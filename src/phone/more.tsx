/** LANX 3.2 phone page: the "More" tab — cards, notes, calendar, status and
 *  profile, kudos, end-of-day reports, emergency alerts, the secure
 *  connection and alerts, a person's details. */
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BellRing, CalendarDays, ClipboardList, Gamepad2, Info, Mail, Phone, Plus, Shield, Smile, StickyNote, Trash2, Trophy, UserCircle, X } from "lucide-react";
import type { AlertInfo, CalendarEvent, Note, Occurrence, Peer, Profile } from "../types";
import { Avatar } from "../components/Avatar";
import { CardView } from "../components/org/CardView";
import { needsMe } from "../components/org/cardModel";
import { localInputValue, whenText } from "../components/chat/chatUtils";
import { ALERT_KINDS, KUDOS_BADGES, alertKind, needsAnswer, stillOn } from "../lib/office";
import { CHARACTERS, CLEAR_AFTER, EMPTY_PROFILE, STATUS_PRESETS, cropToAvatar, roleLine, statusLine } from "../lib/profile";
import type { PhoneSettings } from "./bridge";
import type { Hit, Me, PhoneClient } from "./client";
import { Sheet, SheetRow, dayLabel, timeOf, whenShort } from "./parts";

const secsOf = (value: string): number | null => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : Math.floor(d.getTime() / 1000);
};

const field = "w-full rounded-xl lanx-field px-3.5 py-2.5 text-[15px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500 dark:text-white";
const label = "mb-1 block text-[11.5px] font-semibold text-slate-500 dark:text-slate-400";
const primary = "rounded-full bg-sky-500 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40";
const plain = "rounded-full lanx-group px-4 py-2 text-[13px] font-semibold text-slate-700 dark:text-slate-200";

// --------------------------------------------------------------------- more

export type MoreKey = "cards" | "notes" | "calendar" | "games" | "kudos" | "report" | "emergency" | "status" | "profile" | "secure" | "about";

