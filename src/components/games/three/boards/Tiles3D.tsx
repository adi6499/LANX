// LANX 2.16.0: the tile and grid games in 3D — Chain Reaction (orbs that
// burst across the board), Dots & Boxes (pegs, rails and claimed squares),
// Memory (cards that turn over), Minesweeper Versus (tiles that sink as
// they open), Mahjong Duels (thick tiles that lift away in pairs) and Paint
// Fight (tiles that pop up in your colour). Hidden things stay hidden: a
// card's face or a mine is only put in the scene once it is revealed.

import * as THREE from "three";
import { useEffect, useMemo, useRef } from "react";
import { seatFor, type BoardProps } from "../../boardProps";
import { CR_COLS, CR_ROWS, crCritical, crPlace, crReplay, type CRBoard, type CRState } from "../../../../lib/gameRules";
import { BOXES, DOTS, dots, type DotsState } from "../../../../lib/games/dots.ts";
import { memory, type MemoryState } from "../../../../lib/games/memory.ts";
import { MV_SIZE, minesVersus, mvCount, type MinesVsState } from "../../../../lib/games/minesVersus.ts";
import { MJ_COLS, MJ_ROWS, mahjong, mjFree, mjPairs, type MahjongState } from "../../../../lib/games/mahjong.ts";
import { PAINT, paintFight, paintGrid, type PaintState } from "../../../../lib/games/paintfight.ts";
import { sfx } from "../../../../lib/gameSounds";
import { BoardScene, type PieceSpec } from "../boardScene";
import { FONT, ballGeometry, canvasTexture, mesh, onRelease, roundRect, sharedGeo, slab, wood } from "../kit";
import { SceneBox, useScene } from "../Board3D";
import { BoardBar, HiddenActions, SeatDot, type Action } from "../ui";
import { PartyShell } from "../../boards/PartyShell";
import { easeInOut, easeOut } from "../stage";

