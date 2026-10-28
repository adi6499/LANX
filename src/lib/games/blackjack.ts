// Blackjack 21, 1–6 players against the house (the match deals). Five
// rounds: everyone gets two cards, the dealer shows one and checks the hole
// card at once — a dealer blackjack ends the round there (only another
// blackjack ties it). In turn, Hit, Stand, Double (one more card, twice the
// stake) or Split a pair into two hands; over 21 is bust. Then the dealer
// draws to 17. Points per stake: a win +2, a blackjack +3 (it pays 3:2), a
// loss −2, a tie nothing. Most points after five rounds wins.
// Moves: "h" (hit), "s" (stand), "d" (double), "p" (split) by the player to
// act; "x<p>" (LANX 2.17.0) when player p leaves: they sit out from then on
// and can't win; the game ends when one player is left.

import { ON, draw, lastIn, leaver, win, type GameDef, type Outcome } from "./core.ts";
import { rankOf, shuffledDeck } from "./cards.ts";

export const BJ_ROUNDS = 5;

export interface BjHand {
  cards: string[];
  /** 1, or 2 after a double. */
  stake: number;
  /** Made by splitting a pair (a two-card 21 here is not a blackjack). */
  split: boolean;
  /** Finished: stood, bust, 21, doubled, or split aces. */
  done: boolean;
}

export interface BjResult {
  player: number;
  hands: { cards: string[]; value: number; delta: number; why: string }[];
  delta: number;
}

/** A finished round, kept for the board until the next player acts. */
export interface BjRound {
  round: number;
  dealer: string[];
  dealerValue: number;
  dealerBlackjack: boolean;
  results: BjResult[];
}

export interface BjState {
  round: number;
  /** Each player's hands this round: one, or two after a split (none once they left). */
  boxes: BjHand[][];
  dealer: string[];
  /** Per player: still deciding this round. */
  active: boolean[];
  turn: number;
  /** Which of the player's hands is being played. */
  hand: number;
  /** True once the dealer has played out the round. */
  settled: boolean;
  points: number[];
  /** Round results, with players as "P<n>". */
  results: string[];
  /** The rounds finished since anyone last acted (usually one; two when the next deal was a dealer
   *  blackjack too), so the board can show the dealer's whole hand and everyone's result. */
  lastRounds: BjRound[];
  /** LANX 2.17.0: players who left, and the end when it came early. */
  gone: boolean[];
  end: Outcome | null;
  over: boolean;
}

