// Ludo: 2–4 players, four tokens each, played the way most people know it
// (Ludo King rules, LANX 2.17.0):
// - roll (the match rolls for you); a six lets a token out onto your start square;
// - a six, knocking out a token, or getting a token home gives you another roll;
// - three sixes in a row and your turn is over (the third six is not played);
// - land on a lone enemy token and it goes back to its yard, except on the eight
//   safe squares (the four start squares and the four stars); two tokens of one
//   colour on a square are safe too;
// - you need the exact number to get a token into the centre (five home squares, then home);
// - with two players you sit on opposite corners.
// First to bring all four home wins. Someone who leaves ("x<p>") is out: their
// tokens leave the board and the turn skips them; the last one in wins.
//
// Moves: "r" (roll), then "m:<token>" (move that token with the roll). When
// no token can move, the turn passes by itself.

import { ON, dice, lastIn, leaver, nextIn, win, type GameDef, type Outcome } from "./core.ts";

export const TRACK = 52;
export const HOME_COL = 5; // 51..55 are the home column, 56 = in (2.17.1: five squares, as on a real board)
export const FINISH = 56;
export const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

/** What just happened, for the boards to put into words with the players' names. */
export type LudoEvent = "" | "no move" | "knock" | "sixes" | "home";

export interface LudoState {
  /** pos[player][token]: -1 in the yard, 0..50 on the track (relative to the player's start), 51..56 home column, 57 in. */
  pos: number[][];
  turn: number;
  /** The roll waiting to be used, or 0. */
  roll: number;
  rolls: number;
  lastRoll: number;
  /** Who rolled `lastRoll`. */
  roller: number;
  winner: number | null;
  event: LudoEvent;
  /** The player whose token was knocked out (event "knock"), or -1. */
  victim: number;
  /** Who did it (the mover, for "knock" and "home"). */
  by: number;
  /** Sixes rolled in a row by the player to move. */
  sixes: number;
  /** The player to move has a bonus roll (a six, a knock-out or a token home). */
  again: boolean;
  /** Players who left the table. */
  out: boolean[];
}

/** The board corner (0 top-left, clockwise) a player sits at: opposite corners for two players. */
export const ludoCorner = (player: number, n: number) => (n === 2 ? player * 2 : player);
/** The player sitting at a corner, or -1 when nobody plays it. */
export const ludoPlayerAt = (corner: number, n: number) => (n === 2 ? (corner % 2 === 0 ? corner / 2 : -1) : corner < n ? corner : -1);
/** Each corner's start on the shared track (quarters of the board). */
export const startOf = (corner: number) => (corner * 13) % TRACK;
/** A corner's relative square (0..50) → the shared track square (0..51). */
export const toAbsolute = (corner: number, rel: number) => (startOf(corner) + rel) % TRACK;

export function ludoMovable(s: LudoState): number[] {
  if (!s.roll) return [];
  const out: number[] = [];
  s.pos[s.turn].forEach((p, t) => {
    if (p === FINISH) return;
    if (p === -1) {
      if (s.roll === 6) out.push(t);
      return;
    }
    if (p + s.roll <= FINISH) out.push(t);
  });
  return out;
}

/** The tokens worth choosing between, one per different result (any token from the yard is the same move). */
export function ludoChoices(s: LudoState): number[] {
  const seen = new Set<number>();
  return ludoMovable(s).filter((t) => {
    const from = s.pos[s.turn][t];
    if (seen.has(from)) return false;
    seen.add(from);
    return true;
  });
}

/** The event in words; `name(p)` gives a player's name. */
export function ludoEventText(s: LudoState, name: (p: number) => string): string {
  switch (s.event) {
    case "no move":
      return `${name(s.roller)} can't move with a ${s.lastRoll}`;
    case "sixes":
      return `three sixes in a row — ${name(s.roller)}'s turn is over`;
    case "knock":
      return `${name(s.by)} knocked out ${name(s.victim)}'s token — roll again`;
    case "home":
      return `${name(s.by)} got a token home — roll again`;
    default:
      return s.again && s.lastRoll === 6 && !s.roll ? `a six — ${name(s.turn)} rolls again` : "";
  }
}

