/** LANX 3.2 phone page: voice and video calls on the phone. The PC still does
 *  the signalling (src-tauri/src/networking/calls.rs); the phone makes the
 *  WebRTC offer or answer and carries the sound and picture, straight across
 *  the office network to the colleague's PC (no servers). The browser only
 *  allows the microphone and camera on a secure page. */
import type { CallInfo, Conversation } from "../types";
import { iceGathered, preferCodecs, tuneSdp } from "../lib/webrtc";
import { Recorder, recordingSupported } from "../lib/recorder";
import type { PhoneClient } from "./client";

export type CallStatus = "starting" | "outgoing" | "incoming" | "connecting" | "active" | "ended";

export interface PhoneCallState {
  info: CallInfo;
  status: CallStatus;
  muted: boolean;
  camera: boolean;
  facing: "user" | "environment";
  remoteVideo: boolean;
  remoteMuted: boolean;
  remoteRecording: boolean;
  /** 3.4: they share their screen (remote help, or during a call). */
  remoteScreen: boolean;
  /** 3.4: this phone records the call (saved on the PC). */
  recording: boolean;
  connectedAt: number | null;
  endText: string | null;
  /** Bumped when a track arrives or changes (the screen re-attaches). */
  tracks: number;
}

export interface CallPush {
  action: "incoming" | "accepted" | "media" | "ended" | "outgoing" | "answered";
  call: CallInfo;
  sdp: string | null;
  video: boolean | null;
  muted: boolean | null;
  screen: boolean | null;
  reason: string | null;
  recording?: boolean | null;
}

const CONNECT_TIMEOUT_MS = 20_000;
const DISCONNECT_GRACE_MS = 8_000;

/** A media stream, or nothing on a browser without calls (the page must still
 *  start there: an in-app browser, an old phone). */
export const newStream = (tracks?: MediaStreamTrack[]): MediaStream => (typeof MediaStream === "undefined" ? (null as unknown as MediaStream) : tracks ? new MediaStream(tracks) : new MediaStream());

export const canCall = () => window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && typeof RTCPeerConnection !== "undefined";

function endText(reason: string | null, info: CallInfo): string {
  const name = info.peer_name || "They";
  switch (reason) {
    case "declined":
      return info.outgoing ? `${name} declined the call` : "Call declined";
    case "declined_here":
      return "Call declined";
    case "cancelled":
      return info.outgoing ? "Call cancelled" : `Missed call from ${name}`;
    case "timeout":
      return info.outgoing ? "No answer" : "Missed call";
    case "failed":
      return "The call could not connect";
    case "busy":
      return `${name} is on another call`;
    default:
      return "Call ended";
  }
}

// ------------------------------------------------------------------- ringer

let audioCtx: AudioContext | null = null;

/** Phones only play sound after a tap: the first tap anywhere unlocks it. */
export function unlockAudio() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === "suspended") void audioCtx.resume();
  } catch {
    /* no sound then; the phone still vibrates */
  }
}

function beep(freq: number, at: number, len: number) {
  if (!audioCtx) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = "sine";
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(0.18, at + 0.02);
  g.gain.setValueAtTime(0.18, at + len - 0.03);
  g.gain.linearRampToValueAtTime(0, at + len);
  o.connect(g).connect(audioCtx.destination);
  o.start(at);
  o.stop(at + len + 0.01);
}

let ringTimer = 0;

/** "incoming": a two-tone ring and a buzz; "back": the quieter "it's ringing" tone. */
function startRing(kind: "incoming" | "back") {
  stopRing();
  const once = () => {
    if (audioCtx && audioCtx.state === "running") {
      const t = audioCtx.currentTime + 0.02;
      if (kind === "incoming") {
        beep(880, t, 0.35);
        beep(660, t + 0.4, 0.35);
      } else beep(440, t, 0.9);
    }
    if (kind === "incoming") navigator.vibrate?.([400, 200, 400]);
  };
  once();
  ringTimer = window.setInterval(once, kind === "incoming" ? 2000 : 3000);
}

