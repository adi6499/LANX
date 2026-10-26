import { useEffect, useMemo, useRef, useState } from "react";
import { seatFor, type BoardProps } from "../boardProps";
import { DART_R, darts } from "../../../lib/games/darts.ts";
import { ARROWS, TARGET_R, archery, windFor } from "../../../lib/games/archery.ts";
import { CUPS, CUP_R, cupPong } from "../../../lib/games/cuppong.ts";
import { PINS, bowling, bowlingScore } from "../../../lib/games/bowling.ts";
import { useSwing } from "./useFrames";

const btn = "rounded-full px-4 py-1.5 text-[12.5px] font-semibold";

// ---------------------------------------------------------------- Darts

const SECTOR_LABELS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

/** Darts: the sight wobbles; press Throw (or click the board) when it is where you want. */
export function DartsBoard({ moves, canPlay, turn, seats, starter = 0, onMove }: BoardProps) {
  const n = Math.max(1, seats?.length ?? 1);
  const state = useMemo(() => darts.replay(moves, n, ""), [moves, n]);
  const sx = useSwing(1700, canPlay);
  const sy = useSwing(2300, canPlay);
  const [aim, setAim] = useState<[number, number]>([0, -103]);
  const name = (p: number) => seatFor(seats, starter, p, n).name;
  if (!state) return null;
  const wob = 28;
  const sight: [number, number] = [aim[0] + Math.round((sx - 0.5) * 2 * wob), aim[1] + Math.round((sy - 0.5) * 2 * wob)];
  const scale = 1;
  const R = DART_R * scale;
  const toBoard = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * 2 * R - R), Math.round(((e.clientY - r.top) / r.height) * 2 * R - R)] as [number, number];
  };
  return (
    <div data-game-board="darts" className="flex flex-col items-center gap-2">
      <div className="flex flex-wrap justify-center gap-x-4 text-[12.5px] font-semibold" data-darts-left>
        {state.left.map((l, p) => (
          <span key={p} className={p === turn && state.winner === null ? "underline decoration-2 underline-offset-4" : ""}>
            {name(p)} {l}
          </span>
        ))}
      </div>
      <svg width={2 * R + 20} height={2 * R + 20} viewBox={`${-R - 10} ${-R - 10} ${2 * R + 20} ${2 * R + 20}`} className="select-none" onMouseMove={(e) => canPlay && setAim(toBoard(e))} onClick={() => canPlay && onMove(`t:${sight[0]}:${sight[1]}`)} style={{ cursor: canPlay ? "crosshair" : "default" }}>
        <circle r={R + 6} fill="#0f172a" />
        {SECTOR_LABELS.map((lab, i) => {
          const a0 = ((i * 18 - 9 - 90) * Math.PI) / 180;
          const a1 = ((i * 18 + 9 - 90) * Math.PI) / 180;
          const ring = (r0: number, r1: number, fill: string) => {
            const p = (r: number, a: number) => `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`;
            return <path key={`${i}-${r0}`} d={`M ${p(r0, a0)} A ${r0} ${r0} 0 0 1 ${p(r0, a1)} L ${p(r1, a1)} A ${r1} ${r1} 0 0 0 ${p(r1, a0)} Z`} fill={fill} stroke="#94a3b8" strokeWidth={0.5} />;
          };
          const dark = i % 2 === 0;
          const lx = Math.cos((a0 + a1) / 2) * (R - 14);
          const ly = Math.sin((a0 + a1) / 2) * (R - 14);
          return (
            <g key={i}>
              {ring(16, 99, dark ? "#1e293b" : "#f1f5f9")}
              {ring(99, 107, dark ? "#dc2626" : "#16a34a")}
              {ring(107, 162, dark ? "#1e293b" : "#f1f5f9")}
              {ring(162, R, dark ? "#dc2626" : "#16a34a")}
              <text x={lx} y={ly + 4} textAnchor="middle" fontSize="11" fontWeight="bold" fill={dark ? "#fff" : "#0f172a"}>
                {lab}
              </text>
            </g>
          );
        })}
        <circle r={16} fill="#16a34a" />
        <circle r={6.35} fill="#dc2626" />
        {state.thrown.map((t, i) => (
          <g key={i} data-dart={i}>
            <circle cx={t.x} cy={t.y} r={4} fill="#facc15" stroke="#0f172a" />
          </g>
        ))}
        {canPlay && (
          <g data-darts-sight>
            <circle cx={sight[0]} cy={sight[1]} r={7} fill="none" stroke="#f59e0b" strokeWidth={2} />
            <line x1={sight[0] - 12} y1={sight[1]} x2={sight[0] + 12} y2={sight[1]} stroke="#f59e0b" strokeWidth={1.5} />
            <line x1={sight[0]} y1={sight[1] - 12} x2={sight[0]} y2={sight[1] + 12} stroke="#f59e0b" strokeWidth={1.5} />
          </g>
        )}
      </svg>
      <div className="flex items-center gap-2 text-[12px]">
        {canPlay && (
          <button type="button" data-darts-throw onClick={() => onMove(`t:${sight[0]}:${sight[1]}`)} className={`${btn} bg-indigo-600 text-white`}>
            Throw ({3 - state.thrown.length} left)
          </button>
        )}
        <span className="text-slate-500">{state.thrown.map((t) => t.text).join(", ") || "Move the mouse to aim; the sight wobbles."}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Archery

export function ArcheryBoard({ moves, canPlay, turn, seats, starter = 0, seed = "", onMove }: BoardProps) {
  const n = Math.max(1, seats?.length ?? 1);
  const state = useMemo(() => archery.replay(moves, n, seed), [moves, n, seed]);
  const name = (p: number) => seatFor(seats, starter, p, n).name;
  const colour = (p: number) => seatFor(seats, starter, p, n).color;
  if (!state) return null;
  const k = state.hits[turn]?.length ?? 0;
  const wind = state.done ? { dx: 0, dy: 0 } : windFor(seed, turn, k);
  const R = TARGET_R * 1.6;
  const rings = ["#f8fafc", "#f8fafc", "#0f172a", "#0f172a", "#2563eb", "#2563eb", "#dc2626", "#dc2626", "#facc15", "#facc15"];
  return (
    <div data-game-board="archery" className="flex flex-col items-center gap-2">
      <div className="flex flex-wrap justify-center gap-x-4 text-[12.5px] font-semibold" data-archery-scores>
        {state.scores.map((s, p) => (
          <span key={p} className={`inline-flex items-center gap-1.5 ${p === turn && !state.done ? "underline decoration-2 underline-offset-4" : ""}`}>
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: colour(p) }} /> {name(p)} {s} <span className="text-slate-400 font-normal">({state.hits[p].length}/{ARROWS})</span>
          </span>
        ))}
      </div>
      {!state.done && (
        <div className="flex items-center gap-2 text-[12.5px]" data-archery-wind>
          <span>Wind:</span>
          <svg width={60} height={30}>
            <line x1={30 - wind.dx} y1={15 - wind.dy} x2={30 + wind.dx} y2={15 + wind.dy} stroke="#0ea5e9" strokeWidth={3} markerEnd="url(#arrow)" />
            <defs>
              <marker id="arrow" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 Z" fill="#0ea5e9" />
              </marker>
            </defs>
          </svg>
          <span className="text-slate-500">{Math.round(Math.sqrt(wind.dx ** 2 + wind.dy ** 2))} — aim into it</span>
        </div>
      )}
      <svg
        width={2 * R + 20}
        height={2 * R + 20}
        viewBox={`${-R - 10} ${-R - 10} ${2 * R + 20} ${2 * R + 20}`}
        className="select-none"
        style={{ cursor: canPlay ? "crosshair" : "default" }}
        onClick={(e) => {
          if (!canPlay) return;
          const r = e.currentTarget.getBoundingClientRect();
          const x = Math.round((((e.clientX - r.left) / r.width) * (2 * R + 20) - R - 10) / 1.6);
          const y = Math.round((((e.clientY - r.top) / r.height) * (2 * R + 20) - R - 10) / 1.6);
          onMove(`s:${x}:${y}`);
        }}
      >
        {rings.map((c, i) => (
          <circle key={i} r={R - i * (R / 10)} fill={c} stroke="#64748b" strokeWidth={0.6} />
        ))}
        {state.hits.map((hs, p) => hs.map((h, i) => <circle key={`${p}-${i}`} data-arrow={`${p}:${i}`} cx={h.x * 1.6} cy={h.y * 1.6} r={5} fill={colour(p)} stroke="#fff" strokeWidth={1.5} />))}
      </svg>
      <div className="text-[11.5px] text-slate-500">{canPlay ? "Click where to aim; the wind moves the arrow." : state.done ? "Done." : `${name(turn)} is shooting.`}</div>
    </div>
  );
}

