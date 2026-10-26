// Archery: 2–8 archers, six arrows each at a ten-ring target. Every arrow
// has its own wind (from the match seed, shown before you shoot) that pushes
// it sideways and up or down; aim off to allow for it. Highest total wins.
// Moves: "s:<x>:<y>" — where you aimed, in target units (radius 100).

import { ON, draw, rng, win, type GameDef, type Outcome } from "./core.ts";

export const TARGET_R = 100;
export const ARROWS = 6;

export function windFor(seed: string, player: number, arrow: number): { dx: number; dy: number } {
  const next = rng(`${seed}#wind${player}-${arrow}`);
  next();
  const strength = Math.round(next() * 22);
  const angle = next() * Math.PI * 2;
  return { dx: Math.round(Math.cos(angle) * strength), dy: Math.round(Math.sin(angle) * strength) };
}

export const ringScore = (x: number, y: number) => {
  const d = Math.sqrt(x * x + y * y);
  if (d > TARGET_R) return 0;
  return Math.max(1, 10 - Math.floor(d / 10));
};

export interface ArcheryState {
  /** hits[player] = landed arrows. */
  hits: { x: number; y: number; score: number }[][];
  scores: number[];
  turn: number;
  done: boolean;
}

function outcome(s: ArcheryState): Outcome {
  if (!s.done) return ON;
  const best = Math.max(...s.scores);
  const tops = s.scores.map((x, i) => (x === best ? i : -1)).filter((i) => i >= 0);
  return tops.length > 1 ? draw(`${best} points each`, s.scores) : win(tops[0], `${best} points`, s.scores);
}

export const archery: GameDef<ArcheryState> = {
  id: "archery",
  name: "Archery",
  blurb: "Six arrows each; allow for the wind.",
  emoji: "🏹",
  minPlayers: 1,
  maxPlayers: 8,
  replay(moves, n, seed) {
    const s: ArcheryState = { hits: Array.from({ length: n }, () => []), scores: Array(n).fill(0), turn: 0, done: false };
    for (const m of moves) {
      if (s.done) return null;
      const mv = /^s:(-?\d+):(-?\d+)$/.exec(m);
      if (!mv) return null;
      const p = s.turn;
      const k = s.hits[p].length;
      const w = windFor(seed, p, k);
      const x = Number(mv[1]) + w.dx;
      const y = Number(mv[2]) + w.dy;
      if (Math.abs(x) > 300 || Math.abs(y) > 300) return null;
      const score = ringScore(x, y);
      s.hits[p].push({ x, y, score });
      s.scores[p] += score;
      s.turn = (s.turn + 1) % n;
      if (s.hits.every((h) => h.length >= ARROWS)) s.done = true;
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s) => outcome(s),
  summary: (s) => s.scores.map((x, i) => `P${i + 1} ${x}`).join(" · "),
};