const EMOJI = `"Segoe UI Emoji", "Segoe UI Symbol", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
const colourList = (p: BoardProps, n: number) => Array.from({ length: n }, (_, i) => seatFor(p.seats, p.starter ?? 0, i, n).color);
const tint = (hex: string, k: number) => new THREE.Color(hex).lerp(new THREE.Color(0xffffff), k);

function baseSlab(w: number, d: number, h: number, colour: THREE.Material) {
  const m = mesh(slab(w, h, d, 0.12), colour);
  return m;
}

// ------------------------------------------------------------ Chain Reaction

const CR_GAP = 1;
const orbOffsets = (n: number): [number, number][] => [[[0, 0]], [[-0.18, 0], [0.18, 0]], [[0, -0.17], [-0.18, 0.13], [0.18, 0.13]], [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]][Math.max(0, Math.min(4, n) - 1)] as [number, number][];

function crNeighbours(i: number): number[] {
  const r = Math.floor(i / CR_COLS);
  const c = i % CR_COLS;
  const out: number[] = [];
  if (r > 0) out.push(i - CR_COLS);
  if (r < CR_ROWS - 1) out.push(i + CR_COLS);
  if (c > 0) out.push(i - 1);
  if (c < CR_COLS - 1) out.push(i + 1);
  return out;
}

class ChainScene extends BoardScene<CRState> {
  private colours: string[] = [];
  private info: { canPlay: boolean; turn: number; onPlay: (i: number) => void } | null = null;
  private orbMats = new Map<string, THREE.Material>();
  constructor(host: HTMLElement) {
    super(host, { fov: 26 });
    this.top = 0.3;
    const w = CR_COLS * CR_GAP + 0.5;
    const d = CR_ROWS * CR_GAP + 0.5;
    this.stage.scene.add(baseSlab(w, d, 0.16, new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6 })));
    const tileMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.55 });
    for (let i = 0; i < CR_ROWS * CR_COLS; i++) {
      const t = mesh(slab(0.9, 0.14, 0.9, 0.06), tileMat);
      t.position.copy(this.cellPos(i)).setY(0.16);
      this.root.add(t);
    }
    this.stage.allowViewDrag("chain");
    this.stage.frame(new THREE.Box3(new THREE.Vector3(-w / 2, 0, -d / 2), new THREE.Vector3(w / 2, 0.6, d / 2)), [0, 2.8, 1], 1.03);
  }
  setLook(colours: string[]) {
    this.colours = colours;
    this.stage.invalidate();
  }
  setTurn(info: { canPlay: boolean; turn: number; onPlay: (i: number) => void }) {
    this.info = info;
    if (this.hoverMark) ((this.hoverMark as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(this.colours[info.turn] ?? "#6366f1");
    this.refreshHover();
  }
  protected replay(moves: string[]) {
    return crReplay(moves, this.n);
  }
  protected cellPos(i: number) {
    return new THREE.Vector3(((i % CR_COLS) - (CR_COLS - 1) / 2) * CR_GAP, this.top, (Math.floor(i / CR_COLS) - (CR_ROWS - 1) / 2) * CR_GAP);
  }
  protected cellAt(p: THREE.Vector3) {
    const c = Math.round(p.x / CR_GAP + (CR_COLS - 1) / 2);
    const r = Math.round(p.z / CR_GAP + (CR_ROWS - 1) / 2);
    return c < 0 || r < 0 || c >= CR_COLS || r >= CR_ROWS ? null : r * CR_COLS + c;
  }
  protected clickable(i: number) {
    const s = this.replay(this.shown);
    if (!s || !this.info?.canPlay) return false;
    const c = s.board[i];
    return c.owner === null || c.owner === this.info.turn;
  }
  protected clicked(i: number) {
    this.showHover(null);
    this.info?.onPlay(i);
  }
  protected makeHover() {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.92), new THREE.MeshBasicMaterial({ color: this.colours[this.info?.turn ?? 0] ?? 0x6366f1, transparent: true, opacity: 0.35, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    return m;
  }
  private orbMat(owner: number) {
    const c = this.colours[owner] ?? "#94a3b8";
    let m = this.orbMats.get(c);
    if (!m) {
      m = new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.1 });
      this.orbMats.set(c, m);
    }
    return m;
  }
  private orb(owner: number) {
    return mesh(ballGeometry(0.19, 28), this.orbMat(owner));
  }
  private specs(b: CRBoard): PieceSpec[] {
    const out: PieceSpec[] = [];
    b.forEach((c, i) => {
      if (!c.n || c.owner === null) return;
      const owner = c.owner;
      const offs = orbOffsets(c.n);
      offs.forEach(([ox, oz], k) => {
        const p = this.cellPos(i).add(new THREE.Vector3(ox, 0.2, oz));
        out.push({ key: `${i}:${k}`, pos: p, make: () => this.orb(owner), update: (o) => void ((o as THREE.Mesh).material = this.orbMat(owner)) });
      });
    });
    return out;
  }
  protected snap(s: CRState) {
    void this.place(this.specs(s.board), false);
  }
  protected async animateStep(before: CRState, after: CRState, move: string) {
    if (move.startsWith("x")) {
      await this.place(this.specs(after.board), true, { vanish: "shrink", sound: null });
      return;
    }
    const waves = crPlace(before.board, Number(move), before.turn);
    if (!waves) return;
    await this.place(this.specs(waves[0]), true, { appear: "pop" });
    for (let k = 1; k < waves.length; k++) {
      const prev = waves[k - 1];
      const hot = prev.map((c, i) => (c.n >= crCritical(i) ? i : -1)).filter((i) => i >= 0);
      // Orbs fly from each bursting cell to its neighbours.
      const flyers: THREE.Mesh[] = [];
      const flights: Promise<void>[] = [];
      for (const i of hot) {
        for (const j of crNeighbours(i)) {
          const o = this.orb(before.turn);
          const a = this.cellPos(i).setY(this.top + 0.2);
          const b = this.cellPos(j).setY(this.top + 0.2);
          o.position.copy(a);
          this.root.add(o);
          flyers.push(o);
          flights.push(this.stage.animate(170, (t) => o.position.lerpVectors(a, b, t).setY(a.y + Math.sin(t * Math.PI) * 0.35), easeOut));
        }
      }
      // The burst cells empty as the orbs leave.
      void this.place(this.specs(prev.map((c, i) => (hot.includes(i) ? { owner: c.n - crCritical(i) > 0 ? c.owner : null, n: c.n - crCritical(i) } : c))), true, { vanish: "shrink", sound: null });
      sfx("chain", 0.7);
      await Promise.all(flights);
      for (const f of flyers) this.root.remove(f);
      await this.place(this.specs(waves[k]), false);
    }
  }
}

export function ChainReaction3D(p: BoardProps) {
  const n = Math.max(2, p.seats?.length ?? 2);
  const state = useMemo(() => crReplay(p.moves, n), [p.moves, n]);
  const colours = useMemo(() => colourList(p, n), [p.seats, p.starter, n]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = useRef(p.onMove);
  send.current = p.onMove;
  const [hostRef, scene] = useScene((el) => new ChainScene(el));
  useEffect(() => scene?.setLook(colours), [scene, colours]);
  useEffect(() => scene?.sync(n, "", p.moves), [scene, n, p.moves]);
  useEffect(() => scene?.setTurn({ canPlay: p.canPlay, turn: p.turn, onPlay: (i) => send.current(String(i)) }), [scene, p.canPlay, p.turn]);
  if (!state) return null;
  const actions: Action[] = p.canPlay ? state.board.flatMap((c, i): Action[] => (c.owner === null || c.owner === p.turn ? [{ key: String(i), label: `Cell ${i}`, run: () => p.onMove(String(i)), attrs: { "data-cr-cell": String(i) } }] : [])) : [];
  return (
    <div data-game-board="chainreaction" data-g3-board="chainreaction" className="flex w-full max-w-[700px] flex-col items-center gap-2">
      <BoardBar>
        {state.counts.map((c, q) => (
          <span key={q} className={`inline-flex items-center gap-1.5 ${state.out[q] ? "line-through opacity-50" : ""} ${q === p.turn && !state.out[q] ? "underline decoration-2 underline-offset-4" : ""}`}>
            <SeatDot color={colours[q]} /> {c}
          </span>
        ))}
      </BoardBar>
      <SceneBox hostRef={hostRef} aspect={1.45} maxH={520} testId="chainreaction" />
      <HiddenActions actions={actions} label="Cells you can play" />
      <div className="max-w-[420px] text-center text-[11px] text-slate-500">A corner bursts at 2 orbs, an edge at 3, the middle at 4 — and takes the neighbours with it.</div>
    </div>
  );
}

// ------------------------------------------------------------ Dots & Boxes

const DG = 1.4;
const encodeLine = (kind: "h" | "v", r: number, c: number) => (kind === "h" ? r * BOXES + c : 100 + r * DOTS + c);
const decodeLine = (i: number): ["h" | "v", number, number] => (i < 100 ? ["h", Math.floor(i / BOXES), i % BOXES] : ["v", Math.floor((i - 100) / DOTS), (i - 100) % DOTS]);

class DotsScene extends BoardScene<DotsState> {
  private colours: string[] = [];
  private info: { canPlay: boolean; onPlay: (m: string) => void } | null = null;
  constructor(host: HTMLElement) {
    super(host, { fov: 26 });
    this.top = 0.3;
    const span = (DOTS - 1) * DG + 1.2;
    this.stage.scene.add(baseSlab(span, span, this.top, wood("light", 1)));
    this.root.position.set(-((DOTS - 1) * DG) / 2, 0, -((DOTS - 1) * DG) / 2);
    const peg = new THREE.MeshPhysicalMaterial({ color: 0x1e293b, roughness: 0.3, clearcoat: 0.6 });
    for (let r = 0; r < DOTS; r++)
      for (let c = 0; c < DOTS; c++) {
        const m = mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.2, 20), peg);
        m.position.set(c * DG, this.top + 0.1, r * DG);
        this.root.add(m);
      }
    this.stage.allowViewDrag("dots");
    this.stage.frame(new THREE.Box3(new THREE.Vector3(-span / 2, 0, -span / 2), new THREE.Vector3(span / 2, 0.5, span / 2)), [0, 2.8, 1], 1.04);
  }
  setLook(colours: string[]) {
    this.colours = colours;
  }
  setTurn(info: { canPlay: boolean; onPlay: (m: string) => void }) {
    this.info = info;
    this.refreshHover();
  }
  protected replay(moves: string[]) {
    return dots.replay(moves, this.n, "");
  }
  protected cellPos(i: number) {
    const [k, r, c] = decodeLine(i);
    return k === "h" ? new THREE.Vector3((c + 0.5) * DG, this.top, r * DG) : new THREE.Vector3(c * DG, this.top, (r + 0.5) * DG);
  }
  protected cellAt(p: THREE.Vector3) {
    const gx = p.x / DG;
    const gz = p.z / DG;
    const opts: [number, number][] = [];
    const hr = Math.round(gz);
    const hc = Math.floor(gx);
    if (hr >= 0 && hr < DOTS && hc >= 0 && hc < BOXES && Math.abs(gz - hr) < 0.32) opts.push([Math.abs(gz - hr), encodeLine("h", hr, hc)]);
    const vc = Math.round(gx);
    const vr = Math.floor(gz);
    if (vc >= 0 && vc < DOTS && vr >= 0 && vr < BOXES && Math.abs(gx - vc) < 0.32) opts.push([Math.abs(gx - vc), encodeLine("v", vr, vc)]);
    opts.sort((a, b) => a[0] - b[0]);
    return opts[0]?.[1] ?? null;
  }
  protected clickable(i: number) {
    const s = this.replay(this.shown);
    if (!s || !this.info?.canPlay) return false;
    const [k, r, c] = decodeLine(i);
    return !(k === "h" ? s.h[r][c] : s.v[r][c]);
  }
  protected clicked(i: number) {
    const [k, r, c] = decodeLine(i);
    this.showHover(null);
    this.info?.onPlay(`${k}:${r}:${c}`);
  }
  protected makeHover() {
    const m = new THREE.Mesh(new THREE.BoxGeometry(DG - 0.3, 0.06, 0.16), new THREE.MeshBasicMaterial({ color: 0x6366f1, transparent: true, opacity: 0.55, depthWrite: false }));
    return m;
  }
  protected showHover(c: number | null) {
    super.showHover(c);
    if (c !== null && this.hoverMark) this.hoverMark.rotation.y = decodeLine(c)[0] === "v" ? Math.PI / 2 : 0;
  }
  private specs(s: DotsState): PieceSpec[] {
    const out: PieceSpec[] = [];
    const rail = new THREE.MeshPhysicalMaterial({ color: 0x334155, roughness: 0.35, clearcoat: 0.4 });
    const bar = (kind: "h" | "v") => {
      const m = mesh(slab(DG - 0.26, 0.12, 0.13, 0.05), rail);
      if (kind === "v") m.rotation.y = Math.PI / 2;
      return m;
    };
    for (let r = 0; r < DOTS; r++) for (let c = 0; c < BOXES; c++) if (s.h[r][c]) out.push({ key: `h:${r}:${c}`, pos: this.cellPos(encodeLine("h", r, c)), make: () => bar("h") });
    for (let r = 0; r < BOXES; r++) for (let c = 0; c < DOTS; c++) if (s.v[r][c]) out.push({ key: `v:${r}:${c}`, pos: this.cellPos(encodeLine("v", r, c)), make: () => bar("v") });
    s.box.forEach((row, r) =>
      row.forEach((o, c) => {
        if (o < 0) return;
        const colour = this.colours[o] ?? "#94a3b8";
        out.push({
          key: `b:${r}:${c}:${o}`,
          pos: new THREE.Vector3((c + 0.5) * DG, this.top, (r + 0.5) * DG),
          make: () => mesh(slab(DG - 0.36, 0.05, DG - 0.36, 0.08), new THREE.MeshStandardMaterial({ color: colour, roughness: 0.5 })),
        });
      }),
    );
    return out;
  }
  protected snap(s: DotsState) {
    void this.place(this.specs(s), false);
  }
  protected async animateStep(_b: DotsState, after: DotsState) {
    await this.place(this.specs(after), true, { appear: "pop" });
  }
}

export function Dots3D(p: BoardProps) {
  const n = Math.max(2, p.seats?.length ?? 2);
  const state = useMemo(() => dots.replay(p.moves, n, ""), [p.moves, n]);
  const colours = useMemo(() => colourList(p, n), [p.seats, p.starter, n]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = useRef(p.onMove);
  send.current = p.onMove;
  const [hostRef, scene] = useScene((el) => new DotsScene(el));
  useEffect(() => scene?.setLook(colours), [scene, colours]);
  useEffect(() => scene?.sync(n, "", p.moves), [scene, n, p.moves]);
  useEffect(() => scene?.setTurn({ canPlay: p.canPlay, onPlay: (m) => send.current(m) }), [scene, p.canPlay]);
  if (!state) return null;
  const actions: Action[] = [];
  if (p.canPlay) {
    for (let r = 0; r < DOTS; r++) for (let c = 0; c < BOXES; c++) if (!state.h[r][c]) actions.push({ key: `h${r}${c}`, label: `Line h ${r} ${c}`, run: () => p.onMove(`h:${r}:${c}`), attrs: { "data-dots-line": `h:${r}:${c}` } });
    for (let r = 0; r < BOXES; r++) for (let c = 0; c < DOTS; c++) if (!state.v[r][c]) actions.push({ key: `v${r}${c}`, label: `Line v ${r} ${c}`, run: () => p.onMove(`v:${r}:${c}`), attrs: { "data-dots-line": `v:${r}:${c}` } });
  }
  return (
    <div data-game-board="dots" data-g3-board="dots" className="flex w-full max-w-[600px] flex-col items-center gap-2">
      <BoardBar>
        {state.scores.map((s, q) => (
          <span key={q} className={`inline-flex items-center gap-1.5 ${q === p.turn ? "underline decoration-2 underline-offset-4" : ""}`}>
            <SeatDot color={colours[q]} /> {s}
          </span>
        ))}
      </BoardBar>
      <SceneBox hostRef={hostRef} aspect={1.12} maxH={540} testId="dots" />
      <HiddenActions actions={actions} label="Lines you can draw" />
    </div>
  );
}

// ------------------------------------------------------------ Memory

const MEM = 6;
const MG = 1.18;

function cardBack() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = "#4f46e5";
    roundRect(ctx, 0, 0, w, h, 34);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 6;
    roundRect(ctx, 18, 18, w - 36, h - 36, 22);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    for (let y = 40; y < h - 30; y += 28) for (let x = 40 + ((y / 28) % 2) * 14; x < w - 30; x += 28) ctx.fillRect(x, y, 6, 6);
  });
}
function cardFace(face: string) {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = "#fdfcf8";
    roundRect(ctx, 0, 0, w, h, 34);
    ctx.fill();
    ctx.font = `150px ${EMOJI}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(face, w / 2, h / 2 + 8);
  });
}

