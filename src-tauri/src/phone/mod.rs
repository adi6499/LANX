//! LANX 3.0: "LANX on your phone".
//!
//! This PC serves a small web page on the office network. A phone on the same
//! Wi-Fi scans the QR code shown in Settings (or types the 8-digit code), the
//! PC asks "Allow this phone?", and from then on the phone chats *through this
//! PC*: same name, same chats, same colleagues. Nothing leaves the office
//! network and there is no server anywhere — the phone talks only to this PC,
//! and only while LANX is running here.
//!
//! Pieces: `http.rs` (the web server), `ws.rs` (the live connection),
//! `api.rs` (what the phone can ask for and what it is told about).

pub mod api;
pub mod http;
pub mod ws;
#[cfg(test)]
mod tests;

use crate::networking::{NetworkService, now_secs, port_candidates};
use parking_lot::Mutex;
use rand::RngCore;
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU16, AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tokio::net::TcpListener;
use tokio::sync::mpsc::UnboundedSender;
use tokio_util::sync::CancellationToken;

/// The web server's port (moves to a free one when Windows reserves it, like
/// the messaging port does; the QR code always carries the port in use).
pub const DEFAULT_PHONE_PORT: u16 = 52930;
/// A pairing code is good for this long.
const CODE_SECS: i64 = 10 * 60;
/// Wrong tries before the code is thrown away.
const MAX_WRONG: u32 = 10;
/// A "may this phone join?" request is forgotten after this long.
const REQUEST_SECS: u64 = 5 * 60;
/// At most this many phones waiting for an answer at once.
const MAX_REQUESTS: usize = 8;
const SETTING_ENABLED: &str = "phone_enabled";
const SETTING_PORT: &str = "phone_port";
const SETTING_BOUND: &str = "phone_port_bound";
const SETTING_DEVICES: &str = "phone_devices";

/// A phone that was allowed in (kept in settings as JSON). The phone holds the
/// token; only its hash is stored here.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PhoneDevice {
    pub id: String,
    pub name: String,
    #[serde(default)]
    token_hash: String,
    pub created_at: i64,
    pub last_seen: i64,
}

/// What Settings shows about a phone.
#[derive(Serialize, Clone, Debug)]
pub struct PhoneDeviceInfo {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub last_seen: i64,
    pub connected: bool,
}

/// A phone that typed the right code and waits for "Allow".
#[derive(Serialize, Clone, Debug)]
pub struct PairRequestInfo {
    pub id: String,
    pub name: String,
    pub ip: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct PairingInfo {
    /// Eight digits, e.g. "48219937".
    pub code: String,
    pub expires_at: i64,
}

#[derive(Serialize, Clone, Debug)]
pub struct PhoneStatus {
    pub enabled: bool,
    pub listening: bool,
    pub port: u16,
    /// Where a phone on the office network reaches this PC (one per adapter).
    pub urls: Vec<String>,
    pub pairing: Option<PairingInfo>,
    pub requests: Vec<PairRequestInfo>,
    pub devices: Vec<PhoneDeviceInfo>,
    pub connected: usize,
}

struct Pairing {
    code: String,
    expires_at: i64,
    wrong: u32,
}

#[derive(Clone)]
enum PairState {
    Waiting,
    Allowed(String),
    Denied,
}

struct PairRequest {
    id: String,
    name: String,
    ip: String,
    at: Instant,
    state: PairState,
}

/// What the phone's poll gets back.
#[derive(Serialize, Clone, Debug)]
pub struct PollResult {
    /// "waiting" | "allowed" | "denied" | "expired"
    pub state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
}

/// A phone connected right now (one per WebSocket).
pub(crate) struct ClientHandle {
    pub device_id: String,
    pub tx: UnboundedSender<String>,
    pub cancel: CancellationToken,
}

pub struct PhoneInner {
    pub network: NetworkService,
    pub app_version: String,
    listening: AtomicU16,
    serve_cancel: Mutex<Option<CancellationToken>>,
    pairing: Mutex<Option<Pairing>>,
    requests: Mutex<Vec<PairRequest>>,
    devices: Mutex<Vec<PhoneDevice>>,
    pub(crate) clients: Mutex<HashMap<u64, ClientHandle>>,
    next_client: AtomicU64,
}

#[derive(Clone)]
pub struct PhoneService {
    inner: Arc<PhoneInner>,
}

impl std::ops::Deref for PhoneService {
    type Target = PhoneInner;
    fn deref(&self) -> &PhoneInner {
        &self.inner
    }
}

fn hash_token(token: &str) -> String {
    hex::encode(Sha256::digest(token.trim().as_bytes()))
}

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, bytes)
}

