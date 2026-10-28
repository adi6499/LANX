import { useEffect, useMemo, useRef, useState } from "react";
import { namesIn, seatFor, type BoardProps } from "../boardProps";
import { dealRoles, resolveNight, tally, werewolf, wolfCount, type NightAct, type Role, type Vote, type WerewolfState } from "../../../lib/games/werewolf.ts";
import { firstSeen, hostName, useDriver } from "./PartyShell";

type RoleCard = { kind: "role"; to: number; role: Role; wolves: number[]; s?: string; __from?: number };
type PeekResult = { kind: "peekResult"; to: number; target: number; wolf: boolean; night?: number; s?: string };
/** LANX 2.17.0: a night action goes privately (`to`) to the host, to the sender's own PC and — for a
 *  wolf's pick — to the rest of the pack, tagged with its night and the match round (`s`). */
type Act = NightAct & { to: number; s?: string; __from?: number };
type Delta = RoleCard | PeekResult | Act;
type Secret = { roles: Role[]; night: { round: number } };

export const ROLE_TEXT: Record<Role, string> = { wolf: "🐺 Werewolf — pick a victim each night with your pack.", seer: "🔮 Seer — peek at one player each night.", villager: "🧑‍🌾 Villager — find the wolves by day." };
export const NIGHT_SECS = 45;
export const DAY_SECS = 60;
export const VOTE_RULE = "Most votes is lynched; a tie — or most votes to skip — means no lynch.";

/** LANX 2.16.0: the whole Werewolf game — phases, the host's resolving of nights and days, your role and
 *  your actions — shared by the flat board and the 3D one, so both play the same game. */
