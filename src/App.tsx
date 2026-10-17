import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  UserSettings,
  Peer,
  Conversation,
  Message,
  TransferRecord,
  TransferProgress,
  TransferActions,
  SentFile,
  NavTab,
  TrustState,
  LockStatus,
  UpdateStatus,
} from "./types";
import { api, events, errorText, isTauri } from "./lib/api";
import { applyAppearance } from "./lib/background";
import { lessMotion, originOf, revealChange, setMotion, usePresence } from "./lib/motion";
import { Sidebar } from "./components/Sidebar";
import { ConversationPanel } from "./components/ConversationPanel";
import { ContextPanel } from "./components/ContextPanel";
import { PeopleView } from "./components/PeopleView";
import { TransfersView } from "./components/TransfersView";
import { HistoryView } from "./components/HistoryView";
import { SettingsModal, SettingsTab } from "./components/SettingsModal";
import { OnboardingModal } from "./components/OnboardingModal";
import { LockScreen, PinDialog, NewPinDialog } from "./components/LockScreen";
import { NewGroupModal } from "./components/NewGroupModal";
import { BroadcastModal } from "./components/BroadcastModal";
import { WelcomeTour } from "./components/WelcomeTour";
import { UpdateBanner } from "./components/UpdateBanner";
import { DynamicIsland, IslandMessage, IslandRing } from "./components/DynamicIsland";
import type { IslandCall } from "./components/CallLayer";
import { CallLayer, CallLayerHandle } from "./components/CallLayer";
import { AlertCircle, X } from "lucide-react";

// v2: shown once more after the 1.2 update, which added calls, backups and the new hidden chats.
const TOUR_KEY = "lanx.tourSeen.v2";

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string) {
  try {
    localStorage.setItem(key, "1");
  } catch {
    /* private mode etc. — the tour may show again, which is harmless */
  }
}

/** Insert or replace a message, keeping chronological order. */
function upsertMessage(list: Message[], msg: Message): Message[] {
  const idx = list.findIndex((m) => m.id === msg.id);
  if (idx >= 0) {
    const next = [...list];
    next[idx] = msg;
    return next;
  }
  return [...list, msg].sort((a, b) => a.timestamp - b.timestamp);
}

function upsertTransfer(list: TransferRecord[], t: TransferRecord): TransferRecord[] {
  const idx = list.findIndex((x) => x.id === t.id);
  if (idx >= 0) {
    const next = [...list];
    next[idx] = { ...t, peer_name: t.peer_name ?? list[idx].peer_name };
    return next;
  }
  return [t, ...list];
}

