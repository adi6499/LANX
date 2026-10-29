//! LANX 3.2: an alert on the phone while its LANX page is closed (web push).
//!
//! A phone's browser can wake its LANX page for a short note even when the
//! page is closed: the browser gives the page a "subscription" (an address at
//! the phone maker's push service plus two keys), the page hands it to this
//! PC, and when a message arrives for a phone that has no live connection,
//! this PC encrypts a small note for that phone and posts it to the address.
//! The push service only ever sees ciphertext. Posting needs the internet;
//! when the PC has none, the note is quietly dropped (the phone catches up
//! as soon as its page opens).
//!
//! Written out here (the encryption of RFC 8291 and the signed VAPID token
//! of RFC 8292) because the usual crate needs OpenSSL, which does not build
//! on this PC.

use super::PhoneService;
use crate::storage::models::{Conversation, Message};
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes128Gcm, Nonce};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use hkdf::Hkdf;
use p256::ecdsa::signature::Signer;
use p256::ecdsa::{Signature, SigningKey, VerifyingKey};
use p256::elliptic_curve::sec1::ToEncodedPoint;
use p256::{PublicKey, SecretKey};
use rand::RngCore;
use rand::rngs::OsRng;
use rustls_pki_types::ServerName;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::Sha256;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio_rustls::TlsConnector;

const SETTING_VAPID: &str = "phone_vapid";
const SETTING_PUSH: &str = "phone_push";
/// The push service keeps an undelivered note this long (seconds).
const TTL_SECS: u32 = 300;
/// At most one push per phone this often; later ones in the window are dropped.
pub const MIN_GAP: Duration = Duration::from_secs(5);
/// A phone whose pushes fail is mentioned in the log this often at most.
const ERROR_GAP: Duration = Duration::from_secs(10 * 60);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const REPLY_TIMEOUT: Duration = Duration::from_secs(15);
/// The longest note a push shows.
const BODY_CHARS: usize = 120;
/// RFC 8188 record size: one record carries the whole note.
const RECORD_SIZE: u32 = 4096;
/// Who to contact about this push sender (part of the signed token).
const CONTACT: &str = "https://lanx-website.vercel.app";

// ------------------------------------------------------------ subscriptions

/// What the phone's browser hands out (`PushSubscription.toJSON()`): the
/// address to post to and the keys the note is encrypted for.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Subscription {
    pub endpoint: String,
    pub keys: SubscriptionKeys,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct SubscriptionKeys {
    /// The phone's P-256 public key (65 bytes, base64url).
    pub p256dh: String,
    /// The phone's 16-byte secret (base64url).
    pub auth: String,
}

/// base64url, with or without padding (browsers differ), standard alphabet too.
pub fn b64_decode(s: &str) -> Option<Vec<u8>> {
    let cleaned: String = s.trim().trim_end_matches('=').chars().map(|c| match c {
        '+' => '-',
        '/' => '_',
        c => c,
    }).collect();
    URL_SAFE_NO_PAD.decode(cleaned).ok()
}

impl Subscription {
    /// The browser's JSON, checked: an https address and keys of the right size.
    pub fn parse(v: &Value) -> Result<Subscription, &'static str> {
        let sub: Subscription = serde_json::from_value(v.clone()).map_err(|_| "bad subscription")?;
        if !sub.endpoint.starts_with("https://") || sub.endpoint.len() > 2048 {
            return Err("bad endpoint");
        }
        sub.ua_public()?;
        sub.auth()?;
        Ok(sub)
    }

    fn ua_public(&self) -> Result<PublicKey, &'static str> {
        let bytes = b64_decode(&self.keys.p256dh).ok_or("bad p256dh key")?;
        if bytes.len() != 65 {
            return Err("bad p256dh key");
        }
        PublicKey::from_sec1_bytes(&bytes).map_err(|_| "bad p256dh key")
    }

    fn auth(&self) -> Result<Vec<u8>, &'static str> {
        let bytes = b64_decode(&self.keys.auth).ok_or("bad auth key")?;
        if bytes.len() < 16 {
            return Err("bad auth key");
        }
        Ok(bytes)
    }
}

// -------------------------------------------------------------------- VAPID

/// This PC's push identity: a P-256 key pair made once and kept in settings.
/// Its public half goes to the phone's browser when it subscribes; every
/// push carries a token signed with the private half.
pub struct Vapid {
    secret: SecretKey,
    public: Vec<u8>,
}

