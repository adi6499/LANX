// Go Fish, 2–6 players. Ask someone for a rank you hold; they hand over
// every card of it and you ask again, or you "go fish" from the stock (and
// go again if you fish the rank you asked for). Four of a kind is a book
// and goes down at once. When all thirteen books are made, most books wins.
// Moves: "a:<player>:<rank>" (ask), and (LANX 2.17.0) "x<p>" when player p
// leaves: their cards go under the stock, so every book can still be made,
// and they are skipped from then on and can't win.

import { ON, draw, lastIn, leaver, win, type GameDef, type Outcome } from "./core.ts";
import { RANKS, deal, rankOf, rankPlural, shuffledDeck } from "./cards.ts";

export interface GoFishState {
  hands: string[][];
  stock: string[];
  books: number[];
  turn: number;
  /** What just happened, for the board, with players as "P<n>" ("P1 asked P3 for 7s — got 2"). */
  event: string;
  /** LANX 2.17.0: players who left, and the end when only one is left. */
  gone: boolean[];
  end: Outcome | null;
}

/** Lays down every book of four in the hand; the ranks laid down. */
function layBooks(s: GoFishState, p: number): string[] {
  const made: string[] = [];
  for (const r of RANKS) {
    const cards = s.hands[p].filter((c) => rankOf(c) === r);
    if (cards.length === 4) {
      s.hands[p] = s.hands[p].filter((c) => rankOf(c) !== r);
      s.books[p]++;
      made.push(r);
    }
  }
  return made;
}

const done = (s: GoFishState) => s.books.reduce((a, b) => a + b, 0) === 13;
const one = (r: string) => ({ "8": "an 8", T: "a 10", J: "a jack", Q: "a queen", K: "a king", A: "an ace" })[r] ?? `a ${r}`;
const bookText = (made: string[]) => (made.length ? ` · a book of ${made.map(rankPlural).join(" and ")}` : "");

function outcome(s: GoFishState): Outcome {
  if (s.end) return s.end;
  if (!done(s)) return ON;
  const still = s.books.map((_, i) => i).filter((i) => !s.gone[i]);
  const best = Math.max(...still.map((i) => s.books[i]));
  const tops = still.filter((i) => s.books[i] === best);
  return tops.length > 1 ? draw(`${best} books each`, s.books) : win(tops[0], `${best} books`, s.books);
}

/** When a player has no cards, they draw one (or sit out if the stock is empty). */
function refill(s: GoFishState, p: number) {
  if (!s.gone[p] && s.hands[p].length === 0 && s.stock.length) s.hands[p].push(s.stock.shift()!);
}

function nextTurn(s: GoFishState, n: number) {
  for (let k = 1; k <= n; k++) {
    const q = (s.turn + k) % n;
    if (s.gone[q]) continue;
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
    const s: GoFishState = { hands, stock: rest, books: Array(n).fill(0), turn: 0, event: "", gone: Array(n).fill(false), end: null };
    for (let p = 0; p < n; p++) layBooks(s, p);
    for (const m of moves) {
      if (done(s) || s.end) return null;
      const left = leaver(m, n);
      if (left !== null) {
        if (left < 0 || s.gone[left]) return null;
        s.gone[left] = true;
        s.stock.push(...s.hands[left]);
        s.hands[left] = [];
        s.event = `P${left + 1} left the table`;
        const last = lastIn(s.gone, n);
        if (last !== null) {
          s.end = win(last, "everyone else left", s.books);
          continue;
        }
        if (s.turn === left) nextTurn(s, n);
        else refill(s, s.turn);
        continue;
      }
      const mv = /^a:(\d+):([2-9TJQKA])$/.exec(m);
      if (!mv) return null;
      const who = Number(mv[1]);
      const rank = mv[2];
      const me = s.turn;
      if (who === me || who < 0 || who >= n || s.gone[who]) return null;
      if (!s.hands[me].some((c) => rankOf(c) === rank)) return null; // must hold the rank
      const asked = `P${me + 1} asked P${who + 1} for ${rankPlural(rank)}`;
      const got = s.hands[who].filter((c) => rankOf(c) === rank);
      if (got.length) {
        s.hands[who] = s.hands[who].filter((c) => rankOf(c) !== rank);
        s.hands[me].push(...got);
        s.event = `${asked} — got ${got.length}${bookText(layBooks(s, me))}`;
        refill(s, who);
        if (!s.hands[me].length) nextTurn(s, n); // (books emptied the hand)
        continue;
      }
      // Go fish.
      if (s.stock.length) {
        const card = s.stock.shift()!;
        s.hands[me].push(card);
        const made = layBooks(s, me);
        if (rankOf(card) === rank) {
          s.event = `${asked} — Go fish: fished ${one(rank)}, goes again${bookText(made)}`;
          if (!s.hands[me].length) nextTurn(s, n);
          continue;
        }
        s.event = `${asked} — Go fish${bookText(made)}`;
      } else s.event = `${asked} — Go fish (the stock is empty)`;
      nextTurn(s, n);
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s) => outcome(s),
  summary: (s) => s.books.map((b, i) => `P${i + 1} ${s.gone[i] ? "left" : b}`).join(" · ") + ` · stock ${s.stock.length}`,
};
