// Trick-taking games for four players: Hearts, Spades and Euchre. They
// share the trick engine here; each sets its own deck, bidding, scoring and
// end. Hands come from the match seed; your PC only shows yours.
//
// Moves: "p:<card>" plays a card. Hearts first passes three cards with
// "g:<c1>,<c2>,<c3>" (to the left, the right, across, then no pass, turn
// about). Spades bids with "b:<n>" (n 0..13, 0 = nil). Euchre: "o" orders the
// turned card up ("o:a" to go alone), "x" passes, "t:<suit>" names trump
// ("t:<suit>:a" alone), "d:<card>" is the dealer's discard after picking up.
// LANX 2.17.0: "x<p>" — player p left the table. Spades and Euchre are
// partnerships, so the other team wins; Hearts ends and the lowest score of
// those still in wins.

import { ON, draw, leaver, teamWin, win, type GameDef, type Outcome } from "./core.ts";
import { RANKS, SUITS, cardText, deal, rankOf, rankValue, shuffledDeck, suitOf, trickWinner } from "./cards.ts";

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
  /** Euchre: trump suit, the turned-up card, who called, the dealer. */
  trump: string | null;
  upcard: string | null;
  caller: number;
  dealer: number;
  /** 0 = bidding (Spades) or ordering up (Euchre), 1 = naming trump (Euchre), 2 = playing,
   *  3 = passing three cards (Hearts), 4 = the dealer's discard (Euchre). */
  phase: number;
  /** The last finished trick and who took it (kept across a new deal, so the board can show it). */
  lastTrick: { player: number; card: string }[];
  lastWinner: number;
  /** Hearts: the cards each player passes this round (null = not chosen yet), and where they go:
   *  1 = to the left (the next player), 3 = to the right, 2 = across, 0 = no pass this round. */
  passing: (string[] | null)[];
  passTo: number;
  /** Hearts: the cards each player was passed, until they play their first card. */
  received: string[][];
  /** Euchre: the maker plays alone and their partner sits this hand out (-1 = nobody sits out). */
  alone: boolean;
  sitOut: number;
  /** LANX 2.17.0: players who left the table, and how the game ended when someone did. */
  gone: boolean[];
  result: Outcome | null;
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
  /** Which suit a card counts as (Euchre: the left bower is a trump). */
  suit?: (s: TrickState) => (c: string) => string;
  /** The suit whose first card "breaks" it for leading (Hearts ♥, Spades ♠). */
  breaks?: string;
  /** The first leader of the round and any opening rule. */
  startRound: (s: TrickState, n: number) => void;
  mayLead: (s: TrickState, card: string, player: number) => boolean;
  /** Narrows the cards a player may play once the lead rules and following suit are applied. */
  follow?: (s: TrickState, player: number, cards: string[]) => string[];
  /** Ends the round: scoring and whether the game is over. */
  endRound: (s: TrickState, n: number) => void;
  outcome: (s: TrickState, n: number) => Outcome;
  /** Player p left the table: the game ends here. */
  leave: (s: TrickState, n: number, p: number) => void;
};

/** Partners sit across: P1 + P3 and P2 + P4. */
export const partnerOf = (p: number) => (p + 2) % 4;
export const teamText = (team: number) => (team % 2 === 0 ? "P1+P3" : "P2+P4");
const teamPlayers = (team: number) => (team % 2 === 0 ? [0, 2] : [1, 3]);

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
  s.passing = Array(n).fill(null);
  s.passTo = 0;
  s.received = Array.from({ length: n }, () => []);
  s.alone = false;
  s.sitOut = -1;
  r.startRound(s, n);
}

/** The next deal: the deal moves one seat on. */
function nextDeal(s: TrickState, n: number, seed: string, r: Rules) {
  s.round++;
  s.dealer = (s.dealer + 1) % n;
  newRound(s, n, seed, r);
}

/** The next player round the table who plays this hand (Euchre: not the lone maker's partner). */
const nextPlaying = (s: TrickState, p: number, n: number) => {
  let q = (p + 1) % n;
  if (q === s.sitOut) q = (q + 1) % n;
  return q;
};

/** The cards `player` may play now. */
export function trickPlayable(s: TrickState, player: number, r: Rules): string[] {
  const hand = s.hands[player] ?? [];
  if (player === s.sitOut) return [];
  const suit = r.suit ? r.suit(s) : suitOf;
  let ok: string[];
  if (!s.trick.length) {
    ok = hand.filter((c) => r.mayLead(s, c, player));
  } else {
    const led = suit(s.trick[0].card);
    ok = hand.filter((c) => suit(c) === led);
  }
  if (!ok.length) ok = hand;
  return r.follow ? r.follow(s, player, ok) : ok;
}

