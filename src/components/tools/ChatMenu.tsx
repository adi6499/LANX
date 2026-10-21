import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Archive, ArchiveRestore, Bell, BellOff, Check, FolderPlus, MailOpen, MailWarning, Pin, PinOff, Plus, Trash2, X } from "lucide-react";
import type { ChatFolder, Conversation } from "../../types";
import { MUTE_CHOICES, isMuted, muteText } from "../../lib/tools";

/** LANX 1.7.0: what can be done with a chat from the chat list. */
export interface ChatTools {
  pin: (id: string, pinned: boolean) => void;
  mute: (id: string, minutes: number) => void;
  archive: (id: string, archived: boolean) => void;
  folders: (id: string, folders: string[]) => void;
  /** LANX 2.2.0: "Mark as unread" / "Mark as read". */
  unread?: (id: string, unread: boolean) => void;
}

/** Right-click menu of a chat in the chat list. */
export function ChatMenu({
  conv,
  folders,
  x,
  y,
  tools,
  onNewFolder,
  onClose,
}: {
  conv: Conversation;
  folders: ChatFolder[];
  x: number;
  y: number;
  tools: ChatTools;
  onNewFolder: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<"main" | "mute" | "folders">("main");
  const [pos, setPos] = useState({ left: x, top: y });
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  // Keep the menu on screen.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: Math.min(x, window.innerWidth - r.width - 8), top: Math.min(y, window.innerHeight - r.height - 8) });
  }, [x, y, page]);

  const muted = isMuted(conv);
  const inFolder = (id: string) => (conv.folders ?? []).includes(id);
  const item = "w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[12.5px] text-left text-slate-700 dark:text-slate-200 hover:bg-[var(--lanx-fill)]";
  const done = (f: () => void) => () => {
    f();
    onClose();
  };

  // Drawn at the top of the page, not inside the chat list: the list's glass
  // panel would otherwise cut the menu off at its edge.
  return createPortal(
    <div ref={ref} data-chat-menu style={{ left: pos.left, top: pos.top }} className="fixed z-50 w-60 rounded-[14px] lanx-menu p-1.5 shadow-xl lanx-menu-in">
      <div className="px-2.5 pt-1 pb-1.5 text-[11px] font-semibold text-slate-400 truncate">{conv.peer_name}</div>
      {page === "main" && (
        <>
          {tools.unread && (
            <button type="button" data-menu-unread className={item} onClick={done(() => tools.unread!(conv.id, conv.unread_count === 0))}>
              {conv.unread_count === 0 ? <MailWarning className="h-4 w-4 text-sky-500" /> : <MailOpen className="h-4 w-4 text-sky-500" />}
              {conv.unread_count === 0 ? "Mark as unread" : "Mark as read"}
            </button>
          )}
          <button type="button" data-menu-pin className={item} onClick={done(() => tools.pin(conv.id, !conv.is_pinned))}>
            {conv.is_pinned ? <PinOff className="h-4 w-4 text-amber-500" /> : <Pin className="h-4 w-4 text-amber-500" />}
            {conv.is_pinned ? "Unpin" : "Pin to the top"}
          </button>
          {muted ? (
            <button type="button" data-menu-unmute className={item} onClick={done(() => tools.mute(conv.id, 0))}>
              <Bell className="h-4 w-4 text-sky-500" />
              <span className="flex-1">Turn sounds back on</span>
            </button>
          ) : (
            <button type="button" data-menu-mute className={item} onClick={() => setPage("mute")}>
              <BellOff className="h-4 w-4 text-slate-500" />
              <span className="flex-1">Mute…</span>
            </button>
          )}
          {muted && <div className="px-2.5 -mt-0.5 pb-1 text-[10.5px] text-slate-400">{muteText(conv)}</div>}
          <button type="button" data-menu-folders className={item} onClick={() => setPage("folders")}>
            <FolderPlus className="h-4 w-4 text-indigo-500" />
            <span className="flex-1">Chat folders…</span>
            {(conv.folders ?? []).length > 0 && <span className="text-[10.5px] text-slate-400">{(conv.folders ?? []).length}</span>}
          </button>
          <button type="button" data-menu-archive className={item} onClick={done(() => tools.archive(conv.id, !conv.archived))}>
            {conv.archived ? <ArchiveRestore className="h-4 w-4 text-emerald-500" /> : <Archive className="h-4 w-4 text-slate-500" />}
            {conv.archived ? "Move back to chats" : "Archive"}
          </button>
        </>
      )}
      {page === "mute" && (
        <>
          <div className="px-2.5 pb-1 text-[11px] text-slate-500 dark:text-slate-400 leading-snug">No sounds or pop-ups from this chat. Messages still arrive.</div>
          {MUTE_CHOICES.map(([m, label]) => (
            <button key={m} type="button" data-mute-for={m} className={item} onClick={done(() => tools.mute(conv.id, m))}>
              <BellOff className="h-3.5 w-3.5 text-slate-400" /> {label}
            </button>
          ))}
          <button type="button" className={`${item} text-slate-400`} onClick={() => setPage("main")}>
            ← Back
          </button>
        </>
      )}
      {page === "folders" && (
        <>
          {folders.length === 0 && <div className="px-2.5 pb-1.5 text-[11px] text-slate-500 leading-snug">No folders yet. Make one, e.g. “Clients” or “Site team”.</div>}
          {folders.map((f) => (
            <button
              key={f.id}
              type="button"
              data-folder-toggle={f.id}
              className={item}
              onClick={() => {
                const next = inFolder(f.id) ? (conv.folders ?? []).filter((x) => x !== f.id) : [...(conv.folders ?? []), f.id];
                tools.folders(conv.id, next);
              }}
            >
              <span className={`h-4 w-4 rounded border flex items-center justify-center ${inFolder(f.id) ? "bg-indigo-500 border-indigo-500 text-white" : "border-slate-300 dark:border-slate-600"}`}>
                {inFolder(f.id) && <Check className="h-3 w-3" />}
              </span>
              <span className="flex-1 truncate">{f.name}</span>
            </button>
          ))}
          <button type="button" className={`${item} text-indigo-600 dark:text-indigo-300`} onClick={done(onNewFolder)}>
            <Plus className="h-4 w-4" /> New folder…
          </button>
          <button type="button" className={`${item} text-slate-400`} onClick={() => setPage("main")}>
            ← Back
          </button>
        </>
      )}
    </div>,
    document.body
  );
}

