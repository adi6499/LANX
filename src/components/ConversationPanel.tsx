import React, { useState, useRef, useEffect } from "react";
import { Conversation, Message, Peer } from "../types";
import {
  Send,
  Paperclip,
  Smile,
  Info,
  Shield,
  ShieldAlert,
  Clock,
  CheckCheck,
  AlertCircle,
  Copy,
  Trash2,
  Lock,
} from "lucide-react";

interface ConversationPanelProps {
  conversation: Conversation | null;
  peer: Peer | null;
  messages: Message[];
  isContextOpen: boolean;
  onToggleContext: () => void;
  onSendMessage: (content: string) => void;
  onRetryMessage: (messageId: string) => void;
  onDeleteConversation: () => void;
  onSelectPeerForTransfer?: () => void;
}

const QUICK_EMOJIS = ["👍", "👋", "🚀", "🔥", "❤️", "😀", "💻", "✅", "🎉", "⚡️"];

export const ConversationPanel: React.FC<ConversationPanelProps> = ({
  conversation,
  peer,
  messages,
  isContextOpen,
  onToggleContext,
  onSendMessage,
  onRetryMessage,
  onDeleteConversation,
  onSelectPeerForTransfer,
}) => {
  const [inputText, setInputText] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (!conversation) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center p-8 bg-slate-50/50 dark:bg-[#080c14] text-center select-none">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-500/10 dark:bg-sky-500/15 text-sky-500 mb-4 shadow-sm">
          <Send className="h-8 w-8" />
        </div>
        <h3 className="text-lg font-bold text-slate-800 dark:text-white">
          No Conversation Selected
        </h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-sm">
          Choose a peer from the left sidebar to start local network messaging, or browse discovered computers on your subnet.
        </p>
      </div>
    );
  }

  const handleSend = () => {
    if (!inputText.trim()) return;
    onSendMessage(inputText);
    setInputText("");
    setShowEmojiPicker(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCopyMessage = (content: string) => {
    navigator.clipboard.writeText(content);
  };

  const formatMessageTime = (ts: number) => {
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="flex-1 h-full flex flex-col bg-[#fcfcfd] dark:bg-[#080c14] overflow-hidden select-none">
      {/* Conversation Top Header */}
      <header className="h-16 px-6 border-b border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0c111c] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div
              className="h-10 w-10 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-sm"
              style={{ backgroundColor: conversation.peer_avatar_color }}
            >
              {conversation.peer_name.charAt(0).toUpperCase()}
            </div>
            <span
              className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white dark:border-[#0c111c] ${
                conversation.peer_status === "online"
                  ? "bg-emerald-500"
                  : "bg-slate-400"
              }`}
            />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                {conversation.peer_name}
              </h2>
              {peer?.trust_state === "trusted" ? (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold border border-emerald-500/20">
                  <Shield className="h-3 w-3" />
                  <span>Trusted</span>
                </span>
              ) : (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-semibold border border-amber-500/20">
                  <ShieldAlert className="h-3 w-3" />
                  <span>Unverified</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1">
                {conversation.peer_status === "online" ? (
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                    Online
                  </span>
                ) : (
                  <span>Offline</span>
                )}
              </span>
              <span>•</span>
              <span className="font-mono text-[11px] text-slate-400">
                {conversation.peer_ip}
              </span>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5">
          {onSelectPeerForTransfer && (
            <button
              type="button"
              onClick={onSelectPeerForTransfer}
              title="Send File over LAN"
              className="p-2 rounded-xl text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <Paperclip className="h-4 w-4" />
            </button>
          )}

          <button
            type="button"
            onClick={onDeleteConversation}
            title="Delete Conversation"
            className="p-2 rounded-xl text-slate-600 dark:text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={onToggleContext}
            title="Peer details & transfer information"
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

      {/* Security Banner */}
      <div className="px-6 py-1.5 bg-slate-100/60 dark:bg-slate-900/60 border-b border-slate-200/50 dark:border-slate-800/50 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-1.5">
          <Lock className="h-3 w-3 text-emerald-500" />
          <span>Direct peer-to-peer connection • Zero external server transit</span>
        </div>
        <span className="font-mono text-[10px] text-slate-400">
          TCP :{peer?.tcp_port || 52926}
        </span>
      </div>

      {/* Message History */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 text-xs text-slate-400">
            <div className="h-12 w-12 rounded-full bg-slate-100 dark:bg-slate-800/80 flex items-center justify-center text-slate-400 mb-3">
              <Lock className="h-6 w-6" />
            </div>
            <p className="font-semibold text-slate-700 dark:text-slate-300">
              Direct Local Network Encryption
            </p>
            <p className="mt-1 text-slate-500 max-w-xs">
              Say hello to {conversation.peer_name}. Messages and files sent here travel directly across your LAN.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isOut = msg.is_outgoing;
            return (
              <div
                key={msg.id}
                className={`flex flex-col group ${isOut ? "items-end" : "items-start"}`}
              >
                <div
                  className={`relative max-w-lg rounded-2xl px-4 py-2.5 text-xs transition-all shadow-sm ${
                    isOut
                      ? "bg-sky-500 text-white rounded-br-sm"
                      : "bg-white dark:bg-[#162032] text-slate-900 dark:text-slate-100 border border-slate-200/80 dark:border-slate-800 rounded-bl-sm"
                  }`}
                >
                  <p className="whitespace-pre-wrap leading-relaxed select-text">
                    {msg.content}
                  </p>

                  <div
                    className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${
                      isOut ? "text-sky-100/80" : "text-slate-400"
                    }`}
                  >
                    <span>{formatMessageTime(msg.timestamp)}</span>

                    {isOut && (
                      <span className="inline-flex items-center">
                        {msg.status === "sending" && <Clock className="h-3 w-3 animate-spin" />}
                        {msg.status === "delivered" && <CheckCheck className="h-3 w-3" />}
                        {msg.status === "read" && (
                          <CheckCheck className="h-3 w-3 text-white" />
                        )}
                        {msg.status === "failed" && (
                          <button
                            type="button"
                            onClick={() => onRetryMessage(msg.id)}
                            title={msg.error_reason || "Delivery failed. Click to retry."}
                            className="flex items-center gap-1 text-red-200 hover:text-white hover:underline transition-colors"
                          >
                            <AlertCircle className="h-3 w-3 text-red-300" />
                            <span>Retry</span>
                            {msg.error_reason && (
                              <span className="max-w-[140px] truncate text-[9px] opacity-80" title={msg.error_reason}>
                                ({msg.error_reason})
                              </span>
                            )}
                          </button>
                        )}
                      </span>
                    )}
                  </div>

                  {/* Copy on hover action */}
                  <button
                    type="button"
                    onClick={() => handleCopyMessage(msg.content)}
                    title="Copy text"
                    className="absolute top-2 -left-7 opacity-0 group-hover:opacity-100 p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 bg-white dark:bg-slate-800 shadow-sm border border-slate-200 dark:border-slate-700 transition-opacity"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Emoji Bar (Collapsible) */}
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

      {/* Message Composer Area */}
      <div className="p-4 bg-white dark:bg-[#0c111c] border-t border-slate-200 dark:border-slate-800">
        <div className="relative flex items-center gap-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/70 p-2 shadow-inner">
          <button
            type="button"
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            title="Emoji picker"
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800 rounded-xl transition-colors"
          >
            <Smile className="h-4 w-4" />
          </button>

          <textarea
            rows={1}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${conversation.peer_name}...`}
            className="flex-1 bg-transparent text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none resize-none max-h-32 py-1.5"
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
          <span>Enter to send • Shift + Enter for new line</span>
          <span>End-to-end local networking</span>
        </div>
      </div>
    </div>
  );
};
