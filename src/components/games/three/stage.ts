// LANX 2.16.0: the 3D stage every game draws on — one WebGL renderer, a
// camera that frames the board, soft light with shadows, gentle reflections,
// and pointer picking. It only draws when something changes or moves
// (turn-based boards sit idle at zero cost); the live arcade games ask for
// every frame. dispose() frees the GPU memory, the listeners and the loop,
// so switching games never leaves a scene running.
//
// The stage never decides anything about a game: boards replay the rules
// (lib/games) and only show the result here.

import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { releaseShared } from "./kit";

export interface PickInfo {
  onClick?: (hit: THREE.Intersection) => void;
  onHover?: (on: boolean, hit?: THREE.Intersection) => void;
  /** Mouse cursor while over it (default "pointer"). */
  cursor?: string;
  /** Picked only while this says so. */
  enabled?: () => boolean;
}

export interface StageOptions {
  /** Field of view, degrees. */
  fov?: number;
  /** Shadows from the key light (default on). */
  shadows?: boolean;
  /** Draw every frame (live games). */
  continuous?: boolean;
  /** A faint shadow under the board on the panel itself (default on). */
  ground?: boolean;
}

type FrameFn = (dt: number, t: number) => boolean | void;

interface Framing {
  box: THREE.Box3;
  dir: THREE.Vector3;
  margin: number;
  /** Shift the look-at point (world units), e.g. to leave room for a hand of cards. */
  shift?: THREE.Vector3;
}

/** Views the player dragged to, per game, until LANX closes. */
const savedViews = new Map<string, THREE.Vector3>();

let alive = 0;
function countStages(d: number) {
  alive += d;
  try {
    (window as unknown as { __lanxStages?: number }).__lanxStages = alive;
  } catch {
    /* fine */
  }
}

