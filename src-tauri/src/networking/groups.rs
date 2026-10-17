//! Group chats without a server.
//!
//! The creator is the group's admin. The admin's copy is the source of truth:
//! every change (name, members, admin hand-over) bumps a version number and is
//! sent to all members, who accept it only from the current admin and only if
//! it is newer. Messages are sent to each member separately over the normal
//! encrypted sessions, so each member's delivery and "seen" state is tracked
//! and offline members get their messages later.

use super::protocol::*;
use super::session::SecureChannel;
use super::{ACK_TIMEOUT, NetworkService, now_secs};
use crate::events::AlertKind;
use crate::storage::models::{Conversation, GroupInfo, Message, Peer};

const GROUP_COLORS: [&str; 6] = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6"];
const MAX_MEMBERS: usize = 100;

type MemberRow = (String, String, Option<String>);

fn valid_name(name: &str) -> Result<String, String> {
    let n = name.trim();
    if n.is_empty() {
        return Err("Give the group a name.".to_string());
    }
    if n.chars().count() > 60 {
        return Err("Group names can be at most 60 characters.".to_string());
    }
    Ok(n.to_string())
}

fn names(list: &[String]) -> String {
    match list.len() {
        0 => String::new(),
        1 => list[0].clone(),
        _ => format!("{} and {}", list[..list.len() - 1].join(", "), list[list.len() - 1]),
    }
}

impl NetworkService {
    fn my_id(&self) -> &str {
        &self.identity.device_id
    }

    pub fn get_group(&self, group_id: &str) -> Option<GroupInfo> {
        self.db.get_group(group_id, self.my_id()).ok().flatten()
    }

    /// Adds a local information line ("Asha added Bharat") to a group chat.
    fn group_note(&self, group_id: &str, text: &str) {
        let msg = Message {
            id: uuid::Uuid::new_v4().to_string(),
            conversation_id: group_id.to_string(),
            sender_id: String::new(),
            receiver_id: self.my_id().to_string(),
            content: text.to_string(),
            message_type: "system".to_string(),
            timestamp: now_secs(),
            status: "read".to_string(),
            error_reason: None,
            is_outgoing: false,
            transfer_id: None,
            ttl_secs: None,
            expire_at: None,
            deliveries: None,
        };
        if self.db.insert_message(&msg).is_ok() {
            let conv = self.db.get_conversation(group_id).ok().flatten();
            self.events.message_received(&msg, conv.as_ref());
        }
    }

