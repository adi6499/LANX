// A small, exact 2-D table physics for the billiard-style games (8-ball,
// carrom, mini golf): round pieces that slide with friction, bounce off
// straight walls and each other, and drop into pockets. Everything runs in
// whole numbers (positions in thousandths) with a fixed step, so every PC
// computes the very same result from the same shot — no floating-point
// drift between machines.

export interface Body {
  id: number;
  x: number; // thousandths
  y: number;
  vx: number; // thousandths per step
  vy: number;
  r: number;
  mass: number;
  /** Dropped into a pocket (or the hole). */
  out: boolean;
  /** A wall the piece cannot pass (for the golf hole's marker, say). */
  fixed?: boolean;
  /** LANX 2.16.0, the cue ball only: top spin (+, follow) or back spin (−, draw), −1000…1000;
   *  used up at its first contact with another ball. Absent or 0 = no spin (older shots unchanged). */
  follow?: number;
  /** LANX 2.16.0: side spin (english), −1000 (left) … 1000 (right); bends each cushion bounce, halving each time. */
  side?: number;
}

export interface Wall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Pocket {
  x: number;
  y: number;
  r: number;
}

export interface Table {
  walls: Wall[];
  pockets: Pocket[];
  /** Speed lost per step, in thousandths (e.g. 12 = 1.2 % per step). */
  friction: number;
  /** Below this speed a piece stops. */
  stop: number;
  /** Bounce keeps this share of speed (thousandths). */
  bounce: number;
  /** A piece faster than this skips over a pocket (the golf cup's lip); unset = any speed drops. */
  pocketMaxSpeed?: number;
}

export const K = 1000;
const isqrt = (n: number) => Math.floor(Math.sqrt(Math.max(0, n)));

export interface StepEvent {
  kind: "pocket" | "hit" | "wall";
  a: number;
  b?: number;
  /** The step it happened at (settle fills it in). */
  t?: number;
  /** How hard (speed into the wall / closing speed), for the sound. */
  v?: number;
}

/** Advances every body one step; returns what happened. */
export function step(bodies: Body[], t: Table): StepEvent[] {
  const ev: StepEvent[] = [];
  // Move and apply friction.
  for (const b of bodies) {
    if (b.out || b.fixed) continue;
    b.x += Math.trunc(b.vx / 100);
    b.y += Math.trunc(b.vy / 100);
    // Friction always takes at least one unit, so a slow piece really stops.
    b.vx -= Math.sign(b.vx) * Math.max(1, Math.trunc((Math.abs(b.vx) * t.friction) / K));
    b.vy -= Math.sign(b.vy) * Math.max(1, Math.trunc((Math.abs(b.vy) * t.friction) / K));
    if (Math.abs(b.vx) < t.stop && Math.abs(b.vy) < t.stop) {
      b.vx = 0;
      b.vy = 0;
    }
  }
  // Walls.
  for (const b of bodies) {
    if (b.out || b.fixed) continue;
    for (const w of t.walls) {
      const dx = w.x2 - w.x1;
      const dy = w.y2 - w.y1;
      const len2 = dx * dx + dy * dy || 1;
      // Nearest point on the segment.
      let u = ((b.x - w.x1) * dx + (b.y - w.y1) * dy) / len2;
      u = Math.max(0, Math.min(1, u));
      const px = w.x1 + Math.trunc(dx * u);
      const py = w.y1 + Math.trunc(dy * u);
      const ox = b.x - px;
      const oy = b.y - py;
      const d2 = ox * ox + oy * oy;
      if (d2 >= b.r * b.r || d2 === 0) continue;
      const d = isqrt(d2) || 1;
      // Push out along the normal and reflect the velocity.
      const nx = Math.trunc((ox * K) / d);
      const ny = Math.trunc((oy * K) / d);
      const pen = b.r - d;
      b.x += Math.trunc((nx * pen) / K);
      b.y += Math.trunc((ny * pen) / K);
      const vn = Math.trunc((b.vx * nx + b.vy * ny) / K);
      if (vn < 0) {
        const preX = b.vx;
        const preY = b.vy;
        b.vx -= Math.trunc((2 * vn * nx) / K);
        b.vy -= Math.trunc((2 * vn * ny) / K);
        b.vx = Math.trunc((b.vx * t.bounce) / K);
        b.vy = Math.trunc((b.vy * t.bounce) / K);
        if (b.side) {
          // English: the cushion throws the ball along the rail, towards the side it was struck on.
          const rx = -preY;
          const ry = preX;
          const rn = Math.trunc((rx * nx + ry * ny) / K);
          const tx = rx - Math.trunc((rn * nx) / K);
          const ty = ry - Math.trunc((rn * ny) / K);
          const tl = isqrt(tx * tx + ty * ty) || 1;
          const push = Math.trunc((Math.abs(vn) * b.side) / (2 * K));
          b.vx += Math.trunc((tx * push) / tl);
          b.vy += Math.trunc((ty * push) / tl);
          b.side = Math.trunc(b.side / 2);
        }
        ev.push({ kind: "wall", a: b.id, v: -vn });
      }
    }
  }
  // Pieces against each other (fixed order → the same everywhere).
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    if (a.out) continue;
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      if (b.out) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const rr = a.r + b.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr) continue;
      const d = isqrt(d2) || 1;
      const nx = Math.trunc((dx * K) / d);
      const ny = Math.trunc((dy * K) / d);
      // Separate.
      const pen = rr - d;
      if (!a.fixed) {
        a.x -= Math.trunc((nx * pen) / (2 * K));
        a.y -= Math.trunc((ny * pen) / (2 * K));
      }
      if (!b.fixed) {
        b.x += Math.trunc((nx * pen) / (2 * K));
        b.y += Math.trunc((ny * pen) / (2 * K));
      }
      // Exchange the normal part of the velocities (equal-mass elastic; masses weight it).
      const va = Math.trunc((a.vx * nx + a.vy * ny) / K);
      const vb = Math.trunc((b.vx * nx + b.vy * ny) / K);
      if (va - vb <= 0) continue; // moving apart
      const pre = [a.vx, a.vy, b.vx, b.vy];
      const ma = a.fixed ? 1_000_000 : a.mass;
      const mb = b.fixed ? 1_000_000 : b.mass;
      const total = ma + mb;
      const vaNew = Math.trunc((va * (ma - mb) + 2 * mb * vb) / total);
      const vbNew = Math.trunc((vb * (mb - ma) + 2 * ma * va) / total);
      if (!a.fixed) {
        a.vx += Math.trunc(((vaNew - va) * nx) / K);
        a.vy += Math.trunc(((vaNew - va) * ny) / K);
      }
      if (!b.fixed) {
        b.vx += Math.trunc(((vbNew - vb) * nx) / K);
        b.vy += Math.trunc(((vbNew - vb) * ny) / K);
      }
      // Top or back spin: after its first contact the cue ball follows on or draws back along its line.
      if (a.follow) followThrough(a, pre[0], pre[1]);
      if (b.follow) followThrough(b, pre[2], pre[3]);
      ev.push({ kind: "hit", a: a.id, b: b.id, v: va - vb });
    }
  }
  // Pockets.
  for (const b of bodies) {
    if (b.out || b.fixed) continue;
    if (t.pocketMaxSpeed !== undefined && Math.abs(b.vx) + Math.abs(b.vy) > t.pocketMaxSpeed) continue;
    for (const p of t.pockets) {
      const dx = b.x - p.x;
      const dy = b.y - p.y;
      if (dx * dx + dy * dy < p.r * p.r) {
        b.out = true;
        b.vx = 0;
        b.vy = 0;
        ev.push({ kind: "pocket", a: b.id });
        break;
      }
    }
  }
  return ev;
}

