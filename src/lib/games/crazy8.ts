// Crazy Eights, 2–6 players. Match the top card's suit or rank; an eight
// goes on anything and names the next suit. Nothing to play? Draw one (and
// keep drawing until you can); with the stock gone, pass. First to empty
// their hand wins. LANX 2.17.0: when the stock is gone and every player
// passes in a row, the game is blocked and ends: the fewest card points in
// hand wins (an eight 50, a picture card or ten 10, an ace 1, others their
// number) — the usual Crazy Eights scoring, so stuck eights hurt most.
// Moves: "p:<card>" (play), "p:<8x>:<suit>" (an eight, naming a suit),
// "d" (draw one), "x" (pass — only with the stock gone and nothing to play),
// "x<p>" (player p left: they are skipped from then on and can't win).

import { ON, draw, lastIn, leaver, nextIn, win, type GameDef, type Outcome } from "./core.ts";
import { SUIT_SYMBOL, deal, rankOf, shuffledDeck, suitOf } from "./cards.ts";

export interface Crazy8State {
  hands: string[][];
  stock: string[];
  pile: string[];
  /** The suit to follow (an eight may change it). */
  suit: string;
  turn: number;
  winner: number | null;
  /** Passes in a row (with the stock gone). */
  passes: number;
  /** LANX 2.17.0: players who left, and how the game ended when it wasn't a hand going out. */
  gone: boolean[];
  end: Outcome | null;
  /** What just happened, with players as "P<n>". */
  event: string;
}

/** Card points left in a hand when a blocked game ends. */
export const crazy8Points = (c: string) => {
  const r = rankOf(c);
  if (r === "8") return 50;
  if ("TJQK".includes(r)) return 10;
  if (r === "A") return 1;
  return Number(r);
};
export const crazy8HandPoints = (hand: string[]) => hand.reduce((a, c) => a + crazy8Points(c), 0);

export const crazy8Playable = (s: Crazy8State, card: string) => rankOf(card) === "8" || suitOf(card) === s.suit || rankOf(card) === rankOf(s.pile[s.pile.length - 1]);

function outcome(s: Crazy8State): Outcome {
  if (s.end) return s.end;
  return s.winner !== null ? win(s.winner, "out of cards") : ON;
}

/** Nobody can play and the stock is gone: the fewest card points wins. */
function blocked(s: Crazy8State, n: number): Outcome {
  const still = Array.from({ length: n }, (_, p) => p).filter((p) => !s.gone[p]);
  const pts = s.hands.map(crazy8HandPoints);
  const best = Math.min(...still.map((p) => pts[p]));
  const tops = still.filter((p) => pts[p] === best);
  const scores = pts.map((x, p) => (s.gone[p] ? 0 : x));
  return tops.length > 1 ? draw(`blocked — ${tops.map((p) => `P${p + 1}`).join(", ")} level on ${best} points`, scores) : win(tops[0], `blocked — fewest card points (${best})`, scores);
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
    const s: Crazy8State = { hands, stock, pile: [top], suit: suitOf(top), turn: 0, winner: null, passes: 0, gone: Array(n).fill(false), end: null, event: "" };
    for (const m of moves) {
      if (s.winner !== null || s.end) return null;
      const left = leaver(m, n);
      if (left !== null) {
        if (left < 0 || s.gone[left]) return null;
        s.gone[left] = true;
        s.event = `P${left + 1} left the table`;
        const last = lastIn(s.gone, n);
        if (last !== null) {
          s.winner = last;
          s.end = win(last, "everyone else left");
          continue;
        }
        if (s.turn === left) s.turn = nextIn(left, n, s.gone);
        continue;
      }
      const me = s.turn;
      const hand = s.hands[me];
      if (m === "d") {
        if (!s.stock.length || hand.some((c) => crazy8Playable(s, c))) return null; // only draw when stuck
        hand.push(s.stock.shift()!);
        s.passes = 0;
        s.event = `P${me + 1} drew a card`;
        continue;
      }
      if (m === "x") {
        if (s.stock.length || hand.some((c) => crazy8Playable(s, c))) return null;
        s.passes++;
        s.event = `P${me + 1} passed`;
        if (s.passes >= s.gone.filter((g) => !g).length) {
          s.end = blocked(s, n);
          s.event = "Nobody can play — the game is blocked";
          continue;
        }
        s.turn = nextIn(me, n, s.gone);
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
        s.event = `P${me + 1} played an eight — ${SUIT_SYMBOL[s.suit]} to follow`;
      } else {
        if (mv[2]) return null;
        s.suit = suitOf(card);
        s.event = "";
      }
      hand.splice(k, 1);
      s.pile.push(card);
      s.passes = 0;
      if (hand.length === 0) {
        s.winner = me;
        continue;
      }
      s.turn = nextIn(me, n, s.gone);
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s) => outcome(s),
  summary: (s) => s.hands.map((h, i) => `P${i + 1} ${s.gone[i] ? "left" : h.length}`).join(" · ") + ` · stock ${s.stock.length}`,
};
