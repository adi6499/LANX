pub mod calls;
pub mod lanes;
pub mod extras;
pub mod folders;
pub mod groups;
pub mod protocol;
pub mod session;
pub mod transfer;
pub mod update;
#[cfg(test)]
mod tests;

use crate::events::{AlertKind, Events};
use crate::privacy::PrivacyState;
use crate::security::DeviceIdentity;
use crate::storage::models::{Message, Peer};
use crate::storage::{Database, SECRET_UNREAD_MAX_SECS};
use parking_lot::Mutex;
use protocol::*;
use session::{ExpectedPeer, LocalProfile, RemotePeer, SecureChannel};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU16, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::net::{TcpListener, TcpStream};
use tokio_util::sync::CancellationToken;

pub const DEFAULT_TCP_PORT: u16 = 52926;
const CONNECT_TIMEOUT: Duration = Duration::from_millis(3000);
const ACK_TIMEOUT: Duration = Duration::from_secs(8);
const IDLE_TIMEOUT: Duration = Duration::from_secs(60);
/// After a failed delivery attempt, beacons won't retry sooner than this.
const RETRY_BACKOFF: Duration = Duration::from_secs(15);

pub(crate) fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

/// A peer seen through a verified beacon or handshake.
#[derive(Debug, Clone)]
pub struct SeenPeer {
    pub device_id: String,
    pub display_name: String,
    pub hostname: String,
    pub ip: String,
    pub tcp_port: u16,
    pub public_key: String,
    pub avatar_color: String,
}

impl From<&RemotePeer> for SeenPeer {
    fn from(r: &RemotePeer) -> Self {
        SeenPeer {
            device_id: r.device_id.clone(),
            display_name: r.display_name.clone(),
            hostname: r.hostname.clone(),
            ip: r.ip.clone(),
            tcp_port: r.tcp_port,
            public_key: r.public_key.clone(),
            avatar_color: r.avatar_color.clone(),
        }
    }
}

pub struct Inner {
    pub db: Arc<Database>,
    pub identity: DeviceIdentity,
    pub events: Events,
    pub privacy: Arc<PrivacyState>,
    /// Last "typing…" / ring sent per chat (rate limits).
    pub(crate) typing_sent: Mutex<HashMap<String, Instant>>,
    pub(crate) ring_sent: Mutex<HashMap<String, Instant>>,
    /// The one call in progress (ringing or active), if any.
    pub(crate) call: Mutex<Option<calls::CallInfo>>,
    cancel_token: CancellationToken,
    bound_port: AtomicU16,
    /// Running transfers (either direction) by transfer id.
    pub(crate) active_transfers: Mutex<HashMap<String, CancellationToken>>,
    /// Sender side of transfers being pulled over several connections.
    pub(crate) lane_sessions: Mutex<HashMap<String, lanes::LaneSession>>,
    /// Bytes compression kept off the network (sender side, this run).
    pub(crate) bytes_saved: std::sync::atomic::AtomicU64,
    /// Transfers the other side cancelled while running: id -> reason.
    pub(crate) remote_cancels: Mutex<HashMap<String, String>>,
    /// Peers whose outbox is being flushed: id -> "run again when done".
    flushing: Mutex<HashMap<String, bool>>,
    last_failure: Mutex<HashMap<String, Instant>>,
    /// "Share LANX update" settings and state (see update.rs).
    pub(crate) update_cfg: Mutex<update::UpdateConfig>,
    pub(crate) updates: Mutex<update::UpdateRuntime>,
}

#[derive(Clone)]
pub struct NetworkService {
    inner: Arc<Inner>,
}

impl std::ops::Deref for NetworkService {
    type Target = Inner;
    fn deref(&self) -> &Inner {
        &self.inner
    }
}

impl NetworkService {
    pub fn new(db: Arc<Database>, identity: DeviceIdentity, events: Events) -> Self {
        let privacy = Arc::new(PrivacyState::new(crate::privacy::pin_is_set(&db)));
        Self {
            inner: Arc::new(Inner {
                db,
                identity,
                events,
                privacy,
                typing_sent: Mutex::new(HashMap::new()),
                ring_sent: Mutex::new(HashMap::new()),
                call: Mutex::new(None),
                cancel_token: CancellationToken::new(),
                bound_port: AtomicU16::new(0),
                active_transfers: Mutex::new(HashMap::new()),
                remote_cancels: Mutex::new(HashMap::new()),
                lane_sessions: Mutex::new(HashMap::new()),
                bytes_saved: std::sync::atomic::AtomicU64::new(0),
                flushing: Mutex::new(HashMap::new()),
                last_failure: Mutex::new(HashMap::new()),
                update_cfg: Mutex::new(update::UpdateConfig::default()),
                updates: Mutex::new(update::UpdateRuntime::default()),
            }),
        }
    }

