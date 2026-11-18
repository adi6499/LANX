import { DIE_SHOW, Dice3D, DieFaces } from "./Dice3D";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { seatFor, type BoardProps } from "../boardProps";
import { ARM, ludo, ludoArms, ludoChoices, ludoCorner, ludoEventText, ludoFinish, ludoLast, ludoMovable, ludoPlayerAt, ludoSafe, toAbsolute, type LudoState } from "../../../lib/games/ludo.ts";
import { HEX_CORNER, HEX_EDGE, HEX_HOME, HEX_LOOP, HEX_YARD_R, hexCorners, hexField, hexOutline, hexPlace, hexSpot, hexYard, hexYardGround, yardAngle } from "../../../lib/games/ludoHex.ts";
import { sfx } from "../../../lib/gameSounds";
import { paperTexture, woodTexture } from "../../../lib/games/texture";

const C = 30; // cell size
const SIZE = 15 * C;
/** LANX 3.12.0: the wooden frame round the printed board. */
const FRAME = 14;
/** LANX 3.19.0: the six-sided board for five and six players (lib/games/ludoHex.ts). Its squares
 *  are as big as the four-sided board's; its box is a little wider and a good deal taller. */
const HEX_ROUND = 1.5; // how far its corners are rounded, in squares
const HEX_W = Math.round(2 * HEX_EDGE * C);
const HEX_H = Math.round(2 * (HEX_CORNER - 0.1547 * HEX_ROUND) * C);
/** A place on the six-sided board (in squares from its middle) → pixels, as [y, x]. */
const hexPx = (p: { x: number; y: number }): Pt => [HEX_H / 2 + p.y * C, HEX_W / 2 + p.x * C];
/** The same for a list of corners, as an SVG "points" text. */
const hexPts = (pts: [number, number][]) => pts.map(([x, y]) => `${(HEX_W / 2 + x * C).toFixed(1)},${(HEX_H / 2 + y * C).toFixed(1)}`).join(" ");
/** A six-sided outline with rounded corners (an SVG path), `grow` pixels bigger all round. */
function hexFrame(grow: number): string {
  const R = HEX_CORNER * C + grow / Math.cos(Math.PI / 6);
  const cut = (HEX_ROUND * C + grow) / Math.tan(Math.PI / 3);
  const pts = hexOutline(1).map(([x, y]): [number, number] => [HEX_W / 2 + x * R, HEX_H / 2 + y * R]);
  let d = "";
  pts.forEach((p, i) => {
    const a = pts[(i + pts.length - 1) % pts.length];
    const b = pts[(i + 1) % pts.length];
    const towards = (q: [number, number]) => {
      const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
      return `${(p[0] + ((q[0] - p[0]) / l) * cut).toFixed(1)} ${(p[1] + ((q[1] - p[1]) / l) * cut).toFixed(1)}`;
    };
    d += `${i ? "L" : "M"} ${towards(a)} Q ${p[0].toFixed(1)} ${p[1].toFixed(1)} ${towards(b)} `;
  });
  return `${d}Z`;
}

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
/** LANX 3.19.0: the six colours of the six-sided board, in an order in which no two neighbours
 *  look alike (red, yellow, blue, orange, green, purple). */
export const LUDO_COLOURS_6 = ["#e53935", "#f9b800", "#1e88e5", "#f4721e", "#2e9e44", "#8e44c8"];
export const LUDO_DARK_6 = ["#a91f1c", "#b07f00", "#1259a8", "#b04c0c", "#1d6b2d", "#5f2a8c"];
/** The colours of the board that `n` players play on, one per corner. */
export const ludoPalette = (n: number) => (ludoArms(n) === 6 ? LUDO_COLOURS_6 : LUDO_COLOURS);
const ludoDarks = (n: number) => (ludoArms(n) === 6 ? LUDO_DARK_6 : LUDO_DARK);
/** A player's colour: the colour of the corner they sit at. */
export const ludoColour = (player: number, n: number) => ludoPalette(n)[ludoCorner(player, n)];