/** Make, rename and delete chat folders. */
export function ChatFoldersModal({
  folders,
  onSave,
  onClose,
}: {
  folders: ChatFolder[];
  onSave: (list: ChatFolder[]) => void;
  onClose: () => void;
}) {
  const [list, setList] = useState<ChatFolder[]>(folders);
  const [name, setName] = useState("");
  const add = () => {
    const n = name.trim().slice(0, 30);
    if (!n || list.length >= 20) return;
    setList([...list, { id: `f-${Date.now().toString(36)}`, name: n }]);
    setName("");
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm lanx-fade" onMouseDown={onClose}>
      <div data-folders-modal className="w-[380px] max-w-[92vw] rounded-[20px] lanx-menu p-5 shadow-2xl lanx-rise" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-[15px] font-bold text-slate-900 dark:text-white">Chat folders</h3>
          <button type="button" onClick={onClose} className="lanx-tool p-1 text-slate-400">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-[12px] text-slate-500 dark:text-slate-400 mb-3">Group your chats, e.g. “Clients”, “Site team”. Right-click a chat to put it in a folder.</p>
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {list.map((f, i) => (
            <div key={f.id} className="flex items-center gap-2">
              <input
                value={f.name}
                maxLength={30}
                onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                className="lanx-field flex-1 rounded-lg px-2.5 py-1.5 text-[12.5px] text-slate-900 dark:text-white"
              />
              <button type="button" title="Delete folder (the chats stay)" onClick={() => setList(list.filter((_, j) => j !== i))} className="lanx-tool p-1.5 text-red-500">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-3">
          <input
            data-new-folder-name
            autoFocus
            value={name}
            maxLength={30}
            placeholder="New folder name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            className="lanx-field flex-1 rounded-lg px-2.5 py-1.5 text-[12.5px] text-slate-900 dark:text-white"
          />
          <button type="button" data-add-folder onClick={add} disabled={!name.trim()} className="px-3 py-1.5 rounded-full bg-indigo-500 text-white text-[12px] font-semibold disabled:opacity-40">
            Add
          </button>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="px-4 py-1.5 rounded-full text-[12.5px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-[var(--lanx-fill)]">
            Cancel
          </button>
          <button
            type="button"
            data-save-folders
            onClick={() => onSave(list.map((f) => ({ ...f, name: f.name.trim() })).filter((f) => f.name))}
            className="px-4 py-1.5 rounded-full bg-sky-500 hover:bg-sky-600 text-white text-[12.5px] font-semibold"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
