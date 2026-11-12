import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { FloatingMenu } from "./FloatingMenu";
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
  Mic,
  CalendarClock,
  Star,
  AlarmClock,
  Pin,
  Ban,
  Forward,
} from "lucide-react";
import { FileCard, GroupFileCard } from "./FileCard";
import { MeetingCard, RecordingCard } from "./MeetingCards";
import { lessMotion } from "../lib/motion";
import { Avatar } from "./Avatar";
import { statusLine } from "../lib/profile";
import type { Profile, ScheduledMessage } from "../types";
import { api, errorText, events } from "../lib/api";
import { MessageTools, ReactionChips, type MessageActions } from "./chat/MessageTools";
import { VoiceNote, VoiceRecorder, voiceMsFromLabel } from "./chat/VoiceNote";
import { MentionPicker, PinnedBar, QuickReplyPicker, ReplyEditBar, ScheduledStrip, SendLaterMenu, type MentionCandidate } from "./chat/ComposerExtras";
import { MessageText, isForwarded, whenText, withoutForwardMark } from "./chat/chatUtils";
import { CardView } from "./org/CardView";
import { CreateCardModal, type Person } from "./org/CreateCardModal";
import type { CardKind } from "./org/cardModel";
import { BarChart3, BellOff, CalendarDays, ClipboardCheck, FileSignature, FolderSync, ListChecks, Megaphone, Plus, Scissors, Sticker as StickerIcon } from "lucide-react";
import { StickerBubble, StickerPicker } from "./tools/Stickers";
import { IntercomButton } from "./office/IntercomButton";
import type { SentFile } from "../types";
import { LifeBuoy } from "lucide-react";
import { isMuted, muteText } from "../lib/tools";

/** LANX 1.5.0: what a send can carry besides the text. */
export interface SendOptions {
  replyTo?: string | null;
  mentions?: string[];
}

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
  onSendMessage: (content: string, opts?: SendOptions) => Promise<boolean>;
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
  /** LANX 1.4.0: start a meeting with this group; "Join again" on a meeting card. */
  myId?: string | null;
  onMeeting?: (video: boolean) => void;
  onRejoinMeeting?: (messageId: string) => void;
  onError?: (text: string) => void;
  // ---- LANX 1.5.0
  myName?: string;
  profiles?: Record<string, Profile>;
  /** A recorded voice note to send. */
  onSendVoice?: (data: Blob, durationMs: number, ext: string) => Promise<void>;
  quickReplies?: string[];
  onSaveQuickReplies?: (list: string[]) => void;
  /** LANX 2.6.0: "/meme cats" typed in the box opens the hidden meme picker. */
  onOpenMemes?: (query: string) => void;
  /** LANX 2.7.0: "/music tum hi ho" opens the hidden music picker. */
  onOpenMusic?: (query: string) => void;
  /** LANX 2.9.0: "/game chess" opens the hidden games window. */
  onOpenGames?: (query: string) => void;
  /** A message changed or went away here (instant feedback). */
  onMessageChanged?: (m: Message) => void;
  onMessageRemoved?: (id: string) => void;
  /** Scroll to this message once it is shown (from Starred). */
  jumpTo?: string | null;
  onJumped?: () => void;
  /** LANX 1.6.0: a card was posted here. */
  onCardPosted?: (m: Message) => void;
  // ---- LANX 1.7.0
  onSendSticker?: (id: string) => void;
  /** Take a screenshot (LANX hides for a moment) and mark it up. */
  onScreenshot?: () => void;
  /** Share a folder here that stays up to date. */
  onShareFolder?: () => void;
  onUnmute?: () => void;
  // ---- LANX 1.8.0
  /** An intercom message went out (instant feedback). */
  onIntercomSent?: (sent: SentFile[]) => void;
  /** Remote help: "view" = ask to see their screen, "show" = show mine. */
  onRemoteHelp?: (help: "view" | "show") => void;
  /** LANX 2.2.0: forward these messages (opens the chat picker). */
  onForward?: (messages: Message[]) => void;
  /** LANX 2.5.0 */
  onSaveNote?: (m: Message) => void;
  onShareWhatsApp?: (m: Message) => void;
}

const QUICK_EMOJIS = ["👍", "🙏", "✅", "👋", "😀", "🎉", "🔥", "❤️", "⚡", "📎"];
const NAME_COLORS = ["text-indigo-600", "text-emerald-600", "text-pink-600", "text-amber-600", "text-sky-600", "text-violet-600"];

/** LANX 3.11: made once. A new date format for every message on every draw was a
 *  good part of the time a long chat took to open. */
const TIME_FMT = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" });
const DAY_FMT = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const NO_MESSAGES: Message[] = [];
/** A chat opens on its newest messages; scrolling up shows this many more each time. */
const SHOW_PAGE = 120;
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function dayLabel(ts: number): string {
  const d = new Date(ts * 1000);
  const today = new Date();
  if (sameDay(d, today)) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(d, yesterday)) return "Yesterday";
  return DAY_FMT.format(d);
}

/** An object whose functions always call the newest version of `get()`'s (one that is
 *  missing stays missing): a list kept from an earlier draw never calls an old handler. */
function delegate<T extends object>(get: () => T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(get())) {
    out[k] = typeof v === "function" ? (...a: unknown[]) => (get() as Record<string, ((...x: unknown[]) => unknown) | undefined>)[k]?.(...a) : v;
  }
  return out as T;
}

