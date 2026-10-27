// LANX 2.16.0: Carrom and Mini Golf in 3D. Carrom: a plywood board with its
// markings, four netted pockets, coins and a heavier striker you slide along
// your baseline, aim with the mouse and pull back to flick. Mini Golf: nine
// little courses with wooden walls and blocks, a cup with a flag, and a
// putter-style pull-back to set direction and strength. Both play back
// exactly the path the rules computed (lib/games/physics2d), so the picture
// and the score always agree on every PC.

import * as THREE from "three";
import { useEffect, useMemo, useRef, useState } from "react";
import { seatFor, type BoardProps } from "../../boardProps";
import { CARROM_S, QUEEN, STRIKER, carrom, carromSimulate, strikerSpot, type CarromState } from "../../../../lib/games/carrom.ts";
import { BALL_R, CUP_R, GOLF_H, GOLF_W, HOLES, MAX_STROKES, golfShot, minigolf, type GolfState } from "../../../../lib/games/minigolf.ts";
import { K } from "../../../../lib/games/physics2d.ts";
import { sfx } from "../../../../lib/gameSounds";
import { TurnScene } from "../turnScene";
import { canvasTexture, felt, mesh, plastic, sharedGeo, slab, wood } from "../kit";
import { SceneBox, useScene } from "../Board3D";
import { BoardBar, primary3 } from "../ui";
import { disposeTree, easeIn, linear } from "../stage";

const S = 100;

// ============================================================ Carrom

const CB = CARROM_S / S; // 6
const CTOP = 0.42;
const COIN_R = 0.13;
const STRIKER_R = 0.17;
const cw = (tx: number, ty: number, y = CTOP) => new THREE.Vector3(tx / S - CB / 2, y, ty / S - CB / 2);
const CPOCKETS: [number, number][] = [
  [14, 14],
  [CARROM_S - 14, 14],
  [14, CARROM_S - 14],
  [CARROM_S - 14, CARROM_S - 14],
];