/** Each corner's colour and who plays it (-1: nobody). Every corner keeps its full colour, as on a real board. */
export function cornerColours(n: number): { colour: string; player: number }[] {
  return ludoPalette(n).map((colour, c) => ({ colour, player: ludoPlayerAt(c, n) }));
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

// ---------------------------------------------------------------- one thing at a time (3.16.0)

/** The throw of the die, and how long its number then stays before anything follows. */
export const ROLL_MS = 950;
export const HOLD_MS = 1000;
/** A breath after a token has landed. */
const AFTER_MOVE_MS = 220;

/** How long a step is on show before the next may follow. */
function stepMs(moves: string[], i: number, n: number, seed: string, still: boolean): number {
  const m = moves[i] ?? "";
  if (m === "r") return (still ? 0 : ROLL_MS) + HOLD_MS;
  if (!m.startsWith("m:")) return 0;
  if (still) return AFTER_MOVE_MS;
  const before = ludo.replay(moves.slice(0, i), n, seed);
  const after = ludo.replay(moves.slice(0, i + 1), n, seed);
  if (!before || !after) return 0;
  const p = before.turn;
  const t = Number(m.slice(2));
  const from = before.pos[p]?.[t] ?? -1;
  const to = after.pos[p]?.[t] ?? from;
  const hops = from === -1 ? 1 : Math.max(0, to - from);
  const knocked = after.pos.some((list, q) => q !== p && list.some((rel, k) => rel === -1 && (before.pos[q]?.[k] ?? -1) >= 0));
  return hops * STEP_MS + (knocked ? HOME_MS : 0) + AFTER_MOVE_MS;
}

/** LANX 3.16.0: the board shows one thing at a time, each to its end. A roll is thrown, comes to
 *  rest and stays for a moment; only then the token moves, the turn passes or the next roll comes.
 *  (Everything used to be drawn the moment it arrived. A roll with no move passed the turn at
 *  once, and the die with its number was gone before anyone could read it; a colleague's roll and
 *  move, arriving together, showed only the end.) What is shown is the first `count` moves; the
 *  game itself is never held back, only its picture.
 *  `phase`: the newest step on show is a roll that is being thrown, or lies there to be read. */
export function useLudoPlayback(moves: string[], n: number, seed: string) {
  const [shown, setShown] = useState(moves.length);
  const [, redraw] = useState(0);
  const began = useRef(0); // when the step now on show began (0: it was there already)
  const last = useRef(moves);
  const still = reducedMotion();
  // Still the same game? (A new round, or a list put right by the other PC, is shown as it is.)
  const same = shown <= moves.length && last.current.slice(0, shown).every((x, i) => moves[i] === x);
  let count = same ? shown : moves.length;
  // Far behind (back after a break in the line): only the last few steps are played out.
  if (moves.length - count > 8) count = moves.length - 3;
  useEffect(() => {
    last.current = moves;
    if (count !== shown) {
      began.current = 0;
      setShown(count);
    }
  });
  useEffect(() => {
    if (count >= moves.length) return;
    const left = began.current ? began.current + stepMs(moves, count - 1, n, seed, still) - performance.now() : 0;
    const t = window.setTimeout(() => {
      began.current = performance.now();
      setShown(count + 1);
    }, Math.max(0, left));
    return () => window.clearTimeout(t);
  }, [count, moves, n, seed, still]);
  const newest = moves[count - 1];
  const throwMs = still ? 0 : ROLL_MS;
  const since = began.current ? performance.now() - began.current : Infinity;
  const phase: "throw" | "hold" | null = newest === "r" && since < throwMs + HOLD_MS ? (since < throwMs ? "throw" : "hold") : null;
  // Draw again when the die has come to rest, and when its number has been seen.
  useEffect(() => {
    if (newest !== "r" || !began.current) return;
    const now = performance.now();
    const timers = [throwMs, throwMs + HOLD_MS]
      .map((ms) => began.current + ms - now)
      .filter((ms) => ms > 0)
      .map((ms) => window.setTimeout(() => redraw((x) => x + 1), ms + 20));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [count, newest, throwMs]);
  return { count, live: count >= moves.length, phase, still };
}

/** Where a throw starts, by the thrower's corner of the screen (0 top left, clockwise): x, y as shares of the board. */
const THROW_FROM: [number, number][] = [[0.14, 0.1], [0.86, 0.1], [0.86, 0.9], [0.14, 0.9]];
/** The same on the six-sided board (0 upper left, top, upper right, lower right, bottom, lower left). */
const THROW_FROM_6: [number, number][] = [[0.14, 0.27], [0.5, 0.08], [0.86, 0.27], [0.86, 0.73], [0.5, 0.92], [0.14, 0.73]];
/** The bounces of a throw: each one's share of the time, and how high it goes (the first is 1). */
const BOUNCES: [number, number][] = [[0.4, 1], [0.26, 0.4], [0.17, 0.16], [0.1, 0.06]];

/** LANX 3.16.0: the die, thrown onto the board from the roller's corner. It flies in, bounces four
 *  times, each bounce lower and shorter, tumbling ever more slowly, and comes to rest near the
 *  middle with its number up, where it stays to be read. Drawn frame by frame (no React in
 *  between); with "less motion" it simply lies there. */
function ThrownDie({ value, start, w, h: tall, nth, still }: { value: number; start: [number, number]; w: number; h: number; nth: number; still: boolean }) {
  const box = useRef<HTMLSpanElement>(null);
  const cube = useRef<HTMLSpanElement>(null);
  const shadow = useRef<HTMLSpanElement>(null);
  const v = Math.max(1, Math.min(6, Math.round(value) || 1));
  const side = Math.min(w, tall);
  const D = Math.round(side * 0.125);
  useLayoutEffect(() => {
    // (never twice the same spot, nor the same way up: a little chance from the number of the roll)
    const chance = (k: number) => ((nth * 9301 + k * 49297 + 233) % 1000) / 1000 - 0.5;
    const end = [0.5 + (start[0] - 0.5) * 0.2 + chance(1) * 0.16, 0.5 + (start[1] - 0.5) * 0.2 + chance(2) * 0.16];
    const [fx, fy] = DIE_SHOW[v];
    const restZ = chance(3) * 50;
    const draw = (u: number) => {
      const e = 1 - (1 - u) ** 3; // fast at first, slower and slower
      const x = (start[0] + (end[0] - start[0]) * e) * w;
      const y = (start[1] + (end[1] - start[1]) * e) * tall;
      let z = 0;
      let done = 0;
      for (const [share, height] of BOUNCES) {
        if (u < done + share) {
          const w = (u - done) / share;
          z = height * 4 * w * (1 - w);
          break;
        }
        done += share;
      }
      const lift = z * side * 0.15;
      if (box.current) box.current.style.transform = `translate(${(x - D / 2).toFixed(1)}px, ${(y - D / 2 - lift).toFixed(1)}px) scale(${(1 + z * 0.22).toFixed(3)})`;
      if (cube.current) cube.current.style.transform = `rotateZ(${(restZ + (1 - e) * 220).toFixed(1)}deg) rotateX(${(fx + (1 - e) * 720).toFixed(1)}deg) rotateY(${(fy + (1 - e) * 1080).toFixed(1)}deg)`;
      if (shadow.current) {
        shadow.current.style.transform = `translate(${(x - D / 2 + lift * 0.3).toFixed(1)}px, ${(y - D / 2 + D * 0.2 + lift * 0.12).toFixed(1)}px) scale(${(1 - z * 0.25).toFixed(3)})`;
        shadow.current.style.opacity = (0.34 - z * 0.2).toFixed(2);
      }
    };
    if (still) {
      draw(1);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const frame = () => {
      const u = Math.min(1, (performance.now() - t0) / ROLL_MS);
      draw(u);
      if (u < 1) raf = requestAnimationFrame(frame);
    };
    frame();
    return () => cancelAnimationFrame(raf);
    // (one throw per die: a new roll is a new die)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <span className="pointer-events-none absolute inset-0" data-ludo-thrown={v} aria-hidden="true">
      <span ref={shadow} className="absolute left-0 top-0 rounded-[30%] bg-black blur-[5px]" style={{ width: D, height: D * 0.82, opacity: 0 }} />
      <span ref={box} className="g3-dice absolute left-0 top-0" style={{ width: D, height: D, ["--h" as string]: `${D / 2}px` }}>
        <span ref={cube} className="g3-dice-cube" style={{ transition: "none" }}>
          <DieFaces />
        </span>
      </span>
    </span>
  );
}

/** A corner's square for a token: its yard spot (-1), the track, its home column, or the centre.
 *  (`n` players: five and six play on the six-sided board.) */
function cellOf(corner: number, rel: number, token: number, n: number): Pt {
  if (ludoArms(n) === 6) return hexPx(hexPlace(corner, rel, token));
  if (rel === -1) {
    const [yr, yc] = YARD[corner];
    const [dr, dc] = SPOT[token];
    return [(yr + dr) * C + C / 2, (yc + dc) * C + C / 2];
  }
  if (rel >= ludoFinish(n)) return [7 * C + C / 2, 7 * C + C / 2];
  if (rel > ludoLast(n)) {
    const [r, c] = HOME[corner][rel - ludoLast(n) - 1];
    return [r * C + C / 2, c * C + C / 2];
  }
  const [r, c] = LOOP[toAbsolute(corner, rel, n)];
  return [r * C + C / 2, c * C + C / 2];
}

/** LANX 2.17.1: the board's size on screen — as big as the room allows (the plates and the status line
 *  always fit), up to twice its natural size. The room is the nearest real ancestor (the games window's
 *  board area, which otherwise scrolls). LANX 3.19.0: `w0` × `h0` is the board's natural box (the
 *  six-sided board is taller than wide); the answer is its width on screen. */
function useFitSide(ref: RefObject<HTMLDivElement | null>, w0 = SIZE, h0 = SIZE, plate = 58): number {
  const CHROME = plate * 2 + 8 * 3 + 40 + 8; // two plate rows, three gaps, a two-line status, a little air
  const [side, setSide] = useState(w0);
  useLayoutEffect(() => {
    let el = ref.current?.parentElement ?? null;
    while (el && getComputedStyle(el).display === "contents") el = el.parentElement;
    if (!el) return;
    const box = el;
    const fit = () => {
      const cs = getComputedStyle(box);
      const pw = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const ph = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      setSide(Math.max(240, Math.min(w0 * 2, box.clientWidth - pw - 8, ((box.clientHeight - ph - CHROME) * w0) / h0)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, [ref, w0, h0, CHROME]);
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
  const cellOfPlayer = (p: number, rel: number, t: number) => cellOf(ludoCorner(p, n), rel, t, n);
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
 *  pin tokens, your colour at the bottom left, a player plate at each corner with the die.
 *  LANX 3.19.0: five and six players play on a six-sided board, your colour at the bottom. */
export function LudoBoard({ moves, canPlay, seat, seats, starter = 0, seed = "", local, onMove }: BoardProps) {
  const n = Math.max(2, Math.min(6, seats?.length ?? 2));
  const arms = ludoArms(n);
  const six = arms === 6;
  const finish = ludoFinish(n);
  const palette = ludoPalette(n);
  const darks = ludoDarks(n);
  /** The printed board's own box (the SVG's inner size), and the same with its frame. */
  const BW = six ? HEX_W : SIZE;
  const BH = six ? HEX_H : SIZE;
  // LANX 3.16.0: what is on show (see useLudoPlayback): the game up to the step being played out.
  const play = useLudoPlayback(moves, n, seed);
  const view = useMemo(() => (play.count >= moves.length ? moves : moves.slice(0, play.count)), [moves, play.count]);
  const state = useMemo(() => ludo.replay(view, n, seed), [view, n, seed]);
  const rolls = useMemo(() => view.filter((x) => x === "r").length, [view]);
  const place = useLudoMotion(state, view, n);
  // You act on the game as it is, and once the die has come to rest.
  const mayPlay = canPlay && play.live && play.phase !== "throw";
  useLudoAutoMove(state, mayPlay, onMove, HOLD_MS);
  const rootRef = useRef<HTMLDivElement>(null);
  const side = useFitSide(rootRef, BW + 2 * FRAME, BH + 2 * FRAME, six ? 48 : 58);
  /** Three plates in a row on a narrow board (the games window at its usual size, a phone): short words, a smaller die. */
  const tight = six && side < 470;
  const tall = Math.round((side * (BH + 2 * FRAME)) / (BW + 2 * FRAME));
  if (!state) return null;
  const me = local ? -1 : Math.max(0, seat);
  const name = (p: number) => (p === me ? "You" : seatFor(seats, starter, p, n).name.split(" (")[0]);
  const colour = (p: number) => ludoColour(p, n);
  const movable = mayPlay && state.roll ? ludoMovable(state) : [];
  // While a roll is thrown and read, the board stays with whoever rolled (the turn may have passed already).
  const turn = play.phase ? state.roller : state.turn;
  const corners = Array.from({ length: arms }, (_, c) => c);
  const startCorner = (i: number) => (i % ARM === 0 ? i / ARM : -1);
  // (While the die flies nothing is said about it; while it lies there the status line says it all.)
  const said = play.phase ? "" : ludoEventText(state, name);
  // Your colour sits at the bottom left (as in Ludo King) — at the bottom on the six-sided board;
  // at one PC the board stays put.
  const mine = six ? 4 : 3;
  const k = me < 0 ? 0 : (mine - ludoCorner(me, n) + arms) % arms;
  const spin = (p: Pt): Pt => {
    let [y, x] = p;
    if (six) {
      const a = (k * Math.PI) / 3;
      const [dx, dy] = [x - HEX_W / 2, y - HEX_H / 2];
      return [HEX_H / 2 + dx * Math.sin(a) + dy * Math.cos(a), HEX_W / 2 + dx * Math.cos(a) - dy * Math.sin(a)];
    }
    for (let i = 0; i < k; i++) [x, y] = [SIZE - y, x];
    return [y, x];
  };
  // Places on screen, clockwise: 0 top left, 1 top right, 2 bottom right, 3 bottom left — on the
  // six-sided board 0 upper left, 1 top, 2 upper right, 3 lower right, 4 bottom, 5 lower left.
  const screenCorner = (c: number) => (c + k) % arms;
  const cornerAt = (s: number) => corners.find((c) => screenCorner(c) === s) ?? 0;

  // Tokens: where each stands on screen; tokens sharing a square stand side by side, smaller.
  const placed = state.pos.flatMap((list, p) =>
    list.map((rel, t) => {
      const at = place(`${p}-${t}`, cellOf(ludoCorner(p, n), rel, t, n));
      const [y, x] = spin([at.y, at.x]);
      return { p, t, rel, x, y, lift: at.lift, moving: at.moving, can: p === state.turn && movable.includes(t) };
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
  // (On the six-sided board the tokens that are in stand side by side on their colour's field, smaller.)
  const tokens = placed.map((tk, i) => ({ ...tk, off: offsetOf.get(i) ?? { dx: 0, dy: 0, s: six && tk.rel >= finish && !tk.moving ? 0.7 : 1 } }));
  // Moving tokens are drawn last, so they pass over the others; then by height, so lower pins overlap higher ones.
  tokens.sort((a, b) => Number(a.moving) - Number(b.moving) || a.y + a.off.dy - (b.y + b.off.dy));

  const home = (p: number) => state.pos[p].filter((x) => x === finish).length;
  const canRoll = canPlay && play.live && !play.phase && !state.roll && state.winner === null;
  const plate = (s: number) => {
    const c = cornerAt(s);
    const p = ludoPlayerAt(c, n);
    if (p < 0) return <div className={`${six ? "h-[48px]" : "h-[58px]"} min-w-0 flex-1`} />;
    const active = p === turn && state.winner === null;
    const out = state.out[p];
    // (the plates on the right-hand side are mirrored, so the die is always on the board's side)
    const mirrored = six ? s === 2 || s === 3 : s % 3 !== 0;
    return (
      <div
        className={`flex ${six ? "h-[48px]" : "h-[58px]"} min-w-0 flex-1 items-center rounded-2xl transition-shadow ${six ? (tight ? "gap-1.5 px-1.5" : "gap-2 px-2") : "gap-2.5 px-3"} ${mirrored ? "flex-row-reverse text-right" : ""} ${active ? "bg-white shadow-md dark:bg-slate-800" : "bg-white/60 dark:bg-slate-800/50"}`}
        style={active ? { boxShadow: `0 0 0 2.5px ${palette[c]}` } : undefined}
        data-ludo-plate={p}
        data-ludo-active={active ? "1" : undefined}
      >
        {/* (Three plates in a row on a narrow board — a phone: the plate with the die drops its
            round initial, so that the name still fits. Its coloured ring says whose it is.) */}
        {!(tight && active) && (
          <span className={`flex shrink-0 items-center justify-center rounded-full font-bold text-white ${six ? "h-8 w-8 text-[13px]" : "h-9 w-9 text-[14px]"}`} style={{ backgroundColor: palette[c], opacity: out ? 0.4 : 1 }}>
            {seatFor(seats, starter, p, n).name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className={`truncate text-[13px] font-semibold text-slate-900 dark:text-white ${out ? "line-through opacity-50" : ""}`}>{name(p)}</div>
          <div className="truncate text-[11px] text-slate-500">{out ? (tight ? "left" : "left the game") : tight ? `${home(p)}/4` : `${home(p)}/4 home`}</div>
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
            style={{ backgroundColor: `${palette[c]}22`, boxShadow: canRoll ? `0 0 0 2px ${palette[c]}` : undefined }}
          >
            {state.lastRoll > 0 && state.roller === p ? (
              <span data-ludo-last>
                <Dice3D value={state.lastRoll} size={tight ? 26 : 32} rollKey={rolls} />
              </span>
            ) : (
              // (not rolled yet: a little paler, so that it is not read as a six that was thrown)
              <span className={canRoll ? "" : "opacity-60"}>
                <Dice3D value={6} size={tight ? 26 : 32} />
              </span>
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
  const pickOne = mayPlay && state.roll > 0 && movable.length > 1 && ludoChoices(state).length > 1;
  const turnOf = turn === me ? "Your turn" : `${name(turn)}'s turn`;
  const status = state.winner !== null
    ? `${name(state.winner)} ${state.winner === me ? "win" : "wins"}!`
    : play.phase === "throw"
      ? state.roller === me
        ? "Rolling…"
        : `${name(state.roller)} is rolling…`
      : play.phase === "hold"
        ? `${name(state.roller)} rolled a ${state.lastRoll}${state.event === "no move" ? " — no token can move" : state.event === "sixes" ? " — three sixes in a row, the turn is over" : pickOne ? " — pick a token to move" : ""}`
        : !play.live
          ? turnOf
          : state.roll > 0 && canPlay
            ? pickOne
              ? `Pick a token to move ${state.roll}`
              : `Moving ${state.roll}…`
            : canPlay
              ? state.again
                ? "Roll again!"
                : "Your turn — tap your die to roll"
              : turnOf;

  /** The four-sided board's print (2 to 4 players), unturned. */
  const squarePrint = () => (
    <>
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
                  <circle cx={cx} cy={cy} r={C * 0.62} fill={palette[c]} stroke={darks[c]} strokeWidth={1.5} />
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
            {ludoSafe(i) && <polygon points={star(cc * C + C / 2, rr * C + C / 2, C * 0.36)} fill={sc >= 0 ? "#fff" : "none"} stroke={sc >= 0 ? "none" : "#a99c86"} strokeWidth={1.6} strokeLinejoin="round" pointerEvents="none" />}
          </g>
        );
      })}
      {/* home lanes in full colour, with an arrow where each colour turns in */}
      {HOME.map((cells, c) => cells.slice(0, 5).map(([rr, cc], j) => <rect key={`${c}-${j}`} x={cc * C} y={rr * C} width={C} height={C} fill={`url(#ludo-yard-${c})`} stroke="#d6cbb6" />))}
      {[0, 1, 2, 3].map((c) => {
        const [er, ec] = LOOP[toAbsolute(c, ludoLast(n), n)];
        const [hr, hc] = HOME[c][0];
        const ang = (Math.atan2(hr - er, hc - ec) * 180) / Math.PI;
        const cx = ec * C + C / 2;
        const cy = er * C + C / 2;
        return <polygon key={c} points={`${cx + C * 0.3},${cy} ${cx - C * 0.18},${cy - C * 0.26} ${cx - C * 0.18},${cy + C * 0.26}`} transform={`rotate(${ang} ${cx} ${cy})`} fill={palette[c]} pointerEvents="none" />;
      })}
      {/* the centre: four triangles pointing home */}
      <polygon points={`${6 * C},${6 * C} ${9 * C},${6 * C} ${7.5 * C},${7.5 * C}`} fill={`url(#ludo-yard-1)`} />
      <polygon points={`${9 * C},${6 * C} ${9 * C},${9 * C} ${7.5 * C},${7.5 * C}`} fill={`url(#ludo-yard-2)`} />
      <polygon points={`${9 * C},${9 * C} ${6 * C},${9 * C} ${7.5 * C},${7.5 * C}`} fill={`url(#ludo-yard-3)`} />
      <polygon points={`${6 * C},${9 * C} ${6 * C},${6 * C} ${7.5 * C},${7.5 * C}`} fill={`url(#ludo-yard-0)`} />
      <path d={`M ${6 * C} ${6 * C} L ${9 * C} ${9 * C} M ${9 * C} ${6 * C} L ${6 * C} ${9 * C}`} stroke="#fff" strokeOpacity={0.35} strokeWidth={1.2} />
    </>
  );

  /** LANX 3.19.0: the six-sided board's print (five and six players), unturned: six yards between
   *  six arms, the same squares, stars and home lanes as on the four-sided board. */
  const hexPrint = () => (
    <>
      {/* yards: each colour's ground between two arms, a round white court, four coloured token spots */}
      {corners.map((c) => {
        const active = ludoPlayerAt(c, n) === turn && state.winner === null;
        const [cy, cx] = hexPx(hexYard(c));
        return (
          <g key={c} data-ludo-yard={c}>
            <polygon points={hexPts(hexYardGround(c))} fill={`url(#ludo-yard-${c})`} />
            <circle cx={cx} cy={cy} r={HEX_YARD_R * C} fill="#fffdf7" />
            <circle cx={cx} cy={cy} r={HEX_YARD_R * C - 1.5} fill="none" stroke="#000" strokeOpacity={0.08} strokeWidth={3} />
            {active && <circle className="ludo-glow" cx={cx} cy={cy} r={HEX_YARD_R * C + C * 0.2} fill="none" stroke="#fff" strokeWidth={C * 0.16} />}
            {[0, 1, 2, 3].map((s) => {
              const [sy, sx] = hexPx(hexSpot(c, s));
              return (
                <g key={s}>
                  <circle cx={sx} cy={sy} r={C * 0.62} fill={palette[c]} stroke={darks[c]} strokeWidth={1.5} />
                  <circle cx={sx} cy={sy} r={C * 0.6} fill="url(#ludo-hole)" />
                </g>
              );
            })}
          </g>
        );
      })}
      {/* the track: cream squares, each turned with its arm; start squares in their colour; stars on the safe squares */}
      {HEX_LOOP.map((sq, i) => {
        const sc = startCorner(i);
        const [cy, cx] = hexPx(sq);
        return (
          <g key={i}>
            <polygon data-ludo-square={i} points={hexPts(hexCorners(sq))} fill={sc >= 0 ? `url(#ludo-yard-${sc})` : "#fffdf8"} stroke="#d6cbb6" strokeWidth={1} />
            {ludoSafe(i) && <polygon points={star(cx, cy, C * 0.36)} transform={`rotate(${-k * 60} ${cx} ${cy})`} fill={sc >= 0 ? "#fff" : "none"} stroke={sc >= 0 ? "none" : "#a99c86"} strokeWidth={1.6} strokeLinejoin="round" pointerEvents="none" />}
          </g>
        );
      })}
      {/* home lanes in full colour, with an arrow where each colour turns in */}
      {HEX_HOME.map((cells, c) => cells.map((sq, j) => <polygon key={`${c}-${j}`} points={hexPts(hexCorners(sq))} fill={`url(#ludo-yard-${c})`} stroke="#d6cbb6" />))}
      {corners.map((c) => {
        const [ey, ex] = hexPx(HEX_LOOP[toAbsolute(c, ludoLast(n), n)]);
        const [hy, hx] = hexPx(HEX_HOME[c][0]);
        const ang = (Math.atan2(hy - ey, hx - ex) * 180) / Math.PI;
        return <polygon key={c} points={`${ex + C * 0.3},${ey} ${ex - C * 0.18},${ey - C * 0.26} ${ex - C * 0.18},${ey + C * 0.26}`} transform={`rotate(${ang} ${ex} ${ey})`} fill={palette[c]} pointerEvents="none" />;
      })}
      {/* the centre: six fields pointing home */}
      {corners.map((c) => (
        <polygon key={c} points={hexPts(hexField(c))} fill={`url(#ludo-yard-${c})`} />
      ))}
      <path d={corners.map((c) => `M ${HEX_W / 2} ${HEX_H / 2} L ${hexPts([[Math.cos(yardAngle(c)) * 3, Math.sin(yardAngle(c)) * 3]]).replace(",", " ")}`).join(" ")} stroke="#fff" strokeOpacity={0.35} strokeWidth={1.2} />
    </>
  );

  const topRow = six ? [0, 1, 2] : [0, 1];
  const bottomRow = six ? [5, 4, 3] : [3, 2];
  const thrownFrom = (six ? THROW_FROM_6 : THROW_FROM)[screenCorner(ludoCorner(state.roller, n))] ?? [0.5, 0.9];
  return (
    <div ref={rootRef} data-game-board="ludo" data-ludo-arms={arms} className="flex flex-col items-center gap-2" style={{ width: side }}>
      <div className={`flex w-full ${six ? "gap-2" : "gap-3"}`}>{topRow.map((s) => <Fragment key={s}>{plate(s)}</Fragment>)}</div>
      {/* LANX 3.12.0: a printed cardboard board in a wooden frame, its colours a little shaded,
          the token spots pressed in, and glossy pins standing on a base. */}
      <div className="relative" style={{ width: side, height: tall }} data-ludo-roll-phase={play.phase ?? undefined}>
      <svg width={side} height={tall} viewBox={`${-FRAME} ${-FRAME} ${BW + 2 * FRAME} ${BH + 2 * FRAME}`} className="select-none" data-ludo-classic>
        <defs>
          <clipPath id="ludoRound">{six ? <path d={hexFrame(0)} /> : <rect width={SIZE} height={SIZE} rx={6} />}</clipPath>
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
          {palette.map((col, c) => (
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
        {six ? (
          <>
            <path d={hexFrame(FRAME)} fill="url(#ludo-wood)" />
            <path d={hexFrame(FRAME - 1)} fill="none" stroke="#fff" strokeOpacity={0.18} strokeWidth={1.5} />
            <path d={hexFrame(3)} fill="#000" opacity={0.35} transform="translate(0 1)" />
          </>
        ) : (
          <>
            <rect x={-FRAME} y={-FRAME} width={SIZE + 2 * FRAME} height={SIZE + 2 * FRAME} rx={16} fill="url(#ludo-wood)" />
            <rect x={-FRAME + 1} y={-FRAME + 1} width={SIZE + 2 * FRAME - 2} height={SIZE + 2 * FRAME - 2} rx={15} fill="none" stroke="#fff" strokeOpacity={0.18} strokeWidth={1.5} />
            <rect x={-3} y={-2} width={SIZE + 6} height={SIZE + 6} rx={8} fill="#000" opacity={0.35} />
          </>
        )}
        <g clipPath="url(#ludoRound)">
          <rect width={BW} height={BH} fill="#fffaf0" />
          <g transform={`rotate(${k * (360 / arms)} ${BW / 2} ${BH / 2})`}>{six ? hexPrint() : squarePrint()}</g>
          {/* The print sits on cardboard: its grain over everything printed. */}
          <rect width={BW} height={BH} fill="url(#ludo-paper)" pointerEvents="none" />
        </g>
        {/* tokens: pins that stand upright whichever way the board is turned */}
        {tokens.map(({ p, t, rel, x, y, lift, can, off }) => {
          const col = colour(p);
          const dark = darks[ludoCorner(p, n)];
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
        {play.phase && state.lastRoll > 0 && <ThrownDie key={rolls} value={state.lastRoll} start={thrownFrom} w={side} h={tall} nth={rolls} still={play.still} />}
      </div>
      <div className={`flex w-full ${six ? "gap-2" : "gap-3"}`}>{bottomRow.map((s) => <Fragment key={s}>{plate(s)}</Fragment>)}</div>
      <div className="min-h-[20px] text-center text-[12.5px] font-semibold text-slate-700 dark:text-slate-200" data-ludo-status>
        {status}
        {said && <span className="font-normal text-slate-500" data-ludo-event={state.event || "six"}> · {said}</span>}
        {!state.roll && canPlay && state.again && <span className="sr-only" data-ludo-again>Roll again!</span>}
      </div>
    </div>
  );
}