/** The handlers the kept message list calls (always this draw's). */
type LiveHandlers = Pick<ConversationPanelProps, "transferActions" | "onMessageChanged" | "onError" | "onMeeting" | "onRemoteHelp" | "onRejoinMeeting" | "onRetryMessage" | "onCall"> & {
  actions: MessageActions;
  jumpToMessage: (id: string) => boolean;
};

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
  myId = null,
  onMeeting,
  onRejoinMeeting,
  onError,
  onUnblock,
  myName = "",
  profiles = {},
  onSendVoice,
  quickReplies = [],
  onSaveQuickReplies,
  onOpenMemes,
  onOpenMusic,
  onOpenGames,
  onMessageChanged,
  onMessageRemoved,
  jumpTo = null,
  onSendSticker,
  onScreenshot,
  onShareFolder,
  onUnmute,
  onIntercomSent,
  onRemoteHelp,
  onForward,
  onSaveNote,
  onShareWhatsApp,
  onJumped,
  onCardPosted,
}) => {
  const [inputText, setInputText] = useState("");
  // LANX 1.5.0
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [rawMembers, setMembers] = useState<MentionCandidate[]>([]);
  // Current names and colours (a group remembers the names people had when they joined).
  const members = rawMembers.map((m) => {
    const p = peers.find((x) => x.id === m.id);
    return p ? { ...m, name: p.display_name, color: p.avatar_color } : m;
  });
  const [mention, setMention] = useState<{ start: number; text: string } | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [quickIdx, setQuickIdx] = useState(0);
  const [quickClosed, setQuickClosed] = useState(false);
  const [recording, setRecording] = useState(false);
  const [sendLater, setSendLater] = useState(false);
  const [scheduled, setScheduled] = useState<ScheduledMessage[]>([]);
  // LANX 1.6.0
  const [createCard, setCreateCard] = useState<{ kind: CardKind; title?: string; fromMessage?: string | null } | null>(null);
  const [plusMenu, setPlusMenu] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showStickers, setShowStickers] = useState(false);
  const [helpMenu, setHelpMenu] = useState(false);
  const helpBtnRef = useRef<HTMLButtonElement>(null);
  const secretBtnRef = useRef<HTMLButtonElement>(null);
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

  // LANX 3.11: a chat shows its newest messages; older ones as you scroll up (drawing a
  // whole long history at once froze LANX for seconds). While the next chat's messages
  // load, the last chat's aren't drawn under its name.
  const [more, setMore] = useState({ conv: "", n: 0 });
  const extra = conversation && more.conv === conversation.id ? more.n : 0;
  const loadingOther = !!conversation && messages.length > 0 && messages[0].conversation_id !== conversation.id;
  const list = loadingOther ? NO_MESSAGES : messages;
  const firstShown = Math.max(0, list.length - (SHOW_PAGE + extra));
  const listRef = useRef<HTMLDivElement>(null);
  const keepPlace = useRef<{ height: number; top: number } | null>(null);
  const pendingJump = useRef<string | null>(null);
  const jumpRef = useRef<(id: string) => boolean>(() => false);
  const latest = useRef({ list, conv: "", extra });
  latest.current = { list, conv: conversation?.id ?? "", extra };
  const live = useRef<LiveHandlers | null>(null);
  const listCache = useRef<{ deps: unknown[]; node: React.ReactNode } | null>(null);
  const showEarlier = () => {
    const el = listRef.current;
    if (!conversation || firstShown === 0 || keepPlace.current) return;
    if (el) keepPlace.current = { height: el.scrollHeight, top: el.scrollTop };
    setMore({ conv: conversation.id, n: extra + SHOW_PAGE });
  };
  // Earlier messages were added above: the view stays where it was (and a pending jump goes).
  useLayoutEffect(() => {
    const el = listRef.current;
    const k = keepPlace.current;
    keepPlace.current = null;
    if (el && k) el.scrollTop = k.top + (el.scrollHeight - k.height);
    const id = pendingJump.current;
    if (id) {
      pendingJump.current = null;
      jumpRef.current(id);
    }
  }, [extra]);

  // Opening a chat jumps to the newest message; new messages scroll in smoothly.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: justOpened() ? "auto" : "smooth" });
  }, [messages.length, conversation?.id]);

  useEffect(() => {
    setConfirmDelete(false);
    setSecretMenu(false);
    setInputText("");
    setReplyTo(null);
    setEditing(null);
    setMention(null);
    setRecording(false);
    setSendLater(false);
    setCreateCard(null);
    setPlusMenu(false);
    textareaRef.current?.focus();
  }, [conversation?.id]);

  // LANX 1.5.0: group members (for @mentions) and this chat's "send later" list.
  const convId = conversation?.id ?? null;
  const convIsGroup = conversation?.kind === "group";
  useEffect(() => {
    setMembers([]);
    if (!convId || !convIsGroup) return;
    let gone = false;
    api
      .getGroup(convId)
      .then((g) => {
        if (gone || !g) return;
        setMembers(
          g.members
            .filter((m) => !m.is_me)
            .map((m) => ({ id: m.device_id, name: m.display_name, color: peers.find((p) => p.id === m.device_id)?.avatar_color ?? "#64748b" }))
        );
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId, convIsGroup]);
  const loadScheduled = useCallback(() => {
    if (!convId) return;
    api
      .listScheduled(convId)
      .then((l) => setScheduled(l))
      .catch(() => setScheduled([]));
  }, [convId]);
  useEffect(() => {
    setScheduled([]);
    loadScheduled();
  }, [loadScheduled]);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  // The "+" menu closes when you click anywhere else.
  useEffect(() => {
    if (!plusMenu) return;
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest("[data-plus-options],[data-plus-menu]")) setPlusMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [plusMenu]);
  useEffect(() => {
    let un: (() => void) | undefined;
    events
      .onScheduledChanged((e) => {
        if (e.problem) onErrorRef.current?.(e.problem);
        if (e.conversation_id === convId) loadScheduled();
      })
      .then((u) => (un = u));
    return () => un?.();
  }, [convId, loadScheduled]);

  /** Scrolls to a message and makes it glow for a moment. */
  const jumpToMessage = useCallback((id: string) => {
    const el = rootRef.current?.querySelector(`[data-msg="${CSS.escape(id)}"]`) as HTMLElement | null;
    if (!el) {
      // An older message, not drawn yet: show back to it, then jump (LANX 3.11).
      const { list: all, conv, extra: now } = latest.current;
      const idx = all.findIndex((m) => m.id === id);
      const need = idx < 0 ? 0 : all.length - idx + 20 - SHOW_PAGE;
      if (idx < 0 || !conv || need <= now) return false;
      pendingJump.current = id;
      setMore({ conv, n: need });
      return true;
    }
    el.scrollIntoView({ block: "center", behavior: lessMotion() ? "auto" : "smooth" });
    el.animate([{ backgroundColor: "rgba(250, 204, 21, 0.35)" }, { backgroundColor: "rgba(250, 204, 21, 0)" }], { duration: 1800, easing: "ease-out" });
    return true;
  }, []);
  jumpRef.current = jumpToMessage;
  useEffect(() => {
    if (!jumpTo) return;
    const t = window.setTimeout(() => {
      if (jumpToMessage(jumpTo)) onJumped?.();
    }, 350);
    return () => window.clearTimeout(t);
  }, [jumpTo, messages.length, jumpToMessage, onJumped]);

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
  const hasTimers = list.some((m) => m.ttl_secs && m.expire_at);
  useEffect(() => {
    if (!hasTimers) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [hasTimers]);

  /** Where the cursor goes after the text was changed for you (a picked
   *  @mention) — set in the same frame, so fast typing never lands elsewhere. */
  const caretRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
    if (caretRef.current !== null) {
      const pos = Math.min(caretRef.current, ta.value.length);
      caretRef.current = null;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    }
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

  // ---- LANX 1.5.0: replies, edits, @mentions, quick replies, send later
  const senderName = (m: Message) => (m.is_outgoing ? "You" : isGroup ? peerName(m.sender_id) : conversation.peer_name);
  const previewOf = (m: Message) => (m.deleted ? "Deleted message" : m.ttl_secs ? "🔒 Secret message" : m.content);
  /** Group members whose "@Name" is in the text. */
  const mentionsIn = (text: string) => members.filter((m) => text.includes(`@${m.name}`)).map((m) => m.id);
  const mentionCandidates = mention
    ? members.filter((m) => m.name.toLowerCase().includes(mention.text.toLowerCase())).slice(0, 6)
    : [];
  const quickFilter = !quickClosed && !editing && /^\/[^\n]*$/.test(inputText) ? inputText.slice(1) : null;
  const quickShown = quickFilter === null ? [] : quickReplies.filter((r) => r.toLowerCase().includes(quickFilter.toLowerCase()));
  const run = async (f: () => Promise<Message | void>) => {
    try {
      const m = await f();
      if (m) onMessageChanged?.(m);
    } catch (err) {
      onError?.(errorText(err));
    }
  };
  const focusInput = () => window.setTimeout(() => textareaRef.current?.focus(), 0);

  const actions: MessageActions = {
    reply: (m) => {
      setEditing(null);
      setReplyTo(m);
      focusInput();
    },
    edit: (m) => {
      setReplyTo(null);
      setEditing(m);
      setInputText(m.content);
      focusInput();
    },
    react: (m, e) => void run(() => api.reactMessage(m.id, e)),
    pin: (m, p) => void run(() => api.pinMessage(m.id, p)),
    star: (m, s) => void run(() => api.starMessage(m.id, s)),
    remind: (m, at) => void run(() => (at ? api.setReminder(m.id, at) : api.cancelReminder(m.id))),
    deleteMe: (m) =>
      void run(async () => {
        await api.deleteMessageLocal(m.id);
        onMessageRemoved?.(m.id);
      }),
    deleteEveryone: (m) => void run(() => api.deleteMessageEveryone(m.id)),
    makeTask: (m) => setCreateCard({ kind: "task", title: m.content.slice(0, 200), fromMessage: m.id }),
    forward: onForward ? (m) => onForward([m]) : undefined,
    saveNote: onSaveNote,
    whatsapp: onShareWhatsApp,
    followUp: (m, at) => void run(() => api.setReminder(m.id, at, true)),
  };
  // LANX 1.6.0: names on cards, and who can be picked when making one.
  const nameOf = (id: string) => (id === myId ? "You" : members.find((m) => m.id === id)?.name ?? (isGroup ? peerName(id) : conversation.peer_name));
  const cardPeople: Person[] = isGroup
    ? members
    : conversation.peer_id
      ? [{ id: conversation.peer_id, name: conversation.peer_name, color: conversation.peer_avatar_color }]
      : [];

  const pickMention = (c: MentionCandidate) => {
    if (!mention) return;
    const ta = textareaRef.current;
    const caret = ta?.selectionStart ?? inputText.length;
    const next = `${inputText.slice(0, mention.start)}@${c.name} ${inputText.slice(caret)}`;
    caretRef.current = mention.start + c.name.length + 2;
    setInputText(next);
    setMention(null);
  };

  const pickQuick = (text: string) => {
    setInputText(text);
    setQuickClosed(true);
    focusInput();
  };

  const handleSend = async () => {
    const text = inputText;
    if (!text.trim()) return;
    const memeCmd = /^\/(meme|memes|gif|gifs)\b\s*(.*)$/i.exec(text.trim());
    if (memeCmd && onOpenMemes) {
      setInputText("");
      onOpenMemes(memeCmd[2].trim());
      return;
    }
    const musicCmd = /^\/(music|song|songs|play)\b\s*(.*)$/i.exec(text.trim());
    if (musicCmd && onOpenMusic) {
      setInputText("");
      onOpenMusic(musicCmd[2].trim());
      return;
    }
    const gameCmd = /^\/(game|games|arcade)\b\s*(.*)$/i.exec(text.trim());
    if (gameCmd && onOpenGames) {
      setInputText("");
      onOpenGames(gameCmd[2].trim());
      return;
    }
    if (editing) {
      try {
        const m = await api.editMessage(editing.id, text, mentionsIn(text));
        onMessageChanged?.(m);
        setEditing(null);
        setInputText("");
      } catch (err) {
        onError?.(errorText(err));
      }
      return;
    }
    setInputText("");
    setShowEmojiPicker(false);
    setMention(null);
    const reply = replyTo;
    setReplyTo(null);
    const ok = await onSendMessage(text, { replyTo: reply?.id ?? null, mentions: isGroup ? mentionsIn(text) : [] });
    if (!ok) {
      setInputText(text);
      setReplyTo(reply);
    }
    setQuickClosed(false);
    textareaRef.current?.focus();
  };

  const scheduleAt = async (at: number) => {
    const text = inputText;
    setSendLater(false);
    if (!text.trim()) return;
    try {
      await api.scheduleMessage(conversation.id, text, at, replyTo?.id ?? null, isGroup ? mentionsIn(text) : []);
      setInputText("");
      setReplyTo(null);
      loadScheduled();
    } catch (err) {
      onError?.(errorText(err));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionCandidates.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIdx((i) => (i + (e.key === "ArrowDown" ? 1 : mentionCandidates.length - 1)) % mentionCandidates.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickMention(mentionCandidates[Math.min(mentionIdx, mentionCandidates.length - 1)]);
        return;
      }
      if (e.key === "Escape") {
        setMention(null);
        return;
      }
    }
    if (quickShown.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setQuickIdx((i) => (i + (e.key === "ArrowDown" ? 1 : quickShown.length - 1)) % quickShown.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickQuick(quickShown[Math.min(quickIdx, quickShown.length - 1)]);
        return;
      }
    }
    if (e.key === "Escape") {
      if (quickFilter !== null) setQuickClosed(true);
      else if (editing) {
        setEditing(null);
        setInputText("");
      } else if (replyTo) setReplyTo(null);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (value: string, caret: number) => {
    setInputText(value);
    if (!value.startsWith("/")) setQuickClosed(false);
    setQuickIdx(0);
    if (value.trim()) onTyping();
    if (!isGroup) return;
    const before = value.slice(0, caret);
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(before);
    if (m) {
      setMention({ start: before.length - m[2].length - 1, text: m[2] });
      setMentionIdx(0);
    } else if (mention) setMention(null);
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

  const formatMessageTime = (ts: number) => TIME_FMT.format(ts * 1000);

  let lastReadId: string | undefined;
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (m.is_outgoing && m.status === "read" && m.message_type === "text") {
      lastReadId = m.id;
      break;
    }
  }

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
            onClick={() => live.current?.onRetryMessage(msg.id)}
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
              onClick={() => live.current?.onCall(!!v.video)}
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

  // LANX 3.11: the message list, drawn again only when what it shows changes — not for
  // every key typed, menu opened or second ticked (the main cause of lag in long chats).
  live.current = { actions, transferActions, onMessageChanged, onError, onMeeting, onRemoteHelp, onRejoinMeeting, onRetryMessage, onCall, jumpToMessage };
  const renderList = (): React.ReactNode => {
    if (loadingOther) return null;
    // (Handlers read when used, so a kept list never calls an old one.)
    const actions = delegate(() => live.current!.actions);
    const transferActions = delegate(() => live.current!.transferActions);
    const onMessageChanged = (m: Message) => live.current?.onMessageChanged?.(m);
    const onError = (text: string) => live.current?.onError?.(text);
    const onMeeting = (video: boolean) => live.current?.onMeeting?.(video);
    const onRemoteHelp = (help: "view" | "show") => live.current?.onRemoteHelp?.(help);
    const onRejoinMeeting = (id: string) => live.current?.onRejoinMeeting?.(id);
    const jumpToMessage = (id: string) => live.current?.jumpToMessage(id) ?? false;
    const byId = new Map(list.map((m) => [m.id, m] as const));
    const shown = firstShown > 0 ? list.slice(firstShown) : list;
    let lastDay = "";
    let lastSender = "";
    return (
      <>
        {firstShown > 0 && (
          <div className="flex justify-center py-1">
            <button
              type="button"
              data-show-earlier
              onClick={showEarlier}
              className="rounded-full lanx-chip px-3 py-1 text-[11px] font-medium text-slate-500 dark:text-slate-300 hover:text-sky-600"
            >
              Show earlier messages ({firstShown})
            </button>
          </div>
        )}
          {list.length === 0 ? (
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
            shown.map((msg) => {
              const isOut = msg.is_outgoing;
              const day = dayLabel(msg.timestamp);
              const showDay = day !== lastDay;
              lastDay = day;
              if (msg.message_type === "card" && !msg.deleted) {
                const out = msg.is_outgoing;
                const showName = isGroup && !out && (msg.sender_id !== lastSender || showDay);
                lastSender = out ? "" : msg.sender_id;
                return (
                  <React.Fragment key={msg.id}>
                    {showDay && <DaySeparator day={day} />}
                    <div data-msg={msg.id} className={`flex flex-col group rounded-xl ${enterClass(msg)} ${out ? "items-end" : "items-start"}`}>
                      {showName && <span className={`ml-3 mb-0.5 text-[11px] font-semibold ${nameColor(msg.sender_id)}`}>{peerName(msg.sender_id)}</span>}
                      <div className="relative">
                        <CardView
                          msg={msg}
                          myId={myId ?? ""}
                          nameOf={nameOf}
                          onChanged={(m) => onMessageChanged?.(m)}
                          onError={(t) => onError?.(t)}
                          onStartMeeting={() => onMeeting?.(true)}
                          onRemoteHelp={() => onRemoteHelp?.("view")}
                          onJump={(id) => jumpToMessage(id)}
                          canAct={!blocked && !outOfGroup}
                        />
                        <MessageTools msg={msg} isOut={out} actions={actions} canAct={!blocked && !outOfGroup} />
                      </div>
                      <div className={`mt-0.5 flex items-center gap-1.5 px-2 text-[10px] text-slate-400 ${out ? "justify-end" : ""}`}>
                        {msg.pinned_at && <Pin className="h-3 w-3 rotate-45" />}
                        {msg.starred && <Star className="h-3 w-3 fill-current" />}
                        {msg.remind_at && (
                          <span title={`Reminder: ${whenText(msg.remind_at)}`}>
                            <AlarmClock className="h-3 w-3" />
                          </span>
                        )}
                        <span>{formatMessageTime(msg.timestamp)}</span>
                        {out && <span className="inline-flex items-center">{statusIcon(msg)}</span>}
                      </div>
                      <ReactionChips reactions={msg.reactions ?? []} isOut={out} onToggle={blocked || outOfGroup ? undefined : (e) => actions.react(msg, e)} />
                    </div>
                  </React.Fragment>
                );
              }
              if (msg.message_type === "meeting" || msg.message_type === "recording") {
                lastSender = "";
                return (
                  <React.Fragment key={msg.id}>
                    {showDay && <DaySeparator day={day} />}
                    <div className="flex justify-center lanx-fade py-1">
                      {msg.message_type === "meeting" ? (
                        <MeetingCard msg={msg} myId={myId} onRejoin={(id) => onRejoinMeeting?.(id)} />
                      ) : (
                        <RecordingCard msg={msg} onError={(t) => onError?.(t)} />
                      )}
                    </div>
                  </React.Fragment>
                );
              }
              if (msg.message_type === "sticker" && !msg.deleted) {
                const out = msg.is_outgoing;
                const showName = isGroup && !out && (msg.sender_id !== lastSender || showDay);
                lastSender = out ? "" : msg.sender_id;
                return (
                  <React.Fragment key={msg.id}>
                    {showDay && <DaySeparator day={day} />}
                    <div data-msg={msg.id} className={`flex flex-col group rounded-xl ${enterClass(msg)} ${out ? "items-end" : "items-start"}`}>
                      {showName && <span className={`ml-3 mb-0.5 text-[11px] font-semibold ${nameColor(msg.sender_id)}`}>{peerName(msg.sender_id)}</span>}
                      <div className="relative">
                        <StickerBubble id={msg.content} isOut={out} />
                        <MessageTools msg={msg} isOut={out} actions={actions} canAct={!blocked && !outOfGroup} />
                      </div>
                      <div className={`mt-0.5 flex items-center gap-1.5 px-2 text-[10px] text-slate-400 ${out ? "justify-end" : ""}`}>
                        {msg.starred && <Star className="h-3 w-3 fill-current" />}
                        <span>{formatMessageTime(msg.timestamp)}</span>
                        {out && <span className="inline-flex items-center">{statusIcon(msg)}</span>}
                      </div>
                      <ReactionChips reactions={msg.reactions ?? []} isOut={out} onToggle={blocked || outOfGroup ? undefined : (e) => actions.react(msg, e)} />
                    </div>
                  </React.Fragment>
                );
              }
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
              // LANX 1.5.0
              const isVoice = isFile && (transfer?.kind === "voice" || (groupCopies?.[0]?.kind === "voice") || msg.content.startsWith("🎤 Voice note"));
              const voiceT = groupCopies?.[0] ?? transfer;
              const mentionsMe = !isOut && !!myId && !!msg.mentions?.includes(myId);
              const original = msg.reply_to ? byId.get(msg.reply_to) : undefined;
              const quote = msg.reply_to ? (original ? `${senderName(original)}: ${previewOf(original)}` : msg.reply_preview || "Original message") : null;
              const mentionNames = (msg.mentions ?? []).map((id) => (id === myId ? myName : members.find((m) => m.id === id)?.name ?? peerName(id)));
              if (msg.deleted) {
                return (
                  <React.Fragment key={msg.id}>
                    {showDay && <DaySeparator day={day} />}
                    <div data-msg={msg.id} className={`flex flex-col group rounded-xl ${isOut ? "items-end" : "items-start"}`}>
                      {showSender && <span className={`ml-3 mb-0.5 text-[11px] font-semibold ${nameColor(msg.sender_id)}`}>{peerName(msg.sender_id)}</span>}
                      <div data-deleted className="relative rounded-[18px] px-3.5 py-2 text-[12.5px] italic text-slate-400 dark:text-slate-500 border border-dashed border-slate-300 dark:border-slate-700 inline-flex items-center gap-1.5">
                        <Ban className="h-3.5 w-3.5" /> {isOut ? "You deleted this message" : "This message was deleted"}
                        <span className="not-italic text-[10px] ml-1">{formatMessageTime(msg.timestamp)}</span>
                        <button type="button" title="Remove from this computer" onClick={() => actions.deleteMe(msg)} className="opacity-0 group-hover:opacity-100 ml-1 text-slate-400 hover:text-red-500">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </React.Fragment>
                );
              }
              return (
                <React.Fragment key={msg.id}>
                  {showDay && <DaySeparator day={day} />}
                  <div data-msg={msg.id} className={`flex flex-col group rounded-xl ${enterClass(msg)} ${isOut ? "items-end" : "items-start"}`}>
                    {showSender && (
                      <span className={`ml-3 mb-0.5 text-[11px] font-semibold ${nameColor(msg.sender_id)}`}>{peerName(msg.sender_id)}</span>
                    )}
                    <div
                      data-bubble
                      data-mentions-me={mentionsMe ? "1" : undefined}
                      className={`relative max-w-lg rounded-[18px] px-3.5 py-2 text-[13px] ${mentionsMe ? "ring-2 ring-amber-400/70" : ""} ${
                        isSecret
                          ? isOut
                            ? "bg-violet-600 text-white rounded-br-[6px] shadow-sm"
                            : "bg-violet-50 dark:bg-violet-950/60 text-slate-900 dark:text-slate-100 border border-violet-200 dark:border-violet-900 rounded-bl-[6px]"
                          : isOut
                            ? "bg-sky-500 text-white rounded-br-[6px] shadow-sm shadow-sky-500/20"
                            : "lanx-bubble-in text-slate-900 dark:text-slate-100 rounded-bl-[6px]"
                      }`}
                    >
                      {quote && (
                        <button
                          type="button"
                          data-reply-quote
                          onClick={() => msg.reply_to && jumpToMessage(msg.reply_to)}
                          className={`mb-1.5 block w-full max-w-sm text-left rounded-lg border-l-[3px] px-2 py-1 text-[11.5px] ${
                            isOut ? "border-white/70 bg-white/15 text-white/90" : "border-sky-500 bg-sky-500/10 text-slate-600 dark:text-slate-300"
                          }`}
                        >
                          <span className="line-clamp-2 break-words">{quote}</span>
                        </button>
                      )}
                      {isVoice ? (
                        <VoiceNote
                          transferId={voiceT?.id ?? null}
                          durationMs={voiceMsFromLabel(msg.content)}
                          state={
                            !voiceT
                              ? "arriving"
                              : voiceT.direction === "outgoing" || voiceT.status === "completed"
                                ? "ready"
                                : ["failed", "cancelled", "declined"].includes(voiceT.status)
                                  ? "failed"
                                  : "arriving"
                          }
                          progress={voiceT ? (progress[voiceT.id] ? (progress[voiceT.id].transferred_bytes / Math.max(1, progress[voiceT.id].file_size)) * 100 : undefined) : undefined}
                          onAccent={isOut}
                        />
                      ) : groupCopies ? (
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
                        <p className={`whitespace-pre-wrap break-words leading-relaxed ${isSecret ? "select-none" : "select-text"}`}>
                          {isForwarded(msg.content) && (
                            <span data-forwarded className={`mb-0.5 flex items-center gap-1 text-[10.5px] italic ${isOut ? "text-white/75" : "text-slate-400"}`}>
                              <Forward className="h-3 w-3" /> Forwarded
                            </span>
                          )}
                          <MessageText text={withoutForwardMark(msg.content)} names={mentionNames} myName={myName} onAccent={isOut} />
                        </p>
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
                        {msg.pinned_at && <Pin className="h-3 w-3 rotate-45" aria-label="Pinned" />}
                        {msg.starred && <Star className="h-3 w-3 fill-current" aria-label="Starred" data-starred-mark />}
                        {msg.remind_at && (
                          <span className="inline-flex items-center gap-0.5" title={`Reminder: ${whenText(msg.remind_at)}`} data-reminder-mark>
                            <AlarmClock className="h-3 w-3" />
                          </span>
                        )}
                        {msg.edited_at && <span data-edited>edited</span>}
                        <span>{formatMessageTime(msg.timestamp)}</span>
                        {isOut && !isFile && <span className="inline-flex items-center">{statusIcon(msg)}</span>}
                      </div>
  
                      <MessageTools msg={msg} isOut={isOut} actions={actions} canAct={!blocked && !outOfGroup} />
                    </div>
                    <ReactionChips reactions={msg.reactions ?? []} isOut={isOut} onToggle={blocked || outOfGroup ? undefined : (e) => actions.react(msg, e)} />
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
      </>
    );
  };
  const listDeps: unknown[] = [conversation.id, conversation.peer_name, isGroup, blocked, outOfGroup, list, firstShown, transfers, transfersByParent, progress, peers, rawMembers, myId, myName, hasTimers ? nowSecs : 0, !!onForward, !!onSaveNote, !!onShareWhatsApp];
  const kept = listCache.current;
  const listBody = kept && kept.deps.length === listDeps.length && kept.deps.every((d, i) => Object.is(d, listDeps[i])) ? kept.node : renderList();
  listCache.current = { deps: listDeps, node: listBody };

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

              <div className="min-w-0 overflow-hidden">
                {/* Badges are cut off (not drawn over the buttons) when the header is narrow. */}
                <div className="flex items-center gap-2 overflow-hidden [&>span]:shrink-0 [&>button]:shrink-0">
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
                  {isMuted(conversation) && (
                    <button
                      type="button"
                      data-header-muted
                      onClick={onUnmute}
                      title={`${muteText(conversation)} — click to turn sounds back on`}
                      className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-slate-500/15 text-slate-600 dark:text-slate-300 text-[10px] font-semibold hover:bg-slate-500/25"
                    >
                      <BellOff className="h-3 w-3" /> Muted
                    </button>
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
              {isGroup && onMeeting && (
                <button
                  type="button"
                  data-start-meeting
                  onClick={() => onMeeting(true)}
                  disabled={outOfGroup}
                  title="Start a video meeting with everyone online in this group"
                  className={`${toolCls} hover:text-emerald-600 inline-flex items-center gap-1`}
                >
                  <Video className="h-[17px] w-[17px]" />
                  <span className="hidden lg:inline text-[12px] font-semibold">Meet</span>
                </button>
              )}
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
              {/* LANX 1.8.0: intercom and remote help */}
              {onIntercomSent && (
                <IntercomButton
                  conversationId={conversation.id}
                  name={isGroup ? "everyone online in the group" : conversation.peer_name.split(" ")[0]}
                  disabled={blocked || outOfGroup}
                  onError={(t) => onError?.(t)}
                  onSent={onIntercomSent}
                />
              )}
              {!isGroup && onRemoteHelp && (
                <div className="relative">
                  <button
                    type="button"
                    ref={helpBtnRef}
                    data-remote-help
                    onClick={() => setHelpMenu((v) => !v)}
                    disabled={blocked}
                    title="Remote help: see their screen, or show them yours"
                    className={`${toolCls} hover:text-sky-600 ${helpMenu ? "!bg-sky-500/15 !text-sky-600" : ""}`}
                  >
                    <LifeBuoy className="h-[17px] w-[17px]" />
                  </button>
                  {helpMenu && (
                    <FloatingMenu
                      anchor={helpBtnRef}
                      onClose={() => setHelpMenu(false)}
                      data-remote-help-menu
                      className="w-72 rounded-[14px] lanx-menu p-1.5 lanx-menu-in"
                    >
                      <div className="px-2.5 py-2 text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                        🛟 Remote help: a voice call where one of you shares the screen. {conversation.peer_name.split(" ")[0]} must agree, and chooses what to share.
                      </div>
                      <button
                        type="button"
                        data-help-view
                        onClick={() => {
                          setHelpMenu(false);
                          onRemoteHelp("view");
                        }}
                        className="w-full text-left px-2.5 py-2 rounded-lg text-[12.5px] text-slate-700 dark:text-slate-200 hover:bg-[var(--lanx-fill)]"
                      >
                        <b>Ask to see their screen</b>
                        <span className="block text-[11px] text-slate-400">To help them with a problem</span>
                      </button>
                      <button
                        type="button"
                        data-help-show
                        onClick={() => {
                          setHelpMenu(false);
                          onRemoteHelp("show");
                        }}
                        className="w-full text-left px-2.5 py-2 rounded-lg text-[12.5px] text-slate-700 dark:text-slate-200 hover:bg-[var(--lanx-fill)]"
                      >
                        <b>Show them my screen</b>
                        <span className="block text-[11px] text-slate-400">When you need help</span>
                      </button>
                    </FloatingMenu>
                  )}
                </div>
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
                    ref={secretBtnRef}
                    onClick={() => setSecretMenu(!secretMenu)}
                    disabled={blocked}
                    title="Secret messages (disappear after reading)"
                    className={`${toolCls} ${secret ? "!bg-violet-500/15 !text-violet-600 dark:!text-violet-300" : "hover:text-slate-900 dark:hover:text-white"}`}
                  >
                    <Timer className="h-[17px] w-[17px]" />
                  </button>
                  {secretMenu && (
                    <FloatingMenu
                      anchor={secretBtnRef}
                      onClose={() => setSecretMenu(false)}
                      data-secret-menu
                      className="w-60 rounded-[14px] lanx-menu p-1.5 lanx-menu-in"
                    >
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
                    </FloatingMenu>
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
          <PinnedBar
            pinned={list.filter((m) => m.pinned_at && !m.deleted).sort((a, b) => (b.pinned_at ?? 0) - (a.pinned_at ?? 0))}
            label={(m) => `${senderName(m)}: ${previewOf(m)}`}
            onJump={(m) => jumpToMessage(m.id)}
            onUnpin={(m) => actions.pin(m, false)}
          />
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
        ref={listRef}
        onScroll={(e) => {
          if (e.currentTarget.scrollTop < 400 && firstShown > 0) showEarlier();
        }}
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
        {listBody}
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
        {showStickers && !blocked && !outOfGroup && (
          <StickerPicker
            onPick={(id) => {
              setShowStickers(false);
              onSendSticker?.(id);
            }}
          />
        )}
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
              <ScheduledStrip
                items={scheduled}
                onCancel={(s) =>
                  void api
                    .cancelScheduled(s.id, conversation.id)
                    .then(loadScheduled)
                    .catch((err) => onError?.(errorText(err)))
                }
                onSendNow={(s) =>
                  void api
                    .cancelScheduled(s.id, conversation.id)
                    .then(() => onSendMessage(s.content, { replyTo: s.reply_to, mentions: s.mentions }))
                    .then(loadScheduled)
                    .catch((err) => onError?.(errorText(err)))
                }
              />
              {replyTo && <ReplyEditBar mode="reply" text={`${senderName(replyTo)}: ${previewOf(replyTo)}`} onCancel={() => setReplyTo(null)} />}
              {editing && (
                <ReplyEditBar
                  mode="edit"
                  text={editing.content}
                  onCancel={() => {
                    setEditing(null);
                    setInputText("");
                  }}
                />
              )}
              {mentionCandidates.length > 0 && <MentionPicker candidates={mentionCandidates} active={mentionIdx} profiles={profiles} onPick={pickMention} />}
              {quickFilter !== null && !mentionCandidates.length && (
                <QuickReplyPicker
                  replies={quickReplies}
                  filter={quickFilter}
                  active={quickIdx}
                  hint={
                    onOpenMusic && /^\/(mu|mus|musi|music|s|so|son|song|songs|p|pl|pla|play)(\s|$)/i.test(inputText)
                      ? "Press Enter to open music (add a song or singer to search)"
                      : onOpenGames && /^\/(ga|gam|game|games|a|ar|arc|arca|arcad|arcade)(\s|$)/i.test(inputText)
                        ? "Press Enter to open games (add one: chess, connect, reversi, tic…)"
                        : onOpenMemes && /^\/(m|me|mem|meme|memes|g|gi|gif|gifs)(\s|$)/i.test(inputText)
                        ? "Press Enter to open memes & GIFs (add a word to search)"
                        : undefined
                  }
                  onPick={pickQuick}
                  onSave={(l) => onSaveQuickReplies?.(l)}
                  onClose={() => setQuickClosed(true)}
                />
              )}
              <div className="relative flex items-end gap-1.5">
                <button
                  type="button"
                  data-plus-menu
                  onClick={() => setPlusMenu((v) => !v)}
                  title="Post a notice, poll, task, approval, checklist or meeting"
                  className={`lanx-tool p-2 text-slate-500 hover:text-emerald-600 dark:text-slate-400 ${plusMenu ? "!bg-[var(--lanx-fill)] !text-emerald-600" : ""}`}
                >
                  <Plus className="h-[18px] w-[18px]" />
                </button>
                {plusMenu && (
                  <div data-plus-options className="absolute bottom-full left-0 mb-2 w-64 rounded-2xl lanx-menu p-1.5 shadow-xl lanx-rise z-30">
                    {(
                      [
                        ["notice", Megaphone, "Notice", "text-amber-600"],
                        ["poll", BarChart3, "Poll", "text-violet-600"],
                        ["task", ClipboardCheck, "Task", "text-emerald-600"],
                        ["approval", FileSignature, "Approval", "text-sky-600"],
                        ["checklist", ListChecks, "Checklist", "text-teal-600"],
                        ["event", CalendarDays, "Schedule a meeting", "text-indigo-600"],
                      ] as [CardKind, React.ElementType, string, string][]
                    ).map(([k, I, label, tone]) => (
                      <button
                        key={k}
                        type="button"
                        data-plus-kind={k}
                        onClick={() => {
                          setPlusMenu(false);
                          setCreateCard({ kind: k });
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-[12.5px] rounded-lg hover:bg-[var(--lanx-fill)] text-slate-700 dark:text-slate-200"
                      >
                        <I className={`h-4 w-4 ${tone}`} /> {label}
                      </button>
                    ))}
                    {onShareFolder && (
                      <button
                        type="button"
                        data-plus-kind="sync"
                        onClick={() => {
                          setPlusMenu(false);
                          onShareFolder();
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-[12.5px] rounded-lg hover:bg-[var(--lanx-fill)] text-slate-700 dark:text-slate-200 border-t lanx-line mt-1 pt-2.5"
                      >
                        <FolderSync className="h-4 w-4 text-amber-600" />
                        <span className="flex-1 text-left">
                          Share a folder
                          <span className="block text-[10.5px] text-slate-400">Colleagues' copies stay up to date</span>
                        </span>
                      </button>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  data-sticker-button
                  onClick={() => {
                    setShowStickers(!showStickers);
                    setShowEmojiPicker(false);
                  }}
                  title="Stickers"
                  className={`lanx-tool p-2 text-slate-500 hover:text-pink-600 dark:text-slate-400 ${showStickers ? "!bg-[var(--lanx-fill)] !text-pink-600" : ""}`}
                >
                  <StickerIcon className="h-[18px] w-[18px]" />
                </button>
                {onScreenshot && (
                  <button
                    type="button"
                    data-screenshot-button
                    onClick={onScreenshot}
                    title="Take a screenshot and mark it up (Ctrl + Alt + S anywhere)"
                    className="lanx-tool p-2 text-slate-500 hover:text-sky-600 dark:text-slate-400"
                  >
                    <Scissors className="h-[18px] w-[18px]" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setShowEmojiPicker(!showEmojiPicker);
                    setShowStickers(false);
                  }}
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

                {recording ? (
                  <VoiceRecorder
                    key={conversation.id}
                    onCancel={() => setRecording(false)}
                    onError={(t) => onError?.(t)}
                    onSend={(data, ms, ext) => {
                      setRecording(false);
                      void onSendVoice?.(data, ms, ext);
                    }}
                  />
                ) : (
                <div
                  className={`relative flex-1 flex items-end gap-2 rounded-[20px] pl-4 pr-1 py-1 transition-shadow focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-sky-500)_30%,transparent)] ${
                    secret || hidden
                      ? "bg-violet-500/10 shadow-[inset_0_0_0_1px_rgb(139_92_246/0.35)]"
                      : "bg-[color-mix(in_srgb,var(--lanx-surface)_70%,transparent)] shadow-[inset_0_0_0_1px_var(--lanx-line)]"
                  }`}
                >
                  <textarea
                    ref={textareaRef}
                    rows={1}
                    value={inputText}
                    onChange={(e) => handleInput(e.target.value, e.target.selectionStart ?? e.target.value.length)}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    onBlur={() => window.setTimeout(() => setMention(null), 150)}
                    placeholder={
                      editing
                        ? "Edit your message…"
                        : secret
                          ? `Secret message to ${conversation.peer_name}…`
                          : `Message ${conversation.peer_name}…${isGroup ? " (@ to mention, / for quick replies)" : " (/ for quick replies)"}`
                    }
                    className="flex-1 bg-transparent text-[13px] text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus-visible:outline-none resize-none py-1.5 leading-relaxed select-text"
                  />

                  {inputText.trim() && !editing && !secret && (
                    <button
                      type="button"
                      data-send-later-btn
                      onClick={() => setSendLater((v) => !v)}
                      title="Send later…"
                      className={`mb-0.5 h-7 w-7 shrink-0 flex items-center justify-center rounded-full text-slate-500 hover:text-violet-600 hover:bg-[var(--lanx-fill)] ${sendLater ? "!text-violet-600 bg-violet-500/10" : ""}`}
                    >
                      <CalendarClock className="h-4 w-4" />
                    </button>
                  )}
                  {!inputText.trim() && !editing && onSendVoice ? (
                    <button
                      type="button"
                      data-voice-record
                      onClick={() => setRecording(true)}
                      title="Record a voice note"
                      className="mb-0.5 h-7 w-7 shrink-0 flex items-center justify-center rounded-full text-white bg-sky-500 hover:bg-sky-600 shadow-sm active:scale-90 transition-transform"
                    >
                      <Mic className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSend}
                      disabled={!inputText.trim()}
                      title={editing ? "Save the change (Enter)" : "Send (Enter)"}
                      className={`mb-0.5 h-7 w-7 shrink-0 flex items-center justify-center rounded-full text-white shadow-sm disabled:opacity-30 disabled:shadow-none transition-all duration-200 active:scale-90 ${
                        secret ? "bg-violet-600 hover:bg-violet-700" : "bg-sky-500 hover:bg-sky-600"
                      } ${inputText.trim() ? "scale-100" : "scale-90"}`}
                    >
                      {editing ? <Check className="h-4 w-4" strokeWidth={2.6} /> : <ArrowUp className="h-4 w-4" strokeWidth={2.6} />}
                    </button>
                  )}
                  {sendLater && <SendLaterMenu onPick={(at) => void scheduleAt(at)} onClose={() => setSendLater(false)} />}
                </div>
                )}
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-500 px-1">
                <span>
                  {editing
                    ? "Enter saves · Esc cancels"
                    : replyTo
                      ? "Enter sends your reply · Esc cancels"
                      : "Enter to send · Shift + Enter for a new line · drag files or folders in · Ctrl+V pastes a screenshot"}
                </span>
                <span>Works without internet</span>
              </div>
            </>
          )}
        </div>
      </div>

      {createCard && (
        <CreateCardModal
          initialKind={createCard.kind}
          initialTitle={createCard.title}
          fromMessage={createCard.fromMessage ?? null}
          people={cardPeople}
          profiles={profiles}
          chatName={conversation.peer_name}
          onClose={() => setCreateCard(null)}
          onCreate={async (card) => {
            try {
              const m = await api.sendCard(conversation.id, card);
              onMessageChanged?.(m);
              onCardPosted?.(m);
              return true;
            } catch (err) {
              onError?.(errorText(err));
              return false;
            }
          }}
        />
      )}

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
