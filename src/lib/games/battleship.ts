// Sea Battle (Battleship): each player hides five ships (5, 4, 3, 3, 2) on a
// 10×10 grid, then they take turns calling a square. Where the ships are
// stays on each player's own PC: only the shots and the answers (miss, hit,
// sunk) travel. Seventeen hits win.
//
// Moves: "<player>@ready" once a player has placed (any order), then "f:<cell>"
// by the one to fire and "a:<cell>:<m|h|s>" by the other in answer; after an
// answer the answerer fires next.

import { ON, win, type GameDef, type Outcome } from "./core.ts";

export const SEA = 10;
export const SHIPS = [5, 4, 3, 3, 2];
export const HITS_TO_WIN = SHIPS.reduce((a, b) => a + b, 0);

export interface BattleshipState {
  ready: boolean[];
  /** What each player knows of the other's sea: "m" | "h" | "s" per cell, or "". */
  known: string[][];
  hits: number[];
  /** Who acts next: -1 while placing, else the player to fire or to answer. */
  turn: number;
  /** A shot waiting for its answer, or -1. */
  pending: number;
  /** Who fired the pending shot. */
  shooter: number;
  winner: number | null;
}

function outcome(s: BattleshipState): Outcome {
  return s.winner !== null ? win(s.winner, "every ship sunk") : ON;
}

export const battleship: GameDef<BattleshipState> = {
  id: "battleship",
  name: "Sea Battle",
  blurb: "Hide your fleet, call the squares, sink theirs first.",
  emoji: "🚢",
  minPlayers: 2,
  maxPlayers: 2,
  replay(moves) {
    const s: BattleshipState = { ready: [false, false], known: [Array(100).fill(""), Array(100).fill("")], hits: [0, 0], turn: -1, pending: -1, shooter: 0, winner: null };
    for (const m of moves) {
      if (s.winner !== null) return null;
      const readyAt = /^([01])@ready$/.exec(m);
      if (readyAt) {
        const p = Number(readyAt[1]);
        if (s.ready[p]) return null;
        s.ready[p] = true;
        if (s.ready[0] && s.ready[1]) s.turn = 0;
        continue;
      }
      if (!(s.ready[0] && s.ready[1])) return null;
      const fire = /^f:(\d+)$/.exec(m);
      if (fire) {
        const cell = Number(fire[1]);
        if (s.pending >= 0 || cell < 0 || cell >= 100 || s.known[s.turn][cell] !== "") return null;
        s.pending = cell;
        s.shooter = s.turn;
        s.turn = 1 - s.turn; // the other answers
        continue;
      }
      const ans = /^a:(\d+):([mhs])$/.exec(m);
      if (ans) {
        const cell = Number(ans[1]);
        if (s.pending !== cell) return null;
        s.known[s.shooter][cell] = ans[2];
        if (ans[2] !== "m") s.hits[s.shooter]++;
        if (s.hits[s.shooter] >= HITS_TO_WIN) s.winner = s.shooter;
        s.pending = -1;
        // The answerer fires next (s.turn is already the answerer).
        continue;
      }
      return null;
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s) => outcome(s),
  summary: (s) => `hits ${s.hits[0]} · ${s.hits[1]} of ${HITS_TO_WIN}`,
};

// ---------------------------------------------------------------- the hidden fleet (kept on each PC)

export type Fleet = { cells: number[]; len: number }[];

export function fleetCells(f: Fleet): Set<number> {
  const out = new Set<number>();
  for (const ship of f) for (const c of ship.cells) out.add(c);
  return out;
}

/** Can a ship of `len` go at `start` (cell) in this direction without touching another? */
export function canPlace(f: Fleet, start: number, len: number, horizontal: boolean): number[] | null {
  const r = Math.floor(start / SEA);
  const c = start % SEA;
  if (horizontal ? c + len > SEA : r + len > SEA) return null;
  const cells = Array.from({ length: len }, (_, k) => (horizontal ? start + k : start + k * SEA));
  const taken = fleetCells(f);
  for (const x of cells) {
    const xr = Math.floor(x / SEA);
    const xc = x % SEA;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const rr = xr + dr;
        const cc = xc + dc;
        if (rr >= 0 && rr < SEA && cc >= 0 && cc < SEA && taken.has(rr * SEA + cc)) return null;
      }
  }
  return cells;
}

/** A random fleet (for "place for me"). */
export function randomFleet(seed: number): Fleet {
  let x = seed >>> 0 || 7;
  const next = () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
  for (let attempt = 0; attempt < 50; attempt++) {
    const f: Fleet = [];
    let ok = true;
    for (const len of SHIPS) {
      let placed = false;
      for (let k = 0; k < 200 && !placed; k++) {
        const cells = canPlace(f, Math.floor(next() * 100), len, next() < 0.5);
        if (cells) {
          f.push({ cells, len });
          placed = true;
        }
      }
      if (!placed) {
        ok = false;
        break;
      }
    }
    if (ok) return f;
  }
  return [];
}

/** The answer to a shot at `cell` against this fleet, given the squares already hit. */
export function answerShot(f: Fleet, cell: number, hitsSoFar: Set<number>): "m" | "h" | "s" {
  const ship = f.find((sh) => sh.cells.includes(cell));
  if (!ship) return "m";
  const allHit = ship.cells.every((c) => c === cell || hitsSoFar.has(c));
  return allHit ? "s" : "h";
}
