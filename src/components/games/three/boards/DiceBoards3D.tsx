// LANX 2.16.0: Backgammon and Bankroll in 3D, both with real dice thrown in
// Rapier (landing on the numbers the rules rolled). Backgammon: a wooden
// case with inlaid points, stacked checkers that slide from point to point,
// hits that go to the bar and checkers borne off into the tray. Bankroll: a
// ring of streets with names and prices, pawns that walk round the board,
// little houses in the owner's colour, and the dice rolled across the
// middle of the board.

import * as THREE from "three";
import { useEffect, useMemo, useRef } from "react";
import { seatFor, type BoardProps } from "../../boardProps";
import { backgammon, bgMoves, bgTarget, type BgState } from "../../../../lib/games/backgammon.ts";
import { BOARD, bankroll, type BankrollState } from "../../../../lib/games/bankroll.ts";
import { sfx } from "../../../../lib/gameSounds";
import { TurnScene } from "../turnScene";
import { FONT, canvasTexture, discGeometry, hop, markerRing, mesh, pawnGeometry, plastic, roundRect, slab, wood } from "../kit";
import { diceTray, makeDie, restOn, show, throwDice, topValue, type Die } from "../dice";
import { SceneBox, useScene } from "../Board3D";
import { BoardBar, HiddenActions, SeatDot, primary3, quiet3, type Action } from "../ui";
import { easeInOut } from "../stage";

// ============================================================ Backgammon

const PW = 1; // point width
const BAR = 0.9;
const DEPTH = 11; // board depth (both halves)
const TOPY = 0.45;
const CK = 0.43; // checker radius
const OFF_X = 7.6; // the off tray's centre
const TRAY_X = -9.2; // the dice tray's centre

/** Point index → its x and which half (bottom = player 0's home side). */
function pointX(i: number): number {
  const col = i < 12 ? 11 - i : i - 12;
  return -6 - BAR / 2 + col * PW + PW / 2 + (col >= 6 ? BAR : 0);
}
const bottomRow = (i: number) => i < 12;

/** Where the k-th checker of a stack of `n` sits on point i. */
function checkerPos(i: number, k: number, n: number): THREE.Vector3 {
  const step = n > 5 ? Math.min(2 * CK, 4.3 / (n - 1)) : 2 * CK;
  const z0 = DEPTH / 2 - 0.25 - CK;
  const z = bottomRow(i) ? z0 - k * step : -z0 + k * step;
  return new THREE.Vector3(pointX(i), TOPY, z);
}
const barPos = (p: number, k: number) => new THREE.Vector3(0, TOPY + 0.08, (p === 0 ? 1 : -1) * (0.7 + k * 2 * CK * 0.9));
const offPos = (p: number, k: number) => new THREE.Vector3(OFF_X, TOPY - 0.05 + k * 0.075, (p === 0 ? 1 : -1) * (DEPTH / 2 - 1.1));

function bgTexture(renderer: THREE.WebGLRenderer) {
  const PX = 96;
  const w = 12 * PW + BAR;
  return canvasTexture(
    Math.round(w * PX),
    Math.round(DEPTH * PX),
    (ctx, cw, ch) => {
      ctx.fillStyle = "#e7cf9f";
      ctx.fillRect(0, 0, cw, ch);
      for (let i = 0; i < 24; i++) {
        const x = (pointX(i) + w / 2) * PX;
        const bottom = bottomRow(i);
        const base = bottom ? ch : 0;
        const tip = bottom ? ch - 4.6 * PX : 4.6 * PX;
        ctx.beginPath();
        ctx.moveTo(x - (PW / 2) * PX + 3, base);
        ctx.lineTo(x + (PW / 2) * PX - 3, base);
        ctx.lineTo(x, tip);
        ctx.closePath();
        ctx.fillStyle = i % 2 === 0 ? "#8a2a17" : "#2f4a3a";
        ctx.fill();
        ctx.font = `700 ${PX * 0.22}px ${FONT}`;
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(60,40,20,0.55)";
        ctx.fillText(String(i + 1), x, bottom ? ch - 4.75 * PX : 4.95 * PX);
      }
      // The bar.
      ctx.fillStyle = "#5b3a22";
      ctx.fillRect(6 * PW * PX, 0, BAR * PX, ch);
    },
    renderer,
  );
}

