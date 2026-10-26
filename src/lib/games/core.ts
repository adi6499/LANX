// LANX 2.11.0: the shape every game shares, so a new game is one rules file
// and one board file. Rules are a pure replay of the move list (plus a seed
// for dice and shuffles), the same on every PC, so boards never drift.

export interface Outcome {
  over: boolean;
  /** The winning player number (0 = moved first this round), null for a draw or an unfinished game. */
  winner: number | null;
  draw: boolean;
  reason: string;
  /** Points per player, for games that keep score. */
  scores?: number[];
}

export const ON: Outcome = { over: false, winner: null, draw: false, reason: "" };
export const win = (winner: number, reason: string, scores?: number[]): Outcome => ({ over: true, winner, draw: false, reason, scores });
export const draw = (reason: string, scores?: number[]): Outcome => ({ over: true, winner: null, draw: true, reason, scores });

/** A game: its rules over the move list, and what the lobby needs to know. */
export interface GameDef<S = unknown> {
  id: string;
  name: string;
  blurb: string;
  emoji: string;
  minPlayers: number;
  maxPlayers: number;
  /** Run through a host even with two players (rounds with timers, private deals). */
  hosted?: boolean;
  /** Replays the moves for `n` players; null when a move is not allowed. */
  replay(moves: string[], n: number, seed: string): S | null;
  /** The player number to move next, or -1 when anyone may act (timed rounds). */
  turn(s: S, n: number): number;
  outcome(s: S, n: number): Outcome;
  /** Words under the status line, e.g. the score. */
  summary?(s: S, n: number): string;
}

// ---------------------------------------------------------------- seeded randomness
// Dice and shuffles come from the match id and the round, so every PC rolls
// the same dice without sending them. (Anyone who read the code could work
// the next roll out — fair enough among colleagues.)

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0 || 0x9e3779b9;
}

/** A small, fast random generator: the same seed gives the same numbers everywhere. */
export function rng(seed: string | number): () => number {
  let x = typeof seed === "number" ? seed >>> 0 || 1 : hashSeed(seed);
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
}

export function shuffled<T>(items: T[], seed: string | number): T[] {
  const out = [...items];
  const next = rng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Scrambles the bits well, so neighbouring seeds give unrelated numbers. */
function fmix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** One die (1–6) per call, from the seed and how many were rolled before.
 *  Each roll gets its own well-scrambled seed, so roll 3 says nothing about roll 4. */
export function dice(seed: string, index: number, sides = 6): number {
  const next = rng(fmix(hashSeed(seed) ^ Math.imul(index + 1, 0x9e3779b9)) || 0x27d4eb2f);
  next();
  return 1 + Math.floor(next() * sides);
}

// ---------------------------------------------------------------- grids

export const idx = (r: number, c: number, cols: number) => r * cols + c;
export const rowOf = (i: number, cols: number) => Math.floor(i / cols);
export const colOf = (i: number, cols: number) => i % cols;
export const inGrid = (r: number, c: number, rows: number, cols: number) => r >= 0 && r < rows && c >= 0 && c < cols;

/** Up/down/left/right neighbours. */
export function orthogonal(i: number, rows: number, cols: number): number[] {
  const r = rowOf(i, cols);
  const c = colOf(i, cols);
  const out: number[] = [];
  if (r > 0) out.push(i - cols);
  if (r < rows - 1) out.push(i + cols);
  if (c > 0) out.push(i - 1);
  if (c < cols - 1) out.push(i + 1);
  return out;
}

/** The longest line of `who` through cell `i` in any of the four directions. */
export function longestLine(cells: (number | null)[], i: number, who: number, rows: number, cols: number): number {
  const r0 = rowOf(i, cols);
  const c0 = colOf(i, cols);
  let best = 1;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    let len = 1;
    for (const sign of [1, -1]) {
      let r = r0 + dr * sign;
      let c = c0 + dc * sign;
      while (inGrid(r, c, rows, cols) && cells[idx(r, c, cols)] === who) {
        len++;
        r += dr * sign;
        c += dc * sign;
      }
    }
    best = Math.max(best, len);
  }
  return best;
}

export const num = (s: string): number | null => (/^-?\d+$/.test(s) ? Number(s) : null);
export const nextPlayer = (p: number, n: number) => (p + 1) % n;
