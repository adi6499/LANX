use serde::{Deserialize, Serialize};

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserSettings {
    pub device_id: String,
    pub display_name: String,
    pub hostname: String,
    pub avatar_color: String,
    pub theme: String, // "system" | "dark" | "light"
    pub udp_discovery_port: u16,
    pub tcp_messaging_port: u16,
    pub discovery_interval_secs: u64,
    pub notifications_enabled: bool,
    /// Auto-accept files from peers marked as trusted.
    pub auto_download_transfers: bool,
    pub default_download_dir: String,
    pub onboarding_completed: bool,
    #[serde(default = "default_true")]
    pub launch_at_startup: bool,
    #[serde(default = "default_true")]
    pub close_to_tray: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Peer {
    pub id: String,
    pub display_name: String,
    pub hostname: String,
    pub last_ip: String,
    pub tcp_port: u16,
    pub public_key: Option<String>,
    pub trust_state: String, // "unverified" | "trusted" | "blocked"
    pub status: String,      // "online" | "offline"
    pub last_seen: i64,
    pub avatar_color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conversation {
    pub id: String,
    pub peer_id: String,
    pub peer_name: String,
    pub peer_status: String,
    pub peer_avatar_color: String,
    pub peer_ip: String,
    pub last_message_preview: Option<String>,
    pub last_message_time: i64,
    pub unread_count: i32,
    pub is_pinned: bool,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub sender_id: String,
    pub receiver_id: String,
    pub content: String,
    pub message_type: String, // "text" | "file" | "system"
    pub timestamp: i64,
    /// "sending" | "queued" | "delivered" | "failed" | "read"
    pub status: String,
    pub error_reason: Option<String>,
    pub is_outgoing: bool,
    #[serde(default)]
    pub transfer_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferRecord {
    pub id: String,
    pub peer_id: String,
    pub peer_name: Option<String>,
    pub conversation_id: Option<String>,
    pub file_name: String,
    pub file_size: i64,
    pub file_hash: String,
    pub direction: String, // "incoming" | "outgoing"
    /// "queued" (offer not delivered yet) | "pending" (waiting for the
    /// recipient) | "transferring" | "completed" | "declined" | "cancelled" | "failed"
    pub status: String,
    pub transferred_bytes: i64,
    /// Outgoing: the file being sent. Incoming: where the received file was saved.
    pub local_path: Option<String>,
    pub error_reason: Option<String>,
    pub created_at: i64,
    pub completed_at: Option<i64>,
    /// Incoming only: partially downloaded data kept for resuming.
    #[serde(skip)]
    pub temp_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHit {
    pub message: Message,
    pub peer_name: String,
    pub peer_avatar_color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInfo {
    pub device_id: String,
    pub hostname: String,
    pub local_ips: Vec<String>,
    pub database_path: String,
    pub database_size_bytes: u64,
    pub os: String,
    pub app_version: String,
    pub fingerprint: String,
    pub tcp_listening: bool,
    pub udp_listening: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionTestResult {
    pub reachable: bool,
    pub ip: String,
    pub port: u16,
    pub latency_ms: Option<u64>,
    pub message: String,
}
