import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Download, MessageCircle, Plus, Search, Send, Settings2, Trash2, Users, X } from "lucide-react";
import type { CalendarEvent, Occurrence, Profile } from "../../types";
import { api, errorText } from "../../lib/api";
import {
  DAY,
  DOW,
  EVENT_COLORS,
  type Holiday,
  type Item,
  KIND_STYLE,
  MONTHS,
  REMINDERS,
  REPEATS,
  addDays,
  addMonths,
  birthdayItems,
  cardItems,
  eventItem,
  eventText,
  fmtRange,
  fmtTime,
  fromLocalInput,
  holidayItems,
  itemsOnDay,
  keyOf,
  layoutColumns,
  nationalHolidays,
  sameDay,
  secs,
  startOfDay,
  startOfWeek,
  toDate,
  toLocalInput,
} from "./calendarModel";

/** LANX 2.5.0: the Calendar. Month, week, day and agenda views; your own
 *  events (repeats, reminders, colours, drag to move); the Organiser's
 *  meetings and task deadlines; birthdays; holidays; search; .ics export. */

type View = "month" | "week" | "day" | "agenda";
const HOUR_PX = 48;
const SNAP = 15 * 60;

export interface MeetingPrefill {
  title: string;
  start: number;
  minutes: number;
  place: string;
  agenda: string;
}

