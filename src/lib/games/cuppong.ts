// Cup Pong, LANX 2.17.0: two players, or two teams of two (four players —
// P1 and P3 against P2 and P4; three players can't play). Six cups a side
// in a triangle. Each turn a side throws two balls (one each in a team).
// The sight sways while you aim (pongSway, the same on every board), and
// the ball scatters a little from where it was thrown (from the seed): a
// clean landing drops in, a ball near the rim may roll in or out. A cup
// that is hit is gone. When a side loses its last cup it gets a rebuttal —
// one last turn: sink every cup still on the other side to force overtime
// (three cups each), or lose. A player who leaves is out; a side with no
// one left loses. Moves: "t:<x>:<y>" — where the ball was thrown, on the
// far table half, units 0..300 across and 0..200 deep; "x<p>" (player p left).

import { ON, draw, leaver, rng, teamWin, type GameDef, type Outcome } from "./core.ts";

export const CUP_R = 22;
/** Cup centres (x, y) for a side, laid out as a 3-2-1 triangle pointing at the thrower. */
export const CUPS: [number, number][] = [
  [100, 150], [150, 150], [200, 150],
  [125, 110], [175, 110],
  [150, 70],
];
/** Overtime: the front three (a 2-1 triangle). */
const OVERTIME_CUPS = [3, 4, 5];
/** A landing this close to a cup's centre drops straight in; out to RIM_R it may roll in or out. */
const CLEAN_R = 13;
const RIM_R = 23;
/** How far a throw scatters (each way, roughly a bell curve up to this much). */
const SCATTER = 28;

/** How far the sight has swayed (table units), `t` seconds into your turn. Boards add it to the aim. */
export function pongSway(t: number): [number, number] {
  return [Math.sin((t * Math.PI * 2) / 1.9) * 24, Math.sin((t * Math.PI * 2) / 2.6) * 20];
}

/** Which side a player throws for: P1, P3 (0, 2) are side 0; P2, P4 side 1. */
export const pongSide = (p: number) => p % 2;

export interface PongState {
  /** cups[side][i] = still standing. */
  cups: boolean[][];
  /** The player to throw next, and their side. */
  turn: number;
  side: number;
  /** Throws made this turn (a turn is two). */
  shot: number;
  last: { x: number; y: number; hit: number; rim: boolean; by: number; target: number } | null;
  throws: number;
  /** The winning side (−1 = a draw), or null while the game is on. */
  winner: number | null;
  winners: number[];
  reason: string;
  /** The side now throwing is on its last chance (its cups are all gone). */
  rebuttal: boolean;
  overtime: number;
  out: boolean[];
  /** What happened, in words ("P1 sank a cup — 5 left"); boards name the players. */
  event: string;
}

function members(s: PongState, side: number, n: number): number[] {
  const out: number[] = [];
  for (let p = side; p < n; p += 2) if (!s.out[p]) out.push(p);
  return out;
}

function outcome(s: PongState): Outcome {
  if (s.winner === null) return ON;
  if (s.winner < 0) return draw(s.reason);
  return teamWin(s.winners, s.reason);
}

