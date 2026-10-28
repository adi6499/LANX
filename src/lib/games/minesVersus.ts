// Minesweeper Versus: one shared 12×12 field with 24 mines, players take
// turns opening a square. Every safe square you open is a point (a blank
// opens its neighbours too); a mine costs three. When every safe square is
// open, the highest score wins.
// LANX 2.17.0: a fair start — before the first turn an open area is laid
// out for everyone (it scores for nobody), so the first player no longer
// gets a free flood of points; and "x<p>": player p left, skipped from then
// on, can't win; the last one left wins.
// Moves: the square "0".."143".

import { ON, draw, lastIn, leaver, nextIn, num, rng, win, type GameDef, type Outcome } from "./core.ts";

export const MV_SIZE = 12;
export const MV_MINES = 24;

export interface MinesVsState {
  /** Where the mines are (laid before the first turn since 2.17.0). */
  mines: boolean[] | null;
  open: boolean[];
  /** Who opened each square, or -1 (the starting area belongs to nobody). */
  by: number[];
  scores: number[];
  turn: number;
  safeLeft: number;
  last: number;
  /** The blank square the starting area was opened from. */
  start: number;
  /** LANX 2.17.0: players who left. */
  out: boolean[];
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
  const mines: boolean[] = Array(MV_SIZE * MV_SIZE).fill(false);
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

/** The squares a click on safe square `i` opens: it, and everything round a blank, spreading. */
function flood(mines: boolean[], open: boolean[], i: number): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  const stack = [i];
  while (stack.length) {
    const j = stack.pop()!;
    if (seen.has(j) || open[j] || mines[j]) continue;
    seen.add(j);
    out.push(j);
    if (mvCount(mines, j) === 0) for (const k of mvNeighbours(j)) if (!open[k] && !seen.has(k)) stack.push(k);
  }
  return out;
}

/** The field and its starting area, the same on every PC: a blank square near the middle whose
 *  opening is neither tiny nor most of the board. */
function field(seed: string): { mines: boolean[]; start: number; area: number[] } {
  let best: { mines: boolean[]; start: number; area: number[] } | null = null;
  for (let k = 0; k < 24; k++) {
    const next = rng(`${seed}#start${k}`);
    const r = 3 + Math.floor(next() * (MV_SIZE - 6));
    const c = 3 + Math.floor(next() * (MV_SIZE - 6));
    const start = r * MV_SIZE + c;
    const mines = lay(k === 0 ? seed : `${seed}#${k}`, start);
    const area = flood(mines, Array(mines.length).fill(false), start);
    const fair = area.length >= 10 && area.length <= 36;
    if (fair) return { mines, start, area };
    if (!best || Math.abs(area.length - 20) < Math.abs(best.area.length - 20)) best = { mines, start, area };
  }
  return best!;
}

function outcome(s: MinesVsState, n: number): Outcome {
  const alone = lastIn(s.out, n);
  if (alone !== null) return win(alone, "everyone else left", s.scores.slice(0, n));
  if (s.safeLeft > 0) return ON;
  const best = Math.max(...s.scores.filter((_x, i) => !s.out[i]));
  const tops = s.scores.map((x, i) => (x === best && !s.out[i] ? i : -1)).filter((i) => i >= 0);
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
    const f = field(seed);
    const s: MinesVsState = { mines: f.mines, open: Array(MV_SIZE * MV_SIZE).fill(false), by: Array(MV_SIZE * MV_SIZE).fill(-1), scores: Array(n).fill(0), turn: 0, safeLeft: MV_SIZE * MV_SIZE - MV_MINES - f.area.length, last: -1, start: f.start, out: Array(n).fill(false) };
    for (const j of f.area) s.open[j] = true;
    const mines = f.mines;
    for (const m of moves) {
      if (outcome(s, n).over) return null;
      const p = leaver(m, n);
      if (p !== null) {
        if (p < 0 || s.out[p]) return null;
        s.out[p] = true;
        if (s.turn === p) s.turn = nextIn(p, n, s.out);
        continue;
      }
      const i = num(m);
      if (i === null || i < 0 || i >= s.open.length || s.open[i]) return null;
      s.last = i;
      if (mines[i]) {
        s.open[i] = true;
        s.by[i] = s.turn;
        s.scores[s.turn] -= 3;
      } else {
        const opened = flood(mines, s.open, i);
        for (const j of opened) {
          s.open[j] = true;
          s.by[j] = s.turn;
        }
        s.scores[s.turn] += opened.length;
        s.safeLeft -= opened.length;
      }
      s.turn = nextIn(s.turn, n, s.out);
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome,
  summary: (s) => s.scores.map((x, i) => `P${i + 1} ${x}${s.out[i] ? " (left)" : ""}`).join(" · "),
};
