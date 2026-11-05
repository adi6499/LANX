/** LANX 3.5.0: hands → the page. Finds what the hand pointer is over (with a
 *  little pull towards nearby buttons, so small targets are easy to hit),
 *  and plays the pinches and grabs as the clicks, drags, scrolls and zooms
 *  the page already understands. Only inside LANX's own window. */

/** The pointer id gesture events carry (a real mouse is always 1). */
export const GESTURE_POINTER_ID = 7171;

const CLICKABLE = [
  "button:not([disabled])", "a[href]", '[role="button"]', '[role="menuitem"]', '[role="menuitemcheckbox"]', '[role="tab"]', '[role="option"]',
  '[role="checkbox"]', '[role="radio"]', '[role="switch"]', '[role="link"]', 'input:not([type="hidden"]):not([disabled])', "select:not([disabled])",
  "textarea:not([disabled])", "summary", "label", '[contenteditable=""]', '[contenteditable="true"]', "[data-gesture-target]",
].join(",");
const SNAP_PX = 30;
/** A pinch presses the lit button if the fingers met within this of it. */
const LIT_REACH = 48;
/** Bigger than this, the pointer stays a ring instead of hugging the target. */
const HUG_MAX = { w: 460, h: 140 };

export interface Target {
  el: Element;
  rect: DOMRect;
  radius: number;
  /** Small enough for the pointer to wrap around it. */
  hug: boolean;
}

const isOurs = (el: Element) => !!el.closest("[data-gesture-ui]");

/** The page element at a point, skipping LANX's own gesture layer. */
export function elementAt(x: number, y: number): Element | null {
  for (const el of document.elementsFromPoint(x, y)) if (!isOurs(el)) return el;
  return null;
}

function clickableAt(x: number, y: number): Element | null {
  const hit = elementAt(x, y);
  if (!hit) return null;
  const c = hit.closest(CLICKABLE);
  if (c) return c;
  // A clickable <div>: React leaves no mark on it, but it shows the hand cursor.
  let found: Element | null = null;
  let el: Element | null = hit;
  for (let i = 0; el && i < 6; i++, el = el.parentElement) {
    if (getComputedStyle(el).cursor === "pointer") found = el;
    else if (found) break;
  }
  return found;
}

const rectDist = (r: DOMRect, x: number, y: number) => Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));

/** What the pointer is over, or the nearest clickable thing within reach. */
export function findTarget(x: number, y: number): Target | null {
  let el = clickableAt(x, y);
  if (!el) {
    let best: Element | null = null;
    let bestD = SNAP_PX;
    for (const r of [14, 28]) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const c = clickableAt(x + Math.cos(a) * r, y + Math.sin(a) * r);
        if (!c || c === best) continue;
        const d = rectDist(c.getBoundingClientRect(), x, y);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
    }
    el = best;
  }
  return el ? targetOf(el) : null;
}

/** A clickable element as a target (null when it isn't shown). */
export function targetOf(el: Element): Target | null {
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
  return { el, rect, radius: Math.min(radius, rect.height / 2), hug: rect.width <= HUG_MAX.w && rect.height <= HUG_MAX.h && el.tagName !== "CANVAS" };
}

