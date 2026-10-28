// Dots & Boxes: a 6×6 grid of dots; players (2–4) take turns drawing one
// line between two neighbouring dots. Closing a box earns it and another
// turn. When every line is drawn, the most boxes wins.
//
// Moves: "h:r:c" (a horizontal line at dot row r 0..5, from column c 0..4)
// or "v:r:c" (a vertical line from dot row r 0..4 at column c 0..5).
// LANX 2.17.0: "x<p>" — player p left: they are skipped from then on, keep
// their boxes but can't win, and the last one left wins.

import { ON, draw, lastIn, leaver, nextIn, win, type GameDef, type Outcome } from "./core.ts";

export const DOTS = 6;
export const BOXES = DOTS - 1;

export interface DotsState {
  /** h[r][c]: the line to the right of dot (r,c) is drawn. */
  h: boolean[][];
  /** v[r][c]: the line below dot (r,c) is drawn. */
  v: boolean[][];
  /** owner of box (r,c), or -1. */
  box: number[][];
  scores: number[];
  turn: number;
  linesLeft: number;
  /** LANX 2.17.0: players who left. */
  out: boolean[];
  /** The last line drawn ("h:r:c"), and who drew it — so everyone sees what the other did. */
  last: string | null;
  lastBy: number;
}

const grid = <T,>(rows: number, cols: number, v: T): T[][] => Array.from({ length: rows }, () => Array(cols).fill(v));

function parse(move: string): { kind: "h" | "v"; r: number; c: number } | null {
  const m = /^([hv]):(\d+):(\d+)$/.exec(move);
  if (!m) return null;
  const kind = m[1] as "h" | "v";
  const r = Number(m[2]);
  const c = Number(m[3]);
  if (kind === "h" && (r < 0 || r >= DOTS || c < 0 || c >= BOXES)) return null;
  if (kind === "v" && (r < 0 || r >= BOXES || c < 0 || c >= DOTS)) return null;
  return { kind, r, c };
}

const closed = (s: DotsState, r: number, c: number) => s.h[r][c] && s.h[r + 1][c] && s.v[r][c] && s.v[r][c + 1];

function apply(s: DotsState, move: string, n: number): DotsState | null {
  const p = parse(move);
  if (!p) return null;
  if (p.kind === "h" ? s.h[p.r][p.c] : s.v[p.r][p.c]) return null;
  const next: DotsState = { h: s.h.map((x) => [...x]), v: s.v.map((x) => [...x]), box: s.box.map((x) => [...x]), scores: [...s.scores], turn: s.turn, linesLeft: s.linesLeft - 1, out: s.out, last: move, lastBy: s.turn };
  if (p.kind === "h") next.h[p.r][p.c] = true;
  else next.v[p.r][p.c] = true;
  let gained = 0;
  const check = (r: number, c: number) => {
    if (r < 0 || r >= BOXES || c < 0 || c >= BOXES || next.box[r][c] >= 0) return;
    if (closed(next, r, c)) {
      next.box[r][c] = s.turn;
      gained++;
    }
  };
  if (p.kind === "h") {
    check(p.r - 1, p.c);
    check(p.r, p.c);
  } else {
    check(p.r, p.c - 1);
    check(p.r, p.c);
  }
  if (gained) next.scores[s.turn] += gained;
  else next.turn = nextIn(s.turn, n, s.out);
  return next;
}

/** Player p leaves: skipped from now on; whoever is next moves if it was their turn. */
function leave(s: DotsState, p: number, n: number): DotsState | null {
  if (p < 0 || s.out[p]) return null;
  const out = [...s.out];
  out[p] = true;
  return { ...s, out, turn: s.turn === p ? nextIn(p, n, out) : s.turn };
}

function outcome(s: DotsState, n: number): Outcome {
  const alone = lastIn(s.out, n);
  if (alone !== null) return win(alone, "everyone else left", s.scores);
  if (s.linesLeft > 0) return ON;
  const best = Math.max(...s.scores.filter((_x, i) => !s.out[i]));
  const tops = s.scores.map((x, i) => (x === best && !s.out[i] ? i : -1)).filter((i) => i >= 0);
  if (tops.length > 1) return draw(`${best} boxes each`, s.scores);
  return win(tops[0], `${best} boxes`, s.scores);
}

export const dots: GameDef<DotsState> = {
  id: "dots",
  name: "Dots & Boxes",
  blurb: "Draw lines, close boxes, keep the turn when you do.",
  emoji: "🔲",
  minPlayers: 2,
  maxPlayers: 4,
  replay(moves, n) {
    let s: DotsState = { h: grid(DOTS, BOXES, false), v: grid(BOXES, DOTS, false), box: grid(BOXES, BOXES, -1), scores: Array(n).fill(0), turn: 0, linesLeft: 2 * DOTS * BOXES, out: Array(n).fill(false), last: null, lastBy: -1 };
    for (const m of moves) {
      if (outcome(s, n).over) return null;
      const p = leaver(m, n);
      const next = p !== null ? leave(s, p, n) : apply(s, m, n);
      if (!next) return null;
      s = next;
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome,
  summary: (s) => s.scores.map((x, i) => `P${i + 1} ${x}${s.out[i] ? " (left)" : ""}`).join(" · "),
};
