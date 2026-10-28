// Gin Rummy, two players. Ten cards each; draw from the stock or the
// discard pile, then discard. Knock when your unmatched cards (deadwood)
// add up to ten or less — gin when none. After a knock (not gin) the other
// player lays off what they can onto the knocker's sets and runs, then the
// deadwood is counted. The knocker scores the difference (gin: the other's
// deadwood plus 25); if the other player's deadwood is as low or lower, they
// score the difference plus 25 instead (an undercut). First to 100 wins.
//
// Moves: "ds" (draw from stock), "dd" (draw the discard), "x:<card>"
// (discard), "k:<card>" (discard that card and knock).

import { ON, win, type GameDef, type Outcome } from "./core.ts";
import { RANKS, deal, rankOf, rankValue, shuffledDeck, suitOf } from "./cards.ts";

export const GIN_TARGET = 100;

/** How a knock was counted, kept so both players can see it while the next deal starts. */
export interface GinKnock {
  round: number;
  by: number;
  gin: boolean;
  /** The knocker's sets and runs, and their unmatched cards. */
  melds: string[][];
  deadwood: string[];
  points: number;
  /** The other player's own sets and runs, the cards they laid off on the knocker's, and what was left. */
  defMelds: string[][];
  laid: string[];
  defDeadwood: string[];
  defPoints: number;
  /** Who scored, how much, and whether it was an undercut. */
  scorer: number;
  scored: number;
  undercut: boolean;
  scores: [number, number];
}

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
  /** The last knock, shown through the first turn of the next deal. */
  lastKnock: GinKnock | null;
  /** What just happened between deals ("the stock ran out"), with players as "P<n>"; "" otherwise. */
  notice: string;
  over: boolean;
}

export const cardPoints = (c: string) => {
  const r = rankOf(c);
  if (r === "A") return 1;
  if ("TJQK".includes(r)) return 10;
  return Number(r);
};

// In Gin the ace is low: A-2-3 is a run, Q-K-A is not.
const order = (c: string) => (rankOf(c) === "A" ? 0 : rankValue(c) + 1);
const isSet = (m: string[]) => m.every((c) => rankOf(c) === rankOf(m[0]));

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

/** Every way to set some disjoint melds aside, with the cards left over. */
function arrangements(hand: string[], visit: (chosen: string[][], rest: string[]) => void) {
  const all = melds(hand);
  const search = (start: number, used: Set<string>, chosen: string[][]) => {
    visit(chosen, hand.filter((c) => !used.has(c)));
    for (let i = start; i < all.length; i++) {
      const m = all[i];
      if (m.some((c) => used.has(c))) continue;
      const u = new Set(used);
      for (const c of m) u.add(c);
      search(i + 1, u, [...chosen, m]);
    }
  };
  search(0, new Set(), []);
}

const points = (cards: string[]) => cards.reduce((a, c) => a + cardPoints(c), 0);

/** The smallest deadwood the hand can be arranged into, and the melds used. */
export function deadwood(hand: string[]): { points: number; melds: string[][] } {
  let best = { points: points(hand), melds: [] as string[][] };
  arrangements(hand, (chosen, rest) => {
    const pts = points(rest);
    if (pts < best.points) best = { points: pts, melds: chosen };
  });
  return best;
}

/** Lays off what it can of `cards` onto the knocker's `onto` melds (a run grows at either end, a set takes its fourth card). */
export function layOff(onto: string[][], cards: string[]): { laid: string[]; left: string[] } {
  const ms = onto.map((m) => [...m].sort((a, b) => order(a) - order(b)));
  const laid: string[] = [];
  let left = [...cards];
  for (let again = true; again; ) {
    again = false;
    for (const c of left) {
      // A run first: extending it may let another card on after it.
      const run = ms.find((m) => !isSet(m) && suitOf(m[0]) === suitOf(c) && (order(c) === order(m[0]) - 1 || order(c) === order(m[m.length - 1]) + 1));
      const set = run ? null : ms.find((m) => isSet(m) && m.length < 4 && rankOf(m[0]) === rankOf(c));
      const into = run ?? set;
      if (!into) continue;
      into.push(c);
      into.sort((a, b) => order(a) - order(b));
      laid.push(c);
      left = left.filter((x) => x !== c);
      again = true;
      break;
    }
  }
  return { laid, left };
}

/** The defender's best: their own melds, then lay off the rest onto the knocker's melds. */
export function defend(hand: string[], onto: string[][]): { points: number; melds: string[][]; laid: string[]; left: string[] } {
  let best = { points: points(hand) + 1, melds: [] as string[][], laid: [] as string[], left: hand };
  arrangements(hand, (chosen, rest) => {
    const { laid, left } = layOff(onto, rest);
    const pts = points(left);
    if (pts < best.points) best = { points: pts, melds: chosen, laid, left };
  });
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
    const s: GinState = { round: 1, hands: [], stock: [], discard: [], turn: 0, phase: "draw", tookDiscard: null, scores: [0, 0], log: [], lastKnock: null, notice: "", over: false };
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
      // The first turn of a new deal is over: the last knock can go.
      s.lastKnock = null;
      s.notice = "";
      if (mv[1] === "k") {
        const mine = deadwood(after);
        if (mine.points > 10) return null;
        const other = 1 - p;
        const gin = mine.points === 0;
        const used = new Set(mine.melds.flat());
        // Gin: no laying off. A knock: the other player lays off onto the knocker's melds first.
        const def = gin ? { ...defend(s.hands[other], []), laid: [] as string[] } : defend(s.hands[other], mine.melds);
        const theirs = def.points;
        s.hands[p] = after;
        s.discard.push(card);
        let line: string;
        let scorer = p;
        let scored: number;
        if (gin) {
          scored = theirs + 25;
          line = `Round ${s.round}: P${p + 1} goes gin (+${scored})`;
        } else if (theirs <= mine.points) {
          scorer = other;
          scored = mine.points - theirs + 25;
          line = `Round ${s.round}: P${p + 1} knocks with ${mine.points}, undercut by P${other + 1} with ${theirs} (+${scored})`;
        } else {
          scored = theirs - mine.points;
          line = `Round ${s.round}: P${p + 1} knocks with ${mine.points} against ${theirs} (+${scored})`;
        }
        if (def.laid.length) line += ` · P${other + 1} laid off ${def.laid.length}`;
        s.scores[scorer] += scored;
        s.log.push(line);
        s.lastKnock = {
          round: s.round, by: p, gin,
          melds: mine.melds, deadwood: after.filter((c) => !used.has(c)), points: mine.points,
          defMelds: def.melds, laid: def.laid, defDeadwood: def.left, defPoints: theirs,
          scorer, scored, undercut: !gin && scorer !== p, scores: [s.scores[0], s.scores[1]],
        };
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
        s.log.push(`Round ${s.round}: the stock ran out — no score, new deal`);
        s.notice = s.log[s.log.length - 1];
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
