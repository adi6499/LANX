import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { CallEvent, CallInfo, Conversation } from "../types";
import { api, errorText, events } from "../lib/api";
import {
  Phone,
  PhoneOff,
  Video,
  VideoOff,
  Mic,
  MicOff,
  MonitorUp,
  MonitorX,
  Maximize2,
  Minimize2,
  MessageSquare,
} from "lucide-react";

/** Imperative handle: the chat header's call buttons start calls here. */
export interface CallLayerHandle {
  start: (conversation: Conversation, video: boolean) => void;
  /** LANX 1.2.8: the Dynamic Island's buttons. */
  accept: (video: boolean) => void;
  decline: () => void;
  hangup: () => void;
  toggleSize: () => void;
}

/** What the Dynamic Island shows about the current call. */
export interface IslandCall {
  status: "starting" | "outgoing" | "incoming" | "connecting" | "active";
  name: string;
  color: string;
  video: boolean;
  connectedAt: number | null;
  private: boolean;
}

interface CallLayerProps {
  onError: (text: string) => void;
  onOpenChat: (conversationId: string) => void;
  /** The call changed (null: no call). */
  onIslandChange?: (call: IslandCall | null) => void;
}

type Status = "starting" | "outgoing" | "incoming" | "connecting" | "active" | "ended";

interface CallState {
  info: CallInfo;
  status: Status;
  muted: boolean;
  camera: boolean;
  screen: boolean;
  remoteVideo: boolean;
  remoteMuted: boolean;
  remoteScreen: boolean;
  connectedAt: number | null;
  endText: string | null;
  expanded: boolean;
}

const CONNECT_TIMEOUT_MS = 20_000;
const DISCONNECT_GRACE_MS = 10_000;

/** Waits until the browser has listed this computer's network addresses
 *  (LAN only, no internet servers), so one offer/answer carries everything. */
function iceGathered(pc: RTCPeerConnection, ms = 2500): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    const check = () => pc.iceGatheringState === "complete" && done();
    const timer = setTimeout(done, ms);
    pc.addEventListener("icegatheringstatechange", check);
  });
}

async function getMic(): Promise<MediaStreamTrack | null> {
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    return s.getAudioTracks()[0] ?? null;
  } catch {
    return null;
  }
}

async function getCam(): Promise<MediaStreamTrack | null> {
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    });
    return s.getVideoTracks()[0] ?? null;
  } catch {
    return null;
  }
}

