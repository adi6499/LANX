// LANX 2.16.0: the shared base of the 3D board games where pieces sit on
// cells (Go, Gomoku, Hex, Reversi, Tic-tac-toe, Chain Reaction, Dots,
// Mancala, Memory, Minesweeper, Mahjong, Sea Battle, Paint Fight…).
//
// A board says where every piece should be (a list of keyed specs); place()
// works out what is new (it drops in), what has gone (it lifts away) and
// what moved (it slides or hops), so most games animate with no code of
// their own. Cells are clicked by where the pointer meets the board, so
// there is nothing to click on but the board itself; a drag on the board
// tilts and turns the view instead.

import * as THREE from "three";
import { sfx, type Sfx } from "../../../lib/gameSounds";
import { TurnScene } from "./turnScene";
import { disposeTree, easeInOut, easeOut, type StageOptions } from "./stage";
import { hop } from "./kit";

export interface PieceSpec {
  key: string;
  pos: THREE.Vector3;
  make: () => THREE.Object3D;
  /** Brings an existing piece up to date (a disc that flips, an orb count that changes). */
  update?: (o: THREE.Object3D, animate: boolean) => Promise<void> | void;
  /** Turn about the vertical axis (radians). */
  yaw?: number;
  /** A full orientation (cards turning face up as they travel); wins over yaw. */
  quat?: THREE.Quaternion;
  /** A new piece flies in from here (a card from the deck or a player's hand) instead of dropping. */
  from?: THREE.Vector3;
  fromQuat?: THREE.Quaternion;
}

export interface PlaceStyle {
  /** How new pieces arrive: dropped from above, popped up, or just there. */
  appear?: "drop" | "pop" | "none";
  vanish?: "lift" | "shrink" | "sink";
  sound?: Sfx | null;
  /** Gap between pieces arriving together (ms), for a ripple. */
  stagger?: number;
  /** Pieces that move slide straight (no hop), taking this long (ms). */
  slideMs?: number;
}

const bounce = (t: number) => {
  // Lands, bounces once a little, settles.
  if (t < 0.7) return easeOut(t / 0.7) * 1.0;
  const u = (t - 0.7) / 0.3;
  return 1 - Math.sin(u * Math.PI) * 0.06;
};

export abstract class BoardScene<S> extends TurnScene<S> {
  protected pieces = new Map<string, THREE.Object3D>();
  protected root = new THREE.Group();
  protected hoverMark: THREE.Object3D | null = null;
  protected hoverCell: number | null = null;
  /** Height of the board's top (where pieces stand and the pointer meets it). */
  protected top = 0.3;

  constructor(host: HTMLElement, opts?: StageOptions) {
    super(host, opts);
    this.stage.scene.add(this.root);
    this.stage.onPointerMove = () => this.pointerMoved();
    this.stage.onTap = () => {
      const c = this.cellUnderPointer();
      if (c !== null && this.clickable(c)) this.clicked(c);
    };
  }

  // ------------------------------------------------------------ cells (override)

  /** The cell under a point on the board's top, or null. */
  protected cellAt(_p: THREE.Vector3): number | null {
    return null;
  }
  /** The middle of a cell (on the top). */
  protected cellPos(_i: number): THREE.Vector3 {
    return new THREE.Vector3();
  }
  /** Whether the player may click this cell now. */
  protected clickable(_i: number): boolean {
    return false;
  }
  protected clicked(_i: number): void {}
  /** The marker shown on a clickable cell under the pointer (made once). */
  protected makeHover(): THREE.Object3D | null {
    return null;
  }

  protected cellUnderPointer(): number | null {
    const p = this.stage.pointOnPlane(this.top);
    if (!p) return null;
    const local = this.root.worldToLocal(p.clone());
    return this.cellAt(local);
  }

  protected pointerMoved() {
    if (!this.settled) return this.showHover(null);
    const c = this.cellUnderPointer();
    this.showHover(c !== null && this.clickable(c) ? c : null);
  }

  protected showHover(c: number | null) {
    if (c === this.hoverCell) return;
    this.hoverCell = c;
    if (!this.hoverMark) {
      this.hoverMark = this.makeHover();
      if (this.hoverMark) this.root.add(this.hoverMark);
    }
    if (this.hoverMark) {
      this.hoverMark.visible = c !== null;
      if (c !== null) this.hoverMark.position.copy(this.cellPos(c)).setY(this.top + 0.004);
    }
    this.stage.renderer.domElement.style.cursor = c !== null ? "pointer" : "";
    this.stage.invalidate();
  }

  /** Clears the hover marker (after a move, or when it is no longer your turn). */
  protected refreshHover() {
    this.hoverCell = -1;
    this.pointerMoved();
  }

