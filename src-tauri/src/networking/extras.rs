//! Smaller LANX 1.1 features: read receipts, typing indicator, ring (bell),
//! secret-message mode, pasted screenshots, image previews and broadcast.

use super::protocol::*;
use super::{NetworkService, now_secs};
use crate::events::AlertKind;
use crate::storage::models::{Conversation, Message, Peer};
use base64::Engine;
use serde::Serialize;
use std::path::PathBuf;
use std::time::{Duration, Instant};

const TYPING_EVERY: Duration = Duration::from_millis(2500);
const RING_EVERY: Duration = Duration::from_secs(8);
const MAX_PASTED_IMAGE: usize = 25 * 1024 * 1024;
const MAX_PREVIEW_BYTES: u64 = 15 * 1024 * 1024;
/// Allowed secret-message timers (seconds after reading).
pub const SECRET_TIMERS: [u32; 5] = [30, 300, 3600, 86400, 604800];

#[derive(Serialize, Clone, Debug)]
pub struct BroadcastResult {
    pub sent_to: usize,
    pub problems: Vec<String>,
}

#[derive(Serialize, Clone)]
struct TypingEvent {
    conversation_id: String,
    peer_id: String,
    display_name: String,
}

#[derive(Serialize, Clone)]
struct RingEvent {
    conversation_id: String,
    peer_name: String,
}

impl NetworkService {
    // ------------------------------------------------------------ helpers

    /// Who to contact for a chat: the contact, or the other group members.
    fn chat_targets(&self, conv: &Conversation) -> Result<(Vec<Peer>, Option<String>), String> {
        if conv.kind == "group" {
            let g = self.get_group(&conv.id).ok_or("Group not found")?;
            if g.membership != "member" {
                return Err("You are no longer in this group.".to_string());
            }
            let peers = g
                .members
                .iter()
                .filter(|m| !m.is_me)
                .filter_map(|m| self.db.get_peer(&m.device_id).ok().flatten())
                .filter(|p| p.trust_state != "blocked")
                .collect();
            Ok((peers, Some(conv.id.clone())))
        } else {
            let peer = self
                .db
                .get_peer(&conv.peer_id)
                .map_err(|e| e.to_string())?
                .ok_or("Contact not found")?;
            if peer.trust_state == "blocked" {
                return Err("You blocked this contact.".to_string());
            }
            Ok((vec![peer], None))
        }
    }

    /// The chat a packet from `peer` refers to (direct chat or a group the
    /// peer and I are both in).
    fn chat_for(&self, peer: &Peer, group_id: Option<&str>) -> Option<Conversation> {
        match group_id {
            Some(gid) => {
                let g = self.get_group(gid)?;
                if g.membership != "member" || !g.members.iter().any(|m| m.device_id == peer.id) {
                    return None;
                }
                self.db.get_conversation(gid).ok().flatten()
            }
            None => self.db.get_or_create_conversation(&peer.id).ok(),
        }
    }

    pub(super) fn insert_event_message(&self, conv_id: &str, sender: &str, outgoing: bool, kind: &str, content: &str) -> Option<Message> {
        let msg = Message {
            id: uuid::Uuid::new_v4().to_string(),
            conversation_id: conv_id.to_string(),
            sender_id: sender.to_string(),
            receiver_id: if outgoing { conv_id.to_string() } else { self.identity.device_id.clone() },
            content: content.to_string(),
            message_type: kind.to_string(),
            timestamp: now_secs(),
            status: if outgoing { "delivered" } else { "read" }.to_string(),
            error_reason: None,
            is_outgoing: outgoing,
            transfer_id: None,
            ttl_secs: None,
            expire_at: None,
            deliveries: None,
        };
        self.db.insert_message(&msg).ok()?;
        Some(msg)
    }

    // ------------------------------------------------------ read receipts

    /// Marks a chat read and sends "seen" receipts. Returns its messages
    /// (secret messages now carry their disappearing time).
    pub fn mark_read_and_notify(&self, conversation_id: &str) -> Result<Vec<Message>, String> {
        let receipts = self
            .db
            .get_settings()
            .map(|s| s.read_receipts)
            .unwrap_or(true);
        let senders = self
            .db
            .mark_conversation_read(conversation_id, receipts)
            .map_err(|e| e.to_string())?;
        for s in senders {
            self.kick_outbox(&s, true);
        }
        self.events.update_tray(&self.db);
        self.db.get_messages(conversation_id).map_err(|e| e.to_string())
    }

