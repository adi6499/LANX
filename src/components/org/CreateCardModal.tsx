import { useState } from "react";
import { BarChart3, CalendarDays, ClipboardCheck, FileSignature, ListChecks, Megaphone, Plus, Trash2, X } from "lucide-react";
import { Avatar } from "../Avatar";
import type { Profile } from "../../types";
import { KIND_LABEL, type CardKind } from "./cardModel";
import { localInputValue } from "../chat/chatUtils";

/** LANX 1.6.0: making a card — one window, a tab for each kind. */

export interface Person {
  id: string;
  name: string;
  color: string;
}

const KINDS: { kind: CardKind; icon: React.ElementType; hint: string }[] = [
  { kind: "notice", icon: Megaphone, hint: "An announcement; people confirm they've read it" },
  { kind: "poll", icon: BarChart3, hint: "Ask a question with answers to pick" },
  { kind: "task", icon: ClipboardCheck, hint: "Something to do, for someone, by a date" },
  { kind: "approval", icon: FileSignature, hint: "Ask someone to approve or reject" },
  { kind: "checklist", icon: ListChecks, hint: "A list everyone can tick off" },
  { kind: "event", icon: CalendarDays, hint: "Plan a meeting; people answer and get reminded" },
];

const label = "block text-[11.5px] font-semibold text-slate-600 dark:text-slate-300 mb-1";
const field = "w-full rounded-xl lanx-field px-3 py-2 text-[13px]";

function PeoplePicker({
  people,
  selected,
  onChange,
  single,
  profiles,
}: {
  people: Person[];
  selected: string[];
  onChange: (ids: string[]) => void;
  single?: boolean;
  profiles: Record<string, Profile>;
}) {
  if (!people.length) return <p className="text-[12px] text-slate-400">Nobody else is in this chat.</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {people.map((p) => {
        const on = selected.includes(p.id);
        return (
          <button
            key={p.id}
            type="button"
            data-person-pick={p.name}
            onClick={() => onChange(single ? (on ? [] : [p.id]) : on ? selected.filter((x) => x !== p.id) : [...selected, p.id])}
            className={`inline-flex items-center gap-1.5 rounded-full pl-1 pr-2.5 py-1 text-[12px] border transition-colors ${
              on ? "border-sky-500 bg-sky-500/15 text-sky-700 dark:text-sky-300" : "border-slate-300/70 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:border-sky-400"
            }`}
          >
            <Avatar name={p.name} color={p.color} profile={profiles[p.id]} size={20} />
            {p.name}
          </button>
        );
      })}
    </div>
  );
}