interface BgTurn {
  canPlay: boolean;
  onMove: (from: number | "bar", die: number) => void;
  onRoll: () => void;
  canRoll: boolean;
}

class BackgammonScene extends TurnScene<BgState> {
  private checkers: THREE.Mesh[] = [];
  /** Checker ids per place: 0–23 points, 24/25 the bar (white/black), 26/27 off. */
  private places: number[][] = Array.from({ length: 28 }, () => []);
  private dice: Die[];
  private info: BgTurn | null = null;
  private from: number | "bar" | null = null;
  private marks = new THREE.Group();
  constructor(host: HTMLElement) {
    super(host, { fov: 26 });
    const s = this.stage;
    const w = 12 * PW + BAR;
    // The case: a frame, the inlaid playing surface, the off tray.
    const frame = mesh(slab(w + 1, TOPY - 0.02, DEPTH + 0.9, 0.12), wood("walnut", 2));
    s.scene.add(frame);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, DEPTH), new THREE.MeshPhysicalMaterial({ map: bgTexture(s.renderer), roughness: 0.5, clearcoat: 0.25 }));
    face.rotation.x = -Math.PI / 2;
    face.position.y = TOPY;
    face.receiveShadow = true;
    s.scene.add(face);
    const bar = mesh(slab(BAR, 0.12, DEPTH, 0.04), wood("walnut", 1));
    bar.position.y = TOPY;
    s.scene.add(bar);
    const off = mesh(slab(1.4, TOPY - 0.08, DEPTH + 0.9, 0.12), wood("dark", 1));
    off.position.x = OFF_X;
    s.scene.add(off);
    const tray = diceTray(2.6, 4);
    tray.group.position.set(TRAY_X, 0, 0);
    s.scene.add(tray.group);
    this.dice = [makeDie(0.7), makeDie(0.7, "#1f2937", "#f8fafc")];
    this.dice.forEach((d, k) => {
      restOn(d, TRAY_X, 0.1, k ? 0.7 : -0.7);
      s.scene.add(d.outer);
      s.pickable(d.outer, { enabled: () => !!this.info?.canRoll && this.settled, onClick: () => this.info?.onRoll() });
    });
    s.pickable(tray.floor, { enabled: () => !!this.info?.canRoll && this.settled, onClick: () => this.info?.onRoll() });
    // Thirty checkers.
    const white = new THREE.MeshPhysicalMaterial({ color: 0xf5f0e4, roughness: 0.32, clearcoat: 0.6 });
    const black = new THREE.MeshPhysicalMaterial({ color: 0x1f2937, roughness: 0.3, clearcoat: 0.7 });
    for (let k = 0; k < 30; k++) {
      const m = mesh(discGeometry(0.3), k < 15 ? white : black);
      m.scale.set(CK, 0.45, CK);
      s.scene.add(m);
      this.checkers.push(m);
    }
    s.scene.add(this.marks);
    s.onTap = () => this.tap();
    s.onPointerMove = () => this.hover();
    s.frame(new THREE.Box3(new THREE.Vector3(TRAY_X - 1.6, 0, -DEPTH / 2 - 0.5), new THREE.Vector3(OFF_X + 0.8, 0.8, DEPTH / 2 + 0.5)), [0, 2.7, 1], 1.02);
  }
  setTurn(info: BgTurn) {
    this.info = info;
    this.from = null;
    if (this.settled) this.drawMarks();
  }
  dieTops() {
    return this.dice.map(topValue);
  }
  protected replay(moves: string[]) {
    return backgammon.replay(moves, 2, this.seed);
  }
  private placeOf(id: number) {
    return this.places.findIndex((l) => l.includes(id));
  }
  private posOf(place: number, k: number, n: number) {
    if (place < 24) return checkerPos(place, k, n);
    if (place < 26) return barPos(place - 24, k);
    return offPos(place - 26, k);
  }
  private layoutAll() {
    this.places.forEach((ids, place) => ids.forEach((id, k) => this.checkers[id].position.copy(this.posOf(place, k, ids.length))));
  }
  /** How many checkers each place should hold, and whose. */
  private want(s: BgState): { place: number; p: number; n: number }[] {
    const out: { place: number; p: number; n: number }[] = [];
    s.points.forEach((c, i) => c && out.push({ place: i, p: c > 0 ? 0 : 1, n: Math.abs(c) }));
    [0, 1].forEach((p) => {
      if (s.bar[p]) out.push({ place: 24 + p, p, n: s.bar[p] });
      if (s.off[p]) out.push({ place: 26 + p, p, n: s.off[p] });
    });
    return out;
  }
  protected snap(s: BgState) {
    const want = this.want(s);
    const ok = want.every((w) => this.places[w.place].length === w.n && this.places[w.place].every((id) => (id < 15 ? 0 : 1) === w.p)) && this.places.reduce((a, l) => a + l.length, 0) === 30;
    if (!ok) {
      this.places = Array.from({ length: 28 }, () => []);
      const next = [0, 15];
      for (const w of want) for (let k = 0; k < w.n; k++) this.places[w.place].push(next[w.p]++);
    }
    this.layoutAll();
    if (s.lastRoll && (this.dice[0].value !== s.lastRoll[0] || this.dice[1].value !== s.lastRoll[1])) {
      this.dice.forEach((d, k) => {
        restOn(d, TRAY_X, 0.1, k ? 0.7 : -0.7);
        show(d, s.lastRoll![k], k * 0.4);
      });
    }
    this.drawMarks();
    this.stage.invalidate();
  }
  private async slide(id: number, to: number) {
    const from = this.placeOf(id);
    if (from >= 0) this.places[from].splice(this.places[from].indexOf(id), 1);
    this.places[to].push(id);
    const m = this.checkers[id];
    const a = m.position.clone();
    const b = this.posOf(to, this.places[to].length - 1, this.places[to].length);
    await this.stage.animate(360, (t) => hop(a, b, 0.6, t, m.position), easeInOut);
    sfx("place", 0.5);
    // A crowded point closes up.
    this.places[to].forEach((cid, k) => this.checkers[cid].position.copy(this.posOf(to, k, this.places[to].length)));
  }
  protected async animateStep(before: BgState, after: BgState, move: string) {
    this.from = null;
    this.marks.clear();
    if (move === "r") {
      await throwDice(this.stage, this.dice, after.lastRoll!, { cx: TRAY_X, cz: 0, w: 2.4, d: 3.8, y: 0.1, from: new THREE.Vector3(0.3, 0, 1) }, `${this.seed}#bg${after.rolls}`, (k) => sfx("thud", 0.2 + k * 0.5));
      return;
    }
    const mv = /^m:(bar|\d+):([1-6])$/.exec(move);
    if (!mv) return;
    const p = before.turn;
    const from = mv[1] === "bar" ? 24 + p : Number(mv[1]);
    const to = bgTarget(before, mv[1] === "bar" ? "bar" : Number(mv[1]), Number(mv[2]), p);
    if (to === null) return;
    const id = this.places[from][this.places[from].length - 1];
    if (id === undefined) return;
    // A lone checker there is hit first, off to the bar.
    if (to >= 0 && before.points[to] !== 0 && (before.points[to] > 0 ? 0 : 1) !== p) {
      const victim = this.places[to][this.places[to].length - 1];
      if (victim !== undefined) {
        sfx("capture", 0.7);
        void this.slide(victim, 24 + (1 - p));
      }
    }
    await this.slide(id, to === -1 ? 26 + p : to);
  }
  // ---- picking a checker, then its new point
  private placeAt(): number | "bar" | "off" | null {
    const pt = this.stage.pointOnPlane(TOPY);
    if (!pt) return null;
    if (Math.abs(pt.x - OFF_X) < 0.8 && Math.abs(pt.z) < DEPTH / 2 + 0.4) return "off";
    if (Math.abs(pt.x) < BAR / 2 + 0.05 && Math.abs(pt.z) < DEPTH / 2) return "bar";
    for (let i = 0; i < 24; i++) {
      if (Math.abs(pt.x - pointX(i)) > PW / 2) continue;
      if (bottomRow(i) ? pt.z > 0 : pt.z < 0) return i;
    }
    return null;
  }
  private legal() {
    const s = this.replay(this.shown);
    return s && this.info?.canPlay && s.dice.length ? bgMoves(s) : [];
  }
  private dieFor(from: number | "bar", to: number): number | null {
    const s = this.replay(this.shown);
    if (!s) return null;
    for (const d of [...new Set(s.dice)]) if (bgTarget(s, from, d, s.turn) === to) return d;
    return null;
  }
  private tap() {
    if (!this.settled || !this.info?.canPlay) return;
    const where = this.placeAt();
    if (where === null) return;
    const legal = this.legal();
    const canFrom = (f: number | "bar") => legal.some((m) => m.from === f);
    if (this.from === null) {
      if (where !== "off" && canFrom(where)) this.from = where;
    } else {
      const to = where === "off" ? -1 : where === "bar" ? null : where;
      const d = to === null ? null : this.dieFor(this.from, to);
      if (d) {
        const f = this.from;
        this.from = null;
        this.info.onMove(f, d);
      } else this.from = where !== "off" && canFrom(where) && where !== this.from ? where : null;
    }
    sfx("tap", 0.35);
    this.drawMarks();
  }
  private hover() {
    const where = this.placeAt();
    const legal = this.legal();
    const ok = where !== null && this.settled && (this.from !== null ? legal.some((m) => m.from === this.from && (where === "off" ? m.to === -1 : m.to === where)) : where !== "off" && legal.some((m) => m.from === where));
    this.stage.renderer.domElement.style.cursor = ok ? "pointer" : "";
  }
  private drawMarks() {
    this.marks.clear();
    const legal = this.legal();
    if (!legal.length) return this.stage.invalidate();
    const s = this.replay(this.shown)!;
    const ring = (v: THREE.Vector3, colour: number) => {
      const r = markerRing(CK + 0.06, colour, 0.06);
      r.position.copy(v).setY(TOPY + 0.13);
      this.marks.add(r);
    };
    if (this.from === null) {
      for (const f of new Set(legal.map((m) => m.from))) {
        const place = f === "bar" ? 24 + s.turn : f;
        const ids = this.places[place];
        if (ids.length) ring(this.checkers[ids[ids.length - 1]].position, 0xfacc15);
      }
    } else {
      const place = this.from === "bar" ? 24 + s.turn : this.from;
      const ids = this.places[place];
      if (ids.length) ring(this.checkers[ids[ids.length - 1]].position, 0x6366f1);
      for (const m of legal.filter((x) => x.from === this.from)) {
        const v = m.to === -1 ? offPos(s.turn, this.places[26 + s.turn].length) : checkerPos(m.to, Math.min(this.places[m.to].length, 5), Math.max(1, this.places[m.to].length + 1));
        ring(v, 0x10b981);
      }
    }
    this.stage.invalidate();
  }
  protected idle() {
    this.drawMarks();
  }
}

