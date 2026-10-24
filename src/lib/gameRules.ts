// LANX 2.9.0: the rules of the games, kept apart from the UI so that both
// computers in a match run exactly the same code. Every game is a list of
// moves (strings) replayed from the start; a position is never sent, only
// the moves, so a step that arrives late or twice can't put the boards out
// of step. Pass-and-play and LAN matches share these rules.
//
// Loaded on demand (it pulls in the chess rules library), never at start-up.

import { Chess, type Square } from "chess.js";

export type GameId = "tictactoe" | "connect4" | "reversi" | "chess";

/** How a game stands after its moves: still on, or over and who won. */
export interface Outcome {
  over: boolean;
  /** 0 = the player who moved first this round, 1 = the other; null for a draw or an unfinished game. */
  winner: 0 | 1 | null;
  draw: boolean;
  reason: string;
}

const ON: Outcome = { over: false, winner: null, draw: false, reason: "" };
const win = (winner: 0 | 1, reason: string): Outcome => ({ over: true, winner, draw: false, reason });
const draw = (reason: string): Outcome => ({ over: true, winner: null, draw: true, reason });

// ---------------------------------------------------------------- tic-tac-toe
// Moves: "0".."8" (cell, left to right, top to bottom). Player 0 is X.

export type Cell = 0 | 1 | null;
const TTT_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

export function tttBoard(moves: string[]): Cell[] {
  const b: Cell[] = Array(9).fill(null);
  moves.forEach((m, i) => {
    b[Number(m)] = (i % 2) as 0 | 1;
  });
  return b;
}

export function tttLine(b: Cell[]): number[] | null {
  for (const l of TTT_LINES) if (b[l[0]] !== null && b[l[0]] === b[l[1]] && b[l[1]] === b[l[2]]) return l;
  return null;
}

function tttValid(moves: string[]): boolean {
  const b: Cell[] = Array(9).fill(null);
  for (let i = 0; i < moves.length; i++) {
    const c = Number(moves[i]);
    if (!Number.isInteger(c) || c < 0 || c > 8 || b[c] !== null) return false;
    if (tttLine(b)) return false; // the game was already over
    b[c] = (i % 2) as 0 | 1;
  }
  return true;
}

function tttOutcome(moves: string[]): Outcome {
  const b = tttBoard(moves);
  const l = tttLine(b);
  if (l) return win(b[l[0]] as 0 | 1, "three in a row");
  if (moves.length === 9) return draw("the board is full");
  return ON;
}

// ---------------------------------------------------------------- Connect Four
// Moves: "0".."6" (the column a disc is dropped in). Grid rows top→bottom.

export const C4_ROWS = 6;
export const C4_COLS = 7;

export function c4Grid(moves: string[]): Cell[][] {
  const g: Cell[][] = Array.from({ length: C4_ROWS }, () => Array(C4_COLS).fill(null));
  moves.forEach((m, i) => {
    const col = Number(m);
    for (let r = C4_ROWS - 1; r >= 0; r--) {
      if (g[r][col] === null) {
        g[r][col] = (i % 2) as 0 | 1;
        break;
      }
    }
  });
  return g;
}

export function c4WinCells(g: Cell[][]): [number, number][] | null {
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let r = 0; r < C4_ROWS; r++) {
    for (let c = 0; c < C4_COLS; c++) {
      const p = g[r][c];
      if (p === null) continue;
      for (const [dr, dc] of dirs) {
        const cells: [number, number][] = [[r, c]];
        for (let k = 1; k < 4; k++) {
          const rr = r + dr * k;
          const cc = c + dc * k;
          if (rr < 0 || rr >= C4_ROWS || cc < 0 || cc >= C4_COLS || g[rr][cc] !== p) break;
          cells.push([rr, cc]);
        }
        if (cells.length === 4) return cells;
      }
    }
  }
  return null;
}

function c4Valid(moves: string[]): boolean {
  const heights = Array(C4_COLS).fill(0);
  const g: Cell[][] = Array.from({ length: C4_ROWS }, () => Array(C4_COLS).fill(null));
  for (let i = 0; i < moves.length; i++) {
    const col = Number(moves[i]);
    if (!Number.isInteger(col) || col < 0 || col >= C4_COLS || heights[col] >= C4_ROWS) return false;
    if (c4WinCells(g)) return false;
    g[C4_ROWS - 1 - heights[col]][col] = (i % 2) as 0 | 1;
    heights[col]++;
  }
  return true;
}

function c4Outcome(moves: string[]): Outcome {
  const g = c4Grid(moves);
  const cells = c4WinCells(g);
  if (cells) return win(g[cells[0][0]][cells[0][1]] as 0 | 1, "four in a row");
  if (moves.length === C4_ROWS * C4_COLS) return draw("the board is full");
  return ON;
}

// ---------------------------------------------------------------- Reversi
// Moves: "0".."63" (cell) or "p" (pass, only when there is no legal move).
// Player 0 is black and starts. 8×8, cell = row * 8 + col.

export type RCell = 0 | 1 | -1;
const R_DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