#[derive(Serialize, Deserialize)]
struct VapidStored {
    public: String,
    private: String,
}

impl Vapid {
    pub fn load_or_create(db: &crate::storage::Database) -> Vapid {
        let stored = db
            .get_setting(SETTING_VAPID)
            .and_then(|s| serde_json::from_str::<VapidStored>(&s).ok())
            .and_then(|s| b64_decode(&s.private))
            .and_then(|bytes| SecretKey::from_slice(&bytes).ok());
        if let Some(secret) = stored {
            return Vapid::from_secret(secret);
        }
        let v = Vapid::from_secret(SecretKey::random(&mut OsRng));
        let stored = VapidStored { public: v.public_key_b64(), private: URL_SAFE_NO_PAD.encode(v.secret.to_bytes()) };
        let _ = db.set_setting(SETTING_VAPID, &serde_json::to_string(&stored).unwrap_or_default());
        v
    }

    fn from_secret(secret: SecretKey) -> Vapid {
        let public = secret.public_key().to_encoded_point(false).as_bytes().to_vec();
        Vapid { secret, public }
    }

    /// The uncompressed public key (65 bytes) as base64url — what the page
    /// passes to `pushManager.subscribe` as `applicationServerKey`.
    pub fn public_key_b64(&self) -> String {
        URL_SAFE_NO_PAD.encode(&self.public)
    }

    pub fn verifying_key(&self) -> VerifyingKey {
        VerifyingKey::from(&SigningKey::from(&self.secret))
    }

    /// A signed token for one push service (`aud` is its origin), good for
    /// twelve hours.
    pub fn jwt(&self, aud: &str) -> String {
        let header = URL_SAFE_NO_PAD.encode(br#"{"typ":"JWT","alg":"ES256"}"#);
        let exp = crate::networking::now_secs() + 12 * 3600;
        let claims = URL_SAFE_NO_PAD.encode(json!({ "aud": aud, "exp": exp, "sub": CONTACT }).to_string());
        let input = format!("{}.{}", header, claims);
        let sig: Signature = SigningKey::from(&self.secret).sign(input.as_bytes());
        format!("{}.{}", input, URL_SAFE_NO_PAD.encode(sig.to_bytes()))
    }

    /// The `Authorization` header for a push to `endpoint`.
    pub fn authorization(&self, endpoint: &str) -> Option<String> {
        let (host, port, _) = split_url(endpoint)?;
        let aud = if port == 443 { format!("https://{}", host) } else { format!("https://{}:{}", host, port) };
        Some(format!("vapid t={}, k={}", self.jwt(&aud), self.public_key_b64()))
    }
}

/// `https://host[:port]/path` → (host, port, path-and-query).
pub fn split_url(url: &str) -> Option<(String, u16, String)> {
    let rest = url.strip_prefix("https://")?;
    let (authority, path) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, "/"),
    };
    let (host, port) = match authority.rsplit_once(':') {
        Some((h, p)) if p.chars().all(|c| c.is_ascii_digit()) && !p.is_empty() => (h, p.parse().ok()?),
        _ => (authority, 443),
    };
    if host.is_empty() || host.contains('@') {
        return None;
    }
    Some((host.to_string(), port, path.to_string()))
}

// --------------------------------------------------------------- encryption

/// Encrypts `plaintext` for the phone behind `sub` (RFC 8291, `aes128gcm`).
pub fn encrypt(sub: &Subscription, plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let ua_public = sub.ua_public()?;
    let auth = sub.auth()?;
    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    encrypt_with(&ua_public, &auth, plaintext, &SecretKey::random(&mut OsRng), &salt)
}

