use serde::{Deserialize, Serialize};

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
    pub auto_download_transfers: bool,
    pub default_download_dir: String,
    pub onboarding_completed: bool,
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
    pub message_type: String, // "text" | "file_notice" | "system"
    pub timestamp: i64,
    pub status: String, // "sending" | "delivered" | "failed" | "read"
    pub error_reason: Option<String>,
    pub is_outgoing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferRecord {
    pub id: String,
    pub peer_id: String,
    pub peer_name: Option<String>,
    pub file_name: String,
    pub file_size: i64,
    pub file_hash: String,
    pub direction: String, // "incoming" | "outgoing"
    pub status: String, // "pending" | "approved" | "transferring" | "completed" | "cancelled" | "failed"
    pub transferred_bytes: i64,
    pub local_path: Option<String>,
    pub created_at: i64,
    pub completed_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInfo {
    pub device_id: String,
    pub hostname: String,
    pub local_ips: Vec<String>,
    pub database_path: String,
    pub database_size_bytes: u64,
    pub os: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionTestResult {
    pub reachable: bool,
    pub ip: String,
    pub port: u16,
    pub latency_ms: Option<u64>,
    pub message: String,
}