  protected idle() {
    this.refreshHover();
  }

  // ------------------------------------------------------------ pieces

  /** Makes the board show exactly these pieces, animating the differences (or not). */
  protected async place(specs: PieceSpec[], animate: boolean, style: PlaceStyle = {}): Promise<void> {
    const want = new Map(specs.map((s) => [s.key, s]));
    const jobs: Promise<unknown>[] = [];
    const appear = style.appear ?? "drop";
    let born = 0;
    // Gone.
    for (const [key, obj] of [...this.pieces]) {
      if (want.has(key)) continue;
      this.pieces.delete(key);
      if (!animate) {
        this.root.remove(obj);
        disposeTree(obj);
        continue;
      }
      const start = obj.position.clone();
      const s0 = obj.scale.clone();
      const vanish = style.vanish ?? "shrink";
      jobs.push(
        this.stage
          .animate(260, (t) => {
            if (vanish === "lift") {
              obj.position.y = start.y + t * 1.2;
              obj.scale.copy(s0).multiplyScalar(1 - t * 0.6);
            } else if (vanish === "sink") obj.position.y = start.y - t * 0.6;
            else obj.scale.copy(s0).multiplyScalar(Math.max(0.001, 1 - t));
          })
          .then(() => {
            this.root.remove(obj);
            disposeTree(obj);
          }),
      );
    }
    // New, moved, changed.
    for (const spec of specs) {
      const have = this.pieces.get(spec.key);
      if (!have) {
        const obj = spec.make();
        obj.position.copy(spec.pos);
        if (spec.yaw !== undefined) obj.rotation.y = spec.yaw;
        if (spec.quat) obj.quaternion.copy(spec.quat);
        this.root.add(obj);
        this.pieces.set(spec.key, obj);
        if (spec.update) void spec.update(obj, false);
        if (animate && spec.from) {
          // Flies in along an arc, turning as it goes.
          const a = spec.from.clone();
          const q0 = (spec.fromQuat ?? spec.quat ?? obj.quaternion).clone();
          const q1 = obj.quaternion.clone();
          obj.position.copy(a);
          obj.quaternion.copy(q0);
          const delay = (style.stagger ?? 0) * born++;
          jobs.push(
            this.stage.wait(delay).then(() =>
              this.stage.animate(420, (t) => {
                hop(a, spec.pos, 0.8, t, obj.position);
                obj.quaternion.slerpQuaternions(q0, q1, t);
              }, easeInOut),
            ).then(() => {
              if (style.sound !== null) sfx(style.sound ?? "card", 0.45);
            }),
          );
          continue;
        }
        if (animate && appear !== "none") {
          const delay = (style.stagger ?? 0) * born++;
          const s0 = obj.scale.clone();
          if (appear === "pop") obj.scale.setScalar(0.001);
          else obj.position.y = spec.pos.y + 1.4;
          jobs.push(
            this.stage.wait(delay).then(() =>
              this.stage.animate(appear === "pop" ? 240 : 320, (t) => {
                if (appear === "pop") obj.scale.copy(s0).multiplyScalar(Math.max(0.001, bounce(t)));
                else obj.position.y = spec.pos.y + (1 - bounce(t)) * 1.4;
              }),
            ).then(() => {
              if (style.sound !== null) sfx(style.sound ?? "place", 0.45);
            }),
          );
        }
        continue;
      }
      const moved = have.position.distanceTo(spec.pos) > 1e-4;
      if (moved) {
        if (!animate) have.position.copy(spec.pos);
        else {
          const a = have.position.clone();
          const far = style.slideMs === undefined && a.distanceTo(spec.pos) > 0.6;
          jobs.push(this.stage.animate(style.slideMs ?? (far ? 360 : 220), (t) => (far ? hop(a, spec.pos, 0.5, t, have.position) : have.position.lerpVectors(a, spec.pos, t)), easeInOut));
        }
      }
      if (spec.quat && have.quaternion.angleTo(spec.quat) > 1e-3) {
        if (!animate) have.quaternion.copy(spec.quat);
        else {
          const q0 = have.quaternion.clone();
          const q1 = spec.quat.clone();
          jobs.push(this.stage.animate(moved ? 360 : 300, (t) => have.quaternion.slerpQuaternions(q0, q1, t), easeInOut));
        }
      } else if (spec.yaw !== undefined) have.rotation.y = spec.yaw;
      if (spec.update) jobs.push(Promise.resolve(spec.update(have, animate)));
    }
    this.stage.invalidate();
    await Promise.all(jobs);
  }

  dispose() {
    this.pieces.clear();
    super.dispose();
  }
}
