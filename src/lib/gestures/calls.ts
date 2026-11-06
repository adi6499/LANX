/** LANX 3.7.0: hands in calls and meetings. Raise your real hand (high, open,
 *  held still) to raise or lower your hand in a meeting; hold your palm up close
 *  to the camera to turn the microphone off or on; wave to end the call (LANX
 *  counts down first, and a fist stays). 👍 sends a reaction (handled with the
 *  other signs). Pure logic (no page). */
import { type FrameIn, type HandIn, poseOf } from "./interpret";

export type CallMove = "raise" | "mute" | "wave";
export interface CallWatch {
  /** Being held: which, and how far along (0..1). */
  holding: { move: "raise" | "mute"; p: number } | null;
  fired: CallMove | null;
  /** A fist is up (it cancels an ending call). */
  fist: boolean;
}

/** Hand raised: held this long, the wrist this high (picture heights from the top) and a fingertip near the top. */
const RAISE_MS = 900;
const RAISE_WRIST = 0.42;
const RAISE_TIP = 0.16;
const RAISE_STILL = 0.07;
/** Palm to the camera: this wide (picture widths), held this long. */
const MUTE_WIDE = 0.4;
const MUTE_LET_GO = 0.3;
const MUTE_MS = 600;
/** A wave: this many changes of direction, each swing at least this far, within this long. */
const WAVE_TURNS = 3;
const WAVE_SWING = 0.045;
const WAVE_MS = 1600;
const WAVE_AGAIN_MS = 4000;
/** No hand for this long: everything is ready again. */
const GONE_MS = 300;

const width = (h: HandIn) => {
  let lo = 1;
  let hi = 0;
  for (let i = 0; i < 21; i++) {
    lo = Math.min(lo, h.lm[i * 3]);
    hi = Math.max(hi, h.lm[i * 3]);
  }
  return hi - lo;
};
const topTip = (h: HandIn) => Math.min(...[4, 8, 12, 16, 20].map((i) => h.lm[i * 3 + 1]));

/** The number of changes of direction in a list of positions (ignoring wobbles smaller than `swing`). */
export function turns(xs: number[], swing: number): number {
  let n = 0;
  let dir = 0;
  let lo = xs[0];
  let hi = xs[0];
  for (const x of xs) {
    if (dir === 0) {
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
      if (hi - lo >= swing) {
        dir = x === hi ? 1 : -1;
        lo = hi = x;
      }
    } else if (dir > 0) {
      if (x > hi) hi = x;
      else if (hi - x >= swing) {
        n++;
        dir = -1;
        lo = x;
      }
    } else if (x < lo) lo = x;
    else if (x - lo >= swing) {
      n++;
      dir = 1;
      hi = x;
    }
  }
  return n;
}

export class CallWatcher {
  private raise = { since: 0, wx: 0, wy: 0, armed: true };
  private mute = { since: 0, armed: true };
  private xs: { t: number; x: number }[] = [];
  private waveAt = -Infinity;
  private goneSince = 0;

  update(f: FrameIn): CallWatch {
    const out: CallWatch = { holding: null, fired: null, fist: false };
    // The biggest open hand counts.
    let h: HandIn | null = null;
    for (const c of f.hands) {
      const pose = poseOf(c, f.aspect);
      if (pose.fist) out.fist = true;
      if (pose.open && (!h || width(c) > width(h))) h = c;
    }
    if (!h) {
      this.goneSince ||= f.t;
      if (f.t - this.goneSince > GONE_MS) {
        this.raise.armed = true;
        this.mute.armed = true;
        this.xs = [];
      }
      this.raise.since = 0;
      this.mute.since = 0;
      return out;
    }
    this.goneSince = 0;
    const wx = h.lm[0];
    const wy = h.lm[1];
    const wide = width(h);

    // Palm up close to the camera: microphone off / on.
    if (wide >= MUTE_WIDE) {
      this.mute.since ||= f.t;
      const p = Math.min(1, (f.t - this.mute.since) / MUTE_MS);
      if (this.mute.armed) {
        if (p >= 1) {
          this.mute.armed = false;
          out.fired = "mute";
        } else out.holding = { move: "mute", p };
      }
      this.raise.since = 0;
      this.xs = [];
      return out;
    }
    this.mute.since = 0;
    if (wide < MUTE_LET_GO) this.mute.armed = true;

    // Waving: the wrist swinging side to side.
    if (wy < 0.7) {
      this.xs.push({ t: f.t, x: wx });
      while (this.xs.length && f.t - this.xs[0].t > WAVE_MS) this.xs.shift();
      if (f.t - this.waveAt > WAVE_AGAIN_MS && turns(this.xs.map((s) => s.x), WAVE_SWING) >= WAVE_TURNS) {
        this.waveAt = f.t;
        this.xs = [];
        this.raise.since = 0;
        out.fired = "wave";
        return out;
      }
    } else this.xs = [];

    // A hand raised high and held still.
    const high = wy < RAISE_WRIST && topTip(h) < RAISE_TIP;
    if (!high) {
      this.raise.since = 0;
      if (wy > RAISE_WRIST + 0.08) this.raise.armed = true;
      return out;
    }
    if (!this.raise.since || Math.hypot(wx - this.raise.wx, wy - this.raise.wy) > RAISE_STILL) Object.assign(this.raise, { since: f.t, wx, wy });
    const p = Math.min(1, (f.t - this.raise.since) / RAISE_MS);
    if (this.raise.armed) {
      if (p >= 1) {
        this.raise.armed = false;
        out.fired = "raise";
      } else if (p > 0.2) out.holding = { move: "raise", p };
    }
    return out;
  }

  reset() {
    this.raise = { since: 0, wx: 0, wy: 0, armed: true };
    this.mute = { since: 0, armed: true };
    this.xs = [];
  }
}
