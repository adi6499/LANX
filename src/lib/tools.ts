/** LANX 1.7.0 helpers: muted chats, quiet hours, kinds of files. */
import type { Conversation, QuietHours } from "../types";

const nowSecs = () => Math.floor(Date.now() / 1000);

/** Sounds and pop-ups for this chat are off right now. */
export function isMuted(c?: Conversation | null, now = nowSecs()): boolean {
  if (!c) return false;
  const until = c.muted_until ?? 0;
  return until === -1 || until > now;
}

/** "Muted" / "Muted until 15:30" / "Muted until Fri 09:00". */
export function muteText(c?: Conversation | null): string | null {
  if (!c || !isMuted(c)) return null;
  if (c.muted_until === -1) return "Muted";
  const d = new Date((c.muted_until ?? 0) * 1000);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `Muted until ${sameDay ? time : `${d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })} ${time}`}`;
}

/** Minutes; -1 = until turned back on. */
export const MUTE_CHOICES: [number, string][] = [
  [60, "1 hour"],
  [8 * 60, "8 hours"],
  [24 * 60, "1 day"],
  [7 * 24 * 60, "1 week"],
  [-1, "Until I turn it back on"],
];

export const DEFAULT_QUIET: QuietHours = { enabled: false, start: 19 * 60, end: 9 * 60, days: [0, 1, 2, 3, 4, 5, 6] };

/** Same rule as the app engine: overnight ranges belong to the day they start. */
export function quietCovers(q: QuietHours | undefined, weekday: number, minute: number): boolean {
  if (!q || !q.enabled || q.start === q.end) return false;
  const on = (d: number) => q.days.includes(d);
  if (q.start < q.end) return on(weekday) && minute >= q.start && minute < q.end;
  return (on(weekday) && minute >= q.start) || (on((weekday + 6) % 7) && minute < q.end);
}

export function quietNow(q?: QuietHours, d = new Date()): boolean {
  return quietCovers(q, d.getDay(), d.getHours() * 60 + d.getMinutes());
}

export const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export function fromTime(t: string): number {
  const [h, m] = t.split(":").map((x) => parseInt(x, 10));
  return Math.min(1439, Math.max(0, (h || 0) * 60 + (m || 0)));
}

export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type FileKind = "image" | "pdf" | "doc" | "sheet" | "slides" | "video" | "audio" | "archive" | "other";

const EXT: Record<string, FileKind> = {
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", bmp: "image", heic: "image", svg: "image",
  pdf: "pdf",
  doc: "doc", docx: "doc", txt: "doc", rtf: "doc", odt: "doc", md: "doc",
  xls: "sheet", xlsx: "sheet", xlsm: "sheet", csv: "sheet", ods: "sheet",
  ppt: "slides", pptx: "slides", odp: "slides",
  mp4: "video", mov: "video", avi: "video", mkv: "video", webm: "video", wmv: "video",
  mp3: "audio", wav: "audio", m4a: "audio", ogg: "audio", opus: "audio", aac: "audio",
  zip: "archive", rar: "archive", "7z": "archive", tar: "archive", gz: "archive",
};

export function fileKind(name: string): FileKind {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXT[ext] ?? "other";
}

/** Lowercase-insensitive "contains" for the chat list filter. */
export const matches = (text: string | null | undefined, q: string) => !q || (text ?? "").toLowerCase().includes(q.toLowerCase());