export function Backgammon3D({ moves, canPlay, seed = "", onMove }: BoardProps) {
  const state = useMemo(() => backgammon.replay(moves, 2, seed), [moves, seed]);
  const send = useRef(onMove);
  send.current = onMove;
  const [hostRef, scene] = useScene((el) => new BackgammonScene(el));
  useEffect(() => scene?.sync(2, seed, moves), [scene, seed, moves]);
  const canRoll = canPlay && !!state && state.dice.length === 0;
  useEffect(() => scene?.setTurn({ canPlay, canRoll, onMove: (f, d) => send.current(`m:${f}:${d}`), onRoll: () => send.current("r") }), [scene, canPlay, canRoll]);
  if (!state) return null;
  const legal = canPlay && state.dice.length ? bgMoves(state) : [];
  const stuck = canPlay && state.dice.length > 0 && legal.length === 0;
  const actions: Action[] = legal.map((m) => ({ key: `${m.from}:${m.die}`, label: `Move from ${m.from} with ${m.die}`, run: () => onMove(`m:${m.from}:${m.die}`), attrs: { "data-bg-move": `m:${m.from}:${m.die}` } }));
  return (
    <div data-game-board="backgammon" data-g3-board="backgammon" className="flex w-full max-w-[860px] flex-col items-center gap-2">
      <BoardBar>
        {state.lastRoll && (
          <span data-bg-dice className="inline-flex items-center gap-1.5">
            rolled <b data-die={state.lastRoll[0]}>{state.lastRoll[0]}</b>+<b data-die2={state.lastRoll[1]}>{state.lastRoll[1]}</b>
            {state.dice.length > 0 && <span className="font-normal text-slate-500">· left {state.dice.join(" ")}</span>}
          </span>
        )}
        <button type="button" data-bg-roll disabled={!canRoll} onClick={() => onMove("r")} className={primary3}>
          Roll
        </button>
        {stuck && (
          <button type="button" data-bg-done onClick={() => onMove("x")} className="rounded-full bg-amber-500 px-4 py-1.5 text-white">
            No move — end turn
          </button>
        )}
        <span className="font-normal text-slate-500" data-bg-off>
          off: white {state.off[0]} · black {state.off[1]}
        </span>
      </BoardBar>
      <SceneBox hostRef={hostRef} aspect={1.75} maxH={540} testId="backgammon" />
      <HiddenActions actions={actions} label="Legal moves" />
      <div className="text-[11px] text-slate-500">White moves round to the bottom right; black the other way. Roll, click a checker, then its new point (or the tray to bear off).</div>
    </div>
  );
}

