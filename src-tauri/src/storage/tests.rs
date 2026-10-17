use crate::storage::models::{Message, TransferRecord};
use crate::storage::schema::{LATEST_SCHEMA_VERSION, run_migrations};
use crate::storage::{Database, preview_text};
use rusqlite::Connection;
use std::time::{SystemTime, UNIX_EPOCH};

fn setup_test_db() -> Connection {
    let mut conn = Connection::open_in_memory().expect("in-memory db failed");
    run_migrations(&mut conn).expect("migrations failed");
    conn
}

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64
}

fn text_message(id: &str, conv: &str, content: &str, outgoing: bool, status: &str) -> Message {
    Message {
        id: id.to_string(),
        conversation_id: conv.to_string(),
        sender_id: if outgoing { "me" } else { "peer-1" }.to_string(),
        receiver_id: if outgoing { "peer-1" } else { "me" }.to_string(),
        content: content.to_string(),
        message_type: "text".to_string(),
        timestamp: now(),
        status: status.to_string(),
        error_reason: None,
        is_outgoing: outgoing,
        transfer_id: None,
        ttl_secs: None,
        expire_at: None,
        deliveries: None,
    }
}

#[test]
fn migrations_reach_latest_version_and_are_idempotent() {
    let mut conn = setup_test_db();
    run_migrations(&mut conn).expect("second run must be a no-op");
    let version: i64 = conn
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |r| r.get(0))
        .unwrap();
    assert_eq!(version, LATEST_SCHEMA_VERSION);
}

#[test]
fn v1_database_upgrades_in_place() {
    // A database created by LANX 0.1.0 (schema v1 only) keeps its data.
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
         CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
         CREATE TABLE peers (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, hostname TEXT, last_ip TEXT NOT NULL,
            tcp_port INTEGER NOT NULL, public_key TEXT, trust_state TEXT NOT NULL DEFAULT 'unverified',
            status TEXT NOT NULL DEFAULT 'offline', last_seen INTEGER NOT NULL, avatar_color TEXT NOT NULL DEFAULT '#3b82f6');
         CREATE TABLE conversations (id TEXT PRIMARY KEY, peer_id TEXT NOT NULL, last_message_preview TEXT,
            last_message_time INTEGER NOT NULL, unread_count INTEGER NOT NULL DEFAULT 0, is_pinned INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL);
         CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, sender_id TEXT NOT NULL,
            receiver_id TEXT NOT NULL, content TEXT NOT NULL, message_type TEXT NOT NULL DEFAULT 'text',
            timestamp INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'sending', error_reason TEXT,
            is_outgoing INTEGER NOT NULL DEFAULT 0);
         CREATE TABLE transfers (id TEXT PRIMARY KEY, peer_id TEXT NOT NULL, file_name TEXT NOT NULL,
            file_size INTEGER NOT NULL, file_hash TEXT NOT NULL, direction TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending', transferred_bytes INTEGER NOT NULL DEFAULT 0,
            local_path TEXT, created_at INTEGER NOT NULL, completed_at INTEGER);
         INSERT INTO schema_migrations VALUES (1, 0);
         INSERT INTO messages VALUES ('old', 'c', 'a', 'b', 'hi', 'text', 1, 'delivered', NULL, 0);",
    )
    .unwrap();
    run_migrations(&mut conn).unwrap();
    let (content, tid): (String, Option<String>) = conn
        .query_row("SELECT content, transfer_id FROM messages WHERE id = 'old'", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .unwrap();
    assert_eq!(content, "hi");
    assert!(tid.is_none());
}

#[test]
fn preview_never_splits_multibyte_characters() {
    // Used to panic (byte slicing) and crash the app for Hindi or emoji text.
    let hindi = "नमस्ते ".repeat(20);
    let p = preview_text(&hindi);
    assert!(p.ends_with('…'));
    assert_eq!(p.chars().count(), 61);
    assert_eq!(preview_text("short ✅"), "short ✅");
    let emoji = "🎉".repeat(100);
    assert_eq!(preview_text(&emoji).chars().count(), 61);
}

#[test]
fn incoming_hindi_message_is_stored_with_preview() {
    let db = Database::new_in_memory().unwrap();
    let conv = db.get_or_create_conversation("peer-1").unwrap();
    let long = "कृपया संलग्न कोटेशन की समीक्षा करें और आज शाम तक पुष्टि करें धन्यवाद";
    db.insert_message(&text_message("m1", &conv.id, long, false, "delivered")).unwrap();
    db.increment_unread(&conv.id).unwrap();
    let c = db.get_conversation(&conv.id).unwrap().unwrap();
    assert_eq!(c.unread_count, 1);
    assert!(c.last_message_preview.unwrap().starts_with("कृपया"));
    assert_eq!(db.total_unread(), 1);
    db.mark_conversation_read(&conv.id, true).unwrap();
    assert_eq!(db.total_unread(), 0);
}