/// "Safari on iPhone", "Chrome on Android phone", … from the browser's
/// user-agent line (what Settings lists the phone as).
pub fn device_name_from_ua(ua: &str) -> String {
    let device = if ua.contains("iPhone") {
        "iPhone"
    } else if ua.contains("iPad") || (ua.contains("Macintosh") && ua.contains("Mobile")) {
        "iPad"
    } else if ua.contains("Android") {
        "Android phone"
    } else if ua.contains("Macintosh") {
        "Mac"
    } else if ua.contains("Windows") {
        "Windows PC"
    } else if ua.contains("Linux") {
        "Linux computer"
    } else {
        "device"
    };
    let browser = if ua.contains("EdgiOS") || ua.contains("Edg/") {
        "Edge"
    } else if ua.contains("FxiOS") || ua.contains("Firefox") {
        "Firefox"
    } else if ua.contains("CriOS") || ua.contains("Chrome") {
        "Chrome"
    } else if ua.contains("Safari") {
        "Safari"
    } else {
        "Browser"
    };
    format!("{} on {}", browser, device)
}

impl PhoneService {
    pub fn new(network: NetworkService, app_version: String) -> Self {
        let devices: Vec<PhoneDevice> = network
            .db
            .get_setting(SETTING_DEVICES)
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Self {
            inner: Arc::new(PhoneInner {
                network,
                app_version,
                listening: AtomicU16::new(0),
                serve_cancel: Mutex::new(None),
                pairing: Mutex::new(None),
                requests: Mutex::new(Vec::new()),
                devices: Mutex::new(devices),
                clients: Mutex::new(HashMap::new()),
                next_client: AtomicU64::new(1),
            }),
        }
    }

    // ------------------------------------------------------------ settings

    pub fn enabled(&self) -> bool {
        self.network.db.get_setting(SETTING_ENABLED).as_deref() == Some("true")
    }

    fn configured_port(&self) -> u16 {
        self.network
            .db
            .get_setting(SETTING_PORT)
            .and_then(|p| p.trim().parse().ok())
            .unwrap_or(DEFAULT_PHONE_PORT)
    }

    /// Turns the phone server on or off (remembered across restarts).
    pub fn set_enabled(&self, on: bool) -> Result<(), String> {
        self.network
            .db
            .set_setting(SETTING_ENABLED, if on { "true" } else { "false" })
            .map_err(|e| e.to_string())?;
        if on {
            self.listen();
        } else {
            self.stop_listening();
            *self.pairing.lock() = None;
        }
        self.emit_changed();
        Ok(())
    }

    // ----------------------------------------------------------- listening

    /// At start-up: listens if the setting is on.
    pub fn start(&self) {
        if self.enabled() {
            self.listen();
        }
    }

    /// Stops everything (quit).
    pub fn stop(&self) {
        self.stop_listening();
    }

    pub fn port(&self) -> u16 {
        self.listening.load(Ordering::SeqCst)
    }

    pub fn is_listening(&self) -> bool {
        self.port() != 0
    }

