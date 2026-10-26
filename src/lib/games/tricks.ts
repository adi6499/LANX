// Trick-taking games for four players: Hearts, Spades and Euchre. They
// share the trick engine here; each sets its own deck, bidding, scoring and
// end. Hands come from the match seed; your PC only shows yours.
//
// Moves: "p:<card>" plays a card; Spades bids with "b:<n>" (n 0..13, 0 =
// nil); Euchre picks trump with "o" (order up), "x" (pass), "t:<suit>".

import { ON, draw, win, type GameDef, type Outcome } from "./core.ts";
import { RANKS, SUITS, deal, rankOf, rankValue, shuffledDeck, suitOf, trickWinner } from "./cards.ts";

export interface TrickState {
  round: number;
  hands: string[][];
  /** Cards on the table this trick. */
  trick: { player: number; card: string }[];
  /** Who leads the current trick. */
  leader: number;
  turn: number;
  /** Tricks won this round, per player. */
  won: number[];
  /** Cards taken this round, per player (for Hearts points). */
  taken: string[][];
  scores: number[];
  /** Hearts: a heart has been played. Spades: a spade has been played. */
  broken: boolean;
  /** Spades: bids per player this round (-1 = not yet). */
  bids: number[];
  bags: number[];
  /** Euchre: trump suit, the turned-up card, who called, the dealer, and the tricks of the calling team. */
  trump: string | null;
  upcard: string | null;
  caller: number;
  dealer: number;
  /** Euchre: 0 = ordering round, 1 = naming round, 2 = playing. */
  phase: number;
  lastTrick: { player: number; card: string }[];
  lastWinner: number;
  over: boolean;
  log: string[];
}

type Rules = {
  deck: () => string[];
  per: number;
  target: number;
  /** Trump suit for the round (null in Hearts); Euchre sets it during bidding. */
  trumpOf: (s: TrickState) => string | null;
  value: (s: TrickState) => (c: string) => number;
  /** The first leader of the round and any opening rule. */
  startRound: (s: TrickState, n: number) => void;
  mayLead: (s: TrickState, card: string) => boolean;
  /** Ends the round: scoring and whether the game is over. */
  endRound: (s: TrickState, n: number) => void;
  outcome: (s: TrickState, n: number) => Outcome;
};

function newRound(s: TrickState, n: number, seed: string, r: Rules) {
  const deck = shuffledDeck(`${seed}#round${s.round}`, r.deck());
  const { hands, rest } = deal(deck, n, r.per);
  s.hands = hands.map((h) => [...h]);
  s.trick = [];
  s.won = Array(n).fill(0);
  s.taken = Array.from({ length: n }, () => []);
  s.broken = false;
  s.bids = Array(n).fill(-1);
  s.trump = null;
  s.upcard = rest[0] ?? null;
  s.caller = -1;
  s.phase = 2;
  s.lastTrick = [];
  r.startRound(s, n);
}

/** The cards `player` may play now. */
export function trickPlayable(s: TrickState, player: number, r: Rules): string[] {
  const hand = s.hands[player];
  if (!s.trick.length) {
    const ok = hand.filter((c) => r.mayLead(s, c));
    return ok.length ? ok : hand;
  }
  const led = suitOf(s.trick[0].card);
  const trump = r.trumpOf(s);
  // Euchre: the left bower counts as trump.
  const suitFor = (c: string) => (trump && isLeftBower(c, trump) ? trump : suitOf(c));
  const follow = hand.filter((c) => suitFor(c) === (trump && isLeftBower(s.trick[0].card, trump) ? trump : led));
  return follow.length ? follow : hand;
}

const isLeftBower = (c: string, trump: string) => rankOf(c) === "J" && suitOf(c) !== trump && sameColour(suitOf(c), trump);
const sameColour = (a: string, b: string) => (a === "S" || a === "C") === (b === "S" || b === "C");

