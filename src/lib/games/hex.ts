// Hex: an 11×11 board of hexagons. Red (player 0) joins the left and right
// edges, blue (player 1) the top and bottom; the first unbroken chain wins
// (there is never a draw). Moves: the cell "0".."120".
// LANX 2.17.0: the swap rule, so moving first is no longer an advantage. On
// blue's first turn blue may answer "swap": red's first stone becomes blue's,
// reflected across the long diagonal (row and column trade places, so it does
// for blue's top-bottom goal what it did for red's left-right one), and red
// moves next.

import { ON, num, win, type GameDef, type Outcome } from "./core.ts";

export const HEX = 11;

export interface HexState {
  cells: (number | null)[];
  turn: number;
  winner: number | null;
  last: number;
  /** Blue took red's first stone with the swap rule. */
  swapped: boolean;
}

/** The cell reflected across the long diagonal (row and column swapped). */
export const hexMirror = (i: number) => (i % HEX) * HEX + Math.floor(i / HEX);

/** Whether the player to move may answer "swap" now (blue's first turn). */
export const hexCanSwap = (s: HexState, moves: readonly string[]) => moves.length === 1 && s.turn === 1 && s.winner === null;

/** The six neighbours of a hex cell (rows shift half a cell to the right each row). */
export function hexNeighbours(i: number): number[] {
  const r = Math.floor(i / HEX);
  const c = i % HEX;
  const out: number[] = [];
  for (const [dr, dc] of [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, -1], [1, 0]]) {
    const rr = r + dr;
    const cc = c + dc;
    if (rr >= 0 && rr < HEX && cc >= 0 && cc < HEX) out.push(rr * HEX + cc);
  }
  return out;
}

function connected(cells: (number | null)[], who: number): boolean {
  const seen = new Set<number>();
  const stack: number[] = [];
  for (let k = 0; k < HEX; k++) {
    const start = who === 0 ? k * HEX : k; // left column / top row
    if (cells[start] === who) {
      stack.push(start);
      seen.add(start);
    }
  }
  while (stack.length) {
    const i = stack.pop()!;
    if (who === 0 ? i % HEX === HEX - 1 : Math.floor(i / HEX) === HEX - 1) return true;
    for (const j of hexNeighbours(i)) {
      if (cells[j] === who && !seen.has(j)) {
        seen.add(j);
        stack.push(j);
      }
    }
  }
  return false;
}

function outcome(s: HexState): Outcome {
  return s.winner !== null ? win(s.winner, s.winner === 0 ? "left joined to right" : "top joined to bottom") : ON;
}

export const hex: GameDef<HexState> = {
  id: "hex",
  name: "Hex",
  blurb: "Join your two sides of the board before they join theirs.",
  emoji: "⬡",
  minPlayers: 2,
  maxPlayers: 2,
  replay(moves) {
    const s: HexState = { cells: Array(HEX * HEX).fill(null), turn: 0, winner: null, last: -1, swapped: false };
    for (let k = 0; k < moves.length; k++) {
      const m = moves[k];
      if (s.winner !== null) return null;
      if (m === "swap") {
        if (k !== 1) return null;
        const first = s.last;
        const to = hexMirror(first);
        s.cells[first] = null;
        s.cells[to] = 1;
        s.last = to;
        s.swapped = true;
        s.turn = 0;
        continue;
      }
      const i = num(m);
      if (i === null || i < 0 || i >= s.cells.length || s.cells[i] !== null) return null;
      s.cells[i] = s.turn;
      s.last = i;
      if (connected(s.cells, s.turn)) s.winner = s.turn;
      s.turn = 1 - s.turn;
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s) => outcome(s),
};
