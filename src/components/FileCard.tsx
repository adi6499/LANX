import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import {
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideoCamera,
  Folder,
  Check,
  X,
  RotateCcw,
  FolderOpen,
  ExternalLink,
  Hourglass,
  ShieldCheck,
  AlertCircle,
} from "lucide-react";
import { TransferActions, TransferProgress, TransferRecord } from "../types";
import { fileExtension, formatEta, formatSize, formatSpeed } from "../lib/format";

export function FileIcon({ name, className }: { name: string; className?: string }) {
  const ext = fileExtension(name);
  if (["xls", "xlsx", "csv", "ods"].includes(ext)) return <FileSpreadsheet className={className} />;
  if (["png", "jpg", "jpeg", "gif", "bmp", "webp", "heic", "svg"].includes(ext)) return <FileImage className={className} />;
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return <FileArchive className={className} />;
  if (["mp4", "mov", "avi", "mkv", "wmv"].includes(ext)) return <FileVideoCamera className={className} />;
  if (["pdf", "doc", "docx", "txt", "rtf", "odt", "ppt", "pptx"].includes(ext)) return <FileText className={className} />;
  if (["js", "ts", "json", "xml", "html", "py", "rs", "sql"].includes(ext)) return <FileCode className={className} />;
  return <File className={className} />;
}

/** A folder travels as "<name>.zip" (LANX 1.2.3); show it as the folder. */
export const isFolderTransfer = (t: TransferRecord) => t.kind === "folder";
export const displayName = (t: TransferRecord) =>
  isFolderTransfer(t) ? t.file_name.replace(/\.zip$/i, "") : t.file_name;

const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];
export const isImageFile = (name: string) => IMAGE_EXT.includes(fileExtension(name));

// Previews are loaded once per transfer and kept for the session.
const previewCache = new Map<string, string | null>();

