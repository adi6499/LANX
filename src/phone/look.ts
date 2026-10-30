/** LANX 3.4 phone page: the PC's Appearance on the phone — light or dark,
 *  accent colour, background, glass and animations — with lib/background.ts,
 *  the same code the PC uses. The wallpaper is WallpaperLayer's (the file
 *  itself comes from the PC: `wallpaperSrc`). */
import type { UserSettings } from "../types";
import { applyAppearance } from "../lib/background";
import { setGlassLens } from "../lib/glass";
import { setMotion } from "../lib/motion";
import type { WallpaperChoice } from "../lib/wallpaper";

export type Look = Partial<Pick<UserSettings, "theme" | "chat_background" | "accent_color" | "glass_level" | "frost_level" | "reduce_motion">>;

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
  });
  setMotion(!!s.reduce_motion);
}

/** Where the phone loads the wallpaper picture or video from: straight from
 *  the PC (the query only changes when the file does, so it reloads then). */
export function wallpaperSrc(c: WallpaperChoice): string {
  let h = 0;
  for (const ch of `${c.path ?? ""}|${c.name ?? ""}`) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return `/api/wallpaper?v=${(h >>> 0).toString(36)}`;
}
