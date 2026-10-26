// Mahjong Duels: 72 tiles (36 kinds, two of each) laid out in eight rows of
// nine. A tile is free when its left or right side is open. On your turn
// take a free matching pair (a point) — or pass if there is none for you.
// The game ends when nobody can take a pair; most pairs wins. 2–4 players.
// Moves: "a,b" (two tiles) or "p" to pass.

import { ON, draw, shuffled, win, type GameDef, type Outcome } from "./core.ts";

export const MJ_ROWS = 8;
export const MJ_COLS = 9;
const KINDS = ["🀀", "🀁", "🀂", "🀃", "🀄", "🀅", "🀆", "🀇", "🀈", "🀉", "🀊", "🀋", "🀌", "🀍", "🀎", "🀏", "🀐", "🀑", "🀒", "🀓", "🀔", "🀕", "🀖", "🀗", "🀘", "🀙", "🀚", "🀛", "🀜", "🀝", "🀞", "🀟", "🀠", "🀡", "🀢", "🀣"];

export interface MahjongState {
  tiles: (string | null)[];
  scores: number[];
  turn: number;
  /** Players who passed in a row. */
  passes: number;
  last: number[];
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
  if (!stuck(s) && s.passes < n) return ON;
  const best = Math.max(...s.scores);
  const tops = s.scores.map((x, i) => (x === best ? i : -1)).filter((i) => i >= 0);
  return tops.length > 1 ? draw(`${best} pairs each`, s.scores) : win(tops[0], `${best} pairs`, s.scores);
}

export const mahjong: GameDef<MahjongState> = {
  id: "mahjong",
  name: "Mahjong Duels",
  blurb: "Take free matching tiles in turn; most pairs wins.",
  emoji: "🀄",
  minPlayers: 2,
  maxPlayers: 4,
  replay(moves, n, seed) {
    const s: MahjongState = { tiles: shuffled([...KINDS, ...KINDS], seed), scores: Array(n).fill(0), turn: 0, passes: 0, last: [] };
    for (const m of moves) {
      if (outcome(s, n).over) return null;
      if (m === "p") {
        if (mjPairs(s.tiles).length) return null; // you may only pass with no pair on the table
        s.passes++;
        s.turn = (s.turn + 1) % n;
        s.last = [];
        continue;
      }
      const mm = /^(\d+),(\d+)$/.exec(m);
      if (!mm) return null;
      const a = Number(mm[1]);
      const b = Number(mm[2]);
      if (a === b || !mjFree(s.tiles, a) || !mjFree(s.tiles, b) || s.tiles[a] !== s.tiles[b]) return null;
      s.tiles[a] = null;
      s.tiles[b] = null;
      s.scores[s.turn]++;
      s.last = [a, b];
      s.passes = 0;
      s.turn = (s.turn + 1) % n;
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome,
  summary: (s) => s.scores.map((x, i) => `P${i + 1} ${x}`).join(" · "),
};
