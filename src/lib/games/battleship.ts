// Sea Battle (Battleship): each player hides five ships (5, 4, 3, 3, 2) on a
// 10×10 grid, then they take turns calling a square. Where the ships are
// stays on each player's own PC: only the shots and the answers (miss, hit,
// sunk) travel. Seventeen hits win.
//
// Moves: "<player>@ready" once a player has placed (any order), then "f:<cell>"
// by the one to fire and "a:<cell>:<m|h|s>" by the other in answer; after an
// answer the answerer fires next.
// LANX 2.17.0: a sinking answer may name the ship ("a:<cell>:s2" = the
// Cruiser), and every square of a sunk ship is marked sunk, not just the last.

import { ON, win, type GameDef, type Outcome } from "./core.ts";

export const SEA = 10;
export const SHIPS = [5, 4, 3, 3, 2];
export const SHIP_NAMES = ["Carrier", "Battleship", "Cruiser", "Submarine", "Destroyer"];
export const HITS_TO_WIN = SHIPS.reduce((a, b) => a + b, 0);

/** A ship that went down: which one (an index into SHIPS, -1 when unknown) and its squares. */
export interface Sunk {
  ship: number;
  cells: number[];
}

export interface BattleshipState {
  ready: boolean[];
  /** What each player knows of the other's sea: "m" | "h" | "s" per cell, or "". */
  known: string[][];
  /** The other player's ships each player has sunk, in order. */
  sunk: Sunk[][];
  /** The last ship that went down (by the shooter of the last answer), or null. */
  lastSunk: { shooter: number; ship: number } | null;
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
    const s: BattleshipState = { ready: [false, false], known: [Array(100).fill(""), Array(100).fill("")], sunk: [[], []], lastSunk: null, hits: [0, 0], turn: -1, pending: -1, shooter: 0, winner: null };
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
      const ans = /^a:(\d+):([mhs])([0-4])?$/.exec(m);
      if (ans) {
        const cell = Number(ans[1]);
        if (s.pending !== cell || (ans[3] !== undefined && ans[2] !== "s")) return null;
        const known = s.known[s.shooter];
        known[cell] = ans[2];
        s.lastSunk = null;
        if (ans[2] === "s") {
          // The ship is this square and the hits joined to it (ships never touch, so they are all its own).
          const cells = shipAt(known, cell);
          for (const c of cells) known[c] = "s";
          const gone = s.sunk[s.shooter];
          let ship = ans[3] !== undefined ? Number(ans[3]) : -1;
          if (ship < 0 || gone.some((g) => g.ship === ship)) ship = SHIPS.findIndex((len, k) => len === cells.length && !gone.some((g) => g.ship === k));
          gone.push({ ship, cells });
          s.lastSunk = { shooter: s.shooter, ship };
        }
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
  summary: (s) => `P1 ${s.hits[0]} · P2 ${s.hits[1]} hits of ${HITS_TO_WIN}`,
};

/** The squares of the ship hit at `cell`: it and the hits joined to it. */
function shipAt(known: string[], cell: number): number[] {
  const out: number[] = [];
  const seen = new Set<number>([cell]);
  const stack = [cell];
  while (stack.length) {
    const x = stack.pop()!;
    out.push(x);
    const r = Math.floor(x / SEA);
    const c = x % SEA;
    for (const [rr, cc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
      const y = rr * SEA + cc;
      if (rr < 0 || rr >= SEA || cc < 0 || cc >= SEA || seen.has(y) || known[y] !== "h") continue;
      seen.add(y);
      stack.push(y);
    }
  }
  return out.sort((a, b) => a - b);
}

/** A ship's name ("Cruiser"), or "ship" when it isn't known which. */
export const shipName = (k: number) => SHIP_NAMES[k] ?? "ship";

/** The other player's ships still afloat, as far as `shooter` knows (indexes into SHIPS). */
export function afloat(s: BattleshipState, shooter: number): number[] {
  const gone = s.sunk[shooter];
  const named = new Set(gone.map((g) => g.ship));
  return SHIPS.map((_len, k) => k).filter((k) => !named.has(k));
}

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

/** The answer to a shot at `cell` against this fleet, given the squares already hit: "m", "h", or
 *  "s<k>" when it sinks ship k (2.17.0 names the ship, so both captains see the same one go down). */
export function answerShot(f: Fleet, cell: number, hitsSoFar: Set<number>): string {
  const k = f.findIndex((sh) => sh.cells.includes(cell));
  if (k < 0) return "m";
  const allHit = f[k].cells.every((c) => c === cell || hitsSoFar.has(c));
  return allHit ? `s${shipIndex(f, k)}` : "h";
}

/** Which of SHIPS fleet[k] is (the fleet is placed in SHIPS order; a mixed-up fleet goes by length). */
function shipIndex(f: Fleet, k: number): number {
  if (f.length === SHIPS.length && f[k].len === SHIPS[k]) return k;
  const same = SHIPS.map((len, i) => (len === f[k].len ? i : -1)).filter((i) => i >= 0);
  const before = f.slice(0, k).filter((sh) => sh.len === f[k].len).length;
  return same[Math.min(before, same.length - 1)] ?? 0;
}

/** Why a ship of `len` can't go at `start`: "edge" (it would stick out) or "touch" (next to another ship), or null when it can. */
export function placeProblem(f: Fleet, start: number, len: number, horizontal: boolean): "edge" | "touch" | null {
  const r = Math.floor(start / SEA);
  const c = start % SEA;
  if (horizontal ? c + len > SEA : r + len > SEA) return "edge";
  return canPlace(f, start, len, horizontal) ? null : "touch";
}
