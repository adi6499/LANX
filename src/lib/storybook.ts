/** LANX 3.6.0: Storybook colours — palettes in the spirit of animated films.
 *  The rules: warm light and cool shadows, never plain grey or black (text is
 *  a deep plum or navy "ink", dark mode is an indigo night), one main colour
 *  with a bright one for what you press, and rich colours that stay soft.
 *
 *  A palette redefines Tailwind's colour families (slate, sky, emerald…) and
 *  LANX's own surface colours, so every screen follows without changes. Golden
 *  hour and Toy box are the light looks; in dark mode both become Lantern night. */

export type ColorStyle = "classic" | "golden" | "toybox";
export const COLOR_STYLES: ColorStyle[] = ["classic", "golden", "toybox"];
/** New installs (and anyone who never chose) get Golden hour. */
export const DEFAULT_STYLE: ColorStyle = "golden";
export const colorStyle = (v: string | undefined | null): ColorStyle => (COLOR_STYLES.includes(v as ColorStyle) ? (v as ColorStyle) : DEFAULT_STYLE);

type Hue = "accent" | "blue" | "grape" | "leaf" | "teal" | "sun" | "orange" | "red" | "pink" | "cyan";

interface Palette {
  /** Which <html> it applies to. */
  selector: string;
  /** Tailwind slate 50…950: warm or cool tinted, never plain grey. */
  neutral: string[];
  /** Each colour family's middle (500) shade; lighter shades mix towards
   *  `paper`, darker towards `ink` (shadows keep their colour). */
  hues: Record<Hue, string>;
  paper: string;
  ink: string;
  white: string;
  black: string;
  /** LANX's own surface variables (App.css). */
  lanx: Record<string, string>;
}

/** The background behind everything: three soft colour glows over a base. */
export interface WallLook {
  glows: [string, string, string];
  base: [string, string];
  /** How strong the glows are (1 = as the colour background presets). */
  strength: number;
}

const SHADES: [string, number][] = [
  ["50", 9],
  ["100", 17],
  ["200", 32],
  ["300", 54],
  ["400", 78],
  ["500", 100],
  ["600", -86],
  ["700", -70],
  ["800", -55],
  ["900", -42],
  ["950", -28],
];
const NEUTRAL_SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];
const FAMILIES: Record<Hue, string[]> = {
  accent: ["sky"],
  blue: ["blue"],
  grape: ["indigo", "violet", "purple"],
  leaf: ["emerald", "green", "lime"],
  teal: ["teal"],
  sun: ["amber", "yellow"],
  orange: ["orange"],
  red: ["red", "rose"],
  pink: ["pink", "fuchsia"],
  cyan: ["cyan"],
};
const NEUTRALS = ["slate", "gray", "zinc", "neutral", "stone"];

const GOLDEN: Palette = {
  selector: ":root.storybook-golden:not(.dark)",
  neutral: ["#fff8f0", "#fbefe4", "#f0dfd2", "#ddc6b8", "#b49a92", "#8c7276", "#6e5767", "#574457", "#3f3044", "#2e2236", "#1e1526"],
  hues: { accent: "#ee5a3c", blue: "#3f8fe0", grape: "#8466e8", leaf: "#26a88f", teal: "#1fa59a", sun: "#f5a524", orange: "#f47b2e", red: "#e5484d", pink: "#f0609e", cyan: "#22b3c9" },
  paper: "#fffaf3",
  ink: "#2e1d33",
  white: "#fffdf8",
  black: "#21162a",
  lanx: {
    "--lanx-surface": "#fffaf3",
    "--lanx-tint": "#ffb38a",
    "--lanx-line": "rgb(110 60 50 / 0.11)",
    "--lanx-fill": "rgb(150 95 80 / 0.12)",
    "--lanx-bubble": "#fffdf8",
    "--lanx-rim": "rgb(255 250 240 / 0.7)",
    "--lanx-shadow": "0 1px 1px rgb(90 40 30 / 0.04), 0 14px 36px -16px rgb(130 60 40 / 0.3)",
  },
};
const TOYBOX: Palette = {
  selector: ":root.storybook-toybox:not(.dark)",
  neutral: ["#f5f9ff", "#eaf2fc", "#d6e3f3", "#b6c8e0", "#8aa0bf", "#64799a", "#4b5e7e", "#3a4a66", "#29364e", "#1e2840", "#121a2e"],
  hues: { accent: "#2f7de1", blue: "#2f7de1", grape: "#7b5ce6", leaf: "#2fa866", teal: "#1fa99a", sun: "#f7b500", orange: "#ff8c2b", red: "#e8453c", pink: "#f2549b", cyan: "#21a9e0" },
  paper: "#f8fbff",
  ink: "#141d36",
  white: "#ffffff",
  black: "#141d36",
  lanx: {
    "--lanx-surface": "#ffffff",
    "--lanx-tint": "#8fd3ff",
    "--lanx-line": "rgb(30 60 120 / 0.11)",
    "--lanx-fill": "rgb(60 100 170 / 0.12)",
    "--lanx-bubble": "#ffffff",
    "--lanx-shadow": "0 1px 1px rgb(20 40 90 / 0.04), 0 14px 36px -16px rgb(30 60 130 / 0.28)",
  },
};
const LANTERN: Palette = {
  selector: ":root.storybook.dark",
  neutral: ["#fbf6ff", "#f1e9fb", "#ded2f0", "#c3b4e0", "#a091c6", "#7c6da6", "#5d4f88", "#463a6e", "#312857", "#241d47", "#17122f"],
  hues: { accent: "#e2457f", blue: "#5b9bff", grape: "#9b7bff", leaf: "#2fc49a", teal: "#34d1bf", sun: "#ffb627", orange: "#ff8a3d", red: "#ff5a6e", pink: "#ff6fb0", cyan: "#3cc8e8" },
  paper: "#fff7ec",
  ink: "#120d26",
  white: "#fff6ea",
  black: "#0d0920",
  lanx: {
    "--lanx-surface": "#2a2252",
    "--lanx-tint": "#6e5bc9",
    "--lanx-line": "rgb(255 225 255 / 0.09)",
    "--lanx-fill": "rgb(200 180 255 / 0.16)",
    "--lanx-bubble": "#3a3170",
    "--lanx-rim": "rgb(255 230 255 / 0.12)",
    "--lanx-shine": "rgb(255 235 255 / 0.14)",
    "--lanx-shadow": "0 1px 1px rgb(8 4 24 / 0.25), 0 18px 44px -18px rgb(8 4 24 / 0.75)",
  },
};

