import { useMemo, useState } from "react";
import { Check, File, Folder, Search, Send, Users, X } from "lucide-react";
import type { Conversation, Peer } from "../../types";

/** LANX 1.7.0: files chosen in Explorer ("Send to → LANX"): pick who gets them. */
export function SendToModal({
  paths,
  conversations,
  peers,
  onSend,
  onClose,
}: {
  paths: string[];
  conversations: Conversation[];
  peers: Peer[];
  /** Sends to chats (ids) and to colleagues without a chat yet (peer ids). */
  onSend: (conversationIds: string[], peerIds: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const chats = conversations.filter((c) => !c.is_hidden && c.membership !== "left" && c.membership !== "removed");
  // Colleagues you haven't chatted with yet.
  const others = peers.filter((p) => p.trust_state !== "blocked" && !chats.some((c) => c.kind === "direct" && c.peer_id === p.id));
  const rows = useMemo(() => {
    const all = [
      ...chats.map((c) => ({ key: `c:${c.id}`, name: c.peer_name, color: c.peer_avatar_color, group: c.kind === "group", online: c.peer_status === "online" })),
      ...others.map((p) => ({ key: `p:${p.id}`, name: p.display_name, color: p.avatar_color, group: false, online: p.status === "online" })),
    ];
    return all.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()));
  }, [chats, others, q]);
  const toggle = (k: string) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  const name = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
  const isFolder = (p: string) => !/\.[a-z0-9]{1,6}$/i.test(name(p));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm lanx-fade" onMouseDown={onClose}>
      <div data-send-to className="w-[440px] max-w-[94vw] max-h-[86vh] flex flex-col rounded-[22px] lanx-menu shadow-2xl lanx-rise" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-4">
          <h3 className="text-[15px] font-bold text-slate-900 dark:text-white">Send with LANX</h3>
          <button type="button" onClick={onClose} className="lanx-tool p-1 text-slate-400">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 pt-2 space-y-1 max-h-28 overflow-y-auto">
          {paths.map((p) => (
            <div key={p} className="flex items-center gap-2 text-[12px] text-slate-600 dark:text-slate-300" title={p}>
              {isFolder(p) ? <Folder className="h-3.5 w-3.5 text-amber-500 shrink-0" /> : <File className="h-3.5 w-3.5 text-sky-500 shrink-0" />}
              <span className="truncate">{name(p)}</span>
            </div>
          ))}
        </div>
        <div className="px-5 pt-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Send to…"
              className="lanx-field w-full rounded-[10px] pl-8 pr-3 py-[7px] text-xs text-slate-900 dark:text-white"
            />
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
          {rows.length === 0 && <p className="py-6 text-center text-xs text-slate-400">Nobody found.</p>}
          {rows.map((r) => (
            <button
              key={r.key}
              type="button"
              data-send-to-row={r.key}
              onClick={() => toggle(r.key)}
              className="w-full flex items-center gap-3 px-2 py-1.5 rounded-xl text-left hover:bg-[var(--lanx-fill)]"
            >
              <span className={`h-8 w-8 ${r.group ? "rounded-[10px]" : "rounded-full"} flex items-center justify-center text-white text-[12px] font-bold shrink-0`} style={{ backgroundColor: r.color }}>
                {r.group ? <Users className="h-4 w-4" /> : r.name.charAt(0).toUpperCase()}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[12.5px] font-semibold text-slate-900 dark:text-white truncate">{r.name}</span>
                <span className="block text-[10.5px] text-slate-400">{r.group ? "Group" : r.online ? "Online" : "Offline — gets it when back"}</span>
              </span>
              <span className={`h-5 w-5 rounded-full border-2 flex items-center justify-center ${picked.includes(r.key) ? "bg-sky-500 border-sky-500 text-white" : "border-slate-300 dark:border-slate-600"}`}>
                {picked.includes(r.key) && <Check className="h-3 w-3" />}
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t lanx-line">
          <button type="button" onClick={onClose} className="px-4 py-1.5 rounded-full text-[12.5px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-[var(--lanx-fill)]">
            Cancel
          </button>
          <button
            type="button"
            data-send-to-go
            disabled={!picked.length || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSend(
                  picked.filter((k) => k.startsWith("c:")).map((k) => k.slice(2)),
                  picked.filter((k) => k.startsWith("p:")).map((k) => k.slice(2))
                );
              } finally {
                setBusy(false);
              }
            }}
            className="px-4 py-1.5 rounded-full bg-sky-500 hover:bg-sky-600 disabled:opacity-40 text-white text-[12.5px] font-semibold inline-flex items-center gap-1.5"
          >
            <Send className="h-3.5 w-3.5" /> Send{picked.length > 1 ? ` to ${picked.length}` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