function outcome(s: LudoState): Outcome {
  if (s.winner === null) return ON;
  return win(s.winner, s.pos[s.winner].every((x) => x === FINISH) ? "all four tokens home" : "everyone else left");
}

export const ludo: GameDef<LudoState> = {
  id: "ludo",
  name: "Ludo",
  blurb: "Four tokens round the board. A six gets you out; a six, a knock-out or a token home rolls again.",
  emoji: "🎲",
  minPlayers: 2,
  maxPlayers: 4,
  replay(moves, n, seed) {
    const s: LudoState = { pos: Array.from({ length: n }, () => [-1, -1, -1, -1]), turn: 0, roll: 0, rolls: 0, lastRoll: 0, roller: 0, winner: null, event: "", victim: -1, by: -1, sixes: 0, again: false, out: Array(n).fill(false) };
    const pass = () => {
      s.turn = nextIn(s.turn, n, s.out);
      s.roll = 0;
      s.sixes = 0;
      s.again = false;
    };
    for (const m of moves) {
      if (s.winner !== null) return null;
      const gone = leaver(m, n);
      if (gone !== null) {
        if (gone < 0 || s.out[gone]) return null;
        s.out[gone] = true;
        s.pos[gone] = s.pos[gone].map((x) => (x === FINISH ? x : -1));
        if (s.turn === gone) pass();
        const last = lastIn(s.out, n);
        if (last !== null) s.winner = last;
        continue;
      }
      if (m === "r") {
        if (s.roll) return null; // use the roll first
        s.roll = dice(seed, s.rolls);
        s.rolls++;
        s.lastRoll = s.roll;
        s.roller = s.turn;
        s.event = "";
        s.victim = -1;
        s.by = -1;
        s.again = false;
        s.sixes = s.roll === 6 ? s.sixes + 1 : 0;
        if (s.sixes === 3) {
          s.event = "sixes";
          pass();
        } else if (ludoMovable(s).length === 0) {
          s.event = "no move";
          pass();
        }
        continue;
      }
      const mv = /^m:([0-3])$/.exec(m);
      if (!mv || !s.roll) return null;
      const t = Number(mv[1]);
      if (!ludoMovable(s).includes(t)) return null;
      const p = s.pos[s.turn][t];
      const next = p === -1 ? 0 : p + s.roll;
      s.pos[s.turn][t] = next;
      s.event = "";
      let again = s.roll === 6;
      // Knock a lone enemy token home (not on a safe square, not in a home column).
      if (next <= 50) {
        const abs = toAbsolute(ludoCorner(s.turn, n), next);
        if (!SAFE.has(abs)) {
          for (let q = 0; q < n; q++) {
            if (q === s.turn) continue;
            const there = s.pos[q].map((x, k) => (x >= 0 && x <= 50 && toAbsolute(ludoCorner(q, n), x) === abs ? k : -1)).filter((k) => k >= 0);
            if (there.length === 1) {
              s.pos[q][there[0]] = -1;
              s.event = "knock";
              s.victim = q;
              s.by = s.turn;
              again = true;
            }
          }
        }
      }
      if (next === FINISH) {
        if (!s.event) {
          s.event = "home";
          s.by = s.turn;
        }
        again = true;
      }
      if (s.pos[s.turn].every((x) => x === FINISH)) {
        s.winner = s.turn;
        s.roll = 0;
        s.again = false;
        continue;
      }
      s.roll = 0;
      if (again) s.again = true;
      else pass();
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s) => outcome(s),
  summary: (s) => {
    const home = s.pos.map((ts) => ts.filter((x) => x === FINISH).length);
    return `Tokens home: ${home.join(" – ")}${s.roll ? ` · rolled ${s.roll}` : s.again ? " · roll again" : ""}`;
  },
};