function carromTexture(renderer: THREE.WebGLRenderer) {
  const P = 1024;
  const k = P / CARROM_S;
  return canvasTexture(
    P,
    P,
    (ctx) => {
      ctx.fillStyle = "#f2d7a6";
      ctx.fillRect(0, 0, P, P);
      ctx.strokeStyle = "#7c2d12";
      ctx.fillStyle = "#b91c1c";
      ctx.lineWidth = 3;
      // Centre circles.
      for (const r of [70, 16]) {
        ctx.beginPath();
        ctx.arc(P / 2, P / 2, r * k, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(P / 2, P / 2, 8 * k, 0, Math.PI * 2);
      ctx.fill();
      // Baselines (top and bottom, each a double line with red end circles) and the side ones.
      const base = (vertical: boolean, at: number) => {
        for (const off of [-12, 12]) {
          ctx.beginPath();
          if (vertical) {
            ctx.moveTo((at + off) * k, 90 * k);
            ctx.lineTo((at + off) * k, (CARROM_S - 90) * k);
          } else {
            ctx.moveTo(90 * k, (at + off) * k);
            ctx.lineTo((CARROM_S - 90) * k, (at + off) * k);
          }
          ctx.stroke();
        }
        for (const end of [90, CARROM_S - 90]) {
          ctx.beginPath();
          const [x, y] = vertical ? [at, end] : [end, at];
          ctx.arc(x * k, y * k, 12 * k, 0, Math.PI * 2);
          ctx.fill();
        }
      };
      base(false, 70);
      base(false, CARROM_S - 70);
      base(true, 70);
      base(true, CARROM_S - 70);
      // Arrows towards the pockets.
      ctx.lineWidth = 2;
      for (const [px, py] of CPOCKETS) {
        const dx = px < CARROM_S / 2 ? 1 : -1;
        const dy = py < CARROM_S / 2 ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo((px + dx * 60) * k, (py + dy * 60) * k);
        ctx.lineTo((px + dx * 150) * k, (py + dy * 150) * k);
        ctx.stroke();
      }
    },
    renderer,
  );
}

function coinGeo() {
  return sharedGeo("carromcoin", () => {
    const g = new THREE.CylinderGeometry(COIN_R, COIN_R, 0.07, 36);
    g.translate(0, 0.035, 0);
    return g;
  });
}

interface CarromTurn {
  canPlay: boolean;
  pos: number;
  power: number;
  onPos: (x: number) => void;
  onAim: (a: number) => void;
  onPower: (p: number) => void;
  onFlick: (x: number, angle: number, power: number) => void;
}

class CarromScene extends TurnScene<CarromState> {
  private root = new THREE.Group();
  private pieces = new Map<number, THREE.Mesh>();
  private aimLine: THREE.Line;
  private info: CarromTurn | null = null;
  private angle = 270;
  private drag: "striker" | "pull" | null = null;
  private pullStart: THREE.Vector3 | null = null;
  private pullPower = 0;
  private current: CarromState | null = null;

  constructor(host: HTMLElement) {
    super(host, { fov: 26 });
    const s = this.stage;
    s.scene.add(this.root);
    // The board: a surface with four pocket holes, a raised frame, a dark well under each pocket.
    // The surface runs on under the frame, so the corner pockets are whole holes in it.
    const E = CB / 2 + 0.3;
    const shape = new THREE.Shape();
    shape.moveTo(-E, E);
    shape.lineTo(E, E);
    shape.lineTo(E, -E);
    shape.lineTo(-E, -E);
    shape.lineTo(-E, E);
    const dark = new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 1, side: THREE.DoubleSide });
    for (const [px, py] of CPOCKETS) {
      const c = cw(px, py);
      const h = new THREE.Path();
      h.absarc(c.x, -c.z, 0.24, 0, Math.PI * 2, true);
      shape.holes.push(h);
      const liner = mesh(new THREE.CylinderGeometry(0.24, 0.2, 0.36, 28, 1, true), dark, false);
      liner.position.set(c.x, CTOP - 0.18, c.z);
      this.root.add(liner);
      const net = mesh(new THREE.CircleGeometry(0.22, 24), dark, false);
      net.rotation.x = -Math.PI / 2;
      net.position.set(c.x, CTOP - 0.34, c.z);
      this.root.add(net);
    }
    const surface = new THREE.Mesh(new THREE.ShapeGeometry(shape, 24), new THREE.MeshPhysicalMaterial({ map: carromTexture(s.renderer), roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.15 }));
    const tex = (surface.material as THREE.MeshPhysicalMaterial).map!;
    // ShapeGeometry UVs are the shape's coordinates: map them onto the 0..1 picture.
    const uv = surface.geometry.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / CB + 0.5, uv.getY(i) / CB + 0.5);
    tex.needsUpdate = true;
    surface.rotation.x = -Math.PI / 2;
    surface.position.y = CTOP;
    surface.receiveShadow = true;
    this.root.add(surface);
    const frameMat = wood("walnut", 2);
    for (const sz of [-1, 1]) {
      const f = mesh(slab(CB + 1, 0.16, 0.5, 0.06), frameMat);
      f.position.set(0, CTOP - 0.02, sz * (CB / 2 + 0.25));
      this.root.add(f);
    }
    for (const sx of [-1, 1]) {
      const f = mesh(slab(0.5, 0.16, CB, 0.06), frameMat);
      f.position.set(sx * (CB / 2 + 0.25), CTOP - 0.02, 0);
      this.root.add(f);
    }
    const under = mesh(slab(CB + 0.9, CTOP - 0.4, CB + 0.9, 0.08), wood("dark", 2));
    under.position.y = 0;
    this.root.add(under);
    const floor = mesh(slab(CB, 0.04, CB, 0.02), dark, false);
    floor.position.y = CTOP - 0.4;
    this.root.add(floor);
    // Coins and the striker.
    const white = new THREE.MeshPhysicalMaterial({ color: 0xf3ead8, roughness: 0.35, clearcoat: 0.6 });
    const black = new THREE.MeshPhysicalMaterial({ color: 0x1f2328, roughness: 0.3, clearcoat: 0.7 });
    const red = new THREE.MeshPhysicalMaterial({ color: 0xc81e3a, roughness: 0.3, clearcoat: 0.7 });
    for (let id = 1; id <= 19; id++) {
      const m = mesh(coinGeo(), id === QUEEN ? red : id <= 9 ? white : black);
      this.root.add(m);
      this.pieces.set(id, m);
    }
    const strikerGeo = new THREE.CylinderGeometry(STRIKER_R, STRIKER_R, 0.08, 40);
    strikerGeo.translate(0, 0.04, 0);
    const striker = mesh(strikerGeo, new THREE.MeshPhysicalMaterial({ color: 0xfbbf24, roughness: 0.25, clearcoat: 0.8 }));
    this.root.add(striker);
    this.pieces.set(STRIKER, striker);
    this.aimLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0x1d4ed8, transparent: true, opacity: 0.7 }));
    this.aimLine.visible = false;
    this.root.add(this.aimLine);
    s.onPointerMove = () => this.pointer();
    s.onPointerDown = (e) => this.press(e);
    s.onPointerUp = () => this.release();
    s.frame(new THREE.Box3(new THREE.Vector3(-CB / 2 - 0.55, 0, -CB / 2 - 0.55), new THREE.Vector3(CB / 2 + 0.55, 0.6, CB / 2 + 0.55)), [0, 2.8, 1], 1.02);
  }
  private flip = false;
  setSide(flip: boolean) {
    this.flip = flip;
    this.root.rotation.y = flip ? Math.PI : 0;
    this.stage.invalidate();
  }
  setTurn(info: CarromTurn) {
    this.info = info;
    this.placeStriker();
    this.refreshAim();
  }
  protected replay(moves: string[]) {
    return carrom.replay(moves, 2, "");
  }
  private placeStriker() {
    const s = this.current;
    const m = this.pieces.get(STRIKER)!;
    if (!s || !this.settled) return;
    const { sx, base } = strikerSpot(s.turn, this.info?.pos ?? 0);
    m.position.copy(cw(sx, base));
    m.visible = s.winner === null;
    this.stage.invalidate();
  }
  protected snap(s: CarromState) {
    this.current = s;
    for (const c of s.coins) {
      const m = this.pieces.get(c.id)!;
      m.visible = !c.out;
      m.position.copy(cw(c.x / K, c.y / K));
    }
    this.placeStriker();
    this.refreshAim();
  }
  protected idle() {
    this.placeStriker();
    this.refreshAim();
  }
  protected async animateStep(before: CarromState, _after: CarromState, move: string) {
    this.aimLine.visible = false;
    const mv = /^s:(-?\d+):(-?\d+):(\d+)$/.exec(move);
    if (!mv) return;
    const sim = carromSimulate(before, Number(mv[1]), Number(mv[2]), Math.max(1, Math.min(100, Number(mv[3]))));
    const striker = this.pieces.get(STRIKER)!;
    striker.visible = true;
    striker.position.copy(cw(sim.sx, sim.base));
    sfx("clack", 0.6);
    const ids = sim.bodies.map((b) => b.id);
    const frames = sim.frames;
    const total = frames.length;
    const sunk = new Map<number, { at: number; from: THREE.Vector3 }>();
    let ev = 0;
    await this.stage.animate(
      (total / 62.5) * 1000,
      (k) => {
        const f = k * (total - 1);
        const a = Math.floor(f);
        const b = Math.min(total - 1, a + 1);
        const u = f - a;
        ids.forEach((id, i) => {
          const m = this.pieces.get(id)!;
          const fa = frames[a][i];
          const fb = frames[b][i];
          const wasOut = i > 0 && before.coins[i - 1].out;
          if (wasOut) return void (m.visible = false);
          if (fa.out) {
            if (!sunk.has(id)) sunk.set(id, { at: f, from: m.position.clone() });
            const d = sunk.get(id)!;
            const t2 = Math.min(1, (f - d.at) / 16);
            let best = CPOCKETS[0];
            let bd = Infinity;
            for (const p of CPOCKETS) {
              const dd = (p[0] - fa.x / K) ** 2 + (p[1] - fa.y / K) ** 2;
              if (dd < bd) {
                bd = dd;
                best = p;
              }
            }
            m.position.lerpVectors(d.from, cw(best[0], best[1], CTOP - 0.3), t2);
            m.visible = t2 < 1;
            return;
          }
          m.visible = true;
          m.position.copy(cw((fa.x + (fb.x - fa.x) * u) / K, (fa.y + (fb.y - fa.y) * u) / K));
        });
        while (ev < sim.events.length && (sim.events[ev].t ?? 0) <= f * 5) {
          const e = sim.events[ev++];
          const v = Math.min(1, (e.v ?? 100000) / 280000);
          if (e.kind === "hit") sfx("clack", 0.2 + v * 0.7);
          else if (e.kind === "wall") sfx("thud", 0.12 + v * 0.35);
          else sfx("capture", 0.5);
        }
      },
      linear,
    );
  }
  // ---- aiming
  private canAim() {
    return !!this.info?.canPlay && !!this.current && this.current.winner === null && this.settled;
  }
  private toTable(p: THREE.Vector3): [number, number] {
    const l = this.root.worldToLocal(p.clone());
    return [(l.x + CB / 2) * S, (l.z + CB / 2) * S];
  }
  private pointer() {
    if (!this.canAim() || !this.current) return;
    const p = this.stage.pointOnPlane(CTOP);
    if (!p) return;
    const [x, y] = this.toTable(p);
    const { sx, base } = strikerSpot(this.current.turn, this.info!.pos);
    if (this.drag === "striker") {
      const pos = Math.round(Math.max(-180, Math.min(180, x - CARROM_S / 2)));
      this.info!.onPos(pos);
      return;
    }
    if (this.drag === "pull" && this.pullStart) {
      const a = (this.angle * Math.PI) / 180;
      const [px, py] = this.toTable(this.pullStart);
      const back = -((x - px) * Math.cos(a) + (y - py) * Math.sin(a));
      this.pullPower = Math.max(0, Math.min(100, Math.round((back / 220) * 100)));
      this.info!.onPower(Math.max(10, this.pullPower));
      return;
    }
    if (Math.hypot(x - sx, y - base) > 20) {
      this.angle = ((Math.round((Math.atan2(y - base, x - sx) * 180) / Math.PI) % 360) + 360) % 360;
      this.info!.onAim(this.angle);
    }
    this.stage.renderer.domElement.style.cursor = Math.hypot(x - sx, y - base) < 22 ? "ew-resize" : "crosshair";
    this.refreshAim();
  }
  private press(e: PointerEvent) {
    if (!this.canAim() || e.button !== 0 || !this.current) return;
    const p = this.stage.pointOnPlane(CTOP);
    if (!p) return;
    const [x, y] = this.toTable(p);
    const { sx, base } = strikerSpot(this.current.turn, this.info!.pos);
    if (Math.hypot(x - sx, y - base) < 22) this.drag = "striker";
    else {
      this.drag = "pull";
      this.pullStart = p;
      this.pullPower = 0;
    }
  }
  private release() {
    const d = this.drag;
    this.drag = null;
    if (d !== "pull" || !this.canAim() || !this.info) return;
    const power = this.pullPower >= 5 ? this.pullPower : this.info.power;
    this.aimLine.visible = false;
    this.info.onFlick(this.info.pos, this.angle, Math.max(10, power));
  }
  setAngle(a: number) {
    this.angle = a;
    this.refreshAim();
  }
  private refreshAim() {
    const s = this.current;
    if (!s || !this.canAim()) {
      this.aimLine.visible = false;
      return this.stage.invalidate();
    }
    const { sx, base } = strikerSpot(s.turn, this.info!.pos);
    const a = (this.angle * Math.PI) / 180;
    const start = cw(sx, base, CTOP + 0.09);
    const end = cw(sx + Math.cos(a) * 160, base + Math.sin(a) * 160, CTOP + 0.09);
    (this.aimLine.geometry as THREE.BufferGeometry).setFromPoints([start, end]);
    this.aimLine.visible = true;
    this.stage.invalidate();
  }
  get flipped() {
    return this.flip;
  }
}

