import { useEffect, useMemo, useRef, useState } from "react";
import { namesIn, seatFor, type BoardProps } from "../boardProps";
import { DART_R, DART_START, dartFinish, darts } from "../../../lib/games/darts.ts";
import { ARROWS, TARGET_R, archery, archerySway, windFor } from "../../../lib/games/archery.ts";
import { CUPS, CUP_R, cupPong, pongSide, pongSway } from "../../../lib/games/cuppong.ts";
import { LANE_HALF, PINS, bowling, bowlingLine, bowlingScore } from "../../../lib/games/bowling.ts";
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
          <span key={p} className={`${p === turn && state.winner === null ? "underline decoration-2 underline-offset-4" : ""} ${state.out[p] ? "line-through opacity-50" : ""}`}>
            {name(p)} {state.out[p] ? "left" : l}
          </span>
        ))}
      </div>
      <div className="max-w-[380px] text-center text-[11.5px] text-slate-500" data-darts-rule>
        {DART_START} down to exactly 0. The last dart must be a double (outer ring, or the bull). Below 0, 1 left, or 0 without a double is a bust.
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
      <DartsNews log={state.log} finish={state.winner === null ? dartFinish(state.left[turn] ?? 0) : null} who={name(turn)} names={(t) => namesIn(t, seats, starter, n)} />
    </div>
  );
}

