//! Backups of the LANX database: chats, contacts, groups, settings and this
//! computer's identity key. (Received files stay where they were saved.)
//!
//! - Automatic: once a day into `%APPDATA%\LANX\Backups`, keeping the last 7.
//! - "Back up now": same folder, keeping the last 10.
//! - "Save a backup file…": a password-encrypted copy for a USB drive or a
//!   new computer.
//! - Restore: the chosen backup is staged as `restore-pending.db` and LANX
//!   restarts. Before the database is opened, the current chats are saved as a
//!   "before restore" backup (so a restore can be undone) and the staged copy
//!   takes their place.
//!
//! Secret-chat messages are never written to a backup.

use crate::storage::Database;
use crate::storage::schema::LATEST_SCHEMA_VERSION;
use argon2::Argon2;
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use parking_lot::Mutex;
use rand::RngCore;
use rand::rngs::OsRng;
use rusqlite::{Connection, OpenFlags, params};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

pub const EXT: &str = "lanxbackup";
const MAGIC: &[u8; 8] = b"LANXBK01";
const SQLITE_MAGIC: &[u8; 16] = b"SQLite format 3\0";
const PENDING: &str = "restore-pending.db";
pub const AUTO_EVERY_SECS: i64 = 24 * 3600;
/// How many backups of each kind are kept (oldest are removed first).
const KEEP: [(&str, usize); 4] = [("auto", 7), ("manual", 10), ("before-restore", 5), ("imported", 3)];
/// The UI asks for the password when it sees this error.
pub const NEEDS_PASSWORD: &str = "PASSWORD";

