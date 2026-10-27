// LANX 2.16.0: the three solo games in 3D, on the same rules as the flat
// ones (games/Solo.tsx). 2048: thick tiles that slide and merge with a pop,
// by arrow keys, W A S D, the buttons or a swipe. Snake: a snake of rounded
// segments gliding smoothly from square to square on a grid board — the
// moves, the food and the collisions are still the grid's. Minesweeper:
// raised tiles that sink as they open, real little flags, and the mines
// only appear once the field has been lost (or a mine was opened).

import * as THREE from "three";
import { useCallback, useEffect, useRef, useState } from "react";
import { Flag, Pause, Play, RotateCcw } from "lucide-react";
import { sfx } from "../../../../lib/gameSounds";
import { MINES, MS, addTile, around, canMove, empty, freshField, move2048, plant, type Grid, type SoloProps, type Sq } from "../../Solo";
import { BoardScene, type PieceSpec } from "../boardScene";
import { Stage } from "../stage";
import { FONT, canvasTexture, mesh, sharedGeo, slab, wood } from "../kit";
import { SceneBox, useScene } from "../Board3D";
import { digitTexture, mineMesh } from "./Tiles3D";

const btn = "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors active:scale-95";

// ============================================================ 2048

type Dir = "left" | "right" | "up" | "down";
interface Tile {
  id: number;
  v: number;
  r: number;
  c: number;
}

const TILE_BG: Record<number, string> = { 2: "#eef2f6", 4: "#fdf0c8", 8: "#fdba74", 16: "#fb923c", 32: "#f97316", 64: "#ef4444", 128: "#facc15", 256: "#eab308", 512: "#ca8a04", 1024: "#d97706", 2048: "#10b981" };
const tileBg = (v: number) => TILE_BG[v] ?? "#059669";
const tileFg = (v: number) => (v <= 4 ? "#334155" : "#ffffff");

let nextId = 1;
const toTiles = (g: Grid): Tile[] => g.flatMap((row, r) => row.flatMap((v, c) => (v ? [{ id: nextId++, v, r, c }] : [])));
const toGrid = (tiles: Tile[]): Grid => {
  const g = empty();
  for (const t of tiles) g[t.r][t.c] = t.v;
  return g;
};

/** One slide with every tile's identity kept: where each goes, and which pairs merge (the same sums as move2048). */
function slideTiles(tiles: Tile[], dir: Dir): { moved: Tile[]; absorbed: Tile[]; merged: Set<number>; gained: number } {
  const lines: Tile[][] = [[], [], [], []];
  for (const t of tiles) lines[dir === "left" || dir === "right" ? t.r : t.c].push({ ...t });
  const key = (t: Tile) => (dir === "left" ? t.c : dir === "right" ? -t.c : dir === "up" ? t.r : -t.r);
  const moved: Tile[] = [];
  const absorbed: Tile[] = [];
  const merged = new Set<number>();
  let gained = 0;
  lines.forEach((line, li) => {
    line.sort((a, b) => key(a) - key(b));
    let k = 0;
    for (let i = 0; i < line.length; i++) {
      const at = (kk: number) => (dir === "left" ? { r: li, c: kk } : dir === "right" ? { r: li, c: 3 - kk } : dir === "up" ? { r: kk, c: li } : { r: 3 - kk, c: li });
      const a = line[i];
      const b = line[i + 1];
      if (b && b.v === a.v) {
        const p = at(k);
        moved.push({ ...a, ...p, v: a.v * 2 });
        absorbed.push({ ...b, ...p });
        merged.add(a.id);
        gained += a.v * 2;
        i++;
      } else moved.push({ ...a, ...at(k) });
      k++;
    }
  });
  return { moved, absorbed, merged, gained };
}

