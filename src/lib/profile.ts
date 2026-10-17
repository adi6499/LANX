/** LANX 1.2.9 profiles: avatar (photo / character / initials), status and
 *  "about me" — what colleagues see besides the name and colour. */
import type { Profile } from "../types";

export interface StatusPreset {
  id: string;
  emoji: string;
  label: string;
  /** Badge / chip colour. */
  color: string;
}

export const STATUS_PRESETS: StatusPreset[] = [
  { id: "available", emoji: "🟢", label: "Available", color: "#22c55e" },
  { id: "busy", emoji: "🔴", label: "Busy", color: "#ef4444" },
  { id: "meeting", emoji: "📅", label: "In a meeting", color: "#8b5cf6" },
  { id: "lunch", emoji: "🍽️", label: "At lunch", color: "#f59e0b" },
  { id: "wfh", emoji: "🏠", label: "Working from home", color: "#0ea5e9" },
  { id: "road", emoji: "🚗", label: "On the road", color: "#64748b" },
  { id: "leave", emoji: "🌴", label: "On leave", color: "#14b8a6" },
  { id: "dnd", emoji: "🌙", label: "Do not disturb", color: "#6366f1" },
];

/** Fun characters for the avatar (shown on a gradient of the avatar colour). */
export const CHARACTERS = [
  "🐱", "🐶", "🦊", "🐼", "🐨", "🦁", "🐯", "🐸", "🐵", "🦉",
  "🐧", "🦄", "🐙", "🐝", "🐢", "🦋", "🐳", "🐰", "🐻", "🐮",
  "🚀", "🎧", "🎨", "⚽", "☕", "🍕", "🌸", "🌻", "⭐", "🔥",
  "😎", "🤓", "🥳", "🤖", "👻", "🧑‍💻",
];

export const EMPTY_PROFILE: Profile = {
  avatar: "initials",
  photo: "",
  status: "",
  status_text: "",
  status_until: 0,
  title: "",
  department: "",
  phone: "",
  email: "",
  bio: "",
};

/** The profile with an expired status cleared (like the engine does). */
export function effective(p: Profile | null | undefined, nowSecs = Math.floor(Date.now() / 1000)): Profile | null {
  if (!p) return null;
  if (p.status_until > 0 && nowSecs >= p.status_until) return { ...p, status: "", status_text: "", status_until: 0 };
  return p;
}

export const statusPreset = (id: string | undefined | null) => STATUS_PRESETS.find((s) => s.id === id) ?? null;

function untilText(until: number): string {
  if (!until) return "";
  const d = new Date(until * 1000);
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `until ${time}`;
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return `until tomorrow ${time}`;
  return `until ${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

/** "📅 In a meeting · Budget review · until 3:00 pm" (or null). */
export function statusLine(p: Profile | null | undefined, opts: { until?: boolean } = {}): { emoji: string; text: string; color: string } | null {
  const e = effective(p);
  if (!e || (!e.status && !e.status_text)) return null;
  const preset = statusPreset(e.status);
  const parts = [preset?.label, e.status_text].filter(Boolean) as string[];
  if (opts.until !== false && e.status_until) parts.push(untilText(e.status_until));
  return { emoji: preset?.emoji ?? "💬", text: parts.join(" · "), color: preset?.color ?? "#64748b" };
}

/** "Accountant · Accounts" (or ""). */
export const roleLine = (p: Profile | null | undefined) => [p?.title, p?.department].filter(Boolean).join(" · ");

/** When a status should clear itself. */
export const CLEAR_AFTER: { id: string; label: string; until: () => number }[] = [
  { id: "never", label: "Don't clear", until: () => 0 },
  { id: "30m", label: "30 minutes", until: () => Math.floor(Date.now() / 1000) + 30 * 60 },
  { id: "1h", label: "1 hour", until: () => Math.floor(Date.now() / 1000) + 3600 },
  { id: "4h", label: "4 hours", until: () => Math.floor(Date.now() / 1000) + 4 * 3600 },
  {
    id: "today",
    label: "Today",
    until: () => {
      const d = new Date();
      d.setHours(23, 59, 0, 0);
      return Math.floor(d.getTime() / 1000);
    },
  },
  {
    id: "week",
    label: "This week",
    until: () => {
      const d = new Date();
      d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
      d.setHours(23, 59, 0, 0);
      return Math.floor(d.getTime() / 1000);
    },
  },
];

/** Shrinks a picture to a small square photo for the profile (a data URL),
 *  given the crop: zoom (1 = the short side fills the circle) and offset of
 *  the picture's centre from the circle's centre, as fractions of the circle. */
export async function cropToAvatar(src: string, zoom: number, dx: number, dy: number, size = 160): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("That picture could not be opened."));
    i.src = src;
  });
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare the picture.");
  const scale = (size / Math.min(img.width, img.height)) * zoom;
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, size / 2 - w / 2 + dx * size, size / 2 - h / 2 + dy * size, w, h);
  // Small enough to travel inside one message to colleagues.
  for (const q of [0.85, 0.75, 0.62, 0.5]) {
    const url = canvas.toDataURL("image/webp", q);
    if (url.startsWith("data:image/webp") && url.length <= 45_000) return url;
    const jpg = canvas.toDataURL("image/jpeg", q);
    if (jpg.length <= 45_000) return jpg;
  }
  throw new Error("That picture is too detailed; try another one.");
}
