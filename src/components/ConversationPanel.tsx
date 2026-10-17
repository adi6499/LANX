import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import {
  Conversation,
  Message,
  Peer,
  SECRET_TIMERS,
  TransferActions,
  TransferProgress,
  TransferRecord,
  secretLabel,
} from "../types";
import {
  Send,
  ArrowUp,
  Paperclip,
  Smile,
  Info,
  Shield,
  ShieldAlert,
  ShieldBan,
  Clock,
  Check,
  CheckCheck,
  AlertCircle,
  Copy,
  Trash2,
  Lock,
  CloudUpload,
  X,
  Bell,
  Timer,
  Users,
  Eye,
  EyeOff,
  Phone,
  FolderUp,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Video,
} from "lucide-react";
import { FileCard, GroupFileCard } from "./FileCard";
import { lessMotion } from "../lib/motion";
import { Avatar } from "./Avatar";
import { statusLine } from "../lib/profile";
import type { Profile } from "../types";

interface ConversationPanelProps {
  conversation: Conversation | null;
  peer: Peer | null;
  /** LANX 1.2.9: the colleague's avatar, status and about me. */
  peerProfile?: Profile | null;
  peers: Peer[];
  messages: Message[];
  transfers: Record<string, TransferRecord>;
  transfersByParent: Record<string, TransferRecord[]>;
  progress: Record<string, TransferProgress>;
  transferActions: TransferActions;
  isContextOpen: boolean;
  isDraggingFiles: boolean;
  notice: string | null;
  typingName: string | null;
  ringPulse: number;
  onDismissNotice: () => void;
  onToggleContext: () => void;
  onSendMessage: (content: string) => Promise<boolean>;
  onRetryMessage: (messageId: string) => void;
  onDeleteConversation: () => void;
  onPickFiles: () => void;
  onPickFolder: () => void;
  onPasteImage: (dataUrl: string, mime: string) => void;
  onTyping: () => void;
  onRing: () => void;
  onSetSecret: (ttl: number) => void;
  onSetHidden: (hidden: boolean) => void;
  onCall: (video: boolean) => void;
  onUnblock: () => void;
}

const QUICK_EMOJIS = ["👍", "🙏", "✅", "👋", "😀", "🎉", "🔥", "❤️", "⚡", "📎"];
const NAME_COLORS = ["text-indigo-600", "text-emerald-600", "text-pink-600", "text-amber-600", "text-sky-600", "text-violet-600"];