/** Picture of a sent/received image; click opens it in the normal viewer. */
export const ImagePreview: React.FC<{ transferId: string; name: string; onOpen: () => void }> = ({
  transferId,
  name,
  onOpen,
}) => {
  const [src, setSrc] = useState<string | null | undefined>(previewCache.get(transferId));
  useEffect(() => {
    if (previewCache.has(transferId)) {
      setSrc(previewCache.get(transferId));
      return;
    }
    let alive = true;
    api
      .getImagePreview(transferId)
      .then((url) => {
        previewCache.set(transferId, url);
        if (alive) setSrc(url);
      })
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [transferId]);
  if (!src) return null;
  return (
    <button type="button" onClick={onOpen} title={`Open ${name}`} className="block mb-2 -mx-1 overflow-hidden rounded-xl lanx-fade">
      <img src={src} alt={name} className="max-h-60 max-w-[300px] w-auto object-contain rounded-xl bg-black/5" />
    </button>
  );
};

interface FileCardProps {
  transfer?: TransferRecord;
  /** Used when the transfer was cleared from history. */
  fallbackName: string;
  progress?: TransferProgress;
  actions: TransferActions;
  /** Rendered inside a blue outgoing chat bubble. */
  onAccent?: boolean;
}

const btn =
  "inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors";

export const FileCard: React.FC<FileCardProps> = ({
  transfer: t,
  fallbackName,
  progress,
  actions,
  onAccent = false,
}) => {
  const muted = onAccent ? "text-sky-100/90" : "text-slate-500 dark:text-slate-400";
  const strong = onAccent ? "text-white" : "text-slate-900 dark:text-white";
  const ghost = onAccent
    ? "bg-white/15 hover:bg-white/25 text-white"
    : "bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200";
  const primary = onAccent
    ? "bg-white text-sky-600 hover:bg-sky-50"
    : "bg-sky-500 hover:bg-sky-600 text-white shadow-sm";

  if (!t) {
    return (
      <div className="flex items-center gap-2.5 min-w-[220px]">
        <FileIcon name={fallbackName} className={`h-8 w-8 shrink-0 ${muted}`} />
        <div className="min-w-0">
          <div className={`text-xs font-semibold truncate ${strong}`}>{fallbackName}</div>
          <div className={`text-[11px] ${muted}`}>Removed from the Files list</div>
        </div>
      </div>
    );
  }

  const incoming = t.direction === "incoming";
  const folder = isFolderTransfer(t);
  const name = displayName(t);
  const done = progress?.transferred_bytes ?? t.transferred_bytes;
  const total = progress?.file_size ?? t.file_size;
  const pct = total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 0;
  const speed = progress?.bytes_per_sec ?? 0;
  const peer = t.peer_name || "the other computer";

  let status: React.ReactNode = null;
  let buttons: React.ReactNode = null;

  switch (t.status) {
    case "queued":
      status = (
        <span className="inline-flex items-center gap-1">
          <Hourglass className="h-3 w-3" />
          {t.error_reason || "Getting ready to send…"}
        </span>
      );
      buttons = (
        <button type="button" className={`${btn} ${ghost}`} onClick={() => actions.cancel(t.id)}>
          <X className="h-3 w-3" /> Cancel
        </button>
      );
      break;
    case "pending":
      if (incoming) {
        status = <span>Wants to send you this {folder ? "folder" : "file"}</span>;
        buttons = (
          <>
            <button type="button" className={`${btn} ${primary}`} onClick={() => actions.accept(t.id)}>
              <Check className="h-3 w-3" /> Accept
            </button>
            <button type="button" className={`${btn} ${ghost}`} onClick={() => actions.cancel(t.id)}>
              <X className="h-3 w-3" /> Decline
            </button>
          </>
        );
      } else {
        status = (
          <span className="inline-flex items-center gap-1">
            <Hourglass className="h-3 w-3" /> Waiting for {peer} to accept
          </span>
        );
        buttons = (
          <button type="button" className={`${btn} ${ghost}`} onClick={() => actions.cancel(t.id)}>
            <X className="h-3 w-3" /> Cancel
          </button>
        );
      }
      break;
    case "transferring":
      status = (
        <span>
          {formatSize(done)} of {formatSize(total)}
          {speed > 0 && ` · ${formatSpeed(speed)} · ${formatEta(total - done, speed)}`}
        </span>
      );
      buttons = (
        <button type="button" className={`${btn} ${ghost}`} onClick={() => actions.cancel(t.id)}>
          <X className="h-3 w-3" /> Cancel
        </button>
      );
      break;
    case "completed":
      status = (
        <span className="inline-flex items-center gap-1">
          <ShieldCheck className={`h-3 w-3 ${onAccent ? "" : "text-emerald-500"}`} />
          {t.error_reason
            ? t.error_reason
            : incoming
              ? folder
                ? "Received and unpacked · checksum verified"
                : "Received · checksum verified"
              : "Delivered · checksum verified"}
        </span>
      );
      buttons = incoming ? (
        <>
          <button type="button" className={`${btn} ${primary}`} onClick={() => actions.open(t.id)}>
            {folder ? <FolderOpen className="h-3 w-3" /> : <ExternalLink className="h-3 w-3" />}
            {folder ? "Open folder" : "Open"}
          </button>
          <button type="button" className={`${btn} ${ghost}`} onClick={() => actions.reveal(t.id)}>
            <FolderOpen className="h-3 w-3" /> Show in folder
          </button>
        </>
      ) : (
        <button type="button" className={`${btn} ${ghost}`} onClick={() => actions.reveal(t.id)}>
          <FolderOpen className="h-3 w-3" /> Show in folder
        </button>
      );
      break;
    case "failed":
      status = (
        <span className="inline-flex items-start gap-1">
          <AlertCircle className={`h-3 w-3 mt-px shrink-0 ${onAccent ? "" : "text-red-500"}`} />
          <span>{t.error_reason || "Transfer failed"}</span>
        </span>
      );
      buttons = (
        <>
          <button type="button" className={`${btn} ${primary}`} onClick={() => actions.retry(t.id)}>
            <RotateCcw className="h-3 w-3" /> {incoming && t.transferred_bytes > 0 ? "Resume" : "Retry"}
          </button>
          <button type="button" className={`${btn} ${ghost}`} onClick={() => actions.cancel(t.id)}>
            <X className="h-3 w-3" /> {incoming ? "Discard" : "Cancel"}
          </button>
        </>
      );
      break;
    case "declined":
      status = <span>{incoming ? "You declined this file" : `${peer} declined this file`}</span>;
      break;
    case "cancelled":
      status = <span>{t.error_reason || "Cancelled"}</span>;
      break;
  }

  const showPreview = isImageFile(t.file_name) && (t.status === "completed" || !incoming);

  return (
    <div className="min-w-[240px] max-w-[340px]">
      {showPreview && <ImagePreview transferId={t.id} name={t.file_name} onOpen={() => actions.open(t.id)} />}
      <div className="flex items-center gap-2.5">
        <div
          className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
            onAccent ? "bg-white/15" : "bg-sky-500/10 text-sky-600 dark:text-sky-400"
          }`}
        >
          {folder ? <Folder className="h-5 w-5" /> : <FileIcon name={t.file_name} className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className={`text-xs font-semibold truncate ${strong}`} title={name}>
            {name}
          </div>
          <div className={`text-[11px] ${muted}`}>
            {folder ? `Folder · ${formatSize(t.file_size)}${t.status === "completed" ? "" : " packed"}` : formatSize(t.file_size)}
          </div>
        </div>
        {t.status === "transferring" && (
          <span className={`text-[11px] font-bold tabular-nums ${strong}`}>{pct}%</span>
        )}
      </div>

      {t.status === "transferring" && (
        <div className={`mt-2 h-1.5 w-full rounded-full overflow-hidden ${onAccent ? "bg-white/20" : "bg-slate-200 dark:bg-slate-800"}`}>
          <div
            className={`h-full rounded-full transition-all duration-300 ${onAccent ? "bg-white" : "bg-sky-500"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {status && <div className={`mt-1.5 text-[11px] leading-snug ${muted}`}>{status}</div>}
      {buttons && <div className="mt-2 flex flex-wrap items-center gap-1.5">{buttons}</div>}
    </div>
  );
};

const STATUS_WORD: Record<string, string> = {
  queued: "waiting",
  pending: "not accepted yet",
  transferring: "receiving…",
  completed: "received",
  declined: "declined",
  cancelled: "cancelled",
  failed: "failed",
};

interface GroupFileCardProps {
  transfers: TransferRecord[];
  fallbackName: string;
  progress: Record<string, TransferProgress>;
  actions: TransferActions;
}

/** A file I sent to a group: one copy per member, summarised. */
export const GroupFileCard: React.FC<GroupFileCardProps> = ({ transfers, fallbackName, progress, actions }) => {
  if (transfers.length === 0) {
    return <FileCard fallbackName={fallbackName} actions={actions} onAccent />;
  }
  const first = transfers[0];
  const done = transfers.filter((t) => t.status === "completed").length;
  const active = transfers.filter((t) => ["queued", "pending", "transferring"].includes(t.status));
  const failed = transfers.filter((t) => t.status === "failed");
  const bytes = transfers.reduce((acc, t) => acc + (progress[t.id]?.transferred_bytes ?? (t.status === "completed" ? t.file_size : t.transferred_bytes)), 0);
  const pct = Math.floor((bytes / Math.max(1, first.file_size * transfers.length)) * 100);

  return (
    <div className="min-w-[260px] max-w-[340px]">
      {isImageFile(first.file_name) && (
        <ImagePreview transferId={first.id} name={first.file_name} onOpen={() => actions.reveal(first.id)} />
      )}
      <div className="flex items-center gap-2.5">
        <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0 bg-white/15">
          {isFolderTransfer(first) ? <Folder className="h-5 w-5" /> : <FileIcon name={first.file_name} className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold truncate text-white" title={displayName(first)}>
            {displayName(first)}
          </div>
          <div className="text-[11px] text-sky-100/90">
            {formatSize(first.file_size)} · received by {done} of {transfers.length}
          </div>
        </div>
      </div>
      {active.some((t) => t.status === "transferring") && (
        <div className="mt-2 h-1.5 w-full rounded-full overflow-hidden bg-white/20">
          <div className="h-full rounded-full bg-white transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-1">
        {transfers.map((t) => (
          <span
            key={t.id}
            title={t.error_reason || STATUS_WORD[t.status]}
            className={`px-1.5 py-0.5 rounded-md text-[10px] font-medium ${
              t.status === "completed" ? "bg-white/25 text-white" : t.status === "failed" ? "bg-red-400/40 text-white" : "bg-white/10 text-sky-50"
            }`}
          >
            {t.status === "completed" ? "✓ " : ""}
            {(t.peer_name || "?").split(" ")[0]} · {STATUS_WORD[t.status]}
          </span>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button type="button" className={`${btn} bg-white/15 hover:bg-white/25 text-white`} onClick={() => actions.reveal(first.id)}>
          <FolderOpen className="h-3 w-3" /> Show in folder
        </button>
        {failed.length > 0 && (
          <button type="button" className={`${btn} bg-white text-sky-600 hover:bg-sky-50`} onClick={() => failed.forEach((t) => actions.retry(t.id))}>
            <RotateCcw className="h-3 w-3" /> Retry {failed.length}
          </button>
        )}
        {active.length > 0 && (
          <button type="button" className={`${btn} bg-white/15 hover:bg-white/25 text-white`} onClick={() => active.forEach((t) => actions.cancel(t.id))}>
            <X className="h-3 w-3" /> Cancel for {active.length === transfers.length ? "everyone" : `${active.length} waiting`}
          </button>
        )}
      </div>
    </div>
  );
};