export function useWerewolf({ moves, canPlay, seat, seats, starter = 0, seed = "", host, deltas = [], onDelta, secret, onSecret, onMove }: BoardProps) {
  // LANX 2.17.0: the real table size (the match won't start a table of fewer than five).
  const n = seats?.length || 5;
  const state = useMemo(() => werewolf.replay(moves, n, seed), [moves, n, seed]);
  const name = (p: number) => seatFor(seats, starter, p, n).name.split(" (")[0];
  const colour = (p: number) => seatFor(seats, starter, p, n).color;
  const tidy = (text: string) => namesIn(text, seats, starter, n);
  // What reached this PC for it: this match round's private steps addressed to me.
  const mine = useMemo(() => (deltas as Delta[]).filter((d) => !!d && typeof d === "object" && typeof d.kind === "string" && d.to === seat && (d.s === undefined || d.s === seed)), [deltas, seat, seed]);
  const myRole = [...mine].reverse().find((d): d is RoleCard => d.kind === "role");
  const peeks = useMemo(() => {
    const byNight = new Map<string, PeekResult>();
    for (const d of mine) if (d.kind === "peekResult") byNight.set(String(d.night ?? d.target), d);
    return [...byNight.values()];
  }, [mine]);
  // An action counts only if it really came from the player it names (`__from`, filled in by the match).
  const acts = mine.filter((d): d is Act => (d.kind === "kill" || d.kind === "peek") && typeof d.night === "number" && (typeof d.__from !== "number" || d.__from === d.from));
  const sec = (secret ?? null) as Secret | null;
  const night = state?.phase === "night" ? state.round : 0;
  const tonight = acts.filter((a) => a.night === night);
  const pack = myRole?.role === "wolf" ? myRole.wolves : [];
  const myAct = [...tonight].reverse().find((a) => a.from === seat);
  /** The pack's latest picks tonight (what my packmates chose). */
  const packPicks = useMemo(() => {
    const m = new Map<number, number>();
    for (const a of tonight) if (a.kind === "kill" && a.from !== seat && pack.includes(a.from)) m.set(a.from, a.target);
    return [...m].map(([wolf, target]) => ({ wolf, target }));
  }, [tonight, seat, pack]); // eslint-disable-line react-hooks/exhaustive-deps
  // The host's player number: the role card came from the host (or the host sits first).
  const hostP = host ? seat : typeof myRole?.__from === "number" ? myRole.__from : (n - starter) % n;
  const [acted, setActed] = useState("");
  const [, tick] = useState(0);
  const phaseKey = `${state?.round}:${state?.phase}`;
  const timed = state?.phase === "night" || state?.phase === "day";
  // The phase clock: from when this phase first showed on this PC (every board here agrees).
  const deadline = timed ? firstSeen(`ww|${seed}|${phaseKey}`) + (state?.phase === "night" ? NIGHT_SECS : DAY_SECS) * 1000 : 0;
  useEffect(() => {
    const t = window.setInterval(() => tick((x) => x + 1), 500);
    return () => window.clearInterval(t);
  }, []);
  // ---- the host: resolve nights and days (one board per match drives it, each step once).
  const drive = useDriver();
  const posted = useRef(new Set<string>());
  const run = useRef<() => void>(() => {});
  run.current = () => {
    if (!host || !state || !sec || state.phase === "lobby" || state.phase === "over") return;
    if (!drive(`ww|${seed}`)) return;
    const done = posted.current;
    const once = (k: string) => (done.has(`${seed}|${k}`) ? false : (done.add(`${seed}|${k}`), true));
    if (done.has(`${seed}|end`)) return;
    const finish = (alive: boolean[]) => {
      const w = sec.roles.filter((r, p) => r === "wolf" && alive[p]).length;
      const v = sec.roles.filter((r, p) => r !== "wolf" && alive[p]).length;
      if (w > 0 && w < v) return false;
      if (once("end")) onMove(`end:${w === 0 ? "village" : "wolves"}:${sec.roles.join(",")}`);
      return true;
    };
    // Someone left (or the night or day just ended): the game may be decided already.
    if (finish(state.alive)) return;
    if (done.has(`${seed}|${phaseKey}`)) return;
    if (state.phase === "night") {
      const r = resolveNight(tonight, sec.roles, state.alive, state.round);
      if (!r.allIn && Date.now() < deadline) return;
      if (!once(phaseKey)) return;
      if (r.peek !== null && r.seer >= 0) onDelta?.({ kind: "peekResult", to: r.seer, target: r.peek, wolf: sec.roles[r.peek] === "wolf", night: state.round, s: seed } satisfies PeekResult);
      onMove(`dawn:${state.round}:${r.victim === null ? "none" : r.victim}`);
      finish(state.alive.map((a, p) => a && p !== r.victim));
    } else {
      const living = state.alive.filter(Boolean).length;
      const voted = Object.keys(state.votes).filter((v) => state.alive[Number(v)]).length;
      if (voted < living && Date.now() < deadline) return;
      if (!once(phaseKey)) return;
      const t = tally(state);
      onMove(`lynch:${state.round}:${t === null ? "none" : t}`);
      if (!finish(state.alive.map((a, p) => a && p !== t))) onMove(`night:${state.round + 1}`);
    }
  };
  useEffect(() => run.current());
  useEffect(() => {
    if (!host) return;
    const t = window.setInterval(() => run.current(), 400);
    return () => window.clearInterval(t);
  }, [host]);
  const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  const start = () => {
    if (!state) return;
    const roles = dealRoles(n, Math.random, state.alive);
    onSecret?.({ roles, night: { round: 1 } } satisfies Secret);
    const wolves = roles.map((r, p) => (r === "wolf" ? p : -1)).filter((p) => p >= 0);
    roles.forEach((role, p) => state.alive[p] && onDelta?.({ kind: "role", to: p, role, wolves: role === "wolf" ? wolves : [], s: seed } satisfies RoleCard));
    onMove("night:1");
  };
  const send = (kind: "kill" | "peek", target: number) => {
    if (!state || state.phase !== "night") return;
    for (const to of new Set([hostP, seat, ...(kind === "kill" ? pack : [])])) onDelta?.({ kind, from: seat, target, night: state.round, to, s: seed } satisfies Act);
    setActed(`${seed}|${state.round}`);
  };
  const attack = (p: number) => send("kill", p);
  const peekAt = (p: number) => send("peek", p);
  const vote = (p: number | "skip") => onMove(`${seat}@v:${p}`);
  const done = !!myAct || acted === `${seed}|${night}`;
  const status = statusOf(state, seat, myRole?.role, done, !!host, hostName(seats));
  return { state, n, name, colour, tidy, myRole, peeks, left, start, attack, peekAt, vote, done, canPlay, seat, host: !!host, pack, packPicks, myAct, status };
}

