// Dominoes (block game), 2–4 players with a double-six set. Each draws seven
// (two players) or five tiles; the rest stay face down and nobody draws.
// Match a tile to either end of the line; pass only when you cannot. The
// first to empty their hand wins; if everyone is stuck, the lowest pip count
// wins. (Hands come from the match seed; your PC only shows yours.)
//
// Moves: "p:<a>-<b>:<l|r>" (play tile a-b on the left or right end) or "x".

import { ON, draw, shuffled, win, type GameDef, type Outcome } from "./core.ts";

export type Tile = [number, number];
export const SET: Tile[] = [];
for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) SET.push([a, b]);

export interface DominoState {
  hands: Tile[][];
  /** The line as played, left to right (tiles already turned the right way). */
  line: Tile[];
  turn: number;
  passes: number;
  winner: number | null;
  reason: string;
}

const same = (t: Tile, a: number, b: number) => (t[0] === a && t[1] === b) || (t[0] === b && t[1] === a);
const ends = (line: Tile[]): [number, number] | null => (line.length ? [line[0][0], line[line.length - 1][1]] : null);
const pips = (hand: Tile[]) => hand.reduce((a, t) => a + t[0] + t[1], 0);

export function dominoPlayable(s: DominoState, hand: Tile[]): { tile: Tile; end: "l" | "r" }[] {
  const e = ends(s.line);
  const out: { tile: Tile; end: "l" | "r" }[] = [];
  for (const t of hand) {
    if (!e) {
      out.push({ tile: t, end: "r" });
      continue;
    }
    if (t[0] === e[0] || t[1] === e[0]) out.push({ tile: t, end: "l" });
    if (t[0] === e[1] || t[1] === e[1]) out.push({ tile: t, end: "r" });
  }
  return out;
}

function finish(s: DominoState, n: number) {
  const counts = s.hands.map(pips);
  const best = Math.min(...counts);
  const tops = counts.map((c, i) => (c === best ? i : -1)).filter((i) => i >= 0);
  if (tops.length === 1) {
    s.winner = tops[0];
    s.reason = `blocked — fewest pips (${best})`;
  } else {
    s.winner = -1; // draw
    s.reason = `blocked — ${best} pips each`;
  }
  void n;
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
    const per = n === 2 ? 7 : 5;
    const s: DominoState = { hands: Array.from({ length: n }, (_, p) => deck.slice(p * per, (p + 1) * per)), line: [], turn: 0, passes: 0, winner: null, reason: "" };
    for (const m of moves) {
      if (s.winner !== null) return null;
      const hand = s.hands[s.turn];
      if (m === "x") {
        if (dominoPlayable(s, hand).length) return null;
        s.passes++;
        if (s.passes >= n) {
          finish(s, n);
          continue;
        }
        s.turn = (s.turn + 1) % n;
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
      if (!e) placed = [tile[0], tile[1]];
      else if (end === "l") {
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
      if (hand.length === 0) {
        s.winner = s.turn;
        s.reason = "out of tiles";
        continue;
      }
      s.turn = (s.turn + 1) % n;
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s) => outcome(s),
  summary: (s) => s.hands.map((h, i) => `P${i + 1} ${h.length}`).join(" · "),
};
