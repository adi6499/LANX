// Texas Hold'em, 2–8 players, 1000 chips each, blinds 10/20 (no real money:
// chips are just the score). Two cards each, then the flop, turn and river
// with a round of betting before each. Side pots are worked out when someone
// is all in. The game ends when one player holds every chip or after twenty
// hands — most chips wins.
//
// Moves by the player to act: "f" (fold), "c" (check or call), "r:<total>"
// (raise so your bet this round becomes <total>), "a" (all in).

import { ON, win, type GameDef, type Outcome } from "./core.ts";
import { bestHand, compareHands, shuffledDeck } from "./cards.ts";

export const HOLDEM_HANDS = 20;
const SMALL = 10;
const BIG = 20;

export interface HoldemState {
  hand: number;
  chips: number[];
  hole: string[][];
  board: string[];
  folded: boolean[];
  allin: boolean[];
  /** Out of chips for good. */
  out: boolean[];
  /** Bet this betting round, and in the whole hand. */
  bets: number[];
  contributed: number[];
  turn: number;
  button: number;
  /** 0 pre-flop, 1 flop, 2 turn, 3 river, 4 done. */
  street: number;
  toCall: number;
  minRaise: number;
  /** Who still has to act this round. */
  pending: boolean[];
  log: string[];
  /** The last showdown, for the board. */
  showdown: { player: number; cards: string[]; name: string; won: number }[];
  over: boolean;
  winner: number | null;
}

const alive = (s: HoldemState) => s.chips.map((_, i) => i).filter((i) => !s.out[i]);
const inHand = (s: HoldemState) => alive(s).filter((i) => !s.folded[i]);
const canAct = (s: HoldemState) => inHand(s).filter((i) => !s.allin[i]);

function nextFrom(_s: HoldemState, from: number, n: number, ok: (i: number) => boolean): number {
  for (let k = 1; k <= n; k++) {
    const q = (from + k) % n;
    if (ok(q)) return q;
  }
  return -1;
}

function startHand(s: HoldemState, n: number, seed: string, deck: { cards: string[]; k: number }) {
  deck.cards = shuffledDeck(`${seed}#hand${s.hand}`);
  deck.k = 0;
  const players = alive(s);
  s.hole = Array.from({ length: n }, () => []);
  s.board = [];
  s.folded = s.out.map((o) => o);
  s.allin = Array(n).fill(false);
  s.bets = Array(n).fill(0);
  s.contributed = Array(n).fill(0);
  s.street = 0;
  s.showdown = [];
  for (let i = 0; i < 2; i++) for (const p of players) s.hole[p].push(deck.cards[deck.k++]);
  s.button = nextFrom(s, s.button, n, (i) => !s.out[i]);
  const sb = players.length === 2 ? s.button : nextFrom(s, s.button, n, (i) => !s.out[i]);
  const bb = nextFrom(s, sb, n, (i) => !s.out[i]);
  post(s, sb, SMALL);
  post(s, bb, BIG);
  s.toCall = BIG;
  s.minRaise = BIG;
  s.pending = Array(n).fill(false);
  for (const p of canAct(s)) s.pending[p] = true;
  s.turn = nextFrom(s, bb, n, (i) => s.pending[i]);
  if (s.turn < 0) settle(s, n);
}

function post(s: HoldemState, p: number, amount: number) {
  const a = Math.min(amount, s.chips[p]);
  s.chips[p] -= a;
  s.bets[p] += a;
  s.contributed[p] += a;
  if (s.chips[p] === 0) s.allin[p] = true;
}

function nextStreet(s: HoldemState, n: number, deck: { cards: string[]; k: number }) {
  s.bets = Array(n).fill(0);
  s.toCall = 0;
  s.minRaise = BIG;
  s.street++;
  if (s.street === 1) s.board.push(deck.cards[deck.k++], deck.cards[deck.k++], deck.cards[deck.k++]);
  else if (s.street === 2 || s.street === 3) s.board.push(deck.cards[deck.k++]);
  if (s.street >= 4 || canAct(s).length <= 1) {
    while (s.board.length < 5) s.board.push(deck.cards[deck.k++]);
    settle(s, n);
    return;
  }
  s.pending = Array(n).fill(false);
  for (const p of canAct(s)) s.pending[p] = true;
  s.turn = nextFrom(s, s.button, n, (i) => s.pending[i]);
}

