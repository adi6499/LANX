// Dominoes (block game), 2–4 players with a double-six set. LANX 2.17.0:
// everyone draws seven (with four players that is all 28 tiles); the rest
// stay face down and nobody draws. The player with the highest double sets
// it to start (with no double out, the heaviest tile). Match a tile to
// either end of the line; pass only when you cannot. The first to empty
// their hand wins; if everyone is stuck, the lowest pip count wins. A player
// who leaves is skipped (the last one still in wins). Hands come from the
// match seed; your PC only shows yours.
//
// Moves: "p:<a>-<b>:<l|r>" (play tile a-b on the left or right end), "x"
// (pass), "x<p>" (player p left).

import { ON, draw, lastIn, leaver, nextIn, shuffled, win, type GameDef, type Outcome } from "./core.ts";

export type Tile = [number, number];
export const SET: Tile[] = [];
for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) SET.push([a, b]);
export const DOMINO_HAND = 7;

export interface DominoState {
  hands: Tile[][];
  /** The line as played, left to right (tiles already turned the right way). */
  line: Tile[];
  turn: number;
  passes: number;
  winner: number | null;
  reason: string;
  /** LANX 2.17.0: the tile that must start the line (the highest double, or the heaviest tile). */
  lead: Tile;
  /** Who played or passed last (−1 before the first move), what happened in words ("P2 can't play — passes"). */
  lastBy: number;
  event: string;
  /** Who has left. */
  out: boolean[];
}

const same = (t: Tile, a: number, b: number) => (t[0] === a && t[1] === b) || (t[0] === b && t[1] === a);
const ends = (line: Tile[]): [number, number] | null => (line.length ? [line[0][0], line[line.length - 1][1]] : null);
const pips = (hand: Tile[]) => hand.reduce((a, t) => a + t[0] + t[1], 0);
const name = (t: Tile) => `${t[0]}-${t[1]}`;

/** The opening tile and who holds it: the highest double, else the heaviest tile. */
function leadOf(hands: Tile[][], out?: boolean[]): { player: number; tile: Tile } {
  let best: { player: number; tile: Tile; rank: number } = { player: 0, tile: [0, 0], rank: -1 };
  hands.forEach((h, p) => {
    if (out?.[p]) return;
    for (const t of h) {
      const rank = t[0] === t[1] ? 100 + t[0] : (t[0] + t[1]) * 7 + Math.max(t[0], t[1]);
      if (rank > best.rank) best = { player: p, tile: t, rank };
    }
  });
  return best;
}

export function dominoPlayable(s: DominoState, hand: Tile[]): { tile: Tile; end: "l" | "r" }[] {
  const e = ends(s.line);
  const out: { tile: Tile; end: "l" | "r" }[] = [];
  for (const t of hand) {
    if (!e) {
      // The line opens with the set tile.
      if (same(t, s.lead[0], s.lead[1])) out.push({ tile: t, end: "r" });
      continue;
    }
    if (t[0] === e[0] || t[1] === e[0]) out.push({ tile: t, end: "l" });
    if (t[0] === e[1] || t[1] === e[1]) out.push({ tile: t, end: "r" });
  }
  return out;
}

function finish(s: DominoState) {
  const counts = s.hands.map((h, p) => (s.out[p] ? Infinity : pips(h)));
  const best = Math.min(...counts);
  const tops = counts.map((c, i) => (c === best ? i : -1)).filter((i) => i >= 0);
  if (tops.length === 1) {
    s.winner = tops[0];
    s.reason = `blocked — fewest pips (${best})`;
    s.event = `Nobody can play — P${tops[0] + 1} has the fewest pips (${best})`;
  } else {
    s.winner = -1; // draw
    s.reason = `blocked — ${best} pips each`;
    s.event = `Nobody can play — ${best} pips each, a draw`;
  }
}

function outcome(s: DominoState): Outcome {
  if (s.winner === null) return ON;
  if (s.winner === -1) return draw(s.reason);
  return win(s.winner, s.reason);
}

export const dominoes: GameDef<DominoState> = {
  id: "dominoes",
  name: "Dominoes",
  blurb: "Match the ends of the line; first out of tiles wins.",
  emoji: "🁡",
  minPlayers: 2,
  maxPlayers: 4,
  replay(moves, n, seed) {
    const deck = shuffled(SET, seed);
    const hands = Array.from({ length: n }, (_, p) => deck.slice(p * DOMINO_HAND, (p + 1) * DOMINO_HAND));
    const lead = leadOf(hands);
    const s: DominoState = { hands, line: [], turn: lead.player, passes: 0, winner: null, reason: "", lead: lead.tile, lastBy: -1, event: "", out: Array(n).fill(false) };
    const inCount = () => s.out.filter((o) => !o).length;
    for (const m of moves) {
      if (s.winner !== null) return null;
      const gone = leaver(m, n);
      if (gone !== null) {
        if (gone < 0 || s.out[gone]) return null;
        s.out[gone] = true;
        s.event = `P${gone + 1} left the game`;
        const last = lastIn(s.out, n);
        if (last !== null) {
          s.winner = last;
          s.reason = "the others left";
          continue;
        }
        if (!s.line.length && s.turn === gone) {
          // The opener left before setting: the next best opener in the game starts.
          const next = leadOf(s.hands, s.out);
          s.lead = next.tile;
          s.turn = next.player;
        } else if (s.turn === gone) s.turn = nextIn(gone, n, s.out);
        if (s.line.length && s.passes >= inCount()) finish(s);
        continue;
      }
      const p = s.turn;
      const hand = s.hands[p];
      if (m === "x") {
        if (dominoPlayable(s, hand).length) return null;
        s.passes++;
        s.lastBy = p;
        s.event = `P${p + 1} can't play — passes`;
        if (s.passes >= inCount()) {
          finish(s);
          continue;
        }
        s.turn = nextIn(p, n, s.out);
        continue;
      }
      const mv = /^p:([0-6])-([0-6]):([lr])$/.exec(m);
      if (!mv) return null;
      const a = Number(mv[1]);
      const b = Number(mv[2]);
      const end = mv[3] as "l" | "r";
      const k = hand.findIndex((t) => same(t, a, b));
      if (k < 0) return null;
      const tile = hand[k];
      const e = ends(s.line);
      let placed: Tile;
      if (!e) {
        if (!same(tile, s.lead[0], s.lead[1])) return null; // the set tile opens the line
        placed = [tile[0], tile[1]];
      } else if (end === "l") {
        if (tile[1] === e[0]) placed = [tile[0], tile[1]];
        else if (tile[0] === e[0]) placed = [tile[1], tile[0]];
        else return null;
      } else {
        if (tile[0] === e[1]) placed = [tile[0], tile[1]];
        else if (tile[1] === e[1]) placed = [tile[1], tile[0]];
        else return null;
      }
      hand.splice(k, 1);
      if (end === "l" && e) s.line.unshift(placed);
      else s.line.push(placed);
      s.passes = 0;
      s.lastBy = p;
      s.event = e ? `P${p + 1} played ${name(tile)}` : `P${p + 1} set ${name(tile)}`;
      if (hand.length === 0) {
        s.winner = p;
        s.reason = "out of tiles";
        s.event = `P${p + 1} played the last tile — out!`;
        continue;
      }
      s.turn = nextIn(p, n, s.out);
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s) => outcome(s),
  summary: (s) => s.hands.map((h, i) => `P${i + 1} ${s.out[i] ? "left" : h.length}`).join(" · "),
};