#[derive(Debug, Clone, Serialize)]
pub struct BackupInfo {
    pub file_name: String,
    pub path: String,
    /// auto | manual | before-restore | imported | file
    pub kind: String,
    pub created_at: i64,
    pub size_bytes: u64,
    pub conversations: i64,
    pub messages: i64,
    pub display_name: String,
    pub app_version: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct BackupOverview {
    pub auto_enabled: bool,
    pub folder: String,
    pub backups: Vec<BackupInfo>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PickedBackup {
    pub path: String,
    pub encrypted: bool,
    pub info: Option<BackupInfo>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RestoreNotice {
    pub ok: bool,
    pub text: String,
}

/// Result of a restore applied at start-up, shown once by the UI.
static NOTICE: Mutex<Option<RestoreNotice>> = Mutex::new(None);

pub fn set_notice(ok: bool, text: String) {
    *NOTICE.lock() = Some(RestoreNotice { ok, text });
}

pub fn take_notice() -> Option<RestoreNotice> {
    NOTICE.lock().take()
}

fn now_secs() -> i64 {
    chrono::Utc::now().timestamp()
}

pub fn backups_dir_for(data_dir: &Path) -> PathBuf {
    data_dir.join("Backups")
}

pub fn backups_dir(db: &Database) -> PathBuf {
    backups_dir_for(db.get_path().parent().unwrap_or(Path::new(".")))
}

fn stamp(ts: i64) -> String {
    chrono::DateTime::from_timestamp(ts, 0)
        .map(|d| d.with_timezone(&chrono::Local).format("%Y-%m-%d %H.%M.%S").to_string())
        .unwrap_or_else(|| ts.to_string())
}

/// Readable date for messages, e.g. "16 Oct 2026, 13:05".
pub fn describe_time(ts: i64) -> String {
    chrono::DateTime::from_timestamp(ts, 0)
        .map(|d| d.with_timezone(&chrono::Local).format("%d %b %Y, %H:%M").to_string())
        .unwrap_or_default()
}

fn kind_of(file_name: &str) -> &'static str {
    // "before-restore" first: it must not be mistaken for anything shorter.
    for (k, _) in KEEP {
        if file_name.starts_with(&format!("{}-", k)) {
            return k;
        }
    }
    "file"
}

fn unique_path(dir: &Path, kind: &str, ts: i64) -> PathBuf {
    let base = format!("{}-{}", kind, stamp(ts));
    let mut p = dir.join(format!("{}.{}", base, EXT));
    let mut n = 2;
    while p.exists() {
        p = dir.join(format!("{} ({}).{}", base, n, EXT));
        n += 1;
    }
    p
}

fn has_column(c: &Connection, table: &str, column: &str) -> bool {
    c.query_row(
        &format!("SELECT COUNT(*) FROM pragma_table_info('{}') WHERE name = ?1", table),
        params![column],
        |r| r.get::<_, i64>(0),
    )
    .unwrap_or(0)
        > 0
}

/// Writes a consistent copy of an open database to `dest`, without secret
/// messages, and labels it with what it contains.
fn snapshot_conn(conn: &Connection, dest: &Path, kind: &str, app_version: &str) -> Result<(), String> {
    let tmp = dest.with_extension("partial");
    let _ = fs::remove_file(&tmp);
    conn.execute("VACUUM INTO ?1", params![tmp.to_string_lossy()])
        .map_err(|e| format!("Could not copy the chats: {}", e))?;

    let labelled = (|| -> rusqlite::Result<()> {
        let c = Connection::open(&tmp)?;
        c.execute_batch(
            "PRAGMA journal_mode = DELETE;
             PRAGMA secure_delete = ON;
             PRAGMA foreign_keys = ON;
             DELETE FROM settings WHERE key IN ('pin_failed', 'pin_retry_until');
             CREATE TABLE IF NOT EXISTS lanx_backup (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             DELETE FROM lanx_backup;",
        )?;
        if has_column(&c, "messages", "ttl_secs") {
            c.execute("DELETE FROM messages WHERE ttl_secs IS NOT NULL", [])?;
        }
        let count = |sql: &str| c.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap_or(0);
        let conversations = count("SELECT COUNT(*) FROM conversations");
        let messages = count("SELECT COUNT(*) FROM messages WHERE message_type <> 'system'");
        let name: String = c
            .query_row("SELECT value FROM settings WHERE key = 'display_name'", [], |r| r.get(0))
            .unwrap_or_default();
        let created = now_secs().to_string();
        let (conversations, messages) = (conversations.to_string(), messages.to_string());
        for (k, v) in [
            ("kind", kind),
            ("created_at", created.as_str()),
            ("app_version", app_version),
            ("display_name", name.as_str()),
            ("conversations", conversations.as_str()),
            ("messages", messages.as_str()),
        ] {
            c.execute("INSERT INTO lanx_backup (key, value) VALUES (?1, ?2)", params![k, v])?;
        }
        // Compact, so deleted secret messages are gone from the file too.
        c.execute_batch("VACUUM;")?;
        Ok(())
    })();
    if let Err(e) = labelled {
        let _ = fs::remove_file(&tmp);
        return Err(format!("Could not finish the backup: {}", e));
    }
    fs::rename(&tmp, dest).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Could not save the backup: {}", e)
    })
}

/// Reads what a backup contains. None if it is not a LANX database.
pub fn read_info(path: &Path) -> Option<BackupInfo> {
    let c = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()?;
    let meta = |k: &str| {
        c.query_row("SELECT value FROM lanx_backup WHERE key = ?1", params![k], |r| r.get::<_, String>(0))
            .ok()
    };
    let count = |sql: &str| c.query_row(sql, [], |r| r.get::<_, i64>(0)).ok();
    let setting = |k: &str| {
        c.query_row("SELECT value FROM settings WHERE key = ?1", params![k], |r| r.get::<_, String>(0))
            .ok()
    };
    // Must look like a LANX database.
    setting("device_id")?;
    let file_meta = fs::metadata(path).ok()?;
    let modified = file_meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let file_name = path.file_name()?.to_string_lossy().to_string();
    Some(BackupInfo {
        kind: kind_of(&file_name).to_string(),
        file_name,
        path: path.to_string_lossy().to_string(),
        created_at: meta("created_at").and_then(|v| v.parse().ok()).unwrap_or(modified),
        size_bytes: file_meta.len(),
        conversations: meta("conversations")
            .and_then(|v| v.parse().ok())
            .or_else(|| count("SELECT COUNT(*) FROM conversations"))
            .unwrap_or(0),
        messages: meta("messages")
            .and_then(|v| v.parse().ok())
            .or_else(|| count("SELECT COUNT(*) FROM messages WHERE message_type <> 'system'"))
            .unwrap_or(0),
        display_name: meta("display_name").or_else(|| setting("display_name")).unwrap_or_default(),
        app_version: meta("app_version").unwrap_or_default(),
    })
}

/// Checks that a file is a healthy LANX database this version can open.
pub fn validate(path: &Path) -> Result<(), String> {
    const NOT_LANX: &str = "This file is not a LANX backup (or it is damaged).";
    let c = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| NOT_LANX.to_string())?;
    let check: String = c
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(|_| NOT_LANX.to_string())?;
    if check != "ok" {
        return Err("This backup file is damaged.".to_string());
    }
    let version: i64 = c
        .query_row("SELECT COALESCE(MAX(version), 0) FROM schema_migrations", [], |r| r.get(0))
        .map_err(|_| NOT_LANX.to_string())?;
    if version > LATEST_SCHEMA_VERSION {
        return Err("This backup was made by a newer LANX. Update LANX on this computer first.".to_string());
    }
    let identity: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM settings WHERE key IN ('device_id', 'identity_secret_key') AND value <> ''",
            [],
            |r| r.get(0),
        )
        .map_err(|_| NOT_LANX.to_string())?;
    if identity < 2 {
        return Err(NOT_LANX.to_string());
    }
    Ok(())
}