export function Carrom3D({ moves, canPlay, turn, seat, seats, starter = 0, local, onMove }: BoardProps) {
  const state = useMemo(() => carrom.replay(moves, 2, ""), [moves]);
  const [pos, setPos] = useState(0);
  const [power, setPower] = useState(70);
  const angle = useRef(turn === 0 ? 270 : 90);
  const send = useRef(onMove);
  send.current = onMove;
  const [hostRef, scene] = useScene((el) => new CarromScene(el));
  useEffect(() => scene?.setSide(!local && seat === 1), [scene, local, seat]);
  useEffect(() => scene?.sync(2, "", moves), [scene, moves]);
  useEffect(() => {
    angle.current = turn === 0 ? 270 : 90;
    scene?.setAngle(angle.current);
  }, [scene, turn, moves.length]);
  useEffect(() => {
    scene?.setTurn({ canPlay, pos, power, onPos: setPos, onAim: (a) => (angle.current = a), onPower: setPower, onFlick: (x, a, pw) => send.current(`s:${x}:${a}:${pw}`) });
  }, [scene, canPlay, pos, power]);
  if (!state) return null;
  const name = (p: number) => seatFor(seats, starter, p, 2).name;
  return (
    <div data-game-board="carrom" data-g3-board="carrom" className="flex w-full max-w-[680px] flex-col items-center gap-2">
      <BoardBar>
        <span className={turn === 0 ? "underline decoration-2 underline-offset-4" : ""} data-carrom-score>
          {name(0)} (white) {state.potted[0].filter((id) => id >= 1 && id <= 9).length}/9
        </span>
        <span className={turn === 1 ? "underline decoration-2 underline-offset-4" : ""}>
          {name(1)} (black) {state.potted[1].filter((id) => id >= 10 && id <= 18).length}/9
        </span>
        {state.queenBy !== null && <span className="text-rose-600">queen: {name(state.queenBy)}</span>}
        {state.queenPending !== null && <span className="text-rose-600">cover the queen!</span>}
      </BoardBar>
      <SceneBox hostRef={hostRef} aspect={1.12} maxH={560} testId="carrom" />
      {canPlay && (
        <div className="flex flex-wrap items-center justify-center gap-3 text-[12px]" data-carrom-controls>
          <label className="inline-flex items-center gap-1">
            Striker <input data-carrom-pos type="range" min={-180} max={180} value={pos} onChange={(e) => setPos(Number(e.target.value))} className="accent-indigo-600" />
          </label>
          <label className="inline-flex items-center gap-1">
            Power <input data-carrom-power type="range" min={10} max={100} value={power} onChange={(e) => setPower(Number(e.target.value))} className="accent-indigo-600" />
          </label>
          <button type="button" data-carrom-flick onClick={() => onMove(`s:${pos}:${angle.current}:${power}`)} className={primary3}>
            Flick
          </button>
          <span className="max-w-[240px] text-[11.5px] text-slate-500">Drag the striker along your line; aim with the mouse; press and pull back to flick.</span>
        </div>
      )}
      {state.log.length > 0 && <div className="text-[11.5px] text-slate-500">{state.log[state.log.length - 1]}</div>}
    </div>
  );
}

