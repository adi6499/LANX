import type { CalendarEvent, Occurrence, Profile, SearchHit } from "../../types";
import { parseCard } from "../org/cardModel";

/** LANX 2.5.0: what the Calendar shows — your own events, the Organiser's
 *  meetings and task deadlines, colleagues' birthdays and the office holidays. */

export type ItemKind = "event" | "meeting" | "task" | "birthday" | "holiday";
export interface Item {
  id: string;
  kind: ItemKind;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  color: string;
  /** Your own event (editable, draggable). */
  occ?: Occurrence;
  /** The card behind a meeting or task. */
  card?: { conversationId: string; messageId: string; chat: string };
  subtitle?: string;
}

export interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
}

export const EVENT_COLORS: { id: string; bg: string; text: string; dot: string; name: string }[] = [
  { id: "blue", bg: "bg-sky-500", text: "text-white", dot: "bg-sky-500", name: "Blue" },
  { id: "green", bg: "bg-emerald-500", text: "text-white", dot: "bg-emerald-500", name: "Green" },
  { id: "red", bg: "bg-red-500", text: "text-white", dot: "bg-red-500", name: "Red" },
  { id: "orange", bg: "bg-orange-500", text: "text-white", dot: "bg-orange-500", name: "Orange" },
  { id: "purple", bg: "bg-violet-500", text: "text-white", dot: "bg-violet-500", name: "Purple" },
  { id: "pink", bg: "bg-pink-500", text: "text-white", dot: "bg-pink-500", name: "Pink" },
  { id: "teal", bg: "bg-teal-500", text: "text-white", dot: "bg-teal-500", name: "Teal" },
  { id: "grey", bg: "bg-slate-500", text: "text-white", dot: "bg-slate-500", name: "Grey" },
];
export const KIND_STYLE: Record<ItemKind, { bg: string; text: string; label: string }> = {
  event: { bg: "", text: "", label: "My events" },
  meeting: { bg: "bg-indigo-100 dark:bg-indigo-900/40 border-l-4 border-indigo-500", text: "text-indigo-900 dark:text-indigo-100", label: "Meetings (Organiser)" },
  task: { bg: "bg-amber-100 dark:bg-amber-900/40 border-l-4 border-amber-500", text: "text-amber-900 dark:text-amber-100", label: "Task deadlines" },
  birthday: { bg: "bg-pink-100 dark:bg-pink-900/40", text: "text-pink-900 dark:text-pink-100", label: "Birthdays" },
  holiday: { bg: "bg-rose-100 dark:bg-rose-900/40", text: "text-rose-900 dark:text-rose-100", label: "Holidays" },
};

export const REMINDERS: { mins: number | null; label: string }[] = [
  { mins: null, label: "No reminder" },
  { mins: 0, label: "At the time" },
  { mins: 5, label: "5 minutes before" },
  { mins: 10, label: "10 minutes before" },
  { mins: 15, label: "15 minutes before" },
  { mins: 30, label: "30 minutes before" },
  { mins: 60, label: "1 hour before" },
  { mins: 120, label: "2 hours before" },
  { mins: 1440, label: "1 day before" },
];
export const REPEATS: { id: CalendarEvent["repeat"]; label: string }[] = [
  { id: "none", label: "Does not repeat" },
  { id: "daily", label: "Every day" },
  { id: "weekly", label: "Every week" },
  { id: "monthly", label: "Every month" },
  { id: "yearly", label: "Every year" },
];

