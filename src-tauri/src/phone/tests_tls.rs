//! Tests for LANX 3.2 on the phone: the secure (HTTPS) page and its
//! certificate, voice notes and intercom from the phone, and the push
//! keys, subscriptions and encryption. (The small helpers are copied from
//! tests.rs so the two files stay independent.)

use super::push::{self, Subscription, SubscriptionKeys, b64_decode, pick_targets};
use super::tls::{fingerprint_of, wanted_sans};
use super::{PhoneService, http};
use crate::events::Events;
use crate::networking::NetworkService;
use crate::security::DeviceIdentity;
use crate::storage::Database;
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use p256::ecdsa::signature::Verifier;
use rustls_pki_types::{CertificateDer, ServerName};
use serde_json::{Value, json};
use sha2::Sha256;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_rustls::TlsConnector;
use tokio_util::sync::CancellationToken;

// ---------------------------------------------------------------- engines

fn new_service(name: &str) -> (NetworkService, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let db = Arc::new(Database::open(dir.path()).unwrap());
    let identity = DeviceIdentity::load_or_create(&db.conn.lock()).unwrap();
    let mut s = db.get_settings().unwrap();
    s.display_name = name.to_string();
    s.default_download_dir = dir.path().join("Downloads").to_string_lossy().to_string();
    s.onboarding_completed = true;
    s.tcp_messaging_port = 9;
    db.save_settings(&s).unwrap();
    (NetworkService::new(db, identity, Events::new(None)), dir)
}

struct Node {
    svc: NetworkService,
    port: u16,
    _dir: tempfile::TempDir,
}

async fn node(name: &str) -> Node {
    let (svc, dir) = new_service(name);
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let s = svc.clone();
    tokio::spawn(async move { s.serve(listener).await });
    assert!(wait_for(|| svc.is_listening(), 5).await);
    Node { svc, port, _dir: dir }
}

async fn wait_for<F: Fn() -> bool>(f: F, secs: u64) -> bool {
    let deadline = Instant::now() + Duration::from_secs(secs);
    while Instant::now() < deadline {
        if f() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    f()
}

/// A connects to B by IP and returns A's conversation id.
async fn link(a: &Node, b: &Node) -> String {
    let peer = a.svc.connect_manual_peer("127.0.0.1", b.port, None).await.unwrap();
    a.svc.db.get_or_create_conversation(&peer.id).unwrap().id
}

/// The plain phone server of `svc` on a loopback port.
async fn phone_server(svc: &NetworkService) -> (PhoneService, u16, CancellationToken) {
    let phone = PhoneService::new(svc.clone(), "3.2.0-test".to_string());
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let cancel = CancellationToken::new();
    let p = phone.clone();
    let c = cancel.clone();
    tokio::spawn(async move { p.serve(listener, c).await });
    assert!(wait_for(|| phone.is_listening(), 5).await);
    (phone, port, cancel)
}

/// The secure phone server of an existing `phone` on a loopback port.
async fn https_server(phone: &PhoneService, cancel: &CancellationToken) -> u16 {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let p = phone.clone();
    let c = cancel.clone();
    tokio::spawn(async move { p.serve_tls(listener, c).await });
    assert!(wait_for(|| phone.https_port() != 0, 10).await, "the secure server starts");
    port
}

/// A paired phone: (token, cookie).
fn pair(phone: &PhoneService) -> (String, String) {
    let info = phone.start_pairing();
    let request = phone.claim(&info.code, "Safari on iPhone", "127.0.0.1").unwrap();
    phone.answer(&request, true).unwrap();
    let token = phone.poll(&request).token.unwrap();
    let cookie = format!("lanx_phone={}", token);
    (token, cookie)
}

// ------------------------------------------------------------- phone side

struct Reply {
    status: u16,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Reply {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(n, _)| n.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or(Value::Null)
    }
}

/// One request over any connection; the answer is parsed from whatever
/// arrived before the server closed (a close without the TLS goodbye, or a
/// reset after a refused upload, still leaves the answer readable).
async fn exchange<S: AsyncRead + AsyncWrite + Unpin>(s: &mut S, method: &str, path: &str, headers: &[(&str, &str)], body: &[u8]) -> Reply {
    let mut req = format!("{} {} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\nUser-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Version/17.5 Mobile/15E148 Safari/604.1\r\n", method, path);
    for (n, v) in headers {
        req.push_str(&format!("{}: {}\r\n", n, v));
    }
    if !body.is_empty() || method == "POST" {
        req.push_str(&format!("Content-Length: {}\r\n", body.len()));
    }
    req.push_str("\r\n");
    s.write_all(req.as_bytes()).await.unwrap();
    let _ = s.write_all(body).await;
    let _ = s.flush().await;
    let mut raw = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        let mut tmp = [0u8; 65536];
        match tokio::time::timeout(deadline.saturating_duration_since(Instant::now()), s.read(&mut tmp)).await {
            Ok(Ok(0)) | Ok(Err(_)) | Err(_) => break,
            Ok(Ok(n)) => raw.extend_from_slice(&tmp[..n]),
        }
    }
    let head_end = raw.windows(4).position(|w| w == b"\r\n\r\n").expect("response head") + 4;
    let head = String::from_utf8_lossy(&raw[..head_end]).to_string();
    let mut lines = head.lines();
    let status: u16 = lines.next().unwrap().split(' ').nth(1).unwrap().parse().unwrap();
    let headers = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(n, v)| (n.trim().to_string(), v.trim().to_string()))
        .collect();
    Reply { status, headers, body: raw[head_end..].to_vec() }
}

