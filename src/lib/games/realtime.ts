// The real-time games (Air Hockey, Table Soccer, Spinner Wars) are not
// replayed from moves like the others: the host's PC runs the physics and
// streams positions to everyone over a direct data channel (see
// lib/gameChannel.ts). Only what matters for the record is written as
// moves by the host: goals, knock-outs, rounds and the end.
// Moves: "g:<player>" (a goal), "out:<player>" (knocked out), "round" (the
// next round of Spinner Wars), "end:<player>", and (2.17.0) "x<player>"
// (left the table: in a two-player game the other one wins; in Spinner
// Wars they are out for good and the others play on).
// LANX 2.17.0: Spinner Wars' round wins are counted from the record (the
// one still in when a round ends wins it), so a board that opens late —
// or the host's board coming back — carries on from the real score.

import { ON, leaver, win, type GameDef, type Outcome } from "./core.ts";

export interface RealtimeState {
  goals: number[];
  /** Out of this round (Spinner Wars). */
  out: boolean[];
  /** LANX 2.17.0: left the table. */
  left: boolean[];
  /** Rounds won (Spinner Wars). */
  wins: number[];
  /** Rounds finished. */
  rounds: number;
  winner: number | null;
  /** Why the game ended, when somebody left. */
  reason: string;
  /** "P2" = player 2; the boards put names in. */
  log: string[];
}

/** Spinner Wars: first to two round wins; after three rounds the one with the most round wins — and
 *  while two or more share the most, the rounds go on. Null while nobody has won yet. */
export function spinnerChampion(wins: number[], roundsDone: number, left: boolean[]): number | null {
  const champ = wins.findIndex((w, i) => w >= 2 && !left[i]);
  if (champ >= 0) return champ;
  if (roundsDone < 3) return null;
  const inPlay = wins.map((_, i) => i).filter((i) => !left[i]);
  const best = Math.max(...inPlay.map((i) => wins[i]));
  const tops = inPlay.filter((i) => wins[i] === best);
  return tops.length === 1 ? tops[0] : null;
}

function makeDef(id: string, name: string, blurb: string, emoji: string, maxPlayers: number, target: number, what: "goal" | "knock-out"): GameDef<RealtimeState> & { realtime: true; target: number } {
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
      const s: RealtimeState = { goals: Array(n).fill(0), out: Array(n).fill(false), left: Array(n).fill(false), wins: Array(n).fill(0), rounds: 0, winner: null, reason: "", log: [] };
      const stillIn = () => s.out.map((o, i) => (o ? -1 : i)).filter((i) => i >= 0);
      for (const m of moves) {
        if (s.winner !== null) return null;
        let mm: RegExpExecArray | null;
        const gone = leaver(m, n);
        if (gone !== null) {
          if (gone < 0 || s.left[gone]) return null;
          s.left[gone] = true;
          s.out[gone] = true;
          s.log.push(`P${gone + 1} left the game`);
          const rest = s.left.map((l, i) => (l ? -1 : i)).filter((i) => i >= 0);
          if (rest.length === 1) {
            s.winner = rest[0];
            s.reason = n === 2 ? `P${gone + 1} left` : "the others left";
            s.log.push(`P${rest[0] + 1} wins`);
          }
        } else if ((mm = /^g:(\d+)$/.exec(m))) {
          const p = Number(mm[1]);
          if (p < 0 || p >= n) return null;
          s.goals[p]++;
          s.log.push(`${what === "goal" ? "Goal" : "Point"} for P${p + 1} (${s.goals.join("–")})`);
        } else if ((mm = /^out:(\d+)$/.exec(m))) {
          const p = Number(mm[1]);
          if (p < 0 || p >= n) return null;
          s.out[p] = true;
          s.log.push(`P${p + 1} is out`);
        } else if (m === "round") {
          const alive = stillIn();
          if (alive.length === 1) s.wins[alive[0]]++;
          s.rounds++;
          s.out = [...s.left];
          s.log.push(alive.length === 1 ? `P${alive[0] + 1} wins round ${s.rounds} — round ${s.rounds + 1}` : `Nobody wins round ${s.rounds} — round ${s.rounds + 1}`);
        } else if ((mm = /^end:(\d+)$/.exec(m))) {
          const p = Number(mm[1]);
          if (p < 0 || p >= n) return null;
          if (what === "knock-out") {
            const alive = stillIn();
            if (alive.length === 1 && alive[0] === p) s.wins[p]++;
            s.rounds++;
          }
          s.winner = p;
          s.log.push(`P${p + 1} wins`);
        } else return null;
      }
      return s;
    },
    turn: () => -1,
    outcome: (s): Outcome => {
      if (s.winner === null) return ON;
      if (s.reason) return win(s.winner, s.reason);
      return win(s.winner, what === "goal" ? `${s.goals[s.winner]}–${Math.max(0, ...s.goals.filter((_, i) => i !== s.winner))}` : `${s.wins[s.winner]} round${s.wins[s.winner] === 1 ? "" : "s"} won`);
    },
    summary: (s) => (what === "goal" ? s.goals.map((g, i) => `P${i + 1} ${g}`).join(" · ") : `${s.out.filter((o) => !o).length} in · round ${s.rounds + 1} · wins ` + s.wins.map((w, i) => `P${i + 1} ${w}`).join(" · ")),
  };
}

export const airhockey = makeDef("airhockey", "Air Hockey", "Live puck, live paddles — first to five.", "🏒", 2, 5, "goal");
export const foosball = makeDef("foosball", "Table Soccer", "Four rods a side, live ball — first to five.", "⚽", 2, 5, "goal");
export const spinnerWars = makeDef("spinnerwars", "Spinner Wars", "Bump the others out of the arena; last spinner standing.", "🌀", 8, 3, "knock-out");
