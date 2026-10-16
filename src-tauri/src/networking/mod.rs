pub mod protocol;
#[cfg(test)]
mod tests;

use crate::security::{DeviceIdentity, KeyTrustCheck};
use crate::storage::Database;
use crate::storage::models::{Conversation, Message, Peer};
use protocol::*;
use serde::Serialize;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tokio::net::{TcpListener, TcpStream};
use tokio_util::sync::CancellationToken;

pub const DEFAULT_TCP_PORT: u16 = 52926;

pub struct NetworkService {
    db: Arc<Database>,
    identity: DeviceIdentity,
    app_handle: Option<AppHandle>,
    cancel_token: CancellationToken,
}

impl NetworkService {
    pub fn new(db: Arc<Database>, identity: DeviceIdentity, app_handle: Option<AppHandle>) -> Self {
        Self {
            db,
            identity,
            app_handle,
            cancel_token: CancellationToken::new(),
        }
    }

    pub fn start(&self) {
        let db = self.db.clone();
        let identity = self.identity.clone();
        let app_handle = self.app_handle.clone();
        let cancel_token = self.cancel_token.clone();

        tauri::async_runtime::spawn(async move {
            let port = db
                .get_settings()
                .map(|s| s.tcp_messaging_port)
                .unwrap_or(DEFAULT_TCP_PORT);

            let listener = match TcpListener::bind(format!("0.0.0.0:{}", port)).await {
                Ok(l) => l,
                Err(e) => {
                    eprintln!(
                        "[Network] Failed to bind TCP messaging listener on port {}: {}",
                        port, e
                    );
                    return;
                }
            };

            loop {
                tokio::select! {
                    _ = cancel_token.cancelled() => break,
                    accept_res = listener.accept() => {
                        match accept_res {
                            Ok((stream, remote_addr)) => {
                                let stream_db = db.clone();
                                let stream_identity = identity.clone();
                                let stream_app = app_handle.clone();

                                tauri::async_runtime::spawn(async move {
                                    handle_incoming_connection(stream, remote_addr, stream_db, stream_identity, stream_app).await;
                                });
                            }
                            Err(e) => {
                                eprintln!("[Network] TCP accept error: {}", e);
                                tokio::time::sleep(Duration::from_millis(100)).await;
                            }
                        }
                    }
                }
            }
        });
    }