#[test]
fn search_finds_text_in_any_message() {
    let db = Database::new_in_memory().unwrap();
    let conv = db.get_or_create_conversation("peer-1").unwrap();
    db.insert_message(&text_message("a", &conv.id, "Quote for RFP 3100851312", true, "delivered")).unwrap();
    db.insert_message(&text_message("b", &conv.id, "lunch?", false, "delivered")).unwrap();
    db.insert_message(&text_message("c", &conv.id, "100% done_now", false, "delivered")).unwrap();
    let hits = db.search_messages("rfp 3100", 10, false).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].message.id, "a");
    assert_eq!(db.search_messages("100%", 10, false).unwrap().len(), 1, "% is literal");
    assert_eq!(db.search_messages("e_n", 10, false).unwrap().len(), 1, "_ is literal");
    assert!(db.search_messages("  ", 10, false).unwrap().is_empty());
}

#[test]
fn outbox_and_restart_recovery() {
    let db = Database::new_in_memory().unwrap();
    let conv = db.get_or_create_conversation("peer-1").unwrap();
    db.insert_message(&text_message("a", &conv.id, "one", true, "sending")).unwrap();
    db.insert_message(&text_message("b", &conv.id, "two", true, "delivered")).unwrap();
    db.insert_message(&text_message("c", &conv.id, "three", false, "delivered")).unwrap();
    assert!(db.has_pending_outbox("peer-1"));
    let pending: Vec<String> = db
        .pending_outgoing_messages("peer-1")
        .unwrap()
        .into_iter()
        .map(|m| m.id)
        .collect();
    assert_eq!(pending, vec!["a"]);

    db.insert_transfer(&TransferRecord {
        id: "t1".into(),
        peer_id: "peer-1".into(),
        peer_name: None,
        conversation_id: Some(conv.id.clone()),
        file_name: "x.bin".into(),
        file_size: 10,
        file_hash: String::new(),
        direction: "incoming".into(),
        status: "transferring".into(),
        transferred_bytes: 5,
        local_path: None,
        error_reason: None,
        created_at: now(),
        completed_at: None,
        duration_ms: None,
        started_bytes: None,
        parent_id: None,
        temp_path: Some("x.lanxpart".into()),
        kind: "file".into(),
    })
    .unwrap();

    db.recover_after_restart().unwrap();
    assert_eq!(db.get_message_by_id("a").unwrap().unwrap().status, "queued");
    let t = db.get_transfer("t1").unwrap().unwrap();
    assert_eq!(t.status, "failed");
    assert_eq!(t.temp_path.as_deref(), Some("x.lanxpart"));
}

#[test]
fn transfers_remember_how_long_they_took() {
    let db = Database::new_in_memory().unwrap();
    let mut t = TransferRecord {
        id: "tt".into(),
        peer_id: "p".into(),
        peer_name: None,
        conversation_id: None,
        file_name: "a.bin".into(),
        file_size: 1000,
        file_hash: String::new(),
        direction: "incoming".into(),
        status: "pending".into(),
        transferred_bytes: 0,
        local_path: None,
        error_reason: None,
        created_at: now(),
        completed_at: None,
        duration_ms: None,
        started_bytes: None,
        parent_id: None,
        temp_path: None,
        kind: "file".into(),
    };
    db.insert_transfer(&t).unwrap();
    t.status = "transferring".into();
    db.save_transfer(&t).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(30));
    db.save_transfer(&t).unwrap(); // still running: the start time is kept
    t.status = "failed".into();
    t.transferred_bytes = 400;
    db.save_transfer(&t).unwrap();
    t.status = "transferring".into(); // resumed at 400 bytes
    db.save_transfer(&t).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(25));
    db.update_transfer_status("tt", "completed", None).unwrap();
    let got = db.get_transfer("tt").unwrap().unwrap();
    assert_eq!(got.started_bytes, Some(400), "speed counts from the resume point");
    let d = got.duration_ms.expect("duration recorded");
    assert!((20..5000).contains(&d), "last run only: {d} ms");
    db.update_transfer_status("tt", "completed", None).unwrap();
    assert_eq!(db.get_transfer("tt").unwrap().unwrap().duration_ms, Some(d), "kept once completed");
}