export function CalendarPanel({
  myName,
  myBirthday,
  profiles,
  peerNames,
  onClose,
  onError,
  onOpenCard,
  onSendText,
  onInvite,
}: {
  myName: string;
  myBirthday?: string;
  profiles: Record<string, Profile>;
  peerNames: Record<string, string>;
  onClose: () => void;
  onError: (text: string) => void;
  onOpenCard: (conversationId: string, messageId: string) => void;
  onSendText: (text: string) => void;
  /** "Invite colleagues": make this a meeting in a chat (the Organiser's meeting card). */
  onInvite: (prefill: MeetingPrefill) => void;
}) {
  const [view, setView] = useState<View>("month");
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));
  const [occs, setOccs] = useState<Occurrence[]>([]);
  const [cards, setCards] = useState<Item[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [show, setShow] = useState<Record<string, boolean>>({ event: true, meeting: true, task: true, birthday: true, holiday: true });
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [peek, setPeek] = useState<Item | null>(null);
  const [holidayEditor, setHolidayEditor] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  // One Date object for "today" (a fresh one each render would re-run every effect).
  const today = useMemo(() => startOfDay(new Date()), []);

  // ---- the window of time each view needs
  const range = useMemo(() => {
    if (view === "month") {
      const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      const start = startOfWeek(first);
      return { from: secs(start), to: secs(addDays(start, 42)) };
    }
    if (view === "week") {
      const s = startOfWeek(anchor);
      return { from: secs(s), to: secs(addDays(s, 7)) };
    }
    if (view === "day") return { from: secs(anchor), to: secs(addDays(anchor, 1)) };
    return { from: secs(today), to: secs(addDays(today, 60)) };
  }, [view, anchor, today]);

  const searchRange = useMemo(() => ({ from: secs(addDays(today, -365)), to: secs(addDays(today, 365)) }), [today]);
  const load = useCallback(async () => {
    const r = q.trim() ? searchRange : range;
    try {
      const [o, hits, hol] = await Promise.all([api.listEvents(r.from, r.to), api.listCards(), api.getPref("holidays")]);
      setOccs(o);
      setCards(cardItems(hits, r.from, r.to));
      setHolidays(hol ? (JSON.parse(hol) as Holiday[]) : []);
    } catch (e) {
      onError(errorText(e));
    }
  }, [range, searchRange, q, onError]);
  useEffect(() => {
    void load();
  }, [load]);

  const people = useMemo(() => {
    const list = Object.entries(profiles).map(([id, p]) => ({ name: peerNames[id] ?? "Colleague", birthday: p.birthday }));
    list.push({ name: `${myName} (you)`, birthday: myBirthday });
    return list;
  }, [profiles, peerNames, myName, myBirthday]);

  const items = useMemo(() => {
    const r = q.trim() ? searchRange : range;
    let all: Item[] = [
      ...occs.map(eventItem),
      ...cards,
      ...birthdayItems(people, r.from, r.to),
      ...holidayItems(holidays, r.from, r.to),
    ].filter((it) => show[it.kind]);
    const t = q.trim().toLowerCase();
    if (t) all = all.filter((it) => it.title.toLowerCase().includes(t) || (it.subtitle ?? "").toLowerCase().includes(t) || (it.occ?.event.details ?? "").toLowerCase().includes(t));
    return all.sort((a, b) => a.start - b.start);
  }, [occs, cards, people, holidays, show, q, range, searchRange]);

  // ---- navigation
  const go = (n: number) => setAnchor((a) => (view === "month" ? addMonths(a, n) : view === "week" ? addDays(a, 7 * n) : addDays(a, n)));
  const title =
    view === "month"
      ? `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`
      : view === "week"
        ? `${startOfWeek(anchor).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${addDays(startOfWeek(anchor), 6).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
        : view === "day"
          ? anchor.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
          : "Coming up";

  // ---- creating / editing
  const blank = (start: number, allDay = false, end?: number): CalendarEvent => ({
    id: "",
    title: "",
    details: "",
    location: "",
    start,
    end: end ?? start + 1800,
    all_day: allDay,
    color: "blue",
    repeat: "none",
    repeat_until: null,
    reminder_mins: allDay ? null : 10,
    created_at: 0,
    updated_at: 0,
  });
  const newOnDay = (d: Date) => {
    const at = new Date(d);
    at.setHours(9, 0, 0, 0);
    setEditing(blank(secs(at)));
  };
  const saveEvent = async (e: CalendarEvent) => {
    try {
      await api.saveEvent(e);
      setEditing(null);
      setPeek(null);
      await load();
    } catch (err) {
      onError(errorText(err));
    }
  };
  const deleteEvent = async (id: string) => {
    try {
      await api.deleteEvent(id);
      setEditing(null);
      setPeek(null);
      await load();
    } catch (err) {
      onError(errorText(err));
    }
  };
  /** Moves an occurrence's whole series by `delta` seconds (drag and drop). */
  const shiftEvent = async (it: Item, delta: number, newEnd?: number) => {
    if (!it.occ || delta === 0 && newEnd === undefined) return;
    const e = it.occ.event;
    const next = { ...e, start: e.start + delta, end: newEnd !== undefined ? e.end + (newEnd - it.end) : e.end + delta };
    await saveEvent(next);
  };

  const exportIcs = async () => {
    try {
      const ics = await api.exportEventsIcs();
      const path = await api.saveTextFile("LANX calendar.ics", ics, "ics");
      if (path) onError(`Saved: ${path.split(/[\\/]/).pop()} — open it in Outlook, Google Calendar or your phone.`);
    } catch (err) {
      onError(errorText(err));
    }
  };
  const saveHolidays = async (list: Holiday[]) => {
    try {
      const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
      await api.setPref("holidays", JSON.stringify(sorted));
      setHolidays(sorted);
    } catch (err) {
      onError(errorText(err));
    }
  };

  // ---- drag & drop (month: whole days; week/day: time)
  const dropOnDay = async (day: Date, e: React.DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/lanx-item") || dragging;
    setDragging(null);
    const it = items.find((x) => x.id === id);
    if (!it?.occ) return;
    const from = startOfDay(toDate(it.start));
    const delta = secs(startOfDay(day)) - secs(from);
    await shiftEvent(it, delta);
  };
  const dropOnTime = async (day: Date, e: React.DragEvent, colEl: HTMLDivElement) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/lanx-item") || dragging;
    setDragging(null);
    const it = items.find((x) => x.id === id);
    if (!it?.occ) return;
    const rect = colEl.getBoundingClientRect();
    const y = e.clientY - rect.top + colEl.scrollTop;
    const grabbed = Number(e.dataTransfer.getData("text/lanx-grab") || 0);
    const minute = Math.max(0, Math.round(((y - grabbed) / HOUR_PX) * 60 / 15) * 15);
    const target = secs(startOfDay(day)) + minute * 60;
    if (it.allDay) {
      // dragging an all-day event into the time grid makes it timed
      await saveEvent({ ...it.occ.event, all_day: false, start: target, end: target + 3600 });
      return;
    }
    await shiftEvent(it, target - it.start);
  };

  // ---- pieces
  const colorFor = (it: Item) => EVENT_COLORS.find((c) => c.id === it.color) ?? EVENT_COLORS[0];
  const chipClass = (it: Item) =>
    it.kind === "event" ? `${colorFor(it).bg} ${colorFor(it).text}` : `${KIND_STYLE[it.kind].bg} ${KIND_STYLE[it.kind].text}`;

  const Chip = ({ it, compact = false, style }: { it: Item; compact?: boolean; style?: React.CSSProperties }) => (
    <button
      type="button"
      data-cal-item={it.id}
      draggable={!!it.occ}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/lanx-item", it.id);
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        e.dataTransfer.setData("text/lanx-grab", String(e.clientY - r.top));
        setDragging(it.id);
      }}
      onDragEnd={() => setDragging(null)}
      onClick={(e) => {
        e.stopPropagation();
        setPeek(it);
      }}
      title={`${it.title}\n${fmtRange(it)}`}
      style={style}
      className={`w-full text-left rounded-md px-1.5 ${compact ? "py-0 text-[10.5px] leading-[18px] truncate" : "py-0.5 text-[11px] leading-tight overflow-hidden"} font-medium ${chipClass(it)} ${dragging === it.id ? "opacity-40" : ""}`}
    >
      {!it.allDay && compact && <span className="opacity-80 mr-1">{fmtTime(it.start)}</span>}
      {it.title}
      {!compact && !it.allDay && <div className="text-[10px] opacity-80 truncate">{fmtTime(it.start)} – {fmtTime(it.end)}{it.subtitle ? ` · ${it.subtitle}` : ""}</div>}
    </button>
  );

  const MonthView = () => {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const start = startOfWeek(first);
    const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="grid grid-cols-7 border-b lanx-line text-[11px] font-semibold text-slate-500">
          {DOW.map((d) => <div key={d} className="px-2 py-1">{d}</div>)}
        </div>
        <div className="flex-1 min-h-0 grid grid-cols-7 grid-rows-6">
          {days.map((d) => {
            const inMonth = d.getMonth() === anchor.getMonth();
            const list = itemsOnDay(items, d);
            const isToday = sameDay(d, today);
            const weekend = d.getDay() === 0;
            return (
              <div
                key={keyOf(d)}
                data-cal-day={keyOf(d)}
                onClick={() => newOnDay(d)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => dropOnDay(d, e)}
                className={`border-b border-r lanx-line p-1 min-h-0 overflow-hidden cursor-pointer ${inMonth ? "" : "bg-black/[0.03] dark:bg-white/[0.03] text-slate-400"} ${weekend && inMonth ? "bg-rose-50/40 dark:bg-rose-900/10" : ""} hover:bg-sky-50/50 dark:hover:bg-sky-900/10`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-[11.5px] font-semibold h-5 w-5 flex items-center justify-center rounded-full ${isToday ? "bg-sky-500 text-white" : inMonth ? "text-slate-700 dark:text-slate-200" : ""}`}>{d.getDate()}</span>
                  {list.length > 3 && (
                    <button type="button" onClick={(e) => { e.stopPropagation(); setAnchor(d); setView("day"); }} className="text-[10px] text-slate-400 hover:text-sky-600">+{list.length - 3} more</button>
                  )}
                </div>
                <div className="space-y-0.5 mt-0.5">
                  {list.slice(0, 3).map((it) => <Chip key={it.id} it={it} compact />)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const TimeGrid = ({ days }: { days: Date[] }) => {
    const scroller = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
      if (scroller.current) scroller.current.scrollTop = HOUR_PX * 8 - 8;
    }, []);
    const nowTop = ((Date.now() / 1000 - secs(today)) / 3600) * HOUR_PX;
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        {/* all-day row */}
        <div className="grid border-b lanx-line" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
          <div className="text-[10px] text-slate-400 px-1 pt-1">all day</div>
          {days.map((d) => (
            <div key={keyOf(d)} data-cal-allday={keyOf(d)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => dropOnDay(d, e)} onClick={() => setEditing(blank(secs(startOfDay(d)), true, secs(startOfDay(d)) + DAY))} className="border-l lanx-line p-1 min-h-[34px] space-y-0.5 cursor-pointer">
              <div className={`text-[11px] font-semibold text-center ${sameDay(d, today) ? "text-sky-600" : "text-slate-500"}`}>{DOW[(d.getDay() + 6) % 7]} {d.getDate()}</div>
              {itemsOnDay(items, d).filter((it) => it.allDay).map((it) => <Chip key={it.id} it={it} compact />)}
            </div>
          ))}
        </div>
        <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto">
          <div className="grid relative" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))`, height: HOUR_PX * 24 }}>
            <div className="relative">
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="absolute right-1 text-[10px] text-slate-400" style={{ top: h * HOUR_PX - 6 }}>{h === 0 ? "" : `${((h + 11) % 12) + 1} ${h < 12 ? "am" : "pm"}`}</div>
              ))}
            </div>
            {days.map((d) => {
              const timed = itemsOnDay(items, d).filter((it) => !it.allDay);
              const laid = layoutColumns(timed);
              const dayStart = secs(startOfDay(d));
              return (
                <div
                  key={keyOf(d)}
                  data-cal-col={keyOf(d)}
                  className="relative border-l lanx-line"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => dropOnTime(d, e, e.currentTarget)}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const minute = Math.floor(((e.clientY - rect.top) / HOUR_PX) * 60 / 30) * 30;
                    setEditing(blank(dayStart + minute * 60));
                  }}
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} className="absolute left-0 right-0 border-t lanx-line" style={{ top: h * HOUR_PX }} />
                  ))}
                  {sameDay(d, today) && <div className="absolute left-0 right-0 h-0.5 bg-red-500 z-10" style={{ top: nowTop }} />}
                  {laid.map(({ item: it, col, cols }) => {
                    const top = ((Math.max(it.start, dayStart) - dayStart) / 3600) * HOUR_PX;
                    const bottom = ((Math.min(it.end, dayStart + DAY) - dayStart) / 3600) * HOUR_PX;
                    const width = 100 / cols;
                    return (
                      <div key={it.id} className="absolute px-0.5" style={{ top, height: Math.max(18, bottom - top), left: `${col * width}%`, width: `${width}%` }} onClick={(e) => e.stopPropagation()}>
                        <Chip it={it} style={{ height: "100%" }} />
                        {it.occ && (
                          <div
                            className="absolute left-1 right-1 bottom-0 h-2 cursor-ns-resize"
                            title="Drag to change the end time"
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              const startY = e.clientY;
                              const origEnd = it.end;
                              const move = (ev: PointerEvent) => {
                                const dmin = Math.round(((ev.clientY - startY) / HOUR_PX) * 60 / 15) * 15;
                                const el = (e.target as HTMLElement).parentElement!;
                                el.style.height = `${Math.max(18, bottom - top + (dmin / 60) * HOUR_PX)}px`;
                              };
                              const up = (ev: PointerEvent) => {
                                window.removeEventListener("pointermove", move);
                                window.removeEventListener("pointerup", up);
                                const dmin = Math.round(((ev.clientY - startY) / HOUR_PX) * 60 / 15) * 15;
                                const newEnd = Math.max(it.start + SNAP, origEnd + dmin * 60);
                                if (newEnd !== origEnd) void shiftEvent(it, 0, newEnd);
                              };
                              window.addEventListener("pointermove", move);
                              window.addEventListener("pointerup", up);
                            }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const Agenda = () => {
    const groups = new Map<string, Item[]>();
    for (const it of items) {
      const k = keyOf(toDate(it.start));
      groups.set(k, [...(groups.get(k) ?? []), it]);
    }
    const keys = [...groups.keys()].sort();
    return (
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {!keys.length && <div className="text-center text-[13px] text-slate-400 py-10">{q ? "Nothing matches." : "Nothing coming up in the next 60 days."}</div>}
        {keys.map((k) => {
          const d = new Date(k);
          return (
            <div key={k} className="flex gap-3 py-2 border-b lanx-line">
              <div className="w-24 shrink-0">
                <div className={`text-[12px] font-bold ${sameDay(d, today) ? "text-sky-600" : "text-slate-700 dark:text-slate-200"}`}>{sameDay(d, today) ? "Today" : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</div>
                <div className="text-[10.5px] text-slate-400">{d.getFullYear()}</div>
              </div>
              <div className="flex-1 space-y-1">
                {groups.get(k)!.map((it) => (
                  <button key={it.id} type="button" data-cal-item={it.id} onClick={() => setPeek(it)} className="w-full text-left flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-[var(--lanx-fill)]">
                    <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${it.kind === "event" ? colorFor(it).dot : it.kind === "meeting" ? "bg-indigo-500" : it.kind === "task" ? "bg-amber-500" : it.kind === "birthday" ? "bg-pink-500" : "bg-rose-500"}`} />
                    <span className="w-28 shrink-0 text-[11.5px] text-slate-500">{it.allDay ? "All day" : `${fmtTime(it.start)} – ${fmtTime(it.end)}`}</span>
                    <span className="flex-1 min-w-0 truncate text-[12.5px] font-semibold text-slate-800 dark:text-slate-100">{it.title}</span>
                    {it.subtitle && <span className="text-[11px] text-slate-400 truncate max-w-[180px]">{it.subtitle}</span>}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const MiniMonth = () => {
    const [m, setM] = useState(() => new Date(anchor.getFullYear(), anchor.getMonth(), 1));
    useEffect(() => setM(new Date(anchor.getFullYear(), anchor.getMonth(), 1)), [anchor]);
    const start = startOfWeek(m);
    const busy = new Set(items.map((it) => keyOf(toDate(it.start))));
    return (
      <div className="rounded-xl lanx-group p-2">
        <div className="flex items-center justify-between px-1 pb-1">
          <button type="button" onClick={() => setM(addMonths(m, -1))} className="lanx-tool p-0.5 text-slate-500"><ChevronLeft className="h-3.5 w-3.5" /></button>
          <span className="text-[11.5px] font-semibold text-slate-700 dark:text-slate-200">{MONTHS[m.getMonth()].slice(0, 3)} {m.getFullYear()}</span>
          <button type="button" onClick={() => setM(addMonths(m, 1))} className="lanx-tool p-0.5 text-slate-500"><ChevronRight className="h-3.5 w-3.5" /></button>
        </div>
        <div className="grid grid-cols-7 text-[9.5px] text-slate-400 text-center">{DOW.map((d) => <div key={d}>{d[0]}</div>)}</div>
        <div className="grid grid-cols-7 text-center">
          {Array.from({ length: 42 }, (_, i) => addDays(start, i)).map((d) => (
            <button key={keyOf(d)} type="button" onClick={() => { setAnchor(startOfDay(d)); if (view === "agenda") setView("day"); }} className={`h-6 text-[10.5px] rounded-full relative ${sameDay(d, today) ? "bg-sky-500 text-white font-bold" : sameDay(d, anchor) ? "bg-[var(--lanx-fill)] font-semibold" : d.getMonth() !== m.getMonth() ? "text-slate-300 dark:text-slate-600" : "text-slate-700 dark:text-slate-200"}`}>
              {d.getDate()}
              {busy.has(keyOf(d)) && !sameDay(d, today) && <span className="absolute left-1/2 -translate-x-1/2 bottom-0 h-1 w-1 rounded-full bg-sky-500" />}
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 lanx-scrim" onMouseDown={onClose}>
      <div data-calendar-panel className="w-full h-full max-w-[1400px] flex flex-col rounded-[22px] lanx-sheet overflow-hidden lanx-rise" onMouseDown={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b lanx-line flex-wrap">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-500 text-white"><CalendarDays className="h-4 w-4" /></span>
          <button type="button" data-cal-today onClick={() => setAnchor(today)} className="px-2.5 py-1 rounded-full lanx-group text-[12px] font-semibold text-slate-700 dark:text-slate-200">Today</button>
          <button type="button" data-cal-prev onClick={() => go(-1)} className="lanx-tool p-1 text-slate-500"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" data-cal-next onClick={() => go(1)} className="lanx-tool p-1 text-slate-500"><ChevronRight className="h-4 w-4" /></button>
          <h3 data-cal-title className="text-[15px] font-bold text-slate-900 dark:text-white min-w-[200px]">{title}</h3>
          <div className="ml-auto flex items-center gap-1 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input data-cal-search value={q} onChange={(e) => { setQ(e.target.value); if (e.target.value.trim()) setView("agenda"); }} placeholder="Search…" className="lanx-field w-40 rounded-full pl-7 pr-2 py-1 text-[12px] text-slate-900 dark:text-white" />
            </div>
            <div className="flex rounded-full lanx-group p-0.5">
              {(["month", "week", "day", "agenda"] as View[]).map((v) => (
                <button key={v} type="button" data-cal-view={v} onClick={() => setView(v)} className={`px-2.5 py-1 rounded-full text-[11.5px] font-semibold capitalize ${view === v ? "bg-sky-500 text-white" : "text-slate-600 dark:text-slate-300"}`}>{v}</button>
              ))}
            </div>
            <button type="button" data-cal-new onClick={() => { const at = new Date(); at.setMinutes(at.getMinutes() < 30 ? 30 : 60, 0, 0); setEditing(blank(secs(at))); }} className="px-3 py-1.5 rounded-full bg-sky-500 hover:bg-sky-600 text-white text-[12px] font-semibold inline-flex items-center gap-1"><Plus className="h-3.5 w-3.5" /> New event</button>
            <button type="button" title="Holidays" data-cal-holidays onClick={() => setHolidayEditor(true)} className="lanx-tool p-1.5 text-slate-500"><Settings2 className="h-4 w-4" /></button>
            <button type="button" title="Save the calendar as an .ics file (Outlook, Google, phone)" onClick={exportIcs} className="lanx-tool p-1.5 text-slate-500"><Download className="h-4 w-4" /></button>
            <button type="button" onClick={onClose} className="lanx-tool p-1 text-slate-400"><X className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex">
          <div className="w-[200px] shrink-0 border-r lanx-line p-2 space-y-2 overflow-y-auto hidden md:block">
            <MiniMonth />
            <div className="rounded-xl lanx-group p-2 space-y-1">
              {(Object.keys(KIND_STYLE) as (keyof typeof KIND_STYLE)[]).map((k) => (
                <label key={k} className="flex items-center gap-2 text-[11.5px] text-slate-700 dark:text-slate-200 cursor-pointer">
                  <input type="checkbox" checked={show[k]} onChange={(e) => setShow((s) => ({ ...s, [k]: e.target.checked }))} />
                  <span className={`h-2.5 w-2.5 rounded-full ${k === "event" ? "bg-sky-500" : k === "meeting" ? "bg-indigo-500" : k === "task" ? "bg-amber-500" : k === "birthday" ? "bg-pink-500" : "bg-rose-500"}`} />
                  {KIND_STYLE[k].label}
                </label>
              ))}
            </div>
            <div className="text-[10.5px] text-slate-400 px-1">Click a day or a time to add an event. Drag your events to move them; drag the bottom edge to change the end.</div>
          </div>
          <div ref={gridRef} className="flex-1 min-w-0 flex flex-col">
            {view === "month" && <MonthView />}
            {view === "week" && <TimeGrid days={Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i))} />}
            {view === "day" && <TimeGrid days={[anchor]} />}
            {view === "agenda" && <Agenda />}
          </div>
        </div>
      </div>

      {peek && !editing && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30" onMouseDown={() => setPeek(null)}>
          <div data-cal-peek className="w-[420px] max-w-[94vw] rounded-[18px] lanx-sheet p-4" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-2">
              <span className={`mt-1 h-3 w-3 rounded-full shrink-0 ${peek.kind === "event" ? colorFor(peek).dot : peek.kind === "meeting" ? "bg-indigo-500" : peek.kind === "task" ? "bg-amber-500" : peek.kind === "birthday" ? "bg-pink-500" : "bg-rose-500"}`} />
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-bold text-slate-900 dark:text-white">{peek.title}</div>
                <div className="text-[12px] text-slate-500">{fmtRange(peek)}</div>
                {peek.subtitle && <div className="text-[12px] text-slate-500">{peek.subtitle}</div>}
                {peek.occ?.event.details && <div className="mt-2 text-[12.5px] text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{peek.occ.event.details}</div>}
                {peek.occ && peek.occ.event.repeat !== "none" && <div className="mt-1 text-[11px] text-slate-400">{REPEATS.find((r) => r.id === peek.occ!.event.repeat)?.label}{peek.occ.event.repeat_until ? ` until ${toDate(peek.occ.event.repeat_until).toLocaleDateString("en-GB")}` : ""}</div>}
                {peek.kind === "meeting" && <div className="mt-1 text-[11px] text-slate-400">A meeting from the Organiser (in {peek.card?.chat})</div>}
                {peek.kind === "task" && <div className="mt-1 text-[11px] text-slate-400">A task deadline from the Organiser</div>}
              </div>
              <button type="button" onClick={() => setPeek(null)} className="lanx-tool p-1 text-slate-400"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5 justify-end text-[12px] font-semibold">
              {peek.card && <button type="button" data-cal-open-card onClick={() => { onOpenCard(peek.card!.conversationId, peek.card!.messageId); onClose(); }} className="px-3 py-1.5 rounded-full bg-sky-500 hover:bg-sky-600 text-white">Open in chat</button>}
              {peek.kind === "holiday" && <button type="button" onClick={() => { setPeek(null); setHolidayEditor(true); }} className="px-3 py-1.5 rounded-full lanx-group text-slate-700 dark:text-slate-200">Edit holidays…</button>}
              <button type="button" onClick={() => onSendText(eventText(peek))} className="px-3 py-1.5 rounded-full lanx-group text-slate-700 dark:text-slate-200 inline-flex items-center gap-1"><Send className="h-3.5 w-3.5" /> Send to chat</button>
              <button type="button" onClick={() => api.shareWhatsApp({ text: eventText(peek) }).catch((e) => onError(errorText(e)))} className="px-3 py-1.5 rounded-full lanx-group text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</button>
              {peek.occ && (
                <>
                  <button type="button" data-cal-edit onClick={() => { setEditing(peek.occ!.event); }} className="px-3 py-1.5 rounded-full bg-slate-700 hover:bg-slate-800 text-white">Edit</button>
                  <button type="button" data-cal-delete onClick={() => deleteEvent(peek.occ!.event.id)} className="px-3 py-1.5 rounded-full text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 inline-flex items-center gap-1"><Trash2 className="h-3.5 w-3.5" /> Delete{peek.occ.event.repeat !== "none" ? " series" : ""}</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {editing && (
        <EventDialog
          event={editing}
          onClose={() => setEditing(null)}
          onSave={saveEvent}
          onDelete={editing.id ? () => deleteEvent(editing.id) : undefined}
          onInvite={(e) => {
            onInvite({ title: e.title || "Meeting", start: e.start, minutes: Math.max(15, Math.round((e.end - e.start) / 60)), place: e.location, agenda: e.details });
            setEditing(null);
            onClose();
          }}
        />
      )}

      {holidayEditor && <HolidayEditor holidays={holidays} onClose={() => setHolidayEditor(false)} onSave={saveHolidays} />}
      <span className="hidden"><Users className="h-3 w-3" /></span>
    </div>
  );
}

function EventDialog({ event, onClose, onSave, onDelete, onInvite }: { event: CalendarEvent; onClose: () => void; onSave: (e: CalendarEvent) => void; onDelete?: () => void; onInvite: (e: CalendarEvent) => void }) {
  const [e, setE] = useState<CalendarEvent>(event);
  const set = (p: Partial<CalendarEvent>) => setE((x) => ({ ...x, ...p }));
  const untilInput = e.repeat_until ? toLocalInput(e.repeat_until).slice(0, 10) : "";
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30" onMouseDown={onClose}>
      <div data-event-dialog className="w-[520px] max-w-[94vw] max-h-[92vh] overflow-y-auto rounded-[18px] lanx-sheet p-4 space-y-3" onMouseDown={(ev) => ev.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="text-[15px] font-bold text-slate-900 dark:text-white">{event.id ? "Edit event" : "New event"}</div>
          <button type="button" onClick={onClose} className="lanx-tool p-1 text-slate-400"><X className="h-4 w-4" /></button>
        </div>
        <input autoFocus data-event-title value={e.title} onChange={(ev) => set({ title: ev.target.value })} placeholder="What is it?" className="lanx-field w-full rounded-[10px] px-3 py-2 text-[15px] font-semibold text-slate-900 dark:text-white" onKeyDown={(ev) => ev.key === "Enter" && e.title.trim() && onSave(e)} />
        <label className="inline-flex items-center gap-2 text-[12.5px] text-slate-700 dark:text-slate-200"><input type="checkbox" data-event-allday checked={e.all_day} onChange={(ev) => set({ all_day: ev.target.checked })} /> All day</label>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[11px] font-semibold text-slate-500">Starts</label>
            <input type={e.all_day ? "date" : "datetime-local"} data-event-start value={e.all_day ? toLocalInput(e.start).slice(0, 10) : toLocalInput(e.start)} onChange={(ev) => { const s = fromLocalInput(e.all_day ? `${ev.target.value}T00:00` : ev.target.value); set({ start: s, end: Math.max(s + (e.all_day ? DAY : 1800), e.end + (s - e.start)) }); }} className="lanx-field mt-0.5 w-full rounded-[10px] px-2 py-1.5 text-[12.5px] text-slate-900 dark:text-white" />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-slate-500">Ends</label>
            <input type={e.all_day ? "date" : "datetime-local"} data-event-end value={e.all_day ? toLocalInput(Math.max(e.start, e.end - 1)).slice(0, 10) : toLocalInput(e.end)} onChange={(ev) => set({ end: e.all_day ? fromLocalInput(`${ev.target.value}T00:00`) + DAY : fromLocalInput(ev.target.value) })} className="lanx-field mt-0.5 w-full rounded-[10px] px-2 py-1.5 text-[12.5px] text-slate-900 dark:text-white" />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-slate-500">Repeat</label>
            <select data-event-repeat value={e.repeat} onChange={(ev) => set({ repeat: ev.target.value as CalendarEvent["repeat"] })} className="lanx-field mt-0.5 w-full rounded-[10px] px-2 py-1.5 text-[12.5px] text-slate-900 dark:text-white">
              {REPEATS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-slate-500">{e.repeat === "none" ? "Reminder" : "Repeat until"}</label>
            {e.repeat === "none" ? (
              <select data-event-reminder value={e.reminder_mins ?? ""} onChange={(ev) => set({ reminder_mins: ev.target.value === "" ? null : Number(ev.target.value) })} className="lanx-field mt-0.5 w-full rounded-[10px] px-2 py-1.5 text-[12.5px] text-slate-900 dark:text-white">
                {REMINDERS.map((r) => <option key={String(r.mins)} value={r.mins ?? ""}>{r.label}</option>)}
              </select>
            ) : (
              <input type="date" value={untilInput} onChange={(ev) => set({ repeat_until: ev.target.value ? fromLocalInput(`${ev.target.value}T12:00`) : null })} className="lanx-field mt-0.5 w-full rounded-[10px] px-2 py-1.5 text-[12.5px] text-slate-900 dark:text-white" />
            )}
          </div>
          {e.repeat !== "none" && (
            <div className="col-span-2">
              <label className="text-[11px] font-semibold text-slate-500">Reminder</label>
              <select value={e.reminder_mins ?? ""} onChange={(ev) => set({ reminder_mins: ev.target.value === "" ? null : Number(ev.target.value) })} className="lanx-field mt-0.5 w-full rounded-[10px] px-2 py-1.5 text-[12.5px] text-slate-900 dark:text-white">
                {REMINDERS.map((r) => <option key={String(r.mins)} value={r.mins ?? ""}>{r.label}</option>)}
              </select>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold text-slate-500 mr-1">Colour</span>
          {EVENT_COLORS.map((c) => (
            <button key={c.id} type="button" data-event-color={c.id} title={c.name} onClick={() => set({ color: c.id })} className={`h-5 w-5 rounded-full ${c.dot} ${e.color === c.id ? "ring-2 ring-offset-1 ring-slate-500 dark:ring-offset-slate-900" : "opacity-70 hover:opacity-100"}`} />
          ))}
        </div>
        <input data-event-location value={e.location} onChange={(ev) => set({ location: ev.target.value })} placeholder="Where (optional)" className="lanx-field w-full rounded-[10px] px-3 py-1.5 text-[12.5px] text-slate-900 dark:text-white" />
        <textarea data-event-details value={e.details} onChange={(ev) => set({ details: ev.target.value })} placeholder="Notes (optional)" rows={3} className="lanx-field w-full rounded-[10px] px-3 py-1.5 text-[12.5px] text-slate-900 dark:text-white resize-none" />
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" data-event-invite onClick={() => onInvite(e)} className="px-3 py-1.5 rounded-full lanx-group text-[12px] font-semibold text-indigo-700 dark:text-indigo-300 inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> Invite colleagues…</button>
          <span className="text-[10.5px] text-slate-400">Makes it a meeting in a chat: they get an invite and a reminder.</span>
          <div className="ml-auto flex items-center gap-1.5">
            {onDelete && <button type="button" onClick={onDelete} className="px-3 py-1.5 rounded-full text-[12px] font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">Delete</button>}
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-full text-[12px] font-semibold text-slate-600 dark:text-slate-300">Cancel</button>
            <button type="button" data-event-save disabled={!e.title.trim()} onClick={() => onSave(e)} className="px-4 py-1.5 rounded-full bg-sky-500 hover:bg-sky-600 disabled:opacity-40 text-white text-[12px] font-semibold">Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function HolidayEditor({ holidays, onClose, onSave }: { holidays: Holiday[]; onClose: () => void; onSave: (h: Holiday[]) => void }) {
  const [list, setList] = useState<Holiday[]>(holidays);
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const year = new Date().getFullYear();
  const add = () => {
    if (!date || !name.trim()) return;
    setList((l) => [...l.filter((h) => !(h.date === date && h.name === name.trim())), { date, name: name.trim() }].sort((a, b) => a.date.localeCompare(b.date)));
    setName("");
  };
  const preset = (y: number) => setList((l) => {
    const have = new Set(l.map((h) => h.date + h.name));
    return [...l, ...nationalHolidays(y).filter((h) => !have.has(h.date + h.name))].sort((a, b) => a.date.localeCompare(b.date));
  });
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30" onMouseDown={onClose}>
      <div data-holiday-editor className="w-[480px] max-w-[94vw] max-h-[90vh] flex flex-col rounded-[18px] lanx-sheet p-4" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[15px] font-bold text-slate-900 dark:text-white">Holidays</div>
          <button type="button" onClick={onClose} className="lanx-tool p-1 text-slate-400"><X className="h-4 w-4" /></button>
        </div>
        <div className="text-[11.5px] text-slate-500 mb-2">Your office's holidays, shown on the calendar. Festivals change date each year, so add them yourself.</div>
        <div className="flex gap-1.5 mb-2">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="lanx-field rounded-[10px] px-2 py-1.5 text-[12.5px] text-slate-900 dark:text-white" />
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Name, e.g. Diwali" className="lanx-field flex-1 rounded-[10px] px-2 py-1.5 text-[12.5px] text-slate-900 dark:text-white" />
          <button type="button" onClick={add} className="px-3 py-1.5 rounded-full bg-sky-500 text-white text-[12px] font-semibold">Add</button>
        </div>
        <div className="flex gap-1.5 mb-2 text-[11.5px]">
          <button type="button" onClick={() => preset(year)} className="px-2.5 py-1 rounded-full lanx-group text-slate-700 dark:text-slate-200">Add national holidays {year}</button>
          <button type="button" onClick={() => preset(year + 1)} className="px-2.5 py-1 rounded-full lanx-group text-slate-700 dark:text-slate-200">…and {year + 1}</button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto rounded-xl lanx-group divide-y lanx-line">
          {!list.length && <div className="p-4 text-center text-[12px] text-slate-400">No holidays yet.</div>}
          {list.map((h, i) => (
            <div key={`${h.date}-${h.name}-${i}`} className="flex items-center gap-2 px-3 py-1.5 text-[12.5px]">
              <span className="w-24 text-slate-500">{new Date(h.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
              <span className="flex-1 text-slate-800 dark:text-slate-100">{h.name}</span>
              <button type="button" onClick={() => setList((l) => l.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-500"><X className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-full text-[12px] font-semibold text-slate-600 dark:text-slate-300">Cancel</button>
          <button type="button" data-holiday-save onClick={() => { onSave(list); onClose(); }} className="px-4 py-1.5 rounded-full bg-sky-500 hover:bg-sky-600 text-white text-[12px] font-semibold">Save</button>
        </div>
      </div>
    </div>
  );
}