    pub(super) fn handle_read_receipt(&self, peer: &Peer, r: ReadReceiptPayload) {
        let ids: Vec<String> = r.message_ids.into_iter().take(1000).collect();
        let changed = self
            .db
            .apply_read_receipt(&peer.id, &ids, r.group_id.as_deref())
            .unwrap_or_default();
        for id in changed {
            if r.group_id.is_some() {
                self.emit_group_message(&id);
            } else if let Ok(Some(m)) = self.db.get_message_by_id(&id) {
                self.events.message_updated(&m);
            }
        }
    }

    // ------------------------------------------------------------- typing

    /// Tells the other side(s) that I'm typing (rate-limited, best effort).
    pub fn send_typing(&self, conversation_id: &str) {
        if !self.db.get_settings().map(|s| s.read_receipts).unwrap_or(true) {
            return;
        }
        {
            let mut sent = self.typing_sent.lock();
            if sent.get(conversation_id).is_some_and(|t| t.elapsed() < TYPING_EVERY) {
                return;
            }
            sent.insert(conversation_id.to_string(), Instant::now());
        }
        let Ok(Some(conv)) = self.db.get_conversation(conversation_id) else { return };
        let Ok((peers, group_id)) = self.chat_targets(&conv) else { return };
        for peer in peers.into_iter().filter(|p| p.status == "online").take(15) {
            let this = self.clone();
            let group_id = group_id.clone();
            tauri::async_runtime::spawn(async move {
                if let Ok(mut chan) = this.connect_peer(&peer).await {
                    if version_at_least(&chan.remote.app_version, FEATURES_V11) {
                        let _ = chan.send(PacketPayload::Typing(ChatRefPayload { group_id }), None).await;
                    }
                    chan.close().await;
                }
            });
        }
    }

    pub(super) fn handle_typing(&self, peer: &Peer, t: ChatRefPayload) {
        let conv = match &t.group_id {
            Some(_) => self.chat_for(peer, t.group_id.as_deref()),
            // Don't create a chat just because someone typed.
            None => self
                .db
                .get_conversations(true)
                .ok()
                .and_then(|list| list.into_iter().find(|c| c.kind == "direct" && c.peer_id == peer.id)),
        };
        if let Some(conv) = conv {
            if conv.is_hidden && !self.privacy.hidden_unlocked() {
                return;
            }
            self.events.emit_json(
                "lanx://typing",
                TypingEvent {
                    conversation_id: conv.id,
                    peer_id: peer.id.clone(),
                    display_name: peer.display_name.clone(),
                },
            );
        }
    }

    // --------------------------------------------------------------- ring

    /// Rings the contact (or every online group member): their LANX plays a
    /// bell, flashes and shows a notification. Returns how many were reached.
    pub async fn ring(&self, conversation_id: &str) -> Result<usize, String> {
        {
            let sent = self.ring_sent.lock();
            if sent.get(conversation_id).is_some_and(|t| t.elapsed() < RING_EVERY) {
                return Err("Give them a moment — you just rang.".to_string());
            }
        }
        let conv = self
            .db
            .get_conversation(conversation_id)
            .map_err(|e| e.to_string())?
            .ok_or("Chat not found")?;
        let (peers, group_id) = self.chat_targets(&conv)?;
        let online: Vec<Peer> = peers.into_iter().filter(|p| p.status == "online").collect();
        if online.is_empty() {
            return Err(if conv.kind == "group" {
                "Nobody in this group is online right now.".to_string()
            } else {
                format!("{} is offline right now.", conv.peer_name)
            });
        }
        self.ring_sent
            .lock()
            .insert(conversation_id.to_string(), Instant::now());

        let mut tasks = Vec::new();
        for peer in online {
            let this = self.clone();
            let group_id = group_id.clone();
            tasks.push(tauri::async_runtime::spawn(async move {
                let mut chan = this.connect_peer(&peer).await?;
                if !version_at_least(&chan.remote.app_version, FEATURES_V11) {
                    chan.close().await;
                    return Err(format!("{} needs LANX 1.1 to be rung", peer.display_name));
                }
                let reply = NetworkService::send_acked(
                    &mut chan,
                    PacketPayload::Ring(ChatRefPayload { group_id }),
                )
                .await;
                chan.close().await;
                match reply {
                    Ok(a) if a.ok => Ok(()),
                    Ok(a) => Err(a.reason.unwrap_or_else(|| "Refused".to_string())),
                    Err(()) => Err(format!("Could not reach {}", peer.display_name)),
                }
            }));
        }
        let mut reached = 0;
        let mut first_error = None;
        for t in tasks {
            match t.await {
                Ok(Ok(())) => reached += 1,
                Ok(Err(e)) => {
                    first_error.get_or_insert(e);
                }
                Err(_) => {}
            }
        }
        if reached == 0 {
            self.ring_sent.lock().remove(conversation_id);
            return Err(first_error.unwrap_or_else(|| "Nobody could be reached.".to_string()));
        }
        if let Some(m) = self.insert_event_message(conversation_id, &self.identity.device_id, true, "ring", "") {
            let conv = self.db.get_conversation(conversation_id).ok().flatten();
            self.events.message_received(&m, conv.as_ref());
        }
        Ok(reached)
    }

