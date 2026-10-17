import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Bell, Check, ExternalLink, Folder, Phone, PhoneOff, Video, X } from "lucide-react";
import { Profile, TransferActions, TransferProgress, TransferRecord } from "../types";
import { Avatar } from "./Avatar";
import { formatEta, formatSize, formatSpeed, transferTiming } from "../lib/format";
import { FileIcon, displayName, isFolderTransfer } from "./FileCard";
import { CatMood, DeliveryCat } from "./DeliveryCat";
import type { IslandCall } from "./CallLayer";

/** A new message to show (LANX is in front, but that chat isn't open). */
export interface IslandMessage {
  id: string;
  conversationId: string;
  /** The sender, for their avatar. */
  peerId?: string | null;
  from: string;
  color: string;
  /** Already made private where needed ("🔒 Secret message"). */
  text: string;
  /** Group name, for group messages. */
  group?: string | null;
}

/** Someone rang (or you rang someone). */
export interface IslandRing {
  id: string;
  peerId?: string | null;
  name: string;
  color: string;
  conversationId?: string | null;
  /** You rang them. */
  outgoing?: boolean;
}

interface DynamicIslandProps {
  transfers: TransferRecord[];
  message: IslandMessage | null;
  onMessageClose: () => void;
  ring: IslandRing | null;
  onRingClose: () => void;
  call: IslandCall | null;
  callActions: { accept: (video: boolean) => void; decline: () => void; hangup: () => void; toggleSize: () => void };
  progress: Record<string, TransferProgress>;
  actions: TransferActions;
  /** Settings → Appearance → Delivery cat. */
  catEnabled: boolean;
  /** LANX 1.2.9: colleagues' profiles (for their avatars). */
  profiles?: Record<string, Profile>;
  onOpenChat: (conversationId: string) => void;
}

type Mode = "hidden" | "request" | "message" | "ring" | "call" | "callActive" | "active" | "detail" | "done";

