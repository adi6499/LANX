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
  Plus,
  Sun,
  Moon,
  Pin,
} from "lucide-react";

interface SidebarProps {
  settings: UserSettings;
  conversations: Conversation[];
  peers: Peer[];
  activeConversationId: string | null;
  activeTab: NavTab;
  searchQuery: string;
  /** Incoming files waiting for the user to accept. */
  pendingFiles: number;
  onSelectConversation: (id: string) => void;
  onSelectTab: (tab: NavTab) => void;
  onSearchChange: (q: string) => void;
  onOpenSettings: () => void;
  onToggleTheme: () => void;
  onNewChat: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  settings,
  conversations,
  peers,
  activeConversationId,
  activeTab,
  searchQuery,
  pendingFiles,
  onSelectConversation,
  onSelectTab,
  onSearchChange,
  onOpenSettings,
  onToggleTheme,
  onNewChat,
}) => {
  const onlineCount = peers.filter((p) => p.status === "online").length;
  const totalUnread = conversations.reduce((acc, c) => acc + c.unread_count, 0);

  const filteredConversations = conversations.filter((c) =>
    c.peer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (c.last_message_preview &&
      c.last_message_preview.toLowerCase().includes(searchQuery.toLowerCase()))
  );

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

  return (
    <aside className="w-80 h-full flex flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c111c] select-none transition-colors">
      {/* Brand Header */}
      <div className="p-4 pb-3 border-b border-slate-100 dark:border-slate-800/80">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <img src="/lanx-logo.png" alt="LANX" className="h-9 w-9 rounded-xl shadow-md shadow-sky-500/25" />
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-base tracking-tight text-slate-900 dark:text-white">
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

          <button
            type="button"
            onClick={onNewChat}
            title="Start conversation with peer"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search conversations, peers..."
            className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80 pl-9 pr-3 py-1.5 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-sky-500 transition-all"
          />
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="grid grid-cols-4 p-2 gap-1 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/60 dark:bg-slate-900/40">
        <button
          type="button"
          onClick={() => onSelectTab("messages")}
          className={`flex flex-col items-center py-1.5 rounded-lg text-[10px] font-semibold transition-all relative ${
            activeTab === "messages"
              ? "bg-white dark:bg-slate-800 text-sky-600 dark:text-sky-400 shadow-sm"
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
          className={`flex flex-col items-center py-1.5 rounded-lg text-[10px] font-semibold transition-all relative ${
            activeTab === "people"
              ? "bg-white dark:bg-slate-800 text-sky-600 dark:text-sky-400 shadow-sm"
              : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <Users className="h-4 w-4 mb-0.5" />
          <span>Peers</span>
          {onlineCount > 0 && (
            <span className="absolute top-1 right-2.5 px-1 py-0.2 rounded-full bg-emerald-500 text-[8px] text-white font-bold leading-none">
              {onlineCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => onSelectTab("transfers")}
          className={`flex flex-col items-center py-1.5 rounded-lg text-[10px] font-semibold transition-all relative ${
            activeTab === "transfers"
              ? "bg-white dark:bg-slate-800 text-sky-600 dark:text-sky-400 shadow-sm"
              : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <ArrowUpDown className="h-4 w-4 mb-0.5" />
          <span>Files</span>
          {pendingFiles > 0 && (
            <span className="absolute top-1 right-2.5 px-1 rounded-full bg-sky-500 text-[8px] text-white font-bold leading-none py-0.5">
              {pendingFiles}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => onSelectTab("history")}
          className={`flex flex-col items-center py-1.5 rounded-lg text-[10px] font-semibold transition-all ${
            activeTab === "history"
              ? "bg-white dark:bg-slate-800 text-sky-600 dark:text-sky-400 shadow-sm"
              : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <History className="h-4 w-4 mb-0.5" />
          <span>History</span>
        </button>
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {activeTab === "messages" && (
          <>
            {filteredConversations.length === 0 ? (
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
              filteredConversations.map((conv) => {
                const isSelected = activeConversationId === conv.id;
                return (
                  <button
                    key={conv.id}
                    type="button"
                    onClick={() => onSelectConversation(conv.id)}
                    className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition-all relative ${
                      isSelected
                        ? "bg-sky-500/10 dark:bg-sky-500/15 text-slate-900 dark:text-white border border-sky-500/30 shadow-sm"
                        : "hover:bg-slate-100 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300 border border-transparent"
                    }`}
                  >
                    {/* Avatar with status dot */}
                    <div className="relative shrink-0">
                      <div
                        className="h-10 w-10 rounded-full flex items-center justify-center text-white font-bold text-xs shadow-sm"
                        style={{ backgroundColor: conv.peer_avatar_color }}
                      >
                        {conv.peer_name.charAt(0).toUpperCase()}
                      </div>
                      <span
                        className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white dark:border-[#0c111c] ${
                          conv.peer_status === "online"
                            ? "bg-emerald-500"
                            : "bg-slate-400 dark:bg-slate-600"
                        }`}
                      />
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="font-semibold text-xs truncate text-slate-900 dark:text-white flex items-center gap-1">
                          {conv.peer_name}
                          {conv.is_pinned && (
                            <Pin className="h-3 w-3 text-amber-500 fill-amber-500 shrink-0" />
                          )}
                        </span>
                        <span className="text-[10px] text-slate-400 shrink-0 font-medium">
                          {formatTimestamp(conv.last_message_time)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {conv.last_message_preview || "No messages yet"}
                        </p>
                        {conv.unread_count > 0 && (
                          <span className="ml-1.5 shrink-0 px-1.5 py-0.5 rounded-full bg-sky-500 text-[10px] text-white font-bold leading-none">
                            {conv.unread_count}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </>
        )}

        {activeTab !== "messages" && (
          <button
            type="button"
            onClick={() => onSelectTab("messages")}
            className="w-full p-3 text-left text-xs text-slate-500 dark:text-slate-400 hover:text-sky-600"
          >
            ← Back to chats
          </button>
        )}
      </div>

      {/* User Profile Footer */}
      <div className="p-3 border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/70 dark:bg-slate-900/60 flex items-center justify-between">
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
          <button
            type="button"
            onClick={onToggleTheme}
            title="Toggle theme (System / Light / Dark)"
            className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
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
            className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
};
