// LANX 2.16.0: the two party games with a 3D scene of their own.
// Tap Roulette: a prize wheel with a slice per player; when the round closes
// it spins, slows and stops on the loser — the loser the rules drew from the
// match seed (lib/games/party), so the wheel only shows a result that is
// already fixed and the same on every PC. Wordbox: sixteen wooden letter
// tiles; drag across touching tiles to spell a word (or type it), checked
// against the grid and an English word list before it is sent.

import * as THREE from "three";
import { useEffect, useMemo, useRef, useState } from "react";
import { seatFor, type BoardProps } from "../../boardProps";
import { tapRoulette, type PartyState, type TapExtra } from "../../../../lib/games/party.ts";
import { wordOnGrid, wordPoints, wordbox, type WordboxExtra } from "../../../../lib/games/wordbox.ts";
import { sfx } from "../../../../lib/gameSounds";
import { PartyShell } from "../../boards/PartyShell";
import { TurnScene } from "../turnScene";
import { FONT, canvasTexture, mesh, repaint, sharedGeo, slab, wood } from "../kit";
import { SceneBox, useScene } from "../Board3D";
import { primary3 } from "../ui";
import { easeOut } from "../stage";

// ============================================================ Tap Roulette

/** Who loses a closed round: the drawn player if they tapped in, else the first who did not (the rules' own sum). */
export function rouletteLoser(s: PartyState<TapExtra>, n: number): number | null {
  if (!s.extra) return null;
  const tapped = s.answers.map((a) => a.player);
  let loser = s.extra.loser;
  if (!tapped.includes(loser)) {
    const missing = Array.from({ length: n }, (_, p) => p).filter((p) => !tapped.includes(p));
    loser = missing[0] ?? loser;
  }
  return loser;
}

