// LANX 2.16.0: real dice. The rules have already rolled (lib/games/core
// dice(), from the match seed); here the dice are thrown onto the board in
// Rapier, tumble, bounce off each other and the walls, and settle — and the
// face that ends up on top is the number the rules rolled. (The throw is
// simulated first, then the die's faces are turned inside it so the right
// number lands on top; the tumble you see is the real simulated one.)

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { canvasTexture, felt, mesh, roundRect, sharedGeo, slab, wood } from "./kit";
import { hashString, loadRapier, seeded } from "./physics";
import type { Stage } from "./stage";
import { linear } from "./stage";

/** BoxGeometry face order (+X, −X, +Y, −Y, +Z, −Z) → the value printed there. Opposite faces add to 7. */
const FACE_VALUES = [2, 5, 1, 6, 3, 4];
const FACE_NORMALS = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)];
const normalOf = (value: number) => FACE_NORMALS[FACE_VALUES.indexOf(value)];

const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.27, 0.27], [0.73, 0.73]],
  3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
  4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
  5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
  6: [[0.27, 0.24], [0.73, 0.24], [0.27, 0.5], [0.73, 0.5], [0.27, 0.76], [0.73, 0.76]],
};

function faceTexture(value: number, body: string, pip: string) {
  return canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = body;
    ctx.fillRect(0, 0, w, h);
    for (const [x, y] of PIPS[value]) {
      ctx.beginPath();
      ctx.arc(x * w, y * h, w * (value === 1 ? 0.12 : 0.085), 0, Math.PI * 2);
      ctx.fillStyle = value === 1 && pip === "#1e293b" ? "#b91c1c" : pip;
      ctx.fill();
      // A soft dimple.
      ctx.beginPath();
      ctx.arc(x * w - w * 0.012, y * h - h * 0.012, w * (value === 1 ? 0.1 : 0.07), 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(15,23,42,0.08)";
    ctx.lineWidth = 3;
    roundRect(ctx, 2, 2, w - 4, h - 4, 18);
    ctx.stroke();
  });
}

export interface Die {
  /** Follows the simulation. */
  outer: THREE.Group;
  /** Holds the cube, turned so the rolled number lands on top. */
  inner: THREE.Mesh;
  size: number;
  value: number;
}

/** A die `size` across (ivory with dark pips by default). */
export function makeDie(size = 0.6, body = "#fbfaf7", pip = "#1e293b"): Die {
  const geo = sharedGeo(`die:${size}`, () => new RoundedBoxGeometry(size, size, size, 4, size * 0.16));
  const mats = FACE_VALUES.map((v) => new THREE.MeshPhysicalMaterial({ map: faceTexture(v, body, pip), roughness: 0.38, clearcoat: 0.5, clearcoatRoughness: 0.3 }));
  const inner = new THREE.Mesh(geo, mats);
  inner.castShadow = true;
  inner.receiveShadow = true;
  const outer = new THREE.Group();
  outer.add(inner);
  const d: Die = { outer, inner, size, value: 1 };
  show(d, 1);
  return d;
}

/** Rotation that takes the face showing `value` to the local direction `to`. */
function faceTo(value: number, to: THREE.Vector3): THREE.Quaternion {
  const from = normalOf(value);
  if (from.dot(to) < -0.999) {
    // Opposite: half a turn about an axis at right angles (still a symmetry of the cube).
    const axis = Math.abs(from.x) > 0.5 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    return new THREE.Quaternion().setFromAxisAngle(axis, Math.PI);
  }
  return new THREE.Quaternion().setFromUnitVectors(from, to);
}

/** Puts a die at rest showing `value` on top (no animation). */
export function show(d: Die, value: number, yaw = 0) {
  d.value = value;
  d.outer.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  d.inner.quaternion.copy(faceTo(value, new THREE.Vector3(0, 1, 0)));
  d.outer.position.y = Math.max(d.outer.position.y, 0);
}

export interface ThrowArea {
  /** Centre and size of the floor the dice roll on (world units). */
  cx: number;
  cz: number;
  w: number;
  d: number;
  /** Height of that floor. */
  y: number;
  /** Where the throw comes from (a direction from the centre, e.g. the roller's side). */
  from?: THREE.Vector3;
}