/** Pays out the pot (with side pots) and starts the next hand or ends the game. */
function settle(s: HoldemState, n: number) {
  const players = inHand(s);
  const won = Array(n).fill(0);
  if (players.length === 1) {
    const total = s.contributed.reduce((a, b) => a + b, 0);
    s.chips[players[0]] += total;
    won[players[0]] = total;
    s.log.push(`Hand ${s.hand}: P${players[0] + 1} takes ${total} (everyone else folded)`);
  } else {
    const ranks = new Map<number, ReturnType<typeof bestHand>>();
    for (const p of players) ranks.set(p, bestHand([...s.hole[p], ...s.board]));
    // Side pots: slice the contributions level by level.
    const levels = [...new Set(s.contributed.filter((c) => c > 0))].sort((a, b) => a - b);
    let prev = 0;
    for (const level of levels) {
      let pot = 0;
      for (let p = 0; p < n; p++) pot += Math.max(0, Math.min(s.contributed[p], level) - prev);
      const eligible = players.filter((p) => s.contributed[p] >= level);
      if (eligible.length && pot > 0) {
        let best = eligible[0];
        for (const p of eligible) if (compareHands(ranks.get(p)!, ranks.get(best)!) > 0) best = p;
        const winners = eligible.filter((p) => compareHands(ranks.get(p)!, ranks.get(best)!) === 0);
        const share = Math.floor(pot / winners.length);
        for (const w of winners) {
          s.chips[w] += share;
          won[w] += share;
        }
        s.chips[winners[0]] += pot - share * winners.length;
        won[winners[0]] += pot - share * winners.length;
      }
      prev = level;
    }
    s.showdown = players.map((p) => ({ player: p, cards: s.hole[p], name: ranks.get(p)!.name, won: won[p] }));
    s.log.push(`Hand ${s.hand}: ${players.map((p) => `P${p + 1} ${ranks.get(p)!.name}${won[p] ? ` +${won[p]}` : ""}`).join(", ")}`);
  }
  for (let p = 0; p < n; p++) if (s.chips[p] === 0) s.out[p] = true;
  s.street = 4;
  const left = alive(s);
  if (left.length === 1 || s.hand >= HOLDEM_HANDS) {
    s.over = true;
    s.winner = left.length === 1 ? left[0] : s.chips.indexOf(Math.max(...s.chips));
    return;
  }
  s.hand++; // the next hand is dealt by `replay` (it knows the seed)
}

function outcome(s: HoldemState): Outcome {
  if (!s.over || s.winner === null) return ON;
  return win(s.winner, `most chips (${s.chips[s.winner]})`, s.chips);
}

export const holdem: GameDef<HoldemState> = {
  id: "holdem",
  name: "Texas Hold'em",
  blurb: "Bluff and bet with chips that are only points; twenty hands.",
  emoji: "🂮",
  minPlayers: 2,
  maxPlayers: 8,
  replay(moves, n, seed) {
    const deck = { cards: [] as string[], k: 0 };
    const s: HoldemState = { hand: 1, chips: Array(n).fill(1000), hole: [], board: [], folded: [], allin: [], out: Array(n).fill(false), bets: [], contributed: [], turn: 0, button: n - 1, street: 0, toCall: 0, minRaise: BIG, pending: [], log: [], showdown: [], over: false, winner: null };
    // `settle` cannot see the seed, so wrap hand starts here.
    const begin = () => startHand(s, n, seed, deck);
    begin();
    const after = () => {
      if (!s.over && s.street === 4) begin();
    };
    after();
    for (const m of moves) {
      if (s.over || s.street === 4) return null;
      const p = s.turn;
      if (!s.pending[p]) return null;
      const call = Math.min(s.toCall - s.bets[p], s.chips[p]);
      if (m === "f") {
        s.folded[p] = true;
        s.pending[p] = false;
      } else if (m === "c") {
        post(s, p, call);
        s.pending[p] = false;
      } else if (m === "a") {
        const all = s.chips[p];
        const total = s.bets[p] + all;
        post(s, p, all);
        s.pending[p] = false;
        if (total > s.toCall) {
          s.minRaise = Math.max(s.minRaise, total - s.toCall);
          s.toCall = total;
          for (const q of canAct(s)) if (q !== p) s.pending[q] = true;
        }
      } else {
        const r = /^r:(\d+)$/.exec(m);
        if (!r) return null;
        const total = Number(r[1]);
        const add = total - s.bets[p];
        if (total < s.toCall + s.minRaise || add > s.chips[p]) return null;
        s.minRaise = total - s.toCall;
        post(s, p, add);
        s.toCall = total;
        s.pending[p] = false;
        for (const q of canAct(s)) if (q !== p) s.pending[q] = true;
      }
      if (inHand(s).length === 1) {
        settle(s, n);
        after();
        continue;
      }
      const next = nextFrom(s, p, n, (i) => s.pending[i] && !s.folded[i] && !s.allin[i]);
      if (next < 0) {
        nextStreet(s, n, deck);
        while (!s.over && s.street < 4 && canAct(s).length <= 1) nextStreet(s, n, deck);
        after();
      } else s.turn = next;
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s) => outcome(s),
  summary: (s) => `hand ${s.hand}/${HOLDEM_HANDS} · ` + s.chips.map((c, i) => `P${i + 1} ${s.out[i] ? "out" : c}`).join(" · "),
};
