import { useMemo, useState } from "react";
import { seatFor, type BoardProps } from "../boardProps";
import { BALL_R, CUP_R, GOLF_H, GOLF_W, HOLES, MAX_STROKES, minigolf } from "../../../lib/games/minigolf.ts";
import { POOL_BALL_R, POOL_H, POOL_W, pool } from "../../../lib/games/pool.ts";
import { CARROM_S, QUEEN, STRIKER, carrom } from "../../../lib/games/carrom.ts";
import { K } from "../../../lib/games/physics2d.ts";
import { useFrames } from "./useFrames";

const btn = "rounded-full px-4 py-1.5 text-[12.5px] font-semibold";
const deg = (dx: number, dy: number) => Math.round((Math.atan2(dy, dx) * 180) / Math.PI);

// ---------------------------------------------------------------- Mini Golf

export function GolfBoard({ moves, canPlay, turn, seats, starter = 0, onMove }: BoardProps) {
  const n = Math.max(1, seats?.length ?? 1);
  const state = useMemo(() => minigolf.replay(moves, n, ""), [moves, n]);
  const path = useMemo(() => state?.path ?? [], [state]);
  const { frame: dot, playing } = useFrames(path, 16);
  const [aim, setAim] = useState<[number, number] | null>(null);
  const name = (p: number) => seatFor(seats, starter, p, n).name;
  const colour = (p: number) => seatFor(seats, starter, p, n).color;
  if (!state) return null;
  const hole = HOLES[Math.min(state.hole, HOLES.length - 1)];
  const scale = 0.62;
  const ball = state.ball[turn];
  const lastMover = moves.length ? (() => {
    // The ball that just moved is the one whose turn it was before: find by elimination (the path's start).
    const start = path[0];
    return start ? state.ball.findIndex((b, p) => p !== turn && b && Math.abs(b[0] - path[path.length - 1][0]) < 2 && Math.abs(b[1] - path[path.length - 1][1]) < 2) : -1;
  })() : -1;
  const toTable = (e: React.MouseEvent<SVGSVGElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * GOLF_W, ((e.clientY - r.top) / r.height) * GOLF_H];
  };
  const shot = aim && ball ? { angle: deg(aim[0] - ball[0], aim[1] - ball[1]), power: Math.max(1, Math.min(100, Math.round(Math.hypot(aim[0] - ball[0], aim[1] - ball[1]) / 4))) } : null;
  return (
    <div data-game-board="minigolf" className="flex flex-col items-center gap-2">
      <div className="flex flex-wrap justify-center gap-x-4 text-[12.5px] font-semibold" data-golf-scores>
        <span>Hole {Math.min(state.hole + 1, HOLES.length)} · par {hole.par}</span>
        {state.strokes.map((st, p) => (
          <span key={p} className={`inline-flex items-center gap-1.5 ${p === turn && !state.done ? "underline decoration-2 underline-offset-4" : ""}`}>
            <span className="g3-token h-3 w-3 rounded-full" style={{ backgroundColor: colour(p) }} /> {name(p)} {st.reduce((a, b) => a + b, 0)} <span className="text-slate-400 font-normal">(this hole {st[st.length - 1] ?? 0})</span>
          </span>
        ))}
      </div>
      <svg
        width={GOLF_W * scale}
        height={GOLF_H * scale}
        viewBox={`0 0 ${GOLF_W} ${GOLF_H}`}
        className="rounded-xl shadow-lg ring-1 ring-black/10"
        style={{ background: "#4ade80", cursor: canPlay && ball ? "crosshair" : "default" }}
        onMouseMove={(e) => canPlay && ball && setAim(toTable(e))}
        onMouseLeave={() => setAim(null)}
        onClick={() => canPlay && shot && !playing && onMove(`s:${shot.angle}:${shot.power}`)}
      >
        {hole.blocks.map(([x, y, w, h], i) => (
          <rect key={i} x={x} y={y} width={w} height={h} fill="#15803d" stroke="#052e16" />
        ))}
        <circle cx={hole.cup[0]} cy={hole.cup[1]} r={CUP_R} fill="#0f172a" />
        <rect x={hole.cup[0] - 1} y={hole.cup[1] - 40} width={2} height={40} fill="#0f172a" />
        <polygon points={`${hole.cup[0] + 1},${hole.cup[1] - 40} ${hole.cup[0] + 22},${hole.cup[1] - 32} ${hole.cup[0] + 1},${hole.cup[1] - 24}`} fill="#dc2626" />
        {state.ball.map((b, p) => {
          if (!b) return null;
          const show = playing && p === lastMover && dot ? dot : b;
          return <circle key={p} data-golf-ball={p} cx={show[0]} cy={show[1]} r={BALL_R} fill={colour(p)} stroke="#fff" strokeWidth={2} />;
        })}
        {playing && dot && lastMover < 0 && <circle cx={dot[0]} cy={dot[1]} r={BALL_R} fill="#fff" stroke="#0f172a" />}
        {canPlay && ball && aim && shot && <line x1={ball[0]} y1={ball[1]} x2={aim[0]} y2={aim[1]} stroke="#1d4ed8" strokeWidth={3} strokeDasharray="6 6" />}
      </svg>
      <div className="text-[11.5px] text-slate-500">{canPlay && ball ? `Click to putt: the further from the ball, the harder (${shot ? shot.power : 0}%). ${MAX_STROKES} strokes and the hole is over.` : state.done ? "All nine holes played." : `${name(turn)} is putting.`}</div>
    </div>
  );
}

