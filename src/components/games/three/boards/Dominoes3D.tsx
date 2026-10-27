// LANX 2.16.0: Dominoes in 3D — ivory tiles with real pips on a felt table.
// The line snakes back and forth across the middle; your tiles stand in
// front of you (click one to play it — if it fits both ends you choose which);
// the others' tiles are face down at their places, so their pips never reach
// your screen until they play them.

import * as THREE from "three";
import { useEffect, useMemo, useRef, useState } from "react";
import { seatFor, type BoardProps } from "../../boardProps";
import { dominoPlayable, dominoes, type DominoState, type Tile } from "../../../../lib/games/dominoes.ts";
import { BoardScene, type PieceSpec } from "../boardScene";
import { canvasTexture, labelMesh, mesh, roundRect, sharedGeo, slab } from "../kit";
import { TABLE_BOX, TOP, backFan, makeTable, seatPlaces } from "../cardTable";
import { SceneBox, useScene } from "../Board3D";
import { BoardBar, HiddenActions, primary3, type Action } from "../ui";

const TL = 1.3; // tile length
const TW = 0.65;
const TH = 0.2;
const PER_ROW = 8;

const PIP: Record<number, [number, number][]> = {
  0: [],
  1: [[0.5, 0.5]],
  2: [[0.25, 0.25], [0.75, 0.75]],
  3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
  4: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]],
  5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
  6: [[0.25, 0.22], [0.75, 0.22], [0.25, 0.5], [0.75, 0.5], [0.25, 0.78], [0.75, 0.78]],
};

const tileKey = (t: Tile) => `t:${Math.min(t[0], t[1])}-${Math.max(t[0], t[1])}`;