const isLeftBower = (c: string, trump: string) => rankOf(c) === "J" && suitOf(c) !== trump && sameColour(suitOf(c), trump);
const sameColour = (a: string, b: string) => (a === "S" || a === "C") === (b === "S" || b === "C");

function playCard(s: TrickState, n: number, seed: string, r: Rules, card: string): boolean {
  const p = s.turn;
  if (!trickPlayable(s, p, r).includes(card)) return false;
  s.hands[p] = s.hands[p].filter((c) => c !== card);
  s.trick.push({ player: p, card });
  s.received[p] = [];
  if (r.breaks && suitOf(card) === r.breaks) s.broken = true;
  const playing = n - (s.sitOut >= 0 ? 1 : 0);
  if (s.trick.length < playing) {
    s.turn = nextPlaying(s, p, n);
    return true;
  }
  const winner = trickWinner(s.trick, r.trumpOf(s), r.value(s), r.suit ? r.suit(s) : suitOf);
  s.won[winner]++;
  s.taken[winner].push(...s.trick.map((t) => t.card));
  s.lastTrick = s.trick;
  s.lastWinner = winner;
  s.trick = [];
  s.leader = winner;
  s.turn = winner;
  if (s.hands.every((h, q) => q === s.sitOut || h.length === 0)) {
    r.endRound(s, n);
    if (!s.over) nextDeal(s, n, seed, r);
  }
  return true;
}

type Extra = (s: TrickState, n: number, m: string, redeal: () => void) => boolean | null;

function makeDef(id: string, name: string, blurb: string, emoji: string, r: Rules, extra?: Extra): GameDef<TrickState> {
  return {
    id,
    name,
    blurb,
    emoji,
    minPlayers: 4,
    maxPlayers: 4,
    replay(moves, n, seed) {
      const s: TrickState = {
        round: 1, hands: [], trick: [], leader: 0, turn: 0, won: [], taken: [], scores: Array(n).fill(0), broken: false, bids: [], bags: Array(n).fill(0),
        trump: null, upcard: null, caller: -1, dealer: 0, phase: 2, lastTrick: [], lastWinner: -1, passing: [], passTo: 0, received: [], alone: false, sitOut: -1,
        gone: Array(n).fill(false), result: null, over: false, log: [],
      };
      newRound(s, n, seed, r);
      const redeal = () => nextDeal(s, n, seed, r);
      for (const m of moves) {
        if (s.over) return null;
        const left = leaver(m, n);
        if (left !== null) {
          if (left < 0) return null;
          s.gone[left] = true;
          r.leave(s, n, left);
          continue;
        }
        if (extra) {
          const handled = extra(s, n, m, redeal);
          if (handled === null) return null;
          if (handled) continue;
        }
        const mv = /^p:([2-9TJQKA][SHDC])$/.exec(m);
        if (!mv || s.phase !== 2) return null;
        if (!playCard(s, n, seed, r, mv[1])) return null;
      }
      return s;
    },
    turn: (s) => s.turn,
    outcome: (s, n) => s.result ?? r.outcome(s, n),
    summary: (s) =>
      `round ${s.round} · ` + (id === "hearts" ? s.scores.map((x, i) => `P${i + 1} ${x}`).join(" · ") : `P1+P3 ${s.scores[0]} · P2+P4 ${s.scores[1]}`),
  };
}

/** Partnerships: when a player leaves, the other team wins at once. */
function teamLeave(s: TrickState, _n: number, p: number) {
  const other = (p + 1) % 2;
  s.over = true;
  s.log.push(`P${p + 1} left the table — ${teamText(other)} win`);
  s.result = teamWin(teamPlayers(other), `P${p + 1} left — ${teamText(other)} win`, s.scores);
}

function teamOutcome(s: TrickState): Outcome {
  if (!s.over) return ON;
  if (s.scores[0] === s.scores[1]) return draw("level scores", s.scores);
  const team = s.scores[0] > s.scores[1] ? 0 : 1;
  return teamWin(teamPlayers(team), `${teamText(team)} reach ${s.scores[team]}`, s.scores);
}

const deck52 = () => {
  const out: string[] = [];
  for (const su of SUITS) for (const ra of RANKS) out.push(ra + su);
  return out;
};

// ---------------------------------------------------------------- Hearts

export const heartsPoints = (cards: string[]) => cards.reduce((a, c) => a + (suitOf(c) === "H" ? 1 : c === "QS" ? 13 : 0), 0);
/** Where the three cards go each round: left, right, across, keep. */
const PASS_TURNS = [1, 3, 2, 0];
export const PASS_WORD: Record<number, string> = { 1: "left", 3: "right", 2: "across", 0: "no pass" };
/** Hearts: before the first trick of a round has been taken. */
const firstTrick = (s: TrickState) => s.taken.every((t) => t.length === 0);

