// LANX 2.16.0: the live arcade in 3D — an air-hockey table with a sliding
// puck and two mallets, a table-football pitch with rods of little players
// that swing when they kick, and a spinning-top arena. The host's PC still
// runs each game and streams it (boards/RealtimeBoards: useAirHockey,
// useFoosball, useSpinner — shared with the flat boards); this only draws
// it, smoothing between the snapshots so it moves at the screen's own rate.

import * as THREE from "three";
import { useEffect, useMemo, useRef } from "react";
import type { BoardProps } from "../../boardProps";
import { label, useAirHockey, useFoosball, useSpinner } from "../../boards/RealtimeBoards";
import { AH_H, AH_W, GOAL_W, PADDLE_R, PUCK_R, type AHState } from "../../../../lib/games/sim/airhockey.ts";
import { BALL_R, FB_H, FB_W, GOAL_H, MAN_H, MAN_W, RODS, menOf, type FBState } from "../../../../lib/games/sim/foosball.ts";
import { ARENA_R, SPIN_R, type SpinState } from "../../../../lib/games/sim/spinner.ts";
import { Stage } from "../stage";
import { canvasTexture, mesh, metal, plastic, slab, wood } from "../kit";
import { SceneBox, useScene } from "../Board3D";
import { BoardBar, SeatDot } from "../ui";

const S = 100;

/** Moves a value towards a target a little each frame (smooth, frame-rate independent). */
const follow = (cur: number, to: number, dt: number, rate = 22) => cur + (to - cur) * (1 - Math.exp(-rate * dt));

// ============================================================ Air Hockey

const AW = AH_W / S;
const AD = AH_H / S;
const ATOP = 0.5;

