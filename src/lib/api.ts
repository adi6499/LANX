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
  GroupInfo,
  LockStatus,
  BroadcastResult,
  UpdateStatus,
  SharedInstaller,
  BackupInfo,
  BackupOverview,
  PickedBackup,
  RestoreNotice,
  CallInfo,
  CallEvent,
  SpeedTestResult,
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

export interface TypingPayload {
  conversation_id: string;
  peer_id: string;
  display_name: string;
}

export interface RingPayload {
  conversation_id: string;
  peer_name: string;
}

export interface MessagesDeletedPayload {
  message_ids: string[];
  conversation_ids: string[];
}

export interface UpdateProblemPayload {
  message: string;
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
const ME = "preview-device-7890";

let mockSettings: UserSettings = {
  device_id: ME,
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
  read_receipts: true,
  auto_download_images: true,
  auto_lock_minutes: 5,
  pin_enabled: false,
  sound_enabled: true,
  sound_choice: "chime",
  custom_sound_path: "",
  sound_volume: 80,
  chat_background: "default",
};

let mockLock: LockStatus = { pin_set: false, locked: false, hidden_unlocked: false, retry_after_secs: 0 };

let mockPeers: Peer[] = [
  { id: "peer-sarah", display_name: "Sarah (Accounts)", hostname: "ACCOUNTS-PC", last_ip: "192.168.1.104", tcp_port: 52926, trust_state: "trusted", status: "online", last_seen: now(), avatar_color: "#6366f1", public_key: "a1b2c3" },
  { id: "peer-marcus", display_name: "Marcus (Stores)", hostname: "STORES-01", last_ip: "192.168.1.115", tcp_port: 52926, trust_state: "unverified", status: "online", last_seen: now(), avatar_color: "#10b981", public_key: "d4e5f6" },
  { id: "peer-elena", display_name: "Elena (Sales)", hostname: "SALES-LAPTOP", last_ip: "192.168.1.142", tcp_port: 52926, trust_state: "trusted", status: "offline", last_seen: now() - 3600, avatar_color: "#ec4899", public_key: "778899" },
];

const conv = (c: Partial<Conversation> & Pick<Conversation, "id" | "peer_name">): Conversation => ({
  peer_id: "",
  peer_status: "online",
  peer_avatar_color: "#6366f1",
  peer_ip: "",
  last_message_preview: null,
  last_message_time: now(),
  unread_count: 0,
  is_pinned: false,
  created_at: now() - 86400,
  kind: "direct",
  is_hidden: false,
  secret_ttl: 0,
  member_count: 0,
  membership: "",
  ...c,
});

let mockConversations: Conversation[] = [
  conv({ id: "grp-accounts", peer_name: "Accounts Team", kind: "group", member_count: 4, membership: "member", peer_avatar_color: "#0ea5e9", last_message_preview: "Quarter close on Friday", last_message_time: now() - 60, unread_count: 2 }),
  conv({ id: "conv-sarah", peer_id: "peer-sarah", peer_name: "Sarah (Accounts)", peer_avatar_color: "#6366f1", peer_ip: "192.168.1.104", last_message_preview: "📎 Vendor-Payments-Oct.xlsx", last_message_time: now() - 120, unread_count: 1 }),
  conv({ id: "conv-marcus", peer_id: "peer-marcus", peer_name: "Marcus (Stores)", peer_avatar_color: "#10b981", peer_ip: "192.168.1.115", last_message_preview: "🔒 Secret message", last_message_time: now() - 900, secret_ttl: 300 }),
  conv({ id: "conv-elena", peer_id: "peer-elena", peer_name: "Elena (Sales)", peer_status: "offline", peer_avatar_color: "#ec4899", peer_ip: "192.168.1.142", last_message_preview: "Thanks!", last_message_time: now() - 4000 }),
];

let mockGroups: Record<string, GroupInfo> = {
  "grp-accounts": {
    id: "grp-accounts",
    name: "Accounts Team",
    admin_id: ME,
    version: 3,
    avatar_color: "#0ea5e9",
    membership: "member",
    created_at: now() - 86400,
    members: [
      { device_id: ME, display_name: "Preview User", status: "online", is_admin: true, is_me: true },
      { device_id: "peer-sarah", display_name: "Sarah (Accounts)", status: "online", is_admin: false, is_me: false },
      { device_id: "peer-marcus", display_name: "Marcus (Stores)", status: "online", is_admin: false, is_me: false },
      { device_id: "peer-elena", display_name: "Elena (Sales)", status: "offline", is_admin: false, is_me: false },
    ],
  },
};

let mockTransfers: TransferRecord[] = [
  { id: "tx-1", peer_id: "peer-sarah", peer_name: "Sarah (Accounts)", conversation_id: "conv-sarah", file_name: "Vendor-Payments-Oct.xlsx", file_size: 1_485_760, file_hash: "", direction: "incoming", status: "pending", transferred_bytes: 0, local_path: null, error_reason: null, created_at: now() - 120 },
  { id: "tx-2", peer_id: "peer-sarah", peer_name: "Sarah (Accounts)", conversation_id: "conv-sarah", file_name: "Site-Photos-Dolvi.zip", file_size: 2_400_000_000, file_hash: "", direction: "outgoing", status: "transferring", transferred_bytes: 1_150_000_000, local_path: "D:\\Projects\\Site-Photos-Dolvi.zip", error_reason: null, created_at: now() - 300 },
  { id: "tx-3", peer_id: "peer-elena", peer_name: "Elena (Sales)", conversation_id: "conv-elena", file_name: "Price List 2026.pdf", file_size: 840_000, file_hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", direction: "incoming", status: "completed", transferred_bytes: 840_000, local_path: "C:\\Users\\Public\\Downloads\\Price List 2026.pdf", error_reason: null, created_at: now() - 4000, completed_at: now() - 3990 },
  { id: "tx-g1", peer_id: "peer-sarah", peer_name: "Sarah (Accounts)", conversation_id: "grp-accounts", file_name: "Q3-Closing.xlsx", file_size: 240_000, file_hash: "", direction: "outgoing", status: "completed", transferred_bytes: 240_000, local_path: "D:\\Q3-Closing.xlsx", error_reason: null, created_at: now() - 50, parent_id: "pg-1" },
  { id: "tx-g2", peer_id: "peer-marcus", peer_name: "Marcus (Stores)", conversation_id: "grp-accounts", file_name: "Q3-Closing.xlsx", file_size: 240_000, file_hash: "", direction: "outgoing", status: "pending", transferred_bytes: 0, local_path: "D:\\Q3-Closing.xlsx", error_reason: null, created_at: now() - 50, parent_id: "pg-1" },
  { id: "tx-g3", peer_id: "peer-elena", peer_name: "Elena (Sales)", conversation_id: "grp-accounts", file_name: "Q3-Closing.xlsx", file_size: 240_000, file_hash: "", direction: "outgoing", status: "queued", transferred_bytes: 0, local_path: "D:\\Q3-Closing.xlsx", error_reason: "Waiting for Elena (Sales) to come online", created_at: now() - 50, parent_id: "pg-1" },
];

const msg = (m: Partial<Message> & Pick<Message, "id" | "conversation_id" | "content">): Message => ({
  sender_id: ME,
  receiver_id: "",
  message_type: "text",
  timestamp: now(),
  status: "delivered",
  is_outgoing: true,
  ...m,
});

let mockMessages: Record<string, Message[]> = {
  "grp-accounts": [
    msg({ id: "g-0", conversation_id: "grp-accounts", content: "You created “Accounts Team” with Sarah (Accounts), Marcus (Stores) and Elena (Sales)", message_type: "system", is_outgoing: false, sender_id: "", timestamp: now() - 3000, status: "read" }),
    msg({ id: "g-1", conversation_id: "grp-accounts", content: "Quarter close on Friday — please send your sheets by Thursday.", timestamp: now() - 400, deliveries: { total: 3, delivered: 2, read: 2, queued: 1, failed: 0, read_by: ["Sarah (Accounts)", "Marcus (Stores)"], waiting_for: ["Elena (Sales)"] } }),
    msg({ id: "g-2", conversation_id: "grp-accounts", content: "Will do 👍", sender_id: "peer-sarah", is_outgoing: false, timestamp: now() - 200 }),
    msg({ id: "g-3", conversation_id: "grp-accounts", content: "", message_type: "ring", sender_id: "peer-marcus", is_outgoing: false, timestamp: now() - 120 }),
    msg({ id: "g-4", conversation_id: "grp-accounts", content: "📎 Q3-Closing.xlsx", message_type: "file", transfer_id: "pg-1", timestamp: now() - 50 }),
  ],
  "conv-sarah": [
    msg({ id: "m-1", conversation_id: "conv-sarah", content: "Sending the Dolvi site photos now — it's a big one.", timestamp: now() - 320, status: "read" }),
    msg({ id: "m-2", conversation_id: "conv-sarah", content: "📎 Site-Photos-Dolvi.zip", message_type: "file", transfer_id: "tx-2", timestamp: now() - 300 }),
    msg({ id: "m-3", conversation_id: "conv-sarah", content: "Got it, thanks. Here are this month's vendor payments.", sender_id: "peer-sarah", is_outgoing: false, timestamp: now() - 130, status: "read" }),
    msg({ id: "m-4", conversation_id: "conv-sarah", content: "📎 Vendor-Payments-Oct.xlsx", message_type: "file", transfer_id: "tx-1", sender_id: "peer-sarah", is_outgoing: false, timestamp: now() - 120 }),
  ],
  "conv-marcus": [
    msg({ id: "s-0", conversation_id: "conv-marcus", content: "300", message_type: "secret_setting", timestamp: now() - 1000 }),
    msg({ id: "s-1", conversation_id: "conv-marcus", content: "The locker code is 4417", ttl_secs: 300, expire_at: now() + 240, timestamp: now() - 950, status: "read" }),
    msg({ id: "s-2", conversation_id: "conv-marcus", content: "Got it, thanks", sender_id: "peer-marcus", is_outgoing: false, ttl_secs: 300, expire_at: now() + 280, timestamp: now() - 900 }),
  ],
  "conv-elena": [
    msg({ id: "m-6", conversation_id: "conv-elena", content: "Will send the revised quote after lunch", timestamp: now() - 4100, status: "queued", error_reason: "Waiting for Elena (Sales) to come online" }),
    msg({ id: "m-7", conversation_id: "conv-elena", content: "📎 Price List 2026.pdf", message_type: "file", transfer_id: "tx-3", sender_id: "peer-elena", is_outgoing: false, timestamp: now() - 4000, status: "read" }),
  ],
};

// Preview: Marcus passed on 1.2.1 and it is downloaded; Sarah and Elena are behind.
let mockUpdate: UpdateStatus = {
  current_version: "1.2.0",
  latest_version: "1.2.1",
  available: {
    version: "1.2.1",
    state: "ready",
    from_name: "Marcus (Stores)",
    from_online: true,
    file_size: 6_210_000,
    transfer_id: "upd-1",
    transferred_bytes: 6_210_000,
  },
  sharing: null,
  colleagues: [
    { peer_id: "peer-sarah", display_name: "Sarah (Accounts)", online: true, app_version: "1.2.0", behind: true, state: "behind" },
    { peer_id: "peer-marcus", display_name: "Marcus (Stores)", online: true, app_version: "1.2.1", behind: false, state: "up_to_date" },
    { peer_id: "peer-elena", display_name: "Elena (Sales)", online: false, app_version: "1.1.0", behind: true, state: "behind" },
  ],
  snoozed_until: null,
  auto_chat: true,
};

let mockBackups: BackupOverview = {
  auto_enabled: true,
  folder: "C:\\Users\\You\\AppData\\Roaming\\LANX\\Backups",
  backups: [
    { file_name: "auto-2026-10-16 09.00.00.lanxbackup", path: "", kind: "auto", created_at: now() - 3 * 3600, size_bytes: 412_000, conversations: 4, messages: 213, display_name: "Preview User", app_version: "1.2.0" },
    { file_name: "manual-2026-10-14 17.30.00.lanxbackup", path: "", kind: "manual", created_at: now() - 2 * 86400, size_bytes: 398_000, conversations: 4, messages: 190, display_name: "Preview User", app_version: "1.2.0" },
    { file_name: "auto-2026-10-13 09.00.00.lanxbackup", path: "", kind: "auto", created_at: now() - 3 * 86400, size_bytes: 380_000, conversations: 3, messages: 170, display_name: "Preview User", app_version: "1.1.0" },
  ],
};

const previewOnly = () =>
  Promise.reject("This needs the LANX desktop app — the browser preview cannot open network connections.");

export const api = {
  getSettings: async (): Promise<UserSettings> => {
    if (isTauri) return invoke("get_settings");
    return { ...mockSettings, pin_enabled: mockLock.pin_set };
  },

  saveSettings: async (settings: UserSettings): Promise<UserSettings> => {
    if (isTauri) return invoke("save_settings", { settings });
    mockSettings = { ...settings };
    return { ...mockSettings, pin_enabled: mockLock.pin_set };
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
    return mockConversations.filter((c) => !c.is_hidden || mockLock.hidden_unlocked);
  },

  getOrCreateConversation: async (peerId: string): Promise<Conversation> => {
    if (isTauri) return invoke("get_or_create_conversation", { peerId });
    const existing = mockConversations.find((c) => c.peer_id === peerId);
    if (existing) return existing;
    const peer = mockPeers.find((p) => p.id === peerId);
    const c = conv({
      id: `conv-${peerId}`,
      peer_id: peerId,
      peer_name: peer?.display_name || "Unknown",
      peer_status: peer?.status || "offline",
      peer_avatar_color: peer?.avatar_color || "#3b82f6",
      peer_ip: peer?.last_ip || "",
    });
    mockConversations = [c, ...mockConversations];
    mockMessages[c.id] = [];
    return c;
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
      .filter((m) => (m.message_type === "text" || m.message_type === "file") && !m.ttl_secs && m.content.toLowerCase().includes(q))
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

  /** Marks the chat read and returns its messages (secret timers start now). */
  markConversationRead: async (conversationId: string): Promise<Message[]> => {
    if (isTauri) return invoke("mark_conversation_read", { conversationId });
    mockConversations = mockConversations.map((c) =>
      c.id === conversationId ? { ...c, unread_count: 0 } : c
    );
    return [...(mockMessages[conversationId] || [])];
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

  sendPastedImage: async (conversationId: string, dataBase64: string, mime: string): Promise<SentFile[]> => {
    if (isTauri) return invoke("send_pasted_image", { conversationId, dataBase64, mime });
    return previewOnly();
  },

  getImagePreview: async (transferId: string): Promise<string | null> => {
    if (isTauri) return invoke("get_image_preview", { transferId });
    return null;
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

  pickFiles: async (): Promise<string[]> => {
    if (isTauri) return invoke("pick_files");
    return ["C:\\Users\\Public\\Documents\\Circular.pdf"];
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
      app_version: "1.2.0",
      fingerprint: "3F:9A:12:C4:77:0B:E1:5D",
      tcp_listening: true,
      udp_listening: true,
    };
  },

  testLanConnection: async (ip: string, port: number): Promise<ConnectionTestResult> => {
    if (isTauri) return invoke("test_lan_connection", { ip, port });
    return { reachable: true, ip, port, latency_ms: 2, message: "Preview mode: connection tests run in the desktop app." };
  },

  // ---------------------------------------------------------------- groups
  createGroup: async (name: string, memberIds: string[]): Promise<Conversation> => {
    if (isTauri) return invoke("create_group", { name, memberIds });
    const id = `grp-${Date.now()}`;
    const c = conv({ id, peer_name: name, kind: "group", member_count: memberIds.length + 1, membership: "member", peer_avatar_color: "#8b5cf6" });
    mockConversations = [c, ...mockConversations];
    mockGroups[id] = {
      id, name, admin_id: ME, version: 1, avatar_color: "#8b5cf6", membership: "member", created_at: now(),
      members: [
        { device_id: ME, display_name: mockSettings.display_name, status: "online", is_admin: true, is_me: true },
        ...memberIds.map((pid) => {
          const p = mockPeers.find((x) => x.id === pid)!;
          return { device_id: pid, display_name: p.display_name, status: p.status, is_admin: false, is_me: false };
        }),
      ],
    };
    mockMessages[id] = [msg({ id: `${id}-0`, conversation_id: id, content: `You created “${name}”`, message_type: "system", is_outgoing: false, sender_id: "", status: "read" })];
    return c;
  },

  updateGroup: async (groupId: string, name: string | null, add: string[], remove: string[]): Promise<GroupInfo> => {
    if (isTauri) return invoke("update_group", { groupId, name, add, remove });
    const g = mockGroups[groupId];
    if (name) g.name = name;
    g.members = g.members.filter((m) => !remove.includes(m.device_id));
    for (const pid of add) {
      const p = mockPeers.find((x) => x.id === pid);
      if (p && !g.members.some((m) => m.device_id === pid)) {
        g.members.push({ device_id: pid, display_name: p.display_name, status: p.status, is_admin: false, is_me: false });
      }
    }
    mockConversations = mockConversations.map((c) => (c.id === groupId ? { ...c, peer_name: g.name, member_count: g.members.length } : c));
    return { ...g };
  },

  leaveGroup: async (groupId: string): Promise<void> => {
    if (isTauri) return invoke("leave_group", { groupId });
    mockConversations = mockConversations.map((c) => (c.id === groupId ? { ...c, membership: "left" } : c));
  },

  getGroup: async (groupId: string): Promise<GroupInfo | null> => {
    if (isTauri) return invoke("get_group", { groupId });
    return mockGroups[groupId] ? { ...mockGroups[groupId] } : null;
  },

  // --------------------------------------------------------- lock / hidden
  getLockStatus: async (): Promise<LockStatus> => {
    if (isTauri) return invoke("get_lock_status");
    return { ...mockLock };
  },

  unlock: async (pin: string): Promise<LockStatus> => {
    if (isTauri) return invoke("unlock", { pin });
    if (pin !== "1234") return Promise.reject("Wrong PIN. (Preview PIN is 1234)");
    mockLock = { ...mockLock, locked: false };
    return { ...mockLock };
  },

  lockApp: async (): Promise<LockStatus> => {
    if (isTauri) return invoke("lock_app");
    if (mockLock.pin_set) mockLock = { ...mockLock, locked: true, hidden_unlocked: false };
    return { ...mockLock };
  },

  setPin: async (current: string | null, newPin: string | null): Promise<LockStatus> => {
    if (isTauri) return invoke("set_pin", { current, newPin });
    mockLock = { ...mockLock, pin_set: !!newPin };
    return { ...mockLock };
  },

  unlockHidden: async (pin: string): Promise<LockStatus> => {
    if (isTauri) return invoke("unlock_hidden", { pin });
    if (pin !== "1234") return Promise.reject("Wrong PIN. (Preview PIN is 1234)");
    mockLock = { ...mockLock, hidden_unlocked: true };
    return { ...mockLock };
  },

  hideHiddenChats: async (): Promise<LockStatus> => {
    if (isTauri) return invoke("hide_hidden_chats");
    mockLock = { ...mockLock, hidden_unlocked: false };
    return { ...mockLock };
  },

  setConversationHidden: async (conversationId: string, hidden: boolean): Promise<void> => {
    if (isTauri) return invoke("set_conversation_hidden", { conversationId, hidden });
    if (!mockLock.pin_set) return Promise.reject("Set a PIN first (Settings → Privacy) so hidden chats stay protected.");
    mockConversations = mockConversations.map((c) => (c.id === conversationId ? { ...c, is_hidden: hidden } : c));
  },

  // ------------------------------------------------- secret / typing / ring
  setSecretMode: async (conversationId: string, ttl: number): Promise<Message> => {
    if (isTauri) return invoke("set_secret_mode", { conversationId, ttl });
    mockConversations = mockConversations.map((c) => (c.id === conversationId ? { ...c, secret_ttl: ttl } : c));
    const m = msg({ id: `ss-${Date.now()}`, conversation_id: conversationId, content: String(ttl), message_type: "secret_setting" });
    mockMessages[conversationId] = [...(mockMessages[conversationId] || []), m];
    return m;
  },

  sendTyping: async (conversationId: string): Promise<void> => {
    if (isTauri) return invoke("send_typing", { conversationId });
  },

  ring: async (conversationId: string): Promise<number> => {
    if (isTauri) return invoke("ring", { conversationId });
    const m = msg({ id: `r-${Date.now()}`, conversation_id: conversationId, content: "", message_type: "ring" });
    mockMessages[conversationId] = [...(mockMessages[conversationId] || []), m];
    return 1;
  },

  setContentProtection: async (enabled: boolean): Promise<void> => {
    if (isTauri) return invoke("set_content_protection", { enabled });
  },

  broadcast: async (peerIds: string[], content: string | null, paths: string[]): Promise<BroadcastResult> => {
    if (isTauri) return invoke("broadcast_message", { peerIds, content, paths });
    return { sent_to: peerIds.length, problems: [] };
  },

  // ---------------------------------------------------------- LANX updates
  getUpdateStatus: async (): Promise<UpdateStatus> => {
    if (isTauri) return invoke("get_update_status");
    return { ...mockUpdate };
  },

  /** "Update now": "downloading" | "installing" | "dry_run" (test copies). */
  installUpdate: async (): Promise<string> => {
    if (isTauri) return invoke("install_update");
    if (mockUpdate.available) mockUpdate = { ...mockUpdate, available: { ...mockUpdate.available, state: "installing" } };
    return "installing";
  },

  pickUpdateInstaller: async (): Promise<string | null> => {
    if (isTauri) return invoke("pick_update_installer");
    return "D:\\LANX\\release\\LANX-Setup-1.2.1.exe";
  },

  shareUpdate: async (path: string): Promise<SharedInstaller> => {
    if (isTauri) return invoke("share_update", { path });
    const s: SharedInstaller = { path, file_name: "LANX-Setup-1.2.1.exe", version: "1.2.1", sha256: "9f2c…", size: 6_210_000 };
    mockUpdate = {
      ...mockUpdate,
      sharing: s,
      colleagues: mockUpdate.colleagues.map((c) =>
        c.peer_id === "peer-sarah" ? { ...c, state: "offered" } : c.peer_id === "peer-elena" ? { ...c, state: "chat_sent" } : c
      ),
    };
    return s;
  },

  /** "Remind me tomorrow"; returns when the banner comes back. */
  snoozeUpdate: async (): Promise<number> => {
    if (isTauri) return invoke("snooze_update");
    const until = now() + 86400;
    mockUpdate = { ...mockUpdate, snoozed_until: until };
    return until;
  },

  setUpdateAutoChat: async (enabled: boolean): Promise<void> => {
    if (isTauri) return invoke("set_update_auto_chat", { enabled });
    mockUpdate = { ...mockUpdate, auto_chat: enabled };
  },

  stopSharingUpdate: async (): Promise<void> => {
    if (isTauri) return invoke("stop_sharing_update");
    mockUpdate = { ...mockUpdate, sharing: null };
  },

  sendUpdateAsFile: async (peerIds: string[]): Promise<BroadcastResult> => {
    if (isTauri) return invoke("send_update_as_file", { peerIds });
    return { sent_to: peerIds.length, problems: [] };
  },

  // ---------------------------------------------------------------- sounds
  pickSoundFile: async (): Promise<string | null> => {
    if (isTauri) return invoke("pick_sound_file");
    return "C:\\Users\\Public\\Music\\my-alert.wav";
  },

  playSound: async (name?: string | null, volume?: number, customPath?: string): Promise<void> => {
    if (isTauri) return invoke("play_sound", { name: name ?? null, volume: volume ?? null, customPath: customPath ?? null });
  },

  // --------------------------------------------------------------- backups
  getBackups: async (): Promise<BackupOverview> => {
    if (isTauri) return invoke("get_backups");
    return { ...mockBackups, backups: [...mockBackups.backups] };
  },

  backupNow: async (): Promise<BackupInfo> => {
    if (isTauri) return invoke("backup_now");
    const b: BackupInfo = { ...mockBackups.backups[0], file_name: `manual-${Date.now()}.lanxbackup`, kind: "manual", created_at: now() };
    mockBackups = { ...mockBackups, backups: [b, ...mockBackups.backups] };
    return b;
  },

  setAutoBackup: async (enabled: boolean): Promise<BackupOverview> => {
    if (isTauri) return invoke("set_auto_backup", { enabled });
    mockBackups = { ...mockBackups, auto_enabled: enabled };
    return { ...mockBackups };
  },

  /** Restores a backup from the Backups folder; LANX then restarts. */
  restoreBackup: async (fileName: string): Promise<void> => {
    if (isTauri) return invoke("restore_backup", { fileName });
    return previewOnly();
  },

  /** Saves a password-protected backup file; null if the user cancelled. */
  exportBackup: async (password: string): Promise<string | null> => {
    if (isTauri) return invoke("export_backup", { password });
    if (password.length < 6) return Promise.reject("Use at least 6 characters for the backup password.");
    return "E:\\LANX backup 2026-10-16.lanxbackup";
  },

  pickBackupFile: async (): Promise<PickedBackup | null> => {
    if (isTauri) return invoke("pick_backup_file");
    return { path: "E:\\LANX backup 2026-10-16.lanxbackup", encrypted: true, info: null };
  },

  /** Rejects with "PASSWORD" when the file needs its password. */
  restoreBackupFile: async (path: string, password: string | null): Promise<void> => {
    if (isTauri) return invoke("restore_backup_file", { path, password });
    if (!password) return Promise.reject("PASSWORD");
    return previewOnly();
  },

  revealBackupsFolder: async (): Promise<void> => {
    if (isTauri) return invoke("reveal_backups_folder");
  },

  takeRestoreNotice: async (): Promise<RestoreNotice | null> => {
    if (isTauri) return invoke("take_restore_notice");
    return null;
  },

  // ----------------------------------------------------------------- calls
  callStart: async (conversationId: string, video: boolean, sdp: string): Promise<CallInfo> => {
    if (isTauri) return invoke("call_start", { conversationId, video, sdp });
    const c = mockConversations.find((x) => x.id === conversationId);
    return {
      call_id: `call-${Date.now()}`,
      conversation_id: conversationId,
      peer_id: c?.peer_id ?? "",
      peer_name: c?.peer_name ?? "Colleague",
      avatar_color: c?.peer_avatar_color ?? "#6366f1",
      video,
      outgoing: true,
      phase: "ringing",
      started_at: now(),
      answered_at: null,
      private: false,
    };
  },

  callAnswer: async (callId: string, sdp: string, video: boolean): Promise<CallInfo> => {
    if (isTauri) return invoke("call_answer", { callId, sdp, video });
    return previewOnly();
  },

  callDecline: async (callId: string): Promise<void> => {
    if (isTauri) return invoke("call_decline", { callId });
  },

  callHangup: async (callId: string): Promise<void> => {
    if (isTauri) return invoke("call_hangup", { callId });
  },

  callMedia: async (callId: string, media: { video?: boolean; muted?: boolean; screen?: boolean }): Promise<void> => {
    if (isTauri)
      return invoke("call_media", { callId, video: media.video ?? null, muted: media.muted ?? null, screen: media.screen ?? null });
  },

  // -------------------------------------------------- 1.2.3: speed, folders
  speedTest: async (peerId: string): Promise<SpeedTestResult> => {
    if (isTauri) return invoke("speed_test", { peerId });
    await new Promise((r) => setTimeout(r, 1500));
    return { single_mbps: 4.2, multi_mbps: 11.8, connections: 4 };
  },

  /** Lets the user choose a folder to send; null if cancelled. */
  pickFolderToSend: async (): Promise<string | null> => {
    if (isTauri) return invoke("pick_folder_to_send");
    return "D:\\Projects\\Site Photos";
  },

  getCall: async (): Promise<CallInfo | null> => {
    if (isTauri) return invoke("get_call");
    return null;
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
  onTyping: (cb: (p: TypingPayload) => void) => on<TypingPayload>("lanx://typing", cb),
  onRing: (cb: (p: RingPayload) => void) => on<RingPayload>("lanx://ring", cb),
  onMessagesDeleted: (cb: (p: MessagesDeletedPayload) => void) =>
    on<MessagesDeletedPayload>("lanx://messages-deleted", cb),
  onLockChanged: (cb: (s: LockStatus) => void) => on<LockStatus>("lanx://lock-changed", cb),
  onOpenPrivacySettings: (cb: () => void) => on<null>("lanx://open-privacy-settings", () => cb()),
  onUpdateChanged: (cb: () => void) => on<null>("lanx://update-changed", () => cb()),
  onUpdateProblem: (cb: (p: UpdateProblemPayload) => void) =>
    on<UpdateProblemPayload>("lanx://update-problem", cb),
  onCall: (cb: (e: CallEvent) => void) => on<CallEvent>("lanx://call", cb),
};
