import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import type { RemoteInput } from "./remote";
import {
  UserSettings,
  Profile,
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
  RemoteInfo,
  ClipboardText,
  ForwardResult,
  ConnectionCheck,
  SpeedTestResult,
  MeetingInfo,
  MeetingEvent,
  MeetingChatLine,
  ScheduledMessage,
  SearchFilter,
  Sticker,
  SyncOverview,
  SyncSubscription,
  ToolsStatus,
  AlertInfo,
  IntercomEvent,
  AdminState,
  AppLink,
  OfficePolicy,
  Note,
  CalendarEvent,
  Occurrence,
  Transcript,
  VoiceModel,
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
  accent_color: "default",
  glass_level: 55,
  frost_level: 60,
  reduce_motion: false,
  cat_alerts: true,
  quiet_hours: { enabled: false, start: 19 * 60, end: 9 * 60, days: [0, 1, 2, 3, 4, 5, 6] },
  chat_folders: [
    { id: "clients", name: "Clients" },
    { id: "site", name: "Site team" },
  ],
  send_to_menu: true,
  screenshot_hotkey: true,
  out_of_office: { enabled: false, until: 0, message: "" },
  reception_desk: true,
  apps: [{ name: "Intranet", target: "https://intranet.company.local", emoji: "🏠" }],
  retention_days: 0,
  quick_replies: ["On my way 🚶", "Give me 5 minutes, please.", "In a meeting — I'll get back to you soon.", "Received, thanks 👍", "Can you call me?", "Done ✅"],
  profile: {
    avatar: "emoji:🦊",
    photo: "",
    status: "available",
    status_text: "",
    status_until: 0,
    title: "Operations",
    department: "Head office",
    phone: "Ext. 204",
    email: "preview@company.local",
    bio: "Happy to help with shipping and stock questions.",
    birthday: "",
  },
};

const mockProfiles: Record<string, Profile> = {
  "peer-sarah": {
    avatar: "emoji:🐼",
    photo: "",
    status: "meeting",
    status_text: "Quarter close",
    status_until: Math.floor(Date.now() / 1000) + 3600,
    title: "Accountant",
    department: "Accounts",
    phone: "Ext. 112",
    email: "sarah@company.local",
    bio: "Invoices, payments and the monthly close.",
    // Preview: Sarah's birthday is today.
    birthday: `${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`,
  },
  "peer-marcus": {
    avatar: "initials",
    photo: "",
    status: "road",
    status_text: "Dolvi site visit",
    status_until: 0,
    title: "Store keeper",
    department: "Stores",
    phone: "",
    email: "",
    bio: "",
    // Preview: Marcus's birthday is in 5 days.
    birthday: (() => {
      const d = new Date(Date.now() + 5 * 86400_000);
      return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    })(),
  },
  "peer-elena": {
    avatar: "emoji:🌸",
    photo: "",
    status: "leave",
    status_text: "Back on Monday",
    status_until: 0,
    title: "Sales lead",
    department: "Sales",
    phone: "+91 98 0000 0000",
    email: "elena@company.local",
    bio: "",
  },
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
  muted_until: 0,
  archived: false,
  folders: [],
  ...c,
});

