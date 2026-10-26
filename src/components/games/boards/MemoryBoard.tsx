import { useEffect, useMemo, useState } from "react";
import { seatFor, type BoardProps } from "../boardProps";
import { memory } from "../../../lib/games/memory.ts";

/** Memory: turn two cards; a pair is yours and you go again. */
export function MemoryBoard({ moves, canPlay, seats, starter = 0, seed = "", onMove }: BoardProps) {
  const n = Math.max(2, seats?.length ?? 2);
  const state = useMemo(() => memory.replay(moves, n, seed), [moves, n, seed]);
  // A missed pair stays face up for a moment so everyone sees it.
  const [peek, setPeek] = useState<number[]>([]);
  useEffect(() => {
    if (!state || state.lastMiss.length !== 2) {
      setPeek([]);
      return;
    }
    setPeek(state.lastMiss);
    const t = window.setTimeout(() => setPeek([]), 1300);
    return () => window.clearTimeout(t);
  }, [state, moves.length]);
  if (!state) return null;
  const colour = (p: number) => seatFor(seats, starter, p, n).color;
  return (
    <div data-game-board="memory" data-memory-peeking={peek.length ? "1" : undefined} className="flex flex-col items-center gap-2">
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[12.5px] font-semibold" data-memory-scores>
        {state.scores.map((s, p) => (
          <span key={p} className="inline-flex items-center gap-1.5">
            <span className="h-3.5 w-3.5 rounded-sm" style={{ backgroundColor: colour(p) }} /> {s}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-6 gap-2 rounded-2xl bg-slate-200 dark:bg-slate-700 p-2">
        {state.faces.map((face, i) => {
          const owner = state.owner[i];
          const up = owner >= 0 || state.open.includes(i) || peek.includes(i);
          const can = canPlay && owner < 0 && !state.open.includes(i) && !peek.length;
          return (
            <button
              key={i}
              type="button"
              data-memory-card={i}
              data-memory-up={up ? "1" : undefined}
              disabled={!can}
              onClick={() => onMove(String(i))}
              style={owner >= 0 ? { boxShadow: `inset 0 0 0 3px ${colour(owner)}` } : undefined}
              className={`h-14 w-14 rounded-xl flex items-center justify-center text-[26px] transition-transform ${up ? "bg-white dark:bg-slate-100" : "bg-indigo-600 hover:bg-indigo-500"} ${owner >= 0 ? "opacity-70" : ""} ${can ? "cursor-pointer" : "cursor-default"}`}
            >
              {up ? face : ""}
            </button>
          );
        })}
      </div>
    </div>
  );
}
