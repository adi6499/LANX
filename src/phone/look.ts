/** LANX 3.4 phone page: the PC's Appearance on the phone — light or dark,
 *  accent colour, background, glass and animations — with lib/background.ts,
 *  the same code the PC uses. The wallpaper is WallpaperLayer's (the file
 *  itself comes from the PC: `wallpaperSrc`). */
import type { UserSettings } from "../types";
import { applyAppearance } from "../lib/background";
import { colorStyle } from "../lib/storybook";
import { setGlassLens } from "../lib/glass";
import { setMotion } from "../lib/motion";
import type { WallpaperChoice } from "../lib/wallpaper";

export type Look = Partial<Pick<UserSettings, "theme" | "chat_background" | "accent_color" | "glass_level" | "frost_level" | "reduce_motion" | "color_style">>;

// The glass lens is an SVG filter inside backdrop-filter, which phone
// browsers (Safari) can't do: it stays off here.
setGlassLens(false);

// Light or dark: the PC's choice, "Auto" following the phone (the page
// cannot run an inline script first, so phone.html paints the matching
// background until this runs).
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
let theme: Look["theme"] = "system";
function paintTheme() {
  const dark = theme === "dark" || (theme !== "light" && darkQuery.matches);
  document.documentElement.classList.toggle("dark", dark);
}
darkQuery.addEventListener("change", paintTheme);
paintTheme();

export function applyLook(s: Look | null | undefined) {
  if (!s) return;
  theme = s.theme ?? "system";
  paintTheme();
  applyAppearance({
    chat_background: s.chat_background ?? "default",
    accent_color: s.accent_color ?? "default",
    glass_level: s.glass_level ?? 55,
    frost_level: s.frost_level ?? 60,
    color_style: s.color_style,
  });
  setMotion(!!s.reduce_motion);
  paintBar(s.color_style);
}

/** LANX 3.6.0: the phone browser's own bar takes the look's colour too. */
function paintBar(style: string | undefined) {
  const look = colorStyle(style);
  const bars = look === "classic" ? ["#f8fafc", "#080c14"] : [look === "golden" ? "#fff2e4" : "#eaf6ff", "#1b1640"];
  document.querySelectorAll('meta[name="theme-color"]').forEach((m, i) => m.setAttribute("content", bars[Math.min(i, 1)]));
}

/** Where the phone loads the wallpaper picture or video from: straight from
 *  the PC (the query only changes when the file does, so it reloads then). */
export function wallpaperSrc(c: WallpaperChoice): string {
  let h = 0;
  for (const ch of `${c.path ?? ""}|${c.name ?? ""}`) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return `/api/wallpaper?v=${(h >>> 0).toString(36)}`;
}
