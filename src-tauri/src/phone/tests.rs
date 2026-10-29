//! Tests for "LANX on your phone": the pieces (frames, ranges, pairing) and
//! a real phone session against two LANX engines on loopback.

use super::http::{parse_range, percent_decode};
use super::ws::{OP_CLOSE, OP_PING, OP_PONG, OP_TEXT, accept_key, encode_frame, read_frame};
use super::{PhoneService, device_name_from_ua};
use crate::events::Events;
use crate::networking::NetworkService;
use crate::networking::protocol::GamePayload;
use crate::security::DeviceIdentity;
use crate::storage::Database;
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_util::sync::CancellationToken;

// ------------------------------------------------------------------ pieces

#[test]
fn websocket_accept_key_matches_the_rfc_example() {
    assert_eq!(accept_key("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
}

#[tokio::test]
async fn frames_round_trip_at_every_length_class() {
    for len in [0usize, 10, 125, 126, 200, 65535, 65536, 70000] {
        let payload: Vec<u8> = (0..len).map(|i| (i % 251) as u8).collect();
        for mask in [None, Some([9u8, 8, 7, 6])] {
            let bytes = encode_frame(OP_TEXT, &payload, mask);
            let mut cursor = std::io::Cursor::new(bytes);
            let (op, fin, got) = read_frame(&mut cursor).await.unwrap();
            assert_eq!((op, fin), (OP_TEXT, true), "len {}", len);
            assert_eq!(got, payload, "len {} mask {:?}", len, mask);
        }
    }
}

#[test]
fn ranges_are_parsed_like_a_browser_sends_them() {
    assert_eq!(parse_range("bytes=0-99", 1000), Some(Ok((0, 99))));
    assert_eq!(parse_range("bytes=200-", 1000), Some(Ok((200, 999))));
    assert_eq!(parse_range("bytes=-100", 1000), Some(Ok((900, 999))));
    assert_eq!(parse_range("bytes=0-5000", 1000), Some(Ok((0, 999))));
    assert_eq!(parse_range("bytes=1000-", 1000), Some(Err(())));
    assert_eq!(parse_range("bytes=5-2", 1000), Some(Err(())));
    assert_eq!(parse_range("items=0-1", 1000), None);
    assert_eq!(parse_range("bytes=0-1,5-6", 1000), None);
}

#[test]
fn query_strings_are_decoded() {
    assert_eq!(percent_decode("Q3%20report%20(1).pdf"), "Q3 report (1).pdf");
    assert_eq!(percent_decode("a+b%2Bc"), "a b+c");
    assert_eq!(percent_decode("100%"), "100%");
    assert_eq!(percent_decode("%E0%A4%A8%E0%A4%AE"), "नम");
}

#[test]
fn phones_get_readable_names() {
    assert_eq!(
        device_name_from_ua("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"),
        "Safari on iPhone"
    );
    assert_eq!(
        device_name_from_ua("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36"),
        "Chrome on Android phone"
    );
    assert_eq!(
        device_name_from_ua("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.0.0 Mobile/15E148 Safari/604.1"),
        "Chrome on iPhone"
    );
    assert_eq!(device_name_from_ua("curl/8.0"), "Browser on device");
}

// ---------------------------------------------------------------- engines

fn new_service(name: &str) -> (NetworkService, tempfile::TempDir) {
    // A file database in a fresh folder: phone uploads land next to it.
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

/// The phone server of `svc` on a loopback port.
async fn phone_server(svc: &NetworkService) -> (PhoneService, u16, CancellationToken) {
    let phone = PhoneService::new(svc.clone(), "3.0.0-test".to_string());
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let cancel = CancellationToken::new();
    let p = phone.clone();
    let c = cancel.clone();
    tokio::spawn(async move { p.serve(listener, c).await });
    assert!(wait_for(|| phone.is_listening(), 5).await);
    (phone, port, cancel)
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

/// One HTTP request (the connection closes after the answer).
async fn http(port: u16, method: &str, path: &str, headers: &[(&str, &str)], body: &[u8]) -> Reply {
    let mut s = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    let mut req = format!("{} {} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\nUser-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Version/17.5 Mobile/15E148 Safari/604.1\r\n", method, path);
    for (n, v) in headers {
        req.push_str(&format!("{}: {}\r\n", n, v));
    }
    if !body.is_empty() || method == "POST" {
        req.push_str(&format!("Content-Length: {}\r\n", body.len()));
    }
    req.push_str("\r\n");
    s.write_all(req.as_bytes()).await.unwrap();
    s.write_all(body).await.unwrap();
    let mut raw = Vec::new();
    tokio::time::timeout(Duration::from_secs(10), s.read_to_end(&mut raw)).await.unwrap().unwrap();
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

/// A WebSocket to the phone server, authenticated with `token`.
async fn ws_connect(port: u16, token: &str) -> TcpStream {
    let mut s = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    s.write_all(b"GET /ws HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n")
        .await
        .unwrap();
    let mut head = Vec::new();
    loop {
        let mut b = [0u8; 1];
        s.read_exact(&mut b).await.unwrap();
        head.push(b[0]);
        if head.ends_with(b"\r\n\r\n") {
            break;
        }
    }
    let head = String::from_utf8_lossy(&head).to_string();
    assert!(head.starts_with("HTTP/1.1 101"), "{}", head);
    assert!(head.contains("Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo="), "{}", head);
    ws_send(&mut s, &json!({ "id": 1, "op": "auth", "token": token })).await;
    let reply = ws_next(&mut s).await;
    assert_eq!(reply["ok"], true, "auth reply {}", reply);
    s
}

async fn ws_send(s: &mut TcpStream, v: &Value) {
    s.write_all(&encode_frame(OP_TEXT, v.to_string().as_bytes(), Some([1, 2, 3, 4]))).await.unwrap();
}

/// The next JSON line from the server (pings are answered on the way).
async fn ws_next(s: &mut TcpStream) -> Value {
    loop {
        let (op, _fin, payload) = tokio::time::timeout(Duration::from_secs(10), read_frame(s)).await.expect("a frame in time").unwrap();
        match op {
            OP_TEXT => return serde_json::from_slice(&payload).unwrap(),
            OP_PING => s.write_all(&encode_frame(OP_PONG, &payload, Some([5, 6, 7, 8]))).await.unwrap(),
            OP_CLOSE => panic!("server closed the connection"),
            _ => {}
        }
    }
}

/// Reads lines until one satisfies `pred` (or the time is up).
async fn ws_wait<F: Fn(&Value) -> bool>(s: &mut TcpStream, pred: F, secs: u64) -> Option<Value> {
    let deadline = Instant::now() + Duration::from_secs(secs);
    while Instant::now() < deadline {
        let v = match tokio::time::timeout(deadline - Instant::now(), ws_next(s)).await {
            Ok(v) => v,
            Err(_) => return None,
        };
        if pred(&v) {
            return Some(v);
        }
    }
    None
}

/// Sends request `id` and returns its reply (pushes on the way are skipped).
async fn ask(s: &mut TcpStream, id: i64, mut req: Value) -> Value {
    req["id"] = json!(id);
    ws_send(s, &req).await;
    ws_wait(s, |v| v["id"] == id, 10).await.unwrap_or_else(|| panic!("no reply to request {}", id))
}

/// Sends request `id` and returns its reply, having also seen a push matching
/// `pred` — before or after the reply, since a push caused by the request
/// races with the reply itself.
async fn ask_and_push<F: Fn(&Value) -> bool>(s: &mut TcpStream, id: i64, mut req: Value, pred: F) -> Value {
    req["id"] = json!(id);
    ws_send(s, &req).await;
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut reply = None;
    let mut pushed = false;
    while Instant::now() < deadline && !(reply.is_some() && pushed) {
        let v = match tokio::time::timeout(deadline - Instant::now(), ws_next(s)).await {
            Ok(v) => v,
            Err(_) => break,
        };
        if v["id"] == id {
            reply = Some(v);
        } else if pred(&v) {
            pushed = true;
        }
    }
    assert!(pushed, "the push for request {} never came", id);
    reply.unwrap_or_else(|| panic!("no reply to request {}", id))
}

// ------------------------------------------------------------------ tests

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn pairing_needs_the_right_code_and_an_answer() {
    let (svc, _dir) = new_service("Asha");
    let phone = PhoneService::new(svc, "3.0.0-test".to_string());

    assert_eq!(phone.claim("12345678", "Safari on iPhone", "127.0.0.1"), Err("no-code"));
    let info = phone.start_pairing();
    assert_eq!(info.code.len(), 8);
    assert!(info.code.chars().all(|c| c.is_ascii_digit()));
    let wrong = if info.code == "00000000" { "11111111" } else { "00000000" };
    assert_eq!(phone.claim(wrong, "x", "127.0.0.1"), Err("wrong"));
    assert_eq!(phone.claim("1234", "x", "127.0.0.1"), Err("wrong"));
    // Spaces in the code are fine ("4821 9937").
    let spaced = format!("{} {}", &info.code[..4], &info.code[4..]);
    let request = phone.claim(&spaced, "Safari on iPhone", "127.0.0.1").unwrap();
    assert_eq!(phone.poll(&request).state, "waiting");
    assert_eq!(phone.status().requests.len(), 1);

    // Denied: no device, no token.
    phone.answer(&request, false).unwrap();
    assert_eq!(phone.poll(&request).state, "denied");
    assert!(phone.status().devices.is_empty());
    assert!(phone.answer(&request, true).is_err(), "answered twice");

    // Allowed: one device, a token that opens the door (once).
    let request = phone.claim(&info.code, "Chrome on Android phone", "127.0.0.1").unwrap();
    phone.answer(&request, true).unwrap();
    let r = phone.poll(&request);
    assert_eq!(r.state, "allowed");
    let token = r.token.expect("token");
    assert_eq!(phone.poll(&request).state, "expired", "the token is handed out once");
    let device = phone.device_for_token(&token).expect("device");
    assert_eq!(device.name, "Chrome on Android phone");
    assert!(phone.device_for_token("nonsense").is_none());
    assert!(phone.device_for_token("").is_none());
    let status = phone.status();
    assert_eq!(status.devices.len(), 1);
    assert!(!status.devices[0].connected);

    // Remembered across a restart (settings), gone after Remove.
    let again = PhoneService::new(phone.network.clone(), "3.0.0-test".to_string());
    assert!(again.device_for_token(&token).is_some());
    again.forget(&device.id).unwrap();
    assert!(again.device_for_token(&token).is_none());
    assert!(again.forget(&device.id).is_err());

    // Ten wrong tries throw the code away.
    let info = phone.start_pairing();
    let wrong = if info.code == "00000000" { "11111111" } else { "00000000" };
    for _ in 0..10 {
        assert_eq!(phone.claim(wrong, "x", "127.0.0.1"), Err("wrong"));
    }
    assert_eq!(phone.claim(&info.code, "x", "127.0.0.1"), Err("no-code"));
    assert!(phone.pairing_info().is_none());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_phone_pairs_chats_and_sends_a_photo_through_the_pc() {
    let a = node("Asha (Accounts)").await;
    let b = node("Bharat (Stores)").await;
    let conv_a = link(&a, &b).await;
    let (phone, port, _cancel) = phone_server(&a.svc).await;

    // The page is served, with its security policy; nothing else without a token.
    let page = http(port, "GET", "/", &[], b"").await;
    assert_eq!(page.status, 200);
    assert!(page.header("content-type").unwrap().starts_with("text/html"));
    assert!(page.header("content-security-policy").is_some());
    assert!(String::from_utf8_lossy(&page.body).contains("LANX"));
    assert_eq!(http(port, "GET", "/api/file/x", &[], b"").await.status, 401);
    assert_eq!(http(port, "POST", "/api/upload?conv=x&name=a.png", &[], b"abc").await.status, 401);
    assert_eq!(http(port, "GET", "/nothing", &[], b"").await.status, 404);

    // Pairing over HTTP: wrong code, right code, the PC allows, the phone polls.
    let no_code = http(port, "POST", "/api/pair", &[("Content-Type", "application/json")], b"{\"code\":\"12345678\"}").await;
    assert_eq!(no_code.status, 410);
    let info = phone.start_pairing();
    let wrong = if info.code == "00000000" { "11111111" } else { "00000000" };
    let bad = http(port, "POST", "/api/pair", &[("Content-Type", "application/json")], json!({ "code": wrong }).to_string().as_bytes()).await;
    assert_eq!(bad.status, 403);
    let claimed = http(port, "POST", "/api/pair", &[("Content-Type", "application/json")], json!({ "code": info.code }).to_string().as_bytes()).await;
    assert_eq!(claimed.status, 202, "{}", String::from_utf8_lossy(&claimed.body));
    let request = claimed.json()["request"].as_str().unwrap().to_string();
    let status = phone.status();
    assert_eq!(status.requests.len(), 1);
    assert_eq!(status.requests[0].name, "Safari on iPhone");
    assert_eq!(http(port, "GET", &format!("/api/pair/{}", request), &[], b"").await.json()["state"], "waiting");
    phone.answer(&request, true).unwrap();
    let allowed = http(port, "GET", &format!("/api/pair/{}", request), &[], b"").await;
    assert_eq!(allowed.json()["state"], "allowed");
    let token = allowed.json()["token"].as_str().unwrap().to_string();
    assert!(allowed.header("set-cookie").unwrap().contains(&format!("lanx_phone={}", token)));
    let cookie = format!("lanx_phone={}", token);

    // The live connection: hello lists the chat with Bharat.
    let mut ws = ws_connect(port, &token).await;
    assert!(wait_for(|| phone.connected_count() == 1, 5).await);
    assert!(phone.status().devices[0].connected);
    ws_send(&mut ws, &json!({ "id": 2, "op": "hello" })).await;
    let hello = ws_next(&mut ws).await;
    assert_eq!(hello["ok"], true, "{}", hello);
    assert_eq!(hello["me"]["name"], "Asha (Accounts)");
    assert_eq!(hello["conversations"][0]["id"], conv_a);
    assert_eq!(hello["conversations"][0]["peer_name"], "Bharat (Stores)");
    assert_eq!(hello["peers"].as_array().unwrap().len(), 1);

    // A text from the phone reaches Bharat as a message from Asha.
    ws_send(&mut ws, &json!({ "id": 3, "op": "send", "conv": conv_a, "text": "hello from the phone" })).await;
    let sent = ws_wait(&mut ws, |v| v["id"] == 3, 10).await.expect("send reply");
    assert_eq!(sent["ok"], true, "{}", sent);
    assert_eq!(sent["message"]["is_outgoing"], true);
    assert_eq!(sent["message"]["transfer"], Value::Null);
    let b_db = b.svc.db.clone();
    assert!(
        wait_for(
            || b_db.get_conversations(true).unwrap().first().is_some_and(|c| b_db.get_messages(&c.id).unwrap().iter().any(|m| m.content == "hello from the phone")),
            10
        )
        .await,
        "Bharat got the phone's message"
    );
    // (The phone saw its own message echoed to every phone too.)
    assert!(ws_wait(&mut ws, |v| v["ev"] == "message" && v["message"]["content"] == "hello from the phone", 5).await.is_some());

    // Bharat answers: the phone is told at once.
    let conv_b = b.svc.db.get_conversations(true).unwrap()[0].id.clone();
    b.svc.send_message_full(&conv_b, "hi phone", None, vec![]).await.unwrap();
    let pushed = ws_wait(&mut ws, |v| v["ev"] == "message" && v["message"]["content"] == "hi phone", 10).await.expect("push");
    assert_eq!(pushed["message"]["is_outgoing"], false);
    assert_eq!(pushed["conversation"]["id"], conv_a);

    // Older messages page, and "read" clears the unread count on the PC.
    ws_send(&mut ws, &json!({ "id": 4, "op": "messages", "conv": conv_a, "limit": 50 })).await;
    let page = ws_wait(&mut ws, |v| v["id"] == 4, 10).await.unwrap();
    let texts: Vec<&str> = page["messages"].as_array().unwrap().iter().filter_map(|m| m["content"].as_str()).collect();
    assert!(texts.contains(&"hello from the phone") && texts.contains(&"hi phone"), "{:?}", texts);
    assert_eq!(page["more"], false);
    assert_eq!(a.svc.db.get_conversation(&conv_a).unwrap().unwrap().unread_count, 1);
    ws_send(&mut ws, &json!({ "id": 5, "op": "read", "conv": conv_a })).await;
    assert_eq!(ws_wait(&mut ws, |v| v["id"] == 5, 10).await.unwrap()["ok"], true);
    assert_eq!(a.svc.db.get_conversation(&conv_a).unwrap().unwrap().unread_count, 0);

    // A photo from the phone: stored on the PC, sent to Bharat, served back.
    let pixels: Vec<u8> = (0..5000u32).map(|i| (i * 7 % 256) as u8).collect();
    let up = http(
        port,
        "POST",
        &format!("/api/upload?conv={}&name={}", conv_a, "holiday%20pic.png"),
        &[("Cookie", &cookie), ("Content-Type", "application/octet-stream")],
        &pixels,
    )
    .await;
    assert_eq!(up.status, 200, "{}", String::from_utf8_lossy(&up.body));
    let msg = &up.json()["message"];
    assert_eq!(msg["message_type"], "file");
    assert_eq!(msg["transfer"]["file_name"], "holiday pic.png");
    assert_eq!(msg["transfer"]["is_image"], true);
    let tid = msg["transfer"]["id"].as_str().unwrap().to_string();
    let b_db = b.svc.db.clone();
    assert!(
        wait_for(|| b_db.list_transfers(true).unwrap().iter().any(|t| t.file_name == "holiday pic.png" && t.status == "completed"), 20).await,
        "Bharat downloaded the photo"
    );
    let got = http(port, "GET", &format!("/api/file/{}", tid), &[("Cookie", &cookie)], b"").await;
    assert_eq!(got.status, 200);
    assert_eq!(got.header("content-type"), Some("image/png"));
    assert!(got.header("content-disposition").unwrap().starts_with("inline"));
    assert_eq!(got.body, pixels);
    let part = http(port, "GET", &format!("/api/file/{}", tid), &[("Cookie", &cookie), ("Range", "bytes=10-19")], b"").await;
    assert_eq!(part.status, 206);
    assert_eq!(part.header("content-range"), Some("bytes 10-19/5000"));
    assert_eq!(part.body, pixels[10..20].to_vec());
    assert_eq!(http(port, "GET", &format!("/api/file/{}", tid), &[("Cookie", "lanx_phone=nope")], b"").await.status, 401);

    // Remove the phone on the PC: its connection closes and its token is dead.
    let device = phone.status().devices[0].id.clone();
    phone.forget(&device).unwrap();
    assert!(wait_for(|| phone.connected_count() == 0, 5).await);
    assert_eq!(http(port, "GET", &format!("/api/file/{}", tid), &[("Cookie", &cookie)], b"").await.status, 401);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_locked_pc_tells_the_phone_nothing() {
    let a = node("Asha").await;
    let (phone, port, _cancel) = phone_server(&a.svc).await;
    let info = phone.start_pairing();
    let request = phone.claim(&info.code, "Safari on iPhone", "127.0.0.1").unwrap();
    phone.answer(&request, true).unwrap();
    let token = phone.poll(&request).token.unwrap();
    let mut ws = ws_connect(port, &token).await;
    a.svc.privacy.lock();
    ws_send(&mut ws, &json!({ "id": 9, "op": "hello" })).await;
    let r = ws_wait(&mut ws, |v| v["id"] == 9, 10).await.unwrap();
    assert_eq!(r["ok"], false);
    assert_eq!(r["error"], "LOCKED");
    assert_eq!(http(port, "GET", "/api/file/x", &[("Cookie", &format!("lanx_phone={}", token))], b"").await.status, 423);
}

/// LANX 3.1: everything else the desktop can do, done from the phone —
/// stickers, reactions, edits, stars, pins, search, "send later", "remind
/// me", groups, the Files list, and deleting — each one reaching Bharat (or
/// the database) through the PC like the desktop's own actions do.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_phone_does_everything_the_desktop_does() {
    let a = node("Asha (Accounts)").await;
    let b = node("Bharat (Stores)").await;
    let conv_a = link(&a, &b).await;
    let (phone, port, _cancel) = phone_server(&a.svc).await;
    let info = phone.start_pairing();
    let request = phone.claim(&info.code, "Safari on iPhone", "127.0.0.1").unwrap();
    phone.answer(&request, true).unwrap();
    let token = phone.poll(&request).token.unwrap();
    let cookie = format!("lanx_phone={}", token);
    let mut ws = ws_connect(port, &token).await;
    let bharat = b.svc.identity.device_id.clone();
    let a_db = a.svc.db.clone();
    let b_db = b.svc.db.clone();
    let now = crate::networking::now_secs();

    // hello carries the quick replies and the sticker list.
    let hello = ask(&mut ws, 1, json!({ "op": "hello" })).await;
    assert_eq!(hello["ok"], true, "{}", hello);
    assert_eq!(hello["quick_replies"].as_array().unwrap().len(), 6);
    assert_eq!(hello["quick_replies"][0], "On my way 🚶");
    let stickers = hello["stickers"].as_array().unwrap();
    assert_eq!(stickers.len(), 24);
    assert_eq!(stickers[0], json!({ "id": "thanks", "emoji": "🙏", "label": "Thank you!" }));

    // A sticker from the phone reaches Bharat, and every phone sees it echoed.
    let r = ask_and_push(&mut ws, 2, json!({ "op": "sticker", "conv": conv_a, "sticker": "thanks" }), |v| {
        v["ev"] == "message" && v["message"]["message_type"] == "sticker"
    })
    .await;
    assert_eq!(r["ok"], true, "{}", r);
    assert_eq!(r["message"]["message_type"], "sticker");
    assert_eq!(r["message"]["content"], "thanks");
    assert_eq!(r["message"]["transfer"], Value::Null);
    assert_eq!(ask(&mut ws, 3, json!({ "op": "sticker", "conv": conv_a, "sticker": "nope" })).await["error"], "Unknown sticker");
    let conv_b = {
        let b_db = b_db.clone();
        assert!(wait_for(|| !b_db.get_conversations(true).unwrap().is_empty(), 10).await);
        b_db.get_conversations(true).unwrap()[0].id.clone()
    };
    {
        let b_db = b_db.clone();
        let conv_b = conv_b.clone();
        assert!(
            wait_for(|| b_db.get_messages(&conv_b).unwrap().iter().any(|m| m.message_type == "sticker" && m.content == "thanks"), 10).await,
            "Bharat got the sticker"
        );
    }

    // Bharat says something; the phone reacts to it (one reaction, mine).
    b.svc.send_message_full(&conv_b, "stock count done", None, vec![]).await.unwrap();
    let pushed = ws_wait(&mut ws, |v| v["ev"] == "message" && v["message"]["content"] == "stock count done", 10).await.expect("push");
    let their_id = pushed["message"]["id"].as_str().unwrap().to_string();
    let r = ask(&mut ws, 4, json!({ "op": "react", "message_id": their_id, "emoji": "👍" })).await;
    assert_eq!(r["ok"], true, "{}", r);
    let reactions = r["message"]["reactions"].as_array().unwrap();
    assert_eq!(reactions.len(), 1, "{}", r);
    assert_eq!(reactions[0]["emoji"], "👍");
    assert_eq!(reactions[0]["mine"], true);
    assert_eq!(reactions[0]["count"], 1);
    assert_eq!(ask(&mut ws, 5, json!({ "op": "react", "message_id": "nothing", "emoji": "👍" })).await["error"], "Message not found");

    // The phone's own text, edited.
    let sent = ask(&mut ws, 6, json!({ "op": "send", "conv": conv_a, "text": "pls chek the count" })).await;
    assert_eq!(sent["ok"], true, "{}", sent);
    let mine_id = sent["message"]["id"].as_str().unwrap().to_string();
    let r = ask(&mut ws, 7, json!({ "op": "edit", "message_id": mine_id, "text": "please check the count" })).await;
    assert_eq!(r["ok"], true, "{}", r);
    assert_eq!(r["message"]["content"], "please check the count");
    assert!(r["message"]["edited_at"].is_i64());
    assert_eq!(ask(&mut ws, 8, json!({ "op": "edit", "message_id": their_id, "text": "x" })).await["ok"], false, "not mine");

    // Star and pin; the starred list shows it with the chat's name.
    let r = ask(&mut ws, 9, json!({ "op": "star", "message_id": mine_id, "on": true })).await;
    assert_eq!(r["message"]["starred"], true, "{}", r);
    let r = ask(&mut ws, 10, json!({ "op": "pin", "message_id": mine_id, "on": true })).await;
    assert!(r["message"]["pinned_at"].is_i64(), "{}", r);
    let r = ask(&mut ws, 11, json!({ "op": "starred" })).await;
    let hits = r["hits"].as_array().unwrap();
    assert_eq!(hits.len(), 1, "{}", r);
    assert_eq!(hits[0]["message"]["id"], mine_id.as_str());
    assert_eq!(hits[0]["message"]["transfer"], Value::Null);
    assert_eq!(hits[0]["peer_name"], "Bharat (Stores)");
    assert!(hits[0]["peer_avatar_color"].is_string());
    let r = ask(&mut ws, 12, json!({ "op": "star", "message_id": mine_id, "on": false })).await;
    assert_eq!(r["message"]["starred"], false);
    assert!(ask(&mut ws, 13, json!({ "op": "starred" })).await["hits"].as_array().unwrap().is_empty());

    // Search finds both sides' texts.
    let r = ask(&mut ws, 14, json!({ "op": "search", "query": "count" })).await;
    let found: Vec<&str> = r["hits"].as_array().unwrap().iter().map(|h| h["message"]["content"].as_str().unwrap()).collect();
    assert!(found.contains(&"please check the count") && found.contains(&"stock count done"), "{:?}", found);
    assert!(ask(&mut ws, 15, json!({ "op": "search", "query": "zebra" })).await["hits"].as_array().unwrap().is_empty());

    // Send later: listed, then cancelled (the window is told each time).
    let at = now + 3600;
    let r = ask_and_push(
        &mut ws,
        16,
        json!({ "op": "later", "conv": conv_a, "text": "Stock count at 4", "at": at }),
        |v| v["ev"] == "scheduled" && v["conversation_id"] == conv_a.as_str() && v["problem"].is_null(),
    )
    .await;
    assert_eq!(r["ok"], true, "{}", r);
    assert_eq!(r["scheduled"]["send_at"], at);
    assert_eq!(r["scheduled"]["content"], "Stock count at 4");
    let sid = r["scheduled"]["id"].as_str().unwrap().to_string();
    let r = ask(&mut ws, 17, json!({ "op": "scheduled", "conv": conv_a })).await;
    assert_eq!(r["items"].as_array().unwrap().len(), 1);
    assert_eq!(r["items"][0]["id"], sid.as_str());
    assert_eq!(ask(&mut ws, 18, json!({ "op": "cancel_later", "scheduled_id": "nothing", "conv": conv_a })).await["ok"], false);
    assert_eq!(ask(&mut ws, 19, json!({ "op": "cancel_later", "scheduled_id": sid, "conv": conv_a })).await["ok"], true);
    assert!(ask(&mut ws, 20, json!({ "op": "scheduled", "conv": conv_a })).await["items"].as_array().unwrap().is_empty());
    assert_eq!(ask(&mut ws, 21, json!({ "op": "later", "conv": conv_a, "text": "late", "at": now - 5 })).await["error"], "Pick a time in the future.");

    // Remind me: set, cleared, and (a short one) delivered as a push.
    let r = ask(&mut ws, 22, json!({ "op": "remind", "message_id": their_id, "at": at })).await;
    assert_eq!(r["message"]["remind_at"], at, "{}", r);
    let r = ask(&mut ws, 23, json!({ "op": "cancel_remind", "message_id": their_id })).await;
    assert_eq!(r["message"]["remind_at"], Value::Null, "{}", r);
    let soon = crate::networking::now_secs() + 1;
    assert_eq!(ask(&mut ws, 24, json!({ "op": "remind", "message_id": their_id, "at": soon })).await["ok"], true);
    tokio::time::sleep(Duration::from_millis(1200)).await;
    a.svc.run_chat_timers().await;
    let reminder = ws_wait(&mut ws, |v| v["ev"] == "reminder", 10).await.expect("reminder push");
    assert_eq!(reminder["message"]["id"], their_id.as_str());
    assert_eq!(reminder["conversation_id"], conv_a.as_str());
    assert!(reminder["title"].as_str().unwrap().contains("Reminder"), "{}", reminder);
    assert_eq!(reminder["text"], "stock count done");

    // A group made from the phone: Bharat gets it, and a text in it.
    let r = ask(&mut ws, 25, json!({ "op": "group_create", "name": "Site team", "member_ids": [bharat] })).await;
    assert_eq!(r["ok"], true, "{}", r);
    assert_eq!(r["conversation"]["kind"], "group");
    assert_eq!(r["conversation"]["peer_name"], "Site team");
    let gid = r["conversation"]["id"].as_str().unwrap().to_string();
    let r = ask(&mut ws, 26, json!({ "op": "group", "group_id": gid })).await;
    assert_eq!(r["group"]["name"], "Site team", "{}", r);
    assert_eq!(r["group"]["members"].as_array().unwrap().len(), 2);
    assert!(r["group"]["members"].as_array().unwrap().iter().any(|m| m["device_id"] == bharat.as_str()));
    assert_eq!(ask(&mut ws, 27, json!({ "op": "group", "group_id": "nothing" })).await["error"], "Group not found");
    let r = ask(&mut ws, 28, json!({ "op": "group_update", "group_id": gid, "name": "Site crew" })).await;
    assert_eq!(r["group"]["name"], "Site crew", "{}", r);
    {
        let b_db = b_db.clone();
        let gid = gid.clone();
        assert!(wait_for(|| b_db.get_conversation(&gid).unwrap().is_some(), 10).await, "Bharat got the group");
    }
    let r = ask(&mut ws, 29, json!({ "op": "send", "conv": gid, "text": "Meeting at the gate", "mentions": [bharat] })).await;
    assert_eq!(r["ok"], true, "{}", r);
    assert_eq!(r["message"]["mentions"][0], bharat.as_str());
    {
        let b_db = b_db.clone();
        let gid = gid.clone();
        assert!(
            wait_for(|| b_db.get_messages(&gid).unwrap().iter().any(|m| m.content == "Meeting at the gate"), 10).await,
            "Bharat got the group text"
        );
    }
    assert_eq!(ask(&mut ws, 30, json!({ "op": "group_leave", "group_id": gid })).await["ok"], true);
    assert_eq!(a_db.get_conversation(&gid).unwrap().unwrap().membership, "left");

    // Forward Bharat's text back into the chat.
    let r = ask(&mut ws, 31, json!({ "op": "forward", "message_ids": [their_id], "conversation_ids": [conv_a] })).await;
    assert_eq!(r["ok"], true, "{}", r);
    assert_eq!(r["sent"], 1);
    assert_eq!(r["problems"], json!([]));

    // The Files list after a photo from the phone, and Cancel on it.
    let pixels: Vec<u8> = (0..3000u32).map(|i| (i * 13 % 256) as u8).collect();
    let up = http(
        port,
        "POST",
        &format!("/api/upload?conv={}&name={}", conv_a, "gate.png"),
        &[("Cookie", &cookie), ("Content-Type", "application/octet-stream")],
        &pixels,
    )
    .await;
    assert_eq!(up.status, 200, "{}", String::from_utf8_lossy(&up.body));
    let tid = up.json()["message"]["transfer"]["id"].as_str().unwrap().to_string();
    let r = ask(&mut ws, 32, json!({ "op": "transfers" })).await;
    let listed = r["transfers"].as_array().unwrap().iter().find(|t| t["id"] == tid.as_str()).unwrap_or_else(|| panic!("{}", r));
    assert_eq!(listed["file_name"], "gate.png");
    assert_eq!(listed["conversation_id"], conv_a.as_str());
    assert_eq!(listed["direction"], "outgoing");
    assert!(listed["created_at"].as_i64().unwrap() > 0);
    assert!(listed.get("completed_at").is_some() && listed.get("error_reason").is_some() && listed.get("parent_id").is_some());
    {
        let a_db = a_db.clone();
        let tid = tid.clone();
        assert!(wait_for(|| a_db.get_transfer(&tid).unwrap().is_some_and(|t| t.status == "completed"), 20).await, "the photo went");
    }
    let r = ask(&mut ws, 33, json!({ "op": "cancel", "transfer_id": tid })).await;
    assert!(r["ok"] == true || r["error"] == "This transfer has already finished.", "{}", r);
    assert_eq!(ask(&mut ws, 34, json!({ "op": "retry", "transfer_id": "nothing" })).await["error"], "Transfer not found");

    // Delete for everyone leaves a stub; delete for me removes the message here.
    let r = ask(&mut ws, 35, json!({ "op": "delete", "message_id": mine_id, "everyone": true })).await;
    assert_eq!(r["ok"], true, "{}", r);
    assert_eq!(r["message"]["deleted"], true);
    let r = ask_and_push(&mut ws, 36, json!({ "op": "delete", "message_id": their_id, "everyone": false }), |v| {
        v["ev"] == "deleted" && v["message_ids"][0] == their_id.as_str()
    })
    .await;
    assert_eq!(r["ok"], true, "{}", r);
    let page = ask(&mut ws, 37, json!({ "op": "messages", "conv": conv_a })).await;
    let ids: Vec<&str> = page["messages"].as_array().unwrap().iter().map(|m| m["id"].as_str().unwrap()).collect();
    assert!(ids.contains(&mine_id.as_str()) && !ids.contains(&their_id.as_str()), "{:?}", ids);

    // Locked PC: nothing works.
    a.svc.privacy.lock();
    let r = ask(&mut ws, 38, json!({ "op": "react", "message_id": mine_id, "emoji": "👍" })).await;
    assert_eq!(r["ok"], false);
    assert_eq!(r["error"], "LOCKED");
}

/// A paired, connected phone on Asha's PC (the steps every 3.2 test starts
/// with). The server runs until the returned token is dropped.
async fn paired_phone(a: &Node) -> (PhoneService, TcpStream, CancellationToken) {
    let (phone, port, cancel) = phone_server(&a.svc).await;
    let info = phone.start_pairing();
    let request = phone.claim(&info.code, "Safari on iPhone", "127.0.0.1").unwrap();
    phone.answer(&request, true).unwrap();
    let token = phone.poll(&request).token.unwrap();
    let ws = ws_connect(port, &token).await;
    (phone, ws, cancel)
}

/// LANX 3.2: the office tools from the phone — cards (a poll, a notice), the
/// Organiser's list, personal notes and the calendar — each kept by the PC
/// like the desktop's own, with cards reaching Bharat and his tick coming back.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_phone_posts_cards_and_keeps_notes_and_the_calendar() {
    let a = node("Asha (Accounts)").await;
    let b = node("Bharat (Stores)").await;
    let conv_a = link(&a, &b).await;
    let (_phone, mut ws, _cancel) = paired_phone(&a).await;
    let asha = a.svc.identity.device_id.clone();
    let bharat = b.svc.identity.device_id.clone();
    let b_db = b.svc.db.clone();
    let now = crate::networking::now_secs();

    // A poll from the phone: posted as a card, echoed to every phone, and
    // delivered to Bharat as a card (checked and tidied by the engine).
    let r = ask_and_push(
        &mut ws,
        1,
        json!({ "op": "card_send", "conv": conv_a, "card": { "kind": "poll", "question": "Tea?", "options": ["Yes", "No"], "multi": false } }),
        |v| v["ev"] == "message" && v["message"]["message_type"] == "card",
    )
    .await;
    assert_eq!(r["ok"], true, "{}", r);
    assert_eq!(r["message"]["message_type"], "card");
    assert_eq!(r["message"]["is_outgoing"], true);
    assert_eq!(r["message"]["transfer"], Value::Null);
    let poll_id = r["message"]["id"].as_str().unwrap().to_string();
    let card: Value = serde_json::from_str(r["message"]["content"].as_str().unwrap()).unwrap();
    assert_eq!(card, json!({ "kind": "poll", "question": "Tea?", "options": ["Yes", "No"], "multi": false }));
    let r = ask(&mut ws, 2, json!({ "op": "card_send", "conv": conv_a, "card": { "kind": "poll", "question": "Tea?", "options": ["Yes"] } })).await;
    assert_eq!(r["error"], "A poll needs at least two answers.");
    assert_eq!(ask(&mut ws, 3, json!({ "op": "card_send", "conv": conv_a, "card": "nope" })).await["error"], "Card not given");
    let conv_b = {
        let b_db = b_db.clone();
        assert!(wait_for(|| !b_db.get_conversations(true).unwrap().is_empty(), 10).await);
        b_db.get_conversations(true).unwrap()[0].id.clone()
    };
    {
        let (b_db, conv_b, poll_id) = (b_db.clone(), conv_b.clone(), poll_id.clone());
        assert!(
            wait_for(|| b_db.get_messages(&conv_b).unwrap().iter().any(|m| m.message_type == "card" && m.id == poll_id), 10).await,
            "Bharat got the poll"
        );
    }

    // The Organiser's list: the poll, with the chat's name.
    let r = ask(&mut ws, 4, json!({ "op": "cards" })).await;
    let hits = r["hits"].as_array().unwrap();
    assert_eq!(hits.len(), 1, "{}", r);
    assert_eq!(hits[0]["message"]["id"], poll_id.as_str());
    assert_eq!(hits[0]["message"]["transfer"], Value::Null);
    assert_eq!(hits[0]["peer_name"], "Bharat (Stores)");
    assert!(hits[0]["peer_avatar_color"].is_string());

    // A vote from the phone (my own key only); Bharat sees it on his copy.
    let my_vote = format!("vote:{}", asha);
    let r = ask(&mut ws, 5, json!({ "op": "card_action", "message_id": poll_id, "key": my_vote, "value": [0] })).await;
    assert_eq!(r["ok"], true, "{}", r);
    let state = r["message"]["card_state"].as_array().unwrap();
    assert_eq!(state.len(), 1, "{}", r);
    assert_eq!(state[0]["key"], my_vote.as_str());
    assert_eq!(state[0]["value"], json!([0]));
    assert_eq!(state[0]["peer_id"], asha.as_str());
    let r = ask(&mut ws, 6, json!({ "op": "card_action", "message_id": poll_id, "key": format!("vote:{}", bharat), "value": [1] })).await;
    assert_eq!(r["error"], "That can't be changed on this card.", "no voting for others");
    assert_eq!(ask(&mut ws, 7, json!({ "op": "card_action", "message_id": poll_id, "key": my_vote, "value": [0, 1] })).await["error"], "Pick one answer.");
    assert_eq!(ask(&mut ws, 8, json!({ "op": "card_action", "message_id": "nothing", "key": "closed", "value": true })).await["error"], "Message not found");
    {
        let (b_db, poll_id, key) = (b_db.clone(), poll_id.clone(), my_vote.clone());
        assert!(
            wait_for(|| b_db.get_message_full(&poll_id).unwrap().is_some_and(|m| m.card_state.iter().any(|e| e.key == key && e.value == json!([0]))), 10).await,
            "Bharat sees the vote"
        );
    }

    // A notice that asks to be acknowledged; Bharat ticks it on his PC and
    // the phone is told (the card with its new state).
    let r = ask(&mut ws, 9, json!({ "op": "card_send", "conv": conv_a, "card": { "kind": "notice", "title": "Fire drill", "body": "4 pm, assembly point B", "ack": true } })).await;
    assert_eq!(r["ok"], true, "{}", r);
    let notice_id = r["message"]["id"].as_str().unwrap().to_string();
    let notice: Value = serde_json::from_str(r["message"]["content"].as_str().unwrap()).unwrap();
    assert_eq!(notice["kind"], "notice");
    assert_eq!(notice["title"], "Fire drill");
    assert_eq!(notice["ack"], true);
    assert_eq!(notice["important"], false);
    {
        let (b_db, conv_b, notice_id) = (b_db.clone(), conv_b.clone(), notice_id.clone());
        assert!(wait_for(|| b_db.get_messages(&conv_b).unwrap().iter().any(|m| m.id == notice_id), 10).await, "Bharat got the notice");
    }
    let his_ack = format!("ack:{}", bharat);
    b.svc.card_action(&notice_id, &his_ack, &json!(true)).unwrap();
    let pushed = ws_wait(
        &mut ws,
        |v| v["ev"] == "message" && v["message"]["id"] == notice_id.as_str() && v["message"]["card_state"].as_array().is_some_and(|s| s.iter().any(|e| e["key"] == his_ack.as_str())),
        10,
    )
    .await
    .expect("Bharat's tick reached the phone");
    assert_eq!(pushed["message"]["card_state"][0]["value"], true);
    assert_eq!(pushed["message"]["card_state"][0]["peer_id"], bharat.as_str());
    assert_eq!(ask(&mut ws, 10, json!({ "op": "cards" })).await["hits"].as_array().unwrap().len(), 2);

    // Notes: saved (tidied, given an id), listed, changed, binned, listed in
    // the bin, restored, then removed for good.
    let r = ask(&mut ws, 11, json!({ "op": "note_save", "note": { "title": " Dolvi visit ", "body": "Call Marcus\r\nCheck PO 88", "color": "blue" } })).await;
    assert_eq!(r["ok"], true, "{}", r);
    let note_id = r["note"]["id"].as_str().unwrap().to_string();
    assert!(uuid::Uuid::parse_str(&note_id).is_ok(), "{}", r);
    assert_eq!(r["note"]["title"], "Dolvi visit");
    assert_eq!(r["note"]["body"], "Call Marcus\nCheck PO 88");
    assert_eq!(r["note"]["kind"], "note");
    assert_eq!(r["note"]["color"], "blue");
    assert!(r["note"]["created_at"].as_i64().unwrap() >= now);
    assert_eq!(r["note"]["deleted_at"], Value::Null);
    let r = ask(&mut ws, 12, json!({ "op": "notes" })).await;
    assert_eq!(r["notes"].as_array().unwrap().len(), 1, "{}", r);
    assert_eq!(r["notes"][0]["id"], note_id.as_str());
    let r = ask(&mut ws, 13, json!({ "op": "note_save", "note": { "id": note_id, "title": "Dolvi visit (done)", "body": "Called Marcus", "color": "neon", "pinned": true } })).await;
    assert_eq!(r["ok"], true, "{}", r);
    assert_eq!(r["note"]["id"], note_id.as_str());
    assert_eq!(r["note"]["title"], "Dolvi visit (done)");
    assert_eq!(r["note"]["color"], "yellow", "an unknown colour falls back");
    assert_eq!(r["note"]["pinned"], true);
    let r = ask(&mut ws, 14, json!({ "op": "notes" })).await;
    assert_eq!(r["notes"].as_array().unwrap().len(), 1, "{}", r);
    assert_eq!(r["notes"][0]["title"], "Dolvi visit (done)");
    assert_eq!(ask(&mut ws, 15, json!({ "op": "note_save" })).await["ok"], false, "no note given");
    let r = ask(&mut ws, 16, json!({ "op": "note_delete", "note_id": note_id })).await;
    assert_eq!(r["removed"], true, "{}", r);
    assert!(ask(&mut ws, 17, json!({ "op": "notes" })).await["notes"].as_array().unwrap().is_empty());
    let r = ask(&mut ws, 18, json!({ "op": "notes", "deleted": true })).await;
    assert_eq!(r["notes"].as_array().unwrap().len(), 1, "{}", r);
    assert_eq!(r["notes"][0]["id"], note_id.as_str());
    assert!(r["notes"][0]["deleted_at"].is_i64());
    assert_eq!(ask(&mut ws, 19, json!({ "op": "note_delete", "note_id": note_id })).await["removed"], false, "already in the bin");
    let r = ask(&mut ws, 20, json!({ "op": "note_restore", "note_id": note_id })).await;
    assert_eq!(r["restored"], true, "{}", r);
    assert_eq!(ask(&mut ws, 21, json!({ "op": "notes" })).await["notes"].as_array().unwrap().len(), 1);
    assert!(ask(&mut ws, 22, json!({ "op": "notes", "deleted": true })).await["notes"].as_array().unwrap().is_empty());
    assert_eq!(ask(&mut ws, 23, json!({ "op": "note_restore", "note_id": "nothing" })).await["restored"], false);
    assert_eq!(ask(&mut ws, 24, json!({ "op": "note_delete", "note_id": note_id, "for_good": true })).await["removed"], true);
    assert!(ask(&mut ws, 25, json!({ "op": "notes" })).await["notes"].as_array().unwrap().is_empty());
    assert!(ask(&mut ws, 26, json!({ "op": "notes", "deleted": true })).await["notes"].as_array().unwrap().is_empty());

    // Calendar: an event today, found in the day's window, then deleted.
    let start = now + 3600;
    let r = ask(&mut ws, 27, json!({ "op": "event_save", "event": { "title": " Site review ", "start": start, "end": start + 1800, "color": "green", "location": "Gate 2" } })).await;
    assert_eq!(r["ok"], true, "{}", r);
    let event_id = r["event"]["id"].as_str().unwrap().to_string();
    assert!(uuid::Uuid::parse_str(&event_id).is_ok(), "{}", r);
    assert_eq!(r["event"]["title"], "Site review");
    assert_eq!(r["event"]["start"], start);
    assert_eq!(r["event"]["end"], start + 1800);
    assert_eq!(r["event"]["repeat"], "none");
    assert_eq!(r["event"]["all_day"], false);
    let r = ask(&mut ws, 28, json!({ "op": "events", "from": now - 86_400, "to": now + 86_400 })).await;
    let occ = r["occurrences"].as_array().unwrap();
    assert_eq!(occ.len(), 1, "{}", r);
    assert_eq!(occ[0]["event"]["id"], event_id.as_str());
    assert_eq!(occ[0]["event"]["location"], "Gate 2");
    assert_eq!(occ[0]["start"], start);
    assert_eq!(occ[0]["end"], start + 1800);
    assert!(ask(&mut ws, 29, json!({ "op": "events", "from": now + 7200, "to": now + 86_400 })).await["occurrences"].as_array().unwrap().is_empty());
    assert_eq!(ask(&mut ws, 30, json!({ "op": "events", "from": now, "to": now - 5 })).await["error"], "Pick a shorter period.");
    let r = ask(&mut ws, 31, json!({ "op": "events_all" })).await;
    assert_eq!(r["events"].as_array().unwrap().len(), 1, "{}", r);
    assert_eq!(r["events"][0]["id"], event_id.as_str());
    assert_eq!(ask(&mut ws, 32, json!({ "op": "event_save", "event": { "title": "No time" } })).await["ok"], false, "start and end are needed");
    let r = ask(&mut ws, 33, json!({ "op": "event_delete", "event_id": event_id })).await;
    assert_eq!(r["removed"], true, "{}", r);
    assert!(ask(&mut ws, 34, json!({ "op": "events", "from": now - 86_400, "to": now + 86_400 })).await["occurrences"].as_array().unwrap().is_empty());
    assert!(ask(&mut ws, 35, json!({ "op": "events_all" })).await["events"].as_array().unwrap().is_empty());
    assert_eq!(ask(&mut ws, 36, json!({ "op": "event_delete", "event_id": event_id })).await["removed"], false, "already gone");
}

/// LANX 3.2: the person behind the phone — settings, status, profile, out of
/// office — plus an emergency alert and a game step, each going through the
/// PC the way the desktop's own do, with Bharat hearing about it and his
/// answers coming back to the phone as pushes.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_phone_sets_status_raises_alerts_and_plays_games() {
    let a = node("Asha (Accounts)").await;
    let b = node("Bharat (Stores)").await;
    let _conv_a = link(&a, &b).await;
    let (_phone, mut ws, _cancel) = paired_phone(&a).await;
    let asha = a.svc.identity.device_id.clone();
    let bharat = b.svc.identity.device_id.clone();
    let a_db = a.svc.db.clone();
    let b_db = b.svc.db.clone();
    let now = crate::networking::now_secs();

    // Settings: the person, never the PC's ports, paths or PIN; hello
    // carries the same.
    let r = ask(&mut ws, 1, json!({ "op": "settings" })).await;
    assert_eq!(r["ok"], true, "{}", r);
    let s = &r["settings"];
    assert_eq!(s["display_name"], "Asha (Accounts)");
    assert_eq!(s["device_id"], asha.as_str());
    assert!(s["hostname"].is_string() && s["avatar_color"].is_string() && s["theme"].is_string(), "{}", s);
    for secret in ["tcp_messaging_port", "udp_discovery_port", "default_download_dir", "pin_enabled", "auto_lock_minutes", "custom_sound_path", "apps"] {
        assert!(s.get(secret).is_none(), "{} is the PC's business", secret);
    }
    assert_eq!(s["quick_replies"].as_array().unwrap().len(), 6);
    assert_eq!(s["read_receipts"], true);
    assert_eq!(s["reception_desk"], false);
    assert_eq!(s["profile"]["status"], "");
    assert_eq!(s["out_of_office"]["enabled"], false);
    assert_eq!(s["quiet_hours"]["enabled"], false);
    let hello = ask(&mut ws, 2, json!({ "op": "hello" })).await;
    assert_eq!(hello["settings"]["display_name"], "Asha (Accounts)", "{}", hello);
    assert!(hello["settings"].get("tcp_messaging_port").is_none());

    // Status: busy with a note; what colleagues get (and what the discovery
    // beacon fingerprints) follows at once.
    let rev = a.svc.local_profile_rev();
    let until = now + 3600;
    let r = ask(&mut ws, 3, json!({ "op": "status_set", "status": "busy", "status_text": " Month end ", "status_until": until })).await;
    assert_eq!(r["ok"], true, "{}", r);
    assert_eq!(r["profile"]["status"], "busy");
    assert_eq!(r["profile"]["status_text"], "Month end");
    assert_eq!(r["profile"]["status_until"], until);
    let s = ask(&mut ws, 4, json!({ "op": "settings" })).await["settings"].clone();
    assert_eq!(s["profile"]["status"], "busy", "{}", s);
    assert_eq!(s["profile"]["status_text"], "Month end");
    assert_eq!(a.svc.local_profile_full().status, "busy");
    assert_ne!(a.svc.local_profile_rev(), rev, "colleagues' beacon fingerprint changes");
    let r = ask(&mut ws, 5, json!({ "op": "status_set", "status": "flying", "status_text": "", "status_until": 0 })).await;
    assert_eq!(r["ok"], false);
    assert_eq!(r["error"], "Unknown status");
    assert_eq!(a.svc.local_profile_full().status, "busy", "a bad status changes nothing");

    // The whole profile (what is sent replaces what was there), tidied.
    let r = ask(&mut ws, 6, json!({ "op": "profile_save", "profile": { "title": " Accountant ", "department": "Accounts", "status": "meeting", "avatar": "emoji:🐼", "bio": "Numbers person" } })).await;
    assert_eq!(r["ok"], true, "{}", r);
    assert_eq!(r["profile"]["title"], "Accountant");
    assert_eq!(r["profile"]["department"], "Accounts");
    assert_eq!(r["profile"]["status"], "meeting");
    assert_eq!(r["profile"]["status_text"], "");
    assert_eq!(r["profile"]["avatar"], "emoji:🐼");
    let saved = a_db.get_settings().unwrap().profile;
    assert_eq!((saved.title.as_str(), saved.status.as_str(), saved.bio.as_str()), ("Accountant", "meeting", "Numbers person"));
    assert_eq!(a.svc.local_profile_full().title, "Accountant");
    assert_eq!(ask(&mut ws, 7, json!({ "op": "profile_save", "profile": "nope" })).await["ok"], false);
    // The status cleared from the phone keeps the rest of the profile.
    let r = ask(&mut ws, 8, json!({ "op": "status_set", "status": "", "status_text": "", "status_until": 0 })).await;
    assert_eq!(r["profile"]["status"], "", "{}", r);
    assert_eq!(r["profile"]["title"], "Accountant");

    // Out of office: on with a message, then off.
    let r = ask(&mut ws, 9, json!({ "op": "ooo_set", "enabled": true, "until": 0, "message": " Back Monday " })).await;
    assert_eq!(r["ok"], true, "{}", r);
    assert_eq!(r["out_of_office"], json!({ "enabled": true, "until": 0, "message": "Back Monday" }));
    let s = ask(&mut ws, 10, json!({ "op": "settings" })).await["settings"].clone();
    assert_eq!(s["out_of_office"]["enabled"], true, "{}", s);
    assert_eq!(s["out_of_office"]["message"], "Back Monday");
    assert!(a_db.get_settings().unwrap().out_of_office.active(now));
    let r = ask(&mut ws, 11, json!({ "op": "ooo_set", "enabled": false, "until": 0, "message": "Back Monday" })).await;
    assert_eq!(r["out_of_office"]["enabled"], false, "{}", r);
    assert!(!a_db.get_settings().unwrap().out_of_office.active(now));

    // An emergency alert raised from the phone: the phone hears it as a push
    // like the window does, Bharat's PC gets it, his "I'm safe" comes back
    // to the phone, and the all-clear goes out from the phone.
    let r = ask_and_push(&mut ws, 12, json!({ "op": "alert_raise", "kind": "medical", "text": " First aid at the gate " }), |v| {
        v["ev"] == "alert" && v["alert"]["kind"] == "medical"
    })
    .await;
    assert_eq!(r["ok"], true, "{}", r);
    assert_eq!(r["alert"]["mine"], true);
    assert_eq!(r["alert"]["text"], "First aid at the gate");
    assert_eq!(r["alert"]["from_name"], "Asha (Accounts)");
    assert_eq!(r["alert"]["sent_to"], json!(["Bharat (Stores)"]));
    assert_eq!(r["alert"]["cleared_at"], Value::Null);
    let alert_id = r["alert"]["id"].as_str().unwrap().to_string();
    {
        let (b_db, alert_id) = (b_db.clone(), alert_id.clone());
        assert!(wait_for(|| b_db.alert(&alert_id).unwrap().is_some(), 10).await, "Bharat got the alert");
    }
    let got = b_db.alert(&alert_id).unwrap().unwrap();
    assert!(!got.mine && got.kind == "medical" && got.from_name == "Asha (Accounts)" && got.text == "First aid at the gate");
    let r = ask(&mut ws, 13, json!({ "op": "alerts" })).await;
    assert_eq!(r["alerts"].as_array().unwrap().len(), 1, "{}", r);
    assert_eq!(r["alerts"][0]["id"], alert_id.as_str());
    assert_eq!(ask(&mut ws, 14, json!({ "op": "alert_raise", "kind": "fire", "text": "" })).await["error"], "An alert was just sent.");
    assert_eq!(ask(&mut ws, 15, json!({ "op": "alert_answer", "alert_id": alert_id, "status": "safe" })).await["error"], "That's your own alert.");
    b.svc.answer_alert(&alert_id, "safe").await.unwrap();
    let pushed = ws_wait(
        &mut ws,
        |v| v["ev"] == "alert" && v["alert"]["id"] == alert_id.as_str() && v["alert"]["acks"].as_array().is_some_and(|x| !x.is_empty()),
        10,
    )
    .await
    .expect("Bharat's answer reached the phone");
    assert_eq!(pushed["alert"]["acks"][0]["name"], "Bharat (Stores)");
    assert_eq!(pushed["alert"]["acks"][0]["status"], "safe");
    let r = ask(&mut ws, 16, json!({ "op": "alert_clear", "alert_id": alert_id })).await;
    assert_eq!(r["ok"], true, "{}", r);
    assert!(r["alert"]["cleared_at"].is_i64());
    {
        let (b_db, alert_id) = (b_db.clone(), alert_id.clone());
        assert!(wait_for(|| b_db.alert(&alert_id).unwrap().unwrap().cleared_at.is_some(), 10).await, "Bharat got the all-clear");
    }
    assert_eq!(ask(&mut ws, 17, json!({ "op": "alert_clear", "alert_id": "nothing" })).await["error"], "Alert not found");

    // A game step to Bharat: his LANX takes it and hands it to his window.
    let mut tap = b.svc.events.subscribe().expect("Bharat's events");
    let r = ask(&mut ws, 18, json!({ "op": "game_send", "peer_id": bharat, "step": { "match_id": "m1", "game": "tictactoe", "action": "accept", "seq": 0, "data": null } })).await;
    assert_eq!(r["ok"], true, "{}", r);
    assert_eq!(r["sent"], true);
    let step = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let ev = tap.recv().await.expect("Bharat's event tap");
            if ev.0 == "lanx://game" {
                break ev.1.clone();
            }
        }
    })
    .await
    .expect("Bharat's LANX got the step");
    assert_eq!(step["from_id"], asha.as_str());
    assert_eq!(step["from_name"], "Asha (Accounts)");
    assert_eq!(step["match_id"], "m1");
    assert_eq!(step["game"], "tictactoe");
    assert_eq!(step["action"], "accept");
    assert_eq!(step["seq"], 0);
    assert_eq!(step["data"], Value::Null);
    assert!(step["at"].as_i64().unwrap() >= now);
    let r = ask(&mut ws, 19, json!({ "op": "game_send", "peer_id": "nobody", "step": { "match_id": "m1", "game": "tictactoe", "action": "accept" } })).await;
    assert_eq!(r["error"], "Colleague not found", "{}", r);
    assert_eq!(ask(&mut ws, 20, json!({ "op": "game_send", "peer_id": bharat, "step": { "match_id": "m1", "game": "tictactoe", "action": "cheat" } })).await["error"], "Unknown step.");
    assert_eq!(ask(&mut ws, 21, json!({ "op": "game_send", "peer_id": bharat, "step": { "match_id": "m1", "game": "chaupar", "action": "move" } })).await["error"], "Unknown game.");
    assert_eq!(ask(&mut ws, 22, json!({ "op": "game_send", "peer_id": bharat })).await["ok"], false, "no step");
    // Bharat's move comes to the phone as a push, the way the window gets it.
    let mv = GamePayload { match_id: "m1".to_string(), game: "tictactoe".to_string(), action: "move".to_string(), seq: 1, data: json!({ "cell": 4 }), at: 0 };
    assert!(b.svc.send_game(&asha, mv).await.unwrap());
    let pushed = ws_wait(&mut ws, |v| v["ev"] == "game" && v["match_id"] == "m1", 10).await.expect("the move reached the phone");
    assert_eq!(pushed["from_id"], bharat.as_str());
    assert_eq!(pushed["from_name"], "Bharat (Stores)");
    assert_eq!(pushed["game"], "tictactoe");
    assert_eq!(pushed["action"], "move");
    assert_eq!(pushed["seq"], 1);
    assert_eq!(pushed["data"]["cell"], 4);
    assert!(pushed["at"].is_i64());
}

/// Waits for an engine event (name + test) on a tap; the payload, or None.
async fn tap_wait<F: Fn(&Value) -> bool>(tap: &mut tokio::sync::broadcast::Receiver<Arc<crate::events::TapEvent>>, name: &str, pred: F, secs: u64) -> Option<Value> {
    tokio::time::timeout(Duration::from_secs(secs), async {
        loop {
            match tap.recv().await {
                Ok(ev) if ev.0 == name && pred(&ev.1) => break Some(ev.1.clone()),
                Ok(_) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => break None,
            }
        }
    })
    .await
    .ok()
    .flatten()
}

/// LANX 3.2: voice and video calls on the phone. The PC does the signalling;
/// the phone makes the offer or the answer and carries the call. Whichever
/// device answers first takes it, and the other stops ringing.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_phone_makes_and_takes_calls_through_the_pc() {
    let a = node("Asha (Accounts)").await;
    let b = node("Bharat (Stores)").await;
    let conv_a = link(&a, &b).await;
    let (_phone, mut ws, _cancel) = paired_phone(&a).await;
    let hello = ask(&mut ws, 1, json!({ "op": "hello" })).await;
    let me = hello["device_id"].as_str().unwrap_or("").to_string();
    assert!(!me.is_empty(), "hello names this phone: {}", hello);
    let b_conv = b.svc.db.get_or_create_conversation(&a.svc.identity.device_id).unwrap().id;
    let mut bt = b.svc.events.subscribe().expect("Bharat's events");

    // 1. The phone calls Bharat: his PC rings with the phone's offer.
    let r = ask_and_push(&mut ws, 2, json!({ "op": "call_start", "conv": conv_a, "video": false, "sdp": "v=0 offer-from-the-phone" }), |v| v["ev"] == "call" && v["action"] == "outgoing").await;
    assert_eq!(r["ok"], true, "{}", r);
    assert_eq!(r["call"]["on_phone"], me.as_str());
    assert_eq!(r["call"]["outgoing"], true);
    let call_id = r["call"]["call_id"].as_str().unwrap().to_string();
    let incoming = tap_wait(&mut bt, "lanx://call", |p| p["action"] == "incoming", 10).await.expect("Bharat's PC rings");
    assert_eq!(incoming["sdp"], "v=0 offer-from-the-phone");
    assert_eq!(a.svc.current_call().unwrap().on_phone.as_deref(), Some(me.as_str()));
    // A second call while one is on is refused.
    let r = ask(&mut ws, 3, json!({ "op": "call_start", "conv": conv_a, "video": false, "sdp": "v=0 x" })).await;
    assert_eq!(r["ok"], false);
    // Bharat answers: the phone gets his answer.
    b.svc.answer_call(&call_id, "v=0 answer-from-bharat".to_string(), false).await.unwrap();
    let accepted = ws_wait(&mut ws, |v| v["ev"] == "call" && v["action"] == "accepted", 10).await.expect("the phone hears the answer");
    assert_eq!(accepted["sdp"], "v=0 answer-from-bharat");
    assert_eq!(a.svc.current_call().unwrap().phase, "active");
    // Mute on the phone reaches Bharat.
    let r = ask(&mut ws, 4, json!({ "op": "call_media", "call_id": call_id, "muted": true })).await;
    assert_eq!(r["ok"], true, "{}", r);
    let media = tap_wait(&mut bt, "lanx://call", |p| p["action"] == "media", 10).await.expect("Bharat sees the mute");
    assert_eq!(media["muted"], true);
    // The phone hangs up: both ends close, and the chat shows the call.
    let r = ask(&mut ws, 5, json!({ "op": "call_hangup", "call_id": call_id })).await;
    assert_eq!(r["ok"], true, "{}", r);
    assert!(a.svc.current_call().is_none());
    let ended = tap_wait(&mut bt, "lanx://call", |p| p["action"] == "ended", 10).await.expect("Bharat's call ends");
    assert_eq!(ended["reason"], "hangup");
    assert!(wait_for(|| b.svc.current_call().is_none(), 5).await);
    let calls: Vec<_> = a.svc.db.get_messages(&conv_a).unwrap().into_iter().filter(|m| m.message_type == "call").collect();
    assert_eq!(calls.len(), 1);
    assert!(calls[0].content.contains("\"outcome\":\"answered\""), "{}", calls[0].content);

    // 2. Bharat video-calls Asha: the phone rings with his offer and takes it.
    let call = b.svc.start_call(&b_conv, true, "v=0 offer-from-bharat".to_string(), None).await.unwrap();
    let ring = ws_wait(&mut ws, |v| v["ev"] == "call" && v["action"] == "incoming", 10).await.expect("the phone rings");
    assert_eq!(ring["sdp"], "v=0 offer-from-bharat");
    assert_eq!(ring["call"]["video"], true);
    // A page that opens now can still answer: the PC keeps the offer.
    let got = ask(&mut ws, 6, json!({ "op": "call_get" })).await;
    assert_eq!(got["call"]["call_id"], call.call_id.as_str());
    assert_eq!(got["offer"], "v=0 offer-from-bharat");
    let r = ask_and_push(&mut ws, 7, json!({ "op": "call_answer", "call_id": call.call_id, "sdp": "v=0 answer-from-the-phone", "video": true }), |v| v["ev"] == "call" && v["action"] == "answered").await;
    assert_eq!(r["ok"], true, "{}", r);
    assert_eq!(a.svc.current_call().unwrap().on_phone.as_deref(), Some(me.as_str()));
    let accepted = tap_wait(&mut bt, "lanx://call", |p| p["action"] == "accepted", 10).await.expect("Bharat gets the phone's answer");
    assert_eq!(accepted["sdp"], "v=0 answer-from-the-phone");
    // Hanging up on the PC (its "on your phone" pill) ends the phone's call too.
    a.svc.hangup_call(&call.call_id).await.unwrap();
    let ended = ws_wait(&mut ws, |v| v["ev"] == "call" && v["action"] == "ended", 10).await.expect("the phone's call ends");
    assert_eq!(ended["reason"], "hangup_here");
    assert!(tap_wait(&mut bt, "lanx://call", |p| p["action"] == "ended", 10).await.is_some());

    // 3. The phone declines: Bharat hears "declined", the PC stops ringing.
    let call = b.svc.start_call(&b_conv, false, "v=0 offer-2".to_string(), None).await.unwrap();
    ws_wait(&mut ws, |v| v["ev"] == "call" && v["action"] == "incoming", 10).await.expect("rings again");
    let r = ask(&mut ws, 8, json!({ "op": "call_decline", "call_id": call.call_id })).await;
    assert_eq!(r["ok"], true, "{}", r);
    assert!(a.svc.current_call().is_none());
    let ended = tap_wait(&mut bt, "lanx://call", |p| p["action"] == "ended", 10).await.expect("Bharat hears the decline");
    assert_eq!(ended["reason"], "declined");

    // 4. The PC answers first: the phone is told, and its own answer is refused.
    let call = b.svc.start_call(&b_conv, false, "v=0 offer-3".to_string(), None).await.unwrap();
    ws_wait(&mut ws, |v| v["ev"] == "call" && v["action"] == "incoming", 10).await.expect("rings a third time");
    a.svc.answer_call(&call.call_id, "v=0 answer-from-the-pc".to_string(), false).await.unwrap();
    let answered = ws_wait(&mut ws, |v| v["ev"] == "call" && v["action"] == "answered", 10).await.expect("the phone hears the PC answered");
    assert_eq!(answered["call"]["on_phone"], Value::Null);
    let r = ask(&mut ws, 9, json!({ "op": "call_answer", "call_id": call.call_id, "sdp": "v=0 late", "video": false })).await;
    assert_eq!(r["ok"], false);
    assert_eq!(r["error"], "This call has ended.");
    b.svc.hangup_call(&call.call_id).await.unwrap();
    let ended = ws_wait(&mut ws, |v| v["ev"] == "call" && v["action"] == "ended", 10).await.expect("the phone sees it end");
    assert_eq!(ended["reason"], "hangup");

    // 5. Remote help stays on the PC.
    let call = b.svc.start_call(&b_conv, false, "v=0 offer-help".to_string(), Some("view".to_string())).await.unwrap();
    ws_wait(&mut ws, |v| v["ev"] == "call" && v["action"] == "incoming", 10).await.expect("help rings");
    let r = ask(&mut ws, 10, json!({ "op": "call_answer", "call_id": call.call_id, "sdp": "v=0 nope", "video": false })).await;
    assert_eq!(r["ok"], false);
    assert!(r["error"].as_str().unwrap_or("").contains("Remote help"), "{}", r);
    b.svc.hangup_call(&call.call_id).await.unwrap();
    assert!(wait_for(|| a.svc.current_call().is_none(), 5).await);

    // 6. A locked PC: no calls from the phone.
    a.svc.privacy.lock();
    let r = ask(&mut ws, 11, json!({ "op": "call_start", "conv": conv_a, "video": false, "sdp": "v=0 locked" })).await;
    assert_eq!(r["error"], "LOCKED");
}

