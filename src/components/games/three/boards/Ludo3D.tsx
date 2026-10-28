// LANX 2.16.0: Ludo in 3D — a wooden board, glossy pawns that hop square by
// square, a die thrown into a tray beside the board (Rapier physics, landing
// on the number the rules rolled), and knocked pawns flying back home.
// Moves and rules are exactly the flat board's ("r", "m:<token>").

import * as THREE from "three";
import { useEffect, useMemo, useRef } from "react";
import { seatFor, type BoardProps } from "../../boardProps";
import { FINISH, SAFE, ludo, ludoChoices, ludoCorner, ludoEventText, ludoMovable, ludoPlayerAt, toAbsolute, type LudoState } from "../../../../lib/games/ludo.ts";
import { HOME, LOOP, SPOT, YARD, cornerColours, ludoColour, useLudoAutoMove } from "../../boards/LudoBoard";
import { sfx } from "../../../../lib/gameSounds";
import { TurnScene } from "../turnScene";
import { FONT, boardSlab, canvasTexture, felt, hop, markerDot, markerRing, mesh, pawnGeometry, plastic, repaint, roundRect, slab, wood } from "../kit";
import { makeDie, restOn, show, throwDice, topValue, type Die } from "../dice";
import { SceneBox, useScene } from "../Board3D";
import { BoardBar, HiddenActions, SeatDot, primary3, type Action } from "../ui";
import { easeOut } from "../stage";

const N = 15;
const TOP = 0.42;
const PX = 80; // texture pixels per square
const TRAY_X = 9.75;

/** Square (row, col; fractions allowed) → board-local position on the top. */
const at = (r: number, c: number) => new THREE.Vector3(c + 0.5 - N / 2, TOP, r + 0.5 - N / 2);
/** Finished pawns sit on their colour's triangle in the middle. */
const FINISH_AT: [number, number][] = [
  [7, 6.25],
  [6.25, 7],
  [7, 7.75],
  [7.75, 7],
];

/** A corner's square for a token (2.17.0: corners, not players — two players sit opposite). */
function squareOf(corner: number, rel: number, token: number): [number, number] {
  const player = corner;
  if (rel === -1) {
    const [yr, yc] = YARD[player];
    const [dr, dc] = SPOT[token];
    return [yr + dr, yc + dc];
  }
  if (rel >= FINISH) {
    const [r, c] = FINISH_AT[player];
    const k = (token - 1.5) * 0.36;
    return player % 2 === 0 ? [r + k, c] : [r, c + k];
  }
  if (rel >= 51) return HOME[player][rel - 51];
  return LOOP[toAbsolute(player, rel)];
}

function paintBoard(ctx: CanvasRenderingContext2D, colours: string[]) {
  const P = PX;
  ctx.fillStyle = "#fbfaf6";
  ctx.fillRect(0, 0, N * P, N * P);
  // Yards.
  YARD.forEach(([r, c], p) => {
    ctx.fillStyle = colours[p];
    ctx.fillRect(c * P, r * P, 6 * P, 6 * P);
    ctx.fillStyle = "#fbfaf6";
    roundRect(ctx, (c + 0.8) * P, (r + 0.8) * P, 4.4 * P, 4.4 * P, P * 0.5);
    ctx.fill();
    SPOT.forEach(([dr, dc]) => {
      ctx.beginPath();
      ctx.arc((c + dc + 0.5) * P, (r + dr + 0.5) * P, P * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = colours[p];
      ctx.globalAlpha = 0.28;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 3;
      ctx.strokeStyle = colours[p];
      ctx.stroke();
    });
  });
  // The loop.
  LOOP.forEach(([r, c], i) => {
    const start = [0, 13, 26, 39].indexOf(i);
    ctx.fillStyle = start >= 0 ? colours[start] : "#ffffff";
    ctx.fillRect(c * P, r * P, P, P);
    if (SAFE.has(i) && start < 0) star(ctx, (c + 0.5) * P, (r + 0.5) * P, P * 0.3, "#94a3b8");
    if (start >= 0) star(ctx, (c + 0.5) * P, (r + 0.5) * P, P * 0.3, "rgba(255,255,255,0.85)");
  });
  // Home columns.
  HOME.forEach((cells, p) =>
    cells.slice(0, 5).forEach(([r, c]) => {
      ctx.fillStyle = colours[p];
      ctx.globalAlpha = 0.62;
      ctx.fillRect(c * P, r * P, P, P);
      ctx.globalAlpha = 1;
    }),
  );
  // Grid lines.
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 2;
  for (const [r, c] of [...LOOP, ...HOME.flatMap((h) => h.slice(0, 5))]) ctx.strokeRect(c * P, r * P, P, P);
  // The middle: four triangles.
  const m0 = 6 * P;
  const m1 = 9 * P;
  const mc = 7.5 * P;
  const tri = (pts: number[], colour: string) => {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    ctx.lineTo(pts[2], pts[3]);
    ctx.lineTo(mc, mc);
    ctx.closePath();
    ctx.fillStyle = colour;
    ctx.fill();
  };
  tri([m0, m0, m0, m1], colours[0]);
  tri([m0, m0, m1, m0], colours[1]);
  tri([m1, m0, m1, m1], colours[2]);
  tri([m0, m1, m1, m1], colours[3]);
  ctx.strokeStyle = "rgba(15,23,42,0.25)";
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, N * P - 3, N * P - 3);
  ctx.font = `700 ${P * 0.32}px ${FONT}`;
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, colour: string) {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rr = k % 2 === 0 ? r : r * 0.45;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
}

