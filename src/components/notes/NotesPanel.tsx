import { useEffect, useMemo, useRef, useState } from "react";
import { ListChecks, Pin, PinOff, Plus, RotateCcw, Search, Send, StickyNote, Trash2, X, Download, Copy } from "lucide-react";
import type { Note } from "../../types";
import { api, errorText } from "../../lib/api";

/** LANX 2.5.0: a small notebook inside LANX. Notes stay on this PC (and in
 *  the daily backup); a note can be sent to a chat or saved as a text file. */

export const NOTE_COLORS: { id: string; bg: string; dot: string; name: string }[] = [
  { id: "yellow", bg: "bg-amber-50 dark:bg-amber-900/20", dot: "bg-amber-400", name: "Yellow" },
  { id: "green", bg: "bg-emerald-50 dark:bg-emerald-900/20", dot: "bg-emerald-400", name: "Green" },
  { id: "blue", bg: "bg-sky-50 dark:bg-sky-900/20", dot: "bg-sky-400", name: "Blue" },
  { id: "pink", bg: "bg-pink-50 dark:bg-pink-900/20", dot: "bg-pink-400", name: "Pink" },
  { id: "purple", bg: "bg-violet-50 dark:bg-violet-900/20", dot: "bg-violet-400", name: "Purple" },
  { id: "orange", bg: "bg-orange-50 dark:bg-orange-900/20", dot: "bg-orange-400", name: "Orange" },
  { id: "grey", bg: "bg-slate-100 dark:bg-slate-800/40", dot: "bg-slate-400", name: "Grey" },
];

export function noteHeading(n: Note): string {
  if (n.title.trim()) return n.title.trim();
  const first = n.body
    .split("\n")
    .map((l) => l.replace(/^\[( |x)\] /, "").trim())
    .find((l) => l);
  return first ? first.slice(0, 60) : "Untitled note";
}

/** Checklist lines: "[ ] text" / "[x] text". */
function parseList(body: string): { done: boolean; text: string }[] {
  return body
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => {
      const m = /^\[( |x)\] ?(.*)$/.exec(l);
      return m ? { done: m[1] === "x", text: m[2] } : { done: false, text: l };
    });
}
function listToBody(items: { done: boolean; text: string }[]): string {
  return items.map((i) => `[${i.done ? "x" : " "}] ${i.text}`).join("\n");
}

function when(ts: number): string {
  const d = new Date(ts * 1000);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { day: "numeric", month: "short" });
}