// ============================================================ Bankroll

const BC = 1.45; // a square
const BTOP = 0.36;
const GROUP: Record<string, string> = { brown: "#92400e", sky: "#0ea5e9", pink: "#ec4899", orange: "#f97316", red: "#dc2626", yellow: "#eab308", blue: "#1d4ed8" };

/** Square index → row/col on the 7 × 7 ring (0 bottom right, going clockwise along the bottom first). */
function ringCell(i: number): [number, number] {
  if (i <= 6) return [6, 6 - i];
  if (i <= 12) return [6 - (i - 6), 0];
  if (i <= 18) return [0, i - 12];
  return [i - 18, 6];
}
const squarePos = (i: number) => {
  const [r, c] = ringCell(i);
  return new THREE.Vector3((c - 3) * BC, BTOP, (r - 3) * BC);
};

function bankrollTexture(renderer: THREE.WebGLRenderer) {
  const P = 150;
  return canvasTexture(
    7 * P,
    7 * P,
    (ctx, w) => {
      ctx.fillStyle = "#e8f3ec";
      ctx.fillRect(0, 0, w, w);
      BOARD.forEach((sq, i) => {
        const [r, c] = ringCell(i);
        const x = c * P;
        const y = r * P;
        ctx.fillStyle = "#fbfaf6";
        ctx.fillRect(x + 3, y + 3, P - 6, P - 6);
        if (sq.group) {
          ctx.fillStyle = GROUP[sq.group];
          ctx.fillRect(x + 3, y + 3, P - 6, P * 0.2);
        }
        ctx.fillStyle = "#1f2937";
        ctx.textAlign = "center";
        ctx.font = `700 ${P * 0.13}px ${FONT}`;
        const words = sq.name.split(" ");
        words.forEach((wd, k) => ctx.fillText(wd, x + P / 2, y + P * (sq.group ? 0.42 : 0.4) + k * P * 0.15));
        if (sq.price) {
          ctx.font = `600 ${P * 0.12}px ${FONT}`;
          ctx.fillStyle = "#64748b";
          ctx.fillText(`₹${sq.price}`, x + P / 2, y + P * 0.86);
        }
        if (sq.kind === "chance") {
          ctx.font = `800 ${P * 0.34}px ${FONT}`;
          ctx.fillStyle = "#f59e0b";
          ctx.fillText("?", x + P / 2, y + P * 0.82);
        }
        if (sq.kind === "go") {
          ctx.font = `800 ${P * 0.16}px ${FONT}`;
          ctx.fillStyle = "#10b981";
          ctx.fillText("+200 →", x + P / 2, y + P * 0.8);
        }
      });
      // The middle.
      ctx.fillStyle = "#d9ecdf";
      roundRect(ctx, P + 10, P + 10, 5 * P - 20, 5 * P - 20, 30);
      ctx.fill();
      ctx.save();
      ctx.translate(w / 2, w / 2);
      ctx.rotate(-Math.PI / 4);
      ctx.font = `800 ${P * 0.5}px ${FONT}`;
      ctx.fillStyle = "rgba(16,185,129,0.25)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("BANKROLL", 0, 0);
      ctx.restore();
    },
    renderer,
  );
}