interface TurnInfo {
  canPlay: boolean;
  roll: number;
  turn: number;
  movable: number[];
  onPick: (t: number) => void;
  onRoll: () => void;
}

class LudoScene extends TurnScene<LudoState> {
  private board: THREE.Group;
  private top: THREE.CanvasTexture;
  private tokens: THREE.Mesh[][] = [];
  private die: Die;
  private tray: THREE.Group;
  private marks = new THREE.Group();
  private colours: string[] = ["#f43f5e", "#0ea5e9", "#10b981", "#f59e0b"];
  private info: TurnInfo | null = null;

  constructor(host: HTMLElement) {
    super(host, { fov: 26 });
    const s = this.stage;
    this.top = canvasTexture(N * PX, N * PX, (ctx) => paintBoard(ctx, this.colours), s.renderer);
    this.board = boardSlab(N + 0.7, N + 0.7, TOP, this.top, wood("walnut", 2));
    s.scene.add(this.board);
    this.board.add(this.marks);
    // Pawns: four per colour.
    for (let p = 0; p < 4; p++) {
      const row: THREE.Mesh[] = [];
      for (let t = 0; t < 4; t++) {
        const m = mesh(pawnGeometry(), plastic(this.colours[p]));
        m.scale.setScalar(0.82);
        m.userData = { p, t };
        this.board.add(m);
        row.push(m);
      }
      this.tokens.push(row);
    }
    // The dice tray beside the board.
    this.tray = new THREE.Group();
    this.tray.position.set(TRAY_X, 0, 0);
    const floor = mesh(slab(2.9, 0.1, 4.6, 0.04), felt("#33415c"));
    this.tray.add(floor);
    const wallMat = wood("walnut", 1);
    for (const [x, z, w, d] of [
      [-1.55, 0, 0.2, 5.0],
      [1.55, 0, 0.2, 5.0],
      [0, -2.4, 2.9, 0.2],
      [0, 2.4, 2.9, 0.2],
    ] as const) {
      const wall = mesh(slab(w, 0.42, d, 0.06), wallMat);
      wall.position.set(x, 0, z);
      this.tray.add(wall);
    }
    s.scene.add(this.tray);
    this.die = makeDie(0.84);
    restOn(this.die, TRAY_X, 0.1, 0);
    s.scene.add(this.die.outer);
    s.pickable(this.die.outer, { enabled: () => !!this.info?.canPlay && !this.info.roll && this.settled, onClick: () => this.info?.onRoll() });
    s.pickable(floor, { enabled: () => !!this.info?.canPlay && !this.info.roll && this.settled, onClick: () => this.info?.onRoll() });
    // Seen from almost straight above, like a real board on the table (drag the table to tilt it).
    s.allowViewDrag("ludo");
    s.frame(new THREE.Box3(new THREE.Vector3(-N / 2 - 0.35, 0, -N / 2 - 0.35), new THREE.Vector3(TRAY_X + 1.65, 0.6, N / 2 + 0.35)), [0, 2.75, 1], 1.02);
  }

  /** Colours, how many play, and which way round the board faces (your yard nearest you). */
  setLook(n: number, colours: string[], me: number) {
    this.colours = colours;
    repaint(this.top, (ctx) => paintBoard(ctx, colours));
    this.tokens.forEach((row, c) =>
      row.forEach((m) => {
        m.material = plastic(colours[c]);
        m.visible = ludoPlayerAt(c, n) >= 0;
      }),
    );
    // Turn the board so your yard is at the bottom left.
    this.board.rotation.y = ((ludoCorner(me, n) + 1) % 4) * (Math.PI / 2);
    this.stage.invalidate();
  }

