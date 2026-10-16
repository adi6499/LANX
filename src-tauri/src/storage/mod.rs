pub mod models;
pub mod schema;
#[cfg(test)]
mod tests;

use models::*;
use parking_lot::Mutex;
use rusqlite::{Connection, Result, params};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

pub struct Database {
    pub conn: Arc<Mutex<Connection>>,
    db_path: PathBuf,
}

impl Database {
    pub fn new() -> Result<Self> {
        let db_dir = dirs::data_dir()
            .map(|p| p.join("LANX"))
            .unwrap_or_else(|| PathBuf::from("./data"));

        if !db_dir.exists() {
            let _ = fs::create_dir_all(&db_dir);
        }

        let db_path = db_dir.join("lanx.db");
        let mut conn = Connection::open(&db_path)?;

        // Pragmas for performance and concurrency
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;",
        )?;

        // Run migrations
        schema::run_migrations(&mut conn)?;

        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
            db_path,
        };

        // Initialize default settings if first run
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
        fs::metadata(&self.db_path).map(|m| m.len()).unwrap_or(0)
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
        for r in rows {
            if let Ok((k, v)) = r {
                map.insert(k, v);
            }
        }

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
            notifications_enabled: map
                .get("notifications_enabled")
                .map(|v| v == "true" || v == "1")
                .unwrap_or(true),
            auto_download_transfers: map
                .get("auto_download_transfers")
                .map(|v| v == "true" || v == "1")
                .unwrap_or(false),
            default_download_dir: map.get("default_download_dir").cloned().unwrap_or_default(),
            onboarding_completed: map
                .get("onboarding_completed")
                .map(|v| v == "true" || v == "1")
                .unwrap_or(false),
        })
    }

    pub fn save_settings(&self, settings: &UserSettings) -> Result<()> {
        let conn = self.conn.lock();
        let pairs = [
            ("display_name", settings.display_name.clone()),
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
                settings.discovery_interval_secs.to_string(),
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
        ];

        for (k, v) in pairs {
            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
                params![k, v],
            )?;
        }

        Ok(())
    }

    pub fn set_onboarding_completed(&self, completed: bool) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('onboarding_completed', ?1)",
            params![completed.to_string()],
        )?;
        Ok(())
    }

    pub fn list_peers(&self) -> Result<Vec<Peer>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, display_name, hostname, last_ip, tcp_port, public_key, trust_state, status, last_seen, avatar_color
             FROM peers ORDER BY status DESC, last_seen DESC",
        )?;

        let rows = stmt.query_map([], |row| {
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
        })?;

        let mut peers = Vec::new();
        for r in rows {
            if let Ok(p) = r {
                peers.push(p);
            }
        }
        Ok(peers)
    }

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

    pub fn update_peer_trust(&self, peer_id: &str, trust_state: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE peers SET trust_state = ?1 WHERE id = ?2",
            params![trust_state, peer_id],
        )?;
        Ok(())
    }

    pub fn get_conversations(&self) -> Result<Vec<Conversation>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT c.id, c.peer_id, p.display_name, p.status, p.avatar_color, p.last_ip,
                    c.last_message_preview, c.last_message_time, c.unread_count, c.is_pinned, c.created_at
             FROM conversations c
             JOIN peers p ON c.peer_id = p.id
             ORDER BY c.is_pinned DESC, c.last_message_time DESC",
        )?;

        let rows = stmt.query_map([], |row| {
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
            })
        })?;

        let mut list = Vec::new();
        for r in rows {
            if let Ok(c) = r {
                list.push(c);
            }
        }
        Ok(list)
    }

    pub fn get_or_create_conversation(&self, peer_id: &str) -> Result<Conversation> {
        let conn = self.conn.lock();

        let existing = conn.query_row(
            "SELECT c.id, c.peer_id, p.display_name, p.status, p.avatar_color, p.last_ip,
                    c.last_message_preview, c.last_message_time, c.unread_count, c.is_pinned, c.created_at
             FROM conversations c
             JOIN peers p ON c.peer_id = p.id
             WHERE c.peer_id = ?1",
            params![peer_id],
            |row| {
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
                })
            },
        );

        if let Ok(c) = existing {
            return Ok(c);
        }

        // Need to create conversation
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

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
            let default_name = format!("Peer {}", &peer_id[..peer_id.len().min(8)]);
            conn.execute(
                "INSERT OR IGNORE INTO peers (id, display_name, hostname, last_ip, tcp_port, trust_state, status, last_seen, avatar_color)
                 VALUES (?1, ?2, 'LAN Node', '127.0.0.1', 52926, 'unverified', 'online', ?3, '#3b82f6')",
                params![peer_id, default_name, now],
            )?;
        }

        let conv_id = Uuid::new_v4().to_string();

        conn.execute(
            "INSERT INTO conversations (id, peer_id, last_message_preview, last_message_time, unread_count, is_pinned, created_at)
             VALUES (?1, ?2, NULL, ?3, 0, 0, ?4)",
            params![conv_id, peer_id, now, now],
        )?;

        // Query created record
        conn.query_row(
            "SELECT c.id, c.peer_id, p.display_name, p.status, p.avatar_color, p.last_ip,
                    c.last_message_preview, c.last_message_time, c.unread_count, c.is_pinned, c.created_at
             FROM conversations c
             JOIN peers p ON c.peer_id = p.id
             WHERE c.id = ?1",
            params![conv_id],
            |row| {
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
                })
            },
        )
    }

    pub fn get_messages(&self, conversation_id: &str) -> Result<Vec<Message>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, sender_id, receiver_id, content, message_type, timestamp, status, error_reason, is_outgoing
             FROM messages
             WHERE conversation_id = ?1
             ORDER BY timestamp ASC",
        )?;

        let rows = stmt.query_map(params![conversation_id], |row| {
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
            })
        })?;

        let mut list = Vec::new();
        for r in rows {
            if let Ok(m) = r {
                list.push(m);
            }
        }
        Ok(list)
    }

    pub fn get_message_by_id(&self, message_id: &str) -> Result<Option<Message>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, sender_id, receiver_id, content, message_type, timestamp, status, error_reason, is_outgoing
             FROM messages
             WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![message_id], |row| {
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
            })
        })?;

        if let Some(res) = rows.next() {
            Ok(Some(res?))
        } else {
            Ok(None)
        }
    }

    pub fn insert_message(&self, msg: &Message) -> Result<()> {
        let conn = self.conn.lock();
        let is_outgoing = if msg.is_outgoing { 1 } else { 0 };

        conn.execute(
            "INSERT INTO messages (id, conversation_id, sender_id, receiver_id, content, message_type, timestamp, status, error_reason, is_outgoing)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
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
                is_outgoing,
            ],
        )?;

        // Update conversation summary
        let preview = if msg.content.len() > 60 {
            format!("{}...", &msg.content[..60])
        } else {
            msg.content.clone()
        };

        conn.execute(
            "UPDATE conversations
             SET last_message_preview = ?1, last_message_time = ?2
             WHERE id = ?3",
            params![preview, msg.timestamp, msg.conversation_id],
        )?;

        Ok(())
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

    pub fn mark_conversation_read(&self, conversation_id: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE conversations SET unread_count = 0 WHERE id = ?1",
            params![conversation_id],
        )?;
        conn.execute(
            "UPDATE messages SET status = 'read' WHERE conversation_id = ?1 AND is_outgoing = 0 AND status = 'delivered'",
            params![conversation_id],
        )?;
        Ok(())
    }

    pub fn delete_conversation(&self, conversation_id: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "DELETE FROM conversations WHERE id = ?1",
            params![conversation_id],
        )?;
        Ok(())
    }

    pub fn list_transfers(&self) -> Result<Vec<TransferRecord>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT t.id, t.peer_id, p.display_name, t.file_name, t.file_size, t.file_hash,
                    t.direction, t.status, t.transferred_bytes, t.local_path, t.created_at, t.completed_at
             FROM transfers t
             LEFT JOIN peers p ON t.peer_id = p.id
             ORDER BY t.created_at DESC",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(TransferRecord {
                id: row.get(0)?,
                peer_id: row.get(1)?,
                peer_name: row.get(2)?,
                file_name: row.get(3)?,
                file_size: row.get(4)?,
                file_hash: row.get(5)?,
                direction: row.get(6)?,
                status: row.get(7)?,
                transferred_bytes: row.get(8)?,
                local_path: row.get(9)?,
                created_at: row.get(10)?,
                completed_at: row.get(11)?,
            })
        })?;

        let mut list = Vec::new();
        for r in rows {
            if let Ok(t) = r {
                list.push(t);
            }
        }
        Ok(list)
    }

    pub fn insert_transfer(&self, t: &TransferRecord) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO transfers (id, peer_id, file_name, file_size, file_hash, direction, status, transferred_bytes, local_path, created_at, completed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                t.id,
                t.peer_id,
                t.file_name,
                t.file_size,
                t.file_hash,
                t.direction,
                t.status,
                t.transferred_bytes,
                t.local_path,
                t.created_at,
                t.completed_at,
            ],
        )?;
        Ok(())
    }

    pub fn update_transfer_status(
        &self,
        transfer_id: &str,
        status: &str,
        transferred_bytes: i64,
    ) -> Result<()> {
        let conn = self.conn.lock();
        let completed_at = if status == "completed" || status == "failed" || status == "cancelled" {
            Some(
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs() as i64,
            )
        } else {
            None
        };

        conn.execute(
            "UPDATE transfers SET status = ?1, transferred_bytes = ?2, completed_at = COALESCE(?3, completed_at) WHERE id = ?4",
            params![status, transferred_bytes, completed_at, transfer_id],
        )?;
        Ok(())
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
