// Paint Fight — 2–8 players, a 14×14 grid, thirty seconds a round: tap
// squares to paint them your colour; the last tap on a square owns it.
// Three rounds; most squares wins. Moves: "<player>@a:<square>".

import { partyDef, type PartyState } from "./party.ts";

export const PAINT = 14;

export interface PaintExtra {
  /** Nothing to set up: the grid starts blank. */
  blank: true;
}

/** Owner of each square after the round's taps. */
export function paintGrid(answers: { player: number; text: string }[]): number[] {
  const grid = Array(PAINT * PAINT).fill(-1);
  for (const a of answers) {
    const i = Number(a.text);
    if (Number.isInteger(i) && i >= 0 && i < grid.length) grid[i] = a.player;
  }
  return grid;
}

export const paintFight = partyDef<PaintExtra>(
  "paintfight",
  "Paint Fight",
  "Tap fast: paint more squares than the others in thirty seconds.",
  "🎨",
  8,
  {
    rounds: 3,
    multi: true,
    seconds: 30,
    setup: () => ({ blank: true }),
    accept: (_s, _p, text) => /^\d{1,3}$/.test(text) && Number(text) < PAINT * PAINT,
    score: (s, _e, n) => {
      const grid = paintGrid(s.answers);
      const counts = Array(n).fill(0);
      for (const o of grid) if (o >= 0) counts[o]++;
      for (let p = 0; p < n; p++) s.scores[p] += counts[p];
      return `Round ${s.round}: ` + counts.map((c, p) => `P${p + 1} ${c}`).join(", ");
    },
  },
  "squares",
);

export type PaintState = PartyState<PaintExtra>;
