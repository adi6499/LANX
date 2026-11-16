// Mahjong Duels: 72 tiles (36 kinds, two of each) laid out in eight rows of
// nine. A tile is free when its left or right side is open. On your turn
// take a free matching pair. LANX 3.16.0: a pair of winds or dragons counts two
// points, any other pair one, and the table is shuffled again whenever no pair
// is free, until it is cleared; most points wins. (Every pair used to count the
// same and the game stopped when it got stuck, so the result followed the seat
// order: only the first player could win.) 2–4 players.
// Moves: "a,b" (two tiles) or "p" to pass.
// LANX 2.17.0: "x<p>" — player p left: skipped from then on, can't win; the
// last one left wins.

import { ON, draw, lastIn, leaver, nextIn, shuffled, win, type GameDef, type Outcome } from "./core.ts";

export const MJ_ROWS = 8;
export const MJ_COLS = 9;
const KINDS = ["🀀", "🀁", "🀂", "🀃", "🀄", "🀅", "🀆", "🀇", "🀈", "🀉", "🀊", "🀋", "🀌", "🀍", "🀎", "🀏", "🀐", "🀑", "🀒", "🀓", "🀔", "🀕", "🀖", "🀗", "🀘", "🀙", "🀚", "🀛", "🀜", "🀝", "🀞", "🀟", "🀠", "🀡", "🀢", "🀣"];

/** Winds and dragons: their pairs count double. */
const HONOURS = new Set(KINDS.slice(0, 7));
export const mjValue = (face: string | null | undefined): number => (face && HONOURS.has(face) ? 2 : 1);

export interface MahjongState {
  tiles: (string | null)[];
  scores: number[];
  turn: number;
  /** Players who passed in a row. */
  passes: number;
  last: number[];
  /** Times the table was reshuffled because no pair was free. */
  reshuffles: number;
  /** LANX 2.17.0: players who left. */
  out: boolean[];
}

/** (Two tiles alone are always a free pair, so a table always clears; the cap only guards the loop.) */
const MAX_RESHUFFLES = 60;

/** With no free pair left, the remaining tiles are shuffled in place (the same way on every PC). */
function reshuffleIfStuck(s: MahjongState, seed: string) {
  while (s.reshuffles < MAX_RESHUFFLES && mjPairs(s.tiles).length === 0 && s.tiles.some((t) => t !== null)) {
    const spots = s.tiles.map((t, i) => (t !== null ? i : -1)).filter((i) => i >= 0);
    const faces = shuffled(spots.map((i) => s.tiles[i]!), `${seed}#reshuffle${s.reshuffles}`);
    spots.forEach((i, k) => {
      s.tiles[i] = faces[k];
    });
    s.reshuffles++;
  }
}

export function mjFree(tiles: (string | null)[], i: number): boolean {
  if (tiles[i] === null) return false;
  const c = i % MJ_COLS;
  const left = c === 0 || tiles[i - 1] === null;
  const right = c === MJ_COLS - 1 || tiles[i + 1] === null;
  return left || right;
}

export function mjPairs(tiles: (string | null)[]): [number, number][] {
  const free = tiles.map((t, i) => (t !== null && mjFree(tiles, i) ? i : -1)).filter((i) => i >= 0);
  const out: [number, number][] = [];
  for (let a = 0; a < free.length; a++) for (let b = a + 1; b < free.length; b++) if (tiles[free[a]] === tiles[free[b]]) out.push([free[a], free[b]]);
  return out;
}

const stuck = (s: MahjongState) => mjPairs(s.tiles).length === 0;

function outcome(s: MahjongState, n: number): Outcome {
  const alone = lastIn(s.out, n);
  if (alone !== null) return win(alone, "everyone else left", s.scores);
  if (!stuck(s) && s.passes < s.out.filter((o) => !o).length) return ON;
  const best = Math.max(...s.scores.filter((_x, i) => !s.out[i]));
  const tops = s.scores.map((x, i) => (x === best && !s.out[i] ? i : -1)).filter((i) => i >= 0);
  return tops.length > 1 ? draw(`${best} points each`, s.scores, tops) : win(tops[0], `${best} points`, s.scores);
}

export const mahjong: GameDef<MahjongState> = {
  id: "mahjong",
  name: "Mahjong Duels",
  blurb: "Take free matching tiles in turn; winds and dragons count double. Most points wins.",
  emoji: "🀄",
  minPlayers: 2,
  maxPlayers: 4,
  replay(moves, n, seed) {
    const s: MahjongState = { tiles: shuffled([...KINDS, ...KINDS], seed), scores: Array(n).fill(0), turn: 0, passes: 0, last: [], reshuffles: 0, out: Array(n).fill(false) };
    reshuffleIfStuck(s, seed);
    for (const m of moves) {
      if (outcome(s, n).over) return null;
      const p = leaver(m, n);
      if (p !== null) {
        if (p < 0 || s.out[p]) return null;
        s.out[p] = true;
        if (s.turn === p) s.turn = nextIn(p, n, s.out);
        continue;
      }
      if (m === "p") {
        if (mjPairs(s.tiles).length) return null; // you may only pass with no pair on the table
        s.passes++;
        s.turn = nextIn(s.turn, n, s.out);
        s.last = [];
        continue;
      }
      const mm = /^(\d+),(\d+)$/.exec(m);
      if (!mm) return null;
      const a = Number(mm[1]);
      const b = Number(mm[2]);
      // (Tile numbers off the table are refused: one far outside it used to be taken, and made every PC work for minutes.)
      if (a >= s.tiles.length || b >= s.tiles.length) return null;
      if (a === b || !mjFree(s.tiles, a) || !mjFree(s.tiles, b) || s.tiles[a] !== s.tiles[b]) return null;
      s.scores[s.turn] += mjValue(s.tiles[a]);
      s.tiles[a] = null;
      s.tiles[b] = null;
      s.last = [a, b];
      s.passes = 0;
      s.turn = nextIn(s.turn, n, s.out);
      reshuffleIfStuck(s, seed);
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome,
  summary: (s) => s.scores.map((x, i) => `P${i + 1} ${x}${s.out[i] ? " (left)" : ""}`).join(" · ") + (s.reshuffles ? ` · reshuffled ${s.reshuffles}×` : ""),
};
