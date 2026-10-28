// 8-Ball Pool, two players. Break; the first ball potted gives you solids
// (1–7) or stripes (9–15); pot all of yours, then the 8. Potting the cue
// ball is a foul (the other player places it anywhere); potting the 8 early
// loses. A turn ends when you pot nothing of yours or foul.
// LANX 2.17.0: the 8 down on the break goes back on its spot and play goes
// on; potting your last ball and the 8 in the same shot loses (you must be
// on the 8 before the shot); hitting the 8 first while you still have balls
// up (or on an open table) is a foul — ball in hand. Every shot leaves a line
// in the log ("P1 missed — P2 to play").
// Moves: "s:<angle>:<power>" (degrees, 1–100), or "c:<x>:<y>" to place the
// cue ball when you have it in hand. LANX 2.16.0: "s:<angle>:<power>:<side>:<top>"
// adds spin (each −100…100: side = english, top = follow/draw); a shot
// without spin is still the old three-part move, so older copies agree.

import { ON, win, type GameDef, type Outcome } from "./core.ts";
import { K, rectWalls, settle, velocity, type Body, type Table } from "./physics2d.ts";

export const POOL_W = 800;
export const POOL_H = 400;
export const POOL_BALL_R = 11;
const POCKET_R = 22;

const POCKETS = [
  [8, 8], [POOL_W / 2, 2], [POOL_W - 8, 8],
  [8, POOL_H - 8], [POOL_W / 2, POOL_H - 2], [POOL_W - 8, POOL_H - 8],
];

export const POOL_TABLE: Table = {
  walls: rectWalls(POOL_BALL_R * K, POOL_BALL_R * K, (POOL_W - POOL_BALL_R) * K, (POOL_H - POOL_BALL_R) * K).map((w) => ({ x1: w.x1 - POOL_BALL_R * K + 0, y1: w.y1 - POOL_BALL_R * K + 0, x2: w.x2 - POOL_BALL_R * K + 0, y2: w.y2 - POOL_BALL_R * K + 0 })),
  pockets: POCKETS.map(([x, y]) => ({ x: x * K, y: y * K, r: POCKET_R * K })),
  friction: 6,
  stop: 60,
  bounce: 780,
};
// Walls sit on the cushion line (0..W, 0..H), inset by a ball so pieces bounce at the rail.
POOL_TABLE.walls = rectWalls(0, 0, POOL_W * K, POOL_H * K);

/** The foot spot: where the rack's front ball (and a re-spotted 8) sits. */
const FOOT_X = 560;

export function rack(): Body[] {
  const balls: Body[] = [{ id: 0, x: 200 * K, y: 200 * K, vx: 0, vy: 0, r: POOL_BALL_R * K, mass: 1, out: false }];
  // The triangle: 1 at the front, 8 in the middle of the third row.
  const order = [1, 9, 2, 10, 8, 3, 11, 4, 12, 13, 5, 14, 6, 15, 7];
  let k = 0;
  const ax = FOOT_X;
  for (let row = 0; row < 5; row++) {
    for (let i = 0; i <= row; i++) {
      const id = order[k++];
      balls.push({ id, x: Math.round((ax + row * POOL_BALL_R * 1.74) * K), y: Math.round((200 + (i - row / 2) * POOL_BALL_R * 2.02) * K), vx: 0, vy: 0, r: POOL_BALL_R * K, mass: 1, out: false });
    }
  }
  return balls;
}

export interface PoolState {
  balls: Body[];
  turn: number;
  /** groups[player] = "solid" | "stripe" | null (not yet decided). */
  groups: (string | null)[];
  inHand: boolean;
  winner: number | null;
  reason: string;
  /** Frames of the last shot for the animation (x, y per ball, thousandths). */
  frames: { x: number; y: number; out: boolean }[][];
  /** What each shot did, newest last ("P1 missed — P2 to play"); boards name the players. */
  log: string[];
  /** LANX 2.17.0: shots taken (0 = the break is next). */
  shots: number;
}

const isSolid = (id: number) => id >= 1 && id <= 7;
const isStripe = (id: number) => id >= 9 && id <= 15;
const groupOf = (id: number) => (isSolid(id) ? "solid" : isStripe(id) ? "stripe" : null);

