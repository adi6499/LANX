// LANX 2.13.0: sounds for the games. Every sound is a tiny tune or click
// made on the spot by the browser's synthesiser (no sound files to ship),
// played through the shared audio player in lib/audio.ts. The speaker
// button in the games window turns them off; Do not disturb and quiet
// hours keep them quiet; the volume follows Settings → Sounds.

import { audioContext } from "./audio";

export type Sfx =
  | "tap" // a light click (solo games, menus)
  | "place" // a piece lands on the board
  | "capture" // a piece is taken
  | "dice" // dice rattle and land
  | "card" // a card is dealt or played
  | "whoosh" // a throw, a shot, a swing
  | "pop" // a bubble: answers, strokes, party steps
  | "turn" // it is your move
  | "start" // the game (or a round) begins
  | "win"
  | "lose"
  | "draw"
  | "invite" // a challenge card arrived
  | "tick" // the last seconds of a round
  | "buzz" // declined, left, time's up
  | "score" // a goal in the live arcade
  | "bounce" // the puck or ball hits something
  | "boom" // a mine, a knock-out
  | "chain" // a Chain Reaction burst
  | "merge" // 2048 tiles join
  | "eat" // the snake eats
  | "flag" // a flag planted
  | "join"; // a colleague sat down at the table

const KEY = "lanx_game_sound";
let on = true;
try {
  on = localStorage.getItem(KEY) !== "off";
} catch {
  /* no storage: sounds stay on */
}
let volume = 0.8;
let quiet = false;

/** Whether the speaker button in the games window is on. */
export const gameSoundOn = () => on;
export function setGameSound(v: boolean) {
  on = v;
  try {
    localStorage.setItem(KEY, v ? "on" : "off");
  } catch {
    /* fine */
  }
}
/** The app passes the Settings → Sounds volume (0–100) and whether it is quiet time (Do not disturb / quiet hours). */
export function configureGameSounds(p: { volume?: number; quiet?: boolean }) {
  if (typeof p.volume === "number" && Number.isFinite(p.volume)) volume = Math.max(0, Math.min(1, p.volume / 100));
  if (typeof p.quiet === "boolean") quiet = p.quiet;
}

interface Tone {
  type?: OscillatorType;
  /** Start pitch (Hz) and, when it slides, the end pitch. */
  f0: number;
  f1?: number;
  /** Seconds after the sound starts. */
  at?: number;
  dur: number;
  gain?: number;
}
interface Noise {
  at?: number;
  dur: number;
  gain?: number;
  /** Band-pass centre (Hz) and width. */
  filter?: number;
  q?: number;
}
interface Recipe {
  tones?: Tone[];
  noise?: Noise[];
}

const C5 = 523.25;
const Eb5 = 622.25;
const E5 = 659.25;
const G5 = 783.99;
const A5 = 880;
const C6 = 1046.5;
const E6 = 1318.5;