export function MoreScreen({ forMe, alertsLive, secure, onOpen }: { forMe: number; alertsLive: number; secure: boolean; onOpen: (key: MoreKey) => void }) {
  const items: { key: MoreKey; icon: React.ReactNode; label: string; hint?: string; badge?: number; tint: string }[] = [
    { key: "cards", icon: <ClipboardList className="h-5 w-5" />, label: "Cards", hint: "Notices, polls, tasks, approvals…", badge: forMe, tint: "#8b5cf6" },
    { key: "notes", icon: <StickyNote className="h-5 w-5" />, label: "Notes", tint: "#f59e0b" },
    { key: "calendar", icon: <CalendarDays className="h-5 w-5" />, label: "Calendar", tint: "#0ea5e9" },
    { key: "games", icon: <Gamepad2 className="h-5 w-5" />, label: "Games", hint: "Play with colleagues", tint: "#4f46e5" },
    { key: "kudos", icon: <Trophy className="h-5 w-5" />, label: "Send kudos", tint: "#eab308" },
    { key: "report", icon: <ClipboardList className="h-5 w-5" />, label: "End-of-day report", tint: "#14b8a6" },
    { key: "emergency", icon: <BellRing className="h-5 w-5" />, label: "Emergency", hint: alertsLive ? `${alertsLive} alert${alertsLive > 1 ? "s" : ""} going on` : undefined, badge: alertsLive, tint: "#ef4444" },
    { key: "status", icon: <Smile className="h-5 w-5" />, label: "My status", hint: "Available, busy, out of office…", tint: "#22c55e" },
    { key: "profile", icon: <UserCircle className="h-5 w-5" />, label: "My profile", tint: "#64748b" },
    { key: "secure", icon: <Shield className="h-5 w-5" />, label: "Secure connection & alerts", hint: secure ? "Secure ✓" : "Voice notes and alerts need this", tint: secure ? "#22c55e" : "#f97316" },
    { key: "about", icon: <Info className="h-5 w-5" />, label: "This phone", tint: "#94a3b8" },
  ];
  return (
    <>
      <header className="shrink-0 px-4 py-3 lanx-bar border-b lanx-line">
        <div className="text-[18px] font-bold tracking-[-0.02em] text-slate-900 dark:text-white">More</div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400">Everything else from your PC</div>
      </header>
      <div className="ph-scroll px-3 py-3" data-ph-more>
        <div className="space-y-1">
          {items.map((it) => (
            <button key={it.key} type="button" data-ph-more-item={it.key} onClick={() => onOpen(it.key)} className="flex w-full items-center gap-3 rounded-[14px] px-2.5 py-2.5 text-left active:bg-[var(--lanx-fill)]">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: it.tint }}>
                {it.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-semibold text-slate-900 dark:text-white">{it.label}</span>
                {it.hint && <span className="block truncate text-[11.5px] text-slate-500 dark:text-slate-400">{it.hint}</span>}
              </span>
              {!!it.badge && <span className="min-w-[20px] rounded-full bg-rose-500 px-1.5 py-[2px] text-center text-[10.5px] font-bold text-white">{it.badge}</span>}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function Header({ title, onBack, right }: { title: string; onBack: () => void; right?: React.ReactNode }) {
  return (
    <header className="flex shrink-0 items-center gap-2 px-2 py-2 lanx-bar border-b lanx-line">
      <button type="button" data-ph-back onClick={onBack} className="lanx-tool p-2 text-sky-600 dark:text-sky-400" aria-label="Back">
        <ArrowLeft className="h-5 w-5" />
      </button>
      <div className="min-w-0 flex-1 truncate text-[15px] font-semibold text-slate-900 dark:text-white">{title}</div>
      {right}
    </header>
  );
}

// -------------------------------------------------------------------- cards

export function CardsScreen({
  me,
  hits,
  loading,
  nameOf,
  chatName,
  onBack,
  onChanged,
  onError,
  onNew,
}: {
  me: Me;
  hits: Hit[];
  loading: boolean;
  nameOf: (id: string) => string;
  chatName: (conversationId: string) => string;
  onBack: () => void;
  onChanged: (m: Hit["message"]) => void;
  onError: (t: string) => void;
  onNew: () => void;
}) {
  const mine = hits.filter((h) => needsMe(h.message, me.id));
  const rest = hits.filter((h) => !needsMe(h.message, me.id));
  const section = (title: string, of: Hit[], hook: string) =>
    of.length === 0 ? null : (
      <div key={hook} data-ph-cards-group={hook}>
        <div className="mb-1 px-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
          {title} · {of.length}
        </div>
        <div className="space-y-2">
          {of.map((h) => (
            <div key={h.message.id} data-ph-card={h.message.id} className="rounded-[16px] lanx-card p-2.5">
              <div className="mb-1 flex items-center justify-between text-[10.5px] text-slate-400">
                <span className="truncate">
                  in {chatName(h.message.conversation_id)} · {h.message.is_outgoing ? "you" : nameOf(h.message.sender_id)}
                </span>
                <span>{whenShort(h.message.timestamp)}</span>
              </div>
              <CardView msg={h.message} myId={me.id} nameOf={nameOf} onChanged={(m) => onChanged(m as Hit["message"])} onError={onError} canAct />
            </div>
          ))}
        </div>
      </div>
    );
  return (
    <>
      <Header
        title="Cards"
        onBack={onBack}
        right={
          <button type="button" data-ph-card-new onClick={onNew} className="lanx-tool p-2 text-sky-600 dark:text-sky-400" aria-label="New card">
            <Plus className="h-5 w-5" />
          </button>
        }
      />
      <div className="ph-scroll px-3 py-3 space-y-4" data-ph-cards={hits.length}>
        {loading && <div className="px-4 py-10 text-center text-[13px] text-slate-400">Loading…</div>}
        {!loading && hits.length === 0 && <div className="px-4 py-10 text-center text-[13px] text-slate-400">No cards yet. Tap + to make one.</div>}
        {section("Needs you", mine, "mine")}
        {section("All cards", rest, "all")}
      </div>
    </>
  );
}

// -------------------------------------------------------------------- notes

const emptyNote = (): Note => ({ id: "", title: "", body: "", kind: "note", color: "default", pinned: false, audio: [], created_at: 0, updated_at: 0, deleted_at: null });

export function NotesScreen({ client, onBack, onError }: { client: PhoneClient; onBack: () => void; onError: (t: string) => void }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [deleted, setDeleted] = useState(false);
  const [editing, setEditing] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);
  const load = (bin = deleted) => {
    setLoading(true);
    client
      .request<{ notes: Note[] }>("notes", { deleted: bin })
      .then((r) => setNotes(r.notes))
      .catch((e: Error) => onError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => load(deleted), [deleted]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = (n: Note) =>
    client
      .request<{ note: Note }>("note_save", { note: n })
      .then(() => {
        setEditing(null);
        load();
      })
      .catch((e: Error) => onError(e.message));
  const remove = (id: string, forGood: boolean) =>
    client
      .request("note_delete", { note_id: id, for_good: forGood })
      .then(() => {
        setEditing(null);
        load();
      })
      .catch((e: Error) => onError(e.message));
  const restore = (id: string) =>
    client
      .request("note_restore", { note_id: id })
      .then(() => load())
      .catch((e: Error) => onError(e.message));
  return (
    <>
      <Header
        title={deleted ? "Deleted notes" : "Notes"}
        onBack={onBack}
        right={
          <>
            <button type="button" data-ph-notes-bin onClick={() => setDeleted((d) => !d)} className={`lanx-tool p-2 ${deleted ? "text-sky-600" : "text-slate-500"}`} aria-label="Deleted notes">
              <Trash2 className="h-5 w-5" />
            </button>
            {!deleted && (
              <button type="button" data-ph-note-new onClick={() => setEditing(emptyNote())} className="lanx-tool p-2 text-sky-600 dark:text-sky-400" aria-label="New note">
                <Plus className="h-5 w-5" />
              </button>
            )}
          </>
        }
      />
      <div className="ph-scroll px-3 py-3" data-ph-notes={notes.length}>
        {loading && <div className="px-4 py-10 text-center text-[13px] text-slate-400">Loading…</div>}
        {!loading && notes.length === 0 && <div className="px-4 py-10 text-center text-[13px] text-slate-400">{deleted ? "Nothing in the bin." : "No notes yet. Tap + to write one."}</div>}
        <div className="space-y-1.5">
          {notes.map((n) => (
            <button key={n.id} type="button" data-ph-note={n.id} onClick={() => (deleted ? restore(n.id) : setEditing(n))} className="w-full rounded-[14px] lanx-card px-3 py-2.5 text-left active:bg-[var(--lanx-fill)]">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[14px] font-semibold text-slate-900 dark:text-white">{n.title || n.body.split("\n")[0] || "Untitled"}</span>
                <span className="shrink-0 text-[10.5px] text-slate-400">{whenShort(n.updated_at || n.created_at)}</span>
              </div>
              <div className="line-clamp-2 text-[12.5px] text-slate-500 dark:text-slate-400">{deleted ? "Tap to restore" : n.body}</div>
            </button>
          ))}
        </div>
      </div>
      {editing && (
        <Sheet title={editing.id ? "Note" : "New note"} onClose={() => setEditing(null)} hook="note">
          <input data-ph-note-title value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="Title" className={`${field} mb-2`} />
          <textarea data-ph-note-body value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} placeholder="Write here… (start a line with [ ] for a tick box)" rows={8} className={`${field} ph-select resize-none`} />
          <div className="mt-3 flex items-center justify-between gap-2">
            {editing.id ? (
              <button type="button" data-ph-note-delete onClick={() => remove(editing.id, false)} className="rounded-full px-3 py-2 text-[12.5px] font-semibold text-rose-600 dark:text-rose-400">
                Delete
              </button>
            ) : (
              <span />
            )}
            <button type="button" data-ph-note-save disabled={!editing.title.trim() && !editing.body.trim()} onClick={() => save(editing)} className={primary}>
              Save
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}

// ----------------------------------------------------------------- calendar

const blankEvent = (): CalendarEvent => {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const s = Math.floor(start.getTime() / 1000);
  return { id: "", title: "", details: "", location: "", start: s, end: s + 3600, all_day: false, color: "sky", repeat: "none", repeat_until: null, reminder_mins: 15, created_at: 0, updated_at: 0 };
};

export function CalendarScreen({ client, onBack, onError, version }: { client: PhoneClient; onBack: () => void; onError: (t: string) => void; version: number }) {
  const [items, setItems] = useState<Occurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const load = () => {
    const now = Math.floor(Date.now() / 1000);
    const from = now - 6 * 3600;
    setLoading(true);
    client
      .request<{ occurrences: Occurrence[] }>("events", { from, to: now + 60 * 86400 })
      .then((r) => setItems([...r.occurrences].sort((a, b) => a.start - b.start)))
      .catch((e: Error) => onError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = (e: CalendarEvent) =>
    client
      .request<{ event: CalendarEvent }>("event_save", { event: e })
      .then(() => {
        setEditing(null);
        load();
      })
      .catch((err: Error) => onError(err.message));
  const remove = (id: string) =>
    client
      .request("event_delete", { event_id: id })
      .then(() => {
        setEditing(null);
        load();
      })
      .catch((err: Error) => onError(err.message));
  let lastDay = "";
  return (
    <>
      <Header
        title="Calendar"
        onBack={onBack}
        right={
          <button type="button" data-ph-event-new onClick={() => setEditing(blankEvent())} className="lanx-tool p-2 text-sky-600 dark:text-sky-400" aria-label="New event">
            <Plus className="h-5 w-5" />
          </button>
        }
      />
      <div className="ph-scroll px-3 py-3" data-ph-calendar={items.length}>
        {loading && <div className="px-4 py-10 text-center text-[13px] text-slate-400">Loading…</div>}
        {!loading && items.length === 0 && <div className="px-4 py-10 text-center text-[13px] text-slate-400">Nothing in the next 60 days. Tap + to add an event.</div>}
        {items.map((o) => {
          const day = dayLabel(o.start);
          const sep = day !== lastDay;
          lastDay = day;
          return (
            <div key={`${o.event.id}-${o.start}`}>
              {sep && <div className="mb-1 mt-3 px-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">{day}</div>}
              <button type="button" data-ph-event={o.event.id} onClick={() => setEditing(o.event)} className="mb-1.5 flex w-full items-center gap-3 rounded-[14px] lanx-card px-3 py-2.5 text-left active:bg-[var(--lanx-fill)]">
                <span className="w-[62px] shrink-0 text-[12px] font-semibold text-sky-600 dark:text-sky-400">{o.event.all_day ? "All day" : timeOf(o.start)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-slate-900 dark:text-white">{o.event.title || "Untitled"}</span>
                  {(o.event.location || !o.event.all_day) && (
                    <span className="block truncate text-[11.5px] text-slate-500 dark:text-slate-400">
                      {!o.event.all_day ? `until ${timeOf(o.end)}` : ""}
                      {o.event.location ? `${!o.event.all_day ? " · " : ""}${o.event.location}` : ""}
                    </span>
                  )}
                </span>
              </button>
            </div>
          );
        })}
      </div>
      {editing && <EventSheet event={editing} onClose={() => setEditing(null)} onSave={save} onDelete={editing.id ? () => remove(editing.id) : undefined} />}
    </>
  );
}

function EventSheet({ event, onClose, onSave, onDelete }: { event: CalendarEvent; onClose: () => void; onSave: (e: CalendarEvent) => void; onDelete?: () => void }) {
  const [e, setE] = useState<CalendarEvent>(event);
  const dateOnly = (ts: number) => localInputValue(ts).slice(0, 10);
  return (
    <Sheet title={event.id ? "Event" : "New event"} onClose={onClose} hook="event">
      <input data-ph-event-title value={e.title} onChange={(x) => setE({ ...e, title: x.target.value })} placeholder="Title" className={`${field} mb-2`} />
      <label className="mb-2 flex items-center gap-2 px-1 text-[13px] text-slate-700 dark:text-slate-200">
        <input type="checkbox" checked={e.all_day} onChange={(x) => setE({ ...e, all_day: x.target.checked })} data-ph-event-allday /> All day
      </label>
      <div className="mb-2 grid grid-cols-2 gap-2">
        <div>
          <span className={label}>Starts</span>
          <input
            type={e.all_day ? "date" : "datetime-local"}
            data-ph-event-start
            value={e.all_day ? dateOnly(e.start) : localInputValue(e.start)}
            onChange={(x) => {
              const s = secsOf(x.target.value);
              if (s !== null) setE({ ...e, start: s, end: Math.max(s + (e.all_day ? 0 : 1800), e.end > s ? e.end : s + 3600) });
            }}
            className={field}
          />
        </div>
        <div>
          <span className={label}>Ends</span>
          <input
            type={e.all_day ? "date" : "datetime-local"}
            data-ph-event-end
            value={e.all_day ? dateOnly(e.end) : localInputValue(e.end)}
            onChange={(x) => {
              const s = secsOf(x.target.value);
              if (s !== null) setE({ ...e, end: s });
            }}
            className={field}
          />
        </div>
      </div>
      <input data-ph-event-location value={e.location} onChange={(x) => setE({ ...e, location: x.target.value })} placeholder="Where" className={`${field} mb-2`} />
      <textarea data-ph-event-details value={e.details} onChange={(x) => setE({ ...e, details: x.target.value })} placeholder="Details" rows={3} className={`${field} ph-select mb-2 resize-none`} />
      <div className="mb-3 grid grid-cols-2 gap-2">
        <div>
          <span className={label}>Repeat</span>
          <select data-ph-event-repeat value={e.repeat} onChange={(x) => setE({ ...e, repeat: x.target.value as CalendarEvent["repeat"] })} className={field}>
            <option value="none">Never</option>
            <option value="daily">Every day</option>
            <option value="weekly">Every week</option>
            <option value="monthly">Every month</option>
            <option value="yearly">Every year</option>
          </select>
        </div>
        <div>
          <span className={label}>Remind me</span>
          <select data-ph-event-remind value={e.reminder_mins ?? -1} onChange={(x) => setE({ ...e, reminder_mins: Number(x.target.value) < 0 ? null : Number(x.target.value) })} className={field}>
            <option value={-1}>No reminder</option>
            <option value={0}>At the time</option>
            <option value={5}>5 minutes before</option>
            <option value={15}>15 minutes before</option>
            <option value={30}>30 minutes before</option>
            <option value={60}>1 hour before</option>
            <option value={1440}>1 day before</option>
          </select>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        {onDelete ? (
          <button type="button" data-ph-event-delete onClick={onDelete} className="rounded-full px-3 py-2 text-[12.5px] font-semibold text-rose-600 dark:text-rose-400">
            Delete
          </button>
        ) : (
          <span />
        )}
        <button type="button" data-ph-event-save disabled={!e.title.trim() || e.end < e.start} onClick={() => onSave(e)} className={primary}>
          Save
        </button>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------ status, profile

export function StatusSheet({
  settings,
  onClose,
  onSaveStatus,
  onSaveOoo,
}: {
  settings: PhoneSettings;
  onClose: () => void;
  onSaveStatus: (status: string, text: string, until: number) => Promise<void>;
  onSaveOoo: (enabled: boolean, until: number, message: string) => Promise<void>;
}) {
  const p = settings.profile ?? EMPTY_PROFILE;
  const [status, setStatus] = useState(p.status);
  const [text, setText] = useState(p.status_text);
  const [clear, setClear] = useState("never");
  const ooo = settings.out_of_office ?? { enabled: false, until: 0, message: "" };
  const [oooOn, setOooOn] = useState(ooo.enabled);
  const [oooMsg, setOooMsg] = useState(ooo.message || "I'm away and will reply when I'm back.");
  const [oooUntil, setOooUntil] = useState(ooo.until ? localInputValue(ooo.until) : "");
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    try {
      await f();
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="My status" onClose={onClose} hook="status">
      <div className="grid grid-cols-2 gap-1.5" data-ph-status-presets>
        {STATUS_PRESETS.map((s) => (
          <button key={s.id} type="button" data-ph-status-pick={s.id} aria-pressed={status === s.id} onClick={() => setStatus(status === s.id ? "" : s.id)} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] ${status === s.id ? "bg-sky-500/15 ring-1 ring-sky-500" : "lanx-card"}`}>
            <span>{s.emoji}</span>
            <span className="text-slate-800 dark:text-slate-100">{s.label}</span>
          </button>
        ))}
      </div>
      <input data-ph-status-text value={text} onChange={(e) => setText(e.target.value)} placeholder="Say more (optional)" className={`${field} mt-2`} maxLength={80} />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {CLEAR_AFTER.map((c) => (
          <button key={c.id} type="button" aria-pressed={clear === c.id} onClick={() => setClear(c.id)} className={`rounded-full px-3 py-1 text-[12px] font-semibold ${clear === c.id ? "bg-sky-500 text-white" : "lanx-group text-slate-700 dark:text-slate-200"}`}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" data-ph-status-clear disabled={busy} onClick={() => run(() => onSaveStatus("", "", 0))} className={plain}>
          Clear status
        </button>
        <button type="button" data-ph-status-save disabled={busy} onClick={() => run(() => onSaveStatus(status, text, CLEAR_AFTER.find((c) => c.id === clear)?.until() ?? 0))} className={primary}>
          Save
        </button>
      </div>
      <div className="mt-4 border-t lanx-line pt-3">
        <label className="flex items-center justify-between gap-3 text-[14px] font-semibold text-slate-900 dark:text-white">
          Out of office
          <input type="checkbox" checked={oooOn} onChange={(e) => setOooOn(e.target.checked)} data-ph-ooo-toggle />
        </label>
        {oooOn && (
          <>
            <textarea data-ph-ooo-message value={oooMsg} onChange={(e) => setOooMsg(e.target.value)} rows={2} className={`${field} ph-select mt-2 resize-none`} />
            <span className={`${label} mt-2`}>Until (optional)</span>
            <input type="datetime-local" data-ph-ooo-until value={oooUntil} onChange={(e) => setOooUntil(e.target.value)} className={field} />
          </>
        )}
        <div className="mt-2 flex justify-end">
          <button type="button" data-ph-ooo-save disabled={busy} onClick={() => run(() => onSaveOoo(oooOn, oooUntil ? secsOf(oooUntil) ?? 0 : 0, oooMsg))} className={plain}>
            Save out of office
          </button>
        </div>
      </div>
    </Sheet>
  );
}

export function ProfileSheet({ me, settings, onClose, onSave }: { me: Me; settings: PhoneSettings; onClose: () => void; onSave: (p: Profile) => Promise<void> }) {
  const [p, setP] = useState<Profile>({ ...EMPTY_PROFILE, ...(settings.profile ?? {}) });
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"initials" | "character" | "photo">(p.avatar === "photo" ? "photo" : p.avatar.startsWith("emoji:") ? "character" : "initials");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pickPhoto = async (file: File) => {
    const src = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("Could not read the picture"));
      r.readAsDataURL(file);
    });
    const photo = await cropToAvatar(src, 1, 0, 0);
    setP({ ...p, avatar: "photo", photo });
    setMode("photo");
  };
  const set = (patch: Partial<Profile>) => setP({ ...p, ...patch });
  return (
    <Sheet title="My profile" onClose={onClose} hook="profile">
      <div className="flex items-center gap-3">
        <Avatar name={me.name} color={me.color} profile={p} size={56} />
        <div className="flex flex-wrap gap-1.5">
          <button type="button" data-ph-avatar-initials onClick={() => { setMode("initials"); set({ avatar: "initials" }); }} className={`rounded-full px-3 py-1 text-[12px] font-semibold ${mode === "initials" ? "bg-sky-500 text-white" : "lanx-group"}`}>
            Initials
          </button>
          <button type="button" data-ph-avatar-character onClick={() => setMode("character")} className={`rounded-full px-3 py-1 text-[12px] font-semibold ${mode === "character" ? "bg-sky-500 text-white" : "lanx-group"}`}>
            Character
          </button>
          <button type="button" data-ph-avatar-photo onClick={() => fileRef.current?.click()} className={`rounded-full px-3 py-1 text-[12px] font-semibold ${mode === "photo" ? "bg-sky-500 text-white" : "lanx-group"}`}>
            Photo…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            data-ph-avatar-file
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void pickPhoto(f).catch(() => {});
              e.target.value = "";
            }}
          />
        </div>
      </div>
      {mode === "character" && (
        <div className="mt-2 grid grid-cols-8 gap-1" data-ph-characters>
          {CHARACTERS.map((c) => (
            <button key={c} type="button" data-ph-character={c} onClick={() => set({ avatar: `emoji:${c}` })} className={`rounded-lg py-1 text-[22px] ${p.avatar === `emoji:${c}` ? "bg-sky-500/20 ring-1 ring-sky-500" : ""}`}>
              {c}
            </button>
          ))}
        </div>
      )}
      <div className="mt-3 space-y-2">
        <input data-ph-profile-title value={p.title} onChange={(e) => set({ title: e.target.value })} placeholder="Job title" className={field} maxLength={60} />
        <input data-ph-profile-department value={p.department} onChange={(e) => set({ department: e.target.value })} placeholder="Department" className={field} maxLength={60} />
        <input data-ph-profile-phone value={p.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="Phone" inputMode="tel" className={field} maxLength={40} />
        <input data-ph-profile-email value={p.email} onChange={(e) => set({ email: e.target.value })} placeholder="Email" inputMode="email" className={field} maxLength={80} />
        <textarea data-ph-profile-bio value={p.bio} onChange={(e) => set({ bio: e.target.value })} placeholder="About me" rows={2} className={`${field} ph-select resize-none`} maxLength={300} />
      </div>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          data-ph-profile-save
          disabled={busy}
          onClick={() => {
            setBusy(true);
            onSave(p)
              .then(onClose)
              .finally(() => setBusy(false));
          }}
          className={primary}
        >
          Save
        </button>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------ kudos, report

export function KudosSheet({ peers, profiles, onClose, onSend }: { peers: Peer[]; profiles: Record<string, Profile>; onClose: () => void; onSend: (peer: Peer, badge: string, note: string) => Promise<void> }) {
  const [peer, setPeer] = useState<Peer | null>(null);
  const [badge, setBadge] = useState(KUDOS_BADGES[0].id);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title="Send kudos" onClose={onClose} hook="kudos">
      <span className={label}>To</span>
      <div className="mb-2 max-h-[30dvh] space-y-0.5 overflow-y-auto">
        {peers
          .filter((x) => x.trust_state !== "blocked")
          .map((x) => (
            <button key={x.id} type="button" data-ph-kudos-to={x.display_name} aria-pressed={peer?.id === x.id} onClick={() => setPeer(x)} className={`flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left ${peer?.id === x.id ? "bg-sky-500/15 ring-1 ring-sky-500" : ""}`}>
              <Avatar name={x.display_name} color={x.avatar_color} profile={profiles[x.id]} size={30} />
              <span className="truncate text-[13.5px] font-semibold text-slate-900 dark:text-white">{x.display_name}</span>
            </button>
          ))}
      </div>
      <span className={label}>Badge</span>
      <div className="mb-2 grid grid-cols-3 gap-1.5">
        {KUDOS_BADGES.map((b) => (
          <button key={b.id} type="button" data-ph-kudos-badge={b.id} aria-pressed={badge === b.id} onClick={() => setBadge(b.id)} className={`rounded-xl px-2 py-2 text-center text-[12px] ${badge === b.id ? "bg-sky-500/15 ring-1 ring-sky-500" : "lanx-card"}`}>
            <span className="block text-[22px]">{b.emoji}</span>
            <span className="text-slate-800 dark:text-slate-100">{b.label}</span>
          </button>
        ))}
      </div>
      <textarea data-ph-kudos-note value={note} onChange={(e) => setNote(e.target.value)} placeholder="A few words (optional)" rows={2} className={`${field} ph-select resize-none`} maxLength={300} />
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          data-ph-kudos-send
          disabled={!peer || busy}
          onClick={() => {
            if (!peer) return;
            setBusy(true);
            onSend(peer, badge, note.trim())
              .then(onClose)
              .finally(() => setBusy(false));
          }}
          className={primary}
        >
          Send kudos
        </button>
      </div>
    </Sheet>
  );
}

export function ReportSheet({ peers, profiles, onClose, onSend }: { peers: Peer[]; profiles: Record<string, Profile>; onClose: () => void; onSend: (to: Peer[], done: string, pending: string, blockers: string) => Promise<void> }) {
  const [to, setTo] = useState<Set<string>>(new Set());
  const [done, setDone] = useState("");
  const [pending, setPending] = useState("");
  const [blockers, setBlockers] = useState("");
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) =>
    setTo((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <Sheet title="End-of-day report" onClose={onClose} hook="report">
      <span className={label}>Done today</span>
      <textarea data-ph-report-done value={done} onChange={(e) => setDone(e.target.value)} rows={3} className={`${field} ph-select mb-2 resize-none`} />
      <span className={label}>Still pending</span>
      <textarea data-ph-report-pending value={pending} onChange={(e) => setPending(e.target.value)} rows={2} className={`${field} ph-select mb-2 resize-none`} />
      <span className={label}>Blockers</span>
      <textarea data-ph-report-blockers value={blockers} onChange={(e) => setBlockers(e.target.value)} rows={2} className={`${field} ph-select mb-2 resize-none`} />
      <span className={label}>Send to</span>
      <div className="mb-2 max-h-[26dvh] space-y-0.5 overflow-y-auto">
        {peers
          .filter((x) => x.trust_state !== "blocked")
          .map((x) => (
            <button key={x.id} type="button" data-ph-report-to={x.display_name} aria-pressed={to.has(x.id)} onClick={() => toggle(x.id)} className={`flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left ${to.has(x.id) ? "bg-sky-500/15 ring-1 ring-sky-500" : ""}`}>
              <Avatar name={x.display_name} color={x.avatar_color} profile={profiles[x.id]} size={30} />
              <span className="truncate text-[13.5px] font-semibold text-slate-900 dark:text-white">{x.display_name}</span>
            </button>
          ))}
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          data-ph-report-send
          disabled={to.size === 0 || !done.trim() || busy}
          onClick={() => {
            setBusy(true);
            onSend(
              peers.filter((x) => to.has(x.id)),
              done.trim(),
              pending.trim(),
              blockers.trim()
            )
              .then(onClose)
              .finally(() => setBusy(false));
          }}
          className={primary}
        >
          Send report
        </button>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- emergency

/** Press and hold for `ms` to fire (a slip of the thumb must not raise an alarm). */
export function HoldButton({ label, ms = 1500, onDone, className = "", hook }: { label: string; ms?: number; onDone: () => void; className?: string; hook?: string }) {
  const [pct, setPct] = useState(0);
  const timer = useRef(0);
  const start = useRef(0);
  const tick = () => {
    const p = Math.min(100, ((Date.now() - start.current) / ms) * 100);
    setPct(p);
    if (p >= 100) {
      window.clearInterval(timer.current);
      timer.current = 0;
      setPct(0);
      onDone();
    }
  };
  const begin = () => {
    start.current = Date.now();
    window.clearInterval(timer.current);
    timer.current = window.setInterval(tick, 40);
  };
  const stop = () => {
    window.clearInterval(timer.current);
    timer.current = 0;
    setPct(0);
  };
  return (
    <button
      type="button"
      data-ph-hold={hook}
      onPointerDown={(e) => {
        if (e.button === 0) begin();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      className={`ph-hold relative overflow-hidden rounded-full px-4 py-3 text-[14px] font-bold text-white select-none ${className}`}
    >
      <span className="absolute inset-y-0 left-0 bg-white/30" style={{ width: `${pct}%` }} />
      <span className="relative">{label}</span>
    </button>
  );
}

export function EmergencyScreen({
  alerts,
  onBack,
  onRaise,
  onAnswer,
  onClear,
}: {
  alerts: AlertInfo[];
  onBack: () => void;
  onRaise: (kind: string, text: string) => Promise<void>;
  onAnswer: (id: string, status: "safe" | "help") => Promise<void>;
  onClear: (id: string) => Promise<void>;
}) {
  const [kind, setKind] = useState(ALERT_KINDS[1].id);
  const [text, setText] = useState("");
  const live = alerts.filter((a) => stillOn(a));
  const chosen = alertKind(kind);
  return (
    <>
      <Header title="Emergency" onBack={onBack} />
      <div className="ph-scroll px-3 py-3 space-y-4" data-ph-emergency>
        {live.length > 0 && (
          <div>
            <div className="mb-1 px-1 text-[11px] font-bold uppercase tracking-wide text-rose-500">Going on now</div>
            <div className="space-y-2">
              {live.map((a) => (
                <div key={a.id} data-ph-alert={a.id} className="rounded-[16px] border border-rose-300/60 bg-rose-500/10 p-3">
                  <div className="text-[14px] font-bold text-rose-700 dark:text-rose-300">
                    {alertKind(a.kind).emoji} {alertKind(a.kind).label} — {a.mine ? "you" : a.from_name}
                  </div>
                  <div className="mt-0.5 text-[13px] text-slate-800 dark:text-slate-100">{a.text}</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">{whenShort(a.at)} · {a.acks.length} answered</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {needsAnswer(a) && (
                      <>
                        <button type="button" data-ph-alert-safe onClick={() => void onAnswer(a.id, "safe")} className={primary}>
                          I'm safe
                        </button>
                        <button type="button" data-ph-alert-help onClick={() => void onAnswer(a.id, "help")} className="rounded-full bg-rose-500 px-4 py-2 text-[13px] font-semibold text-white">
                          I need help
                        </button>
                      </>
                    )}
                    {a.my_ack && !a.mine && <span className="text-[12px] text-slate-500">You answered: {a.my_ack === "safe" ? "I'm safe" : "I need help"}</span>}
                    {a.mine && (
                      <button type="button" data-ph-alert-clear onClick={() => void onClear(a.id)} className={plain}>
                        All clear
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="rounded-[16px] lanx-group p-3">
          <div className="text-[14px] font-bold text-slate-900 dark:text-white">Raise an alert</div>
          <div className="text-[11.5px] text-slate-500 dark:text-slate-400">Everyone online in the office gets it at once, with a siren on their PC.</div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {ALERT_KINDS.map((k) => (
              <button key={k.id} type="button" data-ph-alert-kind={k.id} aria-pressed={kind === k.id} onClick={() => setKind(k.id)} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] ${kind === k.id ? "bg-rose-500/15 ring-1 ring-rose-500" : "lanx-card"}`}>
                <span>{k.emoji}</span>
                <span className="text-slate-800 dark:text-slate-100">{k.label}</span>
              </button>
            ))}
          </div>
          <input data-ph-alert-text value={text} onChange={(e) => setText(e.target.value)} placeholder={chosen.text || "What is happening?"} className={`${field} mt-2`} maxLength={200} />
          <div className="mt-3 flex justify-center">
            <HoldButton hook="alert" label="Hold to send the alert" className="w-full bg-rose-500" onDone={() => void onRaise(kind, text.trim() || chosen.text)} />
          </div>
        </div>
      </div>
    </>
  );
}

export function AlertBanner({ alert, onAnswer, onOpen }: { alert: AlertInfo; onAnswer: (id: string, status: "safe" | "help") => Promise<void>; onOpen: () => void }) {
  const k = alertKind(alert.kind);
  return (
    <div className="fixed inset-x-0 top-0 z-[85] bg-rose-600 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+10px)] text-white shadow-lg lanx-rise" data-ph-alert-banner={alert.id}>
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="text-[15px] font-bold">
          {k.emoji} {k.label} — {alert.from_name}
        </div>
        <div className="text-[13px]">{alert.text}</div>
      </button>
      {needsAnswer(alert) && (
        <div className="mt-2 flex gap-2">
          <button type="button" data-ph-alert-safe onClick={() => void onAnswer(alert.id, "safe")} className="rounded-full bg-white px-4 py-1.5 text-[13px] font-semibold text-rose-700">
            I'm safe
          </button>
          <button type="button" data-ph-alert-help onClick={() => void onAnswer(alert.id, "help")} className="rounded-full bg-rose-800 px-4 py-1.5 text-[13px] font-semibold text-white">
            I need help
          </button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- secure

export type PushState = "unsupported" | "off" | "on" | "denied" | "busy";

export function SecureSheet({
  secure,
  httpsUrls,
  fingerprint,
  token,
  push,
  onClose,
  onEnablePush,
}: {
  secure: boolean;
  httpsUrls: string[];
  fingerprint: string;
  token: string;
  push: PushState;
  onClose: () => void;
  onEnablePush: () => void;
}) {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes("Macintosh") && "ontouchend" in document);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || ("standalone" in navigator && (navigator as { standalone?: boolean }).standalone === true);
  const secureUrl = httpsUrls.find((u) => u.includes(location.hostname)) ?? httpsUrls[0] ?? "";
  return (
    <Sheet title="Secure connection & alerts" onClose={onClose} hook="secure">
      {secure ? (
        <div className="rounded-xl bg-emerald-500/15 px-3 py-2 text-[13px] text-emerald-800 dark:text-emerald-200" data-ph-secure="on">
          ✓ This connection is secure. Voice notes, the intercom and alerts are available.
        </div>
      ) : (
        <div className="space-y-2 text-[13px] leading-relaxed text-slate-700 dark:text-slate-200" data-ph-secure="off">
          <p>Phones only allow the microphone and alerts on a secure page. Your PC made its own certificate; install it once on this phone (about five taps), then open the secure page.</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              <a href={ios ? "/lanx-ca.mobileconfig" : "/lanx-ca.crt"} className="font-semibold text-sky-600 dark:text-sky-400" data-ph-cert-download>
                Download the LANX certificate
              </a>
              {fingerprint && <span className="block text-[11px] text-slate-400">Fingerprint {fingerprint.slice(0, 23)}…</span>}
            </li>
            {ios ? (
              <>
                <li>
                  Open <b>Settings</b> → <b>Profile Downloaded</b> → <b>Install</b>.
                </li>
                <li>
                  Then <b>Settings → General → About → Certificate Trust Settings</b> → turn on <b>LANX</b>.
                </li>
              </>
            ) : (
              <li>
                Open the downloaded file: <b>Settings → Security → Install a certificate → CA certificate</b> (Android), or double-click it and install it under Trusted Root Certification Authorities (Windows/Mac).
              </li>
            )}
            <li>
              {secureUrl ? (
                <a href={`${secureUrl}/#token=${encodeURIComponent(token)}`} className="font-semibold text-sky-600 dark:text-sky-400" data-ph-secure-open>
                  Open the secure page
                </a>
              ) : (
                <span className="text-slate-400">The secure address is not ready yet.</span>
              )}
              <span className="block text-[11px] text-slate-400">{secureUrl || ""}</span>
            </li>
          </ol>
        </div>
      )}
      <div className="mt-4 border-t lanx-line pt-3">
        <div className="text-[14px] font-semibold text-slate-900 dark:text-white">Alerts when this page is closed</div>
        <p className="mt-1 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
          {push === "unsupported"
            ? secure
              ? ios && !standalone
                ? "On iPhone, alerts work after you add this page to the Home Screen (Share → Add to Home Screen) and open it from there."
                : "This browser cannot show alerts for a web page."
              : "Needs the secure connection first."
            : push === "on"
              ? "On. New messages and emergency alerts reach this phone even when the page is closed (your PC needs internet for that)."
              : push === "denied"
                ? "Alerts were blocked for this page. Allow notifications for it in the phone's settings."
                : "Off."}
        </p>
        {(push === "off" || push === "busy") && (
          <button type="button" data-ph-push-on disabled={push === "busy"} onClick={onEnablePush} className={`${primary} mt-2`}>
            {push === "busy" ? "Turning on…" : "Turn on alerts"}
          </button>
        )}
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------- person

export function PersonSheet({ peer, profile, onClose, onChat }: { peer: Peer; profile: Profile | null; onClose: () => void; onChat: () => void }) {
  const line = statusLine(profile, { until: true });
  const role = roleLine(profile);
  return (
    <Sheet onClose={onClose} hook="person">
      <div className="flex items-center gap-3">
        <Avatar name={peer.display_name} color={peer.avatar_color} profile={profile} size={56} showStatus />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-bold text-slate-900 dark:text-white">{peer.display_name}</div>
          {role && <div className="truncate text-[12px] text-slate-500 dark:text-slate-400">{role}</div>}
          <div className="text-[12px]" style={{ color: line?.color ?? (peer.status === "online" ? "#22c55e" : "#94a3b8") }}>
            {line ? `${line.emoji} ${line.text}` : peer.status === "online" ? "🟢 Online" : "⚪ Offline"}
          </div>
        </div>
        <button type="button" onClick={onClose} className="lanx-tool p-1.5" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      {profile?.bio && <p className="mt-3 text-[13px] leading-relaxed text-slate-700 dark:text-slate-200">{profile.bio}</p>}
      <div className="mt-3 space-y-1">
        {profile?.phone && <SheetRow icon={<Phone className="h-4 w-4" />} label={profile.phone} hint="Call" hook="call" onClick={() => (location.href = `tel:${profile.phone.replace(/\s+/g, "")}`)} />}
        {profile?.email && <SheetRow icon={<Mail className="h-4 w-4" />} label={profile.email} hint="Email" hook="email" onClick={() => (location.href = `mailto:${profile.email}`)} />}
      </div>
      <button type="button" data-ph-person-chat onClick={onChat} className={`${primary} mt-3 w-full`}>
        Message
      </button>
    </Sheet>
  );
}

/** For the "Needs you" count on the More tab. */
export const useForMe = (hits: Hit[], myId: string) => useMemo(() => hits.filter((h) => needsMe(h.message, myId)).length, [hits, myId]);

export { whenText };