const SIZE: Record<Mode, { w: number; h: number; r: number }> = {
  hidden: { w: 120, h: 30, r: 15 },
  active: { w: 320, h: 38, r: 19 },
  detail: { w: 400, h: 128, r: 30 },
  request: { w: 420, h: 110, r: 30 },
  message: { w: 400, h: 78, r: 30 },
  ring: { w: 380, h: 66, r: 33 },
  call: { w: 420, h: 112, r: 30 },
  callActive: { w: 210, h: 36, r: 18 },
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

/** iPhone-style "Dynamic Island": a black capsule just under the chat's top
 *  bar (so it never covers its buttons) that grows to show a file someone
 *  wants to send you (with the delivery cat), what is being received or
 *  sent and how long it took, messages, rings and calls. */
type CatState = {
  id: string;
  variant: "box" | "letter" | "bell" | "phone";
  from: string;
  say?: string;
  fileName?: string;
  fileSize?: number;
  mood: CatMood;
};

export const DynamicIsland: React.FC<DynamicIslandProps> = ({
  transfers,
  message,
  onMessageClose,
  ring,
  onRingClose,
  call,
  callActions,
  progress,
  actions,
  catEnabled,
  onOpenChat,
  profiles = {},
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

  // A ring shows for a few seconds too.
  useEffect(() => {
    if (!ring || hover) return;
    const t = window.setTimeout(onRingClose, 5000);
    return () => window.clearTimeout(t);
  }, [ring?.id, hover]);

  // While a call lasts, the small green pill counts the time.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (call?.status !== "active") return;
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [call?.status]);

  const callRinging = !!call && call.status !== "active";
  const callName = call ? (call.private && call.status === "incoming" ? "Someone" : call.name) : "";

  // The cat drops in with a parcel (files), a letter (messages), a bell
  // (rings) or a phone (calls); it stays a moment afterwards to animate out.
  const want: Omit<CatState, "mood"> | null = !catEnabled
    ? null
    : callRinging && call
      ? {
          id: "call",
          variant: "phone",
          from: callName,
          say:
            call.status === "incoming"
              ? `${callName.split(" ")[0]} is calling you! Pick up? 📞`
              : call.status === "connecting"
                ? "Connecting… 📞"
                : `Calling ${callName.split(" ")[0]}… 📞`,
        }
      : request
        ? { id: request.id, variant: "box", from: request.peer_name || "Someone", fileName: displayName(request), fileSize: request.file_size }
        : ring
          ? {
              id: ring.id,
              variant: "bell",
              from: ring.name,
              say: ring.outgoing ? `Ding ding! Ringing ${ring.name.split(" ")[0]} 🔔` : `${ring.name.split(" ")[0]} is ringing you! 🔔`,
            }
          : message
            ? { id: `msg-${message.conversationId}`, variant: "letter", from: message.from }
            : null;
  useEffect(() => {
    if (!catEnabled) {
      if (cat) setCat(null);
      return;
    }
    if (want) {
      if (!cat || (cat.mood === "hello" && (cat.id !== want.id || cat.say !== want.say))) {
        setCat({ ...want, mood: cat && cat.id === want.id ? cat.mood : "hello" });
      }
    } else if (cat?.mood === "hello") {
      let mood: CatMood = "bye";
      if (cat.variant === "box") {
        // Answered somewhere else (the chat's Accept/Decline buttons).
        const now = transfers.find((t) => t.id === cat.id);
        mood = now && ["declined", "cancelled"].includes(now.status) ? "bye" : "happy";
      } else if (cat.variant === "phone") {
        mood = call?.status === "active" ? "happy" : "bye";
      }
      setCat({ ...cat, mood });
    }
  }, [want?.id, want?.say, catEnabled, cat, call?.status]);
  useEffect(() => {
    if (!cat || cat.mood === "hello") return;
    const t = window.setTimeout(() => setCat(null), cat.mood === "happy" ? 1300 : 1100);
    return () => window.clearTimeout(t);
  }, [cat]);

  const mode: Mode = callRinging
    ? "call"
    : request
      ? "request"
      : ring
        ? "ring"
        : message
          ? "message"
          : done
            ? "done"
            : call?.status === "active"
              ? "callActive"
              : active.length
                ? expanded
                  ? "detail"
                  : "active"
                : "hidden";
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
  } else if (mode === "call" && call) {
    const incoming = call.status === "incoming";
    content = (
      <div className="flex h-full flex-col justify-between px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="relative h-11 w-11 shrink-0">
            <span className="absolute inset-0 rounded-full bg-emerald-400/40 animate-ping" />
            <Avatar
              name={callName}
              color={call.private && incoming ? "#64748b" : call.color}
              profile={call.private ? null : call.peerId ? profiles[call.peerId] : null}
              size={44}
              className="relative ring-2 ring-white/20 rounded-full"
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold truncate">{callName}</span>
            <span className="block text-[11px] text-white/60 truncate" data-island-call={call.status}>
              {incoming
                ? `${call.video ? "Video" : "Voice"} call for you…`
                : call.status === "connecting"
                  ? "Connecting…"
                  : `Calling… (${call.video ? "video" : "voice"})`}
            </span>
          </span>
          {call.video ? <Video className="h-5 w-5 text-emerald-400" /> : <Phone className="h-5 w-5 text-emerald-400" />}
        </div>
        <div className="flex items-center justify-end gap-1.5">
          {incoming ? (
            <>
              <button
                type="button"
                onClick={callActions.decline}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-red-500 hover:bg-red-400 text-[11px] font-bold"
              >
                <PhoneOff className="h-3.5 w-3.5" /> Decline
              </button>
              {call.video && (
                <button
                  type="button"
                  onClick={() => callActions.accept(true)}
                  className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-500 hover:bg-emerald-400 text-[11px] font-bold"
                >
                  <Video className="h-3.5 w-3.5" /> Video
                </button>
              )}
              <button
                type="button"
                onClick={() => callActions.accept(false)}
                className="inline-flex items-center gap-1 px-3.5 py-1 rounded-full bg-emerald-500 hover:bg-emerald-400 text-[11px] font-bold shadow-md shadow-emerald-500/30"
              >
                <Phone className="h-3.5 w-3.5" /> {call.video ? "Voice" : "Answer"}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={callActions.hangup}
              className="inline-flex items-center gap-1 px-3.5 py-1 rounded-full bg-red-500 hover:bg-red-400 text-[11px] font-bold"
            >
              <PhoneOff className="h-3.5 w-3.5" /> Cancel
            </button>
          )}
        </div>
      </div>
    );
  } else if (mode === "callActive" && call) {
    const secs = call.connectedAt ? Math.max(0, Math.floor((Date.now() - call.connectedAt) / 1000)) : 0;
    content = (
      <button type="button" onClick={callActions.toggleSize} className="flex h-full w-full items-center gap-2 px-3" title="Show the call">
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
        {call.video ? <Video className="h-4 w-4 text-emerald-400" /> : <Phone className="h-4 w-4 text-emerald-400" />}
        <span className="min-w-0 flex-1 truncate text-left text-[12px] font-semibold">{call.name.split(" ")[0]}</span>
        <span className="text-[12px] font-bold tabular-nums text-emerald-400" data-island-call="active">
          {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
        </span>
      </button>
    );
  } else if (mode === "ring" && ring) {
    content = (
      <div className="flex h-full items-center gap-3 px-3.5">
        <span className="relative shrink-0">
          <Avatar name={ring.name} color={ring.color} profile={ring.peerId ? profiles[ring.peerId] : null} size={40} />
          <span className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-gradient-to-br from-amber-300 to-amber-500 flex items-center justify-center lanx-bell ring-2 ring-black">
            <Bell className="h-3 w-3 text-amber-950" />
          </span>
        </span>
        <button
          type="button"
          onClick={() => {
            if (ring.conversationId) onOpenChat(ring.conversationId);
            onRingClose();
          }}
          className="min-w-0 flex-1 text-left"
          title="Open the chat"
          data-island-ring
        >
          <span className="block text-[12.5px] font-semibold truncate">{ring.outgoing ? `Ringing ${ring.name}…` : `${ring.name} is ringing you`}</span>
          <span className="block text-[11px] text-white/60 truncate">{ring.outgoing ? "Their LANX rings and flashes" : "They want your attention"}</span>
        </button>
      </div>
    );
  } else if (mode === "message" && message) {
    content = (
      <div className="flex h-full items-center gap-3 px-3.5">
        <Avatar
          name={message.from}
          color={message.color}
          profile={message.peerId ? profiles[message.peerId] : null}
          size={44}
          className="ring-2 ring-white/15 rounded-full"
        />
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
    <div
      className={`fixed top-[98px] left-1/2 ${mode === "call" || mode === "callActive" ? "z-[75]" : "z-[45]"} -translate-x-1/2 flex flex-col items-center pointer-events-none`}
      data-island={mode}
    >
      <div
        role="status"
        aria-live="polite"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className={`lanx-island ${mode === "hidden" ? "lanx-island-hidden" : ""}`}
        style={{ width: size.w, height: size.h, borderRadius: size.r }}
      >
        <div key={mode + (request?.id ?? ring?.id ?? message?.id ?? done?.id ?? (mode === "call" ? call?.status : ""))} className="lanx-island-content h-full">
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
          say={cat.say}
          mood={cat.mood}
        />
      )}
    </div>
  );
};
