// LANX 2.16.0: Bowling in 3D — a maple lane with gutters, ten pins on the
// deck, a ball that rolls (or drops into the gutter), a camera that follows
// it down the lane, and pins that topple, bounce off each other and scatter
// into the pit (Rapier rigid bodies). Which pins fall is the rules' answer
// (lib/games/bowling, the same on every PC): only those pins are free to
// move in the simulation, the others stay put, so the picture always shows
// the score. Then the sweep clears the deck and the pinsetter resets it.

import * as THREE from "three";
import { useEffect, useMemo, useState } from "react";
import { namesIn, seatFor, type BoardProps } from "../../boardProps";
import { LANE_HALF as LANE_UNITS, PINS, bowling, bowlingLine, bowlingScore, rollResult, type BowlingState, type PinHit } from "../../../../lib/games/bowling.ts";
import { sfx } from "../../../../lib/gameSounds";
import { TurnScene } from "../turnScene";
import { canvasTexture, mesh, sharedGeo, slab, wood } from "../kit";
import { loadRapier, seeded, hashString } from "../physics";
import { SceneBox, useScene } from "../Board3D";
import { BoardBar, primary3 } from "../ui";
import { useSwing } from "../../boards/useFrames";
import { easeInOut, linear } from "../stage";

const LANE_HALF = 0.53;
const DECK_Z = -18; // the head pin
const U = 0.0051; // world per lane unit (pins are 30 units = 6 in apart)
const BALL_R = 0.11;
const PIN_H = 0.38;

const pinXZ = (i: number) => new THREE.Vector3(PINS[i][0] * U, 0, DECK_Z - PINS[i][1] * 0.265);

