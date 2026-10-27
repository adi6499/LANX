// LANX 2.16.0: Snakes & Ladders ("Dice Ladder") in 3D — a numbered board,
// wooden ladders standing off it, snakes curling across it, pawns that hop
// square by square, climb the ladders and slide down the snakes, and a die
// thrown into a tray (Rapier) that lands on the number the rules rolled.
// The move is still just "r"; the rules (lib/games/snakes.ts) decide it all.

import * as THREE from "three";
import { useEffect, useMemo, useRef } from "react";
import { seatFor, type BoardProps } from "../../boardProps";
import { LADDERS, SNAKES, snakes, type SnakesState } from "../../../../lib/games/snakes.ts";
import { sfx } from "../../../../lib/gameSounds";
import { TurnScene } from "../turnScene";
import { FONT, boardSlab, canvasTexture, hop, mesh, pawnGeometry, plastic, wood } from "../kit";
import { diceTray, makeDie, restOn, show, throwDice, topValue, type Die } from "../dice";
import { SceneBox, useScene } from "../Board3D";
import { BoardBar, SeatDot, primary3 } from "../ui";
import { easeInOut, easeOut } from "../stage";

const TOP = 0.36;
const PX = 100;
const TRAY_X = 7.6;
const START_X = -6.05;

/** Square 1..100 → board position (1 at the bottom left, rows snake back and forth). */
function square(sq: number): THREE.Vector3 {
  const k = Math.max(1, Math.min(100, sq)) - 1;
  const row = Math.floor(k / 10);
  const col = row % 2 === 0 ? k % 10 : 9 - (k % 10);
  return new THREE.Vector3(col - 4.5, TOP, 9 - row - 4.5);
}
/** Where a pawn waits before its first roll (beside square 1). */
const startSpot = (p: number) => new THREE.Vector3(START_X + (p % 2) * 0.55, TOP - 0.3, 4.4 - Math.floor(p / 2) * 0.62);

const SNAKE_COLOURS = [
  ["#16a34a", "#14532d"],
  ["#7c3aed", "#3b0764"],
  ["#ea580c", "#7c2d12"],
  ["#0891b2", "#164e63"],
  ["#db2777", "#831843"],
];

function paintBoard(ctx: CanvasRenderingContext2D) {
  const P = PX;
  for (let k = 0; k < 100; k++) {
    const row = Math.floor(k / 10);
    const col = row % 2 === 0 ? k % 10 : 9 - (k % 10);
    const x = col * P;
    const y = (9 - row) * P;
    const tone = (row + col) % 2 === 0;
    ctx.fillStyle = tone ? "#fde7b0" : "#fff7e3";
    ctx.fillRect(x, y, P, P);
    ctx.fillStyle = tone ? "#92400e" : "#b45309";
    ctx.font = `700 ${P * 0.22}px ${FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(String(k + 1), x + P * 0.08, y + P * 0.07);
  }
  // Start and finish.
  ctx.fillStyle = "rgba(16,185,129,0.22)";
  ctx.fillRect(0, 9 * P, P, P);
  ctx.fillStyle = "rgba(245,158,11,0.3)";
  ctx.fillRect(0, 0, P, P);
  ctx.font = `800 ${P * 0.2}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillStyle = "#065f46";
  ctx.fillText("START", P / 2, 9.74 * P);
  ctx.fillStyle = "#92400e";
  ctx.fillText("FINISH", P / 2, 0.74 * P);
  ctx.strokeStyle = "rgba(146,64,14,0.25)";
  ctx.lineWidth = 2;
  for (let i = 0; i <= 10; i++) {
    ctx.beginPath();
    ctx.moveTo(i * P, 0);
    ctx.lineTo(i * P, 10 * P);
    ctx.moveTo(0, i * P);
    ctx.lineTo(10 * P, i * P);
    ctx.stroke();
  }
}

/** A tube that is thick at the head and thin at the tail. */
function taperedTube(curve: THREE.Curve<THREE.Vector3>, radius: number, segs = 96, radial = 14): THREE.BufferGeometry {
  const g = new THREE.TubeGeometry(curve, segs, radius, radial, false);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const c = curve.getPointAt(t);
    const k = t < 0.08 ? 0.85 + t * 1.8 : 1 - Math.pow((t - 0.08) / 0.92, 1.4) * 0.78;
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, idx).sub(c).multiplyScalar(k).add(c);
      pos.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

function snakeTexture(a: string, b: string) {
  return canvasTexture(512, 64, (ctx, w, h) => {
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = b;
    for (let x = 0; x < w; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, h * 0.5);
      ctx.lineTo(x + 16, h * 0.15);
      ctx.lineTo(x + 32, h * 0.5);
      ctx.lineTo(x + 16, h * 0.85);
      ctx.closePath();
      ctx.fill();
    }
  });
}

class SnakesScene extends TurnScene<SnakesState> {
  private pawns: THREE.Mesh[] = [];
  private die: Die;
  private snakeCurves = new Map<number, THREE.CatmullRomCurve3>();
  private onRoll: (() => void) | null = null;
  private canRoll = false;

