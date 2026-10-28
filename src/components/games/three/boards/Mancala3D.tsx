// LANX 2.16.0: Mancala in 3D — a carved wooden board with twelve pits and
// two stores, and real seeds that are picked up and sown one by one round
// the board, captured across it, and swept home at the end. Each seed keeps
// its own colour as it travels; the counts always come from the rules.

import * as THREE from "three";
import { useEffect, useMemo, useRef } from "react";
import { seatFor, type BoardProps } from "../../boardProps";
import { mancala, type MancalaState } from "../../../../lib/games/mancala.ts";
import { mancalaNews, mancalaStoreLabel } from "../../boards/MancalaBoard";
import { sfx } from "../../../../lib/gameSounds";
import { TurnScene } from "../turnScene";
import { hop, labelMesh, mesh, slab, wood } from "../kit";
import { SceneBox, useScene } from "../Board3D";
import { BoardBar, HiddenActions, type Action } from "../ui";
import { easeOut } from "../stage";

const TOP = 0.55;
const STORE = [6, 13];
const SEED_COLOURS = [0xb45309, 0x15803d, 0x1d4ed8, 0xbe123c, 0x7c3aed, 0x0f766e, 0xca8a04, 0x334155];

/** Where a pit or store is on the board. */
function pitXZ(i: number): [number, number] {
  if (i === 6) return [3.75, 0];
  if (i === 13) return [-3.75, 0];
  if (i < 6) return [-2.5 + i, 0.6];
  return [2.5 - (i - 7), -0.6];
}

/** The k-th seed's resting place in a pile of `count`, inside a pit (round) or a store (long). */
function pile(k: number, count: number, store: boolean): THREE.Vector3 {
  void count;
  const perLayer = store ? 12 : 8;
  const layer = Math.floor(k / perLayer);
  const j = k % perLayer;
  const a = j * 2.39996 + layer * 0.9;
  const r = Math.sqrt((j + 0.5) / perLayer) * (store ? 0.3 : 0.27);
  return new THREE.Vector3(Math.cos(a) * r, TOP - 0.16 + layer * 0.1, Math.sin(a) * r * (store ? 2.6 : 1));
}

class MancalaScene extends TurnScene<MancalaState> {
  private root = new THREE.Group();
  private seeds: THREE.Mesh[] = [];
  /** Which seeds are in each pit, in order. */
  private contents: number[][] = Array.from({ length: 14 }, () => []);
  private labels: (THREE.Mesh | null)[] = Array(14).fill(null);
  private info: { canPlay: boolean; turn: number; onPit: (rel: number) => void } | null = null;
  private hoverRing: THREE.Mesh;
  private hoverPit = -1;