function pinGeometry() {
  return sharedGeo("bowlpin", () => {
    const pts = [
      [0, 0],
      [0.026, 0],
      [0.034, 0.02],
      [0.052, 0.08],
      [0.06, 0.13],
      [0.056, 0.18],
      [0.042, 0.22],
      [0.026, 0.255],
      [0.022, 0.27],
      [0.028, 0.3],
      [0.033, 0.33],
      [0.03, 0.36],
      [0.018, 0.377],
      [0, 0.38],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    return new THREE.LatheGeometry(pts, 32);
  });
}

function pinTexture() {
  return canvasTexture(64, 256, (ctx, w, h) => {
    ctx.fillStyle = "#fbfaf6";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#dc2626";
    // Lathe UVs run bottom (v=0) to top (v=1); the canvas top is v=1.
    ctx.fillRect(0, h * (1 - 0.72), w, h * 0.035);
    ctx.fillRect(0, h * (1 - 0.66), w, h * 0.035);
  });
}

function laneTexture(renderer: THREE.WebGLRenderer) {
  return canvasTexture(
    256,
    2048,
    (ctx, w, h) => {
      for (let b = 0; b < 39; b++) {
        const x = (b / 39) * w;
        ctx.fillStyle = b % 2 ? "#e7c995" : "#dcbd85";
        ctx.fillRect(x, 0, w / 39 + 1, h);
      }
      // Arrows and dots (the aiming marks).
      ctx.fillStyle = "#7c4a1d";
      for (let k = 0; k < 7; k++) {
        const x = ((k * 5 + 4.5) / 39) * w;
        const y = h * (1 - 15 / 18) + Math.abs(k - 3) * 22;
        ctx.beginPath();
        ctx.moveTo(x, y - 18);
        ctx.lineTo(x - 5, y + 10);
        ctx.lineTo(x + 5, y + 10);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = "#1f2937";
      ctx.fillRect(0, h - 4, w, 4);
    },
    renderer,
  );
}

interface Frame3 {
  ball: THREE.Vector3;
  pins: { p: THREE.Vector3; q: THREE.Quaternion }[];
}

class BowlingScene extends TurnScene<BowlingState> {
  private ball: THREE.Mesh;
  private pins: THREE.Mesh[] = [];
  private arrow: THREE.Mesh;
  private info: { canPlay: boolean; pos: number; angle: number } | null = null;
  private colour = "#1e3a8a";
  constructor(host: HTMLElement) {
    super(host, { fov: 34 });
    const s = this.stage;
    s.setGroundY(-0.2);
    // Lane, gutters, the approach and the pit.
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(LANE_HALF * 2, 19.4), new THREE.MeshPhysicalMaterial({ map: laneTexture(s.renderer), roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08 }));
    lane.rotation.x = -Math.PI / 2;
    lane.position.set(0, 0, -9.2);
    lane.receiveShadow = true;
    s.scene.add(lane);
    const approach = mesh(slab(2.2, 0.04, 4, 0.02), wood("light", 2));
    approach.position.set(0, -0.04, 2);
    s.scene.add(approach);
    const gutterMat = new THREE.MeshStandardMaterial({ color: 0x9ca3af, metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide });
    for (const sx of [-1, 1]) {
      const g = mesh(new THREE.CylinderGeometry(0.12, 0.12, 19.4, 16, 1, true, Math.PI / 2, Math.PI), gutterMat, false);
      g.rotation.x = Math.PI / 2;
      g.rotation.y = Math.PI;
      g.position.set(sx * (LANE_HALF + 0.12), 0, -9.2);
      g.receiveShadow = true;
      s.scene.add(g);
      const cap = mesh(slab(0.25, 0.05, 19.4, 0.02), wood("dark", 1));
      cap.position.set(sx * (LANE_HALF + 0.36), -0.02, -9.2);
      s.scene.add(cap);
      const kick = mesh(slab(0.08, 0.6, 2.6, 0.02), new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.7 }));
      kick.position.set(sx * (LANE_HALF + 0.3), 0, DECK_Z - 0.7);
      s.scene.add(kick);
    }
    const pit = mesh(slab(2.4, 0.8, 0.1, 0.02), new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 1 }));
    pit.position.set(0, -0.3, DECK_Z - 2.2);
    s.scene.add(pit);
    const curtain = mesh(slab(2.4, 0.9, 0.08, 0.02), new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 1 }));
    curtain.position.set(0, 0.55, DECK_Z - 2.1);
    s.scene.add(curtain);
    // Pins and the ball.
    const pinMat = new THREE.MeshPhysicalMaterial({ map: pinTexture(), roughness: 0.25, clearcoat: 1 });
    for (let i = 0; i < 10; i++) {
      const m = mesh(pinGeometry(), pinMat);
      m.position.copy(pinXZ(i));
      s.scene.add(m);
      this.pins.push(m);
    }
    this.ball = mesh(new THREE.SphereGeometry(BALL_R, 40, 28), new THREE.MeshPhysicalMaterial({ color: this.colour, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 }));
    this.ball.position.set(0, BALL_R, 0.3);
    s.scene.add(this.ball);
    // The aiming arrow on the lane.
    this.arrow = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 6), new THREE.MeshBasicMaterial({ color: 0x4f46e5, transparent: true, opacity: 0.55, depthWrite: false }));
    this.arrow.rotation.x = -Math.PI / 2;
    this.arrow.visible = false;
    s.scene.add(this.arrow);
    // Light along the lane, with shadows down at the pins.
    s.key.position.set(-3, 10, -6);
    s.key.target.position.set(0, 0, -12);
    const sc = s.key.shadow.camera as THREE.OrthographicCamera;
    sc.left = -12;
    sc.right = 12;
    sc.top = 12;
    sc.bottom = -12;
    sc.far = 60;
    sc.updateProjectionMatrix();
    void this.home(false);
  }
  /** The view from behind the foul line. */
  private home(animate: boolean) {
    const to = { pos: new THREE.Vector3(0, 1.35, 3.6), look: new THREE.Vector3(0, 0.05, -12) };
    const cam = this.stage.camera;
    if (!animate) {
      cam.position.copy(to.pos);
      cam.lookAt(to.look);
      this.stage.invalidate();
      return Promise.resolve();
    }
    const p0 = cam.position.clone();
    const l0 = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).multiplyScalar(10).add(p0);
    return this.stage.animate(700, (t) => {
      cam.position.lerpVectors(p0, to.pos, t);
      cam.lookAt(l0.clone().lerp(to.look, t));
    });
  }
  private colours: string[] = [];
  setLook(colours: string[], turn: number) {
    this.colours = colours;
    this.colour = colours[turn] ?? this.colour;
    // Between rolls the ball takes the next bowler's colour; during a roll it keeps the roller's.
    if (this.settled) (this.ball.material as THREE.MeshPhysicalMaterial).color.set(this.colour);
    this.stage.invalidate();
  }
  setTurn(info: { canPlay: boolean; pos: number; angle: number }) {
    this.info = info;
    if (!this.settled) return;
    this.ball.position.set(info.pos * U, BALL_R, 0.3);
    this.arrow.visible = info.canPlay;
    if (info.canPlay) {
      // A 6 m guide from the ball along the chosen line.
      const start = new THREE.Vector3(info.pos * U, 0.003, 0);
      const end = new THREE.Vector3(bowlingLine(info.pos, info.angle) * U, 0.003, DECK_Z);
      this.arrow.rotation.z = Math.atan2(end.x - start.x, start.z - end.z);
      this.arrow.position.copy(start.lerp(end, 3 / 18));
    }
    this.stage.invalidate();
  }
  protected replay(moves: string[]) {
    return bowling.replay(moves, this.n, this.seed);
  }
  protected snap(s: BowlingState) {
    s.standing.forEach((up, i) => {
      const m = this.pins[i];
      m.visible = up;
      m.position.copy(pinXZ(i));
      m.quaternion.identity();
    });
    if (this.info) this.ball.position.set(this.info.pos * U, BALL_R, 0.3);
    this.stage.invalidate();
  }
  protected async animateStep(before: BowlingState, after: BowlingState, move: string) {
    this.arrow.visible = false;
    (this.ball.material as THREE.MeshPhysicalMaterial).color.set(this.colours[before.turn] ?? this.colour);
    const mv = /^r:(-?\d+):(-?\d+):(\d+)$/.exec(move);
    if (!mv) return;
    const pos = Math.max(-100, Math.min(100, Number(mv[1])));
    const angle = Math.max(-30, Math.min(30, Number(mv[2])));
    const power = Math.max(1, Math.min(100, Number(mv[3])));
    const roll = rollResult(this.seed, before.rolls, pos, angle, power, before.standing);
    const knocked = roll.fell.map((f, i) => f && before.standing[i]);
    const at = roll.xAtPins + roll.drift;
    const gutter = power >= 15 && Math.abs(at) > LANE_UNITS; // off the lane before the pins (the rules' gutter)
    const slow = power < 15;
    // The ball's line: foul line → pins (or into a gutter, or rolling to a stop).
    const x0 = pos * U;
    const x1 = at * U;
    const speed = 5 + power * 0.07; // metres a second
    const path = (z: number) => {
      const t = z / DECK_Z;
      let x = x0 + (x1 - x0) * t;
      let y = BALL_R;
      if (Math.abs(x) > LANE_HALF) {
        x = Math.sign(x) * (LANE_HALF + 0.12);
        y = BALL_R - 0.08;
      }
      return new THREE.Vector3(x, y, z);
    };
    // Simulate the pins (Rapier) while the ball crosses the deck.
    const frames = await this.simulate(path, speed, knocked, gutter || slow, roll.hits, power);
    const cam = this.stage.camera;
    const look = new THREE.Vector3(0, 0.15, DECK_Z - 0.4);
    const endZ = slow ? DECK_Z * 0.7 : DECK_Z - 2.2;
    const tRoll = (Math.abs(endZ) / speed) * 1000 * (slow ? 2.2 : 1);
    sfx("thud", 0.4);
    let ev = 0;
    const deckStart = DECK_Z + 0.6;
    const tDeck = (Math.abs(deckStart) / speed) * 1000;
    const total = Math.max(tRoll, tDeck + (frames.length / 60) * 1000);
    let rolledSound = false;
    await this.stage.animate(
      total,
      (k) => {
        const ms = k * total;
        // The ball.
        const z = slow ? endZ * Math.sin(Math.min(1, ms / tRoll) * (Math.PI / 2)) : Math.max(endZ, -(ms / 1000) * speed);
        const prev = this.ball.position.clone();
        if (ms < tDeck || slow || !frames.length) this.ball.position.copy(path(z));
        else {
          const f = Math.min(frames.length - 1, Math.floor(((ms - tDeck) / 1000) * 60));
          this.ball.position.copy(frames[f].ball);
        }
        const d = this.ball.position.clone().sub(prev);
        if (d.lengthSq() > 1e-8) this.ball.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0).cross(d).normalize(), d.length() / BALL_R));
        // The pins.
        if (ms >= tDeck && frames.length) {
          const f = Math.min(frames.length - 1, Math.floor(((ms - tDeck) / 1000) * 60));
          frames[f].pins.forEach((pp, i) => {
            if (!knocked[i]) return;
            this.pins[i].position.copy(pp.p);
            this.pins[i].quaternion.copy(pp.q);
          });
          if (!rolledSound && knocked.some(Boolean)) {
            rolledSound = true;
            sfx("capture", 0.9);
          }
          while (ev < 6 && f > ev * 6) {
            ev++;
            if (knocked.some(Boolean)) sfx("clack", 0.5 - ev * 0.06);
          }
        }
        // The camera follows the ball down the lane, then holds on the deck.
        const cz = Math.max(DECK_Z + 5.2, Math.min(3.6, this.ball.position.z + 3.4));
        cam.position.set(this.ball.position.x * 0.4, 0.95 + (cz < -8 ? 0.25 : 0.4), cz);
        cam.lookAt(look.clone().setX(this.ball.position.x * 0.3));
      },
      linear,
    );
    if (gutter) sfx("buzz", 0.4);
    await this.stage.wait(500);
    // The sweep: fallen pins go; the frame's end resets all ten.
    await this.stage.animate(420, (t) => knocked.forEach((kk, i) => kk && this.pins[i].position.setY(this.pins[i].position.y - t * 0.6)), easeInOut);
    knocked.forEach((kk, i) => kk && (this.pins[i].visible = false));
    const reset = after.standing.every(Boolean) && !before.standing.every((x, i) => x && !knocked[i]);
    if (reset) {
      this.pins.forEach((m, i) => {
        m.visible = true;
        m.position.copy(pinXZ(i)).setY(0.5);
        m.quaternion.identity();
      });
      await this.stage.animate(360, (t) => this.pins.forEach((m) => m.position.setY(0.5 * (1 - t))), easeInOut);
    }
    this.ball.visible = true;
    (this.ball.material as THREE.MeshPhysicalMaterial).color.set(this.colour);
    await this.home(true);
  }
  /** The pins that fall (and only those) as rigid bodies; the ball pushes through on its line. */
  private async simulate(path: (z: number) => THREE.Vector3, speed: number, knocked: boolean[], none: boolean, hits: (PinHit | null)[] = [], power = 50): Promise<Frame3[]> {
    if (none || !knocked.some(Boolean)) return [];
    const R = await loadRapier().catch(() => null);
    if (!R || this.stage.isDisposed) return this.fallback(path, speed, knocked);
    const rnd = seeded(hashString(`${this.seed}#pins${this.shown.length}`));
    const world = new R.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = 1 / 120;
    try {
      const floor = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, -0.05, DECK_Z - 1));
      world.createCollider(R.ColliderDesc.cuboid(LANE_HALF + 0.4, 0.05, 2.5).setFriction(0.4).setRestitution(0.2), floor);
      for (const sx of [-1, 1]) {
        const w = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(sx * (LANE_HALF + 0.34), 0.3, DECK_Z - 0.7));
        world.createCollider(R.ColliderDesc.cuboid(0.04, 0.3, 1.3).setRestitution(0.5), w);
      }
      const back = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, 0.4, DECK_Z - 2.2));
      world.createCollider(R.ColliderDesc.cuboid(1.2, 0.5, 0.05).setRestitution(0.3), back);
      // Pins: the ones that stay up are fixed; the ones that fall are free.
      const bodies = PINS.map((_p, i) => {
        const c = pinXZ(i);
        const desc = knocked[i] ? R.RigidBodyDesc.dynamic() : R.RigidBodyDesc.fixed();
        const b = world.createRigidBody(desc.setTranslation(c.x, PIN_H / 2, c.z).setCcdEnabled(true));
        world.createCollider(R.ColliderDesc.cylinder(PIN_H / 2, 0.05).setDensity(380).setFriction(0.35).setRestitution(0.45), b);
        return b;
      });
      const ballBody = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, BALL_R, DECK_Z + 0.6));
      world.createCollider(R.ColliderDesc.ball(BALL_R).setDensity(1250), ballBody);
      const frames: Frame3[] = [];
      const pushed = new Set<number>();
      let z = DECK_Z + 0.6;
      for (let f = 0; f < 60 * 2.6; f++) {
        for (let sub = 0; sub < 2; sub++) {
          z = Math.max(DECK_Z - 2.15, z - speed / 120);
          const bp = path(z);
          ballBody.setNextKinematicTranslation({ x: bp.x, y: bp.y, z: bp.z });
          // Each falling pin is pushed over when the rules' pin action knocked it (as far down the deck as the
          // ball had come by then), the way the rules sent it; without that, from the ball's side.
          PINS.forEach((_p, i) => {
            if (!knocked[i] || pushed.has(i)) return;
            const c = pinXZ(i);
            const h = hits[i];
            // How far past the head pin the ball had come (lane units) when this pin went over.
            const depth = h && h.step ? -70 + (2.5 + power * 0.045) * h.step : (DECK_Z - c.z) / U;
            if (z > DECK_Z - depth * U + 0.05) return;
            pushed.add(i);
            const away = h && (h.dx || h.dy) ? new THREE.Vector3(h.dx + (rnd() - 0.5) * 0.08, 0, -h.dy).normalize() : new THREE.Vector3(c.x - bp.x + (rnd() - 0.5) * 0.08, 0, -0.6).normalize();
            const strength = 0.9 + speed * 0.12 + rnd() * 0.4;
            bodies[i].applyImpulseAtPoint({ x: away.x * strength, y: 0.05, z: away.z * strength }, { x: c.x, y: PIN_H * 0.85, z: c.z }, true);
          });
          world.step();
        }
        const b = ballBody.translation();
        frames.push({
          ball: new THREE.Vector3(b.x, b.y, b.z),
          pins: bodies.map((pb, i) => {
            const t = pb.translation();
            const q = pb.rotation();
            const p = new THREE.Vector3(t.x, t.y - PIN_H / 2, t.z);
            const qq = new THREE.Quaternion(q.x, q.y, q.z, q.w);
            // The mesh's origin is its base; the body's is its middle.
            p.add(new THREE.Vector3(0, PIN_H / 2, 0).sub(new THREE.Vector3(0, PIN_H / 2, 0).applyQuaternion(qq)));
            return { p: knocked[i] ? p : pinXZ(i), q: knocked[i] ? qq : new THREE.Quaternion() };
          }),
        });
      }
      // Any falling pin still upright at the end tips over in the last frames.
      const last = frames[frames.length - 1];
      last.pins.forEach((pp, i) => {
        if (!knocked[i]) return;
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(pp.q);
        if (up.y > 0.7) {
          const tip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
          for (let k = 0; k < 20 && frames.length - 20 + k >= 0; k++) {
            const fr = frames[frames.length - 20 + k];
            fr.pins[i] = { p: pp.p.clone().setY(k / 19 > 0.9 ? 0.05 : 0), q: pp.q.clone().slerp(tip, k / 19) };
          }
        }
      });
      return frames;
    } finally {
      world.free();
    }
  }
  /** Without physics: the falling pins tip over, away from the ball. */
  private fallback(path: (z: number) => THREE.Vector3, speed: number, knocked: boolean[]): Frame3[] {
    const frames: Frame3[] = [];
    for (let f = 0; f < 90; f++) {
      const z = Math.max(DECK_Z - 2.15, DECK_Z + 0.6 - (speed * f) / 60);
      frames.push({
        ball: path(z),
        pins: PINS.map((_p, i) => {
          const c = pinXZ(i);
          if (!knocked[i]) return { p: c, q: new THREE.Quaternion() };
          const t = Math.max(0, Math.min(1, (DECK_Z + 0.6 - z - (c.z - DECK_Z) * -1) / 0.6));
          const axis = new THREE.Vector3(1, 0, Math.sign(c.x || 0.3) * 0.5).normalize();
          return { p: c.clone().add(new THREE.Vector3(Math.sign(c.x || 1) * t * 0.15, 0, -t * 0.3)), q: new THREE.Quaternion().setFromAxisAngle(axis, -t * Math.PI / 2) };
        }),
      });
    }
    return frames;
  }
}

