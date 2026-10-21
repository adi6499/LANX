import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { CallEvent, CallInfo, Conversation, Profile } from "../types";
import { Avatar } from "./Avatar";
import { api, errorText, events } from "../lib/api";
import { Recorder, recordingSupported } from "../lib/recorder";
import { VOICE_BITRATE, getCamera, getMic, getScreen, tuneSdp, tuneSender, videoBudget } from "../lib/webrtc";
import { CLIP_MAX, REMOTE_CHANNEL, RemoteInput, RemoteLink, RemoteMsg } from "../lib/remote";
import { RemoteAskDialog, RemoteKeysButton, RemoteScreenButton, RemoteSurface } from "./remote/RemoteControl";
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
  Circle,
  Square,
  MousePointer2,
} from "lucide-react";

/** Imperative handle: the chat header's call buttons start calls here. */
export interface CallLayerHandle {
  /** LANX 1.8.0 `help`: "view" = ask to see their screen, "show" = show them yours. */
  start: (conversation: Conversation, video: boolean, help?: "view" | "show") => void;
  /** LANX 1.2.8: the Dynamic Island's buttons. */
  accept: (video: boolean) => void;
  decline: () => void;
  hangup: () => void;
  toggleSize: () => void;
}

/** What the Dynamic Island shows about the current call. */
export interface IslandCall {
  status: "starting" | "outgoing" | "incoming" | "connecting" | "active";
  peerId: string;
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
  /** LANX 1.2.9: colleagues' profiles (for the caller's avatar). */
  profiles?: Record<string, Profile>;
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
  /** LANX 1.4.0: the other side is recording / we are recording (since). */
  remoteRecording?: boolean;
  recordingSince?: number | null;
  /** LANX 2.0 remote control. */
  remote: RemoteUi;
}

interface RemoteUi {
  /** Their LANX can do remote control (2.0 or newer). */
  peer: boolean;
  /** We control their PC. */
  control: "off" | "asking" | "on";
  /** They control ours. */
  controlled: "off" | "asked" | "on";
  /** Screens their picture could be (more than one: "Switch screen"). */
  screens: number;
  /** A short message ("Bharat said no"). */
  note: string | null;
  /** Why Allow didn't work yet (sharing a single window). */
  problem: string | null;
}

const REMOTE_OFF: RemoteUi = { peer: false, control: "off", controlled: "off", screens: 1, note: null, problem: null };
/** How long a request for control waits for an answer. */
const ASK_TIMEOUT_MS = 60_000;

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

/** LANX 1.4.0: one-to-one calls use the camera in Full HD (see webrtc.ts). */
const getCam = () => getCamera("call");

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

