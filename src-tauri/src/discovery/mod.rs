use crate::networking::session::normalize_ip;
use crate::networking::{NetworkService, SeenPeer, now_secs};
use crate::security::DeviceIdentity;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
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
    /// LANX 1.2.9: fingerprint of the sender's profile (not signed: it only
    /// prompts a fetch over the authenticated connection). Older versions
    /// ignore it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile_rev: Option<u64>,
    /// LANX 1.3.0: asks the receiver to answer directly (network search and
    /// introductions). Not signed; older versions ignore it.
    #[serde(default, skip_serializing_if = "is_false")]
    pub probe: bool,
    /// LANX 1.3.0: discovery addresses ("ip:port") of colleagues this PC can
    /// see, so two PCs whose broadcasts never reach each other still meet.
    /// Only a hint: each PC proves who it is with its own signed beacon.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub seen: Vec<String>,
}

/// LANX 1.3.0: how many colleagues' addresses a beacon passes on.
const MAX_SEEN_HINTS: usize = 16;
/// Beacons stay below this size: LANX 1.2 and older read at most 4 KB.
const MAX_BEACON_BYTES: usize = 3500;
/// While someone we know is missing, search the local network this often.
const SEARCH_EVERY: Duration = Duration::from_secs(120);
/// Introduce ourselves to the same address at most this often.
const PROBE_EVERY: Duration = Duration::from_secs(60);
/// Answer the same address's direct "hello?" at most this often.
const ANSWER_EVERY: Duration = Duration::from_secs(4);
/// Check a quiet colleague over the encrypted connection at most this often.
const CHECK_EVERY: Duration = Duration::from_secs(20);

fn is_false(b: &bool) -> bool {
    !*b
}

/// Network adapters that lead to the office network: (address, prefix
/// length). Loopback, link-local and virtual switches are left out.
pub fn lan_adapters() -> Vec<(Ipv4Addr, u32)> {
    const VIRTUAL: [&str; 8] = ["vethernet", "virtualbox", "vmware", "hyper-v", "wsl", "loopback", "bluetooth", "npcap"];
    let mut out = Vec::new();
    if let Ok(ifaces) = if_addrs::get_if_addrs() {
        for iface in ifaces {
            if iface.is_loopback() {
                continue;
            }
            let name = iface.name.to_ascii_lowercase();
            if VIRTUAL.iter().any(|v| name.contains(v)) {
                continue;
            }
            if let if_addrs::IfAddr::V4(v4) = iface.addr {
                if v4.ip.is_link_local() || v4.ip.is_loopback() {
                    continue;
                }
                let prefix = u32::from(v4.netmask).count_ones();
                if !out.iter().any(|(ip, _)| *ip == v4.ip) {
                    out.push((v4.ip, prefix));
                }
            }
        }
    }
    out
}

/// The other addresses on an adapter's network to search (a /24 at most, so a
/// search is a few hundred tiny packets).
pub fn search_hosts(ip: Ipv4Addr, prefix: u32) -> Vec<Ipv4Addr> {
    let prefix = prefix.clamp(24, 32);
    if prefix >= 31 {
        return Vec::new();
    }
    let mask = u32::MAX << (32 - prefix);
    let net = u32::from(ip) & mask;
    let bcast = net | !mask;
    ((net + 1)..bcast).map(Ipv4Addr::from).filter(|h| *h != ip).collect()
}

