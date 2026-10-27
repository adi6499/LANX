// LANX 2.16.0: the stone and disc games in 3D — Go and Gomoku on a wooden
// goban with slate and shell stones, Tic-tac-toe with real X and O pieces,
// Hex on a field of hexagonal tiles, and Reversi with discs that flip over.
// Same moves, same rules (lib/gameRules, lib/games); only the picture is new.

import * as THREE from "three";
import { useEffect, useMemo, useRef } from "react";
import type { BoardProps } from "../../boardProps";
import { GO, go, goScore, type GoState } from "../../../../lib/games/go.ts";
import { GOMOKU, gomoku, type GomokuState } from "../../../../lib/games/gomoku.ts";
import { HEX, hex, type HexState } from "../../../../lib/games/hex.ts";
import { reversiBoard, reversiCount, reversiFlips, reversiLegal, tttBoard, tttLine, type RCell } from "../../../../lib/gameRules";
import { sfx } from "../../../../lib/gameSounds";
import { BoardScene, type PieceSpec } from "../boardScene";
import { boardSlab, canvasTexture, markerDot, mesh, sharedGeo, slab, stoneGeometry, wood } from "../kit";
import { SceneBox, useScene } from "../Board3D";
import { BoardBar, HiddenActions, SeatDot, quiet3, type Action } from "../ui";
import { easeInOut } from "../stage";

// ------------------------------------------------------------ shared bits

const stoneMat = (who: number) =>
  who === 0
    ? new THREE.MeshPhysicalMaterial({ color: 0x15171c, roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.2 })
    : new THREE.MeshPhysicalMaterial({ color: 0xf3efe6, roughness: 0.36, clearcoat: 0.6, clearcoatRoughness: 0.25 });

function stone(who: number, size = 0.94): THREE.Mesh {
  const m = mesh(stoneGeometry(), stoneMat(who));
  m.scale.setScalar(size);
  return m;
}