// ---------------------------------------------------------------- Cup Pong

export function CupPongBoard({ moves, canPlay, turn, seats, starter = 0, seed = "", onMove }: BoardProps) {
  const n = Math.max(2, seats?.length ?? 2);
  const state = useMemo(() => cupPong.replay(moves, n, seed), [moves, n, seed]);
  const name = (p: number) => seatFor(seats, starter, p, n).name;
  if (!state) return null;
  const target = 1 - (turn % 2);
  return (
    <div data-game-board="cuppong" className="flex flex-col items-center gap-2">
      <div className="text-[12.5px] font-semibold" data-cuppong-cups>
        Side A cups {state.cups[0].filter(Boolean).length} · Side B cups {state.cups[1].filter(Boolean).length} · {name(turn)} throws
      </div>
      <svg
        width={300}
        height={220}
        className="rounded-xl bg-emerald-700 shadow-lg ring-1 ring-black/10"
        style={{ cursor: canPlay ? "crosshair" : "default" }}
        onClick={(e) => {
          if (!canPlay) return;
          const r = e.currentTarget.getBoundingClientRect();
          onMove(`t:${Math.round(((e.clientX - r.left) / r.width) * 300)}:${Math.round(((e.clientY - r.top) / r.height) * 200)}`);
        }}
      >
        {CUPS.map(([x, y], i) => (
          <circle key={i} data-cup={`${target}:${i}`} cx={x} cy={y} r={CUP_R} fill={state.cups[target][i] ? "#dc2626" : "#064e3b"} stroke="#fff" strokeWidth={2} opacity={state.cups[target][i] ? 1 : 0.4} />
        ))}
        {state.last && <circle cx={state.last.x} cy={state.last.y} r={7} fill={state.last.hit >= 0 ? "#facc15" : "#f8fafc"} stroke="#0f172a" />}
      </svg>
      <div className="text-[11.5px] text-slate-500">{canPlay ? "Click where to throw at their cups (the ball bounces a little)." : "Waiting…"}</div>
    </div>
  );
}

