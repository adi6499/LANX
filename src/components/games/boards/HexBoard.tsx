import { useMemo } from "react";
import type { BoardProps } from "../boardProps";
import { HEX, hex } from "../../../lib/games/hex.ts";

const R = 17; // hex radius
const W = Math.sqrt(3) * R;
const H = 2 * R;

const hexPath = (cx: number, cy: number) =>
  Array.from({ length: 6 }, (_, k) => {
    const a = (Math.PI / 180) * (60 * k - 30);
    return `${(cx + R * Math.cos(a)).toFixed(1)},${(cy + R * Math.sin(a)).toFixed(1)}`;
  }).join(" ");

/** Hex: red joins left and right, blue joins top and bottom. */
export function HexBoard({ moves, canPlay, onMove }: BoardProps) {
  const state = useMemo(() => hex.replay(moves, 2, ""), [moves]);
  if (!state) return null;
  const width = W * HEX + (W / 2) * (HEX - 1) + 24;
  const height = H * 0.75 * (HEX - 1) + H + 24;
  const centre = (i: number) => {
    const r = Math.floor(i / HEX);
    const c = i % HEX;
    return [12 + W / 2 + c * W + (r * W) / 2, 12 + R + r * H * 0.75] as const;
  };
  return (
    <svg data-game-board="hex" width={width} height={height} className="select-none">
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
  );
}