export function NotesPanel({
  onClose,
  onError,
  onSendText,
  initialNote,
}: {
  onClose: () => void;
  onError: (text: string) => void;
  /** Send a note's text to a chat (opens the "send to" chooser). */
  onSendText: (text: string) => void;
  /** Open with this note already created (e.g. "Save to notes" from a message). */
  initialNote?: { title?: string; body: string } | null;
}) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [bin, setBin] = useState<Note[]>([]);
  const [showBin, setShowBin] = useState(false);
  const [q, setQ] = useState("");
  const [current, setCurrent] = useState<Note | null>(null);
  const [saving, setSaving] = useState(false);
  const [newItem, setNewItem] = useState("");
  const saveTimer = useRef<number>(0);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const started = useRef(false);
  /** The note as last changed (keystrokes can come faster than renders). */
  const currentRef = useRef<Note | null>(null);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  const load = async () => {
    try {
      const [n, b] = await Promise.all([api.listNotes(false), api.listNotes(true)]);
      setNotes(n);
      setBin(b);
      return n;
    } catch (e) {
      onError(errorText(e));
      return [];
    }
  };

  useEffect(() => {
    (async () => {
      const n = await load();
      if (started.current) return;
      started.current = true;
      if (initialNote) {
        await createNote(initialNote.title ?? "", initialNote.body, "note");
      } else if (n.length) {
        setCurrent(n[0]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createNote = async (title: string, body: string, kind: "note" | "checklist") => {
    try {
      const saved = await api.saveNote({ id: "", title, body, kind, color: "yellow", pinned: false, created_at: 0, updated_at: 0, deleted_at: null });
      await load();
      setCurrent(saved);
      setShowBin(false);
      setTimeout(() => titleRef.current?.focus(), 50);
    } catch (e) {
      onError(errorText(e));
    }
  };

  /** Changes the open note; writes it a moment later (and at once when `now`). */
  const change = (patch: Partial<Note>, now = false) => {
    const base = currentRef.current ?? current;
    if (!base) return;
    const next = { ...base, ...patch };
    currentRef.current = next;
    setCurrent(next);
    setNotes((list) => list.map((n) => (n.id === next.id ? next : n)));
    window.clearTimeout(saveTimer.current);
    const write = async () => {
      setSaving(true);
      try {
        const saved = await api.saveNote(next);
        setNotes((list) => {
          const others = list.filter((n) => n.id !== saved.id);
          return [...others, saved].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at - a.updated_at);
        });
        setCurrent((c) => (c && c.id === saved.id ? { ...c, updated_at: saved.updated_at, created_at: saved.created_at } : c));
      } catch (e) {
        onError(errorText(e));
      } finally {
        setSaving(false);
      }
    };
    if (now) void write();
    else saveTimer.current = window.setTimeout(write, 600);
  };

  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  const remove = async (n: Note, forGood: boolean) => {
    try {
      await api.deleteNote(n.id, forGood);
      await load();
      if (current?.id === n.id) setCurrent(null);
    } catch (e) {
      onError(errorText(e));
    }
  };
  const restore = async (n: Note) => {
    try {
      await api.restoreNote(n.id);
      const list = await load();
      setShowBin(false);
      setCurrent(list.find((x) => x.id === n.id) ?? null);
    } catch (e) {
      onError(errorText(e));
    }
  };

  const shown = useMemo(() => {
    const src = showBin ? bin : notes;
    const t = q.trim().toLowerCase();
    if (!t) return src;
    return src.filter((n) => n.title.toLowerCase().includes(t) || n.body.toLowerCase().includes(t));
  }, [notes, bin, showBin, q]);

  const asText = (n: Note) => (n.title.trim() ? `${n.title.trim()}\n\n` : "") + (n.kind === "checklist" ? parseList(n.body).map((i) => `${i.done ? "☑" : "☐"} ${i.text}`).join("\n") : n.body);

  const exportNote = async (n: Note) => {
    try {
      const path = await api.saveTextFile(`${noteHeading(n).slice(0, 60)}.txt`, asText(n));
      if (path) onError(`Saved to ${path}`);
    } catch (e) {
      onError(errorText(e));
    }
  };

  const colorOf = (id: string) => NOTE_COLORS.find((c) => c.id === id) ?? NOTE_COLORS[0];
  const items = current?.kind === "checklist" ? parseList(current.body) : [];
  const setItems = (next: { done: boolean; text: string }[], now = false) => change({ body: listToBody(next) }, now);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 lanx-scrim" onMouseDown={onClose}>
      <div
        data-notes-panel
        className="w-[940px] max-w-[96vw] h-[640px] max-h-[92vh] flex flex-col rounded-[22px] lanx-sheet overflow-hidden lanx-rise"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b lanx-line">
          <h3 className="flex items-center gap-2 text-[15px] font-bold text-slate-900 dark:text-white">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-400 text-white">
              <StickyNote className="h-4 w-4" />
            </span>
            Notes
            <span className="text-[11px] font-medium text-slate-400 ml-1">{saving ? "Saving…" : "Only on this PC · kept in your backups"}</span>
          </h3>
          <div className="flex items-center gap-1.5">
            <button type="button" data-note-new onClick={() => createNote("", "", "note")} className="px-3 py-1.5 rounded-full bg-amber-400 hover:bg-amber-500 text-white text-[12px] font-semibold inline-flex items-center gap-1">
              <Plus className="h-3.5 w-3.5" /> New note
            </button>
            <button type="button" data-note-new-list onClick={() => createNote("", "", "checklist")} className="px-3 py-1.5 rounded-full lanx-group text-[12px] font-semibold inline-flex items-center gap-1 text-slate-700 dark:text-slate-200">
              <ListChecks className="h-3.5 w-3.5" /> New checklist
            </button>
            <button type="button" onClick={onClose} className="lanx-tool p-1 text-slate-400 ml-1">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex">
          {/* List */}
          <div className="w-[300px] shrink-0 border-r lanx-line flex flex-col">
            <div className="p-2.5 border-b lanx-line">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <input data-note-search value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes…" className="lanx-field w-full rounded-[10px] pl-8 pr-3 py-[7px] text-xs text-slate-900 dark:text-white" />
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1">
              {shown.length === 0 && (
                <div className="px-3 py-8 text-center text-[12px] text-slate-400">
                  {showBin ? "Nothing in the bin." : q ? "No note matches." : "No notes yet. Press New note."}
                </div>
              )}
              {shown.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  data-note-item={n.id}
                  onClick={() => setCurrent(n)}
                  className={`w-full text-left px-3 py-2 rounded-xl border ${current?.id === n.id ? "border-amber-400 bg-amber-50/70 dark:bg-amber-900/20" : "border-transparent hover:bg-[var(--lanx-fill)]"}`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full shrink-0 ${colorOf(n.color).dot}`} />
                    <span className="flex-1 min-w-0 truncate text-[12.5px] font-semibold text-slate-900 dark:text-white">{noteHeading(n)}</span>
                    {n.pinned && <Pin className="h-3 w-3 text-amber-500 shrink-0" />}
                    <span className="text-[10.5px] text-slate-400 shrink-0">{when(n.updated_at)}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500 line-clamp-2">
                    {n.kind === "checklist" ? `${parseList(n.body).filter((i) => i.done).length}/${parseList(n.body).length} done` : n.body.slice(0, 120) || " "}
                  </div>
                </button>
              ))}
            </div>
            <div className="p-2 border-t lanx-line">
              <button type="button" data-note-bin onClick={() => { setShowBin((v) => !v); setCurrent(null); }} className={`w-full px-3 py-1.5 rounded-lg text-[11.5px] font-semibold inline-flex items-center justify-center gap-1.5 ${showBin ? "bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-white" : "text-slate-500 hover:bg-[var(--lanx-fill)]"}`}>
                <Trash2 className="h-3.5 w-3.5" /> {showBin ? "Back to notes" : `Recently deleted${bin.length ? ` (${bin.length})` : ""}`}
              </button>
            </div>
          </div>

          {/* Editor */}
          <div className={`flex-1 min-w-0 flex flex-col ${current ? colorOf(current.color).bg : ""}`}>
            {!current && (
              <div className="flex-1 flex items-center justify-center text-[13px] text-slate-400">{showBin ? "Pick a note to bring it back." : "Pick a note, or make a new one."}</div>
            )}
            {current && showBin && (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-8">
                <div className="text-[14px] font-semibold text-slate-800 dark:text-white">{noteHeading(current)}</div>
                <div className="text-[12px] text-slate-500 whitespace-pre-wrap max-h-48 overflow-y-auto">{current.body}</div>
                <div className="flex gap-2 mt-2">
                  <button type="button" data-note-restore onClick={() => restore(current)} className="px-3 py-1.5 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white text-[12px] font-semibold inline-flex items-center gap-1"><RotateCcw className="h-3.5 w-3.5" /> Bring back</button>
                  <button type="button" onClick={() => remove(current, true)} className="px-3 py-1.5 rounded-full text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 text-[12px] font-semibold">Delete for good</button>
                </div>
                <div className="text-[11px] text-slate-400">Deleted notes are removed by themselves after 30 days.</div>
              </div>
            )}
            {current && !showBin && (
              <>
                <div className="flex items-center gap-1 px-4 pt-3">
                  <input
                    ref={titleRef}
                    data-note-title
                    value={current.title}
                    onChange={(e) => change({ title: e.target.value })}
                    placeholder="Title"
                    className="flex-1 min-w-0 bg-transparent text-[16px] font-bold text-slate-900 dark:text-white outline-none placeholder:text-slate-400"
                  />
                  <button type="button" data-note-pin title={current.pinned ? "Unpin" : "Pin to the top"} onClick={() => change({ pinned: !current.pinned }, true)} className={`lanx-tool p-1.5 ${current.pinned ? "text-amber-500" : "text-slate-400"}`}>
                    {current.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                  </button>
                  <div className="flex items-center gap-1 px-1">
                    {NOTE_COLORS.map((c) => (
                      <button key={c.id} type="button" title={c.name} data-note-color={c.id} onClick={() => change({ color: c.id }, true)} className={`h-4 w-4 rounded-full ${c.dot} ${current.color === c.id ? "ring-2 ring-offset-1 ring-slate-500 dark:ring-offset-slate-900" : "opacity-70 hover:opacity-100"}`} />
                    ))}
                  </div>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2">
                  {current.kind === "note" ? (
                    <textarea
                      data-note-body
                      value={current.body}
                      onChange={(e) => change({ body: e.target.value })}
                      placeholder="Write anything… phone numbers, to-dos, things to remember."
                      className="w-full h-full min-h-[300px] resize-none bg-transparent text-[13.5px] leading-relaxed text-slate-800 dark:text-slate-100 outline-none placeholder:text-slate-400"
                    />
                  ) : (
                    <div className="space-y-1">
                      {items.map((it, i) => (
                        <div key={i} className="flex items-start gap-2 group">
                          <button type="button" data-check-item={i} onClick={() => setItems(items.map((x, j) => (j === i ? { ...x, done: !x.done } : x)), true)} className={`mt-0.5 h-[18px] w-[18px] rounded-md border-2 flex items-center justify-center shrink-0 ${it.done ? "bg-emerald-500 border-emerald-500 text-white" : "border-slate-300 dark:border-slate-600"}`}>
                            {it.done && <span className="text-[11px] leading-none">✓</span>}
                          </button>
                          <input
                            value={it.text}
                            onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                            onKeyDown={(e) => {
                              if (e.key === "Backspace" && !it.text) {
                                e.preventDefault();
                                setItems(items.filter((_, j) => j !== i), true);
                              }
                            }}
                            className={`flex-1 min-w-0 bg-transparent text-[13.5px] outline-none ${it.done ? "line-through text-slate-400" : "text-slate-800 dark:text-slate-100"}`}
                          />
                          <button type="button" onClick={() => setItems(items.filter((_, j) => j !== i), true)} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 p-0.5"><X className="h-3.5 w-3.5" /></button>
                        </div>
                      ))}
                      <div className="flex items-center gap-2 pt-1">
                        <span className="h-[18px] w-[18px] rounded-md border-2 border-dashed border-slate-300 dark:border-slate-600 shrink-0" />
                        <input
                          data-check-new
                          value={newItem}
                          onChange={(e) => setNewItem(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && newItem.trim()) {
                              e.preventDefault();
                              setItems([...items, { done: false, text: newItem.trim() }], true);
                              setNewItem("");
                            }
                          }}
                          placeholder="Add an item and press Enter"
                          className="flex-1 min-w-0 bg-transparent text-[13.5px] outline-none text-slate-800 dark:text-slate-100 placeholder:text-slate-400"
                        />
                      </div>
                      {items.length > 0 && items.every((i) => i.done) && <div className="pt-2 text-[12px] text-emerald-600 font-semibold">All done 🎉</div>}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 px-3 py-2 border-t lanx-line text-[11.5px]">
                  <span className="text-slate-400 mr-auto">Edited {when(current.updated_at)}</span>
                  <button type="button" data-note-send onClick={() => onSendText(asText(current))} className="px-2.5 py-1 rounded-full hover:bg-[var(--lanx-fill)] text-sky-600 dark:text-sky-400 font-semibold inline-flex items-center gap-1"><Send className="h-3.5 w-3.5" /> Send to chat</button>
                  <button type="button" onClick={() => navigator.clipboard.writeText(asText(current)).catch(() => {})} className="px-2.5 py-1 rounded-full hover:bg-[var(--lanx-fill)] text-slate-600 dark:text-slate-300 font-semibold inline-flex items-center gap-1"><Copy className="h-3.5 w-3.5" /> Copy</button>
                  <button type="button" onClick={() => exportNote(current)} className="px-2.5 py-1 rounded-full hover:bg-[var(--lanx-fill)] text-slate-600 dark:text-slate-300 font-semibold inline-flex items-center gap-1"><Download className="h-3.5 w-3.5" /> Save as file</button>
                  <button type="button" data-note-delete onClick={() => remove(current, false)} className="px-2.5 py-1 rounded-full hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 font-semibold inline-flex items-center gap-1"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
