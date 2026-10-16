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
  peer_id: string;
  peer_name: string;
  peer_status: "online" | "offline";
  peer_avatar_color: string;
  peer_ip: string;
  last_message_preview?: string | null;
  last_message_time: number;
  unread_count: number;
  is_pinned: boolean;
  created_at: number;
}

export type MessageStatus = "sending" | "queued" | "delivered" | "failed" | "read";

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  message_type: "text" | "file" | "system";
  timestamp: number;
  status: MessageStatus;
  error_reason?: string | null;
  is_outgoing: boolean;
  transfer_id?: string | null;
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
}

export interface TransferProgress {
  transferred_bytes: number;
  file_size: number;
  bytes_per_sec: number;
}

export interface SentFile {
  transfer: TransferRecord;
  message: Message;
}

export interface SearchHit {
  message: Message;
  peer_name: string;
  peer_avatar_color: string;
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