  constructor(host: HTMLElement) {
    super(host, { fov: 26 });
    const s = this.stage;
    s.scene.add(this.root);
    this.buildBoard();
    const seedGeo = new THREE.SphereGeometry(0.075, 16, 12);
    seedGeo.scale(1, 0.72, 1.15);
    for (let k = 0; k < 48; k++) {
      const m = mesh(seedGeo, new THREE.MeshPhysicalMaterial({ color: SEED_COLOURS[(k * 5) % SEED_COLOURS.length], roughness: 0.25, clearcoat: 0.8 }));
      m.rotation.y = k * 1.7;
      this.root.add(m);
      this.seeds.push(m);
    }
    this.hoverRing = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.47, 40), new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.9, depthWrite: false }));
    this.hoverRing.rotation.x = -Math.PI / 2;
    this.hoverRing.visible = false;
    this.root.add(this.hoverRing);
    s.onPointerMove = () => this.hover();
    s.onTap = () => {
      const i = this.pitUnder();
      if (i !== null && this.clickable(i)) {
        this.hoverRing.visible = false;
        this.info?.onPit(i < 6 ? i : i - 7);
      }
    };
    s.allowViewDrag("mancala", 55, 35);
    s.frame(new THREE.Box3(new THREE.Vector3(-4.6, 0, -1.6), new THREE.Vector3(4.6, 0.8, 1.6)), [0, 2.4, 1], 1.03);
  }

  private buildBoard() {
    // The top: a surface with round pits and two long stores cut into it, a bowl under each.
    const shape = new THREE.Shape();
    const W = 9;
    const D = 2.9;
    shape.moveTo(-W / 2 + 0.5, -D / 2);
    shape.lineTo(W / 2 - 0.5, -D / 2);
    shape.quadraticCurveTo(W / 2, -D / 2, W / 2, -D / 2 + 0.5);
    shape.lineTo(W / 2, D / 2 - 0.5);
    shape.quadraticCurveTo(W / 2, D / 2, W / 2 - 0.5, D / 2);
    shape.lineTo(-W / 2 + 0.5, D / 2);
    shape.quadraticCurveTo(-W / 2, D / 2, -W / 2, D / 2 - 0.5);
    shape.lineTo(-W / 2, -D / 2 + 0.5);
    shape.quadraticCurveTo(-W / 2, -D / 2, -W / 2 + 0.5, -D / 2);
    const bowlMat = new THREE.MeshPhysicalMaterial({ color: 0x6b3f1f, roughness: 0.55, clearcoat: 0.3, side: THREE.BackSide });
    for (let i = 0; i < 14; i++) {
      const [x, z] = pitXZ(i);
      const store = i === 6 || i === 13;
      const hole = new THREE.Path();
      if (store) {
        hole.absellipse(x, -z, 0.42, 1.05, 0, Math.PI * 2, true, 0);
      } else hole.absarc(x, -z, 0.42, 0, Math.PI * 2, true);
      shape.holes.push(hole);
      const bowl = mesh(new THREE.SphereGeometry(0.42, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), bowlMat, false);
      bowl.receiveShadow = true;
      bowl.scale.set(1, 0.62, store ? 2.5 : 1);
      bowl.position.set(x, TOP, z);
      this.root.add(bowl);
    }
    const top = mesh(new THREE.ShapeGeometry(shape, 24), wood("medium", 2));
    top.rotation.x = -Math.PI / 2;
    top.position.y = TOP;
    top.castShadow = false;
    this.root.add(top);
    const body = mesh(slab(W, TOP - 0.3, D, 0.4), wood("medium", 2));
    this.root.add(body);
    // Sides from the body up to the top.
    for (const sz of [-1, 1]) {
      const side = mesh(slab(W - 1, 0.31, 0.12, 0.04), wood("medium", 2));
      side.position.set(0, TOP - 0.31, sz * (D / 2 - 0.06));
      this.root.add(side);
    }
    for (const sx of [-1, 1]) {
      const side = mesh(slab(0.12, 0.31, D - 1, 0.04), wood("medium", 2));
      side.position.set(sx * (W / 2 - 0.06), TOP - 0.31, 0);
      this.root.add(side);
    }
  }

  private flipped = false;
  setSide(flip: boolean) {
    this.flipped = flip;
    this.root.rotation.y = flip ? Math.PI : 0;
    for (const l of this.labels) if (l) l.rotation.z = flip ? Math.PI : 0;
    this.stage.invalidate();
  }

  setTurn(info: { canPlay: boolean; turn: number; onPit: (rel: number) => void }) {
    this.info = info;
    this.hover();
  }

  private clickable(i: number) {
    const s = this.replay(this.shown);
    if (!s || !this.info?.canPlay || !this.settled) return false;
    const mine = this.info.turn === 0 ? i >= 0 && i <= 5 : i >= 7 && i <= 12;
    return mine && s.pits[i] > 0;
  }

  private pitUnder(): number | null {
    const p = this.stage.pointOnPlane(TOP);
    if (!p) return null;
    const l = this.root.worldToLocal(p.clone());
    for (let i = 0; i < 14; i++) {
      if (STORE.includes(i)) continue;
      const [x, z] = pitXZ(i);
      if (Math.hypot(l.x - x, l.z - z) < 0.46) return i;
    }
    return null;
  }

  private hover() {
    const i = this.pitUnder();
    const ok = i !== null && this.clickable(i);
    this.hoverRing.visible = ok;
    if (ok && i !== null) {
      const [x, z] = pitXZ(i);
      this.hoverRing.position.set(x, TOP + 0.004, z);
    }
    this.hoverPit = ok && i !== null ? i : -1;
    this.stage.renderer.domElement.style.cursor = ok ? "pointer" : "";
    this.stage.invalidate();
  }

  protected replay(moves: string[]) {
    return mancala.replay(moves, 2, "");
  }

  private seedPos(pit: number, k: number) {
    const [x, z] = pitXZ(pit);
    const v = pile(k, this.contents[pit].length, STORE.includes(pit));
    v.x += x;
    v.z += z;
    return v;
  }

  private drawLabels(s: MancalaState) {
    for (let i = 0; i < 14; i++) {
      const old = this.labels[i];
      if (old && old.userData.count === s.pits[i]) continue;
      if (old) {
        this.root.remove(old);
        old.geometry.dispose();
        ((old.material as THREE.MeshBasicMaterial).map as THREE.Texture | null)?.dispose();
        (old.material as THREE.Material).dispose();
      }
      const [x, z] = pitXZ(i);
      const store = STORE.includes(i);
      const m = labelMesh(String(s.pits[i]), { size: store ? 0.34 : 0.26, color: "#fef3c7" });
      if (store) m.position.set(x + (i === 6 ? 0.58 : -0.58), TOP + 0.003, 0);
      else m.position.set(x, TOP + 0.003, z + (z > 0 ? 0.6 : -0.6));
      m.rotation.z = this.flipped ? Math.PI : 0;
      m.userData.count = s.pits[i];
      this.root.add(m);
      this.labels[i] = m;
    }
  }

  protected snap(s: MancalaState) {
    // Keep each seed's place when the counts already match; otherwise lay them out afresh.
    const ok = this.contents.every((c, i) => c.length === s.pits[i]);
    if (!ok) {
      let k = 0;
      this.contents = s.pits.map((n) => Array.from({ length: n }, () => k++));
    }
    this.contents.forEach((ids, pit) => ids.forEach((id, j) => this.seeds[id].position.copy(this.seedPos(pit, j))));
    this.drawLabels(s);
    this.stage.invalidate();
  }

  private async moveSeed(id: number, to: number, ms = 150) {
    this.contents[to].push(id);
    const m = this.seeds[id];
    const a = m.position.clone();
    const b = this.seedPos(to, this.contents[to].length - 1);
    await this.stage.animate(ms, (t) => hop(a, b, 0.45, t, m.position), easeOut);
    sfx("tap", 0.25);
  }

  protected async animateStep(before: MancalaState, after: MancalaState, move: string) {
    this.hoverRing.visible = false;
    const p = before.turn;
    const from = p === 0 ? Number(move) : 7 + Number(move);
    const hand = this.contents[from].splice(0);
    let i = from;
    const pits = [...before.pits];
    pits[from] = 0;
    for (const id of hand) {
      i = (i + 1) % 14;
      if (i === STORE[1 - p]) i = (i + 1) % 14;
      pits[i]++;
      await this.moveSeed(id, i);
    }
    const own = p === 0 ? [0, 1, 2, 3, 4, 5] : [7, 8, 9, 10, 11, 12];
    // A capture: the last seed alone in your own pit takes everything opposite.
    if (own.includes(i) && pits[i] === 1 && pits[12 - i] > 0 && after.pits[i] === 0) {
      sfx("capture", 0.7);
      const take = [...this.contents[12 - i].splice(0), ...this.contents[i].splice(0)];
      await Promise.all(take.map((id, k) => this.stage.wait(k * 40).then(() => this.moveSeed(id, STORE[p], 320))));
    }
    // The end: one side empty, the other side's seeds go to their store.
    for (const side of [0, 1]) {
      const pitsOf = side === 0 ? [0, 1, 2, 3, 4, 5] : [7, 8, 9, 10, 11, 12];
      if (!pitsOf.every((x) => after.pits[x] === 0)) continue;
      const rest = pitsOf.flatMap((x) => this.contents[x].splice(0));
      if (rest.length) await Promise.all(rest.map((id, k) => this.stage.wait(k * 30).then(() => this.moveSeed(id, STORE[side], 360))));
    }
  }

  protected idle() {
    this.hover();
  }

  get hovered() {
    return this.hoverPit;
  }
}

