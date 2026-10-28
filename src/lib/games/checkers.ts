// Checkers (English draughts), two players on the dark squares of an 8×8
// board. Men move one step diagonally forward and capture by jumping; a
// capture is compulsory and continues with the same piece while it can; a
// man that reaches the far row becomes a king and moves both ways. You lose
// when you have no pieces or no move. Player 0 (red) starts at the bottom.
//
// Moves: "from-to" or "from-to-to…" for a multi-jump, squares 0..63.

import { ON, draw, win, type GameDef, type Outcome } from "./core.ts";

export interface Piece {
  p: 0 | 1;
  king: boolean;
}
export interface CheckersState {
  cells: (Piece | null)[];
  turn: number;
  /** Moves without a capture or a man's move (a long run ends in a draw). */
  quiet: number;
}

const SIZE = 8;
const dark = (i: number) => (Math.floor(i / SIZE) + (i % SIZE)) % 2 === 1;

function start(): (Piece | null)[] {
  const cells: (Piece | null)[] = Array(64).fill(null);
  for (let i = 0; i < 64; i++) {
    if (!dark(i)) continue;
    const r = Math.floor(i / SIZE);
    if (r <= 2) cells[i] = { p: 1, king: false };
    else if (r >= 5) cells[i] = { p: 0, king: false };
  }
  return cells;
}

const dirsFor = (piece: Piece): [number, number][] => (piece.king ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] : piece.p === 0 ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]]);
const at = (r: number, c: number) => (r >= 0 && r < SIZE && c >= 0 && c < SIZE ? r * SIZE + c : -1);

/** All jump sequences for the piece at `from` (each a list of landing squares). */
function jumps(cells: (Piece | null)[], from: number, piece: Piece, taken: Set<number>): number[][] {
  const r = Math.floor(from / SIZE);
  const c = from % SIZE;
  const out: number[][] = [];
  for (const [dr, dc] of dirsFor(piece)) {
    const over = at(r + dr, c + dc);
    const land = at(r + 2 * dr, c + 2 * dc);
    if (over < 0 || land < 0 || taken.has(over)) continue;
    const mid = cells[over];
    if (!mid || mid.p === piece.p || cells[land] !== null) continue;
    const t = new Set(taken);
    t.add(over);
    // A man crowned mid-jump stops there.
    const crowned = !piece.king && ((piece.p === 0 && Math.floor(land / SIZE) === 0) || (piece.p === 1 && Math.floor(land / SIZE) === SIZE - 1));
    const further = crowned ? [] : jumps(cells, land, piece, t);
    if (further.length) for (const f of further) out.push([land, ...f]);
    else out.push([land]);
  }
  return out;
}

/** Every move the player may make right now, as move strings. */
export function checkersMoves(s: CheckersState): string[] {
  const player = s.turn as 0 | 1;
  const captures: string[] = [];
  const steps: string[] = [];
  s.cells.forEach((piece, from) => {
    if (!piece || piece.p !== player) return;
    // LANX 2.17.0: the piece leaves its square while it jumps, so a king can end a loop where it began.
    const lifted = [...s.cells];
    lifted[from] = null;
    for (const seq of jumps(lifted, from, piece, new Set())) captures.push([from, ...seq].join("-"));
    if (captures.length) return;
    const r = Math.floor(from / SIZE);
    const c = from % SIZE;
    for (const [dr, dc] of dirsFor(piece)) {
      const to = at(r + dr, c + dc);
      if (to >= 0 && s.cells[to] === null) steps.push(`${from}-${to}`);
    }
  });
  return captures.length ? captures : steps;
}

function apply(s: CheckersState, move: string): CheckersState | null {
  if (!checkersMoves(s).includes(move)) return null;
  const path = move.split("-").map(Number);
  const cells = s.cells.map((x) => (x ? { ...x } : null));
  const piece = cells[path[0]]!;
  cells[path[0]] = null;
  let captured = false;
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1];
    const b = path[k];
    if (Math.abs(Math.floor(a / SIZE) - Math.floor(b / SIZE)) === 2) {
      cells[(a + b) / 2] = null;
      captured = true;
    }
  }
  const to = path[path.length - 1];
  const crowned = !piece.king && ((piece.p === 0 && Math.floor(to / SIZE) === 0) || (piece.p === 1 && Math.floor(to / SIZE) === SIZE - 1));
  cells[to] = { p: piece.p, king: piece.king || crowned };
  return { cells, turn: 1 - s.turn, quiet: captured || !piece.king ? 0 : s.quiet + 1 };
}

function outcome(s: CheckersState): Outcome {
  const mine = s.cells.filter((x) => x && x.p === s.turn).length;
  const theirs = s.cells.filter((x) => x && x.p === 1 - s.turn).length;
  if (theirs === 0) return win(s.turn, "all pieces taken");
  if (mine === 0) return win(1 - s.turn, "all pieces taken");
  if (checkersMoves(s).length === 0) return win(1 - s.turn, "no move left");
  if (s.quiet >= 80) return draw("forty king moves each without a capture");
  return ON;
}

export const checkers: GameDef<CheckersState> = {
  id: "checkers",
  name: "Checkers",
  blurb: "Jump to capture; crown a king on the far row.",
  emoji: "🔴",
  minPlayers: 2,
  maxPlayers: 2,
  replay(moves) {
    let s: CheckersState = { cells: start(), turn: 0, quiet: 0 };
    for (const m of moves) {
      if (outcome(s).over) return null;
      const next = apply(s, m);
      if (!next) return null;
      s = next;
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s) => outcome(s),
  summary: (s) => `P1 (red) ${s.cells.filter((x) => x?.p === 0).length} · P2 (black) ${s.cells.filter((x) => x?.p === 1).length}`,
};

/** LANX 2.17.0: when more than one capture route fits what the player has clicked so far, the
 *  squares the routes share (start included) and where they part (the squares to pick from next). */
export function checkersRouteStep(routes: string[]): { path: number[]; next: number[] } {
  const paths = routes.map((m) => m.split("-").map(Number));
  if (!paths.length) return { path: [], next: [] };
  const path: number[] = [];
  for (let k = 0; ; k++) {
    const v = paths[0][k];
    if (v === undefined || paths.some((p) => p[k] !== v)) break;
    path.push(v);
  }
  const next = [...new Set(paths.map((p) => p[path.length]).filter((x) => x !== undefined))];
  return { path, next };
}
