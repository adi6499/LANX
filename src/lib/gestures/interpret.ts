/** LANX 3.5.0: what the hands mean. Pure logic (no page, no camera): each
 *  frame of hand points goes in, and out comes where the pointer is and what
 *  just happened — a pinch (click / drag), a grab (scroll and fling), two
 *  hands pinching (zoom and turn), a flick (next / back / close) or a sign
 *  held for half a second (👍 yes, 👎 no, ✌ listen, 🤟 command wheel). */

export interface HandIn {
  /** 21 points × (x, y, z), camera picture units (0..1), not mirrored. */
  lm: number[];
  handed: string;
  gesture: string;
  score: number;
}
export interface FrameIn {
  t: number;
  aspect: number;
  hands: HandIn[];
}
export type Sign = "yes" | "no" | "listen" | "wheel";
export type SwipeDir = "left" | "right" | "up" | "down";
export type GEvent =
  | { type: "press"; x: number; y: number }
  | { type: "drag"; x: number; y: number }
  | { type: "release"; x: number; y: number; click: boolean; double: boolean }
  | { type: "cancel" }
  | { type: "longpress"; x: number; y: number }
  | { type: "grab"; x: number; y: number }
  | { type: "grab-move"; dx: number; dy: number }
  | { type: "grab-end"; vx: number; vy: number }
  | { type: "zoom-start"; cx: number; cy: number }
  /** `scale` and `rotate` (degrees) are the change since the last zoom event. */
  | { type: "zoom"; scale: number; rotate: number; cx: number; cy: number }
  | { type: "zoom-end" }
  | { type: "swipe"; dir: SwipeDir }
  /** LANX 3.6.1: both hands open and held up — the window follows the space between
   *  them. `scale` is the distance now ÷ the distance when it started. */
  | { type: "frame-start" }
  | { type: "frame"; scale: number }
  | { type: "frame-end" }
  | { type: "sign"; sign: Sign };
export type CursorMode = "point" | "press" | "drag" | "grab" | "zoom" | "frame";
export interface Cursor {
  x: number;
  y: number;
  mode: CursorMode;
  /** A sign being held: which, and how far along (0..1). */
  hold: null | { sign: Sign; p: number };
}
export interface Out {
  cursor: Cursor | null;
  /** The other hand's point while zooming. */
  second: { x: number; y: number } | null;
  events: GEvent[];
  /** Hands being followed right now. */
  tracking: number;
}
export type Speed = "slow" | "normal" | "fast";
export interface InterpretOpts {
  speed: Speed;
  /** Which hand drives the pointer when both are up. */
  hand: "auto" | "right" | "left";
  swipes: boolean;
}

/** The part of the camera picture (mirrored, 0..1) that covers the whole window. */
const BOX: Record<Speed, [number, number, number, number]> = {
  slow: [0.1, 0.9, 0.1, 0.86],
  normal: [0.2, 0.8, 0.18, 0.74],
  fast: [0.28, 0.72, 0.25, 0.65],
};
const ENGAGE_MS = 250;
const LOST_MS = 250;
const MIN_SCALE = 0.07;
const PINCH_IN = 0.33;
const PINCH_OUT = 0.48;
/** Fingertips at least this far apart (hand-lengths) for a closed hand to be a fist, not a pinch. */
const FIST_GAP = 0.4;
/** A pinch turns into a drag only after this long and this far: a quick pinch
 *  is a click even while the hand moves (real hands wobble far more than a mouse). */
const DRAG_PX = 36;
const DRAG_DELAY = 180;
const LONG_MS = 700;
const DOUBLE_MS = 420;
const REWIND_MS = 90;
const HOLD_MS = 500;
const SWIPE_WINDOW = 250;
const SWIPE_TAIL = 110;
const SWIPE_DIST = 0.2;
const SWIPE_SPEED = 1.7;
const SWIPE_REST = 900;
/** Both open hands held up this long before the window starts following them. */
const FRAME_HOLD = 450;
/** Frames without two open hands before the window lets go (the model flickers). */
const FRAME_MISS = 4;
const SIGNS: Record<string, Sign> = { Thumb_Up: "yes", Thumb_Down: "no", Victory: "listen", ILoveYou: "wheel" };

