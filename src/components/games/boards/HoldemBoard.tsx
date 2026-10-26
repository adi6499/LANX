import { useMemo, useState } from "react";
import { seatFor, type BoardProps } from "../boardProps";
import { HOLDEM_HANDS, holdem } from "../../../lib/games/holdem.ts";
import { CardBack, CardFace } from "./CardFace";

/** Texas Hold'em: fold, check/call, raise or go all in. */
export function HoldemBoard({ moves, canPlay, turn, seat, seats, starter = 0, seed = "", local, onMove }: BoardProps) {
  const n = Math.max(2, seats?.length ?? 2);
  const state = useMemo(() => holdem.replay(moves, n, seed), [moves, n, seed]);
  const [raise, setRaise] = useState(0);
  if (!state) return null;
  const me = local ? turn : seat;
  const name = (p: number) => seatFor(seats, starter, p, n).name;
  const colour = (p: number) => seatFor(seats, starter, p, n).color;
  const pot = state.contributed.reduce((a, b) => a + b, 0);
  const call = Math.max(0, state.toCall - (state.bets[turn] ?? 0));
  const minTo = state.toCall + state.minRaise;
  const maxTo = (state.bets[turn] ?? 0) + (state.chips[turn] ?? 0);
  const raiseTo = Math.min(Math.max(raise || minTo, minTo), maxTo);
  const showAll = state.street === 4 || state.showdown.length > 0;
  return (
    <div data-game-board="holdem" className="flex w-full max-w-[720px] flex-col items-center gap-3">
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
        Hand {state.hand} of {HOLDEM_HANDS} · pot {pot} · {["pre-flop", "flop", "turn", "river", "showdown"][state.street]}
      </div>
      <div className="flex min-h-[72px] items-center gap-1.5 rounded-2xl bg-emerald-800 px-4 py-2" data-holdem-board>
        {state.board.map((c, i) => (
          <CardFace key={i} card={c} testId={`board:${c}`} />
        ))}
        {state.board.length === 0 && <span className="text-[12px] text-emerald-100">The flop comes after this round of betting.</span>}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {state.chips.map((chips, p) => {
          const mine = p === me || local;
          const reveal = mine || (showAll && !state.folded[p]);
          const sd = state.showdown.find((x) => x.player === p);
          return (
            <div key={p} data-holdem-player={p} className={`flex min-w-[130px] flex-col items-center gap-1 rounded-xl px-2 py-1 ${p === turn && state.street < 4 ? "bg-indigo-500/10 ring-1 ring-indigo-500/40" : ""} ${state.folded[p] || state.out[p] ? "opacity-50" : ""}`}>
              <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colour(p) }} /> {name(p)}
                {p === state.button && <span className="rounded-full bg-white px-1 text-[9px] text-slate-900 ring-1 ring-black/20">D</span>}
              </span>
              <span className="text-[11px] text-slate-500">
                {state.out[p] ? "out" : `${chips} chips`}
                {state.bets[p] > 0 ? ` · bet ${state.bets[p]}` : ""}
                {state.allin[p] ? " · all in" : ""}
                {state.folded[p] && !state.out[p] ? " · folded" : ""}
              </span>
              <div className="flex gap-1">{reveal && state.hole[p] ? state.hole[p].map((c, i) => <CardFace key={i} card={c} small testId={mine ? `hole:${c}` : undefined} />) : state.hole[p]?.length ? [0, 1].map((i) => <CardBack key={i} small />) : null}</div>
              {sd && <span className="text-[10.5px] text-amber-700 dark:text-amber-300">{sd.name}{sd.won ? ` · +${sd.won}` : ""}</span>}
            </div>
          );
        })}
      </div>
      {canPlay && state.street < 4 && state.pending[turn] && (
        <div className="flex flex-wrap items-center justify-center gap-2 text-[12.5px]" data-holdem-actions>
          <button type="button" data-holdem-fold onClick={() => onMove("f")} className="rounded-full bg-slate-500/10 px-4 py-1.5 font-semibold">
            Fold
          </button>
          <button type="button" data-holdem-call onClick={() => onMove("c")} className="rounded-full bg-indigo-600 px-4 py-1.5 font-semibold text-white">
            {call === 0 ? "Check" : `Call ${call}`}
          </button>
          {maxTo >= minTo && (
            <span className="inline-flex items-center gap-1">
              <input type="number" data-holdem-raise-to min={minTo} max={maxTo} step={10} value={raiseTo} onChange={(e) => setRaise(Number(e.target.value))} className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-[12px] dark:border-slate-600 dark:bg-slate-800" />
              <button type="button" data-holdem-raise onClick={() => onMove(`r:${raiseTo}`)} className="rounded-full bg-amber-500 px-4 py-1.5 font-semibold text-white">
                Raise to {raiseTo}
              </button>
            </span>
          )}
          <button type="button" data-holdem-allin onClick={() => onMove("a")} className="rounded-full bg-rose-600 px-4 py-1.5 font-semibold text-white">
            All in
          </button>
        </div>
      )}
      {state.log.length > 0 && (
        <div className="max-w-full text-[11px] text-slate-500" data-holdem-log>
          {state.log.slice(-2).map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}
