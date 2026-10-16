pub mod models;
pub mod schema;
#[cfg(test)]
mod tests;

use models::*;
use parking_lot::Mutex;
use rusqlite::{Connection, OptionalExtension, Result, Row, params};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

pub struct Database {
    pub conn: Arc<Mutex<Connection>>,
    db_path: PathBuf,
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

/// `%APPDATA%\LANX` (or `LANX-<profile>` for side-by-side test profiles).
pub fn data_dir(profile: Option<&str>) -> PathBuf {
    let name = match profile {
        Some(p) if !p.is_empty() => format!("LANX-{}", p),
        _ => "LANX".to_string(),
    };
    dirs::data_dir()
        .map(|p| p.join(&name))
        .unwrap_or_else(|| PathBuf::from("./data"))
}

/// Shortens text for the sidebar preview without splitting a UTF-8 character.
pub fn preview_text(content: &str) -> String {
    let mut chars = content.chars();
    let head: String = chars.by_ref().take(60).collect();
    if chars.next().is_some() {
        format!("{}…", head)
    } else {
        head
    }
}

const PEER_COLS: &str =
    "id, display_name, hostname, last_ip, tcp_port, public_key, trust_state, status, last_seen, avatar_color";
const CONV_SELECT: &str = "SELECT c.id, COALESCE(c.peer_id, ''), COALESCE(p.display_name, g.name, 'Unknown'),
        CASE WHEN c.kind = 'group' THEN
            CASE WHEN EXISTS (SELECT 1 FROM group_members gm JOIN peers pp ON pp.id = gm.device_id
                              WHERE gm.group_id = c.id AND pp.status = 'online') THEN 'online' ELSE 'offline' END
        ELSE COALESCE(p.status, 'offline') END,
        COALESCE(p.avatar_color, g.avatar_color, '#6366f1'), COALESCE(p.last_ip, ''),
        c.last_message_preview, c.last_message_time, c.unread_count, c.is_pinned, c.created_at,
        c.kind, c.is_hidden, c.secret_ttl,
        (SELECT COUNT(*) FROM group_members gm2 WHERE gm2.group_id = c.id),
        COALESCE(g.membership, '')
     FROM conversations c LEFT JOIN peers p ON c.peer_id = p.id LEFT JOIN groups g ON g.id = c.id";
const MSG_COLS: &str = "id, conversation_id, sender_id, receiver_id, content, message_type, timestamp, status, error_reason, is_outgoing, transfer_id, ttl_secs, expire_at";
const TRANSFER_SELECT: &str = "SELECT t.id, t.peer_id, p.display_name, t.conversation_id, t.file_name, t.file_size, t.file_hash,
        t.direction, t.status, t.transferred_bytes, t.local_path, t.error_reason, t.created_at, t.completed_at, t.temp_path,
        t.parent_id
     FROM transfers t LEFT JOIN peers p ON t.peer_id = p.id";

/// Messages from secret chats that were never read still disappear after a week.
pub const SECRET_UNREAD_MAX_SECS: i64 = 7 * 24 * 3600;

fn row_to_peer(row: &Row) -> Result<Peer> {
    Ok(Peer {
        id: row.get(0)?,
        display_name: row.get(1)?,
        hostname: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
        last_ip: row.get(3)?,
        tcp_port: row.get::<_, u32>(4)? as u16,
        public_key: row.get(5)?,
        trust_state: row.get(6)?,
        status: row.get(7)?,
        last_seen: row.get(8)?,
        avatar_color: row.get(9)?,
    })
}

fn row_to_conversation(row: &Row) -> Result<Conversation> {
    Ok(Conversation {
        id: row.get(0)?,
        peer_id: row.get(1)?,
        peer_name: row.get(2)?,
        peer_status: row.get(3)?,
        peer_avatar_color: row.get(4)?,
        peer_ip: row.get(5)?,
        last_message_preview: row.get(6)?,
        last_message_time: row.get(7)?,
        unread_count: row.get(8)?,
        is_pinned: row.get::<_, i32>(9)? != 0,
        created_at: row.get(10)?,
        kind: row.get(11)?,
        is_hidden: row.get::<_, i32>(12)? != 0,
        secret_ttl: row.get::<_, i64>(13)?.max(0) as u32,
        member_count: row.get(14)?,
        membership: row.get(15)?,
    })
}

fn row_to_message(row: &Row) -> Result<Message> {
    Ok(Message {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        sender_id: row.get(2)?,
        receiver_id: row.get(3)?,
        content: row.get(4)?,
        message_type: row.get(5)?,
        timestamp: row.get(6)?,
        status: row.get(7)?,
        error_reason: row.get(8)?,
        is_outgoing: row.get::<_, i32>(9)? != 0,
        transfer_id: row.get(10)?,
        ttl_secs: row.get::<_, Option<i64>>(11)?.map(|v| v.max(0) as u32),
        expire_at: row.get(12)?,
        deliveries: None,
    })
}

fn row_to_transfer(row: &Row) -> Result<TransferRecord> {
    Ok(TransferRecord {
        id: row.get(0)?,
        peer_id: row.get(1)?,
        peer_name: row.get(2)?,
        conversation_id: row.get(3)?,
        file_name: row.get(4)?,
        file_size: row.get(5)?,
        file_hash: row.get(6)?,
        direction: row.get(7)?,
        status: row.get(8)?,
        transferred_bytes: row.get(9)?,
        local_path: row.get(10)?,
        error_reason: row.get(11)?,
        created_at: row.get(12)?,
        completed_at: row.get(13)?,
        temp_path: row.get(14)?,
        parent_id: row.get(15)?,
    })
}

impl Database {
    pub fn new() -> Result<Self> {
        Self::open(&data_dir(None))
    }