class MemoryScene extends BoardScene<MemoryState> {
  private colours: string[] = [];
  private back: THREE.Texture | null = null;
  private faceTex = new Map<string, THREE.Texture>();
  private info: { canPlay: boolean; onPick: (i: number) => void } | null = null;
  private peeking = false;
  constructor(host: HTMLElement) {
    super(host, { fov: 26 });
    this.top = 0.22;
    const span = MEM * MG + 0.6;
    this.stage.scene.add(baseSlab(span, span, this.top, new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.8 })));
    this.root.position.set(-((MEM - 1) * MG) / 2, 0, -((MEM - 1) * MG) / 2);
    this.stage.allowViewDrag("memory");
    this.stage.frame(new THREE.Box3(new THREE.Vector3(-span / 2, 0, -span / 2), new THREE.Vector3(span / 2, 0.4, span / 2)), [0, 2.8, 1], 1.03);
  }
  setLook(colours: string[]) {
    this.colours = colours;
  }
  setTurn(info: { canPlay: boolean; onPick: (i: number) => void }) {
    this.info = info;
    this.refreshHover();
  }
  protected replay(moves: string[]) {
    return memory.replay(moves, this.n, this.seed);
  }
  protected cellPos(i: number) {
    return new THREE.Vector3((i % MEM) * MG, this.top, Math.floor(i / MEM) * MG);
  }
  protected cellAt(p: THREE.Vector3) {
    const c = Math.round(p.x / MG);
    const r = Math.round(p.z / MG);
    return c < 0 || r < 0 || c >= MEM || r >= MEM ? null : r * MEM + c;
  }
  protected clickable(i: number) {
    const s = this.replay(this.shown);
    return !!this.info?.canPlay && !!s && !this.peeking && s.owner[i] < 0 && !s.open.includes(i);
  }
  protected clicked(i: number) {
    this.showHover(null);
    this.info?.onPick(i);
  }
  protected makeHover() {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.06, 1.06), new THREE.MeshBasicMaterial({ color: 0x6366f1, transparent: true, opacity: 0.25, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    return m;
  }
  /** A card: the back faces up; the face (when known) is on the underside, so turning it over shows it. */
  private card(): THREE.Object3D {
    this.back ??= cardBack();
    const g = new THREE.Group();
    const body = mesh(slab(0.96, 0.05, 0.96, 0.024), new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.6 }));
    body.position.y = -0.025;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 0.98), new THREE.MeshStandardMaterial({ map: this.back, roughness: 0.5, alphaTest: 0.5 }));
    back.rotation.x = -Math.PI / 2;
    back.position.y = 0.0265;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 0.98), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, alphaTest: 0.5 }));
    face.rotation.x = Math.PI / 2;
    face.position.y = -0.0265;
    const rim = new THREE.Mesh(new THREE.PlaneGeometry(1.12, 1.12), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }));
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = -0.03;
    const flip = new THREE.Group();
    flip.position.y = 0.03;
    flip.add(body, back, face);
    g.add(flip, rim);
    g.userData = { flip, face, rim, up: false };
    return g;
  }
  /** Turns a card face up (showing `face`) or face down. */
  private setUp(o: THREE.Object3D, up: boolean, face: string | null, owner: number, animate: boolean): Promise<void> | void {
    const u = o.userData as { flip: THREE.Group; face: THREE.Mesh; rim: THREE.Mesh; up: boolean };
    const rim = u.rim.material as THREE.MeshBasicMaterial;
    if (owner >= 0) {
      rim.color.set(this.colours[owner] ?? "#94a3b8");
      rim.opacity = 1;
    } else rim.opacity = 0;
    if (up && face) {
      let t = this.faceTex.get(face);
      if (!t) {
        t = cardFace(face);
        this.faceTex.set(face, t);
      }
      const m = u.face.material as THREE.MeshStandardMaterial;
      if (m.map !== t) {
        m.map = t;
        m.needsUpdate = true;
      }
    }
    if (u.up === up) return;
    u.up = up;
    const to = up ? Math.PI : 0;
    const from = u.flip.rotation.z;
    const clearFace = () => {
      if (!up) {
        // Face down again: the face picture leaves the scene, so nothing hidden is drawn.
        const m = u.face.material as THREE.MeshStandardMaterial;
        m.map = null;
        m.needsUpdate = true;
      }
    };
    if (!animate) {
      u.flip.rotation.z = to;
      clearFace();
      return;
    }
    sfx("card", 0.5);
    return this.stage
      .animate(360, (t) => {
        u.flip.rotation.z = from + (to - from) * t;
        u.flip.position.y = 0.03 + Math.sin(t * Math.PI) * 0.5;
      }, easeInOut)
      .then(clearFace);
  }
  private specs(s: MemoryState, peek: number[] = []): PieceSpec[] {
    return s.faces.map((face, i) => {
      const owner = s.owner[i];
      const up = owner >= 0 || s.open.includes(i) || peek.includes(i);
      return { key: `c${i}`, pos: this.cellPos(i), make: () => this.card(), update: (o: THREE.Object3D, a: boolean) => this.setUp(o, up, up ? face : null, owner, a) };
    });
  }
  protected snap(s: MemoryState) {
    void this.place(this.specs(s), false);
  }
  dispose() {
    for (const t of this.faceTex.values()) t.dispose();
    this.faceTex.clear();
    this.back?.dispose();
    super.dispose();
  }
  protected async animateStep(_b: MemoryState, after: MemoryState) {
    if (after.lastMiss.length === 2) {
      // Both shown for a moment, then back down.
      this.peeking = true;
      await this.place(this.specs(after, after.lastMiss), true);
      await this.stage.wait(1200);
      this.peeking = false;
    }
    await this.place(this.specs(after), true);
    if (after.lastMiss.length === 0 && after.open.length === 0) sfx("score", 0.5);
  }
}

