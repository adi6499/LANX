import { useMemo } from "react";
import { seatFor, type BoardProps } from "../boardProps";
import { HEX, hex, hexCanSwap, type HexState } from "../../../lib/games/hex.ts";

const R = 17; // hex radius
const W = Math.sqrt(3) * R;
const H = 2 * R;

const hexPath = (cx: number, cy: number) =>
  Array.from({ length: 6 }, (_, k) => {
    const a = (Math.PI / 180) * (60 * k - 30);
    return `${(cx + R * Math.cos(a)).toFixed(1)},${(cy + R * Math.sin(a)).toFixed(1)}`;
  }).join(" ");

/** LANX 2.17.0: the swap rule in words, for whoever can see it now. */
export function hexSwapNote(s: HexState, moves: string[], canPlay: boolean, name: (p: number) => string): string | null {
  if (hexCanSwap(s, moves)) return canPlay ? `You may swap: take ${name(0)}'s first stone as yours (it turns blue, mirrored across the long diagonal) and ${name(0)} moves next — or just play a hex.` : `${name(1)} may swap: take the first stone as theirs (it turns blue, mirrored), or play a hex.`;
  if (s.swapped && moves.length === 2) return `${name(1)} swapped: the first stone is now blue (mirrored across the long diagonal). ${name(0)} to play.`;
  return null;
}

/** Hex: red joins left and right, blue joins top and bottom. */
export function HexBoard({ moves, canPlay, seats, starter = 0, onMove }: BoardProps) {
  const state = useMemo(() => hex.replay(moves, 2, ""), [moves]);
  if (!state) return null;
  const name = (p: number) => seatFor(seats, starter, p, 2).name.split(" (")[0];
  const note = hexSwapNote(state, moves, canPlay, name);
  const width = W * HEX + (W / 2) * (HEX - 1) + 24;
  const height = H * 0.75 * (HEX - 1) + H + 24;
  const centre = (i: number) => {
    const r = Math.floor(i / HEX);
    const c = i % HEX;
    return [12 + W / 2 + c * W + (r * W) / 2, 12 + R + r * H * 0.75] as const;
  };
  return (
    <div data-game-board="hex" className="flex flex-col items-center gap-2">
    <div className="text-[12px] font-semibold text-slate-600 dark:text-slate-300">
      <span className="text-rose-500">●</span> {name(0)} joins left and right · <span className="text-sky-500">●</span> {name(1)} joins top and bottom
    </div>
    <svg width={width} height={height} className="select-none">
      {/* the two pairs of edges */}
      {Array.from({ length: HEX }, (_, k) => {
        const [lx, ly] = centre(k * HEX);
        const [rx, ry] = centre(k * HEX + HEX - 1);
        const [tx, ty] = centre(k);
        const [bx, by] = centre((HEX - 1) * HEX + k);
        return (
          <g key={k}>
            <circle cx={lx - W / 2 - 4} cy={ly} r={3} fill="#f43f5e" />
            <circle cx={rx + W / 2 + 4} cy={ry} r={3} fill="#f43f5e" />
            <circle cx={tx} cy={ty - R - 4} r={3} fill="#0ea5e9" />
            <circle cx={bx} cy={by + R + 4} r={3} fill="#0ea5e9" />
          </g>
        );
      })}
      {state.cells.map((who, i) => {
        const [cx, cy] = centre(i);
        const fill = who === 0 ? "#f43f5e" : who === 1 ? "#0ea5e9" : "#e2e8f0";
        return (
          <polygon
            key={i}
            data-hex-cell={i}
            data-hex-owner={who ?? ""}
            points={hexPath(cx, cy)}
            fill={fill}
            stroke={state.last === i ? "#0f172a" : "#94a3b8"}
            strokeWidth={state.last === i ? 2.5 : 1}
            className={who === null && canPlay ? "cursor-pointer hover:opacity-70" : ""}
            onClick={() => who === null && canPlay && onMove(String(i))}
          />
        );
      })}
    </svg>
    {note && (
      <div data-hex-note className="flex max-w-[460px] flex-wrap items-center justify-center gap-2 text-center text-[12px] text-slate-600 dark:text-slate-300">
        <span>{note}</span>
        {canPlay && hexCanSwap(state, moves) && (
          <button type="button" data-hex-swap onClick={() => onMove("swap")} className="rounded-full bg-indigo-600 px-4 py-1.5 text-[12.5px] font-semibold text-white hover:bg-indigo-700">
            Swap
          </button>
        )}
      </div>
    )}
    </div>
  );
}
