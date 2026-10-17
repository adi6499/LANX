import React from "react";
import {
  Conversation,
  Peer,
  UserSettings,
  NavTab,
} from "../types";
import {
  MessageSquare,
  Users,
  ArrowUpDown,
  History,
  Settings,
  Search,
  SquarePen,
  Sun,
  Moon,
  Pin,
  UsersRound,
  Megaphone,
  Lock,
  EyeOff,
  Timer,
} from "lucide-react";
import { stagger } from "../lib/motion";

interface SidebarProps {
  settings: UserSettings;
  conversations: Conversation[];
  peers: Peer[];
  activeConversationId: string | null;
  activeTab: NavTab;
  searchQuery: string;
  /** Incoming files waiting for the user to accept. */
  pendingFiles: number;
  hiddenUnlocked: boolean;
  onSelectConversation: (id: string) => void;
  onSelectTab: (tab: NavTab) => void;
  onSearchChange: (q: string) => void;
  onOpenSettings: () => void;
  onToggleTheme: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onNewChat: () => void;
  onNewGroup: () => void;
  onBroadcast: () => void;
  onLock: () => void;
  onToggleHidden: () => void;
}

const TAB_ORDER: NavTab[] = ["messages", "people", "transfers", "history"];

export const Sidebar: React.FC<SidebarProps> = ({
  settings,
  conversations,
  peers,
  activeConversationId,
  activeTab,
  searchQuery,
  pendingFiles,
  hiddenUnlocked,
  onSelectConversation,
  onSelectTab,
  onSearchChange,
  onOpenSettings,
  onToggleTheme,
  onNewChat,
  onNewGroup,
  onBroadcast,
  onLock,
  onToggleHidden,
}) => {
  const onlineCount = peers.filter((p) => p.status === "online").length;
  const totalUnread = conversations.reduce((acc, c) => acc + c.unread_count, 0);

  const filteredConversations = conversations.filter((c) =>
    c.peer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (c.last_message_preview &&
      c.last_message_preview.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const visibleConversations = filteredConversations.filter((c) => !c.is_hidden);
  const hiddenConversations = filteredConversations.filter((c) => c.is_hidden);

  const formatTimestamp = (ts: number) => {
    if (!ts) return "";
    const date = new Date(ts * 1000);
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  const renderRow = (conv: Conversation, hidden: boolean, index: number) => {
    const isSelected = activeConversationId === conv.id;
    return (
      <button
        key={conv.id}
        type="button"
        data-hidden-chat={hidden ? "true" : undefined}
        aria-current={isSelected ? "true" : undefined}
        onClick={() => onSelectConversation(conv.id)}
        style={stagger(index)}
        className={`lanx-item-in w-full flex items-center gap-3 px-2.5 py-2 rounded-[12px] text-left transition-[background-color,box-shadow,color,transform] duration-200 relative active:scale-[0.985] ${
          isSelected
            ? hidden
              ? "bg-violet-600 text-white shadow-md shadow-violet-600/25"
              : "bg-sky-500 text-white shadow-md shadow-sky-500/25"
            : hidden
              ? "hover:bg-violet-500/10 text-slate-700 dark:text-slate-300"
              : "hover:bg-[var(--lanx-fill)] text-slate-700 dark:text-slate-300"
        }`}
      >
        {/* Avatar with status dot */}
        <div className="relative shrink-0">
          <div
            className={`h-10 w-10 flex items-center justify-center text-white font-bold text-xs shadow-sm ${
              conv.kind === "group" ? "rounded-[12px]" : "rounded-full"
            } ${hidden && !isSelected ? "ring-2 ring-violet-400/80" : ""} ${isSelected ? "ring-2 ring-white/70" : ""}`}
            style={{ backgroundColor: conv.peer_avatar_color }}
          >
            {conv.kind === "group" ? <Users className="h-4 w-4" /> : conv.peer_name.charAt(0).toUpperCase()}
          </div>
          {hidden ? (
            <span className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-violet-600 text-white flex items-center justify-center ring-2 ring-white dark:ring-[#1c1e24]">
              <EyeOff className="h-2 w-2" />
            </span>
          ) : (
            <span
              className={`absolute bottom-0 right-0 h-3 w-3 rounded-full ring-2 ring-white dark:ring-[#1c1e24] ${
                conv.peer_status === "online" ? "bg-emerald-500" : "bg-slate-400 dark:bg-slate-600"
              }`}
            />
          )}
        </div>

        {/* Details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-0.5">
            <span className={`font-semibold text-[13px] tracking-[-0.01em] truncate flex items-center gap-1 ${isSelected ? "text-white" : "text-slate-900 dark:text-white"}`}>
              <span className="truncate">{conv.peer_name}</span>
              {conv.is_pinned && <Pin className={`h-3 w-3 shrink-0 ${isSelected ? "text-white fill-white" : "text-amber-500 fill-amber-500"}`} />}
              {conv.secret_ttl > 0 && <Timer className={`h-3 w-3 shrink-0 ${isSelected ? "text-white" : "text-violet-500"}`} aria-label="Secret chat" />}
            </span>
            <span className={`text-[10px] shrink-0 font-medium ${isSelected ? "text-white/75" : "text-slate-400"}`}>{formatTimestamp(conv.last_message_time)}</span>
          </div>

          <div className="flex items-center justify-between">
            <p className={`text-[11.5px] truncate ${isSelected ? "text-white/80" : "text-slate-500 dark:text-slate-400"}`}>
              {conv.last_message_preview || "No messages yet"}
            </p>
            {conv.unread_count > 0 && (
              <span
                key={conv.unread_count}
                className={`lanx-pop ml-1.5 shrink-0 min-w-[18px] text-center px-1.5 py-[3px] rounded-full text-[10px] font-bold leading-none ${
                  isSelected ? "bg-white text-sky-600" : hidden ? "bg-violet-600 text-white" : "bg-sky-500 text-white"
                }`}
              >
                {conv.unread_count}
              </span>
            )}
          </div>
        </div>
      </button>
    );
  };

  return (
    <aside className="w-80 m-2 mr-0 rounded-[20px] lanx-glass flex flex-col overflow-hidden select-none shrink-0 lanx-launch">
      {/* Brand Header */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <img src="/lanx-logo.png" alt="LANX" className="h-9 w-9 rounded-[10px] shadow-md shadow-sky-500/25" />
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-[17px] tracking-[-0.02em] text-slate-900 dark:text-white">
                  LANX
                </span>
                <span className="rounded bg-sky-500/10 dark:bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-sky-600 dark:text-sky-400">
                  LAN
                </span>
              </div>
              <div
                className={`flex items-center gap-1 text-[11px] font-medium ${
                  onlineCount > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-slate-500 dark:text-slate-400"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${onlineCount > 0 ? "bg-emerald-500 online-pulse" : "bg-slate-400"}`}
                />
                <span>
                  {onlineCount === 0
                    ? "Looking for colleagues…"
                    : `${onlineCount} ${onlineCount === 1 ? "colleague" : "colleagues"} online`}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={onBroadcast}
              title="Message everyone"
              className="lanx-tool flex h-8 w-8 items-center justify-center text-amber-600 dark:text-amber-400"
            >
              <Megaphone className="h-[17px] w-[17px]" />
            </button>
            <button
              type="button"
              onClick={onNewGroup}
              title="New group"
              className="lanx-tool flex h-8 w-8 items-center justify-center text-indigo-600 dark:text-indigo-300"
            >
              <UsersRound className="h-[17px] w-[17px]" />
            </button>
            <button
              type="button"
              onClick={onNewChat}
              title="New chat"
              className="lanx-tool flex h-8 w-8 items-center justify-center text-sky-600 dark:text-sky-400"
            >
              <SquarePen className="h-[17px] w-[17px]" />
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search"
            className="lanx-field w-full rounded-[10px] pl-8 pr-3 py-[7px] text-xs text-slate-900 dark:text-white placeholder:text-slate-400"
          />
        </div>
      </div>

      {/* Navigation Tabs: a segmented control with a sliding highlight */}
      <div className="relative grid grid-cols-4 mx-3 mb-2 p-[3px] rounded-[11px] bg-[var(--lanx-fill)]">
        <span
          aria-hidden
          className="absolute top-[3px] bottom-[3px] left-[3px] w-[calc((100%-6px)/4)] rounded-[9px] bg-white dark:bg-white/15 shadow-[0_1px_3px_rgb(0_0_0/0.12),0_0_0_0.5px_rgb(0_0_0/0.04)] transition-transform duration-300 ease-[cubic-bezier(.3,.7,.3,1)]"
          style={{ transform: `translateX(${Math.max(0, TAB_ORDER.indexOf(activeTab)) * 100}%)` }}
        />
        <button
          type="button"
          onClick={() => onSelectTab("messages")}
          className={`relative z-10 flex flex-col items-center py-1.5 rounded-[9px] text-[10px] font-semibold transition-colors ${
            activeTab === "messages"
              ? "text-sky-600 dark:text-white"
              : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <MessageSquare className="h-4 w-4 mb-0.5" />
          <span>Chats</span>
          {totalUnread > 0 && (
            <span className="absolute top-1 right-3 h-2 w-2 rounded-full bg-sky-500" />
          )}
        </button>

        <button
          type="button"
          onClick={() => onSelectTab("people")}
          className={`relative z-10 flex flex-col items-center py-1.5 rounded-[9px] text-[10px] font-semibold transition-colors ${
            activeTab === "people"
              ? "text-sky-600 dark:text-white"
              : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <Users className="h-4 w-4 mb-0.5" />
          <span>Peers</span>
          {onlineCount > 0 && (
            <span key={onlineCount} className="lanx-pop absolute top-1 right-2.5 px-1 py-0.2 rounded-full bg-emerald-500 text-[8px] text-white font-bold leading-none">
              {onlineCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => onSelectTab("transfers")}
          className={`relative z-10 flex flex-col items-center py-1.5 rounded-[9px] text-[10px] font-semibold transition-colors ${
            activeTab === "transfers"
              ? "text-sky-600 dark:text-white"
              : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <ArrowUpDown className="h-4 w-4 mb-0.5" />
          <span>Files</span>
          {pendingFiles > 0 && (
            <span key={pendingFiles} className="lanx-pop absolute top-1 right-2.5 px-1 rounded-full bg-sky-500 text-[8px] text-white font-bold leading-none py-0.5">
              {pendingFiles}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => onSelectTab("history")}
          className={`relative z-10 flex flex-col items-center py-1.5 rounded-[9px] text-[10px] font-semibold transition-colors ${
            activeTab === "history"
              ? "text-sky-600 dark:text-white"
              : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <History className="h-4 w-4 mb-0.5" />
          <span>History</span>
        </button>
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        {activeTab === "messages" && (
          <>
            {settings.pin_enabled &&
              (hiddenUnlocked ? (
                <div className="mb-2 rounded-[16px] border border-violet-300/60 dark:border-violet-700/50 bg-violet-500/10 p-1.5 lanx-rise">
                  <div className="flex items-center justify-between px-2 pt-1 pb-1.5">
                    <span className="flex items-center gap-1.5 text-[11px] font-bold text-violet-700 dark:text-violet-300">
                      <EyeOff className="h-3.5 w-3.5" /> Hidden chats
                    </span>
                    <button
                      type="button"
                      onClick={onToggleHidden}
                      title="Hide hidden chats again"
                      className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-600 text-white text-[10px] font-semibold hover:bg-violet-700"
                    >
                      <Lock className="h-3 w-3" /> Hide again
                    </button>
                  </div>
                  {hiddenConversations.length === 0 ? (
                    <p className="px-2 pb-2 text-[11px] text-violet-700/80 dark:text-violet-300/80 leading-snug">
                      No hidden chats yet. Open a chat and press <EyeOff className="inline h-3 w-3" /> at the top to hide it.
                    </p>
                  ) : (
                    <div className="space-y-1">{hiddenConversations.map((c, i) => renderRow(c, true, i))}</div>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={onToggleHidden}
                  title="Show hidden chats"
                  className="w-full mb-1 flex items-center gap-2.5 px-3 py-2 rounded-[12px] border border-dashed border-violet-400/50 dark:border-violet-700/60 text-left text-violet-700 dark:text-violet-300 hover:bg-violet-500/10 transition-colors"
                >
                  <span className="h-7 w-7 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                    <EyeOff className="h-3.5 w-3.5" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[11px] font-bold">Hidden chats</span>
                    <span className="block text-[10px] text-violet-600/80 dark:text-violet-300/70">Enter your PIN to see them</span>
                  </span>
                  <Lock className="h-3.5 w-3.5 opacity-70" />
                </button>
              ))}

            {visibleConversations.length === 0 ? (
              <div className="h-48 flex flex-col items-center justify-center text-center p-4 text-xs text-slate-400">
                <MessageSquare className="h-8 w-8 text-slate-300 dark:text-slate-700 mb-2" />
                <p>No conversations found</p>
                <button
                  type="button"
                  onClick={onNewChat}
                  className="mt-2 text-sky-500 hover:underline font-medium"
                >
                  Start a new conversation
                </button>
              </div>
            ) : (
              visibleConversations.map((c, i) => renderRow(c, false, i))
            )}
          </>
        )}

        {activeTab !== "messages" && (
          <button
            type="button"
            onClick={() => onSelectTab("messages")}
            className="w-full p-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-sky-600"
          >
            ← Back to chats
          </button>
        )}
      </div>

      {/* User Profile Footer */}
      <div className="px-3 py-2.5 border-t lanx-line flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="h-8 w-8 rounded-full flex items-center justify-center text-white font-bold text-xs shadow-sm shrink-0"
            style={{ backgroundColor: settings.avatar_color }}
          >
            {settings.display_name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
              {settings.display_name}
            </div>
            <div className="text-[10px] text-slate-400 truncate">
              {settings.hostname}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {settings.pin_enabled && (
            <button
              type="button"
              onClick={onLock}
              title="Lock LANX now"
              className="lanx-tool p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
            >
              <Lock className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onToggleTheme}
            title="Toggle theme (System / Light / Dark)"
            className="lanx-tool p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
          >
            {settings.theme === "dark" ? (
              <Moon className="h-4 w-4" />
            ) : settings.theme === "light" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <div className="flex items-center text-[10px] font-bold">A</div>
            )}
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            title="Application Settings"
            className="lanx-tool p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
};