function heartsLead(s: TrickState) {
  const who = s.hands.findIndex((h) => h.includes("2C"));
  s.leader = who < 0 ? 0 : who;
  s.turn = s.leader;
}

const heartsRules: Rules = {
  deck: deck52,
  per: 13,
  target: 100,
  trumpOf: () => null,
  value: () => rankValue,
  breaks: "H",
  startRound: (s, n) => {
    s.passTo = PASS_TURNS[(s.round - 1) % 4];
    if (s.passTo) {
      s.phase = 3;
      s.turn = (s.round - 1) % n;
      return;
    }
    heartsLead(s);
  },
  // The 2♣ opens; hearts can't be led until one has been played (unless you hold nothing else).
  mayLead: (s, c, p) => {
    if (firstTrick(s) && s.trick.length === 0) return c === "2C";
    return suitOf(c) !== "H" || s.broken || s.hands[p].every((x) => suitOf(x) === "H");
  },
  // On the first trick no hearts or Q♠, unless that is all you hold.
  follow: (s, _p, cards) => {
    if (!firstTrick(s) || !s.trick.length) return cards;
    const clean = cards.filter((c) => suitOf(c) !== "H" && c !== "QS");
    return clean.length ? clean : cards;
  },
  endRound: (s, n) => {
    const pts = s.taken.map(heartsPoints);
    const moon = pts.findIndex((x) => x === 26);
    for (let p = 0; p < n; p++) s.scores[p] += moon >= 0 ? (p === moon ? 0 : 26) : pts[p];
    s.log.push(`Round ${s.round}: ${moon >= 0 ? `P${moon + 1} shot the moon!` : pts.map((x, i) => `P${i + 1} +${x}`).join(", ")}`);
    if (s.scores.some((x) => x >= 100)) s.over = true;
  },
  outcome: (s) => {
    if (!s.over) return ON;
    const best = Math.min(...s.scores);
    const tops = s.scores.map((x, i) => (x === best ? i : -1)).filter((i) => i >= 0);
    return tops.length > 1 ? draw(`${best} points each`, s.scores) : win(tops[0], `fewest points (${best})`, s.scores);
  },
  // Someone left: the game ends, and the lowest score (this hand's points included) of those still in wins.
  leave: (s, n, p) => {
    s.over = true;
    const pts = s.scores.map((x, q) => x + heartsPoints(s.taken[q] ?? []));
    const still = Array.from({ length: n }, (_, q) => q).filter((q) => !s.gone[q]);
    const best = Math.min(...still.map((q) => pts[q]));
    const tops = still.filter((q) => pts[q] === best);
    s.log.push(`P${p + 1} left the table — the game ends`);
    s.result = tops.length > 1 ? draw(`P${p + 1} left — ${tops.map((q) => `P${q + 1}`).join(", ")} level on ${best}`, pts) : win(tops[0], `P${p + 1} left — fewest points (${best})`, pts);
  },
};

export const hearts = makeDef("hearts", "Hearts", "Avoid the hearts and the queen of spades; lowest score wins.", "♥️", heartsRules, (s, n, m) => {
  const g = /^g:([2-9TJQKA][SHDC]),([2-9TJQKA][SHDC]),([2-9TJQKA][SHDC])$/.exec(m);
  if (s.phase !== 3) return g || /^g:/.test(m) ? null : false;
  if (!g) return null;
  const cards = [g[1], g[2], g[3]];
  const p = s.turn;
  if (new Set(cards).size !== 3 || !cards.every((c) => s.hands[p].includes(c)) || s.passing[p]) return null;
  s.passing[p] = cards;
  s.hands[p] = s.hands[p].filter((c) => !cards.includes(c));
  if (s.passing.every(Boolean)) {
    // Everyone has chosen: the cards change hands together.
    for (let q = 0; q < n; q++) {
      const to = (q + s.passTo) % n;
      s.hands[to].push(...s.passing[q]!);
      s.received[to] = [...s.passing[q]!];
    }
    s.phase = 2;
    heartsLead(s);
  } else {
    let q = (p + 1) % n;
    while (s.passing[q]) q = (q + 1) % n;
    s.turn = q;
  }
  return true;
});

// ---------------------------------------------------------------- Spades
// LANX 2.17.0: the jack of clubs is just a club (2.16 mixed it up with Euchre's left bower),
// and a team that sinks to −200 loses.

