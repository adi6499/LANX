import { useMemo, type ReactElement } from "react";
import { seatFor, type BoardProps } from "../boardProps";
import { BOXES, DOTS, dots } from "../../../lib/games/dots.ts";

const GAP = 56;
const PAD = 20;

/** Dots & Boxes: click the space between two dots to draw a line. */
export function DotsBoard({ moves, canPlay, turn, seats, starter = 0, onMove }: BoardProps) {
  const n = Math.max(2, seats?.length ?? 2);
  const state = useMemo(() => dots.replay(moves, n, ""), [moves, n]);
  if (!state) return null;
  const size = PAD * 2 + GAP * BOXES;
  const colour = (p: number) => seatFor(seats, starter, p, n).color;
  const lines: ReactElement[] = [];
  // Drawn lines are bars; the gaps are small rectangles you can click (a bare line has no area to click).
  // LANX 2.17.0: the line drawn last is in its player's colour, so you can see what they did.
  const gap = (key: string, move: string, x: number, y: number, w: number, h: number, on: boolean) =>
    on ? (
      state.last === move ? (
        <rect key={key} data-dots-line={move} data-dots-on="1" data-dots-last="1" x={x - (w > h ? 0 : 1)} y={y - (w > h ? 1 : 0)} width={w + (w > h ? 0 : 2)} height={h + (w > h ? 2 : 0)} rx={4} fill={colour(state.lastBy)} />
      ) : (
        <rect key={key} data-dots-line={move} data-dots-on="1" x={x} y={y} width={w} height={h} rx={3} fill="#334155" />
      )
    ) : (
      <rect key={key} data-dots-line={move} x={x} y={y} width={w} height={h} rx={3} fill="transparent" className={canPlay ? "cursor-pointer hover:fill-indigo-400/50" : ""} onClick={() => canPlay && onMove(move)} />
    );
  for (let r = 0; r < DOTS; r++) for (let c = 0; c < BOXES; c++) lines.push(gap(`h${r}-${c}`, `h:${r}:${c}`, PAD + c * GAP + 7, PAD + r * GAP - (state.h[r][c] ? 3 : 7), GAP - 14, state.h[r][c] ? 6 : 14, state.h[r][c]));
  for (let r = 0; r < BOXES; r++) for (let c = 0; c < DOTS; c++) lines.push(gap(`v${r}-${c}`, `v:${r}:${c}`, PAD + c * GAP - (state.v[r][c] ? 3 : 7), PAD + r * GAP + 7, state.v[r][c] ? 6 : 14, GAP - 14, state.v[r][c]));
  return (
    <div data-game-board="dots" className="flex flex-col items-center gap-2">
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[12.5px] font-semibold" data-dots-scores>
        {state.scores.map((s, p) => (
          <span key={p} data-dots-seat={p} data-dots-out={state.out[p] ? "1" : undefined} title={seatFor(seats, starter, p, n).name} className={`inline-flex items-center gap-1.5 ${state.out[p] ? "line-through opacity-50" : p === turn ? "underline decoration-2 underline-offset-4" : ""}`}>
            <span className="h-3.5 w-3.5 rounded-sm" style={{ backgroundColor: colour(p) }} /> {s}
          </span>
        ))}
      </div>
      <svg width={size} height={size} className="rounded-xl bg-white dark:bg-slate-800 shadow-lg ring-1 ring-black/10">
        {state.box.map((row, r) =>
          row.map((owner, c) =>
            owner >= 0 ? <rect key={`b${r}-${c}`} data-dots-box={`${r}:${c}`} x={PAD + c * GAP + 4} y={PAD + r * GAP + 4} width={GAP - 8} height={GAP - 8} rx={8} fill={colour(owner)} opacity={0.75} /> : null,
          ),
        )}
        {lines}
        {Array.from({ length: DOTS * DOTS }, (_, k) => (
          <circle key={`d${k}`} cx={PAD + (k % DOTS) * GAP} cy={PAD + Math.floor(k / DOTS) * GAP} r={5} fill="#0f172a" className="dark:fill-white" />
        ))}
      </svg>
    </div>
  );
}