/// A colleague's "I can also see this PC" hint is only followed inside our
/// own networks (never to the internet or another company network).
pub fn hint_allowed(addr: &SocketAddr, adapters: &[(Ipv4Addr, u32)]) -> bool {
    let SocketAddr::V4(v4) = addr else { return false };
    let ip = *v4.ip();
    if ip.is_loopback() {
        // Only side-by-side test copies use loopback.
        return crate::testmode::bind_addr().is_loopback();
    }
    if ip.is_broadcast() || ip.is_multicast() || ip.is_unspecified() || v4.port() == 0 {
        return false;
    }
    adapters.iter().any(|(own, prefix)| {
        let p = (*prefix).clamp(8, 32);
        let mask = u32::MAX << (32 - p);
        (u32::from(*own) & mask) == (u32::from(ip) & mask) && ip != *own
    })
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
    /// LANX 1.3.0: where each colleague's beacons last came from, and when.
    heard: Mutex<HashMap<String, (SocketAddr, i64)>>,
    /// Addresses we introduced ourselves to, and when (rate limit).
    probed: Mutex<HashMap<SocketAddr, Instant>>,
    /// Addresses whose "hello?" we answered, and when (rate limit).
    answered: Mutex<HashMap<SocketAddr, Instant>>,
    /// "Search the network" pressed.
    search_now: tokio::sync::Notify,
    /// Last direct check (encrypted connection) of colleagues whose beacons
    /// stopped arriving, by device id.
    checked: Mutex<HashMap<String, Instant>>,
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
            heard: Mutex::new(HashMap::new()),
            probed: Mutex::new(HashMap::new()),
            answered: Mutex::new(HashMap::new()),
            search_now: tokio::sync::Notify::new(),
            checked: Mutex::new(HashMap::new()),
        }
    }

    /// A colleague's beacons stopped arriving (or never do: an older LANX
    /// we were introduced to). Ask over the encrypted connection: if it
    /// answers it stays online (and its name and colour are refreshed);
    /// otherwise, once it has been silent too long, it goes offline.
    fn check_directly(self: &Arc<Self>, peer: crate::storage::models::Peer, overdue: bool) {
        {
            let mut checked = self.checked.lock();
            if checked.get(&peer.id).is_some_and(|t| t.elapsed() < CHECK_EVERY) {
                if overdue {
                    drop(checked);
                    self.network.peer_went_offline(&peer.id);
                }
                return;
            }
            checked.insert(peer.id.clone(), Instant::now());
        }
        let this = self.clone();
        tokio::spawn(async move {
            match this.network.connect_peer(&peer).await {
                Ok(chan) => chan.close().await,
                Err(_) if overdue => this.network.peer_went_offline(&peer.id),
                Err(_) => {}
            }
        });
    }

    /// Seconds without any sign of a colleague before they count as offline.
    fn offline_after(&self) -> i64 {
        (self.interval().as_secs() as i64 * 6 + 2).max(30)
    }

    /// Searches the local network now ("Search the network" in Peers).
    pub fn search(&self) {
        self.search_now.notify_one();
    }

    /// Addresses of colleagues we hear right now (for introductions).
    fn seen_hints(&self) -> Vec<String> {
        let now = now_secs();
        let window = self.offline_after();
        let mut list: Vec<(i64, String)> = self
            .heard
            .lock()
            .values()
            .filter(|(_, t)| now - *t <= window)
            .map(|(a, t)| (*t, a.to_string()))
            .collect();
        list.sort_by(|a, b| b.0.cmp(&a.0));
        list.into_iter().take(MAX_SEEN_HINTS).map(|(_, a)| a).collect()
    }

    /// Every colleague we know, directly: their last beacon address, or their
    /// last known IP on our discovery port. Direct packets get through where
    /// Wi-Fi drops broadcasts.
    fn direct_targets(&self, port: u16) -> Vec<SocketAddr> {
        let own: Vec<String> = local_ipv4_addresses();
        let heard = self.heard.lock().clone();
        let mut out: Vec<SocketAddr> = heard.values().map(|(a, _)| *a).collect();
        if let Ok(peers) = self.network.db.list_peers() {
            for p in peers {
                if p.trust_state == "blocked" || heard.contains_key(&p.id) || own.contains(&p.last_ip) {
                    continue;
                }
                if let Ok(ip) = p.last_ip.parse::<Ipv4Addr>() {
                    if !ip.is_unspecified() && !ip.is_loopback() {
                        let addr = SocketAddr::V4(SocketAddrV4::new(ip, port));
                        if !out.contains(&addr) {
                            out.push(addr);
                        }
                    }
                }
            }
        }
        out
    }

    /// Someone we know is not online (or nobody is): worth searching.
    fn someone_missing(&self) -> bool {
        match self.network.db.list_peers() {
            Ok(peers) => {
                let known: Vec<_> = peers.iter().filter(|p| p.trust_state != "blocked" && !p.id.starts_with("manual-")).collect();
                known.is_empty() || known.iter().any(|p| p.status != "online")
            }
            Err(_) => false,
        }
    }

    /// Sends a "hello?" to every other address on our networks; every LANX
    /// there answers directly.
    async fn search_network(&self, socket: &UdpSocket, port: u16) {
        if crate::testmode::bind_addr().is_loopback() {
            return; // side-by-side test copies: only their own targets
        }
        let Some(bytes) = self.build_beacon_with("online", true) else { return };
        let own = local_ipv4_addresses();
        for (ip, prefix) in lan_adapters() {
            for (i, host) in search_hosts(ip, prefix).into_iter().enumerate() {
                if own.contains(&host.to_string()) {
                    continue;
                }
                let _ = socket.send_to(&bytes, SocketAddr::V4(SocketAddrV4::new(host, port))).await;
                if i % 16 == 15 {
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
            }
        }
    }

    pub fn is_listening(&self) -> bool {
        self.listening.load(Ordering::SeqCst)
    }

    fn build_beacon(&self, status: &str) -> Option<Vec<u8>> {
        self.build_beacon_with(status, false)
    }

    fn build_beacon_with(&self, status: &str, probe: bool) -> Option<Vec<u8>> {
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
            profile_rev: Some(self.network.local_profile_rev()),
            probe,
            seen: if status == "online" { self.seen_hints() } else { Vec::new() },
        };
        beacon.signature = identity.sign_bytes(&beacon.signing_bytes());
        let mut bytes = serde_json::to_vec(&beacon).ok()?;
        while bytes.len() > MAX_BEACON_BYTES && !beacon.seen.is_empty() {
            let keep = beacon.seen.len() / 2;
            beacon.seen.truncate(keep);
            bytes = serde_json::to_vec(&beacon).ok()?;
        }
        Some(bytes)
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

            // 1. Periodic beacons on every adapter, and directly to every
            //    colleague we know (Wi-Fi often drops broadcasts).
            let beacons = this.clone();
            let beacon_socket = socket.clone();
            tokio::spawn(async move {
                loop {
                    if let Some(bytes) = beacons.build_beacon("online") {
                        let mut sent: Vec<SocketAddr> = Vec::new();
                        for target in beacon_targets(port).into_iter().chain(beacons.direct_targets(port)) {
                            if !sent.contains(&target) {
                                let _ = beacon_socket.send_to(&bytes, target).await;
                                sent.push(target);
                            }
                        }
                    }
                    tokio::select! {
                        _ = beacons.cancel_token.cancelled() => break,
                        _ = tokio::time::sleep(beacons.interval()) => {}
                    }
                }
            });

            // 2. Search the local network at start-up, when asked, and every
            //    two minutes while someone we know is missing (their address
            //    may have changed, or the router drops their broadcasts).
            let searcher = this.clone();
            let search_socket = socket.clone();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_secs(3)).await;
                searcher.search_network(&search_socket, port).await;
                loop {
                    let asked = tokio::select! {
                        _ = searcher.cancel_token.cancelled() => break,
                        _ = searcher.search_now.notified() => true,
                        _ = tokio::time::sleep(SEARCH_EVERY) => false,
                    };
                    if asked || searcher.someone_missing() {
                        searcher.search_network(&search_socket, port).await;
                    }
                }
            });

            // 3. Expire peers that stopped sending beacons.
            let expiry = this.clone();
            tokio::spawn(async move {
                loop {
                    tokio::select! {
                        _ = expiry.cancel_token.cancelled() => break,
                        _ = tokio::time::sleep(Duration::from_secs(2)) => {}
                    }
                    let timeout = expiry.offline_after();
                    let quiet = expiry.interval().as_secs() as i64 * 2 + 2;
                    let now = now_secs();
                    if let Ok(peers) = expiry.network.db.list_peers() {
                        for p in peers {
                            let age = now - p.last_seen;
                            if p.status == "online" && age > quiet {
                                expiry.check_directly(p, age > timeout);
                            }
                        }
                    }
                }
            });

            // 4. Listen for beacons.
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
        let profile_rev = beacon.profile_rev;
        let probe = beacon.probe;
        let hints = beacon.seen.clone();
        self.heard.lock().insert(beacon.device_id.clone(), (src, now_secs()));
        let seen = SeenPeer {
            device_id: beacon.device_id,
            display_name: beacon.display_name,
            hostname: beacon.hostname,
            ip: normalize_ip(&src),
            tcp_port: beacon.tcp_port,
            public_key: beacon.public_key,
            avatar_color: beacon.avatar_color,
        };
        let newly_online = self.network.peer_seen(&seen);
        if let Some(rev) = profile_rev {
            self.network.check_peer_profile(&seen.device_id, rev);
        }
        // Newly online, or asking "hello?": answer directly so it sees us
        // without waiting (and even if our broadcasts never reach it).
        let answer = newly_online || {
            let mut answered = self.answered.lock();
            let due = probe && answered.get(&src).is_none_or(|t| t.elapsed() >= ANSWER_EVERY);
            if due {
                answered.insert(src, Instant::now());
            }
            due
        };
        if answer {
            if let Some(reply) = self.build_beacon("online") {
                let _ = socket.send_to(&reply, src).await;
            }
        }
        // Introductions: say hello to colleagues it sees and we don't.
        if !hints.is_empty() {
            self.follow_hints(&hints, socket).await;
        }
    }

    async fn follow_hints(&self, hints: &[String], socket: &UdpSocket) {
        let adapters = lan_adapters();
        let now = now_secs();
        let window = self.offline_after();
        let heard: Vec<SocketAddr> = self
            .heard
            .lock()
            .values()
            .filter(|(_, t)| now - *t <= window)
            .map(|(a, _)| *a)
            .collect();
        let own = self.socket.lock().as_ref().and_then(|s| s.local_addr().ok());
        let mut targets = Vec::new();
        {
            let mut probed = self.probed.lock();
            for h in hints.iter().take(MAX_SEEN_HINTS) {
                let Ok(addr) = h.parse::<SocketAddr>() else { continue };
                if heard.contains(&addr) || Some(addr) == own || !hint_allowed(&addr, &adapters) {
                    continue;
                }
                if probed.get(&addr).is_some_and(|t| t.elapsed() < PROBE_EVERY) {
                    continue;
                }
                probed.insert(addr, Instant::now());
                targets.push(addr);
            }
        }
        if targets.is_empty() {
            return;
        }
        if let Some(bytes) = self.build_beacon_with("online", true) {
            for t in targets {
                let _ = socket.send_to(&bytes, t).await;
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
        // Never advertise LANX's real port: a test peer "seen" on 127.0.0.1
        // would otherwise be contacted at the LANX installed on this PC.
        s.tcp_messaging_port = 9;
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
    fn search_covers_the_office_network_only() {
        let ip: Ipv4Addr = "192.168.29.49".parse().unwrap();
        let hosts = search_hosts(ip, 24);
        assert_eq!(hosts.len(), 253, "1..254 without ourselves");
        assert!(!hosts.contains(&ip));
        assert!(hosts.contains(&"192.168.29.1".parse().unwrap()) && hosts.contains(&"192.168.29.254".parse().unwrap()));
        // A big company network is searched only around us (/24).
        let wide = search_hosts("10.20.30.40".parse().unwrap(), 16);
        assert_eq!(wide.len(), 253);
        assert!(wide.iter().all(|h| h.octets()[..3] == [10, 20, 30]));
        assert!(search_hosts(ip, 31).is_empty());
    }

    #[test]
    fn introductions_stay_inside_our_networks() {
        let adapters = vec![("192.168.29.49".parse::<Ipv4Addr>().unwrap(), 24)];
        let ok = |s: &str| hint_allowed(&s.parse().unwrap(), &adapters);
        assert!(ok("192.168.29.28:52925"));
        assert!(!ok("192.168.30.28:52925"), "another network");
        assert!(!ok("8.8.8.8:52925"), "the internet");
        assert!(!ok("192.168.29.49:52925"), "ourselves");
        assert!(!ok("255.255.255.255:52925"));
        assert!(!ok("192.168.29.28:0"));
    }

    #[test]
    fn new_beacons_stay_readable_by_older_versions() {
        // What LANX 1.2.x reads: the same struct without probe/seen (unknown
        // fields are ignored), in a 4 KB buffer, with the same signature.
        #[derive(Deserialize)]
        #[allow(dead_code)]
        struct OldBeacon {
            protocol: String,
            version: u8,
            device_id: String,
            display_name: String,
            hostname: String,
            tcp_port: u16,
            public_key: String,
            avatar_color: String,
            status: String,
            timestamp: i64,
            signature: String,
        }
        let a = service("Alice");
        for i in 0..40 {
            let addr: SocketAddr = format!("192.168.29.{}:52925", 10 + i).parse().unwrap();
            a.heard.lock().insert(format!("peer-{i}"), (addr, now_secs()));
        }
        let bytes = a.build_beacon_with("online", true).unwrap();
        assert!(bytes.len() < 4096, "{} bytes", bytes.len());
        let new: DiscoveryBeacon = serde_json::from_slice(&bytes).unwrap();
        assert!(new.verify() && new.probe);
        assert_eq!(new.seen.len(), MAX_SEEN_HINTS);
        let old: OldBeacon = serde_json::from_slice(&bytes).unwrap();
        let as_old = DiscoveryBeacon { probe: false, seen: Vec::new(), profile_rev: None, ..new.clone() };
        assert_eq!(old.signature, as_old.signature);
        assert!(as_old.verify(), "the signature doesn't cover the new fields");
        // Plain beacons don't carry the probe flag at all.
        let plain = String::from_utf8(a.build_beacon("online").unwrap()).unwrap();
        assert!(!plain.contains("\"probe\""));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_hello_gets_an_answer_and_hints_are_followed() {
        let a = service("Alice");
        let b = service("Bob");
        let sock = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let listener = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let src = listener.local_addr().unwrap();
        // Bob already known to Alice, then Bob asks "hello?": Alice answers.
        a.handle_beacon(&b.build_beacon("online").unwrap(), src, &sock).await;
        let mut buf = vec![0u8; 4096];
        let _ = tokio::time::timeout(Duration::from_secs(1), listener.recv_from(&mut buf)).await;
        a.handle_beacon(&b.build_beacon_with("online", true).unwrap(), src, &sock).await;
        let got = tokio::time::timeout(Duration::from_secs(2), listener.recv_from(&mut buf)).await;
        let (len, _) = got.expect("answer to the probe").unwrap();
        let reply: DiscoveryBeacon = serde_json::from_slice(&buf[..len]).unwrap();
        assert_eq!(reply.display_name, "Alice");
        assert!(a.heard.lock().contains_key(&b.network.identity.device_id));
    }

    #[test]
    fn local_addresses_and_targets_exclude_nothing_essential() {
        let targets = beacon_targets(52925);
        assert!(targets.contains(&"255.255.255.255:52925".parse().unwrap()));
        assert!(targets.contains(&"127.0.0.1:52925".parse().unwrap()));
        assert!(local_ipv4_addresses().iter().all(|ip| !ip.starts_with("127.")));
    }
}