function house(colour: string): THREE.Object3D {
  const g = new THREE.Group();
  const mat = new THREE.MeshPhysicalMaterial({ color: colour, roughness: 0.35, clearcoat: 0.5 });
  const body = mesh(new THREE.BoxGeometry(0.26, 0.2, 0.26), mat);
  body.position.y = 0.1;
  const roof = mesh(new THREE.ConeGeometry(0.22, 0.16, 4), mat);
  roof.position.y = 0.28;
  roof.rotation.y = Math.PI / 4;
  g.add(body, roof);
  return g;
}

class BankrollScene extends TurnScene<BankrollState> {
  private pawns: THREE.Mesh[] = [];
  private houses = new Map<number, THREE.Object3D>();
  private dice: Die[];
  private colours: string[] = [];
  private canRoll = false;
  private onRoll: (() => void) | null = null;
  constructor(host: HTMLElement) {
    super(host, { fov: 26 });
    const s = this.stage;
    const span = 7 * BC;
    const body = mesh(slab(span + 0.4, BTOP - 0.01, span + 0.4, 0.12), wood("walnut", 2));
    s.scene.add(body);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(span, span), new THREE.MeshStandardMaterial({ map: bankrollTexture(s.renderer), roughness: 0.6 }));
    face.rotation.x = -Math.PI / 2;
    face.position.y = BTOP;
    face.receiveShadow = true;
    s.scene.add(face);
    for (let p = 0; p < 6; p++) {
      const m = mesh(pawnGeometry(), plastic("#94a3b8"));
      m.scale.setScalar(0.62);
      m.visible = false;
      s.scene.add(m);
      this.pawns.push(m);
    }
    this.dice = [makeDie(0.62), makeDie(0.62)];
    this.dice.forEach((d, k) => {
      restOn(d, k ? 0.6 : -0.6, BTOP, 0.4);
      s.scene.add(d.outer);
      s.pickable(d.outer, { enabled: () => this.canRoll && this.settled, onClick: () => this.onRoll?.() });
    });
    s.allowViewDrag("bankroll");
    s.frame(new THREE.Box3(new THREE.Vector3(-span / 2 - 0.2, 0, -span / 2 - 0.2), new THREE.Vector3(span / 2 + 0.2, 0.8, span / 2 + 0.2)), [0, 2.7, 1], 1.03);
  }
  setLook(n: number, colours: string[]) {
    this.colours = colours;
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
  dieTops() {
    return this.dice.map(topValue);
  }
  protected replay(moves: string[]) {
    return bankroll.replay(moves, this.n, this.seed);
  }
  private pawnSpot(s: BankrollState, p: number) {
    const v = squarePos(s.pos[p]);
    const here = s.pos.map((x, k) => (x === s.pos[p] && !s.out[k] ? k : -1)).filter((k) => k >= 0);
    const k = here.indexOf(p);
    if (here.length > 1) {
      v.x += ((k % 3) - 1) * 0.36;
      v.z += (Math.floor(k / 3) - 0.5) * 0.4 + 0.12;
    } else v.z += 0.18;
    return v;
  }
  private drawHouses(s: BankrollState, animate: boolean) {
    s.owner.forEach((o, i) => {
      const key = i;
      const have = this.houses.get(key);
      if (o < 0) {
        if (have) {
          this.stage.scene.remove(have);
          this.houses.delete(key);
        }
        return;
      }
      if (have && have.userData.owner === o) return;
      if (have) this.stage.scene.remove(have);
      const h = house(this.colours[o] ?? "#94a3b8");
      h.userData.owner = o;
      const v = squarePos(i);
      const [r, c] = ringCell(i);
      // On the inner edge of the square.
      v.x += c === 0 ? 0.45 : c === 6 ? -0.45 : 0.45;
      v.z += r === 0 ? 0.42 : r === 6 ? -0.42 : -0.42;
      h.position.copy(v);
      this.stage.scene.add(h);
      this.houses.set(key, h);
      if (animate) {
        h.scale.setScalar(0.001);
        void this.stage.animate(300, (t) => h.scale.setScalar(Math.max(0.001, t)));
      }
    });
  }
  protected snap(s: BankrollState) {
    s.pos.forEach((_q, p) => {
      this.pawns[p].position.copy(this.pawnSpot(s, p));
      this.pawns[p].visible = p < this.n && !s.out[p];
    });
    this.drawHouses(s, false);
    if (s.lastRoll && (this.dice[0].value !== s.lastRoll[0] || this.dice[1].value !== s.lastRoll[1])) {
      this.dice.forEach((d, k) => {
        restOn(d, k ? 0.6 : -0.6, BTOP, 0.4);
        show(d, s.lastRoll![k], k * 0.5);
      });
    }
    this.stage.invalidate();
  }
  protected async animateStep(before: BankrollState, after: BankrollState, move: string) {
    if (move === "b") {
      sfx("score", 0.5);
      this.drawHouses(after, true);
      await this.stage.wait(300);
      return;
    }
    if (move !== "r") return;
    const p = before.turn;
    if (!after.lastRoll || after.rolls === before.rolls) return; // sat out a turn
    await throwDice(this.stage, this.dice, after.lastRoll, { cx: 0, cz: 0, w: 5 * BC - 0.6, d: 5 * BC - 0.6, y: BTOP, from: new THREE.Vector3(0.4, 0, 1) }, `${this.seed}#bank${after.rolls}`, (k) => sfx("thud", 0.2 + k * 0.5));
    const pawn = this.pawns[p];
    const steps = after.lastRoll[0] + after.lastRoll[1];
    for (let k = 1; k <= steps; k++) {
      const a = pawn.position.clone();
      const b = squarePos((before.pos[p] + k) % BOARD.length).add(new THREE.Vector3(0, 0, 0.18));
      await this.stage.animate(150, (t) => hop(a, b, 0.4, t, pawn.position));
      sfx("place", 0.22);
    }
    if (after.pos[p] !== (before.pos[p] + steps) % BOARD.length) {
      // Sent to jail.
      const a = pawn.position.clone();
      const b = this.pawnSpot(after, p);
      sfx("buzz", 0.6);
      await this.stage.animate(700, (t) => hop(a, b, 1.2, t, pawn.position), easeInOut);
    }
    if (after.cash[p] > before.cash[p] + 150) sfx("score", 0.5);
  }
}