// ---------------------------------------------------------------- dates (local)
export const DAY = 86_400;
export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
export function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  const day = x.getDate();
  x.setDate(1);
  x.setMonth(x.getMonth() + n);
  const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
  x.setDate(Math.min(day, last));
  return x;
}
/** Monday of the week that holds `d`. */
export function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7;
  return addDays(x, -dow);
}
export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
export function keyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function fromKey(k: string): Date {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export const secs = (d: Date) => Math.floor(d.getTime() / 1000);
export const toDate = (s: number) => new Date(s * 1000);
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function fmtTime(s: number): string {
  return toDate(s).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }).replace(/\s/g, " ");
}
export function fmtDate(s: number, withYear = false): string {
  return toDate(s).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
}
export function fmtRange(it: Item): string {
  if (it.allDay) {
    const days = Math.round((it.end - it.start) / DAY);
    return days > 1 ? `${fmtDate(it.start)} – ${fmtDate(it.end - DAY)} · all day` : `${fmtDate(it.start)} · all day`;
  }
  const a = toDate(it.start);
  const b = toDate(it.end);
  return sameDay(a, b) ? `${fmtDate(it.start)} · ${fmtTime(it.start)} – ${fmtTime(it.end)}` : `${fmtDate(it.start)} ${fmtTime(it.start)} – ${fmtDate(it.end)} ${fmtTime(it.end)}`;
}
/** "2026-10-23T09:30" for <input type="datetime-local">. */
export function toLocalInput(s: number): string {
  const d = toDate(s);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function fromLocalInput(v: string): number {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? Math.floor(Date.now() / 1000) : secs(d);
}

// ---------------------------------------------------------------- items
export function eventItem(o: Occurrence): Item {
  return { id: `ev:${o.event.id}:${o.start}`, kind: "event", title: o.event.title, start: o.start, end: o.end, allDay: o.event.all_day, color: o.event.color, occ: o, subtitle: o.event.location };
}

/** Meetings and task deadlines from the Organiser's cards. */
export function cardItems(hits: SearchHit[], from: number, to: number): Item[] {
  const out: Item[] = [];
  for (const h of hits) {
    const m = h.message;
    if (m.deleted) continue;
    const c = parseCard(m);
    if (!c) continue;
    if (c.kind === "event") {
      const end = c.start + Math.max(15, c.minutes) * 60;
      if (end <= from || c.start >= to) continue;
      const cancelled = (m.card_state ?? []).some((s) => s.key === "cancelled" && s.value === true);
      if (cancelled) continue;
      out.push({ id: `mt:${m.id}`, kind: "meeting", title: c.title, start: c.start, end, allDay: false, color: "indigo", card: { conversationId: m.conversation_id, messageId: m.id, chat: h.peer_name }, subtitle: c.place || h.peer_name });
    } else if (c.kind === "task" && c.due) {
      const day = startOfDay(toDate(c.due));
      const s = secs(day);
      if (s + DAY <= from || s >= to) continue;
      const done = (m.card_state ?? []).some((st) => st.key === "status" && st.value === "done");
      if (done) continue;
      out.push({ id: `tk:${m.id}`, kind: "task", title: `Due: ${c.title}`, start: s, end: s + DAY, allDay: true, color: "amber", card: { conversationId: m.conversation_id, messageId: m.id, chat: h.peer_name }, subtitle: h.peer_name });
    }
  }
  return out;
}

/** Birthdays ("MM-DD") of colleagues and you, for every year in the window. */
export function birthdayItems(people: { name: string; birthday?: string }[], from: number, to: number): Item[] {
  const out: Item[] = [];
  const y0 = toDate(from).getFullYear();
  const y1 = toDate(to).getFullYear();
  for (const p of people) {
    const m = /^(\d{2})-(\d{2})$/.exec(p.birthday ?? "");
    if (!m) continue;
    for (let y = y0; y <= y1; y++) {
      const d = new Date(y, Number(m[1]) - 1, Number(m[2]));
      const s = secs(d);
      if (s + DAY <= from || s >= to) continue;
      out.push({ id: `bd:${p.name}:${y}`, kind: "birthday", title: `🎂 ${p.name}`, start: s, end: s + DAY, allDay: true, color: "pink" });
    }
  }
  return out;
}

export function holidayItems(holidays: Holiday[], from: number, to: number): Item[] {
  const out: Item[] = [];
  for (const h of holidays) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(h.date)) continue;
    const s = secs(fromKey(h.date));
    if (s + DAY <= from || s >= to) continue;
    out.push({ id: `hd:${h.date}:${h.name}`, kind: "holiday", title: h.name, start: s, end: s + DAY, allDay: true, color: "rose" });
  }
  return out;
}

/** India's fixed-date national holidays for a year (festivals move; add them yourself). */
export function nationalHolidays(year: number): Holiday[] {
  return [
    { date: `${year}-01-26`, name: "Republic Day" },
    { date: `${year}-05-01`, name: "Maharashtra Day / Labour Day" },
    { date: `${year}-08-15`, name: "Independence Day" },
    { date: `${year}-10-02`, name: "Gandhi Jayanti" },
    { date: `${year}-12-25`, name: "Christmas" },
  ];
}

/** Items that touch a given day (all-day ones and timed ones alike). */
export function itemsOnDay(items: Item[], day: Date): Item[] {
  const s = secs(startOfDay(day));
  const e = s + DAY;
  return items.filter((it) => it.start < e && it.end > s).sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start);
}

/** Lays timed items of one day out in columns so overlapping ones sit side by side. */
export function layoutColumns(items: Item[]): { item: Item; col: number; cols: number }[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const placed: { item: Item; col: number; cols: number; group: number }[] = [];
  let groupEnd = -1;
  let group = -1;
  let colsInGroup: number[] = [];
  for (const it of sorted) {
    if (it.start >= groupEnd) {
      group++;
      colsInGroup = [];
      groupEnd = it.end;
    } else groupEnd = Math.max(groupEnd, it.end);
    let col = colsInGroup.findIndex((end) => end <= it.start);
    if (col < 0) {
      col = colsInGroup.length;
      colsInGroup.push(it.end);
    } else colsInGroup[col] = it.end;
    placed.push({ item: it, col, cols: 0, group });
    for (const p of placed) if (p.group === group) p.cols = colsInGroup.length;
  }
  return placed;
}

export function eventText(it: Item): string {
  const when = fmtRange(it);
  const where = it.occ?.event.location ? `\n📍 ${it.occ.event.location}` : it.subtitle ? `\n${it.subtitle}` : "";
  const notes = it.occ?.event.details ? `\n\n${it.occ.event.details}` : "";
  return `📅 ${it.title}\n${when}${where}${notes}`;
}

export function profileName(p: Profile | undefined, fallback: string): string {
  return fallback || (p ? "Colleague" : "Colleague");
}
