/** LANX 2.5.0: live wallpapers. The built-in ones are drawn by LANX itself
 *  (no video files, loop forever without a seam, pause when the window is
 *  hidden); a picture or video from your own files can be used instead. */

export interface WallpaperChoice {
  kind: "none" | "builtin" | "file";
  /** Built-in: which one. */
  id?: string;
  /** File: the copy LANX keeps (in its data folder) and the original name. */
  path?: string;
  name?: string;
  /** 0..80: how much the picture is darkened so text stays readable. */
  dim: number;
  /** 0..20 px of blur. */
  blur: number;
}
export const DEFAULT_WALLPAPER: WallpaperChoice = { kind: "none", dim: 20, blur: 0 };

export const BUILTIN: { id: string; name: string; hint: string; colors: string[] }[] = [
  { id: "aurora", name: "Aurora", hint: "Slow northern lights", colors: ["#0f172a", "#14b8a6", "#8b5cf6"] },
  { id: "ocean", name: "Ocean", hint: "Soft rolling waves", colors: ["#0c4a6e", "#0ea5e9", "#67e8f9"] },
  { id: "night", name: "Night sky", hint: "Drifting stars", colors: ["#020617", "#1e293b", "#fde68a"] },
  { id: "bokeh", name: "Bokeh", hint: "Floating lights", colors: ["#3b0764", "#ec4899", "#fb923c"] },
  { id: "rain", name: "Rain", hint: "Rain on glass", colors: ["#1e293b", "#64748b", "#cbd5e1"] },
  { id: "meadow", name: "Meadow", hint: "Sunlit gradient breeze", colors: ["#14532d", "#4ade80", "#fef08a"] },
];

/** LANX 3.6.1: how bright a wallpaper looks once dimmed — so panels can stay
 *  readable on it ("mid" and the opposite of the theme get more solid panels). */
export type WallTone = "dark" | "mid" | "light";
const luminance = (r: number, g: number, b: number) => {
  const c = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
export function toneOf(lum: number, dim: number): WallTone {
  const l = lum * (1 - Math.min(80, Math.max(0, dim)) / 100);
  return l < 0.2 ? "dark" : l > 0.4 ? "light" : "mid";
}
/** A built-in wallpaper: mostly its first (background) colour. */
export function builtinTone(id: string | undefined, dim: number): WallTone {
  const b = BUILTIN.find((x) => x.id === id) ?? BUILTIN[0];
  const ls = b.colors.map((h) => {
    const n = parseInt(h.slice(1), 16);
    return luminance((n >> 16) & 255, (n >> 8) & 255, n & 255);
  });
  return toneOf(ls[0] * 0.6 + ls[1] * 0.25 + ls[2] * 0.15, dim);
}
/** A picture or video frame, measured on a small copy (null if it can't be read). */
export function measureTone(el: HTMLImageElement | HTMLVideoElement, dim: number): WallTone | null {
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 16;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(el, 0, 0, 16, 16);
    const d = ctx.getImageData(0, 0, 16, 16).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += luminance(d[i], d[i + 1], d[i + 2]);
    return toneOf(sum / (d.length / 4), dim);
  } catch {
    return null;
  }
}

type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number, rnd: number[]) => void;

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