  /** What the die shows (tests). */
  dieTop() {
    return topValue(this.die);
  }

  setTurn(info: TurnInfo) {
    this.info = info;
    if (this.settled) this.idle();
  }

  protected replay(moves: string[]) {
    return ludo.replay(moves, this.n, this.seed);
  }

  /** Where each pawn stands, spread out when several share a square. */
  private layout(s: LudoState): Map<THREE.Mesh, { pos: THREE.Vector3; scale: number }> {
    const out = new Map<THREE.Mesh, { pos: THREE.Vector3; scale: number }>();
    const shared = new Map<string, [number, number][]>();
    s.pos.forEach((row, p) =>
      row.forEach((rel, t) => {
        if (rel < 0 || rel >= FINISH) return;
        const [r, c] = squareOf(ludoCorner(p, this.n), rel, t);
        const k = `${r},${c}`;
        if (!shared.has(k)) shared.set(k, []);
        shared.get(k)!.push([p, t]);
      }),
    );
    s.pos.forEach((row, p) =>
      row.forEach((rel, t) => {
        const [r, c] = squareOf(ludoCorner(p, this.n), rel, t);
        const pos = at(r, c);
        let scale = rel >= FINISH ? 0.52 : 0.82;
        if (rel >= 0 && rel < FINISH) {
          const here = shared.get(`${r},${c}`)!;
          if (here.length > 1) {
            const i = here.findIndex(([q, u]) => q === p && u === t);
            const offs = here.length === 2 ? [[-0.2, 0], [0.2, 0]] : [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]];
            const [ox, oz] = offs[i % offs.length];
            pos.x += ox;
            pos.z += oz;
            scale = 0.56;
          }
        }
        out.set(this.tokens[ludoCorner(p, this.n)][t], { pos, scale });
      }),
    );
    return out;
  }

  protected snap(s: LudoState) {
    for (const [m, { pos, scale }] of this.layout(s)) {
      m.position.copy(pos);
      m.scale.setScalar(scale);
    }
    // The die keeps the pose it landed in; it only jumps when the number on top is wrong (a snap).
    if (s.lastRoll && this.die.value !== s.lastRoll) {
      restOn(this.die, TRAY_X, 0.1, 0);
      show(this.die, s.lastRoll);
    }
    this.stage.invalidate();
  }

  protected async animateStep(before: LudoState, after: LudoState, move: string) {
    this.clearMarks();
    if (move === "r") {
      await throwDice(this.stage, [this.die], [after.lastRoll], { cx: TRAY_X, cz: 0, w: 2.7, d: 4.4, y: 0.1, from: new THREE.Vector3(0.2, 0, 1) }, `${this.seed}#ludo${after.rolls}`, (k) => sfx("thud", 0.2 + k * 0.5));
      return;
    }
    const t = Number(move.slice(2));
    const p = before.turn;
    const from = before.pos[p][t];
    const to = after.pos[p][t];
    const corner = ludoCorner(p, this.n);
    const pawn = this.tokens[corner][t];
    const steps: THREE.Vector3[] = [];
    if (from === -1) steps.push(at(...squareOf(corner, 0, t)));
    else for (let r = from + 1; r <= to; r++) steps.push(at(...squareOf(corner, r, t)));
    for (const target of steps) {
      const start = pawn.position.clone();
      await this.stage.animate(165, (k) => hop(start, target, 0.5, k, pawn.position), easeOut);
      sfx("place", 0.3);
    }
    // Knocked home.
    const flights: Promise<void>[] = [];
    for (let q = 0; q < this.n; q++) {
      if (q === p) continue;
      after.pos[q].forEach((rel, k) => {
        if (before.pos[q][k] >= 0 && rel === -1) {
          const m = this.tokens[ludoCorner(q, this.n)][k];
          const start = m.position.clone();
          const home = at(...squareOf(ludoCorner(q, this.n), -1, k));
          sfx("capture");
          flights.push(this.stage.animate(650, (u) => hop(start, home, 3, u, m.position)));
        }
      });
    }
    await Promise.all(flights);
  }

  private clearMarks() {
    for (const c of [...this.marks.children]) {
      this.marks.remove(c);
      (c as THREE.Mesh).geometry.dispose();
      ((c as THREE.Mesh).material as THREE.Material).dispose();
    }
    for (const row of this.tokens) for (const m of row) this.stage.unpick(m);
  }

  protected idle() {
    this.clearMarks();
    const info = this.info;
    const s = this.replay(this.shown);
    if (!info || !s) return;
    if (!info.canPlay || !info.roll) return;
    for (const t of info.movable) {
      const corner = ludoCorner(info.turn, this.n);
      const pawn = this.tokens[corner][t];
      const ring = markerRing(0.34, 0x4f46e5, 0.06);
      ring.position.set(pawn.position.x, TOP + 0.01, pawn.position.z);
      this.marks.add(ring);
      const rel = s.pos[info.turn][t];
      const dest = at(...squareOf(corner, rel === -1 ? 0 : Math.min(FINISH, rel + info.roll), t));
      this.stage.pickable(pawn, {
        onClick: () => {
          this.clearMarks();
          info.onPick(t);
        },
        onHover: (on) => {
          pawn.position.y = on ? TOP + 0.14 : TOP;
          const old = this.marks.getObjectByName("dest");
          if (old) {
            this.marks.remove(old);
            (old as THREE.Mesh).geometry.dispose();
          }
          if (on) {
            const dot = markerDot(0.2, 0x4f46e5, 0.55);
            dot.name = "dest";
            dot.position.set(dest.x, TOP + 0.012, dest.z);
            this.marks.add(dot);
          }
          this.stage.invalidate();
        },
      });
    }
    this.stage.invalidate();
  }
}

