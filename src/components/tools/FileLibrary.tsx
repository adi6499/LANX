import { useEffect, useMemo, useState } from "react";
import { FileArchive, FileAudio, FileImage, FileSpreadsheet, FileText, FileVideo, File as FileIcon, FolderOpen, MessageSquare, Presentation, Search, Folder } from "lucide-react";
import type { Conversation, TransferRecord } from "../../types";
import { api } from "../../lib/api";
import { formatSize } from "../../lib/format";
import { fileKind, type FileKind } from "../../lib/tools";
import { stagger } from "../../lib/motion";

/** LANX 1.7.0: every file sent or received, by type, person and chat. */

type TypeFilter = "all" | "pictures" | "documents" | "sheets" | "videos" | "audio" | "zips" | "other";
const TYPE_LABEL: [TypeFilter, string][] = [
  ["all", "All"],
  ["pictures", "Pictures"],
  ["documents", "Documents & PDFs"],
  ["sheets", "Spreadsheets"],
  ["videos", "Videos"],
  ["audio", "Audio & voice"],
  ["zips", "Zip & folders"],
  ["other", "Other"],
];
const ICON: Record<FileKind, [React.ElementType, string]> = {
  image: [FileImage, "text-pink-500 bg-pink-500/10"],
  pdf: [FileText, "text-red-500 bg-red-500/10"],
  doc: [FileText, "text-sky-600 bg-sky-500/10"],
  sheet: [FileSpreadsheet, "text-emerald-600 bg-emerald-500/10"],
  slides: [Presentation, "text-orange-500 bg-orange-500/10"],
  video: [FileVideo, "text-violet-500 bg-violet-500/10"],
  audio: [FileAudio, "text-amber-500 bg-amber-500/10"],
  archive: [FileArchive, "text-slate-600 bg-slate-500/10"],
  other: [FileIcon, "text-slate-500 bg-slate-500/10"],
};
const PAGE = 60;

function typeOf(t: TransferRecord): TypeFilter {
  if (t.kind === "voice") return "audio";
  if (t.kind === "folder") return "zips";
  switch (fileKind(t.file_name)) {
    case "image":
      return "pictures";
    case "pdf":
    case "doc":
    case "slides":
      return "documents";
    case "sheet":
      return "sheets";
    case "video":
      return "videos";
    case "audio":
      return "audio";
    case "archive":
      return "zips";
    default:
      return "other";
  }
}

function Thumb({ t }: { t: TransferRecord }) {
  const kind = t.kind === "folder" ? "archive" : t.kind === "voice" ? "audio" : fileKind(t.file_name);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (kind !== "image") return;
    let alive = true;
    api
      .getImagePreview(t.id)
      .then((u) => alive && setSrc(u))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [t.id, kind]);
  if (src) return <img src={src} alt="" className="h-full w-full object-cover" />;
  const [I, tone] = t.kind === "folder" ? [Folder, "text-amber-500 bg-amber-500/10"] : ICON[kind];
  return (
    <div className={`h-full w-full flex items-center justify-center ${tone}`}>
      <I className="h-9 w-9" />
    </div>
  );
}

