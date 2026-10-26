// LANX 2.9.0: the rules of the games, kept apart from the UI so that every
// computer in a match runs exactly the same code. A game is a list of moves
// (strings) replayed from the start; a position is never sent, only the
// moves, so a step that arrives late or twice can't put the boards out of
// step. Pass-and-play and LAN matches share these rules.
//
// Players are numbered from 0 in the order they move in the round (0 moved
// first). The match layer maps those numbers to seats (people).
//
// Loaded on demand (it pulls in the chess rules library), never at start-up.

import { Chess, type Square } from "chess.js";

export type GameId = "tictactoe" | "connect4" | "reversi" | "chess" | "chainreaction";

/** How a game stands after its moves: still on, or over and who won. */
export interface Outcome {
  over: boolean;
  /** The winner's player number (0 = moved first this round), null for a draw or an unfinished game. */
  winner: number | null;
  draw: boolean;
  reason: string;
}

const ON: Outcome = { over: false, winner: null, draw: false, reason: "" };
const win = (winner: number, reason: string): Outcome => ({ over: true, winner, draw: false, reason });
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

// ---------------------------------------------------------------- Chain Reaction
// Any number of players (2.10.0). Moves: "0".."53" (cell = row * 9 + col), or
// "x<player>" when a player leaves (their orbs vanish and the turn passes on).
// You may only place an orb in an empty cell or one you own. A cell explodes
// when it holds as many orbs as it has neighbours (2 in a corner, 3 on an
// edge, 4 inside): one orb goes to each neighbour, which becomes yours — and
// may explode in turn. A player who has moved and has no orbs left is out;
// the last one in wins.

export const CR_ROWS = 6;
export const CR_COLS = 9;
export interface CRCell {
  owner: number | null;
  n: number;
}
export type CRBoard = CRCell[];

/** Everything about a Chain Reaction game after its moves. */
export interface CRState {
  board: CRBoard;
  /** Per player: out of the game (wiped out or left). */
  out: boolean[];
  /** Per player: has placed at least one orb. */
  moved: boolean[];
  /** Who moves next. */
  turn: number;
  /** Orbs per player. */
  counts: number[];
}

/** How many orbs make a cell explode: its number of neighbours. */
export const crCritical = (i: number): number => {
  const r = Math.floor(i / CR_COLS);
  const c = i % CR_COLS;
  return 4 - (r === 0 || r === CR_ROWS - 1 ? 1 : 0) - (c === 0 || c === CR_COLS - 1 ? 1 : 0);
};

function crNeighbours(i: number): number[] {
  const r = Math.floor(i / CR_COLS);
  const c = i % CR_COLS;
  const out: number[] = [];
  if (r > 0) out.push(i - CR_COLS);
  if (r < CR_ROWS - 1) out.push(i + CR_COLS);
  if (c > 0) out.push(i - 1);
  if (c < CR_COLS - 1) out.push(i + 1);
  return out;
}

export const crEmpty = (): CRBoard => Array.from({ length: CR_ROWS * CR_COLS }, () => ({ owner: null, n: 0 }));

export function crCounts(b: CRBoard, n: number): number[] {
  const out = Array(n).fill(0);
  for (const c of b) if (c.owner !== null && c.owner < n) out[c.owner] += c.n;
  return out;
}

/** Places an orb for `player`: the boards right after placing and after each
 *  wave of explosions (the last one is the result), or null when not allowed. */
export function crPlace(b: CRBoard, cell: number, player: number): CRBoard[] | null {
  if (!Number.isInteger(cell) || cell < 0 || cell >= b.length) return null;
  if (b[cell].owner !== null && b[cell].owner !== player) return null;
  let cur = b.map((c) => ({ ...c }));
  cur[cell] = { owner: player, n: cur[cell].n + 1 };
  const waves = [cur];
  for (let guard = 0; guard < 400; guard++) {
    const hot: number[] = [];
    cur.forEach((c, i) => {
      if (c.n >= crCritical(i)) hot.push(i);
    });
    if (!hot.length) break;
    const next = cur.map((c) => ({ ...c }));
    for (const i of hot) {
      next[i].n -= crCritical(i);
      if (next[i].n === 0) next[i].owner = null;
      for (const j of crNeighbours(i)) {
        next[j].n += 1;
        next[j].owner = player;
      }
    }
    cur = next;
    waves.push(cur);
    if (!cur.some((c) => c.owner !== null && c.owner !== player)) break; // nobody else left on the board: won
  }
  return waves;
}

