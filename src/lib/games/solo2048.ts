// 2048: the moves, apart from the board that draws them (so they can be tested by themselves).
// LANX 3.16.0: Up and Down were swapped (the table below turned the board the wrong way
// round for them): pressing Up sent the tiles to the bottom.

export type Grid = number[][];
export type Dir2048 = "left" | "right" | "up" | "down";
const SIZE = 4;
export const empty = (): Grid => Array.from({ length: SIZE }, () => Array(SIZE).fill(0));

/** A new tile (a 2, one time in ten a 4) on a free square. `random` gives numbers from 0 up to 1. */
export function addTile(g: Grid, random: () => number = Math.random): Grid {
  const free: [number, number][] = [];
  g.forEach((row, r) => row.forEach((v, c) => v === 0 && free.push([r, c])));
  if (!free.length) return g;
  const [r, c] = free[Math.floor(random() * free.length)];
  const next = g.map((row) => [...row]);
  next[r][c] = random() < 0.9 ? 2 : 4;
  return next;
}

/** One row slid to the left: equal neighbours merge once. */
export function slideRow(row: number[]): { row: number[]; gained: number } {
  const vals = row.filter((v) => v);
  const out: number[] = [];
  let gained = 0;
  for (let i = 0; i < vals.length; i++) {
    if (vals[i] === vals[i + 1]) {
      out.push(vals[i] * 2);
      gained += vals[i] * 2;
      i++;
    } else out.push(vals[i]);
  }
  while (out.length < SIZE) out.push(0);
  return { row: out, gained };
}

/** The board turned a quarter clockwise. */
const rotate = (g: Grid): Grid => g[0].map((_, c) => g.map((row) => row[c]).reverse());

/** Quarter turns clockwise that bring a direction round to "left". One turn clockwise puts
 *  the bottom of each column at the start of a row, so sliding left then moves tiles DOWN:
 *  one turn is Down, three turns are Up. */
const TURNS: Record<Dir2048, number> = { left: 0, down: 1, right: 2, up: 3 };

export function move2048(g: Grid, dir: Dir2048): { grid: Grid; gained: number; moved: boolean } {
  const turns = TURNS[dir];
  let work = g;
  for (let i = 0; i < turns; i++) work = rotate(work);
  let gained = 0;
  const slid = work.map((row) => {
    const s = slideRow(row);
    gained += s.gained;
    return s.row;
  });
  let back = slid;
  for (let i = 0; i < (4 - turns) % 4; i++) back = rotate(back);
  const moved = back.some((row, r) => row.some((v, c) => v !== g[r][c]));
  return { grid: back, gained, moved };
}

export const canMove = (g: Grid) => (["left", "right", "up", "down"] as const).some((d) => move2048(g, d).moved);
/** The highest tile on the board. */
export const topTile = (g: Grid) => Math.max(0, ...g.flat());