/// Removes the oldest backups of each kind beyond what is kept. `just_made`
/// is never removed.
fn prune(dir: &Path, just_made: Option<&Path>) {
    let mut all: Vec<(String, PathBuf, std::time::SystemTime)> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == EXT))
        .filter(|p| Some(p.as_path()) != just_made)
        .map(|p| {
            let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            let modified = fs::metadata(&p)
                .and_then(|m| m.modified())
                .unwrap_or(std::time::UNIX_EPOCH);
            (kind_of(&name).to_string(), p, modified)
        })
        .collect();
    all.sort_by(|a, b| b.2.cmp(&a.2));
    let made_kind = just_made
        .and_then(|p| p.file_name())
        .map(|n| kind_of(&n.to_string_lossy()).to_string());
    for (kind, keep) in KEEP {
        let keep = if made_kind.as_deref() == Some(kind) { keep.saturating_sub(1) } else { keep };
        for (_, path, _) in all.iter().filter(|(k, _, _)| k == kind).skip(keep) {
            let _ = fs::remove_file(path);
        }
    }
}

/// Saves a backup of the live database in the Backups folder.
pub fn create_backup(db: &Database, kind: &str, app_version: &str) -> Result<BackupInfo, String> {
    let dir = backups_dir(db);
    fs::create_dir_all(&dir).map_err(|e| format!("Could not create {}: {}", dir.display(), e))?;
    let dest = unique_path(&dir, kind, now_secs());
    {
        let conn = db.conn.lock();
        snapshot_conn(&conn, &dest, kind, app_version)?;
    }
    prune(&dir, Some(&dest));
    read_info(&dest).ok_or_else(|| "The backup could not be read back.".to_string())
}

pub fn list_backups(db: &Database) -> Vec<BackupInfo> {
    let mut out: Vec<BackupInfo> = fs::read_dir(backups_dir(db))
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == EXT))
        .filter_map(|p| read_info(&p))
        .collect();
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    out
}

pub fn overview(db: &Database) -> BackupOverview {
    BackupOverview {
        auto_enabled: auto_enabled(db),
        folder: backups_dir(db).to_string_lossy().to_string(),
        backups: list_backups(db),
    }
}

