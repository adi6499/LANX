import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, ClipboardList, RefreshCw, X } from "lucide-react";
import type { Message, SearchHit } from "../../types";
import { api, errorText } from "../../lib/api";
import { CardView } from "./CardView";
import { approvalStatus, eventCancelled, needsMe, parseCard, pollTally, taskDone, ticketStatus, type CardKind } from "./cardModel";

/** LANX 1.6.0: the Organiser — every notice, task, approval, poll, checklist
 *  and meeting from all chats, with what waits for you on top. */

type Tab = "me" | CardKind;
const TABS: { id: Tab; label: string }[] = [
  { id: "me", label: "For me" },
  { id: "notice", label: "Notices" },
  { id: "task", label: "Tasks" },
  { id: "approval", label: "Approvals" },
  { id: "ticket", label: "IT help" },
  { id: "event", label: "Meetings" },
  { id: "poll", label: "Polls" },
  { id: "checklist", label: "Checklists" },
];

/** How many cards wait for you (for the badge). */
export function countNeedsMe(hits: SearchHit[], myId: string) {
  return hits.filter((h) => needsMe(h.message, myId)).length;
}

export function OrganiserPanel({
  myId,
  nameOf,
  onClose,
  onOpen,
  onError,
  onStartMeeting,
  onCount,
}: {
  myId: string;
  nameOf: (id: string) => string;
  onClose: () => void;
  onOpen: (conversationId: string, messageId: string) => void;
  onError: (text: string) => void;
  onStartMeeting: (conversationId: string) => void;
  onCount?: (n: number) => void;
}) {
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [tab, setTab] = useState<Tab>("me");

  const load = () =>
    api
      .listCards()
      .then((h) => setHits(h))
      .catch((e) => {
        onError(errorText(e));
        setHits([]);
      });
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changed = (m: Message) => setHits((list) => (list ?? []).map((h) => (h.message.id === m.id ? { ...h, message: m } : h)));
  // The sidebar badge follows (after drawing, never during).
  useEffect(() => {
    if (hits) onCount?.(countNeedsMe(hits, myId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits]);

  const now = Math.floor(Date.now() / 1000);
  const shown = useMemo(() => {
    const list = hits ?? [];
    if (tab === "me") return list.filter((h) => needsMe(h.message, myId));
    const of = list.filter((h) => parseCard(h.message)?.kind === tab);
    // Open things first.
    const open = (h: SearchHit) => {
      const c = parseCard(h.message)!;
      switch (c.kind) {
        case "task":
          return !taskDone(h.message);
        case "approval":
          return approvalStatus(h.message, c) === "pending";
        case "ticket":
          return ticketStatus(h.message) !== "resolved";
        case "poll":
          return !pollTally(h.message, c).closed;
        case "event":
          return !eventCancelled(h.message) && c.start + c.minutes * 60 > now;
        default:
          return true;
      }
    };
    const sorted = [...of].sort((a, b) => Number(open(b)) - Number(open(a)));
    if (tab === "event") {
      sorted.sort((a, b) => {
        const ca = parseCard(a.message) as { start: number };
        const cb = parseCard(b.message) as { start: number };
        const fa = ca.start + 3600 > now;
        const fb = cb.start + 3600 > now;
        return fa !== fb ? Number(fb) - Number(fa) : fa ? ca.start - cb.start : cb.start - ca.start;
      });
    }
    return sorted;
  }, [hits, tab, myId, now]);

  const count = (t: Tab) => (t === "me" ? (hits ?? []).filter((h) => needsMe(h.message, myId)).length : (hits ?? []).filter((h) => parseCard(h.message)?.kind === t).length);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 lanx-scrim" onMouseDown={onClose}>
      <div data-organiser onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-2xl h-[86vh] flex flex-col rounded-[24px] lanx-sheet !bg-[color-mix(in_srgb,var(--lanx-surface)_96%,transparent)] shadow-2xl lanx-rise">
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="inline-flex items-center gap-2 text-[15px] font-semibold text-slate-900 dark:text-white">
            <ClipboardList className="h-4 w-4 text-emerald-500" /> Organiser
          </h2>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => void load()} title="Refresh" className="h-8 w-8 rounded-full flex items-center justify-center text-slate-500 hover:bg-[var(--lanx-fill)]">
              <RefreshCw className="h-4 w-4" />
            </button>
            <button type="button" onClick={onClose} aria-label="Close" className="h-8 w-8 rounded-full flex items-center justify-center text-slate-500 hover:bg-[var(--lanx-fill)]">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="px-5 pb-2 flex gap-1 overflow-x-auto">
          {TABS.map((t) => {
            const n = count(t.id);
            return (
              <button
                key={t.id}
                type="button"
                data-org-tab={t.id}
                onClick={() => setTab(t.id)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                  tab === t.id ? "bg-sky-500 text-white" : "bg-slate-500/10 text-slate-600 dark:text-slate-300 hover:bg-slate-500/20"
                }`}
              >
                {t.label}
                {n > 0 && (
                  <span className={`rounded-full px-1.5 text-[10px] ${tab === t.id ? "bg-white/25" : t.id === "me" ? "bg-red-500 text-white" : "bg-slate-500/15"}`}>{n}</span>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-4">
          {hits === null && <p className="py-10 text-center text-xs text-slate-400">Loading…</p>}
          {hits !== null && shown.length === 0 && (
            <div className="py-12 text-center text-[12.5px] text-slate-500 dark:text-slate-400">
              {tab === "me" ? "Nothing waits for you. 🎉" : "Nothing here yet. In any chat, press + next to the message box to make one."}
            </div>
          )}
          {shown.map((h) => {
            const why = needsMe(h.message, myId);
            return (
              <div key={h.message.id} data-org-item className="space-y-1">
                <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="font-semibold text-slate-700 dark:text-slate-200 truncate">{h.peer_name}</span>
                  <span>· {h.message.is_outgoing ? "you" : nameOf(h.message.sender_id)} · {new Date(h.message.timestamp * 1000).toLocaleDateString([], { day: "numeric", month: "short" })}</span>
                  {why && <span className="rounded-full bg-red-500/10 text-red-600 dark:text-red-400 px-2 py-0.5 text-[10px] font-bold">{why}</span>}
                  <button type="button" onClick={() => onOpen(h.message.conversation_id, h.message.id)} className="ml-auto inline-flex items-center gap-0.5 font-semibold text-sky-600 hover:underline">
                    Open in chat <ArrowUpRight className="h-3 w-3" />
                  </button>
                </div>
                <CardView
                  msg={h.message}
                  myId={myId}
                  nameOf={nameOf}
                  onChanged={changed}
                  onError={onError}
                  onStartMeeting={onStartMeeting}
                  onRemoteHelp={(convId) => onOpen(convId, h.message.id)}
                  wide
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
