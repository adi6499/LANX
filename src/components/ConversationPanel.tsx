import React, { useState, useRef, useEffect, useLayoutEffect } from "react";
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
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Video,
} from "lucide-react";
import { FileCard, GroupFileCard } from "./FileCard";

interface ConversationPanelProps {
  conversation: Conversation | null;
  peer: Peer | null;
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

function nameColor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return NAME_COLORS[h % NAME_COLORS.length];
}

export const ConversationPanel: React.FC<ConversationPanelProps> = ({
  conversation,
  peer,
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
  const [shaking, setShaking] = useState(false);
  const [, setTick] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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
    setShaking(true);
    const t = setTimeout(() => setShaking(false), 900);
    return () => clearTimeout(t);
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
      <div className="flex-1 h-full flex flex-col items-center justify-center p-8 bg-slate-50/50 dark:bg-[#080c14] text-center select-none">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-500/10 dark:bg-sky-500/15 text-sky-500 mb-4 shadow-sm lanx-float">
          <Send className="h-8 w-8" />
        </div>
        <h3 className="text-lg font-bold text-slate-800 dark:text-white">No chat selected</h3>
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

  return (
    <div
      data-hidden-chat={hidden ? "true" : undefined}
      className={`flex-1 h-full flex flex-col overflow-hidden select-none relative ${
        hidden ? "bg-violet-50/70 dark:bg-[#0f0b1d] lanx-hidden-bg" : "bg-[#fcfcfd] dark:bg-[#080c14]"
      } ${shaking ? "lanx-shake" : ""}`}
    >
      {/* Header */}
      <header
        className={`h-16 px-6 border-b flex items-center justify-between shrink-0 ${
          hidden
            ? "border-violet-200 dark:border-violet-900/70 bg-gradient-to-r from-violet-100 via-white to-white dark:from-violet-950/60 dark:via-[#0c111c] dark:to-[#0c111c]"
            : "border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0c111c]"
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative shrink-0">
            <div
              className={`h-10 w-10 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-sm ${
                hidden ? "ring-2 ring-violet-500 ring-offset-2 ring-offset-violet-100 dark:ring-offset-violet-950" : ""
              }`}
              style={{ backgroundColor: conversation.peer_avatar_color }}
            >
              {isGroup ? <Users className="h-5 w-5" /> : conversation.peer_name.charAt(0).toUpperCase()}
            </div>
            {hidden ? (
              <span className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-violet-600 text-white flex items-center justify-center border-2 border-white dark:border-[#0c111c]">
                <EyeOff className="h-2.5 w-2.5" />
              </span>
            ) : (
              <span
                className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white dark:border-[#0c111c] ${
                  conversation.peer_status === "online" ? "bg-emerald-500" : "bg-slate-400"
                }`}
              />
            )}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white truncate min-w-[5rem]" title={conversation.peer_name}>
                {conversation.peer_name}
              </h2>
              {isGroup ? (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 text-[10px] font-semibold border border-indigo-500/20">
                  <Users className="h-3 w-3" /> {conversation.member_count} members
                </span>
              ) : peer?.trust_state === "trusted" ? (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold border border-emerald-500/20">
                  <Shield className="h-3 w-3" /> Trusted
                </span>
              ) : blocked ? (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 text-[10px] font-semibold border border-red-500/20">
                  <ShieldBan className="h-3 w-3" /> Blocked
                </span>
              ) : (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-semibold border border-amber-500/20">
                  <ShieldAlert className="h-3 w-3" /> Unverified
                </span>
              )}
              {secret && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-300 text-[10px] font-semibold border border-violet-500/20">
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

        <div className="flex items-center gap-1.5 shrink-0">
          {!isGroup && (
            <>
              <button
                type="button"
                onClick={() => onCall(false)}
                disabled={blocked}
                title={`Voice call ${conversation.peer_name}`}
                className="p-2 rounded-xl text-slate-600 dark:text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors disabled:opacity-40"
              >
                <Phone className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => onCall(true)}
                disabled={blocked}
                title={`Video call ${conversation.peer_name}`}
                className="p-2 rounded-xl text-slate-600 dark:text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors disabled:opacity-40"
              >
                <Video className="h-4 w-4" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onRing}
            disabled={blocked || outOfGroup}
            title={isGroup ? "Ring everyone online in this group" : `Ring ${conversation.peer_name} to get their attention`}
            className="p-2 rounded-xl text-slate-600 dark:text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors disabled:opacity-40"
          >
            <Bell className="h-4 w-4" />
          </button>

          {!isGroup && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setSecretMenu(!secretMenu)}
                disabled={blocked}
                title="Secret messages (disappear after reading)"
                className={`p-2 rounded-xl transition-colors disabled:opacity-40 ${
                  secret
                    ? "bg-violet-500/10 text-violet-600 dark:text-violet-300"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                <Timer className="h-4 w-4" />
              </button>
              {secretMenu && (
                <div className="absolute right-0 top-11 z-30 w-60 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] shadow-xl p-1.5 lanx-rise">
                  <div className="px-2.5 py-2 text-[11px] text-slate-500 leading-snug">
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
                        conversation.secret_ttl === t.secs ? "bg-violet-500/10 text-violet-700 dark:text-violet-300 font-semibold" : "text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
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
                      !secret ? "bg-slate-100 dark:bg-slate-800 font-semibold" : "hover:bg-slate-100 dark:hover:bg-slate-800"
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
            className={`p-2 rounded-xl transition-colors ${
              hidden
                ? "bg-violet-600 text-white hover:bg-violet-700"
                : "text-slate-600 dark:text-slate-400 hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-950/30"
            }`}
          >
            {hidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </button>

          {confirmDelete ? (
            <div className="flex items-center gap-1 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 px-2 py-1 text-[11px]">
              <span className="text-red-700 dark:text-red-300 font-medium">Delete this chat?</span>
              <button
                type="button"
                onClick={() => {
                  setConfirmDelete(false);
                  onDeleteConversation();
                }}
                className="px-2 py-0.5 rounded-lg bg-red-500 text-white font-semibold hover:bg-red-600"
              >
                Delete
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="px-2 py-0.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-slate-800">
                Keep
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              title="Delete chat history"
              className="p-2 rounded-xl text-slate-600 dark:text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}

          <button
            type="button"
            onClick={onToggleContext}
            title={isGroup ? "Group details" : "Contact details"}
            className={`p-2 rounded-xl transition-colors ${
              isContextOpen
                ? "bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
          >
            <Info className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Security strip */}
      <div
        className={`px-6 py-1.5 border-b flex items-center justify-between text-[11px] ${
          secret
            ? "bg-violet-50 dark:bg-violet-950/30 border-violet-200/60 dark:border-violet-900/50 text-violet-700 dark:text-violet-300"
            : "bg-slate-100/60 dark:bg-slate-900/60 border-slate-200/50 dark:border-slate-800/50 text-slate-500 dark:text-slate-400"
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

      {hidden && (
        <div className="px-6 py-2 flex items-center gap-3 bg-violet-600 text-white text-[11px] shadow-sm lanx-fade">
          <EyeOff className="h-4 w-4 shrink-0" />
          <span className="flex-1 leading-snug">
            <b>You're in a hidden chat.</b> It isn't in your normal chat list and only shows after your PIN. It hides again when you press
            “Hide again” or LANX locks.
          </span>
          <button
            type="button"
            onClick={() => onSetHidden(false)}
            className="shrink-0 px-2.5 py-1 rounded-lg bg-white/20 hover:bg-white/30 font-semibold"
          >
            Unhide chat
          </button>
        </div>
      )}

      {notice && (
        <div className="mx-6 mt-3 flex items-start gap-2 rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-200 lanx-rise">
          <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
          <span className="flex-1 whitespace-pre-line">{notice}</span>
          <button type="button" onClick={onDismissNotice} className="p-0.5 rounded hover:bg-amber-100 dark:hover:bg-amber-900/50">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3" onClick={() => setSecretMenu(false)}>
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 text-xs text-slate-400">
            <div className="h-12 w-12 rounded-full bg-slate-100 dark:bg-slate-800/80 flex items-center justify-center text-slate-400 mb-3 lanx-float">
              {isGroup ? <Users className="h-6 w-6" /> : <Lock className="h-6 w-6" />}
            </div>
            <p className="font-semibold text-slate-700 dark:text-slate-300">Say hello to {conversation.peer_name}</p>
            <p className="mt-1 text-slate-500 max-w-xs">
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
                    <span className="max-w-md text-center px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800/80 text-[11px] text-slate-500 dark:text-slate-400">
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
                <div className={`flex flex-col group lanx-msg ${isOut ? "items-end" : "items-start"}`}>
                  {showSender && (
                    <span className={`ml-3 mb-0.5 text-[11px] font-semibold ${nameColor(msg.sender_id)}`}>{peerName(msg.sender_id)}</span>
                  )}
                  <div
                    className={`relative max-w-lg rounded-2xl px-4 py-2.5 text-xs shadow-sm ${
                      isSecret
                        ? isOut
                          ? "bg-violet-600 text-white rounded-br-sm"
                          : "bg-violet-50 dark:bg-violet-950/40 text-slate-900 dark:text-slate-100 border border-violet-200 dark:border-violet-900 rounded-bl-sm"
                        : isOut
                          ? "bg-sky-500 text-white rounded-br-sm"
                          : "bg-white dark:bg-[#162032] text-slate-900 dark:text-slate-100 border border-slate-200/80 dark:border-slate-800 rounded-bl-sm"
                    }`}
                  >
                    {groupCopies ? (
                      <GroupFileCard transfers={groupCopies} fallbackName={msg.content.replace(/^📎\s*/, "")} progress={progress} actions={transferActions} />
                    ) : isFile ? (
                      <FileCard
                        transfer={transfer}
                        fallbackName={msg.content.replace(/^📎\s*/, "")}
                        progress={msg.transfer_id ? progress[msg.transfer_id] : undefined}
                        actions={transferActions}
                        onAccent={isOut}
                      />
                    ) : (
                      <p className={`whitespace-pre-wrap break-words leading-relaxed ${isSecret ? "select-none" : "select-text"}`}>{msg.content}</p>
                    )}

                    <div
                      className={`mt-1 flex items-center justify-end gap-1.5 text-[10px] ${
                        isOut ? (isSecret ? "text-violet-100/90" : "text-sky-100/80") : "text-slate-400"
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
                        className={`absolute top-2 ${isOut ? "-left-7" : "-right-7"} opacity-0 group-hover:opacity-100 p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 bg-white dark:bg-slate-800 shadow-sm border border-slate-200 dark:border-slate-700 transition-opacity`}
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  {isOut && msg.status === "queued" && msg.error_reason && !isFile && !isGroup && (
                    <span className="mt-0.5 text-[10px] text-slate-400">{msg.error_reason}</span>
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
            <div className="rounded-2xl rounded-bl-sm bg-white dark:bg-[#162032] border border-slate-200/80 dark:border-slate-800 px-4 py-3 shadow-sm">
              <span className="lanx-typing lanx-typing-lg"><i /><i /><i /></span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {showEmojiPicker && (
        <div className="px-6 py-2 bg-white dark:bg-[#0c111c] border-t border-slate-200/70 dark:border-slate-800/70 flex items-center gap-1.5 overflow-x-auto">
          {QUICK_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => setInputText((prev) => prev + emoji)}
              className="h-8 w-8 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-sm transition-transform active:scale-125"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {/* Composer */}
      <div
        className={`p-4 border-t ${
          hidden ? "bg-violet-50 dark:bg-[#140f26] border-violet-200 dark:border-violet-900/70" : "bg-white dark:bg-[#0c111c] border-slate-200 dark:border-slate-800"
        }`}
      >
        {blocked ? (
          <div className="flex items-center justify-between rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-xs text-red-700 dark:text-red-300">
            <span>You blocked {conversation.peer_name}. They can't message you or send you files.</span>
            <button type="button" onClick={onUnblock} className="px-3 py-1 rounded-lg bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900 font-semibold hover:bg-red-100 dark:hover:bg-red-950">
              Unblock
            </button>
          </div>
        ) : outOfGroup ? (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 px-4 py-3 text-xs text-slate-500 text-center">
            {conversation.membership === "removed" ? "You were removed from this group." : "You left this group."} You can still read the history.
          </div>
        ) : (
          <>
            <div
              className={`relative flex items-end gap-2 rounded-2xl border p-2 shadow-inner ${
                secret || hidden ? "border-violet-300 dark:border-violet-800 bg-violet-50/60 dark:bg-violet-950/20" : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/70"
              }`}
            >
              <button
                type="button"
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                title="Emoji"
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800 rounded-xl transition-colors"
              >
                <Smile className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onPickFiles}
                title="Send files (any size)"
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800 rounded-xl transition-colors"
              >
                <Paperclip className="h-4 w-4" />
              </button>

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
                className="flex-1 bg-transparent text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none resize-none py-2 leading-relaxed select-text"
              />

              <button
                type="button"
                onClick={handleSend}
                disabled={!inputText.trim()}
                title="Send (Enter)"
                className={`p-2.5 rounded-xl text-white shadow-md disabled:opacity-40 disabled:shadow-none transition-all active:scale-90 ${
                  secret ? "bg-violet-600 hover:bg-violet-700 shadow-violet-500/20" : "bg-sky-500 hover:bg-sky-600 shadow-sky-500/20"
                }`}
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-500 px-1">
              <span>Enter to send · Shift + Enter for a new line · drag files in · Ctrl+V pastes a screenshot</span>
              <span>Works without internet</span>
            </div>
          </>
        )}
      </div>

      {isDraggingFiles && !blocked && !outOfGroup && (
        <div className="absolute inset-3 z-20 rounded-3xl border-2 border-dashed border-sky-500 bg-sky-500/10 backdrop-blur-[2px] flex flex-col items-center justify-center pointer-events-none lanx-fade">
          <CloudUpload className="h-12 w-12 text-sky-500 mb-2 lanx-float" />
          <p className="text-sm font-bold text-sky-700 dark:text-sky-300">Drop to send to {conversation.peer_name}</p>
          <p className="text-xs text-sky-700/70 dark:text-sky-300/70">Any size · encrypted · resumes if interrupted</p>
        </div>
      )}
    </div>
  );
};

const DaySeparator: React.FC<{ day: string }> = ({ day }) => (
  <div className="flex justify-center py-1">
    <span className="px-2.5 py-0.5 rounded-full bg-slate-200/70 dark:bg-slate-800 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
      {day}
    </span>
  </div>
);
