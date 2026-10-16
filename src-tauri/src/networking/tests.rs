//! End-to-end tests: two (or three) complete LANX network services talking
//! over loopback with real sockets, encryption and SQLite.

use super::protocol::*;
use super::transfer::{sanitize_file_name, unique_destination};
use super::{NetworkService, SeenPeer, now_secs};
use crate::events::Events;
use crate::security::DeviceIdentity;
use crate::storage::Database;
use crate::storage::models::{Message, Peer};
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::io::Cursor;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::net::TcpListener;

struct Node {
    svc: NetworkService,
    port: u16,
    dir: tempfile::TempDir,
}

impl Node {
    fn id(&self) -> String {
        self.svc.identity.device_id.clone()
    }
    fn db(&self) -> &Database {
        &self.svc.db
    }
}

fn new_service(name: &str) -> (NetworkService, tempfile::TempDir) {
    let db = Arc::new(Database::new_in_memory().unwrap());
    let identity = DeviceIdentity::load_or_create(&db.conn.lock()).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let mut s = db.get_settings().unwrap();
    s.display_name = name.to_string();
    s.default_download_dir = dir.path().join("Downloads").to_string_lossy().to_string();
    s.onboarding_completed = true;
    db.save_settings(&s).unwrap();
    (NetworkService::new(db, identity, Events::default()), dir)
}

async fn serve_on(svc: &NetworkService, port: u16) -> u16 {
    let listener = TcpListener::bind(("127.0.0.1", port)).await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let s = svc.clone();
    tokio::spawn(async move { s.serve(listener).await });
    assert!(wait_for(|| svc.is_listening(), 5).await);
    port
}

async fn node(name: &str) -> Node {
    let (svc, dir) = new_service(name);
    let port = serve_on(&svc, 0).await;
    Node { svc, port, dir }
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

fn free_port() -> u16 {
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    l.local_addr().unwrap().port()
}

/// A connects to B by IP (like "Connect by IP") and returns A's conversation id.
async fn link(a: &Node, b: &Node) -> String {
    let peer = a
        .svc
        .connect_manual_peer("127.0.0.1", b.port, None)
        .await
        .unwrap();
    assert_eq!(peer.id, b.id(), "handshake must reveal B's real device id");
    a.db().get_or_create_conversation(&peer.id).unwrap().id
}

fn msg_status(db: &Database, id: &str) -> String {
    db.get_message_by_id(id).unwrap().map(|m| m.status).unwrap_or_default()
}

fn transfer_status(db: &Database, id: &str) -> String {
    db.get_transfer(id).unwrap().map(|t| t.status).unwrap_or_default()
}

fn write_random_file(dir: &std::path::Path, name: &str, size: usize) -> (std::path::PathBuf, Vec<u8>) {
    let mut data = vec![0u8; size];
    rand::thread_rng().fill_bytes(&mut data);
    let path = dir.join(name);
    std::fs::write(&path, &data).unwrap();
    (path, data)
}

// ------------------------------------------------------------ protocol

#[test]
fn signature_detects_tampering() {
    let (svc, _d) = new_service("Alice");
    let packet = PacketEnvelope::new(
        &svc.identity,
        "Alice",
        Some("corr-1".to_string()),
        PacketPayload::Message(MessagePayload {
            message_id: "m".into(),
            conversation_id: "c".into(),
            content: "hello".into(),
            message_type: "text".into(),
            ttl_secs: None,
            group_id: None,
        }),
    );
    assert_eq!(packet.verify_signature(), Ok(true));

    let mut t = packet.clone();
    t.sender_name = "Mallory".into();
    assert_eq!(t.verify_signature(), Ok(false));

    let mut t = packet.clone();
    t.correlation_id = Some("corr-2".into());
    assert_eq!(t.verify_signature(), Ok(false), "correlation id must be signed");

    let mut t = packet;
    t.version = 1;
    assert!(t.verify_signature().is_err(), "v1 packets are rejected");
}

#[tokio::test]
async fn oversized_and_truncated_frames_are_rejected() {
    let mut buf = Vec::new();
    buf.extend_from_slice(&(100_000u32).to_be_bytes());
    buf.extend_from_slice(&[0u8; 100]);
    let err = read_framed_packet(&mut Cursor::new(buf)).await.unwrap_err();
    assert!(err.to_string().contains("strict maximum limit"));

    let mut buf = Vec::new();
    buf.extend_from_slice(&(50u32).to_be_bytes());
    buf.extend_from_slice(b"{\"packet_i");
    assert!(read_framed_packet(&mut Cursor::new(buf)).await.is_err());
}

#[test]
fn file_names_from_other_computers_are_made_safe() {
    assert_eq!(sanitize_file_name("..\\..\\Windows\\evil.exe"), "evil.exe");
    assert_eq!(sanitize_file_name("../etc/passwd"), "passwd");
    assert_eq!(sanitize_file_name("a<b>c:d|e?.txt"), "a_b_c_d_e_.txt");
    assert_eq!(sanitize_file_name("CON.txt"), "_CON.txt");
    assert_eq!(sanitize_file_name("report. "), "report");
    assert_eq!(sanitize_file_name(""), "file");
    assert_eq!(sanitize_file_name("..."), "file");
    assert_eq!(sanitize_file_name("कोटेशन रिपोर्ट.xlsx"), "कोटेशन रिपोर्ट.xlsx");
    let long = format!("{}.pdf", "x".repeat(400));
    let s = sanitize_file_name(&long);
    assert!(s.chars().count() <= 180 && s.ends_with(".pdf"));
}

#[test]
fn duplicate_names_get_numbered() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("Quote.pdf"), b"1").unwrap();
    std::fs::write(dir.path().join("Quote (1).pdf"), b"2").unwrap();
    assert_eq!(
        unique_destination(dir.path(), "Quote.pdf"),
        dir.path().join("Quote (2).pdf")
    );
    assert_eq!(unique_destination(dir.path(), "New.pdf"), dir.path().join("New.pdf"));
}