/** Where to press: the pointer itself, or the middle of the button it is pulled to. */
export function pointIn(t: Target | null, x: number, y: number): { x: number; y: number } {
  if (!t) return { x, y };
  const r = t.rect;
  if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { x, y };
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function scrollerOf(el: Element | null, axis: "x" | "y" | "any"): Element | null {
  for (let e = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
    const s = getComputedStyle(e);
    const y = /(auto|scroll|overlay)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 1;
    const x = /(auto|scroll|overlay)/.test(s.overflowX) && e.scrollWidth > e.clientWidth + 1;
    if ((axis !== "x" && y) || (axis !== "y" && x)) return e;
  }
  const root = document.scrollingElement;
  return root && root.scrollHeight > root.clientHeight + 1 ? root : null;
}

let captured: Element | null = null;
let patched = false;
/** Pointer capture with LANX's gesture pointer id (the browser only knows real pointers). */
function patchCapture() {
  if (patched) return;
  patched = true;
  const set = Element.prototype.setPointerCapture;
  const rel = Element.prototype.releasePointerCapture;
  const has = Element.prototype.hasPointerCapture;
  Element.prototype.setPointerCapture = function (id: number) {
    if (id === GESTURE_POINTER_ID) captured = this;
    else set.call(this, id);
  };
  Element.prototype.releasePointerCapture = function (id: number) {
    if (id === GESTURE_POINTER_ID) {
      if (captured === this) captured = null;
    } else rel.call(this, id);
  };
  Element.prototype.hasPointerCapture = function (id: number) {
    return id === GESTURE_POINTER_ID ? captured === this : has.call(this, id);
  };
}

function fire(el: Element, type: string, x: number, y: number, extra: { buttons?: number; button?: number; related?: Element | null; detail?: number } = {}) {
  const init: PointerEventInit = {
    bubbles: !/(enter|leave)$/.test(type),
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
    screenX: x + window.screenX,
    screenY: y + window.screenY,
    view: window,
    button: extra.button ?? 0,
    buttons: extra.buttons ?? 0,
    relatedTarget: extra.related ?? null,
    detail: extra.detail ?? 0,
    pointerId: GESTURE_POINTER_ID,
    pointerType: "mouse",
    isPrimary: true,
    width: 1,
    height: 1,
    pressure: extra.buttons ? 0.5 : 0,
  };
  return el.dispatchEvent(type.startsWith("pointer") ? new PointerEvent(type, init) : new MouseEvent(type, init));
}

/** Something here does its own thing while held (hold-to-talk, dragging an event,
 *  a right-click menu for a long pinch): a React press or right-click handler on it
 *  or round it, or a `data-gesture-hold` mark. */
function wantsHold(el: Element): boolean {
  for (let e: Element | null = el; e && e !== document.body; e = e.parentElement) {
    if (e.hasAttribute("data-gesture-hold")) return true;
    const key = Object.keys(e).find((k) => k.startsWith("__reactProps$"));
    const props = key ? (e as unknown as Record<string, { onPointerDown?: unknown; onContextMenu?: unknown } | undefined>)[key] : undefined;
    if (typeof props?.onPointerDown === "function" || typeof props?.onContextMenu === "function") return true;
  }
  return false;
}

/** Places that take typing get the text cursor (buttons don't, as with a mouse). */
function focusable(el: Element): HTMLElement | null {
  const f = el.closest('input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea, select, [contenteditable=""], [contenteditable="true"]');
  return f instanceof HTMLElement ? f : null;
}

const setNativeValue = (el: HTMLInputElement, v: string) => Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, v);

