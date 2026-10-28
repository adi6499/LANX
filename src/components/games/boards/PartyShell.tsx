// The frame shared by the timed party games: scores, the round clock, what
// is happening now, and the host's "Start round" / "Close round" buttons.
// The host's PC closes a round by itself when the clock runs out (or, when
// the board says so, once everyone still at the table has answered).
// LANX 2.17.0: one board per match drives the host's loops (the board on
// screen or the hidden copy that keeps a table going — never both); the
// others count the round down on their own clock; the log says names.
import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { sfx } from "../../../lib/gameSounds";
import { HostAway, namesIn, seatFor, type Seat } from "../boardProps";
import type { RoundState } from "../../../lib/games/party.ts";

// ---------------------------------------------------------------- one driver per match

const drivers = new Map<string, symbol>();

/** LANX 2.17.0: a hosted game's loops (closing rounds, Werewolf's nights and days, the live puck) run
 *  in one board per match on the host's PC. `drive(key)` claims the loop named `key` for this board, or
 *  says another board already has it; a board lets go of all it drove when it closes, and the next one
 *  to ask takes over. */
export function useDriver(): (key: string) => boolean {
  const me = useRef<symbol>(Symbol("board"));
  useEffect(() => {
    const token = me.current;
    return () => {
      for (const [k, v] of drivers) if (v === token) drivers.delete(k);
    };
  }, []);
  return (key: string) => {
    const cur = drivers.get(key);
    if (cur !== undefined) return cur === me.current;
    // A new round or phase: let go of the ones this board drove before (same kind of loop).
    const kind = key.split("|")[0];
    for (const [k, v] of drivers) if (v === me.current && k.split("|")[0] === kind) drivers.delete(k);
    drivers.set(key, me.current);
    return true;
  };
}

// ---------------------------------------------------------------- the round clock

const arrivals = new Map<string, number>();

/** When something (a round, a phase) first showed on this PC — the same for every board here. */
export function firstSeen(key: string): number {
  let t = arrivals.get(key);
  if (t === undefined) {
    if (arrivals.size > 400) arrivals.clear();
    t = Date.now();
    arrivals.set(key, t);
  }
  return t;
}

/** LANX 2.17.0: seconds left in the round on this PC. The host's own clock closes rounds; everyone else
 *  counts `seconds` down from when the round reached their PC (two PCs' clocks seldom agree). */
export function useRoundClock(state: Pick<RoundState, "round" | "open" | "deadline">, seconds: number, host: boolean): number {
  const end = !state.open ? 0 : host ? state.deadline : firstSeen(`round|${state.round}:${state.deadline}`) + seconds * 1000;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!state.open) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [state.open, end]);
  return state.open ? Math.max(0, Math.ceil((end - now) / 1000)) : 0;
}

/** The host's name, for "waiting for …" (the host sits first at a table). */
export const hostName = (seats?: Seat[]) => (seats?.[0]?.name ?? "the host").split(" (")[0];