    pub fn stop(&self) {
        self.cancel_token.cancel();
    }

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
                "Message exceeds maximum allowed length of {} characters",
                MAX_MESSAGE_CONTENT_LEN
            ));
        }

        let settings = self.db.get_settings().map_err(|e| e.to_string())?;

        // Find conversation and target peer
        let convs = self.db.get_conversations().map_err(|e| e.to_string())?;
        let conv = convs
            .into_iter()
            .find(|c| c.id == conversation_id)
            .ok_or_else(|| "Conversation not found".to_string())?;

        let peers = self.db.list_peers().map_err(|e| e.to_string())?;
        let peer = peers
            .into_iter()
            .find(|p| p.id == conv.peer_id)
            .ok_or_else(|| "Peer not found".to_string())?;

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        let message_id = uuid::Uuid::new_v4().to_string();

        let mut msg = Message {
            id: message_id.clone(),
            conversation_id: conversation_id.to_string(),
            sender_id: settings.device_id.clone(),
            receiver_id: peer.id.clone(),
            content: trimmed.to_string(),
            message_type: "text".to_string(),
            timestamp: now,
            status: "sending".to_string(),
            error_reason: None,
            is_outgoing: true,
        };

        // 1. Transactionally insert into SQLite with initial "sending" status
        self.db.insert_message(&msg).map_err(|e| e.to_string())?;

        // 2. Prepare framed packet
        let payload = PacketPayload::Message(MessagePayload {
            message_id: message_id.clone(),
            conversation_id: conversation_id.to_string(),
            content: trimmed.to_string(),
            message_type: "text".to_string(),
        });

        let packet = PacketEnvelope::new(
            &self.identity,
            &settings.display_name,
            PacketType::Message,
            None,
            payload,
        );

        // 3. Dispatch over TCP socket
        self.dispatch_message_packet(&peer.last_ip, peer.tcp_port, &packet, &message_id, &mut msg)
            .await;

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

        let settings = self.db.get_settings().map_err(|e| e.to_string())?;

        let convs = self.db.get_conversations().map_err(|e| e.to_string())?;
        let conv = convs
            .into_iter()
            .find(|c| c.id == msg.conversation_id)
            .ok_or_else(|| "Conversation not found".to_string())?;

        let peers = self.db.list_peers().map_err(|e| e.to_string())?;
        let peer = peers
            .into_iter()
            .find(|p| p.id == conv.peer_id)
            .ok_or_else(|| "Peer not found".to_string())?;

        // Mark as "sending" in SQLite and notify UI
        msg.status = "sending".to_string();
        msg.error_reason = None;
        let _ = self.db.update_message_status(message_id, "sending", None);
        self.emit_status_updated(message_id, "sending", None);

        // Prepare framed packet with original message_id for idempotent delivery
        let payload = PacketPayload::Message(MessagePayload {
            message_id: message_id.to_string(),
            conversation_id: msg.conversation_id.clone(),
            content: msg.content.clone(),
            message_type: msg.message_type.clone(),
        });

        let packet = PacketEnvelope::new(
            &self.identity,
            &settings.display_name,
            PacketType::Message,
            None,
            payload,
        );

        self.dispatch_message_packet(&peer.last_ip, peer.tcp_port, &packet, message_id, &mut msg)
            .await;

        Ok(msg)
    }

    async fn dispatch_message_packet(
        &self,
        peer_ip: &str,
        peer_port: u16,
        packet: &PacketEnvelope,
        message_id: &str,
        msg: &mut Message,
    ) {
        let peer_target = format!("{}:{}", peer_ip, peer_port);
        let connect_timeout = Duration::from_millis(3000);

        let stream_res =
            tokio::time::timeout(connect_timeout, TcpStream::connect(&peer_target)).await;

        match stream_res {
            Ok(Ok(mut stream)) => {
                if let Err(e) = write_framed_packet(&mut stream, packet).await {
                    let err_msg = format!("Failed to write message frame: {}", e);
                    self.update_failed_status(message_id, &err_msg, msg);
                    return;
                }

                let ack_timeout = Duration::from_millis(5000);
                match tokio::time::timeout(ack_timeout, read_framed_packet(&mut stream)).await {
                    Ok(Ok(reply)) => {
                        if let Ok(true) = reply.verify_signature() {
                            if let PacketPayload::MessageAck(ack) = reply.payload {
                                if ack.message_id == message_id && ack.db_committed {
                                    msg.status = "delivered".to_string();
                                    msg.error_reason = None;
                                    let _ = self.db.update_message_status(
                                        message_id,
                                        "delivered",
                                        None,
                                    );
                                    self.emit_status_updated(message_id, "delivered", None);
                                    return;
                                } else {
                                    let reason = ack.reason.unwrap_or_else(|| {
                                        "Remote peer reported rejection".to_string()
                                    });
                                    self.update_failed_status(message_id, &reason, msg);
                                    return;
                                }
                            }
                        }
                        self.update_failed_status(message_id, "Invalid ACK from peer", msg);
                    }
                    Ok(Err(e)) => {
                        self.update_failed_status(
                            message_id,
                            &format!("ACK read error: {}", e),
                            msg,
                        );
                    }
                    Err(_) => {
                        self.update_failed_status(
                            message_id,
                            "Acknowledgement timed out (5s)",
                            msg,
                        );
                    }
                }
            }
            Ok(Err(e)) => {
                let err_msg = format!("Connection refused or unreachable: {}", e);
                self.update_failed_status(message_id, &err_msg, msg);
            }
            Err(_) => {
                self.update_failed_status(message_id, "Connection timed out (3s)", msg);
            }
        }
    }

    pub async fn connect_manual_peer(
        &self,
        ip: &str,
        port: u16,
        name: Option<String>,
    ) -> Result<Peer, String> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        let settings = self
            .db
            .get_settings()
            .unwrap_or_else(|_| create_fallback_settings());
        let target_addr = format!("{}:{}", ip, port);

        // Attempt Hello packet
        let hello_packet = PacketEnvelope::new(
            &self.identity,
            &settings.display_name,
            PacketType::Hello,
            None,
            PacketPayload::Hello(HelloPayload {
                hostname: settings.hostname.clone(),
                tcp_port: settings.tcp_messaging_port,
                avatar_color: settings.avatar_color.clone(),
                protocol_version: PROTOCOL_VERSION,
            }),
        );

        let connect_timeout = Duration::from_millis(3000);
        let stream_res =
            tokio::time::timeout(connect_timeout, TcpStream::connect(&target_addr)).await;

        if let Ok(Ok(mut stream)) = stream_res {
            if write_framed_packet(&mut stream, &hello_packet)
                .await
                .is_ok()
            {
                let ack_timeout = Duration::from_millis(4000);
                if let Ok(Ok(reply)) =
                    tokio::time::timeout(ack_timeout, read_framed_packet(&mut stream)).await
                {
                    if let Ok(true) = reply.verify_signature() {
                        let peer_id = reply.sender_id.clone();
                        let display_name = if let Some(n) = name {
                            n
                        } else {
                            reply.sender_name.clone()
                        };

                        let (hostname, avatar_color, tcp_port) = match reply.payload {
                            PacketPayload::HelloAck(ref h) => {
                                (h.hostname.clone(), h.avatar_color.clone(), h.tcp_port)
                            }
                            _ => ("Manual Node".to_string(), "#3b82f6".to_string(), port),
                        };

                        let existing_peer = self
                            .db
                            .list_peers()
                            .ok()
                            .and_then(|peers| peers.into_iter().find(|p| p.id == peer_id));

                        let trust_state = if let Some(ref p) = existing_peer {
                            match DeviceIdentity::check_peer_key_trust(
                                p.public_key.as_deref(),
                                &reply.sender_pubkey,
                            ) {
                                KeyTrustCheck::KeyChangedWarning { .. } => "unverified".to_string(),
                                _ => p.trust_state.clone(),
                            }
                        } else {
                            "unverified".to_string()
                        };

                        let peer = Peer {
                            id: peer_id,
                            display_name,
                            hostname,
                            last_ip: ip.to_string(),
                            tcp_port,
                            public_key: Some(reply.sender_pubkey),
                            trust_state,
                            status: "online".to_string(),
                            last_seen: now,
                            avatar_color,
                        };

                        self.db.upsert_peer(&peer).map_err(|e| e.to_string())?;
                        let _ = self.db.get_or_create_conversation(&peer.id);

                        if let Some(ref app) = self.app_handle {
                            let _ = app.emit("lanx://peer-discovered", &peer);
                        }

                        return Ok(peer);
                    }
                }
            }
        }

        // Fallback: if offline, create unverified manual peer
        let peer_id = format!("manual-{}:{}", ip, port);
        let display_name = name.unwrap_or_else(|| format!("Peer at {}:{}", ip, port));

        let peer = Peer {
            id: peer_id,
            display_name,
            hostname: "Manual Peer".to_string(),
            last_ip: ip.to_string(),
            tcp_port: port,
            public_key: None,
            trust_state: "unverified".to_string(),
            status: "offline".to_string(),
            last_seen: now,
            avatar_color: "#10b981".to_string(),
        };

        self.db.upsert_peer(&peer).map_err(|e| e.to_string())?;
        let _ = self.db.get_or_create_conversation(&peer.id);

        if let Some(ref app) = self.app_handle {
            let _ = app.emit("lanx://peer-discovered", &peer);
        }

        Ok(peer)
    }

    fn update_failed_status(&self, message_id: &str, error: &str, msg: &mut Message) {
        msg.status = "failed".to_string();
        msg.error_reason = Some(error.to_string());
        let _ = self
            .db
            .update_message_status(message_id, "failed", Some(error));
        self.emit_status_updated(message_id, "failed", Some(error.to_string()));
    }

    fn emit_status_updated(&self, message_id: &str, status: &str, error_reason: Option<String>) {
        if let Some(ref app) = self.app_handle {
            #[derive(Serialize, Clone)]
            struct StatusUpdatePayload {
                message_id: String,
                status: String,
                error_reason: Option<String>,
            }
            let _ = app.emit(
                "lanx://message-status-updated",
                StatusUpdatePayload {
                    message_id: message_id.to_string(),
                    status: status.to_string(),
                    error_reason,
                },
            );
        }
    }
}

