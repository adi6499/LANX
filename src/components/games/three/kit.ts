// LANX 2.16.0: the parts box for the 3D games — materials (wood, felt,
// lacquer, glossy plastic), pictures painted on a canvas (board tops,
// labels, numbers) and the shapes of the pieces (pawns, discs, balls,
// stones). Plain and clean on purpose: soft matte surfaces and a little
// gloss, no glowing effects.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export const FONT = `"Plus Jakarta Sans", "Segoe UI", system-ui, sans-serif`;

// ------------------------------------------------------------ canvas pictures

/** A picture drawn on a canvas, as a texture (sRGB, sharp at an angle). */
export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, renderer?: THREE.WebGLRenderer): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, renderer?.capabilities.getMaxAnisotropy() ?? 4);
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Repaints a canvas texture in place. */
export function repaint(t: THREE.CanvasTexture, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
  const c = t.image as HTMLCanvasElement;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, c.width, c.height);
  draw(ctx, c.width, c.height);
  t.needsUpdate = true;
}

/** Small deterministic noise (for wood grain and felt), so every PC paints the same texture. */
function noiseRng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
}

const texCache = new Map<string, THREE.Texture>();
function cachedTex(key: string, make: () => THREE.Texture): THREE.Texture {
  let t = texCache.get(key);
  if (!t) {
    t = make();
    t.userData.shared = true;
    texCache.set(key, t);
  }
  return t;
}

/** Wood grain (light, medium or dark), repeating. */
export function woodTexture(tone: "light" | "medium" | "dark" | "walnut" = "medium"): THREE.Texture {
  return cachedTex(`wood:${tone}`, () => {
    const base = { light: [222, 190, 140], medium: [176, 120, 70], dark: [92, 56, 30], walnut: [120, 78, 46] }[tone];
    const t = canvasTexture(512, 512, (ctx, w, h) => {
      const rnd = noiseRng(tone.length * 977 + 13);
      ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 140; i++) {
        const y = rnd() * h;
        const amp = 2 + rnd() * 7;
        const shade = (rnd() - 0.5) * 34;
        ctx.strokeStyle = `rgba(${base[0] + shade},${base[1] + shade * 0.8},${base[2] + shade * 0.6},${0.25 + rnd() * 0.35})`;
        ctx.lineWidth = 0.6 + rnd() * 2.4;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 8) {
          const yy = y + Math.sin((x / w) * Math.PI * (2 + rnd() * 0.2) + i) * amp;
          if (x === 0) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  });
}

/** A soft fabric for card tables and pool felt. */
export function feltTexture(): THREE.Texture {
  return cachedTex("felt", () => {
    const t = canvasTexture(256, 256, (ctx, w, h) => {
      const rnd = noiseRng(4242);
      ctx.fillStyle = "#808080";
      ctx.fillRect(0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 128 + (rnd() - 0.5) * 34;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      }
      ctx.putImageData(img, 0, 0);
    });
    t.colorSpace = THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  });
}

// ------------------------------------------------------------ materials

const matCache = new Map<string, THREE.Material>();
function shared<T extends THREE.Material>(key: string, make: () => T): T {
  let m = matCache.get(key) as T | undefined;
  if (!m) {
    m = make();
    m.userData.shared = true;
    matCache.set(key, m);
  }
  return m;
}

/** Glossy plastic (game pieces, tokens). */
export const plastic = (color: THREE.ColorRepresentation, rough = 0.32) =>
  shared(`plastic:${new THREE.Color(color).getHexString()}:${rough}`, () => new THREE.MeshPhysicalMaterial({ color, roughness: rough, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.25 }));

/** Matte paint. */
export const matte = (color: THREE.ColorRepresentation, rough = 0.75) => shared(`matte:${new THREE.Color(color).getHexString()}:${rough}`, () => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 }));

/** Varnished wood. */
export const wood = (tone: "light" | "medium" | "dark" | "walnut" = "medium", repeat = 1) =>
  shared(`wood:${tone}:${repeat}`, () => {
    const map = woodTexture(tone).clone();
    map.userData.shared = true;
    map.repeat.set(repeat, repeat);
    map.needsUpdate = true;
    return new THREE.MeshPhysicalMaterial({ map, roughness: 0.48, clearcoat: 0.35, clearcoatRoughness: 0.4 });
  });