class AirHockeyScene {
  readonly stage: Stage;
  private root = new THREE.Group();
  private puck: THREE.Mesh;
  private mallets: THREE.Group[] = [];
  private target: AHState | null = null;
  constructor(host: HTMLElement) {
    this.stage = new Stage(host, { fov: 28, continuous: true });
    const s = this.stage;
    s.scene.add(this.root);
    const surface = new THREE.Mesh(
      new THREE.PlaneGeometry(AW, AD),
      new THREE.MeshPhysicalMaterial({
        map: canvasTexture(400, 700, (ctx, w, h) => {
          ctx.fillStyle = "#eef6fb";
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = "rgba(14,165,233,0.25)";
          for (let y = 12; y < h; y += 22) for (let x = 12; x < w; x += 22) ctx.fillRect(x, y, 2, 2);
          ctx.strokeStyle = "#dc2626";
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(0, h / 2);
          ctx.lineTo(w, h / 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(w / 2, h / 2, 60, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = "#0ea5e9";
          for (const y of [0, h]) {
            ctx.beginPath();
            ctx.arc(w / 2, y, 90, 0, Math.PI * 2);
            ctx.stroke();
          }
        }),
        roughness: 0.15,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
      }),
    );
    surface.rotation.x = -Math.PI / 2;
    surface.position.y = ATOP;
    surface.receiveShadow = true;
    this.root.add(surface);
    const body = mesh(slab(AW + 0.6, ATOP - 0.02, AD + 0.6, 0.15), new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6 }));
    this.root.add(body);
    // Rails, with the goal mouths left open.
    const rail = new THREE.MeshPhysicalMaterial({ color: 0x334155, roughness: 0.4, clearcoat: 0.6 });
    for (const sx of [-1, 1]) {
      const r = mesh(slab(0.16, 0.16, AD + 0.32, 0.05), rail);
      r.position.set(sx * (AW / 2 + 0.08), ATOP, 0);
      this.root.add(r);
    }
    const seg = (AW - GOAL_W / S) / 2;
    for (const sz of [-1, 1])
      for (const sx of [-1, 1]) {
        const r = mesh(slab(seg + 0.16, 0.16, 0.16, 0.05), rail);
        r.position.set(sx * (AW / 2 - seg / 2 + 0.08), ATOP, sz * (AD / 2 + 0.08));
        this.root.add(r);
      }
    this.puck = mesh(new THREE.CylinderGeometry(PUCK_R / S, PUCK_R / S, 0.05, 32), new THREE.MeshPhysicalMaterial({ color: 0x111827, roughness: 0.3, clearcoat: 0.8 }));
    this.puck.position.y = ATOP + 0.025;
    this.root.add(this.puck);
    for (let k = 0; k < 2; k++) {
      const g = new THREE.Group();
      const base = mesh(new THREE.CylinderGeometry(PADDLE_R / S, PADDLE_R / S, 0.07, 36), plastic("#ef4444"));
      base.position.y = 0.035;
      const knob = mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.22, 24), plastic("#ef4444"));
      knob.position.y = 0.18;
      const top = mesh(new THREE.SphereGeometry(0.11, 20, 12), plastic("#ef4444"));
      top.position.y = 0.3;
      g.add(base, knob, top);
      g.position.y = ATOP;
      this.root.add(g);
      this.mallets.push(g);
    }
    s.onFrame((dt) => {
      const t = this.target;
      if (!t) return true;
      this.puck.position.x = follow(this.puck.position.x, t.puck.x / S - AW / 2, dt);
      this.puck.position.z = follow(this.puck.position.z, t.puck.y / S - AD / 2, dt);
      t.paddles.forEach((p, i) => {
        const m = this.mallets[i];
        m.position.x = follow(m.position.x, p.x / S - AW / 2, dt, 30);
        m.position.z = follow(m.position.z, p.y / S - AD / 2, dt, 30);
      });
      return true;
    });
    s.frame(new THREE.Box3(new THREE.Vector3(-AW / 2 - 0.4, 0, -AD / 2 - 0.4), new THREE.Vector3(AW / 2 + 0.4, ATOP + 0.4, AD / 2 + 0.4)), [0, 2.2, 1], 1.02);
  }
  setLook(colours: string[], flip: boolean) {
    this.mallets.forEach((g, i) => g.children.forEach((c) => ((c as THREE.Mesh).material = plastic(colours[i] ?? "#ef4444"))));
    this.root.rotation.y = flip ? Math.PI : 0;
  }
  show(s: AHState) {
    this.target = s;
  }
  /** The pointer on the table, in table units (the game's own). */
  pointer(): { x: number; y: number } | null {
    const p = this.stage.pointOnPlane(ATOP);
    if (!p) return null;
    const l = this.root.worldToLocal(p.clone());
    return { x: (l.x + AW / 2) * S, y: (l.z + AD / 2) * S };
  }
  dispose() {
    this.stage.dispose();
  }
}

