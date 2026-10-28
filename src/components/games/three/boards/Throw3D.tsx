// LANX 2.16.0: the throwing games in 3D — Darts (a real board on the wall,
// a sight that wobbles, darts that fly in an arc and stick), Archery (a
// range with the target down the field, a wind flag, hold to draw — the
// sight steadies, then tires — and arrows that arc and drift with the wind)
// and Cup Pong (a long table, two triangles of cups, a ball that arcs, drops
// in or bounces away). Where things land is the rules' answer (lib/games),
// worked out the same on every PC; the flight only shows it.

import * as THREE from "three";
import { useEffect, useMemo, useRef, useState } from "react";
import { namesIn, seatFor, type BoardProps } from "../../boardProps";
import { DART_R, DART_START, dartFinish, darts, type DartsState } from "../../../../lib/games/darts.ts";
import { ARROWS, TARGET_R, archery, archerySway, windFor, type ArcheryState } from "../../../../lib/games/archery.ts";
import { CUPS, CUP_R, cupPong, pongSide, pongSway, type PongState } from "../../../../lib/games/cuppong.ts";
import { sfx } from "../../../../lib/gameSounds";
import { TurnScene } from "../turnScene";
import { FONT, canvasTexture, felt, mesh, metal, slab, wood } from "../kit";
import { SceneBox, useScene } from "../Board3D";
import { BoardBar, SeatDot, primary3 } from "../ui";
import { disposeTree, easeIn, easeOut, linear } from "../stage";

// ============================================================ Darts

const DB = 0.01; // world per board unit
const DART_Y = 2.2;
const SECTORS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

