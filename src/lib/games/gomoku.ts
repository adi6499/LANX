// Gomoku: five in a row on a 15×15 board, two players, black (player 0)
// starts. Moves: the cell "0".."224".

import { ON, draw, longestLine, num, win, type GameDef, type Outcome } from "./core.ts";

export const GOMOKU = 15;

export interface GomokuState {
  cells: (number | null)[];
  turn: number;
  last: number;
  winner: number | null;
}

function outcome(s: GomokuState): Outcome {
  if (s.winner !== null) return win(s.winner, "five in a row");
  if (s.cells.every((c) => c !== null)) return draw("the board is full");
  return ON;
}

export const gomoku: GameDef<GomokuState> = {
  id: "gomoku",
  name: "Gomoku",
  blurb: "Five in a row on a big open board.",
  emoji: "⚪",
  minPlayers: 2,
  maxPlayers: 2,
  replay(moves) {
    const s: GomokuState = { cells: Array(GOMOKU * GOMOKU).fill(null), turn: 0, last: -1, winner: null };
    for (const m of moves) {
      if (s.winner !== null) return null;
      const i = num(m);
      if (i === null || i < 0 || i >= s.cells.length || s.cells[i] !== null) return null;
      s.cells[i] = s.turn;
      s.last = i;
      if (longestLine(s.cells, i, s.turn, GOMOKU, GOMOKU) >= 5) s.winner = s.turn;
      s.turn = 1 - s.turn;
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s) => outcome(s),
};