function endReasonText(reason: string | null, info: CallInfo): string {
  const name = info.peer_name || "They";
  switch (reason) {
    case "declined":
      return info.outgoing ? `${name} declined the call` : "Call declined";
    case "cancelled":
      return info.outgoing ? "Call cancelled" : `Missed call from ${name}`;
    case "timeout":
      return info.outgoing ? "No answer" : "Missed call";
    case "failed":
      return "The call could not connect";
    default:
      return "Call ended";
  }
}

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export const CallLayer = forwardRef<CallLayerHandle, CallLayerProps>(({ onError, onOpenChat, onIslandChange }, ref) => {
  const [call, setCall] = useState<CallState | null>(null);
  const [, setTick] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const callIdRef = useRef<string | null>(null);
  const startingRef = useRef(false);
  const pendingRef = useRef<CallEvent[]>([]);
  const micRef = useRef<MediaStreamTrack | null>(null);
  const camRef = useRef<MediaStreamTrack | null>(null);
  const screenRef = useRef<MediaStreamTrack | null>(null);
  const videoSenderRef = useRef<RTCRtpSender | null>(null);
  const remoteStreamRef = useRef<MediaStream>(new MediaStream());
  const localStreamRef = useRef<MediaStream>(new MediaStream());
  const remoteOfferRef = useRef<string | null>(null);
  const timersRef = useRef<{ connect?: number; disconnect?: number; close?: number }>({});
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const patch = useCallback((p: Partial<CallState>) => setCall((c) => (c ? { ...c, ...p } : c)), []);

  /** Uses this camera for the call and keeps it going: if it stops by itself
   *  (unplugged, taken by another program, a driver hiccup) LANX reopens it;
   *  if that fails the call carries on with voice. (track.stop() by LANX itself
   *  does not fire "ended".) */
  function adoptCamera(cam: MediaStreamTrack | null) {
    camRef.current = cam;
    if (!cam) return;
    cam.onended = async () => {
      if (camRef.current !== cam) return;
      for (let attempt = 0; attempt < 2; attempt++) {
        await new Promise((r) => setTimeout(r, 400));
        if (camRef.current !== cam) return; // turned off, or the call ended
        const again = await getCam();
        if (again && camRef.current === cam) {
          adoptCamera(again);
          if (!screenRef.current) await videoSenderRef.current?.replaceTrack(again).catch(() => {});
          setTick((n) => n + 1);
          return;
        }
        again?.stop();
      }
      if (camRef.current !== cam) return;
      camRef.current = null;
      if (!screenRef.current) await videoSenderRef.current?.replaceTrack(null).catch(() => {});
      patch({ camera: false });
      const id = callIdRef.current;
      if (id) api.callMedia(id, { video: !!screenRef.current }).catch(() => {});
      onErrorRef.current("Your camera stopped working — the call continues with voice.");
    };
  }

  // ------------------------------------------------------------ teardown
  const releaseMedia = useCallback(() => {
    const t = timersRef.current;
    window.clearTimeout(t.connect);
    window.clearTimeout(t.disconnect);
    for (const track of [micRef.current, camRef.current, screenRef.current]) track?.stop();
    micRef.current = camRef.current = screenRef.current = null;
    videoSenderRef.current = null;
    remoteOfferRef.current = null;
    try {
      pcRef.current?.close();
    } catch {
      /* already closed */
    }
    pcRef.current = null;
    remoteStreamRef.current = new MediaStream();
    localStreamRef.current = new MediaStream();
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
  }, []);

  const finish = useCallback(
    (text: string | null) => {
      releaseMedia();
      callIdRef.current = null;
      startingRef.current = false;
      pendingRef.current = [];
      window.clearTimeout(timersRef.current.close);
      if (text === null) {
        setCall(null);
        return;
      }
      setCall((c) => (c ? { ...c, status: "ended", endText: text } : c));
      timersRef.current.close = window.setTimeout(() => setCall((c) => (c?.status === "ended" ? null : c)), 2400);
    },
    [releaseMedia]
  );

  const hangup = useCallback(async () => {
    const id = callIdRef.current;
    finish("Call ended");
    if (id) await api.callHangup(id).catch(() => {});
  }, [finish]);

  // --------------------------------------------------------- connection
  const newPeer = useCallback(() => {
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.ontrack = (e) => {
      const stream = remoteStreamRef.current;
      if (!stream.getTracks().includes(e.track)) stream.addTrack(e.track);
      if (e.track.kind === "audio" && remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = stream;
        remoteAudioRef.current.play().catch(() => {});
      }
      e.track.onunmute = () => setTick((n) => n + 1);
      e.track.onmute = () => setTick((n) => n + 1);
      setTick((n) => n + 1);
    };
    pc.onconnectionstatechange = () => {
      if (pcRef.current !== pc) return;
      const st = pc.connectionState;
      const t = timersRef.current;
      if (st === "connected") {
        window.clearTimeout(t.connect);
        window.clearTimeout(t.disconnect);
        setCall((c) => (c && c.status !== "ended" ? { ...c, status: "active", connectedAt: c.connectedAt ?? Date.now() } : c));
      } else if (st === "disconnected") {
        window.clearTimeout(t.disconnect);
        t.disconnect = window.setTimeout(() => {
          onErrorRef.current("The call dropped — the other computer stopped answering.");
          hangup();
        }, DISCONNECT_GRACE_MS);
      } else if (st === "failed") {
        onErrorRef.current("The call could not connect. Both computers must be on the same network.");
        hangup();
      }
    };
    pcRef.current = pc;
    return pc;
  }, [hangup]);

  const armConnectTimeout = useCallback(() => {
    window.clearTimeout(timersRef.current.connect);
    timersRef.current.connect = window.setTimeout(() => {
      if (pcRef.current && pcRef.current.connectionState !== "connected") {
        onErrorRef.current("The call could not connect. A firewall or a different network may be blocking it.");
        hangup();
      }
    }, CONNECT_TIMEOUT_MS);
  }, [hangup]);

  // ------------------------------------------------------------- events
  const handleEvent = useCallback(
    async (ev: CallEvent) => {
      if (ev.action === "incoming") {
        if (callIdRef.current || startingRef.current) return; // LANX already answered "busy"
        callIdRef.current = ev.call.call_id;
        remoteOfferRef.current = ev.sdp;
        window.clearTimeout(timersRef.current.close);
        setCall({
          info: ev.call,
          status: "incoming",
          muted: false,
          camera: false,
          screen: false,
          remoteVideo: ev.call.video,
          remoteMuted: false,
          remoteScreen: false,
          connectedAt: null,
          endText: null,
          expanded: false,
        });
        return;
      }
      if (startingRef.current && !callIdRef.current) {
        pendingRef.current.push(ev); // our invite is still on its way
        return;
      }
      if (ev.call.call_id !== callIdRef.current) return;
      if (ev.action === "accepted" && ev.sdp && pcRef.current) {
        try {
          await pcRef.current.setRemoteDescription({ type: "answer", sdp: ev.sdp });
          patch({ status: "connecting", remoteVideo: !!ev.video });
          armConnectTimeout();
        } catch (err) {
          onErrorRef.current(`Call setup failed: ${errorText(err)}`);
          hangup();
        }
      } else if (ev.action === "media") {
        setCall((c) =>
          c
            ? {
                ...c,
                remoteVideo: ev.video ?? c.remoteVideo,
                remoteMuted: ev.muted ?? c.remoteMuted,
                remoteScreen: ev.screen ?? c.remoteScreen,
              }
            : c
        );
      } else if (ev.action === "ended") {
        finish(endReasonText(ev.reason, ev.call));
      }
    },
    [armConnectTimeout, finish, hangup, patch]
  );

  const handleEventRef = useRef(handleEvent);
  handleEventRef.current = handleEvent;

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    events
      .onCall((ev) => handleEventRef.current(ev))
      .then((u) => (disposed ? u() : (unlisten = u)))
      .catch(console.error);
    // A reload in the middle of a call leaves no media behind: end it cleanly.
    api
      .getCall()
      .then((c) => c && api.callHangup(c.call_id))
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Call timer.
  const active = call?.status === "active";
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [active]);

  // ----------------------------------------------------------- actions
  const start = useCallback(
    async (conv: Conversation, video: boolean) => {
      if (callIdRef.current || startingRef.current) {
        onErrorRef.current("You're already in a call.");
        return;
      }
      if (conv.kind !== "direct") {
        onErrorRef.current("Calls work in one-to-one chats.");
        return;
      }
      startingRef.current = true;
      pendingRef.current = [];
      window.clearTimeout(timersRef.current.close);
      const placeholder: CallInfo = {
        call_id: "",
        conversation_id: conv.id,
        peer_id: conv.peer_id,
        peer_name: conv.peer_name,
        avatar_color: conv.peer_avatar_color,
        video,
        outgoing: true,
        phase: "ringing",
        started_at: Math.floor(Date.now() / 1000),
        answered_at: null,
        private: false,
      };
      setCall({
        info: placeholder,
        status: "starting",
        muted: false,
        camera: false,
        screen: false,
        remoteVideo: false,
        remoteMuted: false,
        remoteScreen: false,
        connectedAt: null,
        endText: null,
        expanded: false,
      });
      try {
        const mic = await getMic();
        const cam = video ? await getCam() : null;
        if (!mic) onErrorRef.current("No microphone found — the other person won't hear you.");
        if (video && !cam) onErrorRef.current("Your camera isn't available, so this starts as a voice call.");
        micRef.current = mic;
        adoptCamera(cam);
        const local = new MediaStream([mic, cam].filter((t): t is MediaStreamTrack => !!t));
        localStreamRef.current = local;
        const pc = newPeer();
        pc.addTransceiver(mic ?? "audio", { direction: "sendrecv", streams: [local] });
        videoSenderRef.current = pc.addTransceiver(cam ?? "video", { direction: "sendrecv", streams: [local] }).sender;
        await pc.setLocalDescription(await pc.createOffer());
        await iceGathered(pc);
        if (!startingRef.current) return; // cancelled meanwhile
        const info = await api.callStart(conv.id, !!cam, pc.localDescription?.sdp ?? "");
        callIdRef.current = info.call_id;
        startingRef.current = false;
        setCall((c) => (c ? { ...c, info, status: "outgoing", camera: !!cam } : c));
        const queued = pendingRef.current;
        pendingRef.current = [];
        for (const ev of queued) await handleEventRef.current(ev);
      } catch (err) {
        finish(null);
        onErrorRef.current(errorText(err));
      }
    },
    [finish, newPeer]
  );

  // Tell the Dynamic Island about the call (ringing, connecting, live, over).
  const islandKey = call && call.status !== "ended" ? `${call.info.call_id}|${call.status}|${call.connectedAt ?? ""}` : "";
  useEffect(() => {
    if (!onIslandChange) return;
    if (!call || call.status === "ended") {
      onIslandChange(null);
      return;
    }
    onIslandChange({
      status: call.status,
      name: call.info.peer_name,
      color: call.info.avatar_color,
      video: call.info.video,
      connectedAt: call.connectedAt,
      private: call.info.private,
    });
  }, [islandKey]);

  const accept = async (withVideo: boolean) => {
    const id = callIdRef.current;
    const offer = remoteOfferRef.current;
    if (!id || !offer || !call) return;
    patch({ status: "connecting" });
    try {
      const mic = await getMic();
      const cam = withVideo ? await getCam() : null;
      if (!mic) onErrorRef.current("No microphone found — the other person won't hear you.");
      if (withVideo && !cam) onErrorRef.current("Your camera isn't available — answering with voice only.");
      micRef.current = mic;
      adoptCamera(cam);
      const local = new MediaStream([mic, cam].filter((t): t is MediaStreamTrack => !!t));
      localStreamRef.current = local;
      const pc = newPeer();
      await pc.setRemoteDescription({ type: "offer", sdp: offer });
      for (const t of pc.getTransceivers()) {
        const kind = t.receiver.track.kind;
        t.direction = "sendrecv";
        await t.sender.replaceTrack(kind === "audio" ? mic : cam);
        t.sender.setStreams?.(local);
        if (kind === "video") videoSenderRef.current = t.sender;
      }
      await pc.setLocalDescription(await pc.createAnswer());
      await iceGathered(pc);
      if (callIdRef.current !== id) return; // they hung up meanwhile
      await api.callAnswer(id, pc.localDescription?.sdp ?? "", !!cam);
      patch({ camera: !!cam });
      armConnectTimeout();
    } catch (err) {
      onErrorRef.current(errorText(err));
      finish(null);
    }
  };

  const decline = async () => {
    const id = callIdRef.current;
    finish(null);
    if (id) await api.callDecline(id).catch(() => {});
  };

  useImperativeHandle(
    ref,
    () => ({
      start: (c, v) => void start(c, v),
      accept: (v) => void accept(v),
      decline: () => void decline(),
      hangup: () => void cancelStarting(),
      toggleSize: () => setCall((c) => (c ? { ...c, expanded: !c.expanded } : c)),
    }),
    [start, accept, decline]
  );

  const cancelStarting = () => {
    if (startingRef.current && !callIdRef.current) {
      startingRef.current = false;
      finish(null);
    } else {
      hangup();
    }
  };

  const sendMedia = (m: { video?: boolean; muted?: boolean; screen?: boolean }) => {
    const id = callIdRef.current;
    if (id) api.callMedia(id, m).catch(() => {});
  };

  const toggleMute = () => {
    if (!call) return;
    const muted = !call.muted;
    if (micRef.current) micRef.current.enabled = !muted;
    patch({ muted });
    sendMedia({ muted });
  };

  const toggleCamera = async () => {
    if (!call) return;
    const sender = videoSenderRef.current;
    if (call.camera) {
      if (!screenRef.current) await sender?.replaceTrack(null);
      camRef.current?.stop();
      camRef.current = null;
      patch({ camera: false });
      sendMedia({ video: !!screenRef.current });
      return;
    }
    const cam = await getCam();
    if (!cam) {
      onErrorRef.current("No camera found on this computer.");
      return;
    }
    adoptCamera(cam);
    if (!screenRef.current) await sender?.replaceTrack(cam);
    patch({ camera: true });
    sendMedia({ video: true });
  };

  const stopScreen = useCallback(async () => {
    screenRef.current?.stop();
    screenRef.current = null;
    await videoSenderRef.current?.replaceTrack(camRef.current).catch(() => {});
    patch({ screen: false });
    const id = callIdRef.current;
    if (id) api.callMedia(id, { screen: false, video: !!camRef.current }).catch(() => {});
  }, [patch]);

  const toggleScreen = async () => {
    if (!call) return;
    if (call.screen) {
      await stopScreen();
      return;
    }
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15 } }, audio: false });
      const track = s.getVideoTracks()[0];
      if (!track) return;
      track.onended = () => void stopScreen();
      screenRef.current = track;
      await videoSenderRef.current?.replaceTrack(track);
      patch({ screen: true });
      sendMedia({ screen: true, video: true });
    } catch {
      /* the user closed the screen picker */
    }
  };

  // -------------------------------------------------------------- views
  const attachRemoteVideo = useCallback((el: HTMLVideoElement | null) => {
    if (el && el.srcObject !== remoteStreamRef.current) {
      el.srcObject = remoteStreamRef.current;
      el.play().catch(() => {});
    }
  }, []);

  const localPreview = call?.screen ? screenRef.current : call?.camera ? camRef.current : null;
  const attachLocalVideo = useCallback(
    (el: HTMLVideoElement | null) => {
      if (!el) return;
      const stream = localPreview ? new MediaStream([localPreview]) : null;
      if ((el.srcObject as MediaStream | null)?.getTracks()[0] !== localPreview) {
        el.srcObject = stream;
        if (stream) el.play().catch(() => {});
      }
    },
    [localPreview]
  );

  const audioEl = <audio ref={remoteAudioRef} autoPlay data-testid="call-remote-audio" />;

  if (!call) return audioEl;

  const { info, status } = call;
  const name = info.peer_name || "Someone";
  const kindWord = info.video ? "video" : "voice";
  const remoteTrack = remoteStreamRef.current.getVideoTracks()[0];
  const showRemoteVideo = (call.remoteVideo || call.remoteScreen) && !!remoteTrack && status === "active";

  const avatar = (size: string, text: string) => (
    <div
      className={`${size} rounded-full flex items-center justify-center text-white font-bold shadow-xl`}
      style={{ backgroundColor: info.avatar_color }}
    >
      {info.private ? <Phone className="h-1/3 w-1/3" /> : text}
    </div>
  );

  const roundBtn = (
    label: string,
    onClick: () => void,
    icon: ReactNode,
    tone: "red" | "green" | "dark" | "light",
    caption?: string
  ) => (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={onClick}
        className={`h-14 w-14 rounded-full flex items-center justify-center shadow-lg transition-transform active:scale-90 ${
          tone === "red"
            ? "bg-red-500 hover:bg-red-600 text-white"
            : tone === "green"
              ? "bg-emerald-500 hover:bg-emerald-600 text-white lanx-call-pulse"
              : tone === "light"
                ? "bg-white text-slate-900 hover:bg-slate-100"
                : "bg-white/15 hover:bg-white/25 text-white"
        }`}
      >
        {icon}
      </button>
      {caption && <span className="text-[11px] text-white/80">{caption}</span>}
    </div>
  );

  // Ringing, connecting and ended: a calm full-window screen.
  if (status !== "active") {
    const line =
      status === "starting"
        ? "Starting call…"
        : status === "outgoing"
          ? `Ringing… (${kindWord} call)`
          : status === "incoming"
            ? `Incoming ${kindWord} call…`
            : status === "connecting"
              ? "Connecting…"
              : call.endText || "Call ended";
    return (
      <>
        {audioEl}
        <div
          data-call-status={status}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/75 backdrop-blur-md lanx-fade"
        >
          <div className="flex flex-col items-center text-center px-6">
            <div className="relative mb-6">
              {(status === "incoming" || status === "outgoing" || status === "starting") && (
                <>
                  <span className="lanx-call-ring" />
                  <span className="lanx-call-ring lanx-call-ring-2" />
                </>
              )}
              {avatar("h-28 w-28 text-4xl relative", name.charAt(0).toUpperCase())}
            </div>
            <h2 className="text-2xl font-bold text-white">{info.private && status === "incoming" ? "Incoming call" : name}</h2>
            <p className={`mt-1 text-sm ${status === "ended" ? "text-amber-200" : "text-white/70"}`}>{line}</p>
            {status === "incoming" && info.private && (
              <p className="mt-1 text-[11px] text-white/50">The name is hidden because LANX is locked or the chat is hidden.</p>
            )}

            <div className="mt-10 flex items-start gap-8">
              {status === "incoming" && (
                <>
                  {roundBtn("Decline call", decline, <PhoneOff className="h-6 w-6" />, "red", "Decline")}
                  {info.video &&
                    roundBtn("Accept with video", () => accept(true), <Video className="h-6 w-6" />, "green", "Video")}
                  {roundBtn(
                    info.video ? "Accept with voice only" : "Accept call",
                    () => accept(false),
                    <Phone className="h-6 w-6" />,
                    "green",
                    info.video ? "Voice only" : "Accept"
                  )}
                </>
              )}
              {(status === "outgoing" || status === "starting") &&
                roundBtn("Cancel call", cancelStarting, <PhoneOff className="h-6 w-6" />, "red", "Cancel")}
              {status === "connecting" && roundBtn("Hang up", hangup, <PhoneOff className="h-6 w-6" />, "red", "Hang up")}
            </div>
          </div>
        </div>
      </>
    );
  }

  // Active call: a floating panel (bigger with video, or full window).
  const withVideo = showRemoteVideo || !!localPreview;
  const elapsed = call.connectedAt ? clock(Date.now() - call.connectedAt) : "0:00";
  const frame = call.expanded
    ? "fixed inset-4 z-[70]"
    : withVideo
      ? "fixed bottom-6 right-6 z-[70] w-[520px] h-[340px]"
      : "fixed bottom-6 right-6 z-[70] w-[340px]";

  return (
    <>
      {audioEl}
      <div
        data-call-status="active"
        className={`${frame} rounded-3xl bg-slate-950 text-white shadow-2xl shadow-black/40 overflow-hidden border border-white/10 lanx-rise flex flex-col`}
      >
        {withVideo ? (
          <div className="relative flex-1 min-h-0 bg-black">
            {showRemoteVideo ? (
              <video
                ref={attachRemoteVideo}
                autoPlay
                playsInline
                muted
                data-testid="call-remote-video"
                className={`h-full w-full ${call.remoteScreen ? "object-contain" : "object-cover"}`}
              />
            ) : (
              <div className="h-full w-full flex flex-col items-center justify-center gap-2">
                {avatar("h-20 w-20 text-3xl", name.charAt(0).toUpperCase())}
                <span className="text-xs text-white/60">{name}'s camera is off</span>
              </div>
            )}
            {localPreview && (
              <video
                ref={attachLocalVideo}
                autoPlay
                playsInline
                muted
                data-testid="call-local-video"
                className="absolute bottom-3 right-3 w-36 h-24 rounded-xl object-cover border border-white/20 shadow-lg bg-slate-800 -scale-x-100"
              />
            )}
            <div className="absolute top-0 inset-x-0 p-3 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent">
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{name}</div>
                <div className="text-[11px] text-white/70 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> {elapsed}
                  {call.remoteMuted && <span className="flex items-center gap-0.5"><MicOff className="h-3 w-3" /> muted</span>}
                  {call.remoteScreen && <span>· sharing screen</span>}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 p-4 pb-2">
            {avatar("h-12 w-12 text-lg", name.charAt(0).toUpperCase())}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold truncate">{name}</div>
              <div className="text-[11px] text-white/70 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 online-pulse" /> Voice call · {elapsed}
                {call.remoteMuted && <span className="flex items-center gap-0.5"><MicOff className="h-3 w-3" /> muted</span>}
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-center gap-2.5 p-3 bg-slate-950">
          <CtlButton label={call.muted ? "Unmute microphone" : "Mute microphone"} onClick={toggleMute} active={call.muted}>
            {call.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </CtlButton>
          <CtlButton label={call.camera ? "Turn camera off" : "Turn camera on"} onClick={toggleCamera} active={!call.camera}>
            {call.camera ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
          </CtlButton>
          <CtlButton label={call.screen ? "Stop sharing your screen" : "Share your screen"} onClick={toggleScreen} active={call.screen} accent>
            {call.screen ? <MonitorX className="h-4 w-4" /> : <MonitorUp className="h-4 w-4" />}
          </CtlButton>
          <CtlButton label="Open the chat" onClick={() => onOpenChat(info.conversation_id)}>
            <MessageSquare className="h-4 w-4" />
          </CtlButton>
          <CtlButton label={call.expanded ? "Make smaller" : "Make bigger"} onClick={() => patch({ expanded: !call.expanded })}>
            {call.expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </CtlButton>
          <button
            type="button"
            aria-label="Hang up"
            title="Hang up"
            onClick={hangup}
            className="h-10 px-4 rounded-full bg-red-500 hover:bg-red-600 flex items-center gap-1.5 text-xs font-semibold active:scale-95 transition-transform"
          >
            <PhoneOff className="h-4 w-4" /> End
          </button>
        </div>
      </div>
    </>
  );
});

CallLayer.displayName = "CallLayer";

function CtlButton({
  label,
  onClick,
  active,
  accent,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  accent?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`h-10 w-10 rounded-full flex items-center justify-center transition-colors active:scale-90 ${
        active ? (accent ? "bg-sky-500 text-white" : "bg-white text-slate-900") : "bg-white/10 hover:bg-white/20 text-white"
      }`}
    >
      {children}
    </button>
  );
}
