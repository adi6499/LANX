/** LANX 3.5.0: the camera side of gestures. Opens the camera, hands its
 *  frames to the hand-tracking worker one at a time (never piling up), and
 *  passes each answer on. Slows to a few frames a second when no hand is in
 *  view, so an idle LANX costs almost nothing. */
import loaderUrl from "@mediapipe/tasks-vision/vision_wasm_module_internal.js?url";
import wasmUrl from "@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url";
import modelUrl from "../../assets/gestures/gesture_recognizer.task?url";
import type { Delegate, FromWorker, ToWorker, WorkerHand } from "./worker";

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
    this.onStatus({ phase: "starting" });
    try {
      const [ok, cam] = await Promise.all([
        this.boot(),
        navigator.mediaDevices.getUserMedia({
          video: { ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "user" }), width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
          audio: false,
        }),
      ]);
      if (!this.running) {
        cam.getTracks().forEach((t) => t.stop());
        return false;
      }
      if (!ok) {
        cam.getTracks().forEach((t) => t.stop());
        this.running = false;
        return false;
      }
      this.cam = cam;
      const v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.srcObject = cam;
      // Kept in the page (some engines pause videos that aren't), but invisible.
      v.style.cssText = "position:fixed;left:-10px;top:-10px;width:1px;height:1px;opacity:0;pointer-events:none";
      document.body.appendChild(v);
      await v.play();
      this.video = v;
      this.lastHand = performance.now();
      this.onStatus({ phase: "on", delegate: this.delegate });
      this.next();
      return true;
    } catch (e) {
      this.running = false;
      this.release();
      const name = e instanceof DOMException ? e.name : "";
      const message =
        name === "NotAllowedError" ? "LANX isn't allowed to use the camera. Allow it in Windows Settings → Privacy → Camera."
        : name === "NotFoundError" || name === "OverconstrainedError" ? "No camera was found. Plug one in, or pick another in Gesture settings."
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
