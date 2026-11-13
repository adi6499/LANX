// LANX 3.11.2: Snakes & Ladders drawn like a real board — bright squares in a wooden
// frame, wooden ladders with rails and rungs, striped snakes with a head, eyes and a
// tongue, pawns that wait on a start lane, and a die. After each roll the die tumbles,
// then the pawn hops square by square, climbs the ladder or slides down the snake's body.
// The rules and the squares (lib/games/snakes.ts) are unchanged, so every LANX version
// still plays the same game.

import { Dice3D } from "./Dice3D";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { namesIn, seatFor, type BoardProps } from "../boardProps";
import { LADDERS, SNAKES, snakes, type SnakesState } from "../../../lib/games/snakes.ts";
import { sfx } from "../../../lib/gameSounds";
import { paperTexture, woodTexture } from "../../../lib/games/texture";

type Pt = [number, number]; // [x, y] in board units

const C = 60; // one square
const FRAME = 16; // the wooden frame
const LANE = 52; // the start lane under the squares
const W = 10 * C + 2 * FRAME;
const H = 10 * C + FRAME + LANE;
/** Room the board leaves for the bar above it and the line under it. */
const CHROME = 56 + 30 + 2 * 10;

/** Each row its own colour, in two shades, so the way from 1 to 100 is easy to follow. */
const ROWS = [
  { light: "#fff6d6", dark: "#ffe49a", num: "#8a5a00" },
  { light: "#e3fbea", dark: "#b4efc8", num: "#166534" },
  { light: "#e4f4fe", dark: "#b9e2fb", num: "#075985" },
  { light: "#ffe9ec", dark: "#fec9d0", num: "#9f1239" },
  { light: "#f1eaff", dark: "#dacbff", num: "#5b21b6" },
];

const LOOKS = [
  { base: "#2fb457", band: "#f6d33c", line: "#14532d" },
  { base: "#9b5cf0", band: "#f3b6f7", line: "#3b0d74" },
  { base: "#f2792b", band: "#7a2d10", line: "#6b2509" },
  { base: "#14b0c9", band: "#0b5d6d", line: "#0b4552" },
  { base: "#e64545", band: "#fbe36b", line: "#7f1d1d" },
];

/** Square 1..100 → its centre (1 at the bottom left, rows going back and forth). */
function centre(sq: number): Pt {
  const k = Math.max(1, Math.min(100, sq)) - 1;
  const row = Math.floor(k / 10);
  const col = row % 2 === 0 ? k % 10 : 9 - (k % 10);
  return [FRAME + col * C + C / 2, FRAME + (9 - row) * C + C / 2];
}
/** Where pawn p waits before its first roll: on the start lane. */
const startSpot = (p: number): Pt => [FRAME + 96 + p * 30, FRAME + 10 * C + LANE / 2 + 9];
const at = (p: number, sq: number): Pt => (sq <= 0 ? startSpot(p) : centre(sq));
const f1 = (v: number) => v.toFixed(1);
const line = (pts: Pt[]) => "M " + pts.map(([x, y]) => `${f1(x)} ${f1(y)}`).join(" L ");

// ---------------------------------------------------------------- the art (made once)

interface SnakeArt {
  head: number;
  /** The body's centre line, head first. */
  spine: Pt[];
  body: string;
  look: (typeof LOOKS)[number];
  hx: number;
  hy: number;
  angle: number;
  length: number;
}

