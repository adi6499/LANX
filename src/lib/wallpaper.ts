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
  // LANX 3.14.0: three more, made for the full-screen wallpaper screen.
  { id: "bloom", name: "Bloom", hint: "Soft colours drifting", colors: ["#1a1030", "#ff5f9e", "#3aa0ff"] },
  { id: "silk", name: "Silk", hint: "Flowing ribbons", colors: ["#0f1b3d", "#a78bfa", "#5eead4"] },
  { id: "horizon", name: "Day and night", hint: "The sky follows your clock", colors: ["#1e3a8a", "#60a5fa", "#fde68a"] },
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
export function measureTone(el: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement, dim: number): WallTone | null {
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
  // LANX 3.14.0 ------------------------------------------------------------
  /** Big soft fields of colour that drift through each other. */
  bloom(ctx, w, h, t) {
    ctx.fillStyle = "#0b0a1a";
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "screen";
    const fields = [
      ["#ff5f9e", 0.0, 0.23, 0.31],
      ["#ff9f43", 1.9, 0.19, 0.27],
      ["#7c5cff", 3.3, 0.17, 0.21],
      ["#3aa0ff", 4.4, 0.21, 0.25],
      ["#2dd4bf", 5.6, 0.15, 0.29],
    ] as const;
    const big = Math.max(w, h);
    for (const [c, off, sx, sy] of fields) {
      const x = w * (0.5 + 0.38 * Math.sin(t * sx * 0.5 + off));
      const y = h * (0.5 + 0.36 * Math.cos(t * sy * 0.5 + off * 1.7));
      const r = big * (0.42 + 0.08 * Math.sin(t * 0.13 + off));
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, c + "cc");
      g.addColorStop(0.55, c + "44");
      g.addColorStop(1, c + "00");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalCompositeOperation = "source-over";
  },
  /** Wide ribbons of colour that flow slowly across the screen. */
  silk(ctx, w, h, t) {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, "#0f1b3d");
    g.addColorStop(1, "#3b1d5e");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const cols = ["#5eead4", "#60a5fa", "#a78bfa", "#f472b6", "#fb923c", "#facc15", "#38bdf8"];
    const step = Math.max(8, Math.round(w / 120));
    for (let i = 0; i < cols.length; i++) {
      const base = h * (0.2 + i * 0.09);
      const amp = h * (0.07 + 0.02 * Math.sin(t * 0.1 + i));
      const top = (x: number) => base + Math.sin((x / w) * Math.PI * 2 * (0.8 + i * 0.07) + t * (0.12 + i * 0.015) + i * 0.9) * amp + Math.sin((x / w) * Math.PI * 5 - t * 0.08 + i) * amp * 0.25;
      const thick = (x: number) => h * (0.1 + 0.03 * Math.sin(t * 0.07 + i * 1.3)) * (0.6 + 0.4 * Math.sin((x / w) * Math.PI * 2 + t * 0.05 + i));
      ctx.beginPath();
      for (let x = 0; x <= w + step; x += step) x === 0 ? ctx.moveTo(x, top(x)) : ctx.lineTo(x, top(x));
      for (let x = w + step; x >= 0; x -= step) ctx.lineTo(x, top(x) + thick(x));
      ctx.closePath();
      const lg = ctx.createLinearGradient(0, 0, w, 0);
      const a = cols[i];
      const b = cols[(i + 2) % cols.length];
      lg.addColorStop(0, a + "00");
      lg.addColorStop(0.25, a + "70");
      lg.addColorStop(0.75, b + "70");
      lg.addColorStop(1, b + "00");
      ctx.fillStyle = lg;
      ctx.fill();
    }
  },
  /** A sky over hills that follows this PC's clock: dawn, day, dusk, and stars at night. */
  horizon(ctx, w, h, t, rnd) {
    const d = new Date();
    const hour = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
    // hour → sky colour at the top and at the horizon
    const keys: [number, number[], number[]][] = [
      [0, [5, 8, 22], [11, 16, 38]],
      [4.5, [10, 15, 44], [27, 31, 74]],
      [6, [42, 42, 106], [246, 165, 107]],
      [7.5, [90, 143, 216], [255, 217, 160]],
      [10, [63, 138, 224], [168, 216, 255]],
      [15, [58, 134, 220], [191, 227, 255]],
      [17.5, [61, 95, 176], [255, 179, 107]],
      [18.75, [43, 42, 110], [240, 112, 90]],
      [20, [13, 18, 53], [42, 31, 79]],
      [24, [5, 8, 22], [11, 16, 38]],
    ];
    let k = 0;
    while (k < keys.length - 2 && hour >= keys[k + 1][0]) k++;
    const f = (hour - keys[k][0]) / (keys[k + 1][0] - keys[k][0]);
    const mix = (a: number[], b: number[]) => a.map((v, i) => Math.round(lerp(v, b[i], f)));
    const top = mix(keys[k][1], keys[k + 1][1]);
    const low = mix(keys[k][2], keys[k + 1][2]);
    const rgb = (c: number[], a = 1) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
    const ground = h * 0.74;
    const sky = ctx.createLinearGradient(0, 0, 0, ground);
    sky.addColorStop(0, rgb(top));
    sky.addColorStop(1, rgb(low));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    // stars: out at night, fading at dawn and dusk
    const stars = hour < 5 ? 1 : hour < 6.5 ? 1 - (hour - 5) / 1.5 : hour < 18.5 ? 0 : hour < 19.75 ? (hour - 18.5) / 1.25 : 1;
    if (stars > 0.02) {
      for (let i = 0; i < 170; i++) {
        const x = rnd[i * 3] * w;
        const y = rnd[i * 3 + 1] * ground * 0.95;
        const tw = 0.55 + 0.45 * Math.sin(t * (0.6 + rnd[i * 3 + 2] * 1.4) + i);
        ctx.fillStyle = `rgba(255, 246, 224, ${stars * tw * 0.85})`;
        ctx.beginPath();
        ctx.arc(x, y, 0.5 + rnd[i * 3 + 2] * 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // the sun by day (6 → 18 across the sky), the moon by night
    const day = hour >= 5.75 && hour <= 18.25;
    const along = day ? (hour - 6) / 12 : ((hour + 6) % 24) / 12;
    const cx = w * (0.08 + 0.84 * Math.min(1, Math.max(0, along)));
    // (A low arc: on the wallpaper screen the top of the sky belongs to the clock.)
    const cy = ground - Math.sin(Math.PI * Math.min(1, Math.max(0, along))) * ground * 0.4 + ground * 0.04;
    const size = Math.min(w, h) * (day ? 0.045 : 0.035);
    const glow = ctx.createRadialGradient(cx, cy, size * 0.6, cx, cy, size * (day ? 7 : 5));
    glow.addColorStop(0, day ? "rgba(255, 244, 214, 0.55)" : "rgba(226, 232, 255, 0.28)");
    glow.addColorStop(1, day ? "rgba(255, 244, 214, 0)" : "rgba(226, 232, 255, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, ground);
    ctx.fillStyle = day ? "#fff6dc" : "#eef1ff";
    ctx.beginPath();
    ctx.arc(cx, cy, size, 0, Math.PI * 2);
    ctx.fill();
    // three rows of hills, darker towards the front, tinted by the sky
    for (let i = 0; i < 3; i++) {
      const y0 = ground + i * h * 0.06;
      const shade = 0.42 - i * 0.14;
      ctx.fillStyle = rgb(low.map((v, j) => Math.round(v * shade + top[j] * 0.12)));
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w + 12; x += 12) {
        const y = y0 - Math.sin(x / (w * (0.21 + i * 0.07)) + i * 2.1) * h * (0.045 - i * 0.008) - Math.sin(x / (w * 0.07) + i * 5.3) * h * 0.012;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    }
  },
};

/** Runs a built-in wallpaper on a canvas until `stop()` is called.
 *  `screen` (LANX 3.14.0): it is the whole picture (the wallpaper screen), not a
 *  background behind lists — drawn sharper and, on Linux, more often. */
export function startBuiltin(canvas: HTMLCanvasElement, id: string, still = false, screen = false): () => void {
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
  const linux = (document.documentElement.classList.contains("lanx-linux") || document.documentElement.classList.contains("lanx-lite"));
  const fit = () => {
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const scale = screen && !linux ? 0.8 : 0.6;
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr * scale));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr * scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  };
  // On Linux it holds still while you scroll: each of its frames repaints the whole
  // window there, and the list you're moving matters more (3.6.2).
  let busyUntil = 0;
  const busy = () => {
    busyUntil = performance.now() + 500;
  };
  if (linux && !screen) {
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
    }, skip ? 120 : linux ? (screen ? 42 : 66) : 33);
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
