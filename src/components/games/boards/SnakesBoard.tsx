import { Dice3D } from "./Dice3D";
import { useMemo } from "react";
import { seatFor, type BoardProps } from "../boardProps";
import { LADDERS, SNAKES, snakes } from "../../../lib/games/snakes.ts";

const CELL = 42;

/** Square 1..100 → pixel centre (1 at the bottom left, rows alternate direction). */
function centre(sq: number): [number, number] {
  const k = Math.max(1, sq) - 1;
  const row = Math.floor(k / 10);
  const col = row % 2 === 0 ? k % 10 : 9 - (k % 10);
  return [col * CELL + CELL / 2, (9 - row) * CELL + CELL / 2];
}

/** Snakes & Ladders: press Roll; the match rolls for you. */
export function SnakesBoard({ moves, canPlay, turn, seats, starter = 0, seed = "", onMove }: BoardProps) {
  const n = Math.max(2, seats?.length ?? 2);
  const state = useMemo(() => snakes.replay(moves, n, seed), [moves, n, seed]);
  const rolls = useMemo(() => moves.filter((x) => x === "r").length, [moves]);
  if (!state) return null;
  const colour = (p: number) => seatFor(seats, starter, p, n).color;
  const size = CELL * 10;
  return (
    <div data-game-board="snakes" className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-3 text-[12.5px] font-semibold">
        {state.lastBy >= 0 && (
          <span className="inline-flex items-center gap-1.5" data-snakes-last>
            <span className="g3-token h-3.5 w-3.5 rounded-full" style={{ backgroundColor: colour(state.lastBy) }} /> rolled <Dice3D value={state.lastRoll} size={30} rollKey={rolls} />
          </span>
        )}
        <button type="button" data-snakes-roll disabled={!canPlay} onClick={() => onMove("r")} className="rounded-full bg-indigo-600 px-4 py-1.5 text-white hover:bg-indigo-700 disabled:opacity-50">
          🎲 Roll
        </button>
      </div>
      <div className="relative rounded-xl overflow-hidden shadow-lg ring-1 ring-black/10" style={{ width: size, height: size }}>
        <div className="grid grid-cols-10" style={{ width: size }}>
          {Array.from({ length: 100 }, (_, k) => {
            const row = 9 - Math.floor(k / 10);
            const col = row % 2 === 0 ? k % 10 : 9 - (k % 10);
            const sq = row * 10 + col + 1;
            const dark = (row + col) % 2 === 0;
            return (
              <div key={k} data-snakes-square={sq} className={`flex items-start justify-start p-1 text-[10px] font-semibold ${dark ? "bg-amber-100 text-amber-900" : "bg-amber-50 text-amber-700"}`} style={{ width: CELL, height: CELL }}>
                {sq}
              </div>
            );
          })}
        </div>
        <svg className="absolute inset-0 pointer-events-none" width={size} height={size}>
          {Object.entries(LADDERS).map(([a, b]) => {
            const [x1, y1] = centre(Number(a));
            const [x2, y2] = centre(b);
            return <line key={`l${a}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#16a34a" strokeWidth={6} strokeLinecap="round" strokeDasharray="4 6" opacity={0.85} />;
          })}
          {Object.entries(SNAKES).map(([a, b]) => {
            const [x1, y1] = centre(Number(a));
            const [x2, y2] = centre(b);
            const mx = (x1 + x2) / 2 + 24;
            const my = (y1 + y2) / 2;
            return <path key={`s${a}`} d={`M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`} stroke="#dc2626" strokeWidth={6} fill="none" strokeLinecap="round" opacity={0.85} />;
          })}
          {state.pos.map((sq, p) => {
            if (sq === 0) return null;
            const [x, y] = centre(sq);
            const dx = (p % 3) * 9 - 9;
            const dy = Math.floor(p / 3) * 9 - 4;
            return <circle key={p} data-snakes-token={p} cx={x + dx} cy={y + dy} r={8} fill={colour(p)} stroke="#fff" strokeWidth={2} />;
          })}
        </svg>
      </div>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[12px]" data-snakes-positions>
        {state.pos.map((sq, p) => (
          <span key={p} className={`inline-flex items-center gap-1.5 ${p === turn && state.winner === null ? "font-bold" : ""}`}>
            <span className="g3-token h-3 w-3 rounded-full" style={{ backgroundColor: colour(p) }} /> {sq || "start"}
          </span>
        ))}
      </div>
    </div>
  );
}
