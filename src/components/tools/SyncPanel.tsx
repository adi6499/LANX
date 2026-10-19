import { useCallback, useEffect, useState } from "react";
import { FolderOpen, FolderSync, MessageSquare, RefreshCw, StopCircle } from "lucide-react";
import type { Conversation, SyncOverview } from "../../types";
import { api, errorText, events } from "../../lib/api";
import { formatSize } from "../../lib/format";

/** LANX 1.7.0: shared folders — what you share and what you get. */

/** Shared-folder state for cards and the panel (one copy, follows changes live). */
let syncData: SyncOverview = { shares: [], subscriptions: [] };
const syncListeners = new Set<(d: SyncOverview) => void>();
let syncStop: (() => void) | null = null;
function loadSync() {
  api
    .listSync()
    .then((d) => {
      syncData = d;
      syncListeners.forEach((f) => f(d));
    })
    .catch(() => {});
}
export function useSync(): [SyncOverview, () => void] {
  const [data, setData] = useState<SyncOverview>(syncData);
  useEffect(() => {
    syncListeners.add(setData);
    if (!syncStop) {
      let un: (() => void) | undefined;
      let gone = false;
      events.onSyncChanged(loadSync).then((u) => (gone ? u() : (un = u)));
      const t = setInterval(loadSync, 15_000);
      syncStop = () => {
        gone = true;
        un?.();
        clearInterval(t);
      };
    }
    loadSync();
    return () => {
      syncListeners.delete(setData);
      if (!syncListeners.size && syncStop) {
        syncStop();
        syncStop = null;
      }
    };
  }, []);
  const reload = useCallback(loadSync, []);
  return [data, reload];
}

export function ago(ts: number): string {
  if (!ts) return "nothing yet";
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ts * 1000).toLocaleDateString([], { day: "numeric", month: "short" });
}

/** A red button that asks once more before it acts (no pop-up windows). */
export function ConfirmButton({ label, ask, onYes, className, ...rest }: { label: React.ReactNode; ask: string; onYes: () => void; className: string; [k: `data-${string}`]: unknown }) {
  const [sure, setSure] = useState(false);
  if (!sure)
    return (
      <button type="button" {...rest} onClick={() => setSure(true)} className={className}>
        {label}
      </button>
    );
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-[11.5px] text-slate-600 dark:text-slate-300">
      {ask}
      <button type="button" data-confirm-yes onClick={() => { setSure(false); onYes(); }} className="px-2.5 py-1 rounded-full bg-red-500 text-white font-semibold">
        Yes
      </button>
      <button type="button" onClick={() => setSure(false)} className="px-2.5 py-1 rounded-full lanx-btn font-semibold">
        No
      </button>
    </span>
  );
}

