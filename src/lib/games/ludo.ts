// Ludo: 2–4 players, four tokens each. Roll (the match rolls for you); a six
// lets a token out and gives another roll; land on a lone enemy token and it
// goes home, except on the eight safe squares; you need the exact number to
// get a token into the centre. First to bring all four home wins.
//
// Moves: "r" (roll), then "m:<token>" (move that token with the roll). When
// no token can move, the turn passes by itself.

import { ON, dice, win, type GameDef, type Outcome } from "./core.ts";

export const TRACK = 52;
export const HOME_COL = 6; // 51..56 are the home column, 57 = in
export const FINISH = 57;
export const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

export interface LudoState {
  /** pos[player][token]: -1 in the yard, 0..50 on the track (relative to the player's start), 51..56 home column, 57 in. */
  pos: number[][];
  turn: number;
  /** The roll waiting to be used, or 0. */
  roll: number;
  rolls: number;
  lastRoll: number;
  winner: number | null;
  /** Last event for the board ("Bharat's token went home"). */
  event: string;
}

/** Each player's start on the shared track (quarters of the board). */
export const startOf = (player: number) => (player * 13) % TRACK;
export const toAbsolute = (player: number, rel: number) => (startOf(player) + rel) % TRACK;

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

function outcome(s: LudoState): Outcome {
  return s.winner !== null ? win(s.winner, "all four tokens home") : ON;
}

export const ludo: GameDef<LudoState> = {
  id: "ludo",
  name: "Ludo",
  blurb: "Four tokens round the board; a six gets you out and rolls again.",
  emoji: "🎲",
  minPlayers: 2,
  maxPlayers: 4,
  replay(moves, n, seed) {
    const s: LudoState = { pos: Array.from({ length: n }, () => [-1, -1, -1, -1]), turn: 0, roll: 0, rolls: 0, lastRoll: 0, winner: null, event: "" };
    const pass = () => {
      s.turn = (s.turn + 1) % n;
      s.roll = 0;
    };
    for (const m of moves) {
      if (s.winner !== null) return null;
      if (m === "r") {
        if (s.roll) return null; // use the roll first
        s.roll = dice(seed, s.rolls);
        s.rolls++;
        s.lastRoll = s.roll;
        s.event = "";
        if (ludoMovable(s).length === 0) {
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
      // Knock a lone enemy token home (not on a safe square, not in a home column).
      if (next <= 50) {
        const abs = toAbsolute(s.turn, next);
        if (!SAFE.has(abs)) {
          for (let q = 0; q < n; q++) {
            if (q === s.turn) continue;
            const there = s.pos[q].map((x, k) => (x >= 0 && x <= 50 && toAbsolute(q, x) === abs ? k : -1)).filter((k) => k >= 0);
            if (there.length === 1) {
              s.pos[q][there[0]] = -1;
              s.event = `knocked player ${q + 1} home`;
            }
          }
        }
      }
      if (s.pos[s.turn].every((x) => x === FINISH)) {
        s.winner = s.turn;
        s.roll = 0;
        continue;
      }
      const six = s.roll === 6;
      s.roll = 0;
      if (!six) s.turn = (s.turn + 1) % n;
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s) => outcome(s),
  summary: (s) => {
    const home = s.pos.map((ts) => ts.filter((x) => x === FINISH).length);
    return `home: ${home.map((h, i) => `P${i + 1} ${h}`).join(" · ")}${s.roll ? ` · roll ${s.roll}` : ""}`;
  },
};
