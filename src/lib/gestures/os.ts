/** LANX 3.7.0: "Control the whole PC" — the hand drives this PC's real mouse and
 *  keyboard, in every program, not only inside LANX. The same gestures: a pinch
 *  clicks where the pointer was as the fingers met, pinch-and-move drags, a pinch
 *  held still is a right-click, a fist scrolls (and flings), two hands zoom
 *  (Ctrl + wheel), a flick presses ← or →. What happens in a frame goes to
 *  Windows in one call. */
import { api, errorText } from "../api";

export type HandInput =
  | { op: "move"; x: number; y: number }
  /** 3.7.1: glide there (LANX eases the mouse between camera frames, ~120 steps a second). */
  | { op: "aim"; x: number; y: number }
  /** 3.7.1: scroll this much, let out smoothly. */
  | { op: "scroll"; dx: number; dy: number }
  | { op: "button"; button: 0 | 1 | 2; down: boolean }
  | { op: "wheel"; dx: number; dy: number }
  | { op: "key"; code: string; down: boolean }
  | { op: "text"; text: string };
/** LANX 3.11.2: the window two hands are resizing (real pixels). */
export interface FramedWindow {
  title: string;
  width: number;
  height: number;
  filled: boolean;
}
/** One screen of this PC, in real pixels. */
export interface HandScreen {
  left: number;
  top: number;
  width: number;
  height: number;
  work_left: number;
  work_top: number;
  work_width: number;
  work_height: number;
  primary: boolean;
}

/** Hand movement (px) → wheel units (120 = one notch ≈ 3 lines ≈ 100 px). */
const WHEEL_PER_PX = 1.3;
/** Smaller steps wait for more (some programs ignore tiny ones). */
const WHEEL_MIN = 24;
/** Two hands: this much change (log of the scale) is one Ctrl + wheel notch. */
const ZOOM_STEP = 0.16;
/** A second click this soon and this near lands exactly on the first (Windows wants a few pixels). */
const DOUBLE_MS = 600;
const DOUBLE_PX = 90;
/** A fling slows down like this (per second), and stops below this speed (px/s). */
const FLING_DECAY = 4;
const FLING_STOP = 60;
const ERROR_EVERY = 4000;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** A window's title, short enough for a note ("Report.xlsx - Excel" stays whole). */
const shortTitle = (t: string) => (t.length > 42 ? `${t.slice(0, 40).trimEnd()}…` : t);

export class OsDriver {
  /** The screen the hand covers (its number for Windows, and its real pixels). */
  screen = 0;
  real: HandScreen | null = null;
  /** The same screen in the units the hand pointer uses (about CSS pixels). */
  w = 1280;
  h = 800;
  private q: HandInput[] = [];
  private sending = false;
  private press: { x: number; y: number } | null = null;
  /** The left button is down (dragging). */
  private held = false;
  /** This pinch already did its thing (a right-click). */
  private used = false;
  private lastClick: { x: number; y: number; t: number } | null = null;
  private wheelAcc = { x: 0, y: 0 };
  private fling: { vx: number; vy: number; t: number } | null = null;
  private zoomAcc = 0;
  private errAt = 0;

  constructor(private onError: (text: string) => void) {}

  /** Finds the main screen. False when this PC can't be driven (not Windows, or no screens). */
  async init(): Promise<boolean> {
    const all = await api.handScreens().catch(() => [] as HandScreen[]);
    const i = Math.max(0, all.findIndex((s) => s.primary));
    this.real = all[i] ?? null;
    if (!this.real) return false;
    this.screen = i;
    const dpr = window.devicePixelRatio || 1;
    this.w = Math.round(this.real.width / dpr);
    this.h = Math.round(this.real.height / dpr);
    return true;
  }

  /** A pointer spot in real screen pixels. */
  toReal(x: number, y: number): { x: number; y: number } {
    const s = this.real;
    return s ? { x: s.left + (x / this.w) * s.width, y: s.top + (y / this.h) * s.height } : { x, y };
  }

