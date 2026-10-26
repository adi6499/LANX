// The real-time games (Air Hockey, Table Soccer, Spinner Wars) are not
// replayed from moves like the others: the host's PC runs the physics and
// streams positions to everyone over a direct data channel (see
// lib/gameChannel.ts). Only what matters for the record is written as
// moves by the host: goals, knock-outs and the end.
// Moves: "g:<player>" (a goal), "out:<player>" (knocked out), "end:<player>".

import { ON, win, type GameDef, type Outcome } from "./core.ts";

export interface RealtimeState {
  goals: number[];
  out: boolean[];
  rounds: number;
  winner: number | null;
  log: string[];
}

function makeDef(id: string, name: string, blurb: string, emoji: string, maxPlayers: number, target: number, what: string): GameDef<RealtimeState> & { realtime: true; target: number } {
  return {
    id,
    name,
    blurb,
    emoji,
    minPlayers: 2,
    maxPlayers,
    hosted: true,
    realtime: true,
    target,
    replay(moves, n) {
      const s: RealtimeState = { goals: Array(n).fill(0), out: Array(n).fill(false), rounds: 0, winner: null, log: [] };
      for (const m of moves) {
        if (s.winner !== null) return null;
        let mm: RegExpExecArray | null;
        if ((mm = /^g:(\d+)$/.exec(m))) {
          const p = Number(mm[1]);
          if (p < 0 || p >= n) return null;
          s.goals[p]++;
          s.log.push(`${what} for Player ${p + 1} (${s.goals.join("–")})`);
        } else if ((mm = /^out:(\d+)$/.exec(m))) {
          const p = Number(mm[1]);
          if (p < 0 || p >= n) return null;
          s.out[p] = true;
          s.log.push(`Player ${p + 1} is out`);
        } else if (m === "round") {
          s.rounds++;
          s.out = Array(n).fill(false);
          s.log.push(`Round ${s.rounds + 1}`);
        } else if ((mm = /^end:(\d+)$/.exec(m))) {
          const p = Number(mm[1]);
          if (p < 0 || p >= n) return null;
          s.winner = p;
          s.log.push(`Player ${p + 1} wins`);
        } else return null;
      }
      return s;
    },
    turn: () => -1,
    outcome: (s): Outcome => (s.winner !== null ? win(s.winner, `${what === "goal" ? `${Math.max(...s.goals)} goals` : "the last one standing"}`) : ON),
    summary: (s) => (what === "goal" ? s.goals.map((g, i) => `P${i + 1} ${g}`).join(" · ") : `${s.out.filter((o) => !o).length} in · round ${s.rounds + 1}`),
  };
}

export const airhockey = makeDef("airhockey", "Air Hockey", "Live puck, live paddles — first to five.", "🏒", 2, 5, "goal");
export const foosball = makeDef("foosball", "Table Soccer", "Four rods a side, live ball — first to five.", "⚽", 2, 5, "goal");
export const spinnerWars = makeDef("spinnerwars", "Spinner Wars", "Bump the others out of the arena; last spinner standing.", "🌀", 8, 3, "knock-out");