function stopRing() {
  window.clearInterval(ringTimer);
  ringTimer = 0;
  navigator.vibrate?.(0);
}

// --------------------------------------------------------------------- call

export class PhoneCall {
  state: PhoneCallState | null = null;
  /** This phone's device id (from `hello`): which "answered" was ours. */
  myDeviceId = "";
  remoteStream = newStream();
  localStream = newStream();
  private listeners = new Set<() => void>();
  private pc: RTCPeerConnection | null = null;
  private mic: MediaStreamTrack | null = null;
  private cam: MediaStreamTrack | null = null;
  private videoSender: RTCRtpSender | null = null;
  private audioSender: RTCRtpSender | null = null;
  /** Times the phone took the camera / microphone away during this call. */
  private recoveries = 0;
  private callId: string | null = null;
  private offer: string | null = null;
  private starting = false;
  private pending: CallPush[] = [];
  private timers = { connect: 0, disconnect: 0, close: 0 };

  constructor(
    private client: PhoneClient,
    private onProblem: (text: string) => void,
    private onNotice: (text: string) => void = onProblem
  ) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  snapshot = () => this.state;

  private set(next: PhoneCallState | null) {
    this.state = next;
    for (const fn of this.listeners) fn();
  }

  private patch(p: Partial<PhoneCallState>) {
    if (this.state) this.set({ ...this.state, ...p });
  }

  private blank(info: CallInfo, status: CallStatus): PhoneCallState {
    return { info, status, muted: false, camera: false, facing: "user", remoteVideo: info.video, remoteMuted: false, remoteRecording: false, remoteScreen: false, recording: false, connectedAt: null, endText: null, tracks: 0 };
  }

  // ------------------------------------------------------------- media

