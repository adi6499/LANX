import React, { useState } from "react";
import {
  Conversation,
  Peer,
  UserSettings,
  NavTab,
} from "../types";
import { MessageSquare, Users, ArrowUpDown, History, Settings, Search, SquarePen, Sun, Moon, Pin, UsersRound, Megaphone, Star, ClipboardList, Lock, EyeOff, Timer, BellOff, Archive, FolderPlus, Building2, BellRing, LifeBuoy, X as XIcon, StickyNote, CalendarDays, Wrench, FileText, Calculator, MessageCircle, Mic, Hand } from "lucide-react";
import { ChatMenu, type ChatTools } from "./tools/ChatMenu";
import { AppsLauncher } from "./admin/AppsLauncher";
import { ShieldCheck } from "lucide-react";
import { isMuted } from "../lib/tools";
import { useDictationLabel } from "../lib/voice";
import { useGesturePrefs } from "../lib/gestures/prefs";
import { stagger } from "../lib/motion";
import { Avatar } from "./Avatar";
import { CLEAR_AFTER, EMPTY_PROFILE, STATUS_PRESETS, effective, statusLine, statusPreset } from "../lib/profile";
import type { Profile } from "../types";

interface SidebarProps {
  settings: UserSettings;
  conversations: Conversation[];
  peers: Peer[];
  /** LANX 1.2.9: colleagues' profiles (avatars and statuses). */
  profiles: Record<string, Profile>;
  /** Quick status from the menu at the bottom. */
  onSetProfile: (profile: Profile) => void;
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
  /** LANX 2.3.0: raise an IT help ticket. */
  onRaiseHelp?: () => void;
  /** LANX 2.4.0: send an end-of-day report. */
  onEndOfDay?: () => void;
  /** LANX 2.5.0: notes, calendar, PDF tools, calculator, WhatsApp invite. */
  onOpenNotes?: () => void;
  onOpenCalendar?: () => void;
  onOpenPdf?: () => void;
  onOpenCalc?: () => void;
  onInviteWhatsApp?: () => void;
  onDictate?: () => void;
  onOpenVoice?: () => void;
  /** LANX 3.5.0 */
  onOpenGestures?: () => void;
  /** LANX 1.5.0: starred messages from all chats. */
  onOpenStarred?: () => void;
  /** LANX 1.6.0: the Organiser, and how many cards wait for you. */
  onOpenOrganiser?: () => void;
  organiserCount?: number;
  onLock: () => void;
  onToggleHidden: () => void;
  /** LANX 1.7.0: pin / mute / archive / folders from the chat list. */
  chatTools?: ChatTools;
  onManageFolders?: () => void;
  /** Search every message for what's typed in the search box. */
  onSearchAll?: (query: string) => void;
  /** LANX 1.8.0: the Office (emergency, reception, kudos, birthdays, away). */
  onOpenOffice?: () => void;
  /** An emergency alert is going on. */
  officeAlert?: boolean;
  /** This PC is the reception desk: a 🛎️ button. */
  onOpenReception?: () => void;
  /** Colleagues whose birthday is today. */
  birthdaysToday?: { id: string; name: string }[];
  onSendWishes?: (peerId: string) => void;
  /** LANX 1.9.0: Admin (office settings, apps, clean-up, export). */
  onOpenAdmin?: (tab?: "office" | "apps" | "cleanup" | "export") => void;
  onError?: (text: string) => void;
}

/** LANX 1.7.0: which chats the list shows. */
type ListView = "all" | "unread" | "archived" | string;

const TAB_ORDER: NavTab[] = ["messages", "people", "transfers", "history"];

/** LANX 3.6.1: gestures on and off in one click. The first time it also shows
 *  how they work; a right-click opens the gesture settings. */