export default function App() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [lock, setLock] = useState<LockStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [transfers, setTransfers] = useState<TransferRecord[]>([]);
  const [progress, setProgress] = useState<Record<string, TransferProgress>>({});
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [typing, setTyping] = useState<Record<string, { name: string; until: number }>>({});
  const [ringPulse, setRingPulse] = useState(0);

  const [activeTab, setActiveTab] = useState<NavTab>("messages");
  const [searchQuery, setSearchQuery] = useState("");
  const [isContextOpen, setIsContextOpen] = useState(true);
  const [unlocking, setUnlocking] = useState(false);
  /** An unlock is in progress here: its zoom-out plays before the app shows. */
  const unlockingRef = useRef(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [showHiddenPrompt, setShowHiddenPrompt] = useState(false);
  /** Hiding a chat before any PIN exists: choose one first. */
  const [pinSetupFor, setPinSetupFor] = useState<string | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [installingUpdate, setInstallingUpdate] = useState(false);

  const locked = !!lock?.locked;
  const callRef = useRef<CallLayerHandle>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  const activeTabRef = useRef<NavTab>("messages");
  const lockedRef = useRef(false);
  /** New message from another chat, shown in the Dynamic Island. */
  const [islandMsg, setIslandMsg] = useState<IslandMessage | null>(null);
  /** Rings and calls in the Dynamic Island (LANX 1.2.8). */
  const [islandRing, setIslandRing] = useState<IslandRing | null>(null);
  const [islandCall, setIslandCall] = useState<IslandCall | null>(null);
  const conversationsRef = useRef<Conversation[]>([]);
  conversationsRef.current = conversations;
  const peersRef = useRef<Peer[]>([]);
  peersRef.current = peers;
  const hiddenUnlockedRef = useRef(false);
  hiddenUnlockedRef.current = !!lock?.hidden_unlocked;
  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);
  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 12000);
    return () => clearTimeout(t);
  }, [notice]);

  const showError = useCallback((err: unknown) => {
    const text = errorText(err);
    if (text === "LOCKED") return; // the lock screen is already showing
    setNotice(text === "HIDDEN" ? "That chat is hidden. Open “Hidden chats” at the top of your chat list and enter your PIN." : text);
  }, []);

  const applyTheme = useCallback((theme: "system" | "dark" | "light") => {
    const root = document.documentElement;
    const dark =
      theme === "dark" ||
      (theme === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
    root.classList.toggle("dark", !!dark);
  }, []);

  /** Wipes chat data from memory when LANX locks. */
  const clearPrivateState = useCallback(() => {
    setConversations([]);
    setMessages([]);
    setTransfers([]);
    setProgress({});
    setTyping({});
  }, []);

  const loadUpdateStatus = useCallback(() => {
    if (lockedRef.current) return;
    api.getUpdateStatus().then(setUpdateStatus).catch(() => {});
  }, []);

  const reloadAll = useCallback(async () => {
    if (lockedRef.current) return [];
    loadUpdateStatus();
    const [p, c, t] = await Promise.all([api.listPeers(), api.getConversations(), api.listTransfers()]);
    setPeers(p);
    setConversations(c);
    setTransfers(t);
    const active = activeConversationIdRef.current;
    if (active && !c.some((x) => x.id === active)) {
      setActiveConversationId(c.length > 0 ? c[0].id : null);
    } else if (active) {
      api.getMessages(active).then(setMessages).catch(() => {});
    }
    return c;
  }, [loadUpdateStatus]);

  const loadAfterUnlock = useCallback(async () => {
    try {
      const s = await api.getSettings();
      setSettings(s);
      const c = await reloadAll();
      if (c.length > 0 && !activeConversationIdRef.current) setActiveConversationId(c[0].id);
    } catch (err) {
      showError(err);
    }
  }, [reloadAll, showError]);

  // Initial load
  useEffect(() => {
    (async () => {
      try {
        const [s, l] = await Promise.all([api.getSettings(), api.getLockStatus()]);
        setSettings(s);
        setLock(l);
        lockedRef.current = l.locked;
        applyTheme(s.theme);
        if (!s.onboarding_completed) setShowOnboarding(true);
        else if (!readFlag(TOUR_KEY)) setShowTour(true);
        if (!l.locked) {
          const c = await reloadAll();
          if (c.length > 0 && !activeConversationIdRef.current) setActiveConversationId(c[0].id);
        }
        const restored = await api.takeRestoreNotice().catch(() => null);
        if (restored) setNotice(restored.text);
      } catch (err) {
        console.error("Initialization error:", err);
        setLoadError(errorText(err));
      }
    })();
  }, [applyTheme, reloadAll]);

  useEffect(() => {
    applyAppearance({
      chat_background: settings?.chat_background ?? "default",
      accent_color: settings?.accent_color ?? "default",
      glass_level: settings?.glass_level ?? 55,
      frost_level: settings?.frost_level ?? 60,
    });
  }, [settings?.chat_background, settings?.accent_color, settings?.glass_level, settings?.frost_level]);

  useEffect(() => {
    setMotion(!!settings?.reduce_motion);
  }, [settings?.reduce_motion]);

  useEffect(() => {
    if (!settings || settings.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [settings, applyTheme]);

  // Load messages for the open chat and mark it read.
  useEffect(() => {
    if (!activeConversationId || locked) {
      setMessages([]);
      return;
    }
    let alive = true;
    api
      .markConversationRead(activeConversationId)
      .then((m) => alive && setMessages(m))
      .catch(() => {
        if (alive) {
          api.getMessages(activeConversationId).then((m) => alive && setMessages(m)).catch(showError);
        }
      });
    setConversations((prev) => prev.map((c) => (c.id === activeConversationId ? { ...c, unread_count: 0 } : c)));
    return () => {
      alive = false;
    };
  }, [activeConversationId, locked, showError]);

  // Auto-lock after inactivity (needs a PIN).
  useEffect(() => {
    if (!settings?.pin_enabled || !settings.auto_lock_minutes || locked) return;
    let last = Date.now();
    const touch = () => (last = Date.now());
    const evs = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"];
    evs.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const timer = setInterval(() => {
      if (Date.now() - last > settings.auto_lock_minutes * 60_000) {
        api.lockApp().then(setLock).catch(() => {});
      }
    }, 15_000);
    return () => {
      evs.forEach((e) => window.removeEventListener(e, touch));
      clearInterval(timer);
    };
  }, [settings?.pin_enabled, settings?.auto_lock_minutes, locked]);

  // Expire "typing…" labels.
  useEffect(() => {
    if (Object.keys(typing).length === 0) return;
    const t = setInterval(() => {
      const now = Date.now();
      setTyping((prev) => {
        const next = Object.fromEntries(Object.entries(prev).filter(([, v]) => v.until > now));
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [typing]);

  // Live updates from the LANX engine.
  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    let disposed = false;
    const add = (p: Promise<() => void>) =>
      p.then((u) => (disposed ? u() : unlisteners.push(u))).catch(console.error);

    add(
      events.onOpenConversation(({ conversation_id }) => {
        if (lockedRef.current) return;
        setActiveConversationId(conversation_id);
        setActiveTab("messages");
      })
    );

    add(
      events.onLockChanged((s) => {
        // Unlocked from the lock screen: the lock screen shows the app itself
        // once its zoom-out animation has played.
        if (!s.locked && unlockingRef.current) return;
        setLock(s);
        lockedRef.current = s.locked;
        if (s.locked) clearPrivateState();
      })
    );

    add(
      events.onPeerDiscovered((discovered) => {
        setPeers((prev) => {
          const idx = prev.findIndex((p) => p.id === discovered.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = discovered;
            return next;
          }
          return [discovered, ...prev];
        });
        setConversations((prev) =>
          prev.map((c) =>
            c.kind === "direct" && c.peer_id === discovered.id
              ? {
                  ...c,
                  peer_status: discovered.status,
                  peer_name: discovered.display_name,
                  peer_avatar_color: discovered.avatar_color,
                  peer_ip: discovered.last_ip,
                }
              : c
          )
        );
      })
    );

    add(
      events.onPeerOffline(({ peer_id }) => {
        setPeers((prev) => prev.map((p) => (p.id === peer_id ? { ...p, status: "offline" } : p)));
        setConversations((prev) =>
          prev.map((c) => (c.kind === "direct" && c.peer_id === peer_id ? { ...c, peer_status: "offline" } : c))
        );
      })
    );

    add(
      events.onMessageReceived(({ message, conversation }) => {
        if (lockedRef.current) return;
        const isActive = activeConversationIdRef.current === message.conversation_id;
        const viewing = isActive && activeTabRef.current === "messages" && document.visibilityState === "visible";
        if (isActive) setMessages((prev) => upsertMessage(prev, message));
        if (!message.is_outgoing) {
          setTyping((prev) => {
            if (!(message.conversation_id in prev)) return prev;
            const next = { ...prev };
            delete next[message.conversation_id];
            return next;
          });
        }
        if (viewing) {
          api
            .markConversationRead(message.conversation_id)
            .then((m) => {
              if (activeConversationIdRef.current === message.conversation_id) setMessages(m);
            })
            .catch(() => {});
        } else if (!message.is_outgoing && document.hasFocus() && ["text", "file"].includes(message.message_type)) {
          // LANX is in front but this chat isn't open: a soft sound, and the
          // message (with the cat) in the Dynamic Island. Hidden chats stay
          // out of sight unless they are shown.
          api.playSound().catch(() => {});
          // (Files have their own island card: Accept / progress / done.)
          if (message.message_type === "text" && conversation && (!conversation.is_hidden || hiddenUnlockedRef.current)) {
            const group = conversation.kind === "group";
            const sender = group ? peersRef.current.find((p) => p.id === message.sender_id) : null;
            setIslandMsg({
              id: message.id,
              conversationId: message.conversation_id,
              from: group ? sender?.display_name ?? "Someone" : conversation.peer_name,
              color: group ? sender?.avatar_color ?? conversation.peer_avatar_color : conversation.peer_avatar_color,
              text: message.ttl_secs ? "🔒 Secret message" : message.content,
              group: group ? conversation.peer_name : null,
            });
          }
        }

        setConversations((prev) => {
          const existing = prev.find((c) => c.id === message.conversation_id);
          const base = conversation ?? existing;
          if (!base) return prev;
          if (base.is_hidden && !existing) return prev; // hidden and not shown
          const updated: Conversation = {
            ...base,
            last_message_preview: conversation?.last_message_preview ?? existing?.last_message_preview ?? message.content,
            last_message_time: message.timestamp,
            unread_count: viewing ? 0 : conversation?.unread_count ?? (existing?.unread_count ?? 0) + 1,
          };
          return [updated, ...prev.filter((c) => c.id !== updated.id)];
        });
        if (!activeConversationIdRef.current) setActiveConversationId(message.conversation_id);
      })
    );

    add(
      events.onMessageStatusUpdated(({ message }) => {
        if (message.conversation_id === activeConversationIdRef.current) {
          setMessages((prev) => upsertMessage(prev, message));
        }
      })
    );

    add(
      events.onMessagesDeleted(({ message_ids }) => {
        const gone = new Set(message_ids);
        setMessages((prev) => (prev.some((m) => gone.has(m.id)) ? prev.filter((m) => !gone.has(m.id)) : prev));
      })
    );

    add(
      events.onTyping(({ conversation_id, display_name }) => {
        setTyping((prev) => ({ ...prev, [conversation_id]: { name: display_name, until: Date.now() + 4500 } }));
      })
    );

    add(
      events.onRing(({ conversation_id, peer_name }) => {
        if (conversation_id === activeConversationIdRef.current) setRingPulse((n) => n + 1);
        if (lockedRef.current) return;
        // The cat rings a bell in the Dynamic Island (hidden chats stay out of sight).
        const conv = conversationsRef.current.find((c) => c.id === conversation_id);
        if (conv?.is_hidden && !hiddenUnlockedRef.current) return;
        setIslandRing({
          id: `ring-${Date.now()}`,
          name: peer_name || conv?.peer_name || "Someone",
          color: conv?.peer_avatar_color ?? "#f59e0b",
          conversationId: conversation_id,
        });
      })
    );

    add(
      events.onTransferUpdated((t) => {
        setTransfers((prev) => upsertTransfer(prev, t));
        if (t.status !== "transferring") {
          setProgress((prev) => {
            if (!(t.id in prev)) return prev;
            const next = { ...prev };
            delete next[t.id];
            return next;
          });
        }
      })
    );

    add(
      events.onTransferProgress(({ transfer_id, transferred_bytes, file_size, bytes_per_sec }) => {
        setProgress((prev) => ({ ...prev, [transfer_id]: { transferred_bytes, file_size, bytes_per_sec } }));
      })
    );

    add(events.onStateChanged(() => reloadAll().catch(() => {})));
    add(events.onOpenPrivacySettings(() => setSettingsTab("privacy")));
    add(events.onUpdateChanged(loadUpdateStatus));
    add(
      events.onUpdateProblem(({ message }) => {
        setNotice(message);
        loadUpdateStatus();
      })
    );

    return () => {
      disposed = true;
      unlisteners.forEach((fn) => fn());
    };
  }, [reloadAll, clearPrivateState, loadUpdateStatus]);

  // "Remind me tomorrow" ran out: show the banner again.
  const snoozedUntil = updateStatus?.snoozed_until ?? 0;
  useEffect(() => {
    if (!snoozedUntil) return;
    const ms = snoozedUntil * 1000 - Date.now();
    const t = setTimeout(loadUpdateStatus, Math.max(1000, Math.min(ms + 1000, 2 ** 31 - 1)));
    return () => clearTimeout(t);
  }, [snoozedUntil, loadUpdateStatus]);

  const handleInstallUpdate = useCallback(async () => {
    setInstallingUpdate(true);
    try {
      const result = await api.installUpdate();
      if (result === "dry_run") {
        setNotice("Test copy (LANX_INSTALL_DRY_RUN): the installer passed every check but was not started.");
      }
    } catch (err) {
      showError(err);
    } finally {
      setInstallingUpdate(false);
      loadUpdateStatus();
    }
  }, [showError, loadUpdateStatus]);

  const addSentFiles = useCallback((sent: SentFile[]) => {
    if (sent.length === 0) return;
    setTransfers((prev) => sent.reduce((acc, s) => s.transfers.reduce(upsertTransfer, acc), prev));
    const active = activeConversationIdRef.current;
    setMessages((prev) =>
      sent.reduce(
        (acc, s) =>
          s.message.conversation_id === active && !acc.some((m) => m.id === s.message.id)
            ? upsertMessage(acc, s.message)
            : acc,
        prev
      )
    );
    const last = sent[sent.length - 1].message;
    setConversations((prev) =>
      prev.map((c) =>
        c.id === last.conversation_id ? { ...c, last_message_preview: last.content, last_message_time: last.timestamp } : c
      )
    );
  }, []);

  /** Sends files and folders; big folders take a moment to pack, so say so. */
  const sendPaths = useCallback(
    async (conv: string, paths: string[]) => {
      const packing = "Packing the folder… big folders take a moment.";
      const timer = window.setTimeout(() => setNotice(packing), 700);
      try {
        addSentFiles(await api.sendFiles(conv, paths));
        setNotice((n) => (n === packing ? null : n));
      } catch (err) {
        showError(err);
      } finally {
        window.clearTimeout(timer);
      }
    },
    [addSentFiles, showError]
  );

  const sendDroppedFiles = useCallback(
    async (paths: string[]) => {
      const conv = activeConversationIdRef.current;
      if (!conv || activeTabRef.current !== "messages") {
        setNotice("Open a chat first, then drop the files into it.");
        return;
      }
      await sendPaths(conv, paths);
    },
    [sendPaths]
  );

  // Drag files from Explorer into the window.
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent((event) => {
          if (lockedRef.current) return;
          const p = event.payload;
          if (p.type === "enter" || p.type === "over") setIsDraggingFiles(true);
          else if (p.type === "leave") setIsDraggingFiles(false);
          else if (p.type === "drop") {
            setIsDraggingFiles(false);
            if (p.paths.length > 0) sendDroppedFiles(p.paths);
          }
        })
      )
      .then((u) => (disposed ? u() : (unlisten = u)))
      .catch(console.error);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [sendDroppedFiles]);

  const availableUpdate = updateStatus?.available ?? null;
  const peerVersions = useMemo(() => {
    const map: Record<string, { version?: string | null; behind: boolean }> = {};
    for (const c of updateStatus?.colleagues ?? []) map[c.peer_id] = { version: c.app_version, behind: c.behind };
    return map;
  }, [updateStatus]);
  const activeConversation = conversations.find((c) => c.id === activeConversationId) || null;
  const activePeer =
    activeConversation && activeConversation.kind === "direct"
      ? peers.find((p) => p.id === activeConversation.peer_id) || null
      : null;

  // Block screenshots of LANX while a secret chat is open.
  const protect = !locked && activeTab === "messages" && !!activeConversation && (activeConversation.secret_ttl > 0 || messages.some((m) => !!m.ttl_secs));
  useEffect(() => {
    api.setContentProtection(protect).catch(() => {});
  }, [protect]);

  const lastTypingSent = useRef(0);
  const handleTyping = () => {
    const conv = activeConversationIdRef.current;
    if (!conv || Date.now() - lastTypingSent.current < 2500) return;
    lastTypingSent.current = Date.now();
    api.sendTyping(conv).catch(() => {});
  };

  const handleSendMessage = async (content: string): Promise<boolean> => {
    const conv = activeConversationId;
    if (!conv) return false;
    try {
      const newMsg = await api.sendMessage(conv, content);
      setMessages((prev) => (prev.some((m) => m.id === newMsg.id) ? prev : upsertMessage(prev, newMsg)));
      setConversations((prev) => {
        const c = prev.find((x) => x.id === conv);
        if (!c) return prev;
        return [
          { ...c, last_message_preview: newMsg.ttl_secs ? "🔒 Secret message" : newMsg.content, last_message_time: newMsg.timestamp },
          ...prev.filter((x) => x.id !== conv),
        ];
      });
      return true;
    } catch (err) {
      showError(err);
      return false;
    }
  };

  const handleRetryMessage = async (messageId: string) => {
    try {
      const updated = await api.retryMessage(messageId);
      setMessages((prev) => upsertMessage(prev, updated));
    } catch (err) {
      showError(err);
    }
  };

  const handlePickFiles = async () => {
    if (!activeConversationId) return;
    try {
      addSentFiles(await api.pickAndSendFiles(activeConversationId));
    } catch (err) {
      showError(err);
    }
  };

  const handlePickFolder = async () => {
    const conv = activeConversationId;
    if (!conv) return;
    try {
      const dir = await api.pickFolderToSend();
      if (dir) await sendPaths(conv, [dir]);
    } catch (err) {
      showError(err);
    }
  };

  const handlePasteImage = async (dataUrl: string, mime: string) => {
    if (!activeConversationId) return;
    try {
      addSentFiles(await api.sendPastedImage(activeConversationId, dataUrl, mime));
    } catch (err) {
      showError(err);
    }
  };

  const handleRing = async () => {
    if (!activeConversationId) return;
    try {
      await api.ring(activeConversationId);
      const conv = conversations.find((c) => c.id === activeConversationId);
      if (conv) {
        setIslandRing({
          id: `ring-out-${Date.now()}`,
          name: conv.peer_name,
          color: conv.peer_avatar_color,
          conversationId: conv.id,
          outgoing: true,
        });
      }
    } catch (err) {
      showError(err);
    }
  };

  const handleSetSecret = async (ttl: number) => {
    if (!activeConversationId) return;
    try {
      const m = await api.setSecretMode(activeConversationId, ttl);
      setMessages((prev) => upsertMessage(prev, m));
      setConversations((prev) => prev.map((c) => (c.id === activeConversationId ? { ...c, secret_ttl: ttl } : c)));
    } catch (err) {
      showError(err);
    }
  };

  const hideOrUnhide = async (id: string, hidden: boolean, hiddenVisible: boolean) => {
    await api.setConversationHidden(id, hidden);
    const c = await reloadAll();
    if (hidden && !hiddenVisible) {
      const next = c.find((x) => !x.is_hidden);
      setActiveConversationId(next ? next.id : null);
      setNotice("Chat hidden 🔒  To open it again: “Hidden chats” at the top of your chat list → your PIN.");
    } else if (hidden) {
      setNotice("Chat moved to Hidden chats. It disappears when you press “Hide again” or LANX locks.");
    } else {
      setNotice("Chat is back in your normal chat list.");
    }
  };

  const handleSetHidden = async (hidden: boolean) => {
    const id = activeConversationId;
    if (!id) return;
    if (hidden && !settings?.pin_enabled) {
      setPinSetupFor(id); // choose a PIN first, then hide
      return;
    }
    try {
      await hideOrUnhide(id, hidden, !!lock?.hidden_unlocked);
    } catch (err) {
      showError(err);
    }
  };

  const handleToggleHidden = async () => {
    if (lock?.hidden_unlocked) {
      try {
        setLock(await api.hideHiddenChats());
        await reloadAll();
      } catch (err) {
        showError(err);
      }
    } else {
      setShowHiddenPrompt(true);
    }
  };

  const handleDeleteConversation = async () => {
    if (!activeConversationId) return;
    try {
      await api.deleteConversation(activeConversationId);
      const remaining = conversations.filter((c) => c.id !== activeConversationId);
      setConversations(remaining);
      setActiveConversationId(remaining.length > 0 ? remaining[0].id : null);
    } catch (err) {
      showError(err);
    }
  };

  const handleAddManualPeer = async (ip: string, port: number, name?: string) => {
    const peer = await api.addManualPeer(ip, port, name); // errors are shown in the dialog
    setPeers((prev) => [peer, ...prev.filter((p) => p.id !== peer.id)]);
    const conv = await api.getOrCreateConversation(peer.id);
    setConversations((prev) => [conv, ...prev.filter((c) => c.id !== conv.id)]);
    setActiveConversationId(conv.id);
    setActiveTab("messages");
    if (peer.status !== "online") {
      setNotice(
        `${peer.display_name} did not answer right now. It's saved — messages you send will be delivered when LANX is running on that computer.`
      );
    }
  };

  const handleStartChatFromPeer = async (peerId: string) => {
    try {
      const conv = await api.getOrCreateConversation(peerId);
      setConversations((prev) => (prev.some((c) => c.id === conv.id) ? prev : [conv, ...prev]));
      setActiveConversationId(conv.id);
      setActiveTab("messages");
    } catch (err) {
      showError(err);
    }
  };

  const handleUpdateTrust = async (peerId: string, trustState: TrustState) => {
    try {
      await api.updatePeerTrust(peerId, trustState);
      setPeers((prev) => prev.map((p) => (p.id === peerId ? { ...p, trust_state: trustState } : p)));
    } catch (err) {
      showError(err);
    }
  };

  const handleToggleTheme = (e?: React.MouseEvent) => {
    if (!settings) return;
    const nextTheme: UserSettings["theme"] =
      settings.theme === "system" ? "dark" : settings.theme === "dark" ? "light" : "system";
    const updated = { ...settings, theme: nextTheme };
    setSettings(updated);
    // The new theme grows from the button (glass reveal).
    revealChange(() => applyTheme(nextTheme), originOf(e));
    api.saveSettings(updated).catch(console.error);
  };

  const transferActions: TransferActions = useMemo(
    () => ({
      accept: (id) => api.acceptTransfer(id).then((t) => setTransfers((prev) => upsertTransfer(prev, t))).catch(showError),
      cancel: (id) => api.cancelTransfer(id).then((t) => setTransfers((prev) => upsertTransfer(prev, t))).catch(showError),
      retry: (id) => api.retryTransfer(id).then((t) => setTransfers((prev) => upsertTransfer(prev, t))).catch(showError),
      open: (id) => api.openTransferFile(id).catch(showError),
      reveal: (id) => api.revealTransferFile(id).catch(showError),
    }),
    [showError]
  );

  const transfersById = useMemo(() => {
    const map: Record<string, TransferRecord> = {};
    for (const t of transfers) map[t.id] = t;
    return map;
  }, [transfers]);

  const transfersByParent = useMemo(() => {
    const map: Record<string, TransferRecord[]> = {};
    for (const t of transfers) {
      if (t.parent_id) (map[t.parent_id] ??= []).push(t);
    }
    return map;
  }, [transfers]);

  // The details panel slides out before it goes away.
  const contextPresence = usePresence(activeTab === "messages" && isContextOpen && !!activeConversation, 220);

  if (!settings || !lock) {
    return (
      <div className="h-screen w-screen flex items-center justify-center lanx-window text-slate-400">
        <div className="flex flex-col items-center gap-3 max-w-md text-center px-6">
          {loadError ? (
            <>
              <AlertCircle className="h-8 w-8 text-red-500" />
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">LANX could not start</span>
              <span className="text-xs">{loadError}</span>
            </>
          ) : (
            <>
              <img src="/lanx-logo.png" alt="" className="h-14 w-14 rounded-2xl shadow-lg tour-bounce" />
              <span className="text-xs font-medium tracking-wide">Starting LANX…</span>
            </>
          )}
        </div>
      </div>
    );
  }

  // Always the first child of the same fragment, so a call survives LANX
  // locking or unlocking in the middle of it.
  const callLayer = (
    <CallLayer
      key="call-layer"
      ref={callRef}
      onError={(text) => setNotice(text)}
      onIslandChange={setIslandCall}
      onOpenChat={(id) => {
        if (lockedRef.current) return;
        setActiveConversationId(id);
        setActiveTab("messages");
      }}
    />
  );

  if (locked) {
    return (
      <>
        {callLayer}
        <LockScreen
          displayName={settings.display_name}
          avatarColor={settings.avatar_color}
          leaving={unlocking}
          onUnlock={async (pin) => {
            unlockingRef.current = true;
            let s: LockStatus;
            try {
              s = await api.unlock(pin);
              // Right PIN: the lock card zooms away, then the app settles in.
              if (!lessMotion()) {
                setUnlocking(true);
                await new Promise((r) => setTimeout(r, 340));
              }
            } finally {
              unlockingRef.current = false;
              setUnlocking(false);
            }
            setLock(s);
            lockedRef.current = false;
            await loadAfterUnlock();
          }}
        />
      </>
    );
  }

  return (
    <>
    {callLayer}
    <div className="h-screen w-screen flex overflow-hidden lanx-window">
      <Sidebar
        settings={settings}
        conversations={conversations}
        peers={peers}
        activeConversationId={activeConversationId}
        activeTab={activeTab}
        searchQuery={searchQuery}
        pendingFiles={transfers.filter((t) => t.direction === "incoming" && t.status === "pending").length}
        hiddenUnlocked={lock.hidden_unlocked}
        onSelectConversation={(id) => {
          setActiveConversationId(id);
          setActiveTab("messages");
        }}
        onSelectTab={setActiveTab}
        onSearchChange={setSearchQuery}
        onOpenSettings={() => setSettingsTab("profile")}
        onToggleTheme={handleToggleTheme}
        onNewChat={() => setActiveTab("people")}
        onNewGroup={() => setShowNewGroup(true)}
        onBroadcast={() => setShowBroadcast(true)}
        onLock={() => api.lockApp().then(setLock).catch(showError)}
        onToggleHidden={handleToggleHidden}
      />

      <main className="flex-1 h-full flex flex-col min-w-0 overflow-hidden relative lanx-launch" style={{ ["--d" as string]: "70ms" }}>
        {availableUpdate &&
          (availableUpdate.state === "downloading" ||
            availableUpdate.state === "installing" ||
            !updateStatus?.snoozed_until ||
            updateStatus.snoozed_until * 1000 <= Date.now()) && (
            <UpdateBanner
              update={availableUpdate}
              progress={availableUpdate.transfer_id ? progress[availableUpdate.transfer_id] : undefined}
              busy={installingUpdate}
              onInstall={handleInstallUpdate}
              onLater={() => api.snoozeUpdate().then(loadUpdateStatus).catch(showError)}
            />
          )}

        {activeTab === "messages" && (
          <ConversationPanel
            conversation={activeConversation}
            peer={activePeer}
            peers={peers}
            messages={messages}
            transfers={transfersById}
            transfersByParent={transfersByParent}
            progress={progress}
            transferActions={transferActions}
            isContextOpen={isContextOpen}
            isDraggingFiles={isDraggingFiles}
            notice={notice}
            typingName={activeConversationId ? typing[activeConversationId]?.name ?? null : null}
            ringPulse={ringPulse}
            onDismissNotice={() => setNotice(null)}
            onToggleContext={() => setIsContextOpen(!isContextOpen)}
            onSendMessage={handleSendMessage}
            onRetryMessage={handleRetryMessage}
            onDeleteConversation={handleDeleteConversation}
            onPickFiles={handlePickFiles}
            onPickFolder={handlePickFolder}
            onPasteImage={handlePasteImage}
            onTyping={handleTyping}
            onRing={handleRing}
            onSetSecret={handleSetSecret}
            onSetHidden={handleSetHidden}
            onCall={(video) => activeConversation && callRef.current?.start(activeConversation, video)}
            onUnblock={() => activePeer && handleUpdateTrust(activePeer.id, "unverified")}
          />
        )}

        {activeTab === "people" && (
          <PeopleView
            peers={peers}
            versions={peerVersions}
            latestVersion={updateStatus?.latest_version ?? null}
            searchQuery={searchQuery}
            onStartChat={handleStartChatFromPeer}
            onAddManualPeer={handleAddManualPeer}
            onUpdateTrust={handleUpdateTrust}
          />
        )}

        {activeTab === "transfers" && (
          <TransfersView
            transfers={transfers}
            progress={progress}
            actions={transferActions}
            onOpenDownloads={() => api.openDownloadFolder().catch(showError)}
            onClearFinished={() =>
              api
                .clearFinishedTransfers()
                .then(() => api.listTransfers().then(setTransfers))
                .catch(showError)
            }
          />
        )}

        {activeTab === "history" && (
          <HistoryView
            conversations={conversations}
            onSelectConversation={(id) => {
              setActiveConversationId(id);
              setActiveTab("messages");
            }}
          />
        )}

        {notice && (activeTab !== "messages" || !activeConversation) && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 max-w-lg flex items-start gap-2 rounded-2xl border border-amber-300/60 bg-amber-50/90 dark:bg-amber-950/80 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-200 shadow-lg backdrop-blur-xl lanx-rise">
            <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
            <span className="flex-1 whitespace-pre-line">{notice}</span>
            <button type="button" onClick={() => setNotice(null)} className="p-0.5 rounded hover:bg-amber-100 dark:hover:bg-amber-900/50">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </main>

      {contextPresence.mounted && activeConversation && (
        <ContextPanel
          closing={contextPresence.closing}
          conversation={activeConversation}
          peer={activePeer}
          peers={peers}
          transfers={transfers}
          pinEnabled={settings.pin_enabled}
          onClose={() => setIsContextOpen(false)}
          onUpdateTrust={handleUpdateTrust}
          onOpenTransfer={transferActions.open}
          onSetHidden={handleSetHidden}
          onError={showError}
        />
      )}

      <DynamicIsland
        transfers={transfers}
        message={islandMsg}
        onMessageClose={() => setIslandMsg(null)}
        ring={islandRing}
        onRingClose={() => setIslandRing(null)}
        call={islandCall}
        callActions={{
          accept: (video) => callRef.current?.accept(video),
          decline: () => callRef.current?.decline(),
          hangup: () => callRef.current?.hangup(),
          toggleSize: () => callRef.current?.toggleSize(),
        }}
        progress={progress}
        actions={transferActions}
        catEnabled={settings.cat_alerts}
        onOpenChat={(id) => {
          setActiveConversationId(id);
          setActiveTab("messages");
        }}
      />

      <SettingsModal
        settings={settings}
        isOpen={settingsTab !== null}
        initialTab={settingsTab ?? undefined}
        onClose={() => setSettingsTab(null)}
        onSave={(updated) => {
          setSettings(updated);
          applyTheme(updated.theme);
        }}
        onThemeChange={applyTheme}
        onShowGuide={() => setShowTour(true)}
        updateStatus={updateStatus}
        installingUpdate={installingUpdate}
        onInstallUpdate={handleInstallUpdate}
        onUpdateChanged={loadUpdateStatus}
      />

      {showNewGroup && (
        <NewGroupModal
          peers={peers}
          onClose={() => setShowNewGroup(false)}
          onCreate={async (name, ids) => {
            const conv = await api.createGroup(name, ids);
            setShowNewGroup(false);
            setConversations((prev) => [conv, ...prev.filter((c) => c.id !== conv.id)]);
            setActiveConversationId(conv.id);
            setActiveTab("messages");
          }}
        />
      )}

      {showBroadcast && (
        <BroadcastModal
          peers={peers}
          onClose={() => setShowBroadcast(false)}
          onDone={(summary) => {
            setShowBroadcast(false);
            setNotice(summary);
            reloadAll().catch(() => {});
          }}
        />
      )}

      {showHiddenPrompt && (
        <PinDialog
          title="Show hidden chats"
          description="Enter your PIN. They stay visible until you hide them again or LANX locks."
          submitLabel="Show"
          onClose={() => setShowHiddenPrompt(false)}
          onSubmit={async (pin) => {
            const s = await api.unlockHidden(pin);
            setLock(s);
            setShowHiddenPrompt(false);
            await reloadAll();
          }}
        />
      )}

      {pinSetupFor && (
        <NewPinDialog
          title="Choose a PIN for hidden chats"
          description="Hidden chats only show after this PIN. LANX will also ask for it when it starts. 4 to 12 digits."
          onClose={() => setPinSetupFor(null)}
          onDone={async (pin) => {
            const id = pinSetupFor;
            await api.setPin(null, pin);
            const s = await api.getSettings();
            setSettings(s);
            setPinSetupFor(null);
            try {
              await hideOrUnhide(id, true, false);
            } catch (err) {
              showError(err);
            }
          }}
        />
      )}

      {showOnboarding && (
        <OnboardingModal
          settings={settings}
          onComplete={(updated) => {
            setSettings(updated);
            setShowOnboarding(false);
            if (!readFlag(TOUR_KEY)) setShowTour(true);
          }}
        />
      )}

      {showTour && !showOnboarding && (
        <WelcomeTour
          name={settings.display_name}
          onClose={() => {
            writeFlag(TOUR_KEY);
            setShowTour(false);
          }}
        />
      )}
    </div>
    </>
  );
}
