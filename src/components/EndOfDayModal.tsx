import { useEffect, useMemo, useState } from "react";
import { ClipboardList, Loader2, Search, X } from "lucide-react";
import type { Conversation, Peer } from "../types";
import { api, errorText } from "../lib/api";

/** LANX 2.4.0: a short end-of-day / shift-handover report — what you did,
 *  what's pending, any blockers — sent to your manager(s). */
export function EndOfDayModal({
  conversations,
  peers,
  myId,
  onClose,
  onSent,
  onError,
}: {
  conversations: Conversation[];
  peers: Peer[];
  myId: string;
  onClose: () => void;
  onSent: (conversationIds: string[]) => void;
  onError: (text: string) => void;
}) {
  const [done, setDone] = useState("");
  const [pending, setPending] = useState("");
  const [blockers, setBlockers] = useState("");
  const [to, setTo] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const people = useMemo(() => {
    const seen = new Set<string>();
    const out: { id: string; name: string; color: string; online: boolean }[] = [];
    for (const c of conversations)
      if (c.kind === "direct" && c.peer_id && c.peer_id !== myId && !seen.has(c.peer_id)) {
        seen.add(c.peer_id);
        out.push({ id: c.peer_id, name: c.peer_name, color: c.peer_avatar_color, online: c.peer_status === "online" });
      }
    for (const p of peers)
      if (p.id !== myId && p.trust_state !== "blocked" && !seen.has(p.id)) {
        seen.add(p.id);
        out.push({ id: p.id, name: p.display_name, color: p.avatar_color, online: p.status === "online" });
      }
    return out;
  }, [conversations, peers, myId]);

  // Pre-tick the saved IT helpers only if they happen to be managers? No —
  // leave blank; managers are chosen per team. But do pre-tick a saved list.
  useEffect(() => {
    api
      .getReportTo()
      .then((ids) => {
        const known = ids.filter((id) => people.some((p) => p.id === id));
        if (known.length) setTo(known);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = people.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (id: string) => setTo((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  const ready = (done.trim() || pending.trim() || blockers.trim()) && to.length > 0;

  const send = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      await api.setReportTo(to).catch(() => {}); // remember for next time
      const card = {
        kind: "report",
        to,
        done: done.trim(),
        pending: pending.trim(),
        blockers: blockers.trim(),
        day: Math.floor(Date.now() / 1000),
      };
      const convIds: string[] = [];
      for (const id of to) {
        try {
          const conv = await api.getOrCreateConversation(id);
          await api.sendCard(conv.id, card);
          convIds.push(conv.id);
        } catch (e) {
          onError(errorText(e));
        }
      }
      if (convIds.length) onSent(convIds);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, value: string, set: (v: string) => void, placeholder: string, attr: string) => (
    <div>
      <label className="text-[11.5px] font-semibold text-slate-500 dark:text-slate-400">{label}</label>
      <textarea
        data-report-field={attr}
        value={value}
        onChange={(e) => set(e.target.value)}
        rows={2}
        placeholder={placeholder}
        className="lanx-field mt-1 w-full resize-none rounded-[10px] px-3 py-2 text-[13px] text-slate-900 dark:text-white"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm lanx-fade" onMouseDown={onClose}>
      <div
        data-endofday
        className="w-[460px] max-w-[94vw] max-h-[90vh] flex flex-col rounded-[22px] border border-black/5 bg-white shadow-2xl lanx-rise dark:border-white/10 dark:bg-slate-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4">
          <h3 className="flex items-center gap-2 text-[15px] font-bold text-slate-900 dark:text-white">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-600 text-white">
              <ClipboardList className="h-4 w-4" />
            </span>
            End-of-day report
          </h3>
          <button type="button" onClick={onClose} className="lanx-tool p-1 text-slate-400">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3 space-y-3">
          {field("What I did today", done, setDone, "Jobs finished, sent, handled…", "done")}
          {field("Still to do", pending, setPending, "What's left for tomorrow", "pending")}
          {field("Anything stuck? (optional)", blockers, setBlockers, "Waiting on someone, a problem…", "blockers")}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-[11.5px] font-semibold text-slate-500 dark:text-slate-400">Send to (your manager)</label>
              {to.length > 0 && <span className="text-[11px] text-slate-600 font-semibold">{to.length} chosen</span>}
            </div>
            <div className="relative mb-1.5">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search colleagues…" className="lanx-field w-full rounded-[10px] pl-8 pr-3 py-[7px] text-xs text-slate-900 dark:text-white" />
            </div>
            <div className="max-h-36 overflow-y-auto rounded-xl border lanx-line">
              {shown.map((p) => (
                <button key={p.id} type="button" data-report-person={p.name} onClick={() => toggle(p.id)} className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-[var(--lanx-fill)]">
                  <span className="h-7 w-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0" style={{ backgroundColor: p.color }}>
                    {p.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="flex-1 min-w-0 text-[12.5px] font-semibold text-slate-900 dark:text-white truncate">{p.name}</span>
                  <span className={`h-5 w-5 rounded-full border-2 flex items-center justify-center ${to.includes(p.id) ? "bg-slate-600 border-slate-600 text-white" : "border-slate-300 dark:border-slate-600"}`}>
                    {to.includes(p.id) && <span className="text-[11px]">✓</span>}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t lanx-line">
          <button type="button" onClick={onClose} className="px-4 py-1.5 rounded-full text-[12.5px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-[var(--lanx-fill)]">Cancel</button>
          <button type="button" data-report-send disabled={!ready || busy} onClick={send} className="px-4 py-1.5 rounded-full bg-slate-700 hover:bg-slate-800 disabled:opacity-40 text-white text-[12.5px] font-semibold inline-flex items-center gap-1.5">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardList className="h-3.5 w-3.5" />} Send report
          </button>
        </div>
      </div>
    </div>
  );
}