/** Throws the dice and lets them settle showing `values`. `key` makes the same throw on every PC. */
export async function throwDice(stage: Stage, dice: Die[], values: number[], area: ThrowArea, key: string, onImpact?: (strength: number) => void): Promise<void> {
  const R = await loadRapier().catch(() => null);
  if (stage.isDisposed) return;
  if (!R) {
    // No physics on this PC: a short spin and drop instead.
    await simpleRoll(stage, dice, values, area);
    return;
  }
  const rnd = seeded(hashString(key));
  const g = 34;
  const world = new R.World({ x: 0, y: -g, z: 0 });
  world.timestep = 1 / 120;
  try {
    // Floor and walls around the area.
    const floor = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(area.cx, area.y - 0.5, area.cz));
    world.createCollider(R.ColliderDesc.cuboid(area.w / 2 + 2, 0.5, area.d / 2 + 2).setFriction(0.7).setRestitution(0.3), floor);
    const wallH = 3;
    const walls: [number, number, number, number][] = [
      [area.cx - area.w / 2 - 0.25, area.cz, 0.25, area.d / 2 + 0.5],
      [area.cx + area.w / 2 + 0.25, area.cz, 0.25, area.d / 2 + 0.5],
      [area.cx, area.cz - area.d / 2 - 0.25, area.w / 2 + 0.5, 0.25],
      [area.cx, area.cz + area.d / 2 + 0.25, area.w / 2 + 0.5, 0.25],
    ];
    for (const [x, z, hx, hz] of walls) {
      const b = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(x, area.y + wallH / 2, z));
      world.createCollider(R.ColliderDesc.cuboid(hx, wallH / 2, hz).setRestitution(0.45).setFriction(0.3), b);
    }
    // The dice, thrown from one side towards the middle.
    const from = (area.from ?? new THREE.Vector3(1, 0, 0.6)).clone().setY(0).normalize();
    const side = new THREE.Vector3(-from.z, 0, from.x);
    const bodies = dice.map((d, i) => {
      const spread = (i - (dice.length - 1) / 2) * d.size * 1.6;
      const sx = area.cx + from.x * area.w * 0.36 + side.x * spread;
      const sz = area.cz + from.z * area.d * 0.36 + side.z * spread;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 6.28, rnd() * 6.28, rnd() * 6.28));
      const speed = 4.5 + rnd() * 2.5;
      const desc = R.RigidBodyDesc.dynamic()
        .setTranslation(sx, area.y + 1.4 + rnd() * 0.6, sz)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setLinvel(-from.x * speed + (rnd() - 0.5) * 1.5, 1 + rnd() * 1.5, -from.z * speed + (rnd() - 0.5) * 1.5)
        .setAngvel({ x: (rnd() - 0.5) * 30, y: (rnd() - 0.5) * 18, z: (rnd() - 0.5) * 30 })
        .setLinearDamping(0.15)
        .setAngularDamping(0.5)
        .setCcdEnabled(true);
      const body = world.createRigidBody(desc);
      const h = d.size / 2;
      const r = d.size * 0.12;
      world.createCollider(R.ColliderDesc.roundCuboid(h - r, h - r, h - r, r).setRestitution(0.32).setFriction(0.55).setDensity(1.2), body);
      return body;
    });
    // Simulate to rest, keeping one pose every other step (60 a second).
    const maxFrames = 60 * 5;
    const poses: { p: THREE.Vector3; q: THREE.Quaternion }[][] = [];
    const impacts: { frame: number; strength: number }[] = [];
    const lastVy = bodies.map(() => 0);
    let still = 0;
    for (let f = 0; f < maxFrames; f++) {
      world.step();
      world.step();
      const row = bodies.map((b, i) => {
        const t = b.translation();
        const r = b.rotation();
        const vy = b.linvel().y;
        if (lastVy[i] < -2 && vy > -0.5) impacts.push({ frame: f, strength: Math.min(1, -lastVy[i] / 10) });
        lastVy[i] = vy;
        return { p: new THREE.Vector3(t.x, t.y, t.z), q: new THREE.Quaternion(r.x, r.y, r.z, r.w) };
      });
      poses.push(row);
      const calm = bodies.every((b) => {
        const v = b.linvel();
        const w = b.angvel();
        return b.isSleeping() || v.x * v.x + v.y * v.y + v.z * v.z + w.x * w.x + w.y * w.y + w.z * w.z < 0.004;
      });
      still = calm ? still + 1 : 0;
      if (still > 12 && f > 30) break;
    }
    // Which face ended on top; turn the faces inside each die so the rolled number is that one.
    const up = new THREE.Vector3(0, 1, 0);
    dice.forEach((d, i) => {
      const end = poses[poses.length - 1][i].q;
      const inv = end.clone().invert();
      const localUp = up.clone().applyQuaternion(inv);
      // The face normal nearest to "up" in the die's own frame.
      let best = FACE_NORMALS[0];
      let bestDot = -2;
      for (const n of FACE_NORMALS) {
        const k = n.dot(localUp);
        if (k > bestDot) {
          bestDot = k;
          best = n;
        }
      }
      d.inner.quaternion.copy(faceTo(values[i], best.clone()));
      d.value = values[i];
    });
    // Play it back.
    const total = poses.length;
    let nextImpact = 0;
    await stage.animate(
      (total / 60) * 1000,
      (t) => {
        const fpos = t * (total - 1);
        const a = Math.floor(fpos);
        const b = Math.min(total - 1, a + 1);
        const k = fpos - a;
        dice.forEach((d, i) => {
          const pa = poses[a][i];
          const pb = poses[b][i];
          d.outer.position.lerpVectors(pa.p, pb.p, k);
          d.outer.quaternion.slerpQuaternions(pa.q, pb.q, k);
        });
        while (nextImpact < impacts.length && impacts[nextImpact].frame <= fpos) {
          onImpact?.(impacts[nextImpact].strength);
          nextImpact++;
        }
      },
      linear,
    );
  } finally {
    world.free();
  }
}