export const cupPong: GameDef<PongState> = {
  id: "cuppong",
  name: "Cup Pong",
  blurb: "Bounce the ball into their cups before they clear yours.",
  emoji: "🥤",
  minPlayers: 2,
  maxPlayers: 4,
  replay(moves, n, seed) {
    if (n !== 2 && n !== 4) return null; // two players, or two teams of two
    const s: PongState = { cups: [Array(6).fill(true), Array(6).fill(true)], turn: 0, side: 0, shot: 0, last: null, throws: 0, winner: null, winners: [], reason: "", rebuttal: false, overtime: 0, out: Array(n).fill(false), event: "" };
    const won = (side: number, reason: string) => {
      s.winner = side;
      s.winners = members(s, side, n);
      s.reason = reason;
    };
    /** The next throw: the other teammate, or the other side once two balls are thrown. */
    const advance = () => {
      s.shot++;
      if (s.shot >= 2) {
        // A rebuttal that didn't clear the other side: the game is lost.
        if (s.rebuttal) {
          won(1 - s.side, "cleared every cup");
          s.event += " — no comeback";
          return;
        }
        s.side = 1 - s.side;
        s.shot = 0;
      }
      const team = members(s, s.side, n);
      s.turn = team[s.shot % team.length];
    };
    for (const m of moves) {
      if (s.winner !== null) return null;
      const gone = leaver(m, n);
      if (gone !== null) {
        if (gone < 0 || s.out[gone]) return null;
        s.out[gone] = true;
        s.event = `P${gone + 1} left the game`;
        const side = pongSide(gone);
        if (!members(s, side, n).length) {
          won(1 - side, n === 2 ? "the other player left" : "the other side left");
          continue;
        }
        const team = members(s, s.side, n);
        s.turn = team[s.shot % team.length];
        continue;
      }
      const mv = /^t:(-?\d+):(-?\d+)$/.exec(m);
      if (!mv) return null;
      const ax = Number(mv[1]);
      const ay = Number(mv[2]);
      if (Math.abs(ax - 150) > 400 || Math.abs(ay - 100) > 400) return null;
      const by = s.turn;
      // The scatter: the sum of three even numbers is a bell curve (plain arithmetic, the same on every PC).
      const r = rng(`${seed}#pong${s.throws}`);
      r();
      const x = ax + Math.round((r() + r() + r() - 1.5) * SCATTER);
      const y = ay + Math.round((r() + r() + r() - 1.5) * SCATTER);
      const roll = r();
      const target = 1 - s.side;
      let near = -1;
      let nd = Infinity;
      CUPS.forEach(([cx, cy], i) => {
        if (!s.cups[target][i]) return;
        const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (d < nd) {
          nd = d;
          near = i;
        }
      });
      let hit = -1;
      let rim = false;
      if (near >= 0 && nd <= CLEAN_R) hit = near;
      else if (near >= 0 && nd <= RIM_R) {
        rim = true;
        if (roll < (RIM_R - nd) / 14) hit = near;
      }
      s.throws++;
      s.last = { x, y, hit, rim, by, target };
      const who = `P${by + 1}`;
      if (hit >= 0) {
        s.cups[target][hit] = false;
        const left = s.cups[target].filter(Boolean).length;
        s.event = `${who} ${rim ? "rolled one in off the rim" : "sank a cup"} — ${left} left`;
        if (left === 0) {
          if (s.rebuttal) {
            // The comeback: overtime, three cups each.
            s.overtime++;
            if (s.overtime > 3) {
              s.winner = -1;
              s.reason = "still level after three overtimes";
              s.event += " — a draw";
              continue;
            }
            s.cups = [0, 1].map(() => CUPS.map((_c, i) => OVERTIME_CUPS.includes(i)));
            s.rebuttal = false;
            s.event += " — overtime! Three cups each";
            s.shot = 1; // the rebuttal turn is over
            advance();
            continue;
          }
          // Their last cup: they get one last turn to answer.
          s.rebuttal = true;
          s.side = target;
          s.shot = 0;
          const team = members(s, s.side, n);
          s.turn = team[0];
          s.event += ` — last chance for P${s.turn + 1}${team.length > 1 ? ` and P${team[1] + 1}` : ""}`;
          continue;
        }
      } else s.event = rim ? `${who} rimmed out` : `${who} missed`;
      advance();
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s) => outcome(s),
  summary: (s, n) => {
    const cups = (side: number) => s.cups[side].filter(Boolean).length;
    const team = (side: number) => (n === 4 ? `P${side + 1}+P${side + 3}` : `P${side + 1}`);
    return `cups left: ${team(0)} ${cups(0)} · ${team(1)} ${cups(1)}${s.rebuttal ? " · last chance!" : ""}${s.overtime ? " · overtime" : ""}`;
  },
};
