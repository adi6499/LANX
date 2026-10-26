import { useMemo } from "react";
import type { BoardProps } from "../boardProps";
import { GOMOKU, gomoku } from "../../../lib/games/gomoku.ts";

const STEP = 30;
const PAD = 18;

/** Gomoku: click a crossing to place a stone. Black starts. */
export function GomokuBoard({ moves, canPlay, onMove }: BoardProps) {
  const state = useMemo(() => gomoku.replay(moves, 2, ""), [moves]);
  if (!state) return null;
  const size = PAD * 2 + STEP * (GOMOKU - 1);
  return (
    <svg data-game-board="gomoku" width={size} height={size} className="rounded-xl bg-[#e8c58a] shadow-lg ring-1 ring-black/10 select-none">
      {Array.from({ length: GOMOKU }, (_, k) => (
        <g key={k}>
          <line x1={PAD} y1={PAD + k * STEP} x2={size - PAD} y2={PAD + k * STEP} stroke="#7c5a2a" strokeWidth={1} />
          <line x1={PAD + k * STEP} y1={PAD} x2={PAD + k * STEP} y2={size - PAD} stroke="#7c5a2a" strokeWidth={1} />
        </g>
      ))}
      {state.cells.map((who, i) => {
        const cx = PAD + (i % GOMOKU) * STEP;
        const cy = PAD + Math.floor(i / GOMOKU) * STEP;
        if (who !== null)
          return (
            <g key={i} data-gomoku-stone={i}>
              <circle cx={cx} cy={cy} r={12} fill={who === 0 ? "#0f172a" : "#f8fafc"} stroke={who === 0 ? "#000" : "#94a3b8"} />
              {state.last === i && <circle cx={cx} cy={cy} r={4} fill={who === 0 ? "#f8fafc" : "#0f172a"} />}
            </g>
          );
        return <circle key={i} data-gomoku-cell={i} cx={cx} cy={cy} r={13} fill="transparent" className={canPlay ? "cursor-pointer hover:fill-black/15" : ""} onClick={() => canPlay && onMove(String(i))} />;
      })}
    </svg>
  );
}
