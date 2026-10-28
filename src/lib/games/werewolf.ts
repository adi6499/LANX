// Werewolf — 5 to 12 players, run by the host. The host's PC deals the roles
// in secret (werewolves, one seer, villagers) and tells each player theirs
// privately. Each night the werewolves pick a victim and the seer peeks at
// someone (private steps to the host, tagged with the night); each day
// everyone votes to lynch a suspect. The village wins when the last werewolf
// is gone; the werewolves win when they are as many as the villagers left.
// The host's PC writes the public story below; roles are revealed at the end,
// and the whole winning side wins together (dead or alive).
//
// Public moves (host): "night:<r>", "dawn:<r>:<victim|none>", "day:<r>",
// "lynch:<r>:<player|none>", "end:<village|wolves>:<roles…>". Players vote
// in the day with "<player>@v:<target>" (or "<player>@v:skip"). LANX 2.17.0:
// "x<p>" — player p left the table: they count as dead from then on (a wolf
// who left no longer keeps the village from winning), their vote is dropped.

import { ON, leaver, teamWin, type GameDef, type Outcome } from "./core.ts";

export type Role = "wolf" | "seer" | "villager";
export type Vote = number | "skip";

export interface WerewolfState {
  round: number;
  /** "lobby" before the first night, then "night" | "day" | "over". */
  phase: "lobby" | "night" | "day" | "over";
  alive: boolean[];
  /** LANX 2.17.0: who left the table (they are also not alive). */
  left: boolean[];
  /** Votes this day, by voter. */
  votes: Record<number, Vote>;
  /** LANX 2.17.0: each day's votes as they stood when the village decided, and who was lynched. */
  days: { round: number; votes: Record<number, Vote>; lynched: number | null }[];
  /** "P2" = player 2; the boards put names in. */
  log: string[];
  /** Revealed at the end. */
  roles: Role[] | null;
  winner: "village" | "wolves" | null;
}

export const wolfCount = (n: number) => Math.max(1, Math.floor(n / 4));

/** The host deals roles with its own randomness (never from the shared seed). LANX 2.17.0: only to
 *  the players still at the table (anyone who already left is dealt a villager). */
export function dealRoles(n: number, random: () => number, inPlay?: readonly boolean[]): Role[] {
  const roles: Role[] = Array(n).fill("villager");
  const seated = Array.from({ length: n }, (_, i) => i).filter((i) => !inPlay || inPlay[i]);
  const order = seated.sort(() => random() - 0.5);
  const wolves = Math.min(wolfCount(order.length), Math.max(0, order.length - 2));
  for (let k = 0; k < Math.max(1, wolves); k++) if (order[k] !== undefined) roles[order[k]] = "wolf";
  const seer = order[Math.max(1, wolves)];
  if (seer !== undefined) roles[seer] = "seer";
  return roles;
}

/** LANX 2.17.0: who the day's vote lynches — whoever has the most votes. A vote to skip is a vote for
 *  "no lynch": a tie at the top, or the most votes to skip, lynches nobody. Votes by or for anyone no
 *  longer alive don't count. */
export function tally(s: Pick<WerewolfState, "votes" | "alive">): number | null {
  const counts = new Map<Vote, number>();
  for (const [voter, v] of Object.entries(s.votes)) {
    if (!s.alive[Number(voter)] || (v !== "skip" && !s.alive[v])) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: Vote | null = null;
  let bestN = 0;
  let tie = false;
  for (const [t, c] of counts) {
    if (c > bestN) {
      best = t;
      bestN = c;
      tie = false;
    } else if (c === bestN) tie = true;
  }
  return best === null || best === "skip" || tie ? null : best;
}

/** A night action as it reaches the host's PC (private: the host and the pack only). */
export interface NightAct {
  kind: "kill" | "peek";
  from: number;
  target: number;
  /** LANX 2.17.0: the night it was meant for; any other night's are ignored. */
  night: number;
}

/** LANX 2.17.0: how the night ends, from this night's actions in the order they arrived. Each living
 *  wolf's latest pick counts as their vote: the player most wolves picked dies (a tie goes to the one
 *  picked first). The seer's latest peek. The night is over early once every living wolf has picked
 *  and the seer (if alive) has peeked. */
export function resolveNight(acts: readonly NightAct[], roles: readonly Role[], alive: readonly boolean[], night: number) {
  const wolves = roles.map((r, p) => (r === "wolf" && alive[p] ? p : -1)).filter((p) => p >= 0);
  const seer = roles.findIndex((r, p) => r === "seer" && alive[p]);
  const picks = new Map<number, { target: number; at: number }>();
  let peek: number | null = null;
  acts.forEach((a, at) => {
    if (a.night !== night || a.target === a.from || !alive[a.target]) return;
    if (a.kind === "kill" && wolves.includes(a.from) && roles[a.target] !== "wolf") picks.set(a.from, { target: a.target, at });
    else if (a.kind === "peek" && a.from === seer) peek = a.target;
  });
  const votes = new Map<number, { n: number; first: number }>();
  for (const { target, at } of picks.values()) {
    const v = votes.get(target);
    if (v) {
      v.n++;
      v.first = Math.min(v.first, at);
    } else votes.set(target, { n: 1, first: at });
  }
  let victim: number | null = null;
  let best: { n: number; first: number } | null = null;
  for (const [t, v] of votes)
    if (!best || v.n > best.n || (v.n === best.n && v.first < best.first)) {
      victim = t;
      best = v;
    }
  const allIn = wolves.length > 0 && wolves.every((w) => picks.has(w)) && (seer < 0 || peek !== null);
  return { victim, peek: peek as number | null, seer, wolves, allIn, picks: [...picks].map(([wolf, p]) => ({ wolf, target: p.target })) };
}

/** Who is on each side once the roles are known (the leavers are left out of the win). */
export function sideOf(roles: Role[], side: "village" | "wolves"): number[] {
  return roles.map((r, p) => ((side === "wolves") === (r === "wolf") ? p : -1)).filter((p) => p >= 0);
}

function outcome(s: WerewolfState): Outcome {
  if (s.winner === null || !s.roles) return ON;
  const side = sideOf(s.roles, s.winner);
  const stayed = side.filter((p) => !s.left[p]);
  return teamWin(stayed.length ? stayed : side, s.winner === "wolves" ? "the werewolves win" : "the village wins");
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
    const s: WerewolfState = { round: 0, phase: "lobby", alive: Array(n).fill(true), left: Array(n).fill(false), votes: {}, days: [], log: [], roles: null, winner: null };
    for (const m of moves) {
      if (s.phase === "over") return null;
      let mm: RegExpExecArray | null;
      const gone = leaver(m, n);
      if (gone !== null) {
        if (gone < 0 || s.left[gone]) return null;
        s.left[gone] = true;
        s.alive[gone] = false;
        delete s.votes[gone];
        s.log.push(`P${gone + 1} left the game.`);
      } else if ((mm = /^night:(\d+)$/.exec(m))) {
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
          s.log.push(`Dawn ${s.round}: P${v + 1} was found dead.`);
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
        const t = mm[2] === "none" ? null : Number(mm[2]);
        if (t !== null && (t < 0 || t >= n || !s.alive[t])) return null;
        s.days.push({ round: s.round, votes: { ...s.votes }, lynched: t });
        if (t !== null) {
          s.alive[t] = false;
          s.log.push(`Day ${s.round}: the village lynched P${t + 1}.`);
        } else s.log.push(`Day ${s.round}: no lynch — the vote was tied or most chose to skip.`);
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