async fn http(port: u16, method: &str, path: &str, headers: &[(&str, &str)], body: &[u8]) -> Reply {
    let mut s = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    exchange(&mut s, method, path, headers, body).await
}

/// A POST that announces a body of `len` bytes and then sends nothing (the
/// server's answer to the size alone, or to the body never arriving).
async fn http_claiming(port: u16, path: &str, cookie: &str, len: usize) -> Reply {
    let mut s = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    let req = format!("POST {} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\nCookie: {}\r\nContent-Length: {}\r\n\r\n", path, cookie, len);
    s.write_all(req.as_bytes()).await.unwrap();
    let _ = s.shutdown().await;
    let mut raw = Vec::new();
    let _ = tokio::time::timeout(Duration::from_secs(40), s.read_to_end(&mut raw)).await;
    let head_end = raw.windows(4).position(|w| w == b"\r\n\r\n").expect("response head") + 4;
    let head = String::from_utf8_lossy(&raw[..head_end]).to_string();
    let status: u16 = head.lines().next().unwrap().split(' ').nth(1).unwrap().parse().unwrap();
    Reply { status, headers: Vec::new(), body: raw[head_end..].to_vec() }
}

/// One request over TLS, trusting `ca` (none: an empty trust store, like a
/// phone that has not installed the certificate). Err: the handshake failed.
async fn https(port: u16, ca: Option<&[u8]>, method: &str, path: &str, headers: &[(&str, &str)], body: &[u8]) -> Result<Reply, String> {
    let mut roots = rustls::RootCertStore::empty();
    if let Some(der) = ca {
        roots.add(CertificateDer::from(der.to_vec())).map_err(|e| e.to_string())?;
    }
    let config = rustls::ClientConfig::builder().with_root_certificates(roots).with_no_client_auth();
    let connector = TlsConnector::from(Arc::new(config));
    let tcp = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    let name = ServerName::try_from("127.0.0.1").unwrap();
    let mut s = tokio::time::timeout(Duration::from_secs(10), connector.connect(name, tcp))
        .await
        .map_err(|_| "handshake timeout".to_string())?
        .map_err(|e| e.to_string())?;
    Ok(exchange(&mut s, method, path, headers, body).await)
}

