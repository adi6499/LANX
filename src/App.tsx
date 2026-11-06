import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from "react";
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
  Profile,
} from "./types";
import { api, events, errorText, isTauri } from "./lib/api";
import { applyAppearance } from "./lib/background";
import { HostRunner } from "./components/games/HostRunner";
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
import { effective } from "./lib/profile";
import type { IslandCall } from "./components/CallLayer";
import { CallLayer, CallLayerHandle } from "./components/CallLayer";
import { MeetingLayer, MeetingLayerHandle, type IslandMeeting } from "./components/MeetingLayer";
import { StarredModal } from "./components/chat/StarredModal";
import { OrganiserPanel, countNeedsMe } from "./components/org/OrganiserPanel";
import { ChatFoldersModal, type ChatTools } from "./components/tools/ChatMenu";
import { ScreenshotEditor } from "./components/tools/ScreenshotEditor";
import { IS_WINDOWS } from "./lib/platform";
import { SendToModal } from "./components/tools/SendToModal";
import * as games from "./lib/games";
import type { MeetingPrefill } from "./components/calendar/CalendarPanel";
// LANX 2.5.3: loaded when first opened, so start-up stays quick.
const NotesPanel = lazy(() => import("./components/notes/NotesPanel").then((m) => ({ default: m.NotesPanel })));
const CalendarPanel = lazy(() => import("./components/calendar/CalendarPanel").then((m) => ({ default: m.CalendarPanel })));
const PdfStudio = lazy(() => import("./components/pdf/PdfStudio").then((m) => ({ default: m.PdfStudio })));
const CalcPanel = lazy(() => import("./components/tools/CalcPanel").then((m) => ({ default: m.CalcPanel })));
const MemePanel = lazy(() => import("./components/memes/MemePanel").then((m) => ({ default: m.MemePanel })));
const MusicApp = lazy(() => import("./components/music/MusicApp").then((m) => ({ default: m.MusicApp })));
const MusicPlayer = lazy(() => import("./components/music/MusicPlayer").then((m) => ({ default: m.MusicPlayer })));
const GamesPanel = lazy(() => import("./components/games/GamesPanel").then((m) => ({ default: m.GamesPanel })));
import { WallpaperLayer } from "./components/WallpaperLayer";
import { WhatsAppInviteModal } from "./components/WhatsAppInviteModal";
import { DictationOverlay } from "./components/voice/DictationOverlay";
import { VoiceSettingsModal } from "./components/voice/VoiceSettingsModal";
import { GestureLayer, type GestureActions } from "./components/gestures/GestureLayer";
import { PhoneCamPill } from "./components/PhoneCamPill";
import { GestureSettingsModal } from "./components/gestures/GestureSettingsModal";
import { WhatsNewModal } from "./components/WhatsNewModal";
import { type Release, releaseNotes, whatsNewOnStart } from "./lib/whatsNew";
import { getVersion } from "@tauri-apps/api/app";
import { type IntentContext, runIntent } from "./components/gestures/runIntent";
import type { ToolId } from "./lib/gestures/commands";
import { loadGesturePrefs, saveGesturePrefs } from "./lib/gestures/prefs";
import { HelpDeskModal } from "./components/HelpDeskModal";
import { EndOfDayModal } from "./components/EndOfDayModal";
import { withoutForwardMark } from "./components/chat/chatUtils";
import { FileLibrary } from "./components/tools/FileLibrary";
import { SyncPanel } from "./components/tools/SyncPanel";
import { isMuted, quietNow } from "./lib/tools";
import { AlertLayer } from "./components/office/AlertLayer";
import { OfficePanel, type OfficeTab } from "./components/office/OfficePanel";
import { Directory } from "./components/office/Directory";
import { birthdayInfo, stillOn } from "./lib/office";
import { playClip, unlockAudio } from "./lib/audio";
import { configureGameSounds, sfx } from "./lib/gameSounds";
import { GlassFilters } from "./components/GlassFilters";
import { parseCard } from "./components/org/cardModel";
import { AdminPanel, type AdminTab } from "./components/admin/AdminPanel";
import { PolicyOfferDialog } from "./components/admin/AppsLauncher";
import { PhoneAskDialog } from "./components/phone/PhoneAskDialog";
import type { PairRequestInfo } from "./types";
import { exportChatExcel, printChat } from "./lib/exportChat";
import type { OfficePolicy } from "./types";
import type { AlertInfo } from "./types";
import type { SendOptions } from "./components/ConversationPanel";
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
  /** LANX 1.4.0: group meetings. */
  const meetingRef = useRef<MeetingLayerHandle>(null);
  const [islandMeeting, setIslandMeeting] = useState<IslandMeeting | null>(null);
  /** LANX 1.5.0: starred messages; a message to scroll to once its chat opens. */
  const [showStarred, setShowStarred] = useState(false);
  const [jumpTo, setJumpTo] = useState<string | null>(null);
  /** LANX 1.6.0: the Organiser and its badge. */
  const [showOrganiser, setShowOrganiser] = useState(false);
  const [organiserCount, setOrganiserCount] = useState(0);
  const organiserTimer = useRef<number | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const refreshOrganiserCount = useCallback(() => {
    if (organiserTimer.current) window.clearTimeout(organiserTimer.current);
    organiserTimer.current = window.setTimeout(() => {
      if (lockedRef.current) return;
      api
        .listCards()
        .then((h) => setOrganiserCount(countNeedsMe(h, settingsRef.current?.device_id ?? "")))
        .catch(() => {});
    }, 600);
  }, []);
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
  /** LANX 1.2.9: colleagues' profiles (avatar, status, about me) by device id. */
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  // ---- LANX 1.7.0
  const [showFolders, setShowFolders] = useState(false);
  const [shot, setShot] = useState<ArrayBuffer | null>(null);
  const [sendRequest, setSendRequest] = useState<string[] | null>(null);
  /** LANX 2.2.0: messages being forwarded (the chat picker is open). */
  const [forwarding, setForwarding] = useState<Message[] | null>(null);
  // LANX 2.5.0: work tools.
  const [showNotes, setShowNotes] = useState<false | { initial: { title?: string; body: string } | null }>(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [pdfPath, setPdfPath] = useState<null | { path: string | null; mode?: "read" | "edit" }>(null);
  const [showCalc, setShowCalc] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  /** LANX 2.6.0: the hidden meme picker (/meme in a chat). */
  const [showMemes, setShowMemes] = useState<{ query: string } | null>(null);
  /** LANX 2.7.0: the hidden music picker (/music in a chat) and a song card to send through "Send to…". */
  const [showMusic, setShowMusic] = useState<{ query: string } | null>(null);
  const [shareCard, setShareCard] = useState<{ card: Record<string, unknown>; preview: string } | null>(null);
  /** LANX 2.9.0: the hidden games window (/game in a chat), and a small note when a colleague moves while it is closed. */
  const [showGames, setShowGames] = useState<{ query: string; matchId: string | null } | null>(null);
  const [gameNudge, setGameNudge] = useState<{ text: string; matchId: string } | null>(null);
  const showGamesRef = useRef(false);
  showGamesRef.current = !!showGames;
  const peersForGamesRef = useRef<Peer[]>([]);
  peersForGamesRef.current = peers;
  useEffect(() => {
    if (settings) games.setMe(settings.device_id, settings.display_name);
  }, [settings?.device_id, settings?.display_name]);
  useEffect(() => {
    games.onNudge((text, m) => {
      if (showGamesRef.current) return;
      setGameNudge({ text, matchId: m.id });
    });
    const open = (e: Event) => {
      const d = ((e as CustomEvent).detail ?? {}) as { matchId?: string; card?: games.GameCardData; message?: Parameters<typeof games.openFromCard>[1] };
      setGameNudge(null);
      if (d.card && d.message) {
        games
          .openFromCard(d.card, d.message, peersForGamesRef.current)
          .then((m) => setShowGames({ query: "", matchId: m.id }))
          .catch((err) => setNotice(errorText(err)));
      } else {
        setShowGames({ query: "", matchId: d.matchId ?? null });
      }
    };
    window.addEventListener("lanx:game-open", open);
    return () => {
      games.onNudge(null);
      window.removeEventListener("lanx:game-open", open);
    };
  }, []);
  const [shareText, setShareText] = useState<string | null>(null);
  const [shareFile, setShareFile] = useState<string | null>(null);
  const [meetingPrefill, setMeetingPrefill] = useState<MeetingPrefill | null>(null);
  const [showVoice, setShowVoice] = useState(false);
  const [dictateNow, setDictateNow] = useState<{ start: number } | null>(null);
  /** LANX 2.3.0: the IT help dialog is open. */
  const [showHelpDesk, setShowHelpDesk] = useState(false);
  /** LANX 2.4.0: the end-of-day report dialog. */
  const [showEndOfDay, setShowEndOfDay] = useState(false);
  const [filesMode, setFilesMode] = useState<"transfers" | "library" | "sync">("transfers");
  const [historyQuery, setHistoryQuery] = useState("");
  // ---- LANX 1.8.0
  const [alerts, setAlerts] = useState<AlertInfo[]>([]);
  const [office, setOffice] = useState<OfficeTab | null>(null);
  const [peopleMode, setPeopleMode] = useState<"network" | "directory">("network");
  // ---- LANX 1.9.0
  const [adminTab, setAdminTab] = useState<AdminTab | null>(null);
  const [policyOffer, setPolicyOffer] = useState<OfficePolicy | null>(null);
  // LANX 3.0: a phone typed the code from Settings → Phone.
  const [phoneAsk, setPhoneAsk] = useState<PairRequestInfo | null>(null);
  const upsertAlert = useCallback((a: AlertInfo) => setAlerts((prev) => [a, ...prev.filter((x) => x.id !== a.id)].sort((x, y) => y.at - x.at)), []);
  // The first click anywhere lets LANX play intercom messages by itself.
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);
  const [, setClockTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setClockTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  /** Quiet hours (Settings → Notifications): like Do not disturb. */
  const quiet = quietNow(settings?.quiet_hours);
  /** Your status is "Do not disturb": no sounds or pop-ups in LANX either. */
  const dnd = effective(settings?.profile)?.status === "dnd" || quiet;
  const dndRef = useRef(false);
  dndRef.current = dnd;
  // LANX 2.13.0: the game sounds follow Settings → Sounds and go quiet with Do not disturb.
  useEffect(() => {
    configureGameSounds({ volume: settings?.sound_enabled === false ? 0 : settings?.sound_volume, quiet: dnd });
  }, [settings?.sound_enabled, settings?.sound_volume, dnd]);
  const myIdRef = useRef("");
  myIdRef.current = settings?.device_id ?? "";
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
    api.getPeerProfiles().then(setProfiles).catch(() => {});
    // LANX 3.4: a phone may have changed the settings (Appearance, quick
    // replies…): the window shows them, and never saves old ones back.
    api
      .getSettings()
      .then((s) => {
        setSettings(s);
        applyTheme(s.theme);
      })
      .catch(() => {});
    refreshOrganiserCount();
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
  }, [loadUpdateStatus, applyTheme]);

  const takeSendRequest = useCallback(() => {
    api
      .takeSendRequest()
      .then((p) => p.length && setSendRequest((prev) => [...new Set([...(prev ?? []), ...p])]))
      .catch(() => {});
  }, []);

  // LANX 2.14.0: a PDF double-clicked in Explorer opens here, in the reader.
  const takeOpenRequest = useCallback(() => {
    api
      .takeOpenRequest()
      .then((p) => {
        if (p.length) setPdfPath({ path: p[0], mode: "read" });
      })
      .catch(() => {});
  }, []);

  const loadAfterUnlock = useCallback(async () => {
    try {
      const s = await api.getSettings();
      setSettings(s);
      const c = await reloadAll();
      takeSendRequest();
      takeOpenRequest();
      if (c.length > 0 && !activeConversationIdRef.current) setActiveConversationId(c[0].id);
    } catch (err) {
      showError(err);
    }
  }, [reloadAll, showError, takeOpenRequest]);

  // Initial load
  useEffect(() => {
    (async () => {
      try {
        const [s, l] = await Promise.all([api.getSettings(), api.getLockStatus()]);
        setSettings(s);
        setLock(l);
        api.listAlerts().then(setAlerts).catch(() => {});
        lockedRef.current = l.locked;
        applyTheme(s.theme);
        if (!s.onboarding_completed) setShowOnboarding(true);
        else if (!readFlag(TOUR_KEY)) setShowTour(true);
        // LANX 3.7.0: just updated? What the new version brings.
        void whatsNewOnStart(!!s.onboarding_completed).then((r) => r.length > 0 && setWhatsNew(r)).catch(() => {});
        if (!l.locked) {
          const c = await reloadAll();
          if (c.length > 0 && !activeConversationIdRef.current) setActiveConversationId(c[0].id);
          takeSendRequest();
          if (s.onboarding_completed) takeOpenRequest(); // else once the welcome screens are done
          api.getAdminState().then((st) => setPolicyOffer(st.offer)).catch(() => {});
        }
        const restored = await api.takeRestoreNotice().catch(() => null);
        if (restored) setNotice(restored.text);
      } catch (err) {
        console.error("Initialization error:", err);
        setLoadError(errorText(err));
      }
    })();
  }, [applyTheme, reloadAll, takeSendRequest, takeOpenRequest]);

  useEffect(() => {
    applyAppearance({
      chat_background: settings?.chat_background ?? "default",
      accent_color: settings?.accent_color ?? "default",
      glass_level: settings?.glass_level ?? 55,
      frost_level: settings?.frost_level ?? 60,
      color_style: settings?.color_style,
    });
  }, [settings?.chat_background, settings?.accent_color, settings?.glass_level, settings?.frost_level, settings?.color_style]);

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
      events.onPeerProfile(({ peer_id, profile }) => {
        setProfiles((prev) => ({ ...prev, [peer_id]: profile }));
      })
    );

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
        } else if (
          !message.is_outgoing &&
          document.hasFocus() &&
          ["text", "file", "sticker"].includes(message.message_type) &&
          // LANX 1.7.0: muted chats stay quiet (unless you are @mentioned).
          (!isMuted(conversation ?? conversationsRef.current.find((c) => c.id === message.conversation_id)) || !!message.mentions?.includes(myIdRef.current))
        ) {
          // LANX is in front but this chat isn't open: a soft sound, and the
          // message (with the cat) in the Dynamic Island. Hidden chats stay
          // out of sight unless they are shown.
          if (!dndRef.current) api.playSound().catch(() => {});
          // (Files have their own island card: Accept / progress / done.)
          if (!dndRef.current && (message.message_type === "text" || message.message_type === "sticker") && conversation && (!conversation.is_hidden || hiddenUnlockedRef.current)) {
            const group = conversation.kind === "group";
            const sender = group ? peersRef.current.find((p) => p.id === message.sender_id) : null;
            setIslandMsg({
              id: message.id,
              conversationId: message.conversation_id,
              peerId: group ? message.sender_id : conversation.peer_id,
              from: group ? sender?.display_name ?? "Someone" : conversation.peer_name,
              color: group ? sender?.avatar_color ?? conversation.peer_avatar_color : conversation.peer_avatar_color,
              text: message.ttl_secs ? "🔒 Secret message" : message.message_type === "sticker" ? conversation.last_message_preview ?? "Sticker" : message.content,
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

    // LANX 1.6.0: cards change → the Organiser badge follows.
    add(
      events.onMessageReceived(({ message }) => {
        if (message.message_type === "card") {
          refreshOrganiserCount();
          // LANX 2.13.0: a game challenge rings a little bell.
          if (!message.is_outgoing && !dndRef.current && parseCard(message)?.kind === "game") sfx("invite");
        }
      })
    );
    add(
      events.onMessageStatusUpdated(({ message }) => {
        if (message.message_type === "card") refreshOrganiserCount();
      })
    );

    // LANX 1.5.0: a "remind me" went off — show it in the Dynamic Island.
    add(
      events.onReminder(({ message, conversation_id, title, text }) => {
        if (lockedRef.current || dndRef.current) return;
        api.playSound().catch(() => {});
        setIslandMsg({ id: `reminder-${message.id}-${Date.now()}`, conversationId: conversation_id, from: title, color: "#f59e0b", text });
        if (conversation_id === activeConversationIdRef.current) setMessages((prev) => upsertMessage(prev, message));
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
        if (lockedRef.current || dndRef.current) return;
        // The cat rings a bell in the Dynamic Island (hidden chats stay out of sight).
        const conv = conversationsRef.current.find((c) => c.id === conversation_id);
        if (conv?.is_hidden && !hiddenUnlockedRef.current) return;
        if (isMuted(conv)) return; // LANX 1.7.0
        setIslandRing({
          id: `ring-${Date.now()}`,
          peerId: conv?.peer_id || null,
          name: peer_name || conv?.peer_name || "Someone",
          color: conv?.peer_avatar_color ?? "#f59e0b",
          conversationId: conversation_id,
        });
      })
    );

    add(
      events.onTransferUpdated((t) => {
        if (t.kind === "sync") return; // shared-folder files: see Files → Shared folders
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
    // LANX 1.8.0: emergency alerts (also over the lock screen), intercom.
    add(events.onAlert((a) => upsertAlert(a)));
    // LANX 1.9.0: the LANX admin asks to manage this computer.
    add(events.onPolicyOffer((p) => setPolicyOffer(p)));
    add(events.onPhonePair((r) => setPhoneAsk(r)));
    add(
      events.onPhoneChanged(() =>
        api
          .phoneStatus()
          .then((st) => setPhoneAsk((cur) => (cur && st.requests.some((r) => r.id === cur.id) ? cur : null)))
          .catch(() => {})
      )
    );
    add(events.onAdminNotice(({ text }) => setNotice(text)));
    // LANX 2.9.0: a colleague's step in a game.
    add(events.onGame((e) => games.receive(e as games.GameEvent)));
    add(
      events.onIntercom(async (e) => {
        if (lockedRef.current || e.quiet) return;
        try {
          const played = await playClip(await api.readVoiceNote(e.transfer_id));
          setIslandMsg({
            id: `intercom-${e.transfer_id}`,
            conversationId: e.conversation_id,
            peerId: e.peer_id,
            from: e.name ?? "Intercom",
            color: "#f97316",
            text: played ? "📻 On the intercom…" : "📻 Sent you an intercom message — open the chat to play it",
          });
        } catch {
          /* still in the chat as a voice note */
        }
      })
    );
    // LANX 1.7.0: Ctrl + Alt + S, and Explorer's "Send to → LANX".
    add(
      events.onScreenshotReady(() => {
        if (lockedRef.current) return;
        api.takeHotkeyCapture().then(setShot).catch(() => {});
      })
    );
    add(
      events.onSendRequest(() => {
        if (lockedRef.current) return;
        api
          .takeSendRequest()
          .then((p) => p.length && setSendRequest((prev) => [...new Set([...(prev ?? []), ...p])]))
          .catch(() => {});
      })
    );
    add(
      events.onOpenRequest(() => {
        if (lockedRef.current) return;
        api
          .takeOpenRequest()
          .then((p) => p.length && setPdfPath({ path: p[0], mode: "read" }))
          .catch(() => {});
      })
    );
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
  }, [reloadAll, clearPrivateState, loadUpdateStatus, upsertAlert]);

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

  const handleSendMessage = async (content: string, opts?: SendOptions): Promise<boolean> => {
    const conv = activeConversationId;
    if (!conv) return false;
    try {
      const newMsg = await api.sendMessageEx(conv, content, opts?.replyTo ?? null, opts?.mentions ?? []);
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

  /** LANX 1.5.0: a recorded voice note goes out like a file. */
  const handleSendVoice = async (data: Blob, durationMs: number, ext: string) => {
    const conv = activeConversationIdRef.current;
    if (!conv) return;
    try {
      addSentFiles(await api.sendVoiceNote(conv, new Uint8Array(await data.arrayBuffer()), durationMs, ext));
    } catch (err) {
      showError(err);
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

  // ---- LANX 1.7.0
  const mergeConversation = (c: Conversation) => setConversations((prev) => prev.map((x) => (x.id === c.id ? { ...x, ...c } : x)));
  const chatTools: ChatTools = {
    pin: (id, pinned) => api.setChatPinned(id, pinned).then(mergeConversation).catch(showError),
    mute: (id, minutes) => api.setChatMuted(id, minutes).then(mergeConversation).catch(showError),
    archive: (id, archived) =>
      api
        .setChatArchived(id, archived)
        .then((c) => {
          mergeConversation(c);
          if (archived) setNotice(`“${c.peer_name}” moved to Archived (the Archived button above your chats).`);
        })
        .catch(showError),
    folders: (id, folders) => api.setChatFolders(id, folders).then(mergeConversation).catch(showError),
    unread: (id, unread) => {
      if (unread) {
        api
          .markChatUnread(id)
          .then((c) => {
            mergeConversation(c);
            // (An open chat would be read again at once.)
            if (activeConversationIdRef.current === id) setActiveConversationId(null);
          })
          .catch(showError);
      } else {
        api
          .markConversationRead(id)
          .then(() => setConversations((prev) => prev.map((x) => (x.id === id ? { ...x, unread_count: 0 } : x))))
          .catch(showError);
      }
    },
  };

  const handleSendSticker = async (id: string) => {
    const conv = activeConversationIdRef.current;
    if (!conv) return;
    try {
      const m = await api.sendSticker(conv, id);
      setMessages((prev) => upsertMessage(prev, m));
      api.getConversations().then(setConversations).catch(() => {});
    } catch (err) {
      showError(err);
    }
  };

  const handleScreenshot = async () => {
    try {
      setShot(await api.captureScreen());
    } catch (err) {
      showError(err);
    }
  };

  const handleShareFolder = async () => {
    const conv = activeConversationIdRef.current;
    if (!conv) return;
    try {
      const dir = await api.pickFolder("Choose a folder to share (colleagues' copies stay up to date)");
      if (!dir) return;
      const m = await api.shareFolder(conv, dir);
      setMessages((prev) => upsertMessage(prev, m));
      api.getConversations().then(setConversations).catch(() => {});
    } catch (err) {
      showError(err);
    }
  };

  // ---- LANX 1.8.0
  const handleSendWishes = async (peerId: string) => {
    try {
      const conv = await api.getOrCreateConversation(peerId);
      setConversations((prev) => (prev.some((c) => c.id === conv.id) ? prev : [conv, ...prev]));
      await api.sendSticker(conv.id, "birthday");
      setActiveConversationId(conv.id);
      setActiveTab("messages");
      setOffice(null);
      api.getConversations().then(setConversations).catch(() => {});
      if (activeConversationIdRef.current === conv.id) api.getMessages(conv.id).then(setMessages).catch(() => {});
    } catch (err) {
      showError(err);
    }
  };

  /** LANX 1.9.0: an Excel file was saved — open it. */
  const handleExported = (path: string) => {
    setNotice(`Saved: ${path}`);
    api.openExported(path).catch(() => {});
  };

  const handleExportChat = async (kind: "excel" | "pdf") => {
    const conv = conversations.find((c) => c.id === activeConversationIdRef.current);
    if (!conv || !settings) return;
    try {
      if (kind === "pdf") await printChat(conv, peers, settings.display_name);
      else {
        const p = await exportChatExcel(conv, peers, settings.display_name);
        if (p) handleExported(p);
      }
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
          peerId: conv.peer_id || null,
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

  // ---- LANX 3.5.0: gestures and spoken commands
  const [showGestures, setShowGestures] = useState(false);
  /** LANX 3.7.0: "What's new" after an update (or from Settings → Updates). */
  const [whatsNew, setWhatsNew] = useState<Release[] | null>(null);
  useEffect(() => {
    const on = () => {
      void getVersion()
        .then((v) => {
          const r = releaseNotes(v);
          if (r) setWhatsNew([r]);
        })
        .catch(() => {});
    };
    window.addEventListener("lanx:whats-new", on);
    return () => window.removeEventListener("lanx:whats-new", on);
  }, []);
  /** Open windows a flick up (or "go back") closes, the one on top first. The PDF tools and games close themselves. */
  const openPanels: [boolean, () => void][] = [
    [showGestures, () => setShowGestures(false)],
    [showVoice, () => setShowVoice(false)],
    [!!settingsTab, () => setSettingsTab(null)],
    [showInvite, () => setShowInvite(false)],
    [showHelpDesk, () => setShowHelpDesk(false)],
    [showEndOfDay, () => setShowEndOfDay(false)],
    [showNewGroup, () => setShowNewGroup(false)],
    [showBroadcast, () => setShowBroadcast(false)],
    [showStarred, () => setShowStarred(false)],
    [showCalc, () => setShowCalc(false)],
    [!!showMemes, () => setShowMemes(null)],
    [!!showMusic, () => setShowMusic(null)],
    [!!showNotes, () => setShowNotes(false)],
    [showCalendar, () => setShowCalendar(false)],
    [showOrganiser, () => setShowOrganiser(false)],
  ];
  const gestureState = useRef({ peers, conversations, activeConversationId, messages, islandCall, islandMeeting, settings, openPanels });
  gestureState.current = { peers, conversations, activeConversationId, messages, islandCall, islandMeeting, settings, openPanels };
  const gestureActions = useMemo<GestureActions>(() => {
    const openTool = (w: ToolId) => {
      if (w === "music") setShowMusic({ query: "" });
      else if (w === "notes") setShowNotes({ initial: null });
      else if (w === "calendar") setShowCalendar(true);
      else if (w === "games") setShowGames({ query: "", matchId: null });
      else if (w === "calculator") setShowCalc(true);
      else if (w === "pdf") setPdfPath({ path: null });
      else if (w === "memes") setShowMemes({ query: "" });
      else if (w === "settings") setSettingsTab("profile");
      else if (w === "voice") setShowVoice(true);
      else if (w === "gestures") setShowGestures(true);
      else if (w === "organiser") setShowOrganiser(true);
      else if (w === "starred") setShowStarred(true);
      else if (w === "help-desk") setShowHelpDesk(true);
    };
    const ctx = (): IntentContext => {
      const g = gestureState.current;
      return {
        peers: g.peers,
        conversations: g.conversations,
        activeConversationId: g.activeConversationId,
        messages: g.messages,
        call: g.islandCall,
        meeting: g.islandMeeting,
        callLayer: callRef.current,
        meetingLayer: meetingRef.current,
        openConversation: (c) => {
          setConversations((prev) => (prev.some((x) => x.id === c.id) ? prev : [c, ...prev]));
          setActiveConversationId(c.id);
          setActiveTab("messages");
        },
        send: async (id, text) => {
          await api.sendMessage(id, text);
          if (activeConversationIdRef.current === id) setMessages(await api.getMessages(id));
        },
        updateMessage: (m) => setMessages((prev) => prev.map((x) => (x.id === m.id ? m : x))),
        setTab: (t) => setActiveTab(t),
        open: openTool,
        setTheme: (theme) => {
          const st = gestureState.current.settings;
          if (!st) return;
          const updated = { ...st, theme };
          setSettings(updated);
          applyTheme(theme);
          api.saveSettings(updated).catch(console.error);
        },
        search: (q) => {
          setActiveTab("messages");
          setSearchQuery(q);
        },
        note: (text) => setShowNotes({ initial: text ? { title: "", body: text } : null }),
        gesturesOff: () => void loadGesturePrefs().then((p) => saveGesturePrefs({ ...p, enabled: false })),
        close: closeTop,
      };
    };
    const closeTop = () => {
      const top = gestureState.current.openPanels.find(([open]) => open);
      top?.[1]();
      return !!top;
    };
    return {
      yes: () => {
        const g = gestureState.current;
        if (g.islandCall?.status === "incoming") callRef.current?.accept(g.islandCall.video);
        else if (g.islandMeeting?.status === "invited") meetingRef.current?.join(g.islandMeeting.video);
        else return false;
        return true;
      },
      no: () => {
        const g = gestureState.current;
        if (g.islandCall?.status === "incoming") callRef.current?.decline();
        else if (g.islandMeeting?.status === "invited") meetingRef.current?.decline();
        else return false;
        return true;
      },
      run: (intent) => runIntent(intent, ctx()),
      close: closeTop,
      names: () => [...gestureState.current.peers.map((p) => p.display_name), ...gestureState.current.conversations.filter((c) => c.kind === "group").map((c) => c.peer_name)],
      // LANX 3.7.0: hands in calls and meetings.
      inCall: () => {
        const g = gestureState.current;
        if (g.islandMeeting?.status === "active") return "meeting";
        if (g.islandCall?.status === "active") return "call";
        return null;
      },
      react: (emoji) => !!(callRef.current?.react(emoji) || meetingRef.current?.react(emoji)),
      toggleMute: () => callRef.current?.toggleMute() ?? meetingRef.current?.toggleMute() ?? null,
      toggleHand: () => meetingRef.current?.toggleHand() ?? null,
      hangup: () => {
        const g = gestureState.current;
        if (g.islandCall) callRef.current?.hangup();
        else if (g.islandMeeting) meetingRef.current?.leave();
        else return false;
        return true;
      },
    };
  }, [applyTheme]);

  const transferActions: TransferActions = useMemo(
    () => ({
      accept: (id) => api.acceptTransfer(id).then((t) => setTransfers((prev) => upsertTransfer(prev, t))).catch(showError),
      cancel: (id) => api.cancelTransfer(id).then((t) => setTransfers((prev) => upsertTransfer(prev, t))).catch(showError),
      retry: (id) => api.retryTransfer(id).then((t) => setTransfers((prev) => upsertTransfer(prev, t))).catch(showError),
      open: (id) => api.openTransferFile(id).catch(showError),
      reveal: (id) => api.revealTransferFile(id).catch(showError),
      editPdf: (id) => api.transferFilePath(id).then((p) => setPdfPath({ path: p })).catch(showError),
      whatsapp: (id) =>
        api
          .transferFilePath(id)
          .then((p) => api.shareWhatsApp({ file: p }))
          .then((r) => r === "copied" && setNotice("The file is copied — pick the chat in WhatsApp and press Ctrl+V to send it."))
          .catch(showError),
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

  /** LANX 1.7.0: Files → Transfers / Library / Shared folders. */
  const filesSwitch = (
    <div data-files-mode className="flex rounded-[11px] bg-[var(--lanx-fill)] p-[3px] text-xs">
      {(
        [
          ["transfers", "Transfers"],
          ["library", "Library"],
          ["sync", "Shared folders"],
        ] as const
      ).map(([k, label]) => (
        <button
          key={k}
          type="button"
          data-files-mode-btn={k}
          onClick={() => setFilesMode(k)}
          className={`px-3 py-1 rounded-lg font-medium transition-colors ${
            filesMode === k ? "bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  /** LANX 1.8.0: Peers → Network / Directory. */
  const peopleSwitch = (
    <div data-people-mode className="flex rounded-[11px] bg-[var(--lanx-fill)] p-[3px] text-xs">
      {(
        [
          ["network", "Network"],
          ["directory", "Directory"],
        ] as const
      ).map(([k, label]) => (
        <button
          key={k}
          type="button"
          data-people-mode-btn={k}
          onClick={() => setPeopleMode(k)}
          className={`px-3 py-1 rounded-lg font-medium transition-colors ${
            peopleMode === k ? "bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  // The details panel slides out before it goes away.
  const contextPresence = usePresence(activeTab === "messages" && isContextOpen && !!activeConversation, 220);
  // LANX 2.14.0: the games window and the PDF tools fade out instead of vanishing.
  const gamesPresence = usePresence(!!showGames, 220);
  const lastGames = useRef(showGames);
  if (showGames) lastGames.current = showGames;
  const pdfPresence = usePresence(!!pdfPath, 220);
  const lastPdf = useRef(pdfPath);
  if (pdfPath) lastPdf.current = pdfPath;

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
      profiles={profiles}
      onOpenChat={(id) => {
        if (lockedRef.current) return;
        setActiveConversationId(id);
        setActiveTab("messages");
      }}
    />
  );

  const meetingLayer = (
    <MeetingLayer
      key="meeting-layer"
      ref={meetingRef}
      onError={(text) => setNotice(text)}
      onNotice={(text) => setNotice(text)}
      onIslandChange={setIslandMeeting}
      profiles={profiles}
      peers={peers}
      onOpenChat={(id) => {
        if (lockedRef.current) return;
        meetingRef.current?.show();
        setActiveConversationId(id);
        setActiveTab("messages");
      }}
    />
  );

  const alertLayer = (
    <AlertLayer
      key="alert-layer"
      alerts={alerts}
      onAnswer={(id, status) => api.answerAlert(id, status).then(upsertAlert).catch(showError)}
      onClear={(id) => api.clearAlert(id).then(upsertAlert).catch(showError)}
    />
  );

  if (locked) {
    return (
      <>
        {callLayer}
        {meetingLayer}
        {alertLayer}
        <LockScreen
          displayName={settings.display_name}
          avatarColor={settings.avatar_color}
          profile={settings.profile}
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
    {meetingLayer}
    {alertLayer}
    <div className="h-screen w-screen flex overflow-hidden lanx-window relative isolate">
      <GlassFilters />
      <WallpaperLayer reduceMotion={!!settings.reduce_motion} />
      <Sidebar
        settings={settings}
        conversations={conversations}
        peers={peers}
        profiles={profiles}
        onSetProfile={(profile) => {
          const updated = { ...settings, profile };
          setSettings(updated);
          api.saveSettings(updated).then(setSettings).catch(showError);
        }}
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
        onRaiseHelp={() => setShowHelpDesk(true)}
        onEndOfDay={() => setShowEndOfDay(true)}
        onOpenNotes={() => setShowNotes({ initial: null })}
        onOpenCalendar={() => setShowCalendar(true)}
        onOpenPdf={() => setPdfPath({ path: null })}
        onOpenCalc={() => setShowCalc(true)}
        onInviteWhatsApp={() => setShowInvite(true)}
        onDictate={() => setDictateNow({ start: Date.now() })}
        onOpenVoice={() => setShowVoice(true)}
        onOpenGestures={() => setShowGestures(true)}
        onOpenStarred={() => setShowStarred(true)}
        onOpenOrganiser={() => setShowOrganiser(true)}
        organiserCount={organiserCount}
        onLock={() => api.lockApp().then(setLock).catch(showError)}
        onToggleHidden={handleToggleHidden}
        chatTools={chatTools}
        onManageFolders={() => setShowFolders(true)}
        onSearchAll={(q) => {
          setHistoryQuery(q);
          setActiveTab("history");
        }}
        onOpenOffice={() => setOffice("emergency")}
        officeAlert={alerts.some((a) => stillOn(a))}
        onOpenReception={settings.reception_desk ? () => setOffice("reception") : undefined}
        birthdaysToday={peers.filter((p) => birthdayInfo(profiles[p.id]?.birthday)?.days === 0).map((p) => ({ id: p.id, name: p.display_name }))}
        onSendWishes={handleSendWishes}
        onOpenAdmin={(tab) => setAdminTab(tab ?? "office")}
        onError={(t) => setNotice(t)}
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
            peerProfile={activePeer ? profiles[activePeer.id] ?? null : null}
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
            myId={settings.device_id}
            onMeeting={(video) => activeConversation && meetingRef.current?.start(activeConversation, video)}
            onRejoinMeeting={(id) => meetingRef.current?.rejoin(id)}
            onError={(text) => setNotice(text)}
            myName={settings.display_name}
            profiles={profiles}
            onSendVoice={handleSendVoice}
            quickReplies={settings.quick_replies ?? []}
            onOpenMemes={(q) => setShowMemes({ query: q })}
            onOpenMusic={(q) => setShowMusic({ query: q })}
            onOpenGames={(q) => setShowGames({ query: q, matchId: null })}
            onSaveQuickReplies={(list) => {
              const updated = { ...settings, quick_replies: list };
              setSettings(updated);
              api.saveSettings(updated).then(setSettings).catch(showError);
            }}
            onMessageChanged={(m) => setMessages((prev) => (m.conversation_id === activeConversationIdRef.current ? upsertMessage(prev, m) : prev))}
            onMessageRemoved={(id) => setMessages((prev) => prev.filter((m) => m.id !== id))}
            jumpTo={jumpTo}
            onJumped={() => setJumpTo(null)}
            onCardPosted={() => {
              api.getConversations().then(setConversations).catch(() => {});
              refreshOrganiserCount();
            }}
            onUnblock={() => activePeer && handleUpdateTrust(activePeer.id, "unverified")}
            onSendSticker={handleSendSticker}
            onScreenshot={IS_WINDOWS ? handleScreenshot : undefined}
            onShareFolder={handleShareFolder}
            onUnmute={() => activeConversation && chatTools.mute(activeConversation.id, 0)}
            onIntercomSent={addSentFiles}
            onRemoteHelp={(help) => activeConversation && callRef.current?.start(activeConversation, false, help)}
            onForward={(msgs) => setForwarding(msgs)}
            onSaveNote={(m) => setShowNotes({ initial: { title: "", body: withoutForwardMark(m.content) } })}
            onShareWhatsApp={(m) => api.shareWhatsApp({ text: withoutForwardMark(m.content) }).catch(showError)}
          />
        )}

        {activeTab === "people" && peopleMode === "directory" && (
          <Directory settings={settings} peers={peers} profiles={profiles} modeSwitch={peopleSwitch} onStartChat={handleStartChatFromPeer} />
        )}

        {activeTab === "people" && peopleMode === "network" && (
          <PeopleView
            modeSwitch={peopleSwitch}
            peers={peers}
            profiles={profiles}
            versions={peerVersions}
            latestVersion={updateStatus?.latest_version ?? null}
            searchQuery={searchQuery}
            onStartChat={handleStartChatFromPeer}
            onAddManualPeer={handleAddManualPeer}
            onUpdateTrust={handleUpdateTrust}
          />
        )}

        {activeTab === "transfers" && filesMode === "library" && (
          <FileLibrary
            transfers={transfers}
            conversations={conversations}
            modeSwitch={filesSwitch}
            onOpen={transferActions.open}
            onReveal={transferActions.reveal}
            onShowInChat={(id) =>
              api
                .messageForTransfer(id)
                .then((m) => {
                  if (!m) return setNotice("That chat message isn't on this computer any more.");
                  setActiveConversationId(m.conversation_id);
                  setActiveTab("messages");
                  setJumpTo(m.id);
                })
                .catch(showError)
            }
          />
        )}

        {activeTab === "transfers" && filesMode === "sync" && (
          <SyncPanel
            conversations={conversations}
            modeSwitch={filesSwitch}
            onError={(t) => setNotice(t)}
            onOpenChat={(id) => {
              setActiveConversationId(id);
              setActiveTab("messages");
            }}
          />
        )}

        {activeTab === "transfers" && filesMode === "transfers" && (
          <TransfersView
            modeSwitch={filesSwitch}
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
            peers={peers}
            initialQuery={historyQuery}
            onOpenMessage={(conversationId, messageId) => {
              setActiveConversationId(conversationId);
              setActiveTab("messages");
              setJumpTo(messageId);
            }}
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
          profiles={profiles}
          peers={peers}
          transfers={transfers}
          pinEnabled={settings.pin_enabled}
          onClose={() => setIsContextOpen(false)}
          onUpdateTrust={handleUpdateTrust}
          onOpenTransfer={transferActions.open}
          onSetHidden={handleSetHidden}
          onError={showError}
          onExport={handleExportChat}
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
        meeting={islandMeeting}
        meetingActions={{
          join: (video) => meetingRef.current?.join(video),
          decline: () => meetingRef.current?.decline(),
          show: () => meetingRef.current?.show(),
        }}
        progress={progress}
        actions={transferActions}
        catEnabled={settings.cat_alerts && !dnd}
        profiles={profiles}
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

      {showOrganiser && (
        <OrganiserPanel
          myId={settings.device_id}
          nameOf={(id) => (id === settings.device_id ? "You" : peers.find((p) => p.id === id)?.display_name ?? "Someone")}
          onClose={() => {
            setShowOrganiser(false);
            refreshOrganiserCount();
          }}
          onError={showError}
          onCount={setOrganiserCount}
          onOpen={(conversationId, messageId) => {
            setShowOrganiser(false);
            setActiveConversationId(conversationId);
            setActiveTab("messages");
            setJumpTo(messageId);
          }}
          onStartMeeting={(conversationId) => {
            const conv = conversations.find((c) => c.id === conversationId);
            setShowOrganiser(false);
            if (conv) meetingRef.current?.start(conv, true);
          }}
        />
      )}

      {adminTab && (
        <AdminPanel
          settings={settings}
          peers={peers}
          profiles={profiles}
          conversations={conversations.filter((c) => !c.is_hidden || lock.hidden_unlocked)}
          versions={peerVersions}
          initialTab={adminTab}
          onClose={() => {
            setAdminTab(null);
            api.getSettings().then(setSettings).catch(() => {});
          }}
          onError={showError}
          onNotice={(t) => setNotice(t)}
          onExported={handleExported}
        />
      )}

      {phoneAsk && (
        <PhoneAskDialog
          request={phoneAsk}
          onAnswer={(allow) =>
            api
              .phoneAnswer(phoneAsk.id, allow)
              .then(() => {
                setPhoneAsk(null);
                setNotice(allow ? `${phoneAsk.name} can use LANX now — it shows your chats through this PC.` : "OK — that phone was not allowed in.");
              })
              .catch((err) => {
                setPhoneAsk(null);
                showError(err);
              })
          }
        />
      )}
      {policyOffer && (
        <PolicyOfferDialog
          offer={policyOffer}
          onAnswer={(accept) =>
            api
              .answerPolicyOffer(accept)
              .then(() => {
                setPolicyOffer(null);
                setNotice(accept ? `This computer now uses ${policyOffer.admin_name}'s office settings.` : "OK — you won't be asked again by them.");
              })
              .catch((err) => {
                setPolicyOffer(null);
                showError(err);
              })
          }
        />
      )}

      {office && (
        <OfficePanel
          settings={settings}
          myId={settings.device_id}
          peers={peers}
          profiles={profiles}
          conversations={conversations}
          alerts={alerts}
          initialTab={office}
          onClose={() => setOffice(null)}
          onSaveSettings={async (updated) => {
            setSettings(updated);
            try {
              setSettings(await api.saveSettings(updated));
            } catch (err) {
              showError(err);
            }
          }}
          onRaiseAlert={async (kind, text) => {
            try {
              const a = await api.raiseAlert(kind, text);
              upsertAlert(a);
              setOffice(null);
              setNotice(a.sent_to.length ? `Emergency alert sent to ${a.sent_to.length} ${a.sent_to.length === 1 ? "colleague" : "colleagues"}. Their answers show at the top.` : "Nobody is online right now to get the alert.");
            } catch (err) {
              showError(err);
            }
          }}
          onOpenChat={(conversationId, messageId) => {
            setOffice(null);
            setActiveConversationId(conversationId);
            setActiveTab("messages");
            if (messageId) setJumpTo(messageId);
          }}
          onSendWishes={handleSendWishes}
          onError={showError}
          onNotice={(t) => setNotice(t)}
          onCardSent={() => api.getConversations().then(setConversations).catch(() => {})}
        />
      )}

      {showFolders && (
        <ChatFoldersModal
          folders={settings.chat_folders ?? []}
          onClose={() => setShowFolders(false)}
          onSave={(list) => {
            const updated = { ...settings, chat_folders: list };
            setSettings(updated);
            setShowFolders(false);
            api.saveSettings(updated).then(setSettings).catch(showError);
          }}
        />
      )}

      {shot && (
        <ScreenshotEditor
          capture={shot}
          conversations={conversations.filter((c) => !c.is_hidden || lock.hidden_unlocked)}
          defaultConversationId={activeConversationId}
          onClose={() => setShot(null)}
          onNotice={(t) => setNotice(t)}
          onSend={async (conversationId, dataUrl) => {
            const mime = dataUrl.slice(5, dataUrl.indexOf(";")) || "image/png";
            const sent = await api.sendPastedImage(conversationId, dataUrl, mime);
            addSentFiles(sent);
            setActiveConversationId(conversationId);
            setActiveTab("messages");
          }}
        />
      )}

      {showEndOfDay && (
        <EndOfDayModal
          conversations={conversations}
          peers={peers}
          myId={settings.device_id}
          onClose={() => setShowEndOfDay(false)}
          onError={showError}
          onSent={(ids) => {
            setNotice(ids.length === 1 ? "Report sent." : `Report sent to ${ids.length} people.`);
            api.getConversations().then(setConversations).catch(() => {});
            if (ids[0]) {
              setActiveConversationId(ids[0]);
              setActiveTab("messages");
            }
          }}
        />
      )}

      {showHelpDesk && (
        <HelpDeskModal
          conversations={conversations}
          peers={peers}
          myId={settings.device_id}
          onClose={() => setShowHelpDesk(false)}
          onError={showError}
          onSent={(ids) => {
            setNotice(ids.length === 1 ? "Sent to IT. They'll see it in your chat." : `Sent to IT (${ids.length} people).`);
            api.getConversations().then(setConversations).catch(() => {});
            if (ids[0]) {
              setActiveConversationId(ids[0]);
              setActiveTab("messages");
            }
          }}
        />
      )}

      {showNotes !== false && (
        <Suspense fallback={null}>
          <NotesPanel
            initialNote={showNotes.initial}
            onClose={() => setShowNotes(false)}
            onError={(t) => setNotice(t)}
            onSendText={(text) => setShareText(text)}
            onOpenVoiceSettings={() => setShowVoice(true)}
          />
        </Suspense>
      )}
      {showCalendar && (
        <Suspense fallback={null}>
        <CalendarPanel
          myName={settings.display_name}
          myBirthday={settings.profile?.birthday}
          profiles={profiles}
          peerNames={Object.fromEntries(peers.map((p) => [p.id, p.display_name]))}
          onClose={() => setShowCalendar(false)}
          onError={(t) => setNotice(t)}
          onOpenCard={(conversationId, messageId) => {
            setActiveConversationId(conversationId);
            setActiveTab("messages");
            setJumpTo(messageId);
          }}
          onSendText={(text) => setShareText(text)}
          onInvite={(prefill) => setMeetingPrefill(prefill)}
        />
        </Suspense>
      )}
      {pdfPresence.mounted && lastPdf.current && (
        <Suspense fallback={null}>
          <PdfStudio
            initialPath={lastPdf.current.path}
            initialMode={lastPdf.current.mode}
            closing={pdfPresence.closing}
            onClose={() => setPdfPath(null)}
            onError={(t) => setNotice(t)}
            onSendFile={(path) => setShareFile(path)}
          />
        </Suspense>
      )}
      {showCalc && (
        <Suspense fallback={null}>
          <CalcPanel onClose={() => setShowCalc(false)} onError={(t) => setNotice(t)} />
        </Suspense>
      )}
      <Suspense fallback={null}>
        <MusicPlayer onOpenMusic={() => setShowMusic({ query: "" })} />
      </Suspense>
      {/* LANX 2.17.0: keeps a hosted game going while the host looks elsewhere. */}
      <HostRunner />
      {gamesPresence.mounted && lastGames.current && settings && (
        <Suspense fallback={null}>
          <GamesPanel
            initialQuery={lastGames.current.query}
            openMatchId={lastGames.current.matchId}
            closing={gamesPresence.closing}
            peers={peers}
            myId={settings.device_id}
            myName={settings.display_name}
            chatPeerId={activeConversation?.peer_id || null}
            onClose={() => setShowGames(null)}
            onError={(t) => setNotice(t)}
            onSendCard={async (card, peerId) => {
              const c = await api.getOrCreateConversation(peerId);
              setConversations((prev) => (prev.some((x) => x.id === c.id) ? prev : [c, ...prev]));
              await api.sendCard(c.id, card as unknown as Record<string, unknown>);
            }}
          />
        </Suspense>
      )}
      {gameNudge && !showGames && (
        <div data-game-nudge className="fixed bottom-[92px] right-5 z-[55] flex items-center gap-2 rounded-full lanx-sheet px-3 py-2 text-[12.5px] shadow-lg lanx-rise">
          <span className="text-base">🎮</span>
          <span className="max-w-[320px] truncate text-slate-800 dark:text-slate-100">{gameNudge.text}</span>
          <button
            type="button"
            data-game-nudge-open
            onClick={() => {
              setShowGames({ query: "", matchId: gameNudge.matchId });
              setGameNudge(null);
            }}
            className="rounded-full bg-indigo-600 px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-indigo-700"
          >
            Open
          </button>
          <button type="button" onClick={() => setGameNudge(null)} className="rounded-full p-1 text-slate-500 hover:bg-slate-500/10" aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {showMusic && (
        <Suspense fallback={null}>
          <MusicApp
            initialQuery={showMusic.query}
            chatName={activeConversation?.peer_name ?? null}
            onClose={() => setShowMusic(null)}
            onError={(t) => setNotice(t)}
            onSendCard={async (card, preview) => {
              if (activeConversation) await api.sendCard(activeConversation.id, card);
              else setShareCard({ card, preview });
            }}
          />
        </Suspense>
      )}
      {shareCard && (
        <SendToModal
          paths={[]}
          title="Send the song to…"
          items={[shareCard.preview]}
          conversations={conversations}
          peers={peers}
          onClose={() => setShareCard(null)}
          onSend={async (conversationIds, peerIds) => {
            const ids = [...conversationIds];
            for (const p of peerIds) {
              try {
                const c = await api.getOrCreateConversation(p);
                setConversations((prev) => (prev.some((x) => x.id === c.id) ? prev : [c, ...prev]));
                ids.push(c.id);
              } catch (e) {
                showError(e);
              }
            }
            for (const id of ids) {
              try {
                await api.sendCard(id, shareCard.card);
              } catch (e) {
                showError(e);
              }
            }
            setShareCard(null);
          }}
        />
      )}
      {showMemes && (
        <Suspense fallback={null}>
          <MemePanel
            initialQuery={showMemes.query}
            chatName={activeConversation?.peer_name ?? null}
            onClose={() => setShowMemes(null)}
            onError={(t) => setNotice(t)}
            onSendToChat={async (path) => {
              if (activeConversation) await api.sendFiles(activeConversation.id, [path]);
              else setShareFile(path);
            }}
          />
        </Suspense>
      )}
      {showInvite && <WhatsAppInviteModal onClose={() => setShowInvite(false)} onError={(t) => setNotice(t)} />}
      {showVoice && <VoiceSettingsModal onClose={() => setShowVoice(false)} onError={(t) => setNotice(t)} />}
      <DictationOverlay onError={(t) => setNotice(t)} onOpenSettings={() => setShowVoice(true)} external={dictateNow} />
      {showGestures && <GestureSettingsModal onClose={() => setShowGestures(false)} />}
      {whatsNew && !showOnboarding && !showTour && !locked && (
        <WhatsNewModal
          releases={whatsNew}
          onClose={() => setWhatsNew(null)}
          tryLabel="Learn hand gestures"
          onTry={
            whatsNew[0]?.version.startsWith("3.7")
              ? () => {
                  setWhatsNew(null);
                  // The gesture layer opens its practice guide (and turns the camera on).
                  window.dispatchEvent(new Event("lanx:gesture-learn"));
                }
              : undefined
          }
        />
      )}
      <PhoneCamPill />
      <GestureLayer actions={gestureActions} locked={locked} onError={(t) => setNotice(t)} onOpenSettings={() => setShowGestures(true)} onOpenVoiceSettings={() => setShowVoice(true)} />
      {(shareText !== null || shareFile !== null) && (
        <SendToModal
          paths={shareFile ? [shareFile] : []}
          title="Send to…"
          items={shareText !== null ? [shareText.slice(0, 120)] : undefined}
          conversations={conversations}
          peers={peers}
          onClose={() => {
            setShareText(null);
            setShareFile(null);
          }}
          onSend={async (conversationIds, peerIds) => {
            const ids = [...conversationIds];
            for (const p of peerIds) {
              try {
                const c = await api.getOrCreateConversation(p);
                setConversations((prev) => (prev.some((x) => x.id === c.id) ? prev : [c, ...prev]));
                ids.push(c.id);
              } catch (e) {
                showError(e);
              }
            }
            for (const id of ids) {
              try {
                if (shareFile) await api.sendFiles(id, [shareFile]);
                else if (shareText !== null) await api.sendMessage(id, shareText);
              } catch (e) {
                showError(e);
              }
            }
            setShareText(null);
            setShareFile(null);
            if (ids.length) setNotice(`Sent to ${ids.length} chat${ids.length === 1 ? "" : "s"}.`);
          }}
        />
      )}
      {meetingPrefill && (
        <SendToModal
          paths={[]}
          title="Which chat holds the meeting?"
          items={[`📅 ${meetingPrefill.title}`]}
          conversations={conversations}
          peers={peers}
          onClose={() => setMeetingPrefill(null)}
          onSend={async (conversationIds, peerIds) => {
            try {
              let c = conversationIds.length ? conversations.find((x) => x.id === conversationIds[0]) ?? null : null;
              if (!c && peerIds.length) {
                c = await api.getOrCreateConversation(peerIds[0]);
                const conv = c;
                setConversations((prev) => (prev.some((x) => x.id === conv.id) ? prev : [conv, ...prev]));
              }
              if (!c) return;
              const attendees = (c.kind === "direct" ? [settings.device_id, c.peer_id] : [settings.device_id]);
              await api.sendCard(c.id, {
                kind: "event",
                title: meetingPrefill.title,
                start: meetingPrefill.start,
                minutes: meetingPrefill.minutes,
                attendees,
                place: meetingPrefill.place,
                video: true,
                agenda: meetingPrefill.agenda,
              });
              setNotice(`Meeting invite sent in ${c.peer_name}.`);
            } catch (e) {
              showError(e);
            } finally {
              setMeetingPrefill(null);
            }
          }}
        />
      )}
      {forwarding && forwarding.length > 0 && (
        <SendToModal
          paths={[]}
          title="Forward to…"
          items={forwarding.map((m) =>
            m.message_type === "file" ? `📎 ${m.content}` : m.message_type === "sticker" ? "Sticker" : withoutForwardMark(m.content).slice(0, 120)
          )}
          conversations={conversations}
          peers={peers}
          onClose={() => setForwarding(null)}
          onSend={async (conversationIds, peerIds) => {
            const ids = [...conversationIds];
            for (const p of peerIds) {
              try {
                const c = await api.getOrCreateConversation(p);
                setConversations((prev) => (prev.some((x) => x.id === c.id) ? prev : [c, ...prev]));
                ids.push(c.id);
              } catch (err) {
                showError(err);
              }
            }
            const msgs = forwarding;
            setForwarding(null);
            try {
              const r = await api.forwardMessages(
                msgs.map((m) => m.id),
                ids
              );
              if (r.problems.length) showError(r.problems.join(" "));
              else setNotice(ids.length === 1 ? "Forwarded." : `Forwarded to ${ids.length} chats.`);
              api.getConversations().then(setConversations).catch(() => {});
              const open = activeConversationIdRef.current;
              if (open && ids.includes(open)) api.getMessages(open).then(setMessages).catch(() => {});
            } catch (err) {
              showError(err);
            }
          }}
        />
      )}

      {sendRequest && sendRequest.length > 0 && (
        <SendToModal
          paths={sendRequest}
          conversations={conversations}
          peers={peers}
          onClose={() => setSendRequest(null)}
          onSend={async (conversationIds, peerIds) => {
            const ids = [...conversationIds];
            for (const p of peerIds) {
              try {
                const c = await api.getOrCreateConversation(p);
                setConversations((prev) => (prev.some((x) => x.id === c.id) ? prev : [c, ...prev]));
                ids.push(c.id);
              } catch (err) {
                showError(err);
              }
            }
            const paths = sendRequest;
            setSendRequest(null);
            for (const id of ids) await sendPaths(id, paths);
            if (ids.length === 1) {
              setActiveConversationId(ids[0]);
              setActiveTab("messages");
            } else if (ids.length > 1) setNotice(`Sending to ${ids.length} chats — see Files for progress.`);
          }}
        />
      )}

      {showStarred && (
        <StarredModal
          onClose={() => setShowStarred(false)}
          onError={showError}
          onOpen={(conversationId, messageId) => {
            setShowStarred(false);
            setActiveConversationId(conversationId);
            setActiveTab("messages");
            setJumpTo(messageId);
          }}
        />
      )}

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
            else takeOpenRequest(); // LANX 2.14.0: the PDF that started LANX (otherwise once the tour is done)
          }}
        />
      )}

      {showTour && !showOnboarding && (
        <WelcomeTour
          name={settings.display_name}
          onClose={() => {
            writeFlag(TOUR_KEY);
            setShowTour(false);
            takeOpenRequest(); // LANX 2.14.0: the PDF that started LANX
          }}
        />
      )}
    </div>
    </>
  );
}