    /// Binds the web server's port (the last one used first, then the
    /// configured port, then — like the messaging port — nearby free ones)
    /// and serves until stopped.
    fn listen(&self) {
        let mut guard = self.serve_cancel.lock();
        if guard.is_some() {
            return;
        }
        let cancel = CancellationToken::new();
        *guard = Some(cancel.clone());
        drop(guard);
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            let port = this.configured_port();
            let last: Option<u16> = this
                .network
                .db
                .get_setting(SETTING_BOUND)
                .and_then(|p| p.trim().parse().ok())
                .filter(|p| *p != 0);
            let mut tries = 0u32;
            'bind: loop {
                let mut candidates = Vec::new();
                candidates.extend(last);
                candidates.extend(port_candidates(port, tries));
                for candidate in candidates {
                    match TcpListener::bind((crate::testmode::bind_addr(), candidate)).await {
                        Ok(listener) => {
                            if candidate != port {
                                eprintln!("[Phone] port {} is not available on this PC; using {} instead", port, candidate);
                            }
                            let _ = this.network.db.set_setting(SETTING_BOUND, &candidate.to_string());
                            this.serve(listener, cancel.clone()).await;
                            break 'bind;
                        }
                        Err(e) => {
                            if tries == 0 && candidate == port {
                                eprintln!("[Phone] cannot listen on port {} ({}); trying again", port, e);
                            }
                        }
                    }
                }
                tries += 1;
                tokio::select! {
                    _ = cancel.cancelled() => break,
                    _ = tokio::time::sleep(Duration::from_secs(2)) => {}
                }
            }
            this.listening.store(0, Ordering::SeqCst);
            this.emit_changed();
        });
    }

    /// Serves one listener until `cancel` fires (tests hand in their own).
    pub async fn serve(&self, listener: TcpListener, cancel: CancellationToken) {
        if let Ok(addr) = listener.local_addr() {
            self.listening.store(addr.port(), Ordering::SeqCst);
        }
        self.emit_changed();
        loop {
            tokio::select! {
                _ = cancel.cancelled() => break,
                accepted = listener.accept() => match accepted {
                    Ok((stream, addr)) => {
                        let this = self.clone();
                        tokio::spawn(async move { http::handle(this, stream, addr).await });
                    }
                    Err(e) => {
                        eprintln!("[Phone] accept error: {}", e);
                        tokio::time::sleep(Duration::from_millis(100)).await;
                    }
                }
            }
        }
        self.listening.store(0, Ordering::SeqCst);
    }

    fn stop_listening(&self) {
        if let Some(c) = self.serve_cancel.lock().take() {
            c.cancel();
        }
        for c in self.clients.lock().values() {
            c.cancel.cancel();
        }
        self.listening.store(0, Ordering::SeqCst);
    }

    /// `http://<ip>:<port>` for every office-network adapter (or loopback for
    /// a test copy bound there).
    pub fn urls(&self) -> Vec<String> {
        let port = self.port();
        if port == 0 {
            return Vec::new();
        }
        let bind = crate::testmode::bind_addr();
        if bind.is_loopback() {
            return vec![format!("http://127.0.0.1:{}", port)];
        }
        let mut ips: Vec<String> = crate::discovery::lan_adapters()
            .into_iter()
            .map(|(ip, _)| ip.to_string())
            .collect();
        if ips.is_empty() {
            ips = crate::discovery::local_ipv4_addresses();
        }
        if ips.is_empty() {
            ips.push("127.0.0.1".to_string());
        }
        ips.into_iter().map(|ip| format!("http://{}:{}", ip, port)).collect()
    }

    pub fn status(&self) -> PhoneStatus {
        self.forget_old_requests();
        let connected: Vec<String> = self.clients.lock().values().map(|c| c.device_id.clone()).collect();
        PhoneStatus {
            enabled: self.enabled(),
            listening: self.is_listening(),
            port: self.port(),
            urls: self.urls(),
            pairing: self.pairing_info(),
            requests: self
                .requests
                .lock()
                .iter()
                .filter(|r| matches!(r.state, PairState::Waiting))
                .map(|r| PairRequestInfo { id: r.id.clone(), name: r.name.clone(), ip: r.ip.clone() })
                .collect(),
            devices: self
                .devices
                .lock()
                .iter()
                .map(|d| PhoneDeviceInfo {
                    id: d.id.clone(),
                    name: d.name.clone(),
                    created_at: d.created_at,
                    last_seen: d.last_seen,
                    connected: connected.contains(&d.id),
                })
                .collect(),
            connected: connected.len(),
        }
    }

    pub(crate) fn emit_changed(&self) {
        self.network.events.emit_json("lanx://phone-changed", ());
    }

    // ------------------------------------------------------------- pairing

    /// A fresh 8-digit code, good for ten minutes (shown as a QR code too).
    pub fn start_pairing(&self) -> PairingInfo {
        let code = format!("{:08}", OsRng.next_u32() % 100_000_000);
        let expires_at = now_secs() + CODE_SECS;
        *self.pairing.lock() = Some(Pairing { code: code.clone(), expires_at, wrong: 0 });
        self.emit_changed();
        PairingInfo { code, expires_at }
    }

    pub fn cancel_pairing(&self) {
        *self.pairing.lock() = None;
        self.emit_changed();
    }

    pub fn pairing_info(&self) -> Option<PairingInfo> {
        let mut guard = self.pairing.lock();
        if guard.as_ref().is_some_and(|p| p.expires_at <= now_secs()) {
            *guard = None;
        }
        guard.as_ref().map(|p| PairingInfo { code: p.code.clone(), expires_at: p.expires_at })
    }

    /// A phone typed (or scanned) a code. Right code: a request the PC's user
    /// must allow; the request id is returned for polling. Errors: "no-code"
    /// (nothing to pair with right now), "wrong", "busy".
    pub fn claim(&self, code: &str, name: &str, ip: &str) -> Result<String, &'static str> {
        let digits: String = code.chars().filter(|c| c.is_ascii_digit()).collect();
        {
            let mut guard = self.pairing.lock();
            let Some(p) = guard.as_mut() else { return Err("no-code") };
            if p.expires_at <= now_secs() {
                *guard = None;
                return Err("no-code");
            }
            if digits.len() != 8 || digits != p.code {
                p.wrong += 1;
                if p.wrong >= MAX_WRONG {
                    *guard = None;
                }
                return Err("wrong");
            }
        }
        self.forget_old_requests();
        let id = uuid::Uuid::new_v4().to_string();
        {
            let mut reqs = self.requests.lock();
            if reqs.iter().filter(|r| matches!(r.state, PairState::Waiting)).count() >= MAX_REQUESTS {
                return Err("busy");
            }
            reqs.push(PairRequest {
                id: id.clone(),
                name: name.to_string(),
                ip: ip.to_string(),
                at: Instant::now(),
                state: PairState::Waiting,
            });
        }
        self.network.events.emit_json(
            "lanx://phone-pair",
            PairRequestInfo { id: id.clone(), name: name.to_string(), ip: ip.to_string() },
        );
        self.emit_changed();
        Ok(id)
    }

    /// The PC's user allowed (or refused) a waiting phone.
    pub fn answer(&self, request_id: &str, allow: bool) -> Result<(), String> {
        let mut reqs = self.requests.lock();
        let Some(r) = reqs.iter_mut().find(|r| r.id == request_id) else {
            return Err("That phone is no longer waiting.".to_string());
        };
        if !matches!(r.state, PairState::Waiting) {
            return Err("That phone was already answered.".to_string());
        }
        if allow {
            let token = random_token();
            let now = now_secs();
            let device = PhoneDevice {
                id: uuid::Uuid::new_v4().to_string(),
                name: r.name.clone(),
                token_hash: hash_token(&token),
                created_at: now,
                last_seen: now,
            };
            self.devices.lock().push(device);
            r.state = PairState::Allowed(token);
        } else {
            r.state = PairState::Denied;
        }
        drop(reqs);
        self.save_devices();
        self.emit_changed();
        Ok(())
    }

    /// The phone asks whether it was allowed. The token is handed out once.
    pub fn poll(&self, request_id: &str) -> PollResult {
        self.forget_old_requests();
        let mut reqs = self.requests.lock();
        let Some(r) = reqs.iter_mut().find(|r| r.id == request_id) else {
            return PollResult { state: "expired", token: None };
        };
        match r.state.clone() {
            PairState::Waiting => PollResult { state: "waiting", token: None },
            PairState::Denied => PollResult { state: "denied", token: None },
            PairState::Allowed(token) => {
                let id = r.id.clone();
                reqs.retain(|q| q.id != id);
                PollResult { state: "allowed", token: Some(token) }
            }
        }
    }

    fn forget_old_requests(&self) {
        let mut reqs = self.requests.lock();
        let before = reqs.len();
        reqs.retain(|r| r.at.elapsed() < Duration::from_secs(REQUEST_SECS));
        if reqs.len() != before {
            drop(reqs);
            self.emit_changed();
        }
    }

    // ------------------------------------------------------------- devices

    /// The phone behind a token (and a note that it was seen just now).
    pub fn device_for_token(&self, token: &str) -> Option<PhoneDevice> {
        if token.trim().is_empty() {
            return None;
        }
        let h = hash_token(token);
        let now = now_secs();
        let mut save = false;
        let found = {
            let mut devices = self.devices.lock();
            let d = devices.iter_mut().find(|d| !d.token_hash.is_empty() && d.token_hash == h)?;
            if now - d.last_seen > 60 {
                d.last_seen = now;
                save = true;
            }
            d.clone()
        };
        if save {
            self.save_devices();
        }
        Some(found)
    }

    /// Removes a phone: its token stops working and its connections close.
    pub fn forget(&self, device_id: &str) -> Result<(), String> {
        {
            let mut devices = self.devices.lock();
            let before = devices.len();
            devices.retain(|d| d.id != device_id);
            if devices.len() == before {
                return Err("That phone is not in the list.".to_string());
            }
        }
        self.save_devices();
        for c in self.clients.lock().values() {
            if c.device_id == device_id {
                c.cancel.cancel();
            }
        }
        self.emit_changed();
        Ok(())
    }

    fn save_devices(&self) {
        let json = serde_json::to_string(&*self.devices.lock()).unwrap_or_else(|_| "[]".to_string());
        let _ = self.network.db.set_setting(SETTING_DEVICES, &json);
    }

    // ------------------------------------------------------------- clients

    pub(crate) fn register_client(&self, device_id: &str, tx: UnboundedSender<String>) -> (u64, CancellationToken) {
        let id = self.next_client.fetch_add(1, Ordering::SeqCst);
        let cancel = CancellationToken::new();
        self.clients.lock().insert(
            id,
            ClientHandle { device_id: device_id.to_string(), tx, cancel: cancel.clone() },
        );
        self.emit_changed();
        (id, cancel)
    }

    pub(crate) fn unregister_client(&self, id: u64) {
        self.clients.lock().remove(&id);
        self.emit_changed();
    }

    /// Tells every connected phone something (a JSON line).
    pub(crate) fn broadcast(&self, json: &str) {
        for c in self.clients.lock().values() {
            let _ = c.tx.send(json.to_string());
        }
    }

    pub fn connected_count(&self) -> usize {
        self.clients.lock().len()
    }
}