    /// Binds the configured TCP port and serves connections (app runtime).
    pub fn start(&self) {
        self.update_housekeeping();
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            let port = this
                .db
                .get_settings()
                .map(|s| s.tcp_messaging_port)
                .unwrap_or(DEFAULT_TCP_PORT);
            match TcpListener::bind((crate::testmode::bind_addr(), port)).await {
                Ok(listener) => this.serve(listener).await,
                Err(e) => eprintln!("[Network] Cannot listen on TCP port {}: {}", port, e),
            }
        });

        // A newer LANX that is waiting to be installed: remind once a day.
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::select! {
                    _ = this.cancel_token.cancelled() => break,
                    _ = tokio::time::sleep(Duration::from_secs(5 * 60)) => {
                        this.remind_about_update();
                    }
                }
            }
        });

        // Deletes secret messages when their time is up.
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::select! {
                    _ = this.cancel_token.cancelled() => break,
                    _ = tokio::time::sleep(Duration::from_secs(2)) => {
                        this.delete_expired_messages();
                    }
                }
            }
        });
    }

    pub async fn serve(&self, listener: TcpListener) {
        if let Ok(addr) = listener.local_addr() {
            self.bound_port.store(addr.port(), Ordering::SeqCst);
        }
        loop {
            tokio::select! {
                _ = self.cancel_token.cancelled() => break,
                accepted = listener.accept() => match accepted {
                    Ok((stream, _addr)) => {
                        let this = self.clone();
                        tokio::spawn(async move { this.handle_connection(stream).await });
                    }
                    Err(e) => {
                        eprintln!("[Network] TCP accept error: {}", e);
                        tokio::time::sleep(Duration::from_millis(100)).await;
                    }
                }
            }
        }
        self.bound_port.store(0, Ordering::SeqCst);
    }

    pub fn is_listening(&self) -> bool {
        self.bound_port.load(Ordering::SeqCst) != 0
    }

    pub fn stop(&self) {
        self.cancel_token.cancel();
        for token in self.active_transfers.lock().values() {
            token.cancel();
        }
    }

    pub fn local_profile(&self) -> LocalProfile {
        let s = self.db.get_settings().ok();
        let bound = self.bound_port.load(Ordering::SeqCst);
        LocalProfile {
            display_name: s
                .as_ref()
                .map(|s| s.display_name.clone())
                .unwrap_or_else(|| "LANX User".to_string()),
            hostname: s
                .as_ref()
                .map(|s| s.hostname.clone())
                .unwrap_or_else(|| "LANX-Node".to_string()),
            tcp_port: if bound != 0 {
                bound
            } else {
                s.as_ref()
                    .map(|s| s.tcp_messaging_port)
                    .unwrap_or(DEFAULT_TCP_PORT)
            },
            avatar_color: s
                .as_ref()
                .map(|s| s.avatar_color.clone())
                .unwrap_or_else(|| "#0284c7".to_string()),
            app_version: self.update_cfg.lock().app_version.clone(),
        }
    }

    // ---------------------------------------------------------------- peers

    /// Records a verified sighting of a peer. Returns true if it just came online.
    pub fn peer_seen(&self, seen: &SeenPeer) -> bool {
        let existing = self.db.get_peer(&seen.device_id).ok().flatten();
        if let Some(pinned) = existing.as_ref().and_then(|p| p.public_key.as_deref()) {
            if pinned != seen.public_key {
                eprintln!(
                    "[Security] Ignoring {}: identity key differs from the pinned key",
                    seen.device_id
                );
                return false;
            }
        }
        let was_online = existing
            .as_ref()
            .map(|p| p.status == "online")
            .unwrap_or(false);
        let changed = match &existing {
            None => true,
            Some(p) => {
                !was_online
                    || p.display_name != seen.display_name
                    || p.last_ip != seen.ip
                    || p.tcp_port != seen.tcp_port
                    || p.avatar_color != seen.avatar_color
                    || p.hostname != seen.hostname
            }
        };

        let peer = Peer {
            id: seen.device_id.clone(),
            display_name: seen.display_name.clone(),
            hostname: seen.hostname.clone(),
            last_ip: seen.ip.clone(),
            tcp_port: seen.tcp_port,
            public_key: Some(seen.public_key.clone()),
            trust_state: existing
                .as_ref()
                .map(|p| p.trust_state.clone())
                .unwrap_or_else(|| "unverified".to_string()),
            status: "online".to_string(),
            last_seen: now_secs(),
            avatar_color: seen.avatar_color.clone(),
        };
        if self.db.upsert_peer(&peer).is_err() {
            return false;
        }
        if self.db.merge_manual_peer(&seen.ip, &peer.id).unwrap_or(false) {
            self.events.state_changed();
        }
        if changed {
            self.events.peer_updated(&peer);
        }
        if !was_online {
            self.kick_outbox(&peer.id, true);
            self.maybe_offer_update(&peer.id);
        } else if self.db.has_pending_outbox(&peer.id) {
            self.kick_outbox(&peer.id, false);
        }
        !was_online
    }

    pub fn peer_went_offline(&self, peer_id: &str) {
        if let Ok(Some(p)) = self.db.get_peer(peer_id) {
            if p.status == "online" {
                let _ = self.db.set_peer_status(peer_id, "offline");
                self.events.peer_offline(peer_id);
            }
        }
    }

    fn expected_for(peer: &Peer) -> ExpectedPeer {
        ExpectedPeer {
            device_id: if peer.id.starts_with("manual-") {
                None
            } else {
                Some(peer.id.clone())
            },
            public_key: peer.public_key.clone(),
        }
    }

    /// Opens an encrypted session to a known peer and refreshes its record.
    pub async fn connect_peer(&self, peer: &Peer) -> Result<SecureChannel, String> {
        let addr = format!("{}:{}", peer.last_ip, peer.tcp_port);
        let chan = SecureChannel::connect(
            &addr,
            &self.identity,
            &self.local_profile(),
            &Self::expected_for(peer),
            CONNECT_TIMEOUT,
        )
        .await?;
        self.peer_seen(&SeenPeer::from(&chan.remote));
        self.note_peer_version(&chan.remote);
        Ok(chan)
    }

    pub async fn connect_manual_peer(
        &self,
        ip: &str,
        port: u16,
        name: Option<String>,
    ) -> Result<Peer, String> {
        let addr = format!("{}:{}", ip, port);
        match SecureChannel::connect(
            &addr,
            &self.identity,
            &self.local_profile(),
            &ExpectedPeer::default(),
            CONNECT_TIMEOUT,
        )
        .await
        {
            Ok(mut chan) => {
                let remote = chan.remote.clone();
                // Keep the address the user typed: it is known to be reachable.
                let mut seen = SeenPeer::from(&remote);
                seen.ip = ip.to_string();
                seen.tcp_port = port;
                if let Ok(Some(existing)) = self.db.get_peer(&remote.device_id) {
                    if existing.public_key.as_deref().is_some_and(|k| k != remote.public_key) {
                        return Err("Security warning: this device's identity key changed. Connection refused.".to_string());
                    }
                }
                self.peer_seen(&seen);
                self.note_peer_version(&remote);
                if let Some(n) = name.filter(|n| !n.trim().is_empty()) {
                    let _ = self.rename_peer_locally(&remote.device_id, n.trim());
                }
                let _ = chan.send(PacketPayload::Ping, None).await;
                let _ = chan.recv_packet_timeout(Duration::from_secs(2)).await;
                chan.close().await;
                let peer = self
                    .db
                    .get_peer(&remote.device_id)
                    .map_err(|e| e.to_string())?
                    .ok_or_else(|| "Peer not saved".to_string())?;
                let _ = self.db.get_or_create_conversation(&peer.id);
                Ok(peer)
            }
            Err(e) if e.contains("this computer") || e.contains("Security") || e.contains("version") => Err(e),
            Err(_) => {
                // Unreachable right now: save it so messages queue until it answers.
                let peer_id = format!("manual-{}:{}", ip, port);
                let peer = Peer {
                    id: peer_id,
                    display_name: name
                        .filter(|n| !n.trim().is_empty())
                        .unwrap_or_else(|| format!("Computer at {}", ip)),
                    hostname: "Not reached yet".to_string(),
                    last_ip: ip.to_string(),
                    tcp_port: port,
                    public_key: None,
                    trust_state: "unverified".to_string(),
                    status: "offline".to_string(),
                    last_seen: now_secs(),
                    avatar_color: "#10b981".to_string(),
                };
                self.db.upsert_peer(&peer).map_err(|e| e.to_string())?;
                let _ = self.db.get_or_create_conversation(&peer.id);
                self.events.peer_updated(&peer);
                Ok(peer)
            }
        }
    }

    fn rename_peer_locally(&self, peer_id: &str, name: &str) -> Result<(), String> {
        if let Ok(Some(mut p)) = self.db.get_peer(peer_id) {
            p.display_name = name.to_string();
            self.db.upsert_peer(&p).map_err(|e| e.to_string())?;
            self.events.peer_updated(&p);
        }
        Ok(())
    }

    // ------------------------------------------------------------- messages

    /// Stores the message and returns at once; delivery happens in the
    /// background and is reported through `lanx://message-status-updated`.
    pub async fn send_direct_message(
        &self,
        conversation_id: &str,
        content: &str,
    ) -> Result<Message, String> {
        let trimmed = content.trim();
        if trimmed.is_empty() {
            return Err("Message content cannot be empty".to_string());
        }
        if trimmed.len() > MAX_MESSAGE_CONTENT_LEN {
            return Err(format!(
                "Message is too long (limit is about {} characters). Send it as a file instead.",
                MAX_MESSAGE_CONTENT_LEN / 2
            ));
        }

        let conv = self
            .db
            .get_conversation(conversation_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Conversation not found".to_string())?;
        if conv.kind == "group" {
            return self.send_group_message(&conv, trimmed);
        }
        let peer = self
            .db
            .get_peer(&conv.peer_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Peer not found".to_string())?;
        if peer.trust_state == "blocked" {
            return Err("You blocked this contact. Unblock them in People to send messages.".to_string());
        }

        let now = now_secs();
        let ttl = (conv.secret_ttl > 0).then_some(conv.secret_ttl);
        let msg = Message {
            id: uuid::Uuid::new_v4().to_string(),
            conversation_id: conversation_id.to_string(),
            sender_id: self.identity.device_id.clone(),
            receiver_id: peer.id.clone(),
            content: trimmed.to_string(),
            message_type: "text".to_string(),
            timestamp: now,
            status: "sending".to_string(),
            error_reason: None,
            is_outgoing: true,
            transfer_id: None,
            ttl_secs: ttl,
            expire_at: ttl.map(|_| now + SECRET_UNREAD_MAX_SECS),
            deliveries: None,
        };
        self.db.insert_message(&msg).map_err(|e| e.to_string())?;
        self.kick_outbox(&peer.id, true);
        Ok(msg)
    }

    /// Emits the current state of an outgoing group message.
    pub(crate) fn emit_group_message(&self, message_id: &str) {
        if let Ok(Some(mut m)) = self.db.get_message_by_id(message_id) {
            if let Some(s) = self.db.delivery_summary(message_id) {
                let status = if s.delivered == s.total && s.total > 0 {
                    if s.read == s.total { "read" } else { "delivered" }
                } else if s.delivered > 0 {
                    "delivered"
                } else {
                    "sending"
                };
                if m.status != status {
                    let _ = self.db.update_message_status(&m.id, status, None);
                    m.status = status.to_string();
                }
                m.deliveries = Some(s);
            }
            self.events.message_updated(&m);
        }
    }

    pub async fn retry_direct_message(&self, message_id: &str) -> Result<Message, String> {
        let mut msg = self
            .db
            .get_message_by_id(message_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Message not found".to_string())?;
        if !msg.is_outgoing {
            return Err("Cannot retry incoming message".to_string());
        }
        if msg.message_type == "file" {
            if let Some(tid) = msg.transfer_id.clone() {
                self.retry_transfer(&tid).await?;
            }
            return Ok(msg);
        }
        msg.status = "sending".to_string();
        msg.error_reason = None;
        let _ = self.db.update_message_status(&msg.id, "sending", None);
        self.events.message_updated(&msg);
        self.kick_outbox(&msg.receiver_id, true);
        Ok(msg)
    }

    fn set_message_status(&self, msg: &mut Message, status: &str, reason: Option<String>) {
        msg.status = status.to_string();
        msg.error_reason = reason;
        let _ = self
            .db
            .update_message_status(&msg.id, status, msg.error_reason.as_deref());
        self.events.message_updated(msg);
    }

    /// Starts delivering queued messages and file offers to a peer.
    /// `force` skips the retry back-off (user action, peer just came online).
    pub fn kick_outbox(&self, peer_id: &str, force: bool) {
        if !force {
            if let Some(t) = self.last_failure.lock().get(peer_id) {
                if t.elapsed() < RETRY_BACKOFF {
                    return;
                }
            }
        }
        {
            let mut flushing = self.flushing.lock();
            if let Some(rerun) = flushing.get_mut(peer_id) {
                *rerun = true;
                return;
            }
            flushing.insert(peer_id.to_string(), false);
        }
        let this = self.clone();
        let peer_id = peer_id.to_string();
        tauri::async_runtime::spawn(async move {
            loop {
                this.flush_outbox_once(&peer_id).await;
                let mut flushing = this.flushing.lock();
                match flushing.get_mut(&peer_id) {
                    Some(rerun) if *rerun => *rerun = false,
                    _ => {
                        flushing.remove(&peer_id);
                        break;
                    }
                }
            }
        });
    }

    /// Sends a message packet and waits for its acknowledgement.
    /// Ok(Err(reason)) = rejected by the recipient; Err(()) = connection lost.
    async fn send_message_packet(
        chan: &mut SecureChannel,
        payload: MessagePayload,
    ) -> Result<Result<(), String>, ()> {
        let sent = chan.send(PacketPayload::Message(payload), None).await.map_err(|_| ())?;
        match chan.recv_packet_timeout(ACK_TIMEOUT).await {
            Ok(reply) if reply.correlation_id.as_deref() == Some(sent.packet_id.as_str()) => {
                Ok(match reply.payload {
                    PacketPayload::MessageAck(ack) if ack.db_committed => Ok(()),
                    PacketPayload::MessageAck(ack) => {
                        Err(ack.reason.unwrap_or_else(|| "Rejected by recipient".to_string()))
                    }
                    PacketPayload::Error(e) => Err(e.message),
                    _ => Err("Unexpected reply from recipient".to_string()),
                })
            }
            _ => Err(()),
        }
    }

    /// Sends a 1.1 packet that is answered with `Ack`. Err(()) = connection lost.
    pub(crate) async fn send_acked(
        chan: &mut SecureChannel,
        payload: PacketPayload,
    ) -> Result<AckPayload, ()> {
        let sent = chan.send(payload, None).await.map_err(|_| ())?;
        match chan.recv_packet_timeout(ACK_TIMEOUT).await {
            Ok(reply) if reply.correlation_id.as_deref() == Some(sent.packet_id.as_str()) => {
                match reply.payload {
                    PacketPayload::Ack(a) => Ok(a),
                    PacketPayload::Error(e) => Ok(AckPayload { ok: false, reason: Some(e.message) }),
                    _ => Err(()),
                }
            }
            _ => Err(()),
        }
    }

    async fn flush_outbox_once(&self, peer_id: &str) {
        let syncs = self.db.pending_group_syncs(peer_id).unwrap_or_default();
        let mut messages = self.db.pending_outgoing_messages(peer_id).unwrap_or_default();
        let group_msgs = self.db.pending_group_deliveries(peer_id).unwrap_or_default();
        let offers = self.db.queued_offers_for_peer(peer_id).unwrap_or_default();
        let receipts = self.db.pending_receipts(peer_id).unwrap_or_default();
        if syncs.is_empty()
            && messages.is_empty()
            && group_msgs.is_empty()
            && offers.is_empty()
            && receipts.is_empty()
        {
            return;
        }
        let Ok(Some(peer)) = self.db.get_peer(peer_id) else {
            return;
        };
        if peer.trust_state == "blocked" {
            for m in messages.iter_mut() {
                self.set_message_status(m, "failed", Some("You blocked this contact".to_string()));
            }
            for m in &group_msgs {
                let _ = self.db.set_delivery_status(&m.id, peer_id, "failed", Some("You blocked this contact"));
                self.emit_group_message(&m.id);
            }
            return;
        }

        let mut chan = match self.connect_peer(&peer).await {
            Ok(c) => c,
            Err(e) => {
                self.last_failure
                    .lock()
                    .insert(peer_id.to_string(), Instant::now());
                let reason = if e.contains("Security") || e.contains("version") || e.contains("not accepting") {
                    e
                } else {
                    format!("Waiting for {} to come online", peer.display_name)
                };
                for m in messages.iter_mut() {
                    if m.status != "queued" || m.error_reason.as_deref() != Some(reason.as_str()) {
                        self.set_message_status(m, "queued", Some(reason.clone()));
                    }
                }
                for m in &group_msgs {
                    let _ = self.db.set_delivery_status(&m.id, peer_id, "queued", Some(&reason));
                }
                for mut t in offers {
                    if t.error_reason.as_deref() != Some(reason.as_str()) {
                        t.error_reason = Some(reason.clone());
                        self.save_and_emit(&t);
                    }
                }
                return;
            }
        };
        self.last_failure.lock().remove(peer_id);
        let modern = version_at_least(&chan.remote.app_version, FEATURES_V11);
        let needs_update = format!("Waiting for {} to update to LANX 1.1", peer.display_name);
        let mut connection_lost = false;

        // 1. Group changes first, so the member knows a group before its messages.
        if modern {
            for (group_id, kind) in &syncs {
                if !self.deliver_group_sync(&mut chan, group_id, kind).await {
                    connection_lost = true;
                    break;
                }
            }
        }

        // 2. Direct messages.
        if !connection_lost {
            for m in messages.iter_mut() {
                let new_feature = m.ttl_secs.is_some() || m.message_type == "secret_setting";
                if new_feature && !modern {
                    if m.error_reason.as_deref() != Some(needs_update.as_str()) {
                        self.set_message_status(m, "queued", Some(needs_update.clone()));
                    }
                    continue;
                }
                let payload = MessagePayload {
                    message_id: m.id.clone(),
                    conversation_id: m.conversation_id.clone(),
                    content: m.content.clone(),
                    message_type: m.message_type.clone(),
                    ttl_secs: m.ttl_secs,
                    group_id: None,
                };
                match Self::send_message_packet(&mut chan, payload).await {
                    Ok(Ok(())) => self.set_message_status(m, "delivered", None),
                    Ok(Err(reason)) => self.set_message_status(m, "failed", Some(reason)),
                    Err(()) => {
                        connection_lost = true;
                        break;
                    }
                }
            }
        }

        // 3. Group messages.
        if !connection_lost {
            for m in &group_msgs {
                if !modern {
                    let _ = self.db.set_delivery_status(&m.id, peer_id, "queued", Some(&needs_update));
                    continue;
                }
                let payload = MessagePayload {
                    message_id: m.id.clone(),
                    conversation_id: m.conversation_id.clone(),
                    content: m.content.clone(),
                    message_type: m.message_type.clone(),
                    ttl_secs: None,
                    group_id: Some(m.conversation_id.clone()),
                };
                match Self::send_message_packet(&mut chan, payload).await {
                    Ok(Ok(())) => {
                        let _ = self.db.set_delivery_status(&m.id, peer_id, "delivered", None);
                    }
                    Ok(Err(reason)) => {
                        let _ = self.db.set_delivery_status(&m.id, peer_id, "failed", Some(&reason));
                    }
                    Err(()) => {
                        connection_lost = true;
                        break;
                    }
                }
                self.emit_group_message(&m.id);
            }
        }

        // 4. File offers.
        if !connection_lost {
            for t in offers {
                if !self.deliver_offer(&mut chan, t, modern).await {
                    connection_lost = true;
                    break;
                }
            }
        }

        // 5. "Seen" receipts.
        if !connection_lost {
            for (group_id, ids) in receipts {
                if !modern {
                    let _ = self.db.clear_receipts(&ids);
                    continue;
                }
                let payload = PacketPayload::ReadReceipt(ReadReceiptPayload {
                    message_ids: ids.clone(),
                    group_id,
                });
                match Self::send_acked(&mut chan, payload).await {
                    Ok(_) => {
                        let _ = self.db.clear_receipts(&ids);
                    }
                    Err(()) => {
                        connection_lost = true;
                        break;
                    }
                }
            }
        }

        if connection_lost {
            self.last_failure
                .lock()
                .insert(peer_id.to_string(), Instant::now());
            let reason = format!("Waiting for {} to come online", peer.display_name);
            for m in messages.iter_mut().filter(|m| m.status == "sending") {
                self.set_message_status(m, "queued", Some(reason.clone()));
            }
        }
        chan.close().await;
    }

    /// Deletes secret messages whose time ran out and tells the UI.
    pub fn delete_expired_messages(&self) -> usize {
        match self.db.delete_expired_messages(now_secs()) {
            Ok(gone) if !gone.is_empty() => {
                #[derive(serde::Serialize, Clone)]
                struct Deleted {
                    message_ids: Vec<String>,
                    conversation_ids: Vec<String>,
                }
                let mut conversation_ids: Vec<String> = gone.iter().map(|(_, c)| c.clone()).collect();
                conversation_ids.dedup();
                let n = gone.len();
                self.events.emit_json(
                    "lanx://messages-deleted",
                    Deleted {
                        message_ids: gone.into_iter().map(|(m, _)| m).collect(),
                        conversation_ids,
                    },
                );
                n
            }
            _ => 0,
        }
    }

    // ------------------------------------------------------------- incoming

    async fn handle_connection(&self, stream: TcpStream) {
        let db = self.db.clone();
        let policy = move |hello: &PacketEnvelope| -> Result<(), (String, String)> {
            if let Ok(Some(p)) = db.get_peer(&hello.sender_id) {
                if p.trust_state == "blocked" {
                    return Err((
                        "BLOCKED".to_string(),
                        "The recipient is not accepting messages from you.".to_string(),
                    ));
                }
                if p.public_key.as_deref().is_some_and(|k| k != hello.sender_pubkey) {
                    return Err((
                        "KEY_MISMATCH".to_string(),
                        "Security warning: identity key mismatch. Connection refused.".to_string(),
                    ));
                }
            }
            Ok(())
        };

        let me = self.local_profile();
        let mut chan = match SecureChannel::accept(stream, &self.identity, &me, policy).await {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[Network] Incoming connection refused: {}", e);
                return;
            }
        };
        self.peer_seen(&SeenPeer::from(&chan.remote));
        self.note_peer_version(&chan.remote);
        let Ok(Some(peer)) = self.db.get_peer(&chan.remote.device_id) else {
            return;
        };

        loop {
            let pkt = match chan.recv_packet_timeout(IDLE_TIMEOUT).await {
                Ok(p) => p,
                Err(_) => break,
            };
            let corr = Some(pkt.packet_id.clone());
            let reply = match pkt.payload {
                PacketPayload::Message(m) => {
                    Some(PacketPayload::MessageAck(self.handle_incoming_message(&peer, m)))
                }
                PacketPayload::Ping => Some(PacketPayload::Pong),
                PacketPayload::FileOffer(o) => {
                    Some(PacketPayload::FileOfferAck(self.handle_file_offer(&peer, o)))
                }
                PacketPayload::FileCancel(c) => {
                    self.handle_remote_cancel(&peer, c);
                    None
                }
                PacketPayload::FileRequest(r) => {
                    self.serve_file(chan, &peer, r, pkt.packet_id).await;
                    return;
                }
                PacketPayload::FileRangeRequest(r) => {
                    self.serve_range(chan, &peer, r, pkt.packet_id).await;
                    return;
                }
                PacketPayload::FileRangeFinish(r) => {
                    self.serve_finish(chan, &peer, r, pkt.packet_id).await;
                    return;
                }
                PacketPayload::SpeedTest(s) if s.phase == "start" => {
                    self.serve_speed_test(chan).await;
                    return;
                }
                PacketPayload::ReadReceipt(r) => {
                    self.handle_read_receipt(&peer, r);
                    Some(PacketPayload::Ack(AckPayload { ok: true, reason: None }))
                }
                PacketPayload::Typing(t) => {
                    self.handle_typing(&peer, t);
                    None
                }
                PacketPayload::Ring(r) => Some(PacketPayload::Ack(self.handle_ring(&peer, r))),
                PacketPayload::Call(c) => Some(PacketPayload::Ack(self.handle_call(&peer, c))),
                PacketPayload::GroupUpdate(g) => {
                    Some(PacketPayload::Ack(self.handle_group_update(&peer, g)))
                }
                PacketPayload::GroupLeave(l) => {
                    Some(PacketPayload::Ack(self.handle_group_leave(&peer, l)))
                }
                PacketPayload::UpdateOffer(o) => {
                    Some(PacketPayload::FileOfferAck(self.handle_update_offer(&peer, o)))
                }
                PacketPayload::Disconnect => break,
                _ => None,
            };
            if let Some(payload) = reply {
                if chan.send(payload, corr).await.is_err() {
                    break;
                }
            }
        }
    }

    fn handle_incoming_message(&self, peer: &Peer, m: MessagePayload) -> MessageAckPayload {
        let ack = |ok: bool, reason: Option<&str>| MessageAckPayload {
            message_id: m.message_id.clone(),
            status: if ok { "delivered" } else { "failed" }.to_string(),
            db_committed: ok,
            reason: reason.map(|r| r.to_string()),
        };
        if self.db.message_exists(&m.message_id) {
            return ack(true, None); // duplicate retransmission
        }
        if m.group_id.is_some() {
            return self.handle_group_message(peer, m);
        }

        let conv = match self.db.get_or_create_conversation(&peer.id) {
            Ok(c) => c,
            Err(_) => return ack(false, Some("Recipient database error")),
        };
        let now = now_secs();

        if m.message_type == "secret_setting" {
            // The other person changed secret mode for this chat.
            let ttl: u32 = m.content.trim().parse::<u32>().unwrap_or(0).min(7 * 24 * 3600);
            let _ = self.db.set_conversation_secret_ttl(&conv.id, ttl);
            let msg = Message {
                id: m.message_id.clone(),
                conversation_id: conv.id.clone(),
                sender_id: peer.id.clone(),
                receiver_id: self.identity.device_id.clone(),
                content: ttl.to_string(),
                message_type: "secret_setting".to_string(),
                timestamp: now,
                status: "read".to_string(),
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
            let conv = self.db.get_conversation(&conv.id).ok().flatten();
            self.events.message_received(&msg, conv.as_ref());
            return ack(true, None);
        }

        if m.content.trim().is_empty() || m.content.len() > MAX_MESSAGE_CONTENT_LEN {
            return ack(false, Some("Message rejected (empty or too long)"));
        }
        let ttl = m.ttl_secs.filter(|t| *t > 0).map(|t| t.min(7 * 24 * 3600));
        let msg = Message {
            id: m.message_id.clone(),
            conversation_id: conv.id.clone(),
            sender_id: peer.id.clone(),
            receiver_id: self.identity.device_id.clone(),
            content: m.content.clone(),
            message_type: "text".to_string(),
            timestamp: now,
            status: "delivered".to_string(),
            error_reason: None,
            is_outgoing: false,
            transfer_id: None,
            ttl_secs: ttl,
            expire_at: ttl.map(|_| now + SECRET_UNREAD_MAX_SECS),
            deliveries: None,
        };
        if let Err(e) = self.db.insert_message(&msg) {
            eprintln!("[Network] Failed to store incoming message: {}", e);
            return ack(false, Some("Recipient database error"));
        }
        let _ = self.db.increment_unread(&conv.id);
        let conv = self.db.get_conversation(&conv.id).ok().flatten();
        self.events.message_received(&msg, conv.as_ref());
        let hidden = conv.as_ref().is_some_and(|c| c.is_hidden);
        let private = hidden || self.privacy.is_locked();
        let (title, body) = if private {
            ("LANX".to_string(), "You have a new message".to_string())
        } else if ttl.is_some() {
            (peer.display_name.clone(), "🔒 Secret message".to_string())
        } else {
            (peer.display_name.clone(), crate::storage::preview_text(&msg.content))
        };
        let alert = crate::events::IslandAlert {
            id: msg.id.clone(),
            kind: "message".into(),
            title: title.clone(),
            body: body.clone(),
            conversation_id: (!private).then(|| msg.conversation_id.clone()),
            avatar_color: (!private).then(|| peer.avatar_color.clone()),
            private,
            ..Default::default()
        };
        self.events.notify_island(&self.db, AlertKind::Message, &title, &body, alert);
        self.events.update_tray(&self.db);
        ack(true, None)
    }
}