class Scene2048 extends BoardScene<null> {
  private tex = new Map<number, THREE.Texture>();
  constructor(host: HTMLElement) {
    super(host, { fov: 26 });
    this.top = 0.3;
    const tray = mesh(slab(4.5, this.top, 4.5, 0.25), new THREE.MeshPhysicalMaterial({ color: 0xa8b3c2, roughness: 0.5, clearcoat: 0.3 }));
    this.stage.scene.add(tray);
    const cellMat = new THREE.MeshStandardMaterial({ color: 0xcfd6df, roughness: 0.7 });
    for (let i = 0; i < 16; i++) {
      const c = mesh(slab(0.96, 0.02, 0.96, 0.12), cellMat);
      c.position.copy(this.at(Math.floor(i / 4), i % 4)).setY(this.top);
      this.stage.scene.add(c);
    }
    this.stage.allowViewDrag("2048", 45, 30);
    this.stage.frame(new THREE.Box3(new THREE.Vector3(-2.3, 0, -2.3), new THREE.Vector3(2.3, 0.8, 2.3)), [0, 2.8, 1], 1.04);
  }
  protected replay() {
    return null;
  }
  protected snap() {}
  protected async animateStep() {}
  private at(r: number, c: number) {
    return new THREE.Vector3((c - 1.5) * 1.06, this.top + 0.02, (r - 1.5) * 1.06);
  }
  private label(v: number) {
    let t = this.tex.get(v);
    if (!t) {
      t = canvasTexture(256, 256, (ctx, w, h) => {
        ctx.fillStyle = tileBg(v);
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = tileFg(v);
        ctx.font = `800 ${v >= 1024 ? 76 : v >= 128 ? 92 : 118}px ${FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(v), w / 2, h / 2 + 6);
      });
      t.userData.shared = true;
      this.tex.set(v, t);
    }
    return t;
  }
  private tile(v: number): THREE.Object3D {
    const g = new THREE.Group();
    const body = mesh(sharedGeo("tile2048", () => slab(0.92, 0.32, 0.92, 0.13)), new THREE.MeshPhysicalMaterial({ color: tileBg(v), roughness: 0.35, clearcoat: 0.5 }));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.72), new THREE.MeshStandardMaterial({ map: this.label(v), roughness: 0.4 }));
    face.rotation.x = -Math.PI / 2;
    face.position.y = 0.322;
    g.add(body, face);
    g.userData = { v, body, face };
    return g;
  }
  private setValue(o: THREE.Object3D, v: number, animate: boolean): Promise<void> | void {
    const u = o.userData as { v: number; body: THREE.Mesh; face: THREE.Mesh };
    if (u.v === v) return;
    u.v = v;
    (u.body.material as THREE.MeshPhysicalMaterial).color.set(tileBg(v));
    (u.face.material as THREE.MeshStandardMaterial).map = this.label(v);
    (u.face.material as THREE.MeshStandardMaterial).needsUpdate = true;
    if (!animate) return;
    return this.stage.animate(220, (t) => o.scale.setScalar(1 + Math.sin(t * Math.PI) * 0.16));
  }
  /** Shows the tiles; `absorbed` slide into their partner first and then go. */
  async show(tiles: Tile[], absorbed: Tile[], animate: boolean) {
    const spec = (t: Tile): PieceSpec => ({ key: `t${t.id}`, pos: this.at(t.r, t.c), make: () => this.tile(t.v), update: (o, a) => this.setValue(o, t.v, a) });
    if (animate && absorbed.length) {
      // Slide everyone (the merging ones on top of each other), keeping old values for now.
      await this.place([...tiles.map((t) => ({ ...spec(t), update: undefined })), ...absorbed.map((t) => ({ ...spec(t), update: undefined }))], true, { appear: "pop", slideMs: 110, sound: null });
    }
    await this.place(tiles.map(spec), animate, { appear: "pop", vanish: "shrink", slideMs: 110, sound: null });
  }
  dispose() {
    for (const t of this.tex.values()) t.dispose();
    this.tex.clear();
    super.dispose();
  }
}

export function Game2048_3D({ onScore }: SoloProps) {
  const [tiles, setTiles] = useState<Tile[]>(() => toTiles(addTile(addTile(empty()))));
  const [score, setScore] = useState(0);
  const [over, setOver] = useState(false);
  const reported = useRef(false);
  const tilesRef = useRef(tiles);
  tilesRef.current = tiles;
  // Slides wait their turn; a key pressed mid-slide finishes the slide at once, so no press is ever lost.
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const [hostRef, scene] = useScene((el) => new Scene2048(el));
  useEffect(() => {
    if (scene) void scene.show(tilesRef.current, [], false);
  }, [scene]);
  const reset = () => {
    const t = toTiles(addTile(addTile(empty())));
    setTiles(t);
    setScore(0);
    setOver(false);
    reported.current = false;
    void scene?.show(t, [], true);
  };
  const step = useCallback(
    (dir: Dir) => {
      if (over) return;
      const cur = tilesRef.current;
      const grid = toGrid(cur);
      const want = move2048(grid, dir);
      if (!want.moved) return;
      const r = slideTiles(cur, dir);
      // The flat game's own sums decide; the 3D picture must agree with them.
      const ok = JSON.stringify(toGrid(r.moved)) === JSON.stringify(want.grid);
      const after = addTile(want.grid);
      let spawned: Tile[] = [];
      after.forEach((row, rr) => row.forEach((v, c) => v && want.grid[rr][c] === 0 && (spawned = [{ id: nextId++, v, r: rr, c }])));
      const next = ok ? [...r.moved, ...spawned] : toTiles(after);
      if (scene) {
        scene.stage.finishAll();
        chain.current = chain.current
          .then(() => scene.show(ok ? r.moved : next, ok ? r.absorbed : [], true))
          .then(() => (ok ? scene.show(next, [], true) : undefined))
          .catch(() => {});
      }
      tilesRef.current = next;
      setTiles(next);
      setScore((s) => s + want.gained);
      sfx(want.gained > 0 ? "merge" : "tap");
      if (!canMove(after)) {
        setOver(true);
        sfx("lose");
      }
    },
    [over, scene],
  );
  useEffect(() => {
    if (over && !reported.current) {
      reported.current = true;
      onScore(score);
    }
  }, [over, score, onScore]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const map: Record<string, Dir> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", a: "left", d: "right", w: "up", s: "down" };
      const d = map[e.key];
      if (d) {
        e.preventDefault();
        step(d);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [step]);
  // A swipe on the board.
  const swipe = useRef<{ x: number; y: number } | null>(null);
  return (
    <div data-solo="2048" data-g3-solo="2048" className="flex w-[460px] max-w-full flex-col items-center gap-3">
      <div className="flex items-center gap-3 text-[13px]">
        <span className="rounded-full bg-slate-500/10 px-3 py-1 font-semibold" data-solo-score>
          Score {score}
        </span>
        <button type="button" data-solo-start onClick={reset} className={`${btn} bg-slate-500/10 text-slate-700 dark:text-slate-200`}>
          <RotateCcw className="h-3.5 w-3.5" /> New game
        </button>
      </div>
      <div
        className="relative w-full"
        onPointerDown={(e) => (swipe.current = { x: e.clientX, y: e.clientY })}
        onPointerUp={(e) => {
          const s = swipe.current;
          swipe.current = null;
          if (!s) return;
          const dx = e.clientX - s.x;
          const dy = e.clientY - s.y;
          if (Math.max(Math.abs(dx), Math.abs(dy)) < 30) return;
          step(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
        }}
      >
        <SceneBox hostRef={hostRef} aspect={1.08} minH={340} maxH={460} testId="2048" />
        <div className="sr-only" data-tiles>
          {toGrid(tiles)
            .flat()
            .map((v, i) => (
              <span key={i} data-tile={v} />
            ))}
        </div>
        {over && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-2xl bg-white/70 lanx-fade dark:bg-slate-900/70">
            <div className="text-xl font-bold">No moves left</div>
            <div className="text-[13px]">Score {score}</div>
          </div>
        )}
      </div>
      <div className="text-[11.5px] text-slate-500">Arrow keys, W A S D, the buttons or a swipe across the board. Tiles with the same number merge.</div>
      <div className="grid grid-cols-3 gap-1 text-[12px]">
        <span />
        <button type="button" data-2048-dir="up" onClick={() => step("up")} className="rounded-lg bg-slate-500/10 px-3 py-1">
          ▲
        </button>
        <span />
        <button type="button" data-2048-dir="left" onClick={() => step("left")} className="rounded-lg bg-slate-500/10 px-3 py-1">
          ◀
        </button>
        <button type="button" data-2048-dir="down" onClick={() => step("down")} className="rounded-lg bg-slate-500/10 px-3 py-1">
          ▼
        </button>
        <button type="button" data-2048-dir="right" onClick={() => step("right")} className="rounded-lg bg-slate-500/10 px-3 py-1">
          ▶
        </button>
      </div>
    </div>
  );
}

// ============================================================ Snake

const SN = 20;
const SC = 0.5;
type SDir = "U" | "D" | "L" | "R";
type Pt = [number, number];
const cellAt = ([x, y]: Pt) => new THREE.Vector3((x - (SN - 1) / 2) * SC, 0.32, (y - (SN - 1) / 2) * SC);

class SnakeScene {
  readonly stage: Stage;
  private segs: THREE.Mesh[] = [];
  private head: THREE.Group;
  private food: THREE.Group;
  private prev: Pt[] = [];
  private cur: Pt[] = [];
  private tickAt = 0;
  private tickMs = 140;
  constructor(host: HTMLElement) {
    this.stage = new Stage(host, { fov: 26 });
    const s = this.stage;
    const board = mesh(slab(SN * SC + 0.5, 0.3, SN * SC + 0.5, 0.15), wood("dark", 2));
    s.scene.add(board);
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(SN * SC, SN * SC),
      new THREE.MeshStandardMaterial({
        map: canvasTexture(640, 640, (ctx, w) => {
          const k = w / SN;
          for (let y = 0; y < SN; y++)
            for (let x = 0; x < SN; x++) {
              ctx.fillStyle = (x + y) % 2 ? "#1f2a3d" : "#243247";
              ctx.fillRect(x * k, y * k, k, k);
            }
        }),
        roughness: 0.9,
      }),
    );
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = 0.301;
    grass.receiveShadow = true;
    s.scene.add(grass);
    this.head = new THREE.Group();
    const headBody = mesh(sharedGeo("snakehead", () => slab(SC * 0.92, 0.34, SC * 0.92, 0.12)), new THREE.MeshPhysicalMaterial({ color: 0x34d399, roughness: 0.3, clearcoat: 0.6 }));
    this.head.add(headBody);
    for (const sx of [-1, 1]) {
      const eye = mesh(new THREE.SphereGeometry(0.06, 12, 10), new THREE.MeshStandardMaterial({ color: 0xffffff }), false);
      eye.position.set(sx * 0.1, 0.3, -0.12);
      const pupil = mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshStandardMaterial({ color: 0x0f172a }), false);
      pupil.position.set(0, 0.01, -0.045);
      eye.add(pupil);
      this.head.add(eye);
    }
    s.scene.add(this.head);
    this.food = new THREE.Group();
    const apple = mesh(new THREE.SphereGeometry(0.19, 24, 16), new THREE.MeshPhysicalMaterial({ color: 0xf43f5e, roughness: 0.3, clearcoat: 0.8 }));
    apple.position.y = 0.19;
    const leaf = mesh(new THREE.ConeGeometry(0.05, 0.14, 6), new THREE.MeshStandardMaterial({ color: 0x16a34a }));
    leaf.position.set(0.05, 0.42, 0);
    leaf.rotation.z = -0.6;
    this.food.add(apple, leaf);
    s.scene.add(this.food);
    s.onFrame(() => {
      // Glide each segment from where it was to where it is, over one tick.
      const k = Math.min(1, (performance.now() - this.tickAt) / this.tickMs);
      const pos = (i: number) => {
        const a = cellAt(this.prev[i] ?? this.cur[i]);
        const b = cellAt(this.cur[i]);
        return a.lerp(b, k);
      };
      if (this.cur.length) {
        this.head.position.copy(pos(0)).setY(0.3);
        const d = cellAt(this.cur[0]).sub(cellAt(this.prev[0] ?? this.cur[0]));
        if (d.lengthSq() > 0) this.head.rotation.y = Math.atan2(-d.x, -d.z);
      }
      this.segs.forEach((m, i) => {
        m.visible = i + 1 < this.cur.length;
        if (m.visible) m.position.copy(pos(i + 1)).setY(0.3);
      });
      this.food.rotation.y += 0.02;
      return k < 1;
    });
    s.allowViewDrag("snake", 40, 30);
    s.frame(new THREE.Box3(new THREE.Vector3(-SN * SC / 2 - 0.3, 0, -SN * SC / 2 - 0.3), new THREE.Vector3(SN * SC / 2 + 0.3, 0.6, SN * SC / 2 + 0.3)), [0, 3, 1], 1.03);
  }
  show(snake: Pt[], food: Pt, tickMs: number, glide: boolean) {
    this.prev = glide ? this.cur.slice(0, snake.length) : snake.slice();
    if (glide && snake.length > this.cur.length) this.prev.push(snake[snake.length - 1]);
    this.cur = snake.map((p) => [p[0], p[1]] as Pt);
    while (this.segs.length < snake.length) {
      const m = mesh(sharedGeo("snakeseg", () => slab(SC * 0.84, 0.28, SC * 0.84, 0.12)), new THREE.MeshPhysicalMaterial({ color: 0x10b981, roughness: 0.35, clearcoat: 0.5 }));
      this.stage.scene.add(m);
      this.segs.push(m);
    }
    this.food.position.copy(cellAt(food)).setY(0.3);
    this.tickMs = tickMs;
    this.tickAt = performance.now();
    this.stage.invalidate();
  }
  dispose() {
    this.stage.dispose();
  }
}

export function Snake3D({ onScore }: SoloProps) {
  const [score, setScore] = useState(0);
  const [state, setState] = useState<"ready" | "running" | "paused" | "dead">("ready");
  const snake = useRef<Pt[]>([[10, 10], [9, 10], [8, 10]]);
  const dir = useRef<SDir>("R");
  const nextDir = useRef<SDir>("R");
  const food = useRef<Pt>([15, 10]);
  const eaten = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [hostRef, scene] = useScene((el) => new SnakeScene(el));
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const speed = () => Math.max(60, 140 - eaten.current * 4);
  const placeFood = () => {
    for (;;) {
      const p: Pt = [Math.floor(Math.random() * SN), Math.floor(Math.random() * SN)];
      if (!snake.current.some(([x, y]) => x === p[0] && y === p[1])) {
        food.current = p;
        return;
      }
    }
  };
  useEffect(() => scene?.show(snake.current, food.current, 140, false), [scene]);
  const reset = () => {
    snake.current = [[10, 10], [9, 10], [8, 10]];
    dir.current = "R";
    nextDir.current = "R";
    eaten.current = 0;
    setScore(0);
    placeFood();
    sceneRef.current?.show(snake.current, food.current, speed(), false);
    setState("running");
  };
  useEffect(() => {
    if (state !== "running") return;
    let alive = true;
    const tick = () => {
      if (!alive || stateRef.current !== "running") return;
      dir.current = nextDir.current;
      const [hx, hy] = snake.current[0];
      const d = dir.current;
      const head: Pt = [hx + (d === "R" ? 1 : d === "L" ? -1 : 0), hy + (d === "D" ? 1 : d === "U" ? -1 : 0)];
      const hit = head[0] < 0 || head[1] < 0 || head[0] >= SN || head[1] >= SN || snake.current.some(([x, y]) => x === head[0] && y === head[1]);
      if (hit) {
        setState("dead");
        sfx("boom");
        onScore(eaten.current);
        return;
      }
      snake.current = [head, ...snake.current];
      if (head[0] === food.current[0] && head[1] === food.current[1]) {
        eaten.current += 1;
        sfx("eat");
        setScore(eaten.current);
        placeFood();
      } else snake.current.pop();
      sceneRef.current?.show(snake.current, food.current, speed(), true);
      window.setTimeout(tick, speed());
    };
    const t = window.setTimeout(tick, 140);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, onScore]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const map: Record<string, SDir> = { ArrowUp: "U", ArrowDown: "D", ArrowLeft: "L", ArrowRight: "R", w: "U", s: "D", a: "L", d: "R" };
      const nd = map[e.key];
      if (nd) {
        e.preventDefault();
        const opposite: Record<SDir, SDir> = { U: "D", D: "U", L: "R", R: "L" };
        if (opposite[dir.current] !== nd) nextDir.current = nd;
        if (stateRef.current === "ready" || stateRef.current === "dead") reset();
      } else if (e.key === " ") {
        e.preventDefault();
        setState((s) => (s === "running" ? "paused" : s === "paused" ? "running" : s));
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div data-solo="snake" data-g3-solo="snake" className="flex w-[480px] max-w-full flex-col items-center gap-3">
      <div className="flex items-center gap-3 text-[13px]">
        <span className="rounded-full bg-slate-500/10 px-3 py-1 font-semibold" data-solo-score>
          Eaten {score}
        </span>
        {state === "running" || state === "paused" ? (
          <button type="button" onClick={() => setState(state === "running" ? "paused" : "running")} className={`${btn} bg-slate-500/10 text-slate-700 dark:text-slate-200`}>
            {state === "running" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} {state === "running" ? "Pause" : "Go on"}
          </button>
        ) : (
          <button type="button" data-solo-start onClick={reset} className={`${btn} bg-emerald-500 text-white hover:bg-emerald-600`}>
            <Play className="h-3.5 w-3.5" /> {state === "dead" ? "Play again" : "Start"}
          </button>
        )}
      </div>
      <div className="relative w-full">
        <SceneBox hostRef={hostRef} aspect={1.08} minH={340} maxH={480} testId="snake" />
        {state === "dead" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-2xl bg-slate-900/60 text-white lanx-fade">
            <div className="text-xl font-bold">Ouch!</div>
            <div className="text-[13px]">You ate {score}</div>
          </div>
        )}
        {state === "paused" && <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-slate-900/40 text-xl font-bold text-white">Paused</div>}
      </div>
      <div className="text-[11.5px] text-slate-500">Arrow keys or W A S D to steer; Space pauses.</div>
    </div>
  );
}

// ============================================================ Minesweeper

class MinesScene extends BoardScene<null> {
  private info: { open: (i: number) => void; flag: (i: number) => void; can: () => boolean } | null = null;
  constructor(host: HTMLElement) {
    super(host, { fov: 26 });
    this.top = 0.2;
    const span = MS + 0.6;
    this.stage.scene.add(mesh(slab(span, this.top, span, 0.15), new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.7 })));
    this.root.position.set(-(MS - 1) / 2, 0, -(MS - 1) / 2);
    this.stage.onPointerDown = (e) => {
      if (e.button !== 2 || !this.info?.can()) return;
      const c = this.cellUnderPointer();
      if (c !== null) this.info.flag(c);
    };
    this.stage.allowViewDrag("mines", 45, 30);
    this.stage.frame(new THREE.Box3(new THREE.Vector3(-span / 2, 0, -span / 2), new THREE.Vector3(span / 2, 0.7, span / 2)), [0, 2.8, 1], 1.04);
  }
  setHandlers(info: { open: (i: number) => void; flag: (i: number) => void; can: () => boolean }) {
    this.info = info;
  }
  protected replay() {
    return null;
  }
  protected snap() {}
  protected async animateStep() {}
  protected cellPos(i: number) {
    return new THREE.Vector3(i % MS, this.top, Math.floor(i / MS));
  }
  protected cellAt(p: THREE.Vector3) {
    const c = Math.round(p.x);
    const r = Math.round(p.z);
    return c < 0 || r < 0 || c >= MS || r >= MS ? null : r * MS + c;
  }
  protected clickable() {
    return !!this.info?.can();
  }
  protected clicked(i: number) {
    this.info?.open(i);
  }
  protected makeHover() {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({ color: 0x6366f1, transparent: true, opacity: 0.3, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.32;
    const g = new THREE.Group();
    g.add(m);
    return g;
  }
  private flagMesh() {
    const g = new THREE.Group();
    const pole = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 8), new THREE.MeshStandardMaterial({ color: 0x334155 }));
    pole.position.y = 0.55;
    const cloth = mesh(new THREE.ConeGeometry(0.14, 0.26, 3), new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.5 }));
    cloth.rotation.z = -Math.PI / 2;
    cloth.position.set(0.12, 0.68, 0);
    const base = mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.04, 12), new THREE.MeshStandardMaterial({ color: 0x334155 }));
    base.position.y = 0.32;
    g.add(pole, cloth, base);
    return g;
  }
  show(field: Sq[], animate: boolean) {
    const specs: PieceSpec[] = field.map((s, i) => {
      if (!s.open)
        return {
          key: `c${i}:${s.flag ? "f" : ""}`,
          pos: this.cellPos(i),
          make: () => {
            const g = new THREE.Group();
            g.add(mesh(sharedGeo("msclosed", () => slab(0.92, 0.3, 0.92, 0.07)), new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.45 })));
            if (s.flag) g.add(this.flagMesh());
            return g;
          },
        };
      return {
        key: `o${i}`,
        pos: this.cellPos(i),
        make: () => {
          const g = new THREE.Group();
          g.add(mesh(sharedGeo("msopen", () => slab(0.94, 0.06, 0.94, 0.03)), new THREE.MeshStandardMaterial({ color: s.mine ? 0xef4444 : 0xf1f5f9, roughness: 0.6 })));
          if (s.mine) g.add(mineMesh());
          else if (s.n > 0) {
            const face = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), new THREE.MeshBasicMaterial({ map: digitTexture(s.n), transparent: true }));
            face.rotation.x = -Math.PI / 2;
            face.position.y = 0.062;
            g.add(face);
          }
          return g;
        },
      };
    });
    void this.place(specs, animate, { appear: "pop", vanish: "sink", sound: null, stagger: 6 });
    this.refreshHover();
  }
}

export function Minesweeper3D({ onScore }: SoloProps) {
  const [field, setField] = useState<Sq[]>(freshField);
  const [planted, setPlanted] = useState(false);
  const [state, setState] = useState<"playing" | "won" | "lost">("playing");
  const [start, setStart] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [hostRef, scene] = useScene((el) => new MinesScene(el));
  const first = useRef(true);
  useEffect(() => {
    if (state !== "playing" || start === null) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [state, start]);
  useEffect(() => {
    if (!scene) return;
    scene.show(field, !first.current);
    first.current = false;
  }, [scene, field]);
  const seconds = start === null ? 0 : Math.floor((now - start) / 1000);
  const flags = field.filter((s) => s.flag).length;
  const reset = () => {
    setField(freshField());
    setPlanted(false);
    setState("playing");
    setStart(null);
  };
  const open = (i: number) => {
    if (state !== "playing") return;
    let f = field;
    if (!planted) {
      f = plant(field, i);
      setPlanted(true);
      setStart(Date.now());
    }
    if (f[i].flag || f[i].open) return;
    f = f.map((s) => ({ ...s }));
    if (f[i].mine) {
      f.forEach((s) => {
        if (s.mine) s.open = true;
      });
      setField(f);
      setState("lost");
      sfx("boom");
      return;
    }
    const stack = [i];
    while (stack.length) {
      const j = stack.pop()!;
      if (f[j].open || f[j].flag) continue;
      f[j].open = true;
      if (f[j].n === 0) for (const k of around(j)) if (!f[k].open && !f[k].mine) stack.push(k);
    }
    sfx("tap");
    setField(f);
    if (f.every((s) => s.open || s.mine)) {
      setState("won");
      sfx("win");
      onScore(Math.max(1, Math.floor((Date.now() - (start ?? Date.now())) / 1000)));
    }
  };
  const toggleFlag = (i: number) => {
    if (state !== "playing" || field[i].open) return;
    sfx("flag");
    setField((f) => f.map((s, j) => (j === i ? { ...s, flag: !s.flag } : s)));
  };
  const openRef = useRef(open);
  openRef.current = open;
  const flagRef = useRef(toggleFlag);
  flagRef.current = toggleFlag;
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => scene?.setHandlers({ open: (i) => openRef.current(i), flag: (i) => flagRef.current(i), can: () => stateRef.current === "playing" }), [scene]);
  return (
    <div data-solo="mines" data-g3-solo="mines" className="flex w-[460px] max-w-full flex-col items-center gap-3">
      <div className="flex items-center gap-3 text-[13px]">
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 px-3 py-1 font-semibold" data-solo-flags>
          <Flag className="h-3.5 w-3.5" /> {MINES - flags}
        </span>
        <span className="rounded-full bg-slate-500/10 px-3 py-1 font-semibold" data-solo-score>
          {seconds} s
        </span>
        <button type="button" data-solo-start onClick={reset} className={`${btn} bg-slate-500/10 text-slate-700 dark:text-slate-200`}>
          <RotateCcw className="h-3.5 w-3.5" /> New field
        </button>
      </div>
      <div className="relative w-full">
        <SceneBox hostRef={hostRef} aspect={1.08} minH={340} maxH={460} testId="mines" />
        {state !== "playing" && (
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
            <div className="rounded-full bg-white/90 px-4 py-1.5 text-[13px] font-bold shadow dark:bg-slate-800/90">{state === "won" ? `Field cleared in ${seconds} s!` : "Boom — try a new field"}</div>
          </div>
        )}
      </div>
      <div className="sr-only" data-mine-cells>
        {field.map((s, i) => (
          <button key={i} type="button" data-mine-cell={i} onClick={() => open(i)} onContextMenu={(e) => { e.preventDefault(); toggleFlag(i); }}>
            {s.open ? (s.mine ? "mine" : s.n) : s.flag ? "flag" : "closed"}
          </button>
        ))}
      </div>
      <div className="text-[11.5px] text-slate-500">Click to open a square; right-click to plant a flag. The first click is always safe.</div>
    </div>
  );
}

