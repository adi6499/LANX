// Mini Golf, 1–8 players, nine holes. Aim with an angle and power; the ball
// rolls, bounces off the walls, and drops in when it reaches the cup slowly
// enough. Fewest strokes over nine holes wins (eight strokes is the most a
// hole can cost). Moves: "s:<angle>:<power>" (angle in degrees, power 1–100).

import { ON, draw, win, type GameDef, type Outcome } from "./core.ts";
import { K, rectWalls, settle, type Body, type Table, type Wall, velocity } from "./physics2d.ts";

export const GOLF_W = 400;
export const GOLF_H = 600;
export const BALL_R = 10;
export const CUP_R = 16;
export const HOLES_COUNT = 9;
export const MAX_STROKES = 8;

export interface Hole {
  tee: [number, number];
  cup: [number, number];
  /** Inner walls as rectangles [x, y, w, h] in table units. */
  blocks: [number, number, number, number][];
  par: number;
}

export const HOLES: Hole[] = [
  { tee: [200, 540], cup: [200, 80], blocks: [], par: 2 },
  { tee: [200, 540], cup: [200, 80], blocks: [[120, 300, 160, 24]], par: 3 },
  { tee: [80, 540], cup: [320, 80], blocks: [[0, 260, 260, 24]], par: 3 },
  { tee: [200, 540], cup: [200, 80], blocks: [[60, 200, 110, 24], [230, 200, 110, 24], [160, 380, 80, 24]], par: 3 },
  { tee: [60, 540], cup: [340, 80], blocks: [[140, 120, 24, 360]], par: 3 },
  { tee: [200, 540], cup: [60, 80], blocks: [[0, 180, 300, 24], [100, 360, 300, 24]], par: 4 },
  { tee: [340, 540], cup: [60, 80], blocks: [[120, 300, 160, 160]], par: 3 },
  { tee: [200, 540], cup: [200, 80], blocks: [[0, 150, 170, 24], [230, 150, 170, 24], [0, 420, 170, 24], [230, 420, 170, 24]], par: 3 },
  { tee: [60, 540], cup: [340, 80], blocks: [[90, 100, 24, 200], [200, 300, 24, 200], [280, 100, 24, 120]], par: 4 },
];

function tableFor(h: Hole): Table {
  const walls: Wall[] = rectWalls(0, 0, GOLF_W * K, GOLF_H * K);
  for (const [x, y, w, hh] of h.blocks) walls.push(...rectWalls(x * K, y * K, (x + w) * K, (y + hh) * K));
  return { walls, pockets: [{ x: h.cup[0] * K, y: h.cup[1] * K, r: CUP_R * K }], friction: 5, stop: 60, bounce: 850, pocketMaxSpeed: 260_000 };
}

export interface GolfState {
  hole: number;
  /** Ball positions per player on the current hole (table units), or null once holed. */
  ball: ([number, number] | null)[];
  strokes: number[][];
  turn: number;
  /** The last shot's path, for the animation. */
  path: [number, number][];
  done: boolean;
}

function nextTurn(s: GolfState, n: number) {
  for (let k = 1; k <= n; k++) {
    const q = (s.turn + k) % n;
    if (s.ball[q]) {
      s.turn = q;
      return;
    }
  }
  // Everyone holed: next hole.
  s.hole++;
  if (s.hole >= HOLES_COUNT) {
    s.done = true;
    return;
  }
  const h = HOLES[s.hole];
  s.ball = s.ball.map(() => [h.tee[0], h.tee[1]] as [number, number]);
  for (const st of s.strokes) st.push(0);
  s.turn = 0;
}

export function golfShot(hole: Hole, from: [number, number], angle: number, power: number): { end: [number, number] | null; path: [number, number][] } {
  const ball: Body = { id: 0, x: from[0] * K, y: from[1] * K, vx: 0, vy: 0, r: BALL_R * K, mass: 1, out: false };
  const [vx, vy] = velocity(angle, power * 3000);
  ball.vx = vx;
  ball.vy = vy;
  const { frames } = settle([ball], tableFor(hole), 2500, 6);
  const path = frames.map((f) => [Math.round(f[0].x / K), Math.round(f[0].y / K)] as [number, number]);
  return { end: ball.out ? null : [Math.round(ball.x / K), Math.round(ball.y / K)], path };
}

function outcome(s: GolfState): Outcome {
  if (!s.done) return ON;
  const totals = s.strokes.map((st) => st.reduce((a, b) => a + b, 0));
  const best = Math.min(...totals);
  const tops = totals.map((x, i) => (x === best ? i : -1)).filter((i) => i >= 0);
  return tops.length > 1 ? draw(`${best} strokes each`, totals) : win(tops[0], `${best} strokes`, totals);
}

export const minigolf: GameDef<GolfState> = {
  id: "minigolf",
  name: "Mini Golf",
  blurb: "Nine holes; bounce off the walls and sink it in the fewest strokes.",
  emoji: "⛳",
  minPlayers: 1,
  maxPlayers: 8,
  replay(moves, n) {
    const h0 = HOLES[0];
    const s: GolfState = { hole: 0, ball: Array.from({ length: n }, () => [h0.tee[0], h0.tee[1]] as [number, number]), strokes: Array.from({ length: n }, () => [0]), turn: 0, path: [], done: false };
    for (const m of moves) {
      if (s.done) return null;
      const mv = /^s:(-?\d+):(\d+)$/.exec(m);
      if (!mv) return null;
      const p = s.turn;
      const from = s.ball[p];
      if (!from) return null;
      const power = Math.max(1, Math.min(100, Number(mv[2])));
      const { end, path } = golfShot(HOLES[s.hole], from, Number(mv[1]), power);
      s.path = path;
      s.strokes[p][s.hole]++;
      if (!end || s.strokes[p][s.hole] >= MAX_STROKES) {
        s.ball[p] = null;
        if (end) s.strokes[p][s.hole] = MAX_STROKES; // picked up
      } else s.ball[p] = end;
      nextTurn(s, n);
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s) => outcome(s),
  summary: (s) => `hole ${Math.min(s.hole + 1, HOLES_COUNT)} · ` + s.strokes.map((st, i) => `P${i + 1} ${st.reduce((a, b) => a + b, 0)}`).join(" · "),
};
