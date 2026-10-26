// Minesweeper Versus: one shared 12×12 field with 24 mines, players take
// turns opening a square. Every safe square you open is a point (a blank
// opens its neighbours too); a mine costs three. The first square is always
// safe. When every safe square is open, the highest score wins.
// Moves: the square "0".."143".

import { ON, draw, num, rng, win, type GameDef, type Outcome } from "./core.ts";

export const MV_SIZE = 12;
export const MV_MINES = 24;

export interface MinesVsState {
  /** null until the first square is opened (mines are laid around it). */
  mines: boolean[] | null;
  open: boolean[];
  /** Who opened each square, or -1. */
  by: number[];
  scores: number[];
  turn: number;
  safeLeft: number;
  last: number;
}

export function mvNeighbours(i: number): number[] {
  const r = Math.floor(i / MV_SIZE);
  const c = i % MV_SIZE;
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr;
      const cc = c + dc;
      if (rr >= 0 && rr < MV_SIZE && cc >= 0 && cc < MV_SIZE) out.push(rr * MV_SIZE + cc);
    }
  return out;
}

export const mvCount = (mines: boolean[], i: number) => mvNeighbours(i).filter((j) => mines[j]).length;

function lay(seed: string, safe: number): boolean[] {
  const mines = Array(MV_SIZE * MV_SIZE).fill(false);
  const keep = new Set([safe, ...mvNeighbours(safe)]);
  const next = rng(seed);
  let left = MV_MINES;
  let guard = 0;
  while (left > 0 && guard++ < 100000) {
    const i = Math.floor(next() * mines.length);
    if (mines[i] || keep.has(i)) continue;
    mines[i] = true;
    left--;
  }
  return mines;
}

function outcome(s: MinesVsState, n: number): Outcome {
  if (s.safeLeft > 0) return ON;
  const best = Math.max(...s.scores);
  const tops = s.scores.map((x, i) => (x === best ? i : -1)).filter((i) => i >= 0);
  return tops.length > 1 ? draw(`${best} points each`, s.scores) : win(tops[0], `${best} points`, s.scores.slice(0, n));
}

export const minesVersus: GameDef<MinesVsState> = {
  id: "minesvs",
  name: "Minesweeper Versus",
  blurb: "One shared field; open safe squares for points, mines cost you.",
  emoji: "💣",
  minPlayers: 2,
  maxPlayers: 4,
  replay(moves, n, seed) {
    const s: MinesVsState = { mines: null, open: Array(MV_SIZE * MV_SIZE).fill(false), by: Array(MV_SIZE * MV_SIZE).fill(-1), scores: Array(n).fill(0), turn: 0, safeLeft: MV_SIZE * MV_SIZE - MV_MINES, last: -1 };
    for (const m of moves) {
      if (s.safeLeft === 0) return null;
      const i = num(m);
      if (i === null || i < 0 || i >= s.open.length || s.open[i]) return null;
      if (!s.mines) s.mines = lay(seed, i);
      s.last = i;
      if (s.mines[i]) {
        s.open[i] = true;
        s.by[i] = s.turn;
        s.scores[s.turn] -= 3;
      } else {
        const stack = [i];
        let gained = 0;
        while (stack.length) {
          const j = stack.pop()!;
          if (s.open[j] || s.mines[j]) continue;
          s.open[j] = true;
          s.by[j] = s.turn;
          gained++;
          if (mvCount(s.mines, j) === 0) for (const k of mvNeighbours(j)) if (!s.open[k]) stack.push(k);
        }
        s.scores[s.turn] += gained;
        s.safeLeft -= gained;
      }
      s.turn = (s.turn + 1) % n;
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome,
  summary: (s) => s.scores.map((x, i) => `P${i + 1} ${x}`).join(" · "),
};
