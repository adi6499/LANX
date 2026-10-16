export interface UserSettings {
  device_id: string;
  display_name: string;
  hostname: string;
  avatar_color: string;
  theme: "system" | "dark" | "light";
  udp_discovery_port: number;
  tcp_messaging_port: number;
  discovery_interval_secs: number;
  notifications_enabled: boolean;
  /** Auto-accept files from peers marked as trusted. */
  auto_download_transfers: boolean;
  default_download_dir: string;
  onboarding_completed: boolean;
  launch_at_startup: boolean;
  close_to_tray: boolean;
  /** Send "Seen" receipts and show "typing…". */
  read_receipts: boolean;
  /** Download images under 10 MB without asking. */
  auto_download_images: boolean;
  /** Minutes before LANX locks itself (0 = never). Needs a PIN. */
  auto_lock_minutes: number;
  /** Read-only: a PIN is set. */
  pin_enabled: boolean;
  sound_enabled: boolean;
  sound_choice: string;
  custom_sound_path: string;
  sound_volume: number;
}

export type TrustState = "unverified" | "trusted" | "blocked";

export interface Peer {
  id: string;
  display_name: string;
  hostname: string;
  last_ip: string;
  tcp_port: number;
  public_key?: string | null;
  trust_state: TrustState;
  status: "online" | "offline";
  last_seen: number;
  avatar_color: string;
}

export interface Conversation {
  id: string;
  /** Empty for group chats. */
  peer_id: string;
  /** Contact name, or the group name. */
  peer_name: string;
  peer_status: "online" | "offline";
  peer_avatar_color: string;
  peer_ip: string;
  last_message_preview?: string | null;
  last_message_time: number;
  unread_count: number;
  is_pinned: boolean;
  created_at: number;
  kind: "direct" | "group";
  is_hidden: boolean;
  /** Secret messages: seconds after reading before they disappear (0 = off). */
  secret_ttl: number;
  member_count: number;
  /** Groups: "member" | "left" | "removed". */
  membership: string;
}

export type MessageStatus = "sending" | "queued" | "delivered" | "failed" | "read";

export interface DeliverySummary {
  total: number;
  delivered: number;
  read: number;
  queued: number;
  failed: number;
  read_by: string[];
  waiting_for: string[];
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  message_type: "text" | "file" | "system" | "secret_setting" | "ring" | "call";
  timestamp: number;
  status: MessageStatus;
  error_reason?: string | null;
  is_outgoing: boolean;
  transfer_id?: string | null;
  ttl_secs?: number | null;
  expire_at?: number | null;
  deliveries?: DeliverySummary | null;
}

export type TransferStatus =
  | "queued"
  | "pending"
  | "transferring"
  | "completed"
  | "declined"
  | "cancelled"
  | "failed";

export interface TransferRecord {
  id: string;
  peer_id: string;
  peer_name?: string | null;
  conversation_id?: string | null;
  file_name: string;
  file_size: number;
  file_hash: string;
  direction: "incoming" | "outgoing";
  status: TransferStatus;
  transferred_bytes: number;
  local_path?: string | null;
  error_reason?: string | null;
  created_at: number;
  completed_at?: number | null;
  /** Group files: shared key of the per-member copies. */
  parent_id?: string | null;
}

export interface TransferProgress {
  transferred_bytes: number;
  file_size: number;
  bytes_per_sec: number;
}

export interface SentFile {
  transfers: TransferRecord[];
  message: Message;
}

export interface SearchHit {
  message: Message;
  peer_name: string;
  peer_avatar_color: string;
}

export interface GroupMember {
  device_id: string;
  display_name: string;
  public_key?: string | null;
  status: "online" | "offline";
  is_admin: boolean;
  is_me: boolean;
}

export interface GroupInfo {
  id: string;
  name: string;
  admin_id: string;
  version: number;
  avatar_color: string;
  membership: string;
  created_at: number;
  members: GroupMember[];
}

export interface LockStatus {
  pin_set: boolean;
  locked: boolean;
  hidden_unlocked: boolean;
  retry_after_secs: number;
}

export interface BroadcastResult {
  sent_to: number;
  problems: string[];
}

export interface SystemInfo {
  device_id: string;
  hostname: string;
  local_ips: string[];
  database_path: string;
  database_size_bytes: number;
  os: string;
  app_version: string;
  fingerprint: string;
  tcp_listening: boolean;
  udp_listening: boolean;
}

export interface ConnectionTestResult {
  reachable: boolean;
  ip: string;
  port: number;
  latency_ms?: number | null;
  message: string;
}

export type NavTab = "messages" | "people" | "transfers" | "history";

/** Actions on a file transfer, shared by the chat bubbles and the Files tab. */
export interface TransferActions {
  accept: (id: string) => void;
  cancel: (id: string) => void;
  retry: (id: string) => void;
  open: (id: string) => void;
  reveal: (id: string) => void;
}

export const SECRET_TIMERS: { secs: number; label: string }[] = [
  { secs: 30, label: "30 seconds" },
  { secs: 300, label: "5 minutes" },
  { secs: 3600, label: "1 hour" },
  { secs: 86400, label: "1 day" },
  { secs: 604800, label: "1 week" },
];

export function secretLabel(secs: number): string {
  return SECRET_TIMERS.find((t) => t.secs === secs)?.label ?? `${secs} seconds`;
}

// ------------------------------------------------------------------ backups
export interface BackupInfo {
  file_name: string;
  path: string;
  /** auto | manual | before-restore | imported | file */
  kind: string;
  created_at: number;
  size_bytes: number;
  conversations: number;
  messages: number;
  display_name: string;
  app_version: string;
}

export interface BackupOverview {
  auto_enabled: boolean;
  folder: string;
  backups: BackupInfo[];
}

export interface PickedBackup {
  path: string;
  encrypted: boolean;
  info: BackupInfo | null;
}

export interface RestoreNotice {
  ok: boolean;
  text: string;
}

// -------------------------------------------------------------------- calls
export interface CallInfo {
  call_id: string;
  conversation_id: string;
  peer_id: string;
  peer_name: string;
  avatar_color: string;
  video: boolean;
  outgoing: boolean;
  phase: "ringing" | "active";
  started_at: number;
  answered_at: number | null;
  /** Hidden chat or LANX locked: don't show the name. */
  private: boolean;
}

export interface CallEvent {
  action: "incoming" | "accepted" | "media" | "ended";
  call: CallInfo;
  sdp: string | null;
  video: boolean | null;
  muted: boolean | null;
  screen: boolean | null;
  reason: string | null;
}