/** The "1€ filter": steady when the hand is still, no lag when it moves. */
export class OneEuro {
  private v: number | null = null;
  private d = 0;
  private t = 0;
  constructor(private minCutoff = 0.9, private beta = 0.025, private dCutoff = 1) {}
  reset() {
    this.v = null;
  }
  filter(x: number, tMs: number): number {
    if (this.v === null) {
      this.v = x;
      this.d = 0;
      this.t = tMs;
      return x;
    }
    const dt = Math.max(0.001, (tMs - this.t) / 1000);
    this.t = tMs;
    const alpha = (cut: number) => {
      const r = 2 * Math.PI * cut * dt;
      return r / (r + 1);
    };
    this.d += alpha(this.dCutoff) * ((x - this.v) / dt - this.d);
    this.v += alpha(this.minCutoff + this.beta * Math.abs(this.d)) * (x - this.v);
    return this.v;
  }
}

interface P2 {
  x: number;
  y: number;
}
const dist = (a: P2, b: P2) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export interface Pose {
  /** Mirrored picture units, x scaled by the aspect so distances are true. */
  palm: P2;
  /** For the pointer: the palm in plain mirrored 0..1 units. */
  anchor: P2;
  scale: number;
  pinch: number;
  fist: boolean;
  open: boolean;
  thumbOut: boolean;
  indexCurled: boolean;
  sign: Sign | null;
  handed: "left" | "right";
}

/** Reads a hand's shape from its 21 points. */
export function poseOf(h: HandIn, aspect: number): Pose {
  const p = (i: number): P2 => ({ x: (1 - h.lm[i * 3]) * aspect, y: h.lm[i * 3 + 1] });
  const u = (i: number): P2 => ({ x: 1 - h.lm[i * 3], y: h.lm[i * 3 + 1] });
  const wrist = p(0);
  const scale = Math.max(1e-3, dist(wrist, p(9)));
  const ids = [0, 5, 9, 13, 17];
  const palm = { x: ids.reduce((s, i) => s + p(i).x, 0) / 5, y: ids.reduce((s, i) => s + p(i).y, 0) / 5 };
  const anchor = { x: ids.reduce((s, i) => s + u(i).x, 0) / 5, y: ids.reduce((s, i) => s + u(i).y, 0) / 5 };
  const curled = (tip: number, pip: number) => dist(p(tip), wrist) < dist(p(pip), wrist) * 1.05;
  const extended = (tip: number, pip: number) => dist(p(tip), wrist) > dist(p(pip), wrist) * 1.15;
  const indexCurled = curled(8, 6) || dist(p(8), p(5)) / scale < 0.45;
  const others = [curled(12, 10), curled(16, 14), curled(20, 18)].filter(Boolean).length;
  const thumbOut = dist(p(4), p(9)) / scale > 0.8 || dist(p(4), p(5)) / scale > 0.75;
  const canned = h.score >= 0.5 ? h.gesture : "None";
  const t4 = p(4);
  const t8 = p(8);
  const pinch = dist(t4, t8) / scale;
  // A fist, unless the thumb and index fingertips touch: most people pinch with
  // the other fingers curled, which the model calls "Closed_Fist" too. Measured
  // on a real hand (5 Nov 2026): pinches 0.12–0.31 hand-lengths apart, fists 0.42–0.65.
  const fistShape = canned === "Closed_Fist" || (canned !== "Thumb_Up" && canned !== "Thumb_Down" && !thumbOut && indexCurled && others >= 3);
  const fist = fistShape && pinch >= FIST_GAP;
  const ext = [extended(8, 6), extended(12, 10), extended(16, 14), extended(20, 18)].filter(Boolean).length;
  const sign = h.score >= 0.65 ? SIGNS[h.gesture] ?? null : null;
  return {
    palm,
    anchor,
    scale,
    pinch,
    fist,
    open: canned === "Open_Palm" || ext >= 3,
    thumbOut,
    indexCurled,
    sign,
    // The engine assumes a mirrored picture; ours isn't, so its "Left" is the right hand.
    handed: h.handed === "Left" ? "right" : "left",
  };
}

interface Track {
  id: number;
  first: number;
  last: number;
  pose: Pose;
  hist: { t: number; x: number; y: number }[];
  fx: OneEuro;
  fy: OneEuro;
  screen: P2;
  shist: { t: number; x: number; y: number }[];
  pinch: boolean;
  pinchFrames: number;
  openFrames: number;
  fistFrames: number;
  plainFrames: number;
  grab: boolean;
  sign: Sign | null;
  signSince: number;
  signMiss: number;
  signFired: boolean;
  /** A pinch that stays closed after a zoom does nothing until it opens. */
  spent: boolean;
}

type Press = { x: number; y: number; t: number; dragging: boolean; long: boolean };

export class GestureInterpreter {
  private tracks: Track[] = [];
  private nextId = 1;
  private primary: number | null = null;
  private press: Press | null = null;
  private offset: P2 = { x: 0, y: 0 };
  private grabbing = false;
  private zoom: null | { a: number; b: number; d: number; angle: number } = null;
  private frame: null | { since: number; d0: number; on: boolean; miss: number } = null;
  private lastClick: { t: number; x: number; y: number } | null = null;
  private swipeAt = 0;

