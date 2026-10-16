import React from "react";
import { AvailableUpdate, TransferProgress } from "../types";
import { formatSize, formatSpeed } from "../lib/format";
import { ArrowUpCircle, Loader2, ShieldCheck, AlertCircle } from "lucide-react";

interface UpdateBannerProps {
  update: AvailableUpdate;
  progress?: TransferProgress;
  busy: boolean;
  onInstall: () => void;
  /** "Remind me tomorrow". */
  onLater: () => void;
}

/**
 * "LANX 1.x is ready — Update LANX now", across the top of LANX. It stays
 * until LANX is updated; "Remind me tomorrow" hides it for one day.
 */
export const UpdateBanner: React.FC<UpdateBannerProps> = ({ update, progress, busy, onInstall, onLater }) => {
  const from = update.from_name ? ` from ${update.from_name}` : "";
  const done = progress?.transferred_bytes ?? update.transferred_bytes;
  const total = progress?.file_size || update.file_size || 1;
  const pct = Math.min(100, Math.round((done / total) * 100));
  const failed = update.state === "failed";
  const working = update.state === "downloading" || update.state === "installing";

  let title: string;
  let detail: string;
  let action: string | null;
  switch (update.state) {
    case "downloading":
      title = `Getting LANX ${update.version}${from}…`;
      detail = `${pct}%${progress?.bytes_per_sec ? ` · ${formatSpeed(progress.bytes_per_sec)}` : ""} · then checked`;
      action = null;
      break;
    case "ready":
      title = `LANX ${update.version} is ready to install`;
      detail = "Official release, checked · keeps all chats";
      action = "Update LANX now";
      break;
    case "installing":
      title = `Installing LANX ${update.version}…`;
      detail = "Click Yes when Windows asks “Do you want to allow this app to make changes?”. LANX closes and opens again by itself.";
      action = null;
      break;
    case "failed":
      title = `LANX ${update.version} could not be installed yet`;
      detail = update.error || "The download stopped.";
      action = "Try again";
      break;
    default:
      title = `LANX ${update.version} is available${from}`;
      detail = `Official release · ${formatSize(update.file_size)}${
        update.from_online || !update.from_name ? "" : ` · ${update.from_name} is offline now`
      }`;
      action = "Update now";
  }

  return (
    <div
      className={`shrink-0 flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 border-b lanx-fade ${
        failed
          ? "bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-900"
          : "bg-sky-50 border-sky-200 dark:bg-sky-950/40 dark:border-sky-900"
      }`}
      role="status"
    >
      <div
        className={`h-8 w-8 shrink-0 rounded-full flex items-center justify-center ${
          failed ? "bg-amber-500/15 text-amber-600" : "bg-sky-500/15 text-sky-600 dark:text-sky-400"
        }`}
      >
        {working ? (
          <Loader2 className="h-4.5 w-4.5 animate-spin" />
        ) : failed ? (
          <AlertCircle className="h-4.5 w-4.5" />
        ) : (
          <ArrowUpCircle className="h-4.5 w-4.5" />
        )}
      </div>
      <div className="flex-1 min-w-[170px]">
        <div className="text-xs font-semibold text-slate-900 dark:text-white leading-snug">{title}</div>
        <div className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300 leading-snug">
          {update.state === "available" || update.state === "ready" ? (
            <ShieldCheck className="h-3 w-3 shrink-0 text-emerald-600" />
          ) : null}
          <span className="line-clamp-2">{detail}</span>
        </div>
        {update.state === "downloading" && (
          <div className="mt-1 h-1 rounded-full bg-sky-200/70 dark:bg-sky-900 overflow-hidden">
            <div className="h-full bg-sky-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      <div className="ml-auto flex items-center gap-1">
        {action && (
          <button
            type="button"
            onClick={onInstall}
            disabled={busy}
            className="shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-xs font-semibold shadow-sm whitespace-nowrap disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {action}
          </button>
        )}
        {update.state !== "installing" && update.state !== "downloading" && (
          <button
            type="button"
            onClick={onLater}
            title="Hide this until tomorrow"
            className="shrink-0 px-2 py-1.5 rounded-lg text-[11px] font-medium text-slate-500 whitespace-nowrap hover:bg-slate-200/60 dark:hover:bg-slate-800"
          >
            Remind me tomorrow
          </button>
        )}
      </div>
    </div>
  );
};
