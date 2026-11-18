// Ludo: 2–6 players, four tokens each, played the way most people know it
// (Ludo King rules, LANX 2.17.0):
// - roll (the match rolls for you); a six lets a token out onto your start square;
// - a six, knocking out a token, or getting a token home gives you another roll;
// - three sixes in a row and your turn is over (the third six is not played);
// - land on a lone enemy token and it goes back to its yard, except on the safe
//   squares (every colour's start square and every star); two tokens of one
//   colour on a square are safe too;
// - you need the exact number to get a token into the centre (five home squares, then home);
// - with two players you sit on opposite corners.
// First to bring all four home wins. Someone who leaves ("x<p>") is out: their
// tokens leave the board and the turn skips them; the last one in wins.
//
// LANX 3.19.0: five and six players. They play on a six-sided board: six arms instead of four,
// so the shared track is 78 squares instead of 52. Everything else is the same — every arm is 13
// squares of track, a colour starts on its arm's second square, the star is eight squares on, a
// token walks all the way round and turns into its own five home squares. The game for 2 to 4
// players is not touched (an older LANX at the table replays the same moves).
//
// Moves: "r" (roll), then "m:<token>" (move that token with the roll). When
// no token can move, the turn passes by itself.

import { ON, dice, lastIn, leaver, nextIn, win, type GameDef, type Outcome } from "./core.ts";

/** The squares of track on one arm of the board. */
export const ARM = 13;
export const HOME_COL = 5; // five home squares, then home (2.17.1: as on a real board)
/** The board's arms (and corners): four, or six for five and six players. */
export const ludoArms = (n: number) => (n > 4 ? 6 : 4);
/** The squares of the shared track: 52, or 78 on the six-sided board. */
export const ludoTrack = (n: number) => ludoArms(n) * ARM;
/** A token's last square on the shared track, counted from its own start (50, or 76). */
export const ludoLast = (n: number) => ludoTrack(n) - 2;
/** A token that is in (56, or 82): the track, the five home squares, then home. */
export const ludoFinish = (n: number) => ludoTrack(n) + HOME_COL - 1;
/** The safe squares of the shared track: every start square and, eight squares on, every star. */
export const ludoSafe = (abs: number) => abs % ARM === 0 || abs % ARM === 8;

/** What just happened, for the boards to put into words with the players' names. */
export type LudoEvent = "" | "no move" | "knock" | "sixes" | "home";

export interface LudoState {
  /** pos[player][token]: -1 in the yard, then the track counted from the player's start (0..50, or 0..76
   *  on the six-sided board), the five home squares, and home (`ludoFinish`). */
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
/** Each corner's start on the shared track (one arm on from the corner before). */
export const startOf = (corner: number, n: number) => (corner * ARM) % ludoTrack(n);
/** A corner's own count of a square → the shared track square. */
export const toAbsolute = (corner: number, rel: number, n: number) => (startOf(corner, n) + rel) % ludoTrack(n);

export function ludoMovable(s: LudoState): number[] {
  if (!s.roll) return [];
  const finish = ludoFinish(s.pos.length);
  const out: number[] = [];
  s.pos[s.turn].forEach((p, t) => {
    if (p === finish) return;
    if (p === -1) {
      if (s.roll === 6) out.push(t);
      return;
    }
    if (p + s.roll <= finish) out.push(t);
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
  // LANX 3.16.0: said to you as "you" ("a six — You rolls again" it used to say).
  const whose = (p: number) => (name(p) === "You" ? "your" : `${name(p)}'s`);
  switch (s.event) {
    case "no move":
      return `${name(s.roller)} can't move with a ${s.lastRoll}`;
    case "sixes":
      return `three sixes in a row — ${whose(s.roller)} turn is over`;
    case "knock":
      return `${name(s.by)} knocked out ${whose(s.victim)} token — ${name(s.by) === "You" ? "roll" : "rolls"} again`;
    case "home":
      return `${name(s.by)} got a token home — ${name(s.by) === "You" ? "roll" : "rolls"} again`;
    default:
      return s.again && s.lastRoll === 6 && !s.roll ? `a six — ${name(s.turn) === "You" ? "you roll" : `${name(s.turn)} rolls`} again` : "";
  }
}

function outcome(s: LudoState): Outcome {
  if (s.winner === null) return ON;
  const finish = ludoFinish(s.pos.length);
  return win(s.winner, s.pos[s.winner].every((x) => x === finish) ? "all four tokens home" : "everyone else left");
}

export const ludo: GameDef<LudoState> = {
  id: "ludo",
  name: "Ludo",
  blurb: "Four tokens round the board. A six gets you out; a six, a knock-out or a token home rolls again.",
  emoji: "🎲",
  minPlayers: 2,
  maxPlayers: 6,
  replay(moves, n, seed) {
    const last = ludoLast(n);
    const finish = ludoFinish(n);
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
        s.pos[gone] = s.pos[gone].map((x) => (x === finish ? x : -1));
        if (s.turn === gone) pass();
        const left = lastIn(s.out, n);
        if (left !== null) s.winner = left;
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
      if (next <= last) {
        const abs = toAbsolute(ludoCorner(s.turn, n), next, n);
        if (!ludoSafe(abs)) {
          for (let q = 0; q < n; q++) {
            if (q === s.turn) continue;
            const there = s.pos[q].map((x, k) => (x >= 0 && x <= last && toAbsolute(ludoCorner(q, n), x, n) === abs ? k : -1)).filter((k) => k >= 0);
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
      if (next === finish) {
        if (!s.event) {
          s.event = "home";
          s.by = s.turn;
        }
        again = true;
      }
      if (s.pos[s.turn].every((x) => x === finish)) {
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
    const finish = ludoFinish(s.pos.length);
    const home = s.pos.map((ts) => ts.filter((x) => x === finish).length);
    return `Tokens home: ${home.join(" – ")}${s.roll ? ` · rolled ${s.roll}` : s.again ? " · roll again" : ""}`;
  },
};