export function FileLibrary({
  transfers,
  conversations,
  modeSwitch,
  onOpen,
  onReveal,
  onShowInChat,
}: {
  transfers: TransferRecord[];
  conversations: Conversation[];
  modeSwitch: React.ReactNode;
  onOpen: (id: string) => void;
  onReveal: (id: string) => void;
  onShowInChat: (transferId: string) => void;
}) {
  const [type, setType] = useState<TypeFilter>("all");
  const [chat, setChat] = useState("");
  const [dir, setDir] = useState<"" | "incoming" | "outgoing">("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"new" | "big" | "name">("new");
  const [limit, setLimit] = useState(PAGE);

  // Finished files that are on this computer (one entry per group file).
  const files = useMemo(() => {
    const seen = new Set<string>();
    return transfers.filter((t) => {
      if (t.status !== "completed" || !t.local_path || t.kind === "update" || t.kind === "sync") return false;
      if (t.parent_id) {
        if (seen.has(t.parent_id)) return false;
        seen.add(t.parent_id);
      }
      return true;
    });
  }, [transfers]);
  const chatName = (id?: string | null) => conversations.find((c) => c.id === id)?.peer_name ?? "";
  const chatsWithFiles = useMemo(() => conversations.filter((c) => files.some((f) => f.conversation_id === c.id)), [conversations, files]);
  const counts = useMemo(() => {
    const m: Record<string, number> = { all: files.length };
    for (const f of files) m[typeOf(f)] = (m[typeOf(f)] ?? 0) + 1;
    return m;
  }, [files]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = files.filter(
      (f) =>
        (type === "all" || typeOf(f) === type) &&
        (!chat || f.conversation_id === chat) &&
        (!dir || f.direction === dir) &&
        (!needle || f.file_name.toLowerCase().includes(needle))
    );
    const when = (f: TransferRecord) => f.completed_at ?? f.created_at;
    list.sort((a, b) => (sort === "big" ? b.file_size - a.file_size : sort === "name" ? a.file_name.localeCompare(b.file_name) : when(b) - when(a)));
    return list;
  }, [files, type, chat, dir, q, sort]);

  useEffect(() => setLimit(PAGE), [type, chat, dir, q, sort]);
  const total = shown.reduce((n, f) => n + f.file_size, 0);
  const select = "lanx-field rounded-lg px-2 py-1.5 text-[11.5px] text-slate-700 dark:text-slate-200";

  return (
    <div data-file-library className="flex-1 h-full flex flex-col overflow-hidden select-none lanx-screen-in">
      <div className="h-16 px-8 border-b lanx-line lanx-bar flex items-center justify-between shrink-0 gap-4">
        <div className="min-w-0 flex items-center gap-3">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Files</h2>
          {modeSwitch}
        </div>
        <div className="relative w-64 shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            data-library-search
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a file by name…"
            className="w-full rounded-xl lanx-field pl-9 pr-3 py-1.5 text-xs text-slate-900 dark:text-white select-text"
          />
        </div>
      </div>

      <div className="px-8 pt-4 pb-2 flex flex-wrap items-center gap-1.5">
        {TYPE_LABEL.map(([k, label]) => (
          <button
            key={k}
            type="button"
            data-library-type={k}
            onClick={() => setType(k)}
            className={`px-2.5 py-1 rounded-full text-[11.5px] font-semibold transition-colors ${type === k ? "bg-sky-500 text-white" : "bg-[var(--lanx-fill)] text-slate-600 dark:text-slate-300"}`}
          >
            {label}
            {counts[k] ? <span className="ml-1 opacity-70">{counts[k]}</span> : null}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1.5">
          <select data-library-chat value={chat} onChange={(e) => setChat(e.target.value)} className={select}>
            <option value="">Every chat</option>
            {chatsWithFiles.map((c) => (
              <option key={c.id} value={c.id}>
                {c.peer_name}
              </option>
            ))}
          </select>
          <select value={dir} onChange={(e) => setDir(e.target.value as typeof dir)} className={select}>
            <option value="">Sent & received</option>
            <option value="incoming">Received</option>
            <option value="outgoing">Sent</option>
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={select}>
            <option value="new">Newest first</option>
            <option value="big">Biggest first</option>
            <option value="name">By name</option>
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-8">
        <p className="text-[11px] text-slate-400 mb-3">
          {shown.length} file{shown.length === 1 ? "" : "s"} · {formatSize(total)}
        </p>
        {shown.length === 0 ? (
          <div className="py-16 text-center text-xs text-slate-400">No files here yet.</div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))" }}>
            {shown.slice(0, limit).map((f, i) => (
              <div key={f.id} data-library-file={f.id} style={stagger(i % PAGE, 12)} className="group rounded-2xl lanx-card overflow-hidden lanx-item-in flex flex-col">
                <button type="button" title="Open" onClick={() => onOpen(f.id)} className="h-28 w-full overflow-hidden">
                  <Thumb t={f} />
                </button>
                <div className="p-2.5 flex-1 flex flex-col">
                  <div className="text-[12px] font-semibold text-slate-900 dark:text-white truncate" title={f.file_name}>
                    {f.file_name}
                  </div>
                  <div className="text-[10.5px] text-slate-400 truncate">
                    {formatSize(f.file_size)} · {new Date((f.completed_at ?? f.created_at) * 1000).toLocaleDateString([], { day: "numeric", month: "short" })}
                  </div>
                  <div className="text-[10.5px] text-slate-500 dark:text-slate-400 truncate">
                    {f.direction === "incoming" ? `From ${f.peer_name ?? chatName(f.conversation_id)}` : `To ${chatName(f.conversation_id) || f.peer_name || "?"}`}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                    <button type="button" title="Show in folder" onClick={() => onReveal(f.id)} className="lanx-tool p-1 text-slate-500">
                      <FolderOpen className="h-3.5 w-3.5" />
                    </button>
                    {f.conversation_id && (
                      <button type="button" data-library-chat-jump title="Show in chat" onClick={() => onShowInChat(f.id)} className="lanx-tool p-1 text-slate-500">
                        <MessageSquare className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {shown.length > limit && (
          <div className="flex justify-center pt-4">
            <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="px-4 py-1.5 rounded-full lanx-btn text-[12px] font-semibold text-slate-700 dark:text-slate-200">
              Show more ({shown.length - limit})
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
