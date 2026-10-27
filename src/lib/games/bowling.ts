// Bowling, 1–8 players, ten frames with the usual strikes and spares. A
// roll is where you release across the lane (−100 left … 100 right), the
// angle you give it (−30 … 30) and the power (1 … 100); the ball drifts a
// little (from the seed) and knocks over the pins it reaches. Highest
// score after ten frames wins. Moves: "r:<pos>:<angle>:<power>".

import { ON, draw, rng, win, type GameDef, type Outcome } from "./core.ts";

/** Pin positions across the lane (x) and depth (row), as in the real triangle. */
export const PINS: [number, number][] = [
  [0, 0],
  [-30, 1], [30, 1],
  [-60, 2], [0, 2], [60, 2],
  [-90, 3], [-30, 3], [30, 3], [90, 3],
];

/** Which pins fall for a ball crossing the pins at lateral x with this power. */
export function knock(x: number, power: number, drift: number): boolean[] {
  const at = x + drift;
  const fell = Array(10).fill(false);
  if (power < 15 || Math.abs(at) > 150) return fell; // in the gutter or too slow
  const width = 34 + power * 0.9; // a hard ball scatters more
  const scatter = power / 100;
  PINS.forEach(([px, row], i) => {
    const d = Math.abs(px - at);
    const direct = d <= width / 2 + row * 6 * scatter;
    fell[i] = direct;
  });
  // Pins behind a fallen pin fall too, mostly.
  PINS.forEach(([px, row], i) => {
    if (fell[i] || row === 0) return;
    const ahead = PINS.findIndex(([qx, qr]) => qr === row - 1 && Math.abs(qx - px) <= 30);
    if (ahead >= 0 && fell[ahead] && power >= 45) fell[i] = true;
  });
  return fell;
}

/** LANX 2.16.0: one roll worked out (the same sums the replay below has always done):
 *  where the ball meets the pins, its drift, and which pins it knocks down. */
export function rollResult(seed: string, rolls: number, pos: number, angle: number, power: number): { xAtPins: number; drift: number; fell: boolean[] } {
  const next = rng(`${seed}#roll${rolls}`);
  next();
  const drift = Math.round((next() - 0.5) * 16);
  // Where the ball meets the pins: it travels the lane (depth 600) at the given angle.
  const xAtPins = pos + Math.round(Math.tan((angle * Math.PI) / 180) * 600);
  return { xAtPins, drift, fell: knock(xAtPins, power, drift) };
}

export interface BowlingState {
  /** frames[player] = rolls per frame, each the number of pins. */
  frames: number[][][];
  turn: number;
  /** Pins still standing in the current frame for the player to roll. */
  standing: boolean[];
  totals: number[];
  last: { x: number; fell: number } | null;
  rolls: number;
  done: boolean;
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

function outcome(s: BowlingState): Outcome {
  if (!s.done) return ON;
  const best = Math.max(...s.totals);
  const tops = s.totals.map((x, i) => (x === best ? i : -1)).filter((i) => i >= 0);
  return tops.length > 1 ? draw(`${best} each`, s.totals) : win(tops[0], `${best} pins`, s.totals);
}

export const bowling: GameDef<BowlingState> = {
  id: "bowling",
  name: "Bowling",
  blurb: "Ten frames, strikes and spares; aim and power are up to you.",
  emoji: "🎳",
  minPlayers: 1,
  maxPlayers: 8,
  replay(moves, n, seed) {
    const s: BowlingState = { frames: Array.from({ length: n }, () => [[]]), turn: 0, standing: Array(10).fill(true), totals: Array(n).fill(0), last: null, rolls: 0, done: false };
    for (const m of moves) {
      if (s.done) return null;
      const mv = /^r:(-?\d+):(-?\d+):(\d+)$/.exec(m);
      if (!mv) return null;
      const pos = Math.max(-100, Math.min(100, Number(mv[1])));
      const angle = Math.max(-30, Math.min(30, Number(mv[2])));
      const power = Math.max(1, Math.min(100, Number(mv[3])));
      const { xAtPins, drift, fell } = rollResult(seed, s.rolls, pos, angle, power);
      let count = 0;
      fell.forEach((f, i) => {
        if (f && s.standing[i]) {
          s.standing[i] = false;
          count++;
        }
      });
      const p = s.turn;
      const frames = s.frames[p];
      const frame = frames[frames.length - 1];
      frame.push(count);
      s.last = { x: xAtPins + drift, fell: count };
      s.rolls++;
      const tenth = frames.length === 10;
      if (tenth && frame.length === 2 && (frame[0] === 10 || frame[0] + frame[1] === 10)) s.standing = Array(10).fill(true);
      if (tenth && frame.length === 1 && frame[0] === 10) s.standing = Array(10).fill(true);
      if (frameDone(frame, tenth)) {
        s.totals[p] = bowlingScore(frames);
        if (!tenth) frames.push([]);
        s.standing = Array(10).fill(true);
        s.turn = (s.turn + 1) % n;
        // Skip players who have finished.
        let guard = 0;
        while (s.frames[s.turn].length === 10 && frameDone(s.frames[s.turn][9], true) && guard++ < n) s.turn = (s.turn + 1) % n;
        if (s.frames.every((fr) => fr.length === 10 && frameDone(fr[9], true))) s.done = true;
      }
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s) => outcome(s),
  summary: (s) => s.frames.map((fr, i) => `P${i + 1} ${bowlingScore(fr)}`).join(" · "),
};