  private async getMic(): Promise<MediaStreamTrack | null> {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const t = s.getAudioTracks()[0] ?? null;
      if (t) t.contentHint = "speech";
      return t;
    } catch {
      return null;
    }
  }

  private async getCam(facing: "user" | "environment"): Promise<MediaStreamTrack | null> {
    for (const video of [{ facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }, { facingMode: facing }, true as const]) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video });
        const t = s.getVideoTracks()[0] ?? null;
        if (t) t.contentHint = "motion";
        return t;
      } catch {
        /* try a simpler request */
      }
    }
    return null;
  }

  private release() {
    stopRing();
    for (const t of [this.mic, this.cam]) t?.stop();
    this.mic = this.cam = null;
    this.videoSender = null;
    this.audioSender = null;
    this.recoveries = 0;
    try {
      this.pc?.close();
    } catch {
      /* already closed */
    }
    this.pc = null;
    this.offer = null;
    this.remoteStream = newStream();
    this.localStream = newStream();
    window.clearTimeout(this.timers.connect);
    window.clearTimeout(this.timers.disconnect);
  }

  private finish(text: string | null) {
    void this.stopRecording();
    this.release();
    this.callId = null;
    this.starting = false;
    this.pending = [];
    window.clearTimeout(this.timers.close);
    if (text === null || !this.state) {
      this.set(null);
      return;
    }
    this.set({ ...this.state, status: "ended", endText: text });
    this.timers.close = window.setTimeout(() => {
      if (this.state?.status === "ended") this.set(null);
    }, 2400);
  }

  private newPeer(): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.ontrack = (e) => {
      if (!this.remoteStream.getTracks().includes(e.track)) this.remoteStream.addTrack(e.track);
      e.track.onunmute = () => this.patch({ tracks: (this.state?.tracks ?? 0) + 1 });
      e.track.onmute = () => this.patch({ tracks: (this.state?.tracks ?? 0) + 1 });
      this.patch({ tracks: (this.state?.tracks ?? 0) + 1 });
    };
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      const st = pc.connectionState;
      if (st === "connected") {
        window.clearTimeout(this.timers.connect);
        window.clearTimeout(this.timers.disconnect);
        stopRing();
        if (this.state && this.state.status !== "ended") this.patch({ status: "active", connectedAt: this.state.connectedAt ?? Date.now() });
      } else if (st === "disconnected") {
        window.clearTimeout(this.timers.disconnect);
        this.timers.disconnect = window.setTimeout(() => {
          this.onProblem("The call dropped — the other side stopped answering.");
          void this.hangup();
        }, DISCONNECT_GRACE_MS);
      } else if (st === "failed") {
        this.onProblem("The call could not connect. The phone and the PC must be on the same Wi-Fi.");
        void this.hangup();
      }
    };
    this.pc = pc;
    return pc;
  }

  private armConnectTimeout() {
    window.clearTimeout(this.timers.connect);
    this.timers.connect = window.setTimeout(() => {
      if (this.pc && this.pc.connectionState !== "connected") {
        this.onProblem("The call could not connect. The phone and the PC must be on the same Wi-Fi.");
        void this.hangup();
      }
    }, CONNECT_TIMEOUT_MS);
  }

  /** The picture this phone shows of itself: a fresh stream, so the preview
   *  picks up a new camera at once. */
  private refreshLocal() {
    this.localStream = newStream([this.mic, this.cam].filter((t): t is MediaStreamTrack => !!t && t.readyState === "live"));
    this.patch({ tracks: (this.state?.tracks ?? 0) + 1 });
  }

  /** Uses `cam` as the call's camera. A phone can take the camera away by
   *  itself (another app wants it, an interruption): the call then picks the
   *  camera up again, so the picture carries on. */
  private adoptCam(cam: MediaStreamTrack | null) {
    this.cam = cam;
    if (!cam) return;
    cam.onended = () => {
      if (this.cam === cam && this.callId && this.state && this.state.status !== "ended") void this.recover("video", cam);
    };
  }

  /** The same for the microphone. */
  private adoptMic(mic: MediaStreamTrack | null) {
    this.mic = mic;
    if (!mic) return;
    mic.onended = () => {
      if (this.mic === mic && this.callId && this.state && this.state.status !== "ended") void this.recover("audio", mic);
    };
  }

  private async recover(kind: "audio" | "video", lost: MediaStreamTrack) {
    if (this.recoveries >= 4) {
      if (kind === "video") {
        this.onProblem("The phone's camera stopped. Tap the camera button to try again.");
        this.cam = null;
        await this.videoSender?.replaceTrack(null).catch(() => {});
        this.patch({ camera: false });
        if (this.callId) this.client.request("call_media", { call_id: this.callId, video: false }).catch(() => {});
      } else this.onProblem("The phone's microphone stopped.");
      this.refreshLocal();
      return;
    }
    this.recoveries++;
    await new Promise((r) => window.setTimeout(r, 300));
    const fresh = kind === "video" ? await this.getCam(this.state?.facing ?? "user") : await this.getMic();
    const still = kind === "video" ? this.cam === lost : this.mic === lost;
    if (!fresh || !still || !this.callId) {
      fresh?.stop();
      if (!fresh && still) void this.recover(kind, lost);
      return;
    }
    if (kind === "video") {
      await this.videoSender?.replaceTrack(fresh);
      this.adoptCam(fresh);
    } else {
      fresh.enabled = !(this.state?.muted ?? false);
      await this.audioSender?.replaceTrack(fresh);
      this.adoptMic(fresh);
    }
    this.refreshLocal();
  }

  // ------------------------------------------------------------ events

  async handle(ev: CallPush) {
    const id = ev.call.call_id;
    if (ev.action === "incoming") {
      if (this.callId || this.starting) return; // the PC already said "busy"
      this.callId = id;
      this.offer = ev.sdp;
      window.clearTimeout(this.timers.close);
      this.set(this.blank(ev.call, "incoming"));
      startRing("incoming");
      return;
    }
    if (this.starting && !this.callId) {
      this.pending.push(ev); // our call is still being set up
      return;
    }
    if (id !== this.callId) return;
    switch (ev.action) {
      case "answered":
        if (ev.call.on_phone === this.myDeviceId) return; // that was us
        if (this.state?.status === "incoming") this.finish(ev.call.on_phone ? "Answered on another phone" : "Answered on your PC");
        return;
      case "outgoing":
        return;
      case "accepted":
        if (!this.pc || !ev.sdp) return;
        try {
          stopRing();
          await this.pc.setRemoteDescription({ type: "answer", sdp: tuneSdp(ev.sdp) });
          this.patch({ status: "connecting", remoteVideo: !!ev.video });
          this.armConnectTimeout();
        } catch (e) {
          this.onProblem(`Call setup failed: ${e instanceof Error ? e.message : String(e)}`);
          void this.hangup();
        }
        return;
      case "media":
        if (this.state)
          this.patch({
            remoteVideo: ev.video ?? (ev.screen ? true : this.state.remoteVideo),
            remoteScreen: ev.screen ?? this.state.remoteScreen,
            remoteMuted: ev.muted ?? this.state.remoteMuted,
            remoteRecording: ev.recording ?? this.state.remoteRecording,
          });
        return;
      case "ended":
        this.finish(endText(ev.reason, ev.call));
        return;
    }
  }

  /** On (re)connecting: a call still ringing can be answered; one this phone
   *  carried before the page reloaded has lost its sound, so it is ended. */
  async resume() {
    try {
      const r = await this.client.request<{ call: CallInfo | null; offer: string | null }>("call_get");
      const c = r.call;
      if (!c || this.callId) return;
      if (c.on_phone === this.myDeviceId) {
        await this.client.request("call_hangup", { call_id: c.call_id }).catch(() => {});
        return;
      }
      if (!c.outgoing && c.phase === "ringing" && r.offer) await this.handle({ action: "incoming", call: c, sdp: r.offer, video: c.video, muted: null, screen: null, reason: null });
    } catch {
      /* not connected yet */
    }
  }

  // ----------------------------------------------------------- actions

  /** `help` "view" (3.4): remote help — ask to see their screen. */
  async start(conv: Conversation, video: boolean, help?: "view") {
    if (this.callId || this.starting) {
      this.onProblem("You're already in a call.");
      return;
    }
    if (!canCall()) {
      this.onProblem("Calls on the phone need the secure connection — More → Secure connection & alerts.");
      return;
    }
    this.starting = true;
    this.pending = [];
    window.clearTimeout(this.timers.close);
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
      on_phone: this.myDeviceId,
      help: help ?? null,
    };
    this.set(this.blank(placeholder, "starting"));
    try {
      const mic = await this.getMic();
      const cam = video ? await this.getCam("user") : null;
      if (!mic) this.onProblem("The phone did not allow the microphone — they won't hear you.");
      if (video && !cam) this.onProblem("The camera isn't available, so this starts as a voice call.");
      this.adoptMic(mic);
      this.adoptCam(cam);
      this.localStream = newStream([mic, cam].filter((t): t is MediaStreamTrack => !!t));
      const pc = this.newPeer();
      this.audioSender = pc.addTransceiver(mic ?? "audio", { direction: "sendrecv", streams: [this.localStream] }).sender;
      this.videoSender = pc.addTransceiver(cam ?? "video", { direction: "sendrecv", streams: [this.localStream] }).sender;
      preferCodecs(pc);
      await pc.setLocalDescription(await pc.createOffer());
      await iceGathered(pc);
      if (!this.starting) return; // cancelled meanwhile
      const r = await this.client.request<{ call: CallInfo }>("call_start", { conv: conv.id, video: !!cam, sdp: pc.localDescription?.sdp ?? "", help: help ?? null });
      this.callId = r.call.call_id;
      this.starting = false;
      this.set({ ...(this.state ?? this.blank(r.call, "outgoing")), info: r.call, status: "outgoing", camera: !!cam, remoteVideo: false });
      startRing("back");
      const queued = this.pending;
      this.pending = [];
      for (const ev of queued) await this.handle(ev);
    } catch (e) {
      this.finish(null);
      this.onProblem(e instanceof Error ? e.message : String(e));
    }
  }

  async answer(withVideo: boolean) {
    const id = this.callId;
    const offer = this.offer;
    if (!id || !offer || !this.state) return;
    if (!canCall()) {
      this.onProblem("Calls on the phone need the secure connection — answer on your PC, or set it up under More.");
      return;
    }
    stopRing();
    this.patch({ status: "connecting" });
    try {
      const mic = await this.getMic();
      const cam = withVideo ? await this.getCam("user") : null;
      if (!mic) this.onProblem("The phone did not allow the microphone — they won't hear you.");
      this.adoptMic(mic);
      this.adoptCam(cam);
      this.localStream = newStream([mic, cam].filter((t): t is MediaStreamTrack => !!t));
      const pc = this.newPeer();
      await pc.setRemoteDescription({ type: "offer", sdp: tuneSdp(offer) });
      for (const t of pc.getTransceivers()) {
        const kind = t.receiver.track.kind;
        t.direction = "sendrecv";
        await t.sender.replaceTrack(kind === "audio" ? mic : cam);
        t.sender.setStreams?.(this.localStream);
        if (kind === "video") this.videoSender = t.sender;
        else this.audioSender = t.sender;
      }
      preferCodecs(pc);
      await pc.setLocalDescription(await pc.createAnswer());
      await iceGathered(pc);
      if (this.callId !== id) return; // they hung up meanwhile
      await this.client.request("call_answer", { call_id: id, sdp: pc.localDescription?.sdp ?? "", video: !!cam });
      this.patch({ camera: !!cam });
      this.armConnectTimeout();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.finish(msg === "This call has ended." ? "Answered elsewhere" : null);
      if (msg !== "This call has ended.") this.onProblem(msg);
    }
  }

  async decline() {
    const id = this.callId;
    this.finish(null);
    if (id) await this.client.request("call_decline", { call_id: id }).catch(() => {});
  }

  async hangup() {
    const id = this.callId;
    const starting = this.starting;
    this.finish("Call ended");
    if (starting) return;
    if (id) await this.client.request("call_hangup", { call_id: id }).catch(() => {});
  }

  // ------------------------------------------------------------ recording

  private recorder: Recorder | null = null;

  /** 3.4: records the call (both pictures and voices) into the PC's
   *  Recordings folder; both sides are told, as on the PC. */
  async startRecording() {
    const st = this.state;
    if (!st || st.status !== "active" || this.recorder || !this.callId) return;
    if (!recordingSupported()) {
      this.onProblem("This phone can't record calls.");
      return;
    }
    const remote = () => this.remoteStream;
    const rec = new Recorder({
      title: `Call with ${st.info.private ? "a colleague" : st.info.peer_name}`,
      kind: "call",
      conversationId: st.info.private ? null : st.info.conversation_id,
      light: true,
      tiles: () => [
        { id: "me", name: "You", color: "#64748b", video: this.cam, audio: this.mic, muted: this.state?.muted },
        { id: st.info.peer_id, name: st.info.peer_name, color: st.info.avatar_color, video: remote().getVideoTracks()[0] ?? null, audio: remote().getAudioTracks()[0] ?? null, screen: this.state?.remoteScreen },
      ],
      onFailed: (t) => {
        this.onProblem(`The recording stopped: ${t}`);
        void this.stopRecording();
      },
    });
    try {
      await rec.start();
      this.recorder = rec;
      this.patch({ recording: true });
      this.client.request("call_media", { call_id: this.callId, recording: true }).catch(() => {});
    } catch (e) {
      this.onProblem(e instanceof Error ? e.message : String(e));
    }
  }

  async stopRecording() {
    const rec = this.recorder;
    if (!rec) return;
    this.recorder = null;
    this.patch({ recording: false });
    if (this.callId) this.client.request("call_media", { call_id: this.callId, recording: false }).catch(() => {});
    try {
      const r = await rec.stop();
      this.onNotice(`Recording saved on your PC (and in the chat): ${r.name}`);
    } catch (e) {
      this.onProblem(e instanceof Error ? e.message : String(e));
    }
  }

  toggleMute() {
    if (!this.state || !this.callId) return;
    const muted = !this.state.muted;
    if (this.mic) this.mic.enabled = !muted;
    this.patch({ muted });
    this.client.request("call_media", { call_id: this.callId, muted }).catch(() => {});
  }

  async toggleCamera() {
    if (!this.state || !this.callId || !this.videoSender) return;
    if (this.cam) {
      const old = this.cam;
      this.cam = null;
      await this.videoSender.replaceTrack(null);
      old.stop();
      this.patch({ camera: false });
      this.refreshLocal();
      this.client.request("call_media", { call_id: this.callId, video: false }).catch(() => {});
      return;
    }
    const cam = await this.getCam(this.state.facing);
    if (!cam) {
      this.onProblem("The camera isn't available.");
      return;
    }
    this.adoptCam(cam);
    await this.videoSender.replaceTrack(cam);
    // A voice call's video slot may still say "receive only".
    for (const t of this.pc?.getTransceivers() ?? []) if (t.sender === this.videoSender && t.direction !== "sendrecv") t.direction = "sendrecv";
    this.patch({ camera: true });
    this.refreshLocal();
    this.client.request("call_media", { call_id: this.callId, video: true }).catch(() => {});
  }

  /** Packets received / sent so far (the end-to-end tests read this). */
  async stats(): Promise<{ audioIn: number; videoIn: number; audioOut: number; videoOut: number; state: string }> {
    const out = { audioIn: 0, videoIn: 0, audioOut: 0, videoOut: 0, state: this.pc?.connectionState ?? "none" };
    if (!this.pc) return out;
    const report = await this.pc.getStats();
    report.forEach((s: { type: string; kind?: string; packetsReceived?: number; packetsSent?: number }) => {
      if (s.type === "inbound-rtp") {
        if (s.kind === "audio") out.audioIn += s.packetsReceived ?? 0;
        if (s.kind === "video") out.videoIn += s.packetsReceived ?? 0;
      } else if (s.type === "outbound-rtp") {
        if (s.kind === "audio") out.audioOut += s.packetsSent ?? 0;
        if (s.kind === "video") out.videoOut += s.packetsSent ?? 0;
      }
    });
    return out;
  }

  /** Everything about the media path, for diagnosing a call (tests). */
  async debug(): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {
      cam: this.cam ? { state: this.cam.readyState, muted: this.cam.muted, enabled: this.cam.enabled, label: this.cam.label, settings: this.cam.getSettings() } : null,
      mic: this.mic ? { state: this.mic.readyState, muted: this.mic.muted } : null,
      transceivers: this.pc?.getTransceivers().map((t) => ({ mid: t.mid, kind: t.receiver.track.kind, dir: t.direction, cur: t.currentDirection, send: t.sender.track?.readyState ?? null })) ?? [],
    };
    if (this.pc) {
      const rows: unknown[] = [];
      (await this.pc.getStats()).forEach((s: Record<string, unknown>) => {
        if (["inbound-rtp", "outbound-rtp", "codec"].includes(String(s.type)))
          rows.push(Object.fromEntries(Object.entries(s).filter(([k]) => ["type", "kind", "mimeType", "packetsSent", "packetsReceived", "framesEncoded", "framesDecoded", "framesSent", "frameWidth", "qualityLimitationReason", "codecId", "encoderImplementation", "decoderImplementation", "payloadType"].includes(k))));
      });
      out.stats = rows;
    }
    return out;
  }

  async flipCamera() {
    if (!this.state) return;
    const facing = this.state.facing === "user" ? "environment" : "user";
    if (!this.cam || !this.videoSender) {
      this.patch({ facing });
      return;
    }
    const cam = await this.getCam(facing);
    if (!cam) return;
    const old = this.cam;
    this.adoptCam(cam);
    await this.videoSender.replaceTrack(cam);
    old.stop();
    this.patch({ facing });
    this.refreshLocal();
  }
}
