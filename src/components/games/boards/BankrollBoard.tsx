import { useMemo } from "react";
import { seatFor, type BoardProps } from "../boardProps";
import { BOARD, bankroll } from "../../../lib/games/bankroll.ts";

const GROUP: Record<string, string> = { brown: "#92400e", sky: "#0ea5e9", pink: "#ec4899", orange: "#f97316", red: "#dc2626", yellow: "#eab308", blue: "#1d4ed8" };
const DIE = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
const CELL = 64;

/** Square index → grid row/col on a 7×7 ring (0 at the bottom right, anticlockwise). */
function place(i: number): [number, number] {
  if (i <= 6) return [6, 6 - i];
  if (i <= 12) return [6 - (i - 6), 0];
  if (i <= 18) return [0, i - 12];
  return [i - 18, 6];
}

/** Bankroll: Roll; buy or skip the street you land on. */
export function BankrollBoard({ moves, canPlay, turn, seats, starter = 0, seed = "", onMove }: BoardProps) {
  const n = Math.max(2, Math.min(6, seats?.length ?? 2));
  const state = useMemo(() => bankroll.replay(moves, n, seed), [moves, n, seed]);
  if (!state) return null;
  const colour = (p: number) => seatFor(seats, starter, p, n).color;
  const offer = state.offer >= 0 ? BOARD[state.offer] : null;
  return (
    <div data-game-board="bankroll" className="flex flex-col items-center gap-2">
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[12px] font-semibold" data-bankroll-cash>
        {state.cash.map((c, p) => (
          <span key={p} className={`inline-flex items-center gap-1.5 ${state.out[p] ? "line-through opacity-50" : ""} ${p === turn && state.winner === null ? "underline decoration-2 underline-offset-4" : ""}`}>
            <span className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: colour(p) }} /> ₹{c}
          </span>
        ))}
      </div>
      <div className="relative" style={{ width: 7 * CELL, height: 7 * CELL }}>
        {BOARD.map((sq, i) => {
          const [r, c] = place(i);
          const owner = state.owner[i];
          const here = state.pos.map((p, k) => (p === i && !state.out[k] ? k : -1)).filter((k) => k >= 0);
          return (
            <div
              key={i}
              data-bankroll-square={i}
              className={`absolute flex flex-col overflow-hidden rounded-md border border-slate-300 bg-white text-[9.5px] leading-tight text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 ${state.offer === i ? "ring-2 ring-indigo-500" : ""}`}
              style={{ left: c * CELL, top: r * CELL, width: CELL - 3, height: CELL - 3 }}
            >
              {sq.group && <div className="h-2.5 w-full" style={{ backgroundColor: GROUP[sq.group] }} />}
              <div className="px-1 pt-0.5 font-semibold">{sq.name}</div>
              {sq.price && <div className="px-1 text-slate-500">₹{sq.price}</div>}
              {owner >= 0 && <div className="mx-1 mt-auto mb-1 h-1.5 rounded-full" style={{ backgroundColor: colour(owner) }} />}
              {here.length > 0 && (
                <div className="absolute bottom-1 right-1 flex gap-0.5">
                  {here.map((k) => (
                    <span key={k} data-bankroll-token={k} className="h-3.5 w-3.5 rounded-full ring-2 ring-white" style={{ backgroundColor: colour(k) }} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {/* centre */}
        <div className="absolute flex flex-col items-center justify-center gap-2 rounded-xl bg-emerald-50 dark:bg-slate-900 p-3 text-center" style={{ left: CELL, top: CELL, width: 5 * CELL - 3, height: 5 * CELL - 3 }}>
          {state.lastRoll && (
            <div className="text-[30px] leading-none" data-bankroll-dice>
              {DIE[state.lastRoll[0]]}
              {DIE[state.lastRoll[1]]}
            </div>
          )}
          {offer && canPlay ? (
            <div className="flex flex-col items-center gap-1.5">
              <div className="text-[13px] font-semibold">
                Buy {offer.name} for ₹{offer.price}?
              </div>
              <div className="flex gap-2">
                <button type="button" data-bankroll-buy disabled={state.cash[turn] < (offer.price ?? 0)} onClick={() => onMove("b")} className="rounded-full bg-indigo-600 px-4 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-50">
                  Buy
                </button>
                <button type="button" data-bankroll-skip onClick={() => onMove("s")} className="rounded-full bg-slate-500/10 px-4 py-1.5 text-[12.5px] font-semibold">
                  Skip
                </button>
              </div>
            </div>
          ) : (
            <button type="button" data-bankroll-roll disabled={!canPlay || state.offer >= 0} onClick={() => onMove("r")} className="rounded-full bg-indigo-600 px-5 py-2 text-[13px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
              🎲 Roll
            </button>
          )}
          <div data-bankroll-log className="mt-1 max-h-[90px] w-full overflow-hidden text-[10.5px] text-slate-600 dark:text-slate-300">
            {state.log.slice(-4).map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
