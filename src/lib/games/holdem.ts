// Texas Hold'em, 2–8 players, 1000 chips each, blinds 10/20 (no real money:
// chips are just the score). Two cards each, then the flop, turn and river
// with a round of betting before each. Side pots are worked out when someone
// is all in. The game ends when one player holds every chip or after twenty
// hands — most chips wins (level chips: a draw).
//
// Moves by the player to act: "f" (fold), "c" (check or call), "r:<total>"
// (raise so your bet this round becomes <total>), "a" (all in). An all-in
// that is less than a full raise does not reopen the betting: whoever had
// already acted may then only call or fold. "x<p>" (LANX 2.17.0): player p
// left the table — they fold and are out from then on.

import { ON, draw, leaver, win, type GameDef, type Outcome } from "./core.ts";
import { bestHand, compareHands, shuffledDeck } from "./cards.ts";

export const HOLDEM_HANDS = 20;
const SMALL = 10;
const BIG = 20;

/** One player's cards at a showdown. */
export interface HoldemShown {
  player: number;
  cards: string[];
  name: string;
  won: number;
}

/** The hand just finished, for the board until the next action. */
export interface HoldemLast {
  hand: number;
  board: string[];
  /** Everyone who showed their cards (empty when the rest folded). */
  shown: HoldemShown[];
  /** Chips won per player. */
  won: number[];
  /** With players as "P<n>": "P2 takes 60 — everyone else folded". */
  text: string;
}