/** The last turn in words, and the finish the player to throw is on. */
function DartsNews({ log, finish, who, names }: { log: string[]; finish: string | null; who: string; names: (t: string) => string }) {
  return (
    <div className="flex flex-col items-center text-[11.5px] text-slate-600 dark:text-slate-300" data-darts-news>
      {log.length > 0 && <span data-darts-log>{names(log[log.length - 1])}</span>}
      {finish && (
        <span className="font-semibold text-emerald-600 dark:text-emerald-400" data-darts-finish>
          {who} can finish with {finish}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Archery

export function ArcheryBoard({ moves, canPlay, turn, seats, starter = 0, seed = "", onMove }: BoardProps) {
  const n = Math.max(1, seats?.length ?? 1);
  const state = useMemo(() => archery.replay(moves, n, seed), [moves, n, seed]);
  const name = (p: number) => seatFor(seats, starter, p, n).name;
  const colour = (p: number) => seatFor(seats, starter, p, n).color;
  // LANX 2.17.0: the sight sways just as on the 3D board (archerySway): hold the mouse to draw and steady it, then let go.
  const [aim, setAim] = useState<[number, number]>([0, 0]);
  const [sway, setSway] = useState<[number, number]>([0, 0]);
  const [draw, setDraw] = useState(0);
  const drawStart = useRef(0);
  const swayRef = useRef(sway);
  swayRef.current = sway;
  useEffect(() => {
    if (!canPlay) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = () => {
      const now = performance.now();
      const held = drawStart.current ? (now - drawStart.current) / 1000 : null;
      setSway(archerySway((now - t0) / 1000, held));
      setDraw(held === null ? 0 : Math.min(1, held / 1.2));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [canPlay]);
  if (!state) return null;
  const k = state.hits[turn]?.length ?? 0;
  const wind = state.done ? { dx: 0, dy: 0 } : windFor(seed, turn, k);
  const R = TARGET_R * 1.6;
  const rings = ["#f8fafc", "#f8fafc", "#0f172a", "#0f172a", "#2563eb", "#2563eb", "#dc2626", "#dc2626", "#facc15", "#facc15"];
  const sight: [number, number] = [aim[0] + sway[0], aim[1] + sway[1]];
  const toTarget = (e: React.MouseEvent<SVGSVGElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [(((e.clientX - r.left) / r.width) * (2 * R + 20) - R - 10) / 1.6, (((e.clientY - r.top) / r.height) * (2 * R + 20) - R - 10) / 1.6];
  };
  const shoot = () => {
    drawStart.current = 0;
    if (!canPlay) return;
    const [sx, sy] = swayRef.current;
    onMove(`s:${Math.round(aim[0] + sx)}:${Math.round(aim[1] + sy)}`);
  };
  return (
    <div data-game-board="archery" className="flex flex-col items-center gap-2">
      <div className="flex flex-wrap justify-center gap-x-4 text-[12.5px] font-semibold" data-archery-scores>
        {state.scores.map((s, p) => (
          <span key={p} className={`inline-flex items-center gap-1.5 ${p === turn && !state.done ? "underline decoration-2 underline-offset-4" : ""} ${state.out[p] ? "line-through opacity-50" : ""}`}>
            <span className="g3-token h-3 w-3 rounded-full" style={{ backgroundColor: colour(p) }} /> {name(p)} {s} <span className="text-slate-400 font-normal">({state.out[p] ? "left" : `${state.hits[p].length}/${ARROWS}`})</span>
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
        onMouseMove={(e) => canPlay && setAim(toTarget(e))}
        onMouseDown={(e) => {
          if (!canPlay || e.button !== 0) return;
          setAim(toTarget(e));
          drawStart.current = performance.now();
        }}
        onMouseUp={() => {
          if (drawStart.current) shoot();
        }}
        onMouseLeave={() => (drawStart.current = 0)}
      >
        {rings.map((c, i) => (
          <circle key={i} r={R - i * (R / 10)} fill={c} stroke="#64748b" strokeWidth={0.6} />
        ))}
        {state.hits.map((hs, p) => hs.map((h, i) => <circle key={`${p}-${i}`} data-arrow={`${p}:${i}`} cx={h.x * 1.6} cy={h.y * 1.6} r={5} fill={colour(p)} stroke="#fff" strokeWidth={1.5} />))}
        {canPlay && (
          <g data-archery-sight pointerEvents="none">
            <circle cx={sight[0] * 1.6} cy={sight[1] * 1.6} r={8} fill="none" stroke="#22d3ee" strokeWidth={2.5} />
            <circle cx={sight[0] * 1.6} cy={sight[1] * 1.6} r={1.5} fill="#22d3ee" />
          </g>
        )}
      </svg>
      {canPlay && (
        <div className="flex items-center gap-3 text-[12px]">
          <span className="inline-flex items-center gap-1.5">
            Draw
            <span className="inline-block h-2.5 w-28 overflow-hidden rounded-full bg-slate-500/20">
              <span className="block h-full bg-cyan-500" style={{ width: `${Math.round(draw * 100)}%` }} />
            </span>
          </span>
          <button type="button" data-archery-shoot onClick={shoot} className={`${btn} bg-indigo-600 text-white`}>
            Shoot
          </button>
        </div>
      )}
      {state.event && (
        <div className="text-[11.5px] text-slate-600 dark:text-slate-300" data-archery-event>
          {namesIn(state.event, seats, starter, n)}
        </div>
      )}
      <div className="max-w-[380px] text-center text-[11.5px] text-slate-500">
        {canPlay ? "Point at the target; the sight sways. Hold the mouse to draw — it steadies, then your arm tires — and let go. The wind moves the arrow." : state.done ? "Done." : `${name(turn)} is shooting.`}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Cup Pong

export function CupPongBoard({ moves, canPlay, turn, seat, seats, starter = 0, seed = "", local, onMove }: BoardProps) {
  const n = Math.max(2, seats?.length ?? 2);
  const state = useMemo(() => cupPong.replay(moves, n, seed), [moves, n, seed]);
  const name = (p: number) => seatFor(seats, starter, p, n).name.split(" (")[0];
  // LANX 2.17.0: the sight sways (pongSway, as on the 3D board); the throw goes where the sight is.
  const [aim, setAim] = useState<[number, number]>([150, 110]);
  const [sway, setSway] = useState<[number, number]>([0, 0]);
  useEffect(() => {
    if (!canPlay) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = () => {
      setSway(pongSway((performance.now() - t0) / 1000));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [canPlay]);
  if (!state) return <div className="text-[12.5px] text-slate-500">Cup Pong is for two players, or two teams of two.</div>;
  const side = state.side;
  const target = 1 - side;
  const mySide = local ? side : pongSide(seat);
  const cupsOf = (s: number) => state.cups[s].filter(Boolean).length;
  const teamOf = (s: number) => (n === 4 ? [s, s + 2] : [s]).map(name).join(" & ");
  const sight: [number, number] = [Math.round(aim[0] + sway[0]), Math.round(aim[1] + sway[1])];
  const toTable = (e: React.MouseEvent<SVGSVGElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * 300), Math.round(((e.clientY - r.top) / r.height) * 200)];
  };
  const throwNow = () => canPlay && onMove(`t:${sight[0]}:${sight[1]}`);
  const shownLast = state.last && state.last.target === target ? state.last : null;
  return (
    <div data-game-board="cuppong" className="flex flex-col items-center gap-2">
      <div className="text-[12.5px] font-semibold" data-cuppong-cups>
        {local ? `${teamOf(0)}: ${cupsOf(0)} cups · ${teamOf(1)}: ${cupsOf(1)} cups` : `Your cups ${cupsOf(mySide)} · Their cups ${cupsOf(1 - mySide)}`}
      </div>
      <div className="text-[12px] text-slate-500" data-cuppong-thrower>
        {state.winner === null ? `${name(turn)} throws ${state.shot === 0 ? "the first" : "the second"} ball at ${local ? `${teamOf(target)}'s` : target === mySide ? "your" : "their"} cups` : ""}
      </div>
      {state.rebuttal && state.winner === null && (
        <div className="text-[12px] font-semibold text-rose-600" data-cuppong-rebuttal>
          Last chance: sink every cup left on the other side with these two balls to force overtime.
        </div>
      )}
      <svg
        width={300}
        height={200}
        viewBox="0 0 300 200"
        className="rounded-xl bg-emerald-700 shadow-lg ring-1 ring-black/10"
        style={{ cursor: canPlay ? "crosshair" : "default" }}
        onMouseMove={(e) => canPlay && setAim(toTable(e))}
        onClick={(e) => {
          if (!canPlay) return;
          setAim(toTable(e));
          throwNow();
        }}
      >
        {CUPS.map(([x, y], i) => (
          <circle key={i} data-cup={`${target}:${i}`} cx={x} cy={y} r={CUP_R} fill={state.cups[target][i] ? "#dc2626" : "#064e3b"} stroke="#fff" strokeWidth={2} opacity={state.cups[target][i] ? 1 : 0.4} />
        ))}
        {shownLast && <circle data-cuppong-ball cx={shownLast.x} cy={shownLast.y} r={7} fill={shownLast.hit >= 0 ? "#facc15" : "#f8fafc"} stroke="#0f172a" />}
        {canPlay && (
          <g data-cuppong-sight pointerEvents="none">
            <circle cx={sight[0]} cy={sight[1]} r={9} fill="none" stroke="#facc15" strokeWidth={2.5} />
            <circle cx={sight[0]} cy={sight[1]} r={1.5} fill="#facc15" />
          </g>
        )}
      </svg>
      <div className="min-h-[18px] text-[12px] text-slate-600 dark:text-slate-300" data-cuppong-event>
        {namesIn(state.event, seats, starter, n)}
      </div>
      {canPlay && (
        <div className="flex items-center gap-2 text-[12px]">
          <button type="button" data-cuppong-throw onClick={throwNow} className={`${btn} bg-indigo-600 text-white`}>
            Throw
          </button>
          <span className="max-w-[300px] text-[11.5px] text-slate-500">Point at their cups; the sight sways — click (or Throw) when it is on a cup. Two balls a turn.</span>
        </div>
      )}
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
  // LANX 2.17.0: the same geometry as the rules and the 3D lane — x across in lane units (scale S), the
  // ball released at the foul line (y 235) reaches the head pin's row (y 80) at bowlingLine(pos, angle).
  const S = 0.95;
  const X = (u: number) => 160 + u * S;
  const FOUL_Y = 235;
  const HEAD_Y = 80;
  const pinY = (row: number) => HEAD_Y - row * 14;
  const at = bowlingLine(pos, angle);
  const last = state.last;
  return (
    <div data-game-board="bowling" className="flex flex-col items-center gap-2">
      <div className="flex flex-wrap justify-center gap-x-4 text-[12.5px] font-semibold" data-bowling-scores>
        {state.frames.map((fr, p) => (
          <span key={p} className={`${p === turn && !state.done ? "underline decoration-2 underline-offset-4" : ""} ${state.out[p] ? "line-through opacity-50" : ""}`}>
            {name(p)} {bowlingScore(fr)} <span className="text-slate-400 font-normal">({state.out[p] ? "left" : `frame ${Math.min(fr.length, 10)}`})</span>
          </span>
        ))}
      </div>
      <svg width={320} height={260} className="rounded-xl bg-slate-300 shadow-lg ring-1 ring-black/10 dark:bg-slate-700" data-bowling-lane>
        <rect x={X(-LANE_HALF) - 20} y={0} width={20} height={260} fill="#9ca3af" />
        <rect x={X(LANE_HALF)} y={0} width={20} height={260} fill="#9ca3af" />
        <rect x={X(-LANE_HALF)} y={0} width={2 * LANE_HALF * S} height={260} fill="#d9b382" />
        <line x1={X(-LANE_HALF)} y1={FOUL_Y + 12} x2={X(LANE_HALF)} y2={FOUL_Y + 12} stroke="#7c2d12" strokeWidth={2} />
        {last && (
          <line data-bowling-track x1={X(last.from)} y1={FOUL_Y} x2={X(Math.max(-LANE_HALF - 12, Math.min(LANE_HALF + 12, last.x)))} y2={HEAD_Y} stroke="#1e3a8a" strokeWidth={2} opacity={0.25} />
        )}
        {PINS.map(([px, row], i) => (
          <circle key={i} data-pin={i} cx={X(px)} cy={pinY(row)} r={7} fill={state.standing[i] ? "#f8fafc" : "#94a3b8"} stroke="#0f172a" opacity={state.standing[i] ? 1 : 0.3} />
        ))}
        {canPlay && <line data-bowling-aim x1={X(pos)} y1={FOUL_Y} x2={X(at)} y2={HEAD_Y} stroke="#4f46e5" strokeDasharray="4 4" />}
        <circle data-bowling-ball cx={X(pos)} cy={FOUL_Y} r={11} fill="#1e3a8a" />
        {last && (
          <text x={8} y={16} fontSize="11" fill="#0f172a">
            last: {last.fell} down
          </text>
        )}
      </svg>
      <div className="min-h-[18px] text-[12.5px] font-semibold text-slate-700 dark:text-slate-200" data-bowling-event>
        {namesIn(state.event, seats, starter, n)}
      </div>
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
            <span className="g3-token inline-block h-3 w-28 overflow-hidden rounded-full bg-slate-500/20">
              <span className="block h-3 bg-indigo-600" style={{ width: `${pw}%` }} />
            </span>
          </span>
          <button type="button" data-bowling-roll onClick={() => onMove(`r:${pos}:${angle}:${pw}`)} className={`${btn} bg-indigo-600 text-white`}>
            Roll
          </button>
        </div>
      )}
      <div className="max-w-[380px] text-center text-[11.5px] text-slate-500">Press Roll when the power bar is where you want it. Aim just right of the head pin, coming in at a slight angle, for the best chance of a strike.</div>
    </div>
  );
}
