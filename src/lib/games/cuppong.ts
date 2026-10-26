// Cup Pong, two players (or two teams of two): six cups each in a triangle.
// Throw at the other side; the ball lands where you aim plus a small bounce
// (from the seed). Land in a cup and it is gone. First to clear the other
// side's cups wins. Moves: "t:<x>:<y>" — the aim on the far table half,
// units 0..300 across and 0..200 deep.

import { ON, rng, win, type GameDef, type Outcome } from "./core.ts";

export const CUP_R = 22;
/** Cup centres (x, y) for a side, laid out as a 3-2-1 triangle pointing at the thrower. */
export const CUPS: [number, number][] = [
  [100, 150], [150, 150], [200, 150],
  [125, 110], [175, 110],
  [150, 70],
];

export interface PongState {
  /** cups[side][i] = still standing. */
  cups: boolean[][];
  turn: number;
  last: { x: number; y: number; hit: number } | null;
  throws: number;
  winner: number | null;
}

function outcome(s: PongState): Outcome {
  return s.winner !== null ? win(s.winner, "cleared every cup") : ON;
}

export const cupPong: GameDef<PongState> = {
  id: "cuppong",
  name: "Cup Pong",
  blurb: "Bounce the ball into their cups before they clear yours.",
  emoji: "🥤",
  minPlayers: 2,
  maxPlayers: 4,
  replay(moves, n, seed) {
    const sides = 2;
    const s: PongState = { cups: Array.from({ length: sides }, () => Array(6).fill(true)), turn: 0, last: null, throws: 0, winner: null };
    for (const m of moves) {
      if (s.winner !== null) return null;
      const mv = /^t:(-?\d+):(-?\d+)$/.exec(m);
      if (!mv) return null;
      const next = rng(`${seed}#pong${s.throws}`);
      next();
      const jitter = 10;
      const x = Number(mv[1]) + Math.round((next() - 0.5) * 2 * jitter);
      const y = Number(mv[2]) + Math.round((next() - 0.5) * 2 * jitter);
      const target = 1 - (s.turn % 2); // player 0 and 2 shoot at side 1
      let hit = -1;
      CUPS.forEach(([cx, cy], i) => {
        if (s.cups[target][i] && (x - cx) ** 2 + (y - cy) ** 2 <= CUP_R * CUP_R) hit = i;
      });
      if (hit >= 0) s.cups[target][hit] = false;
      s.last = { x, y, hit };
      s.throws++;
      if (s.cups[target].every((c) => !c)) s.winner = s.turn;
      else s.turn = (s.turn + 1) % n;
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s) => outcome(s),
  summary: (s) => `cups left: ${s.cups[0].filter(Boolean).length} · ${s.cups[1].filter(Boolean).length}`,
};