async fn handle_incoming_connection(
    mut stream: TcpStream,
    remote_addr: SocketAddr,
    db: Arc<Database>,
    identity: DeviceIdentity,
    app_handle: Option<AppHandle>,
) {
    let peer_ip = match remote_addr {
        SocketAddr::V4(v4) => {
            let s = v4.ip().to_string();
            if s.starts_with("127.") {
                "127.0.0.1".to_string()
            } else {
                s
            }
        }
        SocketAddr::V6(v6) => v6.ip().to_string(),
    };

    // Read incoming packet with 10s idle timeout
    let timeout = Duration::from_secs(10);
    let packet_res = tokio::time::timeout(timeout, read_framed_packet(&mut stream)).await;

    let packet = match packet_res {
        Ok(Ok(p)) => p,
        Ok(Err(e)) => {
            eprintln!(
                "[Network] Framed packet read error from {}: {}",
                remote_addr, e
            );
            return;
        }
        Err(_) => return, // Timed out
    };

    // Verify digital signature
    match packet.verify_signature() {
        Ok(true) => {}
        _ => {
            eprintln!(
                "[Security] Rejected packet with invalid digital signature from {}",
                remote_addr
            );
            let _ = write_framed_packet(
                &mut stream,
                &PacketEnvelope::new(
                    &identity,
                    "LANX Node",
                    PacketType::Error,
                    Some(packet.packet_id),
                    PacketPayload::Error(ErrorPayload {
                        code: "SIGNATURE_INVALID".to_string(),
                        message: "Digital signature verification failed".to_string(),
                    }),
                ),
            )
            .await;
            return;
        }
    }

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    // Check key trust
    let existing_peer = db
        .list_peers()
        .ok()
        .and_then(|peers| peers.into_iter().find(|p| p.id == packet.sender_id));

    let trust_state = if let Some(ref p) = existing_peer {
        let check =
            DeviceIdentity::check_peer_key_trust(p.public_key.as_deref(), &packet.sender_pubkey);
        match check {
            KeyTrustCheck::KeyChangedWarning { .. } => {
                eprintln!(
                    "[Security Alert] Peer {} public key changed on incoming TCP packet!",
                    packet.sender_id
                );
                "unverified".to_string()
            }
            _ => p.trust_state.clone(),
        }
    } else {
        "unverified".to_string()
    };

    // Upsert or update peer in database
    let peer = Peer {
        id: packet.sender_id.clone(),
        display_name: packet.sender_name.clone(),
        hostname: "LAN Node".to_string(),
        last_ip: peer_ip,
        tcp_port: DEFAULT_TCP_PORT,
        public_key: Some(packet.sender_pubkey.clone()),
        trust_state,
        status: "online".to_string(),
        last_seen: now,
        avatar_color: "#3b82f6".to_string(),
    };
    let _ = db.upsert_peer(&peer);

    match packet.payload {
        PacketPayload::Hello(hello) => {
            let mut updated_peer = peer.clone();
            updated_peer.hostname = hello.hostname;
            updated_peer.tcp_port = hello.tcp_port;
            updated_peer.avatar_color = hello.avatar_color;
            let _ = db.upsert_peer(&updated_peer);

            if let Some(ref app) = app_handle {
                let _ = app.emit("lanx://peer-discovered", &updated_peer);
            }

            // Reply with HelloAck
            let my_settings = db
                .get_settings()
                .unwrap_or_else(|_| create_fallback_settings());
            let reply = PacketEnvelope::new(
                &identity,
                &my_settings.display_name,
                PacketType::HelloAck,
                Some(packet.packet_id),
                PacketPayload::HelloAck(HelloPayload {
                    hostname: my_settings.hostname,
                    tcp_port: my_settings.tcp_messaging_port,
                    avatar_color: my_settings.avatar_color,
                    protocol_version: PROTOCOL_VERSION,
                }),
            );
            let _ = write_framed_packet(&mut stream, &reply).await;
        }

        PacketPayload::Message(msg_payload) => {
            // Deduplication check: check if message already persisted
            let existing_msgs = db
                .get_messages(&msg_payload.conversation_id)
                .unwrap_or_default();
            let already_exists = existing_msgs.iter().any(|m| m.id == msg_payload.message_id);

            let my_settings = db
                .get_settings()
                .unwrap_or_else(|_| create_fallback_settings());

            if !already_exists {
                // Ensure conversation exists
                let conv = db.get_or_create_conversation(&packet.sender_id);

                let incoming_msg = Message {
                    id: msg_payload.message_id.clone(),
                    conversation_id: conv
                        .as_ref()
                        .map(|c| c.id.clone())
                        .unwrap_or_else(|_| msg_payload.conversation_id.clone()),
                    sender_id: packet.sender_id.clone(),
                    receiver_id: my_settings.device_id.clone(),
                    content: msg_payload.content.clone(),
                    message_type: msg_payload.message_type.clone(),
                    timestamp: now,
                    status: "delivered".to_string(),
                    error_reason: None,
                    is_outgoing: false,
                };

                // Transactionally insert message
                if let Err(e) = db.insert_message(&incoming_msg) {
                    eprintln!(
                        "[Network] Failed to commit incoming message to SQLite: {}",
                        e
                    );
                    // Do not acknowledge if DB commit failed
                    let reply = PacketEnvelope::new(
                        &identity,
                        &my_settings.display_name,
                        PacketType::MessageAck,
                        Some(packet.packet_id),
                        PacketPayload::MessageAck(MessageAckPayload {
                            message_id: msg_payload.message_id,
                            status: "failed".to_string(),
                            db_committed: false,
                            reason: Some("Database commit error".to_string()),
                        }),
                    );
                    let _ = write_framed_packet(&mut stream, &reply).await;
                    return;
                }

                // Database commit succeeded! Emit real-time event to React UI
                if let Some(ref app) = app_handle {
                    #[derive(Serialize, Clone)]
                    struct IncomingMessageEvent {
                        message: Message,
                        conversation: Option<Conversation>,
                    }
                    let _ = app.emit(
                        "lanx://message-received",
                        IncomingMessageEvent {
                            message: incoming_msg,
                            conversation: conv.ok(),
                        },
                    );
                }
            }

            // Return MessageAck confirming successful commit
            let reply = PacketEnvelope::new(
                &identity,
                &my_settings.display_name,
                PacketType::MessageAck,
                Some(packet.packet_id),
                PacketPayload::MessageAck(MessageAckPayload {
                    message_id: msg_payload.message_id,
                    status: "delivered".to_string(),
                    db_committed: true,
                    reason: None,
                }),
            );
            let _ = write_framed_packet(&mut stream, &reply).await;
        }

        PacketPayload::Ping => {
            let my_settings = db
                .get_settings()
                .unwrap_or_else(|_| create_fallback_settings());
            let reply = PacketEnvelope::new(
                &identity,
                &my_settings.display_name,
                PacketType::Pong,
                Some(packet.packet_id),
                PacketPayload::Pong,
            );
            let _ = write_framed_packet(&mut stream, &reply).await;
        }

        _ => {}
    }
}

fn create_fallback_settings() -> crate::storage::models::UserSettings {
    crate::storage::models::UserSettings {
        device_id: "lanx-node".to_string(),
        display_name: "LANX Node".to_string(),
        hostname: "DESKTOP".to_string(),
        avatar_color: "#0284c7".to_string(),
        theme: "system".to_string(),
        udp_discovery_port: 52925,
        tcp_messaging_port: 52926,
        discovery_interval_secs: 5,
        notifications_enabled: true,
        auto_download_transfers: false,
        default_download_dir: "".to_string(),
        onboarding_completed: true,
    }
}
