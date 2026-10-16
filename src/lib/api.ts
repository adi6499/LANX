import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import {
  UserSettings,
  Peer,
  Conversation,
  Message,
  TransferRecord,
  SystemInfo,
  ConnectionTestResult,
} from "../types";

export interface MessageStatusUpdatedPayload {
  message_id: string;
  status: string;
  error_reason?: string | null;
}

export interface IncomingMessagePayload {
  message: Message;
  conversation: Conversation | null;
}

export interface PeerOfflinePayload {
  peer_id: string;
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// In-memory mock store for web preview mode
let mockSettings: UserSettings = {
  device_id: "preview-device-7890",
  display_name: "LANX Preview User",
  hostname: "DESKTOP-LANX",
  avatar_color: "#0284c7",
  theme: "system",
  udp_discovery_port: 52925,
  tcp_messaging_port: 52926,
  discovery_interval_secs: 5,
  notifications_enabled: true,
  auto_download_transfers: false,
  default_download_dir: "C:\\Users\\Public\\Downloads",
  onboarding_completed: true,
};

let mockPeers: Peer[] = [
  {
    id: "peer-sarah",
    display_name: "Sarah Chen",
    hostname: "THINKPAD-X1",
    last_ip: "192.168.1.104",
    tcp_port: 52926,
    trust_state: "trusted",
    status: "online",
    last_seen: Date.now() / 1000,
    avatar_color: "#6366f1",
  },
  {
    id: "peer-marcus",
    display_name: "Marcus Vance",
    hostname: "DEV-WORKSTATION",
    last_ip: "192.168.1.115",
    tcp_port: 52926,
    trust_state: "unverified",
    status: "online",
    last_seen: Date.now() / 1000,
    avatar_color: "#10b981",
  },
  {
    id: "peer-elena",
    display_name: "Elena Rostova",
    hostname: "MACBOOK-AIR",
    last_ip: "192.168.1.142",
    tcp_port: 52926,
    trust_state: "trusted",
    status: "offline",
    last_seen: Date.now() / 1000 - 3600,
    avatar_color: "#ec4899",
  },
];

let mockConversations: Conversation[] = [
  {
    id: "conv-sarah",
    peer_id: "peer-sarah",
    peer_name: "Sarah Chen",
    peer_status: "online",
    peer_avatar_color: "#6366f1",
    peer_ip: "192.168.1.104",
    last_message_preview: "Sent the updated Q3 network telemetry report.",
    last_message_time: Math.floor(Date.now() / 1000) - 120,
    unread_count: 1,
    is_pinned: true,
    created_at: Math.floor(Date.now() / 1000) - 86400,
  },
  {
    id: "conv-marcus",
    peer_id: "peer-marcus",
    peer_name: "Marcus Vance",
    peer_status: "online",
    peer_avatar_color: "#10b981",
    peer_ip: "192.168.1.115",
    last_message_preview: "Are you running on subnet 192.168.1.0/24?",
    last_message_time: Math.floor(Date.now() / 1000) - 900,
    unread_count: 0,
    is_pinned: false,
    created_at: Math.floor(Date.now() / 1000) - 43200,
  },
  {
    id: "conv-elena",
    peer_id: "peer-elena",
    peer_name: "Elena Rostova",
    peer_status: "offline",
    peer_avatar_color: "#ec4899",
    peer_ip: "192.168.1.142",
    last_message_preview: "Thanks for the swift transfer!",
    last_message_time: Math.floor(Date.now() / 1000) - 4000,
    unread_count: 0,
    is_pinned: false,
    created_at: Math.floor(Date.now() / 1000) - 100000,
  },
];

let mockMessages: Record<string, Message[]> = {
  "conv-sarah": [
    {
      id: "m-1",
      conversation_id: "conv-sarah",
      sender_id: "peer-sarah",
      receiver_id: "preview-device-7890",
      content: "Hey, do you have the LANX build artifacts ready?",
      message_type: "text",
      timestamp: Math.floor(Date.now() / 1000) - 600,
      status: "read",
      is_outgoing: false,
    },
    {
      id: "m-2",
      conversation_id: "conv-sarah",
      sender_id: "preview-device-7890",
      receiver_id: "peer-sarah",
      content: "Yes, Milestone 1 is verified with native SQLite persistence and clean dark/light UI tokens.",
      message_type: "text",
      timestamp: Math.floor(Date.now() / 1000) - 450,
      status: "delivered",
      is_outgoing: true,
    },
    {
      id: "m-3",
      conversation_id: "conv-sarah",
      sender_id: "peer-sarah",
      receiver_id: "preview-device-7890",
      content: "Sent the updated Q3 network telemetry report.",
      message_type: "text",
      timestamp: Math.floor(Date.now() / 1000) - 120,
      status: "delivered",
      is_outgoing: false,
    },
  ],
  "conv-marcus": [
    {
      id: "m-4",
      conversation_id: "conv-marcus",
      sender_id: "preview-device-7890",
      receiver_id: "peer-marcus",
      content: "Hey Marcus, testing peer discovery on LAN.",
      message_type: "text",
      timestamp: Math.floor(Date.now() / 1000) - 1200,
      status: "delivered",
      is_outgoing: true,
    },
    {
      id: "m-5",
      conversation_id: "conv-marcus",
      sender_id: "peer-marcus",
      receiver_id: "preview-device-7890",
      content: "Are you running on subnet 192.168.1.0/24?",
      message_type: "text",
      timestamp: Math.floor(Date.now() / 1000) - 900,
      status: "delivered",
      is_outgoing: false,
    },
  ],
  "conv-elena": [
    {
      id: "m-6",
      conversation_id: "conv-elena",
      sender_id: "peer-elena",
      receiver_id: "preview-device-7890",
      content: "Thanks for the swift transfer!",
      message_type: "text",
      timestamp: Math.floor(Date.now() / 1000) - 4000,
      status: "read",
      is_outgoing: false,
    },
  ],
};

let mockTransfers: TransferRecord[] = [
  {
    id: "tx-1",
    peer_id: "peer-sarah",
    peer_name: "Sarah Chen",
    file_name: "Quarterly_Network_Architecture_v2.pdf",
    file_size: 14857600, // 14.1 MB
    file_hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    direction: "incoming",
    status: "completed",
    transferred_bytes: 14857600,
    local_path: "C:\\Users\\Public\\Downloads\\Quarterly_Network_Architecture_v2.pdf",
    created_at: Math.floor(Date.now() / 1000) - 3600,
    completed_at: Math.floor(Date.now() / 1000) - 3540,
  },
  {
    id: "tx-2",
    peer_id: "peer-marcus",
    peer_name: "Marcus Vance",
    file_name: "firmware_patch_bundle.tar.gz",
    file_size: 52428800, // 50 MB
    file_hash: "a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e",
    direction: "outgoing",
    status: "transferring",
    transferred_bytes: 34078720, // ~32.5 MB
    local_path: "E:\\Releases\\firmware_patch_bundle.tar.gz",
    created_at: Math.floor(Date.now() / 1000) - 60,
  },
];

export const api = {
  getSettings: async (): Promise<UserSettings> => {
    if (isTauri) return await invoke("get_settings");
    return { ...mockSettings };
  },

  saveSettings: async (settings: UserSettings): Promise<void> => {
    if (isTauri) return await invoke("save_settings", { settings });
    mockSettings = { ...settings };
  },

  completeOnboarding: async (
    displayName: string,
    avatarColor: string
  ): Promise<UserSettings> => {
    if (isTauri) {
      return await invoke("complete_onboarding", {
        displayName,
        avatarColor,
      });
    }
    mockSettings.display_name = displayName;
    mockSettings.avatar_color = avatarColor;
    mockSettings.onboarding_completed = true;
    return { ...mockSettings };
  },

  listPeers: async (): Promise<Peer[]> => {
    if (isTauri) return await invoke("list_peers");
    return [...mockPeers];
  },

  addManualPeer: async (
    ip: string,
    port: number,
    name?: string
  ): Promise<Peer> => {
    if (isTauri) return await invoke("add_manual_peer", { ip, port, name });
    const peer: Peer = {
      id: `manual-${ip}:${port}`,
      display_name: name || `Peer at ${ip}:${port}`,
      hostname: "Manual Peer",
      last_ip: ip,
      tcp_port: port,
      trust_state: "unverified",
      status: "online",
      last_seen: Math.floor(Date.now() / 1000),
      avatar_color: "#10b981",
    };
    mockPeers.push(peer);
    return peer;
  },

  updatePeerTrust: async (
    peerId: string,
    trustState: "unverified" | "trusted" | "blocked"
  ): Promise<void> => {
    if (isTauri) return await invoke("update_peer_trust", { peerId, trustState });
    const p = mockPeers.find((x) => x.id === peerId);
    if (p) p.trust_state = trustState;
  },

  getConversations: async (): Promise<Conversation[]> => {
    if (isTauri) return await invoke("get_conversations");
    return [...mockConversations];
  },

  getOrCreateConversation: async (peerId: string): Promise<Conversation> => {
    if (isTauri) return await invoke("get_or_create_conversation", { peerId });
    const existing = mockConversations.find((c) => c.peer_id === peerId);
    if (existing) return existing;

    const peer = mockPeers.find((p) => p.id === peerId);
    const newConv: Conversation = {
      id: `conv-${peerId}`,
      peer_id: peerId,
      peer_name: peer?.display_name || "Unknown Peer",
      peer_status: peer?.status || "offline",
      peer_avatar_color: peer?.avatar_color || "#3b82f6",
      peer_ip: peer?.last_ip || "127.0.0.1",
      last_message_preview: null,
      last_message_time: Math.floor(Date.now() / 1000),
      unread_count: 0,
      is_pinned: false,
      created_at: Math.floor(Date.now() / 1000),
    };
    mockConversations.unshift(newConv);
    mockMessages[newConv.id] = [];
    return newConv;
  },

  getMessages: async (conversationId: string): Promise<Message[]> => {
    if (isTauri) return await invoke("get_messages", { conversationId });
    return [...(mockMessages[conversationId] || [])];
  },

  sendMessage: async (
    conversationId: string,
    content: string
  ): Promise<Message> => {
    if (isTauri) return await invoke("send_message", { conversationId, content });
    throw new Error(
      "Native LAN messaging requires the LANX desktop application shell. Browser preview cannot open raw TCP sockets."
    );
  },

  retryMessage: async (messageId: string): Promise<Message> => {
    if (isTauri) return await invoke("retry_message", { messageId });
    throw new Error(
      "Native LAN messaging requires the LANX desktop application shell. Browser preview cannot open raw TCP sockets."
    );
  },

  markConversationRead: async (conversationId: string): Promise<void> => {
    if (isTauri) return await invoke("mark_conversation_read", { conversationId });
    const conv = mockConversations.find((c) => c.id === conversationId);
    if (conv) conv.unread_count = 0;
  },

  deleteConversation: async (conversationId: string): Promise<void> => {
    if (isTauri) return await invoke("delete_conversation", { conversationId });
    mockConversations = mockConversations.filter((c) => c.id !== conversationId);
    delete mockMessages[conversationId];
  },

  listTransfers: async (): Promise<TransferRecord[]> => {
    if (isTauri) return await invoke("list_transfers");
    return [...mockTransfers];
  },

  cancelTransfer: async (transferId: string): Promise<void> => {
    if (isTauri) return await invoke("cancel_transfer", { transferId });
    const t = mockTransfers.find((x) => x.id === transferId);
    if (t) t.status = "cancelled";
  },

  acceptTransfer: async (transferId: string): Promise<void> => {
    if (isTauri) return await invoke("accept_transfer", { transferId });
    const t = mockTransfers.find((x) => x.id === transferId);
    if (t) t.status = "approved";
  },

  getSystemInfo: async (): Promise<SystemInfo> => {
    if (isTauri) return await invoke("get_system_info");
    return {
      device_id: mockSettings.device_id,
      hostname: mockSettings.hostname,
      local_ips: ["192.168.1.88"],
      database_path: "%APPDATA%\\LANX\\lanx.db",
      database_size_bytes: 40960,
      os: "Windows 11 Pro",
    };
  },

  testLanConnection: async (
    ip: string,
    port: number
  ): Promise<ConnectionTestResult> => {
    if (isTauri) return await invoke("test_lan_connection", { ip, port });
    return {
      reachable: true,
      ip,
      port,
      latency_ms: 2,
      message: "Direct LAN socket connected (2ms)",
    };
  },
};

export const events = {
  onPeerDiscovered: (cb: (peer: Peer) => void): Promise<UnlistenFn> => {
    if (isTauri) {
      return listen<Peer>("lanx://peer-discovered", (e) => cb(e.payload));
    }
    return Promise.resolve(() => {});
  },

  onPeerOffline: (cb: (data: PeerOfflinePayload) => void): Promise<UnlistenFn> => {
    if (isTauri) {
      return listen<PeerOfflinePayload>("lanx://peer-offline", (e) => cb(e.payload));
    }
    return Promise.resolve(() => {});
  },

  onMessageReceived: (cb: (data: IncomingMessagePayload) => void): Promise<UnlistenFn> => {
    if (isTauri) {
      return listen<IncomingMessagePayload>("lanx://message-received", (e) => cb(e.payload));
    }
    return Promise.resolve(() => {});
  },

  onMessageStatusUpdated: (
    cb: (data: MessageStatusUpdatedPayload) => void
  ): Promise<UnlistenFn> => {
    if (isTauri) {
      return listen<MessageStatusUpdatedPayload>(
        "lanx://message-status-updated",
        (e) => cb(e.payload)
      );
    }
    return Promise.resolve(() => {});
  },
};