export function bjValue(hand: string[]): number {
  let total = 0;
  let aces = 0;
  for (const c of hand) {
    const r = rankOf(c);
    if (r === "A") {
      aces++;
      total += 11;
    } else if ("TJQK".includes(r)) total += 10;
    else total += Number(r);
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

/** A blackjack (natural): 21 with the first two cards, not after a split. */
export const bjNatural = (h: BjHand) => h.cards.length === 2 && !h.split && bjValue(h.cards) === 21;
const cardValue = (c: string) => bjValue([c]);

/** The player's current hand, when they are deciding. */
export const bjCurrent = (s: BjState): BjHand | null => (s.active[s.turn] ? (s.boxes[s.turn]?.[s.hand] ?? null) : null);
export const bjCanDouble = (s: BjState) => {
  const h = bjCurrent(s);
  return !!h && h.cards.length === 2 && !h.done;
};
export const bjCanSplit = (s: BjState) => {
  const h = bjCurrent(s);
  return !!h && s.boxes[s.turn].length === 1 && h.cards.length === 2 && cardValue(h.cards[0]) === cardValue(h.cards[1]);
};

type Deck = { k: number; deck: string[] };

function takeCard(s: BjState, seed: string, d: Deck): string {
  // Rarely a big table with splits empties the deck: open another, shuffled.
  if (d.k >= d.deck.length) d.deck.push(...shuffledDeck(`${seed}#round${s.round}#more${d.deck.length}`));
  return d.deck[d.k++];
}

function dealRound(s: BjState, n: number, seed: string, d: Deck) {
  d.deck = shuffledDeck(`${seed}#round${s.round}`);
  d.k = 0;
  s.boxes = Array.from({ length: n }, (_, p) => (s.gone[p] ? [] : [{ cards: [], stake: 1, split: false, done: false }]));
  s.dealer = [];
  for (let i = 0; i < 2; i++) {
    for (let p = 0; p < n; p++) if (!s.gone[p]) s.boxes[p][0].cards.push(takeCard(s, seed, d));
    s.dealer.push(takeCard(s, seed, d));
  }
  // The dealer checks the hole card: a blackjack ends the round before anyone plays.
  const dealerBj = bjValue(s.dealer) === 21;
  s.active = s.boxes.map((b) => !dealerBj && b.length > 0 && !bjNatural(b[0]));
  s.settled = false;
  s.hand = 0;
  s.turn = s.active.findIndex(Boolean);
  if (s.turn < 0) s.turn = Math.max(0, s.gone.findIndex((g) => !g));
}

function settle(s: BjState, n: number, seed: string, d: Deck) {
  const dealerBj = s.dealer.length === 2 && bjValue(s.dealer) === 21;
  // The dealer only draws while someone still has a hand to beat.
  const live = s.boxes.some((b) => b.some((h) => bjValue(h.cards) <= 21 && !bjNatural(h)));
  if (!dealerBj && live) while (bjValue(s.dealer) < 17) s.dealer.push(takeCard(s, seed, d));
  const dv = bjValue(s.dealer);
  const results: BjResult[] = [];
  for (let p = 0; p < n; p++) {
    if (s.gone[p]) continue;
    const hands = s.boxes[p].map((h) => {
      const v = bjValue(h.cards);
      let delta = 0;
      let why = "";
      if (v > 21) {
        delta = -2 * h.stake;
        why = "bust";
      } else if (dealerBj) {
        if (bjNatural(h)) why = "push — blackjack each";
        else {
          delta = -2 * h.stake;
          why = "dealer blackjack";
        }
      } else if (bjNatural(h)) {
        delta = 3;
        why = "blackjack!";
      } else if (dv > 21) {
        delta = 2 * h.stake;
        why = "dealer bust";
      } else if (v > dv) {
        delta = 2 * h.stake;
        why = `${v} beats ${dv}`;
      } else if (v === dv) why = "push";
      else {
        delta = -2 * h.stake;
        why = `${dv} beats ${v}`;
      }
      if (h.stake > 1) why += " (doubled)";
      return { cards: [...h.cards], value: v, delta, why };
    });
    const delta = hands.reduce((a, h) => a + h.delta, 0);
    s.points[p] += delta;
    results.push({ player: p, hands, delta });
  }
  const sign = (x: number) => (x > 0 ? `+${x}` : x < 0 ? `−${-x}` : "0");
  s.results.push(`Round ${s.round}: dealer ${dealerBj ? "blackjack" : dv > 21 ? `bust (${dv})` : dv} · ${results.map((r) => `P${r.player + 1} ${r.hands.map((h) => h.why).join(" / ")} ${sign(r.delta)}`).join(", ")}`);
  s.lastRounds.push({ round: s.round, dealer: [...s.dealer], dealerValue: dv, dealerBlackjack: dealerBj, results });
  s.settled = true;
}

/** The hand in play is finished: the player's next hand, the next player, or the dealer. */
function advance(s: BjState, n: number, seed: string, d: Deck) {
  const box = s.boxes[s.turn] ?? [];
  const nextHand = box.findIndex((h, i) => i > s.hand && !h.done);
  if (s.active[s.turn] && nextHand >= 0) {
    s.hand = nextHand;
    // The second hand of a split may already stand on 21.
    checkHand(s, n, seed, d);
    return;
  }
  s.active[s.turn] = false;
  const nextActive = s.active.findIndex((a, i) => a && i > s.turn);
  if (nextActive >= 0) {
    s.turn = nextActive;
    s.hand = 0;
    return;
  }
  settle(s, n, seed, d);
  if (s.round >= BJ_ROUNDS) {
    s.over = true;
    return;
  }
  s.round++;
  dealRound(s, n, seed, d);
  // A dealer blackjack, or naturals all round → settle at once.
  if (!s.active.some(Boolean)) advance(s, n, seed, d);
}

/** Finishes the current hand at 21 or over (and moves on). */
function checkHand(s: BjState, n: number, seed: string, d: Deck) {
  const h = s.boxes[s.turn][s.hand];
  if (h.done || bjValue(h.cards) >= 21) {
    h.done = true;
    advance(s, n, seed, d);
  }
}

function outcome(s: BjState): Outcome {
  if (s.end) return s.end;
  if (!s.over) return ON;
  const still = s.points.map((_, i) => i).filter((i) => !s.gone[i]);
  const best = Math.max(...still.map((i) => s.points[i]));
  const tops = still.filter((i) => s.points[i] === best);
  return tops.length > 1 ? draw(`${best} points each`, s.points) : win(tops[0], `${best} points after ${BJ_ROUNDS} rounds`, s.points);
}

export const blackjack: GameDef<BjState> = {
  id: "blackjack",
  name: "Blackjack 21",
  blurb: "Hit or stand against the house; five rounds, most points wins.",
  emoji: "🂡",
  minPlayers: 1,
  maxPlayers: 6,
  replay(moves, n, seed) {
    const d: Deck = { k: 0, deck: [] };
    const s: BjState = { round: 1, boxes: [], dealer: [], active: [], turn: 0, hand: 0, settled: false, points: Array(n).fill(0), results: [], lastRounds: [], gone: Array(n).fill(false), end: null, over: false };
    dealRound(s, n, seed, d);
    if (!s.active.some(Boolean)) advance(s, n, seed, d);
    for (const m of moves) {
      if (s.over) return null;
      const left = leaver(m, n);
      if (left !== null) {
        if (left < 0 || s.gone[left]) return null;
        s.gone[left] = true;
        s.boxes[left] = [];
        const last = lastIn(s.gone, n);
        if (last !== null || s.gone.every(Boolean)) {
          s.over = true;
          s.end = last !== null ? win(last, "everyone else left", s.points) : { over: true, winner: null, draw: false, reason: "everyone left", scores: s.points };
          continue;
        }
        if (s.turn === left && s.active[left]) {
          // It was their turn: play moves on to the next seat (their hands are gone).
          s.hand = Number.MAX_SAFE_INTEGER;
          advance(s, n, seed, d);
        } else s.active[left] = false;
        continue;
      }
      const h = bjCurrent(s);
      if (!h) return null;
      s.lastRounds = []; // the next player acts: the last round's result can go
      if (m === "h") {
        h.cards.push(takeCard(s, seed, d));
        checkHand(s, n, seed, d);
        continue;
      }
      if (m === "s") {
        h.done = true;
        advance(s, n, seed, d);
        continue;
      }
      if (m === "d") {
        if (!bjCanDouble(s)) return null;
        h.stake *= 2;
        h.cards.push(takeCard(s, seed, d));
        h.done = true;
        advance(s, n, seed, d);
        continue;
      }
      if (m === "p") {
        if (!bjCanSplit(s)) return null;
        const [a, b] = h.cards;
        const aces = rankOf(a) === "A";
        const one: BjHand = { cards: [a, takeCard(s, seed, d)], stake: 1, split: true, done: aces };
        const two: BjHand = { cards: [b, takeCard(s, seed, d)], stake: 1, split: true, done: aces };
        s.boxes[s.turn] = [one, two];
        s.hand = 0;
        // Split aces take one card each; a hand of 21 needs nothing more.
        if (aces) {
          s.hand = 1;
          advance(s, n, seed, d);
          continue;
        }
        checkHand(s, n, seed, d);
        continue;
      }
      return null;
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s) => outcome(s),
  summary: (s) => `round ${s.round}/${BJ_ROUNDS} · ` + s.points.map((x, i) => `P${i + 1} ${s.gone[i] ? "left" : x}`).join(" · "),
};
