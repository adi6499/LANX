import { useEffect, useState } from "react";
import { Conversation, Peer, SearchFilter, SearchHit } from "../types";
import { api } from "../lib/api";
import { stagger } from "../lib/motion";
import { Search, Paperclip, Link2, ClipboardList, X } from "lucide-react";
import { parseCard, KIND_LABEL } from "./org/cardModel";
import { storyColor } from "../lib/storybook";

interface HistoryViewProps {
  conversations: Conversation[];
  peers?: Peer[];
  /** LANX 1.7.0: start with this search (from the chat list's search box). */
  initialQuery?: string;
  onSelectConversation: (id: string) => void;
  /** LANX 1.7.0: open the chat at this message. */
  onOpenMessage?: (conversationId: string, messageId: string) => void;
}

type Kind = NonNullable<SearchFilter["kind"]>;
const KINDS: [Kind, string][] = [
  ["all", "Everything"],
  ["text", "Messages"],
  ["files", "Files"],
  ["links", "Links"],
  ["cards", "Notices & tasks"],
];
const WHEN: [string, string, number][] = [
  ["any", "Any time", 0],
  ["today", "Today", 0],
  ["week", "Past 7 days", 7],
  ["month", "Past 30 days", 30],
  ["year", "Past year", 365],
];

function sinceOf(when: string): number | null {
  if (when === "any") return null;
  if (when === "today") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return Math.floor(d.getTime() / 1000);
  }
  const days = WHEN.find((w) => w[0] === when)?.[2] ?? 0;
  return Math.floor(Date.now() / 1000) - days * 86400;
}

function highlight(text: string, query: string) {
  const q = query.trim();
  if (!q) return text.length > 160 ? `${text.slice(0, 160)}…` : text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text.length > 160 ? `${text.slice(0, 160)}…` : text;
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

/** What a card says, for the results list. */
function cardLine(h: SearchHit): string {
  const c = parseCard(h.message);
  if (!c) return "Card";
  const title = "title" in c ? c.title : "question" in c ? c.question : "name" in c ? c.name : "";
  return `${KIND_LABEL[c.kind]}: ${title}`;
}

export const HistoryView: React.FC<HistoryViewProps> = ({ conversations, peers = [], initialQuery = "", onSelectConversation, onOpenMessage }) => {
  const [query, setQuery] = useState(initialQuery);
  const [chat, setChat] = useState("");
  const [sender, setSender] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [when, setWhen] = useState("any");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const filtered = !!chat || !!sender || kind !== "all" || when !== "any";

  useEffect(() => setQuery(initialQuery), [initialQuery]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 && !filtered) {
      setHits(null);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      api
        .searchMessagesEx(q.length >= 2 ? q : "", { conversation_id: chat || null, sender: sender || null, kind, since: sinceOf(when) })
        .then(setHits)
        .catch(() => setHits([]))
        .finally(() => setSearching(false));
    }, 200);
    return () => clearTimeout(timer);
  }, [query, chat, sender, kind, when, filtered]);

  const select = "lanx-field rounded-lg px-2 py-1.5 text-[11.5px] text-slate-700 dark:text-slate-200";

  return (
    <div className="flex-1 h-full flex flex-col overflow-hidden select-none lanx-screen-in">
      <div className="h-16 px-8 border-b lanx-line lanx-bar flex items-center justify-between shrink-0 gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">History & search</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Search every message in every chat on this computer</p>
        </div>

        <div className="relative w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            autoFocus
            data-history-search
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search messages and file names…"
            className="w-full rounded-xl lanx-field pl-9 pr-3 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-sky-500 select-text"
          />
        </div>
      </div>

      {/* LANX 1.7.0: filters */}
      <div className="px-8 pt-3 pb-1 max-w-4xl mx-auto w-full flex flex-wrap items-center gap-1.5">
        {KINDS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            data-search-kind={k}
            onClick={() => setKind(k)}
            className={`px-2.5 py-1 rounded-full text-[11.5px] font-semibold transition-colors ${kind === k ? "bg-sky-500 text-white" : "bg-[var(--lanx-fill)] text-slate-600 dark:text-slate-300"}`}
          >
            {label}
          </button>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <select data-search-chat value={chat} onChange={(e) => setChat(e.target.value)} className={select}>
            <option value="">In every chat</option>
            {conversations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.peer_name}
              </option>
            ))}
          </select>
          <select data-search-sender value={sender} onChange={(e) => setSender(e.target.value)} className={select}>
            <option value="">From anyone</option>
            <option value="me">From me</option>
            {peers.map((p) => (
              <option key={p.id} value={p.id}>
                From {p.display_name}
              </option>
            ))}
          </select>
          <select data-search-when value={when} onChange={(e) => setWhen(e.target.value)} className={select}>
            {WHEN.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          {filtered && (
            <button
              type="button"
              title="Clear filters"
              onClick={() => {
                setChat("");
                setSender("");
                setKind("all");
                setWhen("any");
              }}
              className="lanx-tool p-1.5 text-slate-400"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-8 pt-3 max-w-4xl mx-auto w-full">
        {hits !== null ? (
          <>
            <p className="text-[11px] text-slate-400 mb-3">
              {searching
                ? "Searching…"
                : `${hits.length}${hits.length === 300 ? "+" : ""} result${hits.length === 1 ? "" : "s"}${query.trim().length >= 2 ? ` for “${query.trim()}”` : ""} · click one to open it in its chat`}
            </p>
            <div className="space-y-2">
              {hits.map((h, i) => (
                <button
                  key={h.message.id}
                  type="button"
                  data-search-hit={h.message.id}
                  onClick={() => (onOpenMessage ? onOpenMessage(h.message.conversation_id, h.message.id) : onSelectConversation(h.message.conversation_id))}
                  style={stagger(i, 30)}
                  className="w-full text-left p-3.5 rounded-2xl lanx-card lanx-lift lanx-item-in flex items-start gap-3"
                >
                  <div
                    className="h-8 w-8 rounded-full flex items-center justify-center text-white font-bold text-[11px] shrink-0"
                    style={{ backgroundColor: storyColor(h.peer_avatar_color) }}
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
                      {h.message.message_type === "card" && <ClipboardList className="h-3 w-3 mt-0.5 shrink-0" />}
                      {kind === "links" && <Link2 className="h-3 w-3 mt-0.5 shrink-0" />}
                      <span>{h.message.message_type === "card" ? cardLine(h) : highlight(h.message.content.replace(/^📎\s*/, ""), query)}</span>
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
              letters, or pick a filter above
            </p>
            <div className="space-y-2">
              {conversations.map((c, i) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelectConversation(c.id)}
                  style={stagger(i, 35)}
                  className="w-full text-left p-4 rounded-2xl lanx-card lanx-lift lanx-item-in flex items-center justify-between"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="h-10 w-10 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0"
                      style={{ backgroundColor: storyColor(c.peer_avatar_color) }}
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
