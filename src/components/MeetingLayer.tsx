import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from "react";
import { Conversation, MeetingEvent, MeetingInfo, MeetingPerson, Peer, Profile } from "../types";
import { Avatar } from "./Avatar";
import { api, errorText, events } from "../lib/api";
import { VOICE_BITRATE, clock, getMeetingCam, getMic, getScreen, iceGathered, preferCodecs, tuneSdp, tuneSender, videoBudget, watchQuality } from "../lib/webrtc";
import { Recorder, recordingSupported, type RecTile } from "../lib/recorder";
import {
  Check,
  Circle,
  Hand,
  Maximize2,
  MessageSquare,
  Mic,
  MicOff,
  Minimize2,
  MonitorUp,
  MonitorX,
  Phone,
  PhoneOff,
  Send,
  Square,
  UserPlus,
  Users,
  Video,
  VideoOff,
  X,
} from "lucide-react";
import { FloatingReactions, cleanReaction, useReactionBursts, type ReactionBurst } from "./FloatingReactions";

/** LANX 1.4.0: group meetings (video conferences). Everyone in the meeting is
 *  connected to everyone else directly (WebRTC between the LANX windows on
 *  the LAN); LANX carries the invitations and each pair's offer/answer. */

export interface MeetingLayerHandle {
  /** Start a meeting in this chat (group: everyone online is invited). */
  start: (conversation: Conversation, video: boolean) => void;
  /** Answer the invitation. */
  join: (video: boolean) => void;
  decline: () => void;
  leave: () => void;
  /** Bring the meeting screen back to full size. */
  show: () => void;
  /** "Join again" from a meeting line in a chat. */
  rejoin: (messageId: string) => void;
  /** LANX 3.5.0 (spoken commands and gestures). False when not in a meeting. */
  setMuted: (muted: boolean) => boolean;
  setCamera: (on: boolean) => boolean;
  setHand: (up: boolean) => boolean;
  /** LANX 3.7.0 (gestures): sends an emoji reaction (👍 ❤️ 😂 👏 🎉 ✋ 👋) that
   *  floats over your tile for everyone. False when not in a meeting (or it isn't one of those). */
  react: (emoji: string) => boolean;
  /** LANX 3.7.0 (gestures): flips the microphone / raised hand like their
   *  buttons. The new state, or null when not in a meeting. */
  toggleMute: () => boolean | null;
  toggleHand: () => boolean | null;
}

/** What the Dynamic Island shows about the meeting. */
export interface IslandMeeting {
  status: "invited" | "joining" | "active";
  meetingId: string;
  title: string;
  inviterId: string;
  inviterName: string;
  color: string;
  video: boolean;
  count: number;
  joinedAt: number | null;
  private: boolean;
  recording: boolean;
  /** The meeting screen is small (the island shows a pill). */
  minimized: boolean;
}

interface MeetingLayerProps {
  onError: (text: string) => void;
  /** Friendly notes ("Bharat declined", "Recording saved…"). */
  onNotice: (text: string) => void;
  onOpenChat: (conversationId: string) => void;
  onIslandChange?: (m: IslandMeeting | null) => void;
  profiles?: Record<string, Profile>;
  /** Colleagues (to invite more people). */
  peers: Peer[];
}

/** "phone" (3.4): the meeting is on your phone; this window only shows that. */
type Status = "invited" | "joining" | "active" | "phone";

interface Conn {
  pc: RTCPeerConnection;
  stream: MediaStream;
  audio: RTCRtpTransceiver | null;
  video: RTCRtpTransceiver | null;
  tries: number;
  connected: boolean;
  grace: number | null;
  timer: number | null;
  /** LANX 2.8.0: stops this connection's quality watch. */
  stop?: () => void;
}

interface Me {
  muted: boolean;
  camera: boolean;
  screen: boolean;
  hand: boolean;
}

const OFFER_RETRIES = 4;
const DISCONNECT_GRACE_MS = 8_000;
const CONNECT_TIMEOUT_MS = 15_000;
const LOST_AFTER_MS = 30_000;
const NO_ME: Me = { muted: false, camera: false, screen: false, hand: false };
/** LANX 3.7.0: a reaction older than this (when we first see someone) isn't shown. */
const REACTION_FRESH_MS = 5_000;

function gridCols(n: number) {
  return n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
}