/// A backup in the Backups folder, by file name (never a path from outside).
pub fn backup_path(db: &Database, file_name: &str) -> Result<PathBuf, String> {
    let ok = !file_name.is_empty()
        && !file_name.contains(['/', '\\', ':'])
        && !file_name.contains("..")
        && file_name.ends_with(&format!(".{}", EXT));
    let path = backups_dir(db).join(file_name);
    if !ok || !path.is_file() {
        return Err("That backup no longer exists.".to_string());
    }
    Ok(path)
}

pub fn auto_enabled(db: &Database) -> bool {
    db.get_setting("auto_backup").map(|v| v != "false").unwrap_or(true)
}

pub fn set_auto_enabled(db: &Database, enabled: bool) -> Result<(), String> {
    db.set_setting("auto_backup", if enabled { "true" } else { "false" })
        .map_err(|e| e.to_string())
}

/// Makes the daily automatic backup when it is due.
pub fn auto_backup_if_due(db: &Database, app_version: &str) -> Option<BackupInfo> {
    if !auto_enabled(db) || !db.get_settings().ok()?.onboarding_completed {
        return None;
    }
    let now = now_secs();
    let last = db
        .get_setting("last_auto_backup")
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0);
    // (A "last" in the future means the clock was changed: back up anyway.)
    if last <= now && now - last < AUTO_EVERY_SECS {
        return None;
    }
    match create_backup(db, "auto", app_version) {
        Ok(info) => {
            let _ = db.set_setting("last_auto_backup", &now.to_string());
            Some(info)
        }
        Err(e) => {
            eprintln!("[Backup] automatic backup failed: {}", e);
            None
        }
    }
}

// ------------------------------------------------------- encrypted files

pub fn validate_password(password: &str) -> Result<(), String> {
    if password.chars().count() < 6 {
        return Err("Use at least 6 characters for the backup password.".to_string());
    }
    Ok(())
}

fn derive_key(password: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let mut key = [0u8; 32];
    Argon2::default()
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| e.to_string())?;
    Ok(key)
}

/// `MAGIC ‖ salt(16) ‖ nonce(12) ‖ ChaCha20-Poly1305(Argon2id(password, salt))`
pub fn encrypt(plain: &[u8], password: &str) -> Result<Vec<u8>, String> {
    let mut salt = [0u8; 16];
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce);
    let key = derive_key(password, &salt)?;
    let ct = ChaCha20Poly1305::new(Key::from_slice(&key))
        .encrypt(Nonce::from_slice(&nonce), Payload { msg: plain, aad: MAGIC })
        .map_err(|_| "Could not encrypt the backup.".to_string())?;
    let mut out = Vec::with_capacity(MAGIC.len() + 28 + ct.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&salt);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ct);
    Ok(out)
}

pub fn decrypt(data: &[u8], password: &str) -> Result<Vec<u8>, String> {
    if data.len() < MAGIC.len() + 28 + 16 || &data[..MAGIC.len()] != MAGIC {
        return Err("This is not a LANX backup file.".to_string());
    }
    let salt = &data[8..24];
    let nonce = &data[24..36];
    let key = derive_key(password, salt)?;
    ChaCha20Poly1305::new(Key::from_slice(&key))
        .decrypt(Nonce::from_slice(nonce), Payload { msg: &data[36..], aad: MAGIC })
        .map_err(|_| "Wrong password, or the file is damaged.".to_string())
}

/// Looks at a chosen file: encrypted backup, plain backup, or not LANX.
pub fn inspect_file(path: &Path) -> Result<PickedBackup, String> {
    use std::io::Read;
    let mut head = [0u8; 16];
    let n = fs::File::open(path)
        .and_then(|mut f| f.read(&mut head))
        .map_err(|e| format!("Could not read the file: {}", e))?;
    let p = path.to_string_lossy().to_string();
    if n >= 8 && &head[..8] == MAGIC {
        return Ok(PickedBackup { path: p, encrypted: true, info: None });
    }
    if n == 16 && &head == SQLITE_MAGIC {
        if let Some(info) = read_info(path) {
            return Ok(PickedBackup { path: p, encrypted: false, info: Some(info) });
        }
    }
    Err("This is not a LANX backup file.".to_string())
}