class WheelScene extends TurnScene<PartyState<TapExtra>> {
  private wheel = new THREE.Group();
  private face: THREE.CanvasTexture;
  private colours: string[] = [];
  private names: string[] = [];
  private tapped: number[] = [];
  constructor(host: HTMLElement) {
    super(host, { fov: 26 });
    const s = this.stage;
    s.setGroundY(-2);
    this.face = canvasTexture(1024, 1024, (ctx) => this.paint(ctx), s.renderer);
    const R = 2;
    const disc = mesh(new THREE.CylinderGeometry(R, R, 0.16, 96), [
      new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.5 }),
      new THREE.MeshPhysicalMaterial({ map: this.face, roughness: 0.35, clearcoat: 0.6 }),
      new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.5 }),
    ]);
    // Face the camera; the picture's top at the top (see the dartboard for the turn).
    disc.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)));
    this.wheel.add(disc);
    const rim = mesh(new THREE.TorusGeometry(R + 0.04, 0.08, 16, 96), new THREE.MeshStandardMaterial({ color: 0xd4a017, metalness: 0.6, roughness: 0.3 }));
    this.wheel.add(rim);
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const peg = mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshStandardMaterial({ color: 0xf8fafc, metalness: 0.4, roughness: 0.3 }));
      peg.position.set(Math.cos(a) * (R - 0.08), Math.sin(a) * (R - 0.08), 0.12);
      this.wheel.add(peg);
    }
    const hub = mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.3, 32), new THREE.MeshStandardMaterial({ color: 0xd4a017, metalness: 0.6, roughness: 0.3 }));
    hub.rotation.x = Math.PI / 2;
    this.wheel.add(hub);
    this.wheel.position.set(0, 2.4, 0);
    s.scene.add(this.wheel);
    // The pointer at the top and a stand.
    const pointer = mesh(new THREE.ConeGeometry(0.2, 0.45, 3), new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.4 }));
    pointer.rotation.z = Math.PI;
    pointer.position.set(0, 2.4 + R + 0.25, 0.15);
    s.scene.add(pointer);
    const stand = mesh(slab(0.4, 2.3, 0.4, 0.08), wood("walnut", 1));
    stand.position.set(0, -0.2, -0.35);
    s.scene.add(stand);
    s.frame(new THREE.Box3(new THREE.Vector3(-R - 0.3, 0.2, -0.4), new THREE.Vector3(R + 0.3, 2.4 + R + 0.6, 0.4)), [0, 0.15, 1], 1.03);
  }
  private paint(ctx: CanvasRenderingContext2D) {
    const P = 1024;
    const n = Math.max(1, this.names.length);
    ctx.clearRect(0, 0, P, P);
    for (let p = 0; p < n; p++) {
      // Slice p is centred at the top when the wheel's angle is −(p + 0.5)·slice.
      const a0 = -Math.PI / 2 + (p / n) * Math.PI * 2;
      const a1 = -Math.PI / 2 + ((p + 1) / n) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(P / 2, P / 2);
      ctx.arc(P / 2, P / 2, P / 2, a0, a1);
      ctx.closePath();
      const lit = this.tapped.includes(p);
      ctx.fillStyle = this.colours[p] ?? "#94a3b8";
      ctx.globalAlpha = lit ? 1 : 0.45;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.save();
      ctx.translate(P / 2, P / 2);
      ctx.rotate((a0 + a1) / 2);
      ctx.fillStyle = "#ffffff";
      ctx.font = `800 ${n > 6 ? 40 : 52}px ${FONT}`;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText((this.names[p] ?? "").slice(0, 12), P / 2 - 40, 0);
      ctx.restore();
    }
  }
  setLook(names: string[], colours: string[]) {
    this.names = names;
    this.colours = colours;
    repaint(this.face, (ctx) => this.paint(ctx));
    this.stage.invalidate();
  }
  protected replay(moves: string[]) {
    return tapRoulette.replay(moves, this.n, this.seed);
  }
  private showTapped(s: PartyState<TapExtra>) {
    const t = s.open ? s.answers.map((a) => a.player) : this.tapped;
    if (t.join() !== this.tapped.join()) {
      this.tapped = t;
      repaint(this.face, (ctx) => this.paint(ctx));
    }
  }
  protected snap(s: PartyState<TapExtra>) {
    if (s.open && s.answers.length === 0) {
      this.tapped = [];
      repaint(this.face, (ctx) => this.paint(ctx));
    }
    this.showTapped(s);
    this.stage.invalidate();
  }
  protected async animateStep(_before: PartyState<TapExtra>, after: PartyState<TapExtra>, move: string) {
    if (!move.startsWith("e:")) {
      this.showTapped(after);
      if (move.includes("@a:")) sfx("pop", 0.5);
      return;
    }
    const loser = rouletteLoser(after, this.n);
    if (loser === null) return;
    const slice = (Math.PI * 2) / this.n;
    const from = this.wheel.rotation.z;
    // The loser's slice centre under the pointer (turning the wheel anticlockwise brings later slices up); four turns first.
    const base = (loser + 0.5) * slice;
    let to = base;
    while (to < from + Math.PI * 2 * 4) to += Math.PI * 2;
    let lastTick = Math.floor(from / slice);
    await this.stage.animate(
      3600,
      (t) => {
        this.wheel.rotation.z = from + (to - from) * t;
        const k = Math.floor(this.wheel.rotation.z / slice);
        if (k !== lastTick) {
          lastTick = k;
          sfx("tick", 0.6);
        }
      },
      (t) => 1 - Math.pow(1 - t, 4),
    );
    this.wheel.rotation.z = base + Math.round((to - base) / (Math.PI * 2)) * Math.PI * 2;
    sfx("buzz", 0.7);
  }
  /** Which player the pointer is on now (tests). */
  pointing(): number {
    const slice = (Math.PI * 2) / this.n;
    const a = ((this.wheel.rotation.z % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return Math.floor(a / slice) % this.n;
  }
}

export function TapRoulette3D({ moves, canPlay, seat, seats, starter = 0, seed = "", host, onMove }: BoardProps) {
  const n = Math.max(2, seats?.length ?? 2);
  const state = useMemo(() => tapRoulette.replay(moves, n, seed), [moves, n, seed]);
  const names = useMemo(() => Array.from({ length: n }, (_, p) => seatFor(seats, starter, p, n).name), [seats, starter, n]);
  const colours = useMemo(() => Array.from({ length: n }, (_, p) => seatFor(seats, starter, p, n).color), [seats, starter, n]);
  const [hostRef, scene] = useScene((el) => new WheelScene(el));
  useEffect(() => scene?.setLook(names, colours), [scene, names, colours]);
  useEffect(() => scene?.sync(n, seed, moves), [scene, n, seed, moves]);
  if (!state) return null;
  const tapped = state.answers.some((a) => a.player === seat);
  const allIn = state.answers.length >= n;
  return (
    <PartyShell state={state} rounds={5} seconds={10} host={!!host} seats={seats} starter={starter} n={n} allIn={allIn} onMove={onMove} testId="taproulette">
      <div className="flex w-full flex-col items-center gap-2" data-g3-board="taproulette">
        <SceneBox hostRef={hostRef} aspect={1.25} minH={260} maxH={360} testId="taproulette" />
        {state.open ? (
          <button type="button" data-tap-in disabled={!canPlay || tapped} onClick={() => onMove(`${seat}@a:in`)} className={`h-20 w-20 rounded-full text-[16px] font-black text-white shadow-lg transition-transform ${tapped ? "bg-emerald-500" : "bg-rose-600 hover:bg-rose-500 active:scale-95"} disabled:opacity-90`}>
            {tapped ? "IN" : "TAP"}
          </button>
        ) : (
          <div className="text-[12.5px] text-slate-500">Everyone taps in; when the round closes the wheel picks one loser. Five rounds.</div>
        )}
        <div className="text-[11.5px] text-slate-500">
          {state.answers.length} of {n} in
        </div>
      </div>
    </PartyShell>
  );
}

// ============================================================ Wordbox

let dictionary: Set<string> | null = null;
let loadingDict: Promise<Set<string> | null> | null = null;
/** The English word list (about 270,000 words), loaded the first time Wordbox opens. */
function loadDictionary(): Promise<Set<string> | null> {
  if (dictionary) return Promise.resolve(dictionary);
  loadingDict ??= import("../../../../../node_modules/word-list/words.txt?raw")
    .then((m) => {
      dictionary = new Set((m.default as string).split("\n").map((w) => w.trim().toUpperCase()));
      return dictionary;
    })
    .catch(() => null);
  return loadingDict;
}

const TG = 1.15;

class WordScene extends TurnScene<PartyState<WordboxExtra>> {
  private tiles: THREE.Group[] = [];
  private letters: THREE.CanvasTexture[] = [];
  private line: THREE.Line;
  private path: number[] = [];
  private grid: string[] = [];
  private info: { canPlay: boolean; onWord: (w: string) => void; onPath: (w: string) => void } | null = null;
  constructor(host: HTMLElement) {
    super(host, { fov: 26 });
    const s = this.stage;
    const tray = mesh(slab(4 * TG + 0.5, 0.2, 4 * TG + 0.5, 0.12), wood("walnut", 2));
    s.scene.add(tray);
    const cube = sharedGeo("wordtile", () => slab(1.0, 0.42, 1.0, 0.12));
    for (let i = 0; i < 16; i++) {
      const g = new THREE.Group();
      const body = mesh(cube, new THREE.MeshPhysicalMaterial({ color: 0xf3e3c3, roughness: 0.4, clearcoat: 0.4 }));
      const tex = canvasTexture(128, 128, () => {}, s.renderer);
      this.letters.push(tex);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.5 }));
      face.rotation.x = -Math.PI / 2;
      face.position.y = 0.425;
      g.add(body, face);
      g.position.set(((i % 4) - 1.5) * TG, 0.2, (Math.floor(i / 4) - 1.5) * TG);
      s.scene.add(g);
      this.tiles.push(g);
    }
    this.line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x4f46e5, transparent: true, opacity: 0.9, depthTest: false }));
    this.line.renderOrder = 10;
    s.scene.add(this.line);
    s.onPointerDown = (e) => {
      if (e.button !== 0 || !this.info?.canPlay) return;
      const i = this.tileUnder();
      if (i === null) return;
      this.path = [i];
      this.drawPath();
    };
    s.onPointerMove = () => {
      if (!this.path.length) return;
      const i = this.tileUnder();
      if (i === null) return;
      const last = this.path[this.path.length - 1];
      if (i === last) return;
      if (this.path.length > 1 && i === this.path[this.path.length - 2]) {
        this.path.pop(); // backtrack
      } else if (!this.path.includes(i) && Math.abs((i % 4) - (last % 4)) <= 1 && Math.abs(Math.floor(i / 4) - Math.floor(last / 4)) <= 1) {
        this.path.push(i);
        sfx("tap", 0.35);
      }
      this.drawPath();
    };
    s.onPointerUp = () => {
      if (!this.path.length) return;
      const word = this.word();
      this.path = [];
      this.drawPath();
      if (word.length >= 3) this.info?.onWord(word);
    };
    s.frame(new THREE.Box3(new THREE.Vector3(-2.6, 0, -2.6), new THREE.Vector3(2.6, 0.7, 2.6)), [0, 3, 1], 1.03);
  }
  setTurn(info: { canPlay: boolean; onWord: (w: string) => void; onPath: (w: string) => void }) {
    this.info = info;
  }
  private word() {
    return this.path.map((i) => (this.grid[i] === "Q" ? "QU" : this.grid[i])).join("");
  }
  private tileUnder(): number | null {
    const p = this.stage.pointOnPlane(0.62);
    if (!p) return null;
    const c = Math.round(p.x / TG + 1.5);
    const r = Math.round(p.z / TG + 1.5);
    if (c < 0 || r < 0 || c > 3 || r > 3) return null;
    // Only near a tile's middle, so diagonal moves pick the intended tile.
    if (Math.hypot(p.x - (c - 1.5) * TG, p.z - (r - 1.5) * TG) > 0.45) return null;
    return r * 4 + c;
  }
  private drawPath() {
    this.tiles.forEach((g, i) => {
      g.position.y = this.path.includes(i) ? 0.32 : 0.2;
      ((g.children[0] as THREE.Mesh).material as THREE.MeshPhysicalMaterial).color.setHex(this.path.includes(i) ? 0xc7d2fe : 0xf3e3c3);
    });
    const pts = this.path.map((i) => this.tiles[i].position.clone().setY(0.78));
    (this.line.geometry as THREE.BufferGeometry).setFromPoints(pts.length > 1 ? pts : [new THREE.Vector3(), new THREE.Vector3()]);
    this.line.visible = pts.length > 1;
    this.info?.onPath(this.word());
    this.stage.invalidate();
  }
  protected replay(moves: string[]) {
    return wordbox.replay(moves, this.n, this.seed);
  }
  private setGrid(grid: string[], animate: boolean) {
    if (grid.join() === this.grid.join()) return;
    this.grid = grid;
    this.letters.forEach((t, i) =>
      repaint(t, (ctx, w, h) => {
        ctx.font = `800 ${grid[i] === "Q" ? 62 : 84}px ${FONT}`;
        ctx.fillStyle = "#3b2412";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(grid[i] === "Q" ? "Qu" : (grid[i] ?? ""), w / 2, h / 2 + 4);
      }),
    );
    if (animate) {
      // A new round: the tiles roll over to their new letters.
      this.tiles.forEach((g, i) => {
        const delay = i * 25;
        void this.stage.wait(delay).then(() => this.stage.animate(420, (t) => (g.rotation.x = (1 - easeOut(t)) * Math.PI * 2)));
      });
    }
    this.stage.invalidate();
  }
  protected snap(s: PartyState<WordboxExtra>) {
    if (s.extra?.grid) this.setGrid(s.extra.grid, false);
  }
  protected async animateStep(_b: PartyState<WordboxExtra>, after: PartyState<WordboxExtra>, move: string) {
    if (move.startsWith("o:") && after.extra?.grid) this.setGrid(after.extra.grid, true);
  }
}