export const MeetingLayer = forwardRef<MeetingLayerHandle, MeetingLayerProps>(
  ({ onError, onNotice, onOpenChat, onIslandChange, profiles = {}, peers }, ref) => {
    const [meeting, setMeetingState] = useState<MeetingInfo | null>(null);
    const meetingRef = useRef<MeetingInfo | null>(null);
    const [status, setStatusState] = useState<Status | null>(null);
    const statusRef = useRef<Status | null>(null);
    const [me, setMeState] = useState<Me>(NO_ME);
    const meRef = useRef<Me>(NO_ME);
    const [, setVersion] = useState(0);
    const bump = useCallback(() => setVersion((v) => v + 1), []);
    const [speaking, setSpeaking] = useState<Set<string>>(() => new Set());
    const [loudest, setLoudest] = useState<string | null>(null);
    const [mini, setMini] = useState(false);
    const [panel, setPanel] = useState<"chat" | "people" | null>(null);
    const panelRef = useRef(panel);
    panelRef.current = panel;
    const [unread, setUnread] = useState(0);
    const [draft, setDraft] = useState("");
    const [pinned, setPinned] = useState<string | null>(null);
    const [recording, setRecording] = useState<{ since: number } | null>(null);
    const recorderRef = useRef<Recorder | null>(null);
    const [confirmRec, setConfirmRec] = useState(false);
    const [inviteSel, setInviteSel] = useState<Set<string>>(() => new Set());
    const [inviting, setInviting] = useState(false);
    const [, setTick] = useState(0);
    const joinedAtRef = useRef<number | null>(null);
    /** LANX 3.7.0: reactions floating over the tiles, and the newest one
     *  handled for each person (their `reaction_at`). */
    const [reactions, addReaction] = useReactionBursts();
    const reactionSeenRef = useRef(new Map<string, number>());

    const connsRef = useRef(new Map<string, Conn>());
    const micRef = useRef<MediaStreamTrack | null>(null);
    const camRef = useRef<MediaStreamTrack | null>(null);
    const screenRef = useRef<MediaStreamTrack | null>(null);
    const onErrorRef = useRef(onError);
    onErrorRef.current = onError;
    const onNoticeRef = useRef(onNotice);
    onNoticeRef.current = onNotice;

    const setMeeting = useCallback((m: MeetingInfo | null) => {
      meetingRef.current = m;
      setMeetingState(m);
    }, []);
    const setStatus = useCallback((s: Status | null) => {
      statusRef.current = s;
      setStatusState(s);
    }, []);
    const setMe = useCallback((patch: Partial<Me>) => {
      meRef.current = { ...meRef.current, ...patch };
      setMeState(meRef.current);
    }, []);

    const myId = () => meetingRef.current?.my_id ?? "";
    const inMeeting = (id: string) => !!meetingRef.current?.people.some((p) => p.device_id === id);
    /** For each pair, the smaller id makes the offer. */
    const shouldOffer = (id: string) => myId() !== "" && myId() < id;
    const currentVideo = () => screenRef.current ?? camRef.current;

    // ------------------------------------------------------------ connections
    const clearTimers = (c: Conn) => {
      if (c.grace) window.clearTimeout(c.grace);
      if (c.timer) window.clearTimeout(c.timer);
      c.grace = c.timer = null;
    };

    const closeConn = useCallback(
      (id: string) => {
        const c = connsRef.current.get(id);
        if (!c) return;
        clearTimers(c);
        c.stop?.();
        c.pc.ontrack = null;
        c.pc.onconnectionstatechange = null;
        c.pc.close();
        connsRef.current.delete(id);
        bump();
      },
      [bump]
    );

    /** The best voice and picture the office network allows; the picture
     *  steps down only when many people are in (everyone sends to everyone). */
    const applyQuality = () => {
      const n = meetingRef.current?.people.length ?? 2;
      const screen = !!screenRef.current;
      const budget = videoBudget(n, screen);
      for (const c of connsRef.current.values()) {
        void tuneSender(c.audio?.sender, { maxBitrate: VOICE_BITRATE, audio: true });
        void tuneSender(c.video?.sender, { ...budget, screen });
      }
    };

    const drop = (id: string) => {
      closeConn(id);
      const m = meetingRef.current;
      if (m) api.meetingDrop(m.meeting_id, id).catch(() => {});
    };

    const retry = (id: string, c: Conn) => {
      if (connsRef.current.get(id) !== c) return;
      c.connected = false;
      if (!inMeeting(id)) {
        closeConn(id);
        return;
      }
      if (shouldOffer(id)) {
        if (c.tries >= OFFER_RETRIES) {
          drop(id);
          return;
        }
        const tries = c.tries + 1;
        c.tries = tries;
        window.setTimeout(() => {
          if (connsRef.current.get(id) === c) void offerTo(id, tries);
        }, 1200 * tries);
      } else if (!c.timer) {
        // They make a new offer; give up if nothing works for a while.
        c.timer = window.setTimeout(() => {
          if (connsRef.current.get(id) === c && !c.connected) drop(id);
        }, LOST_AFTER_MS);
      }
      bump();
    };

    const newConn = (id: string): Conn => {
      const tries = connsRef.current.get(id)?.tries ?? 0;
      closeConn(id);
      const pc = new RTCPeerConnection({ iceServers: [] });
      const c: Conn = { pc, stream: new MediaStream(), audio: null, video: null, tries, connected: false, grace: null, timer: null };
      pc.ontrack = (e) => {
        if (!c.stream.getTracks().includes(e.track)) c.stream.addTrack(e.track);
        e.track.onunmute = bump;
        e.track.onmute = bump;
        bump();
      };
      pc.onconnectionstatechange = () => {
        if (connsRef.current.get(id) !== c) return;
        const s = pc.connectionState;
        if (s === "connected") {
          c.connected = true;
          c.tries = 0;
          clearTimers(c);
          applyQuality();
          c.stop?.();
          c.stop = watchQuality(pc, () => c.video?.sender ?? null, () => videoBudget(meetingRef.current?.people.length ?? 2, !!screenRef.current), {
            screen: () => !!screenRef.current,
          });
        } else if (s === "disconnected") {
          if (!c.grace)
            c.grace = window.setTimeout(() => {
              c.grace = null;
              if (pc.connectionState !== "connected") retry(id, c);
            }, DISCONNECT_GRACE_MS);
        } else if (s === "failed") {
          retry(id, c);
        }
        bump();
      };
      connsRef.current.set(id, c);
      bump();
      return c;
    };

    const offerTo = async (id: string, tries = 0) => {
      const m = meetingRef.current;
      if (!m || !inMeeting(id)) return;
      const c = newConn(id);
      c.tries = tries;
      c.audio = c.pc.addTransceiver("audio", { direction: "sendrecv" });
      c.video = c.pc.addTransceiver("video", { direction: "sendrecv" });
      try {
        await c.audio.sender.replaceTrack(micRef.current);
        await c.video.sender.replaceTrack(currentVideo());
        preferCodecs(c.pc);
        await c.pc.setLocalDescription(await c.pc.createOffer());
        await iceGathered(c.pc);
        if (connsRef.current.get(id) !== c) return;
        await api.meetingSignal(m.meeting_id, id, "offer", c.pc.localDescription?.sdp ?? "");
        c.timer = window.setTimeout(() => {
          c.timer = null;
          if (connsRef.current.get(id) === c && !c.connected) retry(id, c);
        }, CONNECT_TIMEOUT_MS);
      } catch {
        if (connsRef.current.get(id) === c) retry(id, c);
      }
    };

    const maybeOffer = (id: string) => {
      if (id && id !== myId() && shouldOffer(id) && !connsRef.current.has(id)) void offerTo(id);
    };

    const onOffer = async (from: string, sdp: string) => {
      const m = meetingRef.current;
      if (!m) return;
      const c = newConn(from);
      try {
        await c.pc.setRemoteDescription({ type: "offer", sdp: tuneSdp(sdp) });
        for (const t of c.pc.getTransceivers()) {
          const kind = t.receiver.track.kind;
          t.direction = "sendrecv";
          if (kind === "audio" && !c.audio) c.audio = t;
          else if (kind === "video" && !c.video) c.video = t;
        }
        await c.audio?.sender.replaceTrack(micRef.current);
        await c.video?.sender.replaceTrack(currentVideo());
        preferCodecs(c.pc);
        await c.pc.setLocalDescription(await c.pc.createAnswer());
        await iceGathered(c.pc);
        if (connsRef.current.get(from) !== c) return;
        await api.meetingSignal(m.meeting_id, from, "answer", c.pc.localDescription?.sdp ?? "");
        c.timer = window.setTimeout(() => {
          c.timer = null;
          if (connsRef.current.get(from) === c && !c.connected) drop(from);
        }, LOST_AFTER_MS);
      } catch {
        /* the one who offered tries again */
      }
    };

    const onAnswer = async (from: string, sdp: string) => {
      const c = connsRef.current.get(from);
      if (c && c.pc.signalingState === "have-local-offer") {
        await c.pc.setRemoteDescription({ type: "answer", sdp: tuneSdp(sdp) }).catch(() => {});
      }
    };

    const replaceAll = async (kind: "audio" | "video", track: MediaStreamTrack | null) => {
      await Promise.all(
        [...connsRef.current.values()].map((c) => (kind === "audio" ? c.audio : c.video)?.sender.replaceTrack(track).catch(() => {}))
      );
    };

    // --------------------------------------------------------------- media
    const releaseMedia = () => {
      for (const t of [micRef.current, camRef.current, screenRef.current]) t?.stop();
      micRef.current = camRef.current = screenRef.current = null;
    };

    const cleanup = useCallback(() => {
      for (const id of [...connsRef.current.keys()]) closeConn(id);
      releaseMedia();
      recorderRef.current = null;
      setRecording(null);
      setConfirmRec(false);
      setMeeting(null);
      setStatus(null);
      setMe({ ...NO_ME });
      setMini(false);
      setPanel(null);
      setUnread(0);
      setPinned(null);
      setInviteSel(new Set());
      setSpeaking(new Set());
      setLoudest(null);
      reactionSeenRef.current.clear();
      joinedAtRef.current = null;
    }, [closeConn, setMeeting, setStatus, setMe]);

    const grabMedia = async (video: boolean) => {
      const mic = await getMic();
      if (!mic) onNoticeRef.current("No microphone found — the others won't hear you.");
      const cam = video ? await getMeetingCam() : null;
      if (video && !cam) onNoticeRef.current("No camera found — you join without video.");
      micRef.current = mic;
      camRef.current = cam;
      setMe({ muted: !mic, camera: !!cam, screen: false, hand: false });
      return { mic, cam };
    };

    const becameActive = (m: MeetingInfo) => {
      setMeeting(m);
      setStatus("active");
      joinedAtRef.current = Date.now();
      setMini(false);
      api.meetingMedia(m.meeting_id, { muted: meRef.current.muted, camera: meRef.current.camera }).catch(() => {});
      for (const p of m.people) if (!p.is_me) maybeOffer(p.device_id);
    };

    // ------------------------------------------------------------ actions
    const start = async (conv: Conversation, video: boolean) => {
      if (statusRef.current) {
        onErrorRef.current("You're already in a meeting.");
        return;
      }
      setStatus("joining");
      await grabMedia(video);
      try {
        becameActive(await api.meetingStart(conv.id, video));
      } catch (e) {
        releaseMedia();
        cleanup();
        onErrorRef.current(errorText(e));
      }
    };

    const join = async (video: boolean) => {
      const m = meetingRef.current;
      if (!m || statusRef.current !== "invited") return;
      setStatus("joining");
      await grabMedia(video);
      try {
        becameActive(await api.meetingJoin(m.meeting_id));
      } catch (e) {
        cleanup();
        onErrorRef.current(errorText(e));
      }
    };

    const rejoin = async (messageId: string) => {
      if (statusRef.current) {
        onErrorRef.current("You're already in a meeting.");
        return;
      }
      setStatus("joining");
      await grabMedia(true);
      try {
        becameActive(await api.meetingRejoin(messageId));
      } catch (e) {
        cleanup();
        onErrorRef.current(errorText(e));
      }
    };

    const decline = async () => {
      const m = meetingRef.current;
      cleanup();
      if (m) await api.meetingDecline(m.meeting_id).catch(() => {});
    };

    const stopRecording = async (announce = true) => {
      const r = recorderRef.current;
      if (!r) return;
      recorderRef.current = null;
      setRecording(null);
      const m = meetingRef.current;
      if (m) api.meetingMedia(m.meeting_id, { recording: false }).catch(() => {});
      try {
        const res = await r.stop();
        if (announce) onNoticeRef.current(`Recording saved in Documents\\LANX Recordings: ${res.name}`);
      } catch (e) {
        onErrorRef.current(errorText(e));
      }
    };

    const leave = async () => {
      const m = meetingRef.current;
      if (!m) return;
      if (statusRef.current === "invited") {
        await decline();
        return;
      }
      await stopRecording();
      cleanup();
      await api.meetingLeave(m.meeting_id).catch(() => {});
    };

    useImperativeHandle(ref, () => ({
      start: (c, v) => void start(c, v),
      join: (v) => void join(v),
      decline: () => void decline(),
      leave: () => void leave(),
      show: () => setMini(false),
      rejoin: (id) => void rejoin(id),
      setMuted: (m) => {
        if (statusRef.current !== "active") return false;
        if (meRef.current.muted !== m) void toggleMute();
        return true;
      },
      setCamera: (on) => {
        if (statusRef.current !== "active") return false;
        if (meRef.current.camera !== on) void toggleCamera();
        return true;
      },
      setHand: (up) => {
        if (statusRef.current !== "active") return false;
        if (meRef.current.hand !== up) toggleHand();
        return true;
      },
      react: (emoji) => {
        const m = meetingRef.current;
        const r = cleanReaction(emoji);
        if (statusRef.current !== "active" || !m || !r) return false;
        addReaction(r, m.my_id);
        // (Colleagues on LANX older than 3.7.0 don't see it.)
        api.meetingMedia(m.meeting_id, { reaction: r }).catch(() => {});
        return true;
      },
      toggleMute: () => {
        if (statusRef.current !== "active") return null;
        // (Unmuting without a microphone fails with a message, as the button does.)
        const muted = !meRef.current.muted;
        void toggleMute();
        return muted;
      },
      toggleHand: () => {
        if (statusRef.current !== "active") return null;
        toggleHand();
        return meRef.current.hand;
      },
    }));

    // ------------------------------------------------------------- events
    const handleEvent = (e: MeetingEvent) => {
      const cur = meetingRef.current;
      // 3.4: the meeting is on the phone — this window keeps out of the
      // WebRTC and shows "on your phone" until it ends there.
      if (statusRef.current === "phone") {
        if (!cur || !e.meeting || e.meeting.meeting_id !== cur.meeting_id) return;
        if (e.action === "ended" || !e.meeting.on_phone) cleanup();
        else setMeeting(e.meeting);
        return;
      }
      if (e.meeting?.on_phone && e.action !== "ended" && e.action !== "invited") {
        if (cur && e.meeting.meeting_id !== cur.meeting_id) return;
        if (statusRef.current === "active" || statusRef.current === "joining") return;
        for (const id of [...connsRef.current.keys()]) closeConn(id);
        releaseMedia();
        setMeeting(e.meeting);
        setStatus("phone");
        return;
      }
      if (e.action === "invited") {
        if (statusRef.current || !e.meeting) return;
        setMeeting(e.meeting);
        setStatus("invited");
        return;
      }
      if (e.action === "ended") {
        if (cur && e.meeting && e.meeting.meeting_id === cur.meeting_id && statusRef.current === "invited") {
          cleanup();
          if (e.reason === "timeout") onNoticeRef.current(`You missed a meeting with ${cur.private ? "a colleague" : cur.inviter_name}.`);
        }
        return;
      }
      if (!e.meeting) return;
      if (!cur) {
        // "Join again": the meeting becomes known when the first event arrives.
        if (statusRef.current !== "joining" || e.meeting.phase !== "joined") return;
      } else if (e.meeting.meeting_id !== cur.meeting_id) {
        return;
      }
      setMeeting(e.meeting);
      switch (e.action) {
        case "joined":
          for (const p of e.meeting.people) if (!p.is_me) maybeOffer(p.device_id);
          break;
        case "person-joined":
          if (e.from) maybeOffer(e.from);
          break;
        case "person-left":
          if (e.from) closeConn(e.from);
          if (e.from && e.person && e.reason === "offline") onNoticeRef.current(`${e.person.name}'s computer left the network.`);
          break;
        case "signal":
          if (e.from && e.sdp) {
            if (e.kind === "offer") void onOffer(e.from, e.sdp);
            else if (e.kind === "answer") void onAnswer(e.from, e.sdp);
          }
          break;
        case "chat":
          if (panelRef.current !== "chat") setUnread((n) => n + 1);
          break;
        case "declined":
        case "notice":
          if (e.text) onNoticeRef.current(e.text);
          break;
      }
    };
    const handleRef = useRef(handleEvent);
    handleRef.current = handleEvent;
    useEffect(() => {
      let un: (() => void) | undefined;
      let gone = false;
      events.onMeeting((e) => handleRef.current(e)).then((u) => {
        if (gone) u();
        else un = u;
      });
      return () => {
        gone = true;
        un?.();
      };
    }, []);

    // Picture quality follows the number of people.
    const count = meeting?.people.length ?? 0;
    useEffect(() => {
      if (status === "active") applyQuality();
    }, [count, status, me.screen]);

    // The clock.
    useEffect(() => {
      if (status !== "active") return;
      const t = window.setInterval(() => setTick((n) => n + 1), 1000);
      return () => window.clearInterval(t);
    }, [status]);

    // Who is talking (a green ring) and who talked last (the big tile).
    useEffect(() => {
      if (status !== "active") return;
      let ctx: AudioContext;
      try {
        ctx = new AudioContext();
      } catch {
        return;
      }
      type A = { trackId: string; node: AnalyserNode; src: MediaStreamAudioSourceNode; buf: Float32Array<ArrayBuffer> };
      const analysers = new Map<string, A>();
      let hold: string | null = null;
      const timer = window.setInterval(() => {
        const mine = meetingRef.current?.my_id ?? "";
        const want: [string, MediaStreamTrack][] = [];
        if (micRef.current && mine && !meRef.current.muted) want.push([mine, micRef.current]);
        for (const [id, c] of connsRef.current) {
          const t = c.stream.getAudioTracks()[0];
          if (t) want.push([id, t]);
        }
        for (const [id, a] of analysers) {
          if (!want.some(([w, t]) => w === id && t.id === a.trackId)) {
            a.src.disconnect();
            analysers.delete(id);
          }
        }
        for (const [id, t] of want) {
          if (analysers.has(id)) continue;
          try {
            const src = ctx.createMediaStreamSource(new MediaStream([t]));
            const node = ctx.createAnalyser();
            node.fftSize = 512;
            src.connect(node);
            analysers.set(id, { trackId: t.id, node, src, buf: new Float32Array(node.fftSize) });
          } catch {
            /* skip */
          }
        }
        const talking = new Set<string>();
        let top: [string, number] | null = null;
        for (const [id, a] of analysers) {
          a.node.getFloatTimeDomainData(a.buf);
          let sum = 0;
          for (let i = 0; i < a.buf.length; i++) sum += a.buf[i] * a.buf[i];
          const rms = Math.sqrt(sum / a.buf.length);
          if (rms > 0.02) {
            talking.add(id);
            if (!top || rms > top[1]) top = [id, rms];
          }
        }
        if (top && top[0] !== mine) hold = top[0];
        setSpeaking((prev) => (prev.size === talking.size && [...talking].every((x) => prev.has(x)) ? prev : talking));
        setLoudest((prev) => (prev === hold ? prev : hold));
      }, 250);
      return () => {
        window.clearInterval(timer);
        for (const a of analysers.values()) a.src.disconnect();
        ctx.close().catch(() => {});
      };
    }, [status]);

    // LANX 3.7.0: a colleague's new reaction floats over their tile (ours is
    // shown when we send it). Each PC stamps reactions with its own clock, so
    // a newer stamp is what counts; the "a moment ago" check is only for
    // people we see for the first time (e.g. just after joining).
    useEffect(() => {
      if (!meeting || status !== "active") return;
      const seen = reactionSeenRef.current;
      for (const p of meeting.people) {
        if (p.is_me) continue;
        const at = p.reaction_at ?? 0;
        const before = seen.get(p.device_id);
        if (before !== undefined && at <= before) continue;
        seen.set(p.device_id, at);
        const r = cleanReaction(p.reaction);
        if (!r || !at) continue;
        if (before === undefined && Math.abs(Date.now() - at) > REACTION_FRESH_MS) continue;
        addReaction(r, p.device_id, p.name);
      }
    }, [meeting, status, addReaction]);

    // Tell the island.
    const anyRecording = !!recording || !!meeting?.people.some((p) => p.recording && !p.is_me);
    useEffect(() => {
      if (!onIslandChange) return;
      if (!status || !meeting || status === "phone") {
        onIslandChange(null);
        return;
      }
      onIslandChange({
        status,
        meetingId: meeting.meeting_id,
        title: meeting.title,
        inviterId: meeting.inviter_id,
        inviterName: meeting.inviter_name,
        color: meeting.inviter_color,
        video: meeting.video,
        count: meeting.people.length,
        joinedAt: joinedAtRef.current,
        private: meeting.private,
        recording: anyRecording,
        minimized: mini,
      });
    }, [status, meeting?.meeting_id, meeting?.title, count, anyRecording, mini]);

    // Leaving LANX (closing it from the tray) leaves the meeting properly.
    useEffect(() => {
      const bye = () => {
        const m = meetingRef.current;
        if (m && statusRef.current === "active") void api.meetingLeave(m.meeting_id);
      };
      window.addEventListener("beforeunload", bye);
      return () => window.removeEventListener("beforeunload", bye);
    }, []);

    // ------------------------------------------------------------ controls
    const sendMedia = (patch: Partial<Me> & { recording?: boolean }) => {
      const m = meetingRef.current;
      if (m) api.meetingMedia(m.meeting_id, patch).catch(() => {});
    };

    const toggleMute = async () => {
      if (meRef.current.muted && !micRef.current) {
        const mic = await getMic();
        if (!mic) {
          onErrorRef.current("No microphone found on this computer.");
          return;
        }
        micRef.current = mic;
        await replaceAll("audio", mic);
      }
      const muted = !meRef.current.muted;
      if (micRef.current) micRef.current.enabled = !muted;
      setMe({ muted });
      sendMedia({ muted });
    };

    const toggleCamera = async () => {
      if (meRef.current.camera) {
        if (!screenRef.current) await replaceAll("video", null);
        camRef.current?.stop();
        camRef.current = null;
        setMe({ camera: false });
        sendMedia({ camera: false });
        return;
      }
      const cam = await getMeetingCam();
      if (!cam) {
        onErrorRef.current("No camera found on this computer.");
        return;
      }
      camRef.current = cam;
      if (!screenRef.current) await replaceAll("video", cam);
      setMe({ camera: true });
      sendMedia({ camera: true });
    };

    const stopScreen = async () => {
      screenRef.current?.stop();
      screenRef.current = null;
      await replaceAll("video", camRef.current);
      setMe({ screen: false });
      applyQuality();
      sendMedia({ screen: false });
    };

    const toggleScreen = async () => {
      if (meRef.current.screen) {
        await stopScreen();
        return;
      }
      try {
        const track = await getScreen();
        if (!track) return;
        track.onended = () => void stopScreen();
        screenRef.current = track;
        await replaceAll("video", track);
        setMe({ screen: true });
        applyQuality();
        sendMedia({ screen: true });
      } catch {
        /* the screen picker was closed */
      }
    };

    const toggleHand = () => {
      const hand = !meRef.current.hand;
      setMe({ hand });
      sendMedia({ hand });
    };

    const recTiles = (): RecTile[] => {
      const m = meetingRef.current;
      if (!m) return [];
      return m.people.map((p) => {
        if (p.is_me) {
          return {
            id: p.device_id,
            name: p.name,
            color: p.avatar_color,
            video: currentVideo(),
            audio: micRef.current,
            screen: meRef.current.screen,
            muted: meRef.current.muted,
          };
        }
        const c = connsRef.current.get(p.device_id);
        const v = c?.stream.getVideoTracks()[0] ?? null;
        return {
          id: p.device_id,
          name: p.name,
          color: p.avatar_color,
          video: p.camera || p.screen ? v : null,
          audio: c?.stream.getAudioTracks()[0] ?? null,
          screen: p.screen,
          muted: p.muted,
        };
      });
    };

    const startRecording = async () => {
      setConfirmRec(false);
      const m = meetingRef.current;
      if (!m || recorderRef.current) return;
      if (!recordingSupported()) {
        onErrorRef.current("Recording isn't available on this computer.");
        return;
      }
      const r = new Recorder({
        title: m.title || "Meeting",
        kind: "meeting",
        conversationId: m.conversation_id,
        tiles: recTiles,
        onFailed: (text) => {
          onErrorRef.current(text);
          void stopRecording(false);
        },
      });
      try {
        await r.start();
      } catch (e) {
        onErrorRef.current(errorText(e));
        return;
      }
      recorderRef.current = r;
      setRecording({ since: Date.now() });
      sendMedia({ recording: true });
    };

    const sendChat = async () => {
      const m = meetingRef.current;
      const text = draft.trim();
      if (!m || !text) return;
      try {
        const line = await api.meetingChat(m.meeting_id, text);
        setDraft("");
        const cur = meetingRef.current;
        if (cur && cur.meeting_id === m.meeting_id) setMeeting({ ...cur, chat: [...cur.chat, line] });
      } catch (e) {
        onErrorRef.current(errorText(e));
      }
    };

    const invite = async () => {
      const m = meetingRef.current;
      if (!m || !inviteSel.size) return;
      setInviting(true);
      try {
        const problems = await api.meetingInvite(m.meeting_id, [...inviteSel]);
        const sent = inviteSel.size - problems.length;
        if (sent > 0) onNoticeRef.current(sent === 1 ? "Invitation sent." : `${sent} invitations sent.`);
        for (const p of problems) onNoticeRef.current(p);
        setInviteSel(new Set());
      } catch (e) {
        onErrorRef.current(errorText(e));
      } finally {
        setInviting(false);
      }
    };

    // Chat panel: unread clears when it's open; it scrolls to the newest line.
    const chatEnd = useRef<HTMLDivElement | null>(null);
    const chatLen = meeting?.chat.length ?? 0;
    useEffect(() => {
      if (panel === "chat") setUnread(0);
    }, [panel]);
    useEffect(() => {
      chatEnd.current?.scrollIntoView({ block: "end" });
    }, [chatLen, panel]);

    // Local preview stream (one per track).
    const localTrack = me.screen ? screenRef.current : me.camera ? camRef.current : null;
    const localStream = useMemo(() => (localTrack ? new MediaStream([localTrack]) : null), [localTrack]);

    // ---------------------------------------------------------------- views
    const people = meeting?.people ?? [];
    // One speaker per person, made once their sound has arrived (a player
    // started on a stream without sound doesn't pick it up later).
    const audioEls = (
      <>
        {[...connsRef.current.entries()].map(([id, c]) => {
          const track = c.stream.getAudioTracks()[0];
          if (!track) return null;
          return (
            <audio
              key={`${id}-${track.id}`}
              autoPlay
              data-meeting-audio={id}
              ref={(el) => {
                if (el && el.srcObject !== c.stream) {
                  el.srcObject = c.stream;
                  el.play().catch(() => {});
                }
              }}
            />
          );
        })}
      </>
    );

    if (!status || !meeting) {
      if (status === "joining") {
        return (
          <div data-meeting-status="joining" className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 backdrop-blur-md text-white lanx-fade">
            <div className="flex flex-col items-center gap-3">
              <span className="h-10 w-10 rounded-full border-2 border-white/20 border-t-white animate-spin" />
              <p className="text-sm text-white/80">Joining the meeting…</p>
            </div>
          </div>
        );
      }
      return null;
    }

    if (status === "phone") {
      return (
        <div data-meeting-status="phone" className="fixed bottom-5 right-5 z-[70] flex items-center gap-3 rounded-full bg-emerald-600 py-1.5 pl-3.5 pr-1.5 text-white shadow-xl lanx-rise">
          <Users className="h-4 w-4 shrink-0" />
          <div className="min-w-0 pr-1">
            <div className="max-w-[200px] truncate text-[12.5px] font-semibold">{meeting.private ? "Meeting" : meeting.title}</div>
            <div className="text-[11px] text-white/85" data-meeting-phone-line>
              📱 On your phone · {meeting.people.length} in the meeting
            </div>
          </div>
          <button
            type="button"
            aria-label="Leave the meeting"
            title="Leave (the meeting is on your phone)"
            data-meeting-phone-leave
            onClick={() => {
              cleanup();
              void api.meetingLeave(meeting.meeting_id).catch(() => {});
            }}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-red-500 hover:bg-red-600 active:scale-90"
          >
            <PhoneOff className="h-4 w-4" />
          </button>
        </div>
      );
    }

    if (status === "invited" || status === "joining") {
      const hidden = meeting.private;
      return (
        <div data-meeting-status={status} className="fixed inset-0 z-[70] flex items-end justify-center pb-[8vh] bg-slate-950/80 backdrop-blur-md lanx-fade">
          <div className="flex flex-col items-center text-center px-6 text-white">
            <div className="relative mb-6">
              <span className="lanx-call-ring" />
              <span className="lanx-call-ring lanx-call-ring-2" />
              {hidden ? (
                <div className="relative h-28 w-28 rounded-full bg-slate-600 flex items-center justify-center shadow-xl">
                  <Users className="h-10 w-10" />
                </div>
              ) : (
                <Avatar
                  name={meeting.inviter_name}
                  color={meeting.inviter_color}
                  profile={profiles[meeting.inviter_id]}
                  size={112}
                  className="relative shadow-xl rounded-full"
                />
              )}
            </div>
            <h2 className="text-2xl font-bold">{hidden ? "Meeting invitation" : meeting.title || "Meeting"}</h2>
            <p className="mt-1 text-sm text-white/70">
              {status === "joining"
                ? "Joining…"
                : hidden
                  ? "The name is hidden because LANX is locked or the chat is hidden."
                  : `${meeting.inviter_name} invited you to a ${meeting.video ? "video " : ""}meeting`}
            </p>
            {status === "invited" && (
              <div className="mt-10 flex items-start gap-8">
                <RoundBtn label="Decline" onClick={() => void decline()} tone="red">
                  <PhoneOff className="h-6 w-6" />
                </RoundBtn>
                <RoundBtn label="Join with video" onClick={() => void join(true)} tone="green">
                  <Video className="h-6 w-6" />
                </RoundBtn>
                <RoundBtn label="Join with voice only" caption="Voice only" onClick={() => void join(false)} tone="green">
                  <Phone className="h-6 w-6" />
                </RoundBtn>
              </div>
            )}
          </div>
        </div>
      );
    }

    // ---- active
    const recBy = people.filter((p) => p.recording && !p.is_me).map((p) => p.name.split(" ")[0]);
    if (recording) recBy.unshift("You");
    const elapsed = clock(Date.now() - (joinedAtRef.current ?? Date.now()));
    const others = people.filter((p) => !p.is_me);
    const mine = people.find((p) => p.is_me);
    const ordered = mine ? [...others, mine] : others;

    /** `everyone`: the small meeting window shows one tile, so every reaction
     *  floats over it (with the name of whoever made it, when it's someone else). */
    const tileFor = (p: MeetingPerson, big = false, everyone = false) => {
      const c = connsRef.current.get(p.device_id);
      const floating: ReactionBurst[] = everyone
        ? reactions.map((b) => (b.from === p.device_id ? { ...b, name: undefined } : { ...b, name: b.name ?? "You" }))
        : reactions.filter((b) => b.from === p.device_id).map((b) => ({ ...b, name: undefined }));
      const local = p.is_me;
      const state = local
        ? null
        : !c
          ? shouldOffer(p.device_id) ? "Connecting…" : "Waiting for their picture…"
          : c.connected
            ? null
            : c.pc.connectionState === "disconnected" || c.pc.connectionState === "failed"
              ? "Reconnecting…"
              : "Connecting…";
      const person = local ? { ...p, muted: me.muted, camera: me.camera, screen: me.screen, hand: me.hand, recording: !!recording } : p;
      const videoOn = local ? !!localStream : (p.camera || p.screen) && !!c?.stream.getVideoTracks().length;
      return (
        <Tile
          key={p.device_id}
          person={person}
          stream={local ? localStream : (c?.stream ?? null)}
          videoOn={videoOn}
          mirror={local && me.camera && !me.screen}
          speaking={speaking.has(p.device_id)}
          state={state}
          profile={profiles[p.device_id]}
          big={big}
          pinned={pinned === p.device_id}
          onPin={() => setPinned((x) => (x === p.device_id ? null : p.device_id))}
          reactions={floating}
        />
      );
    };

    if (mini) {
      const focus = others.find((p) => p.device_id === (pinned ?? loudest)) ?? others.find((p) => p.screen) ?? others[0] ?? mine;
      return (
        <>
          {audioEls}
          <div
            data-meeting-status="active"
            data-meeting-mini
            className="fixed bottom-6 right-6 z-[70] w-[340px] rounded-3xl bg-slate-950 text-white shadow-2xl shadow-black/40 border border-white/10 overflow-hidden lanx-rise"
          >
            <div className="relative h-[190px] p-1.5">{focus && tileFor(focus, true, true)}</div>
            <div className="flex items-center gap-2 px-3 pb-3 pt-1">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold truncate">{meeting.title || "Meeting"}</div>
                <div className="text-[11px] text-white/60 flex items-center gap-1.5">
                  {recBy.length > 0 && <span className="text-red-400 font-bold">● REC</span>}
                  <span className="tabular-nums">{elapsed}</span> · <span data-meeting-count>{people.length}</span> in meeting
                </div>
              </div>
              <Ctl id="mic" label={me.muted ? "Unmute" : "Mute"} onClick={() => void toggleMute()} on={me.muted} small>
                {me.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </Ctl>
              <Ctl id="size" label="Make bigger" onClick={() => setMini(false)} small>
                <Maximize2 className="h-4 w-4" />
              </Ctl>
              <button
                type="button"
                data-meeting-ctl="leave"
                aria-label="Leave the meeting"
                title="Leave the meeting"
                onClick={() => void leave()}
                className="h-9 w-9 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center active:scale-90 transition-transform"
              >
                <PhoneOff className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      );
    }

    const sharer = pinned ? people.find((p) => p.device_id === pinned) : people.find((p) => p.screen && (p.is_me ? me.screen : true));
    const cols = gridCols(ordered.length);
    const inviteable = peers.filter(
      (p) => p.status === "online" && p.trust_state !== "blocked" && !p.id.startsWith("manual-") && !people.some((x) => x.device_id === p.id)
    );

    return (
      <>
        {audioEls}
        <div data-meeting-status="active" className="fixed inset-0 z-[70] flex flex-col text-white bg-[#0a0e18] lanx-fade">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(56,189,248,0.10),transparent_60%)]" />
          {/* Top bar */}
          <div className="relative flex items-center gap-3 px-5 pt-4 pb-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <h2 className="text-[15px] font-semibold truncate">{meeting.title || "Meeting"}</h2>
                {recBy.length > 0 && (
                  <span
                    data-rec-badge
                    className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 border border-red-400/40 px-2.5 py-0.5 text-[11px] font-semibold text-red-300"
                  >
                    <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" /> Recording · {recBy.join(", ")}
                  </span>
                )}
              </div>
              <div className="text-[12px] text-white/55 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span className="tabular-nums">{elapsed}</span> · <span data-meeting-count>{people.length}</span>{" "}
                {people.length === 1 ? "person (waiting for others…)" : "people"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onOpenChat(meeting.conversation_id)}
              className="hidden sm:inline-flex h-9 px-3 rounded-full bg-white/10 hover:bg-white/15 text-[12px] font-medium items-center gap-1.5"
              title="Open this meeting's chat in LANX"
            >
              <MessageSquare className="h-4 w-4" /> Group chat
            </button>
            <Ctl id="size" label="Make smaller (keep the meeting going)" onClick={() => setMini(true)} small>
              <Minimize2 className="h-4 w-4" />
            </Ctl>
          </div>

          {/* Stage + side panel */}
          <div className="relative flex-1 min-h-0 flex gap-3 px-4 pb-2">
            <div className="flex-1 min-w-0 min-h-0">
              {sharer ? (
                <div className="h-full flex gap-3">
                  <div className="flex-1 min-w-0">{tileFor(sharer, true)}</div>
                  <div className="w-52 shrink-0 flex flex-col gap-3 overflow-y-auto">
                    {ordered
                      .filter((p) => p.device_id !== sharer.device_id)
                      .map((p) => (
                        <div key={p.device_id} className="aspect-video shrink-0">
                          {tileFor(p)}
                        </div>
                      ))}
                  </div>
                </div>
              ) : (
                <div
                  className="grid h-full w-full gap-3"
                  style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: "minmax(0, 1fr)" }}
                >
                  {ordered.map((p) => tileFor(p))}
                </div>
              )}
            </div>

            {panel && (
              <aside data-meeting-panel={panel} className="w-80 shrink-0 rounded-2xl bg-white/[0.06] border border-white/10 flex flex-col min-h-0 lanx-rise">
                <div className="flex items-center justify-between px-4 pt-3 pb-2">
                  <h3 className="text-sm font-semibold">{panel === "chat" ? "Meeting chat" : `People (${people.length})`}</h3>
                  <button type="button" aria-label="Close" onClick={() => setPanel(null)} className="h-7 w-7 rounded-full hover:bg-white/10 flex items-center justify-center">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {panel === "chat" ? (
                  <>
                    <div className="flex-1 min-h-0 overflow-y-auto px-4 space-y-2.5 pb-2">
                      {meeting.chat.length === 0 && <p className="text-xs text-white/45 pt-6 text-center">Messages here are seen by everyone in the meeting and kept in the meeting summary.</p>}
                      {meeting.chat.map((l, i) =>
                        l.from === "" ? (
                          <p key={i} className="text-[11px] text-white/40 text-center">
                            {l.text}
                          </p>
                        ) : (
                          <div key={i} data-meeting-chat-line className="text-[13px] leading-snug">
                            <span className={`font-semibold ${l.from === meeting.my_id ? "text-sky-300" : "text-white/90"}`}>
                              {l.from === meeting.my_id ? "You" : l.name}
                            </span>
                            <span className="ml-1.5 text-[10px] text-white/35">
                              {new Date(l.at * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                            </span>
                            <div className="text-white/85 whitespace-pre-wrap break-words">{l.text}</div>
                          </div>
                        )
                      )}
                      <div ref={chatEnd} />
                    </div>
                    <form
                      className="p-3 flex items-center gap-2 border-t border-white/10"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void sendChat();
                      }}
                    >
                      <input
                        data-meeting-chat-input
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder="Message everyone…"
                        maxLength={2000}
                        className="flex-1 min-w-0 rounded-full bg-white/10 px-3.5 py-2 text-[13px] outline-none placeholder:text-white/40 focus:bg-white/15"
                      />
                      <button type="submit" aria-label="Send" disabled={!draft.trim()} className="h-9 w-9 rounded-full bg-sky-500 disabled:opacity-40 flex items-center justify-center">
                        <Send className="h-4 w-4" />
                      </button>
                    </form>
                  </>
                ) : (
                  <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
                    {ordered.map((p) => {
                      const s = p.is_me ? { ...p, ...me, recording: !!recording } : p;
                      return (
                        <div key={p.device_id} data-meeting-person={p.device_id} className="flex items-center gap-2.5 px-1.5 py-1.5 rounded-xl">
                          <Avatar name={p.name} color={p.avatar_color} profile={profiles[p.device_id]} size={32} />
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] font-medium truncate">
                              {p.name}
                              {p.is_me && <span className="text-white/45"> (you)</span>}
                            </div>
                            {p.device_id === meeting.host_id && <div className="text-[10px] text-white/45">Started the meeting</div>}
                          </div>
                          {s.hand && <span title="Hand raised">✋</span>}
                          {s.recording && <span className="text-[10px] font-bold text-red-400">REC</span>}
                          {s.screen && <MonitorUp className="h-3.5 w-3.5 text-sky-300" />}
                          {s.camera ? <Video className="h-3.5 w-3.5 text-white/60" /> : <VideoOff className="h-3.5 w-3.5 text-white/30" />}
                          {s.muted ? <MicOff className="h-3.5 w-3.5 text-red-400" /> : <Mic className="h-3.5 w-3.5 text-white/60" />}
                        </div>
                      );
                    })}
                    <div className="mt-3 pt-3 border-t border-white/10">
                      <div className="px-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/45 mb-1.5">Invite people</div>
                      {inviteable.length === 0 ? (
                        <p className="px-1.5 text-xs text-white/45">Nobody else is online right now.</p>
                      ) : (
                        <>
                          {inviteable.map((p) => {
                            const on = inviteSel.has(p.id);
                            return (
                              <button
                                key={p.id}
                                type="button"
                                data-invite-pick={p.id}
                                onClick={() =>
                                  setInviteSel((s) => {
                                    const n = new Set(s);
                                    if (on) n.delete(p.id);
                                    else n.add(p.id);
                                    return n;
                                  })
                                }
                                className={`w-full flex items-center gap-2.5 px-1.5 py-1.5 rounded-xl text-left ${on ? "bg-sky-500/20" : "hover:bg-white/5"}`}
                              >
                                <Avatar name={p.display_name} color={p.avatar_color} profile={profiles[p.id]} size={28} />
                                <span className="flex-1 min-w-0 truncate text-[13px]">{p.display_name}</span>
                                <span className={`h-5 w-5 rounded-full border flex items-center justify-center ${on ? "bg-sky-500 border-sky-500" : "border-white/30"}`}>
                                  {on && <Check className="h-3 w-3" />}
                                </span>
                              </button>
                            );
                          })}
                          <button
                            type="button"
                            data-invite-send
                            disabled={!inviteSel.size || inviting}
                            onClick={() => void invite()}
                            className="mt-2 w-full h-9 rounded-full bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-[13px] font-semibold inline-flex items-center justify-center gap-1.5"
                          >
                            <UserPlus className="h-4 w-4" /> {inviting ? "Inviting…" : `Invite${inviteSel.size ? ` (${inviteSel.size})` : ""}`}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </aside>
            )}
          </div>

          {/* Controls */}
          <div className="relative flex items-center justify-center gap-2.5 px-4 pt-2 pb-5">
            <Ctl id="mic" label={me.muted ? "Unmute your microphone" : "Mute your microphone"} onClick={() => void toggleMute()} on={me.muted} danger>
              {me.muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </Ctl>
            <Ctl id="camera" label={me.camera ? "Turn your camera off" : "Turn your camera on"} onClick={() => void toggleCamera()} on={!me.camera}>
              {me.camera ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
            </Ctl>
            <Ctl id="screen" label={me.screen ? "Stop sharing your screen" : "Share your screen"} onClick={() => void toggleScreen()} on={me.screen} accent>
              {me.screen ? <MonitorX className="h-5 w-5" /> : <MonitorUp className="h-5 w-5" />}
            </Ctl>
            <Ctl id="hand" label={me.hand ? "Lower your hand" : "Raise your hand"} onClick={toggleHand} on={me.hand} accent>
              <Hand className="h-5 w-5" />
            </Ctl>
            <div className="relative">
              <Ctl
                id="record"
                label={recording ? "Stop recording" : "Record the meeting"}
                onClick={() => (recording ? void stopRecording() : setConfirmRec((v) => !v))}
                on={!!recording}
                danger
              >
                {recording ? <Square className="h-4 w-4 fill-current" /> : <Circle className="h-5 w-5" />}
              </Ctl>
              {recording && (
                <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-red-500 px-1.5 text-[10px] font-bold tabular-nums">
                  {clock(Date.now() - recording.since)}
                </span>
              )}
              {confirmRec && (
                <div data-record-confirm className="absolute bottom-14 left-1/2 -translate-x-1/2 w-72 rounded-2xl bg-slate-900/95 border border-white/15 shadow-2xl p-4 text-left lanx-rise">
                  <div className="text-sm font-semibold">Record this meeting?</div>
                  <p className="mt-1 text-[12px] leading-snug text-white/65">
                    Everyone in the meeting will see that you are recording. It is saved on this computer in Documents\LANX Recordings.
                  </p>
                  <div className="mt-3 flex justify-end gap-2">
                    <button type="button" onClick={() => setConfirmRec(false)} className="h-8 px-3 rounded-full bg-white/10 hover:bg-white/15 text-[12px]">
                      Cancel
                    </button>
                    <button
                      type="button"
                      data-record-start
                      onClick={() => void startRecording()}
                      className="h-8 px-3 rounded-full bg-red-500 hover:bg-red-400 text-[12px] font-semibold inline-flex items-center gap-1.5"
                    >
                      <Circle className="h-3 w-3 fill-current" /> Start recording
                    </button>
                  </div>
                </div>
              )}
            </div>
            <span className="mx-1 h-8 w-px bg-white/10" />
            <div className="relative">
              <Ctl id="chat" label="Meeting chat" onClick={() => setPanel((p) => (p === "chat" ? null : "chat"))} on={panel === "chat"} accent>
                <MessageSquare className="h-5 w-5" />
              </Ctl>
              {unread > 0 && (
                <span data-chat-unread className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-[10px] font-bold flex items-center justify-center">
                  {unread}
                </span>
              )}
            </div>
            <Ctl id="people" label="People and invitations" onClick={() => setPanel((p) => (p === "people" ? null : "people"))} on={panel === "people"} accent>
              <Users className="h-5 w-5" />
            </Ctl>
            <button
              type="button"
              data-meeting-ctl="leave"
              aria-label="Leave the meeting"
              title="Leave the meeting"
              onClick={() => void leave()}
              className="ml-2 h-12 px-5 rounded-full bg-red-500 hover:bg-red-600 flex items-center gap-2 text-sm font-semibold active:scale-95 transition-transform shadow-lg shadow-red-500/25"
            >
              <PhoneOff className="h-5 w-5" /> Leave
            </button>
          </div>
        </div>
      </>
    );
  }
);

MeetingLayer.displayName = "MeetingLayer";

function Tile({
  person,
  stream,
  videoOn,
  mirror,
  speaking,
  state,
  profile,
  big,
  pinned,
  onPin,
  reactions = [],
}: {
  person: MeetingPerson;
  stream: MediaStream | null;
  videoOn: boolean;
  mirror: boolean;
  speaking: boolean;
  state: string | null;
  profile?: Profile;
  big: boolean;
  pinned: boolean;
  onPin: () => void;
  /** LANX 3.7.0: reactions floating over this tile. */
  reactions?: ReactionBurst[];
}) {
  const attach = useCallback(
    (el: HTMLVideoElement | null) => {
      if (el && el.srcObject !== stream) {
        el.srcObject = stream;
        el.play().catch(() => {});
      }
    },
    [stream]
  );
  return (
    <div
      data-meeting-tile={person.device_id}
      data-video-on={videoOn ? "1" : "0"}
      data-speaking={speaking ? "1" : "0"}
      onDoubleClick={onPin}
      title={pinned ? "Double-click to unpin" : "Double-click to show large"}
      className={`group relative h-full w-full rounded-2xl overflow-hidden bg-slate-800/70 transition-shadow duration-200 ${
        speaking ? "ring-[3px] ring-emerald-400 shadow-[0_0_24px_rgba(52,211,153,0.35)]" : "ring-1 ring-white/10"
      }`}
    >
      {videoOn ? (
        <video
          ref={attach}
          autoPlay
          playsInline
          muted
          className={`h-full w-full ${person.screen ? "object-contain bg-black" : "object-cover"} ${mirror ? "-scale-x-100" : ""}`}
        />
      ) : (
        <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
          <Avatar name={person.name} color={person.avatar_color} profile={profile} size={big ? 96 : 64} className="rounded-full shadow-xl" />
        </div>
      )}
      {state && (
        <span
          data-tile-state
          className="absolute top-2.5 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full bg-black/55 backdrop-blur-sm px-2.5 py-1 text-[11px] text-white/85 whitespace-nowrap"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-amber-300 animate-pulse" /> {state}
        </span>
      )}
      <div className="absolute bottom-2 left-2 right-2 flex items-center gap-1.5">
        <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-black/55 backdrop-blur-sm px-2.5 py-1 text-[12px] font-medium">
          {person.muted && <MicOff className="h-3.5 w-3.5 shrink-0 text-red-400" />}
          {person.screen && <MonitorUp className="h-3.5 w-3.5 shrink-0 text-sky-300" />}
          <span className="truncate">
            {person.name}
            {person.is_me && " (you)"}
          </span>
        </span>
      </div>
      {person.hand && (
        <span
          data-hand-raised
          className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-amber-400 text-amber-950 px-2 py-0.5 text-[11px] font-bold shadow-lg"
        >
          <Hand className="h-3.5 w-3.5 lanx-bell" /> Hand raised
        </span>
      )}
      {person.recording && (
        <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-red-500/90 px-2 py-0.5 text-[10px] font-bold">
          <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" /> REC
        </span>
      )}
      <FloatingReactions bursts={reactions} size={big ? "lg" : "md"} />
    </div>
  );
}

function Ctl({
  id,
  label,
  onClick,
  on,
  accent,
  danger,
  small,
  children,
}: {
  id: string;
  label: string;
  onClick: () => void;
  on?: boolean;
  accent?: boolean;
  danger?: boolean;
  small?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-meeting-ctl={id}
      aria-label={label}
      aria-pressed={!!on}
      title={label}
      onClick={onClick}
      className={`${small ? "h-9 w-9" : "h-12 w-12"} rounded-full flex items-center justify-center transition-colors active:scale-90 ${
        on
          ? danger
            ? "bg-red-500/90 text-white hover:bg-red-500"
            : accent
              ? "bg-sky-500 text-white hover:bg-sky-400"
              : "bg-white text-slate-900 hover:bg-white/90"
          : "bg-white/10 hover:bg-white/20 text-white"
      }`}
    >
      {children}
    </button>
  );
}

function RoundBtn({
  label,
  caption,
  onClick,
  tone,
  children,
}: {
  label: string;
  caption?: string;
  onClick: () => void;
  tone: "red" | "green";
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={onClick}
        className={`h-14 w-14 rounded-full flex items-center justify-center shadow-lg transition-transform active:scale-90 text-white ${
          tone === "red" ? "bg-red-500 hover:bg-red-600" : "bg-emerald-500 hover:bg-emerald-600 lanx-call-pulse"
        }`}
      >
        {children}
      </button>
      <span className="text-[11px] text-white/80">{caption ?? label.replace(" with video", "").replace("Join", "Join")}</span>
    </div>
  );
}