function makeSnake(head: number, tail: number, i: number): SnakeArt {
  const [x0, y0] = centre(head);
  const [x1, y1] = centre(tail);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const L = Math.hypot(dx, dy);
  const nx = -dy / L;
  const ny = dx / L;
  const halfWaves = Math.max(2, Math.round(L / (C * 1.15)));
  const amp = Math.min(C * 0.36, 9 + L * 0.085) * (i % 2 === 0 ? 1 : -1);
  const N = 96;
  const spine: Pt[] = [];
  for (let k = 0; k <= N; k++) {
    const t = k / N;
    const off = amp * Math.sin(Math.PI * halfWaves * t);
    spine.push([x0 + dx * t + nx * off, y0 + dy * t + ny * off]);
  }
  const w0 = C * 0.3;
  const left: Pt[] = [];
  const right: Pt[] = [];
  let length = 0;
  for (let k = 0; k <= N; k++) {
    const a = spine[Math.max(0, k - 1)];
    const b = spine[Math.min(N, k + 1)];
    const tx = b[0] - a[0];
    const ty = b[1] - a[1];
    const tl = Math.hypot(tx, ty) || 1;
    const half = Math.max(0.7, w0 * Math.pow(1 - k / N, 0.8)) / 2;
    const [px, py] = spine[k];
    left.push([px - (ty / tl) * half, py + (tx / tl) * half]);
    right.push([px + (ty / tl) * half, py - (tx / tl) * half]);
    if (k > 0) length += Math.hypot(spine[k][0] - spine[k - 1][0], spine[k][1] - spine[k - 1][1]);
  }
  const body = `${line(left)} L ${right.reverse().map(([x, y]) => `${f1(x)} ${f1(y)}`).join(" L ")} Z`;
  const angle = (Math.atan2(spine[0][1] - spine[4][1], spine[0][0] - spine[4][0]) * 180) / Math.PI;
  return { head, spine, body, look: LOOKS[i % LOOKS.length], hx: spine[0][0], hy: spine[0][1], angle, length };
}

interface LadderArt {
  foot: number;
  rails: [string, string];
  rungs: string;
}

function makeLadder(foot: number, top: number): LadderArt {
  const [x1, y1] = centre(foot);
  const [x2, y2] = centre(top);
  const L = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / L;
  const uy = (y2 - y1) / L;
  const nx = -uy;
  const ny = ux;
  const half = C * 0.17;
  const ext = C * 0.2;
  const s: Pt = [x1 - ux * ext, y1 - uy * ext];
  const e: Pt = [x2 + ux * ext, y2 + uy * ext];
  const rail = (side: number) => line([[s[0] + nx * half * side, s[1] + ny * half * side], [e[0] + nx * half * side, e[1] + ny * half * side]]);
  const total = L + 2 * ext;
  const count = Math.max(3, Math.round(total / 17));
  let rungs = "";
  for (let k = 1; k < count; k++) {
    const t = (k / count) * total;
    const [cx, cy] = [s[0] + ux * t, s[1] + uy * t];
    rungs += `M ${f1(cx + nx * half)} ${f1(cy + ny * half)} L ${f1(cx - nx * half)} ${f1(cy - ny * half)} `;
  }
  return { foot, rails: [rail(1), rail(-1)], rungs };
}

const SNAKE_ART: SnakeArt[] = Object.entries(SNAKES)
  .map(([a, b], i) => makeSnake(Number(a), b, i))
  .sort((a, b) => b.length - a.length); // long ones first, so short ones lie on top
const SNAKE_AT = new Map(SNAKE_ART.map((s) => [s.head, s]));
const LADDER_ART: LadderArt[] = Object.entries(LADDERS).map(([a, b]) => makeLadder(Number(a), b));

