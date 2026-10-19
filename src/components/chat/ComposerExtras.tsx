import { useEffect, useRef, useState } from "react";
import { CalendarClock, ChevronLeft, ChevronRight, Clock, Pencil, Pin, Plus, Reply, Send, Trash2, X, Zap } from "lucide-react";
import type { Message, ScheduledMessage } from "../../types";
import { Avatar } from "../Avatar";
import type { Profile } from "../../types";
import { localInputValue, whenChoices, whenText } from "./chatUtils";

/** LANX 1.5.0: things around the message box — the reply / edit bar, the
 *  @mention and quick-reply pickers, "send later" and its list, and the bar
 *  of pinned messages at the top of a chat. */

export function ReplyEditBar({
  mode,
  text,
  onCancel,
}: {
  mode: "reply" | "edit";
  /** "Bharat: Truck arrives at 4" */
  text: string;
  onCancel: () => void;
}) {
  return (
    <div data-composer-mode={mode} className="mx-1 mb-1.5 flex items-center gap-2 rounded-xl bg-sky-500/10 border-l-[3px] border-sky-500 px-3 py-1.5 lanx-fade">
      {mode === "reply" ? <Reply className="h-3.5 w-3.5 text-sky-600 shrink-0" /> : <Pencil className="h-3.5 w-3.5 text-sky-600 shrink-0" />}
      <div className="min-w-0 flex-1">
        <div className="text-[10.5px] font-semibold text-sky-700 dark:text-sky-300">{mode === "reply" ? "Replying to" : "Editing your message"}</div>
        <div className="text-[12px] text-slate-600 dark:text-slate-300 truncate">{text}</div>
      </div>
      <button type="button" onClick={onCancel} aria-label="Cancel" className="h-6 w-6 rounded-full flex items-center justify-center text-slate-500 hover:bg-[var(--lanx-fill)]">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export interface MentionCandidate {
  id: string;
  name: string;
  color: string;
}

/** Group members matching what you typed after "@". */
export function MentionPicker({
  candidates,
  active,
  profiles,
  onPick,
}: {
  candidates: MentionCandidate[];
  active: number;
  profiles: Record<string, Profile>;
  onPick: (c: MentionCandidate) => void;
}) {
  if (!candidates.length) return null;
  return (
    <div data-mention-picker className="absolute bottom-full left-14 mb-2 w-64 rounded-2xl lanx-menu p-1.5 shadow-xl lanx-rise z-30">
      <div className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Mention</div>
      {candidates.map((c, i) => (
        <button
          key={c.id}
          type="button"
          data-mention-pick={c.name}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(c);
          }}
          className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] text-left ${
            i === active ? "bg-sky-500/15 text-sky-700 dark:text-sky-300" : "hover:bg-[var(--lanx-fill)] text-slate-700 dark:text-slate-200"
          }`}
        >
          <Avatar name={c.name} color={c.color} profile={profiles[c.id]} size={24} />
          <span className="truncate">{c.name}</span>
        </button>
      ))}
    </div>
  );
}

/** Ready-made answers ("/" in the message box), with a small editor. */
export function QuickReplyPicker({
  replies,
  filter,
  active,
  onPick,
  onSave,
  onClose,
}: {
  replies: string[];
  filter: string;
  active: number;
  onPick: (text: string) => void;
  onSave: (list: string[]) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const shown = replies.filter((r) => r.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div data-quick-replies className="absolute bottom-full left-14 mb-2 w-80 rounded-2xl lanx-menu p-1.5 shadow-xl lanx-rise z-30">
      <div className="flex items-center justify-between px-2 pb-1">
        <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
          <Zap className="h-3 w-3" /> Quick replies
        </span>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setEditing((v) => !v)}
          className="text-[11px] font-semibold text-sky-600 hover:underline"
        >
          {editing ? "Done" : "Edit"}
        </button>
      </div>
      <div className="max-h-60 overflow-y-auto">
        {shown.length === 0 && !editing && <p className="px-2 py-2 text-[12px] text-slate-400">No quick reply matches. Press Esc to type normally.</p>}
        {(editing ? replies : shown).map((r, i) => (
          <div key={r} className="flex items-center gap-1">
            <button
              type="button"
              data-quick-reply={r}
              onMouseDown={(e) => {
                e.preventDefault();
                if (!editing) onPick(r);
              }}
              className={`flex-1 min-w-0 rounded-lg px-2 py-1.5 text-[12.5px] text-left truncate ${
                !editing && i === active ? "bg-sky-500/15 text-sky-700 dark:text-sky-300" : "hover:bg-[var(--lanx-fill)] text-slate-700 dark:text-slate-200"
              }`}
            >
              {r}
            </button>
            {editing && (
              <button
                type="button"
                aria-label={`Remove “${r}”`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onSave(replies.filter((x) => x !== r))}
                className="h-7 w-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-500/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
      {editing && (
        <form
          className="mt-1 flex items-center gap-1.5 px-1"
          onSubmit={(e) => {
            e.preventDefault();
            const t = draft.trim();
            if (t && !replies.includes(t)) onSave([...replies, t]);
            setDraft("");
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onClose()}
            placeholder="Add a quick reply…"
            maxLength={300}
            className="flex-1 min-w-0 rounded-lg lanx-field px-2 py-1 text-[12px]"
          />
          <button type="submit" className="h-7 w-7 rounded-lg bg-sky-500 text-white flex items-center justify-center" aria-label="Add">
            <Plus className="h-3.5 w-3.5" />
          </button>
        </form>
      )}
    </div>
  );
}

/** "Send later": ready-made times or your own. */
export function SendLaterMenu({ onPick, onClose }: { onPick: (at: number) => void; onClose: () => void }) {
  const [custom, setCustom] = useState(() => localInputValue(Math.floor(Date.now() / 1000) + 3600));
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [onClose]);
  return (
    <div ref={ref} data-send-later className="absolute bottom-full right-0 mb-2 w-64 rounded-2xl lanx-menu p-1.5 shadow-xl lanx-rise z-30">
      <div className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Send later</div>
      {whenChoices("send").map((c) => (
        <button
          key={c.label}
          type="button"
          data-send-later-choice={c.label}
          onClick={() => onPick(c.at)}
          className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-[12.5px] rounded-lg hover:bg-[var(--lanx-fill)] text-slate-700 dark:text-slate-200"
        >
          <span className="inline-flex items-center gap-2">
            <Clock className="h-3.5 w-3.5" /> {c.label}
          </span>
          <span className="text-[10.5px] text-slate-400">{c.hint}</span>
        </button>
      ))}
      <div className="mt-1 flex items-center gap-1.5 px-2 pb-1">
        <input
          type="datetime-local"
          data-send-later-custom
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          className="flex-1 min-w-0 rounded-lg lanx-field px-2 py-1 text-[11.5px]"
        />
        <button
          type="button"
          data-send-later-set
          onClick={() => onPick(Math.floor(new Date(custom).getTime() / 1000))}
          className="rounded-lg bg-sky-500 hover:bg-sky-600 text-white px-2.5 py-1 text-[11.5px] font-semibold"
        >
          Set
        </button>
      </div>
    </div>
  );
}

/** Messages of this chat waiting to be sent. */
export function ScheduledStrip({
  items,
  onCancel,
  onSendNow,
}: {
  items: ScheduledMessage[];
  onCancel: (s: ScheduledMessage) => void;
  onSendNow: (s: ScheduledMessage) => void;
}) {
  if (!items.length) return null;
  return (
    <div data-scheduled className="mx-1 mb-1.5 space-y-1 lanx-fade">
      {items.map((s) => (
        <div key={s.id} data-scheduled-item className="flex items-center gap-2 rounded-xl lanx-group px-3 py-1.5">
          <CalendarClock className="h-3.5 w-3.5 text-violet-500 shrink-0" />
          <span className="text-[11px] font-semibold text-violet-600 dark:text-violet-300 shrink-0">{whenText(s.send_at)}</span>
          <span className="flex-1 min-w-0 truncate text-[12px] text-slate-600 dark:text-slate-300">{s.content}</span>
          <button type="button" title="Send now" onClick={() => onSendNow(s)} className="h-6 w-6 rounded-full flex items-center justify-center text-slate-500 hover:text-sky-600 hover:bg-[var(--lanx-fill)]">
            <Send className="h-3.5 w-3.5" />
          </button>
          <button type="button" title="Don't send" data-scheduled-cancel onClick={() => onCancel(s)} className="h-6 w-6 rounded-full flex items-center justify-center text-slate-500 hover:text-red-500 hover:bg-red-500/10">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Pinned messages at the top of a chat (newest first; arrows go through them). */
export function PinnedBar({
  pinned,
  label,
  onJump,
  onUnpin,
}: {
  pinned: Message[];
  label: (m: Message) => string;
  onJump: (m: Message) => void;
  onUnpin: (m: Message) => void;
}) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (i >= pinned.length) setI(0);
  }, [pinned.length, i]);
  if (!pinned.length) return null;
  const m = pinned[Math.min(i, pinned.length - 1)];
  return (
    <div data-pinned-bar className="px-5 py-1.5 flex items-center gap-2 border-t lanx-line bg-amber-400/10 lanx-fade">
      <Pin className="h-3.5 w-3.5 text-amber-600 shrink-0 rotate-45" />
      <button type="button" onClick={() => onJump(m)} className="flex-1 min-w-0 text-left">
        <span className="text-[10.5px] font-semibold text-amber-700 dark:text-amber-300">
          Pinned{pinned.length > 1 ? ` · ${i + 1} of ${pinned.length}` : ""}
        </span>
        <span className="block text-[12px] text-slate-700 dark:text-slate-200 truncate" data-pinned-text>
          {label(m)}
        </span>
      </button>
      {pinned.length > 1 && (
        <>
          <button type="button" aria-label="Previous pinned" onClick={() => setI((x) => (x + pinned.length - 1) % pinned.length)} className="h-6 w-6 rounded-full flex items-center justify-center text-slate-500 hover:bg-[var(--lanx-fill)]">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button type="button" aria-label="Next pinned" onClick={() => setI((x) => (x + 1) % pinned.length)} className="h-6 w-6 rounded-full flex items-center justify-center text-slate-500 hover:bg-[var(--lanx-fill)]">
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </>
      )}
      <button type="button" title="Unpin for everyone" onClick={() => onUnpin(m)} className="h-6 w-6 rounded-full flex items-center justify-center text-slate-500 hover:text-red-500 hover:bg-red-500/10">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