function dartboardTexture(renderer: THREE.WebGLRenderer) {
  const P = 1024;
  const R = DART_R + 34; // numbers ring outside the double ring
  const k = P / 2 / R;
  return canvasTexture(
    P,
    P,
    (ctx) => {
      ctx.fillStyle = "#111827";
      ctx.beginPath();
      ctx.arc(P / 2, P / 2, P / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.translate(P / 2, P / 2);
      SECTORS.forEach((lab, i) => {
        const a0 = ((i * 18 - 9 - 90) * Math.PI) / 180;
        const a1 = ((i * 18 + 9 - 90) * Math.PI) / 180;
        const dark = i % 2 === 0;
        const ring = (r0: number, r1: number, fill: string) => {
          ctx.beginPath();
          ctx.arc(0, 0, r1 * k, a0, a1);
          ctx.arc(0, 0, r0 * k, a1, a0, true);
          ctx.closePath();
          ctx.fillStyle = fill;
          ctx.fill();
          ctx.strokeStyle = "#cbd5e1";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        };
        ring(16, 99, dark ? "#1f2937" : "#f3ead2");
        ring(99, 107, dark ? "#c81e1e" : "#15803d");
        ring(107, 162, dark ? "#1f2937" : "#f3ead2");
        ring(162, DART_R, dark ? "#c81e1e" : "#15803d");
        const mid = (a0 + a1) / 2;
        ctx.save();
        ctx.translate(Math.cos(mid) * (DART_R + 17) * k, Math.sin(mid) * (DART_R + 17) * k);
        ctx.fillStyle = "#f8fafc";
        ctx.font = `800 ${18 * k}px ${FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(lab), 0, 0);
        ctx.restore();
      });
      ctx.beginPath();
      ctx.arc(0, 0, 16 * k, 0, Math.PI * 2);
      ctx.fillStyle = "#15803d";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 0, 6.35 * k, 0, Math.PI * 2);
      ctx.fillStyle = "#c81e1e";
      ctx.fill();
    },
    renderer,
  );
}

function dartMesh(colour: string): THREE.Object3D {
  const g = new THREE.Group();
  const steel = metal(0xb8bec8, 0.25);
  const tip = mesh(new THREE.ConeGeometry(0.012, 0.12, 10), steel);
  tip.rotation.x = -Math.PI / 2;
  tip.position.z = -0.06;
  const barrel = mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.16, 14), metal(0x8b9099, 0.35));
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = 0.08;
  const shaft = mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.14, 8), new THREE.MeshStandardMaterial({ color: 0x111827 }));
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = 0.23;
  const fl = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.5, side: THREE.DoubleSide });
  for (const r of [0, Math.PI / 2]) {
    const f = mesh(new THREE.PlaneGeometry(0.1, 0.12), fl, false);
    f.position.z = 0.3;
    f.rotation.set(Math.PI / 2, r, 0);
    g.add(f);
  }
  g.add(tip, barrel, shaft);
  return g;
}

class DartsScene extends TurnScene<DartsState> {
  private sight: THREE.Group;
  private darts = new Map<string, THREE.Object3D>();
  private colours: string[] = [];
  private info: { canPlay: boolean; onThrow: (x: number, y: number) => void } | null = null;
  private aim: [number, number] = [0, -103];
  private wobble: [number, number] = [0, 0];
  private stopWobble: (() => void) | null = null;
  constructor(host: HTMLElement) {
    super(host, { fov: 24 });
    const s = this.stage;
    s.setGroundY(-50);
    // The wall and the board.
    const back = mesh(new THREE.BoxGeometry(6.4, 4.4, 0.08), new THREE.MeshStandardMaterial({ color: 0x3f4a5c, roughness: 0.95 }));
    back.position.set(0, DART_Y, -0.3);
    s.scene.add(back);
    const surround = mesh(new THREE.CylinderGeometry((DART_R + 60) * DB, (DART_R + 60) * DB, 0.1, 64), new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.8 }));
    surround.rotation.x = Math.PI / 2;
    surround.position.set(0, DART_Y, -0.22);
    s.scene.add(surround);
    const boardGeo = new THREE.CylinderGeometry((DART_R + 34) * DB, (DART_R + 34) * DB, 0.16, 96);
    const side = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.6 });
    const face = new THREE.MeshStandardMaterial({ map: dartboardTexture(s.renderer), roughness: 0.75 });
    const board = mesh(boardGeo, [side, face, side]);
    // Stand the board up facing you, with the picture's top (the 20) at the top: the cap's
    // picture runs sideways round a cylinder, so it is turned a quarter about the facing axis too.
    board.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)));
    board.position.set(0, DART_Y, -0.1);
    board.name = "dartboard";
    s.scene.add(board);
    // The sight: a ring and a cross, hovering just off the board.
    this.sight = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.95, depthTest: false });
    this.sight.add(new THREE.Mesh(new THREE.RingGeometry(0.06, 0.08, 32), ringMat));
    this.sight.add(new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.016), ringMat));
    this.sight.add(new THREE.Mesh(new THREE.PlaneGeometry(0.016, 0.26), ringMat));
    this.sight.children.forEach((c) => (c.renderOrder = 10));
    this.sight.visible = false;
    s.scene.add(this.sight);
    s.onPointerMove = () => {
      const p = this.stage.pointOn(new THREE.Plane(new THREE.Vector3(0, 0, 1), -0.0));
      if (p) this.aim = [Math.round(p.x / DB), Math.round(-(p.y - DART_Y) / DB)];
    };
    s.onTap = () => this.throwNow();
    const R = (DART_R + 60) * DB;
    s.frame(new THREE.Box3(new THREE.Vector3(-R, DART_Y - R, -0.3), new THREE.Vector3(R, DART_Y + R, 0.1)), [0, 0.12, 1], 1.04);
  }
  setLook(colours: string[]) {
    this.colours = colours;
  }
  setTurn(info: { canPlay: boolean; onThrow: (x: number, y: number) => void }) {
    this.info = info;
    this.sightLoop();
  }
  /** Where a throw now would land (the sight). */
  get sightAt(): [number, number] {
    return [this.aim[0] + this.wobble[0], this.aim[1] + this.wobble[1]];
  }
  throwNow() {
    if (!this.info?.canPlay || !this.settled) return;
    const [x, y] = this.sightAt;
    this.info.onThrow(Math.round(x), Math.round(y));
  }
  /** While it is your throw, the sight sways (a figure of eight). */
  private sightLoop() {
    const on = !!this.info?.canPlay;
    this.sight.visible = on;
    if (on && !this.stopWobble) {
      const t0 = performance.now();
      this.stopWobble = this.stage.onFrame(() => {
        const t = (performance.now() - t0) / 1000;
        this.wobble = [Math.sin((t * Math.PI * 2) / 1.7) * 28, Math.sin((t * Math.PI * 2) / 2.3) * 28];
        const [x, y] = this.sightAt;
        this.sight.position.set(x * DB, DART_Y - y * DB, 0.02);
        return true;
      });
    } else if (!on && this.stopWobble) {
      this.stopWobble();
      this.stopWobble = null;
    }
    this.stage.invalidate();
  }
  protected replay(moves: string[]) {
    return darts.replay(moves, this.n, "");
  }
  private keysFor(s: DartsState, moves: string[]) {
    return s.thrown.map((_t, k) => `dart:${moves.length - s.thrown.length + k}`);
  }
  private boardPoint(x: number, y: number) {
    return new THREE.Vector3(x * DB, DART_Y - y * DB, 0.12);
  }
  protected snap(s: DartsState, moves: string[]) {
    const keys = this.keysFor(s, moves);
    for (const [k, o] of [...this.darts]) {
      if (keys.includes(k)) continue;
      this.stage.scene.remove(o);
      disposeTree(o);
      this.darts.delete(k);
    }
    s.thrown.forEach((t, i) => {
      if (this.darts.has(keys[i])) return;
      const d = dartMesh(this.colours[s.turn] ?? "#f59e0b");
      d.position.copy(this.boardPoint(t.x, t.y));
      d.rotation.set(-0.38, 0.32, 0);
      this.stage.scene.add(d);
      this.darts.set(keys[i], d);
    });
    this.stage.invalidate();
  }
  protected async animateStep(before: DartsState, after: DartsState, move: string, index: number) {
    const mv = /^t:(-?\d+):(-?\d+)$/.exec(move);
    if (!mv) return;
    const x = Number(mv[1]);
    const y = Number(mv[2]);
    const d = dartMesh(this.colours[before.turn] ?? "#f59e0b");
    const start = new THREE.Vector3(0.9, DART_Y - 1.6, 4.5);
    const end = this.boardPoint(x, y);
    this.stage.scene.add(d);
    this.darts.set(`dart:${index}`, d);
    sfx("whoosh", 0.5);
    await this.stage.animate(
      380,
      (t) => {
        d.position.lerpVectors(start, end, t);
        d.position.y += Math.sin(t * Math.PI) * 0.5;
        d.rotation.set(-0.7 + t * 0.32, 0.32 * t, t * 6);
      },
      linear,
    );
    sfx("thud", 0.6);
    // A turn just ended: the darts come out.
    if (after.thrown.length === 0) {
      await this.stage.wait(700);
      const out = [...this.darts.values()];
      await this.stage.animate(300, (t) => out.forEach((o) => (o.position.z = 0.12 + t * 0.8)), easeOut);
    }
  }
  dispose() {
    this.stopWobble?.();
    super.dispose();
  }
}

export function Darts3D({ moves, canPlay, turn, seats, starter = 0, onMove }: BoardProps) {
  const n = Math.max(1, seats?.length ?? 1);
  const state = useMemo(() => darts.replay(moves, n, ""), [moves, n]);
  const colours = useMemo(() => Array.from({ length: n }, (_, i) => seatFor(seats, starter, i, n).color), [seats, starter, n]);
  const send = useRef(onMove);
  send.current = onMove;
  const [hostRef, scene] = useScene((el) => new DartsScene(el));
  useEffect(() => scene?.setLook(colours), [scene, colours]);
  useEffect(() => scene?.sync(n, "", moves), [scene, n, moves]);
  useEffect(() => scene?.setTurn({ canPlay, onThrow: (x, y) => send.current(`t:${x}:${y}`) }), [scene, canPlay]);
  if (!state) return null;
  const name = (p: number) => seatFor(seats, starter, p, n).name;
  return (
    <div data-game-board="darts" data-g3-board="darts" className="flex w-full max-w-[640px] flex-col items-center gap-2">
      <BoardBar>
        {state.left.map((l, p) => (
          <span key={p} data-darts-left className={`inline-flex items-center gap-1.5 ${p === turn && state.winner === null ? "underline decoration-2 underline-offset-4" : ""} ${state.out[p] ? "line-through opacity-50" : ""}`}>
            <SeatDot color={colours[p]} /> {name(p)} {state.out[p] ? "left" : l}
          </span>
        ))}
      </BoardBar>
      <div className="max-w-[460px] text-center text-[11.5px] text-slate-500" data-darts-rule>
        {DART_START} down to exactly 0. The last dart must be a double (outer ring, or the bull). Below 0, 1 left, or 0 without a double is a bust.
      </div>
      <SceneBox hostRef={hostRef} aspect={1.15} maxH={560} testId="darts" />
      <div className="flex items-center gap-2 text-[12px]">
        {canPlay && (
          <button type="button" data-darts-throw onClick={() => scene?.throwNow()} className={primary3}>
            Throw ({3 - state.thrown.length} left)
          </button>
        )}
        <span className="text-slate-500" data-darts-thrown>
          {state.thrown.map((t) => t.text).join(", ") || "Point at the board; the sight sways — click (or Throw) when it's where you want."}
        </span>
      </div>
      <div className="flex flex-col items-center text-[11.5px] text-slate-600 dark:text-slate-300" data-darts-news>
        {state.log.length > 0 && <span data-darts-log>{namesIn(state.log[state.log.length - 1], seats, starter, n)}</span>}
        {state.winner === null && dartFinish(state.left[turn] ?? 0) && (
          <span className="font-semibold text-emerald-600 dark:text-emerald-400" data-darts-finish>
            {name(turn)} can finish with {dartFinish(state.left[turn] ?? 0)}
          </span>
        )}
      </div>
    </div>
  );
}

// ============================================================ Archery

const TS = 0.012; // world per target unit
const T_Y = 1.5;
const T_Z = -14;

function targetTexture(renderer: THREE.WebGLRenderer) {
  const P = 1024;
  const rings = ["#f8fafc", "#f8fafc", "#111827", "#111827", "#2563eb", "#2563eb", "#dc2626", "#dc2626", "#facc15", "#facc15"];
  return canvasTexture(
    P,
    P,
    (ctx) => {
      ctx.fillStyle = "#e9dcc0";
      ctx.fillRect(0, 0, P, P);
      rings.forEach((c, i) => {
        ctx.beginPath();
        ctx.arc(P / 2, P / 2, (P / 2) * (1 - i / 10), 0, Math.PI * 2);
        ctx.fillStyle = c;
        ctx.fill();
        ctx.strokeStyle = i < 2 ? "#64748b" : "rgba(255,255,255,0.5)";
        ctx.lineWidth = 2;
        ctx.stroke();
      });
      ctx.fillStyle = "#111827";
      ctx.beginPath();
      ctx.arc(P / 2, P / 2, 4, 0, Math.PI * 2);
      ctx.fill();
    },
    renderer,
  );
}

function arrowMesh(colour: string) {
  const g = new THREE.Group();
  const shaft = mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.0, 8), wood("light", 1));
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = 0.5;
  const fl = new THREE.MeshStandardMaterial({ color: colour, side: THREE.DoubleSide, roughness: 0.6 });
  for (const r of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
    const f = mesh(new THREE.PlaneGeometry(0.05, 0.16), fl, false);
    f.position.z = 0.9;
    f.rotation.set(Math.PI / 2, 0, r);
    f.position.x = Math.cos(r) * 0.025;
    f.position.y = Math.sin(r) * 0.025;
    g.add(f);
  }
  const nock = mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.03, 8), new THREE.MeshStandardMaterial({ color: colour }));
  nock.rotation.x = Math.PI / 2;
  nock.position.z = 1.0;
  g.add(shaft, nock);
  return g;
}

class ArcheryScene extends TurnScene<ArcheryState> {
  private sight: THREE.Mesh;
  private arrows = new Map<string, THREE.Object3D>();
  private flag: THREE.Mesh;
  private colours: string[] = [];
  private info: { canPlay: boolean; turn: number; onShoot: (x: number, y: number) => void; onDraw: (k: number) => void } | null = null;
  private aim: [number, number] = [0, 0];
  private drawStart = 0;
  private sway: [number, number] = [0, 0];
  private loop: (() => void) | null = null;
  constructor(host: HTMLElement) {
    super(host, { fov: 13 });
    const s = this.stage;
    // The field.
    const grass = mesh(new THREE.PlaneGeometry(60, 60), felt("#4d8b3a"), false);
    grass.rotation.x = -Math.PI / 2;
    grass.position.z = -20;
    grass.receiveShadow = true;
    s.scene.add(grass);
    // The target: a straw boss on a stand, with the face.
    const boss = mesh(new THREE.CylinderGeometry(TARGET_R * TS * 1.12, TARGET_R * TS * 1.12, 0.4, 64), [new THREE.MeshStandardMaterial({ color: 0xc9a46a, roughness: 1 }), new THREE.MeshStandardMaterial({ map: targetTexture(s.renderer), roughness: 0.85 }), new THREE.MeshStandardMaterial({ color: 0xc9a46a, roughness: 1 })]);
    boss.rotation.x = Math.PI / 2;
    boss.position.set(0, T_Y, T_Z - 0.2);
    s.scene.add(boss);
    const legMat = wood("medium", 1);
    for (const sx of [-1, 1]) {
      const leg = mesh(new THREE.BoxGeometry(0.08, T_Y + 0.6, 0.08), legMat);
      leg.position.set(sx * 0.9, (T_Y + 0.6) / 2 - 0.2, T_Z - 0.55);
      leg.rotation.x = 0.18;
      s.scene.add(leg);
    }
    // A wind flag beside the target.
    const pole = mesh(new THREE.CylinderGeometry(0.03, 0.03, 3.4, 8), new THREE.MeshStandardMaterial({ color: 0xe2e8f0 }));
    pole.position.set(2.0, 1.7, T_Z);
    s.scene.add(pole);
    this.flag = mesh(new THREE.PlaneGeometry(0.9, 0.5), new THREE.MeshStandardMaterial({ color: 0xf97316, side: THREE.DoubleSide, roughness: 0.6 }));
    this.flag.geometry.translate(0.45, 0, 0);
    this.flag.position.set(2.0, 3.1, T_Z);
    s.scene.add(this.flag);
    // The pin sight on the target.
    this.sight = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.075, 32), new THREE.MeshBasicMaterial({ color: 0x22d3ee, depthTest: false, transparent: true }));
    this.sight.renderOrder = 10;
    this.sight.visible = false;
    s.scene.add(this.sight);
    s.onPointerMove = () => {
      const p = this.stage.pointOn(new THREE.Plane(new THREE.Vector3(0, 0, 1), -T_Z));
      if (p) this.aim = [Math.round(p.x / TS), Math.round(-(p.y - T_Y) / TS)];
    };
    s.onPointerDown = (e) => {
      if (e.button === 0 && this.info?.canPlay && this.settled) this.drawStart = performance.now();
    };
    s.onPointerUp = () => {
      if (!this.drawStart) return;
      this.drawStart = 0;
      this.info?.onDraw(0);
      this.shoot();
    };
    s.setGroundY(0);
    const r = TARGET_R * TS * 1.5;
    s.frame(new THREE.Box3(new THREE.Vector3(-r - 0.6, T_Y - r - 0.2, T_Z - 0.3), new THREE.Vector3(r + 1.4, T_Y + r + 1.0, T_Z + 0.1)), [0, 0.02, 1], 1.02);
  }
  setLook(colours: string[]) {
    this.colours = colours;
  }
  setTurn(info: { canPlay: boolean; turn: number; onShoot: (x: number, y: number) => void; onDraw: (k: number) => void }, wind: { dx: number; dy: number }) {
    this.info = info;
    // The flag points the way the wind blows (sideways part), and droops when it is calm.
    const strength = Math.hypot(wind.dx, wind.dy) / 22;
    this.flag.rotation.set(0, wind.dx < 0 ? Math.PI : 0, -(1 - Math.min(1, strength)) * 1.1);
    this.sight.visible = info.canPlay;
    if (info.canPlay && !this.loop) {
      const t0 = performance.now();
      this.loop = this.stage.onFrame(() => {
        // Breathing sway; drawing steadies it for two seconds, then the arm tires.
        const t = (performance.now() - t0) / 1000;
        const held = this.drawStart ? (performance.now() - this.drawStart) / 1000 : 0;
        this.sway = archerySway(t, this.drawStart ? held : null);
        if (this.drawStart) this.info?.onDraw(Math.min(1, held / 1.2));
        this.sight.position.set((this.aim[0] + this.sway[0]) * TS, T_Y - (this.aim[1] + this.sway[1]) * TS, T_Z + 0.05);
        return true;
      });
    } else if (!info.canPlay && this.loop) {
      this.loop();
      this.loop = null;
    }
    this.stage.invalidate();
  }
  shoot() {
    if (!this.info?.canPlay || !this.settled) return;
    this.info.onShoot(Math.round(this.aim[0] + this.sway[0]), Math.round(this.aim[1] + this.sway[1]));
  }
  protected replay(moves: string[]) {
    return archery.replay(moves, this.n, this.seed);
  }
  private hitPoint(x: number, y: number) {
    return new THREE.Vector3(x * TS, T_Y - y * TS, T_Z - 0.35);
  }
  protected snap(s: ArcheryState) {
    const want = new Set<string>();
    s.hits.forEach((hs, p) =>
      hs.forEach((h, k) => {
        const key = `a:${p}:${k}`;
        want.add(key);
        if (this.arrows.has(key)) return;
        const a = arrowMesh(this.colours[p] ?? "#f59e0b");
        a.position.copy(this.hitPoint(h.x, h.y));
        a.rotation.x = 0.03;
        this.stage.scene.add(a);
        this.arrows.set(key, a);
      }),
    );
    for (const [k, o] of [...this.arrows])
      if (!want.has(k)) {
        this.stage.scene.remove(o);
        disposeTree(o);
        this.arrows.delete(k);
      }
    this.stage.invalidate();
  }
  protected async animateStep(before: ArcheryState, after: ArcheryState, move: string) {
    if (!move.startsWith("s:")) return;
    const p = before.turn;
    const k = before.hits[p].length;
    const h = after.hits[p][k];
    if (!h) return;
    const a = arrowMesh(this.colours[p] ?? "#f59e0b");
    this.stage.scene.add(a);
    this.arrows.set(`a:${p}:${k}`, a);
    const start = new THREE.Vector3(0.25, T_Y - 0.6, 2);
    const end = this.hitPoint(h.x, h.y);
    sfx("whoosh", 0.7);
    await this.stage.animate(
      700,
      (t) => {
        a.position.lerpVectors(start, end, t);
        a.position.y += Math.sin(t * Math.PI) * 0.9;
        // Nose follows the arc.
        a.rotation.x = Math.atan2(Math.cos(t * Math.PI) * 0.9 * Math.PI, end.z - start.z) * -0.12;
      },
      easeIn,
    );
    sfx("thud", 0.8);
  }
  dispose() {
    this.loop?.();
    super.dispose();
  }
}

export function Archery3D({ moves, canPlay, turn, seats, starter = 0, seed = "", onMove }: BoardProps) {
  const n = Math.max(1, seats?.length ?? 1);
  const state = useMemo(() => archery.replay(moves, n, seed), [moves, n, seed]);
  const colours = useMemo(() => Array.from({ length: n }, (_, i) => seatFor(seats, starter, i, n).color), [seats, starter, n]);
  const [draw, setDraw] = useState(0);
  const send = useRef(onMove);
  send.current = onMove;
  const [hostRef, scene] = useScene((el) => new ArcheryScene(el));
  const k = state?.hits[turn]?.length ?? 0;
  const wind = useMemo(() => (state && !state.done ? windFor(seed, turn, k) : { dx: 0, dy: 0 }), [state, seed, turn, k]);
  useEffect(() => scene?.setLook(colours), [scene, colours]);
  useEffect(() => scene?.sync(n, seed, moves), [scene, n, seed, moves]);
  useEffect(() => scene?.setTurn({ canPlay, turn, onShoot: (x, y) => send.current(`s:${x}:${y}`), onDraw: setDraw }, wind), [scene, canPlay, turn, wind]);
  if (!state) return null;
  const name = (p: number) => seatFor(seats, starter, p, n).name;
  return (
    <div data-game-board="archery" data-g3-board="archery" className="flex w-full max-w-[680px] flex-col items-center gap-2">
      <BoardBar>
        {state.scores.map((s, p) => (
          <span key={p} data-archery-scores className={`inline-flex items-center gap-1.5 ${p === turn && !state.done ? "underline decoration-2 underline-offset-4" : ""} ${state.out[p] ? "line-through opacity-50" : ""}`}>
            <SeatDot color={colours[p]} /> {name(p)} {s} <span className="font-normal text-slate-400">({state.out[p] ? "left" : `${state.hits[p].length}/${ARROWS}`})</span>
          </span>
        ))}
      </BoardBar>
      {state.event && (
        <div className="text-[11.5px] text-slate-600 dark:text-slate-300" data-archery-event>
          {namesIn(state.event, seats, starter, n)}
        </div>
      )}
      {!state.done && (
        <div className="flex items-center gap-2 text-[12px]" data-archery-wind>
          Wind
          <svg width={44} height={22} aria-hidden="true">
            <line x1={22 - wind.dx * 0.8} y1={11 - wind.dy * 0.4} x2={22 + wind.dx * 0.8} y2={11 + wind.dy * 0.4} stroke="#0ea5e9" strokeWidth={3} strokeLinecap="round" />
            <circle cx={22 + wind.dx * 0.8} cy={11 + wind.dy * 0.4} r={3} fill="#0ea5e9" />
          </svg>
          <span className="text-slate-500">{Math.round(Math.hypot(wind.dx, wind.dy))} — aim into it</span>
        </div>
      )}
      <SceneBox hostRef={hostRef} aspect={1.35} maxH={520} testId="archery" />
      {canPlay && (
        <div className="flex items-center gap-3 text-[12px]">
          <span className="inline-flex items-center gap-1.5">
            Draw
            <span className="inline-block h-2.5 w-28 overflow-hidden rounded-full bg-slate-500/20">
              <span className="block h-full bg-cyan-500 transition-[width] duration-75" style={{ width: `${Math.round(draw * 100)}%` }} />
            </span>
          </span>
          <button type="button" data-archery-shoot onClick={() => scene?.shoot()} className={primary3}>
            Shoot
          </button>
          <span className="max-w-[260px] text-[11.5px] text-slate-500">Point at the target. Hold the mouse to draw — the sight steadies, then your arm tires — and let go.</span>
        </div>
      )}
    </div>
  );
}

// ============================================================ Cup Pong

const PU = 0.009; // world per table unit
const TABLE_L = 10;
const TABLE_W = 3.2;
const PTOP = 0.7;

/** A cup spot (units) on a side → world: side "far" is the end away from the camera. */
function cupWorld(x: number, y: number, far: boolean) {
  const z = TABLE_L / 2 - 0.5 - (200 - y) * PU * 1.0 - 0.6;
  return new THREE.Vector3((x - 150) * PU * (far ? 1 : -1), PTOP, far ? -z : z);
}

function cupMesh(colour: number) {
  const pts = [
    [0, 0],
    [0.16, 0],
    [0.17, 0.01],
    [CUP_R * PU * 1.15, 0.42],
    [CUP_R * PU * 1.15 - 0.012, 0.42],
    [0.155, 0.012],
    [0, 0.012],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.Group();
  const red = mesh(new THREE.LatheGeometry(pts, 40), new THREE.MeshPhysicalMaterial({ color: colour, roughness: 0.35, clearcoat: 0.5, side: THREE.DoubleSide }));
  const rim = mesh(new THREE.TorusGeometry(CUP_R * PU * 1.15 - 0.006, 0.01, 8, 40), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.42;
  g.add(red, rim);
  return g;
}

class PongScene extends TurnScene<PongState> {
  private cups = new Map<string, THREE.Object3D>();
  private ball: THREE.Mesh;
  private reticle: THREE.Mesh;
  private mySide = 0;
  private info: { canPlay: boolean; target: number; onThrow: (x: number, y: number) => void } | null = null;
  /** Where you point (table units on their end), and the sway on top of it (pongSway). */
  private aim: [number, number] = [150, 110];
  private sway: [number, number] = [0, 0];
  private stopSway: (() => void) | null = null;
  constructor(host: HTMLElement) {
    super(host, { fov: 26 });
    const s = this.stage;
    const top = mesh(slab(TABLE_W, 0.08, TABLE_L, 0.04), new THREE.MeshPhysicalMaterial({ color: 0x1e3a5f, roughness: 0.5, clearcoat: 0.3 }));
    top.position.y = PTOP - 0.08;
    s.scene.add(top);
    const line = mesh(new THREE.BoxGeometry(TABLE_W, 0.002, 0.04), new THREE.MeshBasicMaterial({ color: 0xffffff }), false);
    line.position.y = PTOP + 0.001;
    s.scene.add(line);
    for (const [x, z] of [[-1.4, -4.6], [1.4, -4.6], [-1.4, 4.6], [1.4, 4.6]]) {
      const leg = mesh(new THREE.CylinderGeometry(0.06, 0.06, PTOP - 0.08, 10), metal(0x94a3b8, 0.4));
      leg.position.set(x, (PTOP - 0.08) / 2, z);
      s.scene.add(leg);
    }
    this.ball = mesh(new THREE.SphereGeometry(0.06, 20, 14), new THREE.MeshStandardMaterial({ color: 0xfefcf3, roughness: 0.4 }));
    this.ball.visible = false;
    s.scene.add(this.ball);
    this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.08, 0.11, 28), new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.9, depthWrite: false }));
    this.reticle.rotation.x = -Math.PI / 2;
    this.reticle.visible = false;
    s.scene.add(this.reticle);
    s.onPointerMove = () => {
      const u = this.unitsUnder();
      if (u) this.aim = u;
      this.stage.renderer.domElement.style.cursor = u && this.info?.canPlay ? "crosshair" : "";
    };
    s.onTap = () => {
      const u = this.unitsUnder();
      if (u) this.aim = u;
      this.throwNow();
    };
    s.frame(new THREE.Box3(new THREE.Vector3(-TABLE_W / 2 - 0.2, 0, -TABLE_L / 2 - 0.2), new THREE.Vector3(TABLE_W / 2 + 0.2, PTOP + 0.5, TABLE_L / 2 + 0.2)), [0, 1.15, 1], 1.02);
  }
  setSide(mySide: number) {
    if (this.mySide === mySide && this.cups.size) return;
    this.mySide = mySide;
    const s = this.replay(this.shown);
    for (const o of this.cups.values()) this.stage.scene.remove(o);
    this.cups.clear();
    if (s) this.snap(s);
  }
  setTurn(info: { canPlay: boolean; target: number; onThrow: (x: number, y: number) => void }) {
    this.info = info;
    this.swayLoop();
  }
  /** Where a throw now goes: the aim plus the sway. */
  get sightAt(): [number, number] {
    return [Math.round(this.aim[0] + this.sway[0]), Math.round(this.aim[1] + this.sway[1])];
  }
  throwNow() {
    if (!this.info?.canPlay || !this.settled) return;
    this.reticle.visible = false;
    const [x, y] = this.sightAt;
    this.info.onThrow(x, y);
  }
  /** While it is your throw, the sight sways over their end of the table. */
  private swayLoop() {
    const on = !!this.info?.canPlay;
    if (on && !this.stopSway) {
      const t0 = performance.now();
      this.stopSway = this.stage.onFrame(() => {
        this.sway = pongSway((performance.now() - t0) / 1000);
        const ok = !!this.info?.canPlay && this.settled;
        this.reticle.visible = ok;
        if (ok) {
          const [x, y] = this.sightAt;
          this.reticle.position.copy(cupWorld(x, y, this.far(this.info!.target))).setY(PTOP + 0.003);
        }
        return true;
      });
    } else if (!on && this.stopSway) {
      this.stopSway();
      this.stopSway = null;
      this.reticle.visible = false;
    }
    this.stage.invalidate();
  }
  protected replay(moves: string[]) {
    return cupPong.replay(moves, this.n, this.seed);
  }
  private far(side: number) {
    return side !== this.mySide;
  }
  /** Table units (0–300 across, 0–200 deep) of the target side under the pointer. */
  private unitsUnder(): [number, number] | null {
    const p = this.stage.pointOnPlane(PTOP);
    if (!p || !this.info) return null;
    const far = this.far(this.info.target);
    const x = Math.round(p.x / PU / (far ? 1 : -1) + 150);
    const z = far ? -p.z : p.z;
    const y = Math.round(200 - (TABLE_L / 2 - 0.5 - 0.6 - z) / PU);
    if (x < -20 || x > 320 || y < -20 || y > 260) return null;
    return [x, y];
  }
  protected snap(s: PongState) {
    s.cups.forEach((row, side) =>
      row.forEach((up, i) => {
        const key = `${side}:${i}`;
        const have = this.cups.get(key);
        if (up && !have) {
          const c = cupMesh(0xdc2626);
          c.position.copy(cupWorld(CUPS[i][0], CUPS[i][1], this.far(side)));
          this.stage.scene.add(c);
          this.cups.set(key, c);
        } else if (!up && have) {
          this.stage.scene.remove(have);
          disposeTree(have);
          this.cups.delete(key);
        }
      }),
    );
    this.stage.invalidate();
  }
  protected async animateStep(_before: PongState, after: PongState, move: string) {
    const last = after.last;
    if (!last || !move.startsWith("t:")) return;
    const target = last.target;
    const far = this.far(target);
    const land = cupWorld(last.x, last.y, far);
    const start = new THREE.Vector3(0, PTOP + 0.9, far ? TABLE_L / 2 + 0.3 : -TABLE_L / 2 - 0.3);
    this.ball.visible = true;
    sfx("whoosh", 0.5);
    const hit = last.hit >= 0;
    const end = hit ? cupWorld(CUPS[last.hit][0], CUPS[last.hit][1], far).setY(PTOP + 0.5) : land.clone().setY(PTOP + (last.rim ? 0.45 : 0.06));
    await this.stage.animate(
      720,
      (t) => {
        this.ball.position.lerpVectors(start, end, t);
        this.ball.position.y += Math.sin(t * Math.PI) * 1.6;
      },
      linear,
    );
    if (hit) {
      // Plop: into the cup, which then sinks away.
      await this.stage.animate(160, (t) => (this.ball.position.y = PTOP + 0.5 - t * 0.4), easeIn);
      sfx("score", 0.8);
      const cup = this.cups.get(`${target}:${last.hit}`);
      this.ball.visible = false;
      if (cup) await this.stage.animate(360, (t) => cup.position.setY(PTOP - t * 0.5), easeIn);
    } else {
      // Off the rim (or the table), a bounce or two, then off the end.
      sfx("bounce", 0.7);
      const dir = new THREE.Vector3(0, 0, far ? -1 : 1);
      const a = this.ball.position.clone();
      await this.stage.animate(
        700,
        (t) => {
          this.ball.position.copy(a).addScaledVector(dir, t * 2.4);
          this.ball.position.y = Math.max(PTOP + 0.06, a.y * (1 - t)) + Math.abs(Math.sin(t * Math.PI * 2)) * 0.5 * (1 - t);
        },
        linear,
      );
      this.ball.visible = false;
    }
  }
  dispose() {
    this.stopSway?.();
    super.dispose();
  }
}

export function CupPong3D({ moves, canPlay, turn, seat, seats, starter = 0, seed = "", local, onMove }: BoardProps) {
  const n = Math.max(2, seats?.length ?? 2);
  const state = useMemo(() => cupPong.replay(moves, n, seed), [moves, n, seed]);
  const send = useRef(onMove);
  send.current = onMove;
  const [hostRef, scene] = useScene((el) => new PongScene(el));
  const side = state?.side ?? pongSide(turn);
  const mySide = local ? side : pongSide(seat);
  useEffect(() => scene?.sync(n, seed, moves), [scene, n, seed, moves]);
  useEffect(() => scene?.setSide(mySide), [scene, mySide]);
  useEffect(() => scene?.setTurn({ canPlay, target: 1 - side, onThrow: (x, y) => send.current(`t:${x}:${y}`) }), [scene, canPlay, side]);
  if (!state) return <div className="text-[12.5px] text-slate-500">Cup Pong is for two players, or two teams of two.</div>;
  const name = (p: number) => seatFor(seats, starter, p, n).name.split(" (")[0];
  const cupsOf = (s: number) => state.cups[s].filter(Boolean).length;
  const teamOf = (s: number) => (n === 4 ? [s, s + 2] : [s]).map(name).join(" & ");
  const targetIsMine = 1 - side === mySide;
  return (
    <div data-game-board="cuppong" data-g3-board="cuppong" className="flex w-full max-w-[680px] flex-col items-center gap-2">
      <BoardBar>
        <span data-cuppong-cups>
          {local ? `${teamOf(0)}: ${cupsOf(0)} cups · ${teamOf(1)}: ${cupsOf(1)} cups` : `Your cups ${cupsOf(mySide)} · Their cups ${cupsOf(1 - mySide)}`}
        </span>
        <span className="font-normal text-slate-500" data-cuppong-thrower>
          {state.winner === null ? `${name(turn)} throws ${state.shot === 0 ? "the first" : "the second"} ball${local ? "" : targetIsMine ? " at your cups" : " at their cups"}` : ""}
        </span>
      </BoardBar>
      {state.rebuttal && state.winner === null && (
        <div className="text-[12px] font-semibold text-rose-600" data-cuppong-rebuttal>
          Last chance: sink every cup left on the other side with these two balls to force overtime.
        </div>
      )}
      <SceneBox hostRef={hostRef} aspect={1.25} maxH={560} testId="cuppong" />
      <div className="min-h-[18px] text-[12px] text-slate-600 dark:text-slate-300" data-cuppong-event>
        {namesIn(state.event, seats, starter, n)}
      </div>
      {canPlay && (
        <div className="flex items-center gap-2 text-[12px]">
          <button type="button" data-cuppong-throw onClick={() => scene?.throwNow()} className={primary3}>
            Throw
          </button>
          <span className="max-w-[360px] text-slate-500">Point at their cups; the sight sways — click (or Throw) when it is on a cup. Two balls a turn.</span>
        </div>
      )}
    </div>
  );
}
