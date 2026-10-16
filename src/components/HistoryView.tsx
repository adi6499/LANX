import { useEffect, useState } from "react";
import { Conversation, SearchHit } from "../types";
import { api } from "../lib/api";
import { Search, Paperclip } from "lucide-react";

interface HistoryViewProps {
  conversations: Conversation[];
  onSelectConversation: (id: string) => void;
}

function highlight(text: string, query: string) {
  const q = query.trim();
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  const start = Math.max(0, i - 50);
  const before = (start > 0 ? "…" : "") + text.slice(start, i);
  const match = text.slice(i, i + q.length);
  const after = text.slice(i + q.length, i + q.length + 90);
  return (
    <>
      {before}
      <mark className="bg-amber-200/80 dark:bg-amber-500/30 text-inherit rounded px-0.5">{match}</mark>
      {after}
      {i + q.length + 90 < text.length ? "…" : ""}
    </>
  );
}

export const HistoryView: React.FC<HistoryViewProps> = ({ conversations, onSelectConversation }) => {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits(null);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      api
        .searchMessages(q)
        .then(setHits)
        .catch(() => setHits([]))
        .finally(() => setSearching(false));
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="flex-1 h-full flex flex-col bg-slate-50/50 dark:bg-[#080c14] overflow-hidden select-none">
      <div className="h-16 px-8 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c111c] flex items-center justify-between shrink-0 gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">History & search</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Search every message in every chat on this computer</p>
        </div>

        <div className="relative w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search messages and file names…"
            className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80 pl-9 pr-3 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-sky-500 select-text"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8 max-w-4xl mx-auto w-full">
        {hits !== null ? (
          <>
            <p className="text-[11px] text-slate-400 mb-3">
              {searching ? "Searching…" : `${hits.length}${hits.length === 200 ? "+" : ""} result${hits.length === 1 ? "" : "s"} for “${query.trim()}”`}
            </p>
            <div className="space-y-2">
              {hits.map((h) => (
                <button
                  key={h.message.id}
                  type="button"
                  onClick={() => onSelectConversation(h.message.conversation_id)}
                  className="w-full text-left p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] hover:border-sky-500/40 transition-all flex items-start gap-3"
                >
                  <div
                    className="h-8 w-8 rounded-full flex items-center justify-center text-white font-bold text-[11px] shrink-0"
                    style={{ backgroundColor: h.peer_avatar_color }}
                  >
                    {h.peer_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-bold text-slate-900 dark:text-white">
                        {h.message.is_outgoing ? `You → ${h.peer_name}` : h.peer_name}
                      </span>
                      <span className="text-slate-400 font-mono">
                        {new Date(h.message.timestamp * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 break-words flex items-start gap-1">
                      {h.message.message_type === "file" && <Paperclip className="h-3 w-3 mt-0.5 shrink-0" />}
                      <span>{highlight(h.message.content.replace(/^📎\s*/, ""), query)}</span>
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="text-[11px] text-slate-400 mb-3">
              {conversations.length} chat{conversations.length === 1 ? "" : "s"} stored on this computer · type at least 2
              letters to search
            </p>
            <div className="space-y-2">
              {conversations.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelectConversation(c.id)}
                  className="w-full text-left p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] hover:border-sky-500/40 hover:shadow-sm transition-all flex items-center justify-between"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="h-10 w-10 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0"
                      style={{ backgroundColor: c.peer_avatar_color }}
                    >
                      {c.peer_name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-xs font-bold text-slate-900 dark:text-white">{c.peer_name}</h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                        {c.last_message_preview || "No messages yet"}
                      </p>
                    </div>
                  </div>
                  <div className="text-right text-[11px] text-slate-400 shrink-0 font-mono">
                    {new Date(c.last_message_time * 1000).toLocaleDateString()}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
