import { useMemo } from "react";
import type { BoardProps } from "../boardProps";
import { GO, go, goScore } from "../../../lib/games/go.ts";

const STEP = 44;
const PAD = 26;

/** Go on 9×9: click a crossing to play; Pass twice in a row ends the game. */
export function GoBoard({ moves, canPlay, onMove }: BoardProps) {
  const state = useMemo(() => go.replay(moves, 2, ""), [moves]);
  if (!state) return null;
  const size = PAD * 2 + STEP * (GO - 1);
  const [b, w] = goScore(state.cells);
  return (
    <div data-game-board="go" className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-4 text-[12.5px] font-semibold" data-go-score>
        <span className="inline-flex items-center gap-1.5">
          <span className="g3-token h-3.5 w-3.5 rounded-full bg-slate-900 ring-1 ring-white/40" /> {b} <span className="text-slate-400 font-normal">(+{state.captured[0]} taken)</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="g3-token h-3.5 w-3.5 rounded-full bg-white ring-1 ring-slate-400" /> {w + 6.5} <span className="text-slate-400 font-normal">(+{state.captured[1]} taken)</span>
        </span>
      </div>
      <svg width={size} height={size} className="rounded-xl bg-[#e8c58a] shadow-lg ring-1 ring-black/10 select-none">
        {Array.from({ length: GO }, (_, k) => (
          <g key={k}>
            <line x1={PAD} y1={PAD + k * STEP} x2={size - PAD} y2={PAD + k * STEP} stroke="#7c5a2a" strokeWidth={1.2} />
            <line x1={PAD + k * STEP} y1={PAD} x2={PAD + k * STEP} y2={size - PAD} stroke="#7c5a2a" strokeWidth={1.2} />
          </g>
        ))}
        {[20, 24, 40, 56, 60].map((i) => (
          <circle key={i} cx={PAD + (i % GO) * STEP} cy={PAD + Math.floor(i / GO) * STEP} r={3} fill="#7c5a2a" />
        ))}
        {state.cells.map((who, i) => {
          const cx = PAD + (i % GO) * STEP;
          const cy = PAD + Math.floor(i / GO) * STEP;
          if (who !== null)
            return (
              <g key={i} data-go-stone={i}>
                <circle cx={cx} cy={cy} r={19} fill={who === 0 ? "#0f172a" : "#f8fafc"} stroke={who === 0 ? "#000" : "#94a3b8"} />
                {state.last === i && <circle cx={cx} cy={cy} r={5} fill={who === 0 ? "#f8fafc" : "#0f172a"} />}
              </g>
            );
          const blocked = i === state.ko;
          return <circle key={i} data-go-cell={i} cx={cx} cy={cy} r={20} fill="transparent" className={canPlay && !blocked ? "cursor-pointer hover:fill-black/15" : ""} onClick={() => canPlay && !blocked && onMove(String(i))} />;
        })}
      </svg>
      <button type="button" data-go-pass disabled={!canPlay} onClick={() => onMove("p")} className="rounded-full bg-slate-500/10 px-4 py-1.5 text-[12.5px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-500/20 disabled:opacity-50">
        Pass{state.passes === 1 ? " (a second pass ends the game)" : ""}
      </button>
    </div>
  );
}