export function CreateCardModal({
  initialKind,
  initialTitle = "",
  fromMessage = null,
  people,
  profiles = {},
  chatName,
  onClose,
  onCreate,
}: {
  initialKind: CardKind;
  initialTitle?: string;
  /** "Make a task" from a message. */
  fromMessage?: string | null;
  /** Everyone in the chat except you. */
  people: Person[];
  profiles?: Record<string, Profile>;
  chatName: string;
  onClose: () => void;
  onCreate: (card: Record<string, unknown>) => Promise<boolean>;
}) {
  const [kind, setKind] = useState<CardKind>(initialKind);
  const [busy, setBusy] = useState(false);
  // shared fields
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState("");
  const [important, setImportant] = useState(false);
  const [ack, setAck] = useState(true);
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [multi, setMulti] = useState(false);
  const [assignee, setAssignee] = useState<string[]>([]);
  const [due, setDue] = useState("");
  const [amount, setAmount] = useState("");
  const [approvers, setApprovers] = useState<string[]>([]);
  const [items, setItems] = useState<string[]>(["", ""]);
  const [start, setStart] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() + 1, 0, 0, 0);
    return localInputValue(Math.floor(d.getTime() / 1000));
  });
  const [minutes, setMinutes] = useState(30);
  const [attendees, setAttendees] = useState<string[]>([]);
  const [place, setPlace] = useState("");
  const [video, setVideo] = useState(true);

  const toSecs = (v: string) => (v ? Math.floor(new Date(v).getTime() / 1000) : null);

  const build = (): Record<string, unknown> => {
    switch (kind) {
      case "notice":
        return { kind, title, body, important, ack };
      case "poll":
        return { kind, question: title, options: options.filter((o) => o.trim()), multi };
      case "task":
        return { kind, title, notes: body, assignee: assignee[0] ?? "", due: toSecs(due), from_message: fromMessage };
      case "approval":
        return { kind, title, details: body, amount, approvers };
      case "checklist":
        return { kind, title, items: items.filter((i) => i.trim()) };
      case "event":
        return { kind, title, start: toSecs(start), minutes, attendees, place, video, agenda: body };
    }
  };

  const submit = async () => {
    setBusy(true);
    const ok = await onCreate(build());
    setBusy(false);
    if (ok) onClose();
  };

  const listEditor = (list: string[], set: (l: string[]) => void, placeholder: string, max: number, testId: string) => (
    <div className="space-y-1.5">
      {list.map((v, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            value={v}
            data-list-input={testId}
            onChange={(e) => set(list.map((x, j) => (j === i ? e.target.value : x)))}
            placeholder={`${placeholder} ${i + 1}`}
            maxLength={kind === "poll" ? 100 : 200}
            className={field}
          />
          {list.length > (kind === "poll" ? 2 : 1) && (
            <button type="button" aria-label="Remove" onClick={() => set(list.filter((_, j) => j !== i))} className="h-8 w-8 shrink-0 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-500/10">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}
      {list.length < max && (
        <button type="button" onClick={() => set([...list, ""])} className="inline-flex items-center gap-1 text-[12px] font-semibold text-sky-600 hover:underline">
          <Plus className="h-3.5 w-3.5" /> Add another
        </button>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 lanx-scrim" onMouseDown={onClose}>
      <div data-create-card={kind} onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-xl max-h-[88vh] flex flex-col rounded-[24px] lanx-sheet !bg-[color-mix(in_srgb,var(--lanx-surface)_96%,transparent)] shadow-2xl lanx-rise">
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900 dark:text-white">New {KIND_LABEL[kind].toLowerCase()}</h2>
            <p className="text-[11.5px] text-slate-500">in {chatName} · {KINDS.find((k) => k.kind === kind)?.hint}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="h-8 w-8 rounded-full flex items-center justify-center text-slate-500 hover:bg-[var(--lanx-fill)]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 pb-2 flex gap-1 overflow-x-auto">
          {KINDS.map(({ kind: k, icon: I }) => (
            <button
              key={k}
              type="button"
              data-kind-tab={k}
              onClick={() => setKind(k)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                kind === k ? "bg-sky-500 text-white" : "bg-slate-500/10 text-slate-600 dark:text-slate-300 hover:bg-slate-500/20"
              }`}
            >
              <I className="h-3.5 w-3.5" /> {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3.5">
          <div>
            <label className={label}>{kind === "poll" ? "Question" : kind === "notice" ? "Heading" : kind === "task" ? "What needs doing" : kind === "approval" ? "What needs approving" : "Title"}</label>
            <input data-card-title value={title} onChange={(e) => setTitle(e.target.value)} maxLength={kind === "notice" ? 120 : 200} autoFocus className={field} />
          </div>

          {kind === "notice" && (
            <>
              <div>
                <label className={label}>Message</label>
                <textarea data-card-body value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={4000} className={`${field} resize-none`} />
              </div>
              <label className="flex items-center gap-2 text-[12.5px] text-slate-700 dark:text-slate-200">
                <input type="checkbox" checked={important} onChange={(e) => setImportant(e.target.checked)} /> Mark as important
              </label>
              <label className="flex items-center gap-2 text-[12.5px] text-slate-700 dark:text-slate-200">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> Ask everyone to confirm they've read it
              </label>
            </>
          )}

          {kind === "poll" && (
            <>
              <div>
                <label className={label}>Answers</label>
                {listEditor(options, setOptions, "Answer", 10, "option")}
              </div>
              <label className="flex items-center gap-2 text-[12.5px] text-slate-700 dark:text-slate-200">
                <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} /> People may choose more than one
              </label>
            </>
          )}

          {kind === "task" && (
            <>
              <div>
                <label className={label}>For</label>
                <PeoplePicker people={people} selected={assignee} onChange={setAssignee} single profiles={profiles} />
                <p className="mt-1 text-[11px] text-slate-400">Nobody chosen = anyone can do it.</p>
              </div>
              <div>
                <label className={label}>Due (optional — they get a reminder)</label>
                <input type="datetime-local" data-card-due value={due} onChange={(e) => setDue(e.target.value)} className={field} />
              </div>
              <div>
                <label className={label}>Notes</label>
                <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={2000} className={`${field} resize-none`} />
              </div>
            </>
          )}

          {kind === "approval" && (
            <>
              <div>
                <label className={label}>Who approves</label>
                <PeoplePicker people={people} selected={approvers} onChange={setApprovers} profiles={profiles} />
              </div>
              <div>
                <label className={label}>Amount (optional)</label>
                <input value={amount} onChange={(e) => setAmount(e.target.value)} maxLength={40} placeholder="₹ 18,400" className={field} />
              </div>
              <div>
                <label className={label}>Details</label>
                <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={2000} className={`${field} resize-none`} />
              </div>
            </>
          )}

          {kind === "checklist" && (
            <div>
              <label className={label}>Items</label>
              {listEditor(items, setItems, "Item", 50, "item")}
            </div>
          )}

          {kind === "event" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={label}>When</label>
                  <input type="datetime-local" data-card-start value={start} onChange={(e) => setStart(e.target.value)} className={field} />
                </div>
                <div>
                  <label className={label}>How long</label>
                  <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className={field}>
                    {[15, 30, 45, 60, 90, 120, 180].map((m) => (
                      <option key={m} value={m}>
                        {m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? "s" : ""}`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className={label}>Who (nobody chosen = everyone in this chat)</label>
                <PeoplePicker people={people} selected={attendees} onChange={setAttendees} profiles={profiles} />
              </div>
              <div>
                <label className={label}>Place (optional)</label>
                <input value={place} onChange={(e) => setPlace(e.target.value)} maxLength={120} placeholder="Conference room / Dolvi site office" className={field} />
              </div>
              <label className="flex items-center gap-2 text-[12.5px] text-slate-700 dark:text-slate-200">
                <input type="checkbox" checked={video} onChange={(e) => setVideo(e.target.checked)} /> Video meeting in LANX (a “Start meeting” button appears at the time)
              </label>
              <div>
                <label className={label}>Agenda (optional)</label>
                <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={2000} className={`${field} resize-none`} />
              </div>
            </>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t lanx-line">
          <button type="button" onClick={onClose} className="h-9 px-4 rounded-full bg-slate-500/10 hover:bg-slate-500/20 text-[13px] text-slate-700 dark:text-slate-200">
            Cancel
          </button>
          <button type="button" data-card-post disabled={busy} onClick={() => void submit()} className="h-9 px-5 rounded-full bg-sky-500 hover:bg-sky-600 text-white text-[13px] font-semibold disabled:opacity-50">
            {busy ? "Posting…" : `Post ${KIND_LABEL[kind].toLowerCase()}`}
          </button>
        </div>
      </div>
    </div>
  );
}
