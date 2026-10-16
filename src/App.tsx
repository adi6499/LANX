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
} from "./types";
import { api, events, errorText, isTauri } from "./lib/api";
import { Sidebar } from "./components/Sidebar";
import { ConversationPanel } from "./components/ConversationPanel";
import { ContextPanel } from "./components/ContextPanel";
import { PeopleView } from "./components/PeopleView";
import { TransfersView } from "./components/TransfersView";
import { HistoryView } from "./components/HistoryView";
import { SettingsModal } from "./components/SettingsModal";
import { OnboardingModal } from "./components/OnboardingModal";
import { AlertCircle, X } from "lucide-react";

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [transfers, setTransfers] = useState<TransferRecord[]>([]);
  const [progress, setProgress] = useState<Record<string, TransferProgress>>({});
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);

  const [activeTab, setActiveTab] = useState<NavTab>("messages");
  const [searchQuery, setSearchQuery] = useState("");
  const [isContextOpen, setIsContextOpen] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const activeConversationIdRef = useRef<string | null>(null);
  const activeTabRef = useRef<NavTab>("messages");
  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  // Auto-hide notices after a while.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 12000);
    return () => clearTimeout(t);
  }, [notice]);

  const showError = useCallback((err: unknown) => setNotice(errorText(err)), []);

  const applyTheme = useCallback((theme: "system" | "dark" | "light") => {
    const root = document.documentElement;
    const dark =
      theme === "dark" ||
      (theme === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
    root.classList.toggle("dark", !!dark);
  }, []);

  const reloadAll = useCallback(async () => {
    const [p, c, t] = await Promise.all([api.listPeers(), api.getConversations(), api.listTransfers()]);
    setPeers(p);
    setConversations(c);
    setTransfers(t);
    const active = activeConversationIdRef.current;
    if (active && !c.some((x) => x.id === active)) {
      setActiveConversationId(c.length > 0 ? c[0].id : null);
    } else if (active) {
      api.getMessages(active).then(setMessages).catch(console.error);
    }
    return c;
  }, []);

  // Initial load
  useEffect(() => {
    (async () => {
      try {
        const s = await api.getSettings();
        setSettings(s);
        applyTheme(s.theme);
        if (!s.onboarding_completed) setShowOnboarding(true);
        const c = await reloadAll();
        if (c.length > 0 && !activeConversationIdRef.current) setActiveConversationId(c[0].id);
      } catch (err) {
        console.error("Initialization error:", err);
        setLoadError(errorText(err));
      }
    })();
  }, [applyTheme, reloadAll]);

  useEffect(() => {
    if (!settings || settings.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [settings, applyTheme]);

  // Load messages for the open chat and mark it read.
  useEffect(() => {
    if (!activeConversationId) {
      setMessages([]);
      return;
    }
    let alive = true;
    api
      .getMessages(activeConversationId)
      .then((m) => alive && setMessages(m))
      .catch(console.error);
    api.markConversationRead(activeConversationId).catch(console.error);
    setConversations((prev) =>
      prev.map((c) => (c.id === activeConversationId ? { ...c, unread_count: 0 } : c))
    );
    return () => {
      alive = false;
    };
  }, [activeConversationId]);

  // Live updates from the LANX engine.
  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    let disposed = false;
    const add = (p: Promise<() => void>) =>
      p.then((u) => (disposed ? u() : unlisteners.push(u))).catch(console.error);

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
            c.peer_id === discovered.id
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
          prev.map((c) => (c.peer_id === peer_id ? { ...c, peer_status: "offline" } : c))
        );
      })
    );

    add(
      events.onMessageReceived(({ message, conversation }) => {
        const viewing =
          activeConversationIdRef.current === message.conversation_id &&
          activeTabRef.current === "messages" &&
          document.visibilityState === "visible";
        if (activeConversationIdRef.current === message.conversation_id) {
          setMessages((prev) => upsertMessage(prev, message));
        }
        if (viewing) api.markConversationRead(message.conversation_id).catch(console.error);

        setConversations((prev) => {
          const existing = prev.find((c) => c.id === message.conversation_id);
          const base = conversation ?? existing;
          if (!base) return prev;
          const updated: Conversation = {
            ...base,
            last_message_preview: conversation?.last_message_preview ?? message.content,
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

    add(events.onStateChanged(() => reloadAll().catch(console.error)));

    return () => {
      disposed = true;
      unlisteners.forEach((fn) => fn());
    };
  }, [reloadAll]);

  const addSentFiles = useCallback((sent: SentFile[]) => {
    if (sent.length === 0) return;
    setTransfers((prev) => sent.reduce((acc, s) => upsertTransfer(acc, s.transfer), prev));
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
        c.id === last.conversation_id
          ? { ...c, last_message_preview: last.content, last_message_time: last.timestamp }
          : c
      )
    );
  }, []);

  const sendDroppedFiles = useCallback(
    async (paths: string[]) => {
      const conv = activeConversationIdRef.current;
      if (!conv || activeTabRef.current !== "messages") {
        setNotice("Open a chat first, then drop the files into it.");
        return;
      }
      try {
        addSentFiles(await api.sendFiles(conv, paths));
      } catch (err) {
        showError(err);
      }
    },
    [addSentFiles, showError]
  );

  // Drag files from Explorer into the window.
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent((event) => {
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

  const handleSendMessage = async (content: string): Promise<boolean> => {
    const conv = activeConversationId;
    if (!conv) return false;
    try {
      const newMsg = await api.sendMessage(conv, content);
      // A status event may already have delivered a newer copy: keep that one.
      setMessages((prev) => (prev.some((m) => m.id === newMsg.id) ? prev : upsertMessage(prev, newMsg)));
      setConversations((prev) => {
        const c = prev.find((x) => x.id === conv);
        if (!c) return prev;
        return [
          { ...c, last_message_preview: newMsg.content, last_message_time: newMsg.timestamp },
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

  const handleToggleTheme = () => {
    if (!settings) return;
    const nextTheme: UserSettings["theme"] =
      settings.theme === "system" ? "dark" : settings.theme === "dark" ? "light" : "system";
    const updated = { ...settings, theme: nextTheme };
    setSettings(updated);
    applyTheme(nextTheme);
    api.saveSettings(updated).catch(console.error);
  };

  const transferActions: TransferActions = useMemo(
    () => ({
      accept: (id) =>
        api
          .acceptTransfer(id)
          .then((t) => setTransfers((prev) => upsertTransfer(prev, t)))
          .catch(showError),
      cancel: (id) =>
        api
          .cancelTransfer(id)
          .then((t) => setTransfers((prev) => upsertTransfer(prev, t)))
          .catch(showError),
      retry: (id) =>
        api
          .retryTransfer(id)
          .then((t) => setTransfers((prev) => upsertTransfer(prev, t)))
          .catch(showError),
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

  const activeConversation = conversations.find((c) => c.id === activeConversationId) || null;
  const activePeer = activeConversation
    ? peers.find((p) => p.id === activeConversation.peer_id) || null
    : null;

  if (!settings) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-50 dark:bg-[#080c14] text-slate-400">
        <div className="flex flex-col items-center gap-3 max-w-md text-center px-6">
          {loadError ? (
            <>
              <AlertCircle className="h-8 w-8 text-red-500" />
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">LANX could not start</span>
              <span className="text-xs">{loadError}</span>
            </>
          ) : (
            <>
              <div className="h-8 w-8 rounded-full border-2 border-sky-500 border-t-transparent animate-spin" />
              <span className="text-xs font-medium tracking-wide">Starting LANX…</span>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-slate-100 dark:bg-black">
      <Sidebar
        settings={settings}
        conversations={conversations}
        peers={peers}
        activeConversationId={activeConversationId}
        activeTab={activeTab}
        searchQuery={searchQuery}
        pendingFiles={transfers.filter((t) => t.direction === "incoming" && t.status === "pending").length}
        onSelectConversation={(id) => {
          setActiveConversationId(id);
          setActiveTab("messages");
        }}
        onSelectTab={setActiveTab}
        onSearchChange={setSearchQuery}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onToggleTheme={handleToggleTheme}
        onNewChat={() => setActiveTab("people")}
      />

      <main className="flex-1 h-full flex flex-col min-w-0 overflow-hidden relative">
        {activeTab === "messages" && (
          <ConversationPanel
            conversation={activeConversation}
            peer={activePeer}
            messages={messages}
            transfers={transfersById}
            progress={progress}
            transferActions={transferActions}
            isContextOpen={isContextOpen}
            isDraggingFiles={isDraggingFiles}
            notice={notice}
            onDismissNotice={() => setNotice(null)}
            onToggleContext={() => setIsContextOpen(!isContextOpen)}
            onSendMessage={handleSendMessage}
            onRetryMessage={handleRetryMessage}
            onDeleteConversation={handleDeleteConversation}
            onPickFiles={handlePickFiles}
            onUnblock={() => activePeer && handleUpdateTrust(activePeer.id, "unverified")}
          />
        )}

        {activeTab === "people" && (
          <PeopleView
            peers={peers}
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

        {notice && activeTab !== "messages" && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 max-w-lg flex items-start gap-2 rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-950/80 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-200 shadow-lg">
            <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
            <span className="flex-1 whitespace-pre-line">{notice}</span>
            <button type="button" onClick={() => setNotice(null)} className="p-0.5 rounded hover:bg-amber-100 dark:hover:bg-amber-900/50">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </main>

      {activeTab === "messages" && isContextOpen && activeConversation && (
        <ContextPanel
          conversation={activeConversation}
          peer={activePeer}
          transfers={transfers}
          onClose={() => setIsContextOpen(false)}
          onUpdateTrust={handleUpdateTrust}
          onOpenTransfer={transferActions.open}
        />
      )}

      <SettingsModal
        settings={settings}
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSave={(updated) => {
          setSettings(updated);
          applyTheme(updated.theme);
        }}
        onThemeChange={applyTheme}
      />

      {showOnboarding && (
        <OnboardingModal
          settings={settings}
          onComplete={(updated) => {
            setSettings(updated);
            setShowOnboarding(false);
          }}
        />
      )}
    </div>
  );
}