/** What this player should know or do now, in words (the same on the flat and 3D boards). */
function statusOf(state: WerewolfState | null, seat: number, role: Role | undefined, done: boolean, host: boolean, hostIs: string): string {
  if (!state) return "";
  if (state.phase === "lobby") return host ? "Deal the roles when everyone's here" : `Waiting for ${hostIs} to deal the roles`;
  if (state.phase === "over") return state.winner === "village" ? "The village wins" : "The werewolves win";
  if (state.left[seat]) return "You left the game";
  if (!state.alive[seat]) return "You're out — watching";
  if (state.phase === "night") {
    if (role === "wolf") return done ? "Your pick is in — waiting for the dawn" : "Pick your victim";
    if (role === "seer") return done ? "Peek sent — waiting for the dawn" : "Pick someone to peek at";
    return "The village sleeps…";
  }
  return state.votes[seat] !== undefined ? "Vote cast — you can still change it" : "Vote someone out, or skip";
}

/** Who voted for whom: live during the day, then the last day's votes after the lynch. */
export function DayVotes({ state, name }: { state: WerewolfState; name: (p: number) => string }) {
  const live = state.phase === "day";
  const day = live ? { round: state.round, votes: state.votes, lynched: undefined as number | null | undefined } : state.days[state.days.length - 1];
  if (!day) return null;
  const entries = Object.entries(day.votes) as [string, Vote][];
  if (!entries.length && live) return null;
  return (
    <div className="max-w-full text-center text-[11.5px] text-slate-600 dark:text-slate-300" data-ww-votes-list>
      <span className="font-semibold">{live ? "Votes so far" : `Day ${day.round} votes`}:</span>{" "}
      {entries.length ? entries.map(([voter, v]) => `${name(Number(voter))} → ${v === "skip" ? "skip" : name(v)}`).join(" · ") : "nobody voted"}
      {!live && <span> — {day.lynched === null || day.lynched === undefined ? "no lynch" : `${name(day.lynched)} was lynched`}.</span>}
    </div>
  );
}