let mockConversations: Conversation[] = [
  conv({ id: "grp-accounts", peer_name: "Accounts Team", kind: "group", member_count: 4, membership: "member", peer_avatar_color: "#0ea5e9", last_message_preview: "Quarter close on Friday", last_message_time: now() - 60, unread_count: 2 }),
  conv({ id: "conv-sarah", peer_id: "peer-sarah", peer_name: "Sarah (Accounts)", peer_avatar_color: "#6366f1", peer_ip: "192.168.1.104", last_message_preview: "📎 Vendor-Payments-Oct.xlsx", last_message_time: now() - 120, unread_count: 1 }),
  conv({ id: "conv-marcus", peer_id: "peer-marcus", peer_name: "Marcus (Stores)", peer_avatar_color: "#10b981", peer_ip: "192.168.1.115", last_message_preview: "🔒 Secret message", last_message_time: now() - 900, secret_ttl: 300 }),
  conv({ id: "conv-elena", peer_id: "peer-elena", peer_name: "Elena (Sales)", peer_status: "offline", peer_avatar_color: "#ec4899", peer_ip: "192.168.1.142", last_message_preview: "Thanks!", last_message_time: now() - 4000, folders: ["clients"] }),
  conv({ id: "conv-ravi", peer_id: "peer-ravi", peer_name: "Ravi (Transport)", peer_status: "offline", peer_avatar_color: "#f97316", peer_ip: "192.168.1.150", last_message_preview: "☕ Sticker: Coffee?", last_message_time: now() - 90000, archived: true, unread_count: 1 }),
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
  { id: "tx-3", peer_id: "peer-elena", peer_name: "Elena (Sales)", conversation_id: "conv-elena", file_name: "Price List 2026.pdf", file_size: 840_000, file_hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", direction: "incoming", status: "completed", transferred_bytes: 840_000, local_path: "C:\\Users\\Public\\Downloads\\Price List 2026.pdf", error_reason: null, created_at: now() - 4000, completed_at: now() - 3990, duration_ms: 1840, started_bytes: 0 },
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
    msg({
      id: "g-5",
      conversation_id: "grp-accounts",
      message_type: "meeting",
      content: JSON.stringify({
        meeting_id: "mtg-preview",
        title: "Accounts Team",
        outcome: "attended",
        secs: 1520,
        attended: 4,
        host_id: "peer-sarah",
        host_name: "Sarah (Accounts)",
        people: [
          { id: "peer-sarah", name: "Sarah (Accounts)" },
          { id: "peer-marcus", name: "Marcus (Stores)" },
          { id: "peer-elena", name: "Elena (Sales)" },
          { id: "me", name: "Preview User" },
        ],
        chat: [
          { from: "peer-sarah", name: "Sarah (Accounts)", text: "Sharing the Q3 sheet now", at: now() - 1500 },
          { from: "peer-marcus", name: "Marcus (Stores)", text: "Stock count is done for Dolvi", at: now() - 900 },
        ],
      }),
      sender_id: "peer-sarah",
      is_outgoing: false,
      timestamp: now() - 30,
      status: "read",
    }),
    msg({
      id: "g-6",
      conversation_id: "grp-accounts",
      message_type: "recording",
      content: JSON.stringify({
        path: "C:\\Users\\You\\Documents\\LANX Recordings\\Accounts Team - 2026-10-17 11-05.mp4",
        name: "Accounts Team - 2026-10-17 11-05.mp4",
        size: 187_400_000,
        secs: 1490,
        kind: "meeting",
        title: "Accounts Team",
      }),
      timestamp: now() - 25,
      status: "delivered",
    }),
    // LANX 1.6.0 preview cards from colleagues.
    msg({
      id: "g-7",
      conversation_id: "grp-accounts",
      message_type: "card",
      content: JSON.stringify({ kind: "notice", title: "Office closed for Diwali", body: "The office is closed from 31 Oct to 2 Nov. Dispatch resumes on 3 Nov.", important: true, ack: true }),
      sender_id: "peer-sarah",
      is_outgoing: false,
      timestamp: now() - 20,
      card_state: [{ key: "ack:peer-marcus", peer_id: "peer-marcus", name: "Marcus (Stores)", value: true, at: now() - 10 }],
    }),
    msg({
      id: "g-8",
      conversation_id: "grp-accounts",
      message_type: "card",
      content: JSON.stringify({ kind: "approval", title: "Buy 20 bearings (SKF 6205)", details: "Stock is down to 4. Supplier quote attached in the chat.", amount: "₹18,400", approvers: [ME] }),
      sender_id: "peer-marcus",
      is_outgoing: false,
      timestamp: now() - 15,
      card_state: [],
    }),
    msg({
      id: "g-9",
      conversation_id: "grp-accounts",
      message_type: "card",
      content: JSON.stringify({ kind: "poll", question: "Stock count on which day?", options: ["Friday evening", "Saturday morning", "Monday morning"], multi: false }),
      sender_id: "peer-sarah",
      is_outgoing: false,
      timestamp: now() - 12,
      card_state: [
        { key: "vote:peer-marcus", peer_id: "peer-marcus", name: "Marcus (Stores)", value: [1], at: now() - 8 },
        { key: "vote:peer-elena", peer_id: "peer-elena", name: "Elena (Sales)", value: [1], at: now() - 6 },
      ],
    }),
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
  send_everyone: false,
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

let mockNotes: Note[] = [];
let mockEvents: CalendarEvent[] = [];
const mockPrefs: Record<string, string> = {};

export const api = {
  /** LANX 1.3.0: say hello to every computer on the local network; returns
   *  how many colleagues are online a few seconds later. */
  searchNetwork: async (): Promise<number> => {
    if (isTauri) return invoke("search_network");
    await new Promise((r) => setTimeout(r, 1500));
    return mockPeers.filter((p) => p.status === "online").length;
  },

  /** LANX 1.2.9: colleagues' profiles by device id. */
  getPeerProfiles: async (): Promise<Record<string, Profile>> => {
    if (isTauri) return invoke("get_peer_profiles");
    return { ...mockProfiles };
  },

  refreshPeerProfile: async (peerId: string): Promise<Profile> => {
    if (isTauri) return invoke("refresh_peer_profile", { peerId });
    if (mockProfiles[peerId]) return mockProfiles[peerId];
    throw new Error("No profile");
  },

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
      tcp_port: 52926,
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

  /** LANX 2.0: send the shared update to these colleagues. Returns how many. */
  sendUpdateTo: async (peerIds: string[]): Promise<number> => {
    if (isTauri) return invoke("send_update_to", { peerIds });
    mockUpdate = {
      ...mockUpdate,
      colleagues: mockUpdate.colleagues.map((c) => (peerIds.includes(c.peer_id) ? { ...c, state: "waiting" } : c)),
    };
    return peerIds.length;
  },
  unsendUpdate: async (peerIds: string[]): Promise<void> => {
    if (isTauri) return invoke("unsend_update", { peerIds });
    mockUpdate = {
      ...mockUpdate,
      colleagues: mockUpdate.colleagues.map((c) => (peerIds.includes(c.peer_id) ? { ...c, state: "not_chosen" } : c)),
    };
  },
  setUpdateSendEveryone: async (enabled: boolean): Promise<void> => {
    if (isTauri) return invoke("set_update_send_everyone", { enabled });
    mockUpdate = { ...mockUpdate, send_everyone: enabled };
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
  callStart: async (conversationId: string, video: boolean, sdp: string, help: "view" | "show" | null = null): Promise<CallInfo> => {
    if (isTauri) return invoke("call_start", { conversationId, video, sdp, help });
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

  callMedia: async (
    callId: string,
    media: { video?: boolean; muted?: boolean; screen?: boolean; recording?: boolean }
  ): Promise<void> => {
    if (isTauri)
      return invoke("call_media", {
        callId,
        video: media.video ?? null,
        muted: media.muted ?? null,
        screen: media.screen ?? null,
        recording: media.recording ?? null,
      });
  },

  // ---------------------------------------------------- 1.5.0: chatting
  /** A message that may answer another one and @mention group members. */
  sendMessageEx: async (conversationId: string, content: string, replyTo?: string | null, mentions?: string[]): Promise<Message> => {
    if (isTauri) return invoke("send_message_ex", { conversationId, content, replyTo: replyTo ?? null, mentions: mentions ?? [] });
    // Browser preview: pretend it was sent.
    const orig = replyTo ? (mockMessages[conversationId] || []).find((x) => x.id === replyTo) : undefined;
    const m = msg({
      id: `local-${Date.now()}`,
      conversation_id: conversationId,
      content,
      reply_to: replyTo ?? null,
      reply_preview: orig ? `${orig.is_outgoing ? "You" : "Colleague"}: ${orig.content}` : null,
      mentions: mentions ?? [],
    });
    mockMessages[conversationId] = [...(mockMessages[conversationId] || []), m];
    return m;
  },
  reactMessage: async (messageId: string, emoji: string): Promise<Message> => {
    if (isTauri) return invoke("react_message", { messageId, emoji });
    return mockPatch(messageId, (m) => {
      const list = [...(m.reactions ?? [])].map((r) => ({ ...r, names: [...r.names] }));
      const mine = list.find((r) => r.mine);
      if (mine) {
        mine.count -= 1;
        mine.mine = false;
        mine.names = mine.names.filter((n) => n !== "You");
      }
      if (!mine || mine.emoji !== emoji) {
        const r = list.find((x) => x.emoji === emoji);
        if (r) {
          r.count += 1;
          r.mine = true;
          r.names.push("You");
        } else list.push({ emoji, count: 1, mine: true, names: ["You"] });
      }
      return { ...m, reactions: list.filter((r) => r.count > 0) };
    });
  },
  editMessage: async (messageId: string, content: string, mentions?: string[]): Promise<Message> => {
    if (isTauri) return invoke("edit_message", { messageId, content, mentions: mentions ?? [] });
    return mockPatch(messageId, (m) => ({ ...m, content, edited_at: now() }));
  },
  deleteMessageEveryone: async (messageId: string): Promise<Message> => {
    if (isTauri) return invoke("delete_message_everyone", { messageId });
    return mockPatch(messageId, (m) => ({ ...m, content: "", deleted: true, reactions: [] }));
  },
  deleteMessageLocal: async (messageId: string): Promise<void> => {
    if (isTauri) return invoke("delete_message_local", { messageId });
    for (const k of Object.keys(mockMessages)) mockMessages[k] = mockMessages[k].filter((m) => m.id !== messageId);
  },
  pinMessage: async (messageId: string, pinned: boolean): Promise<Message> => {
    if (isTauri) return invoke("pin_message", { messageId, pinned });
    return mockPatch(messageId, (m) => ({ ...m, pinned_at: pinned ? now() : null, pinned_by: pinned ? "me" : null }));
  },
  starMessage: async (messageId: string, starred: boolean): Promise<Message> => {
    if (isTauri) return invoke("star_message", { messageId, starred });
    return mockPatch(messageId, (m) => ({ ...m, starred }));
  },
  listStarred: async (): Promise<SearchHit[]> => {
    if (isTauri) return invoke("list_starred");
    return Object.values(mockMessages)
      .flat()
      .filter((m) => m.starred)
      .map((m) => {
        const c = mockConversations.find((x) => x.id === m.conversation_id);
        return { message: m, peer_name: c?.peer_name ?? "", peer_avatar_color: c?.peer_avatar_color ?? "#6366f1" };
      });
  },
  /** `noReply` (LANX 2.2.0): only if nobody replied by then. */
  setReminder: async (messageId: string, remindAt: number, noReply = false): Promise<Message> => {
    if (isTauri) return invoke("set_reminder", { messageId, remindAt, noReply });
    return mockPatch(messageId, (m) => ({ ...m, remind_at: remindAt, remind_no_reply: noReply }));
  },

  // ------------------------------------------------------ LANX 2.2.0 everyday
  forwardMessages: async (messageIds: string[], conversationIds: string[]): Promise<ForwardResult> => {
    if (isTauri) return invoke("forward_messages", { messageIds, conversationIds });
    return { sent: messageIds.length * conversationIds.length, problems: [] };
  },
  markChatUnread: async (conversationId: string): Promise<Conversation> => {
    if (isTauri) return invoke("mark_chat_unread", { conversationId });
    const c = mockConversations.find((x) => x.id === conversationId)!;
    return { ...c, unread_count: Math.max(1, c.unread_count) };
  },
  checkConnection: async (peerId: string): Promise<ConnectionCheck> => {
    if (isTauri) return invoke("check_connection", { peerId });
    return {
      ok: true,
      verdict: "All good: messages, files and calls reach them (3 ms).",
      steps: [
        { label: "LANX sees their PC on the network", ok: true, detail: "Heard from it 4 seconds ago" },
        { label: "On the same network as this PC", ok: true, detail: "Their address 192.168.1.24 · this PC 192.168.1.10" },
        { label: "Their PC answers", ok: true, detail: "Answered in 2 ms" },
        { label: "Secure LANX connection", ok: true, detail: "Encrypted connection made in 3 ms" },
      ],
      latency_ms: 3,
    };
  },
  cancelReminder: async (messageId: string): Promise<Message> => {
    if (isTauri) return invoke("cancel_reminder", { messageId });
    return mockPatch(messageId, (m) => ({ ...m, remind_at: null }));
  },
  scheduleMessage: async (conversationId: string, content: string, sendAt: number, replyTo?: string | null, mentions?: string[]): Promise<ScheduledMessage> => {
    if (isTauri) return invoke("schedule_message", { conversationId, content, sendAt, replyTo: replyTo ?? null, mentions: mentions ?? [] });
    const s = { id: `s-${Date.now()}`, conversation_id: conversationId, content, reply_to: replyTo ?? null, mentions: mentions ?? [], send_at: sendAt, created_at: now() };
    mockScheduled.push(s);
    return s;
  },
  cancelScheduled: async (id: string, conversationId: string): Promise<void> => {
    if (isTauri) return invoke("cancel_scheduled", { id, conversationId });
    mockScheduled = mockScheduled.filter((s) => s.id !== id);
  },
  listScheduled: async (conversationId: string): Promise<ScheduledMessage[]> => {
    if (isTauri) return invoke("list_scheduled", { conversationId });
    return mockScheduled.filter((s) => s.conversation_id === conversationId);
  },
  /** A recorded voice note (raw bytes). */
  sendVoiceNote: async (conversationId: string, data: Uint8Array, durationMs: number, ext: string): Promise<SentFile[]> => {
    if (isTauri)
      return invoke("send_voice_note", data, {
        headers: { "x-conversation": conversationId, "x-duration-ms": String(Math.round(durationMs)), "x-ext": ext },
      });
    return previewOnly();
  },
  /** The sound of a voice note on this computer. */
  readVoiceNote: async (transferId: string): Promise<ArrayBuffer> => {
    if (isTauri) return invoke("read_voice_note", { transferId });
    return previewOnly();
  },

  // -------------------------------------------------- 1.6.0: organising
  /** Posts a card (notice, poll, task, approval, checklist, meeting). */
  sendCard: async (conversationId: string, card: Record<string, unknown>): Promise<Message> => {
    if (isTauri) return invoke("send_card", { conversationId, card });
    const m = msg({ id: `card-${Date.now()}`, conversation_id: conversationId, content: JSON.stringify(card), message_type: "card", card_state: [] });
    mockMessages[conversationId] = [...(mockMessages[conversationId] || []), m];
    return m;
  },
  /** Vote, tick, decide, answer on a card. */
  cardAction: async (messageId: string, key: string, value: unknown): Promise<Message> => {
    if (isTauri) return invoke("card_action", { messageId, key, value });
    return mockPatch(messageId, (m) => {
      const rest = (m.card_state ?? []).filter((e) => e.key !== key);
      return { ...m, card_state: [...rest, { key, peer_id: ME, name: "You", value, at: now() }] };
    });
  },
  /** Every card in every chat, for the Organiser. */
  // ------------------------------------------------ LANX 2.3.0 IT help desk
  getItHelpers: async (): Promise<string[]> => {
    if (isTauri) return invoke("get_it_helpers");
    return [];
  },
  setItHelpers: async (peerIds: string[]): Promise<void> => {
    if (isTauri) return invoke("set_it_helpers", { peerIds });
  },
  getReportTo: async (): Promise<string[]> => {
    if (isTauri) return invoke("get_report_to");
    return [];
  },
  setReportTo: async (peerIds: string[]): Promise<void> => {
    if (isTauri) return invoke("set_report_to", { peerIds });
  },

  listCards: async (): Promise<SearchHit[]> => {
    if (isTauri) return invoke("list_cards");
    return Object.values(mockMessages)
      .flat()
      .filter((m) => m.message_type === "card" && !m.deleted)
      .sort((a, b) => b.timestamp - a.timestamp)
      .map((m) => {
        const c = mockConversations.find((x) => x.id === m.conversation_id);
        return { message: m, peer_name: c?.peer_name ?? "", peer_avatar_color: c?.peer_avatar_color ?? "#6366f1" };
      });
  },

  // ------------------------------------------------------ 1.4.0: meetings
  meetingStart: async (conversationId: string, video: boolean, title?: string): Promise<MeetingInfo> => {
    if (isTauri) return invoke("meeting_start", { conversationId, video, title: title ?? null });
    return mockMeeting(conversationId, video);
  },
  /** Returns who couldn't be invited and why. */
  meetingInvite: async (meetingId: string, peerIds: string[]): Promise<string[]> => {
    if (isTauri) return invoke("meeting_invite", { meetingId, peerIds });
    return [];
  },
  meetingJoin: async (meetingId: string): Promise<MeetingInfo> => {
    if (isTauri) return invoke("meeting_join", { meetingId });
    return previewOnly();
  },
  meetingRejoin: async (messageId: string): Promise<MeetingInfo> => {
    if (isTauri) return invoke("meeting_rejoin", { messageId });
    return previewOnly();
  },
  meetingDecline: async (meetingId: string): Promise<void> => {
    if (isTauri) return invoke("meeting_decline", { meetingId });
  },
  meetingLeave: async (meetingId: string): Promise<void> => {
    if (isTauri) return invoke("meeting_leave", { meetingId });
  },
  meetingSignal: async (meetingId: string, to: string, kind: "offer" | "answer", sdp: string): Promise<void> => {
    if (isTauri) return invoke("meeting_signal", { meetingId, to, kind, sdp });
  },
  meetingMedia: async (
    meetingId: string,
    m: { muted?: boolean; camera?: boolean; screen?: boolean; hand?: boolean; recording?: boolean }
  ): Promise<void> => {
    if (isTauri)
      return invoke("meeting_media", {
        meetingId,
        muted: m.muted ?? null,
        camera: m.camera ?? null,
        screen: m.screen ?? null,
        hand: m.hand ?? null,
        recording: m.recording ?? null,
      });
  },
  meetingChat: async (meetingId: string, text: string): Promise<MeetingChatLine> => {
    if (isTauri) return invoke("meeting_chat", { meetingId, text });
    return { from: "me", name: "You", text, at: now() };
  },
  meetingDrop: async (meetingId: string, peerId: string): Promise<void> => {
    if (isTauri) return invoke("meeting_drop", { meetingId, peerId });
  },
  getMeeting: async (): Promise<MeetingInfo | null> => {
    if (isTauri) return invoke("get_meeting");
    return null;
  },

  // ---------------------------------------------------- 1.4.0: recordings
  recordingBegin: async (title: string, ext: "mp4" | "webm"): Promise<{ id: string; name: string }> => {
    if (isTauri) return invoke("recording_begin", { title, ext });
    return { id: `rec-${Date.now()}`, name: `${title}.${ext}` };
  },
  /** A piece of the recording, sent as raw bytes. */
  recordingChunk: async (id: string, data: Uint8Array): Promise<number> => {
    if (isTauri) return invoke("recording_chunk", data, { headers: { "x-recording": id } });
    return data.length;
  },
  recordingEnd: async (
    id: string,
    conversationId: string | null,
    title: string,
    kind: "meeting" | "call",
    secs: number
  ): Promise<string> => {
    if (isTauri) return invoke("recording_end", { id, conversationId, title, kind, secs });
    return `C:\\Users\\You\\Documents\\LANX Recordings\\${title}.mp4`;
  },
  recordingCancel: async (id: string): Promise<void> => {
    if (isTauri) return invoke("recording_cancel", { id });
  },
  openRecording: async (path: string): Promise<void> => {
    if (isTauri) return invoke("open_recording", { path });
  },
  revealRecording: async (path: string): Promise<void> => {
    if (isTauri) return invoke("reveal_recording", { path });
  },
  openRecordingsFolder: async (): Promise<string> => {
    if (isTauri) return invoke("open_recordings_folder");
    return "Documents\\LANX Recordings";
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

  // ------------------------------------------------- remote control (2.0)
  /** This PC's person pressed Allow: `width` × `height` = the shared screen picture. */
  remoteAllow: async (callId: string, width: number, height: number): Promise<RemoteInfo> => {
    if (isTauri) return invoke("remote_allow", { callId, width, height });
    throw new Error("Remote control needs the LANX app.");
  },
  /** LANX 2.1.0: says whether Windows refused some of it. */
  remoteInput: async (callId: string, events: RemoteInput[]): Promise<{ blocked: boolean }> => {
    if (isTauri) return invoke("remote_input", { callId, events });
    return { blocked: false };
  },
  remoteStop: async (): Promise<void> => {
    if (isTauri) return invoke("remote_stop");
  },
  remoteNextScreen: async (callId: string): Promise<RemoteInfo> => {
    if (isTauri) return invoke("remote_next_screen", { callId });
    throw new Error("Remote control needs the LANX app.");
  },
  remoteInfo: async (): Promise<RemoteInfo | null> => {
    if (isTauri) return invoke("remote_info");
    return null;
  },
  remoteAttention: async (): Promise<void> => {
    if (isTauri) return invoke("remote_attention");
  },
  clipboardRead: async (callId: string, since: number): Promise<ClipboardText> => {
    if (isTauri) return invoke("clipboard_read", { callId, since });
    return { seq: since, text: null };
  },
  clipboardWrite: async (callId: string, text: string): Promise<number> => {
    if (isTauri) return invoke("clipboard_write", { callId, text });
    return 0;
  },

  // ------------------------------------------------------- 1.7.0: tools
  setChatPinned: async (conversationId: string, pinned: boolean): Promise<Conversation> => {
    if (isTauri) return invoke("set_chat_pinned", { conversationId, pinned });
    return mockConv(conversationId, { is_pinned: pinned });
  },
  /** minutes: -1 = until turned back on, 0 = sounds back on. */
  setChatMuted: async (conversationId: string, minutes: number): Promise<Conversation> => {
    if (isTauri) return invoke("set_chat_muted", { conversationId, minutes });
    return mockConv(conversationId, { muted_until: minutes < 0 ? -1 : minutes === 0 ? 0 : now() + minutes * 60 });
  },
  setChatArchived: async (conversationId: string, archived: boolean): Promise<Conversation> => {
    if (isTauri) return invoke("set_chat_archived", { conversationId, archived });
    return mockConv(conversationId, { archived });
  },
  setChatFolders: async (conversationId: string, folders: string[]): Promise<Conversation> => {
    if (isTauri) return invoke("set_chat_folders", { conversationId, folders });
    return mockConv(conversationId, { folders });
  },
  searchMessagesEx: async (query: string, filter: SearchFilter): Promise<SearchHit[]> => {
    if (isTauri) return invoke("search_messages_ex", { query, filter });
    const q = query.trim().toLowerCase();
    const since = filter.since ?? 0;
    return Object.values(mockMessages)
      .flat()
      .filter((m) => ["text", "file", "card"].includes(m.message_type) && !m.ttl_secs)
      .filter((m) => !q || m.content.toLowerCase().includes(q))
      .filter((m) => !filter.conversation_id || m.conversation_id === filter.conversation_id)
      .filter((m) => !filter.sender || (filter.sender === "me" ? m.is_outgoing : !m.is_outgoing && m.sender_id === filter.sender))
      .filter((m) => m.timestamp >= since)
      .filter((m) => {
        switch (filter.kind) {
          case "text":
            return m.message_type === "text";
          case "files":
            return m.message_type === "file";
          case "links":
            return m.message_type === "text" && /https?:\/\/|www\./i.test(m.content);
          case "cards":
            return m.message_type === "card";
          default:
            return true;
        }
      })
      .sort((a, b) => b.timestamp - a.timestamp)
      .map((m) => {
        const c = mockConversations.find((x) => x.id === m.conversation_id);
        return { message: m, peer_name: c?.peer_name ?? "", peer_avatar_color: c?.peer_avatar_color ?? "#6366f1" };
      });
  },
  messageForTransfer: async (transferId: string): Promise<Message | null> => {
    if (isTauri) return invoke("message_for_transfer", { transferId });
    const t = mockTransfers.find((x) => x.id === transferId);
    const key = t?.parent_id ?? transferId;
    return Object.values(mockMessages).flat().find((m) => m.transfer_id === key) ?? null;
  },
  listStickers: async (): Promise<Sticker[]> => {
    if (isTauri) return invoke("list_stickers");
    return MOCK_STICKERS;
  },
  sendSticker: async (conversationId: string, id: string): Promise<Message> => {
    if (isTauri) return invoke("send_sticker", { conversationId, id });
    const m = msg({ id: `st-${Date.now()}`, conversation_id: conversationId, content: id, message_type: "sticker" });
    mockMessages[conversationId] = [...(mockMessages[conversationId] || []), m];
    return m;
  },
  /** Hides LANX for a moment and pictures the whole screen. */
  captureScreen: async (): Promise<ArrayBuffer> => {
    if (isTauri) return invoke("capture_screen");
    return mockScreenshot();
  },
  /** The picture taken with Ctrl + Alt + S. */
  takeHotkeyCapture: async (): Promise<ArrayBuffer> => {
    if (isTauri) return invoke("take_hotkey_capture");
    return mockScreenshot();
  },
  /** Saves to Pictures\LANX Screenshots; returns where. */
  saveScreenshot: async (dataBase64: string): Promise<string> => {
    if (isTauri) return invoke("save_screenshot", { dataBase64 });
    return "C:\\Users\\You\\Pictures\\LANX Screenshots\\Screenshot.png";
  },
  getToolsStatus: async (): Promise<ToolsStatus> => {
    if (isTauri) return invoke("get_tools_status");
    return { hotkey: "Ctrl + Alt + S", hotkey_working: true };
  },
  /** Files and folders from Explorer's "Send to → LANX". */
  takeSendRequest: async (): Promise<string[]> => {
    if (isTauri) return invoke("take_send_request");
    return [];
  },
  pickFolder: async (title: string): Promise<string | null> => {
    if (isTauri) return invoke("pick_folder", { title });
    return "D:\\Shared\\Price Lists";
  },
  shareFolder: async (conversationId: string, path: string): Promise<Message> => {
    if (isTauri) return invoke("share_folder", { conversationId, path });
    const name = path.split(/[\\/]/).pop() || "Shared folder";
    const id = `share-${Date.now()}`;
    mockSync.shares.push({ id, name, path, conversation_id: conversationId, created_at: now(), active: true, subscribers: [], waiting: 0 });
    const m = msg({ id: `card-${Date.now()}`, conversation_id: conversationId, message_type: "card", content: JSON.stringify({ kind: "sync", name, share_id: id, files: 42, bytes: 18_400_000 }), card_state: [] });
    mockMessages[conversationId] = [...(mockMessages[conversationId] || []), m];
    return m;
  },
  subscribeFolder: async (messageId: string, dest: string): Promise<SyncSubscription> => {
    if (isTauri) return invoke("subscribe_folder", { messageId, dest });
    const m = Object.values(mockMessages).flat().find((x) => x.id === messageId);
    const c = m ? JSON.parse(m.content) : {};
    const sub: SyncSubscription = { share_id: c.share_id, owner_id: m?.sender_id ?? "", owner_name: "Sarah (Accounts)", name: c.name, dest_path: dest, conversation_id: m?.conversation_id ?? "", since: now(), files: 0, bytes: 0, last_at: 0, status: "active" };
    mockSync.subscriptions = [...mockSync.subscriptions.filter((s) => s.share_id !== sub.share_id), sub];
    return sub;
  },
  unsubscribeFolder: async (shareId: string): Promise<void> => {
    if (isTauri) return invoke("unsubscribe_folder", { shareId });
    mockSync.subscriptions = mockSync.subscriptions.filter((s) => s.share_id !== shareId);
  },
  stopSharingFolder: async (shareId: string): Promise<void> => {
    if (isTauri) return invoke("stop_sharing_folder", { shareId });
    mockSync.shares = mockSync.shares.filter((s) => s.id !== shareId);
  },
  resyncFolder: async (shareId: string): Promise<void> => {
    if (isTauri) return invoke("resync_folder", { shareId });
  },
  listSync: async (): Promise<SyncOverview> => {
    if (isTauri) return invoke("list_sync");
    return { shares: [...mockSync.shares], subscriptions: [...mockSync.subscriptions] };
  },
  openSyncFolder: async (shareId: string): Promise<void> => {
    if (isTauri) return invoke("open_sync_folder", { shareId });
  },

  // ------------------------------------------------------ 1.8.0: office
  raiseAlert: async (kind: string, text: string): Promise<AlertInfo> => {
    if (isTauri) return invoke("raise_alert", { kind, text });
    const a: AlertInfo = { id: `alert-${Date.now()}`, from_id: ME, from_name: "Preview User", kind: kind as AlertInfo["kind"], text: text || "Fire! Leave the building now by the nearest exit.", at: now(), cleared_at: null, mine: true, my_ack: null, sent_to: ["Sarah (Accounts)", "Marcus (Stores)"], acks: [{ peer_id: "peer-sarah", name: "Sarah (Accounts)", status: "safe", at: now() }] };
    mockAlerts = [a, ...mockAlerts];
    return a;
  },
  answerAlert: async (alertId: string, status: "safe" | "help"): Promise<AlertInfo> => {
    if (isTauri) return invoke("answer_alert", { alertId, status });
    mockAlerts = mockAlerts.map((a) => (a.id === alertId ? { ...a, my_ack: status } : a));
    return mockAlerts.find((a) => a.id === alertId)!;
  },
  clearAlert: async (alertId: string): Promise<AlertInfo> => {
    if (isTauri) return invoke("clear_alert", { alertId });
    mockAlerts = mockAlerts.map((a) => (a.id === alertId ? { ...a, cleared_at: now() } : a));
    return mockAlerts.find((a) => a.id === alertId)!;
  },
  listAlerts: async (): Promise<AlertInfo[]> => {
    if (isTauri) return invoke("list_alerts");
    return mockAlerts;
  },
  // ------------------------------------------------------- 1.9.0: admin
  getAdminState: async (): Promise<AdminState> => {
    if (isTauri) return invoke("get_admin_state");
    return mockAdminState();
  },
  becomeAdmin: async (): Promise<AdminState> => {
    if (isTauri) return invoke("become_admin");
    mockAdmin.my_policy = { version: 1, admin_id: ME, admin_name: "Preview User", active: true, apps: [], retention_days: 0, backup_dir: "", backup_password: "", at: now() };
    mockAdmin.peers = [
      { peer_id: "peer-sarah", version: 1, status: "accepted", app_version: "1.9.0", at: now() },
      { peer_id: "peer-marcus", version: 1, status: "waiting", app_version: "1.9.0", at: now() },
      { peer_id: "peer-elena", version: 0, status: "old", app_version: "1.4.0", at: now() },
    ];
    return mockAdminState();
  },
  savePolicy: async (policy: OfficePolicy): Promise<AdminState> => {
    if (isTauri) return invoke("save_policy", { policy });
    mockAdmin.my_policy = { ...policy, version: (mockAdmin.my_policy?.version ?? 0) + 1 };
    return mockAdminState();
  },
  stopAdmin: async (): Promise<AdminState> => {
    if (isTauri) return invoke("stop_admin");
    mockAdmin.my_policy = null;
    mockAdmin.peers = [];
    return mockAdminState();
  },
  answerPolicyOffer: async (accept: boolean): Promise<AdminState> => {
    if (isTauri) return invoke("answer_policy_offer", { accept });
    if (accept) mockAdmin.policy = mockAdmin.offer;
    mockAdmin.offer = null;
    return mockAdminState();
  },
  leavePolicy: async (): Promise<AdminState> => {
    if (isTauri) return invoke("leave_policy");
    mockAdmin.policy = null;
    return mockAdminState();
  },
  setRetention: async (days: number): Promise<AdminState> => {
    if (isTauri) return invoke("set_retention", { days });
    mockSettings = { ...mockSettings, retention_days: days };
    return mockAdminState();
  },
  runRetention: async (): Promise<number> => {
    if (isTauri) return invoke("run_retention");
    return 0;
  },
  setMyApps: async (apps: AppLink[]): Promise<AdminState> => {
    if (isTauri) return invoke("set_my_apps", { apps });
    mockSettings = { ...mockSettings, apps };
    return mockAdminState();
  },
  openAppLink: async (target: string): Promise<void> => {
    if (isTauri) return invoke("open_app_link", { target });
    window.open(target, "_blank");
  },
  /** Saves rows as .xlsx (Windows asks where); null if cancelled. */
  exportExcel: async (fileName: string, sheet: string, rows: string[][]): Promise<string | null> => {
    if (isTauri) return invoke("export_excel", { fileName, sheet, rows });
    console.table(rows.slice(0, 5));
    return `C:\\Users\\You\\Documents\\${fileName}.xlsx`;
  },
  openExported: async (path: string): Promise<void> => {
    if (isTauri) return invoke("open_exported", { path });
  },
  setNetBackup: async (dir: string, password: string | null): Promise<BackupOverview> => {
    if (isTauri) return invoke("set_net_backup", { dir, password });
    mockBackups = { ...mockBackups, net_dir: dir, net_has_password: !!password || !!mockBackups.net_has_password, net_error: "" };
    return mockBackups;
  },
  netBackupNow: async (): Promise<BackupOverview> => {
    if (isTauri) return invoke("net_backup_now");
    mockBackups = { ...mockBackups, net_last_at: now(), net_error: "" };
    return mockBackups;
  },

  /** Push-to-talk: the recording plays by itself for colleagues who are online. */
  sendIntercom: async (conversationId: string, data: Uint8Array, durationMs: number, ext: string): Promise<SentFile[]> => {
    if (isTauri)
      return invoke("send_intercom", data, {
        headers: { "x-conversation": conversationId, "x-duration-ms": String(Math.round(durationMs)), "x-ext": ext },
      });
    return previewOnly();
  },
  // -------------------------------------------------- 2.5.0: work tools
  /** Notes app. */
  listNotes: async (deleted = false): Promise<Note[]> => {
    if (isTauri) return invoke("list_notes", { deleted });
    return mockNotes.filter((n) => (deleted ? n.deleted_at !== null : n.deleted_at === null));
  },
  saveNote: async (note: Note): Promise<Note> => {
    if (isTauri) return invoke("save_note", { note });
    const t = Math.floor(Date.now() / 1000);
    const saved = { ...note, id: note.id || `note-${t}-${Math.random().toString(36).slice(2, 8)}`, created_at: note.created_at || t, updated_at: t, deleted_at: null };
    mockNotes = [saved, ...mockNotes.filter((n) => n.id !== saved.id)];
    return saved;
  },
  deleteNote: async (id: string, forGood = false): Promise<boolean> => {
    if (isTauri) return invoke("delete_note", { id, forGood });
    mockNotes = forGood ? mockNotes.filter((n) => n.id !== id) : mockNotes.map((n) => (n.id === id ? { ...n, deleted_at: Math.floor(Date.now() / 1000) } : n));
    return true;
  },
  restoreNote: async (id: string): Promise<boolean> => {
    if (isTauri) return invoke("restore_note", { id });
    mockNotes = mockNotes.map((n) => (n.id === id ? { ...n, deleted_at: null } : n));
    return true;
  },

  /** Calendar. */
  listEvents: async (from: number, to: number): Promise<Occurrence[]> => {
    if (isTauri) return invoke("list_events", { from, to });
    return mockEvents.filter((e) => e.end > from && e.start < to).map((e) => ({ event: e, start: e.start, end: e.end }));
  },
  listAllEvents: async (): Promise<CalendarEvent[]> => {
    if (isTauri) return invoke("list_all_events");
    return mockEvents;
  },
  saveEvent: async (event: CalendarEvent): Promise<CalendarEvent> => {
    if (isTauri) return invoke("save_event", { event });
    const t = Math.floor(Date.now() / 1000);
    const saved = { ...event, id: event.id || `ev-${t}-${Math.random().toString(36).slice(2, 8)}`, created_at: event.created_at || t, updated_at: t };
    mockEvents = [...mockEvents.filter((e) => e.id !== saved.id), saved];
    return saved;
  },
  deleteEvent: async (id: string): Promise<boolean> => {
    if (isTauri) return invoke("delete_event", { id });
    mockEvents = mockEvents.filter((e) => e.id !== id);
    return true;
  },
  exportEventsIcs: async (): Promise<string> => {
    if (isTauri) return invoke("export_events_ics");
    return "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n";
  },

  /** Small remembered preferences of the 2.5.0 tools (JSON texts). */
  getPref: async (key: string): Promise<string | null> => {
    if (isTauri) return invoke("get_pref", { key });
    return mockPrefs[key] ?? null;
  },
  setPref: async (key: string, value: string): Promise<void> => {
    if (isTauri) return invoke("set_pref", { key, value });
    mockPrefs[key] = value;
  },

  /** Files for the PDF tools. */
  pickDocuments: async (kind: "pdf" | "images" | "any" = "pdf"): Promise<string[]> => {
    if (isTauri) return invoke("pick_documents", { kind });
    return [];
  },
  transferFilePath: async (transferId: string): Promise<string> => {
    if (isTauri) return invoke("transfer_file_path", { transferId });
    return previewOnly();
  },
  readFileBytes: async (path: string): Promise<Uint8Array> => {
    if (isTauri) return new Uint8Array(await invoke<ArrayBuffer>("read_file_bytes", { path }));
    return previewOnly();
  },
  /** Saves bytes to a file the user picks (test copies: the download folder). Null = cancelled. */
  saveFileBytes: async (fileName: string, bytes: Uint8Array, kind: "pdf" | "txt" | "ics" = "pdf"): Promise<string | null> => {
    if (isTauri) return invoke("save_file_bytes", bytes, { headers: { "x-file-name": encodeURIComponent(fileName), "x-kind": kind } });
    const url = URL.createObjectURL(new Blob([bytes.slice(0)]));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return fileName;
  },
  saveTextFile: async (fileName: string, text: string, kind: "txt" | "ics" = "txt"): Promise<string | null> => {
    return api.saveFileBytes(fileName, new TextEncoder().encode(text), kind);
  },
  openDocument: async (path: string): Promise<void> => {
    if (isTauri) return invoke("open_document", { path });
  },

  /** Share on WhatsApp: text (and number) straight in; a file goes to the
   *  clipboard and WhatsApp opens. Returns "copied" or "opened". */
  shareWhatsApp: async (req: { text?: string; phone?: string; file?: string }): Promise<"copied" | "opened"> => {
    if (isTauri) return invoke("share_whatsapp", { req });
    window.open(`https://wa.me/?text=${encodeURIComponent(req.text ?? "")}`, "_blank");
    return "opened";
  },

  /** Live wallpaper from a file: LANX keeps a copy in its data folder. */
  pickWallpaper: async (): Promise<{ path: string; name: string; kind: "image" | "video"; bytes: number } | null> => {
    if (isTauri) return invoke("pick_wallpaper");
    return null;
  },
  clearWallpaperFile: async (): Promise<void> => {
    if (isTauri) return invoke("clear_wallpaper_file");
  },

  /** Voice (2.5.0): the speech model, dictation and note recordings. */
  voiceModels: async (): Promise<VoiceModel[]> => {
    if (isTauri) return invoke("voice_models");
    return [];
  },
  voiceModelChunk: async (id: string, offset: number, bytes: Uint8Array): Promise<number> => {
    if (isTauri) return invoke("voice_model_chunk", bytes, { headers: { "x-model": id, "x-offset": String(offset) } });
    return offset + bytes.length;
  },
  voiceModelFinish: async (id: string): Promise<VoiceModel> => {
    if (isTauri) return invoke("voice_model_finish", { id });
    return previewOnly();
  },
  voiceModelDelete: async (id: string): Promise<void> => {
    if (isTauri) return invoke("voice_model_delete", { id });
  },
  /** 16 kHz mono samples → text (on this PC). */
  transcribe: async (pcm: Float32Array, model: string, lang: string): Promise<Transcript> => {
    if (isTauri) return invoke("transcribe", new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), { headers: { "x-model": model, "x-lang": lang } });
    return previewOnly();
  },
  /** LANX 2.5.2: stop writing the words down. */
  transcribeCancel: async (): Promise<void> => {
    if (isTauri) return invoke("transcribe_cancel");
  },
  typeText: async (text: string): Promise<boolean> => {
    if (isTauri) return invoke("type_text", { text });
    return false;
  },
  /** LANX 2.5.1: on/off and which keys; false = Windows refused the keys (another program has them). */
  setDictationHotkey: async (enabled: boolean, keys?: { ctrl: boolean; alt: boolean; shift: boolean; win: boolean; key: string }): Promise<boolean> => {
    if (isTauri) return invoke("set_dictation_hotkey", { enabled, keys: keys ?? null });
    return true;
  },
  saveNoteAudio: async (bytes: Uint8Array, ext: string): Promise<{ file: string; bytes: number }> => {
    if (isTauri) return invoke("save_note_audio", bytes, { headers: { "x-ext": ext } });
    return { file: `preview-${Date.now()}.${ext}`, bytes: bytes.length };
  },
  deleteNoteAudio: async (file: string): Promise<void> => {
    if (isTauri) return invoke("delete_note_audio", { file });
  },
  /** LANX 2.6.0: a meme / GIF the picker made or fetched, saved in LANX's folder. */
  saveMemeFile: async (bytes: Uint8Array, ext: string, name: string): Promise<{ file: string; bytes: number }> => {
    if (isTauri) return invoke("save_meme_file", bytes, { headers: { "x-ext": ext, "x-name": name.replace(/[^\x20-\x7e]/g, "").slice(0, 60) } });
    return { file: `preview-meme-${Date.now()}.${ext}`, bytes: bytes.length };
  },
  /** LANX 2.6.0: the file (and, for a picture, the picture) onto the clipboard. */
  copyFileToClipboard: async (path: string): Promise<void> => {
    if (isTauri) return invoke("copy_file_to_clipboard", { path });
  },

};

const mockAdmin: { my_policy: OfficePolicy | null; policy: OfficePolicy | null; offer: OfficePolicy | null; peers: AdminState["peers"] } = {
  my_policy: null,
  policy: null,
  offer: null,
  peers: [],
};
function mockAdminState(): AdminState {
  const office = [...(mockAdmin.policy?.apps ?? []), ...(mockAdmin.my_policy?.apps ?? [])].map((a) => ({ ...a, office: true }));
  const mine = (mockSettings.apps ?? []).filter((a) => !office.some((o) => o.target === a.target)).map((a) => ({ ...a, office: false }));
  return {
    my_policy: mockAdmin.my_policy,
    policy: mockAdmin.policy,
    offer: mockAdmin.offer,
    peers: mockAdmin.my_policy ? mockAdmin.peers : [],
    retention_days: mockAdmin.policy?.retention_days || mockSettings.retention_days || 0,
    apps: [...office, ...mine],
  };
}

let mockAlerts: AlertInfo[] = [
  { id: "alert-old", from_id: "peer-marcus", from_name: "Marcus (Stores)", kind: "assembly", text: "Fire drill: everyone to the assembly point, please.", at: now() - 3 * 86400, cleared_at: now() - 3 * 86400 + 900, mine: false, my_ack: "safe", sent_to: [], acks: [] },
];

const MOCK_STICKERS: Sticker[] = [
  ["thanks", "🙏", "Thank you!"], ["ok", "👍", "OK!"], ["on-it", "🫡", "On it!"], ["done", "✅", "Done!"],
  ["great", "🌟", "Great job!"], ["lol", "😂", "LOL"], ["coffee", "☕", "Coffee?"], ["lunch", "🍱", "Lunch?"],
  ["wow", "🤩", "Wow!"], ["sorry", "🙇", "Sorry!"], ["wait", "⏳", "One minute"], ["call", "📞", "Call me"],
  ["meeting", "📅", "In a meeting"], ["hello", "👋", "Hello!"], ["night", "🌙", "Good night"], ["congrats", "🎉", "Congrats!"],
  ["birthday", "🎂", "Happy birthday!"], ["diwali", "🪔", "Happy Diwali!"], ["party", "🥳", "Party!"], ["love", "❤️", "Love it!"],
  ["fire", "🔥", "On fire!"], ["think", "🤔", "Hmm…"], ["tired", "😴", "So tired"], ["cat", "🐱", "Meow!"],
].map(([id, emoji, words]) => ({ id, emoji, words }));

const mockSync: SyncOverview = {
  shares: [],
  subscriptions: [
    { share_id: "share-sarah-prices", owner_id: "peer-sarah", owner_name: "Sarah (Accounts)", name: "Price Lists 2026", dest_path: "D:\\LANX\\Price Lists 2026", conversation_id: "conv-sarah", since: now() - 86400, files: 37, bytes: 52_000_000, last_at: now() - 600, status: "active" },
  ],
};

/** Browser preview: changes a pretend chat. */
function mockConv(id: string, patch: Partial<Conversation>): Conversation {
  mockConversations = mockConversations.map((c) => (c.id === id ? { ...c, ...patch } : c));
  return mockConversations.find((c) => c.id === id)!;
}

/** Browser preview: a pretend desktop picture (size + BGRA pixels). */
function mockScreenshot(): ArrayBuffer {
  const w = 1600;
  const h = 900;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, "#1e3a8a");
  grad.addColorStop(1, "#0ea5e9");
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#ffffff";
  g.fillRect(180, 120, 900, 560);
  g.fillStyle = "#e2e8f0";
  g.fillRect(180, 120, 900, 44);
  g.fillStyle = "#0f172a";
  g.font = "bold 28px Segoe UI, sans-serif";
  g.fillText("Q3 Vendor Payments.xlsx", 210, 220);
  g.font = "20px Segoe UI, sans-serif";
  for (let i = 0; i < 12; i++) g.fillText(`Row ${i + 1}    ₹ ${(12000 + i * 1375).toLocaleString("en-IN")}    Paid`, 210, 270 + i * 32);
  g.fillStyle = "#0f172a";
  g.fillRect(0, h - 48, w, 48);
  const rgba = g.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(8 + w * h * 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, w, true);
  view.setUint32(4, h, true);
  for (let i = 0; i < w * h; i++) {
    out[8 + i * 4] = rgba[i * 4 + 2];
    out[8 + i * 4 + 1] = rgba[i * 4 + 1];
    out[8 + i * 4 + 2] = rgba[i * 4];
    out[8 + i * 4 + 3] = 255;
  }
  return out.buffer;
}

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
  /** LANX 1.2.7: the desktop island was clicked; open that chat. */
  /** LANX 1.2.9: a colleague's profile arrived or changed. */
  onPeerProfile: (cb: (p: { peer_id: string; profile: Profile }) => void) =>
    on<{ peer_id: string; profile: Profile }>("lanx://peer-profile", cb),
  onOpenConversation: (cb: (p: { conversation_id: string }) => void) =>
    on<{ conversation_id: string }>("lanx://open-conversation", cb),
  onUpdateChanged: (cb: () => void) => on<null>("lanx://update-changed", () => cb()),
  onUpdateProblem: (cb: (p: UpdateProblemPayload) => void) =>
    on<UpdateProblemPayload>("lanx://update-problem", cb),
  onCall: (cb: (e: CallEvent) => void) => on<CallEvent>("lanx://call", cb),
  /** LANX 1.4.0: meetings (invitations, who joins/leaves, signals, chat…). */
  onMeeting: (cb: (e: MeetingEvent) => void) => on<MeetingEvent>("lanx://meeting", cb),
  /** LANX 1.5.0: a "remind me" went off. */
  onReminder: (cb: (e: { message: Message; conversation_id: string; title: string; text: string }) => void) =>
    on<{ message: Message; conversation_id: string; title: string; text: string }>("lanx://reminder", cb),
  /** LANX 1.5.0: the "send later" list of a chat changed. */
  onScheduledChanged: (cb: (e: { conversation_id: string; problem: string | null }) => void) =>
    on<{ conversation_id: string; problem: string | null }>("lanx://scheduled-changed", cb),
  /** LANX 1.7.0: shared folders changed (someone got / stopped / a file arrived). */
  onSyncChanged: (cb: () => void) => on<null>("lanx://sync-changed", () => cb()),
  /** LANX 1.7.0: Ctrl + Alt + S took a screenshot. */
  onScreenshotReady: (cb: () => void) => on<null>("lanx://screenshot-ready", () => cb()),
  /** LANX 1.7.0: files from Explorer's "Send to → LANX". */
  onSendRequest: (cb: () => void) => on<null>("lanx://send-request", () => cb()),
  /** LANX 1.8.0: an emergency alert arrived or changed. */
  onAlert: (cb: (a: AlertInfo) => void) => on<AlertInfo>("lanx://alert", cb),
  /** LANX 1.9.0: office settings changed (admin / colleague side). */
  onAdminChanged: (cb: () => void) => on<null>("lanx://admin-changed", () => cb()),
  /** LANX 1.9.0: the admin asks to manage this computer. */
  onPolicyOffer: (cb: (p: OfficePolicy) => void) => on<OfficePolicy>("lanx://policy-offer", cb),
  onAdminNotice: (cb: (p: { text: string }) => void) => on<{ text: string }>("lanx://admin-notice", cb),
  /** LANX 2.0: remote control on this PC started or stopped. */
  onRemote: (cb: (r: RemoteInfo) => void) => on<RemoteInfo>("lanx://remote", cb),
  /** LANX 1.8.0: an intercom message arrived (play it unless quiet). */
  onIntercom: (cb: (e: IntercomEvent) => void) => on<IntercomEvent>("lanx://intercom", cb),
};

let mockScheduled: ScheduledMessage[] = [];

/** Browser preview: changes a pretend message. */
function mockPatch(messageId: string, f: (m: Message) => Message): Message {
  for (const k of Object.keys(mockMessages)) {
    const i = mockMessages[k].findIndex((m) => m.id === messageId);
    if (i >= 0) {
      const next = f(mockMessages[k][i]);
      mockMessages[k] = mockMessages[k].map((m, j) => (j === i ? next : m));
      return next;
    }
  }
  throw new Error("Message not found");
}

/** Browser preview: a pretend meeting with a few colleagues. */
function mockMeeting(conversationId: string, video: boolean): MeetingInfo {
  const c = mockConversations.find((x) => x.id === conversationId);
  const person = (device_id: string, name: string, avatar_color: string, extra: Partial<MeetingInfo["people"][number]> = {}) => ({
    device_id,
    name,
    avatar_color,
    muted: false,
    camera: false,
    screen: false,
    hand: false,
    recording: false,
    is_me: false,
    ...extra,
  });
  return {
    meeting_id: `meeting-${Date.now()}`,
    title: c?.peer_name ?? "Team meeting",
    conversation_id: conversationId,
    group_id: c?.kind === "group" ? conversationId : null,
    host_id: "me",
    host_name: "You",
    inviter_id: "me",
    inviter_name: "You",
    inviter_color: "#0ea5e9",
    video,
    phase: "joined",
    started_at: now(),
    joined_at: now(),
    people: [
      person("me", "You", "#0ea5e9", { is_me: true }),
      person("p1", "Priya Sharma", "#ec4899", { hand: true }),
      person("p2", "Rahul Verma", "#10b981", { muted: true }),
      person("p3", "Anita Desai", "#f59e0b"),
    ],
    chat: [
      { from: "", name: "", text: "Priya Sharma joined", at: now() },
      { from: "p1", name: "Priya Sharma", text: "Can everyone see my screen?", at: now() },
    ],
    private: false,
    my_id: "me",
  };
}
