// LANX 2.16.0: Sea Battle in 3D — two seas side by side: theirs on the left
// (where you call your shots) and yours on the right with your fleet afloat.
// Shots land as pegs: white for a miss, red for a hit, dark red once a ship
// is sunk. Your fleet stays a secret on this PC (only shots and answers
// travel), so the other captain's ships are never in your scene.

import * as THREE from "three";
import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Shuffle, Trash2 } from "lucide-react";
import { seatFor, type BoardProps } from "../../boardProps";
import { SEA, SHIPS, answerShot, battleship, canPlace, fleetCells, placeProblem, randomFleet, shipName, type BattleshipState, type Fleet } from "../../../../lib/games/battleship.ts";
import { FleetList, LOST_FLEET, placeHint, seaNews } from "../../boards/BattleshipBoard";
import { sfx } from "../../../../lib/gameSounds";
import { BoardScene, type PieceSpec } from "../boardScene";
import { canvasTexture, labelMesh, mesh, slab } from "../kit";
import { SceneBox, useScene } from "../Board3D";
import { BoardBar, HiddenActions, primary3, quiet3, type Action } from "../ui";

type Secret = { fleet: Fleet };
const GAP = 1.6; // between the two seas
const OFF = SEA / 2 + GAP / 2; // each sea's centre from the middle

function seaTexture() {
  return canvasTexture(640, 640, (ctx, w, h) => {
    ctx.fillStyle = "#1f6fae";
    ctx.fillRect(0, 0, w, h);
    // Soft swell (stripes of slightly lighter water), then the grid.
    for (let y = 0; y < h; y += 16) {
      ctx.fillStyle = `rgba(255,255,255,${0.025 + ((y / 16) % 3) * 0.012})`;
      ctx.fillRect(0, y, w, 7);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;
    for (let i = 0; i <= SEA; i++) {
      const v = (i / SEA) * w;
      ctx.beginPath();
      ctx.moveTo(v, 0);
      ctx.lineTo(v, h);
      ctx.moveTo(0, v);
      ctx.lineTo(w, v);
      ctx.stroke();
    }
  });
}

/** A ship of `len` squares (along +X), grey with a little superstructure. */
function shipMesh(len: number): THREE.Object3D {
  const g = new THREE.Group();
  const hull = mesh(slab(len - 0.16, 0.32, 0.62, 0.22), new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.5, metalness: 0.2 }));
  hull.position.x = (len - 1) / 2;
  g.add(hull);
  const deck = mesh(slab(Math.max(0.7, len * 0.35), 0.22, 0.34, 0.06), new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.45 }));
  deck.position.set((len - 1) / 2 - len * 0.08, 0.32, 0);
  g.add(deck);
  return g;
}

function peg(kind: string): THREE.Object3D {
  const colour = kind === "m" ? 0xf8fafc : kind === "s" ? 0x7f1d1d : 0xdc2626;
  const m = mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.42, 18), new THREE.MeshPhysicalMaterial({ color: colour, roughness: 0.3, clearcoat: 0.6 }));
  m.position.y = 0.21;
  const g = new THREE.Group();
  g.add(m);
  return g;
}

interface SeaTurn {
  phase: "place" | "wait" | "fire";
  canFire: boolean;
  fleet: Fleet;
  nextLen: number | undefined;
  horizontal: boolean;
  onPlace: (i: number) => void;
  onFire: (i: number) => void;
}

