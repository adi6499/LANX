import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import {
  UserSettings,
  Peer,
  Conversation,
  Message,
  TransferRecord,
  TransferProgress,
  SentFile,
  SearchHit,
  SystemInfo,
  ConnectionTestResult,
  TrustState,
} from "../types";

export interface MessageStatusUpdatedPayload {
  message_id: string;
  status: Message["status"];
  error_reason?: string | null;
  message: Message;
}

export interface IncomingMessagePayload {
  message: Message;
  conversation: Conversation | null;
}

export interface PeerOfflinePayload {
  peer_id: string;
}

export interface TransferProgressPayload extends TransferProgress {
  transfer_id: string;
}

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Tauri command errors arrive as plain strings. */
export function errorText(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return String(err);
}

// ---------------------------------------------------------------------------
// Browser preview (npm run dev without the desktop shell): a small in-memory
// demo so the UI can be designed without two computers. Not used in the app.
// ---------------------------------------------------------------------------
const now = () => Math.floor(Date.now() / 1000);

let mockSettings: UserSettings = {
  device_id: "preview-device-7890",
  display_name: "Preview User",
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
  launch_at_startup: true,
  close_to_tray: true,
};

let mockPeers: Peer[] = [
  { id: "peer-sarah", display_name: "Sarah (Accounts)", hostname: "ACCOUNTS-PC", last_ip: "192.168.1.104", tcp_port: 52926, trust_state: "trusted", status: "online", last_seen: now(), avatar_color: "#6366f1", public_key: "a1b2c3" },
  { id: "peer-marcus", display_name: "Marcus (Stores)", hostname: "STORES-01", last_ip: "192.168.1.115", tcp_port: 52926, trust_state: "unverified", status: "online", last_seen: now(), avatar_color: "#10b981", public_key: "d4e5f6" },
  { id: "peer-elena", display_name: "Elena (Sales)", hostname: "SALES-LAPTOP", last_ip: "192.168.1.142", tcp_port: 52926, trust_state: "trusted", status: "offline", last_seen: now() - 3600, avatar_color: "#ec4899", public_key: "778899" },
];

let mockConversations: Conversation[] = [
  { id: "conv-sarah", peer_id: "peer-sarah", peer_name: "Sarah (Accounts)", peer_status: "online", peer_avatar_color: "#6366f1", peer_ip: "192.168.1.104", last_message_preview: "📎 Vendor-Payments-Oct.xlsx", last_message_time: now() - 120, unread_count: 1, is_pinned: false, created_at: now() - 86400 },
  { id: "conv-marcus", peer_id: "peer-marcus", peer_name: "Marcus (Stores)", peer_status: "online", peer_avatar_color: "#10b981", peer_ip: "192.168.1.115", last_message_preview: "Can you check the GRN?", last_message_time: now() - 900, unread_count: 0, is_pinned: false, created_at: now() - 43200 },
  { id: "conv-elena", peer_id: "peer-elena", peer_name: "Elena (Sales)", peer_status: "offline", peer_avatar_color: "#ec4899", peer_ip: "192.168.1.142", last_message_preview: "Thanks!", last_message_time: now() - 4000, unread_count: 0, is_pinned: false, created_at: now() - 100000 },
];