export function Memory3D(p: BoardProps) {
  const n = Math.max(2, p.seats?.length ?? 2);
  const seed = p.seed ?? "";
  const state = useMemo(() => memory.replay(p.moves, n, seed), [p.moves, n, seed]);
  const colours = useMemo(() => colourList(p, n), [p.seats, p.starter, n]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = useRef(p.onMove);
  send.current = p.onMove;
  const [hostRef, scene] = useScene((el) => new MemoryScene(el));
  useEffect(() => scene?.setLook(colours), [scene, colours]);
  useEffect(() => scene?.sync(n, seed, p.moves), [scene, n, seed, p.moves]);
  useEffect(() => scene?.setTurn({ canPlay: p.canPlay, onPick: (i) => send.current(String(i)) }), [scene, p.canPlay]);
  if (!state) return null;
  const actions: Action[] = p.canPlay ? state.faces.flatMap((_f, i): Action[] => (state.owner[i] < 0 && !state.open.includes(i) ? [{ key: String(i), label: `Card ${i + 1}`, run: () => p.onMove(String(i)), attrs: { "data-memory-card": String(i) } }] : [])) : [];
  return (
    <div data-game-board="memory" data-g3-board="memory" className="flex w-full max-w-[600px] flex-col items-center gap-2">
      <BoardBar>
        {state.scores.map((s, q) => (
          <span key={q} className={`inline-flex items-center gap-1.5 ${q === p.turn ? "underline decoration-2 underline-offset-4" : ""}`}>
            <SeatDot color={colours[q]} /> {s}
          </span>
        ))}
        <span className="font-normal text-slate-500">{state.pairsLeft} pairs left</span>
      </BoardBar>
      <SceneBox hostRef={hostRef} aspect={1.12} maxH={540} testId="memory" />
      <HiddenActions actions={actions} label="Cards you can turn" />
    </div>
  );
}

// ------------------------------------------------------------ Minesweeper Versus (and the solo field)

const NUM_COLOURS = ["", "#2563eb", "#047857", "#dc2626", "#3730a3", "#92400e", "#0e7490", "#111827", "#64748b"];
const numberTex = new Map<number, THREE.Texture>();
export function digitTexture(k: number) {
  let t = numberTex.get(k);
  if (!t) {
    t = canvasTexture(128, 128, (ctx, w, h) => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      if (k > 0) {
        ctx.font = `800 84px ${FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = NUM_COLOURS[k];
        ctx.fillText(String(k), w / 2, h / 2 + 4);
      }
    });
    numberTex.set(k, t);
  }
  return t;
}
export function clearDigitTextures() {
  for (const t of numberTex.values()) t.dispose();
  numberTex.clear();
}
onRelease(clearDigitTextures);

/** A sea mine: a dark ball with stubby spikes. */
export function mineMesh(): THREE.Object3D {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.35, metalness: 0.5 });
  g.add(mesh(ballGeometry(0.24, 24), mat));
  for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1], [0.7, 0.7, 0], [-0.7, 0.7, 0], [0, 0.7, 0.7], [0, 0.7, -0.7]]) {
    const s = mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.16, 8), mat);
    const v = new THREE.Vector3(...d).normalize();
    s.position.copy(v.clone().multiplyScalar(0.28));
    s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v);
    g.add(s);
  }
  g.position.y = 0.22;
  const holder = new THREE.Group();
  holder.add(g);
  return holder;
}

class MinesVsScene extends BoardScene<MinesVsState> {
  private colours: string[] = [];
  private info: { canPlay: boolean; onPick: (i: number) => void } | null = null;
  constructor(host: HTMLElement) {
    super(host, { fov: 26 });
    this.top = 0.2;
    const span = MV_SIZE + 0.6;
    this.stage.scene.add(baseSlab(span, span, this.top, new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.7 })));
    this.root.position.set(-(MV_SIZE - 1) / 2, 0, -(MV_SIZE - 1) / 2);
    this.stage.allowViewDrag("minesvs");
    this.stage.frame(new THREE.Box3(new THREE.Vector3(-span / 2, 0, -span / 2), new THREE.Vector3(span / 2, 0.6, span / 2)), [0, 2.8, 1], 1.03);
  }
  setLook(colours: string[]) {
    this.colours = colours;
  }
  setTurn(info: { canPlay: boolean; onPick: (i: number) => void }) {
    this.info = info;
    this.refreshHover();
  }
  protected replay(moves: string[]) {
    return minesVersus.replay(moves, this.n, this.seed);
  }
  protected cellPos(i: number) {
    return new THREE.Vector3(i % MV_SIZE, this.top, Math.floor(i / MV_SIZE));
  }
  protected cellAt(p: THREE.Vector3) {
    const c = Math.round(p.x);
    const r = Math.round(p.z);
    return c < 0 || r < 0 || c >= MV_SIZE || r >= MV_SIZE ? null : r * MV_SIZE + c;
  }
  protected clickable(i: number) {
    const s = this.replay(this.shown);
    return !!this.info?.canPlay && !!s && !s.open[i] && s.safeLeft > 0;
  }
  protected clicked(i: number) {
    this.showHover(null);
    this.info?.onPick(i);
  }
  protected makeHover() {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({ color: 0x6366f1, transparent: true, opacity: 0.35, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.32;
    const g = new THREE.Group();
    g.add(m);
    return g;
  }
  private specs(s: MinesVsState): PieceSpec[] {
    return s.open.map((open, i) => {
      const mine = open && !!s.mines?.[i];
      const by = s.by[i];
      const k = open && !mine && s.mines ? mvCount(s.mines, i) : 0;
      return { key: open ? `o${i}:${mine ? "m" : k}:${by}` : `c${i}`, pos: this.cellPos(i), make: () => (open ? this.openTile(mine, k, by) : this.closedTile()) };
    });
  }
  private closedTile() {
    const g = sharedGeo("mvclosed", () => slab(0.92, 0.3, 0.92, 0.07));
    return mesh(g, new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.45 }));
  }
  private openTile(mine: boolean, k: number, by: number) {
    const g = new THREE.Group();
    const base = mesh(sharedGeo("mvopen", () => slab(0.94, 0.06, 0.94, 0.03)), new THREE.MeshStandardMaterial({ color: mine ? 0xef4444 : tint(this.colours[by] ?? "#94a3b8", 0.72), roughness: 0.6 }));
    g.add(base);
    if (mine) g.add(mineMesh());
    else if (k > 0) {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), new THREE.MeshBasicMaterial({ map: digitTexture(k), transparent: true, opacity: 0.95 }));
      face.rotation.x = -Math.PI / 2;
      face.position.y = 0.062;
      (face.material as THREE.MeshBasicMaterial).alphaTest = 0;
      (face.material as THREE.MeshBasicMaterial).map!.userData.shared = true;
      g.add(face);
    }
    return g;
  }
  protected snap(s: MinesVsState) {
    void this.place(this.specs(s), false);
  }
  protected async animateStep(before: MinesVsState, after: MinesVsState) {
    const boom = after.open.some((o, i) => o && !before.open[i] && after.mines?.[i]);
    await this.place(this.specs(after), true, { appear: "pop", vanish: "sink", sound: null, stagger: 8 });
    sfx(boom ? "boom" : "tap", boom ? 1 : 0.5);
  }
}

export function MinesVersus3D(p: BoardProps) {
  const n = Math.max(2, p.seats?.length ?? 2);
  const seed = p.seed ?? "";
  const state = useMemo(() => minesVersus.replay(p.moves, n, seed), [p.moves, n, seed]);
  const colours = useMemo(() => colourList(p, n), [p.seats, p.starter, n]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = useRef(p.onMove);
  send.current = p.onMove;
  const [hostRef, scene] = useScene((el) => new MinesVsScene(el));
  useEffect(() => scene?.setLook(colours), [scene, colours]);
  useEffect(() => scene?.sync(n, seed, p.moves), [scene, n, seed, p.moves]);
  useEffect(() => scene?.setTurn({ canPlay: p.canPlay, onPick: (i) => send.current(String(i)) }), [scene, p.canPlay]);
  if (!state) return null;
  const actions: Action[] = p.canPlay ? state.open.flatMap((o, i): Action[] => (o ? [] : [{ key: String(i), label: `Square ${i}`, run: () => p.onMove(String(i)), attrs: { "data-minesvs-cell": String(i) } }])) : [];
  return (
    <div data-game-board="minesvs" data-g3-board="minesvs" className="flex w-full max-w-[620px] flex-col items-center gap-2">
      <BoardBar>
        {state.scores.map((s, q) => (
          <span key={q} className={`inline-flex items-center gap-1.5 ${q === p.turn ? "underline decoration-2 underline-offset-4" : ""}`}>
            <SeatDot color={colours[q]} /> {s}
          </span>
        ))}
        <span className="font-normal text-slate-500">{state.safeLeft} safe squares left</span>
      </BoardBar>
      <SceneBox hostRef={hostRef} aspect={1.12} maxH={560} testId="minesvs" />
      <HiddenActions actions={actions} label="Squares you can open" />
    </div>
  );
}

// ------------------------------------------------------------ Mahjong Duels

const TW = 0.92;
const TD = 1.2;
const mjTex = new Map<string, THREE.Texture>();
onRelease(() => {
  for (const t of mjTex.values()) t.dispose();
  mjTex.clear();
});
function mjFace(glyph: string) {
  let t = mjTex.get(glyph);
  if (!t) {
    t = canvasTexture(192, 256, (ctx, w, h) => {
      ctx.fillStyle = "#fbf7ec";
      ctx.fillRect(0, 0, w, h);
      ctx.font = `200px ${EMOJI}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#14532d";
      ctx.fillText(glyph, w / 2, h / 2 + 10);
    });
    mjTex.set(glyph, t);
  }
  return t;
}

class MahjongScene extends BoardScene<MahjongState> {
  private first: number | null = null;
  private info: { canPlay: boolean; onPair: (a: number, b: number) => void } | null = null;
  constructor(host: HTMLElement) {
    super(host, { fov: 26 });
    this.top = 0.16;
    const w = MJ_COLS * (TW + 0.08) + 0.8;
    const d = MJ_ROWS * (TD + 0.08) + 0.8;
    this.stage.scene.add(baseSlab(w, d, this.top, new THREE.MeshStandardMaterial({ color: 0x14532d, roughness: 0.9 })));
    this.root.position.set(-((MJ_COLS - 1) * (TW + 0.08)) / 2, 0, -((MJ_ROWS - 1) * (TD + 0.08)) / 2);
    this.stage.allowViewDrag("mahjong");
    this.stage.frame(new THREE.Box3(new THREE.Vector3(-w / 2, 0, -d / 2), new THREE.Vector3(w / 2, 0.8, d / 2)), [0, 2.6, 1], 1.03);
  }
  setLook(_colours: string[]) {
    /* the tiles are the same for everyone */
  }
  setTurn(info: { canPlay: boolean; onPair: (a: number, b: number) => void }) {
    this.info = info;
    this.select(null);
    this.refreshHover();
  }
  protected replay(moves: string[]) {
    return mahjong.replay(moves, this.n, this.seed);
  }
  protected cellPos(i: number) {
    return new THREE.Vector3((i % MJ_COLS) * (TW + 0.08), this.top, Math.floor(i / MJ_COLS) * (TD + 0.08));
  }
  protected cellAt(p: THREE.Vector3) {
    const c = Math.round(p.x / (TW + 0.08));
    const r = Math.round(p.z / (TD + 0.08));
    return c < 0 || r < 0 || c >= MJ_COLS || r >= MJ_ROWS ? null : r * MJ_COLS + c;
  }
  protected clickable(i: number) {
    const s = this.replay(this.shown);
    return !!this.info?.canPlay && !!s && mjFree(s.tiles, i);
  }
  protected clicked(i: number) {
    const s = this.replay(this.shown);
    if (!s) return;
    if (this.first === null || this.first === i) {
      this.select(this.first === i ? null : i);
      return;
    }
    if (s.tiles[this.first] === s.tiles[i]) {
      const a = this.first;
      this.select(null);
      this.showHover(null);
      this.info?.onPair(a, i);
    } else this.select(i);
  }
  private select(i: number | null) {
    const lift = (k: number | null, y: number) => {
      if (k === null) return;
      for (const [key, o] of this.pieces) if (key.startsWith(`m${k}:`)) o.position.y = y;
    };
    lift(this.first, this.top);
    this.first = i;
    lift(i, this.top + 0.3);
    if (i !== null) sfx("tap", 0.4);
    this.stage.invalidate();
  }
  protected makeHover() {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(TW + 0.1, TD + 0.1), new THREE.MeshBasicMaterial({ color: 0x6366f1, transparent: true, opacity: 0.35, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    return m;
  }
  private tile(glyph: string, free: boolean) {
    const g = new THREE.Group();
    const body = mesh(sharedGeo("mjtile", () => slab(TW, 0.5, TD, 0.1)), new THREE.MeshPhysicalMaterial({ color: free ? 0xfbf7ec : 0xd9d2c2, roughness: 0.4, clearcoat: 0.5 }));
    const back = mesh(sharedGeo("mjback", () => slab(TW, 0.18, TD, 0.1)), new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.5 }));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(TW * 0.86, TD * 0.86), new THREE.MeshStandardMaterial({ map: mjFace(glyph), roughness: 0.5, color: free ? 0xffffff : 0xcfc8b8 }));
    (face.material as THREE.MeshStandardMaterial).map!.userData.shared = true;
    face.rotation.x = -Math.PI / 2;
    face.position.y = 0.502;
    g.add(back, body, face);
    body.position.y = 0.0;
    return g;
  }
  private specs(s: MahjongState): PieceSpec[] {
    return s.tiles.flatMap((t, i) => {
      if (t === null) return [];
      const free = mjFree(s.tiles, i);
      return [{ key: `m${i}:${t}:${free ? 1 : 0}`, pos: this.cellPos(i), make: () => this.tile(t, free) }];
    });
  }
  protected snap(s: MahjongState) {
    void this.place(this.specs(s), false);
  }
  protected async animateStep(_b: MahjongState, after: MahjongState) {
    this.first = null;
    await this.place(this.specs(after), true, { appear: "none", vanish: "lift", sound: null });
    sfx("score", 0.5);
  }
}

