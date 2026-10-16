import { useState, useEffect, useCallback, useRef } from "react";
import {
  UserSettings,
  Peer,
  Conversation,
  Message,
  TransferRecord,
  NavTab,
} from "./types";
import { api, events } from "./lib/api";
import { Sidebar } from "./components/Sidebar";
import { ConversationPanel } from "./components/ConversationPanel";
import { ContextPanel } from "./components/ContextPanel";
import { PeopleView } from "./components/PeopleView";
import { TransfersView } from "./components/TransfersView";
import { HistoryView } from "./components/HistoryView";
import { SettingsModal } from "./components/SettingsModal";
import { OnboardingModal } from "./components/OnboardingModal";

export default function App() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [transfers, setTransfers] = useState<TransferRecord[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);

  const [activeTab, setActiveTab] = useState<NavTab>("messages");
  const [searchQuery, setSearchQuery] = useState("");
  const [isContextOpen, setIsContextOpen] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Apply Theme
  const applyTheme = useCallback((theme: "system" | "dark" | "light") => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else if (theme === "light") {
      root.classList.remove("dark");
    } else {
      // System default
      if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    }
  }, []);

  // Initial load
  useEffect(() => {
    const init = async () => {
      try {
        const s = await api.getSettings();
        setSettings(s);
        applyTheme(s.theme);

        if (!s.onboarding_completed) {
          setShowOnboarding(true);
        }

        const [p, c, t] = await Promise.all([
          api.listPeers(),
          api.getConversations(),
          api.listTransfers(),
        ]);

        setPeers(p);
        setConversations(c);
        setTransfers(t);

        if (c.length > 0 && !activeConversationId) {
          setActiveConversationId(c[0].id);
        }
      } catch (err) {
        console.error("Initialization error:", err);
      }
    };

    init();
  }, [applyTheme]);

  // Listen to system theme changes when theme === "system"
  useEffect(() => {
    if (!settings || settings.theme !== "system") return;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, [settings, applyTheme]);

  // Load messages whenever activeConversationId changes
  useEffect(() => {
    if (!activeConversationId) {
      setMessages([]);
      return;
    }

    api
      .getMessages(activeConversationId)
      .then(setMessages)
      .catch((err) => console.error("Error loading messages:", err));

    api.markConversationRead(activeConversationId).catch(console.error);

    setConversations((prev) =>
      prev.map((c) => (c.id === activeConversationId ? { ...c, unread_count: 0 } : c))
    );
  }, [activeConversationId]);

  const activeConversationIdRef = useRef<string | null>(activeConversationId);
  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  // Real-time network event subscriptions (Discovery, Peer Expiry, Incoming Message, ACK status)
  useEffect(() => {
    let unlisteners: (() => void)[] = [];

    const setupListeners = async () => {
      // 1. Peer discovered or updated via UDP beacon / TCP Hello
      const u1 = await events.onPeerDiscovered((discovered) => {
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
                  peer_status: "online",
                  peer_name: discovered.display_name,
                  peer_avatar_color: discovered.avatar_color,
                  peer_ip: discovered.last_ip,
                }
              : c
          )
        );
      });
      unlisteners.push(u1);

      // 2. Peer marked offline (beacon expiry)
      const u2 = await events.onPeerOffline(({ peer_id }) => {
        setPeers((prev) =>
          prev.map((p) => (p.id === peer_id ? { ...p, status: "offline" } : p))
        );
        setConversations((prev) =>
          prev.map((c) => (c.peer_id === peer_id ? { ...c, peer_status: "offline" } : c))
        );
      });
      unlisteners.push(u2);

      // 3. Incoming real LAN message received
      const u3 = await events.onMessageReceived(({ message, conversation: newConv }) => {
        const currentActive = activeConversationIdRef.current;

        // If the incoming message belongs to active conversation, append it
        if (currentActive === message.conversation_id) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === message.id)) return prev;
            return [...prev, message];
          });
          api.markConversationRead(message.conversation_id).catch(console.error);
        }

        // Update conversation summary in sidebar
        setConversations((prev) => {
          const existing = prev.find((c) => c.id === message.conversation_id);
          if (existing) {
            return prev.map((c) =>
              c.id === message.conversation_id
                ? {
                    ...c,
                    last_message_preview: message.content,
                    last_message_time: message.timestamp,
                    unread_count:
                      currentActive === message.conversation_id
                        ? 0
                        : c.unread_count + 1,
                  }
                : c
            );
          } else if (newConv) {
            return [
              {
                ...newConv,
                last_message_preview: message.content,
                last_message_time: message.timestamp,
                unread_count: currentActive === newConv.id ? 0 : 1,
              },
              ...prev,
            ];
          }
          return prev;
        });
      });
      unlisteners.push(u3);

      // 4. Message delivery status updated (delivered or failed)
      const u4 = await events.onMessageStatusUpdated(({ message_id, status, error_reason }) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === message_id
              ? {
                  ...m,
                  status: status as any,
                  error_reason: error_reason || undefined,
                }
              : m
          )
        );
      });
      unlisteners.push(u4);
    };

    setupListeners();

    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, []);

  const handleSendMessage = async (content: string) => {
    if (!activeConversationId) return;
    try {
      const newMsg = await api.sendMessage(activeConversationId, content);
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === newMsg.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = newMsg;
          return next;
        }
        return [...prev, newMsg];
      });

      // Update conversation preview in sidebar
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConversationId
            ? {
                ...c,
                last_message_preview: content,
                last_message_time: newMsg.timestamp,
              }
            : c
        )
      );
    } catch (err) {
      console.error("Send message error:", err);
    }
  };

  const handleRetryMessage = async (messageId: string) => {
    try {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, status: "sending", error_reason: undefined } : m
        )
      );
      const updated = await api.retryMessage(messageId);
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? updated : m))
      );
    } catch (err) {
      console.error("Retry message error:", err);
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
      console.error("Delete conversation error:", err);
    }
  };

  const handleAddManualPeer = async (ip: string, port: number, name?: string) => {
    try {
      const peer = await api.addManualPeer(ip, port, name);
      setPeers((prev) => [peer, ...prev.filter((p) => p.id !== peer.id)]);
      const conv = await api.getOrCreateConversation(peer.id);
      setConversations((prev) => [conv, ...prev.filter((c) => c.id !== conv.id)]);
      setActiveConversationId(conv.id);
      setActiveTab("messages");
    } catch (err) {
      console.error("Manual peer error:", err);
      throw err;
    }
  };

  const handleStartChatFromPeer = async (peerId: string) => {
    try {
      const conv = await api.getOrCreateConversation(peerId);
      setConversations((prev) => {
        if (prev.some((c) => c.id === conv.id)) return prev;
        return [conv, ...prev];
      });
      setActiveConversationId(conv.id);
      setActiveTab("messages");
    } catch (err) {
      console.error("Start chat error:", err);
    }
  };

  const handleUpdateTrust = async (
    peerId: string,
    trustState: "unverified" | "trusted" | "blocked"
  ) => {
    try {
      await api.updatePeerTrust(peerId, trustState);
      setPeers((prev) =>
        prev.map((p) => (p.id === peerId ? { ...p, trust_state: trustState } : p))
      );
    } catch (err) {
      console.error("Update trust error:", err);
    }
  };

  const handleToggleTheme = () => {
    if (!settings) return;
    const nextTheme: "system" | "dark" | "light" =
      settings.theme === "system"
        ? "dark"
        : settings.theme === "dark"
        ? "light"
        : "system";
    const updated = { ...settings, theme: nextTheme };
    setSettings(updated);
    applyTheme(nextTheme);
    api.saveSettings(updated).catch(console.error);
  };

  const handleCancelTransfer = async (transferId: string) => {
    try {
      await api.cancelTransfer(transferId);
      setTransfers((prev) =>
        prev.map((t) => (t.id === transferId ? { ...t, status: "cancelled" } : t))
      );
    } catch (err) {
      console.error("Cancel transfer error:", err);
    }
  };

  const handleAcceptTransfer = async (transferId: string) => {
    try {
      await api.acceptTransfer(transferId);
      setTransfers((prev) =>
        prev.map((t) => (t.id === transferId ? { ...t, status: "approved" } : t))
      );
    } catch (err) {
      console.error("Accept transfer error:", err);
    }
  };

  const activeConversation =
    conversations.find((c) => c.id === activeConversationId) || null;
  const activePeer = activeConversation
    ? peers.find((p) => p.id === activeConversation.peer_id) || null
    : null;

  if (!settings) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-50 dark:bg-[#080c14] text-slate-400">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-sky-500 border-t-transparent animate-spin" />
          <span className="text-xs font-medium tracking-wide">Starting LANX Engine...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-slate-100 dark:bg-black">
      {/* 1. Left Sidebar */}
      <Sidebar
        settings={settings}
        conversations={conversations}
        peers={peers}
        activeConversationId={activeConversationId}
        activeTab={activeTab}
        searchQuery={searchQuery}
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

      {/* 2. Main Center Panel */}
      <main className="flex-1 h-full flex flex-col min-w-0 overflow-hidden relative">
        {activeTab === "messages" && (
          <ConversationPanel
            conversation={activeConversation}
            peer={activePeer}
            messages={messages}
            isContextOpen={isContextOpen}
            onToggleContext={() => setIsContextOpen(!isContextOpen)}
            onSendMessage={handleSendMessage}
            onRetryMessage={handleRetryMessage}
            onDeleteConversation={handleDeleteConversation}
            onSelectPeerForTransfer={() => setActiveTab("transfers")}
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
            onCancelTransfer={handleCancelTransfer}
            onAcceptTransfer={handleAcceptTransfer}
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
      </main>

      {/* 3. Optional Right Context Panel (Only when a chat is open and context is toggled) */}
      {activeTab === "messages" && isContextOpen && activeConversation && (
        <ContextPanel
          conversation={activeConversation}
          peer={activePeer}
          transfers={transfers}
          onClose={() => setIsContextOpen(false)}
          onUpdateTrust={handleUpdateTrust}
        />
      )}

      {/* Settings Modal */}
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

      {/* First-Run Onboarding Modal */}
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
