import { Dice3D } from "./Dice3D";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { seatFor, type BoardProps } from "../boardProps";
import { FINISH, ludo, ludoChoices, ludoCorner, ludoEventText, ludoMovable, ludoPlayerAt, startOf, toAbsolute, SAFE, type LudoState } from "../../../lib/games/ludo.ts";
import { sfx } from "../../../lib/gameSounds";

const C = 28; // cell size
const SIZE = 15 * C;

/** The 52 squares of the loop, clockwise from red's start, as [row, col]. */
export const LOOP: [number, number][] = [
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
export const HOME: [number, number][][] = [
  [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]],
  [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]],
  [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]],
  [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]],
];
export const YARD: [number, number][] = [[0, 0], [0, 9], [9, 9], [9, 0]];
export const SPOT: [number, number][] = [[1.5, 1.5], [1.5, 3.5], [3.5, 1.5], [3.5, 3.5]];

type Pt = [number, number]; // [y, x] in pixels

const CLASSIC = ["#f43f5e", "#0ea5e9", "#10b981", "#f59e0b"];

/** Each corner's colour and who plays it (-1: nobody). The corners nobody plays take the
 *  classic colours the players don't use, so no colour appears twice. */
export function cornerColours(n: number, colourOf: (p: number) => string): { colour: string; player: number }[] {
  const taken = new Set<string>();
  const out = [0, 1, 2, 3].map((c) => {
    const p = ludoPlayerAt(c, n);
    if (p < 0) return null;
    const colour = colourOf(p);
    taken.add(colour.toLowerCase());
    return { colour, player: p };
  });
  const spare = CLASSIC.filter((x) => !taken.has(x));
  return out.map((o) => o ?? { colour: spare.shift() ?? "#cbd5e1", player: -1 });
}

/** LANX 2.17.0: when only one move is possible, the token moves by itself after a moment (as in Ludo King). */
export function useLudoAutoMove(state: LudoState | null, canPlay: boolean, onMove: (m: string) => void, delay: number) {
  const send = useRef(onMove);
  send.current = onMove;
  const done = useRef(-1);
  const roll = state?.roll ?? 0;
  const rolls = state?.rolls ?? 0;
  const only = state && canPlay && roll ? ludoChoices(state) : [];
  const pick = only.length === 1 ? only[0] : -1;
  useEffect(() => {
    if (pick < 0 || done.current === rolls) return;
    const t = window.setTimeout(() => {
      done.current = rolls;
      send.current(`m:${pick}`);
    }, delay);
    return () => window.clearTimeout(t);
  }, [pick, rolls, delay]);
}

/** A corner's square for a token: its yard spot (-1), the track, its home column, or the centre. */
function cellOf(corner: number, rel: number, token: number): Pt {
  if (rel === -1) {
    const [yr, yc] = YARD[corner];
    const [dr, dc] = SPOT[token];
    return [(yr + dr) * C + C / 2, (yc + dc) * C + C / 2];
  }
  if (rel >= FINISH) return [7 * C + C / 2, 7 * C + C / 2];
  if (rel >= 51) {
    const [r, c] = HOME[corner][rel - 51];
    return [r * C + C / 2, c * C + C / 2];
  }
  const [r, c] = LOOP[toAbsolute(corner, rel)];
  return [r * C + C / 2, c * C + C / 2];
}

