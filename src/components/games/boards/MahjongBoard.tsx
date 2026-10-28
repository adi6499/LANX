import { useMemo, useState } from "react";
import { seatFor, type BoardProps } from "../boardProps";
import { MJ_COLS, mahjong, mjFree, mjPairs } from "../../../lib/games/mahjong.ts";

/** Mahjong Duels: pick two free matching tiles. */
export function MahjongBoard({ moves, canPlay, turn, seats, starter = 0, seed = "", onMove }: BoardProps) {
  const n = Math.max(2, seats?.length ?? 2);
  const state = useMemo(() => mahjong.replay(moves, n, seed), [moves, n, seed]);
  const [first, setFirst] = useState<number | null>(null);
  if (!state) return null;
  const colour = (p: number) => seatFor(seats, starter, p, n).color;
  const pairs = mjPairs(state.tiles);
  const tap = (i: number) => {
    if (!canPlay || !mjFree(state.tiles, i)) return;
    if (first === null) {
      setFirst(i);
      return;
    }
    if (first === i) {
      setFirst(null);
      return;
    }
    if (state.tiles[first] === state.tiles[i]) {
      onMove(`${first},${i}`);
      setFirst(null);
    } else setFirst(i);
  };
  return (
    <div data-game-board="mahjong" className="flex flex-col items-center gap-2">
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[12.5px] font-semibold" data-mahjong-scores>
        {state.scores.map((s, p) => (
          <span key={p} data-mahjong-seat={p} data-mahjong-out={state.out[p] ? "1" : undefined} title={seatFor(seats, starter, p, n).name + (state.out[p] ? " left" : "")} className={`inline-flex items-center gap-1.5 ${state.out[p] ? "line-through opacity-50" : p === turn ? "underline decoration-2 underline-offset-4" : ""}`}>
            <span className="h-3.5 w-3.5 rounded-sm" style={{ backgroundColor: colour(p) }} /> {s}
          </span>
        ))}
        <span className="text-slate-500 font-normal">{pairs.length} pairs free</span>
      </div>
      <div className="grid gap-1 rounded-xl bg-emerald-900 p-2" style={{ gridTemplateColumns: `repeat(${MJ_COLS}, 44px)` }}>
        {state.tiles.map((t, i) => {
          const free = t !== null && mjFree(state.tiles, i);
          return (
            <button
              key={i}
              type="button"
              data-mahjong-tile={i}
              data-mahjong-free={free ? "1" : undefined}
              disabled={!canPlay || !free}
              onClick={() => tap(i)}
              className={`h-[56px] w-[44px] rounded-md flex items-center justify-center text-[28px] ${t === null ? "bg-transparent" : free ? "bg-amber-50 shadow-md" : "bg-amber-100/60 opacity-60"} ${first === i ? "ring-4 ring-indigo-500" : ""} ${state.last.includes(i) ? "ring-2 ring-emerald-400" : ""} ${canPlay && free ? "cursor-pointer hover:bg-white" : "cursor-default"}`}
            >
              {t ?? ""}
            </button>
          );
        })}
      </div>
      {canPlay && pairs.length === 0 && (
        <button type="button" data-mahjong-pass onClick={() => onMove("p")} className="rounded-full bg-amber-500 px-4 py-1.5 text-[12.5px] font-semibold text-white hover:bg-amber-600">
          No pair left for you — pass
        </button>
      )}
    </div>
  );
}
