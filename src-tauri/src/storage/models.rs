use serde::{Deserialize, Serialize};

fn default_true() -> bool {
    true
}

fn default_auto_lock() -> u32 {
    5
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
    /// Tell senders when their messages were read, and show "typing…".
    #[serde(default = "default_true")]
    pub read_receipts: bool,
    /// Download images under 10 MB without asking.
    #[serde(default = "default_true")]
    pub auto_download_images: bool,
    /// Minutes of inactivity before LANX locks (0 = never). Needs a PIN.
    #[serde(default = "default_auto_lock")]
    pub auto_lock_minutes: u32,
    /// Read-only: a PIN is set. Changed only through set_pin.
    #[serde(default)]
    pub pin_enabled: bool,
    #[serde(default = "default_true")]
    pub sound_enabled: bool,
    /// "chime" | "soft" | "ding" | "pop" | "custom"
    #[serde(default = "default_sound")]
    pub sound_choice: String,
    /// .wav file used when sound_choice == "custom".
    #[serde(default)]
    pub custom_sound_path: String,
    /// 0–100
    #[serde(default = "default_volume")]
    pub sound_volume: u32,
    /// LANX 1.2.4: background — "default", a preset name, or "#rrggbb".
    /// Since 1.2.5 it colours the whole window, not only the chat.
    #[serde(default = "default_background")]
    pub chat_background: String,
    /// LANX 1.2.5: accent colour for buttons, bubbles and highlights —
    /// "default", a preset name, or "#rrggbb".
    #[serde(default = "default_background")]
    pub accent_color: String,
    /// LANX 1.2.5: how see-through the glass panels are, 0 (solid) – 100 (clear).
    #[serde(default = "default_glass")]
    pub glass_level: u32,
    /// LANX 1.2.5: how frosted (blurred) the glass is, 0 (clear) – 100 (heavy frost).
    #[serde(default = "default_frost")]
    pub frost_level: u32,
    /// LANX 1.2.6: turn the animations off (for slower computers).
    #[serde(default)]
    pub reduce_motion: bool,
    /// LANX 1.2.7: the cartoon cat that asks you to accept incoming files.
    #[serde(default = "default_true")]
    pub cat_alerts: bool,
    /// LANX 1.2.9: avatar, status and "about me" (what colleagues see).
    #[serde(default)]
    pub profile: Profile,
}

/// LANX 1.2.9: what colleagues see about you besides your name and colour.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Profile {
    /// "initials" (default), "emoji:<character>", or "photo".
    #[serde(default)]
    pub avatar: String,
    /// The picture when avatar == "photo": a small data:image/...;base64 URL.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub photo: String,
    /// "" | "available" | "busy" | "meeting" | "lunch" | "wfh" | "road" | "leave" | "dnd"
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub status_text: String,
    /// Unix seconds when the status clears itself (0 = never).
    #[serde(default)]
    pub status_until: i64,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub department: String,
    #[serde(default)]
    pub phone: String,
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub bio: String,
}

pub const STATUS_PRESETS: [&str; 8] = ["available", "busy", "meeting", "lunch", "wfh", "road", "leave", "dnd"];

/// Largest photo (as a data URL) — keeps a profile well inside one packet.
pub const MAX_PHOTO_LEN: usize = 48_000;

impl Profile {
    /// Keeps only what LANX knows how to show, within sensible lengths
    /// (used for our own profile and for anything a colleague sends).
    pub fn cleaned(&self) -> Profile {
        fn cut(s: &str, n: usize) -> String {
            s.trim().chars().filter(|c| !c.is_control()).take(n).collect()
        }
        let photo_ok = self.photo.len() <= MAX_PHOTO_LEN
            && ["data:image/webp;base64,", "data:image/jpeg;base64,", "data:image/png;base64,"]
                .iter()
                .any(|p| self.photo.starts_with(p))
            && self
                .photo
                .split_once(',')
                .is_some_and(|(_, b)| !b.is_empty() && b.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'+' || c == b'/' || c == b'='));
        let avatar = if self.avatar == "photo" && photo_ok {
            "photo".to_string()
        } else if let Some(e) = self.avatar.strip_prefix("emoji:") {
            let e = cut(e, 8);
            if e.is_empty() || e.chars().any(|c| c.is_ascii_alphanumeric()) {
                "initials".to_string()
            } else {
                format!("emoji:{e}")
            }
        } else {
            "initials".to_string()
        };
        let status = if STATUS_PRESETS.contains(&self.status.as_str()) { self.status.clone() } else { String::new() };
        Profile {
            photo: if avatar == "photo" { self.photo.clone() } else { String::new() },
            avatar,
            status_text: if status.is_empty() && self.status_text.trim().is_empty() { String::new() } else { cut(&self.status_text, 80) },
            status,
            status_until: self.status_until.max(0),
            title: cut(&self.title, 60),
            department: cut(&self.department, 60),
            phone: cut(&self.phone, 30),
            email: cut(&self.email, 80),
            bio: cut(&self.bio, 160),
        }
    }

    /// The profile with an expired status cleared.
    pub fn effective(&self, now: i64) -> Profile {
        let mut p = self.cleaned();
        if p.status_until > 0 && now >= p.status_until {
            p.status.clear();
            p.status_text.clear();
            p.status_until = 0;
        }
        p
    }

    /// Short fingerprint: when it changes, colleagues fetch the profile again.
    pub fn rev(&self) -> u64 {
        use sha2::{Digest, Sha256};
        let d = Sha256::digest(serde_json::to_vec(self).unwrap_or_default());
        u64::from_le_bytes(d[..8].try_into().unwrap_or([0; 8]))
    }
}


