/** LANX 3.5.0: the camera side of gestures. Opens the camera, hands its
 *  frames to the hand-tracking worker one at a time (never piling up), and
 *  passes each answer on. Slows to a few frames a second when no hand is in
 *  view, so an idle LANX costs almost nothing. */
import loaderUrl from "@mediapipe/tasks-vision/vision_wasm_module_internal.js?url";
import wasmUrl from "@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url";
import modelUrl from "../../assets/gestures/gesture_recognizer.task?url";
import type { Delegate, FromWorker, ToWorker, WorkerHand } from "./worker";
import { setPhoneCamPurpose } from "../phoneCamera";

export type { WorkerHand };
export interface Frame {
  /** performance.now() when the picture was taken. */
  t: number;
  /** The picture's width ÷ height. */
  aspect: number;
  hands: WorkerHand[];
}
export interface EngineStatus {
  phase: "off" | "starting" | "on" | "error";
  message?: string;
  /** How the model runs: on the processor or the graphics chip. */
  delegate?: Delegate;
  /** Frames a second, and milliseconds per frame in the worker. */
  fps?: number;
  ms?: number;
}

const FAST_MS = 1000 / 30;
const IDLE_MS = 1000 / 6;
/** No hand for this long → the slow rate. */
const IDLE_AFTER = 2500;
/** Frames are made this wide (the model looks at 192–224 pixels anyway). */
const FRAME_W = 480;
/** A camera that ends this soon after it was asked for is asked for once more. */
const EARLY_END_MS = 5000;
/** Asking again (300, 700, 1100… ms apart, about 6 s in all) while the camera is still being let go. */
const ASK_TRIES = 5;
/** The model runs on the processor: on this PC the graphics chip took ~10 s a frame to
 *  warm up inside LANX (and was slower after), while the processor keeps 12–16 frames a
 *  second. Support / testing: localStorage "lanx.gestures.delegate" = "GPU" tries the chip. */
function forced(): Delegate | null {
  try {
    const v = localStorage.getItem("lanx.gestures.delegate");
    return v === "CPU" || v === "GPU" ? v : null;
  } catch {
    return null;
  }
}

const abs = (u: string) => new URL(u, location.href).href;

export class GestureEngine {
  private worker: Worker | null = null;
  private ready: Promise<boolean> | null = null;
  private delegate: Delegate = "CPU";
  private video: HTMLVideoElement | null = null;
  private cam: MediaStream | null = null;
  private running = false;
  private busy = false;
  private timer = 0;
  private lastSend = 0;
  private lastHand = 0;
  private frames: number[] = [];
  private lastMs = 0;
  private statusAt = 0;
  /** LANX 3.7.0: which start is the current one. A camera that answers after a quicker
   *  restart (turning "Control the whole PC" on does one) is let go, not left running. */
  private gen = 0;
  /** The start before this one, until it has finished: the camera is asked for one at a time.
   *  (Two requests at once share one camera, and letting go of the old one ended the new one.) */
  private starting: Promise<unknown> = Promise.resolve();

  constructor(
    private onFrame: (f: Frame) => void,
    private onStatus: (s: EngineStatus) => void,
  ) {}

  get stream(): MediaStream | null {
    return this.cam;
  }

