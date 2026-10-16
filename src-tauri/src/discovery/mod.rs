use crate::networking::session::normalize_ip;
use crate::networking::{NetworkService, SeenPeer, now_secs};
use crate::security::DeviceIdentity;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tokio::net::UdpSocket;
use tokio_util::sync::CancellationToken;

pub const DISCOVERY_PORT: u16 = 52925;
pub const PROTOCOL_NAME: &str = "LANX";
pub const BEACON_VERSION: u8 = 2;

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
    /// "online", or "offline" when LANX is quitting.
    pub status: String,
    pub timestamp: i64,
    pub signature: String,
}

impl DiscoveryBeacon {
    fn signing_bytes(&self) -> Vec<u8> {
        let mut out = b"LANX-BEACON-V2".to_vec();
        out.extend_from_slice(
            &serde_json::to_vec(&(
                &self.protocol,
                self.version,
                &self.device_id,
                &self.display_name,
                &self.hostname,
                self.tcp_port,
                &self.public_key,
                &self.avatar_color,
                &self.status,
                self.timestamp,
            ))
            .unwrap_or_default(),
        );
        out
    }

    pub fn verify(&self) -> bool {
        DeviceIdentity::verify_signature(&self.public_key, &self.signing_bytes(), &self.signature)
            == Ok(true)
    }
}

pub struct DiscoveryService {
    network: NetworkService,
    cancel_token: CancellationToken,
    socket: Mutex<Option<Arc<UdpSocket>>>,
    listening: AtomicBool,
}

/// Broadcast addresses of every active IPv4 adapter, plus the global
/// broadcast and loopback (for a second LANX profile on the same PC).
fn beacon_targets(port: u16) -> Vec<SocketAddr> {
    let mut targets: Vec<SocketAddr> = Vec::new();
    if let Ok(ifaces) = if_addrs::get_if_addrs() {
        for iface in ifaces {
            if iface.is_loopback() {
                continue;
            }
            if let if_addrs::IfAddr::V4(v4) = iface.addr {
                let bcast = v4.broadcast.unwrap_or_else(|| {
                    Ipv4Addr::from(u32::from(v4.ip) | !u32::from(v4.netmask))
                });
                let addr = SocketAddr::V4(SocketAddrV4::new(bcast, port));
                if !targets.contains(&addr) {
                    targets.push(addr);
                }
            }
        }
    }
    for fixed in [Ipv4Addr::BROADCAST, Ipv4Addr::LOCALHOST] {
        let addr = SocketAddr::V4(SocketAddrV4::new(fixed, port));
        if !targets.contains(&addr) {
            targets.push(addr);
        }
    }
    targets.extend(crate::testmode::extra_beacon_targets());
    targets
}

/// Non-loopback IPv4 addresses of this computer.
pub fn local_ipv4_addresses() -> Vec<String> {
    let mut ips = Vec::new();
    if let Ok(ifaces) = if_addrs::get_if_addrs() {
        for iface in ifaces {
            if iface.is_loopback() {
                continue;
            }
            if let if_addrs::IfAddr::V4(v4) = iface.addr {
                let s = v4.ip.to_string();
                if !ips.contains(&s) {
                    ips.push(s);
                }
            }
        }
    }
    ips
}

fn bind_discovery_socket(port: u16) -> std::io::Result<UdpSocket> {
    use socket2::{Domain, Protocol, Socket, Type};
    let socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
    // Lets a second LANX test profile share the port on one PC.
    socket.set_reuse_address(true)?;
    socket.set_broadcast(true)?;
    socket.set_nonblocking(true)?;
    socket.bind(&SocketAddr::V4(SocketAddrV4::new(crate::testmode::bind_addr(), port)).into())?;
    UdpSocket::from_std(socket.into())
}

impl DiscoveryService {
    pub fn new(network: NetworkService) -> Self {
        Self {
            network,
            cancel_token: CancellationToken::new(),
            socket: Mutex::new(None),
            listening: AtomicBool::new(false),
        }
    }