const GestureButton: React.FC<{ onOpenGestures: () => void }> = ({ onOpenGestures }) => {
  const [prefs, setPrefs] = useGesturePrefs();
  const on = !!prefs?.enabled;
  const toggle = () => {
    if (!prefs) return;
    setPrefs({ ...prefs, enabled: !on });
    if (on) return;
    let seen = false;
    try {
      seen = localStorage.getItem("lanx.gestures.guideSeen") === "1";
      localStorage.setItem("lanx.gestures.guideSeen", "1");
    } catch {}
    if (!seen) onOpenGestures();
  };
  return (
    <button
      type="button"
      data-gesture-toggle={on ? "on" : "off"}
      onClick={toggle}
      onContextMenu={(e) => {
        e.preventDefault();
        onOpenGestures();
      }}
      title={on ? "Gestures are on: the camera follows your hand. Click to turn them off (right-click for settings)" : "Gestures: use LANX with your hand through the camera (right-click for settings)"}
      aria-pressed={on}
      className={`lanx-tool relative flex h-8 w-8 items-center justify-center ${on ? "text-emerald-600 dark:text-emerald-400 !bg-emerald-500/12" : "text-slate-500 dark:text-slate-400"}`}
    >
      <Hand className="h-[17px] w-[17px]" />
      {on && <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-emerald-500" />}
    </button>
  );
};

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
  onRaiseHelp,
  onEndOfDay,
  onOpenNotes,
  onOpenCalendar,
  onOpenPdf,
  onOpenCalc,
  onInviteWhatsApp,
  onDictate,
  onOpenVoice,
  onOpenGestures,
  onOpenStarred,
  onOpenOrganiser,
  organiserCount = 0,
  onLock,
  onToggleHidden,
  profiles,
  onSetProfile,
  chatTools,
  onManageFolders,
  onSearchAll,
  onOpenOffice,
  officeAlert = false,
  onOpenReception,
  birthdaysToday = [],
  onSendWishes,
  onOpenAdmin,
  onError,
}) => {
  const todayKey = `lanx.bday.${new Date().toDateString()}`;
  const [bdayHidden, setBdayHidden] = useState(() => {
    try {
      return localStorage.getItem(todayKey) === "1";
    } catch {
      return false;
    }
  });
  const [statusMenu, setStatusMenu] = useState(false);
  const [view, setView] = useState<ListView>("all");
  const [composeMenu, setComposeMenu] = useState(false);
  const [toolsMenu, setToolsMenu] = useState(false);
  const dictateLabel = useDictationLabel();
  const [menu, setMenu] = useState<{ conv: Conversation; x: number; y: number } | null>(null);
  const folders = settings.chat_folders ?? [];
  const activeView = view === "all" || view === "unread" || view === "archived" || folders.some((f) => f.id === view) ? view : "all";
  const mine = effective(settings.profile);
  const myLine = statusLine(mine);
  const onlineCount = peers.filter((p) => p.status === "online").length;
  const totalUnread = conversations.reduce((acc, c) => acc + c.unread_count, 0);

  const filteredConversations = conversations.filter((c) =>
    c.peer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (c.last_message_preview &&
      c.last_message_preview.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // Pinned chats first, then the newest.
  const ordered = [...filteredConversations].sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned) || b.last_message_time - a.last_message_time);
  const archivedConversations = ordered.filter((c) => !c.is_hidden && c.archived);
  const archivedUnread = archivedConversations.reduce((n, c) => n + c.unread_count, 0);
  const visibleConversations = ordered.filter((c) => {
    if (c.is_hidden) return false;
    if (activeView === "archived") return !!c.archived;
    if (c.archived) return false;
    if (activeView === "unread") return c.unread_count > 0 || c.id === activeConversationId;
    if (activeView !== "all") return (c.folders ?? []).includes(activeView);
    return true;
  });
  const hiddenConversations = ordered.filter((c) => c.is_hidden);
  const folderUnread = (id: string) => ordered.filter((c) => !c.is_hidden && !c.archived && (c.folders ?? []).includes(id)).reduce((n, c) => n + c.unread_count, 0);

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
    const muted = isMuted(conv);
    return (
      <button
        key={conv.id}
        type="button"
        data-hidden-chat={hidden ? "true" : undefined}
        aria-current={isSelected ? "true" : undefined}
        onClick={() => onSelectConversation(conv.id)}
        onContextMenu={(e) => {
          if (!chatTools) return;
          e.preventDefault();
          setMenu({ conv, x: e.clientX, y: e.clientY });
        }}
        data-chat-row={conv.id}
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
          <Avatar
            name={conv.peer_name}
            color={conv.peer_avatar_color}
            profile={conv.kind === "group" ? null : profiles[conv.peer_id]}
            size={40}
            square={conv.kind === "group"}
            className={`${conv.kind === "group" ? "rounded-[12px]" : "rounded-full"} ${hidden && !isSelected ? "ring-2 ring-violet-400/80" : ""} ${
              isSelected ? "ring-2 ring-white/70" : ""
            }`}
          >
            {conv.kind === "group" ? <Users className="h-4 w-4" /> : undefined}
          </Avatar>
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
              {conv.kind !== "group" && statusPreset(effective(profiles[conv.peer_id])?.status) && (
                <span className="text-[11px] shrink-0" title={statusLine(profiles[conv.peer_id])?.text} data-row-status>
                  {statusPreset(effective(profiles[conv.peer_id])?.status)?.emoji}
                </span>
              )}
              {conv.is_pinned && <Pin className={`h-3 w-3 shrink-0 ${isSelected ? "text-white fill-white" : "text-amber-500 fill-amber-500"}`} />}
              {conv.secret_ttl > 0 && <Timer className={`h-3 w-3 shrink-0 ${isSelected ? "text-white" : "text-violet-500"}`} aria-label="Secret chat" />}
              {muted && <BellOff data-row-muted className={`h-3 w-3 shrink-0 ${isSelected ? "text-white/80" : "text-slate-400"}`} aria-label="Muted" />}
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
                  isSelected ? "bg-white text-sky-600" : hidden ? "bg-violet-600 text-white" : muted ? "bg-slate-400 dark:bg-slate-600 text-white" : "bg-sky-500 text-white"
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
    <aside className="relative w-80 m-2 mr-0 rounded-[20px] lanx-glass flex flex-col overflow-hidden select-none shrink-0 lanx-launch">
      {/* Brand Header */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <img src="/lanx-logo.png" alt="LANX" className="h-9 w-9 shrink-0 rounded-[10px] shadow-md shadow-sky-500/25" />
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
            {/* LANX 1.8.0: new chat / new group / message everyone in one menu. */}
            <div className="relative">
              <button
                type="button"
                data-compose
                onClick={() => setComposeMenu((v) => !v)}
                title="New chat, new group, message everyone"
                className={`lanx-tool flex h-8 w-8 items-center justify-center text-sky-600 dark:text-sky-400 ${composeMenu ? "!bg-[var(--lanx-fill)]" : ""}`}
              >
                <SquarePen className="h-[17px] w-[17px]" />
              </button>
              {composeMenu && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setComposeMenu(false)} />
                  <div data-compose-menu className="absolute right-0 top-9 z-40 w-52 rounded-[14px] lanx-menu p-1.5 lanx-menu-in">
                    {(
                      [
                        [SquarePen, "New chat", "text-sky-600", onNewChat, "new-chat"],
                        [UsersRound, "New group", "text-indigo-600", onNewGroup, "new-group"],
                        [Megaphone, "Message everyone", "text-amber-600", onBroadcast, "broadcast"],
                        ...(onRaiseHelp ? ([[LifeBuoy, "Get IT help", "text-rose-600", onRaiseHelp, "help"]] as [React.ElementType, string, string, () => void, string][]) : []),
                        ...(onEndOfDay ? ([[ClipboardList, "End-of-day report", "text-slate-600", onEndOfDay, "endofday"]] as [React.ElementType, string, string, () => void, string][]) : []),
                        ...(onInviteWhatsApp ? ([[MessageCircle, "Invite on WhatsApp", "text-emerald-600", onInviteWhatsApp, "whatsapp-invite"]] as [React.ElementType, string, string, () => void, string][]) : []),
                      ] as [React.ElementType, string, string, () => void, string][]
                    ).map(([I, label, tone, run, id]) => (
                      <button
                        key={id}
                        type="button"
                        data-compose-item={id}
                        onClick={() => {
                          setComposeMenu(false);
                          run();
                        }}
                        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12.5px] text-left text-slate-700 dark:text-slate-200 hover:bg-[var(--lanx-fill)]"
                      >
                        <I className={`h-4 w-4 ${tone}`} /> {label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* LANX 1.9.0: the tool buttons get their own row (the title row was too full). */}
        <div data-header-tools className="-mx-1 mb-2 flex items-center gap-0.5">
            {onOpenReception && (
              <button
                type="button"
                data-open-reception
                onClick={onOpenReception}
                title="Reception: tell a colleague their visitor has arrived"
                className="lanx-tool flex h-8 w-8 items-center justify-center text-orange-500"
              >
                <BellRing className="h-[17px] w-[17px]" />
              </button>
            )}
            {onOpenAdmin && <AppsLauncher onEdit={() => onOpenAdmin("apps")} onError={(t) => onError?.(t)} />}
            {onOpenOffice && (
              <button
                type="button"
                data-open-office
                onClick={onOpenOffice}
                title="Office: emergency alert, reception, kudos, birthdays, out of office"
                className={`lanx-tool relative flex h-8 w-8 items-center justify-center ${officeAlert ? "text-red-600" : "text-orange-600 dark:text-orange-400"}`}
              >
                <Building2 className="h-[17px] w-[17px]" />
                {officeAlert && <span className="absolute top-0.5 right-0.5 h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />}
                {!officeAlert && birthdaysToday.length > 0 && <span className="absolute -top-0.5 -right-0.5 text-[10px]">🎂</span>}
              </button>
            )}
            {onOpenOrganiser && (
              <button
                type="button"
                data-open-organiser
                onClick={onOpenOrganiser}
                title="Organiser: notices, tasks, approvals, polls, meetings"
                className="lanx-tool relative flex h-8 w-8 items-center justify-center text-emerald-600 dark:text-emerald-400"
              >
                <ClipboardList className="h-[17px] w-[17px]" />
                {organiserCount > 0 && (
                  <span data-organiser-count className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9.5px] font-bold flex items-center justify-center">
                    {organiserCount > 99 ? "99+" : organiserCount}
                  </span>
                )}
              </button>
            )}
            {onOpenCalendar && (
              <button type="button" data-open-calendar onClick={onOpenCalendar} title="Calendar: your events, meetings, deadlines, birthdays, holidays" className="lanx-tool flex h-8 w-8 items-center justify-center text-sky-600 dark:text-sky-400">
                <CalendarDays className="h-[17px] w-[17px]" />
              </button>
            )}
            {onOpenNotes && (
              <button type="button" data-open-notes onClick={onOpenNotes} title="Notes" className="lanx-tool flex h-8 w-8 items-center justify-center text-amber-500">
                <StickyNote className="h-[17px] w-[17px]" />
              </button>
            )}
            {onOpenGestures && <GestureButton onOpenGestures={onOpenGestures} />}
            {(onOpenPdf || onOpenCalc) && (
              <div className="relative">
                <button type="button" data-open-tools onClick={() => setToolsMenu((v) => !v)} title="Tools: PDF tools, voice, gestures, calculator" className={`lanx-tool flex h-8 w-8 items-center justify-center text-slate-600 dark:text-slate-300 ${toolsMenu ? "!bg-[var(--lanx-fill)]" : ""}`}>
                  <Wrench className="h-[17px] w-[17px]" />
                </button>
                {toolsMenu && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setToolsMenu(false)} />
                    <div data-tools-menu className="absolute right-0 top-9 z-40 w-48 rounded-[14px] lanx-menu p-1.5 lanx-menu-in">
                      {onOpenPdf && (
                        <button type="button" data-tools-item="pdf" onClick={() => { setToolsMenu(false); onOpenPdf(); }} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12.5px] text-left text-slate-700 dark:text-slate-200 hover:bg-[var(--lanx-fill)]">
                          <FileText className="h-4 w-4 text-rose-600" /> PDF tools
                        </button>
                      )}
                      {onDictate && (
                        <button type="button" data-tools-item="voice" onClick={() => { setToolsMenu(false); onDictate(); }} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12.5px] text-left text-slate-700 dark:text-slate-200 hover:bg-[var(--lanx-fill)]">
                          <Mic className="h-4 w-4 text-red-600" /> Voice typing <span className="ml-auto whitespace-nowrap text-[10px] text-slate-400">{dictateLabel}</span>
                        </button>
                      )}
                      {onOpenVoice && (
                        <button type="button" data-tools-item="voice-settings" onClick={() => { setToolsMenu(false); onOpenVoice(); }} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12.5px] text-left text-slate-700 dark:text-slate-200 hover:bg-[var(--lanx-fill)]">
                          <Mic className="h-4 w-4 text-slate-500" /> Voice settings
                        </button>
                      )}
                      {onOpenGestures && (
                        <button type="button" data-tools-item="gestures" onClick={() => { setToolsMenu(false); onOpenGestures(); }} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12.5px] text-left text-slate-700 dark:text-slate-200 hover:bg-[var(--lanx-fill)]">
                          <Hand className="h-4 w-4 text-emerald-600" /> Gestures &amp; commands
                        </button>
                      )}
                      {onOpenCalc && (
                        <button type="button" data-tools-item="calc" onClick={() => { setToolsMenu(false); onOpenCalc(); }} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12.5px] text-left text-slate-700 dark:text-slate-200 hover:bg-[var(--lanx-fill)]">
                          <Calculator className="h-4 w-4 text-slate-600" /> Calculator &amp; GST
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
            {onOpenStarred && (
              <button
                type="button"
                data-open-starred
                onClick={onOpenStarred}
                title="Starred messages"
                className="lanx-tool flex h-8 w-8 items-center justify-center text-amber-500"
              >
                <Star className="h-[17px] w-[17px]" />
              </button>
            )}
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

      {/* LANX 1.8.0: birthdays today */}
      {activeTab === "messages" && birthdaysToday.length > 0 && !bdayHidden && (
        <div data-birthday-banner className="mx-3 mb-2 flex items-center gap-2 rounded-[12px] bg-gradient-to-r from-pink-500/15 to-amber-400/15 px-3 py-2 text-[11.5px] text-slate-700 dark:text-slate-200 lanx-rise">
          <span className="text-base">🎂</span>
          <span className="flex-1 min-w-0">
            <b>{birthdaysToday.map((b) => b.name.split(" ")[0]).join(", ")}</b> {birthdaysToday.length === 1 ? "has a birthday" : "have birthdays"} today!
          </span>
          {onSendWishes && (
            <button type="button" data-birthday-wish onClick={() => birthdaysToday.forEach((b) => onSendWishes(b.id))} className="shrink-0 rounded-full bg-pink-500 px-2.5 py-0.5 text-[11px] font-semibold text-white hover:bg-pink-600">
              Wish
            </button>
          )}
          <button
            type="button"
            title="Hide for today"
            onClick={() => {
              setBdayHidden(true);
              try {
                localStorage.setItem(todayKey, "1");
              } catch {
                /* fine */
              }
            }}
            className="shrink-0 text-slate-400 hover:text-slate-600"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* LANX 1.7.0: chat folders */}
      {activeTab === "messages" && (
        <div data-folder-chips className="flex items-center gap-1 px-3 pb-2 overflow-x-auto lanx-noscroll">
          {(
            [
              ["all", "All", 0],
              ["unread", "Unread", 0],
              ...folders.map((f) => [f.id, f.name, folderUnread(f.id)] as [string, string, number]),
            ] as [string, string, number][]
          ).map(([id, label, n]) => (
            <button
              key={id}
              type="button"
              data-folder-chip={id}
              onClick={() => setView(id)}
              className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                activeView === id ? "bg-sky-500 text-white" : "bg-[var(--lanx-fill)] text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              {label}
              {n > 0 && <span className={`min-w-[15px] px-1 rounded-full text-[9.5px] leading-[15px] ${activeView === id ? "bg-white/25" : "bg-sky-500 text-white"}`}>{n}</span>}
            </button>
          ))}
          {(archivedConversations.length > 0 || activeView === "archived") && (
            <button
              type="button"
              data-folder-chip="archived"
              onClick={() => setView(activeView === "archived" ? "all" : "archived")}
              title="Archived chats"
              className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                activeView === "archived" ? "bg-slate-600 text-white" : "bg-[var(--lanx-fill)] text-slate-600 dark:text-slate-300"
              }`}
            >
              <Archive className="h-3 w-3" /> Archived
              {archivedUnread > 0 && <span className="min-w-[15px] px-1 rounded-full bg-slate-500 text-white text-[9.5px] leading-[15px]">{archivedUnread}</span>}
            </button>
          )}
          {onManageFolders && (
            <button type="button" data-manage-folders onClick={onManageFolders} title="Chat folders" className="shrink-0 lanx-tool p-1 text-slate-400 hover:text-indigo-500">
              <FolderPlus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

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
              activeView === "all" ? (
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
                <div className="py-10 px-4 text-center text-[11.5px] text-slate-400 leading-relaxed">
                  {activeView === "unread"
                    ? "All caught up — no unread chats."
                    : activeView === "archived"
                      ? "No archived chats."
                      : "No chats in this folder yet. Right-click a chat → Chat folders."}
                </div>
              )
            ) : (
              visibleConversations.map((c, i) => renderRow(c, false, i))
            )}
            {searchQuery.trim().length >= 2 && onSearchAll && (
              <button
                type="button"
                data-search-all
                onClick={() => onSearchAll(searchQuery.trim())}
                className="w-full mt-1 flex items-center gap-2 px-3 py-2 rounded-[12px] text-left text-[11.5px] font-semibold text-sky-600 dark:text-sky-400 hover:bg-[var(--lanx-fill)]"
              >
                <Search className="h-3.5 w-3.5" />
                <span className="truncate">Search all messages for “{searchQuery.trim()}”</span>
              </button>
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

      {menu && chatTools && (
        <ChatMenu
          conv={conversations.find((c) => c.id === menu.conv.id) ?? menu.conv}
          folders={folders}
          x={menu.x}
          y={menu.y}
          tools={chatTools}
          onNewFolder={() => onManageFolders?.()}
          onClose={() => setMenu(null)}
        />
      )}

      {/* User Profile Footer */}
      <div className="relative px-3 py-2.5 border-t lanx-line flex items-center justify-between">
        <button
          type="button"
          onClick={() => setStatusMenu((v) => !v)}
          title="Set your status"
          className="flex items-center gap-2.5 min-w-0 rounded-[10px] -ml-1 pl-1 pr-2 py-0.5 hover:bg-[var(--lanx-fill)] transition-colors text-left"
          data-my-status
        >
          <Avatar name={settings.display_name} color={settings.avatar_color} profile={mine} size={32} showStatus />
          <div className="min-w-0">
            <div className="text-xs font-bold text-slate-900 dark:text-white truncate">{settings.display_name}</div>
            <div className="text-[10px] text-slate-400 truncate">{myLine ? `${myLine.emoji} ${myLine.text}` : "Set a status"}</div>
          </div>
        </button>
        {statusMenu && (
          <div className="absolute bottom-full left-2 mb-2 z-40 w-64 rounded-[14px] lanx-menu p-1.5 lanx-menu-in origin-bottom-left" data-status-menu>
            <div className="px-2.5 pt-1.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Your status</div>
            {STATUS_PRESETS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setStatusMenu(false);
                  onSetProfile({
                    ...EMPTY_PROFILE,
                    ...settings.profile,
                    status: s.id,
                    status_text: "",
                    status_until: s.id === "dnd" ? CLEAR_AFTER.find((c) => c.id === "1h")!.until() : s.id === "lunch" ? CLEAR_AFTER.find((c) => c.id === "1h")!.until() : 0,
                  });
                }}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left ${
                  mine?.status === s.id ? "bg-[var(--lanx-fill)] font-semibold" : "hover:bg-[var(--lanx-fill)]"
                } text-slate-700 dark:text-slate-200`}
              >
                <span className="w-5 text-center">{s.emoji}</span> {s.label}
                {(s.id === "dnd" || s.id === "lunch") && <span className="ml-auto text-[10px] text-slate-400">1 hour</span>}
              </button>
            ))}
            {mine?.status && (
              <button
                type="button"
                onClick={() => {
                  setStatusMenu(false);
                  onSetProfile({ ...EMPTY_PROFILE, ...settings.profile, status: "", status_text: "", status_until: 0 });
                }}
                className="w-full mt-1 border-t lanx-line pt-1.5 px-2.5 py-1.5 rounded-lg text-xs text-left text-slate-500 hover:bg-[var(--lanx-fill)]"
              >
                Clear status
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setStatusMenu(false);
                onOpenSettings();
              }}
              className="w-full px-2.5 py-1.5 rounded-lg text-xs text-left text-sky-600 dark:text-sky-400 hover:bg-[var(--lanx-fill)]"
            >
              Edit profile…
            </button>
          </div>
        )}

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

          {onOpenAdmin && (
            <button
              type="button"
              data-open-admin
              onClick={() => onOpenAdmin("office")}
              title="Admin: office settings, apps, message clean-up, export"
              className="lanx-tool p-1.5 text-slate-500 dark:text-slate-400 hover:text-indigo-600"
            >
              <ShieldCheck className="h-4 w-4" />
            </button>
          )}
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