/// Writes an encrypted backup file to `dest` (e.g. a USB drive).
pub fn export_backup(db: &Database, dest: &Path, password: &str, app_version: &str) -> Result<(), String> {
    validate_password(password)?;
    let dir = backups_dir(db);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!("export-{}.tmp", uuid::Uuid::new_v4()));
    {
        let conn = db.conn.lock();
        snapshot_conn(&conn, &tmp, "file", app_version)?;
    }
    let plain = fs::read(&tmp).map_err(|e| e.to_string());
    let _ = fs::remove_file(&tmp);
    let sealed = encrypt(&plain?, password)?;
    let partial = dest.with_extension("partial");
    fs::write(&partial, sealed)
        .and_then(|_| fs::rename(&partial, dest))
        .map_err(|e| {
            let _ = fs::remove_file(&partial);
            format!("Could not save {}: {}", dest.display(), e)
        })
}

/// Copies a chosen backup file (decrypting it if needed) into the Backups
/// folder as "imported-…", after checking it.
pub fn import_file(db: &Database, src: &Path, password: Option<&str>) -> Result<BackupInfo, String> {
    let data = fs::read(src).map_err(|e| format!("Could not read the file: {}", e))?;
    let plain = if data.starts_with(MAGIC) {
        let pw = password.filter(|p| !p.is_empty()).ok_or(NEEDS_PASSWORD)?;
        decrypt(&data, pw)?
    } else if data.starts_with(SQLITE_MAGIC) {
        data
    } else {
        return Err("This is not a LANX backup file.".to_string());
    };
    let dir = backups_dir(db);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = unique_path(&dir, "imported", now_secs());
    let partial = dest.with_extension("partial");
    fs::write(&partial, plain).map_err(|e| e.to_string())?;
    if let Err(e) = validate(&partial) {
        let _ = fs::remove_file(&partial);
        return Err(e);
    }
    fs::rename(&partial, &dest).map_err(|e| e.to_string())?;
    prune(&dir, Some(&dest));
    read_info(&dest).ok_or_else(|| "This is not a LANX backup file.".to_string())
}

// ----------------------------------------------------------------- restore

/// Puts a backup in place to be restored when LANX restarts.
pub fn stage_restore(db: &Database, backup: &Path) -> Result<(), String> {
    validate(backup)?;
    let data_dir = db.get_path().parent().ok_or("No data folder")?;
    fs::copy(backup, data_dir.join(PENDING))
        .map(|_| ())
        .map_err(|e| format!("Could not prepare the restore: {}", e))
}