    pub fn is_listening(&self) -> bool {
        self.listening.load(Ordering::SeqCst)
    }

    fn build_beacon(&self, status: &str) -> Option<Vec<u8>> {
        let profile = self.network.local_profile();
        let identity = &self.network.identity;
        let mut beacon = DiscoveryBeacon {
            protocol: PROTOCOL_NAME.to_string(),
            version: BEACON_VERSION,
            device_id: identity.device_id.clone(),
            display_name: profile.display_name,
            hostname: profile.hostname,
            tcp_port: profile.tcp_port,
            public_key: identity.public_key_hex(),
            avatar_color: profile.avatar_color,
            status: status.to_string(),
            timestamp: now_secs(),
            signature: String::new(),
        };
        beacon.signature = identity.sign_bytes(&beacon.signing_bytes());
        serde_json::to_vec(&beacon).ok()
    }

    fn port(&self) -> u16 {
        self.network
            .db
            .get_settings()
            .map(|s| s.udp_discovery_port)
            .unwrap_or(DISCOVERY_PORT)
    }

    fn interval(&self) -> Duration {
        let secs = self
            .network
            .db
            .get_settings()
            .map(|s| s.discovery_interval_secs)
            .unwrap_or(5)
            .clamp(2, 60);
        Duration::from_secs(secs)
    }