/** The board itself never changes: drawn once. */
const BoardArt = memo(function BoardArt() {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" aria-hidden="true">
      <defs>
        <linearGradient id="snk-wood" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c08546" />
          <stop offset="0.55" stopColor="#9a6331" />
          <stop offset="1" stopColor="#74451c" />
        </linearGradient>
        <linearGradient id="snk-rail" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#e2b072" />
          <stop offset="1" stopColor="#b27a3d" />
        </linearGradient>
        <clipPath id="snk-squares">
          <rect x={FRAME} y={FRAME} width={10 * C} height={10 * C} rx={8} />
        </clipPath>
        {/* LANX 3.12.0: real wood and printed cardboard (pictures painted once; see texture.ts). */}
        <pattern id="snk-wood-grain" patternUnits="userSpaceOnUse" width={512} height={256}>
          <image href={woodTexture("walnut")} width={512} height={256} />
        </pattern>
        <pattern id="snk-maple" patternUnits="userSpaceOnUse" width={512} height={256}>
          <image href={woodTexture("maple")} width={512} height={256} />
        </pattern>
        <pattern id="snk-paper" patternUnits="userSpaceOnUse" width={256} height={256}>
          <image href={paperTexture()} width={256} height={256} />
        </pattern>
        {/* Scales: little overlapping arcs, laid over each snake's body. */}
        <pattern id="snk-scales" patternUnits="userSpaceOnUse" width={7} height={6}>
          <path d="M 0 6 A 3.5 3.5 0 0 1 7 6" fill="none" stroke="#000" strokeOpacity={0.18} strokeWidth={0.8} />
          <path d="M -3.5 3 A 3.5 3.5 0 0 1 3.5 3 M 3.5 3 A 3.5 3.5 0 0 1 10.5 3" fill="none" stroke="#000" strokeOpacity={0.18} strokeWidth={0.8} />
        </pattern>
      </defs>
      {/* Frame, and the start lane. */}
      <rect x={0} y={0} width={W} height={H} rx={20} fill="url(#snk-wood-grain)" />
      <rect x={0} y={0} width={W} height={H} rx={20} fill="url(#snk-wood)" opacity={0.35} />
      <rect x={1} y={1} width={W - 2} height={H - 2} rx={19} fill="none" stroke="#fff" strokeOpacity={0.16} strokeWidth={1.5} />
      <rect x={FRAME - 3} y={FRAME - 3} width={10 * C + 6} height={10 * C + 6} rx={10} fill="#2c1606" opacity={0.5} />
      <rect x={FRAME} y={FRAME + 10 * C + 9} width={10 * C} height={LANE - 18} rx={12} fill="#f7e3bd" />
      <rect x={FRAME} y={FRAME + 10 * C + 9} width={10 * C} height={LANE - 18} rx={12} fill="url(#snk-paper)" />
      <text x={FRAME + 16} y={FRAME + 10 * C + LANE / 2 + 5} fontSize={14} fontWeight={800} letterSpacing={1.5} fill="#7a4a1d">
        START
      </text>
      <path d={`M ${FRAME + 74} ${FRAME + 10 * C + LANE / 2} l -8 -5 v 10 z`} fill="#7a4a1d" />

      {/* Squares. */}
      <g clipPath="url(#snk-squares)">
        {Array.from({ length: 100 }, (_, k) => {
          const sq = k + 1;
          const row = Math.floor(k / 10);
          const col = row % 2 === 0 ? k % 10 : 9 - (k % 10);
          const x = FRAME + col * C;
          const y = FRAME + (9 - row) * C;
          const look = ROWS[row % ROWS.length];
          return (
            <g key={sq}>
              <rect data-snakes-square={sq} x={x} y={y} width={C} height={C} fill={(row + col) % 2 === 0 ? look.dark : look.light} stroke="rgba(110,70,20,0.12)" />
              <text x={x + 6} y={y + 16} fontSize={13.5} fontWeight={800} fill={look.num} opacity={0.78}>
                {sq}
              </text>
            </g>
          );
        })}
        {/* The print sits on cardboard. */}
        <rect x={FRAME} y={FRAME} width={10 * C} height={10 * C} fill="url(#snk-paper)" />
      </g>

      {/* Ladders: shadow, rungs, rails. */}
      {LADDER_ART.map((l) => (
        <g key={`ls${l.foot}`} transform="translate(3 4)" opacity={0.22}>
          <path d={l.rungs} stroke="#000" strokeWidth={4} strokeLinecap="round" />
          <path d={l.rails[0]} stroke="#000" strokeWidth={7} strokeLinecap="round" />
          <path d={l.rails[1]} stroke="#000" strokeWidth={7} strokeLinecap="round" />
        </g>
      ))}
      {LADDER_ART.map((l) => (
        <g key={`l${l.foot}`} data-snakes-ladder={l.foot}>
          <path d={l.rungs} stroke="#7a4a1d" strokeWidth={4.6} strokeLinecap="round" />
          <path d={l.rungs} stroke="#c8925a" strokeWidth={2.4} strokeLinecap="round" />
          {l.rails.map((r, i) => (
            <g key={i}>
              <path d={r} stroke="#5e3713" strokeWidth={7.5} strokeLinecap="round" />
              <path d={r} stroke="url(#snk-maple)" strokeWidth={4.6} strokeLinecap="round" />
              <path d={r} stroke="url(#snk-rail)" strokeOpacity={0.45} strokeWidth={4.6} strokeLinecap="round" />
              <path d={r} transform="translate(-0.8 -0.8)" stroke="#fff" strokeOpacity={0.25} strokeWidth={1} strokeLinecap="round" />
            </g>
          ))}
        </g>
      ))}

      {/* The finish: a trophy in square 100's corner, clear of the ladder that reaches it. */}
      <text x={FRAME + C - 15} y={FRAME + C - 9} fontSize={19} textAnchor="middle">
        🏆
      </text>

      {/* Snakes: shadow, striped body, head. */}
      {SNAKE_ART.map((s) => (
        <path key={`ss${s.head}`} d={s.body} transform="translate(3 4)" fill="#000" opacity={0.2} />
      ))}
      {SNAKE_ART.map((s) => (
        <g key={`s${s.head}`} data-snakes-snake={s.head}>
          <clipPath id={`snk-body-${s.head}`}>
            <path d={s.body} />
          </clipPath>
          <path d={s.body} fill={s.look.base} />
          <g clipPath={`url(#snk-body-${s.head})`}>
            <path d={line(s.spine)} stroke={s.look.band} strokeWidth={C * 0.42} strokeDasharray="6 9" fill="none" />
            {/* A round body: its far side in shade, its scales, a shine along the near side. */}
            <path d={line(s.spine)} transform="translate(2.4 2.4)" stroke="#000" strokeOpacity={0.22} strokeWidth={C * 0.16} strokeLinecap="round" fill="none" />
            <path d={s.body} fill="url(#snk-scales)" />
            <path d={line(s.spine)} transform="translate(-1.6 -1.6)" stroke="#fff" strokeOpacity={0.38} strokeWidth={C * 0.07} strokeLinecap="round" fill="none" />
          </g>
          <path d={s.body} fill="none" stroke={s.look.line} strokeWidth={1.4} strokeLinejoin="round" />
          <g transform={`translate(${f1(s.hx)} ${f1(s.hy)}) rotate(${f1(s.angle)})`}>
            <path d={`M ${C * 0.22} 0 L ${C * 0.36} 0 M ${C * 0.33} 0 l 5 -3.5 M ${C * 0.33} 0 l 5 3.5`} stroke="#e11d48" strokeWidth={1.8} strokeLinecap="round" fill="none" />
            <ellipse cx={0} cy={0} rx={C * 0.25} ry={C * 0.19} fill={s.look.base} stroke={s.look.line} strokeWidth={1.4} />
            <ellipse cx={-C * 0.06} cy={0} rx={C * 0.11} ry={C * 0.07} fill={s.look.band} opacity={0.85} />
            {[-1, 1].map((side) => (
              <g key={side}>
                <circle cx={C * 0.07} cy={side * C * 0.1} r={C * 0.065} fill="#fff" stroke={s.look.line} strokeWidth={0.8} />
                <circle cx={C * 0.085} cy={side * C * 0.1} r={C * 0.037} fill="#111" />
                <circle cx={C * 0.075} cy={side * C * 0.1 - 1.2} r={1} fill="#fff" />
                <circle cx={C * 0.2} cy={side * C * 0.045} r={1} fill={s.look.line} />
              </g>
            ))}
          </g>
        </g>
      ))}
    </svg>
  );
});