class SeaScene extends BoardScene<BattleshipState> {
  private info: SeaTurn | null = null;
  private ghost: THREE.Group;
  private ghostLen = 0;
  private seat = 0;
  constructor(host: HTMLElement) {
    super(host, { fov: 26 });
    this.top = 0.12;
    const tex = seaTexture();
    for (const sx of [-1, 1]) {
      const base = mesh(slab(SEA + 0.4, this.top - 0.02, SEA + 0.4, 0.1), new THREE.MeshStandardMaterial({ color: 0x0f3a5f, roughness: 0.6 }));
      base.position.x = sx * OFF;
      this.stage.scene.add(base);
      const water = new THREE.Mesh(new THREE.PlaneGeometry(SEA, SEA), new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.2 }));
      water.rotation.x = -Math.PI / 2;
      water.position.set(sx * OFF, this.top, 0);
      water.receiveShadow = true;
      this.stage.scene.add(water);
      const title = labelMesh(sx < 0 ? "THEIR SEA" : "YOUR SEA", { size: 0.42, color: "#64748b" });
      title.position.set(sx * OFF, 0.01, -SEA / 2 - 0.7);
      this.stage.scene.add(title);
    }
    this.ghost = new THREE.Group();
    this.ghost.visible = false;
    this.root.add(this.ghost);
    this.stage.frame(new THREE.Box3(new THREE.Vector3(-SEA - GAP / 2 - 0.3, 0, -SEA / 2 - 1.1), new THREE.Vector3(SEA + GAP / 2 + 0.3, 0.6, SEA / 2 + 0.3)), [0, 3.2, 1], 1.02);
  }
  setTurn(info: SeaTurn, seat: number) {
    this.info = info;
    this.seat = seat;
    this.drawFleet();
    this.refreshHover();
  }
  protected replay(moves: string[]) {
    return battleship.replay(moves, 2, "");
  }
  /** Cells 0–99 are their sea, 100–199 yours. */
  protected cellPos(i: number) {
    const mine = i >= 100;
    const k = i % 100;
    return new THREE.Vector3((mine ? OFF : -OFF) + (k % SEA) - (SEA - 1) / 2, this.top, Math.floor(k / SEA) - (SEA - 1) / 2);
  }
  protected cellAt(p: THREE.Vector3) {
    for (const mine of [false, true]) {
      const cx = mine ? OFF : -OFF;
      const c = Math.floor(p.x - cx + SEA / 2);
      const r = Math.floor(p.z + SEA / 2);
      if (c >= 0 && c < SEA && r >= 0 && r < SEA) return (mine ? 100 : 0) + r * SEA + c;
    }
    return null;
  }
  protected clickable(i: number) {
    const s = this.replay(this.shown);
    const info = this.info;
    if (!s || !info) return false;
    if (info.phase === "place") return i >= 100 && info.nextLen !== undefined && !fleetCells(info.fleet).has(i - 100);
    if (info.phase === "fire") return i < 100 && info.canFire && s.known[this.seat][i] === "";
    return false;
  }
  protected clicked(i: number) {
    if (!this.info) return;
    this.showHover(null);
    if (this.info.phase === "place") this.info.onPlace(i - 100);
    else this.info.onFire(i);
  }
  protected makeHover() {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.92), new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.45, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    return m;
  }
  protected showHover(c: number | null) {
    super.showHover(c);
    // While placing: a ghost ship shows where it would go — red where it can't (2.17.0).
    const info = this.info;
    if (info?.phase === "place" && c !== null && info.nextLen) {
      if (this.ghostLen !== info.nextLen) {
        this.ghost.clear();
        const ship = shipMesh(info.nextLen);
        ship.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
          if (m) {
            m.transparent = true;
            m.opacity = 0.55;
            m.userData.colour = m.color.getHex();
          }
        });
        this.ghost.add(ship);
        this.ghostLen = info.nextLen;
      }
      const ok = !!canPlace(info.fleet, c - 100, info.nextLen, info.horizontal);
      this.ghost.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m && m.userData.colour !== undefined) m.color.setHex(ok ? m.userData.colour : 0xef4444);
      });
      if (this.hoverMark) (((this.hoverMark as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(ok ? 0xfacc15 : 0xef4444));
      this.ghost.visible = true;
      this.ghost.position.copy(this.cellPos(c)).setY(this.top);
      this.ghost.rotation.y = info.horizontal ? 0 : -Math.PI / 2;
    } else {
      this.ghost.visible = false;
      if (this.hoverMark) ((this.hoverMark as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(0xfacc15);
    }
  }
  private fleetGroup = new THREE.Group();
  private drawFleet() {
    this.fleetGroup.clear();
    if (!this.fleetGroup.parent) this.root.add(this.fleetGroup);
    for (const ship of this.info?.fleet ?? []) {
      const m = shipMesh(ship.len);
      const first = Math.min(...ship.cells);
      const horizontal = ship.cells.length < 2 || ship.cells[1] - ship.cells[0] === 1;
      m.position.copy(this.cellPos(100 + first)).setY(this.top);
      m.rotation.y = horizontal ? 0 : -Math.PI / 2;
      this.fleetGroup.add(m);
    }
    this.stage.invalidate();
  }
  private specs(s: BattleshipState): PieceSpec[] {
    const out: PieceSpec[] = [];
    // My shots on their sea, and their shots on mine.
    s.known[this.seat].forEach((k, i) => k && out.push({ key: `t${i}:${k}`, pos: this.cellPos(i), make: () => peg(k) }));
    const ships = fleetCells(this.info?.fleet ?? []);
    s.known[1 - this.seat].forEach((k, i) => k && out.push({ key: `m${i}:${k}`, pos: this.cellPos(100 + i).setY(this.top + (ships.has(i) ? 0.3 : 0)), make: () => peg(k) }));
    return out;
  }
  protected snap(s: BattleshipState) {
    void this.place(this.specs(s), false);
  }
  protected async animateStep(_b: BattleshipState, after: BattleshipState, move: string) {
    if (move.startsWith("f:")) sfx("whoosh", 0.6);
    await this.place(this.specs(after), true, { appear: "drop", sound: null });
    const a = /^a:\d+:([mhs])$/.exec(move);
    if (a) sfx(a[1] === "m" ? "pop" : "boom", a[1] === "m" ? 0.5 : 0.8);
  }
}

export default function Sea3D({ moves, canPlay, turn, seat, seats, starter = 0, secret, onSecret, onMove }: BoardProps) {
  const state = useMemo(() => battleship.replay(moves, 2, ""), [moves]);
  const fleet: Fleet = ((secret as Secret | undefined)?.fleet ?? []) as Fleet;
  const [horizontal, setHorizontal] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  const answered = useRef(-1);
  const other = 1 - seat;
  const iAmReady = !!state?.ready[seat];
  const bothReady = !!state && state.ready[0] && state.ready[1];
  // LANX 2.17.0: ready, but the fleet is gone from this PC — never answer "miss" for a sea we can't see.
  const lost = iAmReady && fleet.length !== SHIPS.length;
  const name = (p: number) => seatFor(seats, starter, p, 2).name.split(" (")[0];
  const myHits = useMemo(() => new Set((state?.known[other] ?? []).map((k, i) => (k === "h" || k === "s" ? i : -1)).filter((i) => i >= 0)), [state, other]);
  // Their shot waits for my answer: look at my fleet and answer at once (as the flat board does).
  useEffect(() => {
    if (!state || state.pending < 0 || state.turn !== seat || !canPlay || lost) return;
    if (answered.current === moves.length) return;
    answered.current = moves.length;
    onMove(`a:${state.pending}:${answerShot(fleet, state.pending, myHits)}`);
  }, [state, seat, canPlay, fleet, myHits, moves.length, onMove, lost]);
  const send = useRef(onMove);
  send.current = onMove;
  const fleetRef = useRef(fleet);
  fleetRef.current = fleet;
  const [hostRef, scene] = useScene((el) => new SeaScene(el));
  useEffect(() => scene?.sync(2, "", moves), [scene, moves]);
  const phase: SeaTurn["phase"] = !iAmReady ? "place" : !bothReady ? "wait" : "fire";
  const nextLen = SHIPS[fleet.length];
  const canFire = canPlay && bothReady && !lost && turn === seat && (state?.pending ?? 0) < 0;
  useEffect(() => {
    scene?.setTurn(
      {
        phase,
        canFire,
        fleet,
        nextLen,
        horizontal,
        onPlace: (i) => {
          const len = SHIPS[fleetRef.current.length];
          if (len === undefined) return;
          const why = placeProblem(fleetRef.current, i, len, horizontal);
          if (why) return setHint(placeHint(why));
          const cells = canPlace(fleetRef.current, i, len, horizontal);
          if (!cells) return;
          setHint(null);
          onSecret?.({ fleet: [...fleetRef.current, { cells, len }] });
        },
        onFire: (i) => send.current(`f:${i}`),
      },
      seat,
    );
  }, [scene, phase, canFire, fleet, nextLen, horizontal, seat, onSecret]);
  if (!state) return null;
  const actions: Action[] = canFire ? state.known[seat].flatMap((k, i): Action[] => (k ? [] : [{ key: String(i), label: `Fire at ${i}`, run: () => onMove(`f:${i}`), attrs: { "data-sea-cell": `theirs:${i}` } }])) : [];
  const taken = fleetCells(fleet);
  const news = phase === "fire" ? seaNews(state, moves, seat, name) : null;
  return (
    <div data-game-board="battleship" data-g3-board="battleship" data-sea-phase={phase} data-sea-lost={lost ? "1" : undefined} className="flex w-full max-w-[860px] flex-col items-center gap-2">
      <BoardBar>
        {lost ? (
          <span className="max-w-[640px] text-center text-rose-700 dark:text-rose-300">{LOST_FLEET}</span>
        ) : (
          <>
            {phase === "place" && <span>{nextLen ? `Place your ${shipName(fleet.length)} — ${nextLen} squares (${fleet.length + 1} of ${SHIPS.length}) on your sea` : "Fleet placed — press Ready"}</span>}
            {phase === "wait" && <span>Your fleet is in place. Waiting for {name(other)} to place theirs…</span>}
            {phase === "fire" && <span data-sea-hits>Hits: you {state.hits[seat]} · {name(other)} {state.hits[other]} of 17{canFire ? " — call a square on their sea" : ""}</span>}
          </>
        )}
      </BoardBar>
      {phase === "place" && <div data-sea-hint className="min-h-[18px] text-center text-[12px] font-semibold text-amber-700 dark:text-amber-300">{hint ?? ""}</div>}
      {phase === "fire" && !lost && <div data-sea-news className="min-h-[18px] text-[13px] font-semibold text-slate-700 dark:text-slate-200">{news ?? ""}</div>}
      <SceneBox hostRef={hostRef} aspect={1.95} minH={280} maxH={460} testId="battleship" />
      {phase === "fire" && !lost && (
        <div className="flex w-full flex-wrap justify-around gap-2">
          <FleetList s={state} sunkBy={seat} title="Their ships:" />
          <FleetList s={state} sunkBy={other} title="Your ships:" />
        </div>
      )}
      {phase === "place" && (
        <div className="flex flex-wrap items-center justify-center gap-1.5 text-[12px]">
          <button
            type="button"
            data-sea-rotate
            onClick={() => {
              setHint(null);
              setHorizontal((h) => !h);
            }}
            className={`${quiet3} inline-flex items-center gap-1`}
          >
            <RefreshCw className="h-3.5 w-3.5" /> {horizontal ? "Across" : "Down"}
          </button>
          <button
            type="button"
            data-sea-random
            onClick={() => {
              setHint(null);
              onSecret?.({ fleet: randomFleet(Date.now() & 0xffffffff) });
            }}
            className={`${quiet3} inline-flex items-center gap-1`}
          >
            <Shuffle className="h-3.5 w-3.5" /> Place for me
          </button>
          <button
            type="button"
            data-sea-clear
            onClick={() => {
              setHint(null);
              onSecret?.({ fleet: [] });
            }}
            className={`${quiet3} inline-flex items-center gap-1`}
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </button>
          <button type="button" data-sea-ready disabled={fleet.length !== SHIPS.length || !canPlay} onClick={() => onMove(`${seat}@ready`)} className={primary3}>
            Ready
          </button>
        </div>
      )}
      <HiddenActions actions={actions} label="Squares to fire at" />
      <span className="hidden" data-sea-fleet-cells={taken.size} />
    </div>
  );
}
