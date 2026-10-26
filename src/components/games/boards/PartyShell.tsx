// The frame shared by the timed party games: scores, the round clock, and
// the host's "Start round" / "Close round" buttons. The host's PC closes a
// round by itself when the clock runs out.
import { useEffect, useState, type ReactNode } from "react";
import { seatFor, type Seat } from "../boardProps";
import type { RoundState } from "../../../lib/games/party.ts";

export function useClock(deadline: number, open: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [open, deadline]);
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

export function PartyShell({
  state,
  rounds,
  seconds,
  host,
  seats,
  starter,
  n,
  canStart,
  allIn,
  onMove,
  children,
  roundLabel,
  testId,
}: {
  state: RoundState;
  rounds: number;
  seconds: number;
  host: boolean;
  seats?: Seat[];
  starter: number;
  n: number;
  /** Something else must happen before the host may open the next round. */
  canStart?: boolean;
  /** Everyone has answered: the host may close early (and does, by itself). */
  allIn?: boolean;
  onMove: (m: string) => void;
  children: ReactNode;
  roundLabel?: string;
  testId: string;
}) {
  const left = useClock(state.deadline, state.open);
  const colour = (p: number) => seatFor(seats, starter, p, n).color;
  const name = (p: number) => seatFor(seats, starter, p, n).name;
  // The host closes the round when the clock runs out or everyone is in.
  useEffect(() => {
    if (!host || !state.open) return;
    if (left === 0 || allIn) {
      const t = window.setTimeout(() => onMove(`e:${state.round}`), allIn ? 600 : 0);
      return () => window.clearTimeout(t);
    }
  }, [host, state.open, left, allIn, state.round, onMove]);
  const startNext = () => onMove(`o:${state.round + 1}:${Date.now() + seconds * 1000}`);
  return (
    <div data-game-board={testId} data-party-open={state.open ? "1" : undefined} data-party-round={state.round} className="flex w-full max-w-[680px] flex-col items-center gap-3">
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[12.5px] font-semibold" data-party-scores>
        {state.scores.map((s, p) => (
          <span key={p} className="inline-flex items-center gap-1.5">
            <span className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: colour(p) }} /> {name(p)} {s}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-3 text-[12.5px]">
        <span className="font-semibold">
          {roundLabel ?? `Round ${state.round} of ${rounds}`}
        </span>
        {state.open && (
          <span data-party-clock className={`rounded-full px-3 py-0.5 font-bold text-white ${left <= 5 ? "bg-rose-600" : "bg-indigo-600"}`}>
            {left}s
          </span>
        )}
        {host && !state.open && !state.done && (
          <button type="button" data-party-start disabled={canStart === false} onClick={startNext} className="rounded-full bg-indigo-600 px-4 py-1.5 font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
            {state.round === 0 ? "Start" : "Next round"}
          </button>
        )}
        {host && state.open && (
          <button type="button" data-party-close onClick={() => onMove(`e:${state.round}`)} className="rounded-full bg-slate-500/10 px-3 py-1.5 font-semibold">
            Close now
          </button>
        )}
        {!host && !state.open && !state.done && <span className="text-slate-500">Waiting for the host to start the round…</span>}
      </div>
      {children}
      {state.log.length > 0 && (
        <div className="max-w-full text-[11.5px] text-slate-600 dark:text-slate-300" data-party-log>
          {state.log.slice(-2).map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}