export function AirHockey3D(p: BoardProps) {
  const { rec, view, setInput } = useAirHockey(p);
  const [hostRef, scene] = useScene((el) => new AirHockeyScene(el));
  const flip = p.seat === 1 && !p.local;
  const colours = useMemo(() => [label(p, 0, 2).color, label(p, 1, 2).color], [p]);
  useEffect(() => scene?.setLook(colours, flip), [scene, colours, flip]);
  useEffect(() => scene?.show(view), [scene, view]);
  const can = useRef(false);
  can.current = p.canPlay || !!p.local;
  useEffect(() => {
    if (!scene) return;
    scene.stage.onPointerMove = () => {
      if (!can.current) return;
      const pt = scene.pointer();
      setInput(pt);
    };
    scene.stage.renderer.domElement.style.cursor = "none";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);
  const goals = rec?.goals ?? [0, 0];
  return (
    <div data-game-board="airhockey" data-g3-board="airhockey" className="flex w-full max-w-[640px] flex-col items-center gap-2">
      <BoardBar>
        <span data-live-score>
          {label(p, 0, 2).name} {goals[0]} — {goals[1]} {label(p, 1, 2).name} <span className="font-normal text-slate-400">· first to 5</span>
        </span>
      </BoardBar>
      <SceneBox hostRef={hostRef} aspect={0.95} minH={380} maxH={600} testId="airhockey" />
      <div className="text-[11px] text-slate-500">{p.local ? "Pass & play: one pointer moves the near mallet." : "Move the mouse over your half to move your mallet."}</div>
    </div>
  );
}

// ============================================================ Table Soccer

const FW = FB_W / S;
const FD = FB_H / S;
const FTOP = 0.4;

function footballer(colour: string): THREE.Group {
  const g = new THREE.Group();
  const mat = plastic(colour, 0.35);
  const body = mesh(slab((MAN_W / S) * 1.1, 0.34, (MAN_H / S) * 0.7, 0.05), mat);
  body.position.y = 0.2;
  const head = mesh(new THREE.SphereGeometry(0.07, 16, 12), new THREE.MeshStandardMaterial({ color: 0xf1c27d, roughness: 0.6 }));
  head.position.y = 0.6;
  const foot = mesh(slab((MAN_W / S) * 1.2, 0.12, (MAN_H / S) * 0.6, 0.04), mat);
  foot.position.y = 0.0;
  g.add(body, head, foot);
  return g;
}

class FoosballScene {
  readonly stage: Stage;
  private root = new THREE.Group();
  private ball: THREE.Mesh;
  /** rods[side][rod] = { group (turns when kicking), men }. */
  private rods: { group: THREE.Group; men: THREE.Group[] }[][] = [[], []];
  private marker: THREE.Mesh;
  private target: FBState | null = null;
  private mine = 0;
  private rodIndex = 2;
  constructor(host: HTMLElement) {
    this.stage = new Stage(host, { fov: 28, continuous: true });
    const s = this.stage;
    s.scene.add(this.root);
    const pitch = new THREE.Mesh(
      new THREE.PlaneGeometry(FW, FD),
      new THREE.MeshStandardMaterial({
        map: canvasTexture(700, 400, (ctx, w, h) => {
          for (let k = 0; k < 10; k++) {
            ctx.fillStyle = k % 2 ? "#2f8f46" : "#2a8540";
            ctx.fillRect((k * w) / 10, 0, w / 10 + 1, h);
          }
          ctx.strokeStyle = "rgba(255,255,255,0.85)";
          ctx.lineWidth = 4;
          ctx.strokeRect(4, 4, w - 8, h - 8);
          ctx.beginPath();
          ctx.moveTo(w / 2, 0);
          ctx.lineTo(w / 2, h);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(w / 2, h / 2, 50, 0, Math.PI * 2);
          ctx.stroke();
          for (const x of [0, w - 70]) ctx.strokeRect(x, h / 2 - 90, 70, 180);
        }),
        roughness: 0.85,
      }),
    );
    pitch.rotation.x = -Math.PI / 2;
    pitch.position.y = FTOP;
    pitch.receiveShadow = true;
    this.root.add(pitch);
    const cab = wood("walnut", 2);
    const body = mesh(slab(FW + 0.7, FTOP - 0.02, FD + 0.7, 0.12), cab);
    this.root.add(body);
    for (const sz of [-1, 1]) {
      const w = mesh(slab(FW + 0.7, 0.55, 0.2, 0.05), cab);
      w.position.set(0, FTOP - 0.02, sz * (FD / 2 + 0.25));
      this.root.add(w);
    }
    const gseg = (FD - GOAL_H / S) / 2;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const w = mesh(slab(0.2, 0.55, gseg + 0.2, 0.05), cab);
        w.position.set(sx * (FW / 2 + 0.1), FTOP - 0.02, sz * (FD / 2 - gseg / 2 + 0.1));
        this.root.add(w);
      }
    for (const sx of [-1, 1]) {
      const net = mesh(slab(0.3, 0.3, GOAL_H / S, 0.03), new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 1 }));
      net.position.set(sx * (FW / 2 + 0.25), FTOP - 0.1, 0);
      this.root.add(net);
    }
    const steel = metal(0xcbd5e1, 0.25);
    for (const side of [0, 1])
      RODS.forEach((r, k) => {
        const x = (side === 0 ? r.x : FB_W - r.x) / S - FW / 2;
        const group = new THREE.Group();
        group.position.set(x, FTOP + 0.48, 0);
        const bar = mesh(new THREE.CylinderGeometry(0.025, 0.025, FD + 1.6, 12), steel);
        bar.rotation.x = Math.PI / 2;
        group.add(bar);
        const handle = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.32, 14), new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.6 }));
        handle.rotation.x = Math.PI / 2;
        handle.position.z = side === 0 ? FD / 2 + 0.9 : -FD / 2 - 0.9;
        group.add(handle);
        const men: THREE.Group[] = [];
        for (let m = 0; m < r.men; m++) {
          const f = footballer(side === 0 ? "#ef4444" : "#3b82f6");
          f.position.y = -0.46;
          group.add(f);
          men.push(f);
        }
        this.root.add(group);
        this.rods[side][k] = { group, men };
      });
    this.ball = mesh(new THREE.SphereGeometry(BALL_R / S, 20, 14), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 }));
    this.ball.position.y = FTOP + BALL_R / S;
    this.root.add(this.ball);
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.08, 0.12, 28), new THREE.MeshBasicMaterial({ color: 0xfacc15, depthTest: false }));
    this.marker.renderOrder = 10;
    this.root.add(this.marker);
    s.onFrame((dt) => {
      const t = this.target;
      if (!t) return true;
      this.ball.position.x = follow(this.ball.position.x, t.ball.x / S - FW / 2, dt);
      this.ball.position.z = follow(this.ball.position.z, t.ball.y / S - FD / 2, dt);
      for (const side of [0, 1])
        RODS.forEach((_r, k) => {
          const rod = this.rods[side][k];
          const men = menOf(side, k, t.rodY[side][k]);
          men.forEach((m, i) => (rod.men[i].position.z = follow(rod.men[i].position.z, m.y / S - FD / 2, dt, 30)));
          // A kick swings the men round the rod and back.
          const kick = t.kick[side][k];
          const swing = kick > 0 ? Math.sin(((8 - kick) / 8) * Math.PI) * 1.3 * (side === 0 ? 1 : -1) : 0;
          rod.group.rotation.z = follow(rod.group.rotation.z, -swing, dt, 40);
        });
      const sel = this.rods[this.mine][this.rodIndex];
      if (sel) this.marker.position.set(sel.group.position.x, FTOP + 0.02, this.mine === 0 ? FD / 2 + 0.15 : -FD / 2 - 0.15);
      this.marker.rotation.x = -Math.PI / 2;
      return true;
    });
    s.frame(new THREE.Box3(new THREE.Vector3(-FW / 2 - 0.5, 0, -FD / 2 - 1.2), new THREE.Vector3(FW / 2 + 0.5, FTOP + 0.6, FD / 2 + 1.2)), [0, 2.0, 1], 1.02);
  }
  setLook(colours: string[], mine: number, flip: boolean) {
    this.mine = mine;
    for (const side of [0, 1]) for (const rod of this.rods[side]) for (const m of rod.men) m.children.forEach((c, i) => i !== 1 && ((c as THREE.Mesh).material = plastic(colours[side] ?? "#ef4444", 0.35)));
    this.root.rotation.y = flip ? Math.PI : 0;
  }
  show(s: FBState, rod: number) {
    this.target = s;
    this.rodIndex = rod;
  }
  pointer(): { x: number; y: number } | null {
    const p = this.stage.pointOnPlane(FTOP);
    if (!p) return null;
    const l = this.root.worldToLocal(p.clone());
    return { x: (l.x + FW / 2) * S, y: (l.z + FD / 2) * S };
  }
  dispose() {
    this.stage.dispose();
  }
}