function followThrough(c: Body, preX: number, preY: number) {
  const sp = isqrt(preX * preX + preY * preY) || 1;
  const gain = Math.trunc((sp * (c.follow ?? 0) * 7) / (10 * K));
  c.vx += Math.trunc((preX * gain) / sp);
  c.vy += Math.trunc((preY * gain) / sp);
  c.follow = 0;
}

export const moving = (bodies: Body[]) => bodies.some((b) => !b.out && (b.vx !== 0 || b.vy !== 0));

/** Runs the table until everything stops (or the step cap), collecting events and the frames for an animation. */
export function settle(bodies: Body[], t: Table, maxSteps = 3000, keepFrames = 0): { events: StepEvent[]; frames: { x: number; y: number; out: boolean }[][] } {
  const events: StepEvent[] = [];
  const frames: { x: number; y: number; out: boolean }[][] = [];
  for (let k = 0; k < maxSteps && moving(bodies); k++) {
    for (const e of step(bodies, t)) {
      e.t = k;
      events.push(e);
    }
    if (keepFrames && k % keepFrames === 0) frames.push(bodies.map((b) => ({ x: b.x, y: b.y, out: b.out })));
  }
  frames.push(bodies.map((b) => ({ x: b.x, y: b.y, out: b.out })));
  return { events, frames };
}

/** A rectangle of walls, inset so the pieces bounce on the cushions. */
export function rectWalls(x1: number, y1: number, x2: number, y2: number): Wall[] {
  return [
    { x1, y1, x2, y2: y1 },
    { x1: x2, y1, x2, y2 },
    { x1: x2, y1: y2, x2: x1, y2 },
    { x1, y1: y2, x2: x1, y2: y1 },
  ];
}

/** A velocity from an angle (degrees, integer) and a speed, using a sine table so every PC agrees. */
const SIN: number[] = [];
for (let a = 0; a < 360; a++) SIN.push(Math.round(Math.sin((a * Math.PI) / 180) * K));
export function velocity(angleDeg: number, speed: number): [number, number] {
  const a = ((Math.round(angleDeg) % 360) + 360) % 360;
  return [Math.trunc((SIN[(a + 90) % 360] * speed) / K), Math.trunc((SIN[a] * speed) / K)];
}
