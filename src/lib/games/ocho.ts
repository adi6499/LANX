// Ocho — the colour-and-number shedding game, 2–8 players, 108 cards: four
// colours of 0–9, Skip, Reverse and +2, plus Wild and Wild +4. Match the
// colour or the symbol, or play a wild and name a colour (a Wild +4 only when
// you hold nothing of the colour to follow). Nothing to play? Draw one; if it
// fits you may play it, else the turn passes. First hand out wins.
//
// Cards: "<colour><face>" — colour R/G/B/Y, face 0–9, S (skip), V (reverse),
// D (+2); wilds "W" and "F" (+4). Moves: "p:<card>" or "p:<wild>:<colour>",
// "d" (draw), "k" (keep the card you drew and pass), and (LANX 2.17.0) "x<p>"
// when player p leaves: they are skipped from then on and can't win.

import { ON, lastIn, leaver, shuffled, win, type GameDef, type Outcome } from "./core.ts";

export const OCHO_COLOURS = ["R", "G", "B", "Y"];
export const OCHO_COLOUR_NAME: Record<string, string> = { R: "red", G: "green", B: "blue", Y: "yellow" };
const FACE_NAME: Record<string, string> = { S: "Skip", V: "Reverse", D: "+2" };

/** A card in words: "red 7", "blue Skip", "Wild", "Wild +4". */
export const ochoCardName = (c: string) => (c === "W" ? "Wild" : c === "F" ? "Wild +4" : `${OCHO_COLOUR_NAME[c[0]] ?? c[0]} ${FACE_NAME[c[1]] ?? c[1]}`);

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
  /** Why the game ended ("out of cards", or everyone else left). */
  reason: string;
  /** What just happened, with players as "P<n>". */
  event: string;
  /** LANX 2.17.0: players who left the table. */
  gone: boolean[];
}

const isWild = (c: string) => c === "W" || c === "F";
/** Whether the player to move may put this card down. */
export const ochoPlayable = (s: OchoState, c: string) => {
  if (c === "W") return true;
  // A Wild +4 only when you hold no card of the colour to follow.
  if (c === "F") return !(s.hands[s.turn] ?? []).some((x) => !isWild(x) && x[0] === s.colour);
  return c[0] === s.colour || (c.length === 2 && c[1] === s.pile[s.pile.length - 1][1]);
};

function outcome(s: OchoState): Outcome {
  return s.winner !== null ? win(s.winner, s.reason || "out of cards") : ON;
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
    const s: OchoState = { hands, stock, pile: [top], colour: top[0], turn: 0, dir: 1, drawn: null, winner: null, reason: "", event: "", gone: Array(n).fill(false) };
    /** One step round the table, past anyone who left. */
    const step = (from: number) => {
      let q = from;
      for (let i = 0; i < n; i++) {
        q = (q + s.dir + n) % n;
        if (!s.gone[q]) return q;
      }
      return q;
    };
    const next = (steps = 1) => {
      for (let i = 0; i < steps; i++) s.turn = step(s.turn);
    };
    const playing = () => s.gone.filter((g) => !g).length;
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
      const left = leaver(m, n);
      if (left !== null) {
        if (left < 0 || s.gone[left]) return null;
        s.gone[left] = true;
        s.event = `P${left + 1} left the table`;
        const last = lastIn(s.gone, n);
        if (last !== null) {
          s.winner = last;
          s.reason = "everyone else left";
          continue;
        }
        if (s.turn === left) {
          s.drawn = null;
          next();
        }
        continue;
      }
      const me = s.turn;
      const hand = s.hands[me];
      s.event = "";
      if (m === "d") {
        if (s.drawn || hand.some((c) => ochoPlayable(s, c))) return null;
        const before = hand.length;
        drawTo(me, 1);
        const card = hand.length > before ? hand[hand.length - 1] : null;
        if (card && ochoPlayable(s, card)) {
          s.drawn = card; // may play it or keep it
          s.event = `P${me + 1} drew a card that fits`;
        } else {
          s.event = `P${me + 1} drew and passed`;
          next();
        }
        continue;
      }
      if (m === "k") {
        if (!s.drawn) return null;
        s.drawn = null;
        s.event = `P${me + 1} kept the card`;
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
        s.winner = me;
        s.reason = "out of cards";
        continue;
      }
      const face = card.length === 2 ? card[1] : card;
      if (face === "S") {
        const skipped = step(me);
        s.event = `P${skipped + 1} is skipped`;
        next(2);
      } else if (face === "V") {
        s.dir = s.dir === 1 ? -1 : 1;
        if (playing() === 2) {
          // With two players a reverse works like a skip.
          s.event = `Reverse — P${step(me) + 1} is skipped`;
          next(2);
        } else {
          s.event = "Reverse — play changes direction";
          next(1);
        }
      } else if (face === "D") {
        next();
        drawTo(s.turn, 2);
        s.event = `P${s.turn + 1} draws two and misses a turn`;
        next();
      } else if (face === "F") {
        next();
        drawTo(s.turn, 4);
        s.event = `P${me + 1} picked ${OCHO_COLOUR_NAME[s.colour]} — P${s.turn + 1} draws four and misses a turn`;
        next();
      } else {
        if (face === "W") s.event = `P${me + 1} picked ${OCHO_COLOUR_NAME[s.colour]}`;
        next();
      }
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s) => outcome(s),
  summary: (s) => s.hands.map((h, i) => `P${i + 1} ${s.gone[i] ? "left" : h.length}`).join(" · ") + ` · ${OCHO_COLOUR_NAME[s.colour]}`,
};