// ---------------------------------------------------------------- Bowling

export function BowlingBoard({ moves, canPlay, turn, seats, starter = 0, seed = "", onMove }: BoardProps) {
  const n = Math.max(1, seats?.length ?? 1);
  const state = useMemo(() => bowling.replay(moves, n, seed), [moves, n, seed]);
  const name = (p: number) => seatFor(seats, starter, p, n).name;
  const [pos, setPos] = useState(0);
  const [angle, setAngle] = useState(0);
  const power = useSwing(1600, canPlay);
  const locked = useRef<number | null>(null);
  useEffect(() => {
    locked.current = null;
  }, [moves.length]);
  if (!state) return null;
  const pw = Math.max(1, Math.round(power * 100));
  return (
    <div data-game-board="bowling" className="flex flex-col items-center gap-2">
      <div className="flex flex-wrap justify-center gap-x-4 text-[12.5px] font-semibold" data-bowling-scores>
        {state.frames.map((fr, p) => (
          <span key={p} className={p === turn && !state.done ? "underline decoration-2 underline-offset-4" : ""}>
            {name(p)} {bowlingScore(fr)} <span className="text-slate-400 font-normal">(frame {Math.min(fr.length, 10)})</span>
          </span>
        ))}
      </div>
      <svg width={320} height={260} className="rounded-xl bg-amber-100 shadow-lg ring-1 ring-black/10">
        <rect x={60} y={0} width={200} height={260} fill="#d9b382" />
        {PINS.map(([px, row], i) => (
          <circle key={i} data-pin={i} cx={160 + px * 0.6} cy={40 - row * 14 + 40} r={7} fill={state.standing[i] ? "#f8fafc" : "#94a3b8"} stroke="#0f172a" opacity={state.standing[i] ? 1 : 0.3} />
        ))}
        <circle cx={160 + pos * 0.9} cy={235} r={10} fill="#1e3a8a" />
        {canPlay && <line x1={160 + pos * 0.9} y1={235} x2={160 + pos * 0.9 + Math.tan((angle * Math.PI) / 180) * 160} y2={75} stroke="#4f46e5" strokeDasharray="4 4" />}
        {state.last && <text x={10} y={20} fontSize="11" fill="#0f172a">last: {state.last.fell} down</text>}
      </svg>
      {canPlay && (
        <div className="flex flex-wrap items-center justify-center gap-3 text-[12px]" data-bowling-controls>
          <label className="inline-flex items-center gap-1">
            Position <input data-bowling-pos type="range" min={-100} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} />
          </label>
          <label className="inline-flex items-center gap-1">
            Angle <input data-bowling-angle type="range" min={-30} max={30} value={angle} onChange={(e) => setAngle(Number(e.target.value))} />
          </label>
          <span className="inline-flex items-center gap-1">
            Power
            <span className="inline-block h-3 w-28 overflow-hidden rounded-full bg-slate-500/20">
              <span className="block h-3 bg-indigo-600" style={{ width: `${pw}%` }} />
            </span>
          </span>
          <button type="button" data-bowling-roll onClick={() => onMove(`r:${pos}:${angle}:${pw}`)} className={`${btn} bg-indigo-600 text-white`}>
            Roll
          </button>
        </div>
      )}
      <div className="text-[11.5px] text-slate-500">Press Roll when the power bar is where you want it.</div>
    </div>
  );
}
