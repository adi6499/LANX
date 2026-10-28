import { useMemo } from "react";
import { seatFor, type BoardProps } from "../boardProps";
import { GO, GO_KOMI, go, goScore } from "../../../lib/games/go.ts";

const STEP = 44;
const PAD = 26;

/** LANX 2.17.0: area scoring counts every stone left on the board as alive. */
export const GO_PASS_HINT = "Capture dead stones before passing — stones left on the board count as alive.";

/** "Sam passed." after a pass (the game ends on the second one in a row). */
export function goPassed(moves: string[], name: (p: number) => string): string | null {
  if (!moves.length || moves[moves.length - 1] !== "p") return null;
  const who = name((moves.length - 1) % 2);
  return moves.length > 1 && moves[moves.length - 2] === "p" ? `${who} passed too — the game is over.` : `${who} passed. Pass as well to end the game and count.`;
}

/** Go on 9×9: click a crossing to play; Pass twice in a row ends the game. */
export function GoBoard({ moves, canPlay, seats, starter = 0, onMove }: BoardProps) {
  const state = useMemo(() => go.replay(moves, 2, ""), [moves]);
  if (!state) return null;
  const size = PAD * 2 + STEP * (GO - 1);
  const [b, w] = goScore(state.cells);
  const passed = goPassed(moves, (p) => seatFor(seats, starter, p, 2).name.split(" (")[0]);
  return (
    <div data-game-board="go" className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-4 text-[12.5px] font-semibold" data-go-score>
        <span className="inline-flex items-center gap-1.5">
          <span className="g3-token h-3.5 w-3.5 rounded-full bg-slate-900 ring-1 ring-white/40" /> {b}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="g3-token h-3.5 w-3.5 rounded-full bg-white ring-1 ring-slate-400" /> {w + GO_KOMI} <span className="text-slate-400 font-normal">(with {GO_KOMI} komi)</span>
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
      {passed && <div data-go-passed className="text-[12.5px] font-semibold text-slate-700 dark:text-slate-200">{passed}</div>}
      <button type="button" data-go-pass disabled={!canPlay} onClick={() => onMove("p")} className="rounded-full bg-slate-500/10 px-4 py-1.5 text-[12.5px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-500/20 disabled:opacity-50">
        Pass{state.passes === 1 ? " (a second pass ends the game)" : ""}
      </button>
      <div data-go-hint className="max-w-[380px] text-center text-[11px] text-slate-500">{GO_PASS_HINT}</div>
    </div>
  );
}