    pub(super) fn handle_ring(&self, peer: &Peer, r: ChatRefPayload) -> AckPayload {
        let Some(conv) = self.chat_for(peer, r.group_id.as_deref()) else {
            return AckPayload { ok: false, reason: Some("Not a member of this group".to_string()) };
        };
        if let Some(m) = self.insert_event_message(&conv.id, &peer.id, false, "ring", "") {
            let _ = self.db.increment_unread(&conv.id);
            let fresh = self.db.get_conversation(&conv.id).ok().flatten();
            self.events.message_received(&m, fresh.as_ref());
        }
        let private = conv.is_hidden || self.privacy.is_locked();
        let title = if private {
            "🔔 Someone is ringing you".to_string()
        } else if conv.kind == "group" {
            format!("🔔 {} is ringing {}", peer.display_name, conv.peer_name)
        } else {
            format!("🔔 {} is ringing you", peer.display_name)
        };
        // LANX 1.2.8: on the desktop island, with the cat ringing a bell.
        let alert = crate::events::IslandAlert {
            id: format!("ring-{}-{}", conv.id, crate::networking::now_secs()),
            kind: "ring".into(),
            title: if private { "Someone".to_string() } else { peer.display_name.clone() },
            body: if private || conv.kind != "group" { "is ringing you".to_string() } else { format!("is ringing {}", conv.peer_name) },
            conversation_id: (!private).then(|| conv.id.clone()),
            avatar_color: (!private).then(|| peer.avatar_color.clone()),
            private,
            ..Default::default()
        };
        self.events.notify_island(&self.db, AlertKind::Ring, &title, "Open LANX to reply", alert);
        self.events.emit_json(
            "lanx://ring",
            RingEvent {
                conversation_id: conv.id.clone(),
                peer_name: if private { String::new() } else { peer.display_name.clone() },
            },
        );
        self.events.update_tray(&self.db);
        AckPayload { ok: true, reason: None }
    }

    // ------------------------------------------------------ secret chats

    /// Turns secret messages on (seconds after reading) or off (0) for a
    /// direct chat, and tells the other person.
    pub fn set_secret_mode(&self, conversation_id: &str, ttl: u32) -> Result<Message, String> {
        if ttl != 0 && !SECRET_TIMERS.contains(&ttl) {
            return Err("Unsupported timer.".to_string());
        }
        let conv = self
            .db
            .get_conversation(conversation_id)
            .map_err(|e| e.to_string())?
            .ok_or("Chat not found")?;
        if conv.kind != "direct" {
            return Err("Secret messages are available in one-to-one chats.".to_string());
        }
        let peer = self
            .db
            .get_peer(&conv.peer_id)
            .map_err(|e| e.to_string())?
            .ok_or("Contact not found")?;
        self.db
            .set_conversation_secret_ttl(conversation_id, ttl)
            .map_err(|e| e.to_string())?;
        let msg = Message {
            id: uuid::Uuid::new_v4().to_string(),
            conversation_id: conversation_id.to_string(),
            sender_id: self.identity.device_id.clone(),
            receiver_id: peer.id.clone(),
            content: ttl.to_string(),
            message_type: "secret_setting".to_string(),
            timestamp: now_secs(),
            status: "sending".to_string(),
            error_reason: None,
            is_outgoing: true,
            transfer_id: None,
            ttl_secs: None,
            expire_at: None,
            deliveries: None,
        };
        self.db.insert_message(&msg).map_err(|e| e.to_string())?;
        self.kick_outbox(&peer.id, true);
        Ok(msg)
    }