function crNextTurn(from: number, n: number, out: boolean[]): number {
  let p = from;
  for (let k = 0; k < n; k++) {
    p = (p + 1) % n;
    if (!out[p]) return p;
  }
  return from;
}

/** The winner once only one player is left in (and everyone else is out), else null. */
function crWinnerOf(out: boolean[], moved: boolean[], n: number): number | null {
  const alive: number[] = [];
  for (let p = 0; p < n; p++) if (!out[p]) alive.push(p);
  if (alive.length !== 1 || n < 2) return null;
  // Everyone else is out only once they have had a go (or left).
  for (let p = 0; p < n; p++) if (!out[p] && !moved[p] && p !== alive[0]) return null;
  return alive[0];
}

/** Replays the moves for `n` players; null when one of them is not allowed. */
export function crReplay(moves: string[], n: number): CRState | null {
  let board = crEmpty();
  const out: boolean[] = Array(n).fill(false);
  const moved: boolean[] = Array(n).fill(false);
  let turn = 0;
  for (let i = 0; i < moves.length; i++) {
    if (crWinnerOf(out, moved, n) !== null) return null; // the game was already over
    const mv = moves[i];
    if (mv.startsWith("x")) {
      const p = Number(mv.slice(1));
      if (!Number.isInteger(p) || p < 0 || p >= n || out[p]) return null;
      out[p] = true;
      moved[p] = true;
      board = board.map((c) => (c.owner === p ? { owner: null, n: 0 } : c));
      if (turn === p) turn = crNextTurn(p, n, out);
      continue;
    }
    const waves = crPlace(board, Number(mv), turn);
    if (!waves) return null;
    board = waves[waves.length - 1];
    moved[turn] = true;
    const counts = crCounts(board, n);
    for (let p = 0; p < n; p++) if (!out[p] && moved[p] && counts[p] === 0) out[p] = true;
    turn = crNextTurn(turn, n, out);
  }
  return { board, out, moved, turn, counts: crCounts(board, n) };
}

function crOutcome(moves: string[], n: number): Outcome {
  const s = crReplay(moves, n);
  if (!s) return ON;
  const w = crWinnerOf(s.out, s.moved, n);
  if (w === null) return ON;
  return win(w, n > 2 ? "the last one standing" : "the board is all one colour");
}

// ---------------------------------------------------------------- shared

/** True when every move is allowed, in order, from the start. `n` players (2 unless Chain Reaction). */
export function validateMoves(game: GameId, moves: string[], n = 2): boolean {
  if (moves.length > 600) return false;
  switch (game) {
    case "tictactoe":
      return tttValid(moves);
    case "connect4":
      return c4Valid(moves);
    case "reversi":
      return reversiBoard(moves) !== null;
    case "chess":
      return chessGame(moves) !== null;
    case "chainreaction":
      return crReplay(moves, n) !== null;
    default:
      return false;
  }
}

export function outcome(game: GameId, moves: string[], n = 2): Outcome {
  switch (game) {
    case "tictactoe":
      return tttOutcome(moves);
    case "connect4":
      return c4Outcome(moves);
    case "reversi":
      return reversiOutcome(moves);
    case "chess":
      return chessOutcome(moves);
    case "chainreaction":
      return crOutcome(moves, n);
    default:
      return ON;
  }
}

/** Whose turn it is (player number). After a Reversi pass or a Chain Reaction knock-out the next one in goes on. */
export function turnOf(game: GameId, moves: string[], n = 2): number {
  if (game === "chainreaction") return crReplay(moves, n)?.turn ?? 0;
  return moves.length % 2;
}
