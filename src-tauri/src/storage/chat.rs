//! LANX 1.5.0: storage for the chat features — reactions, edits, deletes for
//! everyone, pins, stars, reminders, messages scheduled for later, and the
//! queue of message actions waiting to reach colleagues.

use super::models::*;
use super::{Database, MSG_COLS, mentions_json, message_preview, row_to_message};
use rusqlite::{OptionalExtension, Result, params};
use std::collections::HashMap;

impl Database {
    fn my_device_id(&self) -> String {
        self.get_setting("device_id").unwrap_or_default()
    }

    /// Reactions (with names) for some messages, keyed by message id.
    fn reactions_for(&self, ids: &[&str]) -> Result<HashMap<String, Vec<Reaction>>> {
        let mut out: HashMap<String, Vec<Reaction>> = HashMap::new();
        if ids.is_empty() {
            return Ok(out);
        }
        let me = self.my_device_id();
        let conn = self.conn.lock();
        let marks = vec!["?"; ids.len()].join(",");
        let mut stmt = conn.prepare(&format!(
            "SELECT r.message_id, r.peer_id, r.emoji, COALESCE(p.display_name, '')
             FROM reactions r LEFT JOIN peers p ON p.id = r.peer_id
             WHERE r.message_id IN ({}) ORDER BY r.at ASC",
            marks
        ))?;
        let rows = stmt.query_map(rusqlite::params_from_iter(ids.iter()), |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?))
        })?;
        for (mid, peer, emoji, name) in rows.flatten() {
            let list = out.entry(mid).or_default();
            let mine = peer == me;
            let who = if mine { "You".to_string() } else if name.is_empty() { "Someone".to_string() } else { name };
            match list.iter_mut().find(|x| x.emoji == emoji) {
                Some(x) => {
                    x.count += 1;
                    x.mine |= mine;
                    x.names.push(who);
                }
                None => list.push(Reaction { emoji, count: 1, mine, names: vec![who] }),
            }
        }
        Ok(out)
    }

    /// Adds reactions and reminders to loaded messages.
    pub(super) fn fill_extras(&self, conversation_id: &str, messages: &mut [Message]) -> Result<()> {
        if messages.is_empty() {
            return Ok(());
        }
        let ids: Vec<&str> = messages.iter().map(|m| m.id.as_str()).collect();
        let mut reactions = self.reactions_for(&ids)?;
        let reminders: HashMap<String, (i64, bool)> = {
            let conn = self.conn.lock();
            let mut stmt = conn.prepare("SELECT message_id, remind_at, no_reply FROM reminders WHERE conversation_id = ?1")?;
            let rows = stmt.query_map(params![conversation_id], |r| {
                Ok((r.get::<_, String>(0)?, (r.get::<_, i64>(1)?, r.get::<_, i64>(2)? != 0)))
            })?;
            rows.flatten().collect()
        };
        let card_ids: Vec<&str> = messages.iter().filter(|m| m.message_type == "card").map(|m| m.id.as_str()).collect();
        let mut cards = self.card_entries_for(&card_ids)?;
        for m in messages.iter_mut() {
            m.reactions = reactions.remove(&m.id).unwrap_or_default();
            m.remind_at = reminders.get(&m.id).map(|r| r.0);
            m.remind_no_reply = reminders.get(&m.id).is_some_and(|r| r.1);
            m.card_state = cards.remove(&m.id).unwrap_or_default();
        }
        Ok(())
    }

    // ------------------------------------------------------------ 1.6.0 cards

    fn card_entries_for(&self, ids: &[&str]) -> Result<HashMap<String, Vec<CardEntry>>> {
        let mut out: HashMap<String, Vec<CardEntry>> = HashMap::new();
        if ids.is_empty() {
            return Ok(out);
        }
        let me = self.my_device_id();
        let conn = self.conn.lock();
        let marks = vec!["?"; ids.len()].join(",");
        let mut stmt = conn.prepare(&format!(
            "SELECT s.card_id, s.key, s.peer_id, s.value, s.at, COALESCE(p.display_name, '')
             FROM card_state s LEFT JOIN peers p ON p.id = s.peer_id
             WHERE s.card_id IN ({}) ORDER BY s.at ASC",
            marks
        ))?;
        let rows = stmt.query_map(rusqlite::params_from_iter(ids.iter()), |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, String>(5)?,
            ))
        })?;
        for (card, key, peer, value, at, name) in rows.flatten() {
            let name = if peer == me { "You".to_string() } else if name.is_empty() { "Someone".to_string() } else { name };
            out.entry(card).or_default().push(CardEntry {
                key,
                peer_id: peer,
                name,
                value: serde_json::from_str(&value).unwrap_or(serde_json::Value::Null),
                at,
            });
        }
        Ok(out)
    }

    /// Sets a card entry unless a newer one is stored. True when it changed.
    pub fn set_card_state(&self, card_id: &str, key: &str, peer_id: &str, value: &str, at: i64) -> Result<bool> {
        let conn = self.conn.lock();
        let current: Option<(String, i64)> = conn
            .query_row(
                "SELECT value, at FROM card_state WHERE card_id = ?1 AND key = ?2",
                params![card_id, key],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((v, t)) = &current {
            if *t > at || (*t == at && v == value) {
                return Ok(false);
            }
        }
        conn.execute(
            "INSERT OR REPLACE INTO card_state (card_id, key, peer_id, value, at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![card_id, key, peer_id, value, at],
        )?;
        Ok(true)
    }

    /// When a card entry was last set.
    pub fn card_entry_at(&self, card_id: &str, key: &str) -> Option<i64> {
        let conn = self.conn.lock();
        conn.query_row("SELECT at FROM card_state WHERE card_id = ?1 AND key = ?2", params![card_id, key], |r| r.get(0))
            .ok()
    }

    /// Every card in every chat (newest first), for the Organiser.
    pub fn list_cards(&self, include_hidden: bool) -> Result<Vec<SearchHit>> {
        let cols = MSG_COLS.split(", ").map(|c| format!("m.{}", c)).collect::<Vec<_>>().join(", ");
        let mut hits: Vec<SearchHit> = {
            let conn = self.conn.lock();
            let mut stmt = conn.prepare(&format!(
                "SELECT {}, COALESCE(p.display_name, g.name, ''), COALESCE(p.avatar_color, g.avatar_color, '#6366f1')
                 FROM messages m
                 JOIN conversations c ON m.conversation_id = c.id
                 LEFT JOIN peers p ON c.peer_id = p.id
                 LEFT JOIN groups g ON g.id = c.id
                 WHERE m.message_type = 'card' AND m.deleted = 0 AND (?1 OR c.is_hidden = 0)
                 ORDER BY m.timestamp DESC LIMIT 1000",
                cols
            ))?;
            let rows = stmt.query_map(params![include_hidden], |row| {
                Ok(SearchHit {
                    message: row_to_message(row)?,
                    peer_name: row.get(21)?,
                    peer_avatar_color: row.get(22)?,
                })
            })?;
            rows.flatten().collect()
        };
        let ids: Vec<String> = hits.iter().map(|h| h.message.id.clone()).collect();
        let refs: Vec<&str> = ids.iter().map(|s| s.as_str()).collect();
        let mut cards = self.card_entries_for(&refs)?;
        let reminders: HashMap<String, (i64, bool)> = {
            let conn = self.conn.lock();
            let mut stmt = conn.prepare("SELECT message_id, remind_at, no_reply FROM reminders")?;
            let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, (r.get::<_, i64>(1)?, r.get::<_, i64>(2)? != 0))))?;
            rows.flatten().collect()
        };
        for h in hits.iter_mut() {
            h.message.card_state = cards.remove(&h.message.id).unwrap_or_default();
            h.message.remind_at = reminders.get(&h.message.id).map(|r| r.0);
            h.message.remind_no_reply = reminders.get(&h.message.id).is_some_and(|r| r.1);
        }
        Ok(hits)
    }

    /// One message with its reactions and reminder.
    pub fn get_message_full(&self, message_id: &str) -> Result<Option<Message>> {
        let Some(mut m) = self.get_message_by_id(message_id)? else { return Ok(None) };
        let conv = m.conversation_id.clone();
        self.fill_extras(&conv, std::slice::from_mut(&mut m))?;
        // Group messages keep their "delivered / seen by" summary.
        if m.is_outgoing {
            m.deliveries = self.delivery_summary(&m.id);
        }
        Ok(Some(m))
    }

    // -------------------------------------------------------------- reactions

    /// Sets (or with an empty emoji removes) someone's reaction, unless a
    /// newer one is already stored. Returns true when something changed.
    pub fn set_reaction(&self, message_id: &str, peer_id: &str, emoji: &str, at: i64) -> Result<bool> {
        let conn = self.conn.lock();
        let current: Option<(String, i64)> = conn
            .query_row(
                "SELECT emoji, at FROM reactions WHERE message_id = ?1 AND peer_id = ?2",
                params![message_id, peer_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((e, t)) = &current {
            if *t > at || (*t == at && e == emoji) {
                return Ok(false);
            }
        }
        if emoji.is_empty() {
            let n = conn.execute(
                "DELETE FROM reactions WHERE message_id = ?1 AND peer_id = ?2",
                params![message_id, peer_id],
            )?;
            return Ok(n > 0);
        }
        conn.execute(
            "INSERT OR REPLACE INTO reactions (message_id, peer_id, emoji, at) VALUES (?1, ?2, ?3, ?4)",
            params![message_id, peer_id, emoji, at],
        )?;
        Ok(true)
    }

    /// The emoji someone chose for a message ("" = none).
    pub fn reaction_of(&self, message_id: &str, peer_id: &str) -> String {
        let conn = self.conn.lock();
        conn.query_row(
            "SELECT emoji FROM reactions WHERE message_id = ?1 AND peer_id = ?2",
            params![message_id, peer_id],
            |r| r.get(0),
        )
        .unwrap_or_default()
    }

    // ------------------------------------------------- edit / delete / pin

    /// New text for a message (an edit); ignored if a newer edit is stored.
    pub fn edit_message_content(&self, message_id: &str, content: &str, mentions: &[String], at: i64) -> Result<bool> {
        let changed = {
            let conn = self.conn.lock();
            conn.execute(
                "UPDATE messages SET content = ?1, mentions = ?2, edited_at = ?3
                 WHERE id = ?4 AND deleted = 0 AND (edited_at IS NULL OR edited_at <= ?3)",
                params![content, mentions_json(mentions), at, message_id],
            )? > 0
        };
        if changed {
            self.refresh_preview_for(message_id)?;
        }
        Ok(changed)
    }

    /// Deleted for everyone: the text goes, a "deleted" mark stays.
    pub fn mark_message_deleted(&self, message_id: &str, at: i64) -> Result<bool> {
        let changed = {
            let conn = self.conn.lock();
            let n = conn.execute(
                "UPDATE messages SET content = '', deleted = 1, edited_at = ?1, mentions = NULL, pinned_at = NULL, pinned_by = NULL
                 WHERE id = ?2 AND deleted = 0",
                params![at, message_id],
            )?;
            conn.execute("DELETE FROM reactions WHERE message_id = ?1", params![message_id])?;
            conn.execute("DELETE FROM reminders WHERE message_id = ?1", params![message_id])?;
            n > 0
        };
        if changed {
            self.refresh_preview_for(message_id)?;
        }
        Ok(changed)
    }

    /// Pins (for everyone in the chat) or unpins; the newest change wins.
    pub fn set_pinned(&self, message_id: &str, pinned: bool, by: &str, at: i64) -> Result<bool> {
        let conn = self.conn.lock();
        let current: Option<Option<i64>> = conn
            .query_row("SELECT pinned_at FROM messages WHERE id = ?1 AND deleted = 0", params![message_id], |r| r.get(0))
            .optional()?;
        let Some(current) = current else { return Ok(false) };
        if pinned {
            if current.is_some_and(|t| t >= at) {
                return Ok(false);
            }
            conn.execute(
                "UPDATE messages SET pinned_at = ?1, pinned_by = ?2 WHERE id = ?3",
                params![at, by, message_id],
            )?;
            Ok(true)
        } else {
            match current {
                Some(t) if t <= at => {
                    conn.execute("UPDATE messages SET pinned_at = NULL, pinned_by = NULL WHERE id = ?1", params![message_id])?;
                    Ok(true)
                }
                _ => Ok(false),
            }
        }
    }

    pub fn set_starred(&self, message_id: &str, starred: bool) -> Result<bool> {
        let conn = self.conn.lock();
        Ok(conn.execute(
            "UPDATE messages SET starred = ?1 WHERE id = ?2",
            params![if starred { 1 } else { 0 }, message_id],
        )? > 0)
    }

    /// Starred messages from every chat (newest first; hidden chats only when
    /// they are unlocked).
    pub fn starred_messages(&self, include_hidden: bool) -> Result<Vec<SearchHit>> {
        let cols = MSG_COLS.split(", ").map(|c| format!("m.{}", c)).collect::<Vec<_>>().join(", ");
        let mut hits: Vec<SearchHit> = {
            let conn = self.conn.lock();
            let mut stmt = conn.prepare(&format!(
                "SELECT {}, COALESCE(p.display_name, g.name, ''), COALESCE(p.avatar_color, g.avatar_color, '#6366f1')
                 FROM messages m
                 JOIN conversations c ON m.conversation_id = c.id
                 LEFT JOIN peers p ON c.peer_id = p.id
                 LEFT JOIN groups g ON g.id = c.id
                 WHERE m.starred = 1 AND m.deleted = 0 AND (?1 OR c.is_hidden = 0)
                 ORDER BY m.timestamp DESC LIMIT 500",
                cols
            ))?;
            let rows = stmt.query_map(params![include_hidden], |row| {
                Ok(SearchHit {
                    message: row_to_message(row)?,
                    peer_name: row.get(21)?,
                    peer_avatar_color: row.get(22)?,
                })
            })?;
            rows.flatten().collect()
        };
        let ids: Vec<String> = hits.iter().map(|h| h.message.id.clone()).collect();
        let refs: Vec<&str> = ids.iter().map(|s| s.as_str()).collect();
        let mut reactions = self.reactions_for(&refs)?;
        for h in hits.iter_mut() {
            h.message.reactions = reactions.remove(&h.message.id).unwrap_or_default();
        }
        Ok(hits)
    }

    /// "Delete for me": removes the message from this computer only.
    /// Returns its chat.
    pub fn delete_message_local(&self, message_id: &str) -> Result<Option<String>> {
        let conv: Option<String> = {
            let conn = self.conn.lock();
            let conv = conn
                .query_row("SELECT conversation_id FROM messages WHERE id = ?1", params![message_id], |r| r.get(0))
                .optional()?;
            conn.execute("DELETE FROM reactions WHERE message_id = ?1", params![message_id])?;
            conn.execute("DELETE FROM reminders WHERE message_id = ?1", params![message_id])?;
            conn.execute("DELETE FROM message_deliveries WHERE message_id = ?1", params![message_id])?;
            conn.execute("DELETE FROM messages WHERE id = ?1", params![message_id])?;
            conv
        };
        if let Some(c) = &conv {
            self.refresh_preview(c)?;
        }
        Ok(conv)
    }

    fn refresh_preview_for(&self, message_id: &str) -> Result<()> {
        let conv: Option<String> = {
            let conn = self.conn.lock();
            conn.query_row("SELECT conversation_id FROM messages WHERE id = ?1", params![message_id], |r| r.get(0))
                .optional()?
        };
        if let Some(c) = conv {
            self.refresh_preview(&c)?;
        }
        Ok(())
    }

    /// The chat list's preview follows the newest message.
    pub fn refresh_preview(&self, conversation_id: &str) -> Result<()> {
        let last: Option<Message> = {
            let conn = self.conn.lock();
            conn.query_row(
                &format!(
                    "SELECT {} FROM messages WHERE conversation_id = ?1 ORDER BY timestamp DESC, rowid DESC LIMIT 1",
                    MSG_COLS
                ),
                params![conversation_id],
                row_to_message,
            )
            .optional()?
        };
        let conn = self.conn.lock();
        match last {
            Some(m) => conn.execute(
                "UPDATE conversations SET last_message_preview = ?1 WHERE id = ?2",
                params![message_preview(&m), conversation_id],
            )?,
            None => conn.execute(
                "UPDATE conversations SET last_message_preview = NULL WHERE id = ?1",
                params![conversation_id],
            )?,
        };
        Ok(())
    }

    // -------------------------------------------------------------- reminders

    pub fn set_reminder(&self, message_id: &str, conversation_id: &str, remind_at: i64) -> Result<()> {
        self.set_reminder_ex(message_id, conversation_id, remind_at, false, 0)
    }

    /// LANX 2.2.0: `no_reply`: only go off if nothing came back in the chat after `set_at`.
    pub fn set_reminder_ex(&self, message_id: &str, conversation_id: &str, remind_at: i64, no_reply: bool, set_at: i64) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO reminders (id, message_id, conversation_id, remind_at, no_reply, set_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(message_id) DO UPDATE SET remind_at = excluded.remind_at, no_reply = excluded.no_reply, set_at = excluded.set_at",
            params![uuid::Uuid::new_v4().to_string(), message_id, conversation_id, remind_at, no_reply as i64, set_at],
        )?;
        Ok(())
    }

    /// Did anything come back in this chat after `since` (a message, a file,
    /// a card, a call from them)?
    pub fn has_reply_since(&self, conversation_id: &str, since: i64) -> bool {
        let conn = self.conn.lock();
        conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM messages WHERE conversation_id = ?1 AND is_outgoing = 0 AND timestamp > ?2
                 AND message_type NOT IN ('system', 'secret_setting'))",
            params![conversation_id, since],
            |r| r.get::<_, i64>(0),
        )
        .map(|n| n != 0)
        .unwrap_or(false)
    }

    /// LANX 2.2.0: "Mark as unread" (until the chat is opened again).
    pub fn mark_unread(&self, conversation_id: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE conversations SET unread_count = MAX(unread_count, 1) WHERE id = ?1",
            params![conversation_id],
        )?;
        Ok(())
    }

    pub fn cancel_reminder(&self, message_id: &str) -> Result<bool> {
        let conn = self.conn.lock();
        Ok(conn.execute("DELETE FROM reminders WHERE message_id = ?1", params![message_id])? > 0)
    }

    /// Reminders that are due now (they are removed).
    pub fn take_due_reminders(&self, now: i64) -> Result<Vec<Reminder>> {
        let conn = self.conn.lock();
        let list: Vec<Reminder> = {
            let mut stmt = conn.prepare(
                "SELECT id, message_id, conversation_id, remind_at, no_reply, set_at FROM reminders WHERE remind_at <= ?1 ORDER BY remind_at",
            )?;
            let rows = stmt.query_map(params![now], |r| {
                Ok(Reminder {
                    id: r.get(0)?,
                    message_id: r.get(1)?,
                    conversation_id: r.get(2)?,
                    remind_at: r.get(3)?,
                    no_reply: r.get::<_, i64>(4)? != 0,
                    set_at: r.get(5)?,
                })
            })?;
            rows.flatten().collect()
        };
        for r in &list {
            conn.execute("DELETE FROM reminders WHERE id = ?1", params![r.id])?;
        }
        Ok(list)
    }

    // -------------------------------------------------------------- send later

    pub fn insert_scheduled(&self, s: &ScheduledMessage) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO scheduled_messages (id, conversation_id, content, reply_to, mentions, send_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![s.id, s.conversation_id, s.content, s.reply_to, mentions_json(&s.mentions), s.send_at, s.created_at],
        )?;
        Ok(())
    }

    pub fn delete_scheduled(&self, id: &str) -> Result<bool> {
        let conn = self.conn.lock();
        Ok(conn.execute("DELETE FROM scheduled_messages WHERE id = ?1", params![id])? > 0)
    }

    fn scheduled_where(&self, sql_where: &str, arg: rusqlite::types::Value) -> Result<Vec<ScheduledMessage>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(&format!(
            "SELECT id, conversation_id, content, reply_to, mentions, send_at, created_at FROM scheduled_messages
             WHERE {} ORDER BY send_at ASC",
            sql_where
        ))?;
        let rows = stmt.query_map(params![arg], |r| {
            Ok(ScheduledMessage {
                id: r.get(0)?,
                conversation_id: r.get(1)?,
                content: r.get(2)?,
                reply_to: r.get(3)?,
                mentions: r
                    .get::<_, Option<String>>(4)?
                    .and_then(|s| serde_json::from_str(&s).ok())
                    .unwrap_or_default(),
                send_at: r.get(5)?,
                created_at: r.get(6)?,
            })
        })?;
        Ok(rows.flatten().collect())
    }

    pub fn list_scheduled(&self, conversation_id: &str) -> Result<Vec<ScheduledMessage>> {
        self.scheduled_where("conversation_id = ?1", conversation_id.to_string().into())
    }

    pub fn due_scheduled(&self, now: i64) -> Result<Vec<ScheduledMessage>> {
        self.scheduled_where("send_at <= ?1", now.into())
    }

    // ---------------------------------------------------- queued message actions

    pub fn queue_action(&self, peer_id: &str, payload_json: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO pending_actions (id, peer_id, payload, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![uuid::Uuid::new_v4().to_string(), peer_id, payload_json, super::now_secs()],
        )?;
        Ok(())
    }

    /// (id, payload JSON) waiting for this colleague, oldest first.
    pub fn pending_actions(&self, peer_id: &str) -> Result<Vec<(String, String)>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT id, payload FROM pending_actions WHERE peer_id = ?1 ORDER BY created_at, rowid")?;
        let rows = stmt.query_map(params![peer_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.flatten().collect())
    }

    pub fn delete_action(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM pending_actions WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Drops actions nobody could deliver for a long time.
    pub fn prune_actions(&self, older_than: i64) -> Result<usize> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM pending_actions WHERE created_at < ?1", params![older_than])
    }
}
