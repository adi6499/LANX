// Air Hockey, run on the host's PC at 60 steps a second. Two paddles follow
// the players' pointers; the puck slides, bounces off the sides and the
// paddles, and scores through the gaps at each end. Player 0 defends the
// bottom goal.

export const AH_W = 400;
export const AH_H = 700;
export const PUCK_R = 14;
export const PADDLE_R = 30;
export const GOAL_W = 140;

export interface AHState {
  puck: { x: number; y: number; vx: number; vy: number };
  paddles: { x: number; y: number }[];
  goals: number[];
  /** Frames to wait before the puck is served again. */
  pause: number;
  /** Who scored last, for the board. */
  lastGoal: number;
}

export function ahStart(): AHState {
  return { puck: { x: AH_W / 2, y: AH_H / 2, vx: 0, vy: 0 }, paddles: [{ x: AH_W / 2, y: AH_H - 80 }, { x: AH_W / 2, y: 80 }], goals: [0, 0], pause: 60, lastGoal: -1 };
}

/** Where each player wants their paddle (their last pointer position). */
export function ahStep(s: AHState, targets: ({ x: number; y: number } | null)[]): number {
  // Paddles move towards their targets, staying in their own half.
  const prev = s.paddles.map((p) => ({ ...p }));
  s.paddles.forEach((pad, i) => {
    const t = targets[i];
    if (!t) return;
    const minY = i === 0 ? AH_H / 2 + PADDLE_R : PADDLE_R;
    const maxY = i === 0 ? AH_H - PADDLE_R : AH_H / 2 - PADDLE_R;
    const tx = Math.max(PADDLE_R, Math.min(AH_W - PADDLE_R, t.x));
    const ty = Math.max(minY, Math.min(maxY, t.y));
    pad.x += (tx - pad.x) * 0.45;
    pad.y += (ty - pad.y) * 0.45;
  });
  if (s.pause > 0) {
    s.pause--;
    return -1;
  }
  const k = s.puck;
  k.x += k.vx;
  k.y += k.vy;
  k.vx *= 0.995;
  k.vy *= 0.995;
  // Side walls.
  if (k.x < PUCK_R) {
    k.x = PUCK_R;
    k.vx = Math.abs(k.vx) * 0.9;
  } else if (k.x > AH_W - PUCK_R) {
    k.x = AH_W - PUCK_R;
    k.vx = -Math.abs(k.vx) * 0.9;
  }
  // Ends: goal or bounce.
  const inGoal = Math.abs(k.x - AH_W / 2) < GOAL_W / 2;
  if (k.y < PUCK_R) {
    if (inGoal && k.y < -PUCK_R) return score(s, 0);
    if (!inGoal) {
      k.y = PUCK_R;
      k.vy = Math.abs(k.vy) * 0.9;
    }
  } else if (k.y > AH_H - PUCK_R) {
    if (inGoal && k.y > AH_H + PUCK_R) return score(s, 1);
    if (!inGoal) {
      k.y = AH_H - PUCK_R;
      k.vy = -Math.abs(k.vy) * 0.9;
    }
  }
  // Paddles.
  s.paddles.forEach((pad, i) => {
    const dx = k.x - pad.x;
    const dy = k.y - pad.y;
    const d = Math.hypot(dx, dy) || 1;
    const rr = PUCK_R + PADDLE_R;
    if (d >= rr) return;
    const nx = dx / d;
    const ny = dy / d;
    k.x = pad.x + nx * rr;
    k.y = pad.y + ny * rr;
    const pvx = pad.x - prev[i].x;
    const pvy = pad.y - prev[i].y;
    const vn = k.vx * nx + k.vy * ny;
    if (vn < 0) {
      k.vx -= 2 * vn * nx;
      k.vy -= 2 * vn * ny;
    }
    k.vx += pvx * 1.2;
    k.vy += pvy * 1.2;
    const sp = Math.hypot(k.vx, k.vy);
    if (sp > 22) {
      k.vx = (k.vx / sp) * 22;
      k.vy = (k.vy / sp) * 22;
    }
  });
  return -1;
}

function score(s: AHState, p: number): number {
  s.goals[p]++;
  s.lastGoal = p;
  s.puck = { x: AH_W / 2, y: p === 0 ? AH_H / 2 - 60 : AH_H / 2 + 60, vx: 0, vy: 0 };
  s.pause = 70;
  return p;
}
