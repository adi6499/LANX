import { useMemo, useState } from "react";
import type { BoardProps } from "../boardProps";
import { backgammon, bgMoves, bgTarget } from "../../../lib/games/backgammon.ts";

const PW = 40; // point width
const PH = 150; // point height
const BAR = 30;
const W = 12 * PW + BAR + 2 * 8 + 44; // plus the off tray
const H = 2 * PH + 60;
const DIE = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

/** Point index → x of its left edge (bottom row 0..11 right to left, top row 12..23 left to right). */
function px(i: number): number {
  const col = i < 12 ? 11 - i : i - 12;
  return 8 + col * PW + (col >= 6 ? BAR : 0);
}

/** Backgammon: Roll, click a checker (or the bar), then where it goes; "Off" bears off. */
export function BackgammonBoard({ moves, canPlay, turn, seat, seed = "", onMove }: BoardProps) {
  const state = useMemo(() => backgammon.replay(moves, 2, seed), [moves, seed]);
  const [from, setFrom] = useState<number | "bar" | null>(null);
  if (!state) return null;
  const legal = canPlay ? bgMoves(state) : [];
  const stuck = canPlay && state.dice.length > 0 && legal.length === 0;
  const fromOk = (f: number | "bar") => legal.some((m) => m.from === f);
  const dieFor = (f: number | "bar", to: number) => {
    for (const d of [...new Set(state.dice)]) if (bgTarget(state, f, d, state.turn) === to) return d;
    return null;
  };
  const tap = (where: number | "bar" | "off") => {
    if (!canPlay || !state.dice.length) return;
    if (from === null) {
      if (where !== "off" && fromOk(where)) setFrom(where);
      return;
    }
    const to = where === "off" ? -1 : where === "bar" ? null : where;
    if (to === null) {
      setFrom(null);
      return;
    }
    const d = dieFor(from, to);
    setFrom(null);
    if (d) onMove(`m:${from}:${d}`);
    else if (where !== "off" && fromOk(where)) setFrom(where);
  };
  const mine = (count: number) => (turn === 0 ? count > 0 : count < 0);
  const targetsFrom = from === null ? [] : legal.filter((m) => m.from === from).map((m) => m.to);
  void seat;
  return (
    <div data-game-board="backgammon" className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-3 text-[12.5px] font-semibold">
        {state.lastRoll && (
          <span data-bg-dice className="text-[24px] leading-none">
            {DIE[state.lastRoll[0]]}
            {DIE[state.lastRoll[1]]}
            {state.dice.length > 0 && <span className="ml-2 text-[12px] text-slate-500 align-middle">left: {state.dice.join(" ")}</span>}
          </span>
        )}
        <button type="button" data-bg-roll disabled={!canPlay || state.dice.length > 0} onClick={() => onMove("r")} className="rounded-full bg-indigo-600 px-4 py-1.5 text-white hover:bg-indigo-700 disabled:opacity-50">
          🎲 Roll
        </button>
        {stuck && (
          <button type="button" data-bg-done onClick={() => onMove("x")} className="rounded-full bg-amber-500 px-4 py-1.5 text-white hover:bg-amber-600">
            No move — end turn
          </button>
        )}
      </div>
      <svg width={W} height={H} className="rounded-xl shadow-lg ring-1 ring-black/10 select-none" style={{ background: "#8b5a2b" }}>
        <rect x={8} y={8} width={12 * PW + BAR} height={H - 16} fill="#d9b382" rx={6} />
        <rect x={8 + 6 * PW} y={8} width={BAR} height={H - 16} fill="#5b3a1a" />
        {Array.from({ length: 24 }, (_, i) => {
          const x = px(i);
          const top = i >= 12;
          const tip = top ? 8 + PH : H - 8 - PH;
          const base = top ? 8 : H - 8;
          const can = fromOk(i) && from === null && canPlay;
          const isTarget = targetsFrom.includes(i);
          return (
            <polygon
              key={i}
              data-bg-point={i}
              points={`${x},${base} ${x + PW},${base} ${x + PW / 2},${tip}`}
              fill={isTarget ? "#86efac" : i % 2 === 0 ? "#7c2d12" : "#fde68a"}
              stroke={can ? "#4f46e5" : "none"}
              strokeWidth={can ? 3 : 0}
              className={canPlay ? "cursor-pointer" : ""}
              onClick={() => tap(i)}
            />
          );
        })}
        {/* checkers */}
        {state.points.map((count, i) => {
          if (!count) return null;
          const x = px(i) + PW / 2;
          const top = i >= 12;
          const white = count > 0;
          const shown = Math.min(Math.abs(count), 5);
          return Array.from({ length: shown }, (_, k) => {
            const y = top ? 8 + 18 + k * 32 : H - 8 - 18 - k * 32;
            const last = k === shown - 1;
            return (
              <g key={`${i}-${k}`} data-bg-checker={`${i}:${k}`} className={canPlay && mine(count) ? "cursor-pointer" : ""} onClick={() => tap(i)}>
                <circle cx={x} cy={y} r={15} fill={white ? "#f8fafc" : "#1e293b"} stroke={from === i && last ? "#4f46e5" : white ? "#94a3b8" : "#000"} strokeWidth={from === i && last ? 3 : 1.5} />
                {last && Math.abs(count) > 5 && (
                  <text x={x} y={y + 4} textAnchor="middle" fontSize="12" fontWeight="bold" fill={white ? "#1e293b" : "#f8fafc"}>
                    {Math.abs(count)}
                  </text>
                )}
              </g>
            );
          });
        })}
        {/* bar */}
        {[0, 1].map((p) =>
          Array.from({ length: Math.min(state.bar[p], 4) }, (_, k) => (
            <circle key={`bar${p}${k}`} data-bg-bar={p} cx={8 + 6 * PW + BAR / 2} cy={p === 0 ? H / 2 + 20 + k * 18 : H / 2 - 20 - k * 18} r={13} fill={p === 0 ? "#f8fafc" : "#1e293b"} stroke={from === "bar" ? "#4f46e5" : "#94a3b8"} strokeWidth={from === "bar" ? 3 : 1.5} className={canPlay ? "cursor-pointer" : ""} onClick={() => tap("bar")} />
          )),
        )}
        {/* off tray */}
        <rect data-bg-off x={16 + 12 * PW + BAR} y={8} width={40} height={H - 16} fill={targetsFrom.includes(-1) ? "#86efac" : "#5b3a1a"} rx={6} className={canPlay ? "cursor-pointer" : ""} onClick={() => tap("off")} />
        <text x={16 + 12 * PW + BAR + 20} y={H / 2 - 30} textAnchor="middle" fontSize="11" fill="#fff">
          off
        </text>
        <text x={16 + 12 * PW + BAR + 20} y={H / 2 - 10} textAnchor="middle" fontSize="12" fontWeight="bold" fill="#fff" data-bg-off-white>
          ○ {state.off[0]}
        </text>
        <text x={16 + 12 * PW + BAR + 20} y={H / 2 + 12} textAnchor="middle" fontSize="12" fontWeight="bold" fill="#fff" data-bg-off-black>
          ● {state.off[1]}
        </text>
      </svg>
      <div className="text-[11px] text-slate-500">White moves clockwise down to the bottom right; black the other way. Roll, click a checker, then its new point.</div>
    </div>
  );
}
