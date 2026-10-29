/** LANX 3.x phone page: the pieces screens share — bubbles, file cards,
 *  reaction chips, the bottom sheet, and small helpers. */
import { useRef, type ReactNode } from "react";
import { AlarmClock, Check, CheckCheck, Clock, Download, FileText, Pin, Star, X } from "lucide-react";
import type { Profile } from "../types";
import { MessageText, isForwarded, withoutForwardMark } from "../components/chat/chatUtils";
import { CardView } from "../components/org/CardView";
import { formatSize } from "../lib/format";
import { effective, statusPreset } from "../lib/profile";
import type { PhoneClient, PhoneMessage, PhoneTransfer, StickerInfo } from "./client";

// ------------------------------------------------------------------ helpers

export const timeOf = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function dayLabel(ts: number): string {
  const d = new Date(ts * 1000);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

export function whenShort(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  if (d.toDateString() === new Date().toDateString()) return timeOf(ts);
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

export const fileName = (m: PhoneMessage) => m.content.replace(/^(📎|📁|🎤)\s*/u, "");

export const isVideoName = (name: string) => /\.(mp4|m4v|mov|webm)$/i.test(name);

export function labelOf(m: PhoneMessage): string {
  switch (m.message_type) {
    case "card":
      return "📋 Card — open LANX on the PC to see it";
    case "call":
      return "📞 Call";
    case "meeting":
      return "📅 Meeting";
    case "recording":
      return "🎥 Recording";
    case "ring":
      return "🔔 Ring";
    default:
      return m.content;
  }
}

/** The "Who's in" rule, the same as the PC's. */
export function whereabouts(p: Profile | null, online: boolean): { group: "in" | "wfh" | "away" | "off"; label: string; emoji: string; color: string } {
  const st = effective(p)?.status ?? "";
  if (st === "leave") return { group: "away", label: "On leave", emoji: "🌴", color: "#14b8a6" };
  if (st === "road") return { group: "away", label: "On the road", emoji: "🚗", color: "#64748b" };
  if (st === "wfh") return { group: "wfh", label: "Working from home", emoji: "🏠", color: "#0ea5e9" };
  if (!online) return { group: "off", label: "Offline", emoji: "⚪", color: "#94a3b8" };
  const preset = statusPreset(st);
  return { group: "in", label: preset?.label ?? "In the office", emoji: preset?.emoji ?? "🟢", color: preset?.color ?? "#22c55e" };
}

export const coarsePointer = () => window.matchMedia("(pointer: coarse)").matches;

/** Copies text without the clipboard API (which a plain-http page does not get). */
export function copyText(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** What the sidebar shows for a transfer's state. */
export function transferState(t: PhoneTransfer, pct: number): string {
  if (t.ready && t.direction === "incoming") return "Received";
  if (t.direction === "incoming") {
    if (t.status === "pending") return "Waiting for your PC to accept it";
    if (t.status === "transferring") return `Downloading on your PC · ${pct}%`;
    if (t.status === "failed") return t.error_reason ? `Failed: ${t.error_reason}` : "Download failed on the PC";
    if (t.status === "declined") return "Declined";
    if (t.status === "cancelled") return "Cancelled";
    return t.status;
  }
  if (t.status === "queued") return "Waiting to send";
  if (t.status === "pending") return "Waiting for them to accept";
  if (t.status === "transferring") return `Sending · ${pct}%`;
  if (t.status === "completed") return "Sent";
  if (t.status === "failed") return t.error_reason ? `Failed: ${t.error_reason}` : "Failed";
  return t.status;
}

// ------------------------------------------------------------------- sheet

/** A sheet from the bottom of the screen (menus, pickers). */
export function Sheet({ title, onClose, children, hook }: { title?: string; onClose: () => void; children: ReactNode; hook?: string }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/30 backdrop-blur-sm lanx-fade" onMouseDown={onClose} onTouchStart={onClose} data-ph-sheet={hook ?? "sheet"}>
      <div
        className="ph-safe-bottom max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-[22px] lanx-sheet p-4 lanx-rise"
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[15px] font-bold text-slate-900 dark:text-white">{title}</div>
            <button type="button" onClick={onClose} className="lanx-tool p-1.5" aria-label="Close" data-ph-sheet-close>
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function SheetRow({ icon, label, hint, onClick, hook, danger }: { icon?: ReactNode; label: string; hint?: string; onClick: () => void; hook?: string; danger?: boolean }) {
  return (
    <button
      type="button"
      data-ph-action={hook}
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] active:bg-[var(--lanx-fill)] ${danger ? "text-rose-600 dark:text-rose-400" : "text-slate-800 dark:text-slate-100"}`}
    >
      {icon && <span className="shrink-0 opacity-80">{icon}</span>}
      <span className="flex-1">{label}</span>
      {hint && <span className="text-[11.5px] text-slate-400">{hint}</span>}
    </button>
  );
}

// ---------------------------------------------------------------- messages

export function StatusIcon({ m }: { m: PhoneMessage }) {
  if (m.deliveries) {
    if (m.deliveries.read > 0) return <CheckCheck className="h-3 w-3 text-emerald-200" />;
    if (m.deliveries.delivered > 0) return <CheckCheck className="h-3 w-3" />;
    return <Clock className="h-3 w-3" />;
  }
  switch (m.status) {
    case "read":
      return <CheckCheck className="h-3 w-3 text-emerald-200" />;
    case "delivered":
      return <CheckCheck className="h-3 w-3" />;
    case "failed":
      return <span className="font-semibold text-amber-200">Not sent</span>;
    case "queued":
      return (
        <span className="flex items-center gap-0.5">
          <Clock className="h-3 w-3" /> Queued
        </span>
      );
    default:
      return <Check className="h-3 w-3 opacity-70" />;
  }
}

export function FileBody({ m, isOut, client, progress, onAccept }: { m: PhoneMessage; isOut: boolean; client: PhoneClient; progress?: number; onAccept?: (transferId: string) => void }) {
  const t = m.transfer;
  const name = fileName(m);
  if (t?.ready && t.is_image) {
    return (
      <a href={client.fileUrl(t.id)} target="_blank" rel="noreferrer" data-ph-image>
        <img src={client.fileUrl(t.id)} alt={name} loading="lazy" className="ph-bubble-img rounded-xl bg-black/5" />
      </a>
    );
  }
  if (t?.ready && t.kind === "voice") {
    return (
      <div data-ph-voice>
        <audio controls preload="none" src={client.fileUrl(t.id)} className="max-w-[230px]" />
        <div className={`mt-1 text-[11px] ${isOut ? "text-white/75" : "text-slate-500 dark:text-slate-400"}`}>{name}</div>
      </div>
    );
  }
  if (t?.ready && isVideoName(t.file_name)) {
    return <video controls playsInline preload="metadata" src={client.fileUrl(t.id)} className="ph-bubble-img rounded-xl bg-black" />;
  }
  const pct = progress ?? (t && t.file_size > 0 ? Math.round((t.transferred_bytes / t.file_size) * 100) : 0);
  const state = t ? (t.ready ? "" : transferState(t, pct)) : "";
  const pending = !!t && t.direction === "incoming" && t.status === "pending";
  return (
    <div className="min-w-[170px]">
      <div className="flex items-center gap-2.5">
        <FileText className="h-5 w-5 shrink-0 opacity-80" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{name}</div>
          <div className={`text-[11px] ${isOut ? "text-white/75" : "text-slate-500 dark:text-slate-400"}`}>
            {t ? formatSize(t.file_size) : ""}
            {state ? ` · ${state}` : ""}
          </div>
        </div>
        {t?.ready && (
          <a href={client.fileUrl(t.id)} download={t.file_name} className={`shrink-0 rounded-full p-1.5 ${isOut ? "bg-white/20" : "bg-[var(--lanx-fill)]"}`} aria-label="Download" data-ph-download>
            <Download className="h-4 w-4" />
          </a>
        )}
      </div>
      {t && t.status === "transferring" && (
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
          <div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
      {pending && onAccept && (
        <button type="button" data-ph-accept={t.id} onClick={() => onAccept(t.id)} className="mt-2 rounded-full bg-sky-500 px-3 py-1 text-[12px] font-semibold text-white">
          Accept on the PC
        </button>
      )}
    </div>
  );
}

export function StickerBody({ id, stickers }: { id: string; stickers: StickerInfo[] }) {
  const s = stickers.find((x) => x.id === id);
  return (
    <span className="flex flex-col items-center" data-ph-sticker={id}>
      <span className="text-[56px] leading-none drop-shadow-[0_4px_10px_rgb(0_0_0/0.18)]">{s?.emoji ?? "💬"}</span>
      <span className="mt-1 text-[11px] font-bold opacity-80">{s?.label ?? "Sticker"}</span>
    </span>
  );
}

export function ReactionChips({ m, isOut, onReact }: { m: PhoneMessage; isOut: boolean; onReact: (emoji: string) => void }) {
  const list = m.reactions ?? [];
  if (list.length === 0) return null;
  return (
    <div className={`mt-1 flex flex-wrap gap-1 ${isOut ? "justify-end" : ""}`} data-ph-reactions>
      {list.map((r) => (
        <button
          key={r.emoji}
          type="button"
          data-ph-reaction={r.emoji}
          onClick={() => onReact(r.emoji)}
          title={r.names.join(", ")}
          className={`rounded-full px-2 py-[2px] text-[12px] shadow-sm ${r.mine ? "bg-sky-500/15 ring-1 ring-sky-500 text-sky-700 dark:text-sky-300" : "lanx-card text-slate-700 dark:text-slate-200"}`}
        >
          {r.emoji} {r.count > 1 ? r.count : ""}
        </button>
      ))}
    </div>
  );
}

/** Calls `onLongPress` after holding a finger (or right-clicking). */
function useLongPress(onLongPress: () => void) {
  const timer = useRef(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const clear = () => {
    window.clearTimeout(timer.current);
    timer.current = 0;
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      start.current = { x: e.clientX, y: e.clientY };
      clear();
      timer.current = window.setTimeout(() => {
        timer.current = 0;
        onLongPress();
      }, 450);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!timer.current || !start.current) return;
      if (Math.abs(e.clientX - start.current.x) > 10 || Math.abs(e.clientY - start.current.y) > 10) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      clear();
      onLongPress();
    },
  };
}

export function Bubble({
  m,
  group,
  myId,
  myName,
  names,
  nameOf,
  senderName,
  client,
  stickers,
  progress,
  onActions,
  onReact,
  onAccept,
  onCardChanged,
  onError,
}: {
  m: PhoneMessage;
  group: boolean;
  myId: string;
  myName: string;
  names: string[];
  nameOf: (id: string) => string;
  senderName: string;
  client: PhoneClient;
  stickers: StickerInfo[];
  progress?: number;
  onActions: (m: PhoneMessage) => void;
  onReact: (m: PhoneMessage, emoji: string) => void;
  onAccept: (transferId: string) => void;
  onCardChanged: (m: PhoneMessage) => void;
  onError: (text: string) => void;
}) {
  const isOut = m.is_outgoing;
  const press = useLongPress(() => onActions(m));
  if (m.message_type === "system" || m.message_type === "secret_setting") {
    return (
      <div className="flex justify-center py-1" data-ph-msg={m.id}>
        <span className="max-w-[90%] rounded-full lanx-chip px-2.5 py-0.5 text-center text-[10.5px] font-semibold">{m.content}</span>
      </div>
    );
  }
  if (m.message_type === "card" && !m.deleted) {
    // The PC's own card (poll, task, kudos…), acting through the PC.
    return (
      <div data-ph-msg={m.id} data-ph-out={isOut ? "1" : "0"} data-ph-card={m.id} className={`flex flex-col ${isOut ? "items-end" : "items-start"}`}>
        {group && !isOut && <span className="mb-0.5 ml-3 text-[11px] font-semibold text-slate-500 dark:text-slate-400">{senderName}</span>}
        <div {...press} className="w-[92%] select-none">
          <CardView msg={m} myId={myId} nameOf={nameOf} onChanged={(x) => onCardChanged({ ...(x as PhoneMessage), transfer: m.transfer })} onError={onError} canAct />
        </div>
        <div className="mt-0.5 flex items-center gap-1 px-2 text-[10px] text-slate-400">
          <span>{timeOf(m.timestamp)}</span>
          {isOut && <StatusIcon m={m} />}
        </div>
        <ReactionChips m={m} isOut={isOut} onReact={(e) => onReact(m, e)} />
      </div>
    );
  }
  const forwarded = m.message_type === "text" && isForwarded(m.content);
  const body = m.deleted ? (
    <i className="opacity-70">This message was deleted</i>
  ) : m.message_type === "file" ? (
    <FileBody m={m} isOut={isOut} client={client} progress={progress} onAccept={onAccept} />
  ) : m.message_type === "sticker" ? (
    <StickerBody id={m.content} stickers={stickers} />
  ) : m.message_type === "text" ? (
    <MessageText text={withoutForwardMark(m.content)} names={names} myName={myName} onAccent={isOut} />
  ) : (
    <span>{labelOf(m)}</span>
  );
  const marks: ReactNode[] = [];
  if (m.remind_at) marks.push(<AlarmClock key="r" className="h-3 w-3" />);
  if (m.pinned_at) marks.push(<Pin key="p" className="h-3 w-3" />);
  if (m.starred) marks.push(<Star key="s" className="h-3 w-3" />);
  return (
    <div data-ph-msg={m.id} data-ph-out={isOut ? "1" : "0"} className={`flex flex-col ${isOut ? "items-end" : "items-start"}`}>
      {group && !isOut && <span className="mb-0.5 ml-3 text-[11px] font-semibold text-slate-500 dark:text-slate-400">{senderName}</span>}
      <div
        {...press}
        className={`relative max-w-[82%] select-none rounded-[18px] px-3.5 py-2 text-[14px] ${
          m.message_type === "sticker"
            ? "bg-transparent"
            : isOut
              ? "bg-sky-500 text-white rounded-br-[6px] shadow-sm shadow-sky-500/20"
              : "lanx-bubble-in text-slate-900 dark:text-slate-100 rounded-bl-[6px]"
        }`}
      >
        {forwarded && <div className={`mb-0.5 text-[10.5px] italic ${isOut ? "text-white/70" : "text-slate-400"}`}>↪ Forwarded</div>}
        {m.reply_preview && <div className={`mb-1 rounded-lg px-2 py-1 text-[11.5px] ${isOut ? "bg-white/15" : "bg-black/5 dark:bg-white/10"}`}>{m.reply_preview}</div>}
        <div className="whitespace-pre-wrap break-words leading-relaxed ph-select">{body}</div>
        <div className={`mt-0.5 flex items-center justify-end gap-1 text-[10px] ${isOut ? "text-white/75" : "text-slate-400"} ${m.message_type === "sticker" ? "text-slate-400" : ""}`}>
          {marks}
          {m.edited_at ? <span>edited ·</span> : null}
          <span>{timeOf(m.timestamp)}</span>
          {isOut && <StatusIcon m={m} />}
        </div>
      </div>
      <ReactionChips m={m} isOut={isOut} onReact={(e) => onReact(m, e)} />
    </div>
  );
}