/// The encryption with every random input given (so a test can check it
/// against the RFC's worked example).
pub fn encrypt_with(ua_public: &PublicKey, auth: &[u8], plaintext: &[u8], as_secret: &SecretKey, salt: &[u8; 16]) -> Result<Vec<u8>, String> {
    if plaintext.len() + 1 > RECORD_SIZE as usize - 16 {
        return Err("note too long".to_string());
    }
    let as_public = as_secret.public_key().to_encoded_point(false);
    let ua_bytes = ua_public.to_encoded_point(false);
    // Both sides derive the same secret from their own private and the
    // other's public key; the phone's auth secret and both public keys go
    // into the key derivation so a note fits one phone only.
    let shared = p256::ecdh::diffie_hellman(as_secret.to_nonzero_scalar(), ua_public.as_affine());
    let mut info = b"WebPush: info\0".to_vec();
    info.extend_from_slice(ua_bytes.as_bytes());
    info.extend_from_slice(as_public.as_bytes());
    let mut ikm = [0u8; 32];
    Hkdf::<Sha256>::new(Some(auth), shared.raw_secret_bytes().as_slice())
        .expand(&info, &mut ikm)
        .map_err(|_| "key derivation failed".to_string())?;
    let prk = Hkdf::<Sha256>::new(Some(salt), &ikm);
    let mut cek = [0u8; 16];
    let mut nonce = [0u8; 12];
    prk.expand(b"Content-Encoding: aes128gcm\0", &mut cek).map_err(|_| "key derivation failed".to_string())?;
    prk.expand(b"Content-Encoding: nonce\0", &mut nonce).map_err(|_| "key derivation failed".to_string())?;
    // One record: the note, then the "last record" marker.
    let mut record = plaintext.to_vec();
    record.push(2);
    let cipher = Aes128Gcm::new_from_slice(&cek).map_err(|_| "bad key".to_string())?;
    let sealed = cipher.encrypt(Nonce::from_slice(&nonce), record.as_slice()).map_err(|_| "encryption failed".to_string())?;
    // The header the phone reads first: salt, record size, our public key.
    let mut out = Vec::with_capacity(21 + as_public.as_bytes().len() + sealed.len());
    out.extend_from_slice(salt);
    out.extend_from_slice(&RECORD_SIZE.to_be_bytes());
    out.push(as_public.as_bytes().len() as u8);
    out.extend_from_slice(as_public.as_bytes());
    out.extend_from_slice(&sealed);
    Ok(out)
}

// ------------------------------------------------------------------ sending

static CLIENT_CONFIG: LazyLock<Arc<rustls::ClientConfig>> = LazyLock::new(|| {
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    Arc::new(rustls::ClientConfig::builder().with_root_certificates(roots).with_no_client_auth())
});

/// Posts one note to the phone's push service; the HTTP status it answered.
/// A short hand-written HTTPS client: the push services (Google, Apple,
/// Mozilla) all speak plain HTTP/1.1.
pub async fn send(vapid: &Vapid, sub: &Subscription, note: &[u8]) -> Result<u16, String> {
    let (host, port, path) = split_url(&sub.endpoint).ok_or("bad endpoint")?;
    let body = encrypt(sub, note)?;
    let auth = vapid.authorization(&sub.endpoint).ok_or("bad endpoint")?;
    let tcp = tokio::time::timeout(CONNECT_TIMEOUT, TcpStream::connect((host.as_str(), port)))
        .await
        .map_err(|_| "connect timeout".to_string())?
        .map_err(|e| format!("connect: {}", e))?;
    let name = ServerName::try_from(host.clone()).map_err(|_| "bad host".to_string())?;
    let connector = TlsConnector::from(CLIENT_CONFIG.clone());
    let mut tls = tokio::time::timeout(CONNECT_TIMEOUT, connector.connect(name, tcp))
        .await
        .map_err(|_| "tls timeout".to_string())?
        .map_err(|e| format!("tls: {}", e))?;
    let host_header = if port == 443 { host.clone() } else { format!("{}:{}", host, port) };
    let head = format!(
        "POST {} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\nContent-Type: application/octet-stream\r\nContent-Encoding: aes128gcm\r\nContent-Length: {}\r\nTTL: {}\r\nUrgency: normal\r\nAuthorization: {}\r\n\r\n",
        path,
        host_header,
        body.len(),
        TTL_SECS,
        auth
    );
    let exchange = async {
        tls.write_all(head.as_bytes()).await?;
        tls.write_all(&body).await?;
        tls.flush().await?;
        let mut raw = Vec::new();
        let mut tmp = [0u8; 4096];
        loop {
            if raw.windows(4).any(|w| w == b"\r\n\r\n") || raw.len() > 64 * 1024 {
                break;
            }
            match tls.read(&mut tmp).await {
                Ok(0) => break,
                Ok(n) => raw.extend_from_slice(&tmp[..n]),
                // A close without TLS goodbye after the answer is fine.
                Err(_) if !raw.is_empty() => break,
                Err(e) => return Err(e),
            }
        }
        let _ = tls.shutdown().await;
        Ok::<Vec<u8>, std::io::Error>(raw)
    };
    let raw = tokio::time::timeout(REPLY_TIMEOUT, exchange)
        .await
        .map_err(|_| "no answer in time".to_string())?
        .map_err(|e| format!("send: {}", e))?;
    let line = String::from_utf8_lossy(&raw);
    line.lines()
        .next()
        .and_then(|l| l.split(' ').nth(1))
        .and_then(|s| s.parse::<u16>().ok())
        .ok_or_else(|| "no HTTP answer".to_string())
}

