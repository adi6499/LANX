/** LANX 3.7.0: your own signs. Show LANX a hand shape three times and say what it
 *  does, the way you would speak a command ("call Bharat", "mute", "open notes",
 *  "take a screenshot"). A shape is compared by where its 21 points sit, turned
 *  upright and sized to the hand, so it works near or far, with either hand and a
 *  little tilted. Learned and kept on this PC only. Pure logic (no page). */
import { type FrameIn, type HandIn, poseOf } from "./interpret";

export interface CustomSign {
  id: string;
  /** What the user calls it ("Rock on"); the command when left empty. */
  name: string;
  /** Said like a spoken command: "call Bharat", "open notes"… */
  command: string;
  /** Three shapes (see `shapeOf`) seen while teaching. */
  samples: number[][];
  /** How close a shape must be to count (from how alike the three were). */
  reach: number;
}

/** Held this long (and fairly still) before it does its thing. */
export const SIGN_HOLD_MS = 650;
/** After doing it, the shape must go away before it can again; and not sooner than this. */
const SIGN_COOLDOWN_MS = 1500;
/** The wrist may drift this far (picture widths) during the hold. */
const SIGN_STILL = 0.08;
/** The best sign must beat the next by this much (else it isn't sure). */
const SIGN_MARGIN = 0.03;
/** Frames a shape may flicker away before the hold starts over. */
const SIGN_MISS = 3;
const REACH_MIN = 0.14;
const REACH_MAX = 0.28;
/** LANX's own signs, which a sign of yours can't be. */
const BUILT_IN: Record<string, string> = {
  Thumb_Up: "👍 (it answers calls)",
  Thumb_Down: "👎 (it declines and closes)",
  Victory: "✌ (it listens for a command)",
  ILoveYou: "🤟 (it opens the command wheel and the keyboard)",
  Closed_Fist: "a fist (it scrolls)",
  Open_Palm: "an open hand (it moves the pointer)",
  Pointing_Up: "a pointing finger (it moves the pointer)",
};

/** A hand's shape: its points relative to the wrist, turned so the wrist → middle
 *  knuckle line points up, in units of that line's length. A left hand is mirrored
 *  first, so one sign works with either hand. */
export function shapeOf(h: HandIn, aspect: number): number[] {
  // The engine assumes a mirrored picture: its "Right" is the user's left hand.
  const flip = h.handed === "Right" ? -1 : 1;
  const x = (i: number) => h.lm[i * 3] * aspect * flip;
  const y = (i: number) => h.lm[i * 3 + 1];
  const vx = x(9) - x(0);
  const vy = y(9) - y(0);
  const len = Math.max(1e-3, Math.hypot(vx, vy));
  const turn = -Math.PI / 2 - Math.atan2(vy, vx);
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  const out: number[] = [];
  for (let i = 0; i < 21; i++) {
    const px = x(i) - x(0);
    const py = y(i) - y(0);
    out.push((px * c - py * s) / len, (px * s + py * c) / len);
  }
  return out;
}

/** How far apart two shapes are: the average gap between matching points. */
export function shapeGap(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < 21; i++) sum += Math.hypot(a[i * 2] - b[i * 2], a[i * 2 + 1] - b[i * 2 + 1]);
  return sum / 21;
}

const meanShape = (all: number[][]) => all[0].map((_, i) => all.reduce((s, v) => s + v[i], 0) / all.length);

/** The sign nearest to a shape, and how near the next one is. */
export function nearestSign(signs: CustomSign[], shape: number[]): { sign: CustomSign; gap: number; next: number } | null {
  let best: { sign: CustomSign; gap: number } | null = null;
  let next = Infinity;
  for (const sign of signs) {
    const gap = Math.min(...sign.samples.map((s) => shapeGap(s, shape)));
    if (!best || gap < best.gap) {
      if (best) next = Math.min(next, best.gap);
      best = { sign, gap };
    } else next = Math.min(next, gap);
  }
  return best ? { ...best, next } : null;
}

/** Hands a sign could be: not pinching (that clicks), not a fist, not one of LANX's signs. */
function free(h: HandIn, aspect: number): boolean {
  const p = poseOf(h, aspect);
  return p.pinch >= 0.33 && !p.fist && !p.sign;
}

// ------------------------------------------------------------- teaching

export type TeachStep =
  /** Show the sign; `got` of 3 so far; `p` how far along holding it still (0..1). */
  | { phase: "show"; got: number; p: number; hand: boolean }
  /** Got one: lower the hand (or change shape) before the next. */
  | { phase: "lower"; got: number }
  | { phase: "done"; samples: number[][]; reach: number }
  | { phase: "problem"; text: string };

const TEACH_STEADY_MS = 600;
const TEACH_JITTER = 0.09;
/** A shape this far from the last one counts as "lowered" (changed). */
const TEACH_CHANGED = 0.35;

/** Watches the camera while a sign is taught: three steady looks at the same shape. */
export class SignTeacher {
  samples: number[][] = [];
  private run: { t: number; shape: number[] }[] = [];
  private needLower = false;
  private goneSince = 0;
  private canned = new Map<string, number>();
  private pinches: number[] = [];
  private fists = 0;
  private opens = 0;

  constructor(private others: CustomSign[] = []) {}

