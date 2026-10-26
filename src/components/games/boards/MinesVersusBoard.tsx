import { useMemo } from "react";
import { seatFor, type BoardProps } from "../boardProps";
import { MV_SIZE, minesVersus, mvCount } from "../../../lib/games/minesVersus.ts";

const COLOURS = ["", "text-blue-600", "text-emerald-700", "text-red-600", "text-indigo-800", "text-amber-800", "text-cyan-700", "text-black", "text-slate-500"];

/** Minesweeper Versus: one field for everyone; open squares for points. */
export function MinesVersusBoard({ moves, canPlay, seats, starter = 0, seed = "", onMove }: BoardProps) {
  const n = Math.max(2, seats?.length ?? 2);
  const state = useMemo(() => minesVersus.replay(moves, n, seed), [moves, n, seed]);
  if (!state) return null;
  const colour = (p: number) => seatFor(seats, starter, p, n).color;
  return (
    <div data-game-board="minesvs" className="flex flex-col items-center gap-2">
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[12.5px] font-semibold" data-minesvs-scores>
        {state.scores.map((s, p) => (
          <span key={p} className="inline-flex items-center gap-1.5">
            <span className="h-3.5 w-3.5 rounded-sm" style={{ backgroundColor: colour(p) }} /> {s}
          </span>
        ))}
        <span className="text-slate-500 font-normal">{state.safeLeft} safe squares left</span>
      </div>
      <div className="grid gap-[2px] rounded-xl bg-slate-400 dark:bg-slate-600 p-[4px]" style={{ gridTemplateColumns: `repeat(${MV_SIZE}, 30px)` }}>
        {state.open.map((open, i) => {
          const mine = !!state.mines?.[i];
          const count = open && !mine && state.mines ? mvCount(state.mines, i) : 0;
          const by = state.by[i];
          return (
            <button
              key={i}
              type="button"
              data-minesvs-cell={i}
              data-minesvs-open={open ? "1" : undefined}
              disabled={!canPlay || open}
              onClick={() => onMove(String(i))}
              style={open && by >= 0 ? { backgroundColor: `${colour(by)}33` } : undefined}
              className={`h-[30px] w-[30px] rounded-[4px] text-[13px] font-black flex items-center justify-center ${open ? (mine ? "!bg-red-500 text-white" : "bg-slate-100 dark:bg-slate-300") : "bg-slate-200 dark:bg-slate-500 hover:bg-slate-300 dark:hover:bg-slate-400 shadow"} ${open && !mine ? COLOURS[count] : ""} ${state.last === i ? "ring-2 ring-indigo-500" : ""} ${canPlay && !open ? "cursor-pointer" : "cursor-default"}`}
            >
              {open ? (mine ? "💣" : count || "") : ""}
            </button>
          );
        })}
      </div>
    </div>
  );
}