    pub fn open(db_dir: &Path) -> Result<Self> {
        if !db_dir.exists() {
            let _ = fs::create_dir_all(db_dir);
        }

        let db_path = db_dir.join("lanx.db");
        let mut conn = Connection::open(&db_path)?;

        // Pragmas for performance and concurrency
        // secure_delete: deleted rows (e.g. disappeared secret messages) are
        // overwritten on disk instead of lingering in free pages.
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;
             PRAGMA secure_delete = ON;
             PRAGMA busy_timeout = 5000;",
        )?;

        schema::run_migrations(&mut conn)?;

        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
            db_path,
        };
        db.init_default_settings()?;
        Ok(db)
    }

    pub fn new_in_memory() -> Result<Self> {
        let mut conn = Connection::open_in_memory()?;
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;",
        )?;
        schema::run_migrations(&mut conn)?;
        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
            db_path: PathBuf::from(":memory:"),
        };
        db.init_default_settings()?;
        Ok(db)
    }

    pub fn get_path(&self) -> &Path {
        &self.db_path
    }

    pub fn get_db_size_bytes(&self) -> u64 {
        let wal = self.db_path.with_extension("db-wal");
        fs::metadata(&self.db_path).map(|m| m.len()).unwrap_or(0)
            + fs::metadata(wal).map(|m| m.len()).unwrap_or(0)
    }

    fn init_default_settings(&self) -> Result<()> {
        let conn = self.conn.lock();

        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM settings WHERE key = 'device_id'",
            [],
            |row| row.get(0),
        )?;

        if count == 0 {
            let device_id = Uuid::new_v4().to_string();
            let hostname = hostname();
            let username = whoami_user();
            let display_name = if !username.is_empty() {
                username
            } else {
                format!("User-{}", &device_id[..4])
            };

            let download_dir = dirs::download_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| "C:\\Users\\Public\\Downloads".to_string());

            let colors = [
                "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899", "#10b981", "#06b6d4", "#f59e0b",
            ];
            let avatar_color = colors[rand_index(colors.len())].to_string();

            let defaults = [
                ("device_id", device_id),
                ("display_name", display_name),
                ("hostname", hostname),
                ("avatar_color", avatar_color),
                ("theme", "system".to_string()),
                ("udp_discovery_port", "52925".to_string()),
                ("tcp_messaging_port", "52926".to_string()),
                ("discovery_interval_secs", "5".to_string()),
                ("notifications_enabled", "true".to_string()),
                ("auto_download_transfers", "false".to_string()),
                ("default_download_dir", download_dir),
                ("onboarding_completed", "false".to_string()),
                ("launch_at_startup", "true".to_string()),
                ("close_to_tray", "true".to_string()),
            ];

            for (k, v) in defaults {
                conn.execute(
                    "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
                    params![k, v],
                )?;
            }
        }

        Ok(())
    }

    pub fn get_settings(&self) -> Result<UserSettings> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

        let mut map = std::collections::HashMap::new();
        for (k, v) in rows.flatten() {
            map.insert(k, v);
        }
        let flag = |key: &str, default: bool| {
            map.get(key)
                .map(|v| v == "true" || v == "1")
                .unwrap_or(default)
        };

        Ok(UserSettings {
            device_id: map.get("device_id").cloned().unwrap_or_default(),
            display_name: map
                .get("display_name")
                .cloned()
                .unwrap_or_else(|| "LANX User".to_string()),
            hostname: map.get("hostname").cloned().unwrap_or_else(hostname),
            avatar_color: map
                .get("avatar_color")
                .cloned()
                .unwrap_or_else(|| "#3b82f6".to_string()),
            theme: map
                .get("theme")
                .cloned()
                .unwrap_or_else(|| "system".to_string()),
            udp_discovery_port: map
                .get("udp_discovery_port")
                .and_then(|v| v.parse().ok())
                .unwrap_or(52925),
            tcp_messaging_port: map
                .get("tcp_messaging_port")
                .and_then(|v| v.parse().ok())
                .unwrap_or(52926),
            discovery_interval_secs: map
                .get("discovery_interval_secs")
                .and_then(|v| v.parse().ok())
                .unwrap_or(5),
            notifications_enabled: flag("notifications_enabled", true),
            auto_download_transfers: flag("auto_download_transfers", false),
            default_download_dir: map.get("default_download_dir").cloned().unwrap_or_default(),
            onboarding_completed: flag("onboarding_completed", false),
            launch_at_startup: flag("launch_at_startup", true),
            close_to_tray: flag("close_to_tray", true),
            read_receipts: flag("read_receipts", true),
            auto_download_images: flag("auto_download_images", true),
            auto_lock_minutes: map
                .get("auto_lock_minutes")
                .and_then(|v| v.parse().ok())
                .unwrap_or(5),
            pin_enabled: map.get("pin_hash").is_some_and(|v| !v.is_empty()),
            sound_enabled: flag("sound_enabled", true),
            sound_choice: map
                .get("sound_choice")
                .cloned()
                .unwrap_or_else(|| "chime".to_string()),
            custom_sound_path: map.get("custom_sound_path").cloned().unwrap_or_default(),
            sound_volume: map
                .get("sound_volume")
                .and_then(|v| v.parse().ok())
                .unwrap_or(80),
        })
    }

    pub fn save_settings(&self, settings: &UserSettings) -> Result<()> {
        let conn = self.conn.lock();
        let pairs = [
            ("display_name", settings.display_name.trim().to_string()),
            ("avatar_color", settings.avatar_color.clone()),
            ("theme", settings.theme.clone()),
            (
                "udp_discovery_port",
                settings.udp_discovery_port.to_string(),
            ),
            (
                "tcp_messaging_port",
                settings.tcp_messaging_port.to_string(),
            ),
            (
                "discovery_interval_secs",
                settings.discovery_interval_secs.clamp(2, 60).to_string(),
            ),
            (
                "notifications_enabled",
                settings.notifications_enabled.to_string(),
            ),
            (
                "auto_download_transfers",
                settings.auto_download_transfers.to_string(),
            ),
            (
                "default_download_dir",
                settings.default_download_dir.clone(),
            ),
            (
                "onboarding_completed",
                settings.onboarding_completed.to_string(),
            ),
            ("launch_at_startup", settings.launch_at_startup.to_string()),
            ("close_to_tray", settings.close_to_tray.to_string()),
            ("read_receipts", settings.read_receipts.to_string()),
            ("auto_download_images", settings.auto_download_images.to_string()),
            ("auto_lock_minutes", settings.auto_lock_minutes.min(240).to_string()),
            ("sound_enabled", settings.sound_enabled.to_string()),
            ("sound_choice", settings.sound_choice.clone()),
            ("custom_sound_path", settings.custom_sound_path.clone()),
            ("sound_volume", settings.sound_volume.min(100).to_string()),
        ];

        for (k, v) in pairs {
            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
                params![k, v],
            )?;
        }

        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Option<String> {
        let conn = self.conn.lock();
        conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |r| r.get(0),
        )
        .ok()
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
        Ok(())
    }

    // ---------------------------------------------------------------- peers

    pub fn list_peers(&self) -> Result<Vec<Peer>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(&format!(
            "SELECT {} FROM peers ORDER BY status DESC, last_seen DESC",
            PEER_COLS
        ))?;
        let rows = stmt.query_map([], row_to_peer)?;
        Ok(rows.flatten().collect())
    }

    pub fn get_peer(&self, peer_id: &str) -> Result<Option<Peer>> {
        let conn = self.conn.lock();
        conn.query_row(
            &format!("SELECT {} FROM peers WHERE id = ?1", PEER_COLS),
            params![peer_id],
            row_to_peer,
        )
        .optional()
    }

    /// Inserts or refreshes a peer. The first public key seen is pinned and is
    /// never overwritten; trust is changed only through `update_peer_trust`.
    pub fn upsert_peer(&self, peer: &Peer) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO peers (id, display_name, hostname, last_ip, tcp_port, public_key, trust_state, status, last_seen, avatar_color)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(id) DO UPDATE SET
                display_name = excluded.display_name,
                hostname = excluded.hostname,
                last_ip = excluded.last_ip,
                tcp_port = excluded.tcp_port,
                public_key = COALESCE(peers.public_key, excluded.public_key),
                status = excluded.status,
                last_seen = excluded.last_seen,
                avatar_color = excluded.avatar_color",
            params![
                peer.id,
                peer.display_name,
                peer.hostname,
                peer.last_ip,
                peer.tcp_port as u32,
                peer.public_key,
                peer.trust_state,
                peer.status,
                peer.last_seen,
                peer.avatar_color,
            ],
        )?;
        Ok(())
    }

    pub fn set_peer_status(&self, peer_id: &str, status: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE peers SET status = ?1 WHERE id = ?2",
            params![status, peer_id],
        )?;
        Ok(())
    }

    pub fn update_peer_trust(&self, peer_id: &str, trust_state: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE peers SET trust_state = ?1 WHERE id = ?2",
            params![trust_state, peer_id],
        )?;
        Ok(())
    }

    /// A peer added by IP before it was ever reached is stored as
    /// `manual-<ip>:<port>`. Once the real device identifies itself from that
    /// IP, its chat history and transfers move to the real peer.
    pub fn merge_manual_peer(&self, ip: &str, real_id: &str) -> Result<bool> {
        let mut conn = self.conn.lock();
        let manual_ids: Vec<String> = {
            let mut stmt = conn.prepare(
                "SELECT id FROM peers WHERE id LIKE 'manual-%' AND last_ip = ?1 AND id != ?2",
            )?;
            stmt.query_map(params![ip, real_id], |r| r.get(0))?
                .flatten()
                .collect()
        };
        if manual_ids.is_empty() {
            return Ok(false);
        }

        let tx = conn.transaction()?;
        for manual_id in &manual_ids {
            let real_conv: Option<String> = tx
                .query_row(
                    "SELECT id FROM conversations WHERE peer_id = ?1",
                    params![real_id],
                    |r| r.get(0),
                )
                .optional()?;
            match real_conv {
                Some(real_conv) => {
                    tx.execute(
                        "UPDATE messages SET conversation_id = ?1, receiver_id = CASE WHEN is_outgoing = 1 THEN ?2 ELSE receiver_id END
                         WHERE conversation_id IN (SELECT id FROM conversations WHERE peer_id = ?3)",
                        params![real_conv, real_id, manual_id],
                    )?;
                    tx.execute(
                        "DELETE FROM conversations WHERE peer_id = ?1",
                        params![manual_id],
                    )?;
                }
                None => {
                    tx.execute(
                        "UPDATE conversations SET peer_id = ?1 WHERE peer_id = ?2",
                        params![real_id, manual_id],
                    )?;
                    tx.execute(
                        "UPDATE messages SET receiver_id = ?1 WHERE receiver_id = ?2 AND is_outgoing = 1",
                        params![real_id, manual_id],
                    )?;
                }
            }
            tx.execute(
                "UPDATE transfers SET peer_id = ?1 WHERE peer_id = ?2",
                params![real_id, manual_id],
            )?;
            tx.execute("DELETE FROM peers WHERE id = ?1", params![manual_id])?;
        }
        tx.commit()?;
        Ok(true)
    }

    // -------------------------------------------------------- conversations

    /// Chats for the sidebar. Hidden chats are left out unless `include_hidden`.
    pub fn get_conversations(&self, include_hidden: bool) -> Result<Vec<Conversation>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(&format!(
            "{} WHERE (?1 OR c.is_hidden = 0) ORDER BY c.is_pinned DESC, c.last_message_time DESC",
            CONV_SELECT
        ))?;
        let rows = stmt.query_map(params![include_hidden], row_to_conversation)?;
        Ok(rows.flatten().collect())
    }

    pub fn get_conversation(&self, conversation_id: &str) -> Result<Option<Conversation>> {
        let conn = self.conn.lock();
        conn.query_row(
            &format!("{} WHERE c.id = ?1", CONV_SELECT),
            params![conversation_id],
            row_to_conversation,
        )
        .optional()
    }

    pub fn get_or_create_conversation(&self, peer_id: &str) -> Result<Conversation> {
        let conn = self.conn.lock();

        let existing = conn
            .query_row(
                &format!("{} WHERE c.peer_id = ?1 AND c.kind = 'direct'", CONV_SELECT),
                params![peer_id],
                row_to_conversation,
            )
            .optional()?;
        if let Some(c) = existing {
            return Ok(c);
        }

        let now = now_secs();

        // Ensure peer exists to satisfy foreign key
        let peer_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM peers WHERE id = ?1",
                params![peer_id],
                |row| row.get::<_, i64>(0),
            )
            .map(|c| c > 0)
            .unwrap_or(false);

        if !peer_exists {
            let default_name = format!(
                "Peer {}",
                peer_id.chars().take(8).collect::<String>()
            );
            conn.execute(
                "INSERT OR IGNORE INTO peers (id, display_name, hostname, last_ip, tcp_port, trust_state, status, last_seen, avatar_color)
                 VALUES (?1, ?2, 'LAN Node', '127.0.0.1', 52926, 'unverified', 'offline', ?3, '#3b82f6')",
                params![peer_id, default_name, now],
            )?;
        }

        let conv_id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO conversations (id, peer_id, last_message_preview, last_message_time, unread_count, is_pinned, created_at)
             VALUES (?1, ?2, NULL, ?3, 0, 0, ?4)",
            params![conv_id, peer_id, now, now],
        )?;

        conn.query_row(
            &format!("{} WHERE c.id = ?1", CONV_SELECT),
            params![conv_id],
            row_to_conversation,
        )
    }

    pub fn increment_unread(&self, conversation_id: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE conversations SET unread_count = unread_count + 1 WHERE id = ?1",
            params![conversation_id],
        )?;
        Ok(())
    }

    /// Unread count shown in the tray (hidden chats are not counted).
    pub fn total_unread(&self) -> i64 {
        let conn = self.conn.lock();
        conn.query_row(
            "SELECT COALESCE(SUM(unread_count), 0) FROM conversations WHERE is_hidden = 0",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0)
    }

    /// Marks a chat read. Starts the disappearing timer of secret messages and
    /// flags read receipts to send. Returns the senders who should be told.
    pub fn mark_conversation_read(
        &self,
        conversation_id: &str,
        send_receipts: bool,
    ) -> Result<Vec<String>> {
        let conn = self.conn.lock();
        let now = now_secs();
        conn.execute(
            "UPDATE conversations SET unread_count = 0 WHERE id = ?1",
            params![conversation_id],
        )?;
        // Receipts are always sent for secret messages so the sender's copy
        // disappears too.
        conn.execute(
            "UPDATE messages SET
                 receipt_pending = CASE WHEN message_type IN ('text', 'file') AND (?2 OR ttl_secs IS NOT NULL)
                                        THEN 1 ELSE receipt_pending END,
                 expire_at = CASE WHEN ttl_secs IS NOT NULL
                                  THEN MIN(COALESCE(expire_at, ?3 + ttl_secs), ?3 + ttl_secs)
                                  ELSE expire_at END,
                 status = 'read'
             WHERE conversation_id = ?1 AND is_outgoing = 0 AND status = 'delivered'",
            params![conversation_id, send_receipts, now],
        )?;
        let mut stmt = conn.prepare(
            "SELECT DISTINCT sender_id FROM messages
             WHERE conversation_id = ?1 AND is_outgoing = 0 AND receipt_pending = 1",
        )?;
        let senders = stmt
            .query_map(params![conversation_id], |r| r.get(0))?
            .flatten()
            .collect();
        Ok(senders)
    }

    pub fn set_conversation_hidden(&self, conversation_id: &str, hidden: bool) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE conversations SET is_hidden = ?1 WHERE id = ?2",
            params![hidden, conversation_id],
        )?;
        Ok(())
    }

    pub fn set_conversation_secret_ttl(&self, conversation_id: &str, ttl: u32) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE conversations SET secret_ttl = ?1 WHERE id = ?2",
            params![ttl as i64, conversation_id],
        )?;
        Ok(())
    }

    pub fn is_conversation_hidden(&self, conversation_id: &str) -> bool {
        let conn = self.conn.lock();
        conn.query_row(
            "SELECT is_hidden FROM conversations WHERE id = ?1",
            params![conversation_id],
            |r| r.get::<_, i32>(0),
        )
        .map(|v| v != 0)
        .unwrap_or(false)
    }

    pub fn delete_conversation(&self, conversation_id: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "DELETE FROM conversations WHERE id = ?1",
            params![conversation_id],
        )?;
        Ok(())
    }

    // ------------------------------------------------------------- messages

    pub fn get_messages(&self, conversation_id: &str) -> Result<Vec<Message>> {
        let mut messages: Vec<Message> = {
            let conn = self.conn.lock();
            let mut stmt = conn.prepare(&format!(
                "SELECT {} FROM messages WHERE conversation_id = ?1 ORDER BY timestamp ASC, rowid ASC",
                MSG_COLS
            ))?;
            let rows = stmt.query_map(params![conversation_id], row_to_message)?;
            rows.flatten().collect()
        };
        let summaries = self.delivery_summaries(conversation_id)?;
        if !summaries.is_empty() {
            for m in messages.iter_mut() {
                if let Some(s) = summaries.get(&m.id) {
                    m.deliveries = Some(s.clone());
                }
            }
        }
        Ok(messages)
    }

    /// Per-member delivery state of outgoing group messages in a chat.
    pub fn delivery_summaries(
        &self,
        conversation_id: &str,
    ) -> Result<std::collections::HashMap<String, DeliverySummary>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT d.message_id, d.status, COALESCE(p.display_name, gm.display_name, d.peer_id)
             FROM message_deliveries d
             JOIN messages m ON m.id = d.message_id
             LEFT JOIN peers p ON p.id = d.peer_id
             LEFT JOIN group_members gm ON gm.group_id = m.conversation_id AND gm.device_id = d.peer_id
             WHERE m.conversation_id = ?1",
        )?;
        let rows = stmt.query_map(params![conversation_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
        })?;
        let mut map: std::collections::HashMap<String, DeliverySummary> = Default::default();
        for (mid, status, name) in rows.flatten() {
            let s = map.entry(mid).or_default();
            s.total += 1;
            match status.as_str() {
                "read" => {
                    s.read += 1;
                    s.delivered += 1;
                    s.read_by.push(name);
                }
                "delivered" => {
                    s.delivered += 1;
                }
                "failed" => {
                    s.failed += 1;
                    s.waiting_for.push(name);
                }
                _ => {
                    s.queued += 1;
                    s.waiting_for.push(name);
                }
            }
        }
        Ok(map)
    }

    pub fn delivery_summary(&self, message_id: &str) -> Option<DeliverySummary> {
        let conv = self.get_message_by_id(message_id).ok().flatten()?.conversation_id;
        self.delivery_summaries(&conv).ok()?.remove(message_id)
    }

    pub fn get_message_by_id(&self, message_id: &str) -> Result<Option<Message>> {
        let conn = self.conn.lock();
        conn.query_row(
            &format!("SELECT {} FROM messages WHERE id = ?1", MSG_COLS),
            params![message_id],
            row_to_message,
        )
        .optional()
    }

    pub fn get_message_by_transfer(&self, transfer_id: &str) -> Result<Option<Message>> {
        let conn = self.conn.lock();
        conn.query_row(
            &format!("SELECT {} FROM messages WHERE transfer_id = ?1", MSG_COLS),
            params![transfer_id],
            row_to_message,
        )
        .optional()
    }

    pub fn message_exists(&self, message_id: &str) -> bool {
        let conn = self.conn.lock();
        conn.query_row(
            "SELECT COUNT(*) FROM messages WHERE id = ?1",
            params![message_id],
            |r| r.get::<_, i64>(0),
        )
        .map(|c| c > 0)
        .unwrap_or(false)
    }

    pub fn insert_message(&self, msg: &Message) -> Result<()> {
        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;
        tx.execute(
            &format!(
                "INSERT INTO messages ({}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                MSG_COLS
            ),
            params![
                msg.id,
                msg.conversation_id,
                msg.sender_id,
                msg.receiver_id,
                msg.content,
                msg.message_type,
                msg.timestamp,
                msg.status,
                msg.error_reason,
                if msg.is_outgoing { 1 } else { 0 },
                msg.transfer_id,
                msg.ttl_secs.map(|v| v as i64),
                msg.expire_at,
            ],
        )?;
        tx.execute(
            "UPDATE conversations
             SET last_message_preview = ?1, last_message_time = ?2
             WHERE id = ?3",
            params![message_preview(msg), msg.timestamp, msg.conversation_id],
        )?;
        tx.commit()
    }

    /// Case-insensitive search through stored messages (newest first).
    /// Secret messages are never searchable; hidden chats only when unlocked.
    pub fn search_messages(
        &self,
        query: &str,
        limit: usize,
        include_hidden: bool,
    ) -> Result<Vec<SearchHit>> {
        let q = query.trim();
        if q.is_empty() {
            return Ok(Vec::new());
        }
        let escaped = q.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
        let pattern = format!("%{}%", escaped);
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT m.id, m.conversation_id, m.sender_id, m.receiver_id, m.content, m.message_type, m.timestamp,
                    m.status, m.error_reason, m.is_outgoing, m.transfer_id, m.ttl_secs, m.expire_at,
                    COALESCE(p.display_name, g.name, ''), COALESCE(p.avatar_color, g.avatar_color, '#6366f1')
             FROM messages m
             JOIN conversations c ON m.conversation_id = c.id
             LEFT JOIN peers p ON c.peer_id = p.id
             LEFT JOIN groups g ON g.id = c.id
             WHERE m.content LIKE ?1 ESCAPE '\\'
               AND m.message_type IN ('text', 'file') AND m.ttl_secs IS NULL
               AND (?3 OR c.is_hidden = 0)
             ORDER BY m.timestamp DESC
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![pattern, limit as i64, include_hidden], |row| {
            Ok(SearchHit {
                message: row_to_message(row)?,
                peer_name: row.get(13)?,
                peer_avatar_color: row.get(14)?,
            })
        })?;
        Ok(rows.flatten().collect())
    }

    pub fn update_message_status(
        &self,
        message_id: &str,
        status: &str,
        error: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE messages SET status = ?1, error_reason = ?2 WHERE id = ?3",
            params![status, error, message_id],
        )?;
        Ok(())
    }

    /// Outgoing direct messages (text and secret-mode changes) still waiting
    /// to reach `peer_id`.
    pub fn pending_outgoing_messages(&self, peer_id: &str) -> Result<Vec<Message>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(&format!(
            "SELECT {} FROM messages
             WHERE receiver_id = ?1 AND is_outgoing = 1 AND message_type IN ('text', 'secret_setting')
               AND status IN ('sending', 'queued')
             ORDER BY timestamp ASC, rowid ASC",
            MSG_COLS
        ))?;
        let rows = stmt.query_map(params![peer_id], row_to_message)?;
        Ok(rows.flatten().collect())
    }

    pub fn has_pending_outbox(&self, peer_id: &str) -> bool {
        let conn = self.conn.lock();
        let count = |sql: &str| -> i64 {
            conn.query_row(sql, params![peer_id], |r| r.get(0)).unwrap_or(0)
        };
        count(
            "SELECT COUNT(*) FROM messages WHERE receiver_id = ?1 AND is_outgoing = 1
             AND message_type IN ('text', 'secret_setting') AND status IN ('sending', 'queued')",
        ) + count(
            "SELECT COUNT(*) FROM transfers WHERE peer_id = ?1 AND direction = 'outgoing' AND status = 'queued'",
        ) + count(
            "SELECT COUNT(*) FROM message_deliveries WHERE peer_id = ?1 AND status IN ('sending', 'queued')",
        ) + count("SELECT COUNT(*) FROM group_sync WHERE peer_id = ?1")
            + count(
                "SELECT COUNT(*) FROM messages WHERE sender_id = ?1 AND is_outgoing = 0 AND receipt_pending = 1",
            )
            > 0
    }

    /// Puts interrupted work back into a recoverable state after a restart.
    pub fn recover_after_restart(&self) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE messages SET status = 'queued' WHERE is_outgoing = 1 AND status = 'sending'",
            [],
        )?;
        conn.execute(
            "UPDATE message_deliveries SET status = 'queued' WHERE status = 'sending'",
            [],
        )?;
        conn.execute(
            "UPDATE transfers SET status = 'failed', error_reason = 'Interrupted when LANX closed. Press Resume to continue.'
             WHERE status = 'transferring'",
            [],
        )?;
        conn.execute(
            "UPDATE transfers SET status = 'queued' WHERE status = 'approved'",
            [],
        )?;
        conn.execute("UPDATE peers SET status = 'offline'", [])?;
        Ok(())
    }

    // ------------------------------------------------------------ transfers

    /// Files list. Transfers belonging to hidden chats are left out unless
    /// `include_hidden`.
    pub fn list_transfers(&self, include_hidden: bool) -> Result<Vec<TransferRecord>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(&format!(
            "{} WHERE (?1 OR t.conversation_id IS NULL OR t.conversation_id NOT IN
                        (SELECT id FROM conversations WHERE is_hidden = 1))
             ORDER BY t.created_at DESC",
            TRANSFER_SELECT
        ))?;
        let rows = stmt.query_map(params![include_hidden], row_to_transfer)?;
        Ok(rows.flatten().collect())
    }

    pub fn transfers_by_parent(&self, parent_id: &str) -> Result<Vec<TransferRecord>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(&format!("{} WHERE t.parent_id = ?1", TRANSFER_SELECT))?;
        let rows = stmt.query_map(params![parent_id], row_to_transfer)?;
        Ok(rows.flatten().collect())
    }

    pub fn get_transfer(&self, transfer_id: &str) -> Result<Option<TransferRecord>> {
        let conn = self.conn.lock();
        conn.query_row(
            &format!("{} WHERE t.id = ?1", TRANSFER_SELECT),
            params![transfer_id],
            row_to_transfer,
        )
        .optional()
    }

    pub fn queued_offers_for_peer(&self, peer_id: &str) -> Result<Vec<TransferRecord>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(&format!(
            "{} WHERE t.peer_id = ?1 AND t.direction = 'outgoing' AND t.status = 'queued' ORDER BY t.created_at ASC",
            TRANSFER_SELECT
        ))?;
        let rows = stmt.query_map(params![peer_id], row_to_transfer)?;
        Ok(rows.flatten().collect())
    }

    pub fn insert_transfer(&self, t: &TransferRecord) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO transfers (id, peer_id, conversation_id, file_name, file_size, file_hash, direction, status,
                                    transferred_bytes, local_path, error_reason, created_at, completed_at, temp_path,
                                    parent_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                t.id,
                t.peer_id,
                t.conversation_id,
                t.file_name,
                t.file_size,
                t.file_hash,
                t.direction,
                t.status,
                t.transferred_bytes,
                t.local_path,
                t.error_reason,
                t.created_at,
                t.completed_at,
                t.temp_path,
                t.parent_id,
            ],
        )?;
        Ok(())
    }

    /// Writes every mutable field of a transfer.
    pub fn save_transfer(&self, t: &TransferRecord) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE transfers SET status = ?1, transferred_bytes = ?2, local_path = ?3, error_reason = ?4,
                    completed_at = ?5, temp_path = ?6, file_hash = ?7
             WHERE id = ?8",
            params![
                t.status,
                t.transferred_bytes,
                t.local_path,
                t.error_reason,
                t.completed_at,
                t.temp_path,
                t.file_hash,
                t.id,
            ],
        )?;
        Ok(())
    }

    pub fn update_transfer_progress(&self, transfer_id: &str, bytes: i64) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE transfers SET transferred_bytes = ?1 WHERE id = ?2",
            params![bytes, transfer_id],
        )?;
        Ok(())
    }

    pub fn update_transfer_status(
        &self,
        transfer_id: &str,
        status: &str,
        reason: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock();
        let finished = matches!(status, "completed" | "failed" | "cancelled" | "declined");
        conn.execute(
            "UPDATE transfers SET status = ?1, error_reason = ?2,
                    completed_at = CASE WHEN ?3 THEN ?4 ELSE completed_at END
             WHERE id = ?5",
            params![status, reason, finished, now_secs(), transfer_id],
        )?;
        Ok(())
    }

    /// Removes finished transfers from the Files list (the files stay on disk).
    pub fn clear_finished_transfers(&self) -> Result<usize> {
        let conn = self.conn.lock();
        conn.execute(
            "DELETE FROM transfers WHERE status IN ('completed', 'cancelled', 'declined')",
            [],
        )
    }

    // ------------------------------------------------- secret / receipts

    /// Deletes secret messages whose time is up. Returns (message id, chat id).
    pub fn delete_expired_messages(&self, now: i64) -> Result<Vec<(String, String)>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "DELETE FROM messages WHERE expire_at IS NOT NULL AND expire_at <= ?1
             RETURNING id, conversation_id",
        )?;
        let rows = stmt.query_map(params![now], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.flatten().collect())
    }

    /// Incoming messages from `peer_id` whose "read" receipt still has to be
    /// sent, grouped by group id (None = direct chat).
    pub fn pending_receipts(&self, peer_id: &str) -> Result<Vec<(Option<String>, Vec<String>)>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT m.id, CASE WHEN c.kind = 'group' THEN c.id END
             FROM messages m JOIN conversations c ON c.id = m.conversation_id
             WHERE m.sender_id = ?1 AND m.is_outgoing = 0 AND m.receipt_pending = 1
             LIMIT 1000",
        )?;
        let rows = stmt.query_map(params![peer_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
        })?;
        let mut groups: Vec<(Option<String>, Vec<String>)> = Vec::new();
        for (id, group) in rows.flatten() {
            match groups.iter_mut().find(|(g, _)| *g == group) {
                Some((_, ids)) => ids.push(id),
                None => groups.push((group, vec![id])),
            }
        }
        Ok(groups)
    }

    pub fn clear_receipts(&self, ids: &[String]) -> Result<()> {
        let conn = self.conn.lock();
        for id in ids {
            conn.execute(
                "UPDATE messages SET receipt_pending = 0 WHERE id = ?1",
                params![id],
            )?;
        }
        Ok(())
    }

    /// A peer read our messages. Direct chats: the message becomes "read" and
    /// secret messages start their timer. Groups: that member's delivery row.
    /// Returns the ids of messages whose state changed.
    pub fn apply_read_receipt(
        &self,
        peer_id: &str,
        ids: &[String],
        group_id: Option<&str>,
    ) -> Result<Vec<String>> {
        let conn = self.conn.lock();
        let now = now_secs();
        let mut changed = Vec::new();
        for id in ids {
            let n = match group_id {
                None => conn.execute(
                    "UPDATE messages SET status = 'read',
                         expire_at = CASE WHEN ttl_secs IS NOT NULL
                                          THEN MIN(COALESCE(expire_at, ?3 + ttl_secs), ?3 + ttl_secs)
                                          ELSE expire_at END
                     WHERE id = ?1 AND is_outgoing = 1 AND receiver_id = ?2
                       AND status IN ('sending', 'queued', 'delivered')",
                    params![id, peer_id, now],
                )?,
                Some(g) => conn.execute(
                    "UPDATE message_deliveries SET status = 'read'
                     WHERE message_id = ?1 AND peer_id = ?2
                       AND message_id IN (SELECT id FROM messages WHERE conversation_id = ?3 AND is_outgoing = 1)",
                    params![id, peer_id, g],
                )?,
            };
            if n > 0 {
                changed.push(id.clone());
            }
        }
        Ok(changed)
    }

    // ------------------------------------------------------------ groups

    pub fn create_group(
        &self,
        group: &GroupInfo,
        members: &[(String, String, Option<String>)],
    ) -> Result<()> {
        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO groups (id, name, admin_id, version, avatar_color, membership, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                group.id,
                group.name,
                group.admin_id,
                group.version,
                group.avatar_color,
                group.membership,
                group.created_at
            ],
        )?;
        for (device_id, name, key) in members {
            tx.execute(
                "INSERT OR REPLACE INTO group_members (group_id, device_id, display_name, public_key)
                 VALUES (?1, ?2, ?3, ?4)",
                params![group.id, device_id, name, key],
            )?;
        }
        tx.execute(
            "INSERT OR IGNORE INTO conversations (id, peer_id, kind, last_message_preview, last_message_time,
                                                  unread_count, is_pinned, created_at)
             VALUES (?1, NULL, 'group', NULL, ?2, 0, 0, ?2)",
            params![group.id, group.created_at],
        )?;
        tx.commit()
    }

    /// Replaces a group's details and member list (newer version from the admin).
    pub fn update_group(
        &self,
        group_id: &str,
        name: &str,
        admin_id: &str,
        version: i64,
        membership: &str,
        members: &[(String, String, Option<String>)],
    ) -> Result<()> {
        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;
        tx.execute(
            "UPDATE groups SET name = ?1, admin_id = ?2, version = ?3, membership = ?4 WHERE id = ?5",
            params![name, admin_id, version, membership, group_id],
        )?;
        tx.execute("DELETE FROM group_members WHERE group_id = ?1", params![group_id])?;
        for (device_id, member_name, key) in members {
            tx.execute(
                "INSERT INTO group_members (group_id, device_id, display_name, public_key)
                 VALUES (?1, ?2, ?3, ?4)",
                params![group_id, device_id, member_name, key],
            )?;
        }
        tx.commit()
    }

    pub fn set_group_membership(&self, group_id: &str, membership: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE groups SET membership = ?1 WHERE id = ?2",
            params![membership, group_id],
        )?;
        Ok(())
    }

    pub fn remove_group_member(&self, group_id: &str, device_id: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "DELETE FROM group_members WHERE group_id = ?1 AND device_id = ?2",
            params![group_id, device_id],
        )?;
        conn.execute(
            "DELETE FROM message_deliveries WHERE peer_id = ?2 AND status IN ('sending', 'queued')
               AND message_id IN (SELECT id FROM messages WHERE conversation_id = ?1)",
            params![group_id, device_id],
        )?;
        Ok(())
    }

    pub fn get_group(&self, group_id: &str, my_id: &str) -> Result<Option<GroupInfo>> {
        let conn = self.conn.lock();
        let base = conn
            .query_row(
                "SELECT id, name, admin_id, version, avatar_color, membership, created_at FROM groups WHERE id = ?1",
                params![group_id],
                |r| {
                    Ok(GroupInfo {
                        id: r.get(0)?,
                        name: r.get(1)?,
                        admin_id: r.get(2)?,
                        version: r.get(3)?,
                        avatar_color: r.get(4)?,
                        membership: r.get(5)?,
                        created_at: r.get(6)?,
                        members: Vec::new(),
                    })
                },
            )
            .optional()?;
        let Some(mut g) = base else {
            return Ok(None);
        };
        let mut stmt = conn.prepare(
            "SELECT gm.device_id, COALESCE(p.display_name, gm.display_name), COALESCE(gm.public_key, p.public_key),
                    COALESCE(p.status, 'offline')
             FROM group_members gm LEFT JOIN peers p ON p.id = gm.device_id
             WHERE gm.group_id = ?1
             ORDER BY gm.rowid",
        )?;
        let admin = g.admin_id.clone();
        g.members = stmt
            .query_map(params![group_id], |r| {
                let device_id: String = r.get(0)?;
                Ok(GroupMemberInfo {
                    is_admin: device_id == admin,
                    is_me: device_id == my_id,
                    status: if device_id == my_id { "online".to_string() } else { r.get(3)? },
                    display_name: r.get(1)?,
                    public_key: r.get(2)?,
                    device_id,
                })
            })?
            .flatten()
            .collect();
        Ok(Some(g))
    }

    /// Queue a group change ('update' or 'leave') for a member.
    pub fn queue_group_sync(&self, group_id: &str, peer_id: &str, kind: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT OR REPLACE INTO group_sync (group_id, peer_id, kind) VALUES (?1, ?2, ?3)",
            params![group_id, peer_id, kind],
        )?;
        Ok(())
    }

    pub fn pending_group_syncs(&self, peer_id: &str) -> Result<Vec<(String, String)>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT group_id, kind FROM group_sync WHERE peer_id = ?1")?;
        let rows = stmt.query_map(params![peer_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.flatten().collect())
    }

    pub fn clear_group_sync(&self, group_id: &str, peer_id: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "DELETE FROM group_sync WHERE group_id = ?1 AND peer_id = ?2",
            params![group_id, peer_id],
        )?;
        Ok(())
    }

    pub fn insert_deliveries(&self, message_id: &str, peer_ids: &[String]) -> Result<()> {
        let conn = self.conn.lock();
        for p in peer_ids {
            conn.execute(
                "INSERT OR IGNORE INTO message_deliveries (message_id, peer_id, status) VALUES (?1, ?2, 'sending')",
                params![message_id, p],
            )?;
        }
        Ok(())
    }

    /// Group messages still waiting to reach `peer_id`.
    pub fn pending_group_deliveries(&self, peer_id: &str) -> Result<Vec<Message>> {
        let conn = self.conn.lock();
        let cols = MSG_COLS
            .split(", ")
            .map(|c| format!("m.{}", c))
            .collect::<Vec<_>>()
            .join(", ");
        let mut stmt = conn.prepare(&format!(
            "SELECT {} FROM message_deliveries d JOIN messages m ON m.id = d.message_id
             WHERE d.peer_id = ?1 AND d.status IN ('sending', 'queued') AND m.message_type = 'text'
             ORDER BY m.timestamp ASC, m.rowid ASC",
            cols
        ))?;
        let rows = stmt.query_map(params![peer_id], row_to_message)?;
        Ok(rows.flatten().collect())
    }

    pub fn set_delivery_status(
        &self,
        message_id: &str,
        peer_id: &str,
        status: &str,
        reason: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE message_deliveries SET status = ?1, error_reason = ?2
             WHERE message_id = ?3 AND peer_id = ?4 AND status != 'read'",
            params![status, reason, message_id, peer_id],
        )?;
        Ok(())
    }
}