class DominoScene extends BoardScene<DominoState> {
  private faces = new Map<string, THREE.Texture>();
  private labels = new THREE.Group();
  private view: { me: number; others: number[]; at: Map<number, THREE.Vector3>; canPlay: boolean; playable: Tile[]; onTile: (t: Tile) => void } | null = null;
  constructor(host: HTMLElement) {
    super(host, { fov: 26 });
    this.top = TOP;
    makeTable(this.stage.scene, "#1f5f45");
    this.stage.scene.add(this.labels);
    this.stage.allowViewDrag("dominoes", 50, 30);
    this.stage.frame(TABLE_BOX, [0, 2.4, 1], 1.02);
  }
  setView(v: { me: number; others: number[]; at: Map<number, THREE.Vector3>; canPlay: boolean; playable: Tile[]; onTile: (t: Tile) => void }, names: string[]) {
    this.view = v;
    this.labels.clear();
    v.others.forEach((q) => {
      const l = labelMesh(names[q] ?? `Player ${q + 1}`, { size: 0.3, color: "#ffffff", bg: "rgba(15,23,42,0.55)" });
      l.position.copy(v.at.get(q)!).setY(TOP + 0.004);
      this.labels.add(l);
    });
    const s = this.replay(this.shown);
    if (s) this.snap(s);
  }
  protected replay(moves: string[]) {
    return dominoes.replay(moves, this.n, this.seed);
  }
  private faceTex(t: Tile) {
    const key = `${t[0]}-${t[1]}`;
    let tex = this.faces.get(key);
    if (!tex) {
      tex = canvasTexture(128, 256, (ctx, w, h) => {
        ctx.fillStyle = "#fbf8ef";
        roundRect(ctx, 0, 0, w, h, 18);
        ctx.fill();
        ctx.fillStyle = "#334155";
        ctx.fillRect(w * 0.15, h / 2 - 2, w * 0.7, 4);
        [t[0], t[1]].forEach((v, half) => {
          for (const [x, y] of PIP[v]) {
            ctx.beginPath();
            ctx.arc(x * w, (half * 0.5 + y * 0.5) * h, w * 0.085, 0, Math.PI * 2);
            ctx.fillStyle = "#111827";
            ctx.fill();
          }
        });
      });
      tex.userData.shared = true;
      this.faces.set(key, tex);
    }
    return tex;
  }
  /** A tile, long side along Z: the first number at −Z. Face down: a plain back. */
  private tile(t: Tile | null) {
    const g = new THREE.Group();
    const body = mesh(sharedGeo("domino", () => slab(TW, TH, TL, 0.05)), new THREE.MeshPhysicalMaterial({ color: t ? 0xf5f1e6 : 0x1f2937, roughness: 0.35, clearcoat: 0.5 }));
    g.add(body);
    if (t) {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(TW * 0.94, TL * 0.96), new THREE.MeshStandardMaterial({ map: this.faceTex(t), roughness: 0.4, alphaTest: 0.5 }));
      face.rotation.x = -Math.PI / 2;
      face.position.y = TH + 0.002;
      g.add(face);
    }
    return g;
  }
  /** Where the k-th tile of a line of `len` lies (rows snake back and forth). */
  private lineSpot(k: number, len: number): { pos: THREE.Vector3; yaw: number } {
    const rows = Math.max(1, Math.ceil(len / PER_ROW));
    const row = Math.floor(k / PER_ROW);
    const inRow = Math.min(PER_ROW, len - row * PER_ROW);
    const col = k % PER_ROW;
    const forward = row % 2 === 0;
    const c = forward ? col : PER_ROW - 1 - col;
    const shift = rows === 1 ? (PER_ROW - inRow) / 2 : 0;
    const x = (c + (forward ? shift : -shift) - (PER_ROW - 1) / 2) * (TL + 0.04);
    const z = (row - (rows - 1) / 2) * (TW + 0.5) - 0.5;
    return { pos: new THREE.Vector3(x, TOP + 0.005, z), yaw: forward ? Math.PI / 2 : -Math.PI / 2 };
  }
  private specs(s: DominoState): PieceSpec[] {
    const v = this.view;
    const out: PieceSpec[] = [];
    s.line.forEach((t, k) => {
      const spot = this.lineSpot(k, s.line.length);
      const placedBy = v?.at.get(s.turn === 0 ? this.n - 1 : s.turn - 1);
      out.push({ key: tileKey(t), pos: spot.pos, quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, spot.yaw, 0)), make: () => this.tile(t), from: placedBy?.clone().setY(TOP + 0.4), update: (o) => this.flipTo(o, t) });
    });
    if (!v) return out;
    const hand = s.hands[v.me] ?? [];
    const width = Math.min(10, hand.length * 0.82);
    hand.forEach((t, i) => {
      const x = hand.length > 1 ? -width / 2 + (i * width) / (hand.length - 1) : 0;
      const ok = v.canPlay && v.playable.some((q) => tileKey(q) === tileKey(t));
      out.push({ key: tileKey(t), pos: new THREE.Vector3(x, TOP + 0.12 + (ok ? 0.12 : 0), 3.05), quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.35, 0, 0)), make: () => this.tile(t) });
    });
    for (const q of v.others) {
      const n = s.hands[q]?.length ?? 0;
      backFan(v.at.get(q)!, n).forEach((b, k) => out.push({ key: `back:${q}:${k}`, pos: b.pos, quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, b.yaw + Math.PI / 2, 0)), make: () => this.tile(null) }));
    }
    return out;
  }
  /** A tile that was face down (someone else's) shows its pips once it is played. */
  private flipTo(o: THREE.Object3D, t: Tile) {
    if (o.children.length < 2) {
      o.clear();
      o.add(...this.tile(t).children);
    }
  }
  protected snap(s: DominoState) {
    void this.place(this.specs(s), false).then(() => this.bindPicks(s));
  }
  protected async animateStep(_b: DominoState, after: DominoState) {
    await this.place(this.specs(after), true, { appear: "drop", sound: "place" });
  }
  private bindPicks(s: DominoState) {
    const v = this.view;
    if (!v) return;
    for (const o of this.pieces.values()) this.stage.unpick(o);
    for (const t of s.hands[v.me] ?? []) {
      const o = this.pieces.get(tileKey(t));
      if (!o || !v.canPlay || !v.playable.some((q) => tileKey(q) === tileKey(t))) continue;
      this.stage.pickable(o, {
        onClick: () => v.onTile(t),
        onHover: (on) => {
          o.children.forEach((c) => (c.position.z = on ? -0.1 : 0));
          this.stage.invalidate();
        },
      });
    }
  }
  protected idle() {
    const s = this.replay(this.shown);
    if (s) this.bindPicks(s);
  }
  dispose() {
    for (const t of this.faces.values()) t.dispose();
    this.faces.clear();
    super.dispose();
  }
}

