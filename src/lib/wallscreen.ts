/** LANX 3.14.0: the wallpaper screen — a live wallpaper over the whole screen with a big
 *  clock and the date, like a phone's lock screen. The wallpaper is one of LANX's own
 *  (drawn live), your own picture or video, or one fetched once from a link. */
import { api } from "./api";
import { BUILTIN } from "./wallpaper";

export type ClockStyle = "bold" | "thin" | "serif" | "mono";

export interface WallScreenPrefs {
  /** "app": the wallpaper LANX already shows behind the chats. */
  source: "app" | "builtin" | "file";
  /** Built-in: which one. */
  id?: string;
  /** File: the copy LANX keeps (in its data folder) and a name to show. */
  path?: string;
  name?: string;
  /** The link the file came from, if it came from one. */
  link?: string;
  /** 0..60: how much the picture is darkened so the clock stays easy to read. */
  dim: number;
  clock: ClockStyle;
  hour12: boolean;
  seconds: boolean;
  date: boolean;
  /** Keep the screen from going to sleep while the wallpaper screen shows. */
  awake: boolean;
}

/** Whether this PC's region tells the time with AM and PM. */
function regionUses12Hours(): boolean {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hour12 ?? true;
  } catch {
    return true;
  }
}

export const DEFAULT_WALLSCREEN: WallScreenPrefs = { source: "builtin", id: "bloom", dim: 12, clock: "bold", hour12: regionUses12Hours(), seconds: false, date: true, awake: true };

export const CLOCK_STYLES: { id: ClockStyle; name: string; font: string; weight: number; spacing: string }[] = [
  { id: "bold", name: "Bold", font: '"Plus Jakarta Sans", system-ui, sans-serif', weight: 700, spacing: "-0.045em" },
  { id: "thin", name: "Light", font: '"Plus Jakarta Sans", system-ui, sans-serif', weight: 200, spacing: "-0.04em" },
  { id: "serif", name: "Serif", font: 'Georgia, "Times New Roman", "DejaVu Serif", "Liberation Serif", serif', weight: 400, spacing: "-0.02em" },
  { id: "mono", name: "Digital", font: '"JetBrains Mono", ui-monospace, monospace', weight: 500, spacing: "-0.06em" },
];

/** What was saved, made safe to use (anything missing or odd becomes the usual choice). */
export function cleanWallScreen(v: unknown): WallScreenPrefs {
  const o = (v && typeof v === "object" ? v : {}) as Partial<WallScreenPrefs>;
  const d = DEFAULT_WALLSCREEN;
  const source = o.source === "app" || o.source === "file" || o.source === "builtin" ? o.source : d.source;
  const id = typeof o.id === "string" && BUILTIN.some((b) => b.id === o.id) ? o.id : d.id;
  const path = typeof o.path === "string" && o.path ? o.path : undefined;
  return {
    source: source === "file" && !path ? "builtin" : source,
    id,
    path,
    name: typeof o.name === "string" ? o.name.slice(0, 120) : undefined,
    link: typeof o.link === "string" ? o.link.slice(0, 2000) : undefined,
    dim: Math.min(60, Math.max(0, Number.isFinite(Number(o.dim)) ? Math.round(Number(o.dim)) : d.dim)),
    clock: CLOCK_STYLES.some((c) => c.id === o.clock) ? (o.clock as ClockStyle) : d.clock,
    hour12: typeof o.hour12 === "boolean" ? o.hour12 : d.hour12,
    seconds: typeof o.seconds === "boolean" ? o.seconds : d.seconds,
    date: typeof o.date === "boolean" ? o.date : d.date,
    awake: typeof o.awake === "boolean" ? o.awake : d.awake,
  };
}

export async function loadWallScreen(): Promise<WallScreenPrefs> {
  try {
    const v = await api.getPref("wallscreen");
    return cleanWallScreen(v ? JSON.parse(v) : null);
  } catch {
    return cleanWallScreen(null);
  }
}

export function saveWallScreen(p: WallScreenPrefs): Promise<void> {
  return api.setPref("wallscreen", JSON.stringify(p)).catch(() => {});
}

/** The time as the screen shows it: "9:41" (+ "PM"), or "21:41"; seconds apart. */
export function timeParts(now: Date, hour12: boolean): { main: string; seconds: string; suffix: string } {
  const h = now.getHours();
  const two = (n: number) => String(n).padStart(2, "0");
  return {
    main: `${hour12 ? h % 12 || 12 : two(h)}:${two(now.getMinutes())}`,
    seconds: two(now.getSeconds()),
    suffix: hour12 ? (h < 12 ? "AM" : "PM") : "",
  };
}

/** "Saturday 14 November", in this PC's own language and order. */
export function dateLine(now: Date): string {
  try {
    return new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" }).format(now);
  } catch {
    return now.toDateString();
  }
}

/** Opens the wallpaper screen (App listens). */
export function openWallScreen(): void {
  window.dispatchEvent(new Event("lanx:wallscreen-open"));
}
