// LANX 2.16.0: 8-Ball Pool in 3D — a proper table (felt, cushions, wooden
// rails with sights, six pockets), numbered balls that roll with real spin,
// a cue you aim with the mouse and pull back for power, a guide that shows
// the first ball you will hit, and cue-ball spin (follow, draw, english).
//
// The shot itself is the rules' own billiard physics (lib/games/physics2d,
// whole numbers, the same on every PC): the board plays back exactly the
// path the rules computed, so what you see is what scored.

import * as THREE from "three";
import { useEffect, useMemo, useRef, useState } from "react";
import { seatFor, type BoardProps } from "../../boardProps";
import { POOL_BALL_R, POOL_H, POOL_W, ownBallsLeft, pool, poolSimulate, type PoolState } from "../../../../lib/games/pool.ts";
import { K, type Body } from "../../../../lib/games/physics2d.ts";
import { sfx } from "../../../../lib/gameSounds";
import { useTableCaps } from "../../caps";
import { TurnScene } from "../turnScene";
import { canvasTexture, felt, mesh, sharedGeo, slab, wood } from "../kit";
import { SceneBox, useScene } from "../Board3D";
import { BoardBar, HiddenActions, primary3, quiet3 } from "../ui";
import { easeIn, easeOut, linear } from "../stage";

const S = 100; // table units per world unit
const BED = 0.5; // felt height
const R = POOL_BALL_R / S; // ball radius (world)
const BALL_Y = BED + R;
const W = POOL_W / S;
const H = POOL_H / S;
const RAIL = 0.48;
const CUSHION = 0.15;
const POCKETS: [number, number][] = [
  [8, 8],
  [POOL_W / 2, 2],
  [POOL_W - 8, 8],
  [8, POOL_H - 8],
  [POOL_W / 2, POOL_H - 2],
  [POOL_W - 8, POOL_H - 8],
];
const POCKET_R = 0.23;

const COLOUR: Record<number, string> = { 1: "#f5c518", 2: "#1d4ed8", 3: "#dc2626", 4: "#6d28d9", 5: "#f97316", 6: "#15803d", 7: "#7f1d1d", 8: "#111827" };
const colourOf = (id: number) => COLOUR[id > 8 ? id - 8 : id] ?? "#f8fafc";

/** Table point (units, not thousandths) → world. */
const world = (tx: number, ty: number, y = BALL_Y) => new THREE.Vector3(tx / S - W / 2, y, ty / S - H / 2);
const toTable = (v: THREE.Vector3): [number, number] => [(v.x + W / 2) * S, (v.z + H / 2) * S];

