// Table Soccer, run on the host's PC at 60 steps a second. Each side has
// four rods (goalie 1, defence 2, midfield 5, attack 3); a player moves one
// rod at a time up and down with the pointer and kicks with a click. The
// ball rolls, bounces off the sides, and goes in through the goal mouths.
// Player 0's goal is on the left. LANX 2.17.0: after a goal the ball is
// served towards the side that let it in, and a ball that stays (almost)
// still for two seconds — stuck between rods, out of everyone's reach — is
// served again from the middle.

export const FB_W = 700;
export const FB_H = 400;
export const BALL_R = 9;
export const MAN_W = 14;
export const MAN_H = 34;
export const GOAL_H = 120;

/** Rod x positions for side 0 (left); side 1 mirrors them. Men per rod. */
export const RODS: { x: number; men: number }[] = [
  { x: 60, men: 1 },
  { x: 150, men: 2 },
  { x: 330, men: 5 },
  { x: 500, men: 3 },
];

export interface FBState {
  ball: { x: number; y: number; vx: number; vy: number };
  /** rodY[side][rod]: the rod's offset (centre of its men), and kick frames left. */
  rodY: number[][];
  kick: number[][];
  goals: number[];
  pause: number;
  lastGoal: number;
  /** Steps the ball has been (almost) still, and serves so far (they alternate sides). */
  slow: number;
  serves: number;
}

/** Steps a still ball waits before it is served again (two seconds at 60 a second). */
export const STUCK_STEPS = 120;
const SLOW = 0.35;

/** The ball from the centre spot, rolling towards `side`'s half (0 = left). */
function serve(s: FBState, side: number) {
  s.serves++;
  s.ball = { x: FB_W / 2, y: FB_H / 2, vx: side === 0 ? -2.2 : 2.2, vy: s.serves % 2 ? 0.6 : -0.6 };
  s.slow = 0;
}

/** A fresh table (or, with the goals so far, the table again after the board reopened). */
export function fbStart(goals: number[] = [0, 0]): FBState {
  const s: FBState = { ball: { x: FB_W / 2, y: FB_H / 2, vx: 0, vy: 0 }, rodY: [RODS.map(() => FB_H / 2), RODS.map(() => FB_H / 2)], kick: [RODS.map(() => 0), RODS.map(() => 0)], goals: [goals[0] ?? 0, goals[1] ?? 0], pause: 60, lastGoal: -1, slow: 0, serves: 0 };
  serve(s, (s.goals[0] + s.goals[1]) % 2);
  return s;
}

export interface FBInput {
  rod: number;
  y: number;
  kick: boolean;
}

/** The men of a rod: their centre positions for this rod offset. */
export function menOf(side: number, rod: number, y: number): { x: number; y: number }[] {
  const r = RODS[rod];
  const x = side === 0 ? r.x : FB_W - r.x;
  const spread = r.men === 1 ? 0 : (FB_H - 100) / r.men;
  return Array.from({ length: r.men }, (_, k) => ({ x, y: y + (k - (r.men - 1) / 2) * spread }));
}

export function fbStep(s: FBState, inputs: (FBInput | null)[]): number {
  inputs.forEach((inp, side) => {
    if (!inp) return;
    const rod = Math.max(0, Math.min(RODS.length - 1, inp.rod));
    const r = RODS[rod];
    const spread = r.men === 1 ? 0 : (FB_H - 100) / r.men;
    const half = ((r.men - 1) / 2) * spread + MAN_H / 2;
    const ty = Math.max(half, Math.min(FB_H - half, inp.y));
    s.rodY[side][rod] += (ty - s.rodY[side][rod]) * 0.5;
    if (inp.kick && s.kick[side][rod] === 0) s.kick[side][rod] = 8;
  });
  for (const side of [0, 1]) for (let r = 0; r < RODS.length; r++) if (s.kick[side][r] > 0) s.kick[side][r]--;
  if (s.pause > 0) {
    s.pause--;
    return -1;
  }
  const b = s.ball;
  b.x += b.vx;
  b.y += b.vy;
  b.vx *= 0.992;
  b.vy *= 0.992;
  // Stuck (between rods, out of reach): serve it again from the middle, to each side in turn.
  s.slow = Math.hypot(b.vx, b.vy) < SLOW ? (s.slow ?? 0) + 1 : 0;
  if (s.slow >= STUCK_STEPS) {
    serve(s, (s.serves ?? 0) % 2);
    s.pause = 30;
    return -1;
  }
  if (b.y < BALL_R) {
    b.y = BALL_R;
    b.vy = Math.abs(b.vy) * 0.85;
  } else if (b.y > FB_H - BALL_R) {
    b.y = FB_H - BALL_R;
    b.vy = -Math.abs(b.vy) * 0.85;
  }
  const inGoal = Math.abs(b.y - FB_H / 2) < GOAL_H / 2;
  if (b.x < BALL_R) {
    if (inGoal && b.x < -BALL_R) return score(s, 1);
    if (!inGoal) {
      b.x = BALL_R;
      b.vx = Math.abs(b.vx) * 0.85;
    }
  } else if (b.x > FB_W - BALL_R) {
    if (inGoal && b.x > FB_W + BALL_R) return score(s, 0);
    if (!inGoal) {
      b.x = FB_W - BALL_R;
      b.vx = -Math.abs(b.vx) * 0.85;
    }
  }
  // Men: block and kick.
  for (const side of [0, 1]) {
    for (let r = 0; r < RODS.length; r++) {
      for (const m of menOf(side, r, s.rodY[side][r])) {
        const dx = b.x - m.x;
        const dy = b.y - m.y;
        if (Math.abs(dx) > MAN_W / 2 + BALL_R || Math.abs(dy) > MAN_H / 2 + BALL_R) continue;
        const dir = side === 0 ? 1 : -1;
        const kicking = s.kick[side][r] > 0;
        b.x = m.x + dir * (MAN_W / 2 + BALL_R);
        b.vx = kicking ? dir * 16 : Math.abs(b.vx) * 0.6 * dir;
        b.vy += dy * 0.08;
      }
    }
  }
  return -1;
}

function score(s: FBState, p: number): number {
  s.goals[p]++;
  s.lastGoal = p;
  // Kick-off for the side that let the goal in: towards their half.
  serve(s, 1 - p);
  s.pause = 70;
  return p;
}
