import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, ExternalLink, Folder, X } from "lucide-react";
import { TransferActions, TransferProgress, TransferRecord } from "../types";
import { formatEta, formatSize, formatSpeed, transferTiming } from "../lib/format";
import { FileIcon, displayName, isFolderTransfer } from "./FileCard";
import { CatMood, DeliveryCat } from "./DeliveryCat";

/** A new message to show (LANX is in front, but that chat isn't open). */
export interface IslandMessage {
  id: string;
  conversationId: string;
  from: string;
  color: string;
  /** Already made private where needed ("🔒 Secret message"). */
  text: string;
  /** Group name, for group messages. */
  group?: string | null;
}

interface DynamicIslandProps {
  transfers: TransferRecord[];
  message: IslandMessage | null;
  onMessageClose: () => void;
  progress: Record<string, TransferProgress>;
  actions: TransferActions;
  /** Settings → Appearance → Delivery cat. */
  catEnabled: boolean;
  onOpenChat: (conversationId: string) => void;
}

type Mode = "hidden" | "request" | "message" | "active" | "detail" | "done";

const SIZE: Record<Mode, { w: number; h: number; r: number }> = {
  hidden: { w: 120, h: 30, r: 15 },
  active: { w: 320, h: 38, r: 19 },
  detail: { w: 400, h: 128, r: 30 },
  request: { w: 420, h: 110, r: 30 },
  message: { w: 400, h: 78, r: 30 },
  done: { w: 380, h: 62, r: 31 },
};

const isChatFile = (t: TransferRecord) => t.kind !== "update";

/** Progress ring for the small island. */
const Ring: React.FC<{ pct: number; size?: number }> = ({ pct, size = 22 }) => {
  const r = (size - 4) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="-rotate-90 shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.18)" strokeWidth="3" fill="none" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke="var(--color-sky-400)"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(100, Math.max(0, pct)) / 100)}
        style={{ transition: "stroke-dashoffset 0.4s ease" }}
      />
    </svg>
  );
};

/** iPhone-style "Dynamic Island" at the top of the window: a black capsule
 *  that grows to show a file someone wants to send you (with the delivery
 *  cat), what is being received or sent, and how long it took. */
type CatState = {
  id: string;
  variant: "box" | "letter";
  from: string;
  fileName?: string;
  fileSize?: number;
  mood: CatMood;
};

