// Bowling, 1–8 players, ten frames with the usual strikes and spares. A
// roll is where you release across the lane (−100 left … 100 right), the
// angle you give it (−30 … 30) and the power (1 … 100); the ball drifts a
// little (from the seed).
// LANX 2.17.0: real pin action. The pins are worked out on the exact table
// physics (physics2d, whole numbers): the ball drives through the rack, the
// pins it hits fly off and take others with them, bounce off the side
// boards and drop into the pit; each pin falls only if it is hit hard enough
// (how hard is a seeded chance, and the pins are never spotted quite
// perfectly). So a ball in the pocket (just right of the head pin, coming
// in at a slight angle) usually strikes, a head-on hit often leaves a
// split, and a light hit leaves pins standing. Tenth frame: the pins are
// reset after a strike, after two strikes and after a spare — and only then.
// A player who leaves is skipped (the last one still in wins).
// Moves: "r:<pos>:<angle>:<power>", "x<p>" (player p left).

import { ON, draw, lastIn, leaver, nextIn, rng, win, type GameDef, type Outcome } from "./core.ts";
import { K, settle, velocity, type Body, type Table } from "./physics2d.ts";

/** Pin positions across the lane (x) and depth (row), as in the real triangle. */
export const PINS: [number, number][] = [
  [0, 0],
  [-30, 1], [30, 1],
  [-60, 2], [0, 2], [60, 2],
  [-90, 3], [-30, 3], [30, 3], [90, 3],
];
/** Lane units: pins are 30 apart across (6 in), a row is 52 deep (10.4 in); the lane is ±104 wide; the foul line is 600 from the head pin. */
export const ROW_DEPTH = 52;
export const LANE_HALF = 104;
export const LANE_LENGTH = 600;
const PIN_R = 15; // a pin's reach as it topples
const BALL_R = 21;

/** Where a ball released at `pos` with this angle crosses the head pin's row (before drift). Whole-number sums only. */
export function bowlingLine(pos: number, angle: number): number {
  const [vx, vy] = velocity(90 - angle, 1000);
  return pos + Math.round((LANE_LENGTH * vx) / vy);
}

const DECK: Table = {
  // The side boards (kickbacks) either side of the gutters; the pit is a row of wide drops behind the deck.
  walls: [
    { x1: -150 * K, y1: -100 * K, x2: -150 * K, y2: 400 * K },
    { x1: 150 * K, y1: 400 * K, x2: 150 * K, y2: -100 * K },
  ],
  pockets: [-150, -100, -50, 0, 50, 100, 150].map((x) => ({ x: x * K, y: 270 * K, r: 62 * K })),
  friction: 20,
  stop: 30000,
  bounce: 700,
};
const BALL_MASS = 5;
const BALL_FRICTION = 2;
/** A pin falls when hit faster than this (units a step): a seeded threshold per pin, per ball. */
const FALL_MIN = 0.8;
const FALL_SPREAD = 1.6;

export interface PinHit {
  /** The physics step the pin was knocked over at, and the way it went (lane units: x across, y down the lane). */
  step: number;
  dx: number;
  dy: number;
}

const memo = new Map<string, { fell: boolean[]; hits: (PinHit | null)[] }>();

