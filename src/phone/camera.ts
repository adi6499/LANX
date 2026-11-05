/** LANX 3.6.2 phone page: lending this phone's camera to the PC, for calls,
 *  meetings and hand gestures there (a desktop PC often has no camera). The PC
 *  asks; after a yes the picture goes straight to the PC over the office network
 *  (WebRTC), and the phone shows what it sends until Stop. */
import { iceGathered } from "../lib/webrtc";
import { type PhoneClient, storage } from "./client";

export interface CamPush {
  ev: "cam";
  action: "offer" | "taken" | "stop";
  cam_id: string;
  sdp?: string;
  facing?: "user" | "environment";
  purpose?: string;
}

export type LendState =
  | { phase: "asking"; camId: string; purpose: string }
  | { phase: "starting"; camId: string; purpose: string }
  | { phase: "on"; camId: string; purpose: string; facing: "user" | "environment"; stream: MediaStream }
  | null;

const ALWAYS_KEY = "lanx_cam_always";

export const canLend = () => typeof window !== "undefined" && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && typeof RTCPeerConnection !== "undefined";

async function openCam(facing: "user" | "environment", purpose: string): Promise<MediaStreamTrack | null> {
  // Hand gestures need a steady 30 frames more than detail; calls want HD.
  const size = purpose === "hand gestures" ? { width: { ideal: 640 }, height: { ideal: 480 } } : { width: { ideal: 1280 }, height: { ideal: 720 } };
  for (const video of [{ facingMode: facing, ...size, frameRate: { ideal: 30, max: 30 } }, { facingMode: facing }, true as const]) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      const t = s.getVideoTracks()[0] ?? null;
      if (t) t.contentHint = "motion";
      return t;
    } catch {
      /* a simpler request */
    }
  }
  return null;
}

export class CameraLend {
  state: LendState = null;
  private offer: { camId: string; sdp: string; facing: "user" | "environment"; purpose: string } | null = null;
  private pc: RTCPeerConnection | null = null;
  private track: MediaStreamTrack | null = null;
  /** Requests already answered (the PC asks again every few seconds until it hears back). */
  private seen = new Set<string>();
  private wake: { release: () => Promise<void> } | null = null;
  private listeners = new Set<() => void>();