    // ------------------------------------------------------------- images

    pub(crate) fn app_data_dir(&self) -> PathBuf {
        match self.db.get_path().parent() {
            Some(p) if !p.as_os_str().is_empty() => p.to_path_buf(),
            _ => std::env::temp_dir().join("LANX"),
        }
    }

    /// Saves a pasted screenshot (base64) and returns its path.
    pub fn save_pasted_image(&self, data_base64: &str, mime: &str) -> Result<PathBuf, String> {
        let raw = data_base64
            .split_once(',')
            .map(|(_, b)| b)
            .unwrap_or(data_base64);
        if raw.len() > MAX_PASTED_IMAGE * 4 / 3 + 16 {
            return Err("That image is too large to paste. Send it as a file instead.".to_string());
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(raw.trim())
            .map_err(|_| "The pasted image could not be read.".to_string())?;
        let ext = match mime {
            "image/jpeg" | "image/jpg" => "jpg",
            "image/gif" => "gif",
            "image/webp" => "webp",
            "image/bmp" => "bmp",
            _ => "png",
        };
        let dir = self.app_data_dir().join("Sent screenshots");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let stamp = chrono::Local::now().format("%Y-%m-%d %H.%M.%S");
        let path = super::transfer::unique_destination(&dir, &format!("Screenshot {}.{}", stamp, ext));
        std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
        Ok(path)
    }

    /// A data: URL with the picture of an image transfer (for chat previews).
    pub fn image_preview(&self, transfer_id: &str) -> Option<String> {
        let t = self.db.get_transfer(transfer_id).ok().flatten()?;
        if t.direction == "incoming" && t.status != "completed" {
            return None;
        }
        if !super::transfer::is_image_name(&t.file_name) {
            return None;
        }
        let path = t.local_path?;
        if std::fs::metadata(&path).ok()?.len() > MAX_PREVIEW_BYTES {
            return None;
        }
        let bytes = std::fs::read(&path).ok()?;
        let lower = t.file_name.to_ascii_lowercase();
        let mime = if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
            "image/jpeg"
        } else if lower.ends_with(".gif") {
            "image/gif"
        } else if lower.ends_with(".webp") {
            "image/webp"
        } else if lower.ends_with(".bmp") {
            "image/bmp"
        } else {
            "image/png"
        };
        Some(format!(
            "data:{};base64,{}",
            mime,
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ))
    }

    // ---------------------------------------------------------- broadcast

    /// Sends the same message and/or files to several colleagues, each in
    /// their own one-to-one chat.
    pub async fn broadcast(
        &self,
        peer_ids: &[String],
        content: Option<String>,
        paths: Vec<String>,
    ) -> Result<BroadcastResult, String> {
        let text = content.map(|c| c.trim().to_string()).filter(|c| !c.is_empty());
        if text.is_none() && paths.is_empty() {
            return Err("Write a message or choose files to send.".to_string());
        }
        if peer_ids.is_empty() {
            return Err("Choose who should receive it.".to_string());
        }
        let mut sent_to = 0;
        let mut problems = Vec::new();
        for id in peer_ids {
            let Ok(Some(peer)) = self.db.get_peer(id) else { continue };
            if peer.trust_state == "blocked" {
                continue;
            }
            let conv = match self.db.get_or_create_conversation(&peer.id) {
                Ok(c) => c,
                Err(e) => {
                    problems.push(format!("{}: {}", peer.display_name, e));
                    continue;
                }
            };
            let mut ok = true;
            if let Some(t) = &text {
                if let Err(e) = self.send_direct_message(&conv.id, t).await {
                    problems.push(format!("{}: {}", peer.display_name, e));
                    ok = false;
                }
            }
            if !paths.is_empty() {
                if let Err(e) = self.send_files(&conv.id, paths.clone()).await {
                    problems.push(format!("{}: {}", peer.display_name, e));
                    ok = false;
                }
            }
            if ok {
                sent_to += 1;
            }
        }
        self.events.state_changed();
        Ok(BroadcastResult { sent_to, problems })
    }
}