export function PartyShell({
  state,
  rounds,
  seconds,
  host,
  seats,
  starter,
  n,
  seat,
  canStart,
  allIn,
  onMove,
  children,
  roundLabel,
  verb,
  answered,
  testId,
}: {
  state: RoundState;
  rounds: number;
  seconds: number;
  host: boolean;
  seats?: Seat[];
  starter: number;
  n: number;
  /** My player number (for "you're in", "you're out"). */
  seat?: number;
  /** Something else must happen before the host may open the next round. */
  canStart?: boolean;
  /** Everyone has answered: the host may close early (and does, by itself). */
  allIn?: boolean;
  onMove: (m: string) => void;
  children: ReactNode;
  /** What is happening while a round is open, in place of "Round 3 of 10 open — answer now". */
  roundLabel?: string;
  /** What to do while a round is open ("answer now", "tap in now"). */
  verb?: string;
  /** This player has answered this round. */
  answered?: boolean;
  testId: string;
}) {
  const left = useRoundClock(state, seconds, host);
  // LANX 2.13.0: a chime when a round opens, ticks for the last three seconds, a buzz when it closes.
  const wasOpen = useRef(state.open);
  useEffect(() => {
    if (state.open && !wasOpen.current) sfx("start");
    else if (!state.open && wasOpen.current) sfx("buzz");
    wasOpen.current = state.open;
  }, [state.open]);
  useEffect(() => {
    if (state.open && left > 0 && left <= 3) sfx("tick");
  }, [state.open, left]);
  const colour = (p: number) => seatFor(seats, starter, p, n).color;
  const name = (p: number) => seatFor(seats, starter, p, n).name.split(" (")[0];
  // The host closes the round when its clock runs out or everyone is in — one board per match, once.
  const drive = useDriver();
  const closed = useRef("");
  const live = useRef({ allIn: !!allIn, onMove });
  live.current = { allIn: !!allIn, onMove };
  useEffect(() => {
    if (!host || !state.open) return;
    const key = `close|${testId}:${state.round}:${state.deadline}`;
    let since = 0;
    const t = window.setInterval(() => {
      if (closed.current === key) return;
      const { allIn: everyone, onMove: send } = live.current;
      since = everyone ? since || Date.now() : 0;
      const due = Date.now() >= state.deadline || (everyone && Date.now() - since >= 600);
      if (!due || !drive(key)) return;
      closed.current = key;
      send(`e:${state.round}`);
    }, 150);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, state.open, state.round, state.deadline, testId]);
  const closeNow = () => {
    const key = `close|${testId}:${state.round}:${state.deadline}`;
    if (closed.current === key) return;
    closed.current = key;
    onMove(`e:${state.round}`);
  };
  const startNext = () => onMove(`o:${state.round + 1}:${Date.now() + seconds * 1000}`);
  // LANX 2.17.0: the host looked away (HostRunner): open the next round by itself after a short pause.
  const away = useContext(HostAway);
  const next = useRef(startNext);
  next.current = startNext;
  useEffect(() => {
    if (!away || !host || state.open || state.done || canStart === false) return;
    const t = window.setTimeout(() => {
      if (drive(`next|${testId}:${state.round}`)) next.current();
    }, 8000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [away, host, state.open, state.done, state.round, canStart, testId]);
  const me = seat ?? -1;
  const out = state.out ?? [];
  const status = state.done
    ? "Game over"
    : me >= 0 && out[me]
      ? "You're out — watching"
      : state.open
        ? (roundLabel ?? `Round ${state.round} of ${rounds} open — ${answered ? "you're in, waiting for the others" : (verb ?? "answer now")}`)
        : host
          ? state.round === 0
            ? `${rounds} rounds — start when everyone's here`
            : `Round ${state.round} of ${rounds} done — start round ${state.round + 1} when you're ready`
          : `Waiting for ${hostName(seats)} to start round ${state.round + 1}`;
  return (
    <div data-game-board={testId} data-party-open={state.open ? "1" : undefined} data-party-round={state.round} className="flex w-full max-w-[680px] flex-col items-center gap-3">
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[12.5px] font-semibold" data-party-scores>
        {state.scores.map((s, p) => (
          <span key={p} className={`inline-flex items-center gap-1.5 ${out[p] ? "opacity-50" : ""}`} data-party-left={out[p] ? "1" : undefined}>
            <span className="g3-token h-3.5 w-3.5 rounded-full" style={{ backgroundColor: colour(p) }} /> <span className={out[p] ? "line-through" : ""}>{name(p)}</span> {s}
            {out[p] && <span className="font-normal text-slate-400">(left)</span>}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3 text-[12.5px]">
        <span className="font-semibold" data-party-status>
          {status}
        </span>
        {state.open && (
          <span data-party-clock className={`rounded-full px-3 py-0.5 font-bold text-white ${left <= 5 ? "bg-rose-600" : "bg-indigo-600"}`}>
            {left}s
          </span>
        )}
        {host && !state.open && !state.done && (
          <button type="button" data-party-start disabled={canStart === false} onClick={startNext} className="rounded-full bg-indigo-600 px-4 py-1.5 font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
            {state.round === 0 ? "Start" : `Start round ${state.round + 1}`}
          </button>
        )}
        {host && state.open && (
          <button type="button" data-party-close onClick={closeNow} className="rounded-full bg-slate-500/10 px-3 py-1.5 font-semibold">
            Close now
          </button>
        )}
      </div>
      {children}
      {state.log.length > 0 && (
        <div className="max-w-full text-center text-[11.5px] text-slate-600 dark:text-slate-300" data-party-log>
          {state.log.slice(-2).map((l, i) => (
            <div key={i}>{namesIn(l, seats, starter, n)}</div>
          ))}
        </div>
      )}
    </div>
  );
}