function dayLabel(ts: number): string {
  const d = new Date(ts * 1000);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function countdown(secs: number): string {
  if (secs <= 0) return "now";
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} h ${Math.floor((secs % 3600) / 60)} min`;
  return `${Math.ceil(secs / 86400)} days`;
}

/** A callback ref that keeps track of an element's height. */
function useHeight(initial: number): [(el: HTMLElement | null) => void, number] {
  const [height, setHeight] = useState(initial);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    setHeight(el.offsetHeight);
    observer.current = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.current.observe(el);
  }, []);
  return [ref, height];
}

function nameColor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return NAME_COLORS[h % NAME_COLORS.length];
}

export const ConversationPanel: React.FC<ConversationPanelProps> = ({
  conversation,
  peer,
  peerProfile = null,
  peers,
  messages,
  transfers,
  transfersByParent,
  progress,
  transferActions,
  isContextOpen,
  isDraggingFiles,
  notice,
  typingName,
  ringPulse,
  onDismissNotice,
  onToggleContext,
  onSendMessage,
  onRetryMessage,
  onDeleteConversation,
  onPickFiles,
  onPickFolder,
  onPasteImage,
  onTyping,
  onRing,
  onSetSecret,
  onSetHidden,
  onCall,
  onUnblock,
}) => {
  const [inputText, setInputText] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [secretMenu, setSecretMenu] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [, setTick] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [topRef, topH] = useHeight(92);
  const [bottomRef, bottomH] = useHeight(96);

  // Messages that arrive while a chat is open animate in; the ones that are
  // already there when it opens just fade in together.
  const opened = useRef({ id: "", at: 0, kinds: new Map<string, string>() });
  if (conversation && opened.current.id !== conversation.id) {
    opened.current = { id: conversation.id, at: Date.now(), kinds: new Map() };
  }
  const justOpened = () => Date.now() - opened.current.at < 700;

  // Opening a chat jumps to the newest message; new messages scroll in smoothly.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: justOpened() ? "auto" : "smooth" });
  }, [messages.length, conversation?.id]);

  useEffect(() => {
    setConfirmDelete(false);
    setSecretMenu(false);
    setInputText("");
    textareaRef.current?.focus();
  }, [conversation?.id]);

  // A ring arrived for this chat: shake the panel.
  useEffect(() => {
    if (!ringPulse) return;
    if (lessMotion()) return;
    // (Web Animations, so the screen's own entrance animation never replays.)
    rootRef.current?.animate(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-7px)", offset: 0.15 },
        { transform: "translateX(7px)", offset: 0.35 },
        { transform: "translateX(-7px)", offset: 0.55 },
        { transform: "translateX(7px)", offset: 0.75 },
        { transform: "translateX(0)" },
      ],
      { duration: 450, easing: "ease-in-out" }
    );
  }, [ringPulse]);

  // Secret messages count down once read.
  const hasTimers = messages.some((m) => m.ttl_secs && m.expire_at);
  useEffect(() => {
    if (!hasTimers) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [hasTimers]);

  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
  }, [inputText]);

  if (!conversation) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center p-8 text-center select-none lanx-screen-in">
        <div className="flex h-20 w-20 items-center justify-center rounded-[24px] lanx-glass text-sky-500 mb-5 lanx-float">
          <Send className="h-9 w-9" />
        </div>
        <h3 className="text-xl font-semibold tracking-[-0.02em] text-slate-800 dark:text-white">No chat selected</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-sm">
          Pick a colleague on the left, or open Peers to see every computer running LANX on your network.
        </p>
      </div>
    );
  }

  const isGroup = conversation.kind === "group";
  const blocked = !isGroup && peer?.trust_state === "blocked";
  const outOfGroup = isGroup && conversation.membership !== "member";
  const secret = !isGroup && conversation.secret_ttl > 0;
  const hidden = conversation.is_hidden;
  const nowSecs = Math.floor(Date.now() / 1000);
  const peerName = (id: string) => peers.find((p) => p.id === id)?.display_name ?? "Someone";

  const handleSend = async () => {
    const text = inputText;
    if (!text.trim()) return;
    setInputText("");
    setShowEmojiPicker(false);
    const ok = await onSendMessage(text);
    if (!ok) setInputText(text);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const file = Array.from(e.clipboardData.items)
      .find((i) => i.kind === "file" && i.type.startsWith("image/"))
      ?.getAsFile();
    if (!file) return;
    e.preventDefault();
    const reader = new FileReader();
    reader.onload = () => onPasteImage(String(reader.result), file.type || "image/png");
    reader.readAsDataURL(file);
  };

  const formatMessageTime = (ts: number) =>
    new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const lastReadId = [...messages].reverse().find((m) => m.is_outgoing && m.status === "read" && m.message_type === "text")?.id;

  const statusIcon = (msg: Message) => {
    if (isGroup && msg.deliveries) {
      const d = msg.deliveries;
      const title = [
        d.read_by.length ? `Seen by ${d.read_by.join(", ")}` : "",
        d.waiting_for.length ? `Waiting for ${d.waiting_for.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      return (
        <span className="inline-flex items-center gap-1" title={title}>
          {d.read > 0 ? <CheckCheck className="h-3 w-3 text-emerald-200" /> : d.delivered > 0 ? <CheckCheck className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
          <span>{d.read > 0 ? `Seen by ${d.read}` : `${d.delivered}/${d.total}`}</span>
        </span>
      );
    }
    switch (msg.status) {
      case "sending":
        return <Clock className="h-3 w-3 animate-pulse" aria-label="Sending" />;
      case "queued":
        return (
          <span className="inline-flex items-center gap-0.5" title={msg.error_reason || "Queued"}>
            <Clock className="h-3 w-3" />
            <span>Queued</span>
          </span>
        );
      case "delivered":
        return <CheckCheck className="h-3 w-3" aria-label="Delivered" />;
      case "read":
        return (
          <span className="inline-flex items-center gap-0.5" aria-label="Read">
            <CheckCheck className="h-3 w-3 text-emerald-200" />
            {msg.id === lastReadId && <span className="text-emerald-100">Seen</span>}
          </span>
        );
      case "failed":
        return (
          <button
            type="button"
            onClick={() => onRetryMessage(msg.id)}
            title={msg.error_reason || "Not delivered. Click to retry."}
            className="inline-flex items-center gap-1 text-red-100 hover:text-white hover:underline"
          >
            <AlertCircle className="h-3 w-3" />
            <span>Not sent · Retry</span>
          </button>
        );
      default:
        return <Check className="h-3 w-3" />;
    }
  };

  const eventLine = (msg: Message): React.ReactNode => {
    if (msg.message_type === "system") return msg.content;
    if (msg.message_type === "secret_setting") {
      const ttl = Number(msg.content) || 0;
      const who = msg.is_outgoing ? "You" : conversation.peer_name;
      return ttl > 0 ? (
        <span className="inline-flex items-center gap-1">
          <Timer className="h-3 w-3" /> {who} turned on secret messages · they disappear {secretLabel(ttl)} after reading
        </span>
      ) : (
        `${who} turned off secret messages`
      );
    }
    if (msg.message_type === "call") {
      let v: { video?: boolean; outcome?: string; secs?: number } = {};
      try {
        v = JSON.parse(msg.content);
      } catch {
        /* old or damaged record */
      }
      const kind = v.video ? "video" : "voice";
      const secs = v.secs ?? 0;
      const dur = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
      const name = conversation.peer_name;
      const out = msg.is_outgoing;
      let text: string;
      let missed = false;
      let callBack = false;
      switch (v.outcome) {
        case "answered":
          text = `${v.video ? "Video" : "Voice"} call · ${dur}`;
          break;
        case "missed":
          text = `Missed ${kind} call from ${name}`;
          missed = callBack = true;
          break;
        case "busy":
          text = `Missed ${kind} call from ${name} (you were on another call)`;
          missed = callBack = true;
          break;
        case "declined":
          text = out ? `${name} declined your ${kind} call` : `You declined a ${kind} call`;
          callBack = out;
          break;
        case "no_answer":
          text = `${name} didn't answer`;
          callBack = true;
          break;
        case "cancelled":
          text = `You cancelled a ${kind} call`;
          break;
        default:
          text = "Call failed";
          callBack = true;
      }
      const Icon = missed ? PhoneMissed : v.video ? Video : out ? PhoneOutgoing : PhoneIncoming;
      return (
        <span className={`inline-flex items-center gap-1.5 ${missed ? "text-red-600 dark:text-red-400 font-medium" : ""}`}>
          <Icon className="h-3.5 w-3.5" /> {text}
          {callBack && !blocked && (
            <button
              type="button"
              onClick={() => onCall(!!v.video)}
              className="ml-1 rounded-full bg-sky-500/10 px-2 py-0.5 font-semibold text-sky-600 dark:text-sky-400 hover:bg-sky-500/20"
            >
              Call back
            </button>
          )}
        </span>
      );
    }
    if (msg.message_type === "ring") {
      const text = msg.is_outgoing
        ? `You rang ${isGroup ? "the group" : conversation.peer_name}`
        : `${isGroup ? peerName(msg.sender_id) : conversation.peer_name} rang ${isGroup ? "the group" : "you"}`;
      return (
        <span className="inline-flex items-center gap-1">
          <Bell className="h-3 w-3 lanx-bell" /> {text}
        </span>
      );
    }
    return null;
  };

  let lastDay = "";
  let lastSender = "";

  const toolCls = "lanx-tool p-2 text-slate-600 dark:text-slate-300 transition-colors disabled:opacity-40";

  /** How a message enters: yours spring up, theirs pop in (decided once per message). */
  const enterClass = (msg: Message) => {
    let k = opened.current.kinds.get(msg.id);
    if (k === undefined) {
      k = justOpened() || msg.conversation_id !== conversation.id ? "" : msg.is_outgoing ? "lanx-send" : "lanx-recv";
      opened.current.kinds.set(msg.id, k);
    }
    return k;
  };

  return (
    <div
      data-hidden-chat={hidden ? "true" : undefined}
      ref={rootRef}
      className={`flex-1 h-full relative overflow-hidden select-none lanx-screen-in ${hidden ? "lanx-hidden-bg" : ""}`}
    >
      {/* Top: glass header that the messages scroll underneath */}
      <div ref={topRef} className="absolute top-0 inset-x-0 z-20">
        <div className={`lanx-bar border-b lanx-line ${hidden ? "bg-gradient-to-r from-violet-500/20 via-violet-500/5 to-transparent" : ""}`}>
          <header className="h-16 px-5 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="relative shrink-0">
                <Avatar
                  name={conversation.peer_name}
                  color={conversation.peer_avatar_color}
                  profile={isGroup ? null : peerProfile}
                  size={40}
                  className={`rounded-full ${hidden ? "ring-2 ring-violet-500 ring-offset-2 ring-offset-transparent" : ""}`}
                >
                  {isGroup ? <Users className="h-5 w-5" /> : undefined}
                </Avatar>
                {hidden ? (
                  <span className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-violet-600 text-white flex items-center justify-center ring-2 ring-white dark:ring-[#1c1e24]">
                    <EyeOff className="h-2.5 w-2.5" />
                  </span>
                ) : (
                  <span
                    className={`absolute bottom-0 right-0 h-3 w-3 rounded-full ring-2 ring-white dark:ring-[#1c1e24] ${
                      conversation.peer_status === "online" ? "bg-emerald-500" : "bg-slate-400"
                    }`}
                  />
                )}
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-slate-900 dark:text-white truncate min-w-[5rem]" title={conversation.peer_name}>
                    {conversation.peer_name}
                  </h2>
                  {isGroup ? (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 text-[10px] font-semibold">
                      <Users className="h-3 w-3" /> {conversation.member_count} members
                    </span>
                  ) : peer?.trust_state === "trusted" ? (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold">
                      <Shield className="h-3 w-3" /> Trusted
                    </span>
                  ) : blocked ? (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 text-[10px] font-semibold">
                      <ShieldBan className="h-3 w-3" /> Blocked
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-semibold">
                      <ShieldAlert className="h-3 w-3" /> Unverified
                    </span>
                  )}
                  {secret && (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-300 text-[10px] font-semibold">
                      <Timer className="h-3 w-3" /> Secret
                    </span>
                  )}
                  {hidden && (
                    <span className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-violet-600 text-white text-[10px] font-semibold shadow-sm shadow-violet-500/30">
                      <EyeOff className="h-3 w-3" /> Hidden
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap min-w-0">
                  {typingName ? (
                    <span className="text-sky-600 dark:text-sky-400 font-medium inline-flex items-center gap-1">
                      {isGroup ? `${typingName} is typing` : "typing"}
                      <span className="lanx-typing"><i /><i /><i /></span>
                    </span>
                  ) : !isGroup && statusLine(peerProfile) ? (
                    <span className="truncate font-medium" style={{ color: statusLine(peerProfile)!.color }} data-header-status>
                      {statusLine(peerProfile)!.emoji} {statusLine(peerProfile)!.text}
                      {conversation.peer_status !== "online" && <span className="text-slate-400 font-normal"> · offline</span>}
                    </span>
                  ) : conversation.peer_status === "online" ? (
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">{isGroup ? "Members online" : "Online"}</span>
                  ) : (
                    <span className="truncate" title="Messages and files wait and are delivered when they come back online">
                      Offline · messages will wait
                    </span>
                  )}
                  {!isGroup && (
                    <>
                      <span>•</span>
                      <span className="font-mono text-[11px] text-slate-400">{conversation.peer_ip}</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-0.5 shrink-0">
              {!isGroup && (
                <>
                  <button
                    type="button"
                    onClick={() => onCall(false)}
                    disabled={blocked}
                    title={`Voice call ${conversation.peer_name}`}
                    className={`${toolCls} hover:text-emerald-600`}
                  >
                    <Phone className="h-[17px] w-[17px]" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onCall(true)}
                    disabled={blocked}
                    title={`Video call ${conversation.peer_name}`}
                    className={`${toolCls} hover:text-emerald-600`}
                  >
                    <Video className="h-[17px] w-[17px]" />
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={onRing}
                disabled={blocked || outOfGroup}
                title={isGroup ? "Ring everyone online in this group" : `Ring ${conversation.peer_name} to get their attention`}
                className={`${toolCls} hover:text-amber-600`}
              >
                <Bell className="h-[17px] w-[17px]" />
              </button>

              {!isGroup && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setSecretMenu(!secretMenu)}
                    disabled={blocked}
                    title="Secret messages (disappear after reading)"
                    className={`${toolCls} ${secret ? "!bg-violet-500/15 !text-violet-600 dark:!text-violet-300" : "hover:text-slate-900 dark:hover:text-white"}`}
                  >
                    <Timer className="h-[17px] w-[17px]" />
                  </button>
                  {secretMenu && (
                    <div className="absolute right-0 top-11 z-30 w-60 rounded-[14px] lanx-menu p-1.5 lanx-menu-in">
                      <div className="px-2.5 py-2 text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                        New messages disappear for both of you this long after they are read. Screenshots of LANX are blocked while a secret chat is open.
                      </div>
                      {SECRET_TIMERS.map((t) => (
                        <button
                          key={t.secs}
                          type="button"
                          onClick={() => {
                            setSecretMenu(false);
                            onSetSecret(t.secs);
                          }}
                          className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs ${
                            conversation.secret_ttl === t.secs ? "bg-violet-500/15 text-violet-700 dark:text-violet-300 font-semibold" : "text-slate-700 dark:text-slate-200 hover:bg-[var(--lanx-fill)]"
                          }`}
                        >
                          {t.label} after reading
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          setSecretMenu(false);
                          onSetSecret(0);
                        }}
                        className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs ${
                          !secret ? "bg-[var(--lanx-fill)] font-semibold" : "hover:bg-[var(--lanx-fill)]"
                        } text-slate-700 dark:text-slate-200`}
                      >
                        Off — keep messages
                      </button>
                    </div>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={() => onSetHidden(!hidden)}
                title={hidden ? "Unhide this chat (back to the normal list)" : "Hide this chat (only shows after your PIN)"}
                className={`${toolCls} ${hidden ? "!bg-violet-600 !text-white hover:!bg-violet-700" : "hover:text-violet-600"}`}
              >
                {hidden ? <Eye className="h-[17px] w-[17px]" /> : <EyeOff className="h-[17px] w-[17px]" />}
              </button>

              {confirmDelete ? (
                <div className="flex items-center gap-1 rounded-full bg-red-500/10 border border-red-500/20 pl-3 pr-1 py-1 text-[11px]">
                  <span className="text-red-700 dark:text-red-300 font-medium">Delete this chat?</span>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmDelete(false);
                      onDeleteConversation();
                    }}
                    className="px-2.5 py-0.5 rounded-full bg-red-500 text-white font-semibold hover:bg-red-600"
                  >
                    Delete
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(false)} className="px-2.5 py-0.5 rounded-full text-slate-600 dark:text-slate-300 hover:bg-[var(--lanx-fill)]">
                    Keep
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  title="Delete chat history"
                  className={`${toolCls} hover:text-red-500`}
                >
                  <Trash2 className="h-[17px] w-[17px]" />
                </button>
              )}

              <button
                type="button"
                onClick={onToggleContext}
                title={isGroup ? "Group details" : "Contact details"}
                className={`${toolCls} ${isContextOpen ? "!bg-sky-500/15 !text-sky-600 dark:!text-sky-400" : "hover:text-slate-900 dark:hover:text-white"}`}
              >
                <Info className="h-[17px] w-[17px]" />
              </button>
            </div>
          </header>

          {/* Security strip */}
          <div
            className={`px-5 py-1 flex items-center justify-between text-[11px] ${
              secret ? "bg-violet-500/10 text-violet-700 dark:text-violet-300" : "text-slate-500 dark:text-slate-400"
            }`}
          >
            <div className="flex items-center gap-1.5">
              {secret ? <Timer className="h-3 w-3" /> : <Lock className="h-3 w-3 text-emerald-500" />}
              <span>
                {secret
                  ? `Secret chat · new messages disappear ${secretLabel(conversation.secret_ttl)} after they're read · screenshots blocked`
                  : isGroup
                    ? "End-to-end encrypted · sent directly to each member's computer"
                    : "End-to-end encrypted · goes straight to their computer, never through the internet"}
              </span>
            </div>
            {!isGroup && <span className="font-mono text-[10px] opacity-70">TCP :{peer?.tcp_port || 52926}</span>}
          </div>
        </div>

        {hidden && (
          <div className="px-5 py-2 flex items-center gap-3 bg-violet-600/95 backdrop-blur-xl text-white text-[11px] shadow-sm lanx-fade">
            <EyeOff className="h-4 w-4 shrink-0" />
            <span className="flex-1 leading-snug">
              <b>You're in a hidden chat.</b> It isn't in your normal chat list and only shows after your PIN. It hides again when you press
              “Hide again” or LANX locks.
            </span>
            <button
              type="button"
              onClick={() => onSetHidden(false)}
              className="shrink-0 px-2.5 py-1 rounded-full bg-white/20 hover:bg-white/30 font-semibold"
            >
              Unhide chat
            </button>
          </div>
        )}

        {notice && (
          <div className="mx-6 mt-3 flex items-start gap-2 rounded-2xl border border-amber-300/60 bg-amber-50/90 dark:bg-amber-950/70 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-200 shadow-lg backdrop-blur-xl lanx-rise">
            <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
            <span className="flex-1 whitespace-pre-line">{notice}</span>
            <button type="button" onClick={onDismissNotice} className="p-0.5 rounded hover:bg-amber-100 dark:hover:bg-amber-900/50">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Messages: run the full height, under the glass header and message box */}
      <div
        className="absolute inset-0 overflow-y-auto px-6 lanx-under"
        style={
          {
            paddingTop: topH + 14,
            paddingBottom: bottomH + 14,
            "--lanx-top": `${topH}px`,
            "--lanx-bottom": `${bottomH}px`,
          } as React.CSSProperties
        }
        onClick={() => setSecretMenu(false)}
      >
        <div key={conversation.id} className="min-h-full space-y-2.5 lanx-chat-in">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 text-xs text-slate-400">
            <div className="h-14 w-14 rounded-full lanx-card flex items-center justify-center text-slate-400 mb-3 lanx-float">
              {isGroup ? <Users className="h-6 w-6" /> : <Lock className="h-6 w-6" />}
            </div>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Say hello to {conversation.peer_name}</p>
            <p className="mt-1 text-slate-500 dark:text-slate-400 max-w-xs">
              Messages and files go directly across your office network, encrypted. Drag files here, or paste a screenshot with Ctrl+V.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isOut = msg.is_outgoing;
            const day = dayLabel(msg.timestamp);
            const showDay = day !== lastDay;
            lastDay = day;
            const line = eventLine(msg);
            if (line) {
              lastSender = "";
              return (
                <React.Fragment key={msg.id}>
                  {showDay && <DaySeparator day={day} />}
                  <div className="flex justify-center lanx-fade">
                    <span className="max-w-md text-center px-3 py-1 rounded-full lanx-chip text-[11px] text-slate-500 dark:text-slate-300">
                      {line}
                    </span>
                  </div>
                </React.Fragment>
              );
            }
            const isFile = msg.message_type === "file";
            const showSender = isGroup && !isOut && (msg.sender_id !== lastSender || showDay);
            lastSender = isOut ? "" : msg.sender_id;
            const transfer = msg.transfer_id ? transfers[msg.transfer_id] : undefined;
            const groupCopies = isFile && isGroup && isOut && msg.transfer_id ? transfersByParent[msg.transfer_id] ?? [] : null;
            const isSecret = !!msg.ttl_secs;
            const left = msg.expire_at ? msg.expire_at - nowSecs : null;
            const timerRunning = isSecret && left !== null && left <= (msg.ttl_secs ?? 0) + 2;
            return (
              <React.Fragment key={msg.id}>
                {showDay && <DaySeparator day={day} />}
                <div className={`flex flex-col group ${enterClass(msg)} ${isOut ? "items-end" : "items-start"}`}>
                  {showSender && (
                    <span className={`ml-3 mb-0.5 text-[11px] font-semibold ${nameColor(msg.sender_id)}`}>{peerName(msg.sender_id)}</span>
                  )}
                  <div
                    className={`relative max-w-lg rounded-[18px] px-3.5 py-2 text-[13px] ${
                      isSecret
                        ? isOut
                          ? "bg-violet-600 text-white rounded-br-[6px] shadow-sm"
                          : "bg-violet-50 dark:bg-violet-950/60 text-slate-900 dark:text-slate-100 border border-violet-200 dark:border-violet-900 rounded-bl-[6px]"
                        : isOut
                          ? "bg-sky-500 text-white rounded-br-[6px] shadow-sm shadow-sky-500/20"
                          : "lanx-bubble-in text-slate-900 dark:text-slate-100 rounded-bl-[6px]"
                    }`}
                  >
                    {groupCopies ? (
                      <GroupFileCard transfers={groupCopies} fallbackName={msg.content.replace(/^(📎|📁)\s*/u, "")} progress={progress} actions={transferActions} />
                    ) : isFile ? (
                      <FileCard
                        transfer={transfer}
                        fallbackName={msg.content.replace(/^(📎|📁)\s*/u, "")}
                        progress={msg.transfer_id ? progress[msg.transfer_id] : undefined}
                        actions={transferActions}
                        onAccent={isOut}
                      />
                    ) : (
                      <p className={`whitespace-pre-wrap break-words leading-relaxed ${isSecret ? "select-none" : "select-text"}`}>{msg.content}</p>
                    )}

                    <div
                      className={`mt-0.5 flex items-center justify-end gap-1.5 text-[10px] ${
                        isOut ? (isSecret ? "text-violet-100/90" : "text-white/75") : "text-slate-400"
                      }`}
                    >
                      {isSecret && (
                        <span className="inline-flex items-center gap-0.5" title={`Disappears ${secretLabel(msg.ttl_secs!)} after it's read`}>
                          <Timer className="h-3 w-3" />
                          {timerRunning ? countdown(Math.max(0, left!)) : "secret"}
                        </span>
                      )}
                      <span>{formatMessageTime(msg.timestamp)}</span>
                      {isOut && !isFile && <span className="inline-flex items-center">{statusIcon(msg)}</span>}
                    </div>

                    {!isFile && !isSecret && (
                      <button
                        type="button"
                        onClick={() => navigator.clipboard.writeText(msg.content).catch(() => {})}
                        title="Copy text"
                        className={`absolute top-2 ${isOut ? "-left-8" : "-right-8"} opacity-0 group-hover:opacity-100 p-1.5 rounded-full lanx-menu text-slate-500 hover:text-slate-800 dark:hover:text-white transition-opacity`}
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  {isOut && msg.status === "queued" && msg.error_reason && !isFile && !isGroup && (
                    <span className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">{msg.error_reason}</span>
                  )}
                  {isOut && msg.status === "failed" && msg.error_reason && !isFile && (
                    <span className="mt-0.5 text-[10px] text-red-500">{msg.error_reason}</span>
                  )}
                </div>
              </React.Fragment>
            );
          })
        )}
        {typingName && (
          <div className="flex items-start lanx-fade">
            <div className="rounded-[18px] rounded-bl-[6px] lanx-bubble-in px-4 py-3">
              <span className="lanx-typing lanx-typing-lg"><i /><i /><i /></span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Bottom: glass message box */}
      <div
        ref={bottomRef}
        className={`absolute bottom-0 inset-x-0 z-20 lanx-bar border-t lanx-line ${hidden ? "bg-gradient-to-r from-violet-500/15 to-transparent" : ""}`}
      >
        {showEmojiPicker && (
          <div className="px-5 pt-2 flex items-center gap-1 overflow-x-auto lanx-screen-in">
            {QUICK_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => setInputText((prev) => prev + emoji)}
                className="h-8 w-8 rounded-full hover:bg-[var(--lanx-fill)] flex items-center justify-center text-base transition-transform active:scale-125"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        <div className="px-4 pt-3 pb-2.5">
          {blocked ? (
            <div className="flex items-center justify-between rounded-2xl border border-red-200 dark:border-red-900 bg-red-50/90 dark:bg-red-950/40 px-4 py-3 text-xs text-red-700 dark:text-red-300">
              <span>You blocked {conversation.peer_name}. They can't message you or send you files.</span>
              <button type="button" onClick={onUnblock} className="px-3 py-1 rounded-full bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900 font-semibold hover:bg-red-100 dark:hover:bg-red-950">
                Unblock
              </button>
            </div>
          ) : outOfGroup ? (
            <div className="rounded-2xl lanx-group px-4 py-3 text-xs text-slate-500 dark:text-slate-400 text-center">
              {conversation.membership === "removed" ? "You were removed from this group." : "You left this group."} You can still read the history.
            </div>
          ) : (
            <>
              <div className="flex items-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  title="Emoji"
                  className={`lanx-tool p-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 ${showEmojiPicker ? "!bg-[var(--lanx-fill)]" : ""}`}
                >
                  <Smile className="h-[18px] w-[18px]" />
                </button>
                <button
                  type="button"
                  onClick={onPickFiles}
                  title="Send files (any size)"
                  className="lanx-tool p-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
                >
                  <Paperclip className="h-[18px] w-[18px]" />
                </button>
                <button
                  type="button"
                  onClick={onPickFolder}
                  title="Send a whole folder"
                  className="lanx-tool p-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
                >
                  <FolderUp className="h-[18px] w-[18px]" />
                </button>

                <div
                  className={`flex-1 flex items-end gap-2 rounded-[20px] pl-4 pr-1 py-1 transition-shadow focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-sky-500)_30%,transparent)] ${
                    secret || hidden
                      ? "bg-violet-500/10 shadow-[inset_0_0_0_1px_rgb(139_92_246/0.35)]"
                      : "bg-[color-mix(in_srgb,var(--lanx-surface)_70%,transparent)] shadow-[inset_0_0_0_1px_var(--lanx-line)]"
                  }`}
                >
                  <textarea
                    ref={textareaRef}
                    rows={1}
                    value={inputText}
                    onChange={(e) => {
                      setInputText(e.target.value);
                      if (e.target.value.trim()) onTyping();
                    }}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    placeholder={secret ? `Secret message to ${conversation.peer_name}…` : `Message ${conversation.peer_name}…`}
                    className="flex-1 bg-transparent text-[13px] text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus-visible:outline-none resize-none py-1.5 leading-relaxed select-text"
                  />

                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={!inputText.trim()}
                    title="Send (Enter)"
                    className={`mb-0.5 h-7 w-7 shrink-0 flex items-center justify-center rounded-full text-white shadow-sm disabled:opacity-30 disabled:shadow-none transition-all duration-200 active:scale-90 ${
                      secret ? "bg-violet-600 hover:bg-violet-700" : "bg-sky-500 hover:bg-sky-600"
                    } ${inputText.trim() ? "scale-100" : "scale-90"}`}
                  >
                    <ArrowUp className="h-4 w-4" strokeWidth={2.6} />
                  </button>
                </div>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-500 px-1">
                <span>Enter to send · Shift + Enter for a new line · drag files or folders in · Ctrl+V pastes a screenshot</span>
                <span>Works without internet</span>
              </div>
            </>
          )}
        </div>
      </div>

      {isDraggingFiles && !blocked && !outOfGroup && (
        <div className="absolute inset-3 z-30 rounded-[28px] border-2 border-dashed border-sky-500 bg-sky-500/10 backdrop-blur-md flex flex-col items-center justify-center pointer-events-none lanx-fade">
          <CloudUpload className="h-12 w-12 text-sky-500 mb-2 lanx-float" />
          <p className="text-sm font-bold text-sky-700 dark:text-sky-300">Drop to send to {conversation.peer_name}</p>
          <p className="text-xs text-sky-700/70 dark:text-sky-300/70">Any size · encrypted · resumes if interrupted</p>
        </div>
      )}
    </div>
  );
};

const DaySeparator: React.FC<{ day: string }> = ({ day }) => (
  <div className="flex justify-center py-1.5">
    <span className="px-2.5 py-0.5 rounded-full lanx-chip text-[10px] font-semibold text-slate-500 dark:text-slate-300">
      {day}
    </span>
  </div>
);