export function Wordbox3D({ moves, canPlay, seat, seats, starter = 0, seed = "", host, onMove }: BoardProps) {
  const n = Math.max(2, seats?.length ?? 2);
  const state = useMemo(() => wordbox.replay(moves, n, seed), [moves, n, seed]);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [tracing, setTracing] = useState("");
  const [dict, setDict] = useState<Set<string> | null>(dictionary);
  useEffect(() => {
    void loadDictionary().then(setDict);
  }, []);
  useEffect(() => {
    setText("");
    setNote("");
  }, [state?.round]);
  const grid = (state?.extra as WordboxExtra | null)?.grid ?? [];
  const mine = useMemo(() => (state ? state.answers.filter((a) => a.player === seat).map((a) => a.text.toUpperCase()) : []), [state, seat]);
  const submit = (raw: string) => {
    const w = raw.trim().toUpperCase();
    if (!w) return;
    if (w.length < 3) return setNote("Three letters or more.");
    if (mine.includes(w)) return setNote("Already have it.");
    if (!wordOnGrid(grid, w)) return setNote("Those letters don't touch on the grid.");
    if (dict && !dict.has(w)) return setNote(`"${w}" isn't in the word list.`);
    onMove(`${seat}@a:${w}`);
    sfx("pop", 0.6);
    setText("");
    setNote("");
  };
  const submitRef = useRef(submit);
  submitRef.current = submit;
  const [hostRef, scene] = useScene((el) => new WordScene(el));
  useEffect(() => scene?.sync(n, seed, moves), [scene, n, seed, moves]);
  useEffect(() => scene?.setTurn({ canPlay: canPlay && !!state?.open, onWord: (w) => submitRef.current(w), onPath: setTracing }), [scene, canPlay, state?.open]);
  if (!state) return null;
  return (
    <PartyShell state={state} rounds={3} seconds={90} host={!!host} seats={seats} starter={starter} n={n} onMove={onMove} testId="wordbox">
      <div className="flex w-full flex-wrap items-start justify-center gap-4" data-g3-board="wordbox">
        <div className="flex w-[340px] flex-col items-center gap-1">
          <SceneBox hostRef={hostRef} aspect={1.05} minH={300} maxH={360} testId="wordbox" />
          <div className="h-6 text-[16px] font-black tracking-[0.2em] text-indigo-600" data-wordbox-tracing>
            {tracing}
          </div>
        </div>
        {state.open && grid.length === 16 ? (
          <div className="flex w-[220px] flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <input data-wordbox-input value={text} disabled={!canPlay} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit(text)} placeholder="drag the tiles, or type" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-[14px] uppercase dark:border-slate-600 dark:bg-slate-800" />
              <button type="button" data-wordbox-send disabled={!canPlay} onClick={() => submit(text)} className={primary3}>
                Add
              </button>
            </div>
            {note && <div className="text-[11.5px] text-rose-600" data-wordbox-note>{note}</div>}
            <div className="flex flex-wrap gap-1" data-wordbox-mine>
              {mine.map((w) => (
                <span key={w} className="p3-guess rounded-full bg-white px-2 py-0.5 text-[11.5px] font-semibold text-slate-900 shadow ring-1 ring-black/10">
                  {w} <span className="text-slate-400">{wordPoints(w)}</span>
                </span>
              ))}
            </div>
            <div className="text-[10.5px] text-slate-500">Drag across touching tiles to spell a word (no tile twice). {dict ? "Words are checked against an English word list." : "Loading the word list…"} A word two of you found scores nobody.</div>
          </div>
        ) : (
          <div className="max-w-[220px] text-[13px] text-slate-500">Three rounds of 90 seconds on a fresh letter grid.</div>
        )}
      </div>
    </PartyShell>
  );
}
