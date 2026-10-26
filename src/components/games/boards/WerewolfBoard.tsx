import { useEffect, useMemo, useRef, useState } from "react";
import { seatFor, type BoardProps } from "../boardProps";
import { dealRoles, tally, werewolf, type Role } from "../../../lib/games/werewolf.ts";

type Private = { kind: "role"; to: number; role: Role; wolves: number[] } | { kind: "peekResult"; to: number; target: number; wolf: boolean };
type Night = { kind: "kill" | "peek"; from: number; target: number };
type Delta = Private | Night;
type Secret = { roles: Role[]; night: { kill?: number; peek?: number; round: number } };

const ROLE_TEXT: Record<Role, string> = { wolf: "🐺 Werewolf — pick a victim each night with your pack.", seer: "🔮 Seer — peek at one player each night.", villager: "🧑‍🌾 Villager — find the wolves by day." };
const NIGHT_SECS = 45;
const DAY_SECS = 60;

/** Werewolf: the host's PC keeps the roles and runs the nights and days. */
export function WerewolfBoard({ moves, canPlay, seat, seats, starter = 0, seed = "", host, deltas = [], onDelta, secret, onSecret, onMove }: BoardProps) {
  const n = Math.max(5, seats?.length ?? 5);
  const state = useMemo(() => werewolf.replay(moves, n, seed), [moves, n, seed]);
  const name = (p: number) => seatFor(seats, starter, p, n).name;
  const colour = (p: number) => seatFor(seats, starter, p, n).color;
  const my = (deltas as Delta[]).filter((d) => d && typeof d === "object" && "to" in d && d.to === seat) as Private[];
  const myRole = my.find((d) => d.kind === "role") as (Private & { kind: "role" }) | undefined;
  const peeks = my.filter((d) => d.kind === "peekResult") as (Private & { kind: "peekResult" })[];
  const sec = (secret ?? null) as Secret | null;
  const [acted, setActed] = useState<number>(-1);
  const [deadline, setDeadline] = useState(0);
  const [, tick] = useState(0);
  const phaseKey = `${state?.round}:${state?.phase}`;
  const lastPhase = useRef("");

  // Clock for the current phase (the host closes phases; the others just watch).
  useEffect(() => {
    const t = window.setInterval(() => tick((x) => x + 1), 500);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    if (!state || lastPhase.current === phaseKey) return;
    lastPhase.current = phaseKey;
    setDeadline(Date.now() + (state.phase === "night" ? NIGHT_SECS : DAY_SECS) * 1000);
    setActed(-1);
  }, [state, phaseKey]);

  // ---- the host: night actions arrive as deltas; resolve when all are in or time is up.
  const nightActs = (deltas as Delta[]).filter((d) => d && typeof d === "object" && "from" in d) as Night[];
  useEffect(() => {
    if (!host || !state || !sec) return;
    if (state.phase === "night") {
      const wolves = sec.roles.map((r, p) => (r === "wolf" && state.alive[p] ? p : -1)).filter((p) => p >= 0);
      const seer = sec.roles.findIndex((r, p) => r === "seer" && state.alive[p]);
      const kills = nightActs.filter((d) => d.kind === "kill" && wolves.includes(d.from) && state.alive[d.target]);
      const peekList = nightActs.filter((d) => d.kind === "peek" && d.from === seer);
      const peek = peekList[peekList.length - 1];
      const kill = kills[kills.length - 1];
      const timeUp = Date.now() > deadline;
      const allIn = (kills.length >= wolves.length || (kill && wolves.length === 1)) && (seer < 0 || peek);
      if (!kill && !timeUp) return;
      if (!allIn && !timeUp) return;
      const victim = kill ? kill.target : null;
      if (peek && seer >= 0) onDelta?.({ kind: "peekResult", to: seer, target: peek.target, wolf: sec.roles[peek.target] === "wolf" } satisfies Private);
      const aliveAfter = state.alive.map((a, p) => a && p !== victim);
      onMove(`dawn:${state.round}:${victim === null ? "none" : victim}`);
      const w = sec.roles.filter((r, p) => r === "wolf" && aliveAfter[p]).length;
      const v = sec.roles.filter((r, p) => r !== "wolf" && aliveAfter[p]).length;
      if (w === 0) onMove(`end:village:${sec.roles.join(",")}`);
      else if (w >= v) onMove(`end:wolves:${sec.roles.join(",")}`);
    } else if (state.phase === "day") {
      const alive = state.alive.filter(Boolean).length;
      const voted = Object.keys(state.votes).length;
      if (voted < alive && Date.now() < deadline) return;
      const t = tally(state);
      const aliveAfter = state.alive.map((a, p) => a && p !== t);
      onMove(`lynch:${state.round}:${t === null ? "none" : t}`);
      const w = sec.roles.filter((r, p) => r === "wolf" && aliveAfter[p]).length;
      const v = sec.roles.filter((r, p) => r !== "wolf" && aliveAfter[p]).length;
      if (w === 0) onMove(`end:village:${sec.roles.join(",")}`);
      else if (w >= v) onMove(`end:wolves:${sec.roles.join(",")}`);
      else onMove(`night:${state.round + 1}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, state, sec, deltas, deadline, Math.floor(Date.now() / 1000)]);

  if (!state) return null;
  const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  const alive = state.alive;
  const iAmAlive = alive[seat];

  const start = () => {
    const roles = dealRoles(n, Math.random);
    onSecret?.({ roles, night: { round: 1 } } satisfies Secret);
    const wolves = roles.map((r, p) => (r === "wolf" ? p : -1)).filter((p) => p >= 0);
    roles.forEach((role, p) => onDelta?.({ kind: "role", to: p, role, wolves: role === "wolf" ? wolves : [] } satisfies Private));
    onMove("night:1");
  };

  const players = (pick: (p: number) => void, label: string, filter: (p: number) => boolean) => (
    <div className="flex flex-wrap justify-center gap-1.5" data-ww-targets>
      {alive.map((a, p) =>
        a && p !== seat && filter(p) ? (
          <button key={p} type="button" data-ww-target={p} disabled={!canPlay || acted === state.round * 10 + (state.phase === "night" ? 1 : 2)} onClick={() => pick(p)} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[12.5px] font-semibold text-slate-900 shadow ring-1 ring-black/10 hover:bg-indigo-50 disabled:opacity-50 dark:bg-slate-800 dark:text-white">
            <span className="g3-token h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colour(p) }} /> {label} {name(p)}
          </button>
        ) : null,
      )}
    </div>
  );
  const mark = () => setActed(state.round * 10 + (state.phase === "night" ? 1 : 2));

  return (
    <div data-game-board="werewolf" data-ww-phase={state.phase} className="flex w-full max-w-[640px] flex-col items-center gap-3">
      <div className="flex flex-wrap justify-center gap-1.5" data-ww-players>
        {alive.map((a, p) => (
          <span key={p} data-ww-player={p} data-ww-alive={a ? "1" : undefined} className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${a ? "bg-white shadow ring-1 ring-black/10 dark:bg-slate-800" : "line-through opacity-50"}`}>
            <span className="g3-token h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colour(p) }} /> {name(p)}
            {state.roles && <span className="text-slate-400">· {state.roles[p]}</span>}
          </span>
        ))}
      </div>
      {myRole && state.phase !== "lobby" && (
        <div className="rounded-xl bg-amber-500/15 px-3 py-1.5 text-[12.5px] text-amber-900 dark:text-amber-100" data-ww-role={myRole.role}>
          {ROLE_TEXT[myRole.role]}
          {myRole.role === "wolf" && myRole.wolves.length > 1 && <span> Your pack: {myRole.wolves.filter((p) => p !== seat).map(name).join(", ")}.</span>}
          {peeks.length > 0 && <div className="mt-0.5">Peeks: {peeks.map((p) => `${name(p.target)} is ${p.wolf ? "a werewolf" : "not a werewolf"}`).join("; ")}</div>}
        </div>
      )}
      {state.phase === "lobby" && (
        <div className="flex flex-col items-center gap-2 text-[13px]">
          <div className="text-slate-500">{n} players: {Math.max(1, Math.floor(n / 4))} werewolf{Math.floor(n / 4) > 1 ? "s" : ""}, a seer, villagers. The host deals the roles in secret.</div>
          {host ? (
            <button type="button" data-ww-start onClick={start} className="rounded-full bg-indigo-600 px-5 py-2 font-semibold text-white">
              Deal roles & start the first night
            </button>
          ) : (
            <div className="text-slate-500">Waiting for the host…</div>
          )}
        </div>
      )}
      {state.phase === "night" && (
        <div className="flex flex-col items-center gap-2 text-[13px]" data-ww-night>
          <div className="font-semibold">🌙 Night {state.round} · {left}s</div>
          {iAmAlive && myRole?.role === "wolf" && players((p) => { onDelta?.({ kind: "kill", from: seat, target: p } satisfies Night); mark(); }, "Attack", () => true)}
          {iAmAlive && myRole?.role === "seer" && players((p) => { onDelta?.({ kind: "peek", from: seat, target: p } satisfies Night); mark(); }, "Peek at", () => true)}
          {(!iAmAlive || myRole?.role === "villager") && <div className="text-slate-500">The village sleeps…</div>}
        </div>
      )}
      {state.phase === "day" && (
        <div className="flex flex-col items-center gap-2 text-[13px]" data-ww-day>
          <div className="font-semibold">☀️ Day {state.round} · {left}s · {Object.keys(state.votes).length} of {alive.filter(Boolean).length} voted</div>
          {iAmAlive ? (
            <>
              {players((p) => onMove(`${seat}@v:${p}`), "Vote", () => true)}
              <button type="button" data-ww-skip disabled={!canPlay} onClick={() => onMove(`${seat}@v:skip`)} className="rounded-full bg-slate-500/10 px-3 py-1 text-[12px] font-semibold">
                Skip this vote
              </button>
            </>
          ) : (
            <div className="text-slate-500">You are out — watch and whisper nothing.</div>
          )}
        </div>
      )}
      <div className="max-w-full text-[11.5px] text-slate-600 dark:text-slate-300" data-ww-log>
        {state.log.slice(-3).map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  );
}