const spadesRules: Rules = {
  deck: deck52,
  per: 13,
  target: 500,
  trumpOf: () => "S",
  value: () => rankValue,
  breaks: "S",
  startRound: (s, n) => {
    s.phase = 0; // bidding
    s.leader = (s.dealer + 1) % n;
    s.turn = s.leader;
  },
  mayLead: (s, c, p) => suitOf(c) !== "S" || s.broken || s.hands[p].every((x) => suitOf(x) === "S"),
  endRound: (s) => {
    // Teams P1+P3 and P2+P4.
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
    s.log.push(`Round ${s.round}: P1+P3 ${s.scores[0]}, P2+P4 ${s.scores[1]}`);
    // First to 500 — and, as most tables play it, a team that sinks to −200 loses.
    if (s.scores.some((x) => x >= 500 || x <= -200)) s.over = true;
  },
  outcome: (s) => {
    const o = teamOutcome(s);
    if (o.over && !o.draw && Math.max(s.scores[0], s.scores[1]) < 500) o.reason = `${teamText(o.winner === 0 ? 1 : 0)} fall to ${Math.min(s.scores[0], s.scores[1])}`;
    return o;
  },
  leave: teamLeave,
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
/** The right bower (jack of trumps) is highest, then the left bower (the other jack of the same colour). */
const euchreValue = (s: TrickState) => (c: string) => {
  const t = s.trump;
  if (t && rankOf(c) === "J" && suitOf(c) === t) return 100; // right bower
  if (t && isLeftBower(c, t)) return 99; // left bower
  return rankValue(c);
};
/** The left bower counts as a trump, not as its own suit. */
const euchreSuit = (s: TrickState) => (c: string) => (s.trump && isLeftBower(c, s.trump) ? s.trump : suitOf(c));
export const SUIT_WORD: Record<string, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };

/** Play starts left of the dealer (skipping a lone maker's partner). */
function euchrePlay(s: TrickState, n: number) {
  s.phase = 2;
  s.leader = (s.dealer + 1) % n;
  if (s.leader === s.sitOut) s.leader = (s.leader + 1) % n;
  s.turn = s.leader;
}

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
  suit: euchreSuit,
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
    let how = "";
    if (tricks[callerTeam] === 5) {
      pts = s.alone ? 4 : 2;
      how = s.alone ? " — alone, all five tricks" : " — all five tricks";
    } else if (tricks[callerTeam] >= 3) pts = 1;
    else {
      team = 1 - callerTeam;
      pts = 2; // euchred
      how = " — euchred!";
    }
    for (let p = 0; p < n; p++) if (p % 2 === team) s.scores[p] += pts;
    s.log.push(`Round ${s.round}: ${teamText(team)} +${pts}${how}`);
    if (s.scores[0] >= 10 || s.scores[1] >= 10) s.over = true;
  },
  outcome: teamOutcome,
  leave: teamLeave,
};

export const euchre = makeDef("euchre", "Euchre", "Fast partnership tricks with bowers; first team to ten.", "🃑", euchreRules, (s, n, m, redeal) => {
  if (s.phase === 2) return /^(o|o:a|x|t:.*|d:.*)$/.test(m) ? null : false;
  if (s.phase === 4) {
    // The dealer picked up the turned card and now puts one card away.
    const d = /^d:([9TJQKA][SHDC])$/.exec(m);
    if (!d || !s.hands[s.dealer].includes(d[1])) return null;
    s.hands[s.dealer] = s.hands[s.dealer].filter((c) => c !== d[1]);
    euchrePlay(s, n);
    return true;
  }
  if (s.phase === 0) {
    if (m === "o" || m === "o:a") {
      s.trump = suitOf(s.upcard!);
      s.caller = s.turn;
      s.alone = m === "o:a";
      s.sitOut = s.alone ? partnerOf(s.caller) : -1;
      s.log.push(`P${s.caller + 1} ordered up ${cardText(s.upcard!)}${s.alone ? " and plays alone" : ""}${s.dealer === s.sitOut ? "" : ` — P${s.dealer + 1} picks it up`}`);
      if (s.dealer === s.sitOut) {
        // The dealer sits this hand out, so the card stays where it is.
        euchrePlay(s, n);
        return true;
      }
      s.hands[s.dealer].push(s.upcard!);
      s.phase = 4;
      s.turn = s.dealer;
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
  const t = /^t:([SHDC])(:a)?$/.exec(m);
  if (t) {
    if (s.upcard && t[1] === suitOf(s.upcard)) return null;
    s.trump = t[1];
    s.caller = s.turn;
    s.alone = !!t[2];
    s.sitOut = s.alone ? partnerOf(s.caller) : -1;
    s.log.push(`P${s.caller + 1} named ${SUIT_WORD[t[1]]} trump${s.alone ? " and plays alone" : ""}`);
    euchrePlay(s, n);
    return true;
  }
  if (m === "x") {
    s.turn = (s.turn + 1) % n;
    if (s.turn === s.leader) {
      // Everyone passed twice: throw the hand in; the next player deals.
      s.log.push(`Round ${s.round}: everyone passed twice — P${((s.dealer + 1) % n) + 1} deals again`);
      redeal();
    }
    return true;
  }
  return null;
});

export const TRICK_RULES = { hearts: heartsRules, spades: spadesRules, euchre: euchreRules };