/// Sidebar preview for a message (secret messages never show their text).
pub fn message_preview(msg: &Message) -> String {
    if msg.ttl_secs.is_some() {
        return "🔒 Secret message".to_string();
    }
    match msg.message_type.as_str() {
        "secret_setting" => {
            if msg.content.trim() == "0" {
                "Secret messages turned off".to_string()
            } else {
                "🔒 Secret messages turned on".to_string()
            }
        }
        "ring" => "🔔 Ring".to_string(),
        "call" => call_preview(&msg.content, msg.is_outgoing),
        _ => preview_text(&msg.content),
    }
}

/// "📞 Video call · 3:12", "📞 Missed voice call", … from a call record.
pub fn call_preview(content: &str, outgoing: bool) -> String {
    let v: serde_json::Value = serde_json::from_str(content).unwrap_or_default();
    let kind = if v["video"].as_bool().unwrap_or(false) { "video" } else { "voice" };
    let secs = v["secs"].as_i64().unwrap_or(0);
    match v["outcome"].as_str().unwrap_or("") {
        "answered" => format!(
            "📞 {} call · {}:{:02}",
            if kind == "video" { "Video" } else { "Voice" },
            secs / 60,
            secs % 60
        ),
        "missed" | "busy" => format!("📞 Missed {} call", kind),
        "declined" if outgoing => "📞 Call declined".to_string(),
        "declined" => format!("📞 Declined {} call", kind),
        "no_answer" => "📞 No answer".to_string(),
        "cancelled" => "📞 Cancelled call".to_string(),
        _ => "📞 Call failed".to_string(),
    }
}

fn hostname() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "LANX-Node".to_string())
}

fn whoami_user() -> String {
    std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "User".to_string())
}

fn rand_index(len: usize) -> usize {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    (now as usize) % len
}