  constructor(
    private client: PhoneClient,
    /** In a call or meeting on the phone: its camera is taken. */
    private busy: () => boolean,
    private onProblem: (text: string) => void,
  ) {
    document.addEventListener("visibilitychange", this.onVisible);
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  snapshot = () => this.state;
  private set(s: LendState) {
    this.state = s;
    for (const fn of this.listeners) fn();
  }

  /** Yes to the PC every time, without asking (while LANX is open here). */
  get always() {
    return storage.get(ALWAYS_KEY) === "1";
  }
  setAlways(on: boolean) {
    if (on) storage.set(ALWAYS_KEY, "1");
    else storage.remove(ALWAYS_KEY);
    for (const fn of this.listeners) fn();
  }

  private reply(camId: string, action: "answer" | "decline" | "stop", extra: { sdp?: string; reason?: string } = {}) {
    return this.client.request("cam_signal", { action, cam_id: camId, ...extra });
  }

  handle(p: CamPush) {
    if (p.action === "offer") {
      if (this.seen.has(p.cam_id) || this.state?.camId === p.cam_id) return;
      // A new request while lending: the PC lost the old picture and asks afresh.
      if (this.state?.phase === "on") this.stop(false);
      if (this.busy()) {
        this.seen.add(p.cam_id);
        void this.reply(p.cam_id, "decline", { reason: "busy" }).catch(() => {});
        return;
      }
      if (!canLend()) {
        this.seen.add(p.cam_id);
        void this.reply(p.cam_id, "decline", { reason: "insecure" }).catch(() => {});
        this.onProblem("Your PC wants this phone's camera: open the secure connection first (More → Secure connection).");
        return;
      }
      const purpose = p.purpose || "LANX";
      this.offer = { camId: p.cam_id, sdp: p.sdp ?? "", facing: p.facing === "environment" ? "environment" : "user", purpose };
      if (this.always) void this.accept();
      else this.set({ phase: "asking", camId: p.cam_id, purpose });
    } else if (p.action === "taken") {
      // Another phone said yes first.
      if (this.state?.camId === p.cam_id && this.state.phase === "asking") {
        this.offer = null;
        this.set(null);
      }
    } else if (p.action === "stop") {
      if (this.state?.camId === p.cam_id) this.stop(false);
      else if (this.offer?.camId === p.cam_id) this.offer = null;
    }
  }

  async accept() {
    const o = this.offer;
    if (!o) return;
    this.offer = null;
    this.seen.add(o.camId);
    this.set({ phase: "starting", camId: o.camId, purpose: o.purpose });
    let pc: RTCPeerConnection | null = null;
    try {
      const track = await openCam(o.facing, o.purpose);
      if (!track) throw new Error("the camera didn't open (is it allowed for this page?)");
      pc = new RTCPeerConnection({ iceServers: [] });
      await pc.setRemoteDescription({ type: "offer", sdp: o.sdp });
      const tr = pc.getTransceivers().find((t) => t.receiver.track?.kind === "video") ?? pc.getTransceivers()[0];
      if (!tr) throw new Error("the PC's request had no picture in it");
      tr.direction = "sendonly";
      await tr.sender.replaceTrack(track);
      await pc.setLocalDescription(await pc.createAnswer());
      await iceGathered(pc);
      if (this.state?.camId !== o.camId) {
        // Stopped meanwhile.
        track.stop();
        pc.close();
        return;
      }
      await this.reply(o.camId, "answer", { sdp: pc.localDescription?.sdp ?? "" });
      this.pc = pc;
      this.track = track;
      track.onended = () => void this.recover();
      const live = pc;
      live.onconnectionstatechange = () => {
        if (this.pc === live && (live.connectionState === "failed" || live.connectionState === "closed")) this.stop(true);
      };
      this.set({ phase: "on", camId: o.camId, purpose: o.purpose, facing: o.facing, stream: new MediaStream([track]) });
      void this.keepAwake();
    } catch (e) {
      pc?.close();
      void this.reply(o.camId, "decline", { reason: "camera" }).catch(() => {});
      this.onProblem(`Couldn't lend the camera: ${e instanceof Error ? e.message : String(e)}`);
      this.set(null);
    }
  }

  decline() {
    const o = this.offer;
    this.offer = null;
    if (o) {
      this.seen.add(o.camId);
      void this.reply(o.camId, "decline").catch(() => {});
    }
    this.set(null);
  }

  /** Front ↔ back camera, without the PC noticing a gap. */
  async flip() {
    const s = this.state;
    if (s?.phase !== "on") return;
    const facing = s.facing === "user" ? "environment" : "user";
    await this.swapTrack(facing);
  }

  private async swapTrack(facing: "user" | "environment") {
    const s = this.state;
    const sender = this.pc?.getSenders().find((x) => x.track?.kind === "video" || x.track === null) ?? this.pc?.getSenders()[0];
    if (s?.phase !== "on" || !sender) return;
    this.track?.stop();
    const track = await openCam(facing, s.purpose);
    if (!track) {
      this.onProblem("That camera didn't open.");
      return;
    }
    await sender.replaceTrack(track);
    this.track = track;
    track.onended = () => void this.recover();
    if (this.state?.phase === "on") this.set({ ...this.state, facing, stream: new MediaStream([track]) });
  }

  /** The phone took the camera away (the page was hidden, another app): take it back. */
  private async recover() {
    const s = this.state;
    if (s?.phase !== "on" || document.hidden) return;
    await this.swapTrack(s.facing);
  }

  private onVisible = () => {
    const s = this.state;
    if (document.hidden || s?.phase !== "on") return;
    if (!this.track || this.track.readyState === "ended" || this.track.muted) void this.recover();
    // (The phone lets go of "stay awake" whenever the page is hidden.)
    this.wake = null;
    void this.keepAwake();
  };

  /** The screen stays on while lending (it would lock and stop the camera). */
  private async keepAwake() {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (k: "screen") => Promise<{ release: () => Promise<void> }> } };
      if (!this.wake && nav.wakeLock) this.wake = await nav.wakeLock.request("screen");
    } catch {
      /* not offered here: the phone may lock by itself */
    }
  }

  stop(tellPc = true) {
    const s = this.state;
    if (s && tellPc) void this.reply(s.camId, "stop").catch(() => {});
    this.track?.stop();
    this.track = null;
    this.pc?.close();
    this.pc = null;
    void this.wake?.release().catch(() => {});
    this.wake = null;
    this.set(null);
  }
}
