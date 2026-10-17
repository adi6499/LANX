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
fn empty_folders_are_refused_with_a_helpful_message() {
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        let a = node("Alice").await;
        let b = node("Bob").await;
        let conv = link(&a, &b).await;
        let empty = a.dir.path().join("Nothing here");
        std::fs::create_dir_all(&empty).unwrap();
        let err = a
            .svc
            .send_files(&conv, vec![empty.to_string_lossy().to_string()])
            .await
            .unwrap_err();
        assert!(err.contains("is empty"), "got: {}", err);
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
        folder: None,
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

// ================================================ LANX 1.2: Share LANX update

use super::update::{AvailableUpdate, UpdateConfig, release_message, verify_release, version_matches};
use crate::storage::models::ReleaseInfo;
use ed25519_dalek::{Signer, SigningKey};
use std::path::{Path, PathBuf};

/// Stands in for the LANX release key (the real private key never leaves
/// the owner's PC).
fn test_release_key() -> SigningKey {
    SigningKey::from_bytes(&[7u8; 32])
}

fn update_cfg(node_dir: &Path, version: &str) -> UpdateConfig {
    UpdateConfig {
        app_version: version.into(),
        release_key: hex::encode(test_release_key().verifying_key().to_bytes()),
        check_exe_version: false, // test "installers" are random bytes
        dry_run: true,
        dir: Some(node_dir.join("Updates")),
        install_dir: Some(node_dir.join("Program Files").join("LANX").join("updates")),
    }
}

fn sign_release(version: &str, data: &[u8]) -> ReleaseInfo {
    let sha256 = hex::encode(Sha256::digest(data));
    let size = data.len() as u64;
    let signature = test_release_key().sign(&release_message(version, &sha256, size));
    ReleaseInfo {
        version: version.into(),
        sha256,
        size,
        signature: hex::encode(signature.to_bytes()),
    }
}

/// LANX-Setup-<version>.exe plus its .sig, as `npm run release` makes them.
fn fake_installer(dir: &Path, version: &str, size: usize) -> (PathBuf, Vec<u8>) {
    let (path, data) = write_random_file(dir, &format!("LANX-Setup-{}.exe", version), size);
    let sig = serde_json::to_string(&sign_release(version, &data)).unwrap();
    std::fs::write(format!("{}.sig", path.display()), sig).unwrap();
    (path, data)
}

/// A node that believes it runs LANX `version`.
async fn updater(name: &str, version: &str) -> Node {
    let n = node(name).await;
    n.svc.set_update_config(update_cfg(n.dir.path(), version));
    n
}

fn available(n: &Node) -> Option<AvailableUpdate> {
    n.svc.update_status().available
}

fn avail_state(n: &Node) -> String {
    available(n).map(|a| a.state).unwrap_or_default()
}

fn colleague_state(n: &Node, peer_id: &str) -> String {
    n.svc
        .update_status()
        .colleagues
        .into_iter()
        .find(|c| c.peer_id == peer_id)
        .map(|c| c.state)
        .unwrap_or_default()
}

fn started_installers(n: &Node) -> Vec<String> {
    n.svc.updates.lock().dry_runs.clone()
}

fn offer_of(version: &str, r: &ReleaseInfo) -> UpdateOfferPayload {
    UpdateOfferPayload {
        transfer_id: uuid::Uuid::new_v4().to_string(),
        version: version.into(),
        file_size: r.size,
        sha256: r.sha256.clone(),
        signature: r.signature.clone(),
    }
}

#[test]
fn update_offer_packet_and_version_rules() {
    for good in ["1.2.0", "10.20.30"] {
        assert!(valid_version(good), "{}", good);
    }
    for bad in ["1.2", "1.2.0.1", "1.2.x", "", "1..2", "../1.2.0", "1.2.0-beta", "123456.0.0"] {
        assert!(!valid_version(bad), "{}", bad);
    }
    assert!(is_newer("1.2.1", "1.2.0") && is_newer("1.10.0", "1.9.9"));
    assert!(!is_newer("1.2.0", "1.2.0") && !is_newer("1.1.9", "1.2.0"));
    assert!(version_at_least("1.2.0", FEATURES_V12) && !version_at_least("1.1.0", FEATURES_V12));
    assert!(version_matches("1.2.1.0", "1.2.1") && !version_matches("1.2.10.0", "1.2.1"));
    let v = serde_json::to_value(PacketPayload::UpdateOffer(offer_of("1.2.1", &sign_release("1.2.1", b"x")))).unwrap();
    assert_eq!(v["kind"], "update_offer");
}

#[test]
fn only_installers_signed_with_the_release_key_are_accepted() {
    let key = hex::encode(test_release_key().verifying_key().to_bytes());
    let good = sign_release("1.3.0", b"installer bytes");
    assert_eq!(verify_release(&key, &good), Ok(()));
    let mut t = good.clone();
    t.version = "1.3.1".into();
    assert!(verify_release(&key, &t).is_err(), "the version is signed");
    let mut t = good.clone();
    t.sha256 = hex::encode(Sha256::digest(b"another program"));
    assert!(verify_release(&key, &t).is_err(), "the checksum is signed");
    let mut t = good.clone();
    t.size += 1;
    assert!(verify_release(&key, &t).is_err(), "the size is signed");
    let other = hex::encode(SigningKey::from_bytes(&[9u8; 32]).verifying_key().to_bytes());
    assert!(verify_release(&other, &good).is_err(), "signed with another key");
    // The release key built into the app is a real key, and not the test one.
    let real = UpdateConfig::default().release_key;
    assert_eq!(real.len(), 64);
    assert!(verify_release(&real, &good).is_err());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn update_is_offered_downloaded_checked_and_started_on_click() {
    let a = updater("Asha", "1.3.0").await;
    let b = updater("Bharat", "1.2.0").await;
    link(&a, &b).await;
    let (path, data) = fake_installer(a.dir.path(), "1.3.0", 700_000);
    let share = a.svc.share_update(&path.to_string_lossy()).unwrap();
    assert!(Path::new(&share.path).starts_with(a.dir.path().join("Updates")), "kept in LANX's folder");

    // Without anyone doing anything, Bharat is offered it and his LANX
    // fetches and checks it in the background.
    assert!(wait_for(|| avail_state(&b) == "ready", 20).await);
    let offer = available(&b).unwrap();
    assert_eq!((offer.version.as_str(), offer.from_name.as_str()), ("1.3.0", "Asha"));
    assert!(wait_for(|| colleague_state(&a, &b.id()) == "received", 10).await);
    let t = b.db().update_transfers("incoming").unwrap().remove(0).0;
    assert_eq!(std::fs::read(t.local_path.unwrap()).unwrap(), data);
    assert!(!b.dir.path().join("Downloads").join("LANX-Setup-1.3.0.exe").exists(), "not in Downloads");
    // It is not a chat file: no chat, nothing in the Files list.
    assert!(b.db().list_transfers(true).unwrap().is_empty());
    assert!(b.db().get_conversations(true).unwrap().is_empty());
    // Nothing runs before the click.
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(started_installers(&b).is_empty());

    // "Update LANX now": checked once more, then started.
    assert_eq!(b.svc.install_update().await.unwrap(), "dry_run");
    let line = started_installers(&b).remove(0);
    let updates = b.dir.path().join("Updates");
    assert!(line.contains(&*updates.to_string_lossy()) && line.ends_with("/P /R /UPDATE"), "{}", line);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn update_that_cannot_be_fetched_never_starts_anything() {
    let a = updater("Asha", "1.3.0").await;
    let b = updater("Bharat", "1.2.0").await;
    link(&a, &b).await;
    assert!(wait_for(|| b.db().get_peer(&a.id()).unwrap().is_some(), 5).await);
    let asha = b.db().get_peer(&a.id()).unwrap().unwrap();
    // An offer whose download cannot start on its own (Asha does not have it).
    let r = sign_release("1.3.0", b"x");
    assert!(b.svc.handle_update_offer(&asha, offer_of("1.3.0", &r)).accepted);
    assert!(wait_for(|| matches!(avail_state(&b).as_str(), "failed" | "available"), 10).await);
    assert!(b.svc.install_update().await.is_ok());
    assert!(wait_for(|| avail_state(&b) == "failed", 10).await);
    assert!(started_installers(&b).is_empty(), "nothing broken is started");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn unsigned_forged_old_or_untrusted_updates_are_refused() {
    let a = updater("Asha", "1.3.0").await;
    let b = updater("Bharat", "1.2.0").await;
    link(&a, &b).await;
    assert!(wait_for(|| b.db().get_peer(&a.id()).unwrap().is_some(), 5).await);
    let asha = b.db().get_peer(&a.id()).unwrap().unwrap();

    // Sharing needs the matching .sig that `npm run release` writes.
    let (bare, _) = write_random_file(a.dir.path(), "LANX-Setup-copy.exe", 1000);
    assert!(a.svc.share_update(&bare.to_string_lossy()).unwrap_err().contains("release signature"));
    let (changed, _) = fake_installer(a.dir.path(), "1.3.0", 1000);
    std::fs::write(&changed, vec![1u8; 1000]).unwrap(); // changed after signing
    assert!(a.svc.share_update(&changed.to_string_lossy()).unwrap_err().contains("checksum"));

    let r = sign_release("1.3.0", b"x");
    let mut forged = offer_of("1.3.0", &r);
    forged.signature = hex::encode([0u8; 64]);
    assert!(!b.svc.handle_update_offer(&asha, forged).accepted);
    assert!(!b.svc.handle_update_offer(&asha, offer_of("1.4.0", &r)).accepted, "version swapped");
    let same = sign_release("1.2.0", b"x");
    let reply = b.svc.handle_update_offer(&asha, offer_of("1.2.0", &same));
    assert!(!reply.accepted && reply.reason.unwrap().contains("already has"), "not newer");
    let mut blocked = asha.clone();
    blocked.trust_state = "blocked".into();
    assert!(!b.svc.handle_update_offer(&blocked, offer_of("1.3.0", &r)).accepted);
    let mut unpinned = asha.clone();
    unpinned.public_key = None;
    assert!(!b.svc.handle_update_offer(&unpinned, offer_of("1.3.0", &r)).accepted);
    assert!(available(&b).is_none());

    assert!(b.svc.handle_update_offer(&asha, offer_of("1.3.0", &r)).accepted);
    assert!(available(&b).is_some_and(|x| x.version == "1.3.0"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn installer_changed_on_the_sharing_pc_is_rejected_and_deleted() {
    let a = updater("Asha", "1.3.0").await;
    let b = updater("Bharat", "1.2.0").await;
    let (path, _) = fake_installer(a.dir.path(), "1.3.0", 400_000);
    let share = a.svc.share_update(&path.to_string_lossy()).unwrap();
    std::fs::write(&share.path, vec![0x5A; 400_000]).unwrap(); // same size, other program

    link(&a, &b).await; // Bharat is offered it and fetches it by himself
    assert!(wait_for(|| avail_state(&b) == "failed", 20).await);
    // Pressing the button fetches it again, and it fails the check again.
    b.svc.install_update().await.unwrap();
    assert!(wait_for(|| avail_state(&b) == "failed", 20).await);
    let error = available(&b).unwrap().error.unwrap_or_default();
    assert!(error.contains("safety check"), "got: {}", error);
    assert!(started_installers(&b).is_empty(), "nothing was started");
    let exes = std::fs::read_dir(b.dir.path().join("Updates"))
        .unwrap()
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().ends_with(".exe"))
        .count();
    assert_eq!(exes, 0, "the bad file is deleted");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn colleagues_on_1_1_get_the_installer_as_a_chat_file() {
    let a = updater("Asha", "1.3.0").await;
    let b = updater("Bharat", "1.1.0").await; // reports 1.1.0 like a real 1.1 PC
    link(&a, &b).await;
    let (path, data) = fake_installer(a.dir.path(), "1.3.0", 300_000);
    a.svc.share_update(&path.to_string_lossy()).unwrap();

    // Sent once, by itself, as an ordinary file in their chat.
    let copies = || {
        b.db()
            .list_transfers(true)
            .unwrap()
            .into_iter()
            .filter(|t| t.file_name == "LANX-Setup-1.3.0.exe")
            .collect::<Vec<_>>()
    };
    assert!(wait_for(|| copies().iter().any(|t| t.status == "pending"), 10).await);
    assert!(wait_for(|| colleague_state(&a, &b.id()) == "chat_sent", 10).await);
    assert!(b.db().update_transfers("incoming").unwrap().is_empty(), "1.1 never gets the new packet");
    a.svc.maybe_offer_update(&b.id()); // seen again: not sent twice
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(copies().len(), 1);
    let t = copies().remove(0);
    assert!(t.conversation_id.is_some(), "an ordinary file in the chat");
    b.svc.accept_transfer(&t.id).await.unwrap();
    assert!(wait_for(|| transfer_status(b.db(), &t.id) == "completed", 20).await);
    assert_eq!(received_bytes(&b, &t.id), data);

    // The button in Settings → Updates sends it again on request.
    assert_eq!(a.svc.send_update_as_file(&[b.id()]).await.unwrap().sent_to, 1);
    assert!(wait_for(|| copies().len() == 2, 10).await);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn no_automatic_chat_files_when_turned_off() {
    let a = updater("Asha", "1.3.0").await;
    let b = updater("Bharat", "1.1.0").await;
    a.svc.set_update_auto_chat(false).unwrap();
    link(&a, &b).await;
    let (path, _) = fake_installer(a.dir.path(), "1.3.0", 1000);
    a.svc.share_update(&path.to_string_lossy()).unwrap();
    assert!(wait_for(|| colleague_state(&a, &b.id()) == "old_version", 10).await);
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(b.db().list_transfers(true).unwrap().is_empty());
    assert!(!a.svc.update_status().auto_chat);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn everyone_sees_who_is_behind() {
    let a = updater("Asha", "1.3.0").await;
    let b = updater("Bharat", "1.2.0").await;
    link(&a, &b).await;
    assert!(wait_for(|| b.db().peer_app_version(&a.id()).is_some(), 10).await);
    let on_a = a.svc.update_status();
    let bharat = on_a.colleagues.iter().find(|c| c.peer_id == b.id()).unwrap();
    assert_eq!(on_a.latest_version, "1.3.0");
    assert!(bharat.behind && bharat.state == "behind");
    assert_eq!(bharat.app_version.as_deref(), Some("1.2.0"));
    let on_b = b.svc.update_status();
    assert_eq!(on_b.latest_version, "1.3.0", "Bharat knows a newer LANX exists");
    let asha = on_b.colleagues.iter().find(|c| c.peer_id == a.id()).unwrap();
    assert!(!asha.behind && asha.state == "up_to_date");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn remind_me_tomorrow_and_daily_reminders() {
    let a = updater("Asha", "1.3.0").await;
    let b = updater("Bharat", "1.2.0").await;
    link(&a, &b).await;
    assert!(wait_for(|| b.db().get_peer(&a.id()).unwrap().is_some(), 5).await);
    let asha = b.db().get_peer(&a.id()).unwrap().unwrap();
    assert!(!b.svc.remind_about_update(), "nothing to remind about");
    let r = sign_release("1.3.0", b"x");
    assert!(b.svc.handle_update_offer(&asha, offer_of("1.3.0", &r)).accepted);
    assert!(!b.svc.remind_about_update(), "just announced");

    // A day later it reminds again, once.
    let yesterday = (now_secs() - 25 * 3600).to_string();
    b.db().set_setting("update_reminded_at", &yesterday).unwrap();
    assert!(b.svc.remind_about_update());
    assert!(!b.svc.remind_about_update());

    // "Remind me tomorrow" hides it for a day.
    let until = b.svc.snooze_update().unwrap();
    assert!(until >= now_secs() + 86_000);
    assert_eq!(b.svc.update_status().snoozed_until, Some(until));
    b.db().set_setting("update_reminded_at", &yesterday).unwrap();
    assert!(!b.svc.remind_about_update(), "quiet while snoozed");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn installing_from_a_release_folder_starts_sharing_by_itself() {
    // The installer leaves a copy of itself (and its .sig) in the LANX
    // folder; the LANX it installed then shares that version.
    let a = updater("Asha", "1.3.0").await;
    let copy_dir = a.dir.path().join("Program Files").join("LANX").join("updates");
    std::fs::create_dir_all(&copy_dir).unwrap();
    let (other, _) = fake_installer(&copy_dir, "1.2.9", 1000); // not the running version
    a.svc.update_housekeeping();
    assert!(a.svc.shared_installer().is_none());
    std::fs::remove_file(other).unwrap();

    let (path, _) = fake_installer(&copy_dir, "1.3.0", 50_000);
    a.svc.update_housekeeping();
    let share = a.svc.shared_installer().expect("shares the version it runs");
    assert_eq!((share.release.version.as_str(), share.origin.as_str()), ("1.3.0", "chosen"));
    assert_ne!(Path::new(&share.path), path.as_path(), "copied into LANX's own folder");

    // Without the .sig (e.g. it came through LANX) nothing is shared.
    let b = updater("Bharat", "1.3.0").await;
    let b_copy = b.dir.path().join("Program Files").join("LANX").join("updates");
    std::fs::create_dir_all(&b_copy).unwrap();
    std::fs::copy(&path, b_copy.join("LANX-Setup-1.3.0.exe")).unwrap();
    b.svc.update_housekeeping();
    assert!(b.svc.shared_installer().is_none());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_updated_pc_passes_the_update_on() {
    let a = updater("Asha", "1.3.0").await;
    let b = updater("Bharat", "1.2.0").await;
    let c = updater("Chetan", "1.2.0").await;
    link(&a, &b).await;
    let (path, data) = fake_installer(a.dir.path(), "1.3.0", 500_000);
    a.svc.share_update(&path.to_string_lossy()).unwrap();
    assert!(wait_for(|| avail_state(&b) == "ready", 20).await);
    assert_eq!(b.svc.install_update().await.unwrap(), "dry_run");

    // Bharat's LANX starts again as 1.3.0 (what the installer does).
    b.svc.set_update_config(update_cfg(b.dir.path(), "1.3.0"));
    b.svc.update_housekeeping();
    let share = b.svc.shared_installer().expect("keeps the installer to pass on");
    assert_eq!((share.release.version.as_str(), share.origin.as_str()), ("1.3.0", "passed_on"));
    assert!(available(&b).is_none(), "up to date now");

    // Chetan only knows Bharat, and still gets 1.3.0.
    link(&b, &c).await;
    assert!(wait_for(|| available(&c).is_some_and(|x| x.from_name == "Bharat" && x.state == "ready"), 20).await);
    assert_eq!(c.svc.install_update().await.unwrap(), "dry_run");
    let t = c.db().update_transfers("incoming").unwrap().remove(0).0;
    assert_eq!(std::fs::read(t.local_path.unwrap()).unwrap(), data);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn stopping_sharing_withdraws_the_offer() {
    let a = updater("Asha", "1.3.0").await;
    let b = updater("Bharat", "1.2.0").await;
    // Bharat's LANX cannot fetch it yet (its Updates folder is unavailable),
    // so the offer is still waiting when Asha stops sharing.
    let blocked_dir = b.dir.path().join("not-a-folder");
    std::fs::write(&blocked_dir, b"x").unwrap();
    let mut cfg = update_cfg(b.dir.path(), "1.2.0");
    cfg.dir = Some(blocked_dir);
    b.svc.set_update_config(cfg);
    link(&a, &b).await;
    let (path, _) = fake_installer(a.dir.path(), "1.3.0", 200_000);
    a.svc.share_update(&path.to_string_lossy()).unwrap();
    assert!(wait_for(|| avail_state(&b) == "available", 10).await);
    a.svc.stop_sharing_update().unwrap();
    assert!(a.svc.shared_installer().is_none());
    assert!(wait_for(|| available(&b).is_none(), 10).await, "the banner goes away");
}

// ------------------------------------------------------------------ calls

fn call_records(db: &Database, conv: &str) -> Vec<(bool, String)> {
    messages_in(db, conv)
        .into_iter()
        .filter(|m| m.message_type == "call")
        .map(|m| {
            let v: serde_json::Value = serde_json::from_str(&m.content).unwrap();
            (m.is_outgoing, v["outcome"].as_str().unwrap_or("").to_string())
        })
        .collect()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn call_is_answered_then_hung_up_and_both_sides_keep_a_record() {
    let a = node("Asha").await;
    let b = node("Bharat").await;
    let conv = link(&a, &b).await;
    let call = a.svc.start_call(&conv, true, "v=0 offer".into()).await.unwrap();
    assert!(call.outgoing && call.video && call.phase == "ringing");
    assert!(wait_for(|| b.svc.current_call().is_some_and(|c| c.phase == "ringing" && !c.outgoing), 5).await);
    let incoming = b.svc.current_call().unwrap();
    assert_eq!(incoming.call_id, call.call_id);
    assert_eq!(incoming.peer_name, "Asha");
    assert!(a.svc.start_call(&conv, false, "x".into()).await.unwrap_err().contains("already in a call"));

    b.svc.answer_call(&call.call_id, "v=0 answer".into(), true).await.unwrap();
    assert!(wait_for(|| a.svc.current_call().is_some_and(|c| c.phase == "active"), 5).await);
    tokio::time::sleep(Duration::from_millis(1100)).await;
    a.svc.hangup_call(&call.call_id).await.unwrap();
    assert!(a.svc.current_call().is_none());
    assert!(wait_for(|| b.svc.current_call().is_none(), 5).await);

    assert_eq!(call_records(a.db(), &conv), vec![(true, "answered".to_string())]);
    let b_conv = b.db().get_or_create_conversation(&a.id()).unwrap();
    assert_eq!(call_records(b.db(), &b_conv.id), vec![(false, "answered".to_string())]);
    let preview = conv_of(a.db(), &conv).unwrap().last_message_preview.unwrap();
    assert!(preview.starts_with("📞 Video call · 0:0"), "got {}", preview);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn declined_and_cancelled_calls_are_recorded_on_both_sides() {
    let a = node("Asha").await;
    let b = node("Bharat").await;
    let conv = link(&a, &b).await;
    let b_conv = b.db().get_or_create_conversation(&a.id()).unwrap().id;

    // Bharat declines.
    let call = a.svc.start_call(&conv, false, "offer".into()).await.unwrap();
    assert!(wait_for(|| b.svc.current_call().is_some(), 5).await);
    b.svc.decline_call(&call.call_id).await.unwrap();
    assert!(wait_for(|| a.svc.current_call().is_none(), 5).await);
    assert_eq!(call_records(a.db(), &conv).last().unwrap(), &(true, "declined".to_string()));
    assert_eq!(call_records(b.db(), &b_conv).last().unwrap(), &(false, "declined".to_string()));

    // Asha gives up while it rings: a missed call for Bharat.
    let unread_before = conv_of(b.db(), &b_conv).unwrap().unread_count;
    let call = a.svc.start_call(&conv, true, "offer".into()).await.unwrap();
    assert!(wait_for(|| b.svc.current_call().is_some(), 5).await);
    a.svc.hangup_call(&call.call_id).await.unwrap();
    assert!(wait_for(|| b.svc.current_call().is_none(), 5).await);
    assert_eq!(call_records(a.db(), &conv).last().unwrap(), &(true, "cancelled".to_string()));
    assert_eq!(call_records(b.db(), &b_conv).last().unwrap(), &(false, "missed".to_string()));
    assert_eq!(conv_of(b.db(), &b_conv).unwrap().unread_count, unread_before + 1);
    assert_eq!(
        conv_of(b.db(), &b_conv).unwrap().last_message_preview.unwrap(),
        "📞 Missed video call"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn second_caller_hears_busy_and_strangers_cannot_end_the_call() {
    let (a, b, c) = trio().await;
    let ab = a.db().get_or_create_conversation(&b.id()).unwrap().id;
    let cb = link(&c, &b).await;
    let call = a.svc.start_call(&ab, false, "offer".into()).await.unwrap();
    assert!(wait_for(|| b.svc.current_call().is_some(), 5).await);

    let err = c.svc.start_call(&cb, false, "offer".into()).await.unwrap_err();
    assert!(err.contains("on another call"), "got {}", err);
    assert!(c.svc.current_call().is_none());
    let b_with_c = b.db().get_or_create_conversation(&c.id()).unwrap().id;
    assert_eq!(call_records(b.db(), &b_with_c), vec![(false, "busy".to_string())]);

    // Chetan cannot hang up a call between Asha and Bharat.
    let chetan = b.db().get_peer(&c.id()).unwrap().unwrap();
    let mut forged = CallPayload {
        call_id: call.call_id.clone(),
        action: "hangup".into(),
        video: None,
        sdp: None,
        muted: None,
        screen: None,
    };
    assert!(!b.svc.handle_call(&chetan, forged.clone()).ok);
    assert!(b.svc.current_call().is_some(), "call must survive");
    forged.action = "accept".into();
    assert!(!a.svc.handle_call(&a.db().get_peer(&c.id()).unwrap().unwrap(), forged).ok);
    a.svc.hangup_call(&call.call_id).await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn calling_an_offline_or_blocked_colleague_explains_why() {
    let a = node("Asha").await;
    let b = node("Bharat").await;
    let conv = link(&a, &b).await;
    a.svc.peer_went_offline(&b.id());
    assert!(a.svc.start_call(&conv, false, "o".into()).await.unwrap_err().contains("offline"));
    assert!(a.svc.current_call().is_none());
    let _ = link(&a, &b).await;
    a.db().update_peer_trust(&b.id(), "blocked").unwrap();
    assert!(a.svc.start_call(&conv, false, "o".into()).await.unwrap_err().contains("blocked"));
}

// ======================================== LANX 1.2.3: lanes, folders, speed test

use super::lanes::{LanePlan, lane_count};

fn lane_plan_file(part: &Path) -> PathBuf {
    PathBuf::from(format!("{}.lanes", part.display()))
}

#[test]
fn lane_plans_split_the_rest_evenly() {
    assert_eq!(lane_count(1_000_000), 1);
    assert_eq!(lane_count(20 * 1024 * 1024), 2);
    assert_eq!(lane_count(500 * 1024 * 1024), 8);
    assert_eq!(lane_count(100 * 1024 * 1024), 4);
    let p = LanePlan::new(100 * 1024 * 1024, 10 * 1024 * 1024);
    assert_eq!(p.done(), 10 * 1024 * 1024, "the prefix from a single connection counts as done");
    assert_eq!(p.lanes.len(), 5);
    assert_eq!(p.lanes.last().unwrap().end, 100 * 1024 * 1024);
    let covered: u64 = p.lanes.iter().map(|l| l.end - l.start).sum();
    assert_eq!(covered, 100 * 1024 * 1024);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn big_file_travels_over_several_connections_and_arrives_intact() {
    let a = node("Alice").await;
    let b = node("Bob").await;
    let conv = link(&a, &b).await;
    let (id, data) = offer_file(&a, &b, &conv, 70 * 1024 * 1024).await;
    b.svc.accept_transfer(&id).await.unwrap();
    // While it runs, the sender serves several lanes at once.
    assert!(wait_for(|| a.svc.lane_sessions.lock().get(&id).is_some(), 20).await, "lanes started");
    assert!(wait_for(|| transfer_status(b.db(), &id) == "completed", 120).await);
    assert!(wait_for(|| transfer_status(a.db(), &id) == "completed", 10).await, "sender sees it finish");
    assert_eq!(received_bytes(&b, &id), data);
    let t = b.db().get_transfer(&id).unwrap().unwrap();
    assert_eq!(t.file_hash, hex::encode(Sha256::digest(&data)));
    assert_eq!(a.db().get_transfer(&id).unwrap().unwrap().file_hash, t.file_hash);
    assert!(a.svc.lane_sessions.lock().is_empty() && a.svc.active_transfers.lock().is_empty());
    let leftovers: Vec<_> = std::fs::read_dir(b.dir.path().join("Downloads"))
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| n.contains("lanxpart"))
        .collect();
    assert!(leftovers.is_empty(), "no part or plan files left: {:?}", leftovers);
}

/// A part file where every lane already holds the first half of its bytes.
fn half_done_lanes(b: &Node, id: &str, data: &[u8], corrupt: bool) -> PathBuf {
    let mut t = b.db().get_transfer(id).unwrap().unwrap();
    let dl = b.dir.path().join("Downloads");
    std::fs::create_dir_all(&dl).unwrap();
    let part = dl.join("lanes.lanxpart");
    let mut plan = LanePlan::new(data.len() as u64, 0);
    let mut bytes = vec![0u8; data.len()];
    for l in plan.lanes.iter_mut() {
        let half = (l.end - l.start) / 2;
        let (s, e) = (l.start as usize, (l.start + half) as usize);
        bytes[s..e].copy_from_slice(&data[s..e]);
        l.done = half;
    }
    if corrupt {
        let at = plan.lanes[1].start as usize + 10;
        bytes[at] ^= 0xFF; // a "done" byte that is wrong
    }
    std::fs::write(&part, &bytes).unwrap();
    std::fs::write(lane_plan_file(&part), serde_json::to_vec(&plan).unwrap()).unwrap();
    t.temp_path = Some(part.to_string_lossy().to_string());
    t.status = "failed".into();
    b.db().save_transfer(&t).unwrap();
    part
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn interrupted_lanes_resume_where_each_one_stopped() {
    let a = node("Alice").await;
    let b = node("Bob").await;
    let conv = link(&a, &b).await;
    let (id, data) = offer_file(&a, &b, &conv, 20 * 1024 * 1024).await;
    let part = half_done_lanes(&b, &id, &data, false);
    b.svc.retry_transfer(&id).await.unwrap();
    assert!(wait_for(|| transfer_status(b.db(), &id) == "completed", 60).await);
    assert_eq!(received_bytes(&b, &id), data);
    assert!(!part.exists() && !lane_plan_file(&part).exists());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn damaged_lane_data_is_caught_by_the_final_check() {
    let a = node("Alice").await;
    let b = node("Bob").await;
    let conv = link(&a, &b).await;
    let (id, data) = offer_file(&a, &b, &conv, 20 * 1024 * 1024).await;
    let part = half_done_lanes(&b, &id, &data, true);
    b.svc.retry_transfer(&id).await.unwrap();
    assert!(wait_for(|| transfer_status(b.db(), &id) == "failed", 60).await);
    let t = b.db().get_transfer(&id).unwrap().unwrap();
    assert!(t.error_reason.unwrap_or_default().contains("checksum"));
    assert!(!part.exists() && !lane_plan_file(&part).exists(), "bad data is thrown away");
    // Retry downloads it again, cleanly.
    b.svc.retry_transfer(&id).await.unwrap();
    assert!(wait_for(|| transfer_status(b.db(), &id) == "completed", 60).await);
    assert_eq!(received_bytes(&b, &id), data);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn cancelling_a_lane_transfer_stops_both_sides() {
    let a = node("Alice").await;
    let b = node("Bob").await;
    let conv = link(&a, &b).await;
    let (id, _) = offer_file(&a, &b, &conv, 200 * 1024 * 1024).await;
    b.svc.accept_transfer(&id).await.unwrap();
    assert!(wait_for(|| a.svc.lane_sessions.lock().get(&id).is_some(), 20).await);
    a.svc.cancel_transfer(&id).await.unwrap();
    assert!(wait_for(|| transfer_status(b.db(), &id) == "cancelled", 20).await);
    let ok = wait_for(|| transfer_status(a.db(), &id) == "cancelled", 20).await;
    let ta = a.db().get_transfer(&id).unwrap().unwrap();
    assert!(ok, "sender status {} ({:?}), lanes {}", ta.status, ta.error_reason, a.svc.lane_sessions.lock().len());
    assert!(wait_for(|| a.svc.lane_sessions.lock().is_empty(), 10).await);
    let parts = std::fs::read_dir(b.dir.path().join("Downloads"))
        .unwrap()
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().contains("lanxpart"))
        .count();
    assert_eq!(parts, 0, "part and plan files are removed");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn senders_on_older_lanx_still_use_one_connection() {
    let a = updater("Alice", "1.2.2").await;
    let b = node("Bob").await;
    let conv = link(&a, &b).await;
    let (id, data) = offer_file(&a, &b, &conv, 20 * 1024 * 1024).await;
    b.svc.accept_transfer(&id).await.unwrap();
    assert!(wait_for(|| transfer_status(b.db(), &id) == "completed", 60).await);
    assert_eq!(received_bytes(&b, &id), data);
    assert!(a.svc.lane_sessions.lock().is_empty(), "no lanes with a 1.2.2 sender");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_folder_is_sent_in_one_go_and_unpacked() {
    let a = node("Alice").await;
    let b = node("Bob").await;
    let conv = link(&a, &b).await;
    let folder = a.dir.path().join("Site Photos");
    std::fs::create_dir_all(folder.join("Day 2")).unwrap();
    std::fs::write(folder.join("notes.txt"), "pump room ok\n".repeat(500)).unwrap();
    let (_, img) = write_random_file(&folder.join("Day 2"), "IMG_0001.jpg", 300_000);
    let sent = a.svc.send_files(&conv, vec![folder.to_string_lossy().to_string()]).await.unwrap();
    assert_eq!(sent[0].message.content, "\u{1F4C1} Site Photos");
    let id = sent[0].transfers[0].id.clone();
    assert_eq!(sent[0].transfers[0].kind, "folder");
    assert!(wait_for(|| transfer_status(b.db(), &id) == "pending", 10).await);
    let incoming = b.db().get_transfer(&id).unwrap().unwrap();
    assert_eq!((incoming.kind.as_str(), incoming.file_name.as_str()), ("folder", "Site Photos.zip"));
    b.svc.accept_transfer(&id).await.unwrap();
    assert!(wait_for(|| transfer_status(b.db(), &id) == "completed", 30).await);
    let t = b.db().get_transfer(&id).unwrap().unwrap();
    let got = PathBuf::from(t.local_path.unwrap());
    assert!(got.is_dir() && got.ends_with("Site Photos"), "unpacked into a folder: {}", got.display());
    assert_eq!(std::fs::read_to_string(got.join("notes.txt")).unwrap(), "pump room ok\n".repeat(500));
    assert_eq!(std::fs::read(got.join("Day 2").join("IMG_0001.jpg")).unwrap(), img);
    assert!(!b.dir.path().join("Downloads").join("Site Photos.zip").exists(), "the zip is removed");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn speed_test_measures_one_and_several_connections() {
    let a = node("Alice").await;
    let b = node("Bob").await;
    link(&a, &b).await;
    let r = a.svc.speed_test(&b.id()).await.unwrap();
    assert!(r.single_mbps > 1.0 && r.multi_mbps > 1.0, "{:?}", r);
    assert_eq!(r.connections, 8);
    a.svc.peer_went_offline(&b.id());
    assert!(a.svc.speed_test(&b.id()).await.unwrap_err().contains("offline"));
}

// ================================================= LANX 1.2.4: compression

use super::lanes::ChunkCompressor;
use std::sync::atomic::Ordering as AtomicOrdering;

/// Spreadsheet-like text: compresses well, like real CSV/Excel exports or logs.
fn write_text_file(dir: &Path, name: &str, size: usize) -> (PathBuf, Vec<u8>) {
    let mut data = Vec::with_capacity(size + 100);
    let mut i = 0u64;
    while data.len() < size {
        data.extend_from_slice(
            format!("{},INV-{:06},JSW Steel Dolvi,{}.{:02},2026-10-{:02},paid\n", i, i * 7 % 999_983, 1000 + i % 977, i % 100, 1 + i % 28)
                .as_bytes(),
        );
        i += 1;
    }
    data.truncate(size);
    let path = dir.join(name);
    std::fs::write(&path, &data).unwrap();
    (path, data)
}

#[test]
fn compressor_shrinks_text_and_gives_up_on_random_data() {
    let mut text = Vec::new();
    while text.len() < FILE_CHUNK_SIZE {
        text.extend_from_slice(b"2026-10-16,Dolvi,Bearing 6205-2RS,12 pcs,INR 4,560\n");
    }
    text.truncate(FILE_CHUNK_SIZE);
    let mut c = ChunkCompressor::new(true, "ledger.csv");
    let z = c.compress(&text).expect("text compresses");
    assert!(z.len() * 4 < text.len(), "at least 4x smaller ({} -> {})", text.len(), z.len());
    assert_eq!(zstd::bulk::decompress(&z, FILE_CHUNK_SIZE).unwrap(), text);

    let mut noise = vec![0u8; FILE_CHUNK_SIZE];
    rand::thread_rng().fill_bytes(&mut noise);
    let mut c = ChunkCompressor::new(true, "backup.bin");
    for _ in 0..8 {
        assert!(c.compress(&noise).is_none());
    }
    assert!(!c.active(), "stops trying after a run of incompressible chunks");

    assert!(!ChunkCompressor::new(true, "photo.JPG").active(), "photos are never tried");
    assert!(!ChunkCompressor::new(true, "site.mp4").active());
    assert!(!ChunkCompressor::new(false, "ledger.csv").active(), "only when the receiver asked");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn compressible_big_file_is_squeezed_on_the_wire_and_arrives_intact() {
    let a = node("Alice").await;
    let b = node("Bob").await;
    let conv = link(&a, &b).await;
    let (path, data) = write_text_file(a.dir.path(), "Ledger 2026.csv", 40 * 1024 * 1024);
    let sent = a.svc.send_files(&conv, vec![path.to_string_lossy().to_string()]).await.unwrap();
    let id = sent[0].transfers[0].id.clone();
    assert!(wait_for(|| transfer_status(b.db(), &id) == "pending", 10).await);
    b.svc.accept_transfer(&id).await.unwrap();
    assert!(wait_for(|| transfer_status(b.db(), &id) == "completed", 120).await);
    assert_eq!(received_bytes(&b, &id), data);
    let saved = a.svc.bytes_saved.load(AtomicOrdering::Relaxed);
    assert!(saved > data.len() as u64 / 2, "more than half kept off the network: {} of {}", saved, data.len());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn small_text_file_is_compressed_over_a_single_connection() {
    let a = node("Alice").await;
    let b = node("Bob").await;
    let conv = link(&a, &b).await;
    let (path, data) = write_text_file(a.dir.path(), "notes.txt", 3 * 1024 * 1024);
    let sent = a.svc.send_files(&conv, vec![path.to_string_lossy().to_string()]).await.unwrap();
    let id = sent[0].transfers[0].id.clone();
    assert!(wait_for(|| transfer_status(b.db(), &id) == "pending", 10).await);
    b.svc.accept_transfer(&id).await.unwrap();
    assert!(wait_for(|| transfer_status(b.db(), &id) == "completed", 60).await);
    assert_eq!(received_bytes(&b, &id), data);
    assert!(a.svc.bytes_saved.load(AtomicOrdering::Relaxed) > 1024 * 1024);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn random_data_is_sent_as_it_is() {
    let a = node("Alice").await;
    let b = node("Bob").await;
    let conv = link(&a, &b).await;
    let (id, data) = offer_file(&a, &b, &conv, 20 * 1024 * 1024).await;
    b.svc.accept_transfer(&id).await.unwrap();
    assert!(wait_for(|| transfer_status(b.db(), &id) == "completed", 60).await);
    assert_eq!(received_bytes(&b, &id), data);
    assert_eq!(a.svc.bytes_saved.load(AtomicOrdering::Relaxed), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn no_compression_with_a_sender_on_1_2_3() {
    let a = updater("Alice", "1.2.3").await;
    let b = node("Bob").await;
    let conv = link(&a, &b).await;
    let (path, data) = write_text_file(a.dir.path(), "Ledger.csv", 20 * 1024 * 1024);
    let sent = a.svc.send_files(&conv, vec![path.to_string_lossy().to_string()]).await.unwrap();
    let id = sent[0].transfers[0].id.clone();
    assert!(wait_for(|| transfer_status(b.db(), &id) == "pending", 10).await);
    b.svc.accept_transfer(&id).await.unwrap();
    assert!(wait_for(|| transfer_status(b.db(), &id) == "completed", 60).await);
    assert_eq!(received_bytes(&b, &id), data);
    assert_eq!(a.svc.bytes_saved.load(AtomicOrdering::Relaxed), 0, "a 1.2.3 PC is never sent compressed frames");
}

/// Speed check for compression (run on purpose: cargo test --release bench_ -- --ignored --nocapture).
#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
#[ignore]
async fn bench_compression_and_transfer_speed() {
    // 1. Raw compression speed, one CPU core.
    let mut chunk = Vec::new();
    let mut i = 0u64;
    while chunk.len() < FILE_CHUNK_SIZE {
        chunk.extend_from_slice(format!("{},INV-{:06},JSW Steel Dolvi,{}.{:02},paid\n", i, i * 7 % 999_983, 1000 + i % 977, i % 100).as_bytes());
        i += 1;
    }
    chunk.truncate(FILE_CHUNK_SIZE);
    let mut c = ChunkCompressor::new(true, "x.csv");
    let t = Instant::now();
    let mut out = 0usize;
    for _ in 0..1024 {
        out += c.compress(&chunk).map(|z| z.len()).unwrap_or(FILE_CHUNK_SIZE);
    }
    let secs = t.elapsed().as_secs_f64();
    println!(
        "BENCH compress one core: {:.0} MB/s, ratio {:.1}x",
        256.0 / secs,
        (1024 * FILE_CHUNK_SIZE) as f64 / out as f64
    );

    // 2. The same 300 MB spreadsheet over loopback, compressed vs not.
    for (label, sender_version) in [("compressed (1.2.4)", None), ("plain (1.2.3 sender)", Some("1.2.3"))] {
        let a = match sender_version {
            Some(v) => updater("Alice", v).await,
            None => node("Alice").await,
        };
        let b = node("Bob").await;
        let conv = link(&a, &b).await;
        let (path, data) = write_text_file(a.dir.path(), "Ledger.csv", 300 * 1024 * 1024);
        let sent = a.svc.send_files(&conv, vec![path.to_string_lossy().to_string()]).await.unwrap();
        let id = sent[0].transfers[0].id.clone();
        assert!(wait_for(|| transfer_status(b.db(), &id) == "pending", 10).await);
        let t = Instant::now();
        b.svc.accept_transfer(&id).await.unwrap();
        assert!(wait_for(|| transfer_status(b.db(), &id) == "completed", 300).await);
        let secs = t.elapsed().as_secs_f64();
        assert_eq!(received_bytes(&b, &id).len(), data.len());
        println!(
            "BENCH 300 MB spreadsheet, {}: {:.1} s = {:.0} MB/s (saved {} MB)",
            label,
            secs,
            300.0 / secs,
            a.svc.bytes_saved.load(AtomicOrdering::Relaxed) / (1024 * 1024)
        );
    }
}

// ================================================= LANX 1.2.9: profiles

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn colleagues_fetch_each_others_profiles() {
    use crate::storage::models::Profile;
    let a = node("Alice").await;
    let b = node("Bob").await;
    link(&a, &b).await;
    link(&b, &a).await;
    let mut s = a.db().get_settings().unwrap();
    s.profile = Profile {
        avatar: "emoji:🐼".into(),
        status: "meeting".into(),
        status_text: "Quarter close".into(),
        title: "Accountant".into(),
        department: "Accounts".into(),
        ..Default::default()
    };
    a.db().save_settings(&s).unwrap();
    let rev = a.svc.local_profile_rev();
    // Bob sees Alice's new fingerprint (as in her beacon) and asks for it.
    b.svc.check_peer_profile(&a.id(), rev);
    assert!(wait_for(|| b.db().peer_profile_rev(&a.id()) == Some(rev), 10).await);
    let got = b.db().peer_profile(&a.id()).unwrap();
    assert_eq!((got.avatar.as_str(), got.status.as_str(), got.title.as_str()), ("emoji:🐼", "meeting", "Accountant"));
    assert_eq!(b.svc.island_avatar(&a.id()).as_deref(), Some("🐼"));
    // Same fingerprint: nothing is fetched again.
    assert!(a.svc.local_profile_full().rev() == rev);
    // Alice's status expires by itself.
    s.profile.status_until = now_secs() - 1;
    a.db().save_settings(&s).unwrap();
    assert!(a.svc.local_profile_full().status.is_empty());
    assert_ne!(a.svc.local_profile_rev(), rev);
}
