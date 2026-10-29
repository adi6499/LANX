//! Tests for "LANX on your phone": the pieces (frames, ranges, pairing) and
//! a real phone session against two LANX engines on loopback.

use super::http::{parse_range, percent_decode};
use super::ws::{OP_CLOSE, OP_PING, OP_PONG, OP_TEXT, accept_key, encode_frame, read_frame};
use super::{PhoneService, device_name_from_ua};
use crate::events::Events;
use crate::networking::NetworkService;
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