// ---------------------------------------------------------------- pawns

/** A colour made lighter (amt > 0, towards white) or darker (amt < 0, towards black). */
function shade(hex: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  const ch = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt)));
  return `#${ch.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** A pawn standing at (x, y): `lift` 0..1 above the board while it hops. */
function Pawn({ p, x, y, s, lift, colour, mark }: { p: number; x: number; y: number; s: number; lift: number; colour: string; mark: boolean }) {
  const up = lift * 16;
  return (
    <g data-snakes-token={p} transform={`translate(${f1(x)} ${f1(y + C * 0.2)}) scale(${s})`}>
      <ellipse cx={0} cy={0} rx={11 - lift * 3} ry={4 - lift} fill="#000" opacity={0.28 - lift * 0.12} />
      <g transform={`translate(0 ${f1(-up)})`}>
        <ellipse cx={0} cy={-1} rx={11} ry={4.6} fill={shade(colour, -0.35)} />
        <path d="M -10 -2 C -10 -7 -5 -9 -4 -17 L 4 -17 C 5 -9 10 -7 10 -2 Z" fill={`url(#snk-pawn-${p})`} stroke={shade(colour, -0.45)} strokeWidth={0.9} />
        <ellipse cx={0} cy={-17} rx={6.5} ry={2.3} fill={shade(colour, -0.2)} />
        <circle cx={0} cy={-24} r={7.2} fill={`url(#snk-pawn-${p})`} stroke={shade(colour, -0.45)} strokeWidth={0.9} />
        <ellipse cx={-2.6} cy={-26.6} rx={2.4} ry={1.6} fill="#fff" opacity={0.6} />
        {mark && (
          <g className="snk-bob">
            <path d="M -5.5 -41 L 5.5 -41 L 0 -34 Z" fill={colour} stroke="#fff" strokeWidth={1.2} strokeLinejoin="round" />
          </g>
        )}
      </g>
    </g>
  );
}