export const CallLayer = forwardRef<CallLayerHandle, CallLayerProps>(({ onError, onOpenChat, onIslandChange, profiles = {} }, ref) => {
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
  const recorderRef = useRef<Recorder | null>(null);
  const callStateRef = useRef<CallState | null>(null);
  callStateRef.current = call;
  // LANX 2.0 remote control.
  const linkRef = useRef<RemoteLink | null>(null);
  const remoteVideoElRef = useRef<HTMLVideoElement | null>(null);
  const clipSeqRef = useRef(0);
  const lastClipRef = useRef<string | null>(null);
  const deniedAtRef = useRef(0);
  const askTimerRef = useRef<number | undefined>(undefined);
  const noteTimerRef = useRef<number | undefined>(undefined);

  const patch = useCallback((p: Partial<CallState>) => setCall((c) => (c ? { ...c, ...p } : c)), []);
  const patchRemote = useCallback(
    (p: Partial<RemoteUi>) => setCall((c) => (c ? { ...c, remote: { ...c.remote, ...p } } : c)),
    []
  );
  /** A short message about remote control, gone after a few seconds. */
  const remoteNote = useCallback(
    (note: string) => {
      patchRemote({ note });
      window.clearTimeout(noteTimerRef.current);
      noteTimerRef.current = window.setTimeout(() => patchRemote({ note: null }), 6000);
    },
    [patchRemote]
  );

  /** LANX 1.4.0: the best voice and picture the office network allows. */
  const tuneCall = useCallback(() => {
    const pc = pcRef.current;
    if (!pc) return;
    for (const t of pc.getTransceivers()) {
      if (t.receiver.track.kind === "audio") void tuneSender(t.sender, { maxBitrate: VOICE_BITRATE, audio: true });
    }
    const screen = !!screenRef.current;
    void tuneSender(videoSenderRef.current, { ...videoBudget(2, screen), screen });
  }, []);

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
    linkRef.current?.close();
    linkRef.current = null;
    window.clearTimeout(askTimerRef.current);
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

  /** Stops our recording and saves it (LANX 1.4.0). */
  const stopRecording = useCallback(async (announce = true) => {
    const r = recorderRef.current;
    if (!r) return;
    recorderRef.current = null;
    setCall((c) => (c ? { ...c, recordingSince: null } : c));
    const id = callIdRef.current;
    if (id) api.callMedia(id, { recording: false }).catch(() => {});
    try {
      const res = await r.stop();
      if (announce) onErrorRef.current(`Recording saved in Documents\\LANX Recordings: ${res.name}`);
    } catch (err) {
      onErrorRef.current(errorText(err));
    }
  }, []);

  const finish = useCallback(
    (text: string | null) => {
      void stopRecording();
      if (callStateRef.current?.remote.controlled === "on") api.remoteStop().catch(() => {});
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
    [releaseMedia, stopRecording]
  );

  const hangup = useCallback(async () => {
    const id = callIdRef.current;
    finish("Call ended");
    if (id) await api.callHangup(id).catch(() => {});
  }, [finish]);

  // --------------------------------------------------------- connection
  const newPeer = useCallback(() => {
    const pc = new RTCPeerConnection({ iceServers: [] });
    // LANX 2.0: the caller's remote-control channel (older callers have none).
    pc.ondatachannel = (e) => {
      if (e.channel.label === REMOTE_CHANNEL && pcRef.current === pc) adoptLink(new RemoteLink(e.channel));
    };
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
        tuneCall();
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
  }, [hangup, tuneCall]);

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
          remote: REMOTE_OFF,
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
          await pcRef.current.setRemoteDescription({ type: "answer", sdp: tuneSdp(ev.sdp) });
          patch({ status: "connecting", remoteVideo: !!ev.video });
          armConnectTimeout();
        } catch (err) {
          onErrorRef.current(`Call setup failed: ${errorText(err)}`);
          hangup();
        }
      } else if (ev.action === "media") {
        if (ev.screen === false && callStateRef.current?.remote.control !== "off") {
          window.clearTimeout(askTimerRef.current);
          patchRemote({ control: "off" });
        }
        setCall((c) =>
          c
            ? {
                ...c,
                remoteVideo: ev.video ?? c.remoteVideo,
                remoteMuted: ev.muted ?? c.remoteMuted,
                remoteScreen: ev.screen ?? c.remoteScreen,
                remoteRecording: ev.recording ?? c.remoteRecording,
              }
            : c
        );
      } else if (ev.action === "ended") {
        finish(endReasonText(ev.reason, ev.call));
      }
    },
    [armConnectTimeout, finish, hangup, patch, patchRemote]
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
    async (conv: Conversation, video: boolean, help?: "view" | "show") => {
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
        remote: REMOTE_OFF,
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
        adoptLink(RemoteLink.create(pc));
        await pc.setLocalDescription(await pc.createOffer());
        await iceGathered(pc);
        if (!startingRef.current) return; // cancelled meanwhile
        const info = await api.callStart(conv.id, !!cam, pc.localDescription?.sdp ?? "", help ?? null);
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

  // ---------------------------------------------------- remote control
  function adoptLink(link: RemoteLink) {
    linkRef.current?.close();
    linkRef.current = link;
    link.onMessage = (m) => handleRemoteRef.current(m);
  }

  const sendRemote = (m: RemoteMsg) => linkRef.current?.send(m);

  const handleRemote = (m: RemoteMsg) => {
    const c = callStateRef.current;
    const id = callIdRef.current;
    if (!c || !id) return;
    const r = c.remote;
    const first = c.info.peer_name.split(" ")[0] || "They";
    switch (m.t) {
      case "hello":
        patchRemote({ peer: true });
        break;
      // --- they ask to control us
      case "req":
        if (r.controlled !== "off") break;
        if (!screenRef.current) {
          sendRemote({ t: "deny", why: "not-sharing" });
        } else if (Date.now() - deniedAtRef.current < 8000) {
          sendRemote({ t: "deny", why: "busy" });
        } else {
          patchRemote({ controlled: "asked", problem: null });
          api.remoteAttention().catch(() => {});
        }
        break;
      case "unreq":
        if (r.controlled === "asked") patchRemote({ controlled: "off", problem: null });
        break;
      case "release":
        if (r.controlled === "on") {
          patchRemote({ controlled: "off" });
          api.remoteStop().catch(() => {});
          remoteNote(`${first} stopped controlling your PC.`);
        }
        break;
      case "in":
        if (r.controlled === "on" && Array.isArray(m.e)) {
          api.remoteInput(id, m.e).catch(() => {
            patchRemote({ controlled: "off" });
            sendRemote({ t: "stop" });
          });
        }
        break;
      case "next-screen":
        if (r.controlled === "on") {
          api
            .remoteNextScreen(id)
            .then((info) => sendRemote({ t: "screens", screens: info.screens, screen: info.screen }))
            .catch(() => {});
        }
        break;
      // --- answers to our request
      case "allow":
        if (r.control === "asking") {
          window.clearTimeout(askTimerRef.current);
          patchRemote({ control: "on", screens: Math.max(1, Number(m.screens) || 1), note: null });
          patch({ expanded: true });
        }
        break;
      case "deny":
        if (r.control === "asking") {
          window.clearTimeout(askTimerRef.current);
          patchRemote({ control: "off" });
          remoteNote(
            m.why === "not-sharing"
              ? `${first} isn't sharing their screen yet.`
              : m.why === "busy"
                ? `${first} said no just now. Try again in a moment.`
                : `${first} said no.`
          );
        }
        break;
      case "stop":
        if (r.control !== "off") {
          window.clearTimeout(askTimerRef.current);
          patchRemote({ control: "off" });
          remoteNote(`${first} took back control.`);
        }
        break;
      case "screens":
        patchRemote({ screens: Math.max(1, Number(m.screens) || 1) });
        remoteNote(`Now on screen ${Number(m.screen) + 1} of ${m.screens}.`);
        break;
      // --- copy and paste between the PCs
      case "clip":
        if ((r.control === "on" || r.controlled === "on") && typeof m.text === "string" && m.text.length <= CLIP_MAX) {
          lastClipRef.current = m.text;
          api
            .clipboardWrite(id, m.text)
            .then((seq) => (clipSeqRef.current = seq))
            .catch(() => {});
        }
        break;
    }
  };
  const handleRemoteRef = useRef(handleRemote);
  handleRemoteRef.current = handleRemote;

  // This PC's remote control ended (the Stop bar, or the call check in Rust).
  useEffect(() => {
    let un: (() => void) | undefined;
    let gone = false;
    events
      .onRemote((info) => {
        const c = callStateRef.current;
        if (!info.active && c?.remote.controlled === "on") {
          sendRemote({ t: "stop" });
          patchRemote({ controlled: "off" });
        }
      })
      .then((u) => (gone ? u() : (un = u)))
      .catch(() => {});
    return () => {
      gone = true;
      un?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Ask / cancel / stop controlling their PC. */
  const toggleControl = () => {
    const c = callStateRef.current;
    if (!c) return;
    const first = c.info.peer_name.split(" ")[0] || "They";
    if (c.remote.control === "off") {
      if (!c.remote.peer) {
        remoteNote(`${first} needs LANX 2.0 or newer for remote control.`);
        return;
      }
      sendRemote({ t: "req" });
      patchRemote({ control: "asking", note: null });
      window.clearTimeout(askTimerRef.current);
      askTimerRef.current = window.setTimeout(() => {
        if (callStateRef.current?.remote.control !== "asking") return;
        sendRemote({ t: "unreq" });
        patchRemote({ control: "off" });
        remoteNote(`${first} didn't answer.`);
      }, ASK_TIMEOUT_MS);
    } else if (c.remote.control === "asking") {
      window.clearTimeout(askTimerRef.current);
      sendRemote({ t: "unreq" });
      patchRemote({ control: "off" });
    } else {
      sendRemote({ t: "release" });
      patchRemote({ control: "off" });
    }
  };

  const sendInput = (e: RemoteInput[]) => {
    if (callStateRef.current?.remote.control === "on") sendRemote({ t: "in", e });
  };

  /** The person being helped pressed Allow. */
  const allowControl = async () => {
    const id = callIdRef.current;
    const track = screenRef.current;
    if (!id) return;
    if (!track) {
      sendRemote({ t: "deny", why: "not-sharing" });
      patchRemote({ controlled: "off" });
      return;
    }
    const st = track.getSettings() as MediaTrackSettings & { displaySurface?: string };
    if (st.displaySurface && st.displaySurface !== "monitor") {
      patchRemote({ problem: "You're sharing a single window. Share your whole screen so they can control it." });
      return;
    }
    try {
      const info = await api.remoteAllow(id, st.width ?? 0, st.height ?? 0);
      if (callStateRef.current?.remote.controlled !== "asked") {
        api.remoteStop().catch(() => {}); // they cancelled meanwhile
        return;
      }
      sendRemote({ t: "allow", screens: info.screens });
      patchRemote({ controlled: "on", problem: null });
    } catch (err) {
      patchRemote({ problem: errorText(err) });
    }
  };

  /** Swap the shared window for the whole screen, then allow. */
  const wholeScreenAllow = async () => {
    let track: MediaStreamTrack | null = null;
    try {
      track = await getScreen(true);
    } catch {
      return; // closed the picker
    }
    if (!track) return;
    const old = screenRef.current;
    track.onended = () => void stopScreen();
    screenRef.current = track;
    await videoSenderRef.current?.replaceTrack(track).catch(() => {});
    old?.stop();
    tuneCall();
    patch({ screen: true });
    patchRemote({ problem: null });
    await allowControl();
  };

  const denyControl = () => {
    deniedAtRef.current = Date.now();
    sendRemote({ t: "deny", why: "no" });
    patchRemote({ controlled: "off", problem: null });
  };

  /** The person being helped takes back control. */
  const stopControlled = () => {
    sendRemote({ t: "stop" });
    patchRemote({ controlled: "off" });
    api.remoteStop().catch(() => {});
  };

  // Copy and paste between the PCs while one controls the other: text you
  // copy is sent across (checked once a second), and theirs lands on yours.
  const clipActive = !!call && (call.remote.control === "on" || call.remote.controlled === "on");
  useEffect(() => {
    const id = callIdRef.current;
    if (!clipActive || !id) return;
    let busy = false;
    let started = false;
    const check = async () => {
      if (busy) return;
      busy = true;
      try {
        const r = await api.clipboardRead(id, started ? clipSeqRef.current : 0);
        if (!started) {
          started = true; // what was copied before doesn't count
          clipSeqRef.current = r.seq;
          lastClipRef.current = r.text;
        } else if (r.seq !== clipSeqRef.current) {
          clipSeqRef.current = r.seq;
          if (r.text && r.text !== lastClipRef.current && r.text.length <= CLIP_MAX) {
            lastClipRef.current = r.text;
            sendRemote({ t: "clip", text: r.text });
          }
        }
      } catch {
        /* the clipboard was busy */
      } finally {
        busy = false;
      }
    };
    void check();
    const t = window.setInterval(() => void check(), 1000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipActive]);

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
      peerId: call.info.peer_id,
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
      await pc.setRemoteDescription({ type: "offer", sdp: tuneSdp(offer) });
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
      start: (c, v, h) => void start(c, v, h),
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
    // No picture, no remote control.
    const r = callStateRef.current?.remote;
    if (r?.controlled === "on" || r?.controlled === "asked") {
      linkRef.current?.send(r.controlled === "on" ? { t: "stop" } : { t: "deny", why: "not-sharing" });
      patchRemote({ controlled: "off", problem: null });
      if (r.controlled === "on") api.remoteStop().catch(() => {});
    }
    screenRef.current?.stop();
    screenRef.current = null;
    await videoSenderRef.current?.replaceTrack(camRef.current).catch(() => {});
    tuneCall();
    patch({ screen: false });
    const id = callIdRef.current;
    if (id) api.callMedia(id, { screen: false, video: !!camRef.current }).catch(() => {});
  }, [patch, patchRemote, tuneCall]);

  const toggleScreen = async () => {
    if (!call) return;
    if (call.screen) {
      await stopScreen();
      return;
    }
    try {
      const track = await getScreen();
      if (!track) return;
      track.onended = () => void stopScreen();
      screenRef.current = track;
      await videoSenderRef.current?.replaceTrack(track);
      tuneCall();
      patch({ screen: true });
      sendMedia({ screen: true, video: true });
    } catch {
      /* the user closed the screen picker */
    }
  };

  // LANX 1.8.0 remote help: the person showing their screen starts sharing
  // as soon as the call is connected (Windows asks which screen to share).
  const helpShareRef = useRef<string | null>(null);
  const helpShows = !!call && ((call.info.help === "show" && call.info.outgoing) || (call.info.help === "view" && !call.info.outgoing));
  useEffect(() => {
    if (!call || call.status !== "active" || !helpShows || call.screen) return;
    if (helpShareRef.current === call.info.call_id) return;
    helpShareRef.current = call.info.call_id;
    void toggleScreen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call?.status, call?.info.call_id, helpShows]);

  /** LANX 1.4.0: record the call (they are told; it's saved on this PC). */
  const toggleRecord = async () => {
    const id = callIdRef.current;
    if (!call || !id) return;
    if (recorderRef.current) {
      await stopRecording();
      return;
    }
    if (!recordingSupported()) {
      onErrorRef.current("Recording isn't available on this computer.");
      return;
    }
    try {
      await api.callMedia(id, { recording: true });
    } catch (err) {
      onErrorRef.current(errorText(err));
      return;
    }
    const info = call.info;
    const r = new Recorder({
      title: `Call with ${info.peer_name || "a colleague"}`,
      kind: "call",
      conversationId: info.conversation_id,
      tiles: () => {
        const c = callStateRef.current;
        const remote = remoteStreamRef.current;
        return [
          {
            id: "them",
            name: info.peer_name || "Colleague",
            color: info.avatar_color,
            video: c && (c.remoteVideo || c.remoteScreen) ? remote.getVideoTracks()[0] ?? null : null,
            audio: remote.getAudioTracks()[0] ?? null,
            screen: !!c?.remoteScreen,
            muted: !!c?.remoteMuted,
          },
          {
            id: "me",
            name: "You",
            color: "#0ea5e9",
            video: screenRef.current ?? camRef.current,
            audio: micRef.current,
            screen: !!screenRef.current,
            muted: !!c?.muted,
          },
        ];
      },
      onFailed: (text) => {
        onErrorRef.current(text);
        void stopRecording(false);
      },
    });
    try {
      await r.start();
    } catch (err) {
      api.callMedia(id, { recording: false }).catch(() => {});
      onErrorRef.current(errorText(err));
      return;
    }
    recorderRef.current = r;
    patch({ recordingSince: Date.now() });
  };

  // -------------------------------------------------------------- views
  const attachRemoteVideo = useCallback((el: HTMLVideoElement | null) => {
    remoteVideoElRef.current = el;
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

  const avatarPx = (size: string) => (size.includes("h-28") ? 112 : size.includes("h-20") ? 80 : 48);
  const avatar = (size: string, text: string) =>
    info.private ? (
      <div
        className={`${size} rounded-full flex items-center justify-center text-white font-bold shadow-xl`}
        style={{ backgroundColor: info.avatar_color }}
      >
        <Phone className="h-1/3 w-1/3" />
      </div>
    ) : (
      <Avatar
        name={text}
        color={info.avatar_color}
        profile={profiles[info.peer_id]}
        size={avatarPx(size)}
        className={`${size.includes("relative") ? "relative" : ""} shadow-xl rounded-full`}
      />
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
    const help = info.help;
    const first = name.split(" ")[0] || "They";
    const line =
      status === "starting"
        ? help ? "Starting remote help…" : "Starting call…"
        : status === "outgoing"
          ? help === "view"
            ? `Asking ${first} to show you their screen…`
            : help === "show"
              ? `Asking ${first} to look at your screen…`
              : `Ringing… (${kindWord} call)`
          : status === "incoming"
            ? help === "view"
              ? `${first} wants to see your screen to help you. You choose what to share, and can stop any time.`
              : help === "show"
                ? `${first} needs help and wants to show you their screen.`
                : `Incoming ${kindWord} call…`
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
            {help && status !== "ended" && (
              <span data-call-help={help} className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-sky-500/20 px-3 py-0.5 text-[12px] font-semibold text-sky-200">
                🛟 Remote help
              </span>
            )}
            <p className={`mt-1 max-w-md text-sm ${status === "ended" ? "text-amber-200" : "text-white/70"}`}>{line}</p>
            {status === "incoming" && info.private && (
              <p className="mt-1 text-[11px] text-white/50">The name is hidden because LANX is locked or the chat is hidden.</p>
            )}

            <div className="mt-10 flex items-start gap-8">
              {status === "incoming" && help && (
                <>
                  {roundBtn("Decline", decline, <PhoneOff className="h-6 w-6" />, "red", "Decline")}
                  {roundBtn(
                    help === "view" ? "Allow and share my screen" : "Join and see their screen",
                    () => accept(false),
                    <Phone className="h-6 w-6" />,
                    "green",
                    help === "view" ? "Allow" : "Join"
                  )}
                </>
              )}
              {status === "incoming" && !help && (
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
  const recBadge =
    call.recordingSince || call.remoteRecording ? (
      <span data-call-rec className="inline-flex items-center gap-1 font-semibold text-red-400">
        <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
        {call.recordingSince ? "Recording" : `${name.split(" ")[0]} is recording`}
      </span>
    ) : null;
  const elapsed = call.connectedAt ? clock(Date.now() - call.connectedAt) : "0:00";
  const rc = call.remote;
  const firstName = name.split(" ")[0] || "They";
  const canControl = showRemoteVideo && call.remoteScreen;
  const controlLabel =
    rc.control === "on"
      ? `Stop controlling ${firstName}'s PC`
      : rc.control === "asking"
        ? `Waiting for ${firstName} to allow… (click to cancel)`
        : rc.peer
          ? `Control ${firstName}'s PC (they must allow it)`
          : `${firstName} needs LANX 2.0 or newer for remote control`;
  const controlledBar =
    rc.controlled === "on" ? (
      <div
        data-remote-controlled
        className="flex items-center justify-between gap-2 bg-orange-500 px-3 py-1.5 text-[12px] font-semibold text-white"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <MousePointer2 className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{firstName} is controlling your PC · move your mouse to take over</span>
        </span>
        <button
          type="button"
          data-remote-stop
          onClick={stopControlled}
          className="shrink-0 rounded-full bg-white px-3 py-0.5 text-[11.5px] font-bold text-orange-600 hover:bg-orange-50"
        >
          Stop
        </button>
      </div>
    ) : null;
  const noteChip = rc.note ? (
    <div
      data-remote-note
      className="pointer-events-none absolute bottom-16 left-1/2 z-20 -translate-x-1/2 rounded-full bg-black/80 px-3 py-1 text-[11.5px] text-white shadow-lg"
    >
      {rc.note}
    </div>
  ) : null;
  const askDialog =
    rc.controlled === "asked" ? (
      <RemoteAskDialog
        name={name}
        problem={rc.problem}
        onAllow={allowControl}
        onDeny={denyControl}
        onWholeScreen={wholeScreenAllow}
      />
    ) : null;
  const frame = call.expanded
    ? "fixed inset-4 z-[70]"
    : withVideo
      ? "fixed bottom-6 right-6 z-[70] w-[520px] h-[340px]"
      : "fixed bottom-6 right-6 z-[70] w-[340px]";

  return (
    <>
      {audioEl}
      {askDialog}
      <div
        data-call-status="active"
        data-remote-state={`${rc.control}|${rc.controlled}|${rc.peer ? "peer" : "old"}`}
        className={`${frame} rounded-3xl bg-slate-950 text-white shadow-2xl shadow-black/40 overflow-hidden border ${rc.controlled === "on" || rc.control === "on" ? "border-orange-500" : "border-white/10"} lanx-rise flex flex-col`}
      >
        {controlledBar}
        {noteChip}
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
            {canControl && rc.control === "on" && (
              <RemoteSurface video={() => remoteVideoElRef.current} name={name} send={sendInput} />
            )}
            {localPreview && rc.control !== "on" && (
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
                  {recBadge}
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
                {recBadge}
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
          {canControl && (
            <span data-remote-ask={rc.control} className={rc.control === "asking" ? "animate-pulse" : ""}>
              <CtlButton label={controlLabel} onClick={toggleControl} active={rc.control !== "off"} danger={rc.control === "on"}>
                <MousePointer2 className={`h-4 w-4 ${rc.peer ? "" : "opacity-50"}`} />
              </CtlButton>
            </span>
          )}
          {canControl && rc.control === "on" && <RemoteKeysButton onCombo={(codes) => sendInput([{ t: "combo", codes }])} />}
          {canControl && rc.control === "on" && rc.screens > 1 && (
            <RemoteScreenButton onClick={() => sendRemote({ t: "next-screen" })} />
          )}
          <CtlButton
            label={call.recordingSince ? "Stop recording" : `Record this call (${name.split(" ")[0]} will see it)`}
            onClick={() => void toggleRecord()}
            active={!!call.recordingSince}
            danger
          >
            {call.recordingSince ? <Square className="h-3.5 w-3.5 fill-current" /> : <Circle className="h-4 w-4" />}
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
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  accent?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`h-10 w-10 rounded-full flex items-center justify-center transition-colors active:scale-90 ${
        active ? (danger ? "bg-red-500 text-white" : accent ? "bg-sky-500 text-white" : "bg-white text-slate-900") : "bg-white/10 hover:bg-white/20 text-white"
      }`}
    >
      {children}
    </button>
  );
}
