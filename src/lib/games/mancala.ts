// Mancala (Kalah): six pits of four seeds a side and a store at each end.
// Pick one of your pits and sow its seeds one by one to the right, into your
// store but past the other player's. Last seed in your store: go again. Last
// seed in an empty pit of yours: take it and everything opposite. When one
// side is empty the other keeps what is left; most seeds wins.
//
// Pits 0..5 and store 6 belong to player 0 (bottom); 7..12 and store 13 to
// player 1. Moves: your pit "0".."5".

import { ON, draw, num, win, type GameDef, type Outcome } from "./core.ts";

export interface MancalaState {
  pits: number[];
  turn: number;
  last: number;
}

const store = (p: number) => (p === 0 ? 6 : 13);
const side = (p: number) => (p === 0 ? [0, 1, 2, 3, 4, 5] : [7, 8, 9, 10, 11, 12]);

function apply(s: MancalaState, pitRel: number): MancalaState | null {
  if (pitRel < 0 || pitRel > 5) return null;
  const from = s.turn === 0 ? pitRel : 7 + pitRel;
  if (s.pits[from] === 0) return null;
  const pits = [...s.pits];
  let seeds = pits[from];
  pits[from] = 0;
  let i = from;
  while (seeds > 0) {
    i = (i + 1) % 14;
    if (i === store(1 - s.turn)) continue;
    pits[i]++;
    seeds--;
  }
  let turn = 1 - s.turn;
  if (i === store(s.turn)) turn = s.turn;
  else if (side(s.turn).includes(i) && pits[i] === 1 && pits[12 - i] > 0) {
    pits[store(s.turn)] += pits[i] + pits[12 - i];
    pits[i] = 0;
    pits[12 - i] = 0;
  }
  // One side empty: the other side's seeds go to their store.
  for (const p of [0, 1]) {
    if (side(p).every((x) => pits[x] === 0)) {
      const other = 1 - p;
      for (const x of side(other)) {
        pits[store(other)] += pits[x];
        pits[x] = 0;
      }
    }
  }
  return { pits, turn, last: i };
}

const finished = (s: MancalaState) => side(0).every((x) => s.pits[x] === 0) && side(1).every((x) => s.pits[x] === 0);

function outcome(s: MancalaState): Outcome {
  if (!finished(s)) return ON;
  const a = s.pits[6];
  const b = s.pits[13];
  if (a === b) return draw(`${a} seeds each`, [a, b]);
  return win(a > b ? 0 : 1, `${Math.max(a, b)} seeds to ${Math.min(a, b)}`, [a, b]);
}

export const mancala: GameDef<MancalaState> = {
  id: "mancala",
  name: "Mancala",
  blurb: "Sow seeds round the board; most in your store wins.",
  emoji: "🫘",
  minPlayers: 2,
  maxPlayers: 2,
  replay(moves) {
    let s: MancalaState = { pits: [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0], turn: 0, last: -1 };
    for (const m of moves) {
      if (finished(s)) return null;
      const pit = num(m);
      if (pit === null) return null;
      const next = apply(s, pit);
      if (!next) return null;
      s = next;
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s) => outcome(s),
  summary: (s) => `stores ${s.pits[6]} · ${s.pits[13]}`,
};