// ------------------------------------------------------------ messaging

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn handshake_registers_both_sides() {
    let a = node("Alice").await;
    let b = node("Bob").await;
    link(&a, &b).await;

    let b_seen_by_a = a.db().get_peer(&b.id()).unwrap().unwrap();
    assert_eq!(b_seen_by_a.display_name, "Bob");
    assert_eq!(b_seen_by_a.status, "online");
    assert_eq!(
        b_seen_by_a.public_key.as_deref(),
        Some(b.svc.identity.public_key_hex().as_str())
    );
    assert!(wait_for(|| b.db().get_peer(&a.id()).unwrap().is_some(), 5).await);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn message_is_delivered_and_acknowledged() {
    let a = node("Alice").await;
    let b = node("Bob").await;
    let conv = link(&a, &b).await;

    let text = "Quotation for 3100851312 ready ✅ — कृपया देखें";
    let msg = a.svc.send_direct_message(&conv, text).await.unwrap();
    assert!(wait_for(|| msg_status(a.db(), &msg.id) == "delivered", 10).await);

    let stored = b.db().get_message_by_id(&msg.id).unwrap().unwrap();
    assert_eq!(stored.content, text);
    assert!(!stored.is_outgoing);
    let b_conv = b.db().get_or_create_conversation(&a.id()).unwrap();
    assert_eq!(b_conv.unread_count, 1);
    assert!(b_conv.last_message_preview.unwrap().starts_with("Quotation"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn messages_to_offline_peer_queue_and_deliver_later() {
    let a = node("Alice").await;
    let (c_svc, _c_dir) = new_service("Carol");
    let c_port = free_port();

    // A already knows Carol (pinned key) but Carol is not running.
    let carol = Peer {
        id: c_svc.identity.device_id.clone(),
        display_name: "Carol".into(),
        hostname: "CAROL-PC".into(),
        last_ip: "127.0.0.1".into(),
        tcp_port: c_port,
        public_key: Some(c_svc.identity.public_key_hex()),
        trust_state: "unverified".into(),
        status: "offline".into(),
        last_seen: 0,
        avatar_color: "#10b981".into(),
    };
    a.db().upsert_peer(&carol).unwrap();
    let conv = a.db().get_or_create_conversation(&carol.id).unwrap().id;

    let m1 = a.svc.send_direct_message(&conv, "first").await.unwrap();
    let m2 = a.svc.send_direct_message(&conv, "second").await.unwrap();
    assert!(wait_for(|| msg_status(a.db(), &m1.id) == "queued" && msg_status(a.db(), &m2.id) == "queued", 10).await);

    // Carol starts; her beacon arrives.
    serve_on(&c_svc, c_port).await;
    a.svc.peer_seen(&SeenPeer {
        device_id: carol.id.clone(),
        display_name: "Carol".into(),
        hostname: "CAROL-PC".into(),
        ip: "127.0.0.1".into(),
        tcp_port: c_port,
        public_key: c_svc.identity.public_key_hex(),
        avatar_color: "#10b981".into(),
    });
    assert!(wait_for(|| msg_status(a.db(), &m1.id) == "delivered" && msg_status(a.db(), &m2.id) == "delivered", 10).await);

    let conv_c = c_svc.db.get_or_create_conversation(&a.id()).unwrap().id;
    let got: Vec<String> = c_svc.db.get_messages(&conv_c).unwrap().into_iter().map(|m| m.content).collect();
    assert_eq!(got, vec!["first", "second"], "order is preserved");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn manual_peer_is_merged_when_it_comes_online() {
    let a = node("Alice").await;
    let (b_svc, _b_dir) = new_service("Bob");
    let port = free_port();

    // Added by IP while Bob is not running.
    let manual = a.svc.connect_manual_peer("127.0.0.1", port, Some("Bob (office)".into())).await.unwrap();
    assert!(manual.id.starts_with("manual-"));
    let conv = a.db().get_or_create_conversation(&manual.id).unwrap().id;
    let m = a.svc.send_direct_message(&conv, "are you there?").await.unwrap();
    assert!(wait_for(|| msg_status(a.db(), &m.id) == "queued", 10).await);

    serve_on(&b_svc, port).await;
    a.svc.retry_direct_message(&m.id).await.unwrap();
    assert!(wait_for(|| msg_status(a.db(), &m.id) == "delivered", 10).await);

    let peers = a.db().list_peers().unwrap();
    assert!(peers.iter().all(|p| !p.id.starts_with("manual-")), "manual entry replaced");
    let convs = a.db().get_conversations(false).unwrap();
    assert_eq!(convs.len(), 1);
    assert_eq!(convs[0].peer_id, b_svc.identity.device_id);
    assert_eq!(a.db().get_messages(&convs[0].id).unwrap().len(), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn blocked_sender_is_refused() {
    let a = node("Alice").await;
    let b = node("Bob").await;
    let conv = link(&a, &b).await;
    assert!(wait_for(|| b.db().get_peer(&a.id()).unwrap().is_some(), 5).await);
    b.db().update_peer_trust(&a.id(), "blocked").unwrap();

    let m = a.svc.send_direct_message(&conv, "spam").await.unwrap();
    assert!(wait_for(|| {
        a.db().get_message_by_id(&m.id).unwrap().and_then(|m| m.error_reason).unwrap_or_default().contains("not accepting")
    }, 10).await);
    assert!(b.db().get_message_by_id(&m.id).unwrap().is_none());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn impostor_with_different_key_is_refused() {
    let a = node("Alice").await;
    let b = node("Bob").await;
    // A believes B's device id has a different (attacker's) key.
    let (other, _d) = new_service("Mallory");
    a.db().upsert_peer(&Peer {
        id: b.id(),
        display_name: "Bob".into(),
        hostname: "BOB".into(),
        last_ip: "127.0.0.1".into(),
        tcp_port: b.port,
        public_key: Some(other.identity.public_key_hex()),
        trust_state: "trusted".into(),
        status: "offline".into(),
        last_seen: 0,
        avatar_color: "#000000".into(),
    }).unwrap();
    let peer = a.db().get_peer(&b.id()).unwrap().unwrap();
    let err = a.svc.connect_peer(&peer).await.err().unwrap();
    assert!(err.contains("Security"), "got: {}", err);
}

// ------------------------------------------------------------ files

async fn offer_file(a: &Node, b: &Node, conv: &str, size: usize) -> (String, Vec<u8>) {
    let (path, data) = write_random_file(a.dir.path(), "Drawing Rev-B.pdf", size);
    let sent = a
        .svc
        .send_files(conv, vec![path.to_string_lossy().to_string()])
        .await
        .unwrap();
    let id = sent[0].transfers[0].id.clone();
    assert!(wait_for(|| transfer_status(a.db(), &id) == "pending", 10).await, "offer delivered");
    assert!(wait_for(|| transfer_status(b.db(), &id) == "pending", 10).await, "offer received");
    (id, data)
}

fn received_bytes(b: &Node, id: &str) -> Vec<u8> {
    let t = b.db().get_transfer(id).unwrap().unwrap();
    std::fs::read(t.local_path.unwrap()).unwrap()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn large_file_transfers_with_matching_hash() {
    let a = node("Alice").await;
    let b = node("Bob").await;
    let conv = link(&a, &b).await;
    let size = 24 * 1024 * 1024 + 12345; // many chunks plus a partial one
    let (id, data) = offer_file(&a, &b, &conv, size).await;

    let msg = b.db().get_message_by_transfer(&id).unwrap().unwrap();
    assert_eq!(msg.message_type, "file");

    b.svc.accept_transfer(&id).await.unwrap();
    assert!(wait_for(|| transfer_status(b.db(), &id) == "completed", 60).await);
    assert!(wait_for(|| transfer_status(a.db(), &id) == "completed", 10).await);

    assert_eq!(received_bytes(&b, &id), data);
    let expected = hex::encode(Sha256::digest(&data));
    assert_eq!(b.db().get_transfer(&id).unwrap().unwrap().file_hash, expected);
    assert_eq!(a.db().get_transfer(&id).unwrap().unwrap().file_hash, expected);
    let t = b.db().get_transfer(&id).unwrap().unwrap();
    assert!(t.local_path.unwrap().ends_with("Drawing Rev-B.pdf"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn empty_file_transfers() {
    let a = node("Alice").await;
    let b = node("Bob").await;
    let conv = link(&a, &b).await;
    let (id, data) = offer_file(&a, &b, &conv, 0).await;
    b.svc.accept_transfer(&id).await.unwrap();
    assert!(wait_for(|| transfer_status(b.db(), &id) == "completed", 20).await);
    assert_eq!(received_bytes(&b, &id), data);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn interrupted_download_resumes_from_partial_file() {
    let a = node("Alice").await;
    let b = node("Bob").await;
    let conv = link(&a, &b).await;
    let (id, data) = offer_file(&a, &b, &conv, 3 * 1024 * 1024).await;

    // Simulate a download that broke after 1 MB.
    let mut t = b.db().get_transfer(&id).unwrap().unwrap();
    let dl = b.dir.path().join("Downloads");
    std::fs::create_dir_all(&dl).unwrap();
    let part = dl.join("partial.lanxpart");
    std::fs::write(&part, &data[..1024 * 1024]).unwrap();
    t.temp_path = Some(part.to_string_lossy().to_string());
    t.status = "failed".into();
    b.db().save_transfer(&t).unwrap();

    b.svc.retry_transfer(&id).await.unwrap();
    assert!(wait_for(|| transfer_status(b.db(), &id) == "completed", 30).await);
    assert_eq!(received_bytes(&b, &id), data);
    assert!(!part.exists(), "partial file is renamed into place");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn corrupted_partial_file_is_detected_then_redownloaded() {
    let a = node("Alice").await;
    let b = node("Bob").await;
    let conv = link(&a, &b).await;
    let (id, data) = offer_file(&a, &b, &conv, 2 * 1024 * 1024).await;

    let mut t = b.db().get_transfer(&id).unwrap().unwrap();
    let dl = b.dir.path().join("Downloads");
    std::fs::create_dir_all(&dl).unwrap();
    let part = dl.join("bad.lanxpart");
    std::fs::write(&part, vec![0xAB; 512 * 1024]).unwrap(); // wrong bytes
    t.temp_path = Some(part.to_string_lossy().to_string());
    t.status = "failed".into();
    b.db().save_transfer(&t).unwrap();

    b.svc.retry_transfer(&id).await.unwrap();
    assert!(wait_for(|| transfer_status(b.db(), &id) == "failed", 30).await);
    let reason = b.db().get_transfer(&id).unwrap().unwrap().error_reason.unwrap();
    assert!(reason.contains("damaged"), "got: {}", reason);
    assert!(!part.exists(), "corrupted partial data is discarded");

    b.svc.retry_transfer(&id).await.unwrap();
    assert!(wait_for(|| transfer_status(b.db(), &id) == "completed", 30).await);
    assert_eq!(received_bytes(&b, &id), data);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn declined_file_is_reported_to_sender() {
    let a = node("Alice").await;
    let b = node("Bob").await;
    let conv = link(&a, &b).await;
    let (id, _data) = offer_file(&a, &b, &conv, 4096).await;

    b.svc.cancel_transfer(&id).await.unwrap();
    assert_eq!(transfer_status(b.db(), &id), "declined");
    assert!(wait_for(|| transfer_status(a.db(), &id) == "declined", 10).await);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn sender_cancel_stops_recipient() {
    let a = node("Alice").await;
    let b = node("Bob").await;
    let conv = link(&a, &b).await;
    let (id, _data) = offer_file(&a, &b, &conv, 4096).await;

    a.svc.cancel_transfer(&id).await.unwrap();
    assert!(wait_for(|| transfer_status(b.db(), &id) == "cancelled", 10).await);
    // Accepting a cancelled file is refused.
    assert!(b.svc.accept_transfer(&id).await.is_err());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn trusted_peer_files_auto_download_when_enabled() {
    let a = node("Alice").await;
    let b = node("Bob").await;
    let conv = link(&a, &b).await;
    assert!(wait_for(|| b.db().get_peer(&a.id()).unwrap().is_some(), 5).await);
    b.db().update_peer_trust(&a.id(), "trusted").unwrap();
    let mut s = b.db().get_settings().unwrap();
    s.auto_download_transfers = true;
    b.db().save_settings(&s).unwrap();

    let (path, data) = write_random_file(a.dir.path(), "auto.bin", 300_000);
    let sent = a.svc.send_files(&conv, vec![path.to_string_lossy().to_string()]).await.unwrap();
    let id = sent[0].transfers[0].id.clone();
    assert!(wait_for(|| transfer_status(b.db(), &id) == "completed", 30).await);
    assert_eq!(received_bytes(&b, &id), data);
}

#[test]
fn folders_are_refused_with_a_helpful_message() {
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        let a = node("Alice").await;
        let b = node("Bob").await;
        let conv = link(&a, &b).await;
        let err = a
            .svc
            .send_files(&conv, vec![a.dir.path().to_string_lossy().to_string()])
            .await
            .unwrap_err();
        assert!(err.contains("Zip it first"), "got: {}", err);
        let _: Option<Message> = None;
    });
}

// ======================================================= LANX 1.1 features

#[test]
fn plain_messages_keep_the_1_0_wire_format() {
    // 1.0 re-serialises payloads to check signatures, so new optional fields
    // must not appear on ordinary messages and offers.
    let m = serde_json::to_value(PacketPayload::Message(MessagePayload {
        message_id: "m".into(),
        conversation_id: "c".into(),
        content: "hi".into(),
        message_type: "text".into(),
        ttl_secs: None,
        group_id: None,
    }))
    .unwrap();
    let data = m["data"].as_object().unwrap();
    assert!(!data.contains_key("ttl_secs") && !data.contains_key("group_id"));
    let o = serde_json::to_value(PacketPayload::FileOffer(FileOfferPayload {
        transfer_id: "t".into(),
        file_name: "f".into(),
        file_size: 1,
        group_id: None,
    }))
    .unwrap();
    assert!(!o["data"].as_object().unwrap().contains_key("group_id"));
}

#[test]
fn version_comparison() {
    assert!(version_at_least("1.1.0", FEATURES_V11));
    assert!(version_at_least("1.10.2", "1.9.9"));
    assert!(version_at_least("2.0", "1.1.0"));
    assert!(!version_at_least("1.0.0", FEATURES_V11));
    assert!(!version_at_least("", FEATURES_V11));
}

fn conv_of(db: &Database, id: &str) -> Option<crate::storage::models::Conversation> {
    db.get_conversation(id).unwrap()
}

fn messages_in(db: &Database, conv: &str) -> Vec<Message> {
    db.get_messages(conv).unwrap_or_default()
}

fn texts(db: &Database, conv: &str) -> Vec<String> {
    messages_in(db, conv)
        .into_iter()
        .filter(|m| m.message_type == "text")
        .map(|m| m.content)
        .collect()
}

/// Three online nodes; A knows B and C.
async fn trio() -> (Node, Node, Node) {
    let a = node("Asha").await;
    let b = node("Bharat").await;
    let c = node("Chetan").await;
    link(&a, &b).await;
    link(&a, &c).await;
    (a, b, c)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn group_chat_reaches_every_member_and_replies_flow_between_members() {
    let (a, b, c) = trio().await;
    let conv = a.svc.create_group("Accounts Team", &[b.id(), c.id()]).unwrap();
    assert_eq!(conv.kind, "group");
    let gid = conv.id.clone();

    assert!(wait_for(|| conv_of(b.db(), &gid).is_some() && conv_of(c.db(), &gid).is_some(), 10).await);
    assert_eq!(conv_of(b.db(), &gid).unwrap().peer_name, "Accounts Team");
    assert_eq!(b.svc.get_group(&gid).unwrap().members.len(), 3);

    let m = a.svc.send_direct_message(&gid, "Quarter close on Friday").await.unwrap();
    assert!(wait_for(|| a.db().delivery_summary(&m.id).is_some_and(|s| s.delivered == 2), 10).await);
    assert_eq!(texts(b.db(), &gid), vec!["Quarter close on Friday"]);
    assert_eq!(texts(c.db(), &gid), vec!["Quarter close on Friday"]);

    // B never connected to C directly: it learned C from the group.
    b.svc.send_direct_message(&gid, "Noted 👍").await.unwrap();
    assert!(wait_for(|| texts(c.db(), &gid).len() == 2 && texts(a.db(), &gid).len() == 2, 10).await);
    let from_b = messages_in(c.db(), &gid).into_iter().find(|m| m.content == "Noted 👍").unwrap();
    assert_eq!(from_b.sender_id, b.id());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn offline_group_member_gets_group_and_messages_later() {
    let a = node("Asha").await;
    let b = node("Bharat").await;
    link(&a, &b).await;
    let (c_svc, _c_dir) = new_service("Chetan");
    let c_port = free_port();
    a.db().upsert_peer(&Peer {
        id: c_svc.identity.device_id.clone(),
        display_name: "Chetan".into(),
        hostname: "C".into(),
        last_ip: "127.0.0.1".into(),
        tcp_port: c_port,
        public_key: Some(c_svc.identity.public_key_hex()),
        trust_state: "unverified".into(),
        status: "offline".into(),
        last_seen: 0,
        avatar_color: "#10b981".into(),
    })
    .unwrap();

    let gid = a.svc.create_group("Stores", &[b.id(), c_svc.identity.device_id.clone()]).unwrap().id;
    let m = a.svc.send_direct_message(&gid, "Stock count at 4").await.unwrap();
    assert!(wait_for(|| a.db().delivery_summary(&m.id).is_some_and(|s| s.delivered == 1 && s.queued == 1), 10).await);

    serve_on(&c_svc, c_port).await;
    a.svc.peer_seen(&SeenPeer {
        device_id: c_svc.identity.device_id.clone(),
        display_name: "Chetan".into(),
        hostname: "C".into(),
        ip: "127.0.0.1".into(),
        tcp_port: c_port,
        public_key: c_svc.identity.public_key_hex(),
        avatar_color: "#10b981".into(),
    });
    assert!(wait_for(|| a.db().delivery_summary(&m.id).is_some_and(|s| s.delivered == 2), 10).await);
    assert_eq!(texts(&c_svc.db, &gid), vec!["Stock count at 4"]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn admin_renames_removes_and_hands_over_the_group() {
    let (a, b, c) = trio().await;
    let gid = a.svc.create_group("Sales", &[b.id(), c.id()]).unwrap().id;
    assert!(wait_for(|| conv_of(c.db(), &gid).is_some(), 10).await);

    // Only the admin may change the group.
    assert!(b.svc.update_group(&gid, Some("Hacked".into()), &[], &[]).is_err());

    a.svc.update_group(&gid, Some("Sales North".into()), &[], &[c.id()]).unwrap();
    assert!(wait_for(|| conv_of(b.db(), &gid).is_some_and(|c| c.peer_name == "Sales North"), 10).await);
    assert!(wait_for(|| b.svc.get_group(&gid).is_some_and(|g| g.members.len() == 2), 10).await);
    assert!(wait_for(|| c.svc.get_group(&gid).is_some_and(|g| g.membership == "removed"), 10).await);
    assert!(c.svc.send_direct_message(&gid, "still here?").await.is_err());

    // The admin leaves: Bharat becomes admin.
    a.svc.leave_group(&gid).unwrap();
    assert!(wait_for(|| b.svc.get_group(&gid).is_some_and(|g| g.admin_id == b.id() && g.members.len() == 1), 10).await);
    assert_eq!(a.svc.get_group(&gid).unwrap().membership, "left");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn member_leaving_is_shared_with_everyone() {
    let (a, b, c) = trio().await;
    let gid = a.svc.create_group("Ops", &[b.id(), c.id()]).unwrap().id;
    assert!(wait_for(|| conv_of(b.db(), &gid).is_some() && conv_of(c.db(), &gid).is_some(), 10).await);
    b.svc.leave_group(&gid).unwrap();
    assert!(wait_for(|| a.svc.get_group(&gid).is_some_and(|g| g.members.len() == 2), 10).await);
    assert!(wait_for(|| c.svc.get_group(&gid).is_some_and(|g| !g.members.iter().any(|m| m.device_id == b.id())), 10).await);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn group_file_goes_to_each_member() {
    let (a, b, c) = trio().await;
    let gid = a.svc.create_group("Design", &[b.id(), c.id()]).unwrap().id;
    assert!(wait_for(|| conv_of(b.db(), &gid).is_some() && conv_of(c.db(), &gid).is_some(), 10).await);
    let (path, data) = write_random_file(a.dir.path(), "Layout.dwg", 700_000);
    let sent = a.svc.send_files(&gid, vec![path.to_string_lossy().to_string()]).await.unwrap();
    assert_eq!(sent[0].transfers.len(), 2);
    let parent = sent[0].message.transfer_id.clone().unwrap();
    for (node, t) in [(&b, &sent[0].transfers[0]), (&c, &sent[0].transfers[1])] {
        let _ = node;
        assert_eq!(t.parent_id.as_deref(), Some(parent.as_str()));
    }
    for t in &sent[0].transfers {
        let receiver = if t.peer_id == b.id() { &b } else { &c };
        assert!(wait_for(|| transfer_status(receiver.db(), &t.id) == "pending", 10).await);
        let m = receiver.db().get_message_by_transfer(&t.id).unwrap().unwrap();
        assert_eq!(m.conversation_id, gid, "file shows in the group chat");
        receiver.svc.accept_transfer(&t.id).await.unwrap();
        assert!(wait_for(|| transfer_status(receiver.db(), &t.id) == "completed", 20).await);
        assert_eq!(received_bytes(receiver, &t.id), data);
    }
    assert!(wait_for(|| a.db().transfers_by_parent(&parent).unwrap().iter().all(|t| t.status == "completed"), 10).await);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn read_receipts_mark_messages_seen() {
    let a = node("Asha").await;
    let b = node("Bharat").await;
    let conv = link(&a, &b).await;
    let m = a.svc.send_direct_message(&conv, "Did you check?").await.unwrap();
    assert!(wait_for(|| msg_status(a.db(), &m.id) == "delivered", 10).await);
    let b_conv = b.db().get_or_create_conversation(&a.id()).unwrap().id;
    b.svc.mark_read_and_notify(&b_conv).unwrap();
    assert!(wait_for(|| msg_status(a.db(), &m.id) == "read", 10).await);

    // With "Seen" turned off nothing is sent back.
    let mut s = b.db().get_settings().unwrap();
    s.read_receipts = false;
    b.db().save_settings(&s).unwrap();
    let m2 = a.svc.send_direct_message(&conv, "And this?").await.unwrap();
    assert!(wait_for(|| msg_status(a.db(), &m2.id) == "delivered", 10).await);
    b.svc.mark_read_and_notify(&b_conv).unwrap();
    tokio::time::sleep(Duration::from_millis(800)).await;
    assert_eq!(msg_status(a.db(), &m2.id), "delivered");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn group_read_receipts_count_members() {
    let (a, b, c) = trio().await;
    let gid = a.svc.create_group("Floor 2", &[b.id(), c.id()]).unwrap().id;
    let m = a.svc.send_direct_message(&gid, "Lunch at 1?").await.unwrap();
    assert!(wait_for(|| a.db().delivery_summary(&m.id).is_some_and(|s| s.delivered == 2), 10).await);
    b.svc.mark_read_and_notify(&gid).unwrap();
    assert!(wait_for(|| a.db().delivery_summary(&m.id).is_some_and(|s| s.read == 1), 10).await);
    let s = a.db().delivery_summary(&m.id).unwrap();
    assert_eq!(s.read_by, vec!["Bharat".to_string()]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn secret_messages_disappear_on_both_sides_after_reading() {
    let a = node("Asha").await;
    let b = node("Bharat").await;
    let conv = link(&a, &b).await;
    a.svc.set_secret_mode(&conv, 30).unwrap();
    let b_conv = b.db().get_or_create_conversation(&a.id()).unwrap().id;
    assert!(wait_for(|| conv_of(b.db(), &b_conv).is_some_and(|c| c.secret_ttl == 30), 10).await);
    assert!(a.svc.set_secret_mode(&conv, 42).is_err(), "only offered timers");

    let m = a.svc.send_direct_message(&conv, "door code 4417").await.unwrap();
    assert_eq!(m.ttl_secs, Some(30));
    assert!(wait_for(|| b.db().get_message_by_id(&m.id).unwrap().is_some(), 10).await);
    let got = b.db().get_message_by_id(&m.id).unwrap().unwrap();
    assert_eq!(got.ttl_secs, Some(30));
    assert!(got.expire_at.unwrap() > now_secs() + 3600, "unread: kept up to a week");
    assert!(b.db().search_messages("4417", 10, true).unwrap().is_empty(), "never searchable");
    assert_eq!(conv_of(b.db(), &b_conv).unwrap().last_message_preview.unwrap(), "🔒 Secret message");

    b.svc.mark_read_and_notify(&b_conv).unwrap();
    let read = b.db().get_message_by_id(&m.id).unwrap().unwrap();
    assert!(read.expire_at.unwrap() <= now_secs() + 30);
    assert!(wait_for(|| a.db().get_message_by_id(&m.id).unwrap().is_some_and(|x| x.status == "read" && x.expire_at.unwrap() <= now_secs() + 30), 10).await);

    // 31 s later the cleaner removes them everywhere.
    let later = now_secs() + 31;
    assert_eq!(a.db().delete_expired_messages(later).unwrap().len(), 1);
    assert_eq!(b.db().delete_expired_messages(later).unwrap().len(), 1);
    assert!(b.db().get_message_by_id(&m.id).unwrap().is_none());

    a.svc.set_secret_mode(&conv, 0).unwrap();
    assert!(wait_for(|| conv_of(b.db(), &b_conv).is_some_and(|c| c.secret_ttl == 0), 10).await);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn ring_reaches_online_peer_and_is_rate_limited() {
    let a = node("Asha").await;
    let b = node("Bharat").await;
    let conv = link(&a, &b).await;
    assert_eq!(a.svc.ring(&conv).await.unwrap(), 1);
    let b_conv = b.db().get_or_create_conversation(&a.id()).unwrap();
    assert!(messages_in(b.db(), &b_conv.id).iter().any(|m| m.message_type == "ring" && !m.is_outgoing));
    assert_eq!(b_conv.unread_count, 1);
    assert!(messages_in(a.db(), &conv).iter().any(|m| m.message_type == "ring" && m.is_outgoing));
    let err = a.svc.ring(&conv).await.unwrap_err();
    assert!(err.contains("just rang"), "got {}", err);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn ringing_an_offline_peer_explains_why() {
    let a = node("Asha").await;
    let b = node("Bharat").await;
    let conv = link(&a, &b).await;
    a.svc.peer_went_offline(&b.id());
    let err = a.svc.ring(&conv).await.unwrap_err();
    assert!(err.contains("offline"), "got {}", err);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn pasted_screenshot_is_sent_and_previewed_without_accepting() {
    use base64::Engine;
    let a = node("Asha").await;
    let b = node("Bharat").await;
    let conv = link(&a, &b).await;
    let png = crate::sound::synth("pop"); // any bytes stand in for image data
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
    let path = a.svc.save_pasted_image(&format!("data:image/png;base64,{}", b64), "image/png").unwrap();
    assert!(path.file_name().unwrap().to_string_lossy().starts_with("Screenshot "));
    let sent = a.svc.send_files(&conv, vec![path.to_string_lossy().to_string()]).await.unwrap();
    let id = sent[0].transfers[0].id.clone();
    // Small images download by themselves.
    assert!(wait_for(|| transfer_status(b.db(), &id) == "completed", 20).await);
    let preview = b.svc.image_preview(&id).unwrap();
    assert!(preview.starts_with("data:image/png;base64,"));
    assert!(a.svc.image_preview(&id).is_some(), "sender sees it too");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn broadcast_reaches_each_selected_colleague() {
    let (a, b, c) = trio().await;
    let r = a
        .svc
        .broadcast(&[b.id(), c.id()], Some("Office closed tomorrow".into()), vec![])
        .await
        .unwrap();
    assert_eq!(r.sent_to, 2);
    for n in [&b, &c] {
        let conv = n.db().get_or_create_conversation(&a.id()).unwrap().id;
        assert!(wait_for(|| texts(n.db(), &conv) == vec!["Office closed tomorrow".to_string()], 10).await);
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn hidden_chats_stay_out_of_lists_and_search() {
    let a = node("Asha").await;
    let b = node("Bharat").await;
    let conv = link(&a, &b).await;
    a.svc.send_direct_message(&conv, "salary revision").await.unwrap();
    a.db().set_conversation_hidden(&conv, true).unwrap();
    assert!(a.db().get_conversations(false).unwrap().is_empty());
    assert_eq!(a.db().get_conversations(true).unwrap().len(), 1);
    assert!(a.db().search_messages("salary", 10, false).unwrap().is_empty());
    assert_eq!(a.db().search_messages("salary", 10, true).unwrap().len(), 1);
}
