// Memory: 36 cards face down, 18 pairs. Turn over two; a pair is yours and
// you go again, otherwise they turn back and the next player tries. Any
// number of players; most pairs wins. Moves: the card "0".."35".
// LANX 2.17.0: "x<p>" — player p left: skipped from then on (a card they
// had turned goes back down), can't win; the last one left wins.

import { ON, draw, lastIn, leaver, nextIn, num, shuffled, win, type GameDef, type Outcome } from "./core.ts";

export const MEMORY_SIDE = 6;
const FACES = ["🍎", "🍌", "🍇", "🍉", "🍒", "🥝", "🍍", "🥑", "🌶️", "🥕", "🧀", "🍩", "🍪", "🎈", "⚽", "🎸", "🚗", "✈️"];

export interface MemoryState {
  faces: string[];
  /** Who holds each card's pair, or -1 while face down. */
  owner: number[];
  /** Cards turned up so far this turn (0, 1 or 2). */
  open: number[];
  /** The last two cards shown that did not match (for a short reveal). */
  lastMiss: number[];
  scores: number[];
  turn: number;
  pairsLeft: number;
  /** LANX 2.17.0: players who left. */
  out: boolean[];
}

function outcome(s: MemoryState, n: number): Outcome {
  const alone = lastIn(s.out, n);
  if (alone !== null) return win(alone, "everyone else left", s.scores);
  if (s.pairsLeft > 0) return ON;
  const best = Math.max(...s.scores.filter((_x, i) => !s.out[i]));
  const tops = s.scores.map((x, i) => (x === best && !s.out[i] ? i : -1)).filter((i) => i >= 0);
  return tops.length > 1 ? draw(`${best} pairs each`, s.scores) : win(tops[0], `${best} pairs`, s.scores);
}

export const memory: GameDef<MemoryState> = {
  id: "memory",
  name: "Memory",
  blurb: "Find the pairs before the others do.",
  emoji: "🃏",
  minPlayers: 2,
  maxPlayers: 8,
  replay(moves, n, seed) {
    const faces = shuffled([...FACES, ...FACES], seed);
    const s: MemoryState = { faces, owner: Array(36).fill(-1), open: [], lastMiss: [], scores: Array(n).fill(0), turn: 0, pairsLeft: 18, out: Array(n).fill(false) };
    for (const m of moves) {
      if (outcome(s, n).over) return null;
      const p = leaver(m, n);
      if (p !== null) {
        if (p < 0 || s.out[p]) return null;
        s.out[p] = true;
        s.lastMiss = [];
        if (s.turn === p) {
          s.open = [];
          s.turn = nextIn(p, n, s.out);
        }
        continue;
      }
      const i = num(m);
      if (i === null || i < 0 || i >= 36 || s.owner[i] >= 0 || s.open.includes(i)) return null;
      s.open.push(i);
      s.lastMiss = [];
      if (s.open.length === 2) {
        const [a, b] = s.open;
        if (faces[a] === faces[b]) {
          s.owner[a] = s.turn;
          s.owner[b] = s.turn;
          s.scores[s.turn]++;
          s.pairsLeft--;
        } else {
          s.lastMiss = [a, b];
          s.turn = nextIn(s.turn, n, s.out);
        }
        s.open = [];
      }
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome,
  summary: (s) => s.scores.map((x, i) => `P${i + 1} ${x}${s.out[i] ? " (left)" : ""}`).join(" · "),
};