  constructor(host: HTMLElement) {
    super(host, { fov: 26 });
    const s = this.stage;
    const top = canvasTexture(10 * PX, 10 * PX, (ctx) => paintBoard(ctx), s.renderer);
    s.scene.add(boardSlab(10.6, 10.6, TOP, top, wood("walnut", 2)));
    // Ladders: two rails and rungs, standing a little off the board.
    const ladderWood = wood("light", 1);
    for (const [a, b] of Object.entries(LADDERS)) {
      const p0 = square(Number(a));
      const p1 = square(b);
      p0.y = p1.y = TOP + 0.1;
      const dir = p1.clone().sub(p0);
      const len = dir.length();
      const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize().multiplyScalar(0.2);
      const ladder = new THREE.Group();
      for (const sgn of [-1, 1]) {
        const rail = mesh(new THREE.CylinderGeometry(0.045, 0.045, len + 0.3, 10), ladderWood);
        rail.position.copy(p0).add(p1).multiplyScalar(0.5).addScaledVector(side, sgn);
        rail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
        ladder.add(rail);
      }
      const rungs = Math.max(2, Math.round(len / 0.42));
      for (let k = 1; k < rungs; k++) {
        const rung = mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.4, 8), ladderWood);
        rung.position.copy(p0).lerp(p1, k / rungs);
        rung.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), side.clone().normalize());
        ladder.add(rung);
      }
      s.scene.add(ladder);
    }
    // Snakes: a curving body from the head (the higher square) down to the tail.
    Object.entries(SNAKES).forEach(([a, b], i) => {
      const head = square(Number(a));
      const tail = square(b);
      head.y = tail.y = TOP + 0.13;
      const along = tail.clone().sub(head);
      const perp = new THREE.Vector3(-along.z, 0, along.x).normalize();
      const pts: THREE.Vector3[] = [];
      const bends = Math.max(2, Math.round(along.length() / 1.6));
      for (let k = 0; k <= bends * 2; k++) {
        const t = k / (bends * 2);
        const p = head.clone().lerp(tail, t);
        if (k > 0 && k < bends * 2) p.addScaledVector(perp, Math.sin(t * Math.PI * bends) * 0.42);
        pts.push(p);
      }
      const curve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.5);
      this.snakeCurves.set(Number(a), curve);
      const [c1, c2] = SNAKE_COLOURS[i % SNAKE_COLOURS.length];
      const body = mesh(taperedTube(curve, 0.13), new THREE.MeshPhysicalMaterial({ map: snakeTexture(c1, c2), roughness: 0.45, clearcoat: 0.5 }));
      s.scene.add(body);
      const headM = mesh(new THREE.SphereGeometry(0.17, 20, 14), new THREE.MeshPhysicalMaterial({ color: c1, roughness: 0.4, clearcoat: 0.5 }));
      headM.scale.set(1, 0.7, 1.3);
      headM.position.copy(curve.getPointAt(0));
      headM.lookAt(curve.getPointAt(0.03));
      s.scene.add(headM);
      for (const sgn of [-1, 1]) {
        const eye = mesh(new THREE.SphereGeometry(0.045, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }), false);
        eye.position.set(sgn * 0.08, 0.08, -0.08);
        const pupil = mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshStandardMaterial({ color: 0x0f172a }), false);
        pupil.position.set(0, 0.01, -0.03);
        eye.add(pupil);
        headM.add(eye);
      }
    });
    // Pawns (up to eight) and the die.
    for (let p = 0; p < 8; p++) {
      const m = mesh(pawnGeometry(), plastic("#94a3b8"));
      m.scale.setScalar(0.7);
      m.visible = false;
      s.scene.add(m);
      this.pawns.push(m);
    }
    const tray = diceTray(2.5, 3.6);
    tray.group.position.set(TRAY_X, 0, 0.6);
    s.scene.add(tray.group);
    this.die = makeDie(0.8);
    restOn(this.die, TRAY_X, 0.1, 0.6);
    s.scene.add(this.die.outer);
    const rollable = { enabled: () => this.canRoll && this.settled, onClick: () => this.onRoll?.() };
    s.pickable(this.die.outer, rollable);
    s.pickable(tray.floor, rollable);
    s.allowViewDrag("snakes");
    s.frame(new THREE.Box3(new THREE.Vector3(START_X - 0.5, 0, -5.3), new THREE.Vector3(TRAY_X + 1.5, 0.5, 5.3)), [0, 2.75, 1], 1.02);
  }

  setLook(n: number, colours: string[]) {
    this.pawns.forEach((m, p) => {
      m.visible = p < n;
      if (p < n) m.material = plastic(colours[p]);
    });
    this.stage.invalidate();
  }

  setTurn(canRoll: boolean, onRoll: () => void) {
    this.canRoll = canRoll;
    this.onRoll = onRoll;
  }

  dieTop() {
    return topValue(this.die);
  }

  protected replay(moves: string[]) {
    return snakes.replay(moves, this.n, this.seed);
  }

  /** Each pawn's spot: the middle of its square, or spread out when several share it. */
  private spots(s: SnakesState): THREE.Vector3[] {
    return s.pos.map((sq, p) => {
      if (sq === 0) return startSpot(p);
      const here = s.pos.map((q, k) => (q === sq ? k : -1)).filter((k) => k >= 0);
      const v = square(sq);
      if (here.length > 1) {
        const i = here.indexOf(p);
        const cols = here.length <= 4 ? 2 : 3;
        v.x += ((i % cols) - (cols - 1) / 2) * 0.3;
        v.z += (Math.floor(i / cols) - (Math.ceil(here.length / cols) - 1) / 2) * 0.3;
      }
      return v;
    });
  }

  protected snap(s: SnakesState) {
    this.spots(s).forEach((v, p) => {
      this.pawns[p].position.copy(v);
      this.pawns[p].scale.setScalar(s.pos.filter((q) => q === s.pos[p] && q > 0).length > 1 ? 0.54 : 0.7);
    });
    if (s.lastBy >= 0 && this.die.value !== s.lastRoll) {
      restOn(this.die, TRAY_X, 0.1, 0.6);
      show(this.die, s.lastRoll);
    }
    this.stage.invalidate();
  }

  protected async animateStep(before: SnakesState, after: SnakesState) {
    const p = before.turn;
    await throwDice(this.stage, [this.die], [after.lastRoll], { cx: TRAY_X, cz: 0.6, w: 2.4, d: 3.5, y: 0.1, from: new THREE.Vector3(0.2, 0, 1) }, `${this.seed}#snakes${after.rolls}`, (k) => sfx("thud", 0.2 + k * 0.5));
    const pawn = this.pawns[p];
    const from = before.pos[p];
    const via = after.via;
    if (via === from) {
      // Too far for exactly 100: the pawn stays (a little shake).
      const base = pawn.position.clone();
      await this.stage.animate(360, (t) => {
        pawn.position.x = base.x + Math.sin(t * Math.PI * 6) * 0.08 * (1 - t);
      });
      return;
    }
    pawn.scale.setScalar(0.7);
    for (let sq = from + 1; sq <= via; sq++) {
      const a = pawn.position.clone();
      const b = square(sq);
      await this.stage.animate(150, (t) => hop(a, b, 0.42, t, pawn.position), easeOut);
      sfx("place", 0.25);
    }
    const to = after.pos[p];
    if (to > via) {
      // Up the ladder.
      const a = pawn.position.clone();
      const b = square(to);
      sfx("whoosh", 0.6);
      await this.stage.animate(900, (t) => {
        pawn.position.lerpVectors(a, b, t);
        pawn.position.y = TOP + 0.12 + Math.sin(t * Math.PI * 7) * 0.04;
      }, easeInOut);
    } else if (to < via) {
      // Down the snake, along its body.
      const curve = this.snakeCurves.get(via);
      sfx("capture", 0.7);
      if (curve) {
        await this.stage.animate(1100, (t) => {
          const q = curve.getPointAt(Math.min(1, t));
          pawn.position.set(q.x, TOP + 0.18, q.z);
        }, easeInOut);
      }
      const end = square(to);
      const a = pawn.position.clone();
      await this.stage.animate(160, (t) => hop(a, end, 0.15, t, pawn.position));
    }
  }
}