// ------------------------------------------------------------------ tests

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_secure_page_needs_this_pcs_certificate() {
    let a = node("Asha").await;
    let (phone, port, cancel) = phone_server(&a.svc).await;
    let tls_port = https_server(&phone, &cancel).await;
    let tls = phone.tls().expect("certificates");
    assert!(tls.server_sans().iter().any(|s| s == "127.0.0.1"), "{:?}", tls.server_sans());
    assert!(tls.server_sans().iter().any(|s| s == "localhost"));
    assert!(tls.server_not_after() > crate::networking::now_secs() + 300 * 86_400);
    assert!(tls.ca_pem().starts_with("-----BEGIN CERTIFICATE-----"));

    // With the authority installed: the page, over TLS, with its policy.
    let page = https(tls_port, Some(tls.ca_der()), "GET", "/", &[], b"").await.expect("handshake with the CA");
    assert_eq!(page.status, 200);
    assert!(page.header("content-type").unwrap().starts_with("text/html"));
    assert!(page.header("content-security-policy").is_some());
    assert!(String::from_utf8_lossy(&page.body).contains("LANX"));
    // Without it: no connection at all.
    let refused = https(tls_port, None, "GET", "/", &[], b"").await;
    assert!(refused.is_err(), "a phone without the certificate is refused");

    // The plain page hands out the authority, and says where the secure page is.
    let crt = http(port, "GET", "/lanx-ca.crt", &[], b"").await;
    assert_eq!(crt.status, 200);
    assert_eq!(crt.header("content-type"), Some("application/x-x509-ca-cert"));
    assert!(crt.header("content-disposition").unwrap().starts_with("attachment; filename=\"LANX-"));
    assert_eq!(crt.body, tls.ca_der());
    assert_eq!(fingerprint_of(&crt.body), phone.cert_fingerprint());
    assert_eq!(phone.cert_fingerprint().len(), 32 * 3 - 1);
    let profile = http(port, "GET", "/lanx-ca.mobileconfig", &[], b"").await;
    assert_eq!(profile.status, 200);
    assert_eq!(profile.header("content-type"), Some("application/x-apple-aspen-config"));
    let text = String::from_utf8_lossy(&profile.body).to_string();
    assert!(text.contains(&base64::engine::general_purpose::STANDARD.encode(tls.ca_der())));
    assert!(text.contains("LANX certificate ("), "{}", text);
    assert!(text.contains("com.apple.security.root"));
    let same_again = http(port, "GET", "/lanx-ca.mobileconfig", &[], b"").await;
    assert_eq!(same_again.body, profile.body, "the profile's identifiers are stable");
    // (A unit test is not bound to loopback, so the addresses are this PC's
    // real ones — the same ones as `urls`, with the secure port.)
    let status = phone.status();
    assert_eq!(status.https_port, tls_port);
    assert!(!status.https_urls.is_empty());
    assert!(status.https_urls.iter().all(|u| u.starts_with("https://") && u.ends_with(&format!(":{}", tls_port))), "{:?}", status.https_urls);
    assert_eq!(status.https_urls.len(), status.urls.len());
    assert_eq!(status.cert_fingerprint, phone.cert_fingerprint());
    let ping = http(port, "GET", "/api/ping", &[], b"").await.json();
    assert_eq!(ping["ok"], true);
    assert_eq!(ping["version"], "3.2.0-test");
    assert_eq!(ping["https_port"], tls_port);
    assert_eq!(ping["https_urls"], json!(status.https_urls));
    assert_eq!(ping["cert_fingerprint"], phone.cert_fingerprint());

    // Pairing over the secure page marks the cookie Secure; over the plain one not.
    let info = phone.start_pairing();
    let claimed = https(tls_port, Some(tls.ca_der()), "POST", "/api/pair", &[("Content-Type", "application/json")], json!({ "code": info.code }).to_string().as_bytes())
        .await
        .unwrap();
    assert_eq!(claimed.status, 202, "{}", String::from_utf8_lossy(&claimed.body));
    let request = claimed.json()["request"].as_str().unwrap().to_string();
    phone.answer(&request, true).unwrap();
    let allowed = https(tls_port, Some(tls.ca_der()), "GET", &format!("/api/pair/{}", request), &[], b"").await.unwrap();
    assert_eq!(allowed.json()["state"], "allowed");
    let cookie = allowed.header("set-cookie").unwrap();
    assert!(cookie.contains("; Secure"), "{}", cookie);
    let token = allowed.json()["token"].as_str().unwrap().to_string();
    let plain = http(port, "POST", "/api/session", &[("Content-Type", "application/json")], json!({ "token": token }).to_string().as_bytes()).await;
    assert_eq!(plain.status, 200);
    assert!(!plain.header("set-cookie").unwrap().contains("Secure"));

    // The same certificates come back on a restart; the server one is kept.
    let again = PhoneService::new(a.svc.clone(), "3.2.0-test".to_string());
    let reloaded = again.tls().unwrap();
    assert_eq!(reloaded.ca_der(), tls.ca_der());
    assert_eq!(reloaded.server_not_after(), tls.server_not_after());
    cancel.cancel();
    assert!(wait_for(|| phone.https_port() == 0, 5).await);
}