export const WALLS: Record<"golden" | "toybox" | "lantern", WallLook> = {
  golden: { glows: ["#ffb38a", "#ff9eb5", "#c9b8ff"], base: ["#fff2e4", "#ffe3d3"], strength: 1 },
  toybox: { glows: ["#8fd3ff", "#ffe27a", "#9ff0c8"], base: ["#eaf6ff", "#dcefff"], strength: 1 },
  lantern: { glows: ["#ffb627", "#e2457f", "#34d1bf"], base: ["#1b1640", "#2a1a45"], strength: 0.85 },
};
const mix = (a: string, pct: number, b: string) => `color-mix(in srgb, ${a} ${pct}%, ${b})`;

/** The colours LANX gives people and groups, and the colour family each belongs to. */
const AVATAR: Record<string, string> = {
  "#0284c7": "blue", "#0ea5e9": "blue", "#3b82f6": "blue", "#6366f1": "indigo", "#8b5cf6": "violet", "#ec4899": "pink", "#10b981": "emerald",
  "#06b6d4": "cyan", "#f59e0b": "amber", "#ef4444": "red", "#f97316": "orange", "#84cc16": "lime", "#14b8a6": "teal", "#64748b": "slate",
};
/** A person's or group's colour, in the current look: a Storybook look swaps
 *  it for its own shade of the same colour; Classic keeps it exactly. */
export function storyColor(hex: string | null | undefined): string {
  const h = (hex ?? "").toLowerCase();
  const fam = AVATAR[h];
  return fam ? `var(--lanx-avatar-${fam}, ${h})` : hex ?? "";
}

function rules(p: Palette): string {
  const v: string[] = [];
  for (const fam of NEUTRALS) NEUTRAL_SHADES.forEach((s, i) => v.push(`--color-${fam}-${s}:${p.neutral[i]}`));
  for (const [hue, fams] of Object.entries(FAMILIES) as [Hue, string[]][]) {
    const base = p.hues[hue];
    for (const fam of fams)
      for (const [s, pct] of SHADES) v.push(`--color-${fam}-${s}:${pct === 100 ? base : pct > 0 ? mix(base, pct, p.paper) : mix(base, -pct, p.ink)}`);
  }
  v.push(`--color-white:${p.white}`, `--color-black:${p.black}`);
  for (const fam of new Set(Object.values(AVATAR))) v.push(`--lanx-avatar-${fam}:var(--color-${fam}-500)`);
  for (const [k, val] of Object.entries(p.lanx)) v.push(`${k}:${val}`);
  return `${p.selector}{${v.join(";")}}`;
}

/** Puts the three palettes into the page once (they only apply with the classes below). */
export function ensureStorybookCss() {
  if (typeof document === "undefined" || document.getElementById("lanx-storybook")) return;
  const el = document.createElement("style");
  el.id = "lanx-storybook";
  el.textContent = [GOLDEN, TOYBOX, LANTERN].map(rules).join("\n");
  document.head.appendChild(el);
}

/** Switches <html> to a look (dark mode is the "dark" class, set elsewhere). */
export function applyColorStyle(style: ColorStyle) {
  ensureStorybookCss();
  const root = document.documentElement;
  root.classList.toggle("storybook", style !== "classic");
  root.classList.toggle("storybook-golden", style === "golden");
  root.classList.toggle("storybook-toybox", style === "toybox");
  // Remembered for the next start, so the first frame already has the right colours.
  try {
    localStorage.setItem("lanx.colorStyle", style);
  } catch {}
}
