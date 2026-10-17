import React, { useState } from "react";
import { TransferActions, TransferProgress, TransferRecord } from "../types";
import { ArrowDownLeft, ArrowUpRight, FolderOpen, Inbox, ShieldCheck, Eraser } from "lucide-react";
import { FileCard } from "./FileCard";
import { formatSize } from "../lib/format";
import { stagger } from "../lib/motion";

interface TransfersViewProps {
  transfers: TransferRecord[];
  progress: Record<string, TransferProgress>;
  actions: TransferActions;
  onOpenDownloads: () => void;
  onClearFinished: () => void;
}

type Filter = "all" | "active" | "incoming" | "outgoing";

const ACTIVE = ["queued", "pending", "transferring", "failed"];

export const TransfersView: React.FC<TransfersViewProps> = ({
  transfers,
  progress,
  actions,
  onOpenDownloads,
  onClearFinished,
}) => {
  const [filter, setFilter] = useState<Filter>("all");

  const activeCount = transfers.filter((t) => ACTIVE.includes(t.status)).length;
  const waitingForYou = transfers.filter((t) => t.direction === "incoming" && t.status === "pending").length;
  const totalBytes = transfers
    .filter((t) => t.status === "completed")
    .reduce((acc, t) => acc + t.file_size, 0);

  const shown = transfers.filter((t) => {
    if (filter === "active") return ACTIVE.includes(t.status);
    if (filter === "incoming") return t.direction === "incoming";
    if (filter === "outgoing") return t.direction === "outgoing";
    return true;
  });

  const tab = (f: Filter, label: string) => (
    <button
      type="button"
      onClick={() => setFilter(f)}
      className={`px-3 py-1 rounded-lg font-medium transition-colors ${
        filter === f
          ? "bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-[0_1px_3px_rgb(0_0_0/0.12)]"
          : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex-1 h-full flex flex-col overflow-hidden select-none lanx-screen-in">
      <div className="h-16 px-8 border-b lanx-line lanx-bar flex items-center justify-between shrink-0 gap-4">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Files</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
            Any size · encrypted · verified · resumable
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs shrink-0">
          <div className="flex rounded-[11px] bg-[var(--lanx-fill)] p-[3px]">
            {tab("all", `All (${transfers.length})`)}
            {tab("active", `Active (${activeCount})`)}
            {tab("incoming", "Received")}
            {tab("outgoing", "Sent")}
          </div>
          <button
            type="button"
            onClick={onOpenDownloads}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl lanx-btn text-slate-700 dark:text-slate-300 font-medium"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Downloads
          </button>
          <button
            type="button"
            onClick={onClearFinished}
            title="Remove finished items from this list (files stay on disk)"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl lanx-btn text-slate-700 dark:text-slate-300 font-medium"
          >
            <Eraser className="h-3.5 w-3.5" />
            Clear finished
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        {waitingForYou > 0 && filter !== "outgoing" && (
          <div className="max-w-4xl mx-auto mb-4 rounded-xl border border-sky-300/60 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30 px-4 py-2.5 text-xs text-sky-800 dark:text-sky-200">
            {waitingForYou === 1 ? "1 file is" : `${waitingForYou} files are`} waiting for you to accept.
          </div>
        )}

        {shown.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center p-8 text-xs text-slate-400">
            <Inbox className="h-10 w-10 text-slate-300 dark:text-slate-700 mb-2" />
            <p className="font-semibold text-slate-700 dark:text-slate-300">Nothing here yet</p>
            <p className="mt-1 text-slate-500 max-w-sm">
              Open a chat and press the paperclip, or drag files into the chat, to send them to a colleague.
            </p>
          </div>
        ) : (
          <div className="space-y-3 max-w-4xl mx-auto">
            {shown.map((tx, i) => {
              const incoming = tx.direction === "incoming";
              return (
                <div
                  key={tx.id}
                  style={stagger(i, 40, 10)}
                  className="rounded-2xl lanx-card lanx-item-in p-4"
                >
                  <div className="flex items-center justify-between mb-2 text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="flex items-center gap-1.5">
                      <span
                        className={`h-5 w-5 rounded-md flex items-center justify-center ${
                          incoming ? "bg-sky-500/10 text-sky-500" : "bg-indigo-500/10 text-indigo-500"
                        }`}
                      >
                        {incoming ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                      </span>
                      {incoming ? "From" : "To"}{" "}
                      <span className="font-semibold text-slate-700 dark:text-slate-200">{tx.peer_name || "Unknown"}</span>
                      <span>·</span>
                      <span>{new Date(tx.created_at * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
                    </span>
                  </div>

                  <FileCard transfer={tx} fallbackName={tx.file_name} progress={progress[tx.id]} actions={actions} />

                  {(tx.file_hash || tx.local_path) && (
                    <div className="mt-3 pt-2 border-t lanx-line flex items-center justify-between gap-3 text-[10px] text-slate-400">
                      {tx.file_hash ? (
                        <span className="flex items-center gap-1 font-mono truncate min-w-0" title={tx.file_hash}>
                          <ShieldCheck className="h-3 w-3 text-emerald-500 shrink-0" />
                          <span className="truncate">SHA-256 {tx.file_hash}</span>
                        </span>
                      ) : (
                        <span />
                      )}
                      {tx.local_path && (
                        <span className="truncate font-mono text-slate-500 max-w-[50%]" title={tx.local_path}>
                          {tx.local_path}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {totalBytes > 0 && (
          <p className="max-w-4xl mx-auto mt-6 text-center text-[11px] text-slate-400">
            {formatSize(totalBytes)} transferred successfully in total
          </p>
        )}
      </div>
    </div>
  );
};
