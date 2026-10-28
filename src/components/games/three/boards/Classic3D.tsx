// LANX 2.16.0: chess, checkers and Connect Four in 3D. Chess has a turned
// Staunton set on a wooden board — pieces slide, knights jump, captured
// pieces lift away, castling moves both pieces, and a pawn can promote to
// any piece. Checkers pieces hop through multi-jumps and crown into stacked
// kings. Connect Four stands upright: discs drop down the column and bounce.
// Every move is the same notation as the flat boards.

import * as THREE from "three";
import { Chess, type Square } from "chess.js";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BoardProps } from "../../boardProps";
import { C4_COLS, C4_ROWS, c4Grid, c4WinCells, chessGame, type Cell } from "../../../../lib/gameRules";
import { checkers, checkersMoves, checkersRouteStep, type CheckersState } from "../../../../lib/games/checkers.ts";
import { CHECKERS_ROUTE_NOTE } from "../../boards/CheckersBoard";
import { sfx } from "../../../../lib/gameSounds";
import { BoardScene, type PieceSpec } from "../boardScene";
import { TurnScene } from "../turnScene";
import { FONT, canvasTexture, discGeometry, hop, markerDot, markerRing, mesh, slab, wood } from "../kit";
import { pieceGeometry, ivory, ebony } from "../chessPieces";
import { SceneBox, useScene } from "../Board3D";
import { BoardBar, HiddenActions, SeatDot, quiet3, type Action } from "../ui";
import { easeIn, easeInOut, easeOut } from "../stage";

const FILES = "abcdefgh";

