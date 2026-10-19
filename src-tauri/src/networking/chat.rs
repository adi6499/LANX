//! LANX 1.5.0: replies, @mentions, reactions, edit / delete for everyone,
//! pins, stars, "remind me", "send later" and voice notes.
//!
//! Changes to an existing message travel as `MessageAction` packets to
//! everyone in the chat. They are queued like messages (delivered when the
//! colleague is online, and only to LANX 1.5.0 or newer) and the newest change
//! wins, so every computer ends up showing the same thing.

use super::protocol::*;
use super::transfer::SentFile;
use super::{MAX_MESSAGE_CONTENT_LEN, NetworkService, now_secs};
use crate::events::{AlertKind, IslandAlert};
use crate::storage::models::*;
use serde::Serialize;

/// Your own messages can be edited this long after sending…
pub const EDIT_WINDOW_SECS: i64 = 24 * 3600;
/// …and deleted for everyone this long.
pub const DELETE_WINDOW_SECS: i64 = 48 * 3600;
/// Voice notes up to this size download by themselves.
pub const VOICE_MAX_BYTES: u64 = 10 * 1024 * 1024;
/// Changes nobody could deliver are dropped after this.
const ACTION_MAX_AGE_SECS: i64 = 14 * 24 * 3600;
/// "Send later" / "remind me" at most this far ahead.
const MAX_AHEAD_SECS: i64 = 366 * 24 * 3600;

/// A reply's "Asha: the text…" kept short.
pub fn clip_preview(s: &str) -> String {
    s.chars().map(|c| if c.is_control() { ' ' } else { c }).take(160).collect()
}

/// The chat line of a voice note: "🎤 Voice note · 0:12".
pub fn voice_label(ms: u64) -> String {
    let s = (ms + 500) / 1000;
    format!("🎤 Voice note · {}:{:02}", s / 60, s % 60)
}

pub fn voice_ms_from_label(label: &str) -> Option<u64> {
    let t = label.strip_prefix("🎤 Voice note · ")?;
    let (m, s) = t.split_once(':')?;
    Some((m.trim().parse::<u64>().ok()? * 60 + s.trim().parse::<u64>().ok()?) * 1000)
}

/// A reaction is one emoji (possibly with a skin tone / joiner), never text.
pub fn valid_emoji(e: &str) -> bool {
    !e.is_empty()
        && e.len() <= 32
        && e.chars().count() <= 8
        && !e.chars().any(|c| c.is_ascii() || c.is_control() || c.is_whitespace())
}

#[derive(Serialize, Clone)]
struct ReminderEvent {
    message: Message,
    conversation_id: String,
    title: String,
    text: String,
}

#[derive(Serialize, Clone)]
struct ScheduledChanged {
    conversation_id: String,
    /// Set when a scheduled message could not be sent.
    problem: Option<String>,
}

impl NetworkService {
    // ------------------------------------------------------- replies, mentions

    /// (id, "Name: text") for an answer to `reply_to` in this chat.
    pub(super) fn reply_for(&self, conversation_id: &str, reply_to: Option<&str>) -> Option<(String, String)> {
        let m = self.db.get_message_by_id(reply_to?).ok().flatten()?;
        if m.conversation_id != conversation_id || m.deleted || m.ttl_secs.is_some() {
            return None;
        }
        let name = self.sender_name(&m);
        Some((m.id.clone(), clip_preview(&format!("{}: {}", name, crate::storage::message_preview(&m)))))
    }

    fn sender_name(&self, m: &Message) -> String {
        if m.is_outgoing {
            return self.local_profile().display_name;
        }
        self.db
            .get_peer(&m.sender_id)
            .ok()
            .flatten()
            .map(|p| p.display_name)
            .unwrap_or_else(|| "Someone".to_string())
    }

    /// Mentions that are members of this group (not us), at most 50.
    pub(super) fn valid_mentions(&self, group_id: &str, mentions: &[String]) -> Vec<String> {
        let Some(g) = self.get_group(group_id) else { return Vec::new() };
        let mut out: Vec<String> = Vec::new();
        for id in mentions {
            if !out.contains(id) && g.members.iter().any(|m| &m.device_id == id && !m.is_me) {
                out.push(id.clone());
            }
        }
        out.truncate(50);
        out
    }