function setRange(el: HTMLInputElement, x: number) {
  const r = el.getBoundingClientRect();
  const min = Number(el.min || 0);
  const max = Number(el.max || 100);
  const step = el.step === "any" ? 0 : Number(el.step || 1);
  let v = min + Math.min(1, Math.max(0, (x - r.left) / Math.max(1, r.width))) * (max - min);
  if (step) v = Math.round((v - min) / step) * step + min;
  const s = String(Math.min(max, Math.max(min, v)));
  if (el.value === s) return;
  setNativeValue(el, s);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

type Down =
  | { kind: "pointer"; el: Element; x: number; y: number; scroller: Element | null; scrolling: boolean; last: { x: number; y: number }; samples: { t: number; x: number; y: number }[] }
  | { kind: "range"; el: HTMLInputElement }
  /** Clicked the moment the fingers met; letting go only finishes a double-click. */
  | { kind: "clicked"; el: Element; x: number; y: number }
  | { kind: "grab-scroll"; scroller: Element }
  | { kind: "grab-pointer"; el: Element; x: number; y: number };

export interface DomCallbacks {
  /** A <select> was pinched: show its choices big enough for a hand. */
  onSelect: (el: HTMLSelectElement) => void;
}

export class DomDriver {
  private hoverEl: Element | null = null;
  private hoverTarget: Element | null = null;
  private last: { x: number; y: number } | null = null;
  private down: Down | null = null;
  private fling = 0;
  private zoomEl: Element | null = null;

  constructor(private cb: DomCallbacks) {
    patchCapture();
  }

  private stopFling() {
    cancelAnimationFrame(this.fling);
    this.fling = 0;
  }

  /** The pointer moved (no button held). Returns what it is over now. */
  move(x: number, y: number, held: boolean): Target | null {
    const t = held ? null : findTarget(x, y);
    const el = elementAt(x, y);
    if (el !== this.hoverEl) {
      const old = this.hoverEl;
      if (old && old.isConnected) {
        fire(old, "pointerout", x, y, { related: el });
        fire(old, "mouseout", x, y, { related: el });
        fire(old, "mouseleave", x, y, { related: el });
      }
      if (el) {
        fire(el, "pointerover", x, y, { related: old });
        fire(el, "mouseover", x, y, { related: old });
        fire(el, "mouseenter", x, y, { related: old });
      }
      this.hoverEl = el;
    }
    const tEl = held ? this.hoverTarget : t?.el ?? null;
    if (tEl !== this.hoverTarget) {
      this.hoverTarget?.removeAttribute("data-gesture-hover");
      tEl?.setAttribute("data-gesture-hover", "");
      this.hoverTarget = tEl;
    }
    if (!held && el && (!this.last || Math.abs(this.last.x - x) + Math.abs(this.last.y - y) >= 0.5)) {
      fire(el, "pointermove", x, y);
      fire(el, "mousemove", x, y);
    }
    this.last = { x, y };
    return t;
  }

  /** The hand went away: let go of everything. */
  leave() {
    this.cancel();
    if (this.down?.kind === "grab-scroll" || this.down?.kind === "grab-pointer") this.grabEnd(0, 0);
    const x = this.last?.x ?? 0;
    const y = this.last?.y ?? 0;
    if (this.hoverEl?.isConnected) {
      fire(this.hoverEl, "pointerout", x, y);
      fire(this.hoverEl, "mouseout", x, y);
      fire(this.hoverEl, "mouseleave", x, y);
    }
    this.hoverEl = null;
    this.hoverTarget?.removeAttribute("data-gesture-hover");
    this.hoverTarget = null;
    this.last = null;
  }

  /** The fingers met. `lit` is the button the pointer was showing just before:
   *  the pinch presses that one, even if the hand jumped a little as it closed. */
  press(x0: number, y0: number, lit?: Element | null) {
    this.stopFling();
    const near = lit?.isConnected ? targetOf(lit) : null;
    const t = near && rectDist(near.rect, x0, y0) <= LIT_REACH ? near : findTarget(x0, y0);
    const { x, y } = pointIn(t, x0, y0);
    const hit = elementAt(x, y) ?? t?.el;
    if (!hit) return;
    const target = t?.el ?? hit;
    if (target instanceof HTMLInputElement && target.type === "range") {
      this.down = { kind: "range", el: target };
      target.focus({ preventScroll: true });
      setRange(target, x);
      return;
    }
    fire(hit, "pointerdown", x, y, { buttons: 1 });
    fire(hit, "mousedown", x, y, { buttons: 1, detail: 1 });
    const f = focusable(hit);
    if (f && f !== document.activeElement) f.focus({ preventScroll: true });
    else if (!f && document.activeElement instanceof HTMLElement && !hit.closest("[data-gesture-menu]")) document.activeElement.blur();
    const drags = !!hit.closest('canvas, [draggable="true"], [data-gesture-drag]');
    const scroller = drags ? null : scrollerOf(hit, "any");
    // A plain button (nothing to drag or scroll here): click now. Waiting for the
    // fingers to part lost clicks when the hand drifted or held the pinch a while.
    if (!drags && !scroller && !(target instanceof HTMLSelectElement) && !wantsHold(hit)) {
      fire(hit, "pointerup", x, y);
      fire(hit, "mouseup", x, y, { detail: 1 });
      captured = null;
      fire(hit, "click", x, y, { detail: 1 });
      this.down = { kind: "clicked", el: hit, x, y };
      return;
    }
    this.down = { kind: "pointer", el: hit, x, y, scroller, scrolling: false, last: { x, y }, samples: [{ t: performance.now(), x, y }] };
  }

  drag(x: number, y: number) {
    const d = this.down;
    if (!d) return;
    if (d.kind === "range") {
      setRange(d.el, x);
      return;
    }
    if (d.kind !== "pointer") return;
    d.samples.push({ t: performance.now(), x, y });
    while (d.samples.length > 8) d.samples.shift();
    if (d.scroller) {
      // Like a finger on a phone: dragging over a list moves the list.
      if (!d.scrolling) {
        d.scrolling = true;
        fire(d.el, "pointercancel", x, y);
      }
      d.scroller.scrollBy({ left: -(x - d.last.x), top: -(y - d.last.y), behavior: "instant" });
    } else {
      const el = captured ?? elementAt(x, y) ?? d.el;
      fire(el, "pointermove", x, y, { buttons: 1 });
      fire(el, "mousemove", x, y, { buttons: 1 });
    }
    d.last = { x, y };
  }

  release(x: number, y: number, click: boolean, double: boolean) {
    const d = this.down;
    this.down = null;
    if (!d) return;
    if (d.kind === "range") {
      d.el.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    if (d.kind === "clicked") {
      if (double && d.el.isConnected) fire(d.el, "dblclick", d.x, d.y, { detail: 2 });
      return;
    }
    if (d.kind !== "pointer") return;
    if (d.scrolling && d.scroller) {
      const s = d.samples;
      const a = s[0];
      const b = s[s.length - 1];
      const dt = (b.t - a.t) / 1000;
      if (dt > 0) this.flingBy(d.scroller, -(b.x - a.x) / dt, -(b.y - a.y) / dt);
      return;
    }
    const px = click ? d.x : x;
    const py = click ? d.y : y;
    const up = captured ?? elementAt(px, py) ?? d.el;
    fire(up, "pointerup", px, py);
    fire(up, "mouseup", px, py, { detail: 1 });
    captured = null;
    if (!click) return;
    if (d.el instanceof HTMLSelectElement) {
      this.cb.onSelect(d.el);
      return;
    }
    fire(d.el, "click", px, py, { detail: 1 });
    if (double) fire(d.el, "dblclick", px, py, { detail: 2 });
  }

  longPress(x: number, y: number) {
    const d = this.down;
    if (!d || d.kind !== "pointer") return;
    fire(d.el, "pointerup", x, y);
    fire(d.el, "mouseup", x, y);
    captured = null;
    fire(d.el, "contextmenu", x, y, { button: 2 });
    this.down = null;
  }

  cancel() {
    const d = this.down;
    if (d?.kind === "clicked") this.down = null;
    if (!d || (d.kind !== "pointer" && d.kind !== "range")) return;
    this.down = null;
    if (d.kind === "pointer" && !d.scrolling) {
      fire(captured ?? d.el, "pointercancel", d.last.x, d.last.y);
      fire(d.el, "mouseup", d.last.x, d.last.y);
    }
    captured = null;
  }

  grab(x: number, y: number) {
    this.stopFling();
    const el = elementAt(x, y);
    if (!el) return;
    if (el.closest("canvas")) {
      fire(el, "pointerdown", x, y, { buttons: 1 });
      fire(el, "mousedown", x, y, { buttons: 1 });
      this.down = { kind: "grab-pointer", el, x, y };
      return;
    }
    const s = scrollerOf(el, "any");
    if (s) this.down = { kind: "grab-scroll", scroller: s };
  }

  grabMove(dx: number, dy: number) {
    const d = this.down;
    if (d?.kind === "grab-scroll") d.scroller.scrollBy({ left: -dx, top: -dy, behavior: "instant" });
    else if (d?.kind === "grab-pointer") {
      d.x += dx;
      d.y += dy;
      const el = captured ?? d.el;
      fire(el, "pointermove", d.x, d.y, { buttons: 1 });
      fire(el, "mousemove", d.x, d.y, { buttons: 1 });
    }
  }

  grabEnd(vx: number, vy: number) {
    const d = this.down;
    this.down = null;
    if (d?.kind === "grab-scroll") this.flingBy(d.scroller, -vx, -vy);
    else if (d?.kind === "grab-pointer") {
      fire(captured ?? d.el, "pointerup", d.x, d.y);
      fire(d.el, "mouseup", d.x, d.y);
      captured = null;
    }
  }

  /** Keeps a list moving after the hand lets go, slowing like a real one. */
  private flingBy(el: Element, vx: number, vy: number) {
    this.stopFling();
    const cap = 4000;
    vx = Math.max(-cap, Math.min(cap, vx));
    vy = Math.max(-cap, Math.min(cap, vy));
    if (Math.hypot(vx, vy) < 200) return;
    let t = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - t) / 1000);
      t = now;
      const k = Math.exp(-dt / 0.325);
      vx *= k;
      vy *= k;
      const beforeT = el.scrollTop;
      const beforeL = el.scrollLeft;
      el.scrollBy({ left: vx * dt, top: vy * dt, behavior: "instant" });
      const stuck = el.scrollTop === beforeT && el.scrollLeft === beforeL;
      if (Math.hypot(vx, vy) < 25 || stuck) {
        this.fling = 0;
        return;
      }
      this.fling = requestAnimationFrame(step);
    };
    this.fling = requestAnimationFrame(step);
  }

  zoomStart(cx: number, cy: number) {
    this.cancel();
    this.zoomEl = elementAt(cx, cy);
  }

  /** One step of a two-hand zoom: LANX's own viewers listen for
   *  "lanx:gesture-zoom"; anything else gets a trackpad-style pinch (Ctrl + wheel). */
  zoom(scale: number, rotate: number, cx: number, cy: number) {
    const el = this.zoomEl ?? elementAt(cx, cy);
    if (!el) return;
    const ev = new CustomEvent("lanx:gesture-zoom", { bubbles: true, cancelable: true, detail: { scale, rotate, cx, cy } });
    if (!el.dispatchEvent(ev)) return;
    el.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -Math.log(scale) * 100, deltaMode: 0, clientX: cx, clientY: cy, view: window }));
  }

  zoomEnd() {
    this.zoomEl = null;
  }

  /** A key press, as if typed (for flicks: arrows and Escape). */
  key(key: string) {
    const el = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : document.body;
    const init: KeyboardEventInit = { key, code: key, bubbles: true, cancelable: true, composed: true };
    el.dispatchEvent(new KeyboardEvent("keydown", init));
    el.dispatchEvent(new KeyboardEvent("keyup", init));
  }
}
