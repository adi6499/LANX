// Spinner Wars, run on the host's PC at 60 steps a second: everyone's
// spinner in a round arena; push towards the pointer, bump into the others;
// whoever leaves the arena is out, the last one in wins the round. First to
// two round wins (lib/games/realtime: spinnerChampion).

export const ARENA_R = 230;
export const SPIN_R = 22;

export interface SpinState {
  spinners: { x: number; y: number; vx: number; vy: number; out: boolean; spin: number }[];
  round: number;
  pause: number;
  wins: number[];
}

/** A fresh arena — or (2.17.0) the arena again from the record: round wins so far, the round under
 *  way and who is already out of it. */
export function spinStart(n: number, from?: { wins: number[]; rounds: number; out: boolean[] }): SpinState {
  const s: SpinState = { spinners: place(n), round: (from?.rounds ?? 0) + 1, pause: 90, wins: from ? [...from.wins] : Array(n).fill(0) };
  from?.out.forEach((o, i) => o && s.spinners[i] && (s.spinners[i].out = true));
  return s;
}

function place(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: Math.cos(a) * ARENA_R * 0.6, y: Math.sin(a) * ARENA_R * 0.6, vx: 0, vy: 0, out: false, spin: 100 };
  });
}

export function spinReset(s: SpinState) {
  s.spinners = place(s.spinners.length);
  s.round++;
  s.pause = 90;
}

/** inputs[i] = the direction the player pushes (unit-ish vector) or null. Returns players knocked out this step. */
export function spinStep(s: SpinState, inputs: ({ x: number; y: number } | null)[]): number[] {
  const outs: number[] = [];
  if (s.pause > 0) {
    s.pause--;
    return outs;
  }
  s.spinners.forEach((sp, i) => {
    if (sp.out) return;
    const inp = inputs[i];
    if (inp) {
      const d = Math.hypot(inp.x, inp.y) || 1;
      sp.vx += (inp.x / d) * 0.35;
      sp.vy += (inp.y / d) * 0.35;
    }
    sp.vx *= 0.985;
    sp.vy *= 0.985;
    sp.x += sp.vx;
    sp.y += sp.vy;
    sp.spin = Math.max(0, sp.spin - 0.02);
  });
  // Bumps.
  for (let i = 0; i < s.spinners.length; i++) {
    const a = s.spinners[i];
    if (a.out) continue;
    for (let j = i + 1; j < s.spinners.length; j++) {
      const b = s.spinners[j];
      if (b.out) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d >= SPIN_R * 2) continue;
      const nx = dx / d;
      const ny = dy / d;
      const pen = SPIN_R * 2 - d;
      a.x -= (nx * pen) / 2;
      a.y -= (ny * pen) / 2;
      b.x += (nx * pen) / 2;
      b.y += (ny * pen) / 2;
      const va = a.vx * nx + a.vy * ny;
      const vb = b.vx * nx + b.vy * ny;
      const push = 1.15;
      a.vx += (vb - va) * nx * push;
      a.vy += (vb - va) * ny * push;
      b.vx += (va - vb) * nx * push;
      b.vy += (va - vb) * ny * push;
      a.spin = Math.max(0, a.spin - 4);
      b.spin = Math.max(0, b.spin - 4);
    }
  }
  s.spinners.forEach((sp, i) => {
    if (sp.out) return;
    if (Math.hypot(sp.x, sp.y) > ARENA_R + SPIN_R || sp.spin <= 0) {
      sp.out = true;
      outs.push(i);
    }
  });
  return outs;
}
