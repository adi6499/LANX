//! LANX 1.7.0: storage for chat folders / mute / archive / pin, searching
//! with filters, and shared folders that stay in sync.

use super::models::*;
use super::{Database, MSG_COLS, row_to_message};
use rusqlite::{OptionalExtension, Result, params};
use serde::{Deserialize, Serialize};

/// Search filters (all optional).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SearchFilter {
    #[serde(default)]
    pub conversation_id: Option<String>,
    /// A colleague's device id, or "me".
    #[serde(default)]
    pub sender: Option<String>,
    /// all | text | files | links | cards
    #[serde(default)]
    pub kind: Option<String>,
    /// Unix seconds.
    #[serde(default)]
    pub since: Option<i64>,
}

/// A folder this computer shares (it keeps colleagues' copies up to date).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncShare {
    pub id: String,
    pub name: String,
    pub path: String,
    pub conversation_id: String,
    pub created_at: i64,
    pub active: bool,
    /// Colleagues who get it (names).
    pub subscribers: Vec<String>,
}

/// A colleague's folder this computer receives.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncSubscription {
    pub share_id: String,
    pub owner_id: String,
    pub owner_name: String,
    pub name: String,
    pub dest_path: String,
    pub conversation_id: String,
    pub since: i64,
    pub files: i64,
    pub bytes: i64,
    pub last_at: i64,
    /// active | stopped
    pub status: String,
}

impl Database {
    // ------------------------------------------------------------ chat flags

