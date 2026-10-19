import { useEffect, useState } from "react";
import { Star, StarOff, X } from "lucide-react";
import type { SearchHit } from "../../types";
import { api, errorText } from "../../lib/api";
import { Avatar } from "../Avatar";

/** LANX 1.5.0: every message you starred, from all chats. */
export function StarredModal({
  onClose,
  onOpen,
  onError,
}: {
  onClose: () => void;
  /** Open that chat at that message. */
  onOpen: (conversationId: string, messageId: string) => void;
  onError: (text: string) => void;
}) {
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  useEffect(() => {
    api
      .listStarred()
      .then(setHits)
      .catch((e) => {
        onError(errorText(e));
        setHits([]);
      });
  }, [onError]);

  const unstar = async (h: SearchHit) => {
    try {
      await api.starMessage(h.message.id, false);
      setHits((l) => (l ?? []).filter((x) => x.message.id !== h.message.id));
    } catch (e) {
      onError(errorText(e));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 lanx-scrim" onMouseDown={onClose}>
      <div
        data-starred-modal
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[80vh] flex flex-col rounded-[24px] lanx-sheet shadow-2xl lanx-rise"
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b lanx-line">
          <h2 className="inline-flex items-center gap-2 text-[15px] font-semibold text-slate-900 dark:text-white">
            <Star className="h-4 w-4 text-amber-500 fill-amber-500" /> Starred messages
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="h-8 w-8 rounded-full flex items-center justify-center text-slate-500 hover:bg-[var(--lanx-fill)]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {hits === null && <p className="p-6 text-center text-xs text-slate-400">Loading…</p>}
          {hits?.length === 0 && (
            <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
              <Star className="mx-auto mb-2 h-8 w-8 text-slate-300" />
              Nothing starred yet. Point at a message, press <b>⋯</b> and choose <b>Star</b> to keep it here.
            </div>
          )}
          {hits?.map((h) => (
            <div key={h.message.id} data-starred-item className="group flex items-start gap-3 rounded-2xl px-3 py-2 hover:bg-[var(--lanx-fill)]">
              <Avatar name={h.peer_name} color={h.peer_avatar_color} size={32} />
              <button type="button" onClick={() => onOpen(h.message.conversation_id, h.message.id)} className="min-w-0 flex-1 text-left">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12.5px] font-semibold text-slate-800 dark:text-slate-100 truncate">
                    {h.message.is_outgoing ? `You → ${h.peer_name}` : h.peer_name}
                  </span>
                  <span className="text-[10.5px] text-slate-400 shrink-0">
                    {new Date(h.message.timestamp * 1000).toLocaleDateString([], { day: "numeric", month: "short" })}
                  </span>
                </div>
                <div className="text-[12.5px] text-slate-600 dark:text-slate-300 line-clamp-2 break-words">{h.message.content}</div>
              </button>
              <button
                type="button"
                title="Unstar"
                onClick={() => unstar(h)}
                className="opacity-0 group-hover:opacity-100 h-7 w-7 rounded-full flex items-center justify-center text-slate-400 hover:text-amber-600"
              >
                <StarOff className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