#[test]
fn settings_round_trip_including_new_fields() {
    let db = Database::new_in_memory().unwrap();
    let mut s = db.get_settings().unwrap();
    assert!(s.launch_at_startup && s.close_to_tray, "defaults on");
    s.display_name = "  Jinesh  ".into();
    s.close_to_tray = false;
    s.discovery_interval_secs = 999;
    db.save_settings(&s).unwrap();
    let s2 = db.get_settings().unwrap();
    assert_eq!(s2.display_name, "Jinesh");
    assert!(!s2.close_to_tray);
    assert_eq!(s2.discovery_interval_secs, 60, "clamped");
}

#[test]
fn appearance_settings_round_trip_and_are_cleaned() {
    let db = Database::new_in_memory().unwrap();
    let mut s = db.get_settings().unwrap();
    assert_eq!((s.chat_background.as_str(), s.accent_color.as_str()), ("default", "default"));
    assert_eq!((s.glass_level, s.frost_level), (55, 60), "glass is on by default");
    assert!(!s.reduce_motion, "animations are on by default");
    assert!(s.cat_alerts, "the delivery cat is on by default");
    s.chat_background = "ocean".into();
    s.accent_color = "#FF8800".into();
    s.glass_level = 0;
    s.frost_level = 250;
    s.reduce_motion = true;
    s.cat_alerts = false;
    db.save_settings(&s).unwrap();
    let s2 = db.get_settings().unwrap();
    assert_eq!(s2.chat_background, "ocean");
    assert_eq!(s2.accent_color, "#ff8800");
    assert_eq!((s2.glass_level, s2.frost_level), (0, 100), "solid allowed, frost clamped");
    assert!(s2.reduce_motion);
    assert!(!s2.cat_alerts);
    s.chat_background = "url(evil)".into();
    s.accent_color = "purple; x".into();
    db.save_settings(&s).unwrap();
    let s3 = db.get_settings().unwrap();
    assert_eq!((s3.chat_background.as_str(), s3.accent_color.as_str()), ("default", "default"));
    s.accent_color = "purple".into();
    db.save_settings(&s).unwrap();
    assert_eq!(db.get_settings().unwrap().accent_color, "purple");
}

#[test]
fn profiles_are_cleaned_expire_and_round_trip() {
    use crate::storage::models::Profile;
    let p = Profile {
        avatar: "photo".into(),
        photo: "javascript:alert(1)".into(),
        status: "partying".into(),
        status_text: "x".repeat(200),
        title: "  Accounts Manager  ".into(),
        email: "a@b.c\u{7}".into(),
        ..Default::default()
    }
    .cleaned();
    assert_eq!(p.avatar, "initials", "a bad photo is dropped");
    assert!(p.photo.is_empty());
    assert_eq!(p.status, "", "unknown status dropped");
    assert_eq!(p.status_text.chars().count(), 80);
    assert_eq!(p.title, "Accounts Manager");
    assert_eq!(p.email, "a@b.c", "control characters removed");
    assert_eq!(Profile { avatar: "emoji:🐱".into(), ..Default::default() }.cleaned().avatar, "emoji:🐱");
    assert_eq!(Profile { avatar: "emoji:<b>".into(), ..Default::default() }.cleaned().avatar, "initials");
    let good = Profile { avatar: "photo".into(), photo: "data:image/webp;base64,UklGRg==".into(), ..Default::default() }.cleaned();
    assert_eq!(good.avatar, "photo");

    let busy = Profile { status: "meeting".into(), status_text: "Budget".into(), status_until: 100, ..Default::default() };
    assert_eq!(busy.effective(99).status, "meeting");
    let later = busy.effective(100);
    assert!(later.status.is_empty() && later.status_text.is_empty(), "expired status clears");
    assert_ne!(busy.effective(99).rev(), later.rev(), "fingerprint changes with what colleagues see");

    let db = Database::new_in_memory().unwrap();
    let mut s = db.get_settings().unwrap();
    s.profile = Profile { avatar: "emoji:🦊".into(), status: "dnd".into(), title: "Stores".into(), ..Default::default() };
    db.save_settings(&s).unwrap();
    let back = db.get_settings().unwrap().profile;
    assert_eq!((back.avatar.as_str(), back.status.as_str(), back.title.as_str()), ("emoji:🦊", "dnd", "Stores"));
    db.set_peer_profile("peer-1", 42, &back).unwrap();
    assert_eq!(db.peer_profile_rev("peer-1"), Some(42));
    assert_eq!(db.peer_profiles().unwrap().get("peer-1"), Some(&back));
}