export function SyncPanel({
  conversations,
  modeSwitch,
  onOpenChat,
  onError,
}: {
  conversations: Conversation[];
  modeSwitch: React.ReactNode;
  onOpenChat: (conversationId: string) => void;
  onError: (text: string) => void;
}) {
  const [data, reload] = useSync();
  const chatName = (id: string) => conversations.find((c) => c.id === id)?.peer_name ?? "a chat";
  const run = (p: Promise<unknown>) => p.then(reload).catch((e) => onError(errorText(e)));
  const btn = "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11.5px] font-semibold transition-colors";

  return (
    <div data-sync-panel className="flex-1 h-full flex flex-col overflow-hidden select-none lanx-screen-in">
      <div className="h-16 px-8 border-b lanx-line lanx-bar flex items-center shrink-0 gap-3">
        <h2 className="text-base font-bold text-slate-900 dark:text-white">Files</h2>
        {modeSwitch}
      </div>
      <div className="flex-1 overflow-y-auto p-8 max-w-4xl mx-auto w-full space-y-8">
        <div className="rounded-2xl bg-sky-500/10 px-4 py-3 text-[12px] text-sky-800 dark:text-sky-200 leading-relaxed">
          <b>Shared folders stay up to date.</b> In a chat, press <b>+</b> → <b>Share a folder</b>. Colleagues press <b>Get this folder</b> and choose where it goes.
          New and changed files reach them by themselves (checked every 30 seconds, while both computers are on). Nothing is ever deleted on their side.
        </div>

        <section>
          <h3 className="text-[12px] font-bold uppercase tracking-wide text-slate-400 mb-2">Folders you share</h3>
          {data.shares.length === 0 ? (
            <p className="text-xs text-slate-400">You're not sharing any folder.</p>
          ) : (
            <div className="space-y-2">
              {data.shares.map((s) => (
                <div key={s.id} data-sync-share={s.id} className="rounded-2xl lanx-card p-3.5 flex items-start gap-3">
                  <span className="h-10 w-10 rounded-xl bg-amber-500/15 text-amber-600 flex items-center justify-center shrink-0">
                    <FolderSync className="h-5 w-5" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-slate-900 dark:text-white truncate">{s.name}</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate" title={s.path}>
                      {s.path}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Shared in {chatName(s.conversation_id)} ·{" "}
                      {s.subscribers.length ? `${s.subscribers.join(", ")} ${s.subscribers.length === 1 ? "gets" : "get"} it` : "nobody gets it yet"}
                      {s.waiting > 0 && <span className="text-sky-600 dark:text-sky-400"> · {s.waiting} file{s.waiting === 1 ? "" : "s"} on the way</span>}
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <button type="button" onClick={() => run(api.openSyncFolder(s.id))} className={`${btn} lanx-btn text-slate-700 dark:text-slate-200`}>
                        <FolderOpen className="h-3.5 w-3.5" /> Open
                      </button>
                      <button type="button" onClick={() => onOpenChat(s.conversation_id)} className={`${btn} lanx-btn text-slate-700 dark:text-slate-200`}>
                        <MessageSquare className="h-3.5 w-3.5" /> Chat
                      </button>
                      <button type="button" title="Send every file again (if a colleague lost their copy)" onClick={() => run(api.resyncFolder(s.id))} className={`${btn} lanx-btn text-slate-700 dark:text-slate-200`}>
                        <RefreshCw className="h-3.5 w-3.5" /> Send everything again
                      </button>
                      <ConfirmButton
                        data-sync-stop-share
                        label={<><StopCircle className="h-3.5 w-3.5" /> Stop sharing</>}
                        ask="Stop sharing? Colleagues keep what they have."
                        onYes={() => run(api.stopSharingFolder(s.id))}
                        className={`${btn} text-red-600 hover:bg-red-500/10`}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h3 className="text-[12px] font-bold uppercase tracking-wide text-slate-400 mb-2">Folders you get</h3>
          {data.subscriptions.length === 0 ? (
            <p className="text-xs text-slate-400">When a colleague shares a folder in a chat, press “Get this folder” on it.</p>
          ) : (
            <div className="space-y-2">
              {data.subscriptions.map((s) => (
                <div key={s.share_id} data-sync-sub={s.share_id} className="rounded-2xl lanx-card p-3.5 flex items-start gap-3">
                  <span className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${s.status === "active" ? "bg-emerald-500/15 text-emerald-600" : "bg-slate-500/15 text-slate-500"}`}>
                    <FolderSync className="h-5 w-5" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-slate-900 dark:text-white truncate">
                      {s.name} <span className="font-normal text-slate-400">from {s.owner_name}</span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate" title={s.dest_path}>
                      Saved in {s.dest_path}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {s.status === "active"
                        ? `${s.files} file${s.files === 1 ? "" : "s"} received (${formatSize(s.bytes)}) · last ${ago(s.last_at)}`
                        : `${s.owner_name} stopped sharing it. Your copy stays.`}
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <button type="button" onClick={() => run(api.openSyncFolder(s.share_id))} className={`${btn} lanx-btn text-slate-700 dark:text-slate-200`}>
                        <FolderOpen className="h-3.5 w-3.5" /> Open
                      </button>
                      <button type="button" onClick={() => onOpenChat(s.conversation_id)} className={`${btn} lanx-btn text-slate-700 dark:text-slate-200`}>
                        <MessageSquare className="h-3.5 w-3.5" /> Chat
                      </button>
                      <ConfirmButton
                        data-sync-unsubscribe
                        label={<><StopCircle className="h-3.5 w-3.5" /> {s.status === "active" ? "Stop getting it" : "Remove from list"}</>}
                        ask="Stop getting it? The files already here stay."
                        onYes={() => run(api.unsubscribeFolder(s.share_id))}
                        className={`${btn} text-red-600 hover:bg-red-500/10`}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