export function Foosball3D(p: BoardProps) {
  const { rec, view, side, rod, pickRod, moveTo } = useFoosball(p);
  const [hostRef, scene] = useScene((el) => new FoosballScene(el));
  const colours = useMemo(() => [label(p, 0, 2).color, label(p, 1, 2).color], [p]);
  useEffect(() => scene?.setLook(colours, side, side === 1), [scene, colours, side]);
  useEffect(() => scene?.show(view, rod.current), [scene, view, rod]);
  useEffect(() => {
    if (!scene) return;
    scene.stage.onPointerMove = () => {
      const pt = scene.pointer();
      if (pt) moveTo(pt.y);
    };
    scene.stage.onPointerDown = (e) => {
      if (e.button !== 0) return;
      const pt = scene.pointer();
      if (pt) pickRod(pt.x);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);
  const goals = rec?.goals ?? [0, 0];
  return (
    <div data-game-board="foosball" data-g3-board="foosball" className="flex w-full max-w-[760px] flex-col items-center gap-2">
      <BoardBar>
        <span data-live-score>
          {label(p, 0, 2).name} {goals[0]} — {goals[1]} {label(p, 1, 2).name} <span className="font-normal text-slate-400">· first to 5</span>
        </span>
      </BoardBar>
      <SceneBox hostRef={hostRef} aspect={1.45} maxH={520} testId="foosball" />
      <div className="text-[11px] text-slate-500">Keys 1–4 (or click near a rod) pick a rod; move the mouse up and down; click or Space to kick.</div>
    </div>
  );
}

// ============================================================ Spinner Wars

const SR = ARENA_R / S;
const STOP = 0.3;

function topGeometry() {
  const pts = [
    [0, 0],
    [0.03, 0.02],
    [0.12, 0.1],
    [SPIN_R / S, 0.16],
    [SPIN_R / S, 0.2],
    [0.12, 0.25],
    [0.05, 0.27],
    [0.04, 0.4],
    [0, 0.42],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(pts, 32);
}

class SpinnerScene {
  readonly stage: Stage;
  private tops: THREE.Group[] = [];
  private target: SpinState | null = null;
  private fallen = new Map<number, number>();
  constructor(host: HTMLElement) {
    this.stage = new Stage(host, { fov: 28, continuous: true });
    const s = this.stage;
    // The arena: a shallow dish with a raised rim.
    const dish = mesh(
      new THREE.LatheGeometry(
        [
          [0, STOP - 0.12],
          [SR * 0.6, STOP - 0.09],
          [SR, STOP],
          [SR + 0.12, STOP + 0.12],
          [SR + 0.3, STOP + 0.1],
          [SR + 0.32, 0],
          [0, 0],
        ].map(([x, y]) => new THREE.Vector2(x, y)),
        96,
      ),
      new THREE.MeshPhysicalMaterial({ color: 0x334155, roughness: 0.35, clearcoat: 0.6, side: THREE.DoubleSide }),
    );
    dish.receiveShadow = true;
    s.scene.add(dish);
    const ring = new THREE.Mesh(new THREE.RingGeometry(SR - 0.04, SR, 96), new THREE.MeshBasicMaterial({ color: 0xf59e0b }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = STOP + 0.002;
    s.scene.add(ring);
    s.onFrame((dt) => {
      const t = this.target;
      if (!t) return true;
      t.spinners.forEach((sp, i) => {
        const g = this.tops[i];
        if (!g) return;
        if (sp.out) {
          // Knocked out: flies off the rim and drops away.
          const since = (this.fallen.get(i) ?? 0) + dt;
          this.fallen.set(i, since);
          g.position.y -= dt * since * 6;
          g.rotation.x += dt * 4;
          g.visible = since < 1.2;
          return;
        }
        this.fallen.delete(i);
        g.visible = true;
        g.position.x = follow(g.position.x, sp.x / S, dt);
        g.position.z = follow(g.position.z, sp.y / S, dt);
        const r = Math.hypot(g.position.x, g.position.z) / SR;
        g.position.y = STOP - 0.12 + Math.max(0, r - 0.6) * 0.3;
        const spinning = g.children[0];
        spinning.rotation.y += dt * (4 + sp.spin * 0.25);
        // Wobbles as it slows down.
        const wob = (1 - sp.spin / 100) * 0.35;
        g.rotation.x = Math.sin(performance.now() / 160 + i) * wob;
        g.rotation.z = Math.cos(performance.now() / 160 + i) * wob;
      });
      return true;
    });
    s.frame(new THREE.Box3(new THREE.Vector3(-SR - 0.4, 0, -SR - 0.4), new THREE.Vector3(SR + 0.4, 0.8, SR + 0.4)), [0, 2.6, 1], 1.02);
  }
  setLook(n: number, colours: string[]) {
    const geo = topGeometry();
    while (this.tops.length < n) {
      const g = new THREE.Group();
      const spin = new THREE.Group();
      const body = mesh(geo, plastic("#ef4444"));
      const stripe = mesh(new THREE.TorusGeometry(SPIN_R / S, 0.012, 8, 40), new THREE.MeshStandardMaterial({ color: 0xffffff }));
      stripe.rotation.x = Math.PI / 2;
      stripe.position.y = 0.18;
      spin.add(body, stripe);
      g.add(spin);
      this.stage.scene.add(g);
      this.tops.push(g);
    }
    this.tops.forEach((g, i) => (((g.children[0] as THREE.Group).children[0] as THREE.Mesh).material = plastic(colours[i] ?? "#ef4444")));
  }
  show(s: SpinState) {
    this.target = s;
  }
  pointer(): { x: number; y: number } | null {
    const p = this.stage.pointOnPlane(STOP - 0.1);
    return p ? { x: p.x * S, y: p.z * S } : null;
  }
  dispose() {
    this.stage.dispose();
  }
}

export function Spinner3D(p: BoardProps) {
  const { rec, n, view, setInput } = useSpinner(p);
  const [hostRef, scene] = useScene((el) => new SpinnerScene(el));
  const colours = useMemo(() => Array.from({ length: n }, (_, i) => label(p, i, n).color), [p, n]);
  useEffect(() => scene?.setLook(n, colours), [scene, n, colours]);
  useEffect(() => scene?.show(view), [scene, view]);
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    if (!scene) return;
    scene.stage.onPointerMove = () => {
      const mine = viewRef.current.spinners[p.seat];
      const pt = scene.pointer();
      if (!mine || mine.out || !pt) return;
      setInput({ x: pt.x - mine.x, y: pt.y - mine.y });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, p.seat]);
  return (
    <div data-game-board="spinnerwars" data-g3-board="spinnerwars" className="flex w-full max-w-[620px] flex-col items-center gap-2">
      <BoardBar>
        <span data-live-score className="inline-flex flex-wrap items-center gap-x-3">
          {(rec?.out ?? []).map((o, i) => (
            <span key={i} className={`inline-flex items-center gap-1 ${o ? "line-through opacity-50" : ""}`}>
              <SeatDot color={colours[i]} size={10} /> {label(p, i, n).name} {view.wins[i] ?? 0}
            </span>
          ))}
          <span className="font-normal text-slate-400">round {view.round}/3</span>
        </span>
      </BoardBar>
      <SceneBox hostRef={hostRef} aspect={1.15} maxH={560} testId="spinnerwars" />
      <div className="text-[11px] text-slate-500">Your top chases the mouse. Bump the others out; a slow top wobbles and drops.</div>
    </div>
  );
}


