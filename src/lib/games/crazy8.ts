// Crazy Eights, 2–6 players. Match the top card's suit or rank; an eight
// goes on anything and names the next suit. Nothing to play? Draw one (and
// keep drawing until you can); with the stock gone, pass. First to empty
// their hand wins.
// Moves: "p:<card>" (play), "p:<8x>:<suit>" (an eight, naming a suit),
// "d" (draw one), "x" (pass — only with the stock gone and nothing to play).

import { ON, win, type GameDef, type Outcome } from "./core.ts";
import { deal, rankOf, shuffledDeck, suitOf } from "./cards.ts";

export interface Crazy8State {
  hands: string[][];
  stock: string[];
  pile: string[];
  /** The suit to follow (an eight may change it). */
  suit: string;
  turn: number;
  winner: number | null;
}

export const crazy8Playable = (s: Crazy8State, card: string) => rankOf(card) === "8" || suitOf(card) === s.suit || rankOf(card) === rankOf(s.pile[s.pile.length - 1]);

function outcome(s: Crazy8State): Outcome {
  return s.winner !== null ? win(s.winner, "out of cards") : ON;
}

export const crazy8: GameDef<Crazy8State> = {
  id: "crazy8",
  name: "Crazy Eights",
  blurb: "Match suit or rank; eights are wild. First hand out wins.",
  emoji: "🂸",
  minPlayers: 2,
  maxPlayers: 6,
  replay(moves, n, seed) {
    const deck = shuffledDeck(seed);
    const { hands, rest } = deal(deck, n, n === 2 ? 7 : 5);
    // The first non-eight starts the pile.
    const stock = [...rest];
    let first = stock.findIndex((c) => rankOf(c) !== "8");
    if (first < 0) first = 0;
    const top = stock.splice(first, 1)[0];
    const s: Crazy8State = { hands, stock, pile: [top], suit: suitOf(top), turn: 0, winner: null };
    for (const m of moves) {
      if (s.winner !== null) return null;
      const hand = s.hands[s.turn];
      if (m === "d") {
        if (!s.stock.length || hand.some((c) => crazy8Playable(s, c))) return null; // only draw when stuck
        hand.push(s.stock.shift()!);
        continue;
      }
      if (m === "x") {
        if (s.stock.length || hand.some((c) => crazy8Playable(s, c))) return null;
        s.turn = (s.turn + 1) % n;
        continue;
      }
      const mv = /^p:([2-9TJQKA][SHDC])(?::([SHDC]))?$/.exec(m);
      if (!mv) return null;
      const card = mv[1];
      const k = hand.indexOf(card);
      if (k < 0 || !crazy8Playable(s, card)) return null;
      if (rankOf(card) === "8") {
        if (!mv[2]) return null;
        s.suit = mv[2];
      } else {
        if (mv[2]) return null;
        s.suit = suitOf(card);
      }
      hand.splice(k, 1);
      s.pile.push(card);
      if (hand.length === 0) {
        s.winner = s.turn;
        continue;
      }
      s.turn = (s.turn + 1) % n;
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s) => outcome(s),
  summary: (s) => s.hands.map((h, i) => `P${i + 1} ${h.length}`).join(" · ") + ` · stock ${s.stock.length}`,
};
