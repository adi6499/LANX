/** Chat background colours (Settings → Appearance). The setting holds
 *  "default", a preset id, or any "#rrggbb" the user picked. Colours are
 *  softened so text stays easy to read, in light and in dark mode. */

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

export const isCustomColor = (v: string) => /^#[0-9a-f]{6}$/i.test(v);

export function backgroundColors(value: string): string[] {
  if (isCustomColor(value)) return [value];
  return BACKGROUND_PRESETS.find((p) => p.id === value)?.colors ?? [];
}

const soften = (color: string, dark: boolean) =>
  dark ? `color-mix(in srgb, ${color} 24%, #080c14)` : `color-mix(in srgb, ${color} 30%, #ffffff)`;

/** CSS background for a setting value, or null for the default look. */
export function backgroundCss(value: string, dark: boolean): string | null {
  const cs = backgroundColors(value);
  if (cs.length === 0) return null;
  if (cs.length === 1) return soften(cs[0], dark);
  return `linear-gradient(135deg, ${soften(cs[0], dark)}, ${soften(cs[1], dark)})`;
}

/** Applies the chat background to the whole app (CSS variables used by .lanx-chat-bg). */
export function applyChatBackground(value: string) {
  const style = document.documentElement.style;
  const light = backgroundCss(value, false);
  const dark = backgroundCss(value, true);
  if (light && dark) {
    style.setProperty("--lanx-chat-bg", light);
    style.setProperty("--lanx-chat-bg-dark", dark);
  } else {
    style.removeProperty("--lanx-chat-bg");
    style.removeProperty("--lanx-chat-bg-dark");
  }
}