#[test]
fn the_server_certificate_names_what_a_phone_might_type() {
    let sans = wanted_sans("Stores-PC", &["192.168.1.20".to_string(), "10.0.0.5".to_string(), "192.168.1.20".to_string(), "nonsense".to_string()]);
    assert_eq!(sans, vec!["127.0.0.1", "localhost", "stores-pc", "192.168.1.20", "10.0.0.5"]);
    assert_eq!(wanted_sans("bad name!", &[]), vec!["127.0.0.1", "localhost"]);
    assert_eq!(super::tls::file_name_for("Stores PC #2"), "LANX-Stores_PC__2");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_voice_note_from_the_phone_reaches_bharat() {
    let a = node("Asha (Accounts)").await;
    let b = node("Bharat (Stores)").await;
    let conv_a = link(&a, &b).await;
    let (phone, port, _cancel) = phone_server(&a.svc).await;
    let (_token, cookie) = pair(&phone);

    assert_eq!(http(port, "POST", &format!("/api/voice?conv={}&ms=1200&ext=webm", conv_a), &[], b"abc").await.status, 401);

    let sound: Vec<u8> = (0..3000u32).map(|i| (i.wrapping_mul(2654435761) >> 13) as u8).collect();
    let up = http(
        port,
        "POST",
        &format!("/api/voice?conv={}&ms=1200&ext=webm", conv_a),
        &[("Cookie", &cookie), ("Content-Type", "audio/webm")],
        &sound,
    )
    .await;
    assert_eq!(up.status, 200, "{}", String::from_utf8_lossy(&up.body));
    let msg = &up.json()["message"];
    assert_eq!(msg["message_type"], "file");
    assert!(msg["content"].as_str().unwrap().starts_with("🎤"), "{}", msg);
    assert_eq!(msg["transfer"]["kind"], "voice");
    assert!(msg["transfer"]["file_name"].as_str().unwrap().ends_with(".webm"));
    let b_db = b.svc.db.clone();
    assert!(
        wait_for(|| b_db.list_transfers(true).unwrap().iter().any(|t| t.kind == "voice" && t.status == "completed"), 20).await,
        "Bharat got the voice note"
    );

    // Too big is refused before it is read (the phone only announces the
    // size here; the server answers without waiting for the recording).
    let big = http_claiming(port, &format!("/api/voice?conv={}&ms=1&ext=webm", conv_a), &cookie, 10 * 1024 * 1024 + 1).await;
    assert_eq!(big.status, 413);
    let fits = http_claiming(port, &format!("/api/voice?conv={}&ms=1&ext=webm", conv_a), &cookie, 10 * 1024 * 1024).await;
    assert_eq!(fits.status, 400, "a recording that fits is waited for, then found cut short");
    assert_eq!(http(port, "POST", "/api/voice?ms=1&ext=webm", &[("Cookie", &cookie)], b"abc").await.status, 400);
    assert_eq!(http(port, "POST", &format!("/api/voice?conv={}&ms=1&ext=webm", conv_a), &[("Cookie", &cookie)], b"").await.status, 400);

    // An intercom message to an online colleague goes out the same way.
    let ic = http(
        port,
        "POST",
        &format!("/api/intercom?conv={}&ms=1500&ext=webm", conv_a),
        &[("Cookie", &cookie), ("Content-Type", "audio/webm")],
        &sound,
    )
    .await;
    assert_eq!(ic.status, 200, "{}", String::from_utf8_lossy(&ic.body));
    assert!(ic.json()["message"]["transfer"]["file_name"].as_str().unwrap().starts_with("Intercom "));
    // Longer than an intercom may be: the engine's own words come back.
    let long = http(port, "POST", &format!("/api/intercom?conv={}&ms=900000&ext=webm", conv_a), &[("Cookie", &cookie)], &sound).await;
    assert_eq!(long.status, 400);
    assert!(long.json()["error"].as_str().unwrap().contains("Intercom"), "{}", long.json());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_phone_subscribes_to_pushes_and_is_forgotten_with_them() {
    let a = node("Asha").await;
    let (phone, port, _cancel) = phone_server(&a.svc).await;
    let (_token, cookie) = pair(&phone);
    let device = phone.status().devices[0].id.clone();

    assert_eq!(http(port, "GET", "/api/push/key", &[], b"").await.status, 401);
    let key = http(port, "GET", "/api/push/key", &[("Cookie", &cookie)], b"").await;
    assert_eq!(key.status, 200);
    let key_b64 = key.json()["key"].as_str().unwrap().to_string();
    let raw = URL_SAFE_NO_PAD.decode(&key_b64).expect("base64url without padding");
    assert_eq!(raw.len(), 65);
    assert_eq!(raw[0], 4, "an uncompressed P-256 point");
    assert_eq!(http(port, "GET", "/api/push/key", &[("Cookie", &cookie)], b"").await.json()["key"], key_b64, "the key is kept");
    assert!(a.svc.db.get_setting("phone_vapid").unwrap().contains(&key_b64));

    // Subscribe: kept in settings for that phone; counted in the status.
    let (_, phone_public, auth) = fake_phone_keys();
    let endpoint = "https://push.example.test/send/abc123";
    let sub = json!({ "endpoint": endpoint, "expirationTime": null, "keys": { "p256dh": phone_public, "auth": auth } });
    let bad = http(port, "POST", "/api/push/subscribe", &[("Cookie", &cookie), ("Content-Type", "application/json")], b"{\"endpoint\":\"http://x\"}").await;
    assert_eq!(bad.status, 400);
    let ok = http(port, "POST", "/api/push/subscribe", &[("Cookie", &cookie), ("Content-Type", "application/json")], sub.to_string().as_bytes()).await;
    assert_eq!(ok.status, 200, "{}", String::from_utf8_lossy(&ok.body));
    assert_eq!(ok.json()["ok"], true);
    assert!(a.svc.db.get_setting("phone_push").unwrap().contains(endpoint));
    assert_eq!(phone.status().push_devices, 1);
    let kept = phone.push_subscription(&device).unwrap();
    assert_eq!(kept.endpoint, endpoint);
    assert_eq!(kept.keys.auth, auth);

    // Remembered across a restart; gone with unsubscribe, and with Remove.
    let again = PhoneService::new(a.svc.clone(), "3.2.0-test".to_string());
    assert_eq!(again.push_count(), 1);
    let off = http(port, "POST", "/api/push/unsubscribe", &[("Cookie", &cookie)], b"").await;
    assert_eq!(off.status, 200);
    assert_eq!(phone.push_count(), 0);
    assert!(!a.svc.db.get_setting("phone_push").unwrap().contains(endpoint));
    let ok = http(port, "POST", "/api/push/subscribe", &[("Cookie", &cookie), ("Content-Type", "application/json")], sub.to_string().as_bytes()).await;
    assert_eq!(ok.status, 200);
    assert_eq!(phone.push_count(), 1);
    phone.forget(&device).unwrap();
    assert_eq!(phone.push_count(), 0);
    assert!(!a.svc.db.get_setting("phone_push").unwrap().contains(endpoint));
}

/// A phone's browser keys: (its secret, p256dh, auth) as the browser would hand them out.
fn fake_phone_keys() -> (p256::SecretKey, String, String) {
    use p256::elliptic_curve::sec1::ToEncodedPoint;
    let secret = p256::SecretKey::random(&mut rand::rngs::OsRng);
    let public = URL_SAFE_NO_PAD.encode(secret.public_key().to_encoded_point(false).as_bytes());
    let mut auth = [0u8; 16];
    rand::RngCore::fill_bytes(&mut rand::rngs::OsRng, &mut auth);
    (secret, public, URL_SAFE_NO_PAD.encode(auth))
}

#[test]
fn pushes_skip_connected_phones_and_come_at_most_every_five_seconds() {
    let sub = |n: &str| Subscription {
        endpoint: format!("https://push.example.test/{}", n),
        keys: SubscriptionKeys { p256dh: "x".into(), auth: "y".into() },
    };
    let mut subs = HashMap::new();
    subs.insert("ios".to_string(), sub("ios"));
    subs.insert("android".to_string(), sub("android"));
    subs.insert("tablet".to_string(), sub("tablet"));
    let connected: HashSet<String> = ["android".to_string()].into_iter().collect();
    let mut last = HashMap::new();
    let now = Instant::now();

    let first = pick_targets(&subs, &connected, &mut last, now);
    let ids: Vec<&str> = first.iter().map(|(id, _)| id.as_str()).collect();
    assert_eq!(ids, vec!["ios", "tablet"], "the phone with a live connection is skipped");
    assert_eq!(first[0].1.endpoint, "https://push.example.test/ios");

    // Right after: nothing (coalesced); after the gap: again.
    assert!(pick_targets(&subs, &connected, &mut last, now + Duration::from_secs(2)).is_empty());
    let later = pick_targets(&subs, &connected, &mut last, now + push::MIN_GAP + Duration::from_millis(1));
    assert_eq!(later.len(), 2);
    // A phone that just disconnected is due at once.
    let nobody = HashSet::new();
    let next = pick_targets(&subs, &nobody, &mut last, now + push::MIN_GAP + Duration::from_millis(2));
    assert_eq!(next.len(), 1);
    assert_eq!(next[0].0, "android");
}

#[test]
fn a_note_is_encrypted_the_way_the_rfc_shows() {
    // RFC 8291, Appendix A: every input fixed, the output known.
    let ua_secret = p256::SecretKey::from_slice(&b64_decode("q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94").unwrap()).unwrap();
    let ua_public = p256::PublicKey::from_sec1_bytes(&b64_decode("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4").unwrap()).unwrap();
    assert_eq!(ua_secret.public_key(), ua_public);
    let auth = b64_decode("BTBZMqHH6r4Tts7J_aSIgg").unwrap();
    let as_secret = p256::SecretKey::from_slice(&b64_decode("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw").unwrap()).unwrap();
    let salt: [u8; 16] = b64_decode("DGv6ra1nlYgDCS1FRnbzlw").unwrap().try_into().unwrap();
    let out = push::encrypt_with(&ua_public, &auth, b"When I grow up, I want to be a watermelon", &as_secret, &salt).unwrap();
    assert_eq!(
        URL_SAFE_NO_PAD.encode(&out),
        "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
    );

    // And the phone side can open what `encrypt` makes with fresh randomness.
    let (phone_secret, phone_public, auth_b64) = fake_phone_keys();
    let sub = Subscription { endpoint: "https://push.example.test/x".into(), keys: SubscriptionKeys { p256dh: phone_public, auth: auth_b64.clone() } };
    let sealed = push::encrypt(&sub, b"{\"title\":\"Bharat\"}").unwrap();
    assert_eq!(decrypt_like_a_browser(&phone_secret, &b64_decode(&auth_b64).unwrap(), &sealed), b"{\"title\":\"Bharat\"}");
}

/// RFC 8291 decryption with the phone's keys (what the browser does).
fn decrypt_like_a_browser(ua_secret: &p256::SecretKey, auth: &[u8], body: &[u8]) -> Vec<u8> {
    use aes_gcm::aead::{Aead, KeyInit};
    use hkdf::Hkdf;
    use p256::elliptic_curve::sec1::ToEncodedPoint;
    let salt = &body[..16];
    let rs = u32::from_be_bytes(body[16..20].try_into().unwrap());
    assert_eq!(rs, 4096);
    let idlen = body[20] as usize;
    assert_eq!(idlen, 65);
    let as_public = p256::PublicKey::from_sec1_bytes(&body[21..21 + idlen]).unwrap();
    let sealed = &body[21 + idlen..];
    let shared = p256::ecdh::diffie_hellman(ua_secret.to_nonzero_scalar(), as_public.as_affine());
    let mut info = b"WebPush: info\0".to_vec();
    info.extend_from_slice(ua_secret.public_key().to_encoded_point(false).as_bytes());
    info.extend_from_slice(as_public.to_encoded_point(false).as_bytes());
    let mut ikm = [0u8; 32];
    Hkdf::<Sha256>::new(Some(auth), shared.raw_secret_bytes().as_slice()).expand(&info, &mut ikm).unwrap();
    let prk = Hkdf::<Sha256>::new(Some(salt), &ikm);
    let mut cek = [0u8; 16];
    let mut nonce = [0u8; 12];
    prk.expand(b"Content-Encoding: aes128gcm\0", &mut cek).unwrap();
    prk.expand(b"Content-Encoding: nonce\0", &mut nonce).unwrap();
    let cipher = aes_gcm::Aes128Gcm::new_from_slice(&cek).unwrap();
    let mut record = cipher.decrypt(aes_gcm::Nonce::from_slice(&nonce), sealed).unwrap();
    assert_eq!(record.pop(), Some(2), "the last-record marker");
    record
}

#[test]
fn the_push_token_is_signed_with_this_pcs_key() {
    let (svc, _dir) = new_service("Asha");
    let vapid = push::Vapid::load_or_create(&svc.db);
    let again = push::Vapid::load_or_create(&svc.db);
    assert_eq!(vapid.public_key_b64(), again.public_key_b64(), "made once, kept in settings");

    let header = vapid.authorization("https://fcm.googleapis.com/fcm/send/abc").unwrap();
    let (t, k) = header.strip_prefix("vapid t=").unwrap().split_once(", k=").unwrap();
    assert_eq!(k, vapid.public_key_b64());
    let parts: Vec<&str> = t.split('.').collect();
    assert_eq!(parts.len(), 3);
    let head: Value = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(parts[0]).unwrap()).unwrap();
    assert_eq!(head, json!({ "typ": "JWT", "alg": "ES256" }));
    let claims: Value = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(parts[1]).unwrap()).unwrap();
    assert_eq!(claims["aud"], "https://fcm.googleapis.com");
    let exp = claims["exp"].as_i64().unwrap();
    let now = crate::networking::now_secs();
    assert!(exp > now + 11 * 3600 && exp <= now + 24 * 3600, "{}", exp);
    assert!(claims["sub"].as_str().unwrap().starts_with("https://") || claims["sub"].as_str().unwrap().starts_with("mailto:"));
    let sig = p256::ecdsa::Signature::from_slice(&URL_SAFE_NO_PAD.decode(parts[2]).unwrap()).unwrap();
    vapid.verifying_key().verify(format!("{}.{}", parts[0], parts[1]).as_bytes(), &sig).expect("a valid ES256 signature");

    assert_eq!(push::split_url("https://web.push.apple.com/QAbc"), Some(("web.push.apple.com".to_string(), 443, "/QAbc".to_string())));
    assert_eq!(push::split_url("https://host:8443"), Some(("host".to_string(), 8443, "/".to_string())));
    assert_eq!(push::split_url("http://host/x"), None);
    // A push to a service that does not exist fails quietly (no panic, an error).
    let rt = tokio::runtime::Runtime::new().unwrap();
    let sub = Subscription { endpoint: "https://127.0.0.1:9/send/x".into(), keys: SubscriptionKeys { p256dh: fake_phone_keys().1, auth: fake_phone_keys().2 } };
    assert!(rt.block_on(push::send(&vapid, &sub, b"{}")).is_err());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_message_from_a_colleague_becomes_a_push_note() {
    let a = node("Asha (Accounts)").await;
    let b = node("Bharat (Stores)").await;
    let conv_a = link(&a, &b).await;
    let phone = PhoneService::new(a.svc.clone(), "3.2.0-test".to_string());
    let mut events = a.svc.events.subscribe().unwrap();
    // Bharat's chat with Asha exists once something has arrived in it.
    a.svc.send_message_full(&conv_a, "hello", None, vec![]).await.unwrap();
    let conv_b = {
        let b_db = b.svc.db.clone();
        assert!(wait_for(|| !b_db.get_conversations(true).unwrap().is_empty(), 10).await);
        b_db.get_conversations(true).unwrap()[0].id.clone()
    };
    b.svc.send_message_full(&conv_b, "the count is done, all 40 boxes are in and counted twice over, nothing missing from the list at all", None, vec![]).await.unwrap();
    let mut notice = None;
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline && notice.is_none() {
        let Ok(Ok(ev)) = tokio::time::timeout(deadline - Instant::now(), events.recv()).await else { break };
        if ev.0 == "lanx://message-received" {
            notice = push::notice_for(&phone, &ev.0, &ev.1);
            // (A message's own echo events never make a note.)
        }
    }
    let notice = notice.expect("a note for Bharat's message");
    assert_eq!(notice.title, "Bharat (Stores)");
    assert_eq!(notice.body, "the count is done, all 40 boxes are in and counted twice over, nothing missing from the list at all");
    assert_eq!(notice.conversation_id.as_deref(), Some(conv_a.as_str()));
    let json: Value = serde_json::from_slice(&notice.json()).unwrap();
    assert_eq!(json["title"], "Bharat (Stores)");
    assert!(json["body"].is_string() && json["conversation_id"].is_string());

    // My own messages, a muted chat, and a locked LANX: no note (or a bare one).
    let mine = a.svc.send_message_full(&conv_a, "ok", None, vec![]).await.unwrap();
    let conv = a.svc.db.get_conversation(&conv_a).unwrap().unwrap();
    assert!(push::notice_for(&phone, "lanx://message-received", &json!({ "message": mine, "conversation": conv })).is_none());
    let mut theirs = mine.clone();
    theirs.is_outgoing = false;
    theirs.sender_id = b.svc.identity.device_id.clone();
    theirs.content = "x".repeat(200);
    let long = push::notice_for(&phone, "lanx://message-received", &json!({ "message": theirs, "conversation": conv })).unwrap();
    assert_eq!(long.body.chars().count(), 121);
    assert!(long.body.ends_with('…'));
    let mut muted = conv.clone();
    muted.muted_until = -1;
    assert!(push::notice_for(&phone, "lanx://message-received", &json!({ "message": theirs, "conversation": muted })).is_none());
    let mut system = theirs.clone();
    system.message_type = "system".to_string();
    assert!(push::notice_for(&phone, "lanx://message-received", &json!({ "message": system, "conversation": conv })).is_none());
    a.svc.privacy.lock();
    let bare = push::notice_for(&phone, "lanx://message-received", &json!({ "message": theirs, "conversation": conv })).unwrap();
    assert_eq!((bare.title.as_str(), bare.body.as_str()), ("LANX", "New message"));

    // An emergency from a colleague: always; my own, or one answered: never.
    let alert = json!({ "id": "a1", "from_id": "b", "from_name": "Bharat", "kind": "fire", "text": "Fire at the gate", "at": 1, "cleared_at": null, "mine": false, "my_ack": null, "sent_to": [], "acks": [] });
    let n = push::notice_for(&phone, "lanx://alert", &alert).unwrap();
    assert_eq!(n.title, "🚑 Emergency");
    assert_eq!(n.body, "Bharat: Fire at the gate");
    assert_eq!(n.conversation_id, None);
    let mut mine = alert.clone();
    mine["mine"] = json!(true);
    assert!(push::notice_for(&phone, "lanx://alert", &mine).is_none());
    let mut answered = alert.clone();
    answered["my_ack"] = json!("safe");
    assert!(push::notice_for(&phone, "lanx://alert", &answered).is_none());
    assert!(push::notice_for(&phone, "lanx://typing", &json!({})).is_none());
}

#[test]
fn the_plain_server_is_untouched_by_the_tls_switch() {
    // The address check runs for both listeners.
    assert!(http::is_local("127.0.0.1".parse().unwrap()));
    assert!(http::is_local("192.168.1.9".parse().unwrap()));
    assert!(!http::is_local("8.8.8.8".parse().unwrap()));
}
