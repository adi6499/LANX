// Werewolf — 5 to 12 players, run by the host. The host's PC deals the roles
// in secret (werewolves, one seer, villagers) and tells each player theirs
// privately. Each night the werewolves pick a victim and the seer peeks at
// someone (private steps to the host); each day everyone votes to lynch a
// suspect. The village wins when the last werewolf is gone; the werewolves
// win when they are as many as the villagers left. The host's PC writes the
// public story below; roles are revealed at the end.
//
// Public moves (host): "night:<r>", "dawn:<r>:<victim|none>", "day:<r>",
// "lynch:<r>:<player|none>", "end:<village|wolves>:<roles…>". Players vote
// in the day with "<player>@v:<target>" (or "<player>@v:skip").

import { ON, win, type GameDef, type Outcome } from "./core.ts";

export type Role = "wolf" | "seer" | "villager";

export interface WerewolfState {
  round: number;
  /** "lobby" before the first night, then "night" | "day" | "over". */
  phase: "lobby" | "night" | "day" | "over";
  alive: boolean[];
  /** Votes this day, by voter. */
  votes: Record<number, number | "skip">;
  log: string[];
  /** Revealed at the end. */
  roles: Role[] | null;
  winner: "village" | "wolves" | null;
}

export const wolfCount = (n: number) => Math.max(1, Math.floor(n / 4));

/** The host deals roles with its own randomness (never from the shared seed). */
export function dealRoles(n: number, random: () => number): Role[] {
  const roles: Role[] = Array(n).fill("villager");
  const order = Array.from({ length: n }, (_, i) => i).sort(() => random() - 0.5);
  for (let k = 0; k < wolfCount(n); k++) roles[order[k]] = "wolf";
  roles[order[wolfCount(n)]] = "seer";
  return roles;
}

/** Who the day's vote lynches: a clear majority of the living, or nobody. */
export function tally(s: WerewolfState): number | null {
  const counts = new Map<number, number>();
  let voters = 0;
  for (const v of Object.values(s.votes)) {
    voters++;
    if (v !== "skip") counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestN = 0;
  let tie = false;
  for (const [t, c] of counts) {
    if (c > bestN) {
      best = t;
      bestN = c;
      tie = false;
    } else if (c === bestN) tie = true;
  }
  if (best === null || tie || bestN * 2 <= voters) return null;
  return best;
}

function outcome(s: WerewolfState): Outcome {
  if (s.winner === null || !s.roles) return ON;
  const team = s.winner === "wolves" ? "wolf" : null;
  const first = s.roles.findIndex((r) => (team ? r === "wolf" : r !== "wolf"));
  return win(Math.max(0, first), s.winner === "wolves" ? "the werewolves win" : "the village wins");
}

export const werewolf: GameDef<WerewolfState> = {
  id: "werewolf",
  name: "Werewolf",
  blurb: "Hidden roles: find the wolves by day before they eat the village by night.",
  emoji: "🐺",
  minPlayers: 5,
  maxPlayers: 12,
  hosted: true,
  replay(moves, n) {
    const s: WerewolfState = { round: 0, phase: "lobby", alive: Array(n).fill(true), votes: {}, log: [], roles: null, winner: null };
    for (const m of moves) {
      if (s.phase === "over") return null;
      let mm: RegExpExecArray | null;
      if ((mm = /^night:(\d+)$/.exec(m))) {
        if (Number(mm[1]) !== s.round + 1 || (s.phase !== "lobby" && s.phase !== "day")) return null;
        s.round++;
        s.phase = "night";
        s.votes = {};
        s.log.push(`Night ${s.round} falls.`);
      } else if ((mm = /^dawn:(\d+):(\d+|none)$/.exec(m))) {
        if (Number(mm[1]) !== s.round || s.phase !== "night") return null;
        if (mm[2] !== "none") {
          const v = Number(mm[2]);
          if (v < 0 || v >= n || !s.alive[v]) return null;
          s.alive[v] = false;
          s.log.push(`Dawn ${s.round}: Player ${v + 1} was found dead.`);
        } else s.log.push(`Dawn ${s.round}: everyone wakes up safe.`);
        s.phase = "day";
      } else if ((mm = /^day:(\d+)$/.exec(m))) {
        if (Number(mm[1]) !== s.round || s.phase !== "day") return null;
        s.votes = {};
      } else if ((mm = /^(\d+)@v:(\d+|skip)$/.exec(m))) {
        const p = Number(mm[1]);
        if (s.phase !== "day" || p < 0 || p >= n || !s.alive[p]) return null;
        if (mm[2] !== "skip") {
          const t = Number(mm[2]);
          if (t < 0 || t >= n || !s.alive[t] || t === p) return null;
          s.votes[p] = t;
        } else s.votes[p] = "skip";
      } else if ((mm = /^lynch:(\d+):(\d+|none)$/.exec(m))) {
        if (Number(mm[1]) !== s.round || s.phase !== "day") return null;
        if (mm[2] !== "none") {
          const t = Number(mm[2]);
          if (t < 0 || t >= n || !s.alive[t]) return null;
          s.alive[t] = false;
          s.log.push(`Day ${s.round}: the village lynched Player ${t + 1}.`);
        } else s.log.push(`Day ${s.round}: the village could not agree.`);
      } else if ((mm = /^end:(village|wolves):([a-z,]+)$/.exec(m))) {
        const roles = mm[2].split(",") as Role[];
        if (roles.length !== n || roles.some((r) => !["wolf", "seer", "villager"].includes(r))) return null;
        s.roles = roles;
        s.winner = mm[1] as "village" | "wolves";
        s.phase = "over";
        s.log.push(mm[1] === "wolves" ? "The werewolves have taken the village." : "The village is safe — every werewolf is gone.");
      } else return null;
    }
    return s;
  },
  turn: () => -1,
  outcome: (s) => outcome(s),
  summary: (s) => `${s.alive.filter(Boolean).length} alive · ${s.phase === "lobby" ? "waiting for the host" : s.phase}`,
};