export function Mahjong3D(p: BoardProps) {
  const n = Math.max(2, p.seats?.length ?? 2);
  const seed = p.seed ?? "";
  const state = useMemo(() => mahjong.replay(p.moves, n, seed), [p.moves, n, seed]);
  const colours = useMemo(() => colourList(p, n), [p.seats, p.starter, n]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = useRef(p.onMove);
  send.current = p.onMove;
  const [hostRef, scene] = useScene((el) => new MahjongScene(el));
  useEffect(() => scene?.setLook(colours), [scene, colours]);
  useEffect(() => scene?.sync(n, seed, p.moves), [scene, n, seed, p.moves]);
  useEffect(() => scene?.setTurn({ canPlay: p.canPlay, onPair: (a, b) => send.current(`${a},${b}`) }), [scene, p.canPlay]);
  if (!state) return null;
  const pairs = mjPairs(state.tiles);
  const actions: Action[] = p.canPlay ? pairs.map(([a, b]) => ({ key: `${a},${b}`, label: `Take ${state.tiles[a]} pair`, run: () => p.onMove(`${a},${b}`), attrs: { "data-mahjong-pair": `${a},${b}` } })) : [];
  return (
    <div data-game-board="mahjong" data-g3-board="mahjong" className="flex w-full max-w-[680px] flex-col items-center gap-2">
      <BoardBar>
        {state.scores.map((s, q) => (
          <span key={q} className={`inline-flex items-center gap-1.5 ${q === p.turn ? "underline decoration-2 underline-offset-4" : ""}`}>
            <SeatDot color={colours[q]} /> {s}
          </span>
        ))}
        <span className="font-normal text-slate-500">{pairs.length} pairs free</span>
        {p.canPlay && pairs.length === 0 && (
          <button type="button" data-mahjong-pass onClick={() => p.onMove("p")} className="rounded-full bg-amber-500 px-4 py-1.5 text-white">
            No pair left — pass
          </button>
        )}
      </BoardBar>
      <SceneBox hostRef={hostRef} aspect={1.18} maxH={560} testId="mahjong" />
      <HiddenActions actions={actions} label="Pairs you can take" />
    </div>
  );
}

// ------------------------------------------------------------ Paint Fight

const PG = 0.62;

class PaintScene extends BoardScene<PaintState> {
  private colours: string[] = [];
  private info: { canPlay: boolean; seat: number; onPaint: (i: number) => void } | null = null;
  constructor(host: HTMLElement) {
    super(host, { fov: 26 });
    this.top = 0.16;
    const span = PAINT * PG + 0.5;
    this.stage.scene.add(baseSlab(span, span, this.top, new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.8 })));
    this.root.position.set(-((PAINT - 1) * PG) / 2, 0, -((PAINT - 1) * PG) / 2);
    // Painting is a quick tap: the press itself paints (no waiting for the release).
    this.stage.onTap = null;
    this.stage.onPointerDown = (e) => {
      if (e.button !== 0) return;
      const c = this.cellUnderPointer();
      if (c !== null && this.clickable(c)) this.info?.onPaint(c);
    };
    this.stage.frame(new THREE.Box3(new THREE.Vector3(-span / 2, 0, -span / 2), new THREE.Vector3(span / 2, 0.4, span / 2)), [0, 3.4, 1], 1.03);
  }
  setLook(colours: string[]) {
    this.colours = colours;
  }
  setTurn(info: { canPlay: boolean; seat: number; onPaint: (i: number) => void }) {
    this.info = info;
    this.refreshHover();
  }
  protected replay(moves: string[]) {
    return paintFight.replay(moves, this.n, this.seed);
  }
  protected cellPos(i: number) {
    return new THREE.Vector3((i % PAINT) * PG, this.top, Math.floor(i / PAINT) * PG);
  }
  protected cellAt(p: THREE.Vector3) {
    const c = Math.round(p.x / PG);
    const r = Math.round(p.z / PG);
    return c < 0 || r < 0 || c >= PAINT || r >= PAINT ? null : r * PAINT + c;
  }
  protected clickable(i: number) {
    const s = this.replay(this.shown);
    if (!s || !this.info?.canPlay || !s.open) return false;
    return paintGrid(s.answers)[i] !== this.info.seat;
  }
  protected makeHover() {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(PG * 0.9, PG * 0.9), new THREE.MeshBasicMaterial({ color: 0x0f172a, transparent: true, opacity: 0.15, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.14;
    const g = new THREE.Group();
    g.add(m);
    return g;
  }
  private specs(s: PaintState): PieceSpec[] {
    const grid = paintGrid(s.answers);
    return grid.map((o, i) => ({
      key: `p${i}:${o}`,
      pos: this.cellPos(i),
      make: () => mesh(sharedGeo("painttile", () => slab(PG * 0.92, 0.12, PG * 0.92, 0.04)), new THREE.MeshStandardMaterial({ color: o >= 0 ? (this.colours[o] ?? "#94a3b8") : "#f1f5f9", roughness: 0.55 })),
    }));
  }
  protected snap(s: PaintState) {
    void this.place(this.specs(s), false);
  }
  protected async animateStep(_b: PaintState, after: PaintState) {
    await this.place(this.specs(after), true, { appear: "pop", vanish: "sink", sound: "pop" });
  }
}

export function PaintFight3D(p: BoardProps) {
  const n = Math.max(2, p.seats?.length ?? 2);
  const seed = p.seed ?? "";
  const state = useMemo(() => paintFight.replay(p.moves, n, seed), [p.moves, n, seed]);
  const colours = useMemo(() => colourList(p, n), [p.seats, p.starter, n]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = useRef(p.onMove);
  send.current = p.onMove;
  const [hostRef, scene] = useScene((el) => new PaintScene(el));
  useEffect(() => scene?.setLook(colours), [scene, colours]);
  useEffect(() => scene?.sync(n, seed, p.moves), [scene, n, seed, p.moves]);
  useEffect(() => scene?.setTurn({ canPlay: p.canPlay && !!state?.open, seat: p.seat, onPaint: (i) => send.current(`${p.seat}@a:${i}`) }), [scene, p.canPlay, state?.open, p.seat]);
  if (!state) return null;
  const grid = paintGrid(state.answers);
  const actions: Action[] = p.canPlay && state.open ? grid.flatMap((o, i): Action[] => (o === p.seat ? [] : [{ key: String(i), label: `Paint ${i}`, run: () => p.onMove(`${p.seat}@a:${i}`), attrs: { "data-paint-cell": String(i) } }])) : [];
  return (
    <PartyShell state={state} rounds={3} seconds={30} host={!!p.host} seats={p.seats} starter={p.starter ?? 0} n={n} onMove={p.onMove} testId="paintfight">
      <div className="flex w-full flex-col items-center gap-1" data-g3-board="paintfight">
        <SceneBox hostRef={hostRef} aspect={1.25} minH={300} maxH={460} testId="paintfight" />
        <HiddenActions actions={actions.slice(0, 40)} label="Squares to paint" />
        {!state.open && <div className="text-[12px] text-slate-500">Thirty seconds a round: tap as many squares as you can. The last tap on a square keeps it.</div>}
      </div>
    </PartyShell>
  );
}

