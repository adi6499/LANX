// Archery: 2–8 archers, six arrows each at a ten-ring target. Every arrow
// has its own wind (from the match seed, shown before you shoot) that pushes
// it sideways and up or down; aim off to allow for it. Highest total wins.
// The sight sways as you breathe (archerySway, the same on the flat and the
// 3D board); holding the draw steadies it for a moment, then the arm tires.
// LANX 2.17.0: a player who leaves is skipped and can't win; when only one
// is left, they win. Moves: "s:<x>:<y>" — where the sight was when you let
// go, in target units (radius 100); "x<p>" (player p left).

import { ON, draw, lastIn, leaver, nextIn, rng, win, type GameDef, type Outcome } from "./core.ts";

export const TARGET_R = 100;
export const ARROWS = 6;

export function windFor(seed: string, player: number, arrow: number): { dx: number; dy: number } {
  const next = rng(`${seed}#wind${player}-${arrow}`);
  next();
  const strength = Math.round(next() * 22);
  const angle = next() * Math.PI * 2;
  return { dx: Math.round(Math.cos(angle) * strength), dy: Math.round(Math.sin(angle) * strength) };
}

/** LANX 2.17.0: how far the sight has swayed (target units), `t` seconds into your turn,
 *  having held the draw for `held` seconds (null when not drawing). Boards add it to the aim. */
export function archerySway(t: number, held: number | null): [number, number] {
  const amp = held === null ? 14 : held < 2 ? 14 - held * 5 : Math.min(30, 4 + (held - 2) * 10);
  return [Math.sin(t * 2.1) * amp, Math.sin(t * 1.6 + 1) * amp];
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
  /** LANX 2.17.0: who has left. */
  out: boolean[];
  /** The last arrow in words ("P2 scored 9"). */
  event: string;
}

function outcome(s: ArcheryState, n: number): Outcome {
  if (!s.done) return ON;
  const last = n > 1 ? lastIn(s.out, n) : null;
  if (last !== null && s.out.some(Boolean)) return win(last, "the others left", s.scores);
  const live = s.scores.map((x, i) => (s.out[i] ? -Infinity : x));
  const best = Math.max(...live);
  const tops = live.map((x, i) => (x === best ? i : -1)).filter((i) => i >= 0);
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
    const s: ArcheryState = { hits: Array.from({ length: n }, () => []), scores: Array(n).fill(0), turn: 0, done: false, out: Array(n).fill(false), event: "" };
    const finished = () => s.hits.every((h, p) => s.out[p] || h.length >= ARROWS);
    for (const m of moves) {
      if (s.done) return null;
      const gone = leaver(m, n);
      if (gone !== null) {
        if (gone < 0 || s.out[gone] || n < 2) return null;
        s.out[gone] = true;
        s.event = `P${gone + 1} left the game`;
        if (lastIn(s.out, n) !== null || finished()) s.done = true;
        else if (s.turn === gone) s.turn = nextIn(gone, n, s.out);
        continue;
      }
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
      s.event = score ? `P${p + 1} scored ${score}` : `P${p + 1} missed the target`;
      s.turn = nextIn(p, n, s.out);
      if (finished()) s.done = true;
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s, n) => outcome(s, n),
  summary: (s) => s.scores.map((x, i) => `P${i + 1} ${s.out[i] ? "left" : x}`).join(" · "),
};