// -------------------------------------------------------------------- notes

/// What a push carries (JSON `{title, body, conversation_id}`).
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Notice {
    pub title: String,
    pub body: String,
    pub conversation_id: Option<String>,
}

impl Notice {
    pub fn json(&self) -> Vec<u8> {
        serde_json::to_vec(self).unwrap_or_default()
    }
}

/// One line, at most `BODY_CHARS` characters.
fn shorten(s: &str) -> String {
    let clean: String = s.trim().chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    let mut chars = clean.chars();
    let head: String = chars.by_ref().take(BODY_CHARS).collect();
    if chars.next().is_some() { format!("{}…", head.trim_end()) } else { head }
}

/// The note a desktop event turns into, if it deserves a push: a message
/// from a colleague (not from a muted chat, nothing from a hidden chat while
/// hidden chats are locked) or an emergency alert.
pub(crate) fn notice_for(svc: &PhoneService, name: &str, payload: &Value) -> Option<Notice> {
    match name {
        "lanx://message-received" => {
            let m: Message = serde_json::from_value(payload["message"].clone()).ok()?;
            if m.is_outgoing || !matches!(m.message_type.as_str(), "text" | "file" | "sticker" | "card") {
                return None;
            }
            let db = &svc.network.db;
            if db.is_conversation_hidden(&m.conversation_id) && !svc.network.privacy.hidden_unlocked() {
                return None;
            }
            let conv: Option<Conversation> = serde_json::from_value(payload["conversation"].clone())
                .ok()
                .or_else(|| db.get_conversation(&m.conversation_id).ok().flatten());
            if conv.as_ref().is_some_and(|c| c.is_muted(crate::networking::now_secs())) {
                return None;
            }
            if svc.network.privacy.is_locked() {
                // A locked LANX shows nothing personal, on the phone either.
                return Some(Notice { title: "LANX".to_string(), body: "New message".to_string(), conversation_id: Some(m.conversation_id.clone()) });
            }
            let title = match &conv {
                Some(c) if c.kind == "group" => {
                    let sender = db.get_peer(&m.sender_id).ok().flatten().map(|p| p.display_name).filter(|n| !n.trim().is_empty());
                    match sender {
                        Some(s) => format!("{} · {}", s, c.peer_name),
                        None => c.peer_name.clone(),
                    }
                }
                Some(c) => c.peer_name.clone(),
                None => "LANX".to_string(),
            };
            // A text as written (the chat list's preview cuts at 60); anything
            // else as the chat list shows it ("📷 photo.jpg", "🎤 Voice note · 0:12").
            let body = if m.message_type == "text" && !m.deleted && m.ttl_secs.is_none() {
                shorten(&m.content)
            } else {
                shorten(&crate::storage::message_preview(&m))
            };
            Some(Notice { title, body, conversation_id: Some(m.conversation_id.clone()) })
        }
        "lanx://alert" => {
            // Only an alert raised by a colleague, still open and not yet answered.
            if payload["mine"].as_bool().unwrap_or(false) || !payload["cleared_at"].is_null() || !payload["my_ack"].is_null() {
                return None;
            }
            let text = payload["text"].as_str().unwrap_or("").trim();
            let from = payload["from_name"].as_str().unwrap_or("").trim();
            let body = if from.is_empty() { text.to_string() } else { format!("{}: {}", from, text) };
            Some(Notice { title: "🚑 Emergency".to_string(), body: shorten(&body), conversation_id: None })
        }
        _ => None,
    }
}

/// Which phones get a push: those subscribed, with no live connection, and
/// not pushed to in the last `MIN_GAP` (`last` is updated for the chosen).
pub fn pick_targets(
    subs: &HashMap<String, Subscription>,
    connected: &HashSet<String>,
    last: &mut HashMap<String, Instant>,
    now: Instant,
) -> Vec<(String, Subscription)> {
    let mut out: Vec<(String, Subscription)> = subs
        .iter()
        .filter(|(id, _)| !connected.contains(*id))
        .filter(|(id, _)| !last.get(*id).is_some_and(|t| now.duration_since(*t) < MIN_GAP))
        .map(|(id, s)| (id.clone(), s.clone()))
        .collect();
    out.sort_by(|a, b| a.0.cmp(&b.0));
    for (id, _) in &out {
        last.insert(id.clone(), now);
    }
    out
}