/** A pool ball's picture: wrapped round the sphere (numbers on two sides; stripes are a band). */
function ballTexture(id: number) {
  return canvasTexture(512, 256, (ctx, w, h) => {
    const c = colourOf(id);
    ctx.fillStyle = id === 0 ? "#fbfaf5" : id >= 9 ? "#fbfaf5" : c;
    ctx.fillRect(0, 0, w, h);
    if (id >= 9) {
      ctx.fillStyle = c;
      ctx.fillRect(0, h * 0.27, w, h * 0.46);
    }
    if (id === 0) {
      // The cue ball: a small spot so you can see it roll.
      ctx.fillStyle = "#dc2626";
      for (const u of [0.25, 0.75]) {
        ctx.beginPath();
        ctx.ellipse(u * w, h / 2, 10, 10, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    for (const u of [0.25, 0.75]) {
      ctx.fillStyle = "#fbfaf5";
      ctx.beginPath();
      ctx.ellipse(u * w, h / 2, 40, 44, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#111827";
      ctx.font = `800 ${id >= 10 ? 46 : 52}px "Plus Jakarta Sans", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(id), u * w, h / 2 + 3);
    }
  });
}

function cueGeometry(): THREE.Group {
  const g = new THREE.Group();
  const L = 4.4;
  const part = (y0: number, y1: number, r0: number, r1: number, mat: THREE.Material) => {
    const m = mesh(new THREE.CylinderGeometry(r1, r0, y1 - y0, 20), mat);
    m.position.y = (y0 + y1) / 2;
    g.add(m);
  };
  part(0, 0.012, 0.0115, 0.0115, new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.9 }));
  part(0.012, 0.05, 0.0118, 0.0122, new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 }));
  part(0.05, L * 0.62, 0.0122, 0.019, wood("light", 1));
  part(L * 0.62, L * 0.66, 0.019, 0.0195, new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5 }));
  part(L * 0.66, L * 0.86, 0.0195, 0.024, new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.8 }));
  part(L * 0.86, L, 0.024, 0.026, wood("dark", 1));
  // Lay it along +X, tip at the origin.
  g.rotation.z = -Math.PI / 2;
  const holder = new THREE.Group();
  holder.add(g);
  return holder;
}

/** The first thing the cue ball would touch going this way: a ball (with the ghost-ball spot) or a cushion. */
function guide(balls: Body[], angleDeg: number): { end: [number, number]; ball: Body | null } {
  const cue = balls[0];
  const cx = cue.x / K;
  const cy = cue.y / K;
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const r = POOL_BALL_R;
  let t = Infinity;
  if (dx > 1e-6) t = Math.min(t, (POOL_W - r - cx) / dx);
  if (dx < -1e-6) t = Math.min(t, (r - cx) / dx);
  if (dy > 1e-6) t = Math.min(t, (POOL_H - r - cy) / dy);
  if (dy < -1e-6) t = Math.min(t, (r - cy) / dy);
  let hit: Body | null = null;
  for (const b of balls) {
    if (b.id === 0 || b.out) continue;
    const bx = b.x / K - cx;
    const by = b.y / K - cy;
    const proj = bx * dx + by * dy;
    if (proj <= 0) continue;
    const perp2 = bx * bx + by * by - proj * proj;
    if (perp2 >= 4 * r * r) continue;
    const tb = proj - Math.sqrt(4 * r * r - perp2);
    if (tb < t) {
      t = tb;
      hit = b;
    }
  }
  t = Math.max(0, t);
  return { end: [cx + dx * t, cy + dy * t], ball: hit };
}

interface PoolTurn {
  canPlay: boolean;
  inHand: boolean;
  power: number;
  onAim: (angle: number) => void;
  onShoot: (angle: number, power: number) => void;
  onPlace: (x: number, y: number) => void;
  onPower: (p: number) => void;
}

class PoolScene extends TurnScene<PoolState> {
  private balls = new Map<number, THREE.Mesh>();
  private cue: THREE.Group;
  private aimLine: THREE.Line;
  private objLine: THREE.Line;
  private ghost: THREE.Mesh;
  private placeBall: THREE.Mesh;
  private info: PoolTurn | null = null;
  private angle = 0;
  private pull: { start: THREE.Vector3; power: number } | null = null;
  private current: PoolState | null = null;

  constructor(host: HTMLElement) {
    super(host, { fov: 26 });
    const s = this.stage;
    s.scene.add(this.buildTable());
    // Balls.
    const geo = sharedGeo("poolball", () => new THREE.SphereGeometry(R, 40, 28));
    for (let id = 0; id <= 15; id++) {
      const m = mesh(geo, new THREE.MeshPhysicalMaterial({ map: ballTexture(id), roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08 }));
      m.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, (id * 0.7) % (Math.PI * 2), 0, "YXZ"));
      s.scene.add(m);
      this.balls.set(id, m);
    }
    // The cue, the aiming guide, the ghost ball, the ball you place.
    this.cue = cueGeometry();
    this.cue.visible = false;
    s.scene.add(this.cue);
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false });
    this.aimLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), lineMat);
    this.objLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), lineMat.clone());
    this.ghost = new THREE.Mesh(new THREE.RingGeometry(R * 0.86, R, 36), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    this.ghost.rotation.x = -Math.PI / 2;
    this.placeBall = mesh(geo, new THREE.MeshPhysicalMaterial({ map: ballTexture(0), roughness: 0.2, transparent: true, opacity: 0.6, clearcoat: 1 }));
    for (const o of [this.aimLine, this.objLine, this.ghost, this.placeBall]) {
      o.visible = false;
      o.renderOrder = 3;
      s.scene.add(o);
    }
    s.onPointerMove = () => this.pointer();
    s.onPointerDown = (e) => this.press(e);
    s.onPointerUp = () => this.release();
    s.frame(new THREE.Box3(new THREE.Vector3(-W / 2 - RAIL - CUSHION, 0, -H / 2 - RAIL - CUSHION), new THREE.Vector3(W / 2 + RAIL + CUSHION, BED + 0.2, H / 2 + RAIL + CUSHION)), [0, 2.6, 1], 1.02);
  }

  private buildTable(): THREE.Group {
    const t = new THREE.Group();
    const cloth = felt("#16704a");
    // The bed: felt with six holes, and a dark pocket under each.
    const shape = new THREE.Shape();
    const x0 = -W / 2 - CUSHION;
    const x1 = W / 2 + CUSHION;
    const z0 = -H / 2 - CUSHION;
    const z1 = H / 2 + CUSHION;
    shape.moveTo(x0, -z0);
    shape.lineTo(x1, -z0);
    shape.lineTo(x1, -z1);
    shape.lineTo(x0, -z1);
    shape.lineTo(x0, -z0);
    for (const [px, py] of POCKETS) {
      const c = world(px, py);
      const hole = new THREE.Path();
      hole.absarc(c.x, -c.z, POCKET_R, 0, Math.PI * 2, true);
      shape.holes.push(hole);
    }
    const bed = mesh(new THREE.ShapeGeometry(shape, 24), cloth);
    bed.rotation.x = -Math.PI / 2;
    bed.position.y = BED;
    bed.castShadow = false;
    t.add(bed);
    const dark = new THREE.MeshStandardMaterial({ color: 0x07090c, roughness: 1, side: THREE.DoubleSide });
    for (const [px, py] of POCKETS) {
      const c = world(px, py, BED);
      const liner = mesh(new THREE.CylinderGeometry(POCKET_R, POCKET_R * 0.85, 0.45, 28, 1, true), dark, false);
      liner.position.set(c.x, BED - 0.225, c.z);
      t.add(liner);
      const bottom = mesh(new THREE.CircleGeometry(POCKET_R, 28), dark, false);
      bottom.rotation.x = -Math.PI / 2;
      bottom.position.set(c.x, BED - 0.44, c.z);
      t.add(bottom);
    }
    // Cushions between the pockets (their nose is the playing edge).
    const rubber = felt("#135f3f");
    const gap = 0.33;
    const runs: [number, number, number, number][] = [
      // x from, x to, z, outward sign (z)
      [-W / 2 + gap, -gap * 0.72, -H / 2 - CUSHION / 2, 0],
      [gap * 0.72, W / 2 - gap, -H / 2 - CUSHION / 2, 0],
      [-W / 2 + gap, -gap * 0.72, H / 2 + CUSHION / 2, 0],
      [gap * 0.72, W / 2 - gap, H / 2 + CUSHION / 2, 0],
    ];
    for (const [a, b, z] of runs) {
      const c = mesh(slab(b - a, 0.14, CUSHION, 0.03), rubber);
      c.position.set((a + b) / 2, BED, z);
      t.add(c);
    }
    for (const sx of [-1, 1]) {
      const c = mesh(slab(CUSHION, 0.14, H - 2 * gap, 0.03), rubber);
      c.position.set(sx * (W / 2 + CUSHION / 2), BED, 0);
      t.add(c);
    }
    // Wooden rails and the body.
    const rail = wood("walnut", 3);
    const outerW = W + 2 * (CUSHION + RAIL);
    const outerH = H + 2 * (CUSHION + RAIL);
    for (const sz of [-1, 1]) {
      const r = mesh(slab(outerW, 0.17, RAIL, 0.05), rail);
      r.position.set(0, BED, sz * (H / 2 + CUSHION + RAIL / 2));
      t.add(r);
    }
    for (const sx of [-1, 1]) {
      const r = mesh(slab(RAIL, 0.17, H + 2 * CUSHION, 0.05), rail);
      r.position.set(sx * (W / 2 + CUSHION + RAIL / 2), BED, 0);
      t.add(r);
    }
    // The body: a skirt under the rails and a dark floor far below the pockets.
    const skirt = wood("dark", 2);
    for (const sz of [-1, 1]) {
      const k = mesh(slab(outerW - 0.12, BED - 0.06, 0.1, 0.03), skirt);
      k.position.set(0, 0.06, sz * (outerH / 2 - 0.12));
      t.add(k);
    }
    for (const sx of [-1, 1]) {
      const k = mesh(slab(0.1, BED - 0.06, outerH - 0.12, 0.03), skirt);
      k.position.set(sx * (outerW / 2 - 0.12), 0.06, 0);
      t.add(k);
    }
    const floor = mesh(slab(outerW - 0.2, 0.04, outerH - 0.2, 0.02), new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 1 }), false);
    t.add(floor);
    // Sights (diamonds) on the rails.
    const pearl = new THREE.MeshStandardMaterial({ color: 0xf5f0e6, roughness: 0.35 });
    const dia = new THREE.CircleGeometry(0.035, 4);
    for (let k = 1; k < 8; k++) {
      if (k === 4) continue;
      for (const sz of [-1, 1]) {
        const d = mesh(dia, pearl, false);
        d.rotation.x = -Math.PI / 2;
        d.position.set(-W / 2 + (k * W) / 8, BED + 0.172, sz * (H / 2 + CUSHION + RAIL / 2));
        t.add(d);
      }
    }
    for (let k = 1; k < 4; k++) {
      for (const sx of [-1, 1]) {
        const d = mesh(dia, pearl, false);
        d.rotation.x = -Math.PI / 2;
        d.position.set(sx * (W / 2 + CUSHION + RAIL / 2), BED + 0.172, -H / 2 + (k * H) / 4);
        t.add(d);
      }
    }
    return t;
  }

  setTurn(info: PoolTurn) {
    this.info = info;
    this.refreshAim();
  }

  protected replay(moves: string[]) {
    return pool.replay(moves, 2, "");
  }

  protected snap(s: PoolState) {
    this.current = s;
    for (const b of s.balls) {
      const m = this.balls.get(b.id)!;
      m.visible = !b.out;
      m.position.copy(world(b.x / K, b.y / K));
      m.scale.setScalar(1);
    }
    this.refreshAim();
  }

  protected idle() {
    this.refreshAim();
  }

  /** Rolls a ball by a step on the table: it turns about the axis across its path. */
  private roll(m: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3) {
    const d = to.clone().sub(from);
    d.y = 0;
    const dist = d.length();
    if (dist < 1e-6) return;
    const axis = new THREE.Vector3(0, 1, 0).cross(d).normalize();
    m.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, dist / R));
  }

  protected async animateStep(before: PoolState, _after: PoolState, move: string) {
    this.hideAim();
    const place = /^c:(\d+):(\d+)$/.exec(move);
    if (place) {
      const m = this.balls.get(0)!;
      m.visible = true;
      const end = world(Number(place[1]), Number(place[2]));
      const start = end.clone().setY(BALL_Y + 0.5);
      await this.stage.animate(260, (k) => m.position.lerpVectors(start, end, k), easeIn);
      sfx("thud", 0.4);
      return;
    }
    const mv = /^s:(-?\d+):(\d+)(?::(-?\d+):(-?\d+))?$/.exec(move);
    if (!mv) return;
    const angle = Number(mv[1]);
    const power = Math.max(1, Math.min(100, Number(mv[2])));
    const side = Number(mv[3] ?? 0);
    const top = Number(mv[4] ?? 0);
    const sim = poolSimulate(before.balls, angle, power, side, top);
    // The cue draws back and strikes.
    const cueBall = this.balls.get(0)!;
    this.cue.visible = true;
    const back = 0.08 + power / 220;
    await this.stage.animate(300, (k) => this.placeCue(cueBall.position, angle, 0.04 + back * k), easeOut);
    await this.stage.animate(Math.max(60, 140 - power), (k) => this.placeCue(cueBall.position, angle, 0.04 + back * (1 - k)), easeIn);
    sfx("clack", 0.5 + power / 200);
    const cueStart = cueBall.position.clone();
    void this.stage.animate(350, (k) => {
      this.placeCue(cueStart, angle, 0.02 + k * 0.6);
    }).then(() => {
      this.cue.visible = false;
    });
    // Play back the rules' own path: 62.5 frames a second (each frame is five physics steps).
    const frames = sim.frames;
    const ids = before.balls.map((b) => b.id);
    const sunk = new Map<number, number>(); // ball → frame it dropped
    const pocketOf = (x: number, y: number) => {
      let best = POCKETS[0];
      let bd = Infinity;
      for (const p of POCKETS) {
        const d = (p[0] - x) ** 2 + (p[1] - y) ** 2;
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      return best;
    };
    let ev = 0;
    const events = sim.events;
    const total = frames.length;
    const last = before.balls.map((b) => world(b.x / K, b.y / K));
    await this.stage.animate(
      (total / 62.5) * 1000,
      (k) => {
        const f = k * (total - 1);
        const a = Math.floor(f);
        const b = Math.min(total - 1, a + 1);
        const u = f - a;
        ids.forEach((id, i) => {
          const m = this.balls.get(id)!;
          const fa = frames[a][i];
          const fb = frames[b][i];
          if (fa.out || (before.balls[i].out && fb.out)) {
            if (before.balls[i].out) {
              m.visible = false;
              return;
            }
            // Dropping into the pocket.
            if (!sunk.has(id)) sunk.set(id, a);
            const since = (f - sunk.get(id)!) / 18;
            const [px, py] = pocketOf(fa.x / K, fa.y / K);
            const target = world(px, py, BED - 0.25);
            const from = last[i];
            const t2 = Math.min(1, since);
            m.position.lerpVectors(from, target, t2);
            m.position.y = BALL_Y - (BALL_Y - (BED - 0.25)) * t2 * t2;
            m.visible = t2 < 1;
            return;
          }
          const p = world((fa.x + (fb.x - fa.x) * u) / K, (fa.y + (fb.y - fa.y) * u) / K);
          this.roll(m, m.position, p);
          m.position.copy(p);
          last[i] = p;
        });
        const step = f * 5;
        while (ev < events.length && (events[ev].t ?? 0) <= step) {
          const e = events[ev++];
          const v = Math.min(1, (e.v ?? 100000) / 260000);
          if (e.kind === "hit") sfx("clack", 0.25 + v * 0.75);
          else if (e.kind === "wall") sfx("thud", 0.12 + v * 0.4);
          else if (e.kind === "pocket") sfx("capture", 0.55);
        }
      },
      linear,
    );
    this.cue.visible = false;
  }

  // ------------------------------------------------------------ aiming

  private placeCue(ball: THREE.Vector3, angle: number, gap: number) {
    const a = (angle * Math.PI) / 180;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const tilt = 0.09;
    const tip = ball.clone().addScaledVector(dir, -(R + gap));
    tip.y = BALL_Y + 0.005;
    this.cue.position.copy(tip);
    // Point the cue's +X (butt) away from the ball, raised a little.
    const back = dir.clone().negate();
    back.y = Math.sin(tilt);
    back.normalize();
    this.cue.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), back);
    this.stage.invalidate();
  }

  private hideAim() {
    this.cue.visible = false;
    this.aimLine.visible = false;
    this.objLine.visible = false;
    this.ghost.visible = false;
    this.placeBall.visible = false;
    this.pull = null;
    this.stage.invalidate();
  }

  private canAim() {
    return !!this.info?.canPlay && !!this.current && this.current.winner === null && this.settled;
  }

  private pointer() {
    if (!this.canAim() || !this.current) return;
    const p = this.stage.pointOnPlane(BALL_Y);
    if (!p) return;
    if (this.info!.inHand) {
      const [x, y] = toTable(p);
      this.placeBall.position.copy(world(x, y));
      this.placeBall.visible = true;
      const ok = this.placeOk(x, y);
      (this.placeBall.material as THREE.MeshPhysicalMaterial).color.set(ok ? 0xffffff : 0xfca5a5);
      this.stage.invalidate();
      return;
    }
    if (this.pull) {
      // Pulling back: the further the pointer goes back along the line, the harder.
      const a = (this.angle * Math.PI) / 180;
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const back = -p.clone().sub(this.pull.start).dot(dir);
      this.pull.power = Math.max(0, Math.min(100, Math.round((back / 2.2) * 100)));
      this.info!.onPower(Math.max(1, this.pull.power));
      this.placeCue(this.balls.get(0)!.position, this.angle, 0.04 + this.pull.power / 220);
      return;
    }
    const cue = this.current.balls[0];
    const [x, y] = toTable(p);
    const ang = Math.round((Math.atan2(y - cue.y / K, x - cue.x / K) * 180) / Math.PI);
    if (Math.hypot(x - cue.x / K, y - cue.y / K) > POOL_BALL_R * 1.2) {
      this.angle = ((ang % 360) + 360) % 360;
      this.info!.onAim(this.angle);
    }
    this.refreshAim();
  }

  private press(e: PointerEvent) {
    if (!this.canAim() || e.button !== 0 || this.info!.inHand) return;
    const p = this.stage.pointOnPlane(BALL_Y);
    if (!p) return;
    this.pull = { start: p, power: 0 };
  }

  private release() {
    if (!this.canAim() || !this.info) return;
    if (this.info.inHand) {
      const p = this.stage.pointOnPlane(BALL_Y);
      if (!p) return;
      const [x, y] = toTable(p);
      if (this.placeOk(x, y)) {
        this.hideAim();
        this.info.onPlace(Math.round(x), Math.round(y));
      }
      return;
    }
    const pull = this.pull;
    this.pull = null;
    if (!pull) return;
    // A drag shoots with its pull; a plain click shoots with the slider's power.
    const power = pull.power >= 3 ? pull.power : this.info.power;
    this.hideAim();
    this.info.onShoot(this.angle, Math.max(1, power));
  }

  private placeOk(x: number, y: number) {
    if (!this.current) return false;
    if (x < POOL_BALL_R || x > POOL_W - POOL_BALL_R || y < POOL_BALL_R || y > POOL_H - POOL_BALL_R) return false;
    return !this.current.balls.some((b) => b.id !== 0 && !b.out && (b.x / K - x) ** 2 + (b.y / K - y) ** 2 < (2 * POOL_BALL_R) ** 2);
  }

  /** Aim at an angle chosen outside the table (keyboard, tests). */
  setAngle(a: number) {
    this.angle = a;
    this.refreshAim();
  }

  private refreshAim() {
    const s = this.current;
    if (!s || !this.canAim() || this.info?.inHand) {
      this.cue.visible = false;
      this.aimLine.visible = false;
      this.objLine.visible = false;
      this.ghost.visible = false;
      if (!this.info?.inHand || !this.canAim()) this.placeBall.visible = false;
      this.stage.invalidate();
      return;
    }
    const cuePos = this.balls.get(0)!.position;
    const g = guide(s.balls, this.angle);
    const end = world(g.end[0], g.end[1], BALL_Y - R * 0.6);
    const start = cuePos.clone().setY(BALL_Y - R * 0.6);
    (this.aimLine.geometry as THREE.BufferGeometry).setFromPoints([start, end]);
    this.aimLine.visible = true;
    this.ghost.visible = !!g.ball;
    this.ghost.position.copy(end).setY(BED + 0.004);
    if (g.ball) {
      const bp = world(g.ball.x / K, g.ball.y / K, BALL_Y - R * 0.6);
      const dir = bp.clone().sub(end).setY(0).normalize();
      (this.objLine.geometry as THREE.BufferGeometry).setFromPoints([bp, bp.clone().addScaledVector(dir, 0.7)]);
      this.objLine.visible = true;
    } else this.objLine.visible = false;
    this.cue.visible = true;
    this.placeCue(cuePos, this.angle, this.pull ? 0.04 + this.pull.power / 220 : 0.06);
  }
}

/** A cue-ball face: click where to strike it (spin). */
function SpinPad({ side, top, enabled, onChange }: { side: number; top: number; enabled: boolean; onChange: (side: number, top: number) => void }) {
  return (
    <div className="flex items-center gap-2" data-pool-spin={enabled ? "on" : "off"} title={enabled ? "Click where the cue strikes the ball: high = follow, low = draw, left/right = english" : "Spin needs LANX 2.16 or newer on both PCs"}>
      <button
        type="button"
        aria-label="Cue ball spin"
        disabled={!enabled}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - r.left) / r.width) * 2 - 1;
          const y = ((e.clientY - r.top) / r.height) * 2 - 1;
          const d = Math.hypot(x, y);
          const k = d > 0.85 ? 0.85 / d : 1;
          onChange(Math.round((x * k) / 0.85 * 100), Math.round((-y * k) / 0.85 * 100));
        }}
        className="relative h-11 w-11 rounded-full bg-white shadow-[inset_0_-3px_6px_rgba(15,23,42,0.18)] ring-1 ring-black/15 disabled:opacity-40"
      >
        <span className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-rose-600" style={{ left: `${50 + side * 0.36}%`, top: `${50 - top * 0.36}%` }} />
      </button>
      <span className="text-[11px] leading-tight text-slate-500">
        Spin
        <br />
        {side === 0 && top === 0 ? "centre" : `${top > 0 ? "follow" : top < 0 ? "draw" : ""}${top && side ? " · " : ""}${side > 0 ? "right" : side < 0 ? "left" : ""}`}
      </span>
      {(side !== 0 || top !== 0) && (
        <button type="button" data-pool-spin-reset onClick={() => onChange(0, 0)} className="text-[11px] font-semibold text-indigo-600">
          Centre
        </button>
      )}
    </div>
  );
}

/** 8-Ball Pool, the 3D table. */
export default function Pool3D(p: BoardProps) {
  const { moves, canPlay, turn, seats, starter = 0, onMove } = p;
  const state = useMemo(() => pool.replay(moves, 2, ""), [moves]);
  const spinOk = useTableCaps(p, "spin");
  const [power, setPower] = useState(60);
  const [spin, setSpin] = useState<[number, number]>([0, 0]);
  const angle = useRef(0);
  const move = useRef(onMove);
  move.current = onMove;
  const spinRef = useRef(spin);
  spinRef.current = spinOk ? spin : [0, 0];
  const [hostRef, scene] = useScene((el) => new PoolScene(el));
  useEffect(() => scene?.sync(2, "", moves), [scene, moves]);
  useEffect(() => setSpin([0, 0]), [moves.length]);
  const shoot = (a: number, pw: number) => {
    const [sx, sy] = spinRef.current;
    move.current(sx || sy ? `s:${a}:${pw}:${sx}:${sy}` : `s:${a}:${pw}`);
  };
  const shootRef = useRef(shoot);
  shootRef.current = shoot;
  useEffect(() => {
    scene?.setTurn({
      canPlay,
      inHand: !!state?.inHand,
      power,
      onAim: (a) => (angle.current = a),
      onShoot: (a, pw) => shootRef.current(a, pw),
      onPlace: (x, y) => move.current(`c:${x}:${y}`),
      onPower: setPower,
    });
  }, [scene, canPlay, state, power]);
  if (!state) return null;
  const name = (q: number) => seatFor(seats, starter, q, 2).name;
  const ballsOf = (g: string | null) => (g === "solid" ? [1, 2, 3, 4, 5, 6, 7] : g === "stripe" ? [9, 10, 11, 12, 13, 14, 15] : []);
  const potted = new Set(state.balls.filter((b) => b.out).map((b) => b.id));
  return (
    <div data-game-board="pool" data-g3-board="pool" className="flex w-full max-w-[820px] flex-col items-center gap-2">
      <BoardBar>
        {state.groups.map((g, q) => (
          <span key={q} data-pool-group={q} className={`inline-flex items-center gap-1.5 ${q === turn && state.winner === null ? "underline decoration-2 underline-offset-4" : ""}`}>
            {name(q)}: {g ? `${g}s` : "open"}
            <span className="inline-flex gap-0.5">
              {ballsOf(g).map((id) => (
                <span key={id} className="inline-block h-3 w-3 rounded-full ring-1 ring-black/10" style={{ background: id >= 9 ? `linear-gradient(#fff 25%, ${colourOf(id)} 25% 75%, #fff 75%)` : colourOf(id), opacity: potted.has(id) ? 0.25 : 1 }} />
              ))}
            </span>
            {g && <span className="font-normal text-slate-500">{ownBallsLeft(state, q)} left</span>}
          </span>
        ))}
        {state.inHand && canPlay && <span className="text-indigo-600 dark:text-indigo-300">Ball in hand: click the table to place the cue ball</span>}
      </BoardBar>
      <SceneBox hostRef={hostRef} aspect={1.62} maxH={560} testId="pool" />
      {canPlay && !state.inHand && state.winner === null && (
        <div className="flex flex-wrap items-center justify-center gap-4 text-[12px]" data-pool-controls>
          <label className="inline-flex items-center gap-2">
            Power
            <input data-pool-power type="range" min={5} max={100} value={power} onChange={(e) => setPower(Number(e.target.value))} className="w-32 accent-indigo-600" />
            <span className="w-7 tabular-nums text-slate-500">{power}</span>
          </label>
          <SpinPad side={spin[0]} top={spin[1]} enabled={spinOk} onChange={(a, b) => setSpin([a, b])} />
          <button type="button" data-pool-shoot onClick={() => shoot(angle.current, power)} className={primary3}>
            Shoot
          </button>
          <span className="max-w-[260px] text-[11.5px] text-slate-500">Aim with the mouse. Press and pull back to strike, or click to shoot at the set power.</span>
        </div>
      )}
      {state.inHand && canPlay && (
        <div className="flex gap-2 text-[12px]">
          <button type="button" data-pool-place-spot onClick={() => onMove(`c:200:200`)} className={quiet3}>
            Place on the spot
          </button>
        </div>
      )}
      <HiddenActions actions={[]} label="Pool" />
      {state.log.length > 0 && (
        <div className="text-[11.5px] text-slate-500" data-pool-log>
          {state.log[state.log.length - 1]}
        </div>
      )}
    </div>
  );
}
