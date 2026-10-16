import React from "react";
import { TransferRecord } from "../types";
import {
  ArrowDownLeft,
  ArrowUpRight,
  FileText,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
  X,
  Check,
} from "lucide-react";

interface TransfersViewProps {
  transfers: TransferRecord[];
  onCancelTransfer: (id: string) => void;
  onAcceptTransfer: (id: string) => void;
}

export const TransfersView: React.FC<TransfersViewProps> = ({
  transfers,
  onCancelTransfer,
  onAcceptTransfer,
}) => {
  const activeCount = transfers.filter(
    (t) => t.status === "transferring" || t.status === "pending"
  ).length;

  const totalBytesTransferred = transfers.reduce(
    (acc, t) => acc + (t.status === "completed" ? t.file_size : t.transferred_bytes),
    0
  );

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="flex-1 h-full flex flex-col bg-slate-50/50 dark:bg-[#080c14] overflow-hidden select-none">
      {/* Header */}
      <div className="h-16 px-8 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c111c] flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            LAN File Transfers
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Encrypted direct peer-to-peer streaming with SHA-256 integrity verification
          </p>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <div className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800/80 font-medium text-slate-700 dark:text-slate-300">
            Active: <span className="font-bold text-sky-500">{activeCount}</span>
          </div>
          <div className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800/80 font-medium text-slate-700 dark:text-slate-300">
            Volume:{" "}
            <span className="font-bold text-slate-900 dark:text-white">
              {formatFileSize(totalBytesTransferred)}
            </span>
          </div>
        </div>
      </div>

      {/* Transfer List */}
      <div className="flex-1 overflow-y-auto p-8">
        {transfers.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center p-8 text-xs text-slate-400">
            <FileText className="h-10 w-10 text-slate-300 dark:text-slate-700 mb-2" />
            <p className="font-semibold text-slate-700 dark:text-slate-300">
              No Transfer Activity
            </p>
            <p className="mt-1 text-slate-500 max-w-sm">
              Files and folders you send or receive with LAN peers will appear here with cryptographic integrity hashes and live progress.
            </p>
          </div>
        ) : (
          <div className="space-y-3 max-w-4xl mx-auto">
            {transfers.map((tx) => {
              const isIncoming = tx.direction === "incoming";
              const percent =
                tx.file_size > 0
                  ? Math.min(100, Math.round((tx.transferred_bytes / tx.file_size) * 100))
                  : 0;

              return (
                <div
                  key={tx.id}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-4 shadow-sm"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${
                          isIncoming
                            ? "bg-sky-500/10 text-sky-500 dark:bg-sky-500/20"
                            : "bg-indigo-500/10 text-indigo-500 dark:bg-indigo-500/20"
                        }`}
                      >
                        {isIncoming ? (
                          <ArrowDownLeft className="h-5 w-5" />
                        ) : (
                          <ArrowUpRight className="h-5 w-5" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="font-bold text-xs text-slate-900 dark:text-white truncate">
                          {tx.file_name}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                          <span>
                            {isIncoming ? "From" : "To"}:{" "}
                            <span className="font-medium text-slate-600 dark:text-slate-300">
                              {tx.peer_name || tx.peer_id}
                            </span>
                          </span>
                          <span>•</span>
                          <span>{formatFileSize(tx.file_size)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Status Pill */}
                    <div className="flex items-center gap-2 shrink-0">
                      {tx.status === "completed" && (
                        <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>Completed</span>
                        </span>
                      )}

                      {tx.status === "transferring" && (
                        <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 text-xs font-semibold">
                          <Clock className="h-3.5 w-3.5 animate-spin" />
                          <span>{percent}%</span>
                        </span>
                      )}

                      {tx.status === "pending" && (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onAcceptTransfer(tx.id)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold shadow-sm"
                          >
                            <Check className="h-3.5 w-3.5" />
                            <span>Accept</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onCancelTransfer(tx.id)}
                            className="p-1 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-red-500"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}

                      {tx.status === "cancelled" && (
                        <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 text-xs font-semibold">
                          <XCircle className="h-3.5 w-3.5" />
                          <span>Cancelled</span>
                        </span>
                      )}

                      {tx.status === "transferring" && (
                        <button
                          type="button"
                          onClick={() => onCancelTransfer(tx.id)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                          title="Cancel Transfer"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Progress Bar (active transfers) */}
                  {tx.status === "transferring" && (
                    <div className="mt-2.5">
                      <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-sky-500 rounded-full transition-all duration-300"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                      <div className="flex justify-between items-center text-[10px] text-slate-400 mt-1 font-mono">
                        <span>{formatFileSize(tx.transferred_bytes)}</span>
                        <span>{formatFileSize(tx.file_size)}</span>
                      </div>
                    </div>
                  )}

                  {/* Hash & Verification Footer */}
                  <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400">
                    <div className="flex items-center gap-1 font-mono truncate max-w-sm">
                      <ShieldCheck className="h-3 w-3 text-emerald-500 shrink-0" />
                      <span className="truncate">SHA-256: {tx.file_hash}</span>
                    </div>

                    {tx.local_path && (
                      <span className="truncate font-mono text-slate-500 ml-2">
                        {tx.local_path}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
