import { Dice3D } from "./Dice3D";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { seatFor, type BoardProps } from "../boardProps";
import { FINISH, TRACK, ludo, ludoChoices, ludoCorner, ludoEventText, ludoMovable, ludoPlayerAt, startOf, toAbsolute, SAFE, type LudoState } from "../../../lib/games/ludo.ts";
import { sfx } from "../../../lib/gameSounds";
import { paperTexture, woodTexture } from "../../../lib/games/texture";

const C = 30; // cell size
const SIZE = 15 * C;
/** LANX 3.12.0: the wooden frame round the printed board. */
const FRAME = 14;

/** A colour made lighter (amt > 0) or darker (amt < 0). */
function shade(hex: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  const ch = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt)));
  return `#${ch.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

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

/** LANX 2.17.1: Ludo King's strong colours, one per corner (top left, top right, bottom right, bottom left
 *  of the unturned board) — the same in the flat board, the 3D board and the seat list. */
export const LUDO_COLOURS = ["#e53935", "#2e9e44", "#f9b800", "#1e88e5"];
export const LUDO_DARK = ["#a91f1c", "#1d6b2d", "#b07f00", "#1259a8"];
/** A player's colour: the colour of the corner they sit at. */
export const ludoColour = (player: number, n: number) => LUDO_COLOURS[ludoCorner(player, n)];

/** Each corner's colour and who plays it (-1: nobody). Every corner keeps its full colour, as on a real board. */
export function cornerColours(n: number): { colour: string; player: number }[] {
  return [0, 1, 2, 3].map((c) => ({ colour: LUDO_COLOURS[c], player: ludoPlayerAt(c, n) }));
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

/** LANX 2.17.1: the board's side on screen — as big as the room allows (the plates and the status line
 *  always fit), up to its natural size. The room is the nearest real ancestor (the games window's board
 *  area, which otherwise scrolls). */
const CHROME = 58 * 2 + 8 * 3 + 40 + 8; // two plate rows, three gaps, a two-line status, a little air
function useFitSide(ref: RefObject<HTMLDivElement | null>): number {
  const [side, setSide] = useState(SIZE);
  useLayoutEffect(() => {
    let el = ref.current?.parentElement ?? null;
    while (el && getComputedStyle(el).display === "contents") el = el.parentElement;
    if (!el) return;
    const box = el;
    const fit = () => {
      const cs = getComputedStyle(box);
      const pw = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const ph = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      setSide(Math.max(240, Math.min(SIZE * 2, box.clientWidth - pw - 8, box.clientHeight - ph - CHROME)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, [ref]);
  return side;
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

/** Ludo: Roll, then click the token to move. LANX 2.17.1: the look of Ludo King — four strong colours,
 *  pin tokens, your colour at the bottom left, a player plate at each corner with the die. */
export function LudoBoard({ moves, canPlay, turn, seat, seats, starter = 0, seed = "", local, onMove }: BoardProps) {
  const n = Math.max(2, Math.min(4, seats?.length ?? 2));
  const state = useMemo(() => ludo.replay(moves, n, seed), [moves, n, seed]);
  const rolls = useMemo(() => moves.filter((x) => x === "r").length, [moves]);
  const place = useLudoMotion(state, moves, n);
  useLudoAutoMove(state, canPlay, onMove, 800);
  const rootRef = useRef<HTMLDivElement>(null);
  const side = useFitSide(rootRef);
  if (!state) return null;
  const me = local ? -1 : Math.max(0, seat);
  const name = (p: number) => (p === me ? "You" : seatFor(seats, starter, p, n).name.split(" (")[0]);
  const colour = (p: number) => ludoColour(p, n);
  const movable = canPlay && state.roll ? ludoMovable(state) : [];
  const startCorner = (i: number) => [0, 1, 2, 3].find((c) => startOf(c) === i) ?? -1;
  const said = ludoEventText(state, name);
  // Your colour sits at the bottom left (as in Ludo King); at one PC the board stays put.
  const k = me < 0 ? 0 : (3 - ludoCorner(me, n) + 4) % 4;
  const spin = (p: Pt): Pt => {
    let [y, x] = p;
    for (let i = 0; i < k; i++) [x, y] = [SIZE - y, x];
    return [y, x];
  };
  const screenCorner = (c: number) => (c + k) % 4; // 0 top left, 1 top right, 2 bottom right, 3 bottom left
  const cornerAt = (s: number) => [0, 1, 2, 3].find((c) => screenCorner(c) === s) ?? 0;

  // Tokens: where each stands on screen; tokens sharing a square stand side by side, smaller.
  const placed = state.pos.flatMap((list, p) =>
    list.map((rel, t) => {
      const at = place(`${p}-${t}`, cellOf(ludoCorner(p, n), rel, t));
      const [y, x] = spin([at.y, at.x]);
      return { p, t, rel, x, y, lift: at.lift, moving: at.moving, can: p === turn && movable.includes(t) };
    }),
  );
  const groups = new Map<string, number[]>();
  placed.forEach((tk, i) => {
    if (tk.moving || tk.rel < 0) return;
    const key = `${Math.round(tk.x)},${Math.round(tk.y)}`;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  });
  const offsetOf = new Map<number, { dx: number; dy: number; s: number }>();
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    const offs = ids.length === 2 ? [[-0.2, 0], [0.2, 0]] : [[-0.2, -0.16], [0.2, -0.16], [-0.2, 0.18], [0.2, 0.18]];
    ids.forEach((id, j) => {
      const [ox, oy] = offs[j % offs.length];
      offsetOf.set(id, { dx: ox * C, dy: oy * C, s: ids.length === 2 ? 0.8 : 0.66 });
    });
  }
  const tokens = placed.map((tk, i) => ({ ...tk, off: offsetOf.get(i) ?? { dx: 0, dy: 0, s: 1 } }));
  // Moving tokens are drawn last, so they pass over the others; then by height, so lower pins overlap higher ones.
  tokens.sort((a, b) => Number(a.moving) - Number(b.moving) || a.y + a.off.dy - (b.y + b.off.dy));

  const home = (p: number) => state.pos[p].filter((x) => x === FINISH).length;
  const canRoll = canPlay && !state.roll && state.winner === null;
  const plate = (s: number) => {
    const c = cornerAt(s);
    const p = ludoPlayerAt(c, n);
    if (p < 0) return <div className="h-[58px] flex-1" />;
    const active = p === turn && state.winner === null;
    const out = state.out[p];
    return (
      <div
        className={`flex h-[58px] flex-1 items-center gap-2.5 rounded-2xl px-3 transition-shadow ${s % 3 === 0 ? "" : "flex-row-reverse text-right"} ${active ? "bg-white shadow-md dark:bg-slate-800" : "bg-white/60 dark:bg-slate-800/50"}`}
        style={active ? { boxShadow: `0 0 0 2.5px ${LUDO_COLOURS[c]}` } : undefined}
        data-ludo-plate={p}
        data-ludo-active={active ? "1" : undefined}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[14px] font-bold text-white" style={{ backgroundColor: LUDO_COLOURS[c], opacity: out ? 0.4 : 1 }}>
          {seatFor(seats, starter, p, n).name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className={`truncate text-[13px] font-semibold text-slate-900 dark:text-white ${out ? "line-through opacity-50" : ""}`}>{name(p)}</div>
          <div className="text-[11px] text-slate-500">{out ? "left the game" : `${home(p)}/4 home`}</div>
        </div>
        {active && (
          <div
            role="button"
            tabIndex={canRoll ? 0 : -1}
            data-ludo-roll
            aria-disabled={!canRoll}
            {...(canRoll ? {} : ({ disabled: "" } as Record<string, string>))}
            onClick={() => canRoll && onMove("r")}
            onKeyDown={(e) => canRoll && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onMove("r"))}
            aria-label={canRoll ? "Roll the die" : "The die"}
            className={`flex shrink-0 select-none items-center justify-center rounded-xl p-1 ${canRoll ? "ludo-roll cursor-pointer active:scale-95" : "cursor-default"}`}
            style={{ backgroundColor: `${LUDO_COLOURS[c]}22`, boxShadow: canRoll ? `0 0 0 2px ${LUDO_COLOURS[c]}` : undefined }}
          >
            {state.lastRoll > 0 && state.roller === p ? (
              <span data-ludo-last>
                <Dice3D value={state.lastRoll} size={32} rollKey={rolls} />
              </span>
            ) : (
              <Dice3D value={6} size={32} />
            )}
          </div>
        )}
      </div>
    );
  };
  const r = C * 0.3;
  const h = C * 0.24;
  const tip = C * 0.38;
  const PIN = `M 0 ${tip} Q ${-r * 0.95} ${-h + r * 0.55} ${-r} ${-h} A ${r} ${r} 0 1 1 ${r} ${-h} Q ${r * 0.95} ${-h + r * 0.55} 0 ${tip} Z`;
  const status = state.winner !== null
    ? `${name(state.winner)} ${state.winner === me ? "win" : "wins"}!`
    : state.roll > 0 && canPlay
      ? movable.length > 1 && ludoChoices(state).length > 1
        ? `Pick a token to move ${state.roll}`
        : `Moving ${state.roll}…`
      : canPlay
        ? state.again
          ? "Roll again!"
          : "Your turn — tap your die to roll"
        : `${name(turn)}'s turn`;

  return (
    <div ref={rootRef} data-game-board="ludo" className="flex flex-col items-center gap-2" style={{ width: side }}>
      <div className="flex w-full gap-3">
        {plate(0)}
        {plate(1)}
      </div>
      {/* LANX 3.12.0: a printed cardboard board in a wooden frame, its colours a little shaded,
          the token spots pressed in, and glossy pins standing on a base. */}
      <svg width={side} height={side} viewBox={`${-FRAME} ${-FRAME} ${SIZE + 2 * FRAME} ${SIZE + 2 * FRAME}`} className="select-none" data-ludo-classic>
        <defs>
          <clipPath id="ludoRound">
            <rect width={SIZE} height={SIZE} rx={6} />
          </clipPath>
          <pattern id="ludo-wood" patternUnits="userSpaceOnUse" width={512} height={256}>
            <image href={woodTexture("walnut")} width={512} height={256} />
          </pattern>
          <pattern id="ludo-paper" patternUnits="userSpaceOnUse" width={256} height={256}>
            <image href={paperTexture()} width={256} height={256} />
          </pattern>
          <radialGradient id="ludo-hole" cx="0.5" cy="0.42" r="0.6">
            <stop offset="0" stopColor="#000" stopOpacity="0.32" />
            <stop offset="0.7" stopColor="#000" stopOpacity="0.12" />
            <stop offset="1" stopColor="#000" stopOpacity="0" />
          </radialGradient>
          {LUDO_COLOURS.map((col, c) => (
            <g key={c}>
              <linearGradient id={`ludo-yard-${c}`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor={shade(col, 0.16)} />
                <stop offset="0.55" stopColor={col} />
                <stop offset="1" stopColor={shade(col, -0.14)} />
              </linearGradient>
              <radialGradient id={`ludo-pin-${c}`} cx="0.36" cy="0.28" r="0.85">
                <stop offset="0" stopColor={shade(col, 0.55)} />
                <stop offset="0.45" stopColor={col} />
                <stop offset="1" stopColor={shade(col, -0.32)} />
              </radialGradient>
            </g>
          ))}
        </defs>
        {/* The frame, and the board's own little shadow inside it. */}
        <rect x={-FRAME} y={-FRAME} width={SIZE + 2 * FRAME} height={SIZE + 2 * FRAME} rx={16} fill="url(#ludo-wood)" />
        <rect x={-FRAME + 1} y={-FRAME + 1} width={SIZE + 2 * FRAME - 2} height={SIZE + 2 * FRAME - 2} rx={15} fill="none" stroke="#fff" strokeOpacity={0.18} strokeWidth={1.5} />
        <rect x={-3} y={-2} width={SIZE + 6} height={SIZE + 6} rx={8} fill="#000" opacity={0.35} />
        <g clipPath="url(#ludoRound)">
          <rect width={SIZE} height={SIZE} fill="#fffaf0" />
          <g transform={`rotate(${k * 90} ${SIZE / 2} ${SIZE / 2})`}>
            {/* yards: a strong coloured corner, a white court, four coloured token spots */}
            {YARD.map(([yr, yc], c) => {
              const active = ludoPlayerAt(c, n) === turn && state.winner === null;
              return (
                <g key={c}>
                  <rect x={yc * C} y={yr * C} width={6 * C} height={6 * C} fill={`url(#ludo-yard-${c})`} />
                  <rect x={yc * C + C * 0.7} y={yr * C + C * 0.7} width={C * 4.6} height={C * 4.6} fill="#fffdf7" rx={C * 0.5} />
                  <rect x={yc * C + C * 0.7 + 1.5} y={yr * C + C * 0.7 + 1.5} width={C * 4.6 - 3} height={C * 4.6 - 3} fill="none" rx={C * 0.45} stroke="#000" strokeOpacity={0.08} strokeWidth={3} />
                  {active && <rect className="ludo-glow" x={yc * C + C * 0.45} y={yr * C + C * 0.45} width={C * 5.1} height={C * 5.1} rx={C * 0.65} fill="none" stroke="#fff" strokeWidth={C * 0.16} />}
                  {SPOT.map(([dr, dc], s) => {
                    const cx = (yc + dc) * C + C / 2;
                    const cy = (yr + dr) * C + C / 2;
                    return (
                      <g key={s}>
                        <circle cx={cx} cy={cy} r={C * 0.62} fill={LUDO_COLOURS[c]} stroke={LUDO_DARK[c]} strokeWidth={1.5} />
                        <circle cx={cx} cy={cy} r={C * 0.6} fill="url(#ludo-hole)" />
                        <path d={`M ${cx - C * 0.42} ${cy + C * 0.36} A ${C * 0.56} ${C * 0.56} 0 0 0 ${cx + C * 0.42} ${cy + C * 0.36}`} fill="none" stroke="#fff" strokeOpacity={0.35} strokeWidth={1.4} />
                      </g>
                    );
                  })}
                </g>
              );
            })}
            {/* the track: cream squares; each start square in its colour with a star; grey stars on the safe squares */}
            {LOOP.map(([rr, cc], i) => {
              const sc = startCorner(i);
              return (
                <g key={i}>
                  <rect data-ludo-square={i} x={cc * C} y={rr * C} width={C} height={C} fill={sc >= 0 ? `url(#ludo-yard-${sc})` : "#fffdf8"} stroke="#d6cbb6" strokeWidth={1} />
                  {SAFE.has(i) && <polygon points={star(cc * C + C / 2, rr * C + C / 2, C * 0.36)} fill={sc >= 0 ? "#fff" : "none"} stroke={sc >= 0 ? "none" : "#a99c86"} strokeWidth={1.6} strokeLinejoin="round" pointerEvents="none" />}
                </g>
              );
            })}
            {/* home lanes in full colour, with an arrow where each colour turns in */}
            {HOME.map((cells, c) => cells.slice(0, 5).map(([rr, cc], j) => <rect key={`${c}-${j}`} x={cc * C} y={rr * C} width={C} height={C} fill={`url(#ludo-yard-${c})`} stroke="#d6cbb6" />))}
            {[0, 1, 2, 3].map((c) => {
              const [er, ec] = LOOP[(startOf(c) + 50) % TRACK];
              const [hr, hc] = HOME[c][0];
              const ang = (Math.atan2(hr - er, hc - ec) * 180) / Math.PI;
              const cx = ec * C + C / 2;
              const cy = er * C + C / 2;
              return <polygon key={c} points={`${cx + C * 0.3},${cy} ${cx - C * 0.18},${cy - C * 0.26} ${cx - C * 0.18},${cy + C * 0.26}`} transform={`rotate(${ang} ${cx} ${cy})`} fill={LUDO_COLOURS[c]} pointerEvents="none" />;
            })}
            {/* the centre: four triangles pointing home */}
            <polygon points={`${6 * C},${6 * C} ${9 * C},${6 * C} ${7.5 * C},${7.5 * C}`} fill={`url(#ludo-yard-1)`} />
            <polygon points={`${9 * C},${6 * C} ${9 * C},${9 * C} ${7.5 * C},${7.5 * C}`} fill={`url(#ludo-yard-2)`} />
            <polygon points={`${9 * C},${9 * C} ${6 * C},${9 * C} ${7.5 * C},${7.5 * C}`} fill={`url(#ludo-yard-3)`} />
            <polygon points={`${6 * C},${9 * C} ${6 * C},${6 * C} ${7.5 * C},${7.5 * C}`} fill={`url(#ludo-yard-0)`} />
            <path d={`M ${6 * C} ${6 * C} L ${9 * C} ${9 * C} M ${9 * C} ${6 * C} L ${6 * C} ${9 * C}`} stroke="#fff" strokeOpacity={0.35} strokeWidth={1.2} />
          </g>
          {/* The print sits on cardboard: its grain over everything printed. */}
          <rect width={SIZE} height={SIZE} fill="url(#ludo-paper)" pointerEvents="none" />
        </g>
        {/* tokens: pins that stand upright whichever way the board is turned */}
        {tokens.map(({ p, t, rel, x, y, lift, can, off }) => {
          const col = colour(p);
          const dark = LUDO_DARK[ludoCorner(p, n)];
          const s = off.s * (1 + lift * 0.12);
          return (
            <g key={`${p}-${t}`} data-ludo-token={`${p}:${t}`} data-ludo-pos={rel} data-ludo-can={can ? "1" : undefined} className={can ? "cursor-pointer" : ""} onClick={() => can && onMove(`m:${t}`)}>
              <g transform={`translate(${(x + off.dx).toFixed(2)} ${(y + off.dy - lift * 8).toFixed(2)}) scale(${s.toFixed(3)})`}>
                <ellipse cx={0} cy={tip + lift * 8} rx={C * 0.28 * (1 - lift * 0.3)} ry={C * 0.09} fill="#0f172a" opacity={0.28 - lift * 0.12} />
                {can && <ellipse className="ludo-glow" cx={0} cy={tip} rx={C * 0.42} ry={C * 0.16} fill="none" stroke={col} strokeWidth={2.5} />}
                <g className={can ? "ludo-bob" : ""}>
                  {/* A round foot the pin stands on, then the glossy pin. */}
                  <ellipse cx={0} cy={tip - 1} rx={r * 0.78} ry={r * 0.3} fill={dark} />
                  <ellipse cx={0} cy={tip - 2.2} rx={r * 0.7} ry={r * 0.24} fill={shade(col, -0.1)} />
                  <path d={PIN} fill={`url(#ludo-pin-${ludoCorner(p, n)})`} stroke={dark} strokeWidth={1.2} strokeLinejoin="round" />
                  <circle cx={0} cy={-h} r={C * 0.15} fill="#fff" />
                  <circle cx={0} cy={-h} r={C * 0.085} fill={col} />
                  <ellipse cx={-r * 0.45} cy={-h - r * 0.45} rx={r * 0.2} ry={r * 0.32} fill="#fff" opacity={0.7} transform={`rotate(-30 ${-r * 0.45} ${-h - r * 0.45})`} />
                  <path d={`M ${r * 0.55} ${-h + r * 0.2} Q ${r * 0.62} ${-h + r * 0.9} ${r * 0.15} ${tip - r * 0.55}`} fill="none" stroke="#fff" strokeOpacity={0.25} strokeWidth={1.2} strokeLinecap="round" />
                </g>
              </g>
            </g>
          );
        })}
      </svg>
      <div className="flex w-full gap-3">
        {plate(3)}
        {plate(2)}
      </div>
      <div className="min-h-[20px] text-center text-[12.5px] font-semibold text-slate-700 dark:text-slate-200" data-ludo-status>
        {status}
        {said && <span className="font-normal text-slate-500" data-ludo-event={state.event || "six"}> · {said}</span>}
        {!state.roll && canPlay && state.again && <span className="sr-only" data-ludo-again>Roll again!</span>}
      </div>
    </div>
  );
}