/** Werewolf: the host's PC keeps the roles and runs the nights and days. */
export function WerewolfBoard(p: BoardProps) {
  const { state, n, name, colour, tidy, myRole, peeks, left, start, attack, peekAt, vote, done, canPlay, seat, host, pack, packPicks, status } = useWerewolf(p);
  if (!state) return null;
  const alive = state.alive;
  const iAmAlive = alive[seat];
  const wolves = wolfCount(alive.filter(Boolean).length);
  const votesFor = (q: number) => Object.entries(state.votes).filter(([v, t]) => t === q && alive[Number(v)]).length;
  const players = (pick: (q: number) => void, label: string, chosen: number | undefined, skip: number[] = []) => (
    <div className="flex flex-wrap justify-center gap-1.5" data-ww-targets>
      {alive.map((a, q) =>
        a && q !== seat && !skip.includes(q) ? (
          <button key={q} type="button" data-ww-target={q} disabled={!canPlay || (state.phase === "night" && done)} onClick={() => pick(q)} className={`inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[12.5px] font-semibold text-slate-900 shadow ring-1 hover:bg-indigo-50 disabled:opacity-50 dark:bg-slate-800 dark:text-white ${chosen === q ? "ring-2 ring-indigo-500" : "ring-black/10"}`}>
            <span className="g3-token h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colour(q) }} /> {label} {name(q)}
            {state.phase === "day" && votesFor(q) > 0 && <span className="rounded-full bg-rose-600 px-1.5 text-[10.5px] text-white" data-ww-votes={q}>{votesFor(q)}</span>}
            {state.phase === "night" && packPicks.filter((x) => x.target === q).map((x) => <span key={x.wolf} className="text-[10.5px] text-rose-600" data-ww-pack-pick={x.wolf}>🐺 {name(x.wolf)}</span>)}
          </button>
        ) : null,
      )}
    </div>
  );
  const myVote = state.votes[seat];
  return (
    <div data-game-board="werewolf" data-ww-phase={state.phase} className="flex w-full max-w-[640px] flex-col items-center gap-3">
      <div className="flex flex-wrap justify-center gap-1.5" data-ww-players>
        {alive.map((a, q) => (
          <span key={q} data-ww-player={q} data-ww-alive={a ? "1" : undefined} className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${a ? "bg-white shadow ring-1 ring-black/10 dark:bg-slate-800" : "line-through opacity-50"}`}>
            <span className="g3-token h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colour(q) }} /> {name(q)}
            {state.left[q] && <span className="font-normal text-slate-400">(left)</span>}
            {state.roles && <span className="text-slate-400">· {state.roles[q]}</span>}
          </span>
        ))}
      </div>
      <div className="text-[13px] font-semibold" data-ww-status>
        {state.phase === "night" ? `🌙 Night ${state.round} · ${left}s — ` : state.phase === "day" ? `☀️ Day ${state.round} · ${left}s — ` : ""}
        {status}
      </div>
      {myRole && state.phase !== "lobby" && (
        <div className="rounded-xl bg-amber-500/15 px-3 py-1.5 text-[12.5px] text-amber-900 dark:text-amber-100" data-ww-role={myRole.role}>
          {ROLE_TEXT[myRole.role]}
          {myRole.role === "wolf" && pack.length > 1 && <span> Your pack: {pack.filter((q) => q !== seat).map(name).join(", ")}.</span>}
          {peeks.length > 0 && <div className="mt-0.5">Peeks: {peeks.map((x) => `${name(x.target)} is ${x.wolf ? "a werewolf" : "not a werewolf"}`).join("; ")}</div>}
        </div>
      )}
      {state.phase === "lobby" && (
        <div className="flex flex-col items-center gap-2 text-[13px]">
          <div className="text-slate-500">
            {n} players: {wolves} werewolf{wolves > 1 ? "s" : ""}, a seer, villagers. The host deals the roles in secret.
          </div>
          {host && (
            <button type="button" data-ww-start onClick={start} className="rounded-full bg-indigo-600 px-5 py-2 font-semibold text-white">
              Deal roles & start the first night
            </button>
          )}
        </div>
      )}
      {state.phase === "night" && (
        <div className="flex flex-col items-center gap-2 text-[13px]" data-ww-night>
          {iAmAlive && myRole?.role === "wolf" && players(attack, "Attack", undefined, pack)}
          {iAmAlive && myRole?.role === "seer" && players(peekAt, "Peek at", undefined)}
        </div>
      )}
      {state.phase === "day" && (
        <div className="flex flex-col items-center gap-2 text-[13px]" data-ww-day>
          <div className="text-[11.5px] text-slate-500">
            {Object.keys(state.votes).filter((v) => alive[Number(v)]).length} of {alive.filter(Boolean).length} voted. {VOTE_RULE}
          </div>
          {iAmAlive && (
            <>
              {players((q) => vote(q), "Vote", typeof myVote === "number" ? myVote : undefined)}
              <button type="button" data-ww-skip disabled={!canPlay} onClick={() => vote("skip")} className={`rounded-full px-3 py-1 text-[12px] font-semibold ${myVote === "skip" ? "bg-indigo-600 text-white" : "bg-slate-500/10"}`}>
                Skip this vote
              </button>
            </>
          )}
        </div>
      )}
      <DayVotes state={state} name={name} />
      <div className="max-w-full text-center text-[11.5px] text-slate-600 dark:text-slate-300" data-ww-log>
        {state.log.slice(-3).map((l, i) => (
          <div key={i}>{tidy(l)}</div>
        ))}
      </div>
    </div>
  );
}