/** The last stone played gets a small ring on top. */
function lastMark(who: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.11, 0.17, 28), new THREE.MeshBasicMaterial({ color: who === 0 ? 0xf8fafc : 0x0f172a, transparent: true, opacity: 0.85, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 3;
  return m;
}

function ghostStone(who: number): THREE.Mesh {
  const m = new THREE.Mesh(stoneGeometry(), new THREE.MeshStandardMaterial({ color: who === 0 ? 0x15171c : 0xf3efe6, transparent: true, opacity: 0.45, depthWrite: false }));
  m.scale.setScalar(0.9);
  return m;
}

/** A goban: N lines each way, one unit apart, with star points. */
function gobanTexture(n: number, stars: number[], renderer: THREE.WebGLRenderer, margin: number) {
  const px = 1024;
  const span = n - 1 + margin * 2;
  const k = px / span;
  return canvasTexture(
    px,
    px,
    (ctx) => {
      ctx.fillStyle = "#e3bd7f";
      ctx.fillRect(0, 0, px, px);
      ctx.strokeStyle = "rgba(92,58,22,0.85)";
      ctx.lineWidth = Math.max(1.5, k * 0.035);
      for (let i = 0; i < n; i++) {
        const v = (margin + i) * k;
        ctx.beginPath();
        ctx.moveTo(margin * k, v);
        ctx.lineTo((margin + n - 1) * k, v);
        ctx.moveTo(v, margin * k);
        ctx.lineTo(v, (margin + n - 1) * k);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(92,58,22,0.9)";
      for (const s of stars) {
        ctx.beginPath();
        ctx.arc((margin + (s % n)) * k, (margin + Math.floor(s / n)) * k, k * 0.09, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    renderer,
  );
}

// ------------------------------------------------------------ Go and Gomoku

type StoneState = { cells: (number | null)[]; last: number; turn: number };

interface StoneTurn {
  canPlay: boolean;
  turn: number;
  blocked: number;
  onPlay: (i: number) => void;
}

class GobanScene<S extends StoneState> extends BoardScene<S> {
  private info: StoneTurn | null = null;
  private ghosts: THREE.Mesh[] = [];
  private winBar: THREE.Mesh | null = null;
  constructor(
    host: HTMLElement,
    private size: number,
    stars: number[],
    private rules: (moves: string[]) => S | null,
    private wins?: (s: S) => number[] | null,
  ) {
    super(host, { fov: 26 });
    const margin = 0.8;
    const span = size - 1 + margin * 2;
    this.top = 0.5;
    const board = boardSlab(span, span, this.top, gobanTexture(size, stars, this.stage.renderer, margin), wood("light", 2), 0.5);
    this.stage.scene.add(board);
    this.root.position.set(-(size - 1) / 2, 0, -(size - 1) / 2);
    this.stage.allowViewDrag(`goban${size}`);
    this.stage.frame(new THREE.Box3(new THREE.Vector3(-span / 2, 0, -span / 2), new THREE.Vector3(span / 2, 0.8, span / 2)), [0, 2.8, 1], 1.03);
  }
  setTurn(info: StoneTurn) {
    this.info = info;
    this.refreshHover();
  }
  protected replay(moves: string[]) {
    return this.rules(moves);
  }
  protected cellPos(i: number) {
    return new THREE.Vector3(i % this.size, this.top, Math.floor(i / this.size));
  }
  protected cellAt(p: THREE.Vector3) {
    const c = Math.round(p.x);
    const r = Math.round(p.z);
    if (c < 0 || r < 0 || c >= this.size || r >= this.size) return null;
    if (Math.hypot(p.x - c, p.z - r) > 0.48) return null;
    return r * this.size + c;
  }
  protected clickable(i: number) {
    const s = this.replay(this.shown);
    return !!this.info?.canPlay && !!s && s.cells[i] === null && i !== this.info.blocked;
  }
  protected clicked(i: number) {
    this.showHover(null);
    this.info?.onPlay(i);
  }
  protected makeHover() {
    this.ghosts = [ghostStone(0), ghostStone(1)];
    const g = new THREE.Group();
    g.add(...this.ghosts);
    return g;
  }
  protected showHover(c: number | null) {
    super.showHover(c);
    const who = this.info?.turn ?? 0;
    this.ghosts.forEach((m, k) => (m.visible = k === who % 2));
  }
  private specs(s: S): PieceSpec[] {
    const out: PieceSpec[] = [];
    s.cells.forEach((who, i) => {
      if (who === null) return;
      out.push({ key: `${i}:${who}`, pos: this.cellPos(i), make: () => stone(who) });
    });
    if (s.last >= 0 && s.cells[s.last] !== null) {
      const p = this.cellPos(s.last);
      p.y = this.top + 0.43;
      out.push({ key: `last:${s.last}`, pos: p, make: () => lastMark(s.cells[s.last]!) });
    }
    return out;
  }
  protected snap(s: S) {
    void this.place(this.specs(s), false);
    this.showWin(s, false);
  }
  protected async animateStep(before: S, after: S) {
    const taken = before.cells.filter((c, i) => c !== null && after.cells[i] === null).length;
    await this.place(this.specs(after), true, { appear: "drop", vanish: "lift", sound: "place" });
    if (taken) sfx("capture");
    this.showWin(after, true);
  }
  private showWin(s: S, animate: boolean) {
    const cells = this.wins?.(s) ?? null;
    if (this.winBar) {
      this.root.remove(this.winBar);
      this.winBar.geometry.dispose();
      this.winBar = null;
    }
    if (!cells || cells.length < 2) return;
    const a = this.cellPos(cells[0]);
    const b = this.cellPos(cells[cells.length - 1]);
    a.y = b.y = this.top + 0.5;
    const len = a.distanceTo(b) + 0.9;
    const bar = mesh(new THREE.CylinderGeometry(0.07, 0.07, len, 16), new THREE.MeshStandardMaterial({ color: 0x10b981, roughness: 0.4 }), false);
    bar.position.copy(a).add(b).multiplyScalar(0.5);
    bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    this.root.add(bar);
    this.winBar = bar;
    if (animate) void this.stage.animate(400, (t) => bar.scale.set(1, Math.max(0.001, t), 1), easeInOut);
  }
}

function gomokuFive(s: GomokuState): number[] | null {
  if (s.winner === null || s.last < 0) return null;
  const who = s.cells[s.last];
  const r0 = Math.floor(s.last / GOMOKU);
  const c0 = s.last % GOMOKU;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const line = [s.last];
    for (const sg of [1, -1]) {
      let r = r0 + dr * sg;
      let c = c0 + dc * sg;
      while (r >= 0 && r < GOMOKU && c >= 0 && c < GOMOKU && s.cells[r * GOMOKU + c] === who) {
        if (sg > 0) line.push(r * GOMOKU + c);
        else line.unshift(r * GOMOKU + c);
        r += dr * sg;
        c += dc * sg;
      }
    }
    if (line.length >= 5) return line;
  }
  return null;
}

function useStoneBoard<S extends StoneState>(make: (el: HTMLDivElement) => GobanScene<S>, p: BoardProps, state: S | null, blocked: number) {
  const move = useRef(p.onMove);
  move.current = p.onMove;
  const [hostRef, scene] = useScene(make);
  useEffect(() => scene?.sync(2, "", p.moves), [scene, p.moves]);
  useEffect(() => scene?.setTurn({ canPlay: p.canPlay, turn: state?.turn ?? 0, blocked, onPlay: (i) => move.current(String(i)) }), [scene, p.canPlay, state, blocked]);
  return hostRef;
}

const emptyActions = (cells: (number | null)[], canPlay: boolean, onMove: (m: string) => void, attr: string, skip = -1): Action[] =>
  canPlay ? cells.flatMap((c, i): Action[] => (c === null && i !== skip ? [{ key: String(i), label: `Play point ${i}`, run: () => onMove(String(i)), attrs: { [attr]: String(i) } }] : [])) : [];

export function Go3D(p: BoardProps) {
  const state = useMemo(() => go.replay(p.moves, 2, ""), [p.moves]);
  const hostRef = useStoneBoard((el) => new GobanScene<GoState>(el, GO, [20, 24, 40, 56, 60], (m) => go.replay(m, 2, "")), p, state, state?.ko ?? -1);
  if (!state) return null;
  const [b, w] = goScore(state.cells);
  return (
    <div data-game-board="go" data-g3-board="go" className="flex w-full max-w-[640px] flex-col items-center gap-2">
      <BoardBar>
        <span className="inline-flex items-center gap-1.5" data-go-score>
          <SeatDot color="#15171c" /> {b} <span className="font-normal text-slate-400">(+{state.captured[0]} taken)</span>
          <span className="ml-3" />
          <SeatDot color="#f3efe6" /> {w + 6.5} <span className="font-normal text-slate-400">(+{state.captured[1]} taken)</span>
        </span>
        <button type="button" data-go-pass disabled={!p.canPlay} onClick={() => p.onMove("p")} className={quiet3}>
          Pass{state.passes === 1 ? " (a second pass ends it)" : ""}
        </button>
      </BoardBar>
      <SceneBox hostRef={hostRef} aspect={1.08} maxH={600} testId="go" />
      <HiddenActions actions={emptyActions(state.cells, p.canPlay, p.onMove, "data-go-cell", state.ko)} label="Points you can play" />
    </div>
  );
}

export function Gomoku3D(p: BoardProps) {
  const state = useMemo(() => gomoku.replay(p.moves, 2, ""), [p.moves]);
  const hostRef = useStoneBoard((el) => new GobanScene<GomokuState>(el, GOMOKU, [48, 56, 112, 168, 176], (m) => gomoku.replay(m, 2, ""), gomokuFive), p, state, -1);
  if (!state) return null;
  return (
    <div data-game-board="gomoku" data-g3-board="gomoku" className="flex w-full max-w-[640px] flex-col items-center gap-2">
      <BoardBar>
        <span className="inline-flex items-center gap-1.5">
          <SeatDot color={state.turn === 0 ? "#15171c" : "#f3efe6"} /> {state.winner !== null ? "Five in a row!" : `${state.turn === 0 ? "Black" : "White"} to play`}
        </span>
      </BoardBar>
      <SceneBox hostRef={hostRef} aspect={1.08} maxH={620} testId="gomoku" />
      <HiddenActions actions={emptyActions(state.cells, p.canPlay, p.onMove, "data-gomoku-cell")} label="Points you can play" />
    </div>
  );
}

// ------------------------------------------------------------ Tic-tac-toe

const TTT = 1.25;

class TttScene extends BoardScene<{ b: (0 | 1 | null)[]; line: number[] | null }> {
  private canPlay = false;
  private onPlay: ((i: number) => void) | null = null;
  private bar: THREE.Mesh | null = null;
  constructor(host: HTMLElement) {
    super(host, { fov: 28 });
    this.top = 0.32;
    const tray = mesh(slab(TTT * 3 + 0.5, this.top, TTT * 3 + 0.5, 0.12), wood("light", 1));
    this.stage.scene.add(tray);
    const groove = wood("walnut", 1);
    for (const k of [-0.5, 0.5]) {
      const a = mesh(slab(0.08, 0.06, TTT * 3 + 0.2, 0.03), groove);
      a.position.set(k * TTT, this.top, 0);
      const b = mesh(slab(TTT * 3 + 0.2, 0.06, 0.08, 0.03), groove);
      b.position.set(0, this.top, k * TTT);
      this.stage.scene.add(a, b);
    }
    this.stage.allowViewDrag("ttt");
    this.stage.frame(new THREE.Box3(new THREE.Vector3(-2.2, 0, -2.2), new THREE.Vector3(2.2, 0.7, 2.2)), [0, 2.4, 1], 1.04);
  }
  setTurn(canPlay: boolean, onPlay: (i: number) => void) {
    this.canPlay = canPlay;
    this.onPlay = onPlay;
    this.refreshHover();
  }
  protected replay(moves: string[]) {
    const b = tttBoard(moves);
    return { b, line: tttLine(b) };
  }
  protected cellPos(i: number) {
    return new THREE.Vector3(((i % 3) - 1) * TTT, this.top, (Math.floor(i / 3) - 1) * TTT);
  }
  protected cellAt(p: THREE.Vector3) {
    const c = Math.floor(p.x / TTT + 1.5);
    const r = Math.floor(p.z / TTT + 1.5);
    return c < 0 || c > 2 || r < 0 || r > 2 ? null : r * 3 + c;
  }
  protected clickable(i: number) {
    const s = this.replay(this.shown);
    return this.canPlay && s.b[i] === null && !s.line;
  }
  protected clicked(i: number) {
    this.showHover(null);
    this.onPlay?.(i);
  }
  protected makeHover() {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(TTT * 0.86, TTT * 0.86), new THREE.MeshBasicMaterial({ color: 0x6366f1, transparent: true, opacity: 0.16, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    return m;
  }
  private piece(who: 0 | 1): THREE.Object3D {
    if (who === 0) {
      const g = new THREE.Group();
      const mat = new THREE.MeshPhysicalMaterial({ color: 0x0ea5e9, roughness: 0.3, clearcoat: 0.6 });
      for (const a of [Math.PI / 4, -Math.PI / 4]) {
        const bar = mesh(slab(0.95, 0.2, 0.2, 0.08), mat);
        bar.rotation.y = a;
        g.add(bar);
      }
      return g;
    }
    const o = mesh(new THREE.TorusGeometry(0.33, 0.1, 18, 48), new THREE.MeshPhysicalMaterial({ color: 0xf43f5e, roughness: 0.3, clearcoat: 0.6 }));
    o.rotation.x = -Math.PI / 2;
    const g = new THREE.Group();
    o.position.y = 0.1;
    g.add(o);
    return g;
  }
  private specs(s: { b: (0 | 1 | null)[] }): PieceSpec[] {
    return s.b.flatMap((who, i) => (who === null ? [] : [{ key: `${i}:${who}`, pos: this.cellPos(i), make: () => this.piece(who) }]));
  }
  protected snap(s: { b: (0 | 1 | null)[]; line: number[] | null }) {
    void this.place(this.specs(s), false);
    this.showLine(s.line, false);
  }
  protected async animateStep(_a: unknown, after: { b: (0 | 1 | null)[]; line: number[] | null }) {
    await this.place(this.specs(after), true, { appear: "drop" });
    this.showLine(after.line, true);
  }
  private showLine(line: number[] | null, animate: boolean) {
    if (this.bar) {
      this.stage.scene.remove(this.bar);
      this.bar.geometry.dispose();
      this.bar = null;
    }
    if (!line) return;
    const a = this.cellPos(line[0]);
    const b = this.cellPos(line[2]);
    a.y = b.y = this.top + 0.32;
    const bar = mesh(new THREE.CylinderGeometry(0.06, 0.06, a.distanceTo(b) + 0.8, 16), new THREE.MeshStandardMaterial({ color: 0x10b981, roughness: 0.4 }), false);
    bar.position.copy(a).add(b).multiplyScalar(0.5);
    bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    this.stage.scene.add(bar);
    this.bar = bar;
    if (animate) void this.stage.animate(380, (t) => bar.scale.set(1, Math.max(0.001, t), 1));
  }
}

export function TicTacToe3D({ moves, canPlay, onMove }: BoardProps) {
  const b = useMemo(() => tttBoard(moves), [moves]);
  const line = useMemo(() => tttLine(b), [b]);
  const move = useRef(onMove);
  move.current = onMove;
  const [hostRef, scene] = useScene((el) => new TttScene(el));
  useEffect(() => scene?.sync(2, "", moves), [scene, moves]);
  useEffect(() => scene?.setTurn(canPlay, (i) => move.current(String(i))), [scene, canPlay]);
  const actions: Action[] = canPlay && !line ? b.flatMap((c, i): Action[] => (c === null ? [{ key: String(i), label: `Square ${i + 1}`, run: () => onMove(String(i)), attrs: { "data-game-cell": String(i) } }] : [])) : [];
  return (
    <div data-game-board="tictactoe" data-g3-board="tictactoe" className="flex w-full max-w-[520px] flex-col items-center gap-2">
      <SceneBox hostRef={hostRef} aspect={1.15} maxH={480} testId="tictactoe" />
      <HiddenActions actions={actions} label="Free squares" />
    </div>
  );
}

// ------------------------------------------------------------ Hex

const HEX_R = 0.56;
const ROW = Math.sqrt(3) / 2;

class HexScene extends BoardScene<HexState> {
  private info: { canPlay: boolean; turn: number; onPlay: (i: number) => void } | null = null;
  private colours: [string, string] = ["#f43f5e", "#0ea5e9"];
  constructor(host: HTMLElement) {
    super(host, { fov: 26 });
    this.top = 0.32;
    const w = HEX - 1 + (HEX - 1) * 0.5;
    const d = (HEX - 1) * ROW;
    this.root.position.set(-w / 2, 0, -d / 2);
    // The tiles.
    const tileGeo = sharedGeo("hextile", () => {
      const g = new THREE.CylinderGeometry(HEX_R * 0.95, HEX_R, 0.2, 6);
      g.translate(0, 0.1, 0);
      return g;
    });
    const tileMat = new THREE.MeshStandardMaterial({ color: 0xe9e4da, roughness: 0.7 });
    for (let i = 0; i < HEX * HEX; i++) {
      const t = mesh(tileGeo, tileMat);
      t.position.copy(this.cellPos(i)).setY(this.top - 0.2);
      this.root.add(t);
    }
    // The base under them and the coloured edges.
    // A base the shape of the board (a rhombus), with a margin for the coloured edges.
    const m = 1.15;
    const corners = [this.cellPos(0), this.cellPos(HEX - 1), this.cellPos(HEX * HEX - 1), this.cellPos((HEX - 1) * HEX)];
    const centre = corners.reduce((a, b) => a.clone().add(b)).multiplyScalar(0.25);
    const shape = new THREE.Shape(corners.map((c) => {
      const v = c.clone().sub(centre);
      return new THREE.Vector2(c.x + Math.sign(v.x) * m * 1.15, -(c.z + Math.sign(v.z) * m));
    }));
    const baseGeo = new THREE.ExtrudeGeometry(shape, { depth: this.top - 0.2, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.06, bevelSegments: 3 });
    baseGeo.rotateX(-Math.PI / 2);
    const base = mesh(baseGeo, wood("walnut", 2));
    this.root.add(base);
    this.stage.allowViewDrag("hex");
    this.stage.frame(new THREE.Box3(new THREE.Vector3(-w / 2 - 1.4, 0, -d / 2 - 1.1), new THREE.Vector3(w / 2 + 1.4, 0.6, d / 2 + 1.1)), [0, 2.8, 1], 1.03);
  }
  private edges: THREE.Object3D[] = [];
  setColours(c: [string, string]) {
    this.colours = c;
    for (const e of this.edges) {
      this.root.remove(e);
      (e as THREE.Mesh).geometry.dispose();
    }
    this.edges = [];
    const bar = (a: THREE.Vector3, b: THREE.Vector3, colour: string) => {
      const len = a.distanceTo(b);
      const m = mesh(slab(len, 0.08, 0.18, 0.04), new THREE.MeshStandardMaterial({ color: colour, roughness: 0.5 }));
      m.position.copy(a).add(b).multiplyScalar(0.5).setY(this.top - 0.2);
      m.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
      this.root.add(m);
      this.edges.push(m);
    };
    const off = 0.75;
    const tl = this.cellPos(0);
    const tr = this.cellPos(HEX - 1);
    const bl = this.cellPos((HEX - 1) * HEX);
    const br = this.cellPos(HEX * HEX - 1);
    // Blue: top and bottom rows; red: left and right columns.
    bar(tl.clone().add(new THREE.Vector3(0, 0, -off)), tr.clone().add(new THREE.Vector3(0, 0, -off)), c[1]);
    bar(bl.clone().add(new THREE.Vector3(0, 0, off)), br.clone().add(new THREE.Vector3(0, 0, off)), c[1]);
    bar(tl.clone().add(new THREE.Vector3(-off, 0, 0)), bl.clone().add(new THREE.Vector3(-off, 0, 0)), c[0]);
    bar(tr.clone().add(new THREE.Vector3(off, 0, 0)), br.clone().add(new THREE.Vector3(off, 0, 0)), c[0]);
    this.stage.invalidate();
  }
  setTurn(info: { canPlay: boolean; turn: number; onPlay: (i: number) => void }) {
    this.info = info;
    this.refreshHover();
  }
  protected replay(moves: string[]) {
    return hex.replay(moves, 2, "");
  }
  protected cellPos(i: number) {
    const r = Math.floor(i / HEX);
    const c = i % HEX;
    return new THREE.Vector3(c + r * 0.5, this.top, r * ROW);
  }
  protected cellAt(p: THREE.Vector3) {
    let best: number | null = null;
    let bd = HEX_R * HEX_R;
    for (let i = 0; i < HEX * HEX; i++) {
      const q = this.cellPos(i);
      const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }
  protected clickable(i: number) {
    const s = this.replay(this.shown);
    return !!this.info?.canPlay && !!s && s.cells[i] === null && s.winner === null;
  }
  protected clicked(i: number) {
    this.showHover(null);
    this.info?.onPlay(i);
  }
  protected makeHover() {
    const m = new THREE.Mesh(new THREE.CircleGeometry(HEX_R * 0.9, 6), new THREE.MeshBasicMaterial({ color: 0x6366f1, transparent: true, opacity: 0.3, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.PI / 2;
    return m;
  }
  private cap(who: number): THREE.Mesh {
    const g = sharedGeo("hexcap", () => {
      const geo = new THREE.CylinderGeometry(HEX_R * 0.82, HEX_R * 0.86, 0.12, 6);
      geo.translate(0, 0.06, 0);
      return geo;
    });
    return mesh(g, new THREE.MeshPhysicalMaterial({ color: this.colours[who], roughness: 0.35, clearcoat: 0.5 }));
  }
  private specs(s: HexState): PieceSpec[] {
    const out: PieceSpec[] = [];
    s.cells.forEach((who, i) => {
      if (who !== null) out.push({ key: `${i}:${who}`, pos: this.cellPos(i), make: () => this.cap(who) });
    });
    if (s.last >= 0) {
      const p = this.cellPos(s.last);
      p.y = this.top + 0.125;
      out.push({ key: `last:${s.last}`, pos: p, make: () => lastMark(1) });
    }
    return out;
  }
  protected snap(s: HexState) {
    void this.place(this.specs(s), false);
  }
  protected async animateStep(_a: HexState, after: HexState) {
    await this.place(this.specs(after), true, { appear: "drop" });
  }
}

export function Hex3D(p: BoardProps) {
  const state = useMemo(() => hex.replay(p.moves, 2, ""), [p.moves]);
  const move = useRef(p.onMove);
  move.current = p.onMove;
  const [hostRef, scene] = useScene((el) => new HexScene(el));
  useEffect(() => scene?.setColours(["#f43f5e", "#0ea5e9"]), [scene]);
  useEffect(() => scene?.sync(2, "", p.moves), [scene, p.moves]);
  useEffect(() => scene?.setTurn({ canPlay: p.canPlay, turn: state?.turn ?? 0, onPlay: (i) => move.current(String(i)) }), [scene, p.canPlay, state]);
  if (!state) return null;
  return (
    <div data-game-board="hex" data-g3-board="hex" className="flex w-full max-w-[760px] flex-col items-center gap-2">
      <BoardBar>
        <span className="inline-flex items-center gap-1.5">
          <SeatDot color="#f43f5e" /> Red joins left and right · <SeatDot color="#0ea5e9" /> Blue joins top and bottom
        </span>
      </BoardBar>
      <SceneBox hostRef={hostRef} aspect={1.55} maxH={540} testId="hex" />
      <HiddenActions actions={emptyActions(state.cells, p.canPlay && state.winner === null, p.onMove, "data-hex-cell")} label="Free hexes" />
    </div>
  );
}

// ------------------------------------------------------------ Reversi

interface RState {
  b: RCell[];
  moves: number;
}

class ReversiScene extends BoardScene<RState> {
  private info: { canPlay: boolean; turn: number; legal: number[]; onPlay: (i: number) => void } | null = null;
  constructor(host: HTMLElement) {
    super(host, { fov: 26 });
    this.top = 0.34;
    const top = canvasTexture(
      1024,
      1024,
      (ctx, w) => {
        ctx.fillStyle = "#1c7a4c";
        ctx.fillRect(0, 0, w, w);
        ctx.strokeStyle = "rgba(6,40,24,0.75)";
        ctx.lineWidth = 6;
        for (let i = 0; i <= 8; i++) {
          const v = (i / 8) * w;
          ctx.beginPath();
          ctx.moveTo(v, 0);
          ctx.lineTo(v, w);
          ctx.moveTo(0, v);
          ctx.lineTo(w, v);
          ctx.stroke();
        }
        ctx.fillStyle = "rgba(6,40,24,0.85)";
        for (const [r, c] of [[2, 2], [2, 6], [6, 2], [6, 6]]) {
          ctx.beginPath();
          ctx.arc((c / 8) * w, (r / 8) * w, 9, 0, Math.PI * 2);
          ctx.fill();
        }
      },
      this.stage.renderer,
    );
    const g = new THREE.Group();
    const frame = mesh(slab(9, this.top - 0.02, 9, 0.12), wood("walnut", 2));
    g.add(frame);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshStandardMaterial({ map: top, roughness: 0.9 }));
    face.rotation.x = -Math.PI / 2;
    face.position.y = this.top;
    face.receiveShadow = true;
    g.add(face);
    this.stage.scene.add(g);
    this.root.position.set(-3.5, 0, -3.5);
    this.stage.allowViewDrag("reversi");
    this.stage.frame(new THREE.Box3(new THREE.Vector3(-4.5, 0, -4.5), new THREE.Vector3(4.5, 0.6, 4.5)), [0, 2.8, 1], 1.03);
  }
  setTurn(info: { canPlay: boolean; turn: number; legal: number[]; onPlay: (i: number) => void }) {
    this.info = info;
    if (this.settled) this.showHints();
    this.refreshHover();
  }
  protected replay(moves: string[]) {
    const b = reversiBoard(moves);
    return b ? { b, moves: moves.length } : null;
  }
  protected cellPos(i: number) {
    return new THREE.Vector3(i % 8, this.top, Math.floor(i / 8));
  }
  protected cellAt(p: THREE.Vector3) {
    const c = Math.round(p.x);
    const r = Math.round(p.z);
    return c < 0 || r < 0 || c > 7 || r > 7 ? null : r * 8 + c;
  }
  protected clickable(i: number) {
    return !!this.info?.canPlay && this.info.legal.includes(i);
  }
  protected clicked(i: number) {
    this.showHover(null);
    this.info?.onPlay(i);
  }
  protected makeHover() {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.92), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    return m;
  }
  private disc(): THREE.Object3D {
    const geo = sharedGeo("rdisc", () => {
      const g = new THREE.CylinderGeometry(0.4, 0.4, 0.12, 40);
      return g;
    });
    const side = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5 });
    const black = new THREE.MeshPhysicalMaterial({ color: 0x15171c, roughness: 0.35, clearcoat: 0.5 });
    const white = new THREE.MeshPhysicalMaterial({ color: 0xf5f3ee, roughness: 0.35, clearcoat: 0.5 });
    const m = mesh(geo, [side, black, white]);
    const holder = new THREE.Group();
    m.position.y = 0.06;
    holder.add(m);
    holder.userData.disc = m;
    holder.userData.colour = 0;
    return holder;
  }
  /** Black side up (0) or white side up (1); turning over when it changes. */
  private setColour(o: THREE.Object3D, colour: number, animate: boolean): Promise<void> | void {
    const m = o.userData.disc as THREE.Mesh;
    if (o.userData.colour === colour && m.rotation.z === (colour ? Math.PI : 0)) return;
    const from = m.rotation.z;
    const to = colour ? Math.PI : 0;
    o.userData.colour = colour;
    if (!animate) {
      m.rotation.z = to;
      return;
    }
    return this.stage.wait(160).then(() =>
      this.stage.animate(380, (t) => {
        m.rotation.z = from + (to - from) * t;
        m.position.y = 0.06 + Math.sin(t * Math.PI) * 0.45;
      }),
    );
  }
  private specs(s: RState): PieceSpec[] {
    return s.b.flatMap((c, i) => (c === -1 ? [] : [{ key: `d${i}`, pos: this.cellPos(i), make: () => this.disc(), update: (o: THREE.Object3D, a: boolean) => this.setColour(o, c, a) }]));
  }
  private hints: THREE.Mesh[] = [];
  private showHints() {
    for (const h of this.hints) {
      this.root.remove(h);
      h.geometry.dispose();
    }
    this.hints = [];
    if (!this.info?.canPlay) return;
    for (const i of this.info.legal) {
      const d = markerDot(0.1, this.info.turn === 0 ? 0x0f172a : 0xffffff, 0.45);
      d.position.copy(this.cellPos(i)).setY(this.top + 0.004);
      this.root.add(d);
      this.hints.push(d);
    }
    this.stage.invalidate();
  }
  protected snap(s: RState) {
    void this.place(this.specs(s), false);
  }
  protected async animateStep(_before: RState, after: RState) {
    for (const h of this.hints) h.visible = false;
    await this.place(this.specs(after), true, { appear: "drop" });
  }
  protected idle() {
    this.showHints();
    super.idle();
  }
}

export function Reversi3D({ moves, canPlay, turn, onMove }: BoardProps) {
  const board = useMemo(() => reversiBoard(moves) ?? reversiBoard([])!, [moves]);
  const legal = useMemo(() => reversiLegal(board, (turn % 2) as 0 | 1), [board, turn]);
  const [black, white] = reversiCount(board);
  const move = useRef(onMove);
  move.current = onMove;
  const [hostRef, scene] = useScene((el) => new ReversiScene(el));
  useEffect(() => scene?.sync(2, "", moves), [scene, moves]);
  useEffect(() => scene?.setTurn({ canPlay, turn, legal, onPlay: (i) => move.current(String(i)) }), [scene, canPlay, turn, legal]);
  const actions: Action[] = canPlay ? legal.map((i) => ({ key: String(i), label: `Play ${i} (flips ${reversiFlips(board, i, (turn % 2) as 0 | 1).length})`, run: () => onMove(String(i)), attrs: { "data-game-cell": String(i) } })) : [];
  return (
    <div data-game-board="reversi" data-g3-board="reversi" className="flex w-full max-w-[600px] flex-col items-center gap-2">
      <BoardBar>
        <span className="inline-flex items-center gap-1.5" data-reversi-black>
          <SeatDot color="#15171c" /> {black}
        </span>
        <span className="inline-flex items-center gap-1.5" data-reversi-white>
          <SeatDot color="#f5f3ee" /> {white}
        </span>
        {canPlay && legal.length === 0 && (
          <button type="button" data-game-pass onClick={() => onMove("p")} className="rounded-full bg-amber-500 px-4 py-1.5 text-white">
            No move possible — pass
          </button>
        )}
      </BoardBar>
      <SceneBox hostRef={hostRef} aspect={1.12} maxH={560} testId="reversi" />
      <HiddenActions actions={actions} label="Legal moves" />
    </div>
  );
}

