/** LANX 1.5.0 chat helpers: "when" choices for reminders and send-later, and
 *  @mention highlighting. */
import React from "react";

export interface WhenChoice {
  label: string;
  hint: string;
  at: number;
}

const secs = (d: Date) => Math.floor(d.getTime() / 1000);
const timeText = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** Ready-made times: soon, later today, tomorrow morning, next Monday. */
export function whenChoices(kind: "remind" | "send"): WhenChoice[] {
  const now = new Date();
  const out: WhenChoice[] = [];
  const add = (label: string, d: Date) => out.push({ label, hint: `${d.toLocaleDateString([], { weekday: "short" })} ${timeText(d)}`, at: secs(d) });
  if (kind === "remind") add("In 20 minutes", new Date(now.getTime() + 20 * 60_000));
  add("In 1 hour", new Date(now.getTime() + 60 * 60_000));
  add("In 3 hours", new Date(now.getTime() + 3 * 60 * 60_000));
  const evening = new Date(now);
  evening.setHours(18, 0, 0, 0);
  if (evening.getTime() - now.getTime() > 60 * 60_000) add("This evening", evening);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  add("Tomorrow morning", tomorrow);
  const monday = new Date(now);
  monday.setDate(now.getDate() + (((8 - now.getDay()) % 7) || 7));
  monday.setHours(9, 0, 0, 0);
  if (monday.toDateString() !== tomorrow.toDateString()) add("Next Monday", monday);
  return out;
}

/** "Today 4:30 PM", "Tomorrow 9:00 AM", "Mon 20 Oct, 9:00 AM". */
export function whenText(at: number): string {
  const d = new Date(at * 1000);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return `Today ${timeText(d)}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow ${timeText(d)}`;
  return `${d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}, ${timeText(d)}`;
}

/** Value for <input type="datetime-local"> (local time). */
export function localInputValue(at: number): string {
  const d = new Date(at * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Message text with @Name mentions highlighted (yours in amber). */
export function MessageText({
  text,
  names,
  myName,
  onAccent,
}: {
  text: string;
  /** Display names of the people mentioned. */
  names: string[];
  myName: string;
  onAccent: boolean;
}) {
  const tokens = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!tokens.length) return <>{text}</>;
  const escaped = tokens.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`@(${escaped.join("|")})`, "g");
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const me = m[1] === myName;
    parts.push(
      <span
        key={m.index}
        data-mention={me ? "me" : "other"}
        className={`rounded px-0.5 font-semibold ${
          me ? "bg-amber-300/40 text-amber-900 dark:text-amber-200" : onAccent ? "bg-white/20" : "bg-sky-500/10 text-sky-700 dark:text-sky-300"
        }`}
      >
        @{m[1]}
      </span>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "🙏", "✅"];
