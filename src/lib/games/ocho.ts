// Ocho — the colour-and-number shedding game, 2–8 players, 108 cards: four
// colours of 0–9, Skip, Reverse and +2, plus Wild and Wild +4. Match the
// colour or the symbol, or play a wild and name a colour. Nothing to play?
// Draw one; if it fits you may play it, else the turn passes. First hand
// out wins.
//
// Cards: "<colour><face>" — colour R/G/B/Y, face 0–9, S (skip), V (reverse),
// D (+2); wilds "W" and "F" (+4). Moves: "p:<card>" or "p:<wild>:<colour>",
// "d" (draw), "k" (keep the card you drew and pass).

import { ON, shuffled, win, type GameDef, type Outcome } from "./core.ts";

export const OCHO_COLOURS = ["R", "G", "B", "Y"];
export const OCHO_COLOUR_NAME: Record<string, string> = { R: "red", G: "green", B: "blue", Y: "yellow" };

export function ochoDeck(): string[] {
  const out: string[] = [];
  for (const c of OCHO_COLOURS) {
    out.push(`${c}0`);
    for (const f of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "S", "V", "D"]) out.push(`${c}${f}`, `${c}${f}`);
  }
  for (let k = 0; k < 4; k++) out.push("W", "F");
  return out;
}

export interface OchoState {
  hands: string[][];
  stock: string[];
  pile: string[];
  colour: string;
  turn: number;
  dir: 1 | -1;
  /** A card just drawn that may be played or kept, or null. */
  drawn: string | null;
  winner: number | null;
  event: string;
}

const isWild = (c: string) => c === "W" || c === "F";
export const ochoPlayable = (s: OchoState, c: string) => isWild(c) || c[0] === s.colour || (c.length === 2 && c[1] === s.pile[s.pile.length - 1][1]);

function outcome(s: OchoState): Outcome {
  return s.winner !== null ? win(s.winner, "out of cards") : ON;
}

export const ocho: GameDef<OchoState> = {
  id: "ocho",
  name: "Ocho",
  blurb: "Colours, numbers, skips and wilds — shed your hand first.",
  emoji: "🃏",
  minPlayers: 2,
  maxPlayers: 8,
  replay(moves, n, seed) {
    const deck = shuffled(ochoDeck(), seed);
    const hands: string[][] = Array.from({ length: n }, () => []);
    let k = 0;
    for (let i = 0; i < 7; i++) for (let p = 0; p < n; p++) hands[p].push(deck[k++]);
    const stock = deck.slice(k);
    let first = stock.findIndex((c) => !isWild(c) && !"SVD".includes(c[1]));
    if (first < 0) first = 0;
    const top = stock.splice(first, 1)[0];
    const s: OchoState = { hands, stock, pile: [top], colour: top[0], turn: 0, dir: 1, drawn: null, winner: null, event: "" };
    const next = (steps = 1) => {
      s.turn = (s.turn + s.dir * steps + n * 4) % n;
    };
    const drawTo = (p: number, count: number) => {
      for (let i = 0; i < count; i++) {
        if (!s.stock.length) {
          // Reshuffle the pile under the top card.
          const top = s.pile.pop()!;
          s.stock = shuffled(s.pile, `${seed}#re${s.pile.length}`);
          s.pile = [top];
        }
        if (s.stock.length) s.hands[p].push(s.stock.shift()!);
      }
    };
    for (const m of moves) {
      if (s.winner !== null) return null;
      const hand = s.hands[s.turn];
      s.event = "";
      if (m === "d") {
        if (s.drawn || hand.some((c) => ochoPlayable(s, c))) return null;
        drawTo(s.turn, 1);
        const card = hand[hand.length - 1];
        if (ochoPlayable(s, card)) s.drawn = card; // may play it or keep it
        else next();
        continue;
      }
      if (m === "k") {
        if (!s.drawn) return null;
        s.drawn = null;
        next();
        continue;
      }
      const mv = /^p:([RGBY][0-9SVD]|W|F)(?::([RGBY]))?$/.exec(m);
      if (!mv) return null;
      const card = mv[1];
      if (s.drawn && card !== s.drawn) return null;
      const idx = hand.indexOf(card);
      if (idx < 0 || !ochoPlayable(s, card)) return null;
      if (isWild(card)) {
        if (!mv[2]) return null;
        s.colour = mv[2];
      } else {
        if (mv[2]) return null;
        s.colour = card[0];
      }
      hand.splice(idx, 1);
      s.pile.push(card);
      s.drawn = null;
      if (hand.length === 0) {
        s.winner = s.turn;
        continue;
      }
      const face = card.length === 2 ? card[1] : card;
      if (face === "S") {
        s.event = "skip";
        next(2);
      } else if (face === "V") {
        s.dir = s.dir === 1 ? -1 : 1;
        s.event = "reverse";
        next(n === 2 ? 2 : 1);
      } else if (face === "D") {
        next();
        drawTo(s.turn, 2);
        s.event = `player ${s.turn + 1} draws two`;
        next();
      } else if (face === "F") {
        next();
        drawTo(s.turn, 4);
        s.event = `player ${s.turn + 1} draws four`;
        next();
      } else next();
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s) => outcome(s),
  summary: (s) => s.hands.map((h, i) => `P${i + 1} ${h.length}`).join(" · ") + ` · ${OCHO_COLOUR_NAME[s.colour]}`,
};