/** Which of the standing pins fall for a ball crossing the head pin's row at `at` with this angle and power. */
export function pinAction(seed: string, rolls: number, at: number, angle: number, power: number, standing: boolean[]): { fell: boolean[]; hits: (PinHit | null)[] } {
  const key = `${seed}|${rolls}|${at}|${angle}|${power}|${standing.map((u) => (u ? 1 : 0)).join("")}`;
  const known = memo.get(key);
  if (known) return known;
  const fell: boolean[] = Array(10).fill(false);
  const hits: (PinHit | null)[] = Array(10).fill(null);
  if (power >= 15 && Math.abs(at) <= LANE_HALF) {
    const r = rng(`${seed}#pins${rolls}`);
    r();
    const speed = Math.round((2.5 + power * 0.045) * 100000);
    const [vx, vy] = velocity(90 - angle, speed);
    const ball: Body = { id: 10, x: at * K - Math.trunc((vx * 70 * K) / vy), y: -70 * K, vx, vy, r: BALL_R * K, mass: BALL_MASS, out: false, friction: BALL_FRICTION };
    // Pins are never spotted quite perfectly (±2 units).
    const pins: Body[] = PINS.map(([px, row], i) => ({ id: i, x: Math.round((px + (r() - 0.5) * 4) * K), y: Math.round((row * ROW_DEPTH + (r() - 0.5) * 4) * K), vx: 0, vy: 0, r: PIN_R * K, mass: 1, out: !standing[i] }));
    const need = PINS.map(() => Math.round((FALL_MIN + r() * FALL_SPREAD) * 100000));
    const bodies = [...pins, ball];
    const { events } = settle(bodies, DECK, 220, 0);
    const homeX = pins.map((p) => p.x);
    const homeY = pins.map((p) => p.y);
    for (const e of events) {
      if (e.kind !== "hit") continue;
      for (const id of [e.a, e.b!]) {
        if (id >= 10 || !standing[id] || fell[id] || (e.v ?? 0) < need[id]) continue;
        fell[id] = true;
        hits[id] = { step: e.t ?? 0, dx: 0, dy: 0 };
      }
    }
    pins.forEach((p, i) => {
      if (!standing[i]) return;
      // Knocked well off its spot (whole numbers, the same on every PC).
      const moved = (p.x - homeX[i]) ** 2 + (p.y - homeY[i]) ** 2 > (14 * K) ** 2;
      if (!fell[i] && (p.out || moved)) {
        fell[i] = true;
        hits[i] = { step: 0, dx: 0, dy: 0 };
      }
      // The way it went: from its spot to where it ended up (or into the pit).
      const h = hits[i];
      if (h) {
        const dx = (p.x - homeX[i]) / K;
        const dy = (p.y - homeY[i]) / K;
        const len = Math.hypot(dx, dy) || 1;
        h.dx = Math.round((dx / len) * 100) / 100;
        h.dy = Math.round((dy / len) * 100) / 100;
      }
    });
  }
  const out = { fell, hits };
  if (memo.size > 4000) memo.clear();
  memo.set(key, out);
  return out;
}

/** One roll worked out: where the ball meets the pins, its drift, which pins fall and how. */
export function rollResult(seed: string, rolls: number, pos: number, angle: number, power: number, standing: boolean[] = Array(10).fill(true)): { xAtPins: number; drift: number; fell: boolean[]; hits: (PinHit | null)[] } {
  const next = rng(`${seed}#roll${rolls}`);
  next();
  const drift = Math.round((next() - 0.5) * 16);
  const xAtPins = bowlingLine(pos, angle);
  const { fell, hits } = pinAction(seed, rolls, xAtPins + drift, angle, power, standing);
  return { xAtPins, drift, fell, hits };
}

export interface BowlingState {
  /** frames[player] = rolls per frame, each the number of pins. */
  frames: number[][][];
  turn: number;
  /** Pins still standing in the current frame for the player to roll. */
  standing: boolean[];
  totals: number[];
  /** The last ball: where it crossed the pins (with drift), where it was released, who rolled, what fell. */
  last: { x: number; fell: number; from: number; by: number } | null;
  rolls: number;
  done: boolean;
  /** LANX 2.17.0: who has left. */
  out: boolean[];
  /** The last ball in words ("P1: strike!", "P2 knocked down 8 — 7 and 10 left"); boards name the players. */
  event: string;
}

/** Standard ten-pin scoring. */
export function bowlingScore(frames: number[][]): number {
  let total = 0;
  for (let f = 0; f < 10; f++) {
    const fr = frames[f] ?? [];
    const next = [...(frames[f + 1] ?? []), ...(frames[f + 2] ?? [])];
    const sum = fr.reduce((a, b) => a + b, 0);
    if (f < 9) {
      if (fr[0] === 10) total += 10 + (next[0] ?? 0) + (next[1] ?? 0);
      else if (sum === 10 && fr.length >= 2) total += 10 + (next[0] ?? 0);
      else total += sum;
    } else total += sum;
  }
  return total;
}

function frameDone(frame: number[], tenth: boolean): boolean {
  if (!tenth) return frame[0] === 10 || frame.length >= 2;
  if (frame.length < 2) return false;
  if (frame.length === 3) return true;
  return frame[0] + frame[1] < 10 && frame[0] !== 10;
}

const finished = (fr: number[][]) => fr.length === 10 && frameDone(fr[9], true);

