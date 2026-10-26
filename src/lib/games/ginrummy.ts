// Gin Rummy, two players. Ten cards each; draw from the stock or the
// discard pile, then discard. Knock when your unmatched cards (deadwood)
// add up to ten or less — gin when none. The knocker scores the difference
// in deadwood (plus 25 for gin); if the other player's deadwood is as low or
// lower, they score the difference plus 25 instead. First to 100 wins.
//
// Moves: "ds" (draw from stock), "dd" (draw the discard), "x:<card>"
// (discard), "k:<card>" (discard that card and knock).

import { ON, win, type GameDef, type Outcome } from "./core.ts";
import { RANKS, deal, rankOf, rankValue, shuffledDeck, suitOf } from "./cards.ts";

export const GIN_TARGET = 100;

export interface GinState {
  round: number;
  hands: string[][];
  stock: string[];
  discard: string[];
  turn: number;
  /** "draw" then "discard". */
  phase: "draw" | "discard";
  /** The card just taken from the discard pile (may not go straight back). */
  tookDiscard: string | null;
  scores: number[];
  log: string[];
  lastKnock: { by: number; deadwood: [number, number] } | null;
  over: boolean;
}

export const cardPoints = (c: string) => {
  const r = rankOf(c);
  if (r === "A") return 1;
  if ("TJQK".includes(r)) return 10;
  return Number(r);
};

/** All sets (3–4 of a rank) and runs (3+ in a suit) that can be made from the hand. */
function melds(hand: string[]): string[][] {
  const out: string[][] = [];
  for (const r of RANKS) {
    const same = hand.filter((c) => rankOf(c) === r);
    if (same.length >= 3) {
      out.push(same);
      if (same.length === 4) for (const drop of same) out.push(same.filter((c) => c !== drop));
    }
  }
  // In Gin the ace is low: A-2-3 is a run, Q-K-A is not.
  const order = (c: string) => (rankOf(c) === "A" ? 0 : rankValue(c) + 1);
  for (const s of ["S", "H", "D", "C"]) {
    const suited = hand.filter((c) => suitOf(c) === s).sort((a, b) => order(a) - order(b));
    for (let i = 0; i < suited.length; i++) {
      for (let j = i + 2; j < suited.length; j++) {
        const run = suited.slice(i, j + 1);
        if (run.every((c, k) => k === 0 || order(c) === order(run[k - 1]) + 1)) out.push(run);
        else break;
      }
    }
  }
  return out;
}

/** The smallest deadwood the hand can be arranged into, and the melds used. */
export function deadwood(hand: string[]): { points: number; melds: string[][] } {
  const all = melds(hand);
  let best = { points: hand.reduce((a, c) => a + cardPoints(c), 0), melds: [] as string[][] };
  const search = (start: number, used: Set<string>, chosen: string[][]) => {
    const pts = hand.filter((c) => !used.has(c)).reduce((a, c) => a + cardPoints(c), 0);
    if (pts < best.points) best = { points: pts, melds: chosen };
    for (let i = start; i < all.length; i++) {
      const m = all[i];
      if (m.some((c) => used.has(c))) continue;
      const u = new Set(used);
      for (const c of m) u.add(c);
      search(i + 1, u, [...chosen, m]);
    }
  };
  search(0, new Set(), []);
  return best;
}

function newRound(s: GinState, seed: string) {
  const deck = shuffledDeck(`${seed}#round${s.round}`);
  const { hands, rest } = deal(deck, 2, 10);
  s.hands = hands;
  s.discard = [rest[0]];
  s.stock = rest.slice(1);
  s.turn = (s.round + 1) % 2; // the non-dealer starts; the deal alternates
  s.phase = "draw";
  s.tookDiscard = null;
}

function outcome(s: GinState): Outcome {
  if (!s.over) return ON;
  return win(s.scores[0] > s.scores[1] ? 0 : 1, `reaches ${Math.max(...s.scores)}`, s.scores);
}

export const ginrummy: GameDef<GinState> = {
  id: "ginrummy",
  name: "Gin Rummy",
  blurb: "Build sets and runs; knock when your deadwood is ten or less.",
  emoji: "🂭",
  minPlayers: 2,
  maxPlayers: 2,
  replay(moves, _n, seed) {
    const s: GinState = { round: 1, hands: [], stock: [], discard: [], turn: 0, phase: "draw", tookDiscard: null, scores: [0, 0], log: [], lastKnock: null, over: false };
    newRound(s, seed);
    for (const m of moves) {
      if (s.over) return null;
      const p = s.turn;
      const hand = s.hands[p];
      if (s.phase === "draw") {
        if (m === "ds") {
          if (!s.stock.length) return null;
          hand.push(s.stock.shift()!);
          s.tookDiscard = null;
        } else if (m === "dd") {
          if (!s.discard.length) return null;
          const c = s.discard.pop()!;
          hand.push(c);
          s.tookDiscard = c;
        } else return null;
        s.phase = "discard";
        continue;
      }
      const mv = /^(x|k):([2-9TJQKA][SHDC])$/.exec(m);
      if (!mv) return null;
      const card = mv[2];
      if (!hand.includes(card) || card === s.tookDiscard) return null;
      const after = hand.filter((c) => c !== card);
      if (mv[1] === "k") {
        const mine = deadwood(after).points;
        if (mine > 10) return null;
        const theirs = deadwood(s.hands[1 - p]).points;
        s.hands[p] = after;
        s.discard.push(card);
        let line: string;
        if (mine === 0) {
          s.scores[p] += theirs + 25;
          line = `Round ${s.round}: P${p + 1} goes gin (+${theirs + 25})`;
        } else if (theirs <= mine) {
          s.scores[1 - p] += mine - theirs + 25;
          line = `Round ${s.round}: P${p + 1} knocks with ${mine}, undercut by P${2 - p} with ${theirs} (+${mine - theirs + 25})`;
        } else {
          s.scores[p] += theirs - mine;
          line = `Round ${s.round}: P${p + 1} knocks with ${mine} against ${theirs} (+${theirs - mine})`;
        }
        s.log.push(line);
        s.lastKnock = { by: p, deadwood: p === 0 ? [mine, theirs] : [theirs, mine] };
        if (s.scores.some((x) => x >= GIN_TARGET)) {
          s.over = true;
          continue;
        }
        s.round++;
        newRound(s, seed);
        continue;
      }
      s.hands[p] = after;
      s.discard.push(card);
      s.tookDiscard = null;
      s.phase = "draw";
      s.turn = 1 - p;
      if (s.stock.length <= 2) {
        // Stock exhausted: the round is void, redeal.
        s.log.push(`Round ${s.round}: the stock ran out — redeal`);
        s.round++;
        newRound(s, seed);
      }
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s) => outcome(s),
  summary: (s) => `round ${s.round} · P1 ${s.scores[0]} · P2 ${s.scores[1]} · stock ${s.stock.length}`,
};