/** Snakes & Ladders, the 3D board. */
export default function Snakes3D({ moves, canPlay, turn, seats, starter = 0, seed = "", onMove }: BoardProps) {
  const n = Math.max(2, seats?.length ?? 2);
  const state = useMemo(() => snakes.replay(moves, n, seed), [moves, n, seed]);
  const colours = useMemo(() => Array.from({ length: n }, (_, i) => seatFor(seats, starter, i, n).color), [seats, starter, n]);
  const move = useRef(onMove);
  move.current = onMove;
  const [hostRef, scene] = useScene((el) => new SnakesScene(el));
  useEffect(() => scene?.setLook(n, colours), [scene, n, colours]);
  useEffect(() => scene?.sync(n, seed, moves), [scene, n, seed, moves]);
  useEffect(() => scene?.setTurn(canPlay, () => move.current("r")), [scene, canPlay]);
  if (!state) return null;
  return (
    <div data-game-board="snakes" data-g3-board="snakes" className="flex w-full max-w-[760px] flex-col items-center gap-2">
      <BoardBar>
        {state.lastBy >= 0 && (
          <span className="inline-flex items-center gap-1.5" data-snakes-last>
            <SeatDot color={colours[state.lastBy]} /> rolled <b data-die={state.lastRoll}>{state.lastRoll}</b>
          </span>
        )}
        <button type="button" data-snakes-roll disabled={!canPlay} onClick={() => onMove("r")} className={primary3}>
          Roll
        </button>
      </BoardBar>
      <SceneBox hostRef={hostRef} aspect={1.45} maxH={620} testId="snakes" />
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[12px]" data-snakes-positions>
        {state.pos.map((sq, p) => (
          <span key={p} className={`inline-flex items-center gap-1.5 ${p === turn && state.winner === null ? "font-bold" : ""}`}>
            <SeatDot color={colours[p]} size={10} /> {seatFor(seats, starter, p, n).name}: {sq || "start"}
          </span>
        ))}
      </div>
    </div>
  );
}