let mockTransfers: TransferRecord[] = [
  { id: "tx-1", peer_id: "peer-sarah", peer_name: "Sarah (Accounts)", conversation_id: "conv-sarah", file_name: "Vendor-Payments-Oct.xlsx", file_size: 1_485_760, file_hash: "", direction: "incoming", status: "pending", transferred_bytes: 0, local_path: null, error_reason: null, created_at: now() - 120 },
  { id: "tx-2", peer_id: "peer-sarah", peer_name: "Sarah (Accounts)", conversation_id: "conv-sarah", file_name: "Site-Photos-Dolvi.zip", file_size: 2_400_000_000, file_hash: "", direction: "outgoing", status: "transferring", transferred_bytes: 1_150_000_000, local_path: "D:\\Projects\\Site-Photos-Dolvi.zip", error_reason: null, created_at: now() - 300 },
  { id: "tx-3", peer_id: "peer-elena", peer_name: "Elena (Sales)", conversation_id: "conv-elena", file_name: "Price List 2026.pdf", file_size: 840_000, file_hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", direction: "incoming", status: "completed", transferred_bytes: 840_000, local_path: "C:\\Users\\Public\\Downloads\\Price List 2026.pdf", error_reason: null, created_at: now() - 4000, completed_at: now() - 3990 },
];

let mockMessages: Record<string, Message[]> = {
  "conv-sarah": [
    { id: "m-1", conversation_id: "conv-sarah", sender_id: "preview-device-7890", receiver_id: "peer-sarah", content: "Sending the Dolvi site photos now — it's a big one.", message_type: "text", timestamp: now() - 320, status: "read", is_outgoing: true },
    { id: "m-2", conversation_id: "conv-sarah", sender_id: "preview-device-7890", receiver_id: "peer-sarah", content: "📎 Site-Photos-Dolvi.zip", message_type: "file", timestamp: now() - 300, status: "delivered", is_outgoing: true, transfer_id: "tx-2" },
    { id: "m-3", conversation_id: "conv-sarah", sender_id: "peer-sarah", receiver_id: "preview-device-7890", content: "Got it, thanks. Here are this month's vendor payments.", message_type: "text", timestamp: now() - 130, status: "read", is_outgoing: false },
    { id: "m-4", conversation_id: "conv-sarah", sender_id: "peer-sarah", receiver_id: "preview-device-7890", content: "📎 Vendor-Payments-Oct.xlsx", message_type: "file", timestamp: now() - 120, status: "delivered", is_outgoing: false, transfer_id: "tx-1" },
  ],
  "conv-marcus": [
    { id: "m-5", conversation_id: "conv-marcus", sender_id: "peer-marcus", receiver_id: "preview-device-7890", content: "Can you check the GRN?", message_type: "text", timestamp: now() - 900, status: "read", is_outgoing: false },
  ],
  "conv-elena": [
    { id: "m-6", conversation_id: "conv-elena", sender_id: "preview-device-7890", receiver_id: "peer-elena", content: "Will send the revised quote after lunch", message_type: "text", timestamp: now() - 4100, status: "queued", error_reason: "Waiting for Elena (Sales) to come online", is_outgoing: true },
    { id: "m-7", conversation_id: "conv-elena", sender_id: "peer-elena", receiver_id: "preview-device-7890", content: "📎 Price List 2026.pdf", message_type: "file", timestamp: now() - 4000, status: "read", is_outgoing: false, transfer_id: "tx-3" },
  ],
};

const previewOnly = () =>
  Promise.reject("This needs the LANX desktop app — the browser preview cannot open network connections.");

export const api = {
  getSettings: async (): Promise<UserSettings> => {
    if (isTauri) return invoke("get_settings");
    return { ...mockSettings };
  },

  saveSettings: async (settings: UserSettings): Promise<UserSettings> => {
    if (isTauri) return invoke("save_settings", { settings });
    mockSettings = { ...settings };
    return { ...mockSettings };
  },

  completeOnboarding: async (
    displayName: string,
    avatarColor: string,
    launchAtStartup: boolean
  ): Promise<UserSettings> => {
    if (isTauri) {
      return invoke("complete_onboarding", { displayName, avatarColor, launchAtStartup });
    }
    mockSettings = {
      ...mockSettings,
      display_name: displayName,
      avatar_color: avatarColor,
      launch_at_startup: launchAtStartup,
      onboarding_completed: true,
    };
    return { ...mockSettings };
  },

  listPeers: async (): Promise<Peer[]> => {
    if (isTauri) return invoke("list_peers");
    return [...mockPeers];
  },

  addManualPeer: async (ip: string, port: number, name?: string): Promise<Peer> => {
    if (isTauri) return invoke("add_manual_peer", { ip, port, name });
    const peer: Peer = {
      id: `manual-${ip}:${port}`,
      display_name: name || `Computer at ${ip}`,
      hostname: "Not reached yet",
      last_ip: ip,
      tcp_port: port,
      trust_state: "unverified",
      status: "offline",
      last_seen: now(),
      avatar_color: "#10b981",
    };
    mockPeers = [peer, ...mockPeers];
    return peer;
  },

  updatePeerTrust: async (peerId: string, trustState: TrustState): Promise<void> => {
    if (isTauri) return invoke("update_peer_trust", { peerId, trustState });
    mockPeers = mockPeers.map((p) => (p.id === peerId ? { ...p, trust_state: trustState } : p));
  },

  getConversations: async (): Promise<Conversation[]> => {
    if (isTauri) return invoke("get_conversations");
    return [...mockConversations];
  },

  getOrCreateConversation: async (peerId: string): Promise<Conversation> => {
    if (isTauri) return invoke("get_or_create_conversation", { peerId });
    const existing = mockConversations.find((c) => c.peer_id === peerId);
    if (existing) return existing;
    const peer = mockPeers.find((p) => p.id === peerId);
    const conv: Conversation = {
      id: `conv-${peerId}`,
      peer_id: peerId,
      peer_name: peer?.display_name || "Unknown",
      peer_status: peer?.status || "offline",
      peer_avatar_color: peer?.avatar_color || "#3b82f6",
      peer_ip: peer?.last_ip || "",
      last_message_preview: null,
      last_message_time: now(),
      unread_count: 0,
      is_pinned: false,
      created_at: now(),
    };
    mockConversations = [conv, ...mockConversations];
    mockMessages[conv.id] = [];
    return conv;
  },

  getMessages: async (conversationId: string): Promise<Message[]> => {
    if (isTauri) return invoke("get_messages", { conversationId });
    return [...(mockMessages[conversationId] || [])];
  },

  searchMessages: async (query: string): Promise<SearchHit[]> => {
    if (isTauri) return invoke("search_messages", { query });
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return Object.values(mockMessages)
      .flat()
      .filter((m) => m.content.toLowerCase().includes(q))
      .map((m) => {
        const c = mockConversations.find((x) => x.id === m.conversation_id);
        return { message: m, peer_name: c?.peer_name || "", peer_avatar_color: c?.peer_avatar_color || "#3b82f6" };
      });
  },

  sendMessage: async (conversationId: string, content: string): Promise<Message> => {
    if (isTauri) return invoke("send_message", { conversationId, content });
    return previewOnly();
  },

  retryMessage: async (messageId: string): Promise<Message> => {
    if (isTauri) return invoke("retry_message", { messageId });
    return previewOnly();
  },

  markConversationRead: async (conversationId: string): Promise<void> => {
    if (isTauri) return invoke("mark_conversation_read", { conversationId });
    mockConversations = mockConversations.map((c) =>
      c.id === conversationId ? { ...c, unread_count: 0 } : c
    );
  },

  deleteConversation: async (conversationId: string): Promise<void> => {
    if (isTauri) return invoke("delete_conversation", { conversationId });
    mockConversations = mockConversations.filter((c) => c.id !== conversationId);
    delete mockMessages[conversationId];
  },

  listTransfers: async (): Promise<TransferRecord[]> => {
    if (isTauri) return invoke("list_transfers");
    return [...mockTransfers];
  },

  pickAndSendFiles: async (conversationId: string): Promise<SentFile[]> => {
    if (isTauri) return invoke("pick_and_send_files", { conversationId });
    return previewOnly();
  },

  sendFiles: async (conversationId: string, paths: string[]): Promise<SentFile[]> => {
    if (isTauri) return invoke("send_files", { conversationId, paths });
    return previewOnly();
  },

  acceptTransfer: async (transferId: string): Promise<TransferRecord> => {
    if (isTauri) return invoke("accept_transfer", { transferId });
    mockTransfers = mockTransfers.map((t) =>
      t.id === transferId ? { ...t, status: "transferring" } : t
    );
    return mockTransfers.find((t) => t.id === transferId)!;
  },

  cancelTransfer: async (transferId: string): Promise<TransferRecord> => {
    if (isTauri) return invoke("cancel_transfer", { transferId });
    mockTransfers = mockTransfers.map((t) =>
      t.id === transferId
        ? { ...t, status: t.status === "pending" && t.direction === "incoming" ? "declined" : "cancelled" }
        : t
    );
    return mockTransfers.find((t) => t.id === transferId)!;
  },

  retryTransfer: async (transferId: string): Promise<TransferRecord> => {
    if (isTauri) return invoke("retry_transfer", { transferId });
    return previewOnly();
  },

  openTransferFile: async (transferId: string): Promise<void> => {
    if (isTauri) return invoke("open_transfer_file", { transferId });
    return previewOnly();
  },

  revealTransferFile: async (transferId: string): Promise<void> => {
    if (isTauri) return invoke("reveal_transfer_file", { transferId });
    return previewOnly();
  },

  openDownloadFolder: async (): Promise<void> => {
    if (isTauri) return invoke("open_download_folder");
    return previewOnly();
  },

  clearFinishedTransfers: async (): Promise<number> => {
    if (isTauri) return invoke("clear_finished_transfers");
    const before = mockTransfers.length;
    mockTransfers = mockTransfers.filter(
      (t) => !["completed", "cancelled", "declined"].includes(t.status)
    );
    return before - mockTransfers.length;
  },

  pickDownloadDir: async (): Promise<string | null> => {
    if (isTauri) return invoke("pick_download_dir");
    return "D:\\LANX Downloads";
  },

  getSystemInfo: async (): Promise<SystemInfo> => {
    if (isTauri) return invoke("get_system_info");
    return {
      device_id: mockSettings.device_id,
      hostname: mockSettings.hostname,
      local_ips: ["192.168.1.88"],
      database_path: "%APPDATA%\\LANX\\lanx.db",
      database_size_bytes: 40960,
      os: "Windows",
      app_version: "1.0.0",
      fingerprint: "3F:9A:12:C4:77:0B:E1:5D",
      tcp_listening: true,
      udp_listening: true,
    };
  },

  testLanConnection: async (ip: string, port: number): Promise<ConnectionTestResult> => {
    if (isTauri) return invoke("test_lan_connection", { ip, port });
    return {
      reachable: true,
      ip,
      port,
      latency_ms: 2,
      message: "Preview mode: connection tests run in the desktop app.",
    };
  },
};

function on<T>(event: string, cb: (payload: T) => void): Promise<UnlistenFn> {
  if (isTauri) return listen<T>(event, (e) => cb(e.payload));
  return Promise.resolve(() => {});
}

export const events = {
  onPeerDiscovered: (cb: (peer: Peer) => void) => on<Peer>("lanx://peer-discovered", cb),
  onPeerOffline: (cb: (data: PeerOfflinePayload) => void) =>
    on<PeerOfflinePayload>("lanx://peer-offline", cb),
  onMessageReceived: (cb: (data: IncomingMessagePayload) => void) =>
    on<IncomingMessagePayload>("lanx://message-received", cb),
  onMessageStatusUpdated: (cb: (data: MessageStatusUpdatedPayload) => void) =>
    on<MessageStatusUpdatedPayload>("lanx://message-status-updated", cb),
  onTransferUpdated: (cb: (t: TransferRecord) => void) =>
    on<TransferRecord>("lanx://transfer-updated", cb),
  onTransferProgress: (cb: (p: TransferProgressPayload) => void) =>
    on<TransferProgressPayload>("lanx://transfer-progress", cb),
  onStateChanged: (cb: () => void) => on<null>("lanx://state-changed", () => cb()),
};