// ============================================================ Mini Golf

const GTOP = 0.3;
const gw = (tx: number, ty: number, y = GTOP + BALL_R / S) => new THREE.Vector3(tx / S - GOLF_W / S / 2, y, ty / S - GOLF_H / S / 2);

class GolfScene extends TurnScene<GolfState> {
  private course = new THREE.Group();
  private balls: THREE.Mesh[] = [];
  private builtHole = -1;
  private colours: string[] = [];
  private info: { canPlay: boolean; onPutt: (angle: number, power: number) => void } | null = null;
  private aim: THREE.Line;
  private pull: THREE.Vector3 | null = null;
  private current: GolfState | null = null;

  constructor(host: HTMLElement) {
    super(host, { fov: 26 });
    const s = this.stage;
    s.scene.add(this.course);
    this.aim = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
    this.aim.visible = false;
    s.scene.add(this.aim);
    s.onPointerMove = () => this.pointer();
    s.onPointerDown = (e) => {
      if (e.button === 0 && this.canAim()) this.pull = this.stage.pointOnPlane(GTOP);
    };
    s.onPointerUp = () => this.release();
    const w = GOLF_W / S;
    const d = GOLF_H / S;
    s.frame(new THREE.Box3(new THREE.Vector3(-w / 2 - 0.3, 0, -d / 2 - 0.3), new THREE.Vector3(w / 2 + 0.3, 0.6, d / 2 + 0.3)), [0, 2.6, 1], 1.03);
  }
  setLook(n: number, colours: string[]) {
    this.colours = colours;
    while (this.balls.length < n) {
      const m = mesh(sharedGeo("golfball", () => new THREE.SphereGeometry(BALL_R / S, 24, 16)), plastic("#ffffff", 0.25));
      this.stage.scene.add(m);
      this.balls.push(m);
    }
    this.balls.forEach((m, p) => (m.material = plastic(colours[p] ?? "#ffffff", 0.25)));
    this.stage.invalidate();
  }
  setTurn(info: { canPlay: boolean; onPutt: (angle: number, power: number) => void }) {
    this.info = info;
    this.refreshAim();
  }
  protected replay(moves: string[]) {
    return minigolf.replay(moves, this.n, "");
  }
  /** The course of a hole: green, walls, blocks, the cup and its flag. */
  private build(holeIndex: number) {
    if (this.builtHole === holeIndex) return;
    this.builtHole = holeIndex;
    for (const c of [...this.course.children]) {
      this.course.remove(c);
      disposeTree(c);
    }
    const h = HOLES[Math.min(holeIndex, HOLES.length - 1)];
    const w = GOLF_W / S;
    const d = GOLF_H / S;
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, d / 2);
    shape.lineTo(w / 2, d / 2);
    shape.lineTo(w / 2, -d / 2);
    shape.lineTo(-w / 2, -d / 2);
    shape.lineTo(-w / 2, d / 2);
    const cup = gw(h.cup[0], h.cup[1], GTOP);
    const hole = new THREE.Path();
    hole.absarc(cup.x, -cup.z, (CUP_R / S) * 0.8, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const green = mesh(new THREE.ShapeGeometry(shape, 24), felt("#2f9e55"));
    green.rotation.x = -Math.PI / 2;
    green.position.y = GTOP;
    green.castShadow = false;
    this.course.add(green);
    const dark = new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 1, side: THREE.DoubleSide });
    const liner = mesh(new THREE.CylinderGeometry((CUP_R / S) * 0.8, (CUP_R / S) * 0.8, 0.25, 24, 1, true), dark, false);
    liner.position.set(cup.x, GTOP - 0.125, cup.z);
    this.course.add(liner);
    const base = mesh(slab(w + 0.5, GTOP - 0.25, d + 0.5, 0.1), wood("dark", 2));
    this.course.add(base);
    const under = mesh(slab(w, 0.04, d, 0.02), dark, false);
    under.position.y = GTOP - 0.25;
    this.course.add(under);
    // The flag.
    const pole = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.9, 8), new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3 }));
    pole.position.set(cup.x, GTOP + 0.45, cup.z);
    this.course.add(pole);
    const flag = mesh(new THREE.PlaneGeometry(0.32, 0.2), new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.6, side: THREE.DoubleSide }));
    flag.position.set(cup.x + 0.16, GTOP + 0.8, cup.z);
    this.course.add(flag);
    // Walls round the edge and the blocks.
    const rail = wood("light", 1);
    for (const [x, z, ww, dd] of [
      [0, -d / 2 - 0.08, w + 0.32, 0.16],
      [0, d / 2 + 0.08, w + 0.32, 0.16],
      [-w / 2 - 0.08, 0, 0.16, d],
      [w / 2 + 0.08, 0, 0.16, d],
    ] as const) {
      const r = mesh(slab(ww, 0.16, dd, 0.05), rail);
      r.position.set(x, GTOP - 0.02, z);
      this.course.add(r);
    }
    const blockMat = new THREE.MeshPhysicalMaterial({ color: 0x9a6b3c, roughness: 0.45, clearcoat: 0.3 });
    for (const [x, y, bw, bh] of h.blocks) {
      const b = mesh(slab(bw / S, 0.2, bh / S, 0.04), blockMat);
      const c = gw(x + bw / 2, y + bh / 2, GTOP);
      b.position.set(c.x, GTOP, c.z);
      this.course.add(b);
    }
    // The tee.
    const tee = mesh(slab(0.4, 0.01, 0.3, 0.005), felt("#1e6b3a"), false);
    const t = gw(h.tee[0], h.tee[1], GTOP);
    tee.position.set(t.x, GTOP, t.z);
    this.course.add(tee);
    this.stage.invalidate();
  }
  protected snap(s: GolfState) {
    this.current = s;
    this.build(s.hole);
    s.ball.forEach((b, p) => {
      const m = this.balls[p];
      if (!m) return;
      m.visible = !!b && !s.done;
      if (b) m.position.copy(gw(b[0], b[1]));
    });
    this.refreshAim();
  }
  protected idle() {
    this.refreshAim();
  }
  protected async animateStep(before: GolfState, _after: GolfState, move: string) {
    this.aim.visible = false;
    const mv = /^s:(-?\d+):(\d+)$/.exec(move);
    const p = before.turn;
    const from = before.ball[p];
    if (!mv || !from) return;
    const { end, path } = golfShot(HOLES[before.hole], from, Number(mv[1]), Math.max(1, Math.min(100, Number(mv[2]))));
    const m = this.balls[p];
    sfx("clack", 0.4);
    const total = path.length;
    let lastWall = -1;
    await this.stage.animate(
      (total / 62.5) * 1000 * 1.2,
      (k) => {
        const f = k * (total - 1);
        const a = Math.floor(f);
        const b = Math.min(total - 1, a + 1);
        const u = f - a;
        const x = path[a][0] + (path[b][0] - path[a][0]) * u;
        const y = path[a][1] + (path[b][1] - path[a][1]) * u;
        const prev = m.position.clone();
        m.position.copy(gw(x, y));
        const dist = prev.distanceTo(m.position);
        if (dist > 1e-5) {
          const axis = new THREE.Vector3(0, 1, 0).cross(m.position.clone().sub(prev)).normalize();
          m.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, dist / (BALL_R / S)));
        }
        // A tap when it turns sharply (a wall).
        if (a > 1 && a !== lastWall) {
          const d1 = [path[a][0] - path[a - 1][0], path[a][1] - path[a - 1][1]];
          const d2 = [path[b][0] - path[a][0], path[b][1] - path[a][1]];
          if (d1[0] * d2[0] + d1[1] * d2[1] < 0 || d1[0] * d2[0] < -1 || d1[1] * d2[1] < -1) {
            lastWall = a;
            sfx("thud", 0.3);
          }
        }
      },
      linear,
    );
    if (!end) {
      // In the cup.
      const at = m.position.clone();
      await this.stage.animate(260, (t) => (m.position.y = at.y - t * 0.25), easeIn);
      m.visible = false;
      sfx("score", 0.8);
    }
    await this.stage.wait(200);
  }
  // ---- putting
  private canAim() {
    const s = this.current;
    return !!this.info?.canPlay && !!s && !s.done && !!s.ball[s.turn] && this.settled;
  }
  private shot(p: THREE.Vector3): { angle: number; power: number } | null {
    const s = this.current;
    if (!s) return null;
    const ball = s.ball[s.turn];
    if (!ball) return null;
    const start = gw(ball[0], ball[1]);
    if (this.pull) {
      // Pulling back: the ball goes the other way, harder the further you pull.
      const d = this.pull.clone().sub(p);
      const len = Math.hypot(d.x, d.z);
      if (len > 0.12) return { angle: Math.round((Math.atan2(d.z, d.x) * 180) / Math.PI), power: Math.max(1, Math.min(100, Math.round((len / 2.2) * 100))) };
    }
    const dx = p.x - start.x;
    const dz = p.z - start.z;
    return { angle: Math.round((Math.atan2(dz, dx) * 180) / Math.PI), power: Math.max(1, Math.min(100, Math.round((Math.hypot(dx, dz) * S) / 4))) };
  }
  private pointer() {
    this.refreshAim();
  }
  private release() {
    const start = this.pull;
    this.pull = null;
    if (!start || !this.canAim() || !this.info) return;
    const p = this.stage.pointOnPlane(GTOP);
    if (!p) return;
    const pulled = Math.hypot(p.x - start.x, p.z - start.z) > 0.12;
    this.pull = pulled ? start : null;
    const shot = this.shot(p);
    this.pull = null;
    if (!shot) return;
    this.aim.visible = false;
    this.info.onPutt(((shot.angle % 360) + 360) % 360, shot.power);
  }
  private refreshAim() {
    const s = this.current;
    const p = this.stage.pointOnPlane(GTOP);
    if (!s || !this.canAim() || !p) {
      this.aim.visible = false;
      return this.stage.invalidate();
    }
    const shot = this.shot(p);
    const ball = s.ball[s.turn]!;
    if (!shot) return;
    const start = gw(ball[0], ball[1], GTOP + 0.02);
    const a = (shot.angle * Math.PI) / 180;
    const len = 0.3 + (shot.power / 100) * 2.2;
    const end = start.clone().add(new THREE.Vector3(Math.cos(a) * len, 0, Math.sin(a) * len));
    (this.aim.geometry as THREE.BufferGeometry).setFromPoints([start, end]);
    (this.aim.material as THREE.LineBasicMaterial).color.set(this.colours[s.turn] ?? "#ffffff");
    this.aim.visible = true;
    this.stage.renderer.domElement.style.cursor = "crosshair";
    this.stage.invalidate();
  }
}