const painters: Record<string, Painter> = {
  aurora(ctx, w, h, t) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#050816");
    g.addColorStop(1, "#0f172a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";
    const bands = [
      ["#14b8a6", 0.0],
      ["#8b5cf6", 1.7],
      ["#22d3ee", 3.1],
      ["#a3e635", 4.6],
    ] as const;
    for (const [c, off] of bands) {
      ctx.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const y = h * 0.35 + Math.sin(x / 180 + t * 0.25 + off) * h * 0.1 + Math.sin(x / 70 - t * 0.18 + off * 2) * h * 0.04;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      const gg = ctx.createLinearGradient(0, h * 0.2, 0, h);
      gg.addColorStop(0, c + "66");
      gg.addColorStop(1, c + "00");
      ctx.fillStyle = gg;
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  },
  ocean(ctx, w, h, t) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#0c4a6e");
    g.addColorStop(1, "#082f49");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      const base = h * (0.45 + i * 0.1);
      for (let x = 0; x <= w; x += 6) {
        const y = base + Math.sin(x / (90 + i * 20) + t * (0.6 + i * 0.1) + i) * (10 + i * 3) + Math.sin(x / 37 - t * 0.9 + i) * 4;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fillStyle = `rgba(${56 + i * 10}, ${189 - i * 15}, ${248 - i * 20}, ${0.12 + i * 0.05})`;
      ctx.fill();
    }
  },
  night(ctx, w, h, t, rnd) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#020617");
    g.addColorStop(1, "#1e1b4b");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) {
      const x = ((rnd[i * 3] * w + t * (2 + rnd[i * 3 + 1] * 6)) % (w + 20)) - 10;
      const y = rnd[i * 3 + 1] * h;
      const tw = 0.5 + 0.5 * Math.sin(t * (1 + rnd[i * 3 + 2] * 2) + i);
      ctx.fillStyle = `rgba(255, 244, 214, ${0.25 + tw * 0.7})`;
      const r = 0.6 + rnd[i * 3 + 2] * 1.6;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // a soft moon
    const mg = ctx.createRadialGradient(w * 0.8, h * 0.22, 10, w * 0.8, h * 0.22, 120);
    mg.addColorStop(0, "rgba(254, 240, 200, 0.9)");
    mg.addColorStop(0.2, "rgba(254, 240, 200, 0.35)");
    mg.addColorStop(1, "rgba(254, 240, 200, 0)");
    ctx.fillStyle = mg;
    ctx.fillRect(0, 0, w, h);
  },
  bokeh(ctx, w, h, t, rnd) {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, "#3b0764");
    g.addColorStop(1, "#7c2d12");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 28; i++) {
      const sp = 6 + rnd[i * 3] * 10;
      const y = ((rnd[i * 3 + 1] * h - t * sp) % (h + 160) + h + 160) % (h + 160) - 80;
      const x = rnd[i * 3 + 2] * w + Math.sin(t * 0.3 + i) * 25;
      const r = 20 + rnd[i * 3] * 60;
      const col = ["#ec4899", "#fb923c", "#a78bfa", "#f472b6"][i % 4];
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, col + "55");
      rg.addColorStop(0.7, col + "22");
      rg.addColorStop(1, col + "00");
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  },
  rain(ctx, w, h, t, rnd) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#1e293b");
    g.addColorStop(1, "#334155");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(203, 213, 225, 0.35)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 140; i++) {
      const sp = 300 + rnd[i * 3] * 400;
      const len = 10 + rnd[i * 3 + 1] * 18;
      const x = rnd[i * 3 + 2] * w;
      const y = ((rnd[i * 3 + 1] * h + t * sp) % (h + 40)) - 20;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 2, y + len);
      ctx.stroke();
    }
    // slow drops on the glass
    for (let i = 0; i < 40; i++) {
      const x = rnd[i * 3] * w;
      const y = ((rnd[i * 3 + 1] * h + t * (4 + rnd[i * 3 + 2] * 8)) % (h + 20)) - 10;
      const r = 2 + rnd[i * 3 + 2] * 4;
      const rg = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
      rg.addColorStop(0, "rgba(255,255,255,0.5)");
      rg.addColorStop(1, "rgba(255,255,255,0.05)");
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  meadow(ctx, w, h, t) {
    const a = 0.5 + 0.5 * Math.sin(t * 0.2);
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, `rgb(${lerp(20, 34, a)}, ${lerp(83, 110, a)}, ${lerp(45, 60, a)})`);
    g.addColorStop(0.6, "#15803d");
    g.addColorStop(1, `rgb(${lerp(74, 134, a)}, ${lerp(222, 239, a)}, ${lerp(128, 172, a)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 5; i++) {
      const x = w * (0.2 + i * 0.15) + Math.sin(t * 0.15 + i) * w * 0.08;
      const y = h * 0.25 + Math.cos(t * 0.12 + i * 1.3) * h * 0.1;
      const rg = ctx.createRadialGradient(x, y, 0, x, y, w * 0.25);
      rg.addColorStop(0, "rgba(254, 240, 138, 0.35)");
      rg.addColorStop(1, "rgba(254, 240, 138, 0)");
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalCompositeOperation = "source-over";
  },
};

/** Runs a built-in wallpaper on a canvas until `stop()` is called. */
export function startBuiltin(canvas: HTMLCanvasElement, id: string, still = false): () => void {
  const paint = painters[id] ?? painters.aurora;
  const ctx = canvas.getContext("2d")!;
  let raf = 0;
  let timer = 0;
  let alive = true;
  // Fixed random numbers so the scene is the same every frame.
  let seed = 1234567;
  const rnd = Array.from({ length: 600 }, () => {
    seed = (seed * 48271) % 2147483647;
    return seed / 2147483647;
  });
  const t0 = performance.now();
  const fit = () => {
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr * 0.6));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr * 0.6));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  };
  const linux = (document.documentElement.classList.contains("lanx-linux") || document.documentElement.classList.contains("lanx-lite"));
  // On Linux it holds still while you scroll: each of its frames repaints the whole
  // window there, and the list you're moving matters more (3.6.2).
  let busyUntil = 0;
  const busy = () => {
    busyUntil = performance.now() + 500;
  };
  if (linux) {
    window.addEventListener("scroll", busy, { capture: true, passive: true });
    window.addEventListener("wheel", busy, { capture: true, passive: true });
  }
  const frame = () => {
    if (!alive) return;
    const skip = linux && !still && performance.now() < busyUntil;
    if (!skip) {
      fit();
      const t = still ? 12 : (performance.now() - t0) / 1000;
      paint(ctx, canvas.width, canvas.height, t, rnd);
    }
    if (still) return;
    // ~30 fps is plenty for a background and easy on laptops; 15 on Linux (3.6.2),
    // where the engine paints it on the processor.
    timer = window.setTimeout(() => {
      raf = requestAnimationFrame(frame);
    }, skip ? 120 : linux ? 66 : 33);
  };
  const onVisible = () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    } else if (alive && !still) {
      raf = requestAnimationFrame(frame);
    }
  };
  document.addEventListener("visibilitychange", onVisible);
  raf = requestAnimationFrame(frame);
  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    window.clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("scroll", busy, { capture: true });
    window.removeEventListener("wheel", busy, { capture: true });
  };
}

export const IMAGE_TYPES = ["png", "jpg", "jpeg", "webp", "gif", "bmp"];
export const VIDEO_TYPES = ["mp4", "webm", "mov", "m4v"];
export function fileKind(name: string): "image" | "video" | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_TYPES.includes(ext) ? "image" : VIDEO_TYPES.includes(ext) ? "video" : null;
}
export function mimeOf(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", bmp: "image/bmp", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", m4v: "video/mp4" } as Record<string, string>)[ext] ?? "application/octet-stream";
}