fn default_glass() -> u32 {
    55
}

fn default_frost() -> u32 {
    60
}

fn default_background() -> String {
    "default".to_string()
}

fn default_sound() -> String {
    "chime".to_string()
}

fn default_volume() -> u32 {
    80
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
    /// Empty for group chats.
    pub peer_id: String,
    /// Contact name, or group name.
    pub peer_name: String,
    /// For groups: "online" when any member is online.
    pub peer_status: String,
    pub peer_avatar_color: String,
    pub peer_ip: String,
    pub last_message_preview: Option<String>,
    pub last_message_time: i64,
    pub unread_count: i32,
    pub is_pinned: bool,
    pub created_at: i64,
    /// "direct" | "group"
    pub kind: String,
    pub is_hidden: bool,
    /// Secret messages: seconds after reading before they disappear (0 = off).
    pub secret_ttl: u32,
    pub member_count: i64,
    /// Groups: "member" | "left" | "removed" (empty for direct chats).
    pub membership: String,
}

/// Delivery state of an outgoing group message across its members.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DeliverySummary {
    pub total: u32,
    pub delivered: u32,
    pub read: u32,
    pub queued: u32,
    pub failed: u32,
    pub read_by: Vec<String>,
    pub waiting_for: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub sender_id: String,
    pub receiver_id: String,
    pub content: String,
    /// "text" | "file" | "system" | "secret_setting"
    pub message_type: String,
    pub timestamp: i64,
    /// "sending" | "queued" | "delivered" | "failed" | "read"
    pub status: String,
    pub error_reason: Option<String>,
    pub is_outgoing: bool,
    #[serde(default)]
    pub transfer_id: Option<String>,
    /// Secret message: disappears this many seconds after being read.
    #[serde(default)]
    pub ttl_secs: Option<u32>,
    /// When the message will be deleted (unix seconds).
    #[serde(default)]
    pub expire_at: Option<i64>,
    /// Outgoing group messages only.
    #[serde(default)]
    pub deliveries: Option<DeliverySummary>,
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
    /// Group file sent to several members: shared key of the per-member copies
    /// (the chat message's transfer_id).
    #[serde(default)]
    pub parent_id: Option<String>,
    /// Incoming only: partially downloaded data kept for resuming.
    #[serde(skip)]
    pub temp_path: Option<String>,
    /// "file" (chat file) | "update" (LANX installer shared through Settings →
    /// Updates; never shown in chats or the Files list).
    #[serde(default = "default_transfer_kind")]
    pub kind: String,
    /// LANX 1.2.7: how long the (last run of the) transfer took, once completed.
    #[serde(default)]
    pub duration_ms: Option<i64>,
    /// LANX 1.2.7: bytes already there when that run started (resume), so the
    /// speed is (file_size - started_bytes) / duration.
    #[serde(default)]
    pub started_bytes: Option<i64>,
}

pub fn default_transfer_kind() -> String {
    "file".to_string()
}

/// What the LANX release signature covers (also the content of the
/// `LANX-Setup-<version>.exe.sig` file written by `npm run release`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReleaseInfo {
    pub version: String,
    /// SHA-256 of the installer, lowercase hex.
    pub sha256: String,
    pub size: u64,
    /// Ed25519 signature by the LANX release key, hex.
    pub signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupMemberInfo {
    pub device_id: String,
    pub display_name: String,
    pub public_key: Option<String>,
    pub status: String,
    pub is_admin: bool,
    pub is_me: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupInfo {
    pub id: String,
    pub name: String,
    pub admin_id: String,
    pub version: i64,
    pub avatar_color: String,
    pub membership: String,
    pub created_at: i64,
    pub members: Vec<GroupMemberInfo>,
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
