import { useMemo } from "react";
import { seatFor, type BoardProps } from "../boardProps";
import { BJ_ROUNDS, bjValue, blackjack } from "../../../lib/games/blackjack.ts";
import { CardBack, CardFace } from "./CardFace";

/** Blackjack: Hit or Stand against the house. */
export function BlackjackBoard({ moves, canPlay, turn, seats, starter = 0, seed = "", onMove }: BoardProps) {
  const n = Math.max(1, seats?.length ?? 1);
  const state = useMemo(() => blackjack.replay(moves, n, seed), [moves, n, seed]);
  if (!state) return null;
  const name = (p: number) => seatFor(seats, starter, p, n).name;
  const colour = (p: number) => seatFor(seats, starter, p, n).color;
  const dealerDone = state.settled || !state.active.some(Boolean);
  return (
    <div data-game-board="blackjack" className="flex w-full max-w-[640px] flex-col items-center gap-3">
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
        Round {state.round} of {BJ_ROUNDS} · dealer {dealerDone ? `shows ${bjValue(state.dealer)}` : "shows one card"}
      </div>
      <div className="flex items-center gap-1.5" data-bj-dealer>
        {state.dealer.map((c, i) => (i === 1 && !dealerDone ? <CardBack key={i} /> : <CardFace key={i} card={c} />))}
      </div>
      <div className="flex flex-wrap justify-center gap-4">
        {state.hands.map((h, p) => {
          const v = bjValue(h);
          const acting = p === turn && state.active[p] && !state.over;
          return (
            <div key={p} data-bj-player={p} className={`flex flex-col items-center gap-1 rounded-2xl p-2 ${acting ? "bg-indigo-500/10 ring-1 ring-indigo-500/40" : ""}`}>
              <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colour(p) }} /> {name(p)} · {v}
                {v > 21 && <span className="text-rose-600">bust</span>}
                <span className="text-slate-500 font-normal">({state.points[p] >= 0 ? "+" : ""}{state.points[p]} pts)</span>
              </span>
              <div className="flex gap-1">
                {h.map((c, i) => (
                  <CardFace key={i} card={c} small />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {canPlay && state.active[turn] && (
        <div className="flex gap-2">
          <button type="button" data-bj-hit onClick={() => onMove("h")} className="rounded-full bg-indigo-600 px-5 py-1.5 text-[12.5px] font-semibold text-white">
            Hit
          </button>
          <button type="button" data-bj-stand onClick={() => onMove("s")} className="rounded-full bg-slate-500/10 px-5 py-1.5 text-[12.5px] font-semibold">
            Stand
          </button>
        </div>
      )}
      {state.results.length > 0 && (
        <div className="max-w-full text-[11px] text-slate-500" data-bj-results>
          {state.results.slice(-2).map((r, i) => (
            <div key={i}>{r}</div>
          ))}
        </div>
      )}
    </div>
  );
}
