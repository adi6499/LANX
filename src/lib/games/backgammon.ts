// Backgammon, two players. Points 0..23; white (player 0) moves from 23 down
// to 0 and bears off from 0..5, black (player 1) from 0 up to 23 and bears
// off from 18..23. The match rolls the dice (doubles give four moves). A lone
// checker is hit and goes to the bar; you must re-enter from the bar first.
// First to bear off all fifteen wins.
//
// Moves: "r" (roll), "m:<from>:<die>" (from 0..23 or "bar"; die 1..6), and
// "x" to end the turn when the dice left cannot be used.

import { ON, dice, win, type GameDef, type Outcome } from "./core.ts";

export interface BgState {
  /** points[i] = number of checkers; positive white, negative black. */
  points: number[];
  bar: [number, number];
  off: [number, number];
  turn: number;
  /** Dice still to use this turn. */
  dice: number[];
  lastRoll: [number, number] | null;
  rolls: number;
  winner: number | null;
}

const start = (): number[] => {
  const p = Array(24).fill(0);
  p[23] = 2;
  p[12] = 5;
  p[7] = 3;
  p[5] = 5;
  p[0] = -2;
  p[11] = -5;
  p[16] = -3;
  p[18] = -5;
  return p;
};

const sign = (p: number) => (p === 0 ? 1 : -1);
const owns = (s: BgState, i: number, p: number) => (p === 0 ? s.points[i] > 0 : s.points[i] < 0);
const blocked = (s: BgState, i: number, p: number) => (p === 0 ? s.points[i] <= -2 : s.points[i] >= 2);
const homeOf = (p: number) => (p === 0 ? [0, 1, 2, 3, 4, 5] : [18, 19, 20, 21, 22, 23]);

function allHome(s: BgState, p: number): boolean {
  if (s.bar[p] > 0) return false;
  for (let i = 0; i < 24; i++) if (owns(s, i, p) && !homeOf(p).includes(i)) return false;
  return true;
}

/** Where a checker from `from` lands with `die`, or -1 for bearing off, or null if not allowed. */
export function bgTarget(s: BgState, from: number | "bar", die: number, p: number): number | null {
  const dir = p === 0 ? -1 : 1;
  if (from === "bar") {
    if (s.bar[p] === 0) return null;
    const to = p === 0 ? 24 - die : die - 1;
    return blocked(s, to, p) ? null : to;
  }
  if (s.bar[p] > 0 || !owns(s, from, p)) return null;
  const to = from + dir * die;
  if (to >= 0 && to < 24) return blocked(s, to, p) ? null : to;
  // Bearing off: everyone home; exact die, or a higher die from the farthest point.
  if (!allHome(s, p)) return null;
  const exact = p === 0 ? from + 1 === die : 24 - from === die;
  if (exact) return -1;
  const farther = homeOf(p).some((i) => owns(s, i, p) && (p === 0 ? i > from : i < from));
  return farther ? null : -1;
}

export function bgMoves(s: BgState): { from: number | "bar"; die: number; to: number }[] {
  const out: { from: number | "bar"; die: number; to: number }[] = [];
  const dice = [...new Set(s.dice)];
  for (const die of dice) {
    const t = bgTarget(s, "bar", die, s.turn);
    if (t !== null) out.push({ from: "bar", die, to: t });
    if (s.bar[s.turn] > 0) continue;
    for (let i = 0; i < 24; i++) {
      const to = bgTarget(s, i, die, s.turn);
      if (to !== null) out.push({ from: i, die, to });
    }
  }
  return out;
}

function apply(s: BgState, from: number | "bar", die: number): boolean {
  const p = s.turn;
  const k = s.dice.indexOf(die);
  if (k < 0) return false;
  const to = bgTarget(s, from, die, p);
  if (to === null) return false;
  if (from === "bar") s.bar[p]--;
  else s.points[from] -= sign(p);
  if (to === -1) s.off[p]++;
  else {
    const other = 1 - p;
    if (owns(s, to, other) && Math.abs(s.points[to]) === 1) {
      s.points[to] = 0;
      s.bar[other]++;
    }
    s.points[to] += sign(p);
  }
  s.dice.splice(k, 1);
  if (s.off[p] === 15) s.winner = p;
  return true;
}

function outcome(s: BgState): Outcome {
  return s.winner !== null ? win(s.winner, "all checkers borne off") : ON;
}

export const backgammon: GameDef<BgState> = {
  id: "backgammon",
  name: "Backgammon",
  blurb: "Race your checkers home on the dice; hit lone ones on the way.",
  emoji: "🎯",
  minPlayers: 2,
  maxPlayers: 2,
  replay(moves, _n, seed) {
    const s: BgState = { points: start(), bar: [0, 0], off: [0, 0], turn: 0, dice: [], lastRoll: null, rolls: 0, winner: null };
    for (const m of moves) {
      if (s.winner !== null) return null;
      if (m === "r") {
        if (s.dice.length) return null;
        const a = dice(seed, s.rolls);
        const b = dice(seed, s.rolls + 1);
        s.rolls += 2;
        s.lastRoll = [a, b];
        s.dice = a === b ? [a, a, a, a] : [a, b];
        if (bgMoves(s).length === 0) {
          s.dice = [];
          s.turn = 1 - s.turn;
        }
        continue;
      }
      if (m === "x") {
        if (!s.dice.length || bgMoves(s).length) return null; // only when stuck
        s.dice = [];
        s.turn = 1 - s.turn;
        continue;
      }
      const mv = /^m:(bar|\d+):([1-6])$/.exec(m);
      if (!mv || !s.dice.length) return null;
      const from = mv[1] === "bar" ? "bar" : Number(mv[1]);
      if (!apply(s, from, Number(mv[2]))) return null;
      if (s.winner === null && (s.dice.length === 0 || bgMoves(s).length === 0)) {
        s.dice = [];
        s.turn = 1 - s.turn;
      }
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s) => outcome(s),
  summary: (s) => `off ${s.off[0]} · ${s.off[1]}${s.dice.length ? ` · dice ${s.dice.join(" ")}` : ""}`,
};