/** Cloth (pool, cards, carrom-free tables). */
export const felt = (color: THREE.ColorRepresentation) =>
  shared(`felt:${new THREE.Color(color).getHexString()}`, () => {
    const bump = feltTexture().clone();
    bump.userData.shared = true;
    bump.repeat.set(6, 6);
    bump.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, bumpMap: bump, bumpScale: 0.6 });
  });

export const metal = (color: THREE.ColorRepresentation = 0xc0c4cc, rough = 0.28) => shared(`metal:${new THREE.Color(color).getHexString()}:${rough}`, () => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.9 }));

/** A material showing a canvas picture (a board top, a label). Not shared: the caller owns it. */
export const pictureMaterial = (map: THREE.Texture, rough = 0.6, opts: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ map, roughness: rough, metalness: 0, ...opts });

// ------------------------------------------------------------ shapes

const geoCache = new Map<string, THREE.BufferGeometry>();
export function sharedGeo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key) as T | undefined;
  if (!g) {
    g = make();
    g.userData.shared = true;
    geoCache.set(key, g);
  }
  return g;
}

const lathe = (pts: [number, number][], seg = 40) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);

/** A classic pawn (Ludo, Snakes & Ladders), 1 unit tall, base radius ~0.36. */
export const pawnGeometry = () =>
  sharedGeo("pawn", () =>
    lathe([
      [0, 0],
      [0.36, 0],
      [0.38, 0.04],
      [0.36, 0.1],
      [0.27, 0.15],
      [0.2, 0.24],
      [0.15, 0.42],
      [0.12, 0.56],
      [0.2, 0.6],
      [0.2, 0.64],
      [0.11, 0.67],
      [0.17, 0.72],
      [0.2, 0.8],
      [0.19, 0.88],
      [0.14, 0.95],
      [0.07, 0.99],
      [0, 1],
    ]),
  );

/** A flat round piece with a soft edge (checkers, backgammon, carrom coins). r = 1, height h. */
export const discGeometry = (h = 0.32, groove = true) =>
  sharedGeo(`disc:${h}:${groove}`, () => {
    const pts: [number, number][] = [
      [0, 0],
      [0.94, 0],
      [0.99, h * 0.12],
      [1, h * 0.35],
    ];
    if (groove) pts.push([0.97, h * 0.5], [1, h * 0.65]);
    pts.push([0.99, h * 0.88], [0.94, h], [0.74, h], [0.7, h * 0.92], [0.62, h * 0.92], [0.58, h], [0, h]);
    return lathe(pts, 48);
  });

/** A Go stone: a flattened lens. Diameter 1. */
export const stoneGeometry = () =>
  sharedGeo("stone", () => {
    const g = new THREE.SphereGeometry(0.5, 40, 20);
    g.scale(1, 0.42, 1);
    g.translate(0, 0.21, 0);
    return g;
  });

export const ballGeometry = (r = 0.5, seg = 40) => sharedGeo(`ball:${r}:${seg}`, () => new THREE.SphereGeometry(r, seg, Math.round(seg * 0.7)));

/** A rounded box with the floor at y = 0. */
export function slab(w: number, h: number, d: number, radius = 0.08, seg = 3): THREE.BufferGeometry {
  // The rounding can never be more than half the thinnest side (or the box turns inside out).
  radius = Math.max(0.001, Math.min(radius, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  // Round the corners by pushing vertices towards an inner box.
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const inner = new THREE.Vector3(w / 2 - radius, h / 2 - radius, d / 2 - radius);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const c = new THREE.Vector3(Math.max(-inner.x, Math.min(inner.x, v.x)), Math.max(-inner.y, Math.min(inner.y, v.y)), Math.max(-inner.z, Math.min(inner.z, v.z)));
    const dir = v.clone().sub(c);
    if (dir.lengthSq() > 0) {
      dir.normalize().multiplyScalar(radius);
      v.copy(c).add(dir);
    }
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  g.translate(0, h / 2, 0);
  return g;
}

/** A board: a thick slab of wood with a picture on top. Returns the group; its top is at `h`. */
export function boardSlab(w: number, d: number, h: number, top: THREE.Texture, side: THREE.Material = wood("walnut"), topRough = 0.55): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(slab(w, h, d, Math.min(0.12, h * 0.4)), side);
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.02, d - 0.02), pictureMaterial(top, topRough));
  face.rotation.x = -Math.PI / 2;
  face.position.y = h + 0.002;
  face.receiveShadow = true;
  g.add(face);
  return g;
}

