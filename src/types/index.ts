export interface UserSettings {
  device_id: string;
  display_name: string;
  hostname: string;
  avatar_color: string;
  theme: "system" | "dark" | "light";
  udp_discovery_port: number;
  tcp_messaging_port: number;
  discovery_interval_secs: number;
  notifications_enabled: bool;
  auto_download_transfers: bool;
  default_download_dir: string;
  onboarding_completed: bool;
}

// In typescript bool is boolean
export type bool = boolean;

export interface Peer {
  id: string;
  display_name: string;
  hostname: string;
  last_ip: string;
  tcp_port: number;
  public_key?: string | null;
  trust_state: "unverified" | "trusted" | "blocked";
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

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  message_type: "text" | "file_notice" | "system";
  timestamp: number;
  status: "sending" | "delivered" | "failed" | "read";
  error_reason?: string | null;
  is_outgoing: boolean;
}

export interface TransferRecord {
  id: string;
  peer_id: string;
  peer_name?: string | null;
  file_name: string;
  file_size: number;
  file_hash: string;
  direction: "incoming" | "outgoing";
  status: "pending" | "approved" | "transferring" | "completed" | "cancelled" | "failed";
  transferred_bytes: number;
  local_path?: string | null;
  created_at: number;
  completed_at?: number | null;
}

export interface SystemInfo {
  device_id: string;
  hostname: string;
  local_ips: string[];
  database_path: string;
  database_size_bytes: number;
  os: string;
}

export interface ConnectionTestResult {
  reachable: boolean;
  ip: string;
  port: number;
  latency_ms?: number | null;
  message: string;
}

export type NavTab = "messages" | "people" | "transfers" | "history";