/** An 8 × 8 board with a wooden border (and, for chess, letters and numbers on it). */
function eightTexture(light: string, dark: string, labels: boolean, renderer: THREE.WebGLRenderer, darkWhen: (r: number, c: number) => boolean) {
  const B = 0.6;
  const span = 8 + 2 * B;
  const px = 1152;
  const k = px / span;
  return canvasTexture(
    px,
    px,
    (ctx) => {
      ctx.fillStyle = "#5b3a22";
      ctx.fillRect(0, 0, px, px);
      for (let r = 0; r < 8; r++)
        for (let c = 0; c < 8; c++) {
          ctx.fillStyle = darkWhen(r, c) ? dark : light;
          ctx.fillRect((B + c) * k, (B + r) * k, k + 1, k + 1);
        }
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 3;
      ctx.strokeRect(B * k, B * k, 8 * k, 8 * k);
      if (labels) {
        ctx.fillStyle = "rgba(255,240,220,0.85)";
        ctx.font = `700 ${k * 0.3}px ${FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (let i = 0; i < 8; i++) {
          ctx.fillText(FILES[i], (B + i + 0.5) * k, (B + 8 + B / 2) * k);
          ctx.fillText(FILES[i], (B + i + 0.5) * k, (B / 2) * k);
          ctx.fillText(String(8 - i), (B / 2) * k, (B + i + 0.5) * k);
          ctx.fillText(String(8 - i), (B + 8 + B / 2) * k, (B + i + 0.5) * k);
        }
      }
    },
    renderer,
  );
}

function eightBoard(stage: { scene: THREE.Scene; renderer: THREE.WebGLRenderer }, tex: THREE.Texture, top: number) {
  const g = new THREE.Group();
  const body = mesh(slab(9.2, top - 0.01, 9.2, 0.12), wood("walnut", 2));
  g.add(body);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(9.2, 9.2), new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.38, clearcoat: 0.4, clearcoatRoughness: 0.3 }));
  face.rotation.x = -Math.PI / 2;
  face.position.y = top;
  face.receiveShadow = true;
  g.add(face);
  stage.scene.add(g);
}

function squarePlane(colour: number, opacity: number) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 0.98), new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 1;
  return m;
}

// ------------------------------------------------------------ Chess

const sqIndex = (sq: string) => (8 - Number(sq[1])) * 8 + FILES.indexOf(sq[0]);
const sqName = (i: number) => `${FILES[i % 8]}${8 - Math.floor(i / 8)}` as Square;

interface ChessTurn {
  canPlay: boolean;
  colour: "w" | "b";
  onMove: (from: Square, to: Square) => void;
}

class ChessScene extends BoardScene<Chess> {
  private info: ChessTurn | null = null;
  private from: number | null = null;
  private marks = new THREE.Group();
  private flipped = false;
  constructor(host: HTMLElement) {
    super(host, { fov: 26 });
    this.top = 0.42;
    eightBoard(this.stage, eightTexture("#ecd9b8", "#94603f", true, this.stage.renderer, (r, c) => (r + c) % 2 === 1), this.top);
    this.root.add(this.marks);
    // A little more lean than the other boards, so the pieces show their shapes (drag to change it).
    this.stage.allowViewDrag("chess", 58, 40);
    this.stage.frame(new THREE.Box3(new THREE.Vector3(-4.6, 0, -4.6), new THREE.Vector3(4.6, 1.2, 4.6)), [0, 1.7, 1], 1.02);
  }
  /** White at the bottom, or black (turns the board round). */
  setSide(black: boolean) {
    this.flipped = black;
    this.root.rotation.y = black ? Math.PI : 0;
    this.stage.invalidate();
  }
  setTurn(info: ChessTurn) {
    this.info = info;
    this.from = null;
    if (this.settled) this.idle();
  }
  protected replay(moves: string[]) {
    return chessGame(moves);
  }
  protected cellPos(i: number) {
    return new THREE.Vector3((i % 8) - 3.5, this.top, Math.floor(i / 8) - 3.5);
  }
  protected cellAt(p: THREE.Vector3) {
    const c = Math.floor(p.x + 4);
    const r = Math.floor(p.z + 4);
    return c < 0 || r < 0 || c > 7 || r > 7 ? null : r * 8 + c;
  }
  private game(): Chess | null {
    return this.replay(this.shown);
  }
  private targetsFrom(i: number): number[] {
    const g = this.game();
    if (!g) return [];
    return g.moves({ square: sqName(i), verbose: true }).map((m) => sqIndex(m.to));
  }
  protected clickable(i: number) {
    const g = this.game();
    if (!this.info?.canPlay || !g) return false;
    if (this.from !== null && this.targetsFrom(this.from).includes(i)) return true;
    const p = g.get(sqName(i));
    return !!p && p.color === this.info.colour && this.targetsFrom(i).length > 0;
  }
  protected clicked(i: number) {
    if (!this.info) return;
    if (this.from !== null && this.targetsFrom(this.from).includes(i)) {
      const from = this.from;
      this.select(null);
      this.showHover(null);
      this.info.onMove(sqName(from), sqName(i));
      return;
    }
    this.select(this.from === i ? null : i);
  }
  protected makeHover() {
    return squarePlane(0x6366f1, 0.22);
  }
  private select(i: number | null) {
    const prev = this.from !== null ? this.pieceAt(this.from) : null;
    if (prev) prev.position.y = this.top;
    this.from = i;
    this.drawMarks();
    const now = i !== null ? this.pieceAt(i) : null;
    if (now) now.position.y = this.top + 0.18;
    sfx("tap", 0.4);
    this.stage.invalidate();
  }
  private pieceAt(i: number): THREE.Object3D | undefined {
    for (const [k, o] of this.pieces) if (k.startsWith(`${sqName(i)}:`)) return o;
    return undefined;
  }
  private clearMarks() {
    for (const m of [...this.marks.children]) {
      this.marks.remove(m);
      (m as THREE.Mesh).geometry.dispose();
    }
  }
  /** The last move, a king in check, the selected piece and where it may go. */
  private drawMarks() {
    this.clearMarks();
    const g = this.game();
    if (!g) return;
    const hist = g.history({ verbose: true });
    const last = hist[hist.length - 1];
    if (last) {
      for (const sq of [last.from, last.to]) {
        const q = squarePlane(0xfacc15, 0.28);
        q.position.copy(this.cellPos(sqIndex(sq))).setY(this.top + 0.002);
        this.marks.add(q);
      }
    }
    if (g.inCheck()) {
      for (const row of g.board())
        for (const p of row)
          if (p && p.type === "k" && p.color === g.turn()) {
            const q = squarePlane(0xef4444, 0.45);
            q.position.copy(this.cellPos(sqIndex(p.square))).setY(this.top + 0.003);
            this.marks.add(q);
          }
    }
    if (this.from !== null) {
      const sel = squarePlane(0x6366f1, 0.35);
      sel.position.copy(this.cellPos(this.from)).setY(this.top + 0.003);
      this.marks.add(sel);
      for (const t of this.targetsFrom(this.from)) {
        const capture = !!g.get(sqName(t));
        const m = capture ? markerRing(0.46, 0x0f172a, 0.06) : markerDot(0.15, 0x0f172a, 0.32);
        if (capture) ((m.material as THREE.MeshBasicMaterial).opacity = 0.4);
        m.position.copy(this.cellPos(t)).setY(this.top + 0.004);
        this.marks.add(m);
      }
    }
    this.stage.invalidate();
  }
  private piece(type: string, colour: string): THREE.Object3D {
    const m = mesh(pieceGeometry(type), colour === "w" ? ivory() : ebony());
    m.scale.setScalar(1.08);
    if (colour === "b") m.rotation.y = Math.PI;
    const g = new THREE.Group();
    g.add(m);
    g.userData = { type, colour, mesh: m };
    return g;
  }
  private specs(g: Chess): PieceSpec[] {
    const out: PieceSpec[] = [];
    for (const row of g.board())
      for (const p of row) {
        if (!p) continue;
        out.push({ key: `${p.square}:${p.color}${p.type}`, pos: this.cellPos(sqIndex(p.square)), make: () => this.piece(p.type, p.color) });
      }
    return out;
  }
  protected snap(g: Chess) {
    void this.place(this.specs(g), false);
    this.drawMarks();
  }
  private rekey(oldKey: string, newKey: string) {
    const o = this.pieces.get(oldKey);
    if (!o) return;
    this.pieces.delete(oldKey);
    this.pieces.set(newKey, o);
  }
  protected async animateStep(_before: Chess, after: Chess) {
    this.from = null;
    this.clearMarks();
    const hist = after.history({ verbose: true });
    const h = hist[hist.length - 1];
    if (!h) return;
    const jobs: Promise<unknown>[] = [];
    // A capture lifts away.
    if (h.captured) {
      const capSq = h.flags.includes("e") ? `${h.to[0]}${h.from[1]}` : h.to;
      const opp = h.color === "w" ? "b" : "w";
      const key = `${capSq}:${opp}${h.captured}`;
      const obj = this.pieces.get(key);
      if (obj) {
        this.pieces.delete(key);
        const start = obj.position.clone();
        jobs.push(
          this.stage.wait(200).then(() =>
            this.stage.animate(380, (t) => {
              obj.position.y = start.y + t * 1.6;
              obj.scale.setScalar(Math.max(0.001, 1 - t));
            }).then(() => this.root.remove(obj)),
          ),
        );
        setTimeout(() => sfx("capture", 0.7), 220);
      }
    }
    const moveObj = (from: string, to: string, key: string, newKey: string, jump: boolean) => {
      const o = this.pieces.get(key);
      if (!o) return;
      const a = o.position.clone();
      a.y = this.top;
      const b = this.cellPos(sqIndex(to));
      this.rekey(key, newKey);
      jobs.push(this.stage.animate(jump ? 420 : 300 + a.distanceTo(b) * 30, (t) => (jump ? hop(a, b, 0.9, t, o.position) : hop(a, b, 0.12, t, o.position)), easeInOut).then(() => sfx("place", 0.5)));
      void from;
    };
    const newType = h.promotion ?? h.piece;
    moveObj(h.from, h.to, `${h.from}:${h.color}${h.piece}`, `${h.to}:${h.color}${newType}`, h.piece === "n");
    if (h.flags.includes("k") || h.flags.includes("q")) {
      const rank = h.from[1];
      const [rf, rt] = h.flags.includes("k") ? ["h", "f"] : ["a", "d"];
      moveObj(`${rf}${rank}`, `${rt}${rank}`, `${rf}${rank}:${h.color}r`, `${rt}${rank}:${h.color}r`, false);
    }
    await Promise.all(jobs);
    if (h.promotion) {
      const o = this.pieces.get(`${h.to}:${h.color}${newType}`);
      const m = o?.userData.mesh as THREE.Mesh | undefined;
      if (m) {
        await this.stage.animate(160, (t) => m.scale.setScalar(Math.max(0.001, 1 - t)));
        m.geometry = pieceGeometry(h.promotion);
        await this.stage.animate(240, (t) => m.scale.setScalar(Math.max(0.001, t)), easeOut);
      }
    }
  }
  protected idle() {
    this.drawMarks();
    super.idle();
  }
  get isFlipped() {
    return this.flipped;
  }
}

const PROMO: [string, string][] = [
  ["q", "Queen"],
  ["r", "Rook"],
  ["b", "Bishop"],
  ["n", "Knight"],
];

export function Chess3D({ moves, canPlay, turn, seat, local, onMove }: BoardProps) {
  const game = useMemo(() => chessGame(moves), [moves]);
  const [promo, setPromo] = useState<{ from: Square; to: Square } | null>(null);
  const movesRef = useRef(moves);
  movesRef.current = moves;
  const send = useRef(onMove);
  send.current = onMove;
  const [hostRef, scene] = useScene((el) => new ChessScene(el));
  useEffect(() => scene?.setSide(!local && seat === 1), [scene, local, seat]);
  useEffect(() => scene?.sync(2, "", moves), [scene, moves]);
  const play = (from: Square, to: Square, promotion?: string) => {
    const g = chessGame(movesRef.current);
    if (!g) return;
    try {
      const mv = g.move({ from, to, promotion: promotion ?? "q" });
      if (mv) send.current(mv.san);
    } catch {
      /* not allowed */
    }
  };
  useEffect(() => {
    scene?.setTurn({
      canPlay,
      colour: turn === 0 ? "w" : "b",
      onMove: (from, to) => {
        const g = chessGame(movesRef.current);
        const p = g?.get(from);
        if (p?.type === "p" && (to[1] === "8" || to[1] === "1")) setPromo({ from, to });
        else play(from, to);
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, canPlay, turn]);
  useEffect(() => setPromo(null), [moves.length]);
  if (!game) return null;
  // Captured pieces, as glyphs beside the board.
  const GLYPH: Record<string, string> = { wp: "♙", wn: "♘", wb: "♗", wr: "♖", wq: "♕", bp: "♟", bn: "♞", bb: "♝", br: "♜", bq: "♛" };
  const taken = game.history({ verbose: true }).filter((h) => h.captured).map((h) => `${h.color === "w" ? "b" : "w"}${h.captured}`);
  const actions: Action[] = canPlay
    ? game.moves({ verbose: true }).map((m) => ({ key: m.san, label: `Play ${m.san}`, run: () => onMove(m.san), attrs: { "data-chess-move": m.san, "data-chess-from": m.from, "data-chess-to": m.to } }))
    : [];
  return (
    <div data-game-board="chess" data-g3-board="chess" className="flex w-full max-w-[640px] flex-col items-center gap-2">
      <BoardBar>
        <span className="text-[13px] tracking-wide" data-chess-taken-white>
          {taken.filter((t) => t[0] === "b").map((t) => GLYPH[t]).join(" ")}
        </span>
        {game.inCheck() && <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-rose-700 dark:text-rose-300">Check</span>}
        <span className="text-[13px] tracking-wide" data-chess-taken-black>
          {taken.filter((t) => t[0] === "w").map((t) => GLYPH[t]).join(" ")}
        </span>
      </BoardBar>
      <SceneBox hostRef={hostRef} aspect={1.08} maxH={620} testId="chess" />
      {promo && (
        <div className="flex items-center gap-2 text-[12.5px]" data-chess-promote>
          <span>Promote to:</span>
          {PROMO.map(([k, label]) => (
            <button key={k} type="button" data-chess-promote-to={k} onClick={() => play(promo.from, promo.to, k)} className={quiet3}>
              {label}
            </button>
          ))}
        </div>
      )}
      <HiddenActions actions={actions} label="Legal moves" />
    </div>
  );
}

// ------------------------------------------------------------ Checkers

interface CheckersTurn {
  canPlay: boolean;
  turn: number;
  legal: string[];
  onMove: (m: string) => void;
  /** Tells the page when two capture routes reach the clicked square (so it can say what to do). */
  onRoutes: (choosing: boolean) => void;
}

class CheckersScene extends BoardScene<CheckersState> {
  private info: CheckersTurn | null = null;
  private from: number | null = null;
  /** LANX 2.17.0: the capture routes still possible while the player picks one hop by hop. */
  private routes: string[] | null = null;
  private marks = new THREE.Group();
  private colours = ["#e11d48", "#1f2937"];
  constructor(host: HTMLElement) {
    super(host, { fov: 26 });
    this.top = 0.42;
    eightBoard(this.stage, eightTexture("#ead7b7", "#7a5230", false, this.stage.renderer, (r, c) => (r + c) % 2 === 1), this.top);
    this.root.add(this.marks);
    this.stage.allowViewDrag("checkers", 58, 40);
    this.stage.frame(new THREE.Box3(new THREE.Vector3(-4.6, 0, -4.6), new THREE.Vector3(4.6, 0.8, 4.6)), [0, 2.6, 1], 1.02);
  }
  setSide(flip: boolean) {
    this.root.rotation.y = flip ? Math.PI : 0;
    this.stage.invalidate();
  }
  setTurn(info: CheckersTurn) {
    this.info = info;
    this.from = null;
    this.setRoutes(null);
    if (this.settled) this.drawMarks();
    this.refreshHover();
  }
  protected replay(moves: string[]) {
    return checkers.replay(moves, 2, "");
  }
  protected cellPos(i: number) {
    return new THREE.Vector3((i % 8) - 3.5, this.top, Math.floor(i / 8) - 3.5);
  }
  protected cellAt(p: THREE.Vector3) {
    const c = Math.floor(p.x + 4);
    const r = Math.floor(p.z + 4);
    return c < 0 || r < 0 || c > 7 || r > 7 ? null : r * 8 + c;
  }
  private targets(from: number) {
    return (this.info?.legal ?? []).filter((m) => Number(m.split("-")[0]) === from);
  }
  private setRoutes(r: string[] | null) {
    const was = this.routes !== null;
    this.routes = r;
    if (was !== (r !== null)) this.info?.onRoutes(r !== null);
  }
  protected clickable(i: number) {
    if (!this.info?.canPlay) return false;
    if (this.routes) return i === this.from || checkersRouteStep(this.routes).next.includes(i);
    if (this.from !== null && this.targets(this.from).some((m) => Number(m.split("-").pop()) === i)) return true;
    return this.targets(i).length > 0;
  }
  private send(m: string) {
    this.from = null;
    this.setRoutes(null);
    this.drawMarks();
    this.showHover(null);
    this.info?.onMove(m);
  }
  protected clicked(i: number) {
    if (!this.info) return;
    if (this.routes) {
      const step = checkersRouteStep(this.routes);
      if (step.next.includes(i)) {
        const left = this.routes.filter((m) => Number(m.split("-")[step.path.length]) === i);
        sfx("tap", 0.4);
        if (left.length === 1) this.send(left[0]);
        else {
          this.setRoutes(left);
          this.drawMarks();
        }
        return;
      }
      // The piece again: start over.
      this.setRoutes(null);
      this.drawMarks();
      return;
    }
    if (this.from !== null) {
      const ends = this.targets(this.from).filter((x) => Number(x.split("-").pop()) === i);
      if (ends.length === 1) return this.send(ends[0]);
      if (ends.length > 1) {
        // Two routes end here: the player clicks the hops to say which.
        sfx("tap", 0.4);
        this.setRoutes(ends);
        this.drawMarks();
        return;
      }
    }
    this.from = this.from === i ? null : i;
    sfx("tap", 0.4);
    this.drawMarks();
  }
  protected makeHover() {
    return squarePlane(0x6366f1, 0.22);
  }
  private drawMarks() {
    for (const m of [...this.marks.children]) {
      this.marks.remove(m);
      (m as THREE.Mesh).geometry.dispose();
    }
    if (this.info?.canPlay) {
      if (this.from === null) {
        for (const f of new Set(this.info.legal.map((m) => Number(m.split("-")[0])))) {
          const r = markerRing(0.44, 0xfacc15, 0.05);
          r.position.copy(this.cellPos(f)).setY(this.top + 0.004);
          this.marks.add(r);
        }
      } else if (this.routes) {
        const sel = squarePlane(0x6366f1, 0.35);
        sel.position.copy(this.cellPos(this.from)).setY(this.top + 0.003);
        this.marks.add(sel);
        const step = checkersRouteStep(this.routes);
        for (const k of step.path.slice(1)) {
          const p = squarePlane(0xfacc15, 0.3);
          p.position.copy(this.cellPos(k)).setY(this.top + 0.003);
          this.marks.add(p);
        }
        for (const k of step.next) {
          const d = markerDot(0.18, 0x0ea5e9, 0.85);
          d.position.copy(this.cellPos(k)).setY(this.top + 0.004);
          this.marks.add(d);
        }
        // Where both routes end.
        for (const k of new Set(this.routes.map((m) => Number(m.split("-").pop())))) {
          if (k === this.from) continue;
          const d = markerDot(0.16, 0x10b981, 0.75);
          d.position.copy(this.cellPos(k)).setY(this.top + 0.004);
          this.marks.add(d);
        }
      } else {
        const sel = squarePlane(0x6366f1, 0.35);
        sel.position.copy(this.cellPos(this.from)).setY(this.top + 0.003);
        this.marks.add(sel);
        for (const m of this.targets(this.from)) {
          const d = markerDot(0.16, 0x10b981, 0.75);
          d.position.copy(this.cellPos(Number(m.split("-").pop()))).setY(this.top + 0.004);
          this.marks.add(d);
        }
      }
    }
    this.stage.invalidate();
  }
  private disc(p: number, king: boolean): THREE.Object3D {
    const g = new THREE.Group();
    const mat = new THREE.MeshPhysicalMaterial({ color: this.colours[p], roughness: 0.35, clearcoat: 0.6 });
    const a = mesh(discGeometry(0.34), mat);
    a.scale.set(0.4, 0.45, 0.4);
    g.add(a);
    if (king) {
      const b = mesh(discGeometry(0.34), mat);
      b.scale.set(0.4, 0.45, 0.4);
      b.position.y = 0.155;
      g.add(b);
    }
    g.userData = { p, king };
    return g;
  }
  private specs(s: CheckersState): PieceSpec[] {
    return s.cells.flatMap((pc, i) => (pc ? [{ key: `${i}:${pc.p}${pc.king ? "k" : ""}`, pos: this.cellPos(i), make: () => this.disc(pc.p, pc.king) }] : []));
  }
  protected snap(s: CheckersState) {
    void this.place(this.specs(s), false);
    this.drawMarks();
  }
  protected async animateStep(before: CheckersState, after: CheckersState, move: string) {
    this.from = null;
    this.setRoutes(null);
    for (const m of [...this.marks.children]) m.visible = false;
    const path = move.split("-").map(Number);
    const piece = before.cells[path[0]];
    if (!piece) return;
    const key = `${path[0]}:${piece.p}${piece.king ? "k" : ""}`;
    const obj = this.pieces.get(key);
    if (!obj) return;
    for (let k = 1; k < path.length; k++) {
      const a = obj.position.clone();
      const b = this.cellPos(path[k]);
      const jump = Math.abs(Math.floor(path[k] / 8) - Math.floor(path[k - 1] / 8)) === 2;
      await this.stage.animate(jump ? 380 : 260, (t) => hop(a, b, jump ? 0.7 : 0.25, t, obj.position), easeInOut);
      sfx("place", 0.5);
      if (jump) {
        const mid = (path[k] + path[k - 1]) / 2;
        const victim = before.cells[mid];
        const vk = victim ? `${mid}:${victim.p}${victim.king ? "k" : ""}` : "";
        const v = this.pieces.get(vk);
        if (v) {
          this.pieces.delete(vk);
          sfx("capture", 0.7);
          const s0 = v.position.clone();
          void this.stage.animate(300, (t) => {
            v.position.y = s0.y + t;
            v.scale.setScalar(Math.max(0.001, 1 - t));
          }).then(() => this.root.remove(v));
        }
      }
    }
    const to = path[path.length - 1];
    const after_ = after.cells[to];
    this.pieces.delete(key);
    if (after_?.king && !piece.king) {
      // Crowned: a second disc lands on top.
      const crown = this.disc(piece.p, true);
      crown.position.copy(obj.position);
      this.root.remove(obj);
      this.root.add(crown);
      const top = crown.children[1];
      const y0 = top.position.y;
      await this.stage.animate(320, (t) => (top.position.y = y0 + (1 - easeOut(t)) * 1.2));
      sfx("score", 0.6);
      this.pieces.set(`${to}:${piece.p}k`, crown);
    } else this.pieces.set(`${to}:${piece.p}${piece.king ? "k" : ""}`, obj);
  }
  protected idle() {
    this.drawMarks();
    super.idle();
  }
}

export function Checkers3D({ moves, canPlay, turn, seat, local, onMove }: BoardProps) {
  const state = useMemo(() => checkers.replay(moves, 2, ""), [moves]);
  const legal = useMemo(() => (state && canPlay ? checkersMoves(state) : []), [state, canPlay]);
  const send = useRef(onMove);
  send.current = onMove;
  const [choosing, setChoosing] = useState(false);
  const [hostRef, scene] = useScene((el) => new CheckersScene(el));
  useEffect(() => scene?.setSide(!local && seat === 1), [scene, local, seat]);
  useEffect(() => scene?.sync(2, "", moves), [scene, moves]);
  useEffect(() => scene?.setTurn({ canPlay, turn, legal, onMove: (m) => send.current(m), onRoutes: setChoosing }), [scene, canPlay, turn, legal]);
  if (!state) return null;
  const actions: Action[] = legal.map((m) => ({ key: m, label: `Move ${m}`, run: () => onMove(m), attrs: { "data-checkers-move": m } }));
  return (
    <div data-game-board="checkers" data-g3-board="checkers" className="flex w-full max-w-[640px] flex-col items-center gap-2">
      <BoardBar>
        <span className="inline-flex items-center gap-1.5">
          <SeatDot color="#e11d48" /> {state.cells.filter((x) => x?.p === 0).length}
          <span className="ml-2" />
          <SeatDot color="#1f2937" /> {state.cells.filter((x) => x?.p === 1).length}
        </span>
        {canPlay && legal.length > 0 && legal[0].split("-").length > 1 && Math.abs(Number(legal[0].split("-")[1]) - Number(legal[0].split("-")[0])) > 9 && <span className="text-amber-700 dark:text-amber-300">You must jump</span>}
      </BoardBar>
      <SceneBox hostRef={hostRef} aspect={1.08} maxH={620} testId="checkers" />
      {choosing && <div data-checkers-routes className="text-center text-[12px] font-semibold text-slate-700 dark:text-slate-200">{CHECKERS_ROUTE_NOTE}</div>}
      <HiddenActions actions={actions} label="Legal moves" />
    </div>
  );
}

// ------------------------------------------------------------ Connect Four

interface C4 {
  g: Cell[][];
  n: number;
}

class ConnectFourScene extends TurnScene<C4> {
  private discs = new Map<string, THREE.Object3D>();
  private ghost: THREE.Mesh;
  private info: { canPlay: boolean; turn: number; full: boolean[]; onDrop: (c: number) => void } | null = null;
  private rings: THREE.Object3D[] = [];
  private hoverCol = -1;
  constructor(host: HTMLElement) {
    super(host, { fov: 26 });
    const s = this.stage;
    // The frame: a blue panel with 42 holes, front and back, on two feet.
    const shape = new THREE.Shape();
    const W = C4_COLS + 0.6;
    const H = C4_ROWS + 0.6;
    shape.moveTo(-W / 2, 0);
    shape.lineTo(W / 2, 0);
    shape.lineTo(W / 2, H);
    shape.lineTo(-W / 2, H);
    shape.lineTo(-W / 2, 0);
    for (let r = 0; r < C4_ROWS; r++)
      for (let c = 0; c < C4_COLS; c++) {
        const p = this.cell(r, c);
        const h = new THREE.Path();
        h.absarc(p.x, p.y, 0.42, 0, Math.PI * 2, true);
        shape.holes.push(h);
      }
    const blue = new THREE.MeshPhysicalMaterial({ color: 0x1d4ed8, roughness: 0.32, clearcoat: 0.6 });
    for (const z of [-0.2, 0.2]) {
      const panel = mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2, curveSegments: 28 }), blue);
      panel.position.set(0, 0, z - 0.05);
      s.scene.add(panel);
    }
    for (const x of [-W / 2 - 0.05, W / 2 + 0.05]) {
      const foot = mesh(slab(0.5, 0.18, 2.2, 0.08), blue);
      foot.position.set(x, 0, 0);
      s.scene.add(foot);
      const post = mesh(slab(0.16, H + 0.45, 0.5, 0.05), blue);
      post.position.set(x, 0.12, 0);
      s.scene.add(post);
    }
    this.ghost = new THREE.Mesh(this.discGeo(), new THREE.MeshStandardMaterial({ color: 0xef4444, transparent: true, opacity: 0.55 }));
    this.ghost.visible = false;
    s.scene.add(this.ghost);
    s.onPointerMove = () => this.hover();
    s.onTap = () => {
      const c = this.colAt();
      if (c !== null && this.info?.canPlay && !this.info.full[c] && this.settled) {
        this.ghost.visible = false;
        this.info.onDrop(c);
      }
    };
    s.frame(new THREE.Box3(new THREE.Vector3(-W / 2 - 0.4, 0, -1.1), new THREE.Vector3(W / 2 + 0.4, H + 1.6, 1.1)), [0, 0.38, 1], 1.03);
  }
  private discGeo() {
    const g = new THREE.CylinderGeometry(0.4, 0.4, 0.2, 40);
    g.rotateX(Math.PI / 2);
    return g;
  }
  /** Row 0 is the top. */
  private cell(r: number, c: number) {
    return new THREE.Vector3(c - (C4_COLS - 1) / 2, 0.3 + (C4_ROWS - 1 - r) + 0.5, 0);
  }
  setTurn(info: { canPlay: boolean; turn: number; full: boolean[]; onDrop: (c: number) => void }) {
    this.info = info;
    (this.ghost.material as THREE.MeshStandardMaterial).color.set(info.turn === 0 ? 0xef4444 : 0xfacc15);
    this.hover();
  }
  private colAt(): number | null {
    const p = this.stage.pointOn(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
    if (!p) return null;
    const c = Math.round(p.x + (C4_COLS - 1) / 2);
    return c < 0 || c >= C4_COLS || p.y < 0 || p.y > C4_ROWS + 2 ? null : c;
  }
  private hover() {
    const c = this.colAt();
    const ok = c !== null && !!this.info?.canPlay && !this.info.full[c] && this.settled;
    this.ghost.visible = ok;
    if (ok && c !== null) {
      this.ghost.position.copy(this.cell(0, c)).setY(C4_ROWS + 1.15);
      this.hoverCol = c;
    }
    this.stage.renderer.domElement.style.cursor = ok ? "pointer" : "";
    this.stage.invalidate();
  }
  protected replay(moves: string[]) {
    return { g: c4Grid(moves), n: moves.length };
  }
  private disc(who: number) {
    return mesh(this.discGeo(), new THREE.MeshPhysicalMaterial({ color: who === 0 ? 0xef4444 : 0xfacc15, roughness: 0.3, clearcoat: 0.7 }));
  }
  protected snap(s: C4) {
    const want = new Set<string>();
    s.g.forEach((row, r) =>
      row.forEach((who, c) => {
        if (who === null) return;
        const k = `${r}:${c}:${who}`;
        want.add(k);
        if (!this.discs.has(k)) {
          const d = this.disc(who);
          d.position.copy(this.cell(r, c));
          this.stage.scene.add(d);
          this.discs.set(k, d);
        }
      }),
    );
    for (const [k, d] of [...this.discs])
      if (!want.has(k)) {
        this.stage.scene.remove(d);
        this.discs.delete(k);
      }
    this.showWin(s);
    this.stage.invalidate();
  }
  protected async animateStep(before: C4, after: C4) {
    let r = -1;
    let c = -1;
    for (let rr = 0; rr < C4_ROWS; rr++) for (let cc = 0; cc < C4_COLS; cc++) if (after.g[rr][cc] !== null && before.g[rr][cc] === null) [r, c] = [rr, cc];
    if (r < 0) return;
    const who = after.g[r][c]!;
    const d = this.disc(who);
    const end = this.cell(r, c);
    const start = end.clone().setY(C4_ROWS + 1.15);
    d.position.copy(start);
    this.stage.scene.add(d);
    this.discs.set(`${r}:${c}:${who}`, d);
    this.ghost.visible = false;
    const fall = start.y - end.y;
    await this.stage.animate(180 + fall * 45, (t) => (d.position.y = start.y - fall * t), easeIn);
    sfx("place", 0.7);
    await this.stage.animate(160, (t) => (d.position.y = end.y + Math.sin(t * Math.PI) * 0.18));
  }
  private showWin(s: C4) {
    for (const r of this.rings) this.stage.scene.remove(r);
    this.rings = [];
    const cells = c4WinCells(s.g);
    if (!cells) return;
    for (const [r, c] of cells) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.28, 32), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      ring.position.copy(this.cell(r, c)).setZ(0.11);
      this.stage.scene.add(ring);
      const back = ring.clone();
      back.position.z = -0.11;
      back.rotation.y = Math.PI;
      this.stage.scene.add(back);
      this.rings.push(ring, back);
    }
  }
  protected idle() {
    this.hover();
  }
  get column() {
    return this.hoverCol;
  }
}

export function ConnectFour3D({ moves, canPlay, turn, onMove }: BoardProps) {
  const grid = useMemo(() => c4Grid(moves), [moves]);
  const win = useMemo(() => c4WinCells(grid), [grid]);
  const full = useMemo(() => Array.from({ length: C4_COLS }, (_, c) => grid[0][c] !== null), [grid]);
  const over = !!win || moves.length === C4_ROWS * C4_COLS;
  const send = useRef(onMove);
  send.current = onMove;
  const [hostRef, scene] = useScene((el) => new ConnectFourScene(el));
  useEffect(() => scene?.sync(2, "", moves), [scene, moves]);
  useEffect(() => scene?.setTurn({ canPlay: canPlay && !over, turn, full, onDrop: (c) => send.current(String(c)) }), [scene, canPlay, over, turn, full]);
  const actions: Action[] = canPlay && !over ? full.flatMap((f, c): Action[] => (f ? [] : [{ key: String(c), label: `Drop in column ${c + 1}`, run: () => onMove(String(c)), attrs: { "data-game-col": String(c) } }])) : [];
  return (
    <div data-game-board="connect4" data-g3-board="connect4" className="flex w-full max-w-[600px] flex-col items-center gap-2">
      <BoardBar>
        <span className="inline-flex items-center gap-1.5">
          <SeatDot color={turn === 0 ? "#ef4444" : "#facc15"} /> {win ? "Four in a row!" : over ? "The board is full" : `${turn === 0 ? "Red" : "Yellow"} to drop`}
        </span>
      </BoardBar>
      <SceneBox hostRef={hostRef} aspect={1.18} maxH={540} testId="connect4" />
      <HiddenActions actions={actions} label="Columns" />
    </div>
  );
}
