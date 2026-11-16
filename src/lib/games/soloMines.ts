// Minesweeper: the rules, apart from the board that draws them (so they can be tested by themselves).
// LANX 3.18.0 (Sprint 3, S3-11):
//  - a first click on a FLAGGED square did nothing you could see, but it marked the mines as laid
//    without laying any: the field then had no mines at all. A flagged or open square is now
//    left alone before anything else happens;
//  - a flag can be planted without a right mouse button (flag mode, the F key);
//  - a click on an open number whose flags are all planted opens the squares around it;
//  - no more flags than there are mines (the counter went below zero).

export const MS = 9;
export const MINES = 10;
export interface Sq {
  mine: boolean;
  open: boolean;
  flag: boolean;
  n: number;
}
export type MinesState = "playing" | "won" | "lost";
export interface MinesGame {
  field: Sq[];
  /** The mines are laid (at the first square opened, never on or next to it). */
  planted: boolean;
  state: MinesState;
}

export function freshField(): Sq[] {
  return Array.from({ length: MS * MS }, () => ({ mine: false, open: false, flag: false, n: 0 }));
}

export function around(i: number): number[] {
  const r = Math.floor(i / MS);
  const c = i % MS;
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const rr = r + dr;
    const cc = c + dc;
    if (rr >= 0 && rr < MS && cc >= 0 && cc < MS) out.push(rr * MS + cc);
  }
  return out;
}

/** Lays the mines, none on `safe` or next to it. Flags already planted stay. `random`: 0 up to 1. */
export function plant(field: Sq[], safe: number, random: () => number = Math.random): Sq[] {
  const f = field.map((s) => ({ ...s, mine: false }));
  const keep = new Set([safe, ...around(safe)]);
  const free: number[] = [];
  for (let i = 0; i < MS * MS; i++) if (!keep.has(i)) free.push(i);
  for (let left = MINES; left > 0 && free.length; left--) {
    const k = Math.min(free.length - 1, Math.floor(random() * free.length));
    f[free[k]].mine = true;
    free.splice(k, 1);
  }
  f.forEach((s, i) => {
    s.n = around(i).filter((j) => f[j].mine).length;
  });
  return f;
}

export const minesStart = (): MinesGame => ({ field: freshField(), planted: false, state: "playing" });

/** Opens these squares of `f` (a copy the caller owns), spreading over empty ground. */
function openFrom(f: Sq[], starts: number[]): MinesGame {
  if (starts.some((i) => f[i].mine)) {
    f.forEach((s) => {
      if (s.mine) s.open = true;
    });
    return { field: f, planted: true, state: "lost" };
  }
  const stack = [...starts];
  while (stack.length) {
    const j = stack.pop()!;
    if (f[j].open || f[j].flag) continue;
    f[j].open = true;
    if (f[j].n === 0) for (const k of around(j)) if (!f[k].open && !f[k].mine) stack.push(k);
  }
  return { field: f, planted: true, state: f.every((s) => s.open || s.mine) ? "won" : "playing" };
}

/** A square is opened. A flagged or already open square is left alone, and nothing is laid for it. */
export function minesOpen(g: MinesGame, i: number, random: () => number = Math.random): MinesGame {
  const sq = g.field[i];
  if (g.state !== "playing" || !sq || sq.flag || sq.open) return g;
  const f = g.planted ? g.field.map((s) => ({ ...s })) : plant(g.field, i, random);
  return openFrom(f, [i]);
}

export const flagsOn = (g: MinesGame) => g.field.filter((s) => s.flag).length;

/** A flag goes on or comes off a closed square. No more flags than mines. */
export function minesFlag(g: MinesGame, i: number): MinesGame {
  const sq = g.field[i];
  if (g.state !== "playing" || !sq || sq.open) return g;
  if (!sq.flag && flagsOn(g) >= MINES) return g;
  return { ...g, field: g.field.map((s, j) => (j === i ? { ...s, flag: !s.flag } : s)) };
}

/** A click on an open number: when as many flags stand around it as its number says, the other
 *  squares around it are opened (and a wrong flag sets off the mine it missed). */
export function minesChord(g: MinesGame, i: number): MinesGame {
  const sq = g.field[i];
  if (g.state !== "playing" || !sq || !sq.open || sq.n === 0) return g;
  const near = around(i);
  if (near.filter((k) => g.field[k].flag).length !== sq.n) return g;
  const rest = near.filter((k) => !g.field[k].open && !g.field[k].flag);
  if (!rest.length) return g;
  return openFrom(g.field.map((s) => ({ ...s })), rest);
}

/** Whole seconds between two readings of the clock, never below zero. */
export const minesSeconds = (startMs: number | null, nowMs: number) => (startMs === null ? 0 : Math.max(0, Math.floor((nowMs - startMs) / 1000)));
