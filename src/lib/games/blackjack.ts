// Blackjack 21, 1–6 players against the house (the match deals). Five
// rounds: everyone gets two cards, the dealer shows one. In turn, Hit or
// Stand; over 21 is bust. Then the dealer draws to 17. Beat the dealer for
// a point (two for a natural 21), lose one if the dealer beats you, nothing
// on a tie. Most points after five rounds wins.
// Moves: "h" (hit) or "s" (stand) by the player to act.

import { ON, draw, win, type GameDef, type Outcome } from "./core.ts";
import { rankOf, shuffledDeck } from "./cards.ts";

export const BJ_ROUNDS = 5;

export interface BjState {
  round: number;
  hands: string[][];
  dealer: string[];
  /** Per player: still deciding this round. */
  active: boolean[];
  turn: number;
  /** True once the dealer has played out the round. */
  settled: boolean;
  points: number[];
  /** Round results for the board. */
  results: string[];
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

function dealRound(s: BjState, n: number, seed: string, deckPos: { k: number; deck: string[] }) {
  deckPos.deck = shuffledDeck(`${seed}#round${s.round}`);
  deckPos.k = 0;
  s.hands = Array.from({ length: n }, () => []);
  s.dealer = [];
  for (let i = 0; i < 2; i++) {
    for (let p = 0; p < n; p++) s.hands[p].push(deckPos.deck[deckPos.k++]);
    s.dealer.push(deckPos.deck[deckPos.k++]);
  }
  s.active = s.hands.map((h) => bjValue(h) !== 21);
  s.settled = false;
  s.turn = s.active.findIndex(Boolean);
  if (s.turn < 0) s.turn = 0;
}

function settle(s: BjState, n: number, deckPos: { k: number; deck: string[] }) {
  while (bjValue(s.dealer) < 17) s.dealer.push(deckPos.deck[deckPos.k++]);
  const d = bjValue(s.dealer);
  const lines: string[] = [];
  for (let p = 0; p < n; p++) {
    const v = bjValue(s.hands[p]);
    let delta = 0;
    let why = "";
    if (v > 21) {
      delta = -1;
      why = "bust";
    } else if (s.hands[p].length === 2 && v === 21 && !(s.dealer.length === 2 && d === 21)) {
      delta = 2;
      why = "blackjack!";
    } else if (d > 21 || v > d) {
      delta = 1;
      why = d > 21 ? "dealer bust" : `${v} beats ${d}`;
    } else if (v === d) why = "push";
    else {
      delta = -1;
      why = `${d} beats ${v}`;
    }
    s.points[p] += delta;
    lines.push(`P${p + 1}: ${why} (${delta > 0 ? "+" : ""}${delta})`);
  }
  s.results.push(`Round ${s.round}: ${lines.join(", ")}`);
  s.settled = true;
}

function advance(s: BjState, n: number, seed: string, deckPos: { k: number; deck: string[] }) {
  const nextActive = s.active.findIndex((a, i) => a && i > s.turn);
  if (nextActive >= 0) {
    s.turn = nextActive;
    return;
  }
  settle(s, n, deckPos);
  if (s.round >= BJ_ROUNDS) {
    s.over = true;
    return;
  }
  s.round++;
  dealRound(s, n, seed, deckPos);
  // Everyone standing pat (naturals) → settle at once.
  if (!s.active.some(Boolean)) advance(s, n, seed, deckPos);
}

function outcome(s: BjState): Outcome {
  if (!s.over) return ON;
  const best = Math.max(...s.points);
  const tops = s.points.map((x, i) => (x === best ? i : -1)).filter((i) => i >= 0);
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
    const deckPos = { k: 0, deck: [] as string[] };
    const s: BjState = { round: 1, hands: [], dealer: [], active: [], turn: 0, settled: false, points: Array(n).fill(0), results: [], over: false };
    dealRound(s, n, seed, deckPos);
    if (!s.active.some(Boolean)) advance(s, n, seed, deckPos);
    for (const m of moves) {
      if (s.over || !s.active[s.turn]) return null;
      if (m === "h") {
        s.hands[s.turn].push(deckPos.deck[deckPos.k++]);
        const v = bjValue(s.hands[s.turn]);
        if (v >= 21) {
          s.active[s.turn] = false;
          advance(s, n, seed, deckPos);
        }
        continue;
      }
      if (m === "s") {
        s.active[s.turn] = false;
        advance(s, n, seed, deckPos);
        continue;
      }
      return null;
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s) => outcome(s),
  summary: (s) => `round ${s.round}/${BJ_ROUNDS} · ` + s.points.map((x, i) => `P${i + 1} ${x}`).join(" · "),
};
