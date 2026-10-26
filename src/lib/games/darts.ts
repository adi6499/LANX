// Darts (301, straight out): 2–8 players, three darts a turn, down from 301
// to exactly 0; a turn that would go below 0 is a bust and scores nothing.
// Aim by clicking the board while the sight wobbles; the dart lands where you
// clicked. Moves: "t:<x>:<y>" in board units (0,0 = the bull, radius 170).

import { ON, win, type GameDef, type Outcome } from "./core.ts";

export const DART_R = 170; // outer edge of the double ring
const SECTORS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

/** The score of a dart at (x, y), board units. */
export function dartScore(x: number, y: number): { points: number; text: string } {
  const d = Math.sqrt(x * x + y * y);
  if (d > DART_R) return { points: 0, text: "miss" };
  if (d <= 6.35) return { points: 50, text: "bull" };
  if (d <= 16) return { points: 25, text: "outer bull" };
  const angle = ((Math.atan2(x, -y) * 180) / Math.PI + 360 + 9) % 360; // 20 at the top
  const sector = SECTORS[Math.floor(angle / 18)];
  if (d >= 162 && d <= DART_R) return { points: sector * 2, text: `double ${sector}` };
  if (d >= 99 && d <= 107) return { points: sector * 3, text: `treble ${sector}` };
  return { points: sector, text: `${sector}` };
}

export interface DartsState {
  left: number[];
  turn: number;
  /** Darts thrown this turn (0..3) and their points. */
  thrown: { x: number; y: number; points: number; text: string }[];
  /** The score at the start of this turn (restored on a bust). */
  turnStart: number;
  winner: number | null;
  log: string[];
}

function outcome(s: DartsState): Outcome {
  return s.winner !== null ? win(s.winner, "down to zero") : ON;
}

export const darts: GameDef<DartsState> = {
  id: "darts",
  name: "Darts",
  blurb: "301 down to zero, three darts a turn; bust and you lose the turn.",
  emoji: "🎯",
  minPlayers: 1,
  maxPlayers: 8,
  replay(moves, n) {
    const s: DartsState = { left: Array(n).fill(301), turn: 0, thrown: [], turnStart: 301, winner: null, log: [] };
    for (const m of moves) {
      if (s.winner !== null) return null;
      const mv = /^t:(-?\d+):(-?\d+)$/.exec(m);
      if (!mv) return null;
      const x = Number(mv[1]);
      const y = Number(mv[2]);
      if (Math.abs(x) > 400 || Math.abs(y) > 400) return null;
      const sc = dartScore(x, y);
      s.thrown.push({ x, y, ...sc });
      s.left[s.turn] -= sc.points;
      const p = s.turn;
      const endTurn = (why: string) => {
        s.log.push(`Player ${p + 1}: ${s.thrown.map((t) => t.text).join(", ")} — ${why}`);
        s.thrown = [];
        s.turn = (s.turn + 1) % n;
        s.turnStart = s.left[s.turn];
      };
      if (s.left[p] === 0) {
        s.winner = p;
        s.log.push(`Player ${p + 1} checks out!`);
      } else if (s.left[p] < 0) {
        s.left[p] = s.turnStart;
        endTurn("bust");
      } else if (s.thrown.length === 3) endTurn(`${s.left[p]} left`);
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s) => outcome(s),
  summary: (s) => s.left.map((x, i) => `P${i + 1} ${x}`).join(" · "),
};