export const DynamicIsland: React.FC<DynamicIslandProps> = ({
  transfers,
  message,
  onMessageClose,
  progress,
  actions,
  catEnabled,
  onOpenChat,
}) => {
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState(false);
  const [done, setDone] = useState<TransferRecord | null>(null);
  const [cat, setCat] = useState<CatState | null>(null);
  const [hover, setHover] = useState(false);
  const prevStatus = useRef<Map<string, string> | null>(null);

  const requests = useMemo(
    () =>
      transfers
        .filter((t) => isChatFile(t) && t.direction === "incoming" && t.status === "pending" && !dismissed.has(t.id))
        .sort((a, b) => b.created_at - a.created_at),
    [transfers, dismissed]
  );
  const active = useMemo(() => transfers.filter((t) => isChatFile(t) && t.status === "transferring"), [transfers]);

  // A transfer that just finished shows for a few seconds with its time.
  useEffect(() => {
    const prev = prevStatus.current;
    const next = new Map<string, string>();
    let finished: TransferRecord | null = null;
    for (const t of transfers) {
      next.set(t.id, t.status);
      if (prev && isChatFile(t) && t.status === "completed" && prev.get(t.id) && prev.get(t.id) !== "completed") finished = t;
    }
    prevStatus.current = next;
    if (finished) setDone(finished);
  }, [transfers]);
  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => setDone(null), 5200);
    return () => window.clearTimeout(t);
  }, [done]);

  const request = requests[0] ?? null;

  // A message shows for a few seconds (longer while the mouse is on it).
  useEffect(() => {
    if (!message || hover) return;
    const t = window.setTimeout(() => {
      setCat((c) => (c && c.variant === "letter" ? { ...c, mood: "bye" } : c));
      onMessageClose();
    }, 6000);
    return () => window.clearTimeout(t);
  }, [message?.id, hover]);

  // The cat drops in for each new request (with the parcel) or message (with
  // a letter); it stays a moment after Accept/Later to animate out.
  const letterKey = message ? `msg-${message.conversationId}` : null;
  useEffect(() => {
    if (!catEnabled) {
      if (cat) setCat(null);
      return;
    }
    if (request) {
      if (!cat || (cat.mood === "hello" && cat.id !== request.id)) {
        setCat({
          id: request.id,
          variant: "box",
          from: request.peer_name || "Someone",
          fileName: displayName(request),
          fileSize: request.file_size,
          mood: "hello",
        });
      }
    } else if (cat?.mood === "hello" && cat.variant === "box") {
      // Answered somewhere else (the chat's Accept/Decline buttons).
      const now = transfers.find((t) => t.id === cat.id);
      setCat({ ...cat, mood: now && ["declined", "cancelled"].includes(now.status) ? "bye" : "happy" });
    } else if (message && letterKey && (!cat || (cat.mood === "hello" && cat.id !== letterKey))) {
      setCat({ id: letterKey, variant: "letter", from: message.from, mood: "hello" });
    } else if (!message && cat?.mood === "hello" && cat.variant === "letter") {
      setCat({ ...cat, mood: "bye" });
    }
  }, [request?.id, letterKey, catEnabled, cat]);
  useEffect(() => {
    if (!cat || cat.mood === "hello") return;
    const t = window.setTimeout(() => setCat(null), cat.mood === "happy" ? 1300 : 1100);
    return () => window.clearTimeout(t);
  }, [cat]);

  const mode: Mode = request ? "request" : message ? "message" : done ? "done" : active.length ? (expanded ? "detail" : "active") : "hidden";
  useEffect(() => {
    if (!active.length) setExpanded(false);
  }, [active.length]);

  const size = SIZE[mode];
  const main = mode === "detail" || mode === "active" ? active[active.length - 1] : null;
  const p = main ? progress[main.id] : undefined;
  const moved = main ? p?.transferred_bytes ?? main.transferred_bytes : 0;
  const total = main ? p?.file_size ?? main.file_size : 0;
  const pct = total > 0 ? Math.floor((moved / total) * 100) : 0;
  const speed = p?.bytes_per_sec ?? 0;

  const accept = (t: TransferRecord) => {
    if (cat?.id === t.id) setCat({ ...cat, mood: "happy" });
    actions.accept(t.id);
  };
  const later = (t: TransferRecord) => {
    if (cat?.id === t.id) setCat({ ...cat, mood: "bye" });
    setDismissed((d) => new Set(d).add(t.id));
  };
  const openMessage = (m: IslandMessage) => {
    if (cat?.variant === "letter") setCat({ ...cat, mood: "happy" });
    onOpenChat(m.conversationId);
    onMessageClose();
  };

  const icon = (t: TransferRecord, cls: string) =>
    isFolderTransfer(t) ? <Folder className={cls} /> : <FileIcon name={t.file_name} className={cls} />;

  let content: React.ReactNode = null;
  if (mode === "request" && request) {
    content = (
      <div className="flex h-full flex-col justify-between px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="h-10 w-10 shrink-0 rounded-[12px] bg-gradient-to-br from-amber-300 to-orange-500 flex items-center justify-center text-white shadow-inner">
            {icon(request, "h-5 w-5")}
          </span>
          <button
            type="button"
            className="min-w-0 flex-1 text-left"
            title="Open the chat"
            onClick={() => request.conversation_id && onOpenChat(request.conversation_id)}
          >
            <span className="block text-[11px] font-medium text-white/60 truncate">
              {request.peer_name || "Someone"} wants to send you {isFolderTransfer(request) ? "a folder" : "a file"}
            </span>
            <span className="block text-[13px] font-semibold truncate">
              {displayName(request)} · {formatSize(request.file_size)}
            </span>
          </button>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10.5px] text-white/50">{requests.length > 1 ? `+${requests.length - 1} more waiting` : "Encrypted · straight from their PC"}</span>
          <span className="flex gap-1.5">
            <button
              type="button"
              onClick={() => later(request)}
              className="px-3 py-1 rounded-full bg-white/12 hover:bg-white/20 text-[11px] font-semibold transition-colors"
            >
              Later
            </button>
            <button
              type="button"
              onClick={() => accept(request)}
              className="px-3.5 py-1 rounded-full bg-sky-500 hover:bg-sky-400 text-[11px] font-bold shadow-md shadow-sky-500/30 transition-colors active:scale-95"
            >
              Accept
            </button>
          </span>
        </div>
      </div>
    );
  } else if (mode === "message" && message) {
    content = (
      <div className="flex h-full items-center gap-3 px-3.5">
        <span
          className="h-11 w-11 shrink-0 rounded-full flex items-center justify-center text-white text-[15px] font-bold shadow-inner ring-2 ring-white/15"
          style={{ backgroundColor: message.color }}
        >
          {message.from.charAt(0).toUpperCase()}
        </span>
        <button type="button" onClick={() => openMessage(message)} className="min-w-0 flex-1 text-left" title="Open the chat">
          <span className="block text-[12.5px] font-semibold truncate">
            {message.from}
            {message.group && <span className="font-medium text-white/50"> · {message.group}</span>}
          </span>
          <span className="block text-[12px] text-white/75 leading-snug line-clamp-2 break-words" data-island-text>
            {message.text}
          </span>
        </button>
        <button
          type="button"
          onClick={() => openMessage(message)}
          className="shrink-0 px-3 py-1 rounded-full bg-sky-500 hover:bg-sky-400 text-[11px] font-bold shadow-md shadow-sky-500/30"
        >
          Open
        </button>
      </div>
    );
  } else if (mode === "done" && done) {
    const incoming = done.direction === "incoming";
    content = (
      <div className="flex h-full items-center gap-3 px-3.5">
        <span className="h-9 w-9 shrink-0 rounded-full bg-emerald-500 flex items-center justify-center lanx-pop">
          <Check className="h-5 w-5" strokeWidth={3} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-semibold truncate">
            {incoming ? "Received" : `Delivered to ${(done.peer_name || "them").split(" ")[0]}`} · {displayName(done)}
          </span>
          <span className="block text-[11px] text-white/60 truncate" data-island-time>
            {transferTiming(done) ?? `${formatSize(done.file_size)} · checksum verified`}
          </span>
        </span>
        {incoming && (
          <button
            type="button"
            onClick={() => actions.open(done.id)}
            className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/12 hover:bg-white/20 text-[11px] font-semibold"
          >
            <ExternalLink className="h-3 w-3" /> Open
          </button>
        )}
      </div>
    );
  } else if (mode === "active" && main) {
    const incoming = main.direction === "incoming";
    content = (
      <button type="button" onClick={() => setExpanded(true)} className="flex h-full w-full items-center gap-2.5 pl-2 pr-2.5" title="Show details">
        <span className={`h-6 w-6 shrink-0 rounded-full flex items-center justify-center ${incoming ? "bg-sky-500" : "bg-indigo-500"}`}>
          {incoming ? <ArrowDown className="h-3.5 w-3.5" strokeWidth={3} /> : <ArrowUp className="h-3.5 w-3.5" strokeWidth={3} />}
        </span>
        <span className="min-w-0 flex-1 truncate text-left text-[12px] font-semibold">
          {displayName(main)}
          {active.length > 1 && <span className="text-white/50 font-medium"> +{active.length - 1}</span>}
        </span>
        <span className="text-[11px] font-bold tabular-nums text-white/80">{pct}%</span>
        <Ring pct={pct} />
      </button>
    );
  } else if (mode === "detail" && main) {
    const incoming = main.direction === "incoming";
    content = (
      <div className="flex h-full flex-col justify-between px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`h-10 w-10 shrink-0 rounded-[12px] flex items-center justify-center ${incoming ? "bg-sky-500" : "bg-indigo-500"}`}>
            {icon(main, "h-5 w-5")}
          </span>
          <button type="button" onClick={() => setExpanded(false)} className="min-w-0 flex-1 text-left" title="Make smaller">
            <span className="block text-[13px] font-semibold truncate">{displayName(main)}</span>
            <span className="block text-[11px] text-white/60 truncate">
              {incoming ? `From ${main.peer_name || "a colleague"}` : `To ${main.peer_name || "a colleague"}`}
              {active.length > 1 ? ` · +${active.length - 1} more` : ""}
            </span>
          </button>
          <button
            type="button"
            onClick={() => actions.cancel(main.id)}
            title="Cancel"
            className="h-7 w-7 shrink-0 rounded-full bg-white/12 hover:bg-red-500/80 flex items-center justify-center transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div>
          <div className="h-1.5 rounded-full bg-white/15 overflow-hidden">
            <div className="h-full rounded-full bg-sky-400 transition-[width] duration-300" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between text-[10.5px] text-white/60 tabular-nums">
            <span>
              {formatSize(moved)} of {formatSize(total)}
            </span>
            <span>{speed > 0 ? `${formatSpeed(speed)} · ${formatEta(total - moved, speed)}` : `${pct}%`}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed top-2 left-1/2 z-[65] -translate-x-1/2 flex flex-col items-center pointer-events-none" data-island={mode}>
      <div
        role="status"
        aria-live="polite"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className={`lanx-island ${mode === "hidden" ? "lanx-island-hidden" : ""}`}
        style={{ width: size.w, height: size.h, borderRadius: size.r }}
      >
        <div key={mode + (request?.id ?? message?.id ?? done?.id ?? "")} className="lanx-island-content h-full">
          {content}
        </div>
      </div>
      {cat && (
        <DeliveryCat
          key={cat.id}
          alertId={cat.id}
          variant={cat.variant}
          from={cat.from}
          fileName={cat.fileName}
          fileSize={cat.fileSize}
          mood={cat.mood}
        />
      )}
    </div>
  );
};