/** Ludo, the 3D board. */
export default function Ludo3D({ moves, canPlay, seat, seats, starter = 0, seed = "", local, onMove }: BoardProps) {
  const n = Math.max(2, Math.min(4, seats?.length ?? 2));
  const state = useMemo(() => ludo.replay(moves, n, seed), [moves, n, seed]);
  // Each corner's colour — Ludo King's four, every corner full (2.17.1).
  const colours = useMemo(() => cornerColours(n).map((c) => c.colour), [n]);
  const me = local ? 0 : Math.max(0, seat);
  const move = useRef(onMove);
  move.current = onMove;
  const [hostRef, scene] = useScene((el) => new LudoScene(el));
  useEffect(() => scene?.setLook(n, colours, me), [scene, n, colours, me]);
  useEffect(() => scene?.sync(n, seed, moves), [scene, n, seed, moves]);
  const movable = useMemo(() => (canPlay && state?.roll ? ludoMovable(state) : []), [canPlay, state]);
  useEffect(() => {
    scene?.setTurn({ canPlay, roll: state?.roll ?? 0, turn: state?.turn ?? 0, movable, onPick: (t) => move.current(`m:${t}`), onRoll: () => move.current("r") });
  }, [scene, canPlay, state, movable]);
  useLudoAutoMove(state, canPlay, onMove, 900);
  if (!state) return null;
  const colour = (p: number) => ludoColour(p, n);
  const said = ludoEventText(state, (p) => seatFor(seats, starter, p, n).name);
  const choose = movable.length > 1 && ludoChoices(state).length > 1;
  const actions: Action[] = movable.map((t) => ({ key: `t${t}`, label: `Move token ${t + 1}`, run: () => onMove(`m:${t}`), attrs: { "data-ludo-token": `${state.turn}:${t}`, "data-ludo-can": "1" } }));
  return (
    <div data-game-board="ludo" data-g3-board="ludo" className="flex w-full max-w-[760px] flex-col items-center gap-2">
      <BoardBar>
        {state.lastRoll > 0 && (
          <span className="inline-flex items-center gap-1.5" data-ludo-last>
            <SeatDot color={colour(state.roller)} /> rolled <b data-die={state.lastRoll}>{state.lastRoll}</b>
            {said && <span className="font-normal text-slate-500" data-ludo-event={state.event || "six"}>· {said}</span>}
          </span>
        )}
        <button type="button" data-ludo-roll disabled={!canPlay || state.roll > 0} onClick={() => onMove("r")} className={primary3}>
          Roll
        </button>
        {state.roll > 0 && canPlay && <span className="text-indigo-600 dark:text-indigo-300">{choose ? `Click a pawn to move ${state.roll}` : `Moving ${state.roll}…`}</span>}
        {!state.roll && canPlay && state.again && <span className="text-indigo-600 dark:text-indigo-300" data-ludo-again>Roll again!</span>}
      </BoardBar>
      <SceneBox hostRef={hostRef} aspect={1.2} maxH={640} testId="ludo" />
      <HiddenActions actions={actions} label="Pawns you can move" />
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11.5px] text-slate-500" data-ludo-home>
        {state.pos.map((row, p) => (
          <span key={p} className="inline-flex items-center gap-1.5">
            <SeatDot color={colour(p)} size={10} /> {seatFor(seats, starter, p, n).name}: {row.filter((x) => x === FINISH).length}/4 home
          </span>
        ))}
      </div>
    </div>
  );
}