function outcome(s: BowlingState, n: number): Outcome {
  if (!s.done) return ON;
  const last = n > 1 && s.out.some(Boolean) ? lastIn(s.out, n) : null;
  if (last !== null) return win(last, "the others left", s.totals);
  const live = s.totals.map((x, i) => (s.out[i] ? -1 : x));
  const best = Math.max(...live);
  const tops = live.map((x, i) => (x === best ? i : -1)).filter((i) => i >= 0);
  return tops.length > 1 ? draw(`${best} each`, s.totals) : win(tops[0], `${best} pins`, s.totals);
}

/** Pins still up, by their numbers (1 = the head pin): "7 and 10", "2, 4 and 5". */
function pinWords(standing: boolean[]): string {
  const up = standing.map((u, i) => (u ? String(i + 1) : "")).filter(Boolean);
  return up.length <= 1 ? up.join("") : `${up.slice(0, -1).join(", ")} and ${up[up.length - 1]}`;
}

export const bowling: GameDef<BowlingState> = {
  id: "bowling",
  name: "Bowling",
  blurb: "Ten frames, strikes and spares; aim and power are up to you.",
  emoji: "🎳",
  minPlayers: 1,
  maxPlayers: 8,
  replay(moves, n, seed) {
    const s: BowlingState = { frames: Array.from({ length: n }, () => [[]]), turn: 0, standing: Array(10).fill(true), totals: Array(n).fill(0), last: null, rolls: 0, done: false, out: Array(n).fill(false), event: "" };
    /** The next bowler still in and not yet through ten frames. */
    const pass = () => {
      s.standing = Array(10).fill(true);
      let q = s.turn;
      for (let k = 0; k < n; k++) {
        q = nextIn(q, n, s.out);
        if (!finished(s.frames[q])) break;
      }
      s.turn = q;
      if (s.frames.every((fr, p) => s.out[p] || finished(fr))) s.done = true;
    };
    for (const m of moves) {
      if (s.done) return null;
      const gone = leaver(m, n);
      if (gone !== null) {
        if (gone < 0 || s.out[gone] || n < 2) return null;
        s.out[gone] = true;
        s.event = `P${gone + 1} left the game`;
        if (lastIn(s.out, n) !== null) s.done = true;
        else if (s.turn === gone) pass();
        else if (s.frames.every((fr, p) => s.out[p] || finished(fr))) s.done = true;
        continue;
      }
      const mv = /^r:(-?\d+):(-?\d+):(\d+)$/.exec(m);
      if (!mv) return null;
      const pos = Math.max(-100, Math.min(100, Number(mv[1])));
      const angle = Math.max(-30, Math.min(30, Number(mv[2])));
      const power = Math.max(1, Math.min(100, Number(mv[3])));
      const p = s.turn;
      const { xAtPins, drift, fell } = rollResult(seed, s.rolls, pos, angle, power, s.standing);
      const wasFull = s.standing.every(Boolean);
      let count = 0;
      fell.forEach((f, i) => {
        if (f && s.standing[i]) {
          s.standing[i] = false;
          count++;
        }
      });
      const frames = s.frames[p];
      const frame = frames[frames.length - 1];
      frame.push(count);
      s.last = { x: xAtPins + drift, fell: count, from: pos, by: p };
      s.rolls++;
      const who = `P${p + 1}`;
      const gutter = power >= 15 && Math.abs(xAtPins + drift) > LANE_HALF;
      if (wasFull && count === 10) s.event = `${who}: strike!`;
      else if (!wasFull && s.standing.every((u) => !u)) s.event = `${who}: spare!`;
      else if (count === 0) s.event = gutter ? `${who}: in the gutter` : power < 15 ? `${who}: too slow to reach the pins` : `${who}: missed them all`;
      else s.event = `${who} knocked down ${count}`;
      const tenth = frames.length === 10;
      const done = frameDone(frame, tenth);
      if (!done && count > 0 && s.standing.some(Boolean)) s.event += ` — ${pinWords(s.standing)} left`;
      // Tenth frame: fresh pins after a strike, after two strikes, or after a spare — only then.
      if (tenth && frame.length === 1 && frame[0] === 10) s.standing = Array(10).fill(true);
      if (tenth && frame.length === 2 && ((frame[0] === 10 && frame[1] === 10) || (frame[0] !== 10 && frame[0] + frame[1] === 10))) s.standing = Array(10).fill(true);
      if (done) {
        s.totals[p] = bowlingScore(frames);
        if (!tenth) frames.push([]);
        pass();
      }
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s, n) => outcome(s, n),
  summary: (s) => s.frames.map((fr, i) => `P${i + 1} ${s.out[i] ? "left" : bowlingScore(fr)}`).join(" · "),
};