export interface HoldemState {
  hand: number;
  chips: number[];
  hole: string[][];
  board: string[];
  folded: boolean[];
  allin: boolean[];
  /** Out of chips for good (or left the table). */
  out: boolean[];
  /** Left the table (LANX 2.17.0). */
  gone: boolean[];
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
  /** Facing only a short all-in after acting: may call or fold, not raise. */
  capped: boolean[];
  log: string[];
  /** The last hand's result (the showdown, or who took it), until the next action. */
  last: HoldemLast | null;
  over: boolean;
  winner: number | null;
  /** Level chips at the end. */
  tie: boolean;
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

type Deck = { cards: string[]; k: number };

const runOut = (s: HoldemState, deck: Deck) => {
  while (s.board.length < 5) s.board.push(deck.cards[deck.k++]);
};

function startHand(s: HoldemState, n: number, seed: string, deck: Deck) {
  deck.cards = shuffledDeck(`${seed}#hand${s.hand}`);
  deck.k = 0;
  const players = alive(s);
  s.hole = Array.from({ length: n }, () => []);
  s.board = [];
  s.folded = s.out.map((o) => o);
  s.allin = Array(n).fill(false);
  s.bets = Array(n).fill(0);
  s.contributed = Array(n).fill(0);
  s.capped = Array(n).fill(false);
  s.street = 0;
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
  if (s.turn < 0) {
    // Everyone is all in from the blinds: deal the whole board, then show down.
    runOut(s, deck);
    settle(s, n);
  }
}

function post(s: HoldemState, p: number, amount: number) {
  const a = Math.min(amount, s.chips[p]);
  s.chips[p] -= a;
  s.bets[p] += a;
  s.contributed[p] += a;
  if (s.chips[p] === 0) s.allin[p] = true;
}

function nextStreet(s: HoldemState, n: number, deck: Deck) {
  s.bets = Array(n).fill(0);
  s.toCall = 0;
  s.minRaise = BIG;
  s.capped = Array(n).fill(false);
  s.street++;
  if (s.street === 1) s.board.push(deck.cards[deck.k++], deck.cards[deck.k++], deck.cards[deck.k++]);
  else if (s.street === 2 || s.street === 3) s.board.push(deck.cards[deck.k++]);
  if (s.street >= 4 || canAct(s).length <= 1) {
    runOut(s, deck);
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
  const total = s.contributed.reduce((a, b) => a + b, 0);
  if (players.length === 1) {
    s.chips[players[0]] += total;
    won[players[0]] = total;
    const text = `Hand ${s.hand}: P${players[0] + 1} takes ${total} — everyone else folded`;
    s.log.push(text);
    s.last = { hand: s.hand, board: [...s.board], shown: [], won, text };
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
    const shown = players.map((p) => ({ player: p, cards: [...s.hole[p]], name: ranks.get(p)!.name, won: won[p] }));
    const text = `Hand ${s.hand}: ${players.map((p) => `P${p + 1} ${ranks.get(p)!.name}${won[p] ? ` +${won[p]}` : ""}`).join(", ")}`;
    s.log.push(text);
    s.last = { hand: s.hand, board: [...s.board], shown, won, text };
  }
  for (let p = 0; p < n; p++) if (s.chips[p] === 0) s.out[p] = true;
  s.street = 4;
  const left = alive(s);
  if (left.length <= 1 || s.hand >= HOLDEM_HANDS) {
    s.over = true;
    const most = Math.max(...left.map((p) => s.chips[p]));
    const tops = left.filter((p) => s.chips[p] === most);
    s.winner = tops.length === 1 ? tops[0] : null;
    s.tie = tops.length > 1;
    return;
  }
  s.hand++; // the next hand is dealt by `replay` (it knows the seed)
}

function outcome(s: HoldemState): Outcome {
  if (!s.over) return ON;
  const scores = s.chips.map((c, i) => (s.gone[i] ? 0 : c));
  if (s.tie) {
    const most = Math.max(...alive(s).map((p) => s.chips[p]));
    return draw(`${most} chips each`, scores);
  }
  if (s.winner === null) return ON;
  const n = s.chips.length;
  const reason = alive(s).length > 1 ? `most chips (${s.chips[s.winner]})` : s.gone.filter(Boolean).length === n - 1 ? "everyone else left" : `the last one with chips (${s.chips[s.winner]})`;
  return win(s.winner, reason, scores);
}

/** What the player to act may do: the call, and whether (and how far) they may raise. */
export function holdemOptions(s: HoldemState) {
  const p = s.turn;
  const bet = s.bets[p] ?? 0;
  const chips = s.chips[p] ?? 0;
  const call = Math.max(0, Math.min(s.toCall - bet, chips));
  const minTo = s.toCall + s.minRaise;
  const maxTo = bet + chips;
  const capped = !!s.capped[p];
  return { call, minTo, maxTo, canRaise: !capped && maxTo >= minTo, canAllIn: chips > 0 && (!capped || maxTo <= s.toCall) };
}

export const holdem: GameDef<HoldemState> = {
  id: "holdem",
  name: "Texas Hold'em",
  blurb: "Bluff and bet with chips that are only points; twenty hands.",
  emoji: "🂮",
  minPlayers: 2,
  maxPlayers: 8,
  replay(moves, n, seed) {
    const deck: Deck = { cards: [], k: 0 };
    const s: HoldemState = {
      hand: 1, chips: Array(n).fill(1000), hole: [], board: [], folded: [], allin: [], out: Array(n).fill(false), gone: Array(n).fill(false), bets: [], contributed: [],
      turn: 0, button: n - 1, street: 0, toCall: 0, minRaise: BIG, pending: [], capped: [], log: [], last: null, over: false, winner: null, tie: false,
    };
    // `settle` cannot see the seed, so wrap hand starts here.
    const begin = () => startHand(s, n, seed, deck);
    const after = () => {
      while (!s.over && s.street === 4) begin();
    };
    begin();
    after();
    /** After someone acted (or left): the next to act, the next street, or the next hand. */
    const moveOn = (from: number) => {
      if (inHand(s).length <= 1) {
        settle(s, n);
        after();
        return;
      }
      const next = nextFrom(s, from, n, (i) => s.pending[i] && !s.folded[i] && !s.allin[i]);
      if (next < 0) {
        nextStreet(s, n, deck);
        while (!s.over && s.street < 4 && canAct(s).length <= 1) nextStreet(s, n, deck);
        after();
      } else s.turn = next;
    };
    for (const m of moves) {
      if (s.over) return null;
      const left = leaver(m, n);
      if (left !== null) {
        if (left < 0 || s.gone[left]) return null;
        s.gone[left] = true;
        s.log.push(`P${left + 1} left the table`);
        if (s.out[left]) continue; // already out of chips
        // They fold; what they bet stays in the pot.
        const wasTurn = s.turn === left;
        s.folded[left] = true;
        s.pending[left] = false;
        s.out[left] = true;
        if (wasTurn || inHand(s).length <= 1) moveOn(left);
        else if (!canAct(s).some((q) => s.pending[q])) moveOn(s.turn);
        continue;
      }
      if (s.street === 4) return null;
      const p = s.turn;
      if (!s.pending[p]) return null;
      s.last = null; // the next action: the last hand's result can go
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
        if (s.capped[p] && total > s.toCall) return null; // may only call or fold
        post(s, p, all);
        s.pending[p] = false;
        if (total > s.toCall) {
          const raise = total - s.toCall;
          // A full raise reopens the betting for everyone; a short all-in only asks the others to call it.
          const full = raise >= s.minRaise;
          if (full) s.minRaise = raise;
          s.toCall = total;
          for (const q of canAct(s)) {
            if (q === p) continue;
            if (full) s.capped[q] = false;
            else if (!s.pending[q]) s.capped[q] = true;
            s.pending[q] = true;
          }
        }
      } else {
        const r = /^r:(\d+)$/.exec(m);
        if (!r || s.capped[p]) return null;
        const total = Number(r[1]);
        const add = total - s.bets[p];
        if (total < s.toCall + s.minRaise || add > s.chips[p]) return null;
        s.minRaise = total - s.toCall;
        post(s, p, add);
        s.toCall = total;
        s.pending[p] = false;
        for (const q of canAct(s)) {
          if (q === p) continue;
          s.pending[q] = true;
          s.capped[q] = false;
        }
      }
      moveOn(p);
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s) => outcome(s),
  summary: (s) => `hand ${s.hand}/${HOLDEM_HANDS} · ` + s.chips.map((c, i) => `P${i + 1} ${s.gone[i] ? "left" : s.out[i] ? "out" : c}`).join(" · "),
};