  private at(x: number, y: number): HandInput {
    return { op: "move", x: clamp01(x / this.w), y: clamp01(y / this.h) };
  }
  private aim(x: number, y: number): HandInput {
    return { op: "aim", x: clamp01(x / this.w), y: clamp01(y / this.h) };
  }

  private push(...ops: HandInput[]) {
    for (const op of ops) {
      const last = this.q[this.q.length - 1];
      // Only the newest place matters; scrolling adds up.
      if (op.op === "aim" && last?.op === "aim") this.q[this.q.length - 1] = op;
      else if (op.op === "scroll" && last?.op === "scroll") this.q[this.q.length - 1] = { op: "scroll", dx: last.dx + op.dx, dy: last.dy + op.dy };
      else this.q.push(op);
    }
    void this.flush();
  }

  private async flush() {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.q.length) {
        const batch = this.q.splice(0, 64);
        try {
          await api.handInput(this.screen, batch);
        } catch (e) {
          const now = performance.now();
          if (now - this.errAt > ERROR_EVERY) {
            this.errAt = now;
            this.onError(errorText(e));
          }
        }
      }
    } finally {
      this.sending = false;
    }
  }

  /** The pointer follows the hand, gliding (but holds still while a pinch may still be a click). */
  move(x: number, y: number) {
    if (this.press && !this.held) return;
    this.push(this.aim(x, y));
  }

  pressAt(x: number, y: number) {
    this.press = { x, y };
    this.used = false;
    this.fling = null;
  }

  drag(x: number, y: number) {
    const p = this.press;
    if (!p || this.used) return;
    if (!this.held) {
      this.held = true;
      this.push(this.at(p.x, p.y), { op: "button", button: 0, down: true });
    }
    // From where the fingers met, the mouse glides after the hand (no jump).
    this.push(this.aim(x, y));
  }

  release(x: number, y: number, click: boolean, double: boolean) {
    const p = this.press;
    this.press = null;
    if (this.held) {
      this.held = false;
      this.push(this.at(x, y), { op: "button", button: 0, down: false });
      return;
    }
    if (this.used || !click) return;
    let c = p ?? { x, y };
    const now = performance.now();
    const l = this.lastClick;
    if (l && now - l.t < DOUBLE_MS && Math.hypot(c.x - l.x, c.y - l.y) < DOUBLE_PX) c = { x: l.x, y: l.y };
    this.push(this.at(c.x, c.y), { op: "button", button: 0, down: true }, { op: "button", button: 0, down: false });
    this.lastClick = double ? null : { ...c, t: now };
  }

  cancel() {
    if (this.held) this.push({ op: "button", button: 0, down: false });
    this.held = false;
    this.press = null;
  }

  /** A pinch held still: the right-click menu. */
  longPress(x: number, y: number) {
    if (this.held) return;
    const p = this.press ?? { x, y };
    this.used = true;
    this.push(this.at(p.x, p.y), { op: "button", button: 2, down: true }, { op: "button", button: 2, down: false });
  }

  grab() {
    this.fling = null;
    this.wheelAcc = { x: 0, y: 0 };
  }

  /** A fist moves the page with it: down scrolls up, like dragging paper. */
  grabMove(dx: number, dy: number) {
    this.wheelAcc.x -= dx * WHEEL_PER_PX;
    this.wheelAcc.y += dy * WHEEL_PER_PX;
    this.sendWheel(false);
  }

  private sendWheel(all: boolean) {
    const { x, y } = this.wheelAcc;
    const wx = Math.abs(x) >= WHEEL_MIN || (all && Math.abs(x) >= 1) ? Math.round(x) : 0;
    const wy = Math.abs(y) >= WHEEL_MIN || (all && Math.abs(y) >= 1) ? Math.round(y) : 0;
    if (!wx && !wy) return;
    this.wheelAcc = { x: x - wx, y: y - wy };
    this.push({ op: "scroll", dx: wx, dy: wy });
  }

  grabEnd(vx: number, vy: number) {
    this.sendWheel(true);
    if (Math.hypot(vx, vy) > 300) this.fling = { vx, vy, t: performance.now() };
  }

  /** Every camera frame: a fling keeps scrolling, slowing down. */
  tick(now: number) {
    const f = this.fling;
    if (!f) return;
    const dt = Math.min(0.1, Math.max(0, (now - f.t) / 1000));
    f.t = now;
    this.grabMove(f.vx * dt, f.vy * dt);
    const k = Math.exp(-FLING_DECAY * dt);
    f.vx *= k;
    f.vy *= k;
    if (Math.hypot(f.vx, f.vy) < FLING_STOP) {
      this.fling = null;
      this.sendWheel(true);
    }
  }

  zoomStart() {
    this.zoomAcc = 0;
  }

  /** Two hands apart or together: Ctrl + wheel, which zooms in nearly every program. */
  zoom(scale: number) {
    if (!(scale > 0)) return;
    this.zoomAcc += Math.log(scale);
    while (Math.abs(this.zoomAcc) >= ZOOM_STEP) {
      const s = Math.sign(this.zoomAcc);
      this.push({ op: "key", code: "ControlLeft", down: true }, { op: "wheel", dx: 0, dy: 120 * s }, { op: "key", code: "ControlLeft", down: false });
      this.zoomAcc -= s * ZOOM_STEP;
    }
  }

  // ---- LANX 3.11.2: both hands held up resize the window between them, in any program.
  private frameBegun: Promise<void> | null = null;
  private framedNow: FramedWindow | null = null;
  private frameWant: number | null = null;
  private framePumping: Promise<void> | null = null;

  /** Both hands up around (x, y): that window is the one to resize. */
  frameStart(x: number, y: number, note: (text: string) => void) {
    this.frameWant = null;
    this.framedNow = null;
    this.frameBegun = api
      .handWindow("begin", this.screen, clamp01(x / this.w), clamp01(y / this.h), 1)
      .then((w) => {
        this.framedNow = w;
        if (w) note(`↔ ${shortTitle(w.title)} — hands apart: bigger, together: smaller`);
      })
      .catch((e) => note(errorText(e)));
  }

  /** The hands are `scale` times as far apart as at the start. Only the newest size goes. */
  frameSet(scale: number) {
    this.frameWant = scale;
    this.framePumping ??= this.framePump().finally(() => {
      this.framePumping = null;
    });
  }

  private async framePump() {
    await this.frameBegun;
    while (this.frameWant !== null && this.framedNow) {
      const s = this.frameWant;
      this.frameWant = null;
      try {
        this.framedNow = (await api.handWindow("set", this.screen, 0, 0, s)) ?? this.framedNow;
      } catch (e) {
        const now = performance.now();
        if (now - this.errAt > ERROR_EVERY) {
          this.errAt = now;
          this.onError(errorText(e));
        }
        return;
      }
    }
  }

  /** A hand went down: the window stays as it is now. */
  frameEnd(note: (text: string) => void) {
    const begun = this.frameBegun;
    this.frameBegun = null;
    void (async () => {
      await begun;
      await this.framePumping;
      const w = this.framedNow;
      this.framedNow = null;
      this.frameWant = null;
      await api.handWindow("end", this.screen, 0, 0, 1).catch(() => {});
      if (w) note(w.filled ? `${shortTitle(w.title)} fills the screen` : `${shortTitle(w.title)}: ${w.width} × ${w.height}`);
    })();
  }

  /** A key by its place ("Enter", "ArrowLeft", "Escape"…). */
  key(code: string) {
    this.push({ op: "key", code, down: true }, { op: "key", code, down: false });
  }

  /** Keys held together, like Ctrl + C (let go in reverse). */
  chord(codes: string[]) {
    this.push(...codes.map((code): HandInput => ({ op: "key", code, down: true })), ...[...codes].reverse().map((code): HandInput => ({ op: "key", code, down: false })));
  }

  text(text: string) {
    if (text) this.push({ op: "text", text });
  }

  /** The hand went away: nothing stays held. */
  leave() {
    this.cancel();
    this.fling = null;
  }
}