export default function Dominoes3D(p: BoardProps) {
  const n = Math.max(2, Math.min(4, p.seats?.length ?? 2));
  const seed = p.seed ?? "";
  const state = useMemo(() => dominoes.replay(p.moves, n, seed), [p.moves, n, seed]);
  const me = p.local ? Math.max(0, p.turn) : p.seat;
  const [pick, setPick] = useState<Tile | null>(null);
  const send = useRef(p.onMove);
  send.current = p.onMove;
  const [hostRef, scene] = useScene((el) => new DominoScene(el));
  const others = useMemo(() => Array.from({ length: n - 1 }, (_, k) => (me + k + 1) % n), [me, n]);
  const at = useMemo(() => {
    const m = new Map<number, THREE.Vector3>();
    const places = seatPlaces(others.length);
    others.forEach((q, i) => m.set(q, places[i]));
    return m;
  }, [others]);
  const playable = useMemo(() => (state && p.canPlay ? dominoPlayable(state, state.hands[me] ?? []) : []), [state, p.canPlay, me]);
  const names = Array.from({ length: n }, (_, q) => seatFor(p.seats, p.starter ?? 0, q, n).name);
  const play = (t: Tile, end: "l" | "r") => {
    setPick(null);
    send.current(`p:${t[0]}-${t[1]}:${end}`);
  };
  const choose = (t: Tile) => {
    const ends = playable.filter((q) => q.tile === t).map((q) => q.end);
    if (!ends.length || !state) return;
    if (ends.length === 1 || !state.line.length) play(t, ends[0]);
    else setPick(t);
  };
  const chooseRef = useRef(choose);
  chooseRef.current = choose;
  useEffect(() => scene?.sync(n, seed, p.moves), [scene, n, seed, p.moves]);
  useEffect(() => {
    scene?.setView({ me, others, at, canPlay: p.canPlay, playable: playable.map((q) => q.tile), onTile: (t) => chooseRef.current(t) }, names);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, me, others, at, p.canPlay, playable, names.join()]);
  if (!state) return null;
  const actions: Action[] = playable.map((q) => ({ key: `${q.tile[0]}-${q.tile[1]}:${q.end}`, label: `Play ${q.tile[0]}-${q.tile[1]} on the ${q.end === "l" ? "left" : "right"}`, run: () => play(q.tile, q.end), attrs: { "data-domino-play": `p:${q.tile[0]}-${q.tile[1]}:${q.end}` } }));
  return (
    <div data-game-board="dominoes" data-g3-board="dominoes" className="flex w-full max-w-[860px] flex-col items-center gap-2">
      <BoardBar>
        <span data-domino-hands>
          {state.hands.map((h, q) => `${names[q]} ${h.length}`).join(" · ")}
        </span>
        {pick && (
          <span className="inline-flex items-center gap-2" data-domino-ends>
            Put {pick[0]}-{pick[1]} on the
            <button type="button" data-domino-end="l" onClick={() => play(pick, "l")} className={primary3}>
              ← left end
            </button>
            <button type="button" data-domino-end="r" onClick={() => play(pick, "r")} className={primary3}>
              right end →
            </button>
          </span>
        )}
        {p.canPlay && playable.length === 0 && state.winner === null && (
          <button type="button" data-domino-pass onClick={() => p.onMove("x")} className="rounded-full bg-amber-500 px-4 py-1.5 text-white">
            Nothing fits — pass
          </button>
        )}
      </BoardBar>
      <SceneBox hostRef={hostRef} aspect={1.5} maxH={540} testId="dominoes" />
      <HiddenActions actions={actions} label="Tiles you can play" />
    </div>
  );
}