    pub fn set_conversation_pinned(&self, id: &str, pinned: bool) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute("UPDATE conversations SET is_pinned = ?1 WHERE id = ?2", params![pinned as i64, id])?;
        Ok(())
    }

    pub fn set_conversation_muted(&self, id: &str, until: i64) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute("UPDATE conversations SET muted_until = ?1 WHERE id = ?2", params![until, id])?;
        Ok(())
    }

    pub fn set_conversation_archived(&self, id: &str, archived: bool) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute("UPDATE conversations SET archived = ?1 WHERE id = ?2", params![archived as i64, id])?;
        Ok(())
    }

    pub fn set_conversation_folders(&self, id: &str, folders: &[String]) -> Result<()> {
        let json = (!folders.is_empty()).then(|| serde_json::to_string(folders).unwrap_or_default());
        let conn = self.conn.lock();
        conn.execute("UPDATE conversations SET folders = ?1 WHERE id = ?2", params![json, id])?;
        Ok(())
    }

    // ----------------------------------------------------------------- search

    /// Searches messages with filters (newest first). Secret messages are
    /// never searchable; hidden chats only when unlocked.
    pub fn search_messages_ex(&self, query: &str, f: &SearchFilter, limit: usize, include_hidden: bool) -> Result<Vec<SearchHit>> {
        let q = query.trim();
        let escaped = q.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
        let pattern = format!("%{}%", escaped);
        let kind = f.kind.as_deref().unwrap_or("all");
        let type_sql = match kind {
            "text" => "m.message_type = 'text'",
            "files" => "m.message_type = 'file'",
            "links" => "m.message_type = 'text' AND (m.content LIKE '%http://%' OR m.content LIKE '%https://%' OR m.content LIKE '%www.%')",
            "cards" => "m.message_type = 'card'",
            _ => "m.message_type IN ('text', 'file', 'card')",
        };
        let sender = f.sender.as_deref().unwrap_or("");
        let sender_sql = match sender {
            "" => "1",
            "me" => "m.is_outgoing = 1",
            _ => "(m.is_outgoing = 0 AND m.sender_id = ?4)",
        };
        let cols = MSG_COLS.split(", ").map(|c| format!("m.{}", c)).collect::<Vec<_>>().join(", ");
        let sql = format!(
            "SELECT {cols}, COALESCE(p.display_name, g.name, ''), COALESCE(p.avatar_color, g.avatar_color, '#6366f1')
             FROM messages m
             JOIN conversations c ON m.conversation_id = c.id
             LEFT JOIN peers p ON c.peer_id = p.id
             LEFT JOIN groups g ON g.id = c.id
             WHERE (?1 = '%%' OR m.content LIKE ?1 ESCAPE '\\')
               AND {type_sql} AND m.ttl_secs IS NULL AND m.deleted = 0
               AND (?3 OR c.is_hidden = 0)
               AND {sender_sql}
               AND (?5 = '' OR m.conversation_id = ?5)
               AND (?6 = 0 OR m.timestamp >= ?6)
             ORDER BY m.timestamp DESC
             LIMIT ?2"
        );
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(&sql)?;
        let conv = f.conversation_id.clone().unwrap_or_default();
        let rows = stmt.query_map(
            params![pattern, limit as i64, include_hidden, sender, conv, f.since.unwrap_or(0)],
            |row| {
                Ok(SearchHit {
                    message: row_to_message(row)?,
                    peer_name: row.get(21)?,
                    peer_avatar_color: row.get(22)?,
                })
            },
        )?;
        Ok(rows.flatten().collect())
    }

    /// The chat message of a transfer (a group copy points at its parent).
    pub fn message_for_transfer(&self, transfer_id: &str) -> Result<Option<Message>> {
        let t = self.get_transfer(transfer_id)?;
        let key = t.as_ref().and_then(|t| t.parent_id.clone()).unwrap_or_else(|| transfer_id.to_string());
        self.get_message_by_transfer(&key)
    }

    // ---------------------------------------------------------- shared folders

    pub fn insert_sync_share(&self, s: &SyncShare) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO sync_shares (id, name, path, conversation_id, created_at, active) VALUES (?1, ?2, ?3, ?4, ?5, 1)",
            params![s.id, s.name, s.path, s.conversation_id, s.created_at],
        )?;
        Ok(())
    }

    pub fn sync_shares(&self) -> Result<Vec<SyncShare>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT s.id, s.name, s.path, s.conversation_id, s.created_at, s.active,
                    (SELECT GROUP_CONCAT(COALESCE(p.display_name, '?'), ', ') FROM sync_subscribers b LEFT JOIN peers p ON p.id = b.peer_id WHERE b.share_id = s.id)
             FROM sync_shares s ORDER BY s.created_at DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(SyncShare {
                id: r.get(0)?,
                name: r.get(1)?,
                path: r.get(2)?,
                conversation_id: r.get(3)?,
                created_at: r.get(4)?,
                active: r.get::<_, i64>(5)? != 0,
                subscribers: r
                    .get::<_, Option<String>>(6)?
                    .map(|s| s.split(", ").map(|x| x.to_string()).collect())
                    .unwrap_or_default(),
            })
        })?;
        Ok(rows.flatten().collect())
    }

    pub fn sync_share(&self, id: &str) -> Result<Option<SyncShare>> {
        Ok(self.sync_shares()?.into_iter().find(|s| s.id == id))
    }

    pub fn set_sync_share_active(&self, id: &str, active: bool) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute("UPDATE sync_shares SET active = ?1 WHERE id = ?2", params![active as i64, id])?;
        Ok(())
    }

    pub fn add_sync_subscriber(&self, share_id: &str, peer_id: &str, now: i64) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT OR IGNORE INTO sync_subscribers (share_id, peer_id, since) VALUES (?1, ?2, ?3)",
            params![share_id, peer_id, now],
        )?;
        Ok(())
    }

    pub fn remove_sync_subscriber(&self, share_id: &str, peer_id: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM sync_subscribers WHERE share_id = ?1 AND peer_id = ?2", params![share_id, peer_id])?;
        conn.execute("DELETE FROM sync_sent WHERE share_id = ?1 AND peer_id = ?2", params![share_id, peer_id])?;
        Ok(())
    }

    pub fn sync_subscriber_ids(&self, share_id: &str) -> Result<Vec<String>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT peer_id FROM sync_subscribers WHERE share_id = ?1")?;
        let rows = stmt.query_map(params![share_id], |r| r.get(0))?;
        Ok(rows.flatten().collect())
    }

    /// (size, mtime) last offered of each file to one colleague.
    pub fn sync_sent_map(&self, share_id: &str, peer_id: &str) -> Result<std::collections::HashMap<String, (i64, i64)>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT rel_path, size, mtime FROM sync_sent WHERE share_id = ?1 AND peer_id = ?2")?;
        let rows = stmt.query_map(params![share_id, peer_id], |r| Ok((r.get::<_, String>(0)?, (r.get::<_, i64>(1)?, r.get::<_, i64>(2)?))))?;
        Ok(rows.flatten().collect())
    }

    pub fn mark_sync_sent(&self, share_id: &str, peer_id: &str, rel: &str, size: i64, mtime: i64) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT OR REPLACE INTO sync_sent (share_id, peer_id, rel_path, size, mtime) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![share_id, peer_id, rel, size, mtime],
        )?;
        Ok(())
    }

    /// Sends everything again to this colleague on the next check.
    pub fn reset_sync_sent(&self, share_id: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM sync_sent WHERE share_id = ?1", params![share_id])?;
        Ok(())
    }

    pub fn upsert_sync_subscription(&self, s: &SyncSubscription) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO sync_subscriptions (share_id, owner_id, name, dest_path, conversation_id, since, files, bytes, last_at, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 0, 0, 'active')
             ON CONFLICT(share_id) DO UPDATE SET dest_path = excluded.dest_path, status = 'active'",
            params![s.share_id, s.owner_id, s.name, s.dest_path, s.conversation_id, s.since],
        )?;
        Ok(())
    }

    pub fn sync_subscriptions(&self) -> Result<Vec<SyncSubscription>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT s.share_id, s.owner_id, COALESCE(p.display_name, ''), s.name, s.dest_path, s.conversation_id, s.since,
                    s.files, s.bytes, s.last_at, s.status
             FROM sync_subscriptions s LEFT JOIN peers p ON p.id = s.owner_id ORDER BY s.since DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(SyncSubscription {
                share_id: r.get(0)?,
                owner_id: r.get(1)?,
                owner_name: r.get(2)?,
                name: r.get(3)?,
                dest_path: r.get(4)?,
                conversation_id: r.get(5)?,
                since: r.get(6)?,
                files: r.get(7)?,
                bytes: r.get(8)?,
                last_at: r.get(9)?,
                status: r.get(10)?,
            })
        })?;
        Ok(rows.flatten().collect())
    }

    pub fn sync_subscription(&self, share_id: &str) -> Result<Option<SyncSubscription>> {
        Ok(self.sync_subscriptions()?.into_iter().find(|s| s.share_id == share_id))
    }

    pub fn set_sync_subscription_status(&self, share_id: &str, status: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute("UPDATE sync_subscriptions SET status = ?1 WHERE share_id = ?2", params![status, share_id])?;
        Ok(())
    }

    pub fn delete_sync_subscription(&self, share_id: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM sync_subscriptions WHERE share_id = ?1", params![share_id])?;
        Ok(())
    }

    pub fn count_sync_file(&self, share_id: &str, bytes: i64, now: i64) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE sync_subscriptions SET files = files + 1, bytes = bytes + ?1, last_at = ?2 WHERE share_id = ?3",
            params![bytes, now, share_id],
        )?;
        Ok(())
    }

    pub fn insert_sync_transfer(&self, transfer_id: &str, share_id: &str, rel: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT OR REPLACE INTO sync_transfers (transfer_id, share_id, rel_path) VALUES (?1, ?2, ?3)",
            params![transfer_id, share_id, rel],
        )?;
        Ok(())
    }

    /// Files whose sending failed (e.g. the colleague went offline mid-way)
    /// are sent again in the next check.
    pub fn sync_retry_failed(&self, share_id: &str) -> Result<usize> {
        let conn = self.conn.lock();
        let n = conn.execute(
            "DELETE FROM sync_sent WHERE share_id = ?1 AND EXISTS (
                SELECT 1 FROM sync_transfers st JOIN transfers t ON t.id = st.transfer_id
                WHERE st.share_id = ?1 AND st.rel_path = sync_sent.rel_path AND t.peer_id = sync_sent.peer_id
                  AND t.direction = 'outgoing' AND t.status = 'failed')",
            params![share_id],
        )?;
        conn.execute(
            "DELETE FROM transfers WHERE kind = 'sync' AND direction = 'outgoing' AND status = 'failed'
               AND id IN (SELECT transfer_id FROM sync_transfers WHERE share_id = ?1)",
            params![share_id],
        )?;
        Ok(n)
    }

    /// Shared-folder files still waiting to go out (all colleagues).
    pub fn sync_pending_count(&self, share_id: &str) -> Result<i64> {
        let conn = self.conn.lock();
        conn.query_row(
            "SELECT COUNT(*) FROM transfers t JOIN sync_transfers st ON st.transfer_id = t.id
             WHERE st.share_id = ?1 AND t.direction = 'outgoing'
               AND t.status IN ('queued','pending','approved','transferring')",
            params![share_id],
            |r| r.get(0),
        )
    }

    /// Finished shared-folder transfers are not kept (they'd fill the list).
    pub fn prune_sync_transfers(&self, before: i64) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "DELETE FROM transfers WHERE kind = 'sync'
               AND status IN ('completed','declined','cancelled','failed')
               AND COALESCE(completed_at, created_at) < ?1",
            params![before],
        )?;
        conn.execute(
            "DELETE FROM sync_transfers WHERE transfer_id NOT IN (SELECT id FROM transfers)",
            [],
        )?;
        Ok(())
    }

    /// (share id, relative path) of a sync transfer.
    pub fn sync_transfer(&self, transfer_id: &str) -> Result<Option<(String, String)>> {
        let conn = self.conn.lock();
        conn.query_row(
            "SELECT share_id, rel_path FROM sync_transfers WHERE transfer_id = ?1",
            params![transfer_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
    }
}