export function Bankroll3D(p: BoardProps) {
  const { moves, canPlay, turn, seats, starter = 0, seed = "", onMove } = p;
  const n = Math.max(2, Math.min(6, seats?.length ?? 2));
  const state = useMemo(() => bankroll.replay(moves, n, seed), [moves, n, seed]);
  const colours = useMemo(() => Array.from({ length: n }, (_, i) => seatFor(seats, starter, i, n).color), [seats, starter, n]);
  const send = useRef(onMove);
  send.current = onMove;
  const [hostRef, scene] = useScene((el) => new BankrollScene(el));
  useEffect(() => scene?.setLook(n, colours), [scene, n, colours]);
  useEffect(() => scene?.sync(n, seed, moves), [scene, n, seed, moves]);
  const canRoll = canPlay && !!state && state.offer < 0;
  useEffect(() => scene?.setTurn(canRoll, () => send.current("r")), [scene, canRoll]);
  if (!state) return null;
  const offer = state.offer >= 0 ? BOARD[state.offer] : null;
  return (
    <div data-game-board="bankroll" data-g3-board="bankroll" className="flex w-full max-w-[720px] flex-col items-center gap-2">
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[12px] font-semibold" data-bankroll-cash>
        {state.cash.map((c, q) => (
          <span key={q} className={`inline-flex items-center gap-1.5 ${state.out[q] ? "line-through opacity-50" : ""} ${q === turn && state.winner === null ? "underline decoration-2 underline-offset-4" : ""}`}>
            <SeatDot color={colours[q]} /> ₹{c}
          </span>
        ))}
      </div>
      <BoardBar>
        {state.lastRoll && (
          <span data-bankroll-dice>
            rolled <b data-die={state.lastRoll[0]}>{state.lastRoll[0]}</b>+<b data-die2={state.lastRoll[1]}>{state.lastRoll[1]}</b>
          </span>
        )}
        {offer && canPlay ? (
          <>
            <span>
              Buy {offer.name} for ₹{offer.price}?
            </span>
            <button type="button" data-bankroll-buy disabled={state.cash[turn] < (offer.price ?? 0)} onClick={() => onMove("b")} className={primary3}>
              Buy
            </button>
            <button type="button" data-bankroll-skip onClick={() => onMove("s")} className={quiet3}>
              Skip
            </button>
          </>
        ) : (
          <button type="button" data-bankroll-roll disabled={!canRoll} onClick={() => onMove("r")} className={primary3}>
            Roll
          </button>
        )}
      </BoardBar>
      <SceneBox hostRef={hostRef} aspect={1.25} maxH={600} testId="bankroll" />
      <div data-bankroll-log className="w-full max-w-[520px] text-center text-[11px] text-slate-600 dark:text-slate-300">
        {state.log.slice(-3).map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  );
}