/** The cue ball struck: every ball's path (frames every 5 steps) and what happened (with the step it happened at). */
export function poolSimulate(start: Body[], angle: number, power: number, side = 0, top = 0) {
  const balls = start.map((b) => ({ ...b }));
  const cue = balls[0];
  const [vx, vy] = velocity(angle, power * 5000);
  cue.vx = vx;
  cue.vy = vy;
  cue.follow = top * 10;
  cue.side = side * 10;
  const { events, frames } = settle(balls, POOL_TABLE, 4000, 5);
  for (const b of balls) {
    delete b.follow;
    delete b.side;
  }
  return { balls, events, frames };
}

/** LANX 2.17.0: where the 8 goes back after it drops on the break — the foot spot, or straight behind it if a ball is there. */
function respotEight(balls: Body[]) {
  const eight = balls.find((b) => b.id === 8)!;
  const y = (POOL_H / 2) * K;
  for (let x = FOOT_X; x <= POOL_W - POOL_BALL_R; x++) {
    const clear = balls.every((b) => b.id === 8 || b.out || (b.x - x * K) ** 2 + (b.y - y) ** 2 >= (2 * POOL_BALL_R * K) ** 2);
    if (!clear) continue;
    eight.x = x * K;
    eight.y = y;
    break;
  }
  eight.out = false;
  eight.vx = 0;
  eight.vy = 0;
}

export function poolShot(s: PoolState, angle: number, power: number, n: number, side = 0, top = 0): PoolState {
  const { balls, events, frames } = poolSimulate(s.balls, angle, power, side, top);
  const cue = balls[0];
  const potted = events.filter((e) => e.kind === "pocket").map((e) => e.a);
  const next: PoolState = { ...s, balls, frames, log: [...s.log], shots: (s.shots ?? 0) + 1 };
  const p = s.turn;
  const o = (p + 1) % n;
  const who = `P${p + 1}`;
  const brk = (s.shots ?? 0) === 0;
  const mineGroup = s.groups[p];
  // Counted before the shot: potting your last ball and the 8 together is not "on the 8".
  const onEight = mineGroup !== null && ownBallsLeft(s, p) === 0;
  const firstHit = events.find((e) => e.kind === "hit" && (e.a === 0 || e.b === 0));
  const hitId = firstHit ? (firstHit.a === 0 ? firstHit.b! : firstHit.a) : null;
  let foul = false;
  let why = "";
  if (potted.includes(0)) {
    foul = true;
    why = "potted the cue ball";
    cue.out = false;
    cue.x = 200 * K;
    cue.y = 200 * K;
    cue.vx = 0;
    cue.vy = 0;
  } else if (hitId === null) {
    foul = true;
    why = "hit nothing";
  } else if (hitId === 8 && !onEight && !brk) {
    foul = true;
    why = mineGroup ? "hit the 8 first while their own balls are still up" : "hit the 8 first on an open table";
  } else if (mineGroup && groupOf(hitId) && groupOf(hitId) !== mineGroup) {
    foul = true;
    why = "hit the wrong ball first";
  }
  let eightNote = "";
  if (potted.includes(8)) {
    if (brk) {
      // The 8 on the break: back on its spot, and play goes on.
      respotEight(balls);
      eightNote = "the 8 went down on the break — back on its spot";
    } else {
      const legal = onEight && !foul;
      if (legal) {
        next.winner = p;
        next.reason = "the 8 is down";
        next.log.push(`${who} potted the 8 — wins!`);
      } else {
        next.winner = o;
        next.reason = foul ? "the 8 went down on a foul" : "the 8 went down too early";
        next.log.push(`${who} potted the 8 ${foul ? `on a foul (${why})` : "too early"} — P${o + 1} wins`);
      }
      return next;
    }
  }
  // Decide groups on the first pot (not on a foul).
  const object = potted.filter((id) => id !== 0 && id !== 8);
  let groupNote = "";
  if (!foul && mineGroup === null && object.length) {
    const g = groupOf(object[0])!;
    next.groups = next.groups.map((x, i) => (i === p ? g : x === null && n === 2 ? (g === "solid" ? "stripe" : "solid") : x));
    groupNote = `${who} takes ${g}s`;
  }
  const mine = next.groups[p];
  const keep = !foul && object.some((id) => groupOf(id) === mine);
  next.inHand = foul;
  const parts: string[] = [];
  if (eightNote) parts.push(eightNote);
  if (foul) parts.push(`Foul by ${who}: ${why}${object.length ? ` (potted ${object.join(", ")})` : ""}`);
  else if (object.length) {
    const own = object.filter((id) => groupOf(id) === mine);
    const other = object.filter((id) => groupOf(id) !== mine);
    parts.push(`${who} potted ${object.join(", ")}${!own.length && other.length ? " — not theirs" : ""}`);
  } else if (!eightNote) parts.push(`${who} missed`);
  if (groupNote) parts.push(groupNote);
  if (foul) parts.push(`P${o + 1} has the cue ball in hand`);
  else parts.push(keep ? `${who} shoots again` : `P${o + 1} to play`);
  next.log.push(parts.join(" — "));
  if (!keep) next.turn = o;
  return next;
}

