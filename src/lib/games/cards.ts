// Playing cards shared by the card games. A card is a two-letter string:
// rank then suit — "AS" (ace of spades), "TH" (ten of hearts), "2C"…
// Hands come from the match seed on every PC; your PC only shows yours.

import { shuffled } from "./core.ts";

export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
export const SUITS = ["S", "H", "D", "C"];
export const SUIT_SYMBOL: Record<string, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
export const RANK_NAME: Record<string, string> = { T: "10", J: "J", Q: "Q", K: "K", A: "A" };

export const rankOf = (c: string) => c[0];
export const suitOf = (c: string) => c[1];
/** 2 = 0 … A = 12 */
export const rankValue = (c: string) => RANKS.indexOf(c[0]);
export const cardText = (c: string) => `${RANK_NAME[c[0]] ?? c[0]}${SUIT_SYMBOL[c[1]] ?? c[1]}`;
export const isRed = (c: string) => c[1] === "H" || c[1] === "D";

export function deck52(): string[] {
  const out: string[] = [];
  for (const s of SUITS) for (const r of RANKS) out.push(r + s);
  return out;
}

/** A shuffled deck for this seed (and round). */
export const shuffledDeck = (seed: string, deck = deck52()) => shuffled(deck, seed);

/** Deals `per` cards to each of `n` players from the top of `deck`; returns hands and the rest. */
export function deal(deck: string[], n: number, per: number): { hands: string[][]; rest: string[] } {
  const hands: string[][] = Array.from({ length: n }, () => []);
  let k = 0;
  for (let i = 0; i < per; i++) for (let p = 0; p < n; p++) hands[p].push(deck[k++]);
  return { hands, rest: deck.slice(k) };
}

export const sortHand = (hand: string[]) => [...hand].sort((a, b) => SUITS.indexOf(suitOf(a)) - SUITS.indexOf(suitOf(b)) || rankValue(a) - rankValue(b));

// ---------------------------------------------------------------- poker hands

export interface HandRank {
  /** 8 straight flush … 0 high card */
  cat: number;
  /** Tie-breaker values, high to low. */
  kick: number[];
  name: string;
}
const CAT_NAMES = ["high card", "a pair", "two pair", "three of a kind", "a straight", "a flush", "a full house", "four of a kind", "a straight flush"];

function rank5(cards: string[]): HandRank {
  const vals = cards.map(rankValue).sort((a, b) => b - a);
  const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]));
  let straightHigh = -1;
  const uniq = [...new Set(vals)];
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq.join() === "12,3,2,1,0") straightHigh = 3; // wheel A-2-3-4-5
  }
  const counts = new Map<number, number>();
  for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const kick = groups.map((g) => g[0]);
  let cat = 0;
  if (straightHigh >= 0 && flush) cat = 8;
  else if (groups[0][1] === 4) cat = 7;
  else if (groups[0][1] === 3 && groups[1]?.[1] === 2) cat = 6;
  else if (flush) cat = 5;
  else if (straightHigh >= 0) cat = 4;
  else if (groups[0][1] === 3) cat = 3;
  else if (groups[0][1] === 2 && groups[1]?.[1] === 2) cat = 2;
  else if (groups[0][1] === 2) cat = 1;
  return { cat, kick: cat === 4 || cat === 8 ? [straightHigh] : kick, name: CAT_NAMES[cat] };
}

export function compareHands(a: HandRank, b: HandRank): number {
  if (a.cat !== b.cat) return a.cat - b.cat;
  for (let i = 0; i < Math.max(a.kick.length, b.kick.length); i++) {
    const d = (a.kick[i] ?? -1) - (b.kick[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

/** The best five-card hand out of five to seven cards. */
export function bestHand(cards: string[]): HandRank {
  if (cards.length <= 5) return rank5(cards);
  let best: HandRank | null = null;
  const pick = (start: number, chosen: string[]) => {
    if (chosen.length === 5) {
      const r = rank5(chosen);
      if (!best || compareHands(r, best) > 0) best = r;
      return;
    }
    for (let i = start; i < cards.length; i++) pick(i + 1, [...chosen, cards[i]]);
  };
  pick(0, []);
  return best!;
}

// ---------------------------------------------------------------- tricks

/** Who wins a trick: the highest card of the led suit, unless a trump was played. */
export function trickWinner(plays: { player: number; card: string }[], trump: string | null, value: (c: string) => number = rankValue): number {
  let best = plays[0];
  for (const p of plays.slice(1)) {
    const s = suitOf(p.card);
    const bs = suitOf(best.card);
    if (trump && s === trump && bs !== trump) best = p;
    else if (s === bs && value(p.card) > value(best.card)) best = p;
  }
  return best.player;
}