function playCard(s: TrickState, n: number, seed: string, r: Rules, card: string): boolean {
  const p = s.turn;
  if (!trickPlayable(s, p, r).includes(card)) return false;
  s.hands[p] = s.hands[p].filter((c) => c !== card);
  s.trick.push({ player: p, card });
  if (suitOf(card) === "H" || suitOf(card) === "S") s.broken = s.broken || (r.deck().length === 52 ? suitOf(card) === (r.trumpOf(s) ? "S" : "H") : false);
  if (s.trick.length < n) {
    s.turn = (p + 1) % n;
    return true;
  }
  const trump = r.trumpOf(s);
  const winner = trickWinner(
    s.trick.map((t) => ({ player: t.player, card: trump && isLeftBower(t.card, trump) ? `J${trump}` : t.card })),
    trump,
    r.value(s),
  );
  s.won[winner]++;
  s.taken[winner].push(...s.trick.map((t) => t.card));
  s.lastTrick = s.trick;
  s.lastWinner = winner;
  s.trick = [];
  s.leader = winner;
  s.turn = winner;
  if (s.hands.every((h) => h.length === 0)) {
    r.endRound(s, n);
    if (!s.over) {
      s.round++;
      s.dealer = (s.dealer + 1) % n;
      newRound(s, n, seed, r);
    }
  }
  return true;
}

function makeDef(id: string, name: string, blurb: string, emoji: string, r: Rules, extra?: (s: TrickState, n: number, m: string) => boolean | null): GameDef<TrickState> {
  return {
    id,
    name,
    blurb,
    emoji,
    minPlayers: 4,
    maxPlayers: 4,
    replay(moves, n, seed) {
      const s: TrickState = { round: 1, hands: [], trick: [], leader: 0, turn: 0, won: [], taken: [], scores: Array(n).fill(0), broken: false, bids: [], bags: Array(n).fill(0), trump: null, upcard: null, caller: -1, dealer: 0, phase: 2, lastTrick: [], lastWinner: -1, over: false, log: [] };
      newRound(s, n, seed, r);
      for (const m of moves) {
        if (s.over) return null;
        if (extra) {
          const handled = extra(s, n, m);
          if (handled === null) return null;
          if (handled) {
            if (!s.over && s.hands.every((h) => h.length === 0) && s.phase === 2) {
              r.endRound(s, n);
              if (!s.over) {
                s.round++;
                s.dealer = (s.dealer + 1) % n;
                newRound(s, n, seed, r);
              }
            }
            continue;
          }
        }
        const mv = /^p:([2-9TJQKA][SHDC])$/.exec(m);
        if (!mv || s.phase !== 2) return null;
        if (!playCard(s, n, seed, r, mv[1])) return null;
      }
      return s;
    },
    turn: (s) => s.turn,
    outcome: (s, n) => r.outcome(s, n),
    summary: (s) => `round ${s.round} · ` + s.scores.map((x, i) => `P${i + 1} ${x}`).join(" · "),
  };
}

// ---------------------------------------------------------------- Hearts

const heartsPoints = (cards: string[]) => cards.reduce((a, c) => a + (suitOf(c) === "H" ? 1 : c === "QS" ? 13 : 0), 0);

