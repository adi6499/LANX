// Go Fish, 2–6 players. Ask someone for a rank you hold; they hand over
// every card of it and you ask again, or you "go fish" from the stock (and
// go again if you fish the rank you asked for). Four of a kind is a book
// and goes down at once. When all thirteen books are made, most books wins.
// Moves: "a:<player>:<rank>" (ask).

import { ON, draw, win, type GameDef, type Outcome } from "./core.ts";
import { RANKS, deal, rankOf, shuffledDeck } from "./cards.ts";

export interface GoFishState {
  hands: string[][];
  stock: string[];
  books: number[];
  turn: number;
  /** What just happened, for the board. */
  event: string;
}

function layBooks(s: GoFishState, p: number) {
  for (const r of RANKS) {
    const cards = s.hands[p].filter((c) => rankOf(c) === r);
    if (cards.length === 4) {
      s.hands[p] = s.hands[p].filter((c) => rankOf(c) !== r);
      s.books[p]++;
    }
  }
}

const done = (s: GoFishState) => s.books.reduce((a, b) => a + b, 0) === 13;

function outcome(s: GoFishState): Outcome {
  if (!done(s)) return ON;
  const best = Math.max(...s.books);
  const tops = s.books.map((b, i) => (b === best ? i : -1)).filter((i) => i >= 0);
  return tops.length > 1 ? draw(`${best} books each`, s.books) : win(tops[0], `${best} books`, s.books);
}

/** When a player has no cards, they draw one (or sit out if the stock is empty). */
function refill(s: GoFishState, p: number) {
  if (s.hands[p].length === 0 && s.stock.length) s.hands[p].push(s.stock.shift()!);
}

function nextTurn(s: GoFishState, n: number) {
  for (let k = 1; k <= n; k++) {
    const q = (s.turn + k) % n;
    refill(s, q);
    if (s.hands[q].length) {
      s.turn = q;
      return;
    }
  }
}

export const gofish: GameDef<GoFishState> = {
  id: "gofish",
  name: "Go Fish",
  blurb: "Ask for a rank; collect books of four.",
  emoji: "🐟",
  minPlayers: 2,
  maxPlayers: 6,
  replay(moves, n, seed) {
    const { hands, rest } = deal(shuffledDeck(seed), n, n <= 3 ? 7 : 5);
    const s: GoFishState = { hands, stock: rest, books: Array(n).fill(0), turn: 0, event: "" };
    for (let p = 0; p < n; p++) layBooks(s, p);
    for (const m of moves) {
      if (done(s)) return null;
      const mv = /^a:(\d+):([2-9TJQKA])$/.exec(m);
      if (!mv) return null;
      const who = Number(mv[1]);
      const rank = mv[2];
      const me = s.turn;
      if (who === me || who < 0 || who >= n) return null;
      if (!s.hands[me].some((c) => rankOf(c) === rank)) return null; // must hold the rank
      const got = s.hands[who].filter((c) => rankOf(c) === rank);
      if (got.length) {
        s.hands[who] = s.hands[who].filter((c) => rankOf(c) !== rank);
        s.hands[me].push(...got);
        s.event = `Player ${who + 1} hands over ${got.length} × ${rank}`;
        layBooks(s, me);
        refill(s, who);
        if (!s.hands[me].length) nextTurn(s, n); // (books emptied the hand)
        continue;
      }
      // Go fish.
      if (s.stock.length) {
        const card = s.stock.shift()!;
        s.hands[me].push(card);
        layBooks(s, me);
        if (rankOf(card) === rank) {
          s.event = `Go fish — and Player ${me + 1} fished the ${rank}!`;
          if (!s.hands[me].length) nextTurn(s, n);
          continue;
        }
        s.event = "Go fish";
      } else s.event = "Go fish — the stock is empty";
      nextTurn(s, n);
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s) => outcome(s),
  summary: (s) => s.books.map((b, i) => `P${i + 1} ${b}`).join(" · ") + ` · stock ${s.stock.length}`,
};