    /// The length of an outgoing voice note (from its chat line).
    pub(super) fn voice_ms_of(&self, t: &TransferRecord) -> Option<u64> {
        let id = t.parent_id.clone().unwrap_or_else(|| t.id.clone());
        let m = self.db.get_message_by_transfer(&id).ok().flatten()?;
        voice_ms_from_label(&m.content)
    }

    // ------------------------------------------------------------- actions

    /// Who hears about a change in this chat (and the group id, if any).
    fn chat_recipients(&self, conversation_id: &str) -> Result<(Vec<String>, Option<String>), String> {
        let conv = self
            .db
            .get_conversation(conversation_id)
            .map_err(|e| e.to_string())?
            .ok_or("Chat not found")?;
        if conv.kind == "group" {
            let g = self.get_group(&conv.id).ok_or("Group not found")?;
            if g.membership != "member" {
                return Err("You are no longer in this group.".to_string());
            }
            Ok((g.members.iter().filter(|m| !m.is_me).map(|m| m.device_id.clone()).collect(), Some(g.id)))
        } else {
            Ok((vec![conv.peer_id.clone()], None))
        }
    }

    fn queue_message_action(&self, conversation_id: &str, mut p: MessageActionPayload) -> Result<(), String> {
        let (peers, group_id) = self.chat_recipients(conversation_id)?;
        p.group_id = group_id;
        if p.action_id.is_empty() {
            p.action_id = uuid::Uuid::new_v4().to_string();
        }
        let json = serde_json::to_string(&p).map_err(|e| e.to_string())?;
        for peer in peers.into_iter().filter(|p| !p.is_empty() && !p.starts_with("manual-")) {
            self.db.queue_action(&peer, &json).map_err(|e| e.to_string())?;
            self.kick_outbox(&peer, true);
        }
        Ok(())
    }

    /// LANX 1.6.0: a change to a card, for everyone in the chat.
    pub(super) fn queue_card_action(&self, conversation_id: &str, message_id: &str, key: &str, value: &str, at: i64) -> Result<(), String> {
        self.queue_message_action(
            conversation_id,
            MessageActionPayload {
                message_id: message_id.to_string(),
                action: "card".to_string(),
                key: Some(key.to_string()),
                value: Some(value.to_string()),
                at,
                ..Default::default()
            },
        )
    }

    /// Tells the window a message changed (and the chat list, if `preview`).
    fn emit_changed(&self, message_id: &str, preview: bool) -> Option<Message> {
        let m = self.db.get_message_full(message_id).ok().flatten()?;
        self.events.message_updated(&m);
        if preview {
            self.events.state_changed();
        }
        Some(m)
    }

