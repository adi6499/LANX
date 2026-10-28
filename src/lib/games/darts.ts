// Darts, LANX 2.17.0: 501, double out — the game in every pub and club.
// 1–8 players, three darts a turn, down from 501 to exactly 0, and the dart
// that gets you there must be a double (the thin outer ring, or the bull,
// which counts as double 25). Going below 0, landing on 1, or reaching 0
// without a double is a bust: the turn scores nothing. Aim by clicking the
// board while the sight wobbles; the dart lands where the sight was.
// A player who leaves is skipped (the last one still in wins).
// Moves: "t:<x>:<y>" in board units (0,0 = the bull, radius 170), "x<p>" (player p left).

import { ON, lastIn, leaver, nextIn, win, type GameDef, type Outcome } from "./core.ts";

export const DART_R = 170; // outer edge of the double ring
export const DART_START = 501;
const SECTORS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

/** The score of a dart at (x, y), board units; `double` when it can finish a game. */
export function dartScore(x: number, y: number): { points: number; text: string; double: boolean } {
  const d = Math.sqrt(x * x + y * y);
  if (d > DART_R) return { points: 0, text: "miss", double: false };
  if (d <= 6.35) return { points: 50, text: "bull", double: true };
  if (d <= 16) return { points: 25, text: "outer bull", double: false };
  const angle = ((Math.atan2(x, -y) * 180) / Math.PI + 360 + 9) % 360; // 20 at the top
  const sector = SECTORS[Math.floor(angle / 18)];
  if (d >= 162 && d <= DART_R) return { points: sector * 2, text: `double ${sector}`, double: true };
  if (d >= 99 && d <= 107) return { points: sector * 3, text: `treble ${sector}`, double: false };
  return { points: sector, text: `${sector}`, double: false };
}

/** The one-dart finish for what is left, if there is one ("double 16", "bull"). */
export function dartFinish(left: number): string | null {
  if (left === 50) return "bull";
  if (left >= 2 && left <= 40 && left % 2 === 0) return `double ${left / 2}`;
  return null;
}

export interface DartsState {
  left: number[];
  turn: number;
  /** Darts thrown this turn (0..3) and their points. */
  thrown: { x: number; y: number; points: number; text: string }[];
  /** The score at the start of this turn (restored on a bust). */
  turnStart: number;
  winner: number | null;
  /** What happened, per turn ("P1: 20, treble 19, 5 — 419 left"). */
  log: string[];
  /** LANX 2.17.0: who has left. */
  out: boolean[];
  reason: string;
}

function outcome(s: DartsState): Outcome {
  return s.winner !== null ? win(s.winner, s.reason) : ON;
}

export const darts: GameDef<DartsState> = {
  id: "darts",
  name: "Darts",
  blurb: "501, finish on a double, three darts a turn; bust and you lose the turn.",
  emoji: "🎯",
  minPlayers: 1,
  maxPlayers: 8,
  replay(moves, n) {
    const s: DartsState = { left: Array(n).fill(DART_START), turn: 0, thrown: [], turnStart: DART_START, winner: null, log: [], out: Array(n).fill(false), reason: "" };
    const pass = () => {
      s.thrown = [];
      s.turn = nextIn(s.turn, n, s.out);
      s.turnStart = s.left[s.turn];
    };
    for (const m of moves) {
      if (s.winner !== null) return null;
      const gone = leaver(m, n);
      if (gone !== null) {
        if (gone < 0 || s.out[gone] || n < 2) return null;
        s.out[gone] = true;
        s.log.push(`P${gone + 1} left the game`);
        if (s.turn === gone) {
          s.left[gone] = s.turnStart; // their unfinished turn doesn't count
          pass();
        }
        const last = lastIn(s.out, n);
        if (last !== null) {
          s.winner = last;
          s.reason = "the others left";
        }
        continue;
      }
      const mv = /^t:(-?\d+):(-?\d+)$/.exec(m);
      if (!mv) return null;
      const x = Number(mv[1]);
      const y = Number(mv[2]);
      if (Math.abs(x) > 400 || Math.abs(y) > 400) return null;
      const sc = dartScore(x, y);
      s.thrown.push({ x, y, points: sc.points, text: sc.text });
      s.left[s.turn] -= sc.points;
      const p = s.turn;
      const darts = () => s.thrown.map((t) => t.text).join(", ");
      const left = s.left[p];
      if (left === 0 && sc.double) {
        s.winner = p;
        s.reason = `checked out on ${sc.text}`;
        s.log.push(`P${p + 1}: ${darts()} — checked out!`);
      } else if (left < 0 || left === 1 || left === 0) {
        const why = left === 0 ? "the last dart must be a double" : left === 1 ? "1 left can't be finished" : "below zero";
        s.left[p] = s.turnStart;
        s.log.push(`P${p + 1}: ${darts()} — bust (${why}), back to ${s.turnStart}`);
        pass();
      } else if (s.thrown.length === 3) {
        s.log.push(`P${p + 1}: ${darts()} — ${left} left`);
        pass();
      }
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s) => outcome(s),
  summary: (s) => s.left.map((x, i) => `P${i + 1} ${s.out[i] ? "left" : x}`).join(" · "),
};
