pub mod protocol;
pub mod session;
pub mod transfer;
#[cfg(test)]
mod tests;

use crate::events::Events;
use crate::security::DeviceIdentity;
use crate::storage::Database;
use crate::storage::models::{Message, Peer};
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
    cancel_token: CancellationToken,
    bound_port: AtomicU16,
    /// Running transfers (either direction) by transfer id.
    pub(crate) active_transfers: Mutex<HashMap<String, CancellationToken>>,
    /// Transfers the other side cancelled while running: id -> reason.
    pub(crate) remote_cancels: Mutex<HashMap<String, String>>,
    /// Peers whose outbox is being flushed: id -> "run again when done".
    flushing: Mutex<HashMap<String, bool>>,
    last_failure: Mutex<HashMap<String, Instant>>,
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
        Self {
            inner: Arc::new(Inner {
                db,
                identity,
                events,
                cancel_token: CancellationToken::new(),
                bound_port: AtomicU16::new(0),
                active_transfers: Mutex::new(HashMap::new()),
                remote_cancels: Mutex::new(HashMap::new()),
                flushing: Mutex::new(HashMap::new()),
                last_failure: Mutex::new(HashMap::new()),
            }),
        }
    }

    /// Binds the configured TCP port and serves connections (app runtime).
    pub fn start(&self) {
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            let port = this
                .db
                .get_settings()
                .map(|s| s.tcp_messaging_port)
                .unwrap_or(DEFAULT_TCP_PORT);
            match TcpListener::bind(("0.0.0.0", port)).await {
                Ok(listener) => this.serve(listener).await,
                Err(e) => eprintln!("[Network] Cannot listen on TCP port {}: {}", port, e),
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
        let peer = self
            .db
            .get_peer(&conv.peer_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Peer not found".to_string())?;
        if peer.trust_state == "blocked" {
            return Err("You blocked this contact. Unblock them in People to send messages.".to_string());
        }

        let msg = Message {
            id: uuid::Uuid::new_v4().to_string(),
            conversation_id: conversation_id.to_string(),
            sender_id: self.identity.device_id.clone(),
            receiver_id: peer.id.clone(),
            content: trimmed.to_string(),
            message_type: "text".to_string(),
            timestamp: now_secs(),
            status: "sending".to_string(),
            error_reason: None,
            is_outgoing: true,
            transfer_id: None,
        };
        self.db.insert_message(&msg).map_err(|e| e.to_string())?;
        self.kick_outbox(&peer.id, true);
        Ok(msg)
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

    async fn flush_outbox_once(&self, peer_id: &str) {
        let mut messages = self.db.pending_outgoing_messages(peer_id).unwrap_or_default();
        let offers = self.db.queued_offers_for_peer(peer_id).unwrap_or_default();
        if messages.is_empty() && offers.is_empty() {
            return;
        }
        let Ok(Some(peer)) = self.db.get_peer(peer_id) else {
            return;
        };
        if peer.trust_state == "blocked" {
            for m in messages.iter_mut() {
                self.set_message_status(m, "failed", Some("You blocked this contact".to_string()));
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
                for mut t in offers {
                    if t.error_reason.as_deref() != Some(reason.as_str()) {
                        t.error_reason = Some(reason.clone());
                        let _ = self.db.save_transfer(&t);
                        self.events.transfer_updated(&t);
                    }
                }
                return;
            }
        };
        self.last_failure.lock().remove(peer_id);

        let mut connection_lost = false;
        for m in messages.iter_mut() {
            let payload = PacketPayload::Message(MessagePayload {
                message_id: m.id.clone(),
                conversation_id: m.conversation_id.clone(),
                content: m.content.clone(),
                message_type: m.message_type.clone(),
            });
            let sent = match chan.send(payload, None).await {
                Ok(p) => p,
                Err(_) => {
                    connection_lost = true;
                    break;
                }
            };
            match chan.recv_packet_timeout(ACK_TIMEOUT).await {
                Ok(reply) if reply.correlation_id.as_deref() == Some(sent.packet_id.as_str()) => {
                    match reply.payload {
                        PacketPayload::MessageAck(ack) if ack.db_committed => {
                            self.set_message_status(m, "delivered", None)
                        }
                        PacketPayload::MessageAck(ack) => self.set_message_status(
                            m,
                            "failed",
                            Some(ack.reason.unwrap_or_else(|| "Rejected by recipient".to_string())),
                        ),
                        PacketPayload::Error(e) => {
                            self.set_message_status(m, "failed", Some(e.message))
                        }
                        _ => self.set_message_status(
                            m,
                            "failed",
                            Some("Unexpected reply from recipient".to_string()),
                        ),
                    }
                }
                _ => {
                    connection_lost = true;
                    break;
                }
            }
        }

        if !connection_lost {
            for t in offers {
                if !self.deliver_offer(&mut chan, t).await {
                    connection_lost = true;
                    break;
                }
            }
        }

        if connection_lost {
            self.last_failure
                .lock()
                .insert(peer_id.to_string(), Instant::now());
            for m in messages.iter_mut().filter(|m| m.status == "sending") {
                self.set_message_status(
                    m,
                    "queued",
                    Some(format!("Waiting for {} to come online", peer.display_name)),
                );
            }
        }
        chan.close().await;
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
        if m.content.trim().is_empty() || m.content.len() > MAX_MESSAGE_CONTENT_LEN {
            return ack(false, Some("Message rejected (empty or too long)"));
        }

        let conv = match self.db.get_or_create_conversation(&peer.id) {
            Ok(c) => c,
            Err(_) => return ack(false, Some("Recipient database error")),
        };
        let msg = Message {
            id: m.message_id.clone(),
            conversation_id: conv.id.clone(),
            sender_id: peer.id.clone(),
            receiver_id: self.identity.device_id.clone(),
            content: m.content.clone(),
            message_type: "text".to_string(),
            timestamp: now_secs(),
            status: "delivered".to_string(),
            error_reason: None,
            is_outgoing: false,
            transfer_id: None,
        };
        if let Err(e) = self.db.insert_message(&msg) {
            eprintln!("[Network] Failed to store incoming message: {}", e);
            return ack(false, Some("Recipient database error"));
        }
        let _ = self.db.increment_unread(&conv.id);
        let conv = self.db.get_conversation(&conv.id).ok().flatten();
        self.events.message_received(&msg, conv.as_ref());
        self.events.notify(
            &self.db,
            &peer.display_name,
            &crate::storage::preview_text(&msg.content),
        );
        self.events.update_tray(&self.db);
        ack(true, None)
    }
}
