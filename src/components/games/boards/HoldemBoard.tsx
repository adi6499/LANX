import { useMemo, useState } from "react";
import { namesIn, seatFor, type BoardProps } from "../boardProps";
import { HOLDEM_HANDS, holdem, holdemOptions, type HoldemLast, type HoldemState } from "../../../lib/games/holdem.ts";
import { CardBack, CardFace, CardRow, ResultPanel } from "./CardFace";

/** LANX 2.17.0: the hand just played — the board, everyone's cards at the showdown and who won what — until the next action. */
export function HoldemLastHand({ last, name, say }: { last: HoldemLast | null; name: (p: number) => string; say: (t: string) => string }) {
  if (!last) return null;
  return (
    <ResultPanel title={`Hand ${last.hand} result`} testId="holdem-last">
      {last.shown.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center gap-2" data-holdem-last-board>
            <span className="font-semibold">Board</span>
            <CardRow cards={last.board} />
          </div>
          {last.shown.map((x) => (
            <div key={x.player} className="flex flex-wrap items-center gap-2" data-holdem-last-player={x.player}>
              <span className="font-semibold">{name(x.player)}</span>
              <CardRow cards={x.cards} />
              <span className="text-slate-500">{x.name}</span>
              {x.won > 0 && <span className="ml-auto font-bold text-emerald-600 dark:text-emerald-400">+{x.won}</span>}
            </div>
          ))}
        </>
      ) : (
        <div data-holdem-last-fold>{say(last.text.replace(/^Hand \d+: /, ""))}</div>
      )}
    </ResultPanel>
  );
}

/** The fold / call / raise / all-in buttons for the player to act (flat and 3D). */
export function HoldemActions({ state, onMove, quiet, primary, range }: { state: HoldemState; onMove: (m: string) => void; quiet: string; primary: string; range?: boolean }) {
  const o = holdemOptions(state);
  const [raise, setRaise] = useState(0);
  const raiseTo = Math.min(Math.max(raise || o.minTo, o.minTo), o.maxTo);
  if (state.street >= 4 || !state.pending[state.turn]) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 text-[12.5px]" data-holdem-actions>
      <button type="button" data-holdem-fold onClick={() => onMove("f")} className={quiet}>
        Fold
      </button>
      <button type="button" data-holdem-call onClick={() => onMove("c")} className={primary}>
        {o.call === 0 ? "Check" : `Call ${o.call}`}
      </button>
      {o.canRaise && (
        <span className="inline-flex items-center gap-1">
          {range ? (
            <input type="range" data-holdem-raise-to min={o.minTo} max={o.maxTo} step={10} value={raiseTo} onChange={(e) => setRaise(Number(e.target.value))} className="w-28 accent-amber-500" />
          ) : (
            <input type="number" data-holdem-raise-to min={o.minTo} max={o.maxTo} step={10} value={raiseTo} onChange={(e) => setRaise(Number(e.target.value))} className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-[12px] dark:border-slate-600 dark:bg-slate-800" />
          )}
          <button type="button" data-holdem-raise onClick={() => onMove(`r:${raiseTo}`)} className="rounded-full bg-amber-500 px-4 py-1.5 font-semibold text-white">
            Raise to {raiseTo}
          </button>
        </span>
      )}
      {o.canAllIn && (
        <button type="button" data-holdem-allin onClick={() => onMove("a")} className="rounded-full bg-rose-600 px-4 py-1.5 font-semibold text-white">
          All in
        </button>
      )}
      {state.capped[state.turn] && <span className="text-[11.5px] text-slate-500">A short all-in: you may call or fold.</span>}
    </div>
  );
}

/** Texas Hold'em: fold, check/call, raise or go all in. */
export function HoldemBoard({ moves, canPlay, turn, seat, seats, starter = 0, seed = "", local, onMove }: BoardProps) {
  const n = Math.max(2, seats?.length ?? 2);
  const state = useMemo(() => holdem.replay(moves, n, seed), [moves, n, seed]);
  if (!state) return null;
  const me = local ? turn : seat;
  const name = (p: number) => seatFor(seats, starter, p, n).name;
  const colour = (p: number) => seatFor(seats, starter, p, n).color;
  const say = (t: string) => namesIn(t, seats, starter, n);
  const pot = state.contributed.reduce((a, b) => a + b, 0);
  return (
    <div data-game-board="holdem" className="flex w-full max-w-[720px] flex-col items-center gap-3">
      <HoldemLastHand last={state.last} name={name} say={say} />
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
          // Only your own hole cards are face up (in pass & play: only the player to act).
          const mine = p === me;
          const reveal = mine && !state.gone[p];
          return (
            <div key={p} data-holdem-player={p} className={`flex min-w-[130px] flex-col items-center gap-1 rounded-xl px-2 py-1 ${p === turn && state.street < 4 ? "bg-indigo-500/10 ring-1 ring-indigo-500/40" : ""} ${state.folded[p] || state.out[p] ? "opacity-50" : ""}`}>
              <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold">
                <span className="g3-token h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colour(p) }} /> {name(p)}
                {p === state.button && <span className="rounded-full bg-white px-1 text-[9px] text-slate-900 ring-1 ring-black/20">D</span>}
              </span>
              <span className="text-[11px] text-slate-500">
                {state.gone[p] ? "left" : state.out[p] ? "out" : `${chips} chips`}
                {state.bets[p] > 0 ? ` · bet ${state.bets[p]}` : ""}
                {state.allin[p] ? " · all in" : ""}
                {state.folded[p] && !state.out[p] ? " · folded" : ""}
              </span>
              <div className="flex gap-1">{reveal && state.hole[p]?.length ? state.hole[p].map((c, i) => <CardFace key={i} card={c} small testId={`hole:${c}`} />) : state.hole[p]?.length && !state.out[p] ? [0, 1].map((i) => <CardBack key={i} small />) : null}</div>
            </div>
          );
        })}
      </div>
      {canPlay && <HoldemActions state={state} onMove={onMove} quiet="rounded-full bg-slate-500/10 px-4 py-1.5 font-semibold" primary="rounded-full bg-indigo-600 px-4 py-1.5 font-semibold text-white" />}
      {state.log.length > 0 && !state.last && (
        <div className="max-w-full text-[11px] text-slate-500" data-holdem-log>
          {state.log.slice(-2).map((l, i) => (
            <div key={i}>{say(l)}</div>
          ))}
        </div>
      )}
    </div>
  );
}