    pub fn start(self: &Arc<Self>) {
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            let port = this.port();
            let socket = match bind_discovery_socket(port) {
                Ok(s) => Arc::new(s),
                Err(e) => {
                    eprintln!("[Discovery] Cannot bind UDP port {}: {}", port, e);
                    return;
                }
            };
            *this.socket.lock() = Some(socket.clone());
            this.listening.store(true, Ordering::SeqCst);

            // 1. Periodic beacons on every adapter.
            let beacons = this.clone();
            let beacon_socket = socket.clone();
            tokio::spawn(async move {
                loop {
                    if let Some(bytes) = beacons.build_beacon("online") {
                        for target in beacon_targets(port) {
                            let _ = beacon_socket.send_to(&bytes, target).await;
                        }
                    }
                    tokio::select! {
                        _ = beacons.cancel_token.cancelled() => break,
                        _ = tokio::time::sleep(beacons.interval()) => {}
                    }
                }
            });

            // 2. Expire peers that stopped sending beacons.
            let expiry = this.clone();
            tokio::spawn(async move {
                loop {
                    tokio::select! {
                        _ = expiry.cancel_token.cancelled() => break,
                        _ = tokio::time::sleep(Duration::from_secs(2)) => {}
                    }
                    let timeout = (expiry.interval().as_secs() as i64 * 3 + 2).max(15);
                    let now = now_secs();
                    if let Ok(peers) = expiry.network.db.list_peers() {
                        for p in peers {
                            if p.status == "online" && now - p.last_seen > timeout {
                                expiry.network.peer_went_offline(&p.id);
                            }
                        }
                    }
                }
            });

            // 3. Listen for beacons.
            let mut buf = vec![0u8; 4096];
            loop {
                tokio::select! {
                    _ = this.cancel_token.cancelled() => break,
                    res = socket.recv_from(&mut buf) => match res {
                        Ok((len, src)) => this.handle_beacon(&buf[..len], src, &socket).await,
                        // Windows reports ICMP "port unreachable" from earlier
                        // sends as a receive error; it is harmless.
                        Err(e) if e.kind() == std::io::ErrorKind::ConnectionReset => continue,
                        Err(e) => {
                            eprintln!("[Discovery] UDP receive error: {}", e);
                            tokio::time::sleep(Duration::from_millis(200)).await;
                        }
                    }
                }
            }
            this.listening.store(false, Ordering::SeqCst);
        });
    }

    async fn handle_beacon(&self, bytes: &[u8], src: SocketAddr, socket: &UdpSocket) {
        let Ok(beacon) = serde_json::from_slice::<DiscoveryBeacon>(bytes) else {
            return;
        };
        if beacon.protocol != PROTOCOL_NAME
            || beacon.version != BEACON_VERSION
            || beacon.device_id == self.network.identity.device_id
            || !beacon.verify()
        {
            return;
        }
        if beacon.status == "offline" {
            if let Ok(Some(p)) = self.network.db.get_peer(&beacon.device_id) {
                if p.public_key.as_deref() == Some(beacon.public_key.as_str()) {
                    self.network.peer_went_offline(&p.id);
                }
            }
            return;
        }
        let seen = SeenPeer {
            device_id: beacon.device_id,
            display_name: beacon.display_name,
            hostname: beacon.hostname,
            ip: normalize_ip(&src),
            tcp_port: beacon.tcp_port,
            public_key: beacon.public_key,
            avatar_color: beacon.avatar_color,
        };
        if self.network.peer_seen(&seen) {
            // Newly online: answer directly so it sees us without waiting.
            if let Some(reply) = self.build_beacon("online") {
                let _ = socket.send_to(&reply, src).await;
            }
        }
    }

    /// Tells everyone we are going offline (called when LANX quits).
    pub async fn announce_offline(&self) {
        let socket = self.socket.lock().clone();
        if let (Some(socket), Some(bytes)) = (socket, self.build_beacon("offline")) {
            for target in beacon_targets(self.port()) {
                let _ = socket.send_to(&bytes, target).await;
            }
        }
    }

    pub fn stop(&self) {
        self.cancel_token.cancel();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::Events;
    use crate::storage::Database;

    fn service(name: &str) -> Arc<DiscoveryService> {
        let db = Arc::new(Database::new_in_memory().unwrap());
        let identity = DeviceIdentity::load_or_create(&db.conn.lock()).unwrap();
        let mut s = db.get_settings().unwrap();
        s.display_name = name.to_string();
        db.save_settings(&s).unwrap();
        Arc::new(DiscoveryService::new(NetworkService::new(db, identity, Events::default())))
    }

    #[test]
    fn beacons_are_signed_and_tamper_evident() {
        let a = service("Alice");
        let bytes = a.build_beacon("online").unwrap();
        let beacon: DiscoveryBeacon = serde_json::from_slice(&bytes).unwrap();
        assert!(beacon.verify());
        assert_eq!(beacon.display_name, "Alice");

        let mut forged = beacon.clone();
        forged.tcp_port = 4444; // redirect attempt
        assert!(!forged.verify());
        let mut forged = beacon;
        forged.display_name = "CEO".into();
        assert!(!forged.verify());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn beacon_registers_peer_and_offline_beacon_removes_it() {
        let a = service("Alice");
        let b = service("Bob");
        let sock = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let src: SocketAddr = "192.168.1.77:52925".parse().unwrap();

        a.handle_beacon(&b.build_beacon("online").unwrap(), src, &sock).await;
        let bob = a.network.db.get_peer(&b.network.identity.device_id).unwrap().unwrap();
        assert_eq!(bob.display_name, "Bob");
        assert_eq!(bob.last_ip, "192.168.1.77");
        assert_eq!(bob.status, "online");

        // Own beacons are ignored.
        a.handle_beacon(&a.build_beacon("online").unwrap(), src, &sock).await;
        assert_eq!(a.network.db.list_peers().unwrap().len(), 1);

        a.handle_beacon(&b.build_beacon("offline").unwrap(), src, &sock).await;
        let bob = a.network.db.get_peer(&b.network.identity.device_id).unwrap().unwrap();
        assert_eq!(bob.status, "offline");
    }

    #[test]
    fn local_addresses_and_targets_exclude_nothing_essential() {
        let targets = beacon_targets(52925);
        assert!(targets.contains(&"255.255.255.255:52925".parse().unwrap()));
        assert!(targets.contains(&"127.0.0.1:52925".parse().unwrap()));
        assert!(local_ipv4_addresses().iter().all(|ip| !ip.starts_with("127.")));
    }
}
