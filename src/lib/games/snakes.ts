// Snakes & Ladders: 2–8 players race from 1 to 100 on dice rolled by the
// match itself (everyone sees the same roll). Exactly 100 wins; a roll that
// would overshoot is lost. LANX 2.17.0, the Indian way: a six rolls again
// (a third six in a row is lost and the turn passes), and a player who
// leaves is skipped (the last one still in wins).
// Moves: "r" (the player to move rolls), "x<p>" (player p left).

import { ON, dice, lastIn, leaver, nextIn, win, type GameDef, type Outcome } from "./core.ts";

export const SNAKES: Record<number, number> = { 16: 6, 47: 26, 49: 11, 56: 53, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 98: 78 };
export const LADDERS: Record<number, number> = { 1: 38, 4: 14, 9: 31, 21: 42, 28: 84, 36: 44, 51: 67, 71: 91, 80: 100 };

export interface SnakesState {
  /** Square per player, 0 = not yet on the board. */
  pos: number[];
  turn: number;
  /** The last roll and who rolled it, for the board to show. */
  lastRoll: number;
  lastBy: number;
  /** Where the last move went through (square before a snake or ladder), for the animation. */
  via: number;
  rolls: number;
  winner: number | null;
  /** LANX 2.17.0: who has left (skipped, can't win). */
  out: boolean[];
  /** Sixes rolled in a row this turn. */
  sixes: number;
  /** What the last move did, in words ("P1 climbed a ladder to 42"); boards name the players. */
  event: string;
  reason: string;
}

function outcome(s: SnakesState): Outcome {
  return s.winner !== null ? win(s.winner, s.reason) : ON;
}

export const snakes: GameDef<SnakesState> = {
  id: "snakes",
  name: "Snakes & Ladders",
  blurb: "Pure luck: climb the ladders, dodge the snakes, hit 100 exactly.",
  emoji: "🪜",
  minPlayers: 2,
  maxPlayers: 8,
  replay(moves, n, seed) {
    const s: SnakesState = { pos: Array(n).fill(0), turn: 0, lastRoll: 0, lastBy: -1, via: 0, rolls: 0, winner: null, out: Array(n).fill(false), sixes: 0, event: "", reason: "" };
    for (const m of moves) {
      if (s.winner !== null) return null;
      const gone = leaver(m, n);
      if (gone !== null) {
        if (gone < 0 || s.out[gone]) return null;
        s.out[gone] = true;
        s.event = `P${gone + 1} left the game`;
        const last = lastIn(s.out, n);
        if (last !== null) {
          s.winner = last;
          s.reason = "the others left";
          continue;
        }
        if (s.turn === gone) {
          s.turn = nextIn(gone, n, s.out);
          s.sixes = 0;
        }
        continue;
      }
      if (m !== "r") return null;
      const p = s.turn;
      const roll = dice(seed, s.rolls);
      s.rolls++;
      s.lastRoll = roll;
      s.lastBy = p;
      const six = roll === 6;
      s.sixes = six ? s.sixes + 1 : 0;
      const from = s.pos[p];
      const who = `P${p + 1}`;
      if (s.sixes === 3) {
        // A third six in a row is lost, and so is the turn.
        s.via = from;
        s.sixes = 0;
        s.event = `${who} rolled a third six in a row — turn over`;
        s.turn = nextIn(p, n, s.out);
        continue;
      }
      let to = from + roll;
      let words: string;
      if (to > 100) {
        to = from;
        words = `${who} needs exactly ${100 - from}`;
      } else words = `${who} moved to ${to}`;
      s.via = to;
      if (LADDERS[to]) {
        to = LADDERS[to];
        words = `${who} climbed a ladder to ${to}`;
      } else if (SNAKES[to]) {
        to = SNAKES[to];
        words = `${who} slid down a snake to ${to}`;
      }
      s.pos[p] = to;
      if (to === 100) {
        s.winner = p;
        s.reason = "reached 100";
        s.event = `${who} reached 100!`;
        continue;
      }
      if (six) s.event = `${words} — a six, roll again`;
      else {
        s.event = words;
        s.turn = nextIn(p, n, s.out);
      }
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s) => outcome(s),
  summary: (s) => (s.event ? s.event : "roll to start — a six rolls again"),
};
