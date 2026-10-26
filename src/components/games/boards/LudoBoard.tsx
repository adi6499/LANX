import { Dice3D } from "./Dice3D";
import { useMemo } from "react";
import { seatFor, type BoardProps } from "../boardProps";
import { FINISH, ludo, ludoMovable, toAbsolute, SAFE } from "../../../lib/games/ludo.ts";

const C = 28; // cell size
const SIZE = 15 * C;

/** The 52 squares of the loop, clockwise from red's start, as [row, col]. */
const LOOP: [number, number][] = [
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
  [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
  [0, 7],
  [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
  [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],
  [7, 14],
  [8, 14], [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
  [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
  [14, 7],
  [14, 6], [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
  [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
  [7, 0],
  [6, 0],
];
/** Home columns per player (relative 51..56), and the yards' top-left cells. */
const HOME: [number, number][][] = [
  [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]],
  [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]],
  [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]],
  [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]],
];
const YARD: [number, number][] = [[0, 0], [0, 9], [9, 9], [9, 0]];
const SPOT: [number, number][] = [[1.5, 1.5], [1.5, 3.5], [3.5, 1.5], [3.5, 3.5]];

function cellOf(player: number, rel: number, token: number): [number, number] {
  if (rel === -1) {
    const [yr, yc] = YARD[player];
    const [dr, dc] = SPOT[token];
    return [(yr + dr) * C + C / 2, (yc + dc) * C + C / 2];
  }
  if (rel >= FINISH) return [7 * C + C / 2, 7 * C + C / 2];
  if (rel >= 51) {
    const [r, c] = HOME[player][rel - 51];
    return [r * C + C / 2, c * C + C / 2];
  }
  const [r, c] = LOOP[toAbsolute(player, rel)];
  return [r * C + C / 2, c * C + C / 2];
}

/** Ludo: Roll, then click the token to move. */
export function LudoBoard({ moves, canPlay, turn, seats, starter = 0, seed = "", onMove }: BoardProps) {
  const n = Math.max(2, Math.min(4, seats?.length ?? 2));
  const state = useMemo(() => ludo.replay(moves, n, seed), [moves, n, seed]);
  const rolls = useMemo(() => moves.filter((x) => x === "r").length, [moves]);
  if (!state) return null;
  const colour = (p: number) => seatFor(seats, starter, p, n).color;
  const movable = canPlay && state.roll ? ludoMovable(state) : [];
  const tint = (p: number) => (p < n ? colour(p) : "#cbd5e1");
  return (
    <div data-game-board="ludo" className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-3 text-[12.5px] font-semibold">
        {state.lastRoll > 0 && (
          <span className="inline-flex items-center gap-1.5" data-ludo-last>
            <span className="g3-token h-3.5 w-3.5 rounded-full" style={{ backgroundColor: colour(turn) }} /> <Dice3D value={state.lastRoll} size={30} rollKey={rolls} />
            {state.event && <span className="text-slate-500 font-normal">· {state.event}</span>}
          </span>
        )}
        <button type="button" data-ludo-roll disabled={!canPlay || state.roll > 0} onClick={() => onMove("r")} className="rounded-full bg-indigo-600 px-4 py-1.5 text-white hover:bg-indigo-700 disabled:opacity-50">
          🎲 Roll
        </button>
        {state.roll > 0 && canPlay && <span className="text-indigo-600 dark:text-indigo-300">Pick a token to move {state.roll}</span>}
      </div>
      <svg width={SIZE} height={SIZE} className="rounded-xl shadow-lg ring-1 ring-black/10 select-none" style={{ background: "#f8fafc" }}>
        <defs>
          <radialGradient id="g3gloss" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#fff" stopOpacity="0.95" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* yards */}
        {YARD.map(([r, c], p) => (
          <g key={p}>
            <rect x={c * C} y={r * C} width={6 * C} height={6 * C} fill={tint(p)} opacity={0.28} />
            <rect x={c * C + C} y={r * C + C} width={4 * C} height={4 * C} fill="#fff" opacity={0.7} rx={6} />
          </g>
        ))}
        {/* loop squares */}
        {LOOP.map(([r, c], i) => {
          const startOf = [0, 13, 26, 39].indexOf(i);
          const fill = startOf >= 0 ? tint(startOf) : SAFE.has(i) ? "#fde68a" : "#fff";
          return <rect key={i} data-ludo-square={i} x={c * C} y={r * C} width={C} height={C} fill={fill} stroke="#94a3b8" strokeWidth={1} />;
        })}
        {/* home columns */}
        {HOME.map((cells, p) => cells.slice(0, 5).map(([r, c], k) => <rect key={`${p}-${k}`} x={c * C} y={r * C} width={C} height={C} fill={tint(p)} opacity={0.5} stroke="#94a3b8" />))}
        {/* centre */}
        <rect x={6 * C} y={6 * C} width={3 * C} height={3 * C} fill="#e2e8f0" />
        <polygon points={`${6 * C},${6 * C} ${9 * C},${6 * C} ${7.5 * C},${7.5 * C}`} fill={tint(1)} opacity={0.6} />
        <polygon points={`${9 * C},${6 * C} ${9 * C},${9 * C} ${7.5 * C},${7.5 * C}`} fill={tint(2)} opacity={0.6} />
        <polygon points={`${9 * C},${9 * C} ${6 * C},${9 * C} ${7.5 * C},${7.5 * C}`} fill={tint(3)} opacity={0.6} />
        <polygon points={`${6 * C},${9 * C} ${6 * C},${6 * C} ${7.5 * C},${7.5 * C}`} fill={tint(0)} opacity={0.6} />
        {/* tokens */}
        {state.pos.map((tokens, p) =>
          tokens.map((rel, t) => {
            const [y, x] = cellOf(p, rel, t);
            const stack = rel >= 0 && rel < FINISH ? tokens.filter((o, k) => k < t && o === rel).length : 0;
            const can = p === turn && movable.includes(t);
            return (
              <g key={`${p}-${t}`} data-ludo-token={`${p}:${t}`} data-ludo-pos={rel} data-ludo-can={can ? "1" : undefined} className={can ? "cursor-pointer" : ""} onClick={() => can && onMove(`m:${t}`)}>
                <circle className="g3-shadow" cx={x + stack * 4 + 1.5} cy={y - stack * 4 + 3} r={10} fill="#0f172a" opacity={0.28} />
                <circle cx={x + stack * 4} cy={y - stack * 4} r={10} fill={colour(p)} stroke="#fff" strokeWidth={2.5} />
                <circle className="g3-gloss" cx={x + stack * 4 - 3} cy={y - stack * 4 - 3.5} r={4.5} fill="url(#g3gloss)" pointerEvents="none" />
                {can && <circle cx={x + stack * 4} cy={y - stack * 4} r={13} fill="none" stroke="#4f46e5" strokeWidth={3} className="animate-pulse" />}
              </g>
            );
          }),
        )}
      </svg>
    </div>
  );
}