const heartsRules: Rules = {
  deck: () => {
    const out: string[] = [];
    for (const su of SUITS) for (const ra of RANKS) out.push(ra + su);
    return out;
  },
  per: 13,
  target: 100,
  trumpOf: () => null,
  value: () => rankValue,
  startRound: (s) => {
    const who = s.hands.findIndex((h) => h.includes("2C"));
    s.leader = who < 0 ? 0 : who;
    s.turn = s.leader;
  },
  mayLead: (s, c) => (s.round >= 1 && s.won.every((w) => w === 0) && s.trick.length === 0 && s.hands[s.turn].includes("2C") ? c === "2C" : suitOf(c) !== "H" || s.broken),
  endRound: (s, n) => {
    const pts = s.taken.map(heartsPoints);
    const moon = pts.findIndex((x) => x === 26);
    for (let p = 0; p < n; p++) s.scores[p] += moon >= 0 ? (p === moon ? 0 : 26) : pts[p];
    s.log.push(`Round ${s.round}: ${moon >= 0 ? `P${moon + 1} shot the moon!` : pts.map((x, i) => `P${i + 1} +${x}`).join(", ")}`);
    if (s.scores.some((x) => x >= 100)) s.over = true;
  },
  outcome: (s, _n) => {
    if (!s.over) return ON;
    const best = Math.min(...s.scores);
    const tops = s.scores.map((x, i) => (x === best ? i : -1)).filter((i) => i >= 0);
    return tops.length > 1 ? draw(`${best} points each`, s.scores) : win(tops[0], `fewest points (${best})`, s.scores);
  },
};

export const hearts = makeDef("hearts", "Hearts", "Avoid the hearts and the queen of spades; lowest score wins.", "♥️", {
  ...heartsRules,
  mayLead: (s, c) => {
    const first = s.won.every((w) => w === 0) && s.trick.length === 0 && s.taken.every((t) => t.length === 0);
    if (first) return c === "2C";
    return suitOf(c) !== "H" || s.broken || s.hands[s.turn].every((x) => suitOf(x) === "H");
  },
});

// ---------------------------------------------------------------- Spades

const spadesRules: Rules = {
  deck: heartsRules.deck,
  per: 13,
  target: 500,
  trumpOf: () => "S",
  value: () => rankValue,
  startRound: (s, n) => {
    s.phase = 0; // bidding
    s.leader = (s.dealer + 1) % n;
    s.turn = s.leader;
  },
  mayLead: (s, c) => suitOf(c) !== "S" || s.broken || s.hands[s.turn].every((x) => suitOf(x) === "S"),
  endRound: (s, n) => {
    // Teams 0+2 and 1+3.
    for (const team of [[0, 2], [1, 3]]) {
      const bid = team.reduce((a, p) => a + Math.max(0, s.bids[p]), 0);
      const tricks = team.reduce((a, p) => a + s.won[p], 0);
      let pts = 0;
      if (tricks >= bid) {
        pts = bid * 10 + (tricks - bid);
        s.bags[team[0]] += tricks - bid;
        if (s.bags[team[0]] >= 10) {
          pts -= 100;
          s.bags[team[0]] -= 10;
        }
      } else pts = -bid * 10;
      for (const p of team) if (s.bids[p] === 0) pts += s.won[p] === 0 ? 100 : -100;
      for (const p of team) s.scores[p] += pts;
    }
    s.log.push(`Round ${s.round}: team 1+3 ${s.scores[0]}, team 2+4 ${s.scores[1]}`);
    if (s.scores[0] >= 500 || s.scores[1] >= 500) s.over = true;
    void n;
  },
  outcome: (s) => {
    if (!s.over) return ON;
    if (s.scores[0] === s.scores[1]) return draw("level scores", s.scores);
    const team = s.scores[0] > s.scores[1] ? 0 : 1;
    return win(team, `team ${team === 0 ? "1 + 3" : "2 + 4"} reaches ${Math.max(s.scores[0], s.scores[1])}`, s.scores);
  },
};

export const spades = makeDef("spades", "Spades", "Partners across the table bid their tricks; spades always trump.", "♠️", spadesRules, (s, n, m) => {
  const bid = /^b:(\d+)$/.exec(m);
  if (s.phase === 0) {
    if (!bid) return null;
    const v = Number(bid[1]);
    if (v < 0 || v > 13 || s.bids[s.turn] >= 0) return null;
    s.bids[s.turn] = v;
    s.turn = (s.turn + 1) % n;
    if (s.bids.every((b) => b >= 0)) {
      s.phase = 2;
      s.turn = s.leader;
    }
    return true;
  }
  return bid ? null : false;
});