/// LANX 3.3: the PIN from the phone (unlock, hidden chats, lock), secret
/// messages, ring, broadcast, memes kept and sent by the PC, and what an IT
/// ticket says about this PC.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_phone_unlocks_hides_and_sends_secret_broadcast_and_memes() {
    let a = node("Asha (Accounts)").await;
    let b = node("Bharat (Stores)").await;
    let conv_a = link(&a, &b).await;
    let (_phone, mut ws, _cancel) = paired_phone(&a).await;
    let port = _phone.port();
    let token = {
        // A second pairing gives a token this test can use over plain HTTP too.
        let info = _phone.start_pairing();
        let request = _phone.claim(&info.code, "Chrome on Android phone", "127.0.0.1").unwrap();
        _phone.answer(&request, true).unwrap();
        _phone.poll(&request).token.unwrap()
    };
    let cookie = format!("lanx_phone={}", token);

    // No PIN yet: "lock" is refused, hiding a chat too.
    let r = ask(&mut ws, 1, json!({ "op": "lock" })).await;
    assert_eq!(r["ok"], false);
    assert!(r["error"].as_str().unwrap().contains("PIN"), "{}", r);
    let hello = ask(&mut ws, 2, json!({ "op": "hello" })).await;
    assert_eq!(hello["lock"]["pin_set"], false);
    assert_eq!(hello["lock"]["locked"], false);

    // A PIN set on the PC; the phone locks the PC, and unlocks it with the PIN.
    crate::privacy::set_pin(&a.svc.db, None, Some("4321")).unwrap();
    let r = ask(&mut ws, 3, json!({ "op": "lock" })).await;
    assert_eq!(r["ok"], true, "{}", r);
    assert_eq!(r["status"]["locked"], true);
    assert!(a.svc.privacy.is_locked());
    let r = ask(&mut ws, 4, json!({ "op": "hello" })).await;
    assert_eq!(r["error"], "LOCKED");
    let r = ask(&mut ws, 5, json!({ "op": "lock_status" })).await;
    assert_eq!(r["status"]["locked"], true);
    assert_eq!(r["status"]["pin_set"], true);
    let r = ask(&mut ws, 6, json!({ "op": "unlock", "pin": "0000" })).await;
    assert_eq!(r["ok"], false);
    assert_eq!(r["error"], "Wrong PIN.");
    assert!(a.svc.privacy.is_locked());
    let r = ask(&mut ws, 7, json!({ "op": "unlock", "pin": "4321" })).await;
    assert_eq!(r["ok"], true, "{}", r);
    assert_eq!(r["status"]["locked"], false);
    assert!(!a.svc.privacy.is_locked());

    // Hide the chat with Bharat; it vanishes until the PIN shows hidden chats.
    let r = ask(&mut ws, 8, json!({ "op": "chat_hide", "conv": conv_a, "hidden": true })).await;
    assert_eq!(r["ok"], true, "{}", r);
    assert!(r["conversations"].as_array().unwrap().iter().all(|c| c["id"] != conv_a.as_str()));
    let r = ask(&mut ws, 9, json!({ "op": "messages", "conv": conv_a })).await;
    assert_eq!(r["error"], "HIDDEN");
    let r = ask(&mut ws, 10, json!({ "op": "unlock_hidden", "pin": "1111" })).await;
    assert_eq!(r["ok"], false);
    let r = ask(&mut ws, 11, json!({ "op": "unlock_hidden", "pin": "4321" })).await;
    assert_eq!(r["ok"], true, "{}", r);
    assert_eq!(r["status"]["hidden_unlocked"], true);
    assert!(r["conversations"].as_array().unwrap().iter().any(|c| c["id"] == conv_a.as_str() && c["is_hidden"] == true));
    let r = ask(&mut ws, 12, json!({ "op": "chat_hide", "conv": conv_a, "hidden": false })).await;
    assert_eq!(r["ok"], true, "{}", r);
    let r = ask(&mut ws, 13, json!({ "op": "hide_hidden" })).await;
    assert_eq!(r["status"]["hidden_unlocked"], false);
    assert!(r["conversations"].as_array().unwrap().iter().any(|c| c["id"] == conv_a.as_str()), "unhidden chats stay listed");

    // Secret messages: 5 minutes, then off; bad timers are refused.
    let r = ask(&mut ws, 14, json!({ "op": "secret", "conv": conv_a, "ttl": 300 })).await;
    assert_eq!(r["ok"], true, "{}", r);
    assert_eq!(r["message"]["message_type"], "secret_setting");
    assert_eq!(r["conversation"]["secret_ttl"], 300);
    let r = ask(&mut ws, 15, json!({ "op": "send", "conv": conv_a, "text": "this disappears" })).await;
    assert_eq!(r["message"]["ttl_secs"], 300);
    let r = ask(&mut ws, 16, json!({ "op": "secret", "conv": conv_a, "ttl": 7 })).await;
    assert_eq!(r["ok"], false);
    let r = ask(&mut ws, 17, json!({ "op": "secret", "conv": conv_a, "ttl": 0 })).await;
    assert_eq!(r["conversation"]["secret_ttl"], 0);
    let b_db = b.svc.db.clone();
    assert!(wait_for(|| b_db.get_conversations(true).unwrap().first().is_some_and(|c| c.secret_ttl == 0), 10).await);

    // Ring Bharat.
    let r = ask(&mut ws, 18, json!({ "op": "ring", "conv": conv_a })).await;
    assert_eq!(r["ok"], true, "{}", r);

    // Broadcast to Bharat.
    let bharat = b.svc.identity.device_id.clone();
    let r = ask(&mut ws, 19, json!({ "op": "broadcast", "peer_ids": [bharat], "text": "Office closes at 5 today" })).await;
    assert_eq!(r["ok"], true, "{}", r);
    assert_eq!(r["sent_to"], 1);
    assert!(
        wait_for(|| b_db.get_conversations(true).unwrap().first().is_some_and(|c| b_db.get_messages(&c.id).unwrap().iter().any(|m| m.content == "Office closes at 5 today")), 10).await,
        "Bharat got the broadcast"
    );
    let r = ask(&mut ws, 20, json!({ "op": "broadcast", "peer_ids": [], "text": "nobody" })).await;
    assert_eq!(r["ok"], false);

    // A meme made on the phone is kept on the PC and sent from there; any
    // other file on the PC is refused.
    let png: Vec<u8> = std::iter::once(0x89u8).chain(b"PNG\r\n\x1a\n".iter().copied()).chain((0..2000u32).map(|i| (i % 251) as u8)).collect();
    let saved = http(port, "POST", "/api/meme?ext=png&name=when%20the%20client", &[("Cookie", &cookie)], &png).await;
    assert_eq!(saved.status, 200, "{}", String::from_utf8_lossy(&saved.body));
    let file = saved.json()["file"].as_str().unwrap().to_string();
    assert!(file.contains("when-the-client"), "{}", file);
    let r = ask(&mut ws, 21, json!({ "op": "meme_send", "conv": conv_a, "file": file })).await;
    assert_eq!(r["ok"], true, "{}", r);
    assert_eq!(r["message"]["message_type"], "file");
    let elsewhere = a._dir.path().join("secret.txt");
    std::fs::write(&elsewhere, b"not a meme").unwrap();
    let r = ask(&mut ws, 22, json!({ "op": "meme_send", "conv": conv_a, "file": elsewhere.to_string_lossy() })).await;
    assert_eq!(r["ok"], false);
    assert!(r["error"].as_str().unwrap().contains("not one of LANX's memes"), "{}", r);
    let r = ask(&mut ws, 23, json!({ "op": "meme_download", "url": "https://example.com/x.png", "ext": "png", "name": "x" })).await;
    assert_eq!(r["ok"], false, "only the meme services LANX knows");
    assert_eq!(http(port, "POST", "/api/meme?ext=png", &[], &png).await.status, 401);

    // What an IT ticket says about this PC; the saved IT helpers.
    let r = ask(&mut ws, 24, json!({ "op": "system_info" })).await;
    assert_eq!(r["info"]["device_id"], a.svc.identity.device_id.as_str());
    assert!(r["info"]["app_version"].as_str().is_some());
    a.svc.db.set_setting("it_helpers", &serde_json::to_string(&vec![bharat.clone()]).unwrap()).unwrap();
    let r = ask(&mut ws, 25, json!({ "op": "it_helpers" })).await;
    assert_eq!(r["ids"], json!([bharat]));

    // The phone sees the lock change pushed when the PC locks.
    a.svc.privacy.lock();
    a.svc.events.emit_json("lanx://lock-changed", a.svc.privacy.status(&a.svc.db));
    let pushed = ws_wait(&mut ws, |v| v["ev"] == "lock", 10).await.expect("lock push");
    assert_eq!(pushed["locked"], true);
    assert_eq!(pushed["pin_set"], true);
}