  constructor(public opts: InterpretOpts) {}

  reset() {
    this.tracks = [];
    this.primary = null;
    this.press = null;
    this.grabbing = false;
    this.frame = null;
    this.zoom = null;
  }

  private toScreen(a: P2, vw: number, vh: number): P2 {
    const [x0, x1, y0, y1] = BOX[this.opts.speed];
    return { x: clamp01((a.x - x0) / (x1 - x0)) * vw, y: clamp01((a.y - y0) / (y1 - y0)) * vh };
  }

  private match(f: FrameIn): Track[] {
    const poses = f.hands.map((h) => poseOf(h, f.aspect)).filter((p) => p.scale >= MIN_SCALE * 0.8);
    const free = new Set(this.tracks);
    const seen: Track[] = [];
    for (const pose of poses) {
      let best: Track | null = null;
      let bestD = 0.25 * f.aspect;
      for (const tr of free) {
        const d = dist(tr.pose.palm, pose.palm);
        if (d < bestD) {
          bestD = d;
          best = tr;
        }
      }
      if (best) {
        free.delete(best);
        best.pose = pose;
        best.last = f.t;
        seen.push(best);
      } else {
        const tr: Track = {
          id: this.nextId++, first: f.t, last: f.t, pose, hist: [], fx: new OneEuro(), fy: new OneEuro(), screen: { x: 0, y: 0 }, shist: [],
          pinch: false, pinchFrames: 0, openFrames: 0, fistFrames: 0, plainFrames: 0, grab: false, sign: null, signSince: 0, signMiss: 0, signFired: false, spent: false,
        };
        this.tracks.push(tr);
        seen.push(tr);
      }
    }
    this.tracks = this.tracks.filter((tr) => f.t - tr.last <= LOST_MS);
    return seen;
  }