export function Golf3D({ moves, canPlay, turn, seats, starter = 0, onMove }: BoardProps) {
  const n = Math.max(1, seats?.length ?? 1);
  const state = useMemo(() => minigolf.replay(moves, n, ""), [moves, n]);
  const colours = useMemo(() => Array.from({ length: n }, (_, i) => seatFor(seats, starter, i, n).color), [seats, starter, n]);
  const send = useRef(onMove);
  send.current = onMove;
  const [power, setPower] = useState(40);
  const [hostRef, scene] = useScene((el) => new GolfScene(el));
  useEffect(() => scene?.setLook(n, colours), [scene, n, colours]);
  useEffect(() => scene?.sync(n, "", moves), [scene, n, moves]);
  useEffect(() => scene?.setTurn({ canPlay, onPutt: (a, p) => send.current(`s:${a}:${p}`) }), [scene, canPlay]);
  if (!state) return null;
  const hole = HOLES[Math.min(state.hole, HOLES.length - 1)];
  const name = (p: number) => seatFor(seats, starter, p, n).name;
  return (
    <div data-game-board="minigolf" data-g3-board="minigolf" className="flex w-full max-w-[640px] flex-col items-center gap-2">
      <BoardBar>
        <span data-golf-scores>
          Hole {Math.min(state.hole + 1, HOLES.length)} of {HOLES.length} · par {hole.par}
        </span>
        <span className="font-normal text-slate-500">{canPlay ? "Pull back from anywhere and let go — or click where to putt." : state.done ? "All nine holes played." : `${name(turn)} is putting.`}</span>
      </BoardBar>
      <SceneBox hostRef={hostRef} aspect={0.95} minH={360} maxH={600} testId="minigolf" />
      {canPlay && (
        <div className="flex items-center gap-3 text-[12px]" data-golf-controls>
          <label className="inline-flex items-center gap-1">
            Power <input data-golf-power type="range" min={5} max={100} value={power} onChange={(e) => setPower(Number(e.target.value))} className="accent-indigo-600" />
          </label>
          <span className="text-slate-500">aim straight at the cup:</span>
          <button
            type="button"
            data-golf-putt
            onClick={() => {
              const b = state.ball[turn];
              if (!b) return;
              const a = Math.round((Math.atan2(hole.cup[1] - b[1], hole.cup[0] - b[0]) * 180) / Math.PI);
              onMove(`s:${((a % 360) + 360) % 360}:${power}`);
            }}
            className={primary3}
          >
            Putt
          </button>
        </div>
      )}
      <table className="text-[11px]" data-golf-card>
        <thead>
          <tr className="text-slate-500">
            <td className="pr-2" />
            {HOLES.map((_, k) => (
              <td key={k} className={`w-6 text-center ${k === state.hole ? "font-bold text-indigo-600" : ""}`}>
                {k + 1}
              </td>
            ))}
            <td className="pl-2 font-bold">Total</td>
          </tr>
        </thead>
        <tbody>
          {state.strokes.map((st, p) => (
            <tr key={p} className={p === turn && !state.done ? "font-semibold" : ""}>
              <td className="pr-2">
                <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colours[p] }} />
                {name(p)}
              </td>
              {HOLES.map((_, k) => (
                <td key={k} className="text-center">
                  {k < st.length ? (st[k] >= MAX_STROKES ? `${MAX_STROKES}*` : st[k] || (k < state.hole ? "–" : "")) : ""}
                </td>
              ))}
              <td className="pl-2 font-bold">{st.reduce((a, b) => a + b, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
