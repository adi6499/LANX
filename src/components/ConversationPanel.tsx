import React, { useState, useRef, useEffect, useLayoutEffect } from "react";
import {
  Conversation,
  Message,
  Peer,
  TransferActions,
  TransferProgress,
  TransferRecord,
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
} from "lucide-react";
import { FileCard } from "./FileCard";

interface ConversationPanelProps {
  conversation: Conversation | null;
  peer: Peer | null;
  messages: Message[];
  transfers: Record<string, TransferRecord>;
  progress: Record<string, TransferProgress>;
  transferActions: TransferActions;
  isContextOpen: boolean;
  isDraggingFiles: boolean;
  notice: string | null;
  onDismissNotice: () => void;
  onToggleContext: () => void;
  onSendMessage: (content: string) => Promise<boolean>;
  onRetryMessage: (messageId: string) => void;
  onDeleteConversation: () => void;
  onPickFiles: () => void;
  onUnblock: () => void;
}

const QUICK_EMOJIS = ["👍", "🙏", "✅", "👋", "😀", "🎉", "🔥", "❤️", "⚡", "📎"];

function dayLabel(ts: number): string {
  const d = new Date(ts * 1000);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

export const ConversationPanel: React.FC<ConversationPanelProps> = ({
  conversation,
  peer,
  messages,
  transfers,
  progress,
  transferActions,
  isContextOpen,
  isDraggingFiles,
  notice,
  onDismissNotice,
  onToggleContext,
  onSendMessage,
  onRetryMessage,
  onDeleteConversation,
  onPickFiles,
  onUnblock,
}) => {
  const [inputText, setInputText] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, conversation?.id]);

  useEffect(() => {
    setConfirmDelete(false);
    setInputText("");
    textareaRef.current?.focus();
  }, [conversation?.id]);

  // Grow the composer with its content (up to ~6 lines).
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
  }, [inputText]);

  if (!conversation) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center p-8 bg-slate-50/50 dark:bg-[#080c14] text-center select-none">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-500/10 dark:bg-sky-500/15 text-sky-500 mb-4 shadow-sm">
          <Send className="h-8 w-8" />
        </div>
        <h3 className="text-lg font-bold text-slate-800 dark:text-white">No chat selected</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-sm">
          Pick a colleague on the left, or open Peers to see every computer running LANX on your network.
        </p>
      </div>
    );
  }

  const blocked = peer?.trust_state === "blocked";

  const handleSend = async () => {
    const text = inputText;
    if (!text.trim()) return;
    setInputText("");
    setShowEmojiPicker(false);
    const ok = await onSendMessage(text);
    if (!ok) setInputText(text); // keep the text so nothing is lost
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatMessageTime = (ts: number) =>
    new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const statusIcon = (msg: Message) => {
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
        return <CheckCheck className="h-3 w-3 text-white" aria-label="Read" />;
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

  let lastDay = "";

  return (
    <div className="flex-1 h-full flex flex-col bg-[#fcfcfd] dark:bg-[#080c14] overflow-hidden select-none relative">
      {/* Header */}
      <header className="h-16 px-6 border-b border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0c111c] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative shrink-0">
            <div
              className="h-10 w-10 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-sm"
              style={{ backgroundColor: conversation.peer_avatar_color }}
            >
              {conversation.peer_name.charAt(0).toUpperCase()}
            </div>
            <span
              className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white dark:border-[#0c111c] ${
                conversation.peer_status === "online" ? "bg-emerald-500" : "bg-slate-400"
              }`}
            />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                {conversation.peer_name}
              </h2>
              {peer?.trust_state === "trusted" ? (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold border border-emerald-500/20">
                  <Shield className="h-3 w-3" />
                  <span>Trusted</span>
                </span>
              ) : blocked ? (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 text-[10px] font-semibold border border-red-500/20">
                  <ShieldBan className="h-3 w-3" />
                  <span>Blocked</span>
                </span>
              ) : (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-semibold border border-amber-500/20">
                  <ShieldAlert className="h-3 w-3" />
                  <span>Unverified</span>
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap min-w-0">
              {conversation.peer_status === "online" ? (
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">Online</span>
              ) : (
                <span className="truncate" title="Messages and files wait and are delivered when they come back online">
                  Offline · messages will wait
                </span>
              )}
              <span>•</span>
              <span className="font-mono text-[11px] text-slate-400">{conversation.peer_ip}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onPickFiles}
            disabled={blocked}
            title="Send files"
            className="p-2 rounded-xl text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-40"
          >
            <Paperclip className="h-4 w-4" />
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
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="px-2 py-0.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-slate-800"
              >
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
            title="Contact details"
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
      <div className="px-6 py-1.5 bg-slate-100/60 dark:bg-slate-900/60 border-b border-slate-200/50 dark:border-slate-800/50 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-1.5">
          <Lock className="h-3 w-3 text-emerald-500" />
          <span>End-to-end encrypted · goes straight to their computer, never through the internet</span>
        </div>
        <span className="font-mono text-[10px] text-slate-400">TCP :{peer?.tcp_port || 52926}</span>
      </div>

      {notice && (
        <div className="mx-6 mt-3 flex items-start gap-2 rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
          <span className="flex-1 whitespace-pre-line">{notice}</span>
          <button type="button" onClick={onDismissNotice} className="p-0.5 rounded hover:bg-amber-100 dark:hover:bg-amber-900/50">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 text-xs text-slate-400">
            <div className="h-12 w-12 rounded-full bg-slate-100 dark:bg-slate-800/80 flex items-center justify-center text-slate-400 mb-3">
              <Lock className="h-6 w-6" />
            </div>
            <p className="font-semibold text-slate-700 dark:text-slate-300">Say hello to {conversation.peer_name}</p>
            <p className="mt-1 text-slate-500 max-w-xs">
              Messages and files go directly across your office network, encrypted. Drag files here to send them.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isOut = msg.is_outgoing;
            const day = dayLabel(msg.timestamp);
            const showDay = day !== lastDay;
            lastDay = day;
            const isFile = msg.message_type === "file";
            const transfer = msg.transfer_id ? transfers[msg.transfer_id] : undefined;
            return (
              <React.Fragment key={msg.id}>
                {showDay && (
                  <div className="flex justify-center py-1">
                    <span className="px-2.5 py-0.5 rounded-full bg-slate-200/70 dark:bg-slate-800 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                      {day}
                    </span>
                  </div>
                )}
                <div className={`flex flex-col group ${isOut ? "items-end" : "items-start"}`}>
                  <div
                    className={`relative max-w-lg rounded-2xl px-4 py-2.5 text-xs shadow-sm ${
                      isOut
                        ? "bg-sky-500 text-white rounded-br-sm"
                        : "bg-white dark:bg-[#162032] text-slate-900 dark:text-slate-100 border border-slate-200/80 dark:border-slate-800 rounded-bl-sm"
                    }`}
                  >
                    {isFile ? (
                      <FileCard
                        transfer={transfer}
                        fallbackName={msg.content.replace(/^📎\s*/, "")}
                        progress={msg.transfer_id ? progress[msg.transfer_id] : undefined}
                        actions={transferActions}
                        onAccent={isOut}
                      />
                    ) : (
                      <p className="whitespace-pre-wrap break-words leading-relaxed select-text">{msg.content}</p>
                    )}

                    <div
                      className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${
                        isOut ? "text-sky-100/80" : "text-slate-400"
                      }`}
                    >
                      <span>{formatMessageTime(msg.timestamp)}</span>
                      {isOut && !isFile && <span className="inline-flex items-center">{statusIcon(msg)}</span>}
                    </div>

                    {!isFile && (
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
                  {isOut && msg.status === "queued" && msg.error_reason && !isFile && (
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
      <div className="p-4 bg-white dark:bg-[#0c111c] border-t border-slate-200 dark:border-slate-800">
        {blocked ? (
          <div className="flex items-center justify-between rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-xs text-red-700 dark:text-red-300">
            <span>You blocked {conversation.peer_name}. They can't message you or send you files.</span>
            <button
              type="button"
              onClick={onUnblock}
              className="px-3 py-1 rounded-lg bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900 font-semibold hover:bg-red-100 dark:hover:bg-red-950"
            >
              Unblock
            </button>
          </div>
        ) : (
          <>
            <div className="relative flex items-end gap-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/70 p-2 shadow-inner">
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
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Message ${conversation.peer_name}…`}
                className="flex-1 bg-transparent text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none resize-none py-2 leading-relaxed select-text"
              />

              <button
                type="button"
                onClick={handleSend}
                disabled={!inputText.trim()}
                title="Send (Enter)"
                className="p-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 active:bg-sky-700 text-white shadow-md shadow-sky-500/20 disabled:opacity-40 disabled:shadow-none transition-all"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-500 px-1">
              <span>Enter to send · Shift + Enter for a new line · drag files in to send them</span>
              <span>Works without internet</span>
            </div>
          </>
        )}
      </div>

      {isDraggingFiles && !blocked && (
        <div className="absolute inset-3 z-20 rounded-3xl border-2 border-dashed border-sky-500 bg-sky-500/10 backdrop-blur-[2px] flex flex-col items-center justify-center pointer-events-none">
          <CloudUpload className="h-12 w-12 text-sky-500 mb-2" />
          <p className="text-sm font-bold text-sky-700 dark:text-sky-300">Drop to send to {conversation.peer_name}</p>
          <p className="text-xs text-sky-700/70 dark:text-sky-300/70">Any size · encrypted · resumes if interrupted</p>
        </div>
      )}
    </div>
  );
};