/** The frame boxes: X for a strike, / for a spare, – for none. */
function marks(frame: number[], tenth: boolean): string[] {
  const out: string[] = [];
  frame.forEach((r, k) => {
    if (r === 10 && (k === 0 || tenth)) out.push(k > 0 && !tenth ? "" : "X");
    else if (k > 0 && frame[k - 1] + r === 10 && frame[k - 1] !== 10) out.push("/");
    else out.push(r === 0 ? "–" : String(r));
  });
  return out;
}

export default function Bowling3D({ moves, canPlay, turn, seats, starter = 0, seed = "", onMove }: BoardProps) {
  const n = Math.max(1, seats?.length ?? 1);
  const state = useMemo(() => bowling.replay(moves, n, seed), [moves, n, seed]);
  const [pos, setPos] = useState(0);
  const [angle, setAngle] = useState(0);
  const power = useSwing(1600, canPlay);
  const [hostRef, scene] = useScene((el) => new BowlingScene(el));
  const colours = useMemo(() => Array.from({ length: n }, (_, i) => seatFor(seats, starter, i, n).color), [seats, starter, n]);
  useEffect(() => scene?.setLook(colours, turn), [scene, colours, turn]);
  useEffect(() => scene?.sync(n, seed, moves), [scene, n, seed, moves]);
  useEffect(() => scene?.setTurn({ canPlay, pos, angle }), [scene, canPlay, pos, angle, moves.length]);
  const pw = Math.max(1, Math.round(power * 100));
  if (!state) return null;
  const name = (p: number) => seatFor(seats, starter, p, n).name;
  return (
    <div data-game-board="bowling" data-g3-board="bowling" className="flex w-full max-w-[760px] flex-col items-center gap-2">
      <SceneBox hostRef={hostRef} aspect={1.6} maxH={460} testId="bowling" />
      <div className="min-h-[18px] text-[12.5px] font-semibold text-slate-700 dark:text-slate-200" data-bowling-event>
        {namesIn(state.event, seats, starter, n)}
      </div>
      {canPlay && (
        <div className="flex flex-wrap items-center justify-center gap-3 text-[12px]" data-bowling-controls>
          <label className="inline-flex items-center gap-1">
            Position <input data-bowling-pos type="range" min={-100} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} className="accent-indigo-600" />
          </label>
          <label className="inline-flex items-center gap-1">
            Angle <input data-bowling-angle type="range" min={-30} max={30} value={angle} onChange={(e) => setAngle(Number(e.target.value))} className="accent-indigo-600" />
          </label>
          <span className="inline-flex items-center gap-1">
            Power
            <span className="inline-block h-3 w-28 overflow-hidden rounded-full bg-slate-500/20">
              <span className="block h-3 bg-indigo-600" style={{ width: `${pw}%` }} />
            </span>
          </span>
          <button type="button" data-bowling-roll onClick={() => onMove(`r:${pos}:${angle}:${pw}`)} className={primary3}>
            Roll
          </button>
        </div>
      )}
      <BoardBar>
        <span className="font-normal text-slate-500">{canPlay ? "Set where you stand and the angle; press Roll when the power bar is where you want it." : state.done ? "Ten frames done." : `${name(turn)} is bowling.`}</span>
      </BoardBar>
      <table className="text-[11px]" data-bowling-scores>
        <tbody>
          {state.frames.map((fr, p) => (
            <tr key={p} className={`${p === turn && !state.done ? "font-semibold" : ""} ${state.out[p] ? "line-through opacity-50" : ""}`}>
              <td className="pr-2">
                <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: seatFor(seats, starter, p, n).color }} />
                {name(p)}
              </td>
              {Array.from({ length: 10 }, (_, f) => (
                <td key={f} className="border border-slate-300 px-1 text-center dark:border-slate-600">
                  <span className="tabular-nums">{fr[f] ? marks(fr[f], f === 9).join(" ") : ""}</span>
                </td>
              ))}
              <td className="pl-2 font-bold">{bowlingScore(fr)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