  update(f: FrameIn): TeachStep {
    const got = this.samples.length;
    const h = biggest(f.hands);
    if (!h) {
      this.run = [];
      if (this.needLower) {
        this.goneSince ||= f.t;
        if (f.t - this.goneSince > 250) this.needLower = false;
        return { phase: "lower", got };
      }
      return { phase: "show", got, p: 0, hand: false };
    }
    this.goneSince = 0;
    const shape = shapeOf(h, f.aspect);
    if (this.needLower) {
      if (shapeGap(shape, this.samples[got - 1]) > TEACH_CHANGED) this.needLower = false;
      else return { phase: "lower", got };
    }
    this.run.push({ t: f.t, shape });
    while (this.run.length && f.t - this.run[0].t > TEACH_STEADY_MS + 150) this.run.shift();
    const first = this.run[0];
    const jumpy = this.run.some((r, i) => i > 0 && shapeGap(r.shape, this.run[i - 1].shape) > TEACH_JITTER) || shapeGap(first.shape, shape) > TEACH_JITTER * 1.4;
    if (jumpy) this.run = [{ t: f.t, shape }];
    const p = Math.min(1, (f.t - this.run[0].t) / TEACH_STEADY_MS);
    if (p < 1) return { phase: "show", got, p, hand: true };
    // A steady look: keep it.
    this.samples.push(meanShape(this.run.map((r) => r.shape)));
    const pose = poseOf(h, f.aspect);
    if (h.score >= 0.6) this.canned.set(h.gesture, (this.canned.get(h.gesture) ?? 0) + 1);
    this.pinches.push(pose.pinch);
    if (pose.fist) this.fists++;
    if (pose.open) this.opens++;
    this.run = [];
    this.needLower = true;
    if (this.samples.length < 3) return { phase: "lower", got: this.samples.length };
    return this.finish();
  }

  private finish(): TeachStep {
    const problem = (text: string): TeachStep => {
      this.reset();
      return { phase: "problem", text };
    };
    for (const [g, n] of this.canned) if (n >= 2 && BUILT_IN[g]) return problem(`That's ${BUILT_IN[g]} already. Try another shape, like 🤙, 🤘 or three fingers up.`);
    if (this.pinches.filter((v) => v < 0.4).length >= 2) return problem("Thumb and finger touching is a pinch (it clicks). Try a shape where they're apart.");
    if (this.fists >= 2) return problem("A fist scrolls. Try another shape, like 🤙 or three fingers up.");
    let spread = 0;
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) spread = Math.max(spread, shapeGap(this.samples[i], this.samples[j]));
    if (spread > 0.3) return problem("The three looked different. Try again, holding the same shape each time.");
    const reach = Math.min(REACH_MAX, Math.max(REACH_MIN, spread * 1.6 + 0.06));
    const mean = meanShape(this.samples);
    for (const o of this.others) {
      if (Math.min(...o.samples.map((s) => shapeGap(s, mean))) < Math.max(reach, o.reach) + 0.04) return problem(`That looks like your sign “${o.name || o.command}”. Try a different shape.`);
    }
    return { phase: "done", samples: this.samples, reach };
  }

  reset() {
    this.samples = [];
    this.run = [];
    this.needLower = false;
    this.canned.clear();
    this.pinches = [];
    this.fists = 0;
    this.opens = 0;
  }
}

function biggest(hands: HandIn[]): HandIn | null {
  let best: HandIn | null = null;
  let size = 0;
  for (const h of hands) {
    const s = Math.hypot(h.lm[27] - h.lm[0], h.lm[28] - h.lm[1]);
    if (s > size) [best, size] = [h, s];
  }
  return best;
}

// ------------------------------------------------------------- watching

export interface SignWatch {
  /** A sign being held: which, and how far along (0..1). */
  holding: { sign: CustomSign; p: number } | null;
  /** Just held long enough: do it. */
  fired: CustomSign | null;
  /** A sign of yours is up (pinches and holding-still clicks wait meanwhile). */
  active: boolean;
}

/** Watches every frame for the user's own signs. */
export class SignWatcher {
  private cand: { id: string; since: number; miss: number; wx: number; wy: number } | null = null;
  private armed = true;
  private quietUntil = 0;

  update(f: FrameIn, signs: CustomSign[]): SignWatch {
    const none: SignWatch = { holding: null, fired: null, active: false };
    if (!signs.length) {
      this.cand = null;
      return none;
    }
    let best: { sign: CustomSign; gap: number; next: number; h: HandIn } | null = null;
    for (const h of f.hands) {
      if (!free(h, f.aspect)) continue;
      const n = nearestSign(signs, shapeOf(h, f.aspect));
      if (n && n.gap < n.sign.reach && n.next - n.gap >= SIGN_MARGIN && (!best || n.gap < best.gap)) best = { ...n, h };
    }
    if (!best) {
      if (this.cand && ++this.cand.miss > SIGN_MISS) {
        this.cand = null;
        this.armed = true;
      }
      return this.cand ? { ...none, active: true } : none;
    }
    const wx = best.h.lm[0];
    const wy = best.h.lm[1];
    const c = this.cand;
    if (!c || c.id !== best.sign.id) {
      this.cand = { id: best.sign.id, since: f.t, miss: 0, wx, wy };
      if (c) this.armed = true;
    } else {
      c.miss = 0;
      // Moving about: the hold starts over from here.
      if (Math.hypot(wx - c.wx, wy - c.wy) > SIGN_STILL) Object.assign(c, { since: f.t, wx, wy });
    }
    const cand = this.cand!;
    const p = Math.min(1, (f.t - cand.since) / SIGN_HOLD_MS);
    const active = f.t - cand.since > 150;
    if (!this.armed) return { holding: null, fired: null, active };
    if (p >= 1 && f.t >= this.quietUntil) {
      this.armed = false;
      this.quietUntil = f.t + SIGN_COOLDOWN_MS;
      return { holding: null, fired: best.sign, active };
    }
    return { holding: p > 0.15 ? { sign: best.sign, p } : null, fired: null, active };
  }

  reset() {
    this.cand = null;
    this.armed = true;
  }
}
