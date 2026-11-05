/// <reference lib="webworker" />
/** LANX 3.5.0: hand tracking, off the window's own thread so the app never
 *  stutters. The window sends camera frames (ImageBitmaps, one at a time);
 *  this answers with each hand's 21 points and the sign it is making.
 *  Everything stays on this PC: the model and the engine ship inside LANX. */
import { GestureRecognizer } from "@mediapipe/tasks-vision";

export interface WorkerHand {
  /** 21 points × (x, y, z), in the camera picture's own (not mirrored) 0..1 units. */
  lm: number[];
  /** As the engine names it (it assumes a mirrored picture, so "Left" is the right hand). */
  handed: string;
  gesture: string;
  score: number;
}
/** "CPU": the processor (the start: quick and the same on every PC). "GPU": the graphics chip. */
export type Delegate = "CPU" | "GPU";
export type ToWorker =
  | { kind: "init"; loader: string; wasm: string; model: string; prefer: Delegate }
  /** Try the other way of running the model (the window measures which is quicker). */
  | { kind: "delegate"; delegate: Delegate }
  | { kind: "frame"; bitmap: ImageBitmap; t: number };
export type FromWorker =
  | { kind: "ready"; delegate: Delegate }
  | { kind: "error"; message: string }
  /** `both`: this frame looked for two hands (slower; not counted when measuring). */
  | { kind: "result"; t: number; ms: number; hands: WorkerHand[]; both: boolean };

const post = (m: FromWorker) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);
/** Two copies of the model: one follows a single hand (cheap — once it has the
 *  hand it only looks near it), the other looks for two hands (it searches the
 *  whole picture every frame, about twice the work). The second one runs a few
 *  times a second, and takes over while two hands are up (zoom and turn). */
let one: GestureRecognizer | null = null;
let two: GestureRecognizer | null = null;
let current: Delegate = "CPU";
let lastT = 0;
let frameNo = 0;
let bothUntil = 0;
let setup: Extract<ToWorker, { kind: "init" }> | null = null;
const LOOK_EVERY = 10;
const BOTH_HOLD_MS = 800;

/** Each copy of the model needs the engine's loader to run afresh: a module
 *  imported twice runs only once ("ModuleFactory not set"), so every copy after
 *  the first asks for it under its own address. */
let loads = 0;
const loaderFor = (m: Extract<ToWorker, { kind: "init" }>) => (loads++ === 0 ? m.loader : `${m.loader}?copy=${loads}`);
const create = (m: Extract<ToWorker, { kind: "init" }>, delegate: Delegate, numHands: number) =>
  GestureRecognizer.createFromOptions(
    { wasmLoaderPath: loaderFor(m), wasmBinaryPath: m.wasm },
    {
      baseOptions: { modelAssetPath: m.model, delegate },
      runningMode: "VIDEO",
      numHands,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.55,
      minTrackingConfidence: 0.5,
    },
  );
const createPair = async (m: Extract<ToWorker, { kind: "init" }>, d: Delegate) => {
  const a = await create(m, d, 1);
  try {
    return [a, await create(m, d, 2)] as const;
  } catch (e) {
    a.close();
    throw e;
  }
};

async function init(m: Extract<ToWorker, { kind: "init" }>) {
  setup = m;
  for (const d of m.prefer === "GPU" ? (["GPU", "CPU"] as const) : (["CPU", "GPU"] as const)) {
    try {
      [one, two] = await createPair(m, d);
      current = d;
      post({ kind: "ready", delegate: d });
      return;
    } catch (e) {
      console.warn(`LANX gestures: the ${d} path did not start`, e);
    }
  }
  post({ kind: "error", message: "the hand model did not start on this PC" });
}

async function switchTo(d: Delegate) {
  const m = setup;
  if (!m || d === current) {
    post({ kind: "ready", delegate: current });
    return;
  }
  const old = [one, two];
  one = two = null;
  try {
    [one, two] = await createPair(m, d);
    current = d;
    old.forEach((r) => r?.close());
  } catch (e) {
    [one, two] = old;
    console.warn(`LANX gestures: the ${d} path failed, staying on ${current}`, e);
  }
  post({ kind: "ready", delegate: current });
}

function frame(m: Extract<ToWorker, { kind: "frame" }>) {
  if (!one || !two) {
    m.bitmap.close();
    return;
  }
  // The engine needs times that only go up.
  const t = Math.max(m.t, lastT + 1);
  lastT = t;
  frameNo++;
  const both = t < bothUntil || frameNo % LOOK_EVERY === 0;
  const t0 = performance.now();
  let hands: WorkerHand[] = [];
  try {
    const res = (both ? two : one).recognizeForVideo(m.bitmap, t);
    if (both && res.landmarks.length >= 2) bothUntil = t + BOTH_HOLD_MS;
    hands = res.landmarks.map((pts, i) => ({
      lm: pts.flatMap((p) => [p.x, p.y, p.z]),
      handed: res.handedness[i]?.[0]?.categoryName ?? "",
      gesture: res.gestures[i]?.[0]?.categoryName ?? "None",
      score: res.gestures[i]?.[0]?.score ?? 0,
    }));
  } catch (e) {
    console.warn("LANX gestures: frame skipped", e);
  } finally {
    m.bitmap.close();
  }
  post({ kind: "result", t: m.t, ms: performance.now() - t0, hands, both });
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.kind === "init") void init(m);
  else if (m.kind === "delegate") void switchTo(m.delegate);
  else if (m.kind === "frame") frame(m);
};
