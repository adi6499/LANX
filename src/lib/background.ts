/** Appearance (Settings → Appearance): the window background, the accent
 *  colour and the glass panels. Everything is applied as CSS variables on
 *  <html>, so every screen follows the same choice. */

export interface BackgroundPreset {
  id: string;
  label: string;
  colors: string[];
}

export const BACKGROUND_PRESETS: BackgroundPreset[] = [
  { id: "default", label: "Default", colors: [] },
  { id: "sky", label: "Sky", colors: ["#38bdf8"] },
  { id: "mint", label: "Mint", colors: ["#34d399"] },
  { id: "peach", label: "Peach", colors: ["#fb923c"] },
  { id: "lavender", label: "Lavender", colors: ["#a78bfa"] },
  { id: "rose", label: "Rose", colors: ["#fb7185"] },
  { id: "sand", label: "Sand", colors: ["#d6b77a"] },
  { id: "slate", label: "Slate", colors: ["#64748b"] },
  { id: "sunrise", label: "Sunrise", colors: ["#fbbf24", "#f87171"] },
  { id: "ocean", label: "Ocean", colors: ["#38bdf8", "#818cf8"] },
  { id: "forest", label: "Forest", colors: ["#4ade80", "#2dd4bf"] },
  { id: "candy", label: "Candy", colors: ["#f472b6", "#a78bfa"] },
];

export interface AccentPreset {
  id: string;
  label: string;
  color: string;
}

/** "default" keeps LANX's own sky blue. */
export const ACCENT_PRESETS: AccentPreset[] = [
  { id: "default", label: "Sky", color: "#0ea5e9" },
  { id: "blue", label: "Blue", color: "#007aff" },
  { id: "indigo", label: "Indigo", color: "#5856d6" },
  { id: "purple", label: "Purple", color: "#a855f7" },
  { id: "pink", label: "Pink", color: "#e8458b" },
  { id: "red", label: "Red", color: "#ef4444" },
  { id: "orange", label: "Orange", color: "#f2730c" },
  { id: "green", label: "Green", color: "#22a55a" },
  { id: "teal", label: "Teal", color: "#0f9f96" },
  { id: "graphite", label: "Graphite", color: "#6e6e73" },
];

/** Ready-made glass looks: [transparency, frost]. */
export const GLASS_PRESETS: { id: string; label: string; glass: number; frost: number }[] = [
  { id: "solid", label: "Solid", glass: 0, frost: 0 },
  { id: "frosted", label: "Frosted", glass: 55, frost: 60 },
  { id: "crystal", label: "Crystal", glass: 90, frost: 30 },
];

export const isCustomColor = (v: string) => /^#[0-9a-f]{6}$/i.test(v);

export function backgroundColors(value: string): string[] {
  if (isCustomColor(value)) return [value];
  return BACKGROUND_PRESETS.find((p) => p.id === value)?.colors ?? [];
}

export function accentColor(value: string): string | null {
  if (isCustomColor(value)) return value;
  if (!value || value === "default") return null;
  return ACCENT_PRESETS.find((p) => p.id === value)?.color ?? null;
}

/** The colour a setting shows as (for swatches). */
export const accentSwatch = (value: string) => accentColor(value) ?? ACCENT_PRESETS[0].color;

// ------------------------------------------------------------ colour maths

function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return "#" + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
}

/** The same colour moved round the colour wheel (for a richer background). */
function shiftHue(hex: string, deg: number): string {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex((h + deg + 360) % 360, s, l);
}

const mix = (a: string, pct: number, b: string) => `color-mix(in srgb, ${a} ${pct}%, ${b})`;
const alpha = (c: string, pct: number) => mix(c, pct, "transparent");

// ------------------------------------------------------------ background

/** The full window background for a setting value: soft colour glows over a
 *  gentle base, like a desktop wallpaper, so the glass panels have something
 *  to pick their colour up from. */
