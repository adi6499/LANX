/** LANX 3.6.1: the LANX window, resized with two hands. Hands apart: bigger;
 *  together: smaller — from the window's middle, kept between LANX's smallest
 *  size and the screen. In the browser preview only the numbers change. */
import { PhysicalPosition, PhysicalSize, currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";

/** Past the screen's size by this much, the window fills the screen. */
const FILL_PAST = 1.08;
import { isTauri } from "../api";

/** LANX's smallest window (tauri.conf.json minWidth / minHeight), in logical pixels. */
const MIN_W = 900;
const MIN_H = 600;

interface Start {
  w: number;
  h: number;
  cx: number;
  cy: number;
  /** Physical pixels per logical pixel. */
  sf: number;
  minW: number;
  minH: number;
  maxW: number;
  maxH: number;
  /** The screen's usable area (physical), to keep the window on it. */
  area: { x: number; y: number; w: number; h: number } | null;
}

export class WindowFrame {
  private start: Start | null = null;
  private want: { w: number; h: number } | "fill" | null = null;
  private filled = false;
  private busy = false;

  /** `onSize`: the new size in logical pixels (for the little size label); `fill` when it fills the screen. */
  constructor(private onSize: (w: number, h: number, fill?: boolean) => void) {}

  async begin() {
    if (!isTauri) {
      const sf = window.devicePixelRatio || 1;
      this.start = { w: innerWidth * sf, h: innerHeight * sf, cx: 0, cy: 0, sf, minW: MIN_W * sf, minH: MIN_H * sf, maxW: innerWidth * sf * 2, maxH: innerHeight * sf * 2, area: null };
      this.onSize(innerWidth, innerHeight);
      return;
    }
    const win = getCurrentWindow();
    if (await win.isMaximized()) await win.unmaximize();
    const [size, pos, sf, mon] = await Promise.all([win.outerSize(), win.outerPosition(), win.scaleFactor(), currentMonitor()]);
    const work = (mon as unknown as { workArea?: { position: { x: number; y: number }; size: { width: number; height: number } } } | null)?.workArea;
    const area = work ? { x: work.position.x, y: work.position.y, w: work.size.width, h: work.size.height } : mon ? { x: mon.position.x, y: mon.position.y, w: mon.size.width, h: mon.size.height } : null;
    this.start = {
      w: size.width,
      h: size.height,
      cx: pos.x + size.width / 2,
      cy: pos.y + size.height / 2,
      sf,
      minW: MIN_W * sf,
      minH: MIN_H * sf,
      maxW: area?.w ?? size.width * 2,
      maxH: area?.h ?? size.height * 2,
      area,
    };
    this.onSize(Math.round(size.width / sf), Math.round(size.height / sf));
  }

  /** The hands are `scale` times as far apart as when it began. */
  set(scale: number) {
    const s = this.start;
    if (!s) return;
    // The same factor both ways keeps the window's shape: no smaller than LANX's
    // smallest window, no bigger than the screen (never smaller just for starting);
    // past the screen it fills it.
    const maxK = Math.max(1, Math.min(s.maxW / s.w, s.maxH / s.h));
    if (scale > maxK * FILL_PAST) {
      this.want = "fill";
      this.onSize(Math.round(s.maxW / s.sf), Math.round(s.maxH / s.sf), true);
    } else {
      const k = Math.min(Math.max(scale, s.minW / s.w, s.minH / s.h), maxK);
      const w = Math.round(s.w * k);
      const h = Math.round(s.h * k);
      this.want = { w, h };
      this.onSize(Math.round(w / s.sf), Math.round(h / s.sf));
    }
    void this.apply();
  }

  /** Only the newest size is sent; the window never queues up behind the hands. */
  private async apply() {
    if (this.busy || !isTauri) return;
    this.busy = true;
    try {
      const win = getCurrentWindow();
      while (this.want && this.start) {
        const want = this.want;
        this.want = null;
        if (want === "fill") {
          if (!this.filled) await win.maximize();
          this.filled = true;
          continue;
        }
        if (this.filled) {
          await win.unmaximize();
          this.filled = false;
        }
        const { w, h } = want;
        const s = this.start;
        let x = Math.round(s.cx - w / 2);
        let y = Math.round(s.cy - h / 2);
        if (s.area) {
          x = Math.max(s.area.x, Math.min(s.area.x + s.area.w - w, x));
          y = Math.max(s.area.y, Math.min(s.area.y + s.area.h - h, y));
        }
        await win.setSize(new PhysicalSize(w, h));
        await win.setPosition(new PhysicalPosition(x, y));
      }
    } catch (e) {
      console.warn("LANX gestures: the window could not be resized", e);
    } finally {
      this.busy = false;
    }
  }

  end() {
    this.start = null;
    this.want = null;
    this.filled = false;
  }
}