/** A five-pointed star (the safe squares). */
function star(cx: number, cy: number, R: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? R * 0.45 : R;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`);
  }
  return pts.join(" ");
}

// ---------------------------------------------------------------- moving tokens (2.16.1)

const STEP_MS = 170; // one square
const HOME_MS = 480; // a knocked token flying back to its yard
const easeInOut = (u: number) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
const reducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

interface Motion {
  key: string;
  /** The squares the token hops through, its old square first. */
  path: Pt[];
  knocked: { key: string; from: Pt; to: Pt }[];
  t0: number;
}

/** LANX 2.16.1: a moved token hops square by square along its way, and a knocked one flies home after. */
function useLudoMotion(state: LudoState | null, moves: string[], n: number) {
  const cellOfPlayer = (p: number, rel: number, t: number) => cellOf(ludoCorner(p, n), rel, t);
  const prev = useRef<{ moves: string[]; state: LudoState | null }>({ moves, state });
  const [motion, setMotion] = useState<Motion | null>(null);
  const [, setFrame] = useState(0);
  // Before the browser paints, so the token never shows at its new square first.
  useLayoutEffect(() => {
    const before = prev.current;
    if (before.moves === moves) return;
    prev.current = { moves, state };
    const last = moves[moves.length - 1] ?? "";
    const one = moves.length === before.moves.length + 1 && before.moves.every((x, i) => moves[i] === x);
    if (!state || !before.state || !one || !last.startsWith("m:") || reducedMotion()) {
      setMotion(null);
      return;
    }
    const t = Number(last.slice(2));
    const p = before.state.turn;
    const from = before.state.pos[p]?.[t];
    const to = state.pos[p]?.[t];
    if (from === undefined || to === undefined || from === to) {
      setMotion(null);
      return;
    }
    const path: Pt[] = [cellOfPlayer(p, from, t)];
    if (from === -1) path.push(cellOfPlayer(p, 0, t));
    else for (let r = from + 1; r <= to; r++) path.push(cellOfPlayer(p, r, t));
    const knocked: Motion["knocked"] = [];
    state.pos.forEach((tokens, q) =>
      tokens.forEach((rel, k) => {
        const was = before.state!.pos[q]?.[k] ?? -1;
        if (q !== p && was >= 0 && rel === -1) knocked.push({ key: `${q}-${k}`, from: cellOfPlayer(q, was, k), to: cellOfPlayer(q, -1, k) });
      }),
    );
    setMotion({ key: `${p}-${t}`, path, knocked, t0: performance.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moves, state]);
  useEffect(() => {
    if (!motion) return;
    const total = (motion.path.length - 1) * STEP_MS + (motion.knocked.length ? HOME_MS : 0);
    let raf = 0;
    let landed = 0;
    const tick = () => {
      const el = performance.now() - motion.t0;
      const step = Math.min(motion.path.length - 1, Math.floor(el / STEP_MS));
      if (step > landed) {
        landed = step;
        sfx("place", 0.25);
      }
      if (el >= total) {
        setMotion(null);
        return;
      }
      setFrame((f) => f + 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [motion]);
  /** Where a token is drawn now: its square, or somewhere along its hop (`lift` 0..1 above the board). */
  return (key: string, rest: Pt): { y: number; x: number; lift: number; moving: boolean } => {
    if (!motion) return { y: rest[0], x: rest[1], lift: 0, moving: false };
    const el = performance.now() - motion.t0;
    if (key === motion.key) {
      const steps = motion.path.length - 1;
      const f = Math.min(steps, Math.max(0, el / STEP_MS));
      const i = Math.min(steps - 1, Math.floor(f));
      const u = f - i;
      const [a, b] = [motion.path[i], motion.path[i + 1]];
      const e = easeInOut(u);
      return { y: a[0] + (b[0] - a[0]) * e, x: a[1] + (b[1] - a[1]) * e, lift: Math.sin(Math.PI * u), moving: true };
    }
    const k = motion.knocked.find((x) => x.key === key);
    if (k) {
      const u = Math.max(0, Math.min(1, (el - (motion.path.length - 1) * STEP_MS) / HOME_MS));
      const e = easeInOut(u);
      return { y: k.from[0] + (k.to[0] - k.from[0]) * e, x: k.from[1] + (k.to[1] - k.from[1]) * e, lift: Math.sin(Math.PI * u) * 1.5, moving: true };
    }
    return { y: rest[0], x: rest[1], lift: 0, moving: false };
  };
}

/** Ludo: Roll, then click the token to move. */
export function LudoBoard({ moves, canPlay, turn, seats, starter = 0, seed = "", onMove }: BoardProps) {
  const n = Math.max(2, Math.min(4, seats?.length ?? 2));
  const state = useMemo(() => ludo.replay(moves, n, seed), [moves, n, seed]);
  const rolls = useMemo(() => moves.filter((x) => x === "r").length, [moves]);
  const place = useLudoMotion(state, moves, n);
  useLudoAutoMove(state, canPlay, onMove, 800);
  if (!state) return null;
  const colour = (p: number) => seatFor(seats, starter, p, n).color;
  const name = (p: number) => seatFor(seats, starter, p, n).name;
  const movable = canPlay && state.roll ? ludoMovable(state) : [];
  // Every corner keeps its colour, like a real board; the corners nobody plays are paler.
  const corners = cornerColours(n, colour);
  const tint = (c: number) => corners[c].colour;
  const strength = (c: number) => (corners[c].player >= 0 ? 1 : 0.32);
  const startPlayer = (i: number) => [0, 1, 2, 3].find((c) => startOf(c) === i) ?? -1;
  const said = ludoEventText(state, name);
  const tokens = state.pos.flatMap((list, p) =>
    list.map((rel, t) => {
      const rest = cellOf(ludoCorner(p, n), rel, t);
      const stack = rel >= 0 && rel < FINISH ? list.filter((o, k) => k < t && o === rel).length : 0;
      const at = place(`${p}-${t}`, [rest[0] - stack * 4, rest[1] + stack * 4]);
      return { p, t, rel, at, can: p === turn && movable.includes(t) };
    }),
  );
  // Moving tokens are drawn last, so they pass over the others.
  tokens.sort((a, b) => Number(a.at.moving) - Number(b.at.moving));
  return (
    <div data-game-board="ludo" className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-3 text-[12.5px] font-semibold">
        {state.lastRoll > 0 && (
          <span className="inline-flex items-center gap-1.5" data-ludo-last>
            <span className="g3-token h-3.5 w-3.5 rounded-full" style={{ backgroundColor: colour(state.roller) }} /> <Dice3D value={state.lastRoll} size={30} rollKey={rolls} />
            {said && <span className="text-slate-500 font-normal" data-ludo-event={state.event || "six"}>· {said}</span>}
          </span>
        )}
        <button type="button" data-ludo-roll disabled={!canPlay || state.roll > 0} onClick={() => onMove("r")} className="rounded-full bg-indigo-600 px-4 py-1.5 text-white hover:bg-indigo-700 disabled:opacity-50">
          🎲 Roll
        </button>
        {state.roll > 0 && canPlay && <span className="text-indigo-600 dark:text-indigo-300">{movable.length > 1 && ludoChoices(state).length > 1 ? `Pick a token to move ${state.roll}` : `Moving ${state.roll}…`}</span>}
        {!state.roll && canPlay && state.again && <span className="text-indigo-600 dark:text-indigo-300" data-ludo-again>Roll again!</span>}
      </div>
      <svg width={SIZE} height={SIZE} className="rounded-2xl shadow-lg ring-1 ring-black/10 select-none" style={{ background: "#ffffff" }} data-ludo-classic>
        <defs>
          <radialGradient id="g3gloss" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#fff" stopOpacity="0.95" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <clipPath id="ludoRound">
            <rect width={SIZE} height={SIZE} rx={16} />
          </clipPath>
        </defs>
        <g clipPath="url(#ludoRound)">
          {/* yards: a coloured corner, a white court, four token bases */}
          {YARD.map(([r, c], p) => (
            <g key={p} opacity={strength(p)}>
              <rect x={c * C} y={r * C} width={6 * C} height={6 * C} fill={tint(p)} />
              <rect x={c * C + C * 0.8} y={r * C + C * 0.8} width={C * 4.4} height={C * 4.4} fill="#fff" rx={10} />
              {SPOT.map(([dr, dc], k) => (
                <circle key={k} cx={(c + dc) * C + C / 2} cy={(r + dr) * C + C / 2} r={C * 0.58} fill={tint(p)} fillOpacity={0.22} stroke={tint(p)} strokeWidth={2} />
              ))}
            </g>
          ))}
          {/* loop squares: each player's start in their colour; stars on the safe squares */}
          {LOOP.map(([r, c], i) => {
            const sp = startPlayer(i);
            return (
              <g key={i}>
                <rect data-ludo-square={i} x={c * C} y={r * C} width={C} height={C} fill={sp >= 0 ? tint(sp) : "#fff"} fillOpacity={sp >= 0 ? strength(sp) : 1} stroke="#cbd5e1" strokeWidth={1} />
                {SAFE.has(i) && <polygon points={star(c * C + C / 2, r * C + C / 2, C * 0.34)} fill={sp >= 0 ? "#fff" : "none"} stroke={sp >= 0 ? "none" : "#94a3b8"} strokeWidth={1.4} strokeLinejoin="round" pointerEvents="none" />}
              </g>
            );
          })}
          {/* home columns, in full colour */}
          {HOME.map((cells, p) => cells.slice(0, 5).map(([r, c], k) => <rect key={`${p}-${k}`} x={c * C} y={r * C} width={C} height={C} fill={tint(p)} fillOpacity={strength(p) * 0.9} stroke="#cbd5e1" />))}
          {/* the centre: four triangles pointing home */}
          <rect x={6 * C} y={6 * C} width={3 * C} height={3 * C} fill="#fff" />
          <polygon points={`${6 * C},${6 * C} ${9 * C},${6 * C} ${7.5 * C},${7.5 * C}`} fill={tint(1)} fillOpacity={strength(1)} stroke="#fff" strokeWidth={1.5} />
          <polygon points={`${9 * C},${6 * C} ${9 * C},${9 * C} ${7.5 * C},${7.5 * C}`} fill={tint(2)} fillOpacity={strength(2)} stroke="#fff" strokeWidth={1.5} />
          <polygon points={`${9 * C},${9 * C} ${6 * C},${9 * C} ${7.5 * C},${7.5 * C}`} fill={tint(3)} fillOpacity={strength(3)} stroke="#fff" strokeWidth={1.5} />
          <polygon points={`${6 * C},${9 * C} ${6 * C},${6 * C} ${7.5 * C},${7.5 * C}`} fill={tint(0)} fillOpacity={strength(0)} stroke="#fff" strokeWidth={1.5} />
        </g>
        {/* tokens */}
        {tokens.map(({ p, t, rel, at, can }) => {
          const { x, y, lift } = at;
          return (
            <g key={`${p}-${t}`} data-ludo-token={`${p}:${t}`} data-ludo-pos={rel} data-ludo-can={can ? "1" : undefined} className={can ? "cursor-pointer" : ""} onClick={() => can && onMove(`m:${t}`)}>
              <ellipse className="g3-shadow" cx={x + 1.5} cy={y + 3} rx={10 - lift * 2} ry={9 - lift * 2} fill="#0f172a" opacity={0.28 - lift * 0.12} />
              <g transform={`translate(${x.toFixed(2)} ${(y - lift * 8).toFixed(2)}) scale(${(1 + lift * 0.14).toFixed(3)})`}>
                <circle r={10.5} fill={colour(p)} stroke="#fff" strokeWidth={2.5} />
                <circle r={4.6} fill="none" stroke="#fff" strokeOpacity={0.55} strokeWidth={1.6} />
                <circle className="g3-gloss" cx={-3} cy={-3.5} r={4.5} fill="url(#g3gloss)" pointerEvents="none" />
                {can && <circle r={13.5} fill="none" stroke="#4f46e5" strokeWidth={3} className="animate-pulse" />}
              </g>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