// ---------------------------------------------------------------- Euchre

const EUCHRE_RANKS = ["9", "T", "J", "Q", "K", "A"];
const euchreValue = (s: TrickState) => (c: string) => {
  const t = s.trump;
  if (t && rankOf(c) === "J" && suitOf(c) === t) return 100; // right bower
  if (t && isLeftBower(c, t)) return 99; // left bower (already mapped to trump suit by the engine)
  return rankValue(c);
};

const euchreRules: Rules = {
  deck: () => {
    const out: string[] = [];
    for (const su of SUITS) for (const ra of EUCHRE_RANKS) out.push(ra + su);
    return out;
  },
  per: 5,
  target: 10,
  trumpOf: (s) => s.trump,
  value: euchreValue,
  startRound: (s, n) => {
    s.phase = 0; // ordering up the turned card
    s.leader = (s.dealer + 1) % n;
    s.turn = s.leader;
  },
  mayLead: () => true,
  endRound: (s, n) => {
    const callerTeam = s.caller % 2;
    const tricks = [0, 1].map((t) => s.won.reduce((a, w, p) => a + (p % 2 === t ? w : 0), 0));
    let pts = 0;
    let team = callerTeam;
    if (tricks[callerTeam] === 5) pts = 2;
    else if (tricks[callerTeam] >= 3) pts = 1;
    else {
      team = 1 - callerTeam;
      pts = 2; // euchred
    }
    for (let p = 0; p < n; p++) if (p % 2 === team) s.scores[p] += pts;
    s.log.push(`Round ${s.round}: team ${team + 1} +${pts}${team !== callerTeam ? " (euchred!)" : ""}`);
    if (s.scores[0] >= 10 || s.scores[1] >= 10) s.over = true;
  },
  outcome: (s) => {
    if (!s.over) return ON;
    const team = s.scores[0] > s.scores[1] ? 0 : 1;
    return win(team, `team ${team === 0 ? "1 + 3" : "2 + 4"} reaches ${s.scores[team]}`, s.scores);
  },
};

export const euchre = makeDef("euchre", "Euchre", "Fast partnership tricks with bowers; first team to ten.", "🃑", euchreRules, (s, n, m) => {
  if (s.phase === 2) return /^(o|x|t:)/.test(m) ? null : false;
  if (s.phase === 0) {
    if (m === "o") {
      s.trump = suitOf(s.upcard!);
      s.caller = s.turn;
      // The dealer picks up the card and discards their lowest other card.
      const d = s.dealer;
      s.hands[d].push(s.upcard!);
      const low = [...s.hands[d]].sort((a, b) => euchreValue(s)(a) - euchreValue(s)(b))[0];
      s.hands[d] = s.hands[d].filter((c) => c !== low);
      s.phase = 2;
      s.turn = s.leader;
      return true;
    }
    if (m === "x") {
      s.turn = (s.turn + 1) % n;
      if (s.turn === s.leader) s.phase = 1; // everyone passed: name a suit
      return true;
    }
    return null;
  }
  // phase 1: name a suit (not the turned one) or pass; if all pass, the deal moves on.
  const t = /^t:([SHDC])$/.exec(m);
  if (t) {
    if (s.upcard && t[1] === suitOf(s.upcard)) return null;
    s.trump = t[1];
    s.caller = s.turn;
    s.phase = 2;
    s.turn = s.leader;
    return true;
  }
  if (m === "x") {
    s.turn = (s.turn + 1) % n;
    if (s.turn === s.leader) {
      // Throw the hand in: redeal.
      s.round++;
      s.dealer = (s.dealer + 1) % n;
      s.hands = s.hands.map(() => []); // the engine re-deals below
      s.phase = 2;
      s.log.push("Everyone passed twice — new deal");
    }
    return true;
  }
  return null;
});

export const TRICK_RULES = { hearts: heartsRules, spades: spadesRules, euchre: euchreRules };