  update(f: FrameIn, vw: number, vh: number): Out {
    const events: GEvent[] = [];
    const seen = this.match(f);
    const engaged = (tr: Track) => f.t - tr.first >= ENGAGE_MS && tr.pose.scale >= MIN_SCALE;

    // Follow each visible hand: its history, its pointer, its pinch and fist.
    for (const tr of seen) {
      const P = tr.pose;
      tr.hist.push({ t: f.t, x: P.anchor.x, y: P.anchor.y });
      while (tr.hist.length && f.t - tr.hist[0].t > 500) tr.hist.shift();
      const raw = this.toScreen(P.anchor, vw, vh);
      tr.screen = { x: tr.fx.filter(raw.x, f.t), y: tr.fy.filter(raw.y, f.t) };
      tr.shist.push({ t: f.t, ...tr.screen });
      while (tr.shist.length && f.t - tr.shist[0].t > 400) tr.shist.shift();
      const pinchy = P.pinch < (tr.pinch ? PINCH_OUT : PINCH_IN);
      tr.pinchFrames = pinchy ? tr.pinchFrames + 1 : 0;
      tr.openFrames = pinchy ? 0 : tr.openFrames + 1;
      if (!tr.pinch && tr.pinchFrames >= 2) tr.pinch = true;
      else if (tr.pinch && tr.openFrames >= 2) {
        tr.pinch = false;
        tr.spent = false;
      }
      tr.fistFrames = P.fist ? tr.fistFrames + 1 : 0;
      tr.plainFrames = P.fist ? 0 : tr.plainFrames + 1;
      if (!tr.grab && tr.fistFrames >= 4) tr.grab = true;
      else if (tr.grab && tr.plainFrames >= 3) tr.grab = false;
    }

    const live = this.tracks.filter((tr) => tr.last === f.t && engaged(tr));
    // Which hand drives the pointer: the same one while it stays, else the chosen hand, else the nearest.
    let prim = live.find((tr) => tr.id === this.primary) ?? null;
    if (!prim && live.length) {
      const wanted = this.opts.hand === "auto" ? live : live.filter((tr) => tr.pose.handed === this.opts.hand);
      const pool = wanted.length ? wanted : live;
      prim = pool.reduce((a, b) => (b.pose.scale > a.pose.scale ? b : a));
    }
    if (prim?.id !== this.primary) {
      // The pointer hand went away (or changed): finish whatever it was doing.
      if (this.press) events.push({ type: "cancel" });
      if (this.grabbing) events.push({ type: "grab-end", vx: 0, vy: 0 });
      this.press = null;
      this.grabbing = false;
      if (prim) this.offset = { x: 0, y: 0 };
    }
    this.primary = prim?.id ?? null;
    const other = prim ? live.find((tr) => tr !== prim) ?? null : null;

    // Two hands pinching: zoom and turn.
    if (prim && other && prim.pinch && other.pinch) {
      // The two pointers (where the hands show on screen) set the middle and the size.
      const a = { x: prim.screen.x, y: prim.screen.y };
      const b = { x: other.screen.x, y: other.screen.y };
      const d = Math.max(1, dist(a, b));
      const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      if (!this.zoom) {
        if (this.press) events.push({ type: "cancel" });
        this.press = null;
        if (this.grabbing) events.push({ type: "grab-end", vx: 0, vy: 0 });
        this.grabbing = false;
        this.zoom = { a: prim.id, b: other.id, d, angle };
        events.push({ type: "zoom-start", cx, cy });
      } else {
        let turn = angle - this.zoom.angle;
        if (turn > 180) turn -= 360;
        if (turn < -180) turn += 360;
        const scale = d / this.zoom.d;
        if (Math.abs(scale - 1) > 0.004 || Math.abs(turn) > 0.3) {
          events.push({ type: "zoom", scale, rotate: turn, cx, cy });
          this.zoom.d = d;
          this.zoom.angle = angle;
        }
      }
      prim.spent = other.spent = true;
      return { cursor: { x: a.x, y: a.y, mode: "zoom", hold: null }, second: b, events, tracking: live.length };
    }
    if (this.zoom) {
      events.push({ type: "zoom-end" });
      this.zoom = null;
    }

    // Two open hands, held up for a moment: the window follows the space between them.
    const both = !!prim && !!other && prim.pose.open && other.pose.open && !prim.pinch && !other.pinch && !prim.grab && !other.grab;
    if (both && prim && other) {
      const d = Math.max(0.01, dist(prim.pose.palm, other.pose.palm));
      const fr = (this.frame ??= { since: f.t, d0: d, on: false, miss: 0 });
      fr.miss = 0;
      if (!fr.on && f.t - fr.since >= FRAME_HOLD) {
        fr.on = true;
        fr.d0 = d;
        if (this.press) events.push({ type: "cancel" });
        this.press = null;
        events.push({ type: "frame-start" });
      } else if (fr.on) events.push({ type: "frame", scale: d / fr.d0 });
      if (fr.on) {
        return { cursor: { x: prim.screen.x, y: prim.screen.y, mode: "frame", hold: null }, second: { x: other.screen.x, y: other.screen.y }, events, tracking: live.length };
      }
    } else if (this.frame) {
      if (!this.frame.on || ++this.frame.miss > FRAME_MISS) {
        if (this.frame.on) events.push({ type: "frame-end" });
        this.frame = null;
      } else if (prim) {
        // A flicker: hold the window as it is for a moment.
        return { cursor: { x: prim.screen.x, y: prim.screen.y, mode: "frame", hold: null }, second: other ? { x: other.screen.x, y: other.screen.y } : null, events, tracking: live.length };
      }
    }
    if (!prim) {
      return { cursor: null, second: null, events, tracking: 0 };
    }

    // Ease back any pinch offset once nothing is held.
    if (!this.press) {
      this.offset = { x: this.offset.x * 0.6, y: this.offset.y * 0.6 };
    }
    let x = prim.screen.x + this.offset.x;
    let y = prim.screen.y + this.offset.y;

    // Grab (a fist): scroll the page with the hand, and fling it on letting go.
    if (prim.grab && !this.press) {
      if (!this.grabbing) {
        this.grabbing = true;
        events.push({ type: "grab", x, y });
      } else {
        const h = prim.shist;
        const prev = h.length >= 2 ? h[h.length - 2] : h[h.length - 1];
        const dx = prim.screen.x - prev.x;
        const dy = prim.screen.y - prev.y;
        if (dx || dy) events.push({ type: "grab-move", dx, dy });
      }
      return { cursor: { x, y, mode: "grab", hold: null }, second: null, events, tracking: live.length };
    }
    if (this.grabbing) {
      this.grabbing = false;
      const h = prim.shist.filter((s) => f.t - s.t <= 120);
      const first = h[0];
      const last = h[h.length - 1];
      const dt = first && last && last.t > first.t ? (last.t - first.t) / 1000 : 0;
      events.push({ type: "grab-end", vx: dt ? (last.x - first.x) / dt : 0, vy: dt ? (last.y - first.y) / dt : 0 });
    }

    // Pinch: press where the pointer was just before the fingers met (they pull the hand a little).
    if (prim.pinch && !prim.spent) {
      if (!this.press) {
        const back = [...prim.shist].reverse().find((s) => f.t - s.t >= REWIND_MS) ?? prim.shist[0] ?? { x: prim.screen.x, y: prim.screen.y };
        const px = back.x + this.offset.x;
        const py = back.y + this.offset.y;
        this.offset = { x: px - prim.screen.x, y: py - prim.screen.y };
        this.press = { x: px, y: py, t: f.t, dragging: false, long: false };
        x = px;
        y = py;
        events.push({ type: "press", x, y });
      } else {
        const pr = this.press;
        if (!pr.dragging && !pr.long && f.t - pr.t >= DRAG_DELAY && Math.hypot(x - pr.x, y - pr.y) > DRAG_PX) pr.dragging = true;
        if (pr.dragging) events.push({ type: "drag", x, y });
        else if (!pr.long && f.t - pr.t >= LONG_MS) {
          pr.long = true;
          events.push({ type: "longpress", x: pr.x, y: pr.y });
        }
        if (!pr.dragging) {
          x = pr.x;
          y = pr.y;
        }
      }
      return { cursor: { x, y, mode: this.press.dragging ? "drag" : "press", hold: null }, second: null, events, tracking: live.length };
    }
    if (this.press) {
      const pr = this.press;
      this.press = null;
      if (pr.long) events.push({ type: "cancel" });
      else {
        const click = !pr.dragging;
        const ex = click ? pr.x : x;
        const ey = click ? pr.y : y;
        const double = click && !!this.lastClick && f.t - this.lastClick.t < DOUBLE_MS && Math.hypot(this.lastClick.x - ex, this.lastClick.y - ey) < 30;
        events.push({ type: "release", x: ex, y: ey, click, double });
        this.lastClick = click && !double ? { t: f.t, x: ex, y: ey } : null;
      }
    }

    // A flick of the open hand.
    let swiped = false;
    if (this.opts.swipes && !this.frame && prim.pose.open && f.t - prim.first >= 400 && f.t - this.swipeAt > SWIPE_REST) {
      // Far enough over the last quarter second, and still fast at the end.
      const win = prim.hist.filter((s) => f.t - s.t <= SWIPE_WINDOW);
      const tail = prim.hist.filter((s) => f.t - s.t <= SWIPE_TAIL);
      if (win.length >= 3 && tail.length >= 2) {
        const a = win[0];
        const b = win[win.length - 1];
        const c = tail[0];
        const dt = Math.max(0.001, (b.t - c.t) / 1000);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const vx = (b.x - c.x) / dt;
        const vy = (b.y - c.y) / dt;
        const horiz = Math.abs(dx) >= SWIPE_DIST && Math.abs(vx) >= SWIPE_SPEED && Math.sign(vx) === Math.sign(dx) && Math.abs(dx) > 1.8 * Math.abs(dy);
        const vert = Math.abs(dy) >= SWIPE_DIST && Math.abs(vy) >= SWIPE_SPEED && Math.sign(vy) === Math.sign(dy) && Math.abs(dy) > 1.8 * Math.abs(dx);
        if (horiz || vert) {
          const dir: SwipeDir = horiz ? (dx < 0 ? "left" : "right") : dy < 0 ? "up" : "down";
          events.push({ type: "swipe", dir });
          this.swipeAt = f.t;
          swiped = true;
          prim.sign = null;
        }
      }
    }

    // A sign held still for half a second.
    let hold: Cursor["hold"] = null;
    const sign = swiped || f.t - this.swipeAt < 400 ? null : prim.pose.sign;
    const recent = prim.hist.filter((s) => f.t - s.t <= 200);
    const speed = recent.length >= 2 ? dist(recent[0], recent[recent.length - 1]) / Math.max(0.001, (recent[recent.length - 1].t - recent[0].t) / 1000) : 0;
    if (sign && speed < 0.7) {
      if (prim.sign !== sign) {
        prim.sign = sign;
        prim.signSince = f.t;
        prim.signFired = false;
      }
      prim.signMiss = 0;
      const p = Math.min(1, (f.t - prim.signSince) / HOLD_MS);
      if (!prim.signFired) {
        hold = { sign, p };
        if (p >= 1) {
          prim.signFired = true;
          events.push({ type: "sign", sign });
        }
      }
    } else if (prim.sign && ++prim.signMiss > 4) {
      prim.sign = null;
      prim.signFired = false;
    } else if (prim.sign && !prim.signFired) {
      hold = { sign: prim.sign, p: Math.min(1, (f.t - prim.signSince) / HOLD_MS) };
    }

    return { cursor: { x, y, mode: "point", hold }, second: null, events, tracking: live.length };
  }
}
