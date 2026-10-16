use crate::security::{DeviceIdentity, KeyTrustCheck};
use crate::storage::Database;
use crate::storage::models::Peer;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tokio::net::UdpSocket;
use tokio_util::sync::CancellationToken;

pub const DISCOVERY_PORT: u16 = 52925;
pub const PROTOCOL_NAME: &str = "LANX";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveryBeacon {
    pub protocol: String,
    pub version: u8,
    pub device_id: String,
    pub display_name: String,
    pub hostname: String,
    pub tcp_port: u16,
    pub public_key: String,
    pub avatar_color: String,
}

pub struct DiscoveryService {
    db: Arc<Database>,
    identity: DeviceIdentity,
    app_handle: Option<AppHandle>,
    cancel_token: CancellationToken,
}

impl DiscoveryService {
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

        // Spawn async tasks on tauri async runtime
        tauri::async_runtime::spawn(async move {
            let socket = match bind_discovery_socket(DISCOVERY_PORT).await {
                Ok(s) => Arc::new(s),
                Err(e) => {
                    eprintln!("[Discovery] Failed to bind UDP discovery socket: {}", e);
                    return;
                }
            };

            let beacon_socket = socket.clone();
            let beacon_identity = identity.clone();
            let beacon_db = db.clone();
            let beacon_cancel = cancel_token.clone();

            // Task 1: Periodic Beacon Broadcaster
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_secs(5));
                loop {
                    tokio::select! {
                        _ = beacon_cancel.cancelled() => break,
                        _ = interval.tick() => {
                            if let Ok(settings) = beacon_db.get_settings() {
                                let beacon = DiscoveryBeacon {
                                    protocol: PROTOCOL_NAME.to_string(),
                                    version: 1,
                                    device_id: beacon_identity.device_id.clone(),
                                    display_name: settings.display_name,
                                    hostname: settings.hostname,
                                    tcp_port: settings.tcp_messaging_port,
                                    public_key: beacon_identity.public_key_hex(),
                                    avatar_color: settings.avatar_color,
                                };

                                if let Ok(json_bytes) = serde_json::to_vec(&beacon) {
                                    // Broadcast to IPv4 LAN
                                    let targets = [
                                        "255.255.255.255:52925",
                                        "127.0.0.1:52925",
                                    ];
                                    for target in targets {
                                        let _ = beacon_socket.send_to(&json_bytes, target).await;
                                    }
                                }
                            }
                        }
                    }
                }
            });

            // Task 2: Incoming Beacon Listener
            let listener_socket = socket.clone();
            let listener_db = db.clone();
            let listener_identity = identity.clone();
            let listener_app = app_handle.clone();
            let listener_cancel = cancel_token.clone();

            tauri::async_runtime::spawn(async move {
                let mut buf = [0u8; 2048];
                loop {
                    tokio::select! {
                        _ = listener_cancel.cancelled() => break,
                        result = listener_socket.recv_from(&mut buf) => {
                            match result {
                                Ok((len, src_addr)) => {
                                    handle_received_beacon(
                                        &buf[..len],
                                        src_addr,
                                        &listener_identity,
                                        &listener_db,
                                        listener_app.as_ref(),
                                    );
                                }
                                Err(e) => {
                                    eprintln!("[Discovery] Error reading UDP socket: {}", e);
                                    tokio::time::sleep(Duration::from_millis(500)).await;
                                }
                            }
                        }
                    }
                }
            });

            // Task 3: Peer Expiry Task (marks offline after 15s)
            let expiry_db = db.clone();
            let expiry_app = app_handle.clone();
            let expiry_cancel = cancel_token.clone();

            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_secs(5));
                loop {
                    tokio::select! {
                        _ = expiry_cancel.cancelled() => break,
                        _ = interval.tick() => {
                            check_expired_peers(&expiry_db, expiry_app.as_ref());
                        }
                    }
                }
            });
        });
    }

    pub fn stop(&self) {
        self.cancel_token.cancel();
    }
}

async fn bind_discovery_socket(port: u16) -> Result<UdpSocket, std::io::Error> {
    let addr = format!("0.0.0.0:{}", port);
    let socket = UdpSocket::bind(&addr).await?;
    socket.set_broadcast(true)?;
    Ok(socket)
}

fn handle_received_beacon(
    bytes: &[u8],
    src_addr: SocketAddr,
    local_identity: &DeviceIdentity,
    db: &Database,
    app_handle: Option<&AppHandle>,
) {
    let beacon: DiscoveryBeacon = match serde_json::from_slice(bytes) {
        Ok(b) => b,
        Err(_) => return,
    };

    // Ignore packets from self
    if beacon.device_id == local_identity.device_id {
        return;
    }

    if beacon.protocol != PROTOCOL_NAME || beacon.version != 1 {
        return;
    }

    let ip = match src_addr {
        SocketAddr::V4(v4) => {
            let s = v4.ip().to_string();
            // If local loopback, keep as 127.0.0.1
            if s.starts_with("127.") {
                "127.0.0.1".to_string()
            } else {
                s
            }
        }
        SocketAddr::V6(v6) => v6.ip().to_string(),
    };

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    // Check existing peer to evaluate key trust change
    let existing_peer = db
        .list_peers()
        .ok()
        .and_then(|peers| peers.into_iter().find(|p| p.id == beacon.device_id));

    let trust_state = if let Some(ref p) = existing_peer {
        let check =
            DeviceIdentity::check_peer_key_trust(p.public_key.as_deref(), &beacon.public_key);
        match check {
            KeyTrustCheck::KeyChangedWarning { .. } => {
                eprintln!(
                    "[Security Alert] Peer {} public key changed! Forcing unverified state.",
                    beacon.device_id
                );
                "unverified".to_string()
            }
            _ => p.trust_state.clone(),
        }
    } else {
        "unverified".to_string()
    };

    let peer = Peer {
        id: beacon.device_id.clone(),
        display_name: beacon.display_name,
        hostname: beacon.hostname,
        last_ip: ip,
        tcp_port: beacon.tcp_port,
        public_key: Some(beacon.public_key),
        trust_state,
        status: "online".to_string(),
        last_seen: now,
        avatar_color: beacon.avatar_color,
    };

    let _ = db.upsert_peer(&peer);

    // Emit typed Tauri event
    if let Some(app) = app_handle {
        let _ = app.emit("lanx://peer-discovered", &peer);
    }
}

fn check_expired_peers(db: &Database, app_handle: Option<&AppHandle>) {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    if let Ok(peers) = db.list_peers() {
        for mut peer in peers {
            if peer.status == "online" && (now - peer.last_seen > 15) {
                peer.status = "offline".to_string();
                let _ = db.upsert_peer(&peer);
                if let Some(app) = app_handle {
                    #[derive(Serialize, Clone)]
                    struct PeerOfflinePayload {
                        peer_id: String,
                    }
                    let _ = app.emit(
                        "lanx://peer-offline",
                        PeerOfflinePayload {
                            peer_id: peer.id.clone(),
                        },
                    );
                }
            }
        }
    }
}
