import { useMemo } from "react";
import { namesIn, seatFor, type BoardProps } from "../boardProps";
import { BJ_ROUNDS, bjCanDouble, bjCanSplit, bjCurrent, bjValue, blackjack, type BjRound, type BjState } from "../../../lib/games/blackjack.ts";
import { CardBack, CardFace, CardRow, ResultPanel } from "./CardFace";

const signed = (x: number) => (x > 0 ? `+${x}` : x < 0 ? `−${-x}` : "±0");

/** LANX 2.17.0: the round just played — the dealer's whole hand and everyone's result — until the next player acts. */
export function BlackjackLast({ rounds, name }: { rounds: BjRound[]; name: (p: number) => string }) {
  if (!rounds.length) return null;
  return (
    <>
      {rounds.map((r) => (
        <ResultPanel key={r.round} title={`Round ${r.round} result`} testId={`bj-last-${r.round}`}>
          <div className="flex flex-wrap items-center gap-2" data-bj-last-dealer>
            <span className="font-semibold">Dealer</span>
            <CardRow cards={r.dealer} />
            <span>{r.dealerBlackjack ? "blackjack" : r.dealerValue > 21 ? `${r.dealerValue} — bust` : r.dealerValue}</span>
          </div>
          {r.results.map((res) => (
            <div key={res.player} className="flex flex-wrap items-center gap-2" data-bj-last-player={res.player}>
              <span className="font-semibold">{name(res.player)}</span>
              {res.hands.map((h, i) => (
                <span key={i} className="inline-flex items-center gap-1">
                  <CardRow cards={h.cards} />
                  <span className="text-slate-500">{h.value} · {h.why}</span>
                </span>
              ))}
              <span className={`ml-auto font-bold ${res.delta > 0 ? "text-emerald-600 dark:text-emerald-400" : res.delta < 0 ? "text-rose-600 dark:text-rose-400" : "text-slate-500"}`}>{signed(res.delta)}</span>
            </div>
          ))}
        </ResultPanel>
      ))}
    </>
  );
}

/** The buttons for the player to act (flat and 3D). */
export function BlackjackActions({ state, onMove, primary, quiet }: { state: BjState; onMove: (m: string) => void; primary: string; quiet: string }) {
  if (!bjCurrent(state)) return null;
  const split = state.boxes[state.turn].length > 1;
  return (
    <div className="flex flex-wrap items-center justify-center gap-2" data-bj-actions>
      {split && <span className="text-[12px] text-slate-500">Hand {state.hand + 1} of 2:</span>}
      <button type="button" data-bj-hit onClick={() => onMove("h")} className={primary}>
        Hit
      </button>
      <button type="button" data-bj-stand onClick={() => onMove("s")} className={quiet}>
        Stand
      </button>
      {bjCanDouble(state) && (
        <button type="button" data-bj-double onClick={() => onMove("d")} className={quiet}>
          Double
        </button>
      )}
      {bjCanSplit(state) && (
        <button type="button" data-bj-split onClick={() => onMove("p")} className={quiet}>
          Split
        </button>
      )}
    </div>
  );
}

export const bjDealerLine = (state: BjState) => {
  const done = state.settled || !state.active.some(Boolean);
  return done ? `dealer has ${bjValue(state.dealer)}` : `dealer shows ${bjValue([state.dealer[0]])}`;
};

const pill = "rounded-full px-5 py-1.5 text-[12.5px] font-semibold transition-[background-color,transform] duration-150 active:scale-[0.97]";

/** Blackjack: Hit, Stand, Double or Split against the house. */
export function BlackjackBoard({ moves, canPlay, turn, seats, starter = 0, seed = "", onMove }: BoardProps) {
  const n = Math.max(1, seats?.length ?? 1);
  const state = useMemo(() => blackjack.replay(moves, n, seed), [moves, n, seed]);
  if (!state) return null;
  const name = (p: number) => seatFor(seats, starter, p, n).name;
  const colour = (p: number) => seatFor(seats, starter, p, n).color;
  const dealerDone = state.settled || !state.active.some(Boolean);
  const last = state.results[state.results.length - 1];
  return (
    <div data-game-board="blackjack" className="flex w-full max-w-[680px] flex-col items-center gap-3">
      <BlackjackLast rounds={state.lastRounds} name={name} />
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
        Round {state.round} of {BJ_ROUNDS} · {bjDealerLine(state)}
      </div>
      <div className="flex items-center gap-1.5" data-bj-dealer>
        {state.dealer.map((c, i) => (i === 1 && !dealerDone ? <CardBack key={i} /> : <CardFace key={i} card={c} />))}
      </div>
      <div className="flex flex-wrap justify-center gap-4">
        {state.boxes.map((box, p) => {
          const acting = p === turn && state.active[p] && !state.over;
          return (
            <div key={p} data-bj-player={p} className={`flex flex-col items-center gap-1 rounded-2xl p-2 ${acting ? "bg-indigo-500/10 ring-1 ring-indigo-500/40" : ""} ${state.gone[p] ? "opacity-45" : ""}`}>
              <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold">
                <span className="g3-token h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colour(p) }} /> {name(p)}
                <span className="text-slate-500 font-normal">({state.points[p] >= 0 ? "+" : ""}{state.points[p]} pts)</span>
              </span>
              {state.gone[p] && <span className="text-[11px] text-slate-500">left</span>}
              <div className="flex gap-3">
                {box.map((h, i) => {
                  const v = bjValue(h.cards);
                  const on = acting && state.hand === i;
                  return (
                    <div key={i} className={`flex flex-col items-center gap-0.5 rounded-xl px-1 ${on && box.length > 1 ? "ring-1 ring-indigo-500/60" : ""}`} data-bj-hand={`${p}:${i}`}>
                      <div className="flex gap-1">
                        {h.cards.map((c, k) => (
                          <CardFace key={k} card={c} small />
                        ))}
                      </div>
                      <span className="text-[11px] text-slate-500">
                        {v}
                        {v > 21 && <span className="text-rose-600"> bust</span>}
                        {h.stake > 1 && " · doubled"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {canPlay && <BlackjackActions state={state} onMove={onMove} primary={`${pill} bg-indigo-600 text-white hover:bg-indigo-700`} quiet={`${pill} bg-slate-500/10 hover:bg-slate-500/20`} />}
      {!state.lastRounds.length && last && (
        <div className="max-w-full text-[11px] text-slate-500" data-bj-results>
          {namesIn(last, seats, starter, n)}
        </div>
      )}
    </div>
  );
}