/** Without physics: the dice hop and spin, then show their numbers. */
async function simpleRoll(stage: Stage, dice: Die[], values: number[], area: ThrowArea) {
  const starts = dice.map((d) => d.outer.position.clone());
  const ends = dice.map((d, i) => new THREE.Vector3(area.cx + (i - (dice.length - 1) / 2) * d.size * 1.8, area.y, area.cz));
  const spin = dice.map(() => new THREE.Euler(Math.random() * 8, Math.random() * 8, Math.random() * 8));
  dice.forEach((d, i) => {
    d.inner.quaternion.copy(faceTo(values[i], new THREE.Vector3(0, 1, 0)));
    d.value = values[i];
  });
  await stage.animate(700, (t) => {
    dice.forEach((d, i) => {
      d.outer.position.lerpVectors(starts[i], ends[i], t);
      d.outer.position.y = area.y + Math.sin(Math.PI * t) * 1.2;
      const k = 1 - t;
      d.outer.rotation.set(spin[i].x * k, spin[i].y * k, spin[i].z * k);
    });
  });
}

/** Sets the die's resting height so it sits on a floor at y. */
export function restOn(d: Die, x: number, y: number, z: number) {
  d.outer.position.set(x, y + d.size / 2, z);
}

/** A felt-lined wooden tray (w × d inside) that dice are thrown into. Its floor top is at y = 0.1. */
export function diceTray(w: number, d: number): { group: THREE.Group; floor: THREE.Mesh } {
  const group = new THREE.Group();
  const floor = mesh(slab(w + 0.2, 0.1, d + 0.2, 0.04), felt("#33415c"));
  group.add(floor);
  const wallMat = wood("walnut", 1);
  const t = 0.2;
  for (const [x, z, ww, dd] of [
    [-(w / 2 + t / 2), 0, t, d + 2 * t],
    [w / 2 + t / 2, 0, t, d + 2 * t],
    [0, -(d / 2 + t / 2), w + 2 * t, t],
    [0, d / 2 + t / 2, w + 2 * t, t],
  ] as const) {
    const wall = mesh(slab(ww, 0.42, dd, 0.06), wallMat);
    wall.position.set(x, 0, z);
    group.add(wall);
  }
  return { group, floor };
}

/** The number showing on top of a die right now (from its pose in the world). */
export function topValue(d: Die): number {
  d.inner.updateWorldMatrix(true, false);
  const q = d.inner.getWorldQuaternion(new THREE.Quaternion());
  let best = 1;
  let bestY = -2;
  FACE_NORMALS.forEach((n, i) => {
    const y = n.clone().applyQuaternion(q).y;
    if (y > bestY) {
      bestY = y;
      best = FACE_VALUES[i];
    }
  });
  return best;
}