/** A thin flat label (text on a transparent plane), lying flat (or standing if `standing`). */
export function labelMesh(text: string, opts: { size?: number; color?: string; weight?: number; standing?: boolean; bg?: string } = {}): THREE.Mesh {
  const size = opts.size ?? 0.4;
  const px = 96;
  const ctx0 = document.createElement("canvas").getContext("2d")!;
  ctx0.font = `${opts.weight ?? 700} ${px}px ${FONT}`;
  const tw = Math.ceil(ctx0.measureText(text).width) + px * 0.6;
  const tex = canvasTexture(tw, Math.round(px * 1.4), (ctx, w, h) => {
    if (opts.bg) {
      ctx.fillStyle = opts.bg;
      roundRect(ctx, 0, 0, w, h, h * 0.3);
      ctx.fill();
    }
    ctx.font = `${opts.weight ?? 700} ${px}px ${FONT}`;
    ctx.fillStyle = opts.color ?? "#0f172a";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, w / 2, h / 2 + px * 0.04);
  });
  const aspect = tw / (px * 1.4);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size * aspect, size), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
  if (!opts.standing) m.rotation.x = -Math.PI / 2;
  return m;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** A ring that marks a selectable piece or square (lying flat). Plain colour, no glow. */
export function markerRing(r = 0.5, color: THREE.ColorRepresentation = 0x4f46e5, width = 0.07): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.RingGeometry(r - width, r, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 2;
  return m;
}

/** A small flat dot (legal-move hints). */
export function markerDot(r = 0.16, color: THREE.ColorRepresentation = 0x0f172a, opacity = 0.35): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 2;
  return m;
}

/** Sets the colour of everything under an object at once (for highlights). */
export function setEmissive(obj: THREE.Object3D, hex: number, amount = 0) {
  obj.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m && "emissive" in m && !m.userData.shared) {
      m.emissive.setHex(hex);
      m.emissiveIntensity = amount;
    }
  });
}

/** Clones a shared material so one piece can change (a highlight) without touching the others. */
export function own<T extends THREE.Material>(m: T): T {
  const c = m.clone() as T;
  c.userData = { ...c.userData, shared: false };
  return c;
}

export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], shadows = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadows;
  m.receiveShadow = shadows;
  return m;
}

export const merge = (geos: THREE.BufferGeometry[]) => mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)), false)!;

/** Points along a quadratic hop from a to b (height h at the middle). */
export function hop(a: THREE.Vector3, b: THREE.Vector3, h: number, t: number, out = new THREE.Vector3()): THREE.Vector3 {
  out.lerpVectors(a, b, t);
  out.y += Math.sin(Math.PI * t) * h;
  return out;
}

const releasers = new Set<() => void>();
/** Something else to free with the shared parts (a module's own picture cache). */
export function onRelease(fn: () => void) {
  releasers.add(fn);
}

/** Frees the shared parts (when a stage closes): the next board makes fresh ones. */
export function releaseShared() {
  for (const fn of releasers) {
    try {
      fn();
    } catch {
      /* fine */
    }
  }
  for (const g of geoCache.values()) g.dispose();
  for (const m of matCache.values()) m.dispose();
  for (const t of texCache.values()) t.dispose();
  for (const m of matCache.values()) for (const v of Object.values(m)) if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose();
  geoCache.clear();
  matCache.clear();
  texCache.clear();
}

/** Colour helpers. */
export const hex = (c: string) => new THREE.Color(c);
export function shade(c: string, k: number): string {
  const col = new THREE.Color(c);
  const hsl = { h: 0, s: 0, l: 0 };
  col.getHSL(hsl);
  col.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l * k)));
  return `#${col.getHexString()}`;
}