// ---------------------------------------------------------------- motion

const DIE_MS = 650; // the die tumbles before the pawn sets off
const STEP_MS = 185; // one square
const PAUSE_MS = 140; // on the ladder's foot or the snake's head, before going
const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
const reducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("lanx-still");
  } catch {
    return false;
  }
};

interface Motion {
  p: number;
  roll: number;
  hops: Pt[];
  slide: Pt[] | null;
  kind: "ladder" | "snake" | null;
  slideMs: number;
  t0: number;
}
const total = (m: Motion) => DIE_MS + (m.hops.length - 1) * STEP_MS + (m.slide ? PAUSE_MS + m.slideMs : 0);

function useSnakesMotion(state: SnakesState | null, moves: string[]) {
  const prev = useRef({ moves, state });
  const [motion, setMotion] = useState<Motion | null>(null);
  const [, setFrame] = useState(0);
  useLayoutEffect(() => {
    const before = prev.current;
    if (before.moves === moves) return;
    prev.current = { moves, state };
    const one = moves.length === before.moves.length + 1 && before.moves.every((x, i) => moves[i] === x);
    if (!state || !before.state || !one || moves[moves.length - 1] !== "r") {
      setMotion(null);
      return;
    }
    sfx("dice", 0.55);
    const p = state.lastBy;
    const from = before.state.pos[p] ?? 0;
    const via = state.via;
    const to = state.pos[p] ?? 0;
    if (reducedMotion() || (via === from && to === from)) {
      setMotion(null);
      return;
    }
    const hops: Pt[] = [at(p, from)];
    for (let sq = from + 1; sq <= via; sq++) hops.push(centre(sq));
    let slide: Pt[] | null = null;
    let kind: Motion["kind"] = null;
    let slideMs = 0;
    if (to > via) {
      slide = [centre(via), centre(to)];
      kind = "ladder";
      slideMs = Math.min(1300, 600 + Math.hypot(slide[1][0] - slide[0][0], slide[1][1] - slide[0][1]) * 1.4);
    } else if (to < via) {
      const art = SNAKE_AT.get(via);
      slide = art ? art.spine : [centre(via), centre(to)];
      kind = "snake";
      slideMs = Math.min(1600, 750 + (art?.length ?? 200) * 1.2);
    }
    setMotion({ p, roll: state.lastRoll, hops, slide, kind, slideMs, t0: performance.now() });
  }, [moves, state]);
  useEffect(() => {
    if (!motion) return;
    let raf = 0;
    let landed = 0;
    let slid = false;
    const end = total(motion);
    const tick = () => {
      const el = performance.now() - motion.t0;
      const hop = Math.floor((el - DIE_MS) / STEP_MS);
      if (hop > landed && hop <= motion.hops.length - 1) {
        landed = hop;
        sfx("place", 0.22);
      }
      if (!slid && motion.slide && el >= DIE_MS + (motion.hops.length - 1) * STEP_MS + PAUSE_MS) {
        slid = true;
        sfx(motion.kind === "ladder" ? "whoosh" : "capture", 0.6);
      }
      if (el >= end) {
        if (motion.slide) sfx("place", 0.3);
        setMotion(null);
        return;
      }
      setFrame((f) => f + 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [motion]);
  /** Where the moving pawn is now (or null: it stands on its square). */
  const where = (p: number): { x: number; y: number; lift: number } | null => {
    if (!motion || motion.p !== p) return null;
    const el = performance.now() - motion.t0;
    const steps = motion.hops.length - 1;
    const e = el - DIE_MS;
    if (e <= 0) return { x: motion.hops[0][0], y: motion.hops[0][1], lift: 0 };
    if (e < steps * STEP_MS) {
      const f = e / STEP_MS;
      const i = Math.min(steps - 1, Math.floor(f));
      const u = f - i;
      const [a, b] = [motion.hops[i], motion.hops[i + 1]];
      const k = ease(u);
      return { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k, lift: Math.sin(Math.PI * u) };
    }
    const last = motion.hops[steps];
    if (!motion.slide) return { x: last[0], y: last[1], lift: 0 };
    const s = e - steps * STEP_MS - PAUSE_MS;
    if (s <= 0) return { x: last[0], y: last[1], lift: 0 };
    const u = Math.min(1, s / motion.slideMs);
    if (motion.kind === "ladder") {
      const [a, b] = motion.slide;
      const k = ease(u);
      return { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k, lift: 0.35 + Math.abs(Math.sin(u * Math.PI * 6)) * 0.15 };
    }
    // Down the snake: slow at the head, faster and faster towards the tail.
    const pts = motion.slide;
    const f = u * u * (pts.length - 1);
    const i = Math.min(pts.length - 2, Math.floor(f));
    const v = f - i;
    return { x: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * v, y: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * v, lift: 0.25 };
  };
  return { motion, where };
}

// ---------------------------------------------------------------- fitting the room

function useFitScale(ref: RefObject<HTMLDivElement | null>): number {
  const [scale, setScale] = useState(0.7);
  useLayoutEffect(() => {
    let el = ref.current?.parentElement ?? null;
    while (el && getComputedStyle(el).display === "contents") el = el.parentElement;
    if (!el) return;
    const box = el;
    const fit = () => {
      const cs = getComputedStyle(box);
      const pw = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const ph = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const byW = (box.clientWidth - pw - 8) / W;
      const byH = (box.clientHeight - ph - CHROME) / H;
      setScale(Math.max(0.46, Math.min(1.7, byW, byH)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, [ref]);
  return scale;
}

// ---------------------------------------------------------------- the board

/** Snakes & Ladders: press Roll; the match rolls for you. */
export function SnakesBoard({ moves, canPlay, turn, seat, seats, starter = 0, seed = "", local, onMove }: BoardProps) {
  const n = Math.max(2, seats?.length ?? 2);
  const state = useMemo(() => snakes.replay(moves, n, seed), [moves, n, seed]);
  const rolls = useMemo(() => moves.filter((x) => x === "r").length, [moves]);
  const { motion, where } = useSnakesMotion(state, moves);
  const rootRef = useRef<HTMLDivElement>(null);
  const scale = useFitScale(rootRef);
  if (!state) return null;
  const me = local ? -1 : seat;
  const colour = (p: number) => seatFor(seats, starter, p, n).color;
  const name = (p: number) => (p === me ? "You" : seatFor(seats, starter, p, n).name.split(" (")[0]);
  const players = Array.from({ length: n }, (_, p) => p);
  const over = state.winner !== null;
  const canRoll = canPlay && !over && !motion;

  // Pawns: the moving one where its motion has it; the others on their squares, side by side when they share one.
  const resting = players.filter((p) => !state.out[p] && (!motion || motion.p !== p));
  const bySquare = new Map<number, number[]>();
  for (const p of resting) if (state.pos[p] > 0) bySquare.set(state.pos[p], [...(bySquare.get(state.pos[p]) ?? []), p]);
  const OFFS: Record<number, Pt[]> = {
    2: [[-11, 0], [11, 0]],
    3: [[-12, -7], [12, -7], [0, 9]],
    4: [[-12, -8], [12, -8], [-12, 9], [12, 9]],
  };
  const pawns = players
    .filter((p) => !state.out[p])
    .map((p) => {
      const moving = where(p);
      if (moving) return { p, x: moving.x, y: moving.y, s: 1.05, lift: moving.lift, moving: true };
      const sq = state.pos[p];
      const [x, y] = at(p, sq);
      const group = sq > 0 ? bySquare.get(sq) ?? [p] : [p];
      if (group.length < 2) return { p, x, y, s: sq > 0 ? 1 : 0.86, lift: 0, moving: false };
      const j = group.indexOf(p);
      const offs = OFFS[group.length];
      const [dx, dy] = offs ? offs[j] : [((j % 3) - 1) * 13, (Math.floor(j / 3) - 1) * 12];
      return { p, x: x + dx, y: y + dy, s: group.length === 2 ? 0.82 : group.length <= 4 ? 0.7 : 0.58, lift: 0, moving: false };
    })
    .sort((a, b) => Number(a.moving) - Number(b.moving) || a.y - b.y);

  const event = motion
    ? `${name(motion.p)} rolled ${motion.roll}…`
    : state.event
      ? namesIn(state.event, seats, starter, n)
      : "Roll to start. Exactly 100 wins; a six rolls again.";
  const icon = motion ? "🎲" : /ladder/.test(state.event) ? "🪜" : /snake/.test(state.event) ? "🐍" : /100!/.test(state.event) ? "🏆" : /six/.test(state.event) ? "🎲" : "";
  const side = W * scale;

  return (
    <div ref={rootRef} data-game-board="snakes" className="flex flex-col items-center gap-2.5">
      <div className="flex items-center justify-between gap-3" style={{ width: side }}>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5" data-snakes-positions>
          {players.map((p) => {
            const active = p === turn && !over && !state.out[p];
            return (
              <span
                key={p}
                data-snakes-player={p}
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] ${active ? "bg-white font-bold text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white" : "bg-white/50 text-slate-600 dark:bg-slate-800/40 dark:text-slate-300"} ${state.out[p] ? "line-through opacity-50" : ""}`}
                style={active ? { boxShadow: `0 0 0 2px ${colour(p)}` } : undefined}
              >
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: colour(p), boxShadow: `inset 0 -2px 0 ${shade(colour(p), -0.35)}` }} />
                {name(p)}: {state.out[p] ? "left" : state.pos[p] || "start"}
              </span>
            );
          })}
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <span data-snakes-last={state.lastBy >= 0 ? "" : undefined} className="inline-flex items-center rounded-xl p-1" style={{ backgroundColor: state.lastBy >= 0 ? `${colour(state.lastBy)}22` : "rgba(100,116,139,0.1)" }} title={state.lastBy >= 0 ? `${name(state.lastBy)} rolled ${state.lastRoll}` : undefined}>
            <Dice3D value={state.lastRoll || 6} size={40} rollKey={rolls} />
          </span>
          {!over && (
            <button
              type="button"
              data-snakes-roll
              disabled={!canRoll}
              onClick={() => canRoll && onMove("r")}
              className="snk-roll inline-flex items-center rounded-full bg-indigo-600 px-6 py-2.5 text-[14px] font-bold text-white hover:bg-indigo-700 active:scale-95 disabled:bg-slate-400/60 disabled:text-white/90 dark:disabled:bg-slate-600/60"
            >
              {canPlay ? "Roll" : `${name(turn)}'s turn`}
            </button>
          )}
        </div>
      </div>

      <div className="relative select-none" style={{ width: side, height: H * scale }}>
        <div className="absolute inset-0 rounded-[18px] shadow-xl" />
        <BoardArt />
        <svg viewBox={`0 0 ${W} ${H}`} className="pointer-events-none absolute inset-0 h-full w-full" role="img" aria-label="Snakes and Ladders board">
          <defs>
            {players.map((p) => (
              <radialGradient key={p} id={`snk-pawn-${p}`} cx="0.35" cy="0.3" r="0.8">
                <stop offset="0" stopColor={shade(colour(p), 0.55)} />
                <stop offset="0.5" stopColor={colour(p)} />
                <stop offset="1" stopColor={shade(colour(p), -0.3)} />
              </radialGradient>
            ))}
          </defs>
          {pawns.map((t) => (
            <Pawn key={t.p} p={t.p} x={t.x} y={t.y} s={t.s} lift={t.lift} colour={colour(t.p)} mark={!motion && !over && t.p === turn} />
          ))}
        </svg>
      </div>

      <div className="flex min-h-[22px] items-center gap-1.5 text-[13px] font-medium text-slate-700 dark:text-slate-200" data-snakes-event>
        {icon && <span aria-hidden="true">{icon}</span>}
        <span>{event}</span>
      </div>
    </div>
  );
}
