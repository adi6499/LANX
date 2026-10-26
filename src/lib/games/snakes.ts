// Snakes & Ladders: 2–8 players race from 1 to 100 on dice rolled by the
// match itself (everyone sees the same roll). Exactly 100 wins; a roll that
// would overshoot is lost. Moves: "r" (the player to move rolls).

import { ON, dice, win, type GameDef, type Outcome } from "./core.ts";

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
}

function outcome(s: SnakesState): Outcome {
  return s.winner !== null ? win(s.winner, "reached 100") : ON;
}

export const snakes: GameDef<SnakesState> = {
  id: "snakes",
  name: "Snakes & Ladders",
  blurb: "Pure luck: climb the ladders, dodge the snakes, hit 100 exactly.",
  emoji: "🪜",
  minPlayers: 2,
  maxPlayers: 8,
  replay(moves, n, seed) {
    const s: SnakesState = { pos: Array(n).fill(0), turn: 0, lastRoll: 0, lastBy: -1, via: 0, rolls: 0, winner: null };
    for (const m of moves) {
      if (s.winner !== null || m !== "r") return null;
      const roll = dice(seed, s.rolls);
      s.rolls++;
      s.lastRoll = roll;
      s.lastBy = s.turn;
      const from = s.pos[s.turn];
      let to = from + roll;
      if (to > 100) to = from;
      s.via = to;
      if (LADDERS[to]) to = LADDERS[to];
      else if (SNAKES[to]) to = SNAKES[to];
      s.pos[s.turn] = to;
      if (to === 100) s.winner = s.turn;
      else s.turn = (s.turn + 1) % n;
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s) => outcome(s),
  summary: (s) => (s.lastBy >= 0 ? `last roll ${s.lastRoll}` : "roll to start"),
};