export function reversiStart(): RCell[] {
  const b: RCell[] = Array(64).fill(-1);
  b[27] = 1;
  b[28] = 0;
  b[35] = 0;
  b[36] = 1;
  return b;
}

/** The discs a move at `cell` would flip for `player` (empty = not allowed). */
export function reversiFlips(b: RCell[], cell: number, player: 0 | 1): number[] {
  if (cell < 0 || cell > 63 || b[cell] !== -1) return [];
  const r0 = Math.floor(cell / 8);
  const c0 = cell % 8;
  const out: number[] = [];
  for (const [dr, dc] of R_DIRS) {
    const line: number[] = [];
    let r = r0 + dr;
    let c = c0 + dc;
    while (r >= 0 && r < 8 && c >= 0 && c < 8 && b[r * 8 + c] === 1 - player) {
      line.push(r * 8 + c);
      r += dr;
      c += dc;
    }
    if (line.length && r >= 0 && r < 8 && c >= 0 && c < 8 && b[r * 8 + c] === player) out.push(...line);
  }
  return out;
}

export function reversiLegal(b: RCell[], player: 0 | 1): number[] {
  const out: number[] = [];
  for (let i = 0; i < 64; i++) if (b[i] === -1 && reversiFlips(b, i, player).length) out.push(i);
  return out;
}

/** Replays the moves; null when one of them is not allowed. */
export function reversiBoard(moves: string[]): RCell[] | null {
  const b = reversiStart();
  for (let i = 0; i < moves.length; i++) {
    const player = (i % 2) as 0 | 1;
    const legal = reversiLegal(b, player);
    if (moves[i] === "p") {
      if (legal.length) return null; // you may only pass with no move
      if (!reversiLegal(b, (1 - player) as 0 | 1).length) return null; // game already over
      continue;
    }
    const cell = Number(moves[i]);
    if (!legal.includes(cell)) return null;
    for (const f of reversiFlips(b, cell, player)) b[f] = player;
    b[cell] = player;
  }
  return b;
}

export function reversiCount(b: RCell[]): [number, number] {
  let a = 0;
  let w = 0;
  for (const x of b) {
    if (x === 0) a++;
    else if (x === 1) w++;
  }
  return [a, w];
}

function reversiOutcome(moves: string[]): Outcome {
  const b = reversiBoard(moves);
  if (!b) return ON;
  const next = (moves.length % 2) as 0 | 1;
  if (reversiLegal(b, next).length || reversiLegal(b, (1 - next) as 0 | 1).length) return ON;
  const [black, white] = reversiCount(b);
  if (black === white) return draw(`${black} discs each`);
  return win(black > white ? 0 : 1, `${Math.max(black, white)} discs to ${Math.min(black, white)}`);
}

// ---------------------------------------------------------------- Chess
// Moves: standard notation ("e4", "Nf3", "O-O", "exd8=Q"). Player 0 is white.

export function chessGame(moves: string[]): Chess | null {
  const c = new Chess();
  for (const m of moves) {
    try {
      c.move(m);
    } catch {
      return null;
    }
  }
  return c;
}

/** The notation for moving from `from` to `to` (queen when a pawn promotes), or null. */
export function chessSan(moves: string[], from: Square, to: Square): string | null {
  const c = chessGame(moves);
  if (!c) return null;
  try {
    const mv = c.move({ from, to, promotion: "q" });
    return mv ? mv.san : null;
  } catch {
    return null;
  }
}

export function chessTargets(moves: string[], from: Square): Square[] {
  const c = chessGame(moves);
  if (!c) return [];
  return c.moves({ square: from, verbose: true }).map((m) => m.to as Square);
}

function chessOutcome(moves: string[]): Outcome {
  const c = chessGame(moves);
  if (!c) return ON;
  if (c.isCheckmate()) return win(((moves.length - 1) % 2) as 0 | 1, "checkmate");
  if (c.isStalemate()) return draw("stalemate");
  if (c.isThreefoldRepetition()) return draw("the same position three times");
  if (c.isInsufficientMaterial()) return draw("not enough pieces to mate");
  if (c.isDrawByFiftyMoves()) return draw("fifty moves without progress");
  if (c.isDraw()) return draw("a draw");
  return ON;
}

// ---------------------------------------------------------------- shared

/** True when every move is allowed, in order, from the start. */
export function validateMoves(game: GameId, moves: string[]): boolean {
  if (moves.length > 400) return false;
  switch (game) {
    case "tictactoe":
      return tttValid(moves);
    case "connect4":
      return c4Valid(moves);
    case "reversi":
      return reversiBoard(moves) !== null;
    case "chess":
      return chessGame(moves) !== null;
    default:
      return false;
  }
}

export function outcome(game: GameId, moves: string[]): Outcome {
  switch (game) {
    case "tictactoe":
      return tttOutcome(moves);
    case "connect4":
      return c4Outcome(moves);
    case "reversi":
      return reversiOutcome(moves);
    case "chess":
      return chessOutcome(moves);
    default:
      return ON;
  }
}

/** Whose turn it is: 0 or 1 (after a Reversi pass the other player goes on). */
export const turnOf = (moves: string[]): 0 | 1 => (moves.length % 2) as 0 | 1;