const RECIPES: Record<Sfx, Recipe> = {
  tap: { tones: [{ f0: 700, f1: 500, dur: 0.06, gain: 0.45 }] },
  place: { tones: [{ type: "triangle", f0: 230, f1: 160, dur: 0.09, gain: 0.9 }], noise: [{ dur: 0.03, gain: 0.35, filter: 1800 }] },
  capture: { tones: [{ type: "triangle", f0: 520, f1: 260, dur: 0.14, gain: 0.7 }, { f0: 160, f1: 110, at: 0.05, dur: 0.12, gain: 0.6 }] },
  dice: {
    noise: [0, 0.06, 0.13, 0.21, 0.3].map((at, i) => ({ at, dur: 0.035, gain: 0.55 - i * 0.07, filter: 2600 + i * 300, q: 2 })),
    tones: [{ type: "triangle", f0: 900, f1: 600, at: 0.3, dur: 0.05, gain: 0.25 }],
  },
  card: { noise: [{ dur: 0.11, gain: 0.45, filter: 3200, q: 0.8 }], tones: [{ f0: 1800, f1: 900, dur: 0.05, gain: 0.12 }] },
  whoosh: { noise: [{ dur: 0.1, gain: 0.3, filter: 500, q: 1.2 }, { at: 0.08, dur: 0.22, gain: 0.5, filter: 1400, q: 1.2 }] },
  pop: { tones: [{ f0: 900, f1: 250, dur: 0.07, gain: 0.55 }] },
  turn: { tones: [{ f0: C6, dur: 0.12, gain: 0.45 }, { f0: E6, at: 0.11, dur: 0.22, gain: 0.45 }] },
  start: { tones: [{ f0: C5, dur: 0.1, gain: 0.45 }, { f0: E5, at: 0.1, dur: 0.1, gain: 0.45 }, { f0: G5, at: 0.2, dur: 0.25, gain: 0.5 }] },
  win: {
    tones: [
      { f0: C5, dur: 0.12 },
      { f0: E5, at: 0.12, dur: 0.12 },
      { f0: G5, at: 0.24, dur: 0.12 },
      { f0: C6, at: 0.36, dur: 0.45, gain: 0.6 },
      { type: "triangle", f0: E6, at: 0.5, dur: 0.4, gain: 0.3 },
    ],
  },
  lose: { tones: [{ type: "triangle", f0: E5, dur: 0.18 }, { type: "triangle", f0: Eb5, at: 0.18, dur: 0.18 }, { type: "triangle", f0: C5, at: 0.36, dur: 0.4, gain: 0.5 }] },
  draw: { tones: [{ f0: G5, dur: 0.14 }, { f0: G5, at: 0.2, dur: 0.3, gain: 0.4 }] },
  invite: { tones: [{ f0: E6, dur: 0.16, gain: 0.4 }, { f0: C6, at: 0.18, dur: 0.3, gain: 0.4 }] },
  tick: { tones: [{ type: "square", f0: 1200, dur: 0.025, gain: 0.16 }] },
  buzz: { tones: [{ type: "square", f0: 140, f1: 110, dur: 0.22, gain: 0.22 }] },
  score: { tones: [{ f0: G5, dur: 0.08 }, { f0: C6, at: 0.08, dur: 0.08 }, { f0: E6, at: 0.16, dur: 0.22, gain: 0.5 }] },
  bounce: { tones: [{ type: "triangle", f0: 480, f1: 380, dur: 0.045, gain: 0.5 }] },
  boom: { noise: [{ dur: 0.35, gain: 0.8, filter: 300, q: 0.7 }], tones: [{ f0: 110, f1: 40, dur: 0.35, gain: 0.8 }] },
  chain: { tones: [{ f0: 600, f1: 200, dur: 0.09, gain: 0.5 }], noise: [{ dur: 0.05, gain: 0.3, filter: 1200 }] },
  merge: { tones: [{ f0: E5, f1: A5, dur: 0.09, gain: 0.45 }] },
  eat: { tones: [{ f0: 500, f1: 900, dur: 0.07, gain: 0.45 }] },
  flag: { tones: [{ type: "triangle", f0: 800, dur: 0.05, gain: 0.35 }, { type: "triangle", f0: 1000, at: 0.05, dur: 0.06, gain: 0.3 }] },
  join: { tones: [{ f0: A5, dur: 0.08, gain: 0.4 }, { f0: E6, at: 0.08, dur: 0.16, gain: 0.4 }] },
};

const last = new Map<Sfx, number>();
let noiseBuf: AudioBuffer | null = null;

/** Play one of the game sounds (if sounds are on and it is not quiet time). */
export function sfx(kind: Sfx) {
  if (!on || quiet || volume <= 0) return;
  const now = performance.now();
  const gap = kind === "bounce" ? 70 : kind === "tick" ? 0 : 40; // the same sound never stutters
  if ((last.get(kind) ?? -1e9) + gap > now) return;
  last.set(kind, now);
  const ctx = audioContext();
  if (!ctx || ctx.state !== "running") return; // before the first click, the browser keeps pages silent
  const r = RECIPES[kind];
  try {
    const master = ctx.createGain();
    master.gain.value = volume * 0.5;
    master.connect(ctx.destination);
    const t0 = ctx.currentTime + 0.005;
    for (const t of r.tones ?? []) tone(ctx, master, t0, t);
    for (const nz of r.noise ?? []) noise(ctx, master, t0, nz);
    window.setTimeout(() => master.disconnect(), 1500);
  } catch {
    /* no sound on this computer */
  }
}

function tone(ctx: AudioContext, out: AudioNode, t0: number, t: Tone) {
  const o = ctx.createOscillator();
  o.type = t.type ?? "sine";
  const start = t0 + (t.at ?? 0);
  const end = start + t.dur;
  o.frequency.setValueAtTime(t.f0, start);
  if (t.f1 && t.f1 !== t.f0) o.frequency.exponentialRampToValueAtTime(t.f1, end);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(t.gain ?? 0.5, start + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  o.connect(g);
  g.connect(out);
  o.start(start);
  o.stop(end + 0.02);
}

function noise(ctx: AudioContext, out: AudioNode, t0: number, nz: Noise) {
  if (!noiseBuf || noiseBuf.sampleRate !== ctx.sampleRate) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const start = t0 + (nz.at ?? 0);
  const end = start + nz.dur;
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = nz.filter ?? 1500;
  f.Q.value = nz.q ?? 1;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(nz.gain ?? 0.4, start + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  src.connect(f);
  f.connect(g);
  g.connect(out);
  src.start(start, Math.random() * 0.5);
  src.stop(end + 0.02);
}