  private boot(): Promise<boolean> {
    if (this.ready) return this.ready;
    this.ready = new Promise<boolean>((resolve) => {
      const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "lanx-gestures" });
      this.worker = w;
      w.onmessage = (e: MessageEvent<FromWorker>) => {
        const m = e.data;
        if (m.kind === "ready") {
          this.delegate = m.delegate;
          this.busy = false;
          resolve(true);
          this.next();
        } else if (m.kind === "error") {
          this.onStatus({ phase: "error", message: `Hand tracking could not start: ${m.message}` });
          resolve(false);
        } else if (m.kind === "result") this.result(m);
      };
      w.onerror = (e) => {
        this.onStatus({ phase: "error", message: `Hand tracking stopped: ${e.message || "the worker failed"}` });
        resolve(false);
      };
      const init: ToWorker = { kind: "init", loader: abs(loaderUrl), wasm: abs(wasmUrl), model: abs(modelUrl), prefer: forced() ?? "CPU" };
      w.postMessage(init);
    });
    return this.ready;
  }

  /** Opens the camera and starts watching. Resolves false (and reports why) when it can't. */
  async start(deviceId?: string | null): Promise<boolean> {
    if (this.running) return true;
    this.running = true;
    const gen = ++this.gen;
    this.onStatus({ phase: "starting" });
    setPhoneCamPurpose("hand gestures");
    const before = this.starting;
    const run = this.open(gen, deviceId, before);
    this.starting = run;
    return run;
  }

  /** The camera — asked again a few times when it has only just been let go: for a moment it
   *  can answer "no camera" or hand over a picture that has already ended (3.7.0). */
  private async askCamera(gen: number, deviceId: string | null | undefined): Promise<MediaStream> {
    const want: MediaStreamConstraints = {
      video: { ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "user" }), width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
      audio: false,
    };
    for (let i = 0; ; i++) {
      try {
        const s = await navigator.mediaDevices.getUserMedia(want);
        if (s.getVideoTracks()[0]?.readyState !== "ended" || i >= ASK_TRIES) return s;
        s.getTracks().forEach((t) => t.stop());
      } catch (e) {
        const busy = e instanceof DOMException && /^(NotFoundError|NotReadableError|AbortError)$/.test(e.name) && !/phone/i.test(e.message);
        if (!busy || i >= ASK_TRIES || gen !== this.gen) throw e;
      }
      await new Promise((r) => window.setTimeout(r, 300 + i * 400));
      if (gen !== this.gen) throw new DOMException("Stopped", "AbortError");
    }
  }

  private async open(gen: number, deviceId: string | null | undefined, before: Promise<unknown>, again = 0): Promise<boolean> {
    await before.catch(() => {});
    if (gen !== this.gen) return false;
    try {
      const [ok, cam] = await Promise.all([this.boot(), this.askCamera(gen, deviceId)]);
      const gotAt = performance.now();
      if (!this.running || gen !== this.gen) {
        cam.getTracks().forEach((t) => t.stop());
        return false;
      }
      if (!ok) {
        cam.getTracks().forEach((t) => t.stop());
        this.running = false;
        return false;
      }
      this.cam = cam;
      // The camera went away (unplugged, or the phone lending it pressed Stop).
      cam.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (this.cam !== cam || !this.running || gen !== this.gen) return;
        // 3.7.0: ended straight away — the camera was still letting go of the last start
        // (seen when it is stopped and asked for again within moments). Once more, shortly.
        if (again < 2 && performance.now() - gotAt < EARLY_END_MS) {
          this.release();
          this.starting = this.open(gen, deviceId, new Promise((r) => window.setTimeout(r, 600)), again + 1);
          return;
        }
        this.running = false;
        this.release();
        this.onStatus({ phase: "error", message: "The camera stopped. Turn gestures off and on to start it again." });
      });
      // (3.7.0: this video keeps playing while LANX is minimised or in the tray — LANX's window
      // never counts as hidden, so hands keep driving the whole PC; measured on this PC.)
      const v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.srcObject = cam;
      // Kept in the page (some engines pause videos that aren't), but invisible.
      v.style.cssText = "position:fixed;left:-10px;top:-10px;width:1px;height:1px;opacity:0;pointer-events:none";
      document.body.appendChild(v);
      await v.play();
      if (gen !== this.gen || !this.running) {
        // Stopped (or restarted, or the camera went away) meanwhile.
        v.srcObject = null;
        v.remove();
        cam.getTracks().forEach((t) => t.stop());
        return false;
      }
      this.video = v;
      this.lastHand = performance.now();
      this.onStatus({ phase: "on", delegate: this.delegate });
      this.next();
      return true;
    } catch (e) {
      if (gen !== this.gen) return false;
      this.running = false;
      this.release();
      const name = e instanceof DOMException ? e.name : "";
      const message =
        // (The phone camera's own messages say what to do on the phone.)
        e instanceof DOMException && /phone/i.test(e.message) ? e.message
        : name === "NotAllowedError" ? "LANX isn't allowed to use the camera. Allow it in Windows Settings → Privacy → Camera."
        : name === "NotFoundError" || name === "OverconstrainedError" ? "No camera was found. Plug one in, or use your phone's: pair it in Settings → Phone and open LANX on it."
        : name === "NotReadableError" ? "The camera is busy in another program. Close it there and try again."
        : `The camera didn't start: ${e instanceof Error ? e.message : String(e)}`;
      this.onStatus({ phase: "error", message });
      return false;
    }
  }

  /** The next frame goes as soon as the worker is free (but no more often
   *  than the camera's own rate, and only a few a second while no hand is up). */
  private next(soon = false) {
    if (!this.running) return;
    window.clearTimeout(this.timer);
    const gap = performance.now() - this.lastHand > IDLE_AFTER ? IDLE_MS : FAST_MS;
    const wait = soon ? 0 : Math.max(0, this.lastSend + gap - performance.now());
    this.timer = window.setTimeout(() => void this.send(), wait);
  }

  private async send() {
    const v = this.video;
    const w = this.worker;
    if (this.busy || !this.running) return;
    if (!v || !w || v.readyState < 2 || !v.videoWidth) {
      this.timer = window.setTimeout(() => void this.send(), 50);
      return;
    }
    this.busy = true;
    this.lastSend = performance.now();
    try {
      const h = Math.round((FRAME_W * v.videoHeight) / v.videoWidth);
      const bitmap = await createImageBitmap(v, v.videoWidth > FRAME_W ? { resizeWidth: FRAME_W, resizeHeight: h, resizeQuality: "low" } : {});
      if (!this.running) {
        bitmap.close();
        this.busy = false;
        return;
      }
      const m: ToWorker = { kind: "frame", bitmap, t: performance.now() };
      w.postMessage(m, [bitmap]);
    } catch {
      this.busy = false;
      this.next();
    }
  }

  private result(m: Extract<FromWorker, { kind: "result" }>) {
    this.busy = false;
    if (!this.running) return;
    const v = this.video;
    const now = performance.now();
    // A hand just came into view: back to the full rate straight away.
    const waking = m.hands.length > 0 && now - this.lastHand > IDLE_AFTER;
    if (m.hands.length) this.lastHand = now;
    this.frames.push(now);
    while (this.frames.length && now - this.frames[0] > 1000) this.frames.shift();
    this.lastMs = m.ms;
    if (now - this.statusAt > 1000) {
      this.statusAt = now;
      this.onStatus({ phase: "on", delegate: this.delegate, fps: this.frames.length, ms: Math.round(this.lastMs) });
    }
    this.onFrame({ t: m.t, aspect: v && v.videoHeight ? v.videoWidth / v.videoHeight : 4 / 3, hands: m.hands });
    if (!this.busy) this.next(waking);
  }

  private release() {
    window.clearTimeout(this.timer);
    this.cam?.getTracks().forEach((t) => t.stop());
    this.cam = null;
    if (this.video) {
      this.video.srcObject = null;
      this.video.remove();
      this.video = null;
    }
    this.busy = false;
  }

  /** Turns the camera off (the hand model stays loaded for a quick restart). */
  stop() {
    this.gen++;
    this.running = false;
    this.release();
    this.onStatus({ phase: "off" });
  }

  /** Everything off, the worker too. */
  dispose() {
    this.stop();
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
  }
}