export function ownBallsLeft(s: PoolState, p: number): number {
  const g = s.groups[p];
  if (!g) return 7;
  return s.balls.filter((b) => !b.out && groupOf(b.id) === g).length;
}

function outcome(s: PoolState): Outcome {
  return s.winner !== null ? win(s.winner, s.reason) : ON;
}

export const pool: GameDef<PoolState> = {
  id: "pool",
  name: "8-Ball Pool",
  blurb: "Solids or stripes, then the 8 — real angles, real bounces.",
  emoji: "🎱",
  minPlayers: 2,
  maxPlayers: 2,
  replay(moves, n) {
    let s: PoolState = { balls: rack(), turn: 0, groups: [null, null], inHand: false, winner: null, reason: "", frames: [], log: [], shots: 0 };
    for (const m of moves) {
      if (s.winner !== null) return null;
      const place = /^c:(\d+):(\d+)$/.exec(m);
      if (place) {
        if (!s.inHand) return null;
        const x = Number(place[1]);
        const y = Number(place[2]);
        if (x < POOL_BALL_R || x > POOL_W - POOL_BALL_R || y < POOL_BALL_R || y > POOL_H - POOL_BALL_R) return null;
        if (s.balls.some((b) => b.id !== 0 && !b.out && (b.x - x * K) ** 2 + (b.y - y * K) ** 2 < (2 * POOL_BALL_R * K) ** 2)) return null;
        s = { ...s, balls: s.balls.map((b) => (b.id === 0 ? { ...b, x: x * K, y: y * K, out: false } : b)), inHand: false, frames: [] };
        continue;
      }
      const mv = /^s:(-?\d+):(\d+)(?::(-?\d+):(-?\d+))?$/.exec(m);
      if (!mv || s.inHand) return null;
      const spin = (v: string | undefined) => Math.max(-100, Math.min(100, Number(v ?? 0)));
      s = poolShot(s, Number(mv[1]), Math.max(1, Math.min(100, Number(mv[2]))), n, spin(mv[3]), spin(mv[4]));
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s) => outcome(s),
  summary: (s) => s.groups.map((g, i) => `P${i + 1} ${g ?? "?"} ${g ? ownBallsLeft(s, i) : ""}`).join(" · "),
};

/** LANX 2.17.0: a clear place for the cue ball in hand — the head spot, or the nearest free point along the middle line. */
export function poolFreeSpot(s: PoolState): [number, number] {
  const y = POOL_H / 2;
  for (let d = 0; d < POOL_W / 2; d++)
    for (const x of [200 - d, 200 + d]) {
      if (x < POOL_BALL_R || x > POOL_W - POOL_BALL_R) continue;
      if (s.balls.every((b) => b.id === 0 || b.out || (b.x - x * K) ** 2 + (b.y - y * K) ** 2 >= (2 * POOL_BALL_R * K) ** 2)) return [x, y];
    }
  return [200, y];
}
