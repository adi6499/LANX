/** LANX 3.21.0: the magnifying glass. Every glass panel, bar, window and menu
 *  becomes clear glass, frosted only a little, that shows what passes under
 *  it bigger, and drawn out long towards its edges — like Apple's glass.
 *  (The same lens as the Expenses app and Music Flow; the look the user
 *  picked in the demo, then asked bigger: 1.5×, stretch 100 %.)
 *
 *  How: each glass element gets its own picture (a displacement map: each
 *  pixel says where to look instead), used through an SVG filter in
 *  `backdrop-filter`. Elements of the same size share one filter. App.css
 *  draws the glass when <html> has the class `lanx-mag`; this file only
 *  hands each element its filter in `--lanx-lens`.
 *
 *  Only Chromium can bend what is behind an element (WebView2 on Windows,
 *  Chrome on Android). Linux (WebKitGTK), iPhones and Firefox keep the
 *  ordinary glass, and so does a PC where it is switched off (Settings →
 *  Appearance → Magnifying glass). Cosmetic only: any failure leaves plain glass. */
import { IS_LINUX } from "./platform";

const KEY = "lanx_glass_mag";
let wanted = true;
try {
  wanted = localStorage.getItem(KEY) !== "off";
} catch {
  /* no storage: on */
}

function isChromium(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  try {
    if ((window as unknown as { chrome?: unknown }).chrome) return true;
    const brands = (navigator as unknown as { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands;
    if (brands?.some((b) => /Chromium|Chrome|Edge|Opera|Brave/i.test(b.brand))) return true;
  } catch {
    /* fall through to the name */
  }
  const ua = navigator.userAgent || "";
  return /Chrome\/\d+|Chromium\/\d+|EdgA?\/\d+|SamsungBrowser\/\d+/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

/** The small alert window over other programs (main.tsx): nothing of LANX is behind it to magnify. */
const ownWindow = (() => {
  try {
    if (typeof location !== "undefined" && /^#(island|remote|hud)$/.test(location.hash)) return true;
    const label = (window as unknown as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } }).__TAURI_INTERNALS__?.metadata?.currentWindow?.label;
    return !!label && label !== "main";
  } catch {
    return false;
  }
})();

/** Can this browser draw the magnifying glass at all? */
export const canMagnify =
  !IS_LINUX &&
  !ownWindow &&
  typeof CSS !== "undefined" &&
  typeof CSS.supports === "function" &&
  CSS.supports("backdrop-filter", "blur(1px)") &&
  isChromium();

/** The switch (Settings → Appearance → Glass). */
export const magnifierWanted = () => wanted;
/** Whether the magnifying glass is drawn on this device. */
export const magnifierOn = () => wanted && canMagnify;
export function setMagnifier(v: boolean) {
  wanted = v;
  try {
    localStorage.setItem(KEY, v ? "on" : "off");
  } catch {
    /* fine */
  }
}

// ------------------------------------------------------------------ the lens

/** The look: how much bigger, and how much it is drawn out at the edges (0…1). */
const MAG = 1.5;
const STRETCH = 1;
/** Bigger than this (its short side) is a panel or a window. */
const BAR_MAX = 120;
/** A panel's stretched rim, in pixels: inside it, everything is evenly bigger. */
const RIM = 56;

const bow = (u: number) => (2 / Math.PI) * Math.sin((Math.PI * u) / 2);
/** 0 = an even magnifier; 1 = it grows towards the edge. Never folds back on itself. */
const curve = (u: number, s: number) => (1 - s) * u + s * bow(u);
/** Where a point at distance u (0 = middle, 1 = rim) shows from. */
const sampleAt = (u: number) => curve(u, STRETCH) / MAG;

/** Along one side of a panel: where a point t from the middle (half = half its size, b = the rim) shows from. */
function panelAxis(t: number, half: number, b: number): number {
  const a = Math.abs(t);
  const inner = half - b;
  if (a <= inner) return t / MAG;
  // In the rim the curve carries on at the same slope and flattens out at the edge.
  return Math.sign(t) * (inner + b * curve(Math.min(1, (a - inner) / b), STRETCH)) / MAG;
}

function makeMap(w: number, h: number, radius: number): { url: string; scale: number } | null {
  const short = Math.min(w, h);
  const bar = short <= BAR_MAX;
  const pill = bar && radius >= short / 2 - 1;
  // Big panels need no full-size picture: it is smooth, and stretched over the panel
  // (and a coarse one, smoothed between its points, also keeps the even middle exact).
  const step = bar ? Math.max(1, Math.ceil(Math.max(w, h) / 640)) : Math.max(1, Math.ceil(Math.max(w, h) / 200));
  const mw = Math.ceil(w / step);
  const mh = Math.ceil(h / step);
  const ox = new Float32Array(mw * mh);
  const oy = new Float32Array(mw * mh);
  let max = 0.01;
  const mx = Math.max(1, MAG * 0.95);
  for (let py = 0; py < mh; py++) {
    for (let px = 0; px < mw; px++) {
      const x = (px + 0.5) * step;
      const y = (py + 0.5) * step;
      let dx = 0;
      let dy = 0;
      if (pill) {
        // A round pill: bigger towards its middle line, round at both ends…
        const rad = short / 2;
        const sx = Math.max(rad, Math.min(w - rad, x));
        const sy = Math.max(rad, Math.min(h - rad, y));
        const vx = x - sx;
        const vy = y - sy;
        const dist = Math.hypot(vx, vy);
        if (dist > 0) {
          const k = (sampleAt(Math.min(1, dist / rad)) * rad - dist) / dist;
          dx = vx * k;
          dy = vy * k;
        }
        // …and widened along its length, drawn out towards its two ends.
        if (w > h) dx += (w / 2) * (curve((x - w / 2) / (w / 2), STRETCH * 0.6) / mx) - (x - w / 2);
        else if (h > w) dy += (h / 2) * (curve((y - h / 2) / (h / 2), STRETCH * 0.6) / mx) - (y - h / 2);
      } else if (bar) {
        // A straight bar (a top bar, the message box): bigger top to bottom, stretched at its
        // top and bottom edges, and widened along its length.
        const half = h / 2;
        const d = y - half;
        dy = Math.sign(d) * sampleAt(Math.min(1, Math.abs(d) / half)) * half - d;
        const hw = w / 2;
        dx = hw * (curve((x - hw) / hw, STRETCH * 0.6) / mx) - (x - hw);
      } else {
        // A panel or a window: one big magnifying glass. Evenly bigger inside, and drawn out
        // long in a rim along its four edges.
        const b = Math.min(RIM, short / 4);
        dx = panelAxis(x - w / 2, w / 2, b) - (x - w / 2);
        dy = panelAxis(y - h / 2, h / 2, b) - (y - h / 2);
      }
      const i = py * mw + px;
      ox[i] = dx;
      oy[i] = dy;
      max = Math.max(max, Math.abs(dx), Math.abs(dy));
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = mw;
  canvas.height = mh;
  const g = canvas.getContext("2d");
  if (!g) return null;
  const img = g.createImageData(mw, mh);
  for (let i = 0; i < mw * mh; i++) {
    img.data[i * 4] = Math.round(128 + (ox[i] / max) * 127);
    img.data[i * 4 + 1] = Math.round(128 + (oy[i] / max) * 127);
    img.data[i * 4 + 2] = 128;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return { url: canvas.toDataURL("image/png"), scale: Math.round(max * 2 * 100) / 100 };
}

// One filter per size and shape, shared, and removed once nothing uses it.
const SVG = "http://www.w3.org/2000/svg";
const made = new Map<string, { id: string; node: Element; users: number }>();
let host: SVGSVGElement | null = null;
let count = 0;

function defs(): Element {
  if (!host || !host.isConnected) {
    host = document.createElementNS(SVG, "svg");
    host.setAttribute("aria-hidden", "true");
    host.setAttribute("width", "0");
    host.setAttribute("height", "0");
    host.setAttribute("data-glass-magnifier", "");
    host.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
    host.appendChild(document.createElementNS(SVG, "defs"));
    document.body.appendChild(host);
  }
  return host.firstChild as Element;
}

function acquire(key: string, w: number, h: number, radius: number): string {
  const had = made.get(key);
  if (had) {
    had.users++;
    return had.id;
  }
  const map = makeMap(w, h, radius);
  if (!map) return "";
  const id = `lanx-mag-${++count}`;
  const filter = document.createElementNS(SVG, "filter");
  filter.id = id;
  filter.setAttribute("filterUnits", "userSpaceOnUse");
  filter.setAttribute("primitiveUnits", "userSpaceOnUse");
  // Without this the map's neutral grey would be read as a small constant shift.
  filter.setAttribute("color-interpolation-filters", "sRGB");
  const picture = document.createElementNS(SVG, "feImage");
  picture.setAttribute("href", map.url);
  picture.setAttribute("preserveAspectRatio", "none");
  picture.setAttribute("result", "m");
  for (const node of [filter, picture]) {
    node.setAttribute("x", "0");
    node.setAttribute("y", "0");
    node.setAttribute("width", String(w));
    node.setAttribute("height", String(h));
  }
  const bend = document.createElementNS(SVG, "feDisplacementMap");
  bend.setAttribute("in", "SourceGraphic");
  bend.setAttribute("in2", "m");
  bend.setAttribute("scale", String(map.scale));
  bend.setAttribute("xChannelSelector", "R");
  bend.setAttribute("yChannelSelector", "G");
  filter.append(picture, bend);
  defs().appendChild(filter);
  made.set(key, { id, node: filter, users: 1 });
  return id;
}

function release(key: string) {
  const had = made.get(key);
  if (!had || --had.users > 0) return;
  had.node.remove();
  made.delete(key);
}

// ------------------------------------------------------------- the watcher

// Everything that floats or lies on the background: panels, bars, windows, menus, cards,
// the island (pop-up alerts, uploads) and the delivery cat's speech bubble.
const GLASS = ".lanx-glass, .lanx-bar, .lanx-sheet, .lanx-menu, .lanx-card, .lanx-island, .lanx-cat-bubble";
const tracked = new Map<HTMLElement, string>();
let sizes: ResizeObserver | null = null;
let watcher: MutationObserver | null = null;
let running = false;

function fit(el: HTMLElement) {
  try {
    if (!el.isConnected || !el.matches(GLASS)) {
      forget(el);
      return;
    }
    // offsetWidth/Height ignore a window's opening animation (a scale), which is what we want.
    const w = Math.round(el.offsetWidth);
    const h = Math.round(el.offsetHeight);
    if (w < 8 || h < 8) return;
    const r = Math.round(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0);
    const key = `${w}x${h}x${Math.min(r, Math.floor(Math.min(w, h) / 2))}`;
    const old = tracked.get(el);
    if (old === key) return;
    const id = acquire(key, w, h, r);
    if (old) release(old);
    if (!id) {
      tracked.delete(el);
      el.style.removeProperty("--lanx-lens");
      return;
    }
    tracked.set(el, key);
    el.style.setProperty("--lanx-lens", `url(#${id})`);
  } catch {
    forget(el); // plain glass stays
  }
}

function forget(el: HTMLElement) {
  const key = tracked.get(el);
  if (key) release(key);
  tracked.delete(el);
  sizes?.unobserve(el);
  el.style.removeProperty("--lanx-lens");
}

function watch(el: HTMLElement) {
  if (tracked.has(el)) return;
  tracked.set(el, "");
  sizes?.observe(el); // fires once at once, which draws it
}

function scan(root: ParentNode) {
  if (root instanceof HTMLElement && root.matches(GLASS)) watch(root);
  root.querySelectorAll<HTMLElement>(GLASS).forEach(watch);
}

function start() {
  if (running || typeof document === "undefined" || typeof ResizeObserver === "undefined") return;
  running = true;
  sizes = new ResizeObserver((list) => list.forEach((e) => fit(e.target as HTMLElement)));
  watcher = new MutationObserver((list) => {
    let gone = false;
    for (const m of list) {
      if (m.type === "attributes") {
        const el = m.target as HTMLElement;
        if (el.matches?.(GLASS)) watch(el);
        else if (tracked.has(el)) forget(el);
        continue;
      }
      m.addedNodes.forEach((n) => n instanceof HTMLElement && scan(n));
      if (m.removedNodes.length) gone = true;
    }
    if (gone) for (const el of tracked.keys()) if (!el.isConnected) forget(el);
  });
  watcher.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
  scan(document.body);
}

function stop() {
  if (!running) return;
  running = false;
  watcher?.disconnect();
  watcher = null;
  for (const el of [...tracked.keys()]) forget(el);
  sizes?.disconnect();
  sizes = null;
}

/** Called whenever the appearance is applied: draws the magnifying glass, or takes it away. */
export function syncMagnifier(on: boolean) {
  try {
    if (on) start();
    else stop();
  } catch {
    stop();
  }
}
