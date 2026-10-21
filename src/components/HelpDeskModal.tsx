import { useEffect, useMemo, useState } from "react";
import { LifeBuoy, Loader2, Search, X } from "lucide-react";
import type { Conversation, Peer } from "../types";
import { api, errorText } from "../lib/api";
import { decodeCapture } from "./tools/ScreenshotEditor";

/** LANX 2.3.0 IT help desk: describe a computer problem and send it to your
 *  IT person as a ticket (with the PC's details and, if you like, a picture
 *  of the screen). They get it in their chat and can take over to help. */
export function HelpDeskModal({
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
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [withShot, setWithShot] = useState(true);
  const [helpers, setHelpers] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  // Colleagues you could ask (not yourself, not blocked).
  const people = useMemo(() => {
    const seen = new Set<string>();
    const out: { id: string; name: string; color: string; online: boolean }[] = [];
    for (const c of conversations) {
      if (c.kind === "direct" && c.peer_id && c.peer_id !== myId && !seen.has(c.peer_id)) {
        seen.add(c.peer_id);
        out.push({ id: c.peer_id, name: c.peer_name, color: c.peer_avatar_color, online: c.peer_status === "online" });
      }
    }
    for (const p of peers) {
      if (p.id !== myId && p.trust_state !== "blocked" && !seen.has(p.id)) {
        seen.add(p.id);
        out.push({ id: p.id, name: p.display_name, color: p.avatar_color, online: p.status === "online" });
      }
    }
    return out;
  }, [conversations, peers, myId]);

  // Pre-tick the saved IT helpers.
  useEffect(() => {
    api
      .getItHelpers()
      .then((ids) => {
        const known = ids.filter((id) => people.some((p) => p.id === id));
        if (known.length) setHelpers(known);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = people.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (id: string) => setHelpers((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id]));

  const send = async () => {
    if (!title.trim() || helpers.length === 0) return;
    setBusy(true);
    try {
      const info = await api.getSystemInfo().catch(() => null);
      const card = {
        kind: "ticket",
        title: title.trim(),
        details: details.trim(),
        helpers,
        pc: info?.hostname ?? "",
        app: info?.app_version ?? "",
        os: info?.os ?? "Windows",
        shot: withShot,
      };
      // One screenshot, sent to each helper's chat.
      let dataUrl: string | null = null;
      if (withShot) {
        try {
          const buf = await api.captureScreen();
          dataUrl = decodeCapture(buf).toDataURL("image/png");
        } catch {
          card.shot = false; // couldn't grab the screen — send the ticket anyway
        }
      }
      const convIds: string[] = [];
      for (const id of helpers) {
        try {
          const conv = await api.getOrCreateConversation(id);
          await api.sendCard(conv.id, card);
          if (dataUrl) await api.sendPastedImage(conv.id, dataUrl, "image/png").catch(() => {});
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm lanx-fade" onMouseDown={onClose}>
      <div
        data-helpdesk
        className="w-[460px] max-w-[94vw] max-h-[88vh] flex flex-col rounded-[22px] border border-black/5 bg-white shadow-2xl lanx-rise dark:border-white/10 dark:bg-slate-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4">
          <h3 className="flex items-center gap-2 text-[15px] font-bold text-slate-900 dark:text-white">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-rose-500 text-white">
              <LifeBuoy className="h-4 w-4" />
            </span>
            Get IT help
          </h3>
          <button type="button" onClick={onClose} className="lanx-tool p-1 text-slate-400">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3 space-y-3">
          <div>
            <label className="text-[11.5px] font-semibold text-slate-500 dark:text-slate-400">What's wrong?</label>
            <input
              autoFocus
              data-help-title
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Printer won't print, email not opening…"
              className="lanx-field mt-1 w-full rounded-[10px] px-3 py-2 text-[13px] text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="text-[11.5px] font-semibold text-slate-500 dark:text-slate-400">More details (optional)</label>
            <textarea
              data-help-details
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={2}
              placeholder="When did it start? Any message on screen?"
              className="lanx-field mt-1 w-full resize-none rounded-[10px] px-3 py-2 text-[13px] text-slate-900 dark:text-white"
            />
          </div>
          <label className="flex items-center gap-2 text-[12.5px] text-slate-700 dark:text-slate-200 cursor-pointer">
            <input type="checkbox" data-help-shot checked={withShot} onChange={(e) => setWithShot(e.target.checked)} className="accent-rose-500" />
            Send a picture of my screen now (helps them see the problem)
          </label>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-[11.5px] font-semibold text-slate-500 dark:text-slate-400">Send to</label>
              {helpers.length > 0 && <span className="text-[11px] text-rose-600 font-semibold">{helpers.length} chosen</span>}
            </div>
            <div className="relative mb-1.5">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search colleagues…"
                className="lanx-field w-full rounded-[10px] pl-8 pr-3 py-[7px] text-xs text-slate-900 dark:text-white"
              />
            </div>
            <div className="max-h-40 overflow-y-auto rounded-xl border lanx-line">
              {shown.length === 0 && <p className="py-5 text-center text-xs text-slate-400">Nobody found.</p>}
              {shown.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  data-help-person={p.name}
                  onClick={() => toggle(p.id)}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-[var(--lanx-fill)]"
                >
                  <span className="h-7 w-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0" style={{ backgroundColor: p.color }}>
                    {p.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[12.5px] font-semibold text-slate-900 dark:text-white truncate">{p.name}</span>
                    <span className="block text-[10px] text-slate-400">{p.online ? "Online" : "Offline — gets it when back"}</span>
                  </span>
                  <span className={`h-5 w-5 rounded-full border-2 flex items-center justify-center ${helpers.includes(p.id) ? "bg-rose-500 border-rose-500 text-white" : "border-slate-300 dark:border-slate-600"}`}>
                    {helpers.includes(p.id) && <span className="text-[11px]">✓</span>}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t lanx-line">
          <button type="button" onClick={onClose} className="px-4 py-1.5 rounded-full text-[12.5px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-[var(--lanx-fill)]">
            Cancel
          </button>
          <button
            type="button"
            data-help-send
            disabled={!title.trim() || helpers.length === 0 || busy}
            onClick={send}
            className="px-4 py-1.5 rounded-full bg-rose-500 hover:bg-rose-600 disabled:opacity-40 text-white text-[12.5px] font-semibold inline-flex items-center gap-1.5"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LifeBuoy className="h-3.5 w-3.5" />} Send to IT
          </button>
        </div>
      </div>
    </div>
  );
}