/// Runs at start-up, before the database is opened. Ok(Some(info)) when a
/// staged backup was swapped in.
pub fn apply_pending_restore(data_dir: &Path, app_version: &str) -> Result<Option<BackupInfo>, String> {
    let pending = data_dir.join(PENDING);
    if !pending.exists() {
        return Ok(None);
    }
    let give_up = |e: String| {
        let _ = fs::remove_file(data_dir.join("restore-failed.db"));
        let _ = fs::rename(&pending, data_dir.join("restore-failed.db"));
        Err(e)
    };
    if let Err(e) = validate(&pending) {
        return give_up(e);
    }
    let info = read_info(&pending);
    let live = data_dir.join("lanx.db");
    if live.exists() {
        // Keep how things are now, so the restore can be undone.
        let dir = backups_dir_for(data_dir);
        if let Err(e) = fs::create_dir_all(&dir) {
            return give_up(e.to_string());
        }
        let dest = unique_path(&dir, "before-restore", now_secs());
        let saved = Connection::open(&live)
            .map_err(|e| e.to_string())
            .and_then(|conn| snapshot_conn(&conn, &dest, "before-restore", app_version));
        if let Err(e) = saved {
            return give_up(format!("Could not save the current chats first, so nothing was changed. ({})", e));
        }
        prune(&dir, Some(&dest));
    }
    for name in ["lanx.db", "lanx.db-wal", "lanx.db-shm"] {
        let p = data_dir.join(name);
        if p.exists() {
            if let Err(e) = fs::remove_file(&p) {
                return give_up(format!("Could not replace {}: {}", name, e));
            }
        }
    }
    fs::rename(&pending, &live).map_err(|e| format!("Could not put the backup in place: {}", e))?;
    Ok(info)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::security::DeviceIdentity;
    use crate::storage::models::Message;

    fn msg(id: &str, conv: &str, content: &str, ttl: Option<u32>) -> Message {
        Message {
            id: id.to_string(),
            conversation_id: conv.to_string(),
            sender_id: "me".to_string(),
            receiver_id: "peer-1".to_string(),
            content: content.to_string(),
            message_type: "text".to_string(),
            timestamp: now_secs(),
            status: "sent".to_string(),
            error_reason: None,
            is_outgoing: true,
            transfer_id: None,
            ttl_secs: ttl,
            expire_at: None,
            deliveries: None,
        }
    }

    fn db_with_chat(dir: &Path) -> (Database, String) {
        let db = Database::open(dir).unwrap();
        DeviceIdentity::load_or_create(&db.conn.lock()).unwrap();
        db.upsert_peer(&crate::storage::models::Peer {
            id: "peer-1".into(),
            display_name: "Bharat".into(),
            hostname: "STORES".into(),
            last_ip: "10.0.0.2".into(),
            tcp_port: 52926,
            public_key: None,
            trust_state: "unverified".into(),
            status: "online".into(),
            last_seen: now_secs(),
            avatar_color: "#123456".into(),
        })
        .unwrap();
        let conv = db.get_or_create_conversation("peer-1").unwrap().id;
        db.insert_message(&msg("m1", &conv, "Quarter close on Friday", None)).unwrap();
        db.insert_message(&msg("m2", &conv, "locker code 4417", Some(30))).unwrap();
        (db, conv)
    }

    #[test]
    fn backup_keeps_chats_but_never_secret_messages() {
        let dir = tempfile::tempdir().unwrap();
        let (db, _) = db_with_chat(dir.path());
        let info = create_backup(&db, "manual", "1.2.0").unwrap();
        assert_eq!(info.kind, "manual");
        assert_eq!(info.conversations, 1);
        assert_eq!(info.messages, 1);
        assert_eq!(info.app_version, "1.2.0");
        validate(Path::new(&info.path)).unwrap();
        let bytes = fs::read(&info.path).unwrap();
        let has = |needle: &str| bytes.windows(needle.len()).any(|w| w == needle.as_bytes());
        assert!(has("Quarter close on Friday"));
        assert!(!has("locker code 4417"), "secret text must not be anywhere in the file");
        assert_eq!(list_backups(&db).len(), 1);
    }

    #[test]
    fn automatic_backup_runs_once_a_day_and_old_ones_are_pruned() {
        let dir = tempfile::tempdir().unwrap();
        let (db, _) = db_with_chat(dir.path());
        assert!(auto_backup_if_due(&db, "1.2.0").is_none(), "not before onboarding");
        db.set_setting("onboarding_completed", "true").unwrap();
        assert!(auto_backup_if_due(&db, "1.2.0").is_some());
        assert!(auto_backup_if_due(&db, "1.2.0").is_none(), "only once a day");
        set_auto_enabled(&db, false).unwrap();
        db.set_setting("last_auto_backup", "0").unwrap();
        assert!(auto_backup_if_due(&db, "1.2.0").is_none(), "switched off");
        for _ in 0..9 {
            create_backup(&db, "auto", "1.2.0").unwrap();
        }
        let autos = list_backups(&db).iter().filter(|b| b.kind == "auto").count();
        assert_eq!(autos, 7);
    }

    #[test]
    fn encrypted_file_round_trip_and_wrong_password() {
        let dir = tempfile::tempdir().unwrap();
        let (db, _) = db_with_chat(dir.path());
        let out = dir.path().join("usb.lanxbackup");
        assert!(export_backup(&db, &out, "123", "1.2.0").is_err(), "short password refused");
        export_backup(&db, &out, "office-2026", "1.2.0").unwrap();
        let bytes = fs::read(&out).unwrap();
        assert!(bytes.starts_with(MAGIC));
        assert!(!bytes.windows(7).any(|w| w == b"Quarter"), "file must be encrypted");
        assert!(inspect_file(&out).unwrap().encrypted);
        assert_eq!(import_file(&db, &out, None).unwrap_err(), NEEDS_PASSWORD);
        assert!(import_file(&db, &out, Some("wrong-pass")).unwrap_err().contains("Wrong password"));
        let imported = import_file(&db, &out, Some("office-2026")).unwrap();
        assert_eq!(imported.kind, "imported");
        assert_eq!(imported.messages, 1);
        let junk = dir.path().join("junk.lanxbackup");
        fs::write(&junk, b"hello").unwrap();
        assert!(inspect_file(&junk).is_err());
    }

    #[test]
    fn restore_swaps_the_database_and_keeps_an_undo_copy() {
        let dir = tempfile::tempdir().unwrap();
        let (db, conv) = db_with_chat(dir.path());
        let device_id = db.get_setting("device_id").unwrap();
        let backup = create_backup(&db, "manual", "1.2.0").unwrap();
        // Something unwanted happens after the backup.
        db.insert_message(&msg("m3", &conv, "added after the backup", None)).unwrap();
        db.delete_conversation(&conv).unwrap();
        stage_restore(&db, Path::new(&backup.path)).unwrap();
        drop(db);

        let restored = apply_pending_restore(dir.path(), "1.2.0").unwrap().unwrap();
        assert_eq!(restored.created_at, backup.created_at);
        let db = Database::open(dir.path()).unwrap();
        assert_eq!(db.get_setting("device_id").unwrap(), device_id, "same identity");
        let msgs = db.get_messages(&conv).unwrap();
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].content, "Quarter close on Friday");
        let undo: Vec<_> = list_backups(&db).into_iter().filter(|b| b.kind == "before-restore").collect();
        assert_eq!(undo.len(), 1);
        assert_eq!(undo[0].conversations, 0, "undo copy is how things were just before");
        assert!(apply_pending_restore(dir.path(), "1.2.0").unwrap().is_none(), "nothing left to apply");
    }

    #[test]
    fn restore_refuses_broken_or_newer_backups_without_touching_the_chats() {
        let dir = tempfile::tempdir().unwrap();
        let (db, conv) = db_with_chat(dir.path());
        let backup = create_backup(&db, "manual", "1.2.0").unwrap();
        {
            let c = Connection::open(&backup.path).unwrap();
            c.execute("INSERT INTO schema_migrations (version, applied_at) VALUES (99, 0)", []).unwrap();
        }
        assert!(stage_restore(&db, Path::new(&backup.path)).unwrap_err().contains("newer LANX"));
        // A damaged staged file is set aside at start-up and the chats stay.
        fs::write(dir.path().join(PENDING), b"not a database").unwrap();
        drop(db);
        assert!(apply_pending_restore(dir.path(), "1.2.0").is_err());
        assert!(dir.path().join("restore-failed.db").exists());
        let db = Database::open(dir.path()).unwrap();
        assert_eq!(db.get_messages(&conv).unwrap().len(), 2);
        assert!(backup_path(&db, "..\\lanx.db").is_err());
        assert!(backup_path(&db, &backup.file_name).is_ok());
    }
}