export const prefersReducedMotion = () => {
  try {
    return document.documentElement.classList.contains("reduce-motion") || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

export const isDark = () => document.documentElement.classList.contains("dark");

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly host: HTMLElement;
  readonly key: THREE.DirectionalLight;
  readonly reduceMotion = prefersReducedMotion();
  /** Pointer position in normalised device coordinates (−1…1). */
  readonly ndc = new THREE.Vector2(9, 9);
  /** Called with the pointer over the canvas (aiming), its press and release. */
  onPointerMove: ((e: PointerEvent) => void) | null = null;
  onPointerDown: ((e: PointerEvent) => void) | null = null;
  onPointerUp: ((e: PointerEvent) => void) | null = null;
  /** A click (no drag) that hit nothing pickable — boards that pick cells by position use it. */
  onTap: ((e: PointerEvent) => void) | null = null;
  /** Called when the GPU drops the drawing (the board then shows flat). */
  onLost: (() => void) | null = null;

  private raf = 0;
  private last = 0;
  private frameFns = new Set<FrameFn>();
  private pickables = new Set<THREE.Object3D>();
  private hovered: THREE.Object3D | null = null;
  private ray = new THREE.Raycaster();
  private ro: ResizeObserver;
  private disposed = false;
  private framing: Framing | null = null;
  private view: { key: string; homeDir: THREE.Vector3; maxTilt: number; turn: number } | null = null;
  private dragging: { x: number; y: number; az: number; tilt: number } | null = null;
  private down: { x: number; y: number } | null = null;
  private continuous: boolean;
  private ground: THREE.Mesh | null = null;
  private envTex: THREE.Texture | null = null;
  private onVis = () => this.invalidate();
  private onLostCtx = (e: Event) => {
    e.preventDefault();
    this.onLost?.();
  };

  constructor(host: HTMLElement, opts: StageOptions = {}) {
    this.host = host;
    this.continuous = !!opts.continuous;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "default" });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    if (opts.shadows !== false) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFShadowMap;
    }
    const cv = this.renderer.domElement;
    cv.style.display = "block";
    cv.style.width = "100%";
    cv.style.height = "100%";
    cv.style.touchAction = "none";
    cv.style.outline = "none";
    cv.setAttribute("data-g3-canvas", "");
    host.appendChild(cv);

    this.camera = new THREE.PerspectiveCamera(opts.fov ?? 34, 1, 0.05, 400);
    this.camera.position.set(0, 10, 10);
    this.camera.lookAt(0, 0, 0);

    // Light: a soft sky, a warm key light with shadows, a cool fill.
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8478, 0.85));
    this.key = new THREE.DirectionalLight(0xfff6ea, 1.75);
    this.key.position.set(-4, 12, 7);
    this.key.castShadow = opts.shadows !== false;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.radius = 4;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.02;
    this.scene.add(this.key, this.key.target);
    const fill = new THREE.DirectionalLight(0xe8f0ff, 0.4);
    fill.position.set(6, 5, -4);
    this.scene.add(fill);

    // Gentle reflections for glossy pieces (no picture files needed).
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const room = new RoomEnvironment();
      this.envTex = pmrem.fromScene(room, 0.04).texture;
      this.scene.environment = this.envTex;
      this.scene.environmentIntensity = 0.42;
      disposeTree(room);
      pmrem.dispose();
    } catch {
      /* no reflections: the pieces still look fine */
    }

    if (opts.ground !== false) {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: isDark() ? 0.42 : 0.2 }));
      g.rotation.x = -Math.PI / 2;
      g.position.y = -0.001;
      g.receiveShadow = true;
      g.renderOrder = -1;
      this.ground = g;
      this.scene.add(g);
    }

    cv.addEventListener("pointermove", this.pmove);
    cv.addEventListener("pointerdown", this.pdown);
    cv.addEventListener("pointerup", this.pup);
    cv.addEventListener("pointerleave", this.pleave);
    cv.addEventListener("contextmenu", this.noMenu);
    cv.addEventListener("webglcontextlost", this.onLostCtx);
    document.addEventListener("visibilitychange", this.onVis);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    countStages(1);
  }

  /** The ground's height (the board usually stands on it). */
  setGroundY(y: number) {
    if (this.ground) this.ground.position.y = y;
  }

  // ------------------------------------------------------------ drawing

  /** Draws one more frame soon. */
  invalidate() {
    if (this.raf || this.disposed) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  /** A function run every frame; return true while it still needs frames. Returns its remover. */
  onFrame(fn: FrameFn): () => void {
    this.frameFns.add(fn);
    this.invalidate();
    return () => {
      this.frameFns.delete(fn);
    };
  }

  setContinuous(on: boolean) {
    this.continuous = on;
    this.invalidate();
  }

  private loop = (now: number) => {
    this.raf = 0;
    if (this.disposed) return;
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    let busy = this.continuous;
    for (const fn of [...this.frameFns]) {
      try {
        if (fn(dt, now / 1000)) busy = true;
      } catch {
        this.frameFns.delete(fn); // a broken animation never stops the board
      }
    }
    try {
      this.renderer.render(this.scene, this.camera);
    } catch {
      /* a lost context: the board falls back to flat (see Board3D) */
    }
    if (busy && !this.disposed) this.raf = requestAnimationFrame(this.loop);
  };

  // ------------------------------------------------------------ animation

  private anims = new Set<{ finish: () => void }>();

  /** Runs fn(t) with t from 0 to 1 over `ms` (eased); resolves at the end. Reduced motion shortens it. */
  animate(ms: number, fn: (t: number) => void, ease: (t: number) => number = easeInOut): Promise<void> {
    const dur = this.reduceMotion ? Math.min(ms, 120) : ms;
    return new Promise((resolve) => {
      let start = -1;
      let done = false;
      let remove = () => {};
      const a = {
        finish: () => {
          if (done) return;
          done = true;
          try {
            fn(1);
          } catch {
            /* fine */
          }
          remove();
          this.anims.delete(a);
          this.invalidate();
          resolve();
        },
      };
      this.anims.add(a);
      if (this.disposed) {
        a.finish();
        return;
      }
      remove = this.onFrame((_dt, t) => {
        if (done) return false;
        if (start < 0) start = t;
        const k = dur <= 0 ? 1 : Math.min(1, ((t - start) * 1000) / dur);
        fn(ease(k));
        if (k >= 1) {
          a.finish();
          return false;
        }
        return true;
      });
    });
  }

  /** Waits (in animation time). */
  wait(ms: number) {
    return this.animate(ms, () => {}, linear);
  }

  /** Jumps every running animation to its end (a new move arrived). */
  finishAll() {
    for (const a of [...this.anims]) a.finish();
  }

  get animating() {
    return this.anims.size > 0;
  }

  get isDisposed() {
    return this.disposed;
  }

  // ------------------------------------------------------------ camera

  /** Frames a box from a direction (from the target towards the camera); kept on resize. */
  frame(box: THREE.Box3, dir: THREE.Vector3 | [number, number, number], margin = 1.06, shift?: THREE.Vector3) {
    const d = (Array.isArray(dir) ? new THREE.Vector3(...dir) : dir.clone()).normalize();
    // A view the player set by dragging (this game, this session) is kept.
    const saved = this.view ? savedViews.get(this.view.key) : undefined;
    this.framing = { box: box.clone(), dir: saved ? saved.clone() : d, margin, shift };
    if (this.view) this.view.homeDir = d;
    this.applyFraming();
    this.invalidate();
  }

  /**
   * Lets the player drag the empty table to tilt and turn the view (within limits);
   * a double-click puts it back. `key` remembers the view for this game until LANX closes.
   * Call before frame().
   */
  allowViewDrag(key: string, maxTiltDeg = 62, turnDeg = 50) {
    this.view = { key, homeDir: this.framing?.dir.clone() ?? new THREE.Vector3(0, 1, 0.3).normalize(), maxTilt: (maxTiltDeg * Math.PI) / 180, turn: (turnDeg * Math.PI) / 180 };
    this.renderer.domElement.addEventListener("dblclick", this.resetView);
  }

  private resetView = () => {
    const v = this.view;
    const f = this.framing;
    if (!v || !f || this.pickAt()) return;
    savedViews.delete(v.key);
    const from = f.dir.clone();
    const to = v.homeDir.clone();
    void this.animate(380, (t) => {
      f.dir.copy(from).lerp(to, t).normalize();
      this.applyFraming();
    });
  };

  private dragView(e: PointerEvent) {
    const v = this.view;
    const f = this.framing;
    const d = this.dragging;
    if (!v || !f || !d) return;
    const h = Math.max(200, this.host.clientHeight);
    const homeAz = Math.atan2(v.homeDir.x, v.homeDir.z);
    let az = d.az - ((e.clientX - d.x) / h) * Math.PI * 0.9;
    az = homeAz + Math.max(-v.turn, Math.min(v.turn, az - homeAz));
    const tilt = Math.max(0.02, Math.min(v.maxTilt, d.tilt - ((e.clientY - d.y) / h) * Math.PI * 0.9));
    f.dir.set(Math.sin(tilt) * Math.sin(az), Math.cos(tilt), Math.sin(tilt) * Math.cos(az));
    savedViews.set(v.key, f.dir.clone());
    this.applyFraming();
    this.invalidate();
  }

  private applyFraming() {
    const f = this.framing;
    if (!f) return;
    const centre = f.box.getCenter(new THREE.Vector3());
    if (f.shift) centre.add(f.shift);
    const corners: THREE.Vector3[] = [];
    for (const x of [f.box.min.x, f.box.max.x]) for (const y of [f.box.min.y, f.box.max.y]) for (const z of [f.box.min.z, f.box.max.z]) corners.push(new THREE.Vector3(x, y, z));
    const cam = this.camera;
    const p = new THREE.Vector3();
    const fits = (d: number) => {
      cam.position.copy(centre).addScaledVector(f.dir, d);
      cam.lookAt(centre);
      cam.updateMatrixWorld(true);
      const lim = 1 / f.margin;
      for (const c of corners) {
        p.copy(c).project(cam);
        if (Math.abs(p.x) > lim || Math.abs(p.y) > lim || p.z > 1 || p.z < -1) return false;
      }
      return true;
    };
    // Search with a deep view so the last framing's near and far planes cannot get in the way.
    cam.near = 0.01;
    cam.far = 10000;
    cam.updateProjectionMatrix();
    let lo = 0.5;
    let hi = 400;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    cam.near = Math.max(0.05, hi / 60);
    cam.far = hi * 6 + 50;
    cam.updateProjectionMatrix();
    fits(hi);
    // The key light's shadow covers the box.
    const size = f.box.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.z) * 0.75 + 2;
    const sc = this.key.shadow.camera as THREE.OrthographicCamera;
    sc.left = -r;
    sc.right = r;
    sc.top = r;
    sc.bottom = -r;
    sc.near = 0.5;
    sc.far = 80;
    sc.updateProjectionMatrix();
    this.key.target.position.copy(centre);
    this.key.position.copy(centre).add(new THREE.Vector3(-0.3, 1, 0.5).multiplyScalar(Math.max(14, r * 1.6)));
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.applyFraming();
    this.invalidate();
  }

  // ------------------------------------------------------------ picking

  /** Makes an object clickable / hoverable. */
  pickable<T extends THREE.Object3D>(obj: T, info: PickInfo): T {
    obj.userData.pick = info;
    this.pickables.add(obj);
    return obj;
  }

  unpick(obj: THREE.Object3D) {
    this.pickables.delete(obj);
    if (this.hovered === obj) this.setHover(null);
    delete obj.userData.pick;
  }

  /** The point where the pointer's ray meets a horizontal plane at height y (or null). */
  pointOnPlane(y = 0, ndc: THREE.Vector2 = this.ndc): THREE.Vector3 | null {
    return this.pointOn(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), ndc);
  }

  /** The point where the pointer's ray meets any plane. */
  pointOn(plane: THREE.Plane, ndc: THREE.Vector2 = this.ndc): THREE.Vector3 | null {
    if (Math.abs(ndc.x) > 1.5 || Math.abs(ndc.y) > 1.5) return null;
    this.ray.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(plane, p) ? p : null;
  }

  /** Where a world point is on the canvas, in CSS pixels. */
  toScreen(p: THREE.Vector3): { x: number; y: number } {
    const v = p.clone().project(this.camera);
    return { x: ((v.x + 1) / 2) * this.host.clientWidth, y: ((1 - v.y) / 2) * this.host.clientHeight };
  }

  /** Re-checks what is under the pointer (after pieces moved). */
  refreshHover() {
    const p = this.pickAt();
    this.setHover(p?.obj ?? null, p?.hit);
  }

  private pickAt(): { obj: THREE.Object3D; hit: THREE.Intersection } | null {
    if (!this.pickables.size || Math.abs(this.ndc.x) > 1) return null;
    this.ray.setFromCamera(this.ndc, this.camera);
    const list = [...this.pickables].filter((o) => o.visible && (o.userData.pick as PickInfo | undefined)?.enabled?.() !== false);
    if (!list.length) return null;
    const hits = this.ray.intersectObjects(list, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !this.pickables.has(o)) o = o.parent;
      if (o) return { obj: o, hit: h };
    }
    return null;
  }

  private setHover(obj: THREE.Object3D | null, hit?: THREE.Intersection) {
    if (this.hovered === obj) return;
    const prev = this.hovered;
    this.hovered = obj;
    (prev?.userData.pick as PickInfo | undefined)?.onHover?.(false);
    (obj?.userData.pick as PickInfo | undefined)?.onHover?.(true, hit);
    this.renderer.domElement.style.cursor = obj ? ((obj.userData.pick as PickInfo).cursor ?? "pointer") : this.view ? "grab" : "";
    this.invalidate();
  }

  private setNdc(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1, -((e.clientY - r.top) / Math.max(1, r.height)) * 2 + 1);
  }

  private pmove = (e: PointerEvent) => {
    this.setNdc(e);
    if (this.dragging) {
      this.dragView(e);
      return;
    }
    this.onPointerMove?.(e);
    const p = this.pickAt();
    this.setHover(p?.obj ?? null, p?.hit);
  };

  private pdown = (e: PointerEvent) => {
    this.setNdc(e);
    this.down = { x: e.clientX, y: e.clientY };
    const f = this.framing;
    if (this.view && f && !this.pickAt()) {
      this.dragging = { x: e.clientX, y: e.clientY, az: Math.atan2(f.dir.x, f.dir.z), tilt: Math.acos(Math.max(-1, Math.min(1, f.dir.y))) };
      this.renderer.domElement.style.cursor = "grabbing";
    }
    try {
      this.renderer.domElement.setPointerCapture(e.pointerId);
    } catch {
      /* fine */
    }
    this.onPointerDown?.(e);
  };

  private pup = (e: PointerEvent) => {
    this.setNdc(e);
    if (this.dragging) {
      this.dragging = null;
      this.renderer.domElement.style.cursor = this.view ? "grab" : "";
    }
    this.onPointerUp?.(e);
    const d = this.down;
    this.down = null;
    if (!d || e.button !== 0) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) return;
    const p = this.pickAt();
    if (p) (p.obj.userData.pick as PickInfo | undefined)?.onClick?.(p.hit);
    else this.onTap?.(e);
  };

  private pleave = () => {
    if (this.down) return; // still dragging (pointer capture)
    this.ndc.set(9, 9);
    this.setHover(null);
  };

  private noMenu = (e: Event) => e.preventDefault();

  // ------------------------------------------------------------ the end

  /** Frees everything: GPU memory, listeners, the loop. Safe to call twice. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const a of [...this.anims]) a.finish();
    this.frameFns.clear();
    this.ro.disconnect();
    const cv = this.renderer.domElement;
    cv.removeEventListener("pointermove", this.pmove);
    cv.removeEventListener("pointerdown", this.pdown);
    cv.removeEventListener("pointerup", this.pup);
    cv.removeEventListener("pointerleave", this.pleave);
    cv.removeEventListener("contextmenu", this.noMenu);
    cv.removeEventListener("webglcontextlost", this.onLostCtx);
    cv.removeEventListener("dblclick", this.resetView);
    document.removeEventListener("visibilitychange", this.onVis);
    this.onPointerMove = this.onPointerDown = this.onPointerUp = this.onLost = this.onTap = null;
    disposeTree(this.scene);
    releaseShared();
    this.envTex?.dispose();
    this.pickables.clear();
    this.renderer.dispose();
    try {
      this.renderer.forceContextLoss();
    } catch {
      /* fine */
    }
    cv.remove();
    countStages(-1);
  }
}

/** Frees the geometry, materials and textures of everything under `root` (shared ones are kept). */
export function disposeTree(root: THREE.Object3D) {
  const mats = new Set<THREE.Material>();
  const geos = new Set<THREE.BufferGeometry>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !m.geometry.userData?.shared) geos.add(m.geometry);
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => mats.add(x));
    else if (mat) mats.add(mat);
  });
  for (const g of geos) g.dispose();
  for (const m of mats) {
    if (m.userData?.shared) continue;
    for (const v of Object.values(m)) {
      const t = v as THREE.Texture | null;
      if (t && t.isTexture && !t.userData?.shared) t.dispose();
    }
    m.dispose();
  }
}

// ------------------------------------------------------------ easing

export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeIn = (t: number) => t * t * t;
export const linear = (t: number) => t;
/** A soft spring that settles just past the end and back. */
export const springOut = (t: number) => {
  const c = 1.4;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