    fn message(&self, message_id: &str) -> Result<Message, String> {
        self.db
            .get_message_by_id(message_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Message not found".to_string())
    }

    fn reactable(m: &Message) -> Result<(), String> {
        if m.deleted {
            return Err("That message was deleted.".to_string());
        }
        if m.message_type != "text" && m.message_type != "file" && m.message_type != "card" {
            return Err("You can't do that with this message.".to_string());
        }
        Ok(())
    }

    /// Adds your emoji to a message; the same emoji again takes it back.
    pub fn react_to_message(&self, message_id: &str, emoji: &str) -> Result<Message, String> {
        let m = self.message(message_id)?;
        Self::reactable(&m)?;
        if !emoji.is_empty() && !valid_emoji(emoji) {
            return Err("Choose an emoji.".to_string());
        }
        let me = self.identity.device_id.clone();
        let emoji = if self.db.reaction_of(message_id, &me) == emoji { "" } else { emoji };
        let at = now_secs();
        self.chat_recipients(&m.conversation_id)?;
        self.db.set_reaction(message_id, &me, emoji, at).map_err(|e| e.to_string())?;
        self.queue_message_action(
            &m.conversation_id,
            MessageActionPayload {
                message_id: message_id.to_string(),
                action: "react".to_string(),
                emoji: Some(emoji.to_string()),
                at,
                ..Default::default()
            },
        )?;
        self.emit_changed(message_id, false).ok_or_else(|| "Message not found".to_string())
    }

    /// Changes the text of one of your messages (for everyone).
    pub fn edit_message(&self, message_id: &str, content: &str, mentions: &[String]) -> Result<Message, String> {
        let m = self.message(message_id)?;
        if !m.is_outgoing || m.message_type != "text" || m.deleted || m.ttl_secs.is_some() {
            return Err("Only your own text messages can be edited.".to_string());
        }
        if now_secs() - m.timestamp > EDIT_WINDOW_SECS {
            return Err("Messages can be edited for 24 hours after sending.".to_string());
        }
        let text = content.trim();
        if text.is_empty() {
            return Err("The message can't be empty. Delete it instead.".to_string());
        }
        if text.len() > MAX_MESSAGE_CONTENT_LEN {
            return Err("The message is too long.".to_string());
        }
        let (_, group) = self.chat_recipients(&m.conversation_id)?;
        let mentions = match &group {
            Some(g) => self.valid_mentions(g, mentions),
            None => Vec::new(),
        };
        if text == m.content && mentions == m.mentions {
            return Ok(m);
        }
        let at = now_secs().max(m.edited_at.unwrap_or(0) + 1);
        self.db.edit_message_content(message_id, text, &mentions, at).map_err(|e| e.to_string())?;
        self.queue_message_action(
            &m.conversation_id,
            MessageActionPayload {
                message_id: message_id.to_string(),
                action: "edit".to_string(),
                content: Some(text.to_string()),
                mentions,
                at,
                ..Default::default()
            },
        )?;
        self.emit_changed(message_id, true).ok_or_else(|| "Message not found".to_string())
    }

    /// Deletes one of your messages for everyone ("This message was deleted").
    pub async fn delete_for_everyone(&self, message_id: &str) -> Result<Message, String> {
        let m = self.message(message_id)?;
        if !m.is_outgoing || m.deleted || !matches!(m.message_type.as_str(), "text" | "file" | "card") {
            return Err("Only your own messages can be deleted for everyone.".to_string());
        }
        if now_secs() - m.timestamp > DELETE_WINDOW_SECS {
            return Err("Messages can be deleted for everyone for 2 days after sending. Use “Delete for me”.".to_string());
        }
        self.chat_recipients(&m.conversation_id)?;
        // A file that hasn't arrived yet is called off.
        if let Some(tid) = &m.transfer_id {
            let mut ids = vec![tid.clone()];
            ids.extend(self.db.transfers_by_parent(tid).unwrap_or_default().into_iter().map(|t| t.id));
            for id in ids {
                if let Ok(Some(t)) = self.db.get_transfer(&id) {
                    if !matches!(t.status.as_str(), "completed" | "failed" | "cancelled" | "declined") {
                        let _ = self.cancel_transfer(&id).await;
                    }
                }
            }
        }
        let at = now_secs();
        self.db.mark_message_deleted(message_id, at).map_err(|e| e.to_string())?;
        self.queue_message_action(
            &m.conversation_id,
            MessageActionPayload {
                message_id: message_id.to_string(),
                action: "delete".to_string(),
                at,
                ..Default::default()
            },
        )?;
        self.emit_changed(message_id, true).ok_or_else(|| "Message not found".to_string())
    }

    /// Removes a message from this computer only.
    pub fn delete_for_me(&self, message_id: &str) -> Result<(), String> {
        let conv = self
            .db
            .delete_message_local(message_id)
            .map_err(|e| e.to_string())?
            .ok_or("Message not found")?;
        self.events.emit_json(
            "lanx://messages-deleted",
            serde_json::json!({ "message_ids": [message_id], "conversation_ids": [conv] }),
        );
        self.events.state_changed();
        Ok(())
    }

    /// Pins a message at the top of the chat for everyone (or unpins it).
    pub fn pin_message(&self, message_id: &str, pinned: bool) -> Result<Message, String> {
        let m = self.message(message_id)?;
        Self::reactable(&m)?;
        if m.ttl_secs.is_some() {
            return Err("Secret messages can't be pinned.".to_string());
        }
        self.chat_recipients(&m.conversation_id)?;
        let at = now_secs().max(m.pinned_at.unwrap_or(0));
        self.db
            .set_pinned(message_id, pinned, &self.identity.device_id, at)
            .map_err(|e| e.to_string())?;
        self.queue_message_action(
            &m.conversation_id,
            MessageActionPayload {
                message_id: message_id.to_string(),
                action: if pinned { "pin" } else { "unpin" }.to_string(),
                at,
                ..Default::default()
            },
        )?;
        self.emit_changed(message_id, false).ok_or_else(|| "Message not found".to_string())
    }

    /// Stars (saves) a message on this computer.
    pub fn star_message(&self, message_id: &str, starred: bool) -> Result<Message, String> {
        let m = self.message(message_id)?;
        if m.deleted || m.ttl_secs.is_some() {
            return Err("This message can't be starred.".to_string());
        }
        self.db.set_starred(message_id, starred).map_err(|e| e.to_string())?;
        self.emit_changed(message_id, false).ok_or_else(|| "Message not found".to_string())
    }

    pub(super) fn handle_message_action(&self, peer: &Peer, a: MessageActionPayload) -> AckPayload {
        let ok = AckPayload { ok: true, reason: None };
        let no = |r: &str| AckPayload { ok: false, reason: Some(r.to_string()) };
        if peer.trust_state == "blocked" {
            return no("Not available");
        }
        // Not here (deleted for me, or never arrived): nothing to do.
        let Some(m) = self.db.get_message_by_id(&a.message_id).ok().flatten() else {
            return ok;
        };
        let in_chat = match &a.group_id {
            Some(g) => {
                m.conversation_id == *g
                    && self.get_group(g).is_some_and(|gi| gi.members.iter().any(|x| x.device_id == peer.id))
            }
            None => self
                .db
                .get_conversation(&m.conversation_id)
                .ok()
                .flatten()
                .is_some_and(|c| c.kind == "direct" && c.peer_id == peer.id),
        };
        if !in_chat {
            return no("Not in this chat");
        }
        let at = a.at.min(now_secs() + 300);
        let (changed, preview) = match a.action.as_str() {
            "react" => {
                let e = a.emoji.clone().unwrap_or_default();
                if !e.is_empty() && !valid_emoji(&e) {
                    return no("Not an emoji");
                }
                (!m.deleted && self.db.set_reaction(&m.id, &peer.id, &e, at).unwrap_or(false), false)
            }
            "edit" => {
                if m.is_outgoing || m.sender_id != peer.id || m.message_type != "text" {
                    return no("Only the sender can edit a message");
                }
                let text = a.content.clone().unwrap_or_default();
                let text = text.trim();
                if text.is_empty() || text.len() > MAX_MESSAGE_CONTENT_LEN {
                    return no("Edit rejected (empty or too long)");
                }
                let mentions = match &a.group_id {
                    Some(g) => self
                        .get_group(g)
                        .map(|gi| {
                            a.mentions
                                .iter()
                                .filter(|id| gi.members.iter().any(|x| &x.device_id == *id))
                                .take(50)
                                .cloned()
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default(),
                    None => Vec::new(),
                };
                (self.db.edit_message_content(&m.id, text, &mentions, at).unwrap_or(false), true)
            }
            "delete" => {
                if m.is_outgoing || m.sender_id != peer.id {
                    return no("Only the sender can delete a message for everyone");
                }
                if let Some(tid) = m.transfer_id.clone() {
                    if let Ok(Some(t)) = self.db.get_transfer(&tid) {
                        if matches!(t.status.as_str(), "pending" | "queued" | "transferring") {
                            let this = self.clone();
                            tauri::async_runtime::spawn(async move {
                                let _ = this.cancel_transfer(&tid).await;
                            });
                        }
                    }
                }
                (self.db.mark_message_deleted(&m.id, at).unwrap_or(false), true)
            }
            "pin" | "unpin" => (self.db.set_pinned(&m.id, a.action == "pin", &peer.id, at).unwrap_or(false), false),
            "card" => {
                let (Some(key), Some(value)) = (a.key.as_deref(), a.value.as_deref()) else {
                    return no("Empty card change");
                };
                if key.len() > 80 || value.len() > 2000 {
                    return no("Card change too large");
                }
                match self.apply_remote_card_change(peer, &m, key, value, at) {
                    Ok(changed) => (changed, false),
                    Err(e) => return no(&e),
                }
            }
            _ => return no("Unknown action"),
        };
        if changed {
            self.emit_changed(&m.id, preview);
        }
        ok
    }

    // ------------------------------------------------------------ remind me

    pub fn set_reminder(&self, message_id: &str, remind_at: i64) -> Result<Message, String> {
        let m = self.message(message_id)?;
        let now = now_secs();
        if remind_at <= now {
            return Err("Pick a time in the future.".to_string());
        }
        if remind_at > now + MAX_AHEAD_SECS {
            return Err("Reminders can be at most a year ahead.".to_string());
        }
        self.db
            .set_reminder(message_id, &m.conversation_id, remind_at)
            .map_err(|e| e.to_string())?;
        self.emit_changed(message_id, false).ok_or_else(|| "Message not found".to_string())
    }

    pub fn cancel_reminder(&self, message_id: &str) -> Result<Message, String> {
        self.db.cancel_reminder(message_id).map_err(|e| e.to_string())?;
        self.emit_changed(message_id, false).ok_or_else(|| "Message not found".to_string())
    }

    // ----------------------------------------------------------- send later

    pub fn schedule_message(
        &self,
        conversation_id: &str,
        content: &str,
        send_at: i64,
        reply_to: Option<String>,
        mentions: Vec<String>,
    ) -> Result<ScheduledMessage, String> {
        let text = content.trim();
        if text.is_empty() {
            return Err("Type a message first.".to_string());
        }
        if text.len() > MAX_MESSAGE_CONTENT_LEN {
            return Err("The message is too long.".to_string());
        }
        let now = now_secs();
        if send_at <= now + 5 {
            return Err("Pick a time in the future.".to_string());
        }
        if send_at > now + MAX_AHEAD_SECS {
            return Err("Messages can be scheduled at most a year ahead.".to_string());
        }
        let (_, group) = self.chat_recipients(conversation_id)?;
        let mentions = match &group {
            Some(g) => self.valid_mentions(g, &mentions),
            None => Vec::new(),
        };
        let s = ScheduledMessage {
            id: uuid::Uuid::new_v4().to_string(),
            conversation_id: conversation_id.to_string(),
            content: text.to_string(),
            reply_to,
            mentions,
            send_at,
            created_at: now,
        };
        self.db.insert_scheduled(&s).map_err(|e| e.to_string())?;
        self.emit_scheduled(conversation_id, None);
        Ok(s)
    }

    pub fn cancel_scheduled(&self, id: &str, conversation_id: &str) -> Result<(), String> {
        self.db.delete_scheduled(id).map_err(|e| e.to_string())?;
        self.emit_scheduled(conversation_id, None);
        Ok(())
    }

    pub fn list_scheduled(&self, conversation_id: &str) -> Vec<ScheduledMessage> {
        self.db.list_scheduled(conversation_id).unwrap_or_default()
    }

    fn emit_scheduled(&self, conversation_id: &str, problem: Option<String>) {
        self.events.emit_json(
            "lanx://scheduled-changed",
            ScheduledChanged { conversation_id: conversation_id.to_string(), problem },
        );
    }

    /// Every few seconds: due reminders pop up, scheduled messages go out.
    pub async fn run_chat_timers(&self) {
        let now = now_secs();
        for r in self.db.take_due_reminders(now).unwrap_or_default() {
            let Some(m) = self.db.get_message_full(&r.message_id).ok().flatten() else { continue };
            let conv = self.db.get_conversation(&r.conversation_id).ok().flatten();
            let hidden = conv.as_ref().is_some_and(|c| c.is_hidden);
            let private = hidden && !self.privacy.hidden_unlocked() || self.privacy.is_locked();
            let chat = conv.as_ref().map(|c| c.peer_name.clone()).unwrap_or_default();
            let text = if private {
                "Open LANX to see it".to_string()
            } else if m.deleted {
                "(the message was deleted)".to_string()
            } else {
                crate::storage::message_preview(&m)
            };
            let title = if private { "⏰ Reminder".to_string() } else { format!("⏰ Reminder · {}", chat) };
            self.events.message_updated(&m);
            self.events.emit_json(
                "lanx://reminder",
                ReminderEvent {
                    message: m.clone(),
                    conversation_id: r.conversation_id.clone(),
                    title: title.clone(),
                    text: text.clone(),
                },
            );
            let alert = IslandAlert {
                id: format!("reminder-{}", r.id),
                kind: "message".into(),
                title: title.clone(),
                body: text.clone(),
                conversation_id: (!private).then(|| r.conversation_id.clone()),
                private,
                ..Default::default()
            };
            self.events.notify_island(&self.db, AlertKind::Ring, &title, &text, alert);
        }
        for s in self.db.due_scheduled(now).unwrap_or_default() {
            let _ = self.db.delete_scheduled(&s.id);
            match self
                .send_message_full(&s.conversation_id, &s.content, s.reply_to.clone(), s.mentions.clone())
                .await
            {
                Ok(m) => {
                    let conv = self.db.get_conversation(&s.conversation_id).ok().flatten();
                    self.events.message_received(&m, conv.as_ref());
                    self.emit_scheduled(&s.conversation_id, None);
                }
                Err(e) => self.emit_scheduled(
                    &s.conversation_id,
                    Some(format!("A scheduled message could not be sent: {}", e)),
                ),
            }
        }
        let _ = self.db.prune_actions(now - ACTION_MAX_AGE_SECS);
    }

    // ----------------------------------------------------------- voice notes

    /// Saves a recorded voice note and sends it into the chat.
    pub async fn send_voice_note(&self, conversation_id: &str, data: &[u8], media_ms: u64, ext: &str) -> Result<Vec<SentFile>, String> {
        if data.is_empty() {
            return Err("Nothing was recorded.".to_string());
        }
        if data.len() as u64 > VOICE_MAX_BYTES {
            return Err("That voice note is too long. Keep it under about 10 minutes.".to_string());
        }
        let ext = match ext {
            "ogg" | "webm" | "m4a" | "mp4" => ext,
            _ => "webm",
        };
        let dir = crate::storage::data_dir(crate::testmode::profile().as_deref()).join("Voice notes");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let name = format!(
            "Voice note {} {}.{}",
            chrono::Local::now().format("%Y-%m-%d %H-%M-%S"),
            &uuid::Uuid::new_v4().to_string()[..4],
            ext
        );
        let path = dir.join(name);
        std::fs::write(&path, data).map_err(|e| format!("Could not save the voice note: {}", e))?;
        self.send_files_as(conversation_id, vec![path.to_string_lossy().to_string()], Some(media_ms.max(1)))
            .await
    }

    /// The sound of a voice note that is on this computer.
    pub fn voice_note_bytes(&self, transfer_id: &str) -> Result<Vec<u8>, String> {
        let t = self
            .db
            .get_transfer(transfer_id)
            .map_err(|e| e.to_string())?
            .ok_or("Voice note not found")?;
        if t.kind != "voice" {
            return Err("Not a voice note".to_string());
        }
        if t.direction == "incoming" && t.status != "completed" {
            return Err("The voice note is still arriving.".to_string());
        }
        let path = t.local_path.ok_or("The voice note isn't on this computer.")?;
        let meta = std::fs::metadata(&path).map_err(|_| "The voice note was moved or deleted.".to_string())?;
        if meta.len() > VOICE_MAX_BYTES {
            return Err("Voice note too large".to_string());
        }
        std::fs::read(&path).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voice_labels_round_trip() {
        assert_eq!(voice_label(12_400), "🎤 Voice note · 0:12");
        assert_eq!(voice_label(75_600), "🎤 Voice note · 1:16");
        assert_eq!(voice_ms_from_label("🎤 Voice note · 1:16"), Some(76_000));
        assert_eq!(voice_ms_from_label("📎 report.pdf"), None);
    }

    #[test]
    fn only_emoji_count_as_reactions() {
        for ok in ["👍", "❤️", "😂", "🙏🏽", "👨‍👩‍👧"] {
            assert!(valid_emoji(ok), "{}", ok);
        }
        for bad in ["", "lol", "👍 ", "<b>", "👍👍👍👍👍👍👍👍👍"] {
            assert!(!valid_emoji(bad), "{}", bad);
        }
    }
}