export function Mancala3D({ moves, canPlay, turn, seat, seats, starter = 0, local, onMove }: BoardProps) {
  const state = useMemo(() => mancala.replay(moves, 2, ""), [moves]);
  const send = useRef(onMove);
  send.current = onMove;
  const [hostRef, scene] = useScene((el) => new MancalaScene(el));
  useEffect(() => scene?.setSide(!local && seat === 1), [scene, local, seat]);
  useEffect(() => scene?.sync(2, "", moves), [scene, moves]);
  useEffect(() => scene?.setTurn({ canPlay, turn, onPit: (rel) => send.current(String(rel)) }), [scene, canPlay, turn]);
  if (!state) return null;
  const me = local ? -1 : seat;
  const name = (p: number) => seatFor(seats, starter, p, 2).name.split(" (")[0];
  const news = mancalaNews(state, me, name);
  const mine = turn === 0 ? [0, 1, 2, 3, 4, 5] : [7, 8, 9, 10, 11, 12];
  const actions: Action[] = canPlay ? mine.filter((i) => state.pits[i] > 0).map((i) => ({ key: String(i), label: `Sow pit ${i}`, run: () => onMove(String(turn === 0 ? i : i - 7)), attrs: { "data-mancala-pit": String(i) } })) : [];
  return (
    <div data-game-board="mancala" data-g3-board="mancala" className="flex w-full max-w-[760px] flex-col items-center gap-2">
      <BoardBar>
        {/* LANX 2.17.0: by person ("top"/"bottom" was wrong on the other player's screen), in the order
            they sit on the board: the store on the left first. */}
        {(!local && seat === 1 ? [0, 1] : [1, 0]).map((p) => (
          <span key={p} data-mancala-store={p}>
            {mancalaStoreLabel(p, me, name)}: {state.pits[p === 0 ? 6 : 13]}
          </span>
        ))}
      </BoardBar>
      <div data-mancala-news className="min-h-[18px] text-[12.5px] font-semibold text-slate-700 dark:text-slate-200">
        {news ?? ""}
      </div>
      <SceneBox hostRef={hostRef} aspect={2.1} minH={260} maxH={420} testId="mancala" />
      <HiddenActions actions={actions} label="Pits you can sow" />
    </div>
  );
}