/// Per phone: when it was last pushed to, and when its failure was last logged.
#[derive(Default)]
pub struct Throttle {
    pub last: HashMap<String, Instant>,
    errors: HashMap<String, Instant>,
}

impl PhoneService {
    pub(crate) fn vapid(&self) -> Arc<Vapid> {
        let mut guard = self.vapid.lock();
        if let Some(v) = guard.as_ref() {
            return v.clone();
        }
        let v = Arc::new(Vapid::load_or_create(&self.network.db));
        *guard = Some(v.clone());
        v
    }

    /// Loads the subscriptions kept in settings (at start-up).
    pub(crate) fn load_push(db: &crate::storage::Database) -> HashMap<String, Subscription> {
        db.get_setting(SETTING_PUSH).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    }

    fn save_push(&self) {
        let json = serde_json::to_string(&*self.push.lock()).unwrap_or_else(|_| "{}".to_string());
        let _ = self.network.db.set_setting(SETTING_PUSH, &json);
    }

    /// The phone's browser subscribed: remembered for that phone.
    pub fn push_subscribe(&self, device_id: &str, sub: Subscription) {
        self.push.lock().insert(device_id.to_string(), sub);
        self.save_push();
        self.emit_changed();
    }

    /// The phone unsubscribed (or was removed): no more pushes to it.
    pub fn push_unsubscribe(&self, device_id: &str) -> bool {
        let removed = self.push.lock().remove(device_id).is_some();
        if removed {
            self.push_state.lock().last.remove(device_id);
            self.save_push();
            self.emit_changed();
        }
        removed
    }

    /// How many phones get pushes.
    pub fn push_count(&self) -> usize {
        self.push.lock().len()
    }

    /// The subscription kept for a phone, if any.
    pub fn push_subscription(&self, device_id: &str) -> Option<Subscription> {
        self.push.lock().get(device_id).cloned()
    }

    /// Sends `notice` to every subscribed phone without a live connection
    /// (in the background; nothing waits for the push service).
    pub(crate) fn push_notice(&self, notice: Notice) {
        let targets = {
            let subs = self.push.lock();
            if subs.is_empty() {
                return;
            }
            let connected: HashSet<String> = self.clients.lock().values().map(|c| c.device_id.clone()).collect();
            let mut state = self.push_state.lock();
            pick_targets(&subs, &connected, &mut state.last, Instant::now())
        };
        if targets.is_empty() {
            return;
        }
        let vapid = self.vapid();
        let note = notice.json();
        for (device_id, sub) in targets {
            let this = self.clone();
            let vapid = vapid.clone();
            let note = note.clone();
            tokio::spawn(async move {
                match send(&vapid, &sub, &note).await {
                    Ok(status) if (200..300).contains(&status) => {}
                    Ok(404) | Ok(410) => {
                        // The browser dropped the subscription: forget it too.
                        this.push_unsubscribe(&device_id);
                    }
                    Ok(status) => this.push_failed(&device_id, &format!("the push service answered {}", status)),
                    Err(e) => this.push_failed(&device_id, &e),
                }
            });
        }
    }

    fn push_failed(&self, device_id: &str, why: &str) {
        let mut state = self.push_state.lock();
        let now = Instant::now();
        if state.errors.get(device_id).is_some_and(|t| now.duration_since(*t) < ERROR_GAP) {
            return;
        }
        state.errors.insert(device_id.to_string(), now);
        eprintln!("[Phone] push to {} failed: {}", device_id, why);
    }

    /// Watches the desktop's events and pushes the ones that deserve it
    /// (only while some phone is subscribed, so an idle LANX pays nothing).
    pub(crate) fn start_push_sender(&self) {
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                if this.push.lock().is_empty() || !this.enabled() {
                    tokio::time::sleep(Duration::from_secs(3)).await;
                    continue;
                }
                let Some(mut events) = this.network.events.subscribe() else { return };
                loop {
                    match events.recv().await {
                        Ok(ev) => {
                            if this.push.lock().is_empty() || !this.enabled() {
                                break;
                            }
                            if let Some(n) = notice_for(&this, &ev.0, &ev.1) {
                                this.push_notice(n);
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(_) => return,
                    }
                }
            }
        });
    }
}