// ---------------------------------------------------------------- 8-Ball Pool

const BALL_COLOUR: Record<number, string> = { 1: "#facc15", 2: "#2563eb", 3: "#dc2626", 4: "#7c3aed", 5: "#f97316", 6: "#16a34a", 7: "#7f1d1d", 8: "#0f172a", 9: "#facc15", 10: "#2563eb", 11: "#dc2626", 12: "#7c3aed", 13: "#f97316", 14: "#16a34a", 15: "#7f1d1d" };

export function PoolBoard({ moves, canPlay, turn, seats, starter = 0, onMove }: BoardProps) {
  const n = 2;
  const state = useMemo(() => pool.replay(moves, n, ""), [moves]);
  const frames = useMemo(() => state?.frames ?? [], [state]);
  const { frame, playing } = useFrames(frames, 16);
  const [aim, setAim] = useState<[number, number] | null>(null);
  const [power, setPower] = useState(60);
  const name = (p: number) => seatFor(seats, starter, p, n).name;
  if (!state) return null;
  const scale = 0.54;
  const cue = state.balls[0];
  const shown = playing && frame ? state.balls.map((b, i) => ({ ...b, x: frame[i]?.x ?? b.x, y: frame[i]?.y ?? b.y, out: frame[i]?.out ?? b.out })) : state.balls;
  const toTable = (e: React.MouseEvent<SVGSVGElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * POOL_W, ((e.clientY - r.top) / r.height) * POOL_H];
  };
  const angle = aim ? deg(aim[0] - cue.x / K, aim[1] - cue.y / K) : 0;
  return (
    <div data-game-board="pool" className="flex flex-col items-center gap-2">
      <div className="flex flex-wrap justify-center gap-x-4 text-[12.5px] font-semibold" data-pool-groups>
        {state.groups.map((g, p) => (
          <span key={p} className={p === turn && state.winner === null ? "underline decoration-2 underline-offset-4" : ""}>
            {name(p)}: {g ?? "not decided"}
          </span>
        ))}
        {state.inHand && canPlay && <span className="text-indigo-600">Place the cue ball: click the table</span>}
      </div>
      <svg
        width={POOL_W * scale}
        height={POOL_H * scale}
        viewBox={`0 0 ${POOL_W} ${POOL_H}`}
        className="rounded-xl shadow-lg ring-8 ring-amber-900"
        style={{ background: "#166534", cursor: canPlay ? "crosshair" : "default" }}
        onMouseMove={(e) => canPlay && !state.inHand && setAim(toTable(e))}
        onClick={(e) => {
          if (!canPlay || playing) return;
          const [x, y] = toTable(e);
          if (state.inHand) onMove(`c:${Math.round(x)}:${Math.round(y)}`);
          else onMove(`s:${angle}:${power}`);
        }}
      >
        {[[8, 8], [POOL_W / 2, 2], [POOL_W - 8, 8], [8, POOL_H - 8], [POOL_W / 2, POOL_H - 2], [POOL_W - 8, POOL_H - 8]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={22} fill="#0f172a" />
        ))}
        {canPlay && aim && !state.inHand && !cue.out && <line x1={cue.x / K} y1={cue.y / K} x2={aim[0]} y2={aim[1]} stroke="#f8fafc" strokeWidth={2} strokeDasharray="6 6" opacity={0.7} />}
        {shown.map((b) =>
          b.out ? null : (
            <g key={b.id} data-pool-ball={b.id}>
              <circle cx={b.x / K} cy={b.y / K} r={POOL_BALL_R} fill={b.id === 0 ? "#f8fafc" : BALL_COLOUR[b.id]} stroke="#0f172a" strokeWidth={0.8} />
              {b.id >= 9 && <rect x={b.x / K - POOL_BALL_R} y={b.y / K - 4} width={2 * POOL_BALL_R} height={8} fill="#f8fafc" opacity={0.85} />}
              {b.id > 0 && (
                <text x={b.x / K} y={b.y / K + 3} textAnchor="middle" fontSize="8" fontWeight="bold" fill={b.id >= 9 ? "#0f172a" : "#fff"}>
                  {b.id}
                </text>
              )}
            </g>
          ),
        )}
      </svg>
      {canPlay && !state.inHand && (
        <div className="flex items-center gap-2 text-[12px]" data-pool-controls>
          <label className="inline-flex items-center gap-1">
            Power <input data-pool-power type="range" min={5} max={100} value={power} onChange={(e) => setPower(Number(e.target.value))} />
          </label>
          <button type="button" data-pool-shoot disabled={playing} onClick={() => onMove(`s:${angle}:${power}`)} className={`${btn} bg-indigo-600 text-white disabled:opacity-50`}>
            Shoot
          </button>
          <span className="text-slate-500">Move the mouse to aim; click the table or press Shoot.</span>
        </div>
      )}
      {state.log.length > 0 && <div className="text-[11.5px] text-slate-500">{state.log[state.log.length - 1]}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Carrom

export function CarromBoard({ moves, canPlay, turn, seat, seats, starter = 0, onMove }: BoardProps) {
  const n = 2;
  const state = useMemo(() => carrom.replay(moves, n, ""), [moves]);
  const frames = useMemo(() => state?.frames ?? [], [state]);
  const { frame, playing } = useFrames(frames, 16);
  const [pos, setPos] = useState(0);
  const [power, setPower] = useState(70);
  const [aim, setAim] = useState<[number, number] | null>(null);
  const name = (p: number) => seatFor(seats, starter, p, n).name;
  if (!state) return null;
  const scale = 0.7;
  const flip = seat === 1; // my baseline at the bottom
  const base = turn === 0 ? CARROM_S - 70 : 70;
  const sx = CARROM_S / 2 + pos;
  const coins = playing && frame ? state.coins.map((c, i) => ({ ...c, x: frame[i + 1]?.x ?? c.x, y: frame[i + 1]?.y ?? c.y, out: frame[i + 1]?.out ?? c.out })) : state.coins;
  const strikerShown = playing && frame?.[0] ? { x: frame[0].x / K, y: frame[0].y / K, out: frame[0].out } : null;
  const toBoard = (e: React.MouseEvent<SVGSVGElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * CARROM_S;
    const y = ((e.clientY - r.top) / r.height) * CARROM_S;
    return flip ? [CARROM_S - x, CARROM_S - y] : [x, y];
  };
  const angle = aim ? deg(aim[0] - sx, aim[1] - base) : turn === 0 ? 270 : 90;
  const view = (x: number, y: number) => (flip ? [CARROM_S - x, CARROM_S - y] : [x, y]);
  return (
    <div data-game-board="carrom" className="flex flex-col items-center gap-2">
      <div className="flex flex-wrap justify-center gap-x-4 text-[12.5px] font-semibold" data-carrom-score>
        <span className={turn === 0 ? "underline decoration-2 underline-offset-4" : ""}>{name(0)} (white) {state.potted[0].filter((id) => id >= 1 && id <= 9).length}/9</span>
        <span className={turn === 1 ? "underline decoration-2 underline-offset-4" : ""}>{name(1)} (black) {state.potted[1].filter((id) => id >= 10 && id <= 18).length}/9</span>
        {state.queenBy !== null && <span className="text-rose-600">queen: {name(state.queenBy)}</span>}
        {state.queenPending !== null && <span className="text-rose-600">cover the queen!</span>}
      </div>
      <svg width={CARROM_S * scale} height={CARROM_S * scale} viewBox={`0 0 ${CARROM_S} ${CARROM_S}`} className="rounded-lg shadow-lg ring-8 ring-amber-900" style={{ background: "#fde68a", cursor: canPlay ? "crosshair" : "default" }} onMouseMove={(e) => canPlay && setAim(toBoard(e))} onClick={() => canPlay && !playing && onMove(`s:${pos}:${angle}:${power}`)}>
        {[[14, 14], [CARROM_S - 14, 14], [14, CARROM_S - 14], [CARROM_S - 14, CARROM_S - 14]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={24} fill="#0f172a" />
        ))}
        <circle cx={CARROM_S / 2} cy={CARROM_S / 2} r={70} fill="none" stroke="#b45309" strokeWidth={2} />
        {[70, CARROM_S - 70].map((y, i) => (
          <line key={i} x1={60} y1={y} x2={CARROM_S - 60} y2={y} stroke="#b45309" strokeWidth={2} />
        ))}
        {coins.map((c) => {
          if (c.out) return null;
          const [x, y] = view(c.x / K, c.y / K);
          return <circle key={c.id} data-carrom-coin={c.id} cx={x} cy={y} r={13} fill={c.id === QUEEN ? "#dc2626" : c.id <= 9 ? "#f8fafc" : "#0f172a"} stroke="#78350f" strokeWidth={1} />;
        })}
        {(() => {
          const s = strikerShown && !strikerShown.out ? strikerShown : !playing ? { x: sx, y: base } : null;
          if (!s) return null;
          const [x, y] = view(s.x, s.y);
          return <circle data-carrom-striker cx={x} cy={y} r={17} fill="#fbbf24" stroke="#78350f" strokeWidth={2} />;
        })()}
        {canPlay && aim && !playing && (() => {
          const [x1, y1] = view(sx, base);
          const [x2, y2] = view(aim[0], aim[1]);
          return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#1d4ed8" strokeWidth={2} strokeDasharray="6 6" opacity={0.7} />;
        })()}
      </svg>
      {canPlay && (
        <div className="flex flex-wrap items-center justify-center gap-3 text-[12px]" data-carrom-controls>
          <label className="inline-flex items-center gap-1">
            Striker <input data-carrom-pos type="range" min={-180} max={180} value={pos} onChange={(e) => setPos(Number(e.target.value))} />
          </label>
          <label className="inline-flex items-center gap-1">
            Power <input data-carrom-power type="range" min={10} max={100} value={power} onChange={(e) => setPower(Number(e.target.value))} />
          </label>
          <button type="button" data-carrom-flick disabled={playing} onClick={() => onMove(`s:${pos}:${angle}:${power}`)} className={`${btn} bg-indigo-600 text-white disabled:opacity-50`}>
            Flick
          </button>
        </div>
      )}
      {state.log.length > 0 && <div className="text-[11.5px] text-slate-500">{state.log[state.log.length - 1]}</div>}
      <span className="hidden" data-carrom-striker-id={STRIKER} />
    </div>
  );
}