    /// Checks that colleagues can be put in a group (LANX must have reached
    /// them once, so their identity key is known).
    fn group_candidates(&self, peer_ids: &[String]) -> Result<Vec<Peer>, String> {
        let mut out: Vec<Peer> = Vec::new();
        for id in peer_ids {
            if id == self.my_id() || out.iter().any(|p| &p.id == id) {
                continue;
            }
            let peer = self
                .db
                .get_peer(id)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "A selected colleague is unknown.".to_string())?;
            if peer.id.starts_with("manual-") || peer.public_key.is_none() {
                return Err(format!(
                    "{} can't be added yet: LANX hasn't reached their computer. Try again when they are online.",
                    peer.display_name
                ));
            }
            if peer.trust_state == "blocked" {
                return Err(format!("{} is blocked. Unblock them first.", peer.display_name));
            }
            out.push(peer);
        }
        Ok(out)
    }

    fn me_row(&self) -> MemberRow {
        (
            self.my_id().to_string(),
            self.local_profile().display_name,
            Some(self.identity.public_key_hex()),
        )
    }

    fn sync_group_to(&self, group_id: &str, peer_ids: &[String], kind: &str) {
        for p in peer_ids {
            if p != self.my_id() {
                let _ = self.db.queue_group_sync(group_id, p, kind);
                self.kick_outbox(p, true);
            }
        }
    }

    pub fn create_group(&self, name: &str, member_ids: &[String]) -> Result<Conversation, String> {
        let name = valid_name(name)?;
        let peers = self.group_candidates(member_ids)?;
        if peers.is_empty() {
            return Err("Choose at least one colleague for the group.".to_string());
        }
        if peers.len() + 1 > MAX_MEMBERS {
            return Err(format!("A group can have at most {} members.", MAX_MEMBERS));
        }
        let id = uuid::Uuid::new_v4().to_string();
        let color = GROUP_COLORS[id.as_bytes()[0] as usize % GROUP_COLORS.len()];
        let group = GroupInfo {
            id: id.clone(),
            name: name.clone(),
            admin_id: self.my_id().to_string(),
            version: 1,
            avatar_color: color.to_string(),
            membership: "member".to_string(),
            created_at: now_secs(),
            members: Vec::new(),
        };
        let mut rows = vec![self.me_row()];
        rows.extend(peers.iter().map(|p| (p.id.clone(), p.display_name.clone(), p.public_key.clone())));
        self.db.create_group(&group, &rows).map_err(|e| e.to_string())?;
        let member_names: Vec<String> = peers.iter().map(|p| p.display_name.clone()).collect();
        self.group_note(&id, &format!("You created “{}” with {}", name, names(&member_names)));
        let ids: Vec<String> = peers.iter().map(|p| p.id.clone()).collect();
        self.sync_group_to(&id, &ids, "update");
        self.db
            .get_conversation(&id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Group not saved".to_string())
    }

    /// Admin only: rename, add or remove members.
    pub fn update_group(
        &self,
        group_id: &str,
        new_name: Option<String>,
        add: &[String],
        remove: &[String],
    ) -> Result<GroupInfo, String> {
        let g = self.get_group(group_id).ok_or("Group not found")?;
        if g.membership != "member" {
            return Err("You are no longer in this group.".to_string());
        }
        if g.admin_id != self.my_id() {
            return Err("Only the group admin can change the group.".to_string());
        }
        let name = match &new_name {
            Some(n) => valid_name(n)?,
            None => g.name.clone(),
        };
        let added = self.group_candidates(add)?;
        let mut rows: Vec<MemberRow> = g
            .members
            .iter()
            .filter(|m| !remove.contains(&m.device_id) || m.is_me)
            .map(|m| (m.device_id.clone(), m.display_name.clone(), m.public_key.clone()))
            .collect();
        let mut added_names = Vec::new();
        for p in &added {
            if !rows.iter().any(|r| r.0 == p.id) {
                rows.push((p.id.clone(), p.display_name.clone(), p.public_key.clone()));
                added_names.push(p.display_name.clone());
            }
        }
        if rows.len() > MAX_MEMBERS {
            return Err(format!("A group can have at most {} members.", MAX_MEMBERS));
        }
        let removed: Vec<_> = g
            .members
            .iter()
            .filter(|m| !m.is_me && remove.contains(&m.device_id))
            .collect();
        self.db
            .update_group(group_id, &name, &g.admin_id, g.version + 1, "member", &rows)
            .map_err(|e| e.to_string())?;
        for m in &removed {
            let _ = self.db.remove_group_member(group_id, &m.device_id);
        }
        if name != g.name {
            self.group_note(group_id, &format!("You renamed the group to “{}”", name));
        }
        if !added_names.is_empty() {
            self.group_note(group_id, &format!("You added {}", names(&added_names)));
        }
        if !removed.is_empty() {
            let n: Vec<String> = removed.iter().map(|m| m.display_name.clone()).collect();
            self.group_note(group_id, &format!("You removed {}", names(&n)));
        }
        // Current members get the new state; removed ones learn they are out.
        let mut targets: Vec<String> = rows.iter().map(|r| r.0.clone()).collect();
        targets.extend(removed.iter().map(|m| m.device_id.clone()));
        self.sync_group_to(group_id, &targets, "update");
        self.events.state_changed();
        self.get_group(group_id).ok_or_else(|| "Group not found".to_string())
    }

    pub fn leave_group(&self, group_id: &str) -> Result<(), String> {
        let g = self.get_group(group_id).ok_or("Group not found")?;
        if g.membership != "member" {
            return Ok(());
        }
        let others: Vec<MemberRow> = g
            .members
            .iter()
            .filter(|m| !m.is_me)
            .map(|m| (m.device_id.clone(), m.display_name.clone(), m.public_key.clone()))
            .collect();
        let other_ids: Vec<String> = others.iter().map(|r| r.0.clone()).collect();
        if g.admin_id == self.my_id() && !others.is_empty() {
            // Hand the group to the next member, without me.
            let new_admin = others[0].0.clone();
            self.db
                .update_group(group_id, &g.name, &new_admin, g.version + 1, "left", &others)
                .map_err(|e| e.to_string())?;
            self.sync_group_to(group_id, &other_ids, "update");
        } else {
            self.db.set_group_membership(group_id, "left").map_err(|e| e.to_string())?;
            self.sync_group_to(group_id, &other_ids, "leave");
        }
        self.group_note(group_id, "You left the group");
        self.events.state_changed();
        Ok(())
    }

    pub(super) fn send_group_message(&self, conv: &Conversation, text: &str) -> Result<Message, String> {
        let g = self.get_group(&conv.id).ok_or("Group not found")?;
        if g.membership != "member" {
            return Err("You are no longer in this group.".to_string());
        }
        let recipients: Vec<String> = g
            .members
            .iter()
            .filter(|m| !m.is_me)
            .map(|m| m.device_id.clone())
            .collect();
        if recipients.is_empty() {
            return Err("Nobody else is in this group.".to_string());
        }
        let mut msg = Message {
            id: uuid::Uuid::new_v4().to_string(),
            conversation_id: conv.id.clone(),
            sender_id: self.my_id().to_string(),
            receiver_id: conv.id.clone(),
            content: text.to_string(),
            message_type: "text".to_string(),
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
        self.db
            .insert_deliveries(&msg.id, &recipients)
            .map_err(|e| e.to_string())?;
        for r in &recipients {
            self.kick_outbox(r, true);
        }
        msg.deliveries = self.db.delivery_summary(&msg.id);
        Ok(msg)
    }

    fn group_payload(&self, g: &GroupInfo) -> GroupUpdatePayload {
        let members = g
            .members
            .iter()
            .filter_map(|m| {
                if m.is_me {
                    return Some(GroupMemberPayload {
                        device_id: m.device_id.clone(),
                        display_name: self.local_profile().display_name,
                        public_key: self.identity.public_key_hex(),
                        ip: String::new(),
                        tcp_port: self.local_profile().tcp_port,
                        avatar_color: self.local_profile().avatar_color,
                    });
                }
                let peer = self.db.get_peer(&m.device_id).ok().flatten();
                Some(GroupMemberPayload {
                    device_id: m.device_id.clone(),
                    display_name: m.display_name.clone(),
                    public_key: m.public_key.clone()?,
                    ip: peer.as_ref().map(|p| p.last_ip.clone()).unwrap_or_default(),
                    tcp_port: peer.as_ref().map(|p| p.tcp_port).unwrap_or(super::DEFAULT_TCP_PORT),
                    avatar_color: peer
                        .as_ref()
                        .map(|p| p.avatar_color.clone())
                        .unwrap_or_else(|| "#64748b".to_string()),
                })
            })
            .collect();
        GroupUpdatePayload {
            group_id: g.id.clone(),
            name: g.name.clone(),
            admin_id: g.admin_id.clone(),
            version: g.version,
            avatar_color: g.avatar_color.clone(),
            members,
        }
    }

    /// Sends one queued group change. Returns false if the connection broke.
    pub(super) async fn deliver_group_sync(
        &self,
        chan: &mut SecureChannel,
        group_id: &str,
        kind: &str,
    ) -> bool {
        let peer_id = chan.remote.device_id.clone();
        let Some(g) = self.get_group(group_id) else {
            let _ = self.db.clear_group_sync(group_id, &peer_id);
            return true;
        };
        let sent_version = g.version;
        let payload = if kind == "leave" {
            PacketPayload::GroupLeave(ChatRefPayload { group_id: Some(g.id.clone()) })
        } else {
            PacketPayload::GroupUpdate(self.group_payload(&g))
        };
        let sent = match chan.send(payload, None).await {
            Ok(p) => p,
            Err(_) => return false,
        };
        match chan.recv_packet_timeout(ACK_TIMEOUT).await {
            Ok(reply) if reply.correlation_id.as_deref() == Some(sent.packet_id.as_str()) => {
                if let PacketPayload::Ack(a) = &reply.payload {
                    if !a.ok {
                        eprintln!("[Groups] {} refused update: {:?}", peer_id, a.reason);
                    }
                }
                // If the group changed while this was in flight, keep the
                // pending sync so the newer version is sent next.
                let changed = kind != "leave"
                    && self.get_group(group_id).map(|g| g.version) != Some(sent_version);
                if !changed {
                    let _ = self.db.clear_group_sync(group_id, &peer_id);
                }
                true
            }
            _ => false,
        }
    }

    /// Makes sure every member can be contacted (adds unknown ones as peers).
    fn learn_members(&self, members: &[GroupMemberPayload]) {
        for m in members {
            if m.device_id == self.my_id() {
                continue;
            }
            if let Ok(None) = self.db.get_peer(&m.device_id) {
                let _ = self.db.upsert_peer(&Peer {
                    id: m.device_id.clone(),
                    display_name: m.display_name.clone(),
                    hostname: String::new(),
                    last_ip: m.ip.clone(),
                    tcp_port: m.tcp_port,
                    public_key: Some(m.public_key.clone()),
                    trust_state: "unverified".to_string(),
                    status: "offline".to_string(),
                    last_seen: 0,
                    avatar_color: m.avatar_color.clone(),
                });
            }
        }
    }

    pub(super) fn handle_group_update(&self, sender: &Peer, p: GroupUpdatePayload) -> AckPayload {
        let reject = |r: &str| AckPayload { ok: false, reason: Some(r.to_string()) };
        let ok = AckPayload { ok: true, reason: None };
        let Ok(name) = valid_name(&p.name) else {
            return reject("Invalid group name");
        };
        if p.members.len() > MAX_MEMBERS
            || p.members.iter().any(|m| hex::decode(&m.public_key).map(|k| k.len() != 32).unwrap_or(true))
            || uuid::Uuid::parse_str(&p.group_id).is_err()
        {
            return reject("Invalid group data");
        }
        let me = self.my_id().to_string();
        let i_am_in = p.members.iter().any(|m| m.device_id == me);
        let rows: Vec<MemberRow> = p
            .members
            .iter()
            .map(|m| (m.device_id.clone(), m.display_name.clone(), Some(m.public_key.clone())))
            .collect();

        match self.get_group(&p.group_id) {
            None => {
                if !i_am_in {
                    return ok;
                }
                if p.admin_id != sender.id {
                    return reject("Only the group admin can add you");
                }
                let group = GroupInfo {
                    id: p.group_id.clone(),
                    name: name.clone(),
                    admin_id: p.admin_id.clone(),
                    version: p.version,
                    avatar_color: p.avatar_color.clone(),
                    membership: "member".to_string(),
                    created_at: now_secs(),
                    members: Vec::new(),
                };
                if self.db.create_group(&group, &rows).is_err() {
                    return reject("Database error");
                }
                self.learn_members(&p.members);
                self.group_note(&p.group_id, &format!("{} added you to “{}”", sender.display_name, name));
                let _ = self.db.increment_unread(&p.group_id);
                self.events.state_changed();
                self.events.notify(
                    &self.db,
                    AlertKind::Message,
                    &name,
                    &format!("{} added you to this group", sender.display_name),
                );
                ok
            }
            Some(existing) => {
                if sender.id != existing.admin_id {
                    return reject("Only the group admin can change the group");
                }
                if p.version <= existing.version {
                    return ok; // already have this (or newer)
                }
                let old: Vec<(String, String)> = existing
                    .members
                    .iter()
                    .map(|m| (m.device_id.clone(), m.display_name.clone()))
                    .collect();
                let membership = if i_am_in { "member" } else { "removed" };
                if self
                    .db
                    .update_group(&p.group_id, &name, &p.admin_id, p.version, membership, &rows)
                    .is_err()
                {
                    return reject("Database error");
                }
                self.learn_members(&p.members);

                if name != existing.name {
                    self.group_note(&p.group_id, &format!("{} renamed the group to “{}”", sender.display_name, name));
                }
                let added: Vec<String> = p
                    .members
                    .iter()
                    .filter(|m| !old.iter().any(|(id, _)| id == &m.device_id))
                    .map(|m| if m.device_id == me { "you".to_string() } else { m.display_name.clone() })
                    .collect();
                let removed: Vec<String> = old
                    .iter()
                    .filter(|(id, _)| !p.members.iter().any(|m| &m.device_id == id) && *id != sender.id && *id != me)
                    .map(|(_, n)| n.clone())
                    .collect();
                if !added.is_empty() {
                    self.group_note(&p.group_id, &format!("{} added {}", sender.display_name, names(&added)));
                }
                if !removed.is_empty() {
                    self.group_note(&p.group_id, &format!("{} removed {}", sender.display_name, names(&removed)));
                }
                let sender_left = !p.members.iter().any(|m| m.device_id == sender.id);
                if sender_left {
                    self.group_note(&p.group_id, &format!("{} left the group", sender.display_name));
                }
                if p.admin_id != existing.admin_id && p.admin_id == me {
                    self.group_note(&p.group_id, "You are now the group admin");
                }
                if !i_am_in {
                    self.group_note(&p.group_id, &format!("{} removed you from the group", sender.display_name));
                }
                self.events.state_changed();
                ok
            }
        }
    }

    pub(super) fn handle_group_leave(&self, sender: &Peer, l: ChatRefPayload) -> AckPayload {
        let ok = AckPayload { ok: true, reason: None };
        let Some(gid) = l.group_id else { return ok };
        let Some(g) = self.get_group(&gid) else { return ok };
        if !g.members.iter().any(|m| m.device_id == sender.id) {
            return ok;
        }
        let _ = self.db.remove_group_member(&gid, &sender.id);
        self.group_note(&gid, &format!("{} left the group", sender.display_name));
        if g.admin_id == self.my_id() && g.membership == "member" {
            // Admin keeps everyone's member list in step.
            if let Some(now) = self.get_group(&gid) {
                let rows: Vec<MemberRow> = now
                    .members
                    .iter()
                    .map(|m| (m.device_id.clone(), m.display_name.clone(), m.public_key.clone()))
                    .collect();
                let _ = self
                    .db
                    .update_group(&gid, &now.name, &now.admin_id, now.version + 1, "member", &rows);
                let ids: Vec<String> = rows.iter().map(|r| r.0.clone()).collect();
                self.sync_group_to(&gid, &ids, "update");
            }
        }
        self.events.state_changed();
        ok
    }

    pub(super) fn handle_group_message(&self, sender: &Peer, m: MessagePayload) -> MessageAckPayload {
        let ack = |ok: bool, reason: Option<&str>| MessageAckPayload {
            message_id: m.message_id.clone(),
            status: if ok { "delivered" } else { "failed" }.to_string(),
            db_committed: ok,
            reason: reason.map(|r| r.to_string()),
        };
        let gid = m.group_id.clone().unwrap_or_default();
        let Some(g) = self.get_group(&gid) else {
            return ack(false, Some("Not a member of this group"));
        };
        if g.membership != "member" {
            return ack(false, Some("Has left this group"));
        }
        if !g.members.iter().any(|x| x.device_id == sender.id) {
            return ack(false, Some("You are not in this group"));
        }
        if m.message_type != "text" || m.content.trim().is_empty() || m.content.len() > MAX_MESSAGE_CONTENT_LEN {
            return ack(false, Some("Message rejected (empty or too long)"));
        }
        let msg = Message {
            id: m.message_id.clone(),
            conversation_id: gid.clone(),
            sender_id: sender.id.clone(),
            receiver_id: self.my_id().to_string(),
            content: m.content.clone(),
            message_type: "text".to_string(),
            timestamp: now_secs(),
            status: "delivered".to_string(),
            error_reason: None,
            is_outgoing: false,
            transfer_id: None,
            ttl_secs: None,
            expire_at: None,
            deliveries: None,
        };
        if self.db.insert_message(&msg).is_err() {
            return ack(false, Some("Recipient database error"));
        }
        let _ = self.db.increment_unread(&gid);
        let conv = self.db.get_conversation(&gid).ok().flatten();
        self.events.message_received(&msg, conv.as_ref());
        let hidden = conv.as_ref().is_some_and(|c| c.is_hidden);
        let private = hidden || self.privacy.is_locked();
        let (title, body) = if private {
            ("LANX".to_string(), "You have a new message".to_string())
        } else {
            (
                g.name.clone(),
                format!("{}: {}", sender.display_name, crate::storage::preview_text(&msg.content)),
            )
        };
        let alert = if private {
            crate::events::IslandAlert {
                id: msg.id.clone(),
                kind: "message".into(),
                title: title.clone(),
                body: body.clone(),
                private,
                ..Default::default()
            }
        } else {
            crate::events::IslandAlert {
                id: msg.id.clone(),
                kind: "message".into(),
                title: sender.display_name.clone(),
                body: crate::storage::preview_text(&msg.content),
                conversation_id: Some(gid.clone()),
                avatar_color: Some(sender.avatar_color.clone()),
                group: Some(g.name.clone()),
                ..Default::default()
            }
        };
        self.events.notify_island(&self.db, AlertKind::Message, &title, &body, alert);
        self.events.update_tray(&self.db);
        ack(true, None)
    }
}
