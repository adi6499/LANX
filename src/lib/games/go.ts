// Go on a 9×9 board, two players, black (player 0) starts. Stones with no
// liberties are captured; you may not fill your own last liberty (suicide)
// or retake a ko at once. Two passes in a row end the game, scored by area
// (stones plus surrounded empty points) with 7.5 points to white for
// moving second (2.17.0; it was 6.5, the figure for territory scoring).
// Captures don't add to an area score. Moves: the point "0".."80" or "p" to pass.

import { ON, num, orthogonal, win, type GameDef, type Outcome } from "./core.ts";

export const GO = 9;
export const GO_KOMI = 7.5;
const KOMI = GO_KOMI;

export interface GoState {
  cells: (number | null)[];
  turn: number;
  captured: [number, number];
  passes: number;
  /** A point that may not be played right now (ko), or -1. */
  ko: number;
  last: number;
}

function group(cells: (number | null)[], i: number): { stones: number[]; liberties: number } {
  const who = cells[i];
  const stones: number[] = [];
  const seen = new Set<number>([i]);
  const libs = new Set<number>();
  const stack = [i];
  while (stack.length) {
    const x = stack.pop()!;
    stones.push(x);
    for (const j of orthogonal(x, GO, GO)) {
      if (cells[j] === null) libs.add(j);
      else if (cells[j] === who && !seen.has(j)) {
        seen.add(j);
        stack.push(j);
      }
    }
  }
  return { stones, liberties: libs.size };
}

function play(s: GoState, i: number): GoState | null {
  if (i < 0 || i >= GO * GO || s.cells[i] !== null || i === s.ko) return null;
  const cells = [...s.cells];
  cells[i] = s.turn;
  let taken = 0;
  let lastTaken = -1;
  for (const j of orthogonal(i, GO, GO)) {
    if (cells[j] === 1 - s.turn) {
      const g = group(cells, j);
      if (g.liberties === 0) {
        for (const x of g.stones) cells[x] = null;
        taken += g.stones.length;
        lastTaken = g.stones[0];
      }
    }
  }
  if (group(cells, i).liberties === 0) return null; // suicide
  const captured: [number, number] = [...s.captured] as [number, number];
  captured[s.turn] += taken;
  // Ko: a single stone taken a single stone and sits alone with one liberty.
  const ko = taken === 1 && group(cells, i).stones.length === 1 && group(cells, i).liberties === 1 ? lastTaken : -1;
  return { cells, turn: 1 - s.turn, captured, passes: 0, ko, last: i };
}

/** Area score: stones plus empty regions touching only one colour. */
export function goScore(cells: (number | null)[]): [number, number] {
  const score: [number, number] = [0, 0];
  const seen = new Set<number>();
  cells.forEach((c) => {
    if (c !== null) score[c]++;
  });
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== null || seen.has(i)) continue;
    const region: number[] = [];
    const touch = new Set<number>();
    const stack = [i];
    seen.add(i);
    while (stack.length) {
      const x = stack.pop()!;
      region.push(x);
      for (const j of orthogonal(x, GO, GO)) {
        if (cells[j] === null) {
          if (!seen.has(j)) {
            seen.add(j);
            stack.push(j);
          }
        } else touch.add(cells[j]!);
      }
    }
    if (touch.size === 1) score[[...touch][0]] += region.length;
  }
  return score;
}

function outcome(s: GoState): Outcome {
  if (s.passes < 2) return ON;
  const [b, w] = goScore(s.cells);
  const white = w + KOMI;
  return b > white ? win(0, `${b} to ${white} points`, [b, white]) : win(1, `${white} to ${b} points`, [b, white]);
}

export const go: GameDef<GoState> = {
  id: "go",
  name: "Go",
  blurb: "Surround territory on a 9×9 board. Pass twice to finish.",
  emoji: "⚫",
  minPlayers: 2,
  maxPlayers: 2,
  replay(moves) {
    let s: GoState = { cells: Array(GO * GO).fill(null), turn: 0, captured: [0, 0], passes: 0, ko: -1, last: -1 };
    for (const m of moves) {
      if (s.passes >= 2) return null;
      if (m === "p") {
        s = { ...s, turn: 1 - s.turn, passes: s.passes + 1, ko: -1, last: -1 };
        continue;
      }
      const i = num(m);
      if (i === null) return null;
      const next = play(s, i);
      if (!next) return null;
      s = next;
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s) => outcome(s),
  summary: (s) => {
    const [b, w] = goScore(s.cells);
    return `P1 (black) ${b} · P2 (white) ${w + KOMI} by area, komi ${KOMI}`;
  },
};