export function wallpaperCss(value: string, dark: boolean, unit: "vmax" | "%" = "vmax"): string {
  const cs = backgroundColors(value);
  let c1: string, c2: string, c3: string;
  let strength = 1;
  if (cs.length === 0) {
    [c1, c2, c3] = ["#38bdf8", "#818cf8", "#f0abfc"];
    strength = 0.55;
  } else if (cs.length === 1) {
    [c1, c2, c3] = [cs[0], shiftHue(cs[0], 24), shiftHue(cs[0], -20)];
  } else {
    [c1, c2, c3] = [cs[0], cs[1], mix(cs[0], 50, cs[1])];
  }
  const p = (x: number) => Math.round(x * strength);
  const base = dark
    ? `linear-gradient(160deg, ${mix(c1, p(12), "#0a0c11")}, ${mix(c2, p(16), "#05070b")})`
    : `linear-gradient(160deg, ${mix(c1, p(18), "#f6f8fb")}, ${mix(c2, p(26), "#eef1f6")})`;
  // Sizes follow the window (vmax), or the box for small previews (%).
  const k = unit === "%" ? 1.6 : 1;
  const glow = (c: string, at: string, size: number, light: number, darkPct: number) =>
    `radial-gradient(${Math.round(size * k)}${unit} ${Math.round(size * k)}${unit} at ${at}, ${alpha(c, p(dark ? darkPct : light))}, transparent 62%)`;
  return [
    glow(c1, "0% 0%", 72, 70, 46),
    glow(c2, "100% 100%", 78, 62, 40),
    glow(c3, "86% 8%", 50, 48, 28),
    glow(c2, "22% 100%", 46, 36, 20),
    glow(c1, "55% 45%", 40, 18, 10),
    base,
  ].join(", ");
}

/** A small preview of a background (Settings swatches). */
export const backgroundCss = (value: string, dark: boolean) => wallpaperCss(value, dark, "%");

// ------------------------------------------------------------ apply

const SHADES: [string, number][] = [
  ["50", 8],
  ["100", 16],
  ["200", 30],
  ["300", 50],
  ["400", 75],
  ["500", 100],
  ["600", -85],
  ["700", -70],
  ["800", -55],
  ["900", -42],
  ["950", -28],
];

export interface AppearanceChoice {
  chat_background: string;
  accent_color: string;
  glass_level: number;
  frost_level: number;
}

/** Glass numbers for the CSS: panel opacity, blur and colour boost. */
export function glassValues(glass: number, frost: number) {
  const g = Math.max(0, Math.min(100, glass || 0));
  const f = Math.max(0, Math.min(100, frost || 0));
  return {
    solid: g === 0,
    opacity: +(1 - (g / 100) * 0.66).toFixed(3),
    blur: Math.round((f / 100) * 40),
    saturate: Math.round(100 + f * 0.9),
  };
}

export function applyAppearance(a: AppearanceChoice) {
  const root = document.documentElement;
  const style = root.style;
  const bg = a.chat_background || "default";
  style.setProperty("--lanx-wall-l", wallpaperCss(bg, false));
  style.setProperty("--lanx-wall-d", wallpaperCss(bg, true));
  style.setProperty("--lanx-tint", backgroundColors(bg)[0] ?? "#94a3b8");

  // Accent: LANX's buttons, bubbles and highlights all use Tailwind's "sky"
  // colours, so recolouring that palette recolours the whole app.
  const accent = accentColor(a.accent_color);
  for (const [shade, pct] of SHADES) {
    const name = `--color-sky-${shade}`;
    if (!accent) style.removeProperty(name);
    else if (pct === 100) style.setProperty(name, accent);
    else if (pct > 0) style.setProperty(name, mix(accent, pct, "white"));
    else style.setProperty(name, mix(accent, -pct, "black"));
  }

  const g = glassValues(a.glass_level, a.frost_level);
  style.setProperty("--lanx-glass-a", String(g.opacity));
  style.setProperty("--lanx-filter", g.solid ? "none" : `blur(${g.blur}px) saturate(${g.saturate}%)`);
  root.classList.toggle("lanx-solid", g.solid);
}
