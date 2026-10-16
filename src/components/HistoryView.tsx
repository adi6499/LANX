import { useState } from "react";
import { Conversation } from "../types";
import { Search } from "lucide-react";

interface HistoryViewProps {
  conversations: Conversation[];
  onSelectConversation: (id: string) => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  conversations,
  onSelectConversation,
}) => {
  const [query, setQuery] = useState("");

  const filtered = conversations.filter(
    (c) =>
      c.peer_name.toLowerCase().includes(query.toLowerCase()) ||
      (c.last_message_preview &&
        c.last_message_preview.toLowerCase().includes(query.toLowerCase()))
  );

  return (
    <div className="flex-1 h-full flex flex-col bg-slate-50/50 dark:bg-[#080c14] overflow-hidden select-none">
      <div className="h-16 px-8 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c111c] flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            Message History & Archives
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Searchable transcripts persisted in local Windows SQLite storage
          </p>
        </div>

        <div className="relative w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all archived transcripts..."
            className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80 pl-9 pr-3 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8 max-w-4xl mx-auto w-full">
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Active Conversations
            </span>
            <div className="text-xl font-bold text-slate-900 dark:text-white mt-1">
              {conversations.length}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">Persisted in SQLite</p>
          </div>

          <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Storage Engine
            </span>
            <div className="text-xl font-bold text-sky-600 dark:text-sky-400 mt-1">
              SQLite WAL
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">Crash-resilient writes</p>
          </div>

          <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Privacy Mode
            </span>
            <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
              Local Only
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">0 bytes sent to cloud</p>
          </div>
        </div>

        <div className="space-y-3">
          {filtered.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelectConversation(c.id)}
              className="w-full text-left p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] hover:border-sky-500/40 hover:shadow-sm transition-all flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div
                  className="h-10 w-10 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0"
                  style={{ backgroundColor: c.peer_avatar_color }}
                >
                  {c.peer_name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                    {c.peer_name}
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1">
                    {c.last_message_preview || "Conversation initialized"}
                  </p>
                </div>
              </div>

              <div className="text-right text-[11px] text-slate-400 shrink-0 font-mono">
                {new Date(c.last_message_time * 1000).toLocaleDateString()}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
