//! LANX 1.7.0 tools: muted chats, stickers, and shared folders that stay in
//! sync.
//!
//! Shared folders (one way): someone shares a folder in a chat; colleagues
//! who press "Get this folder" choose where it goes on their computer. Every
//! 30 seconds the sharing computer looks for new or changed files and sends
//! them (over the normal encrypted file transfer) straight into the same
//! sub-folder on each colleague's computer. Nothing is ever deleted on the
//! receiving side, and the receiving side only accepts files for a folder it
//! asked for, from the colleague who shares it, inside the folder it chose.

use super::protocol::*;
use super::{NetworkService, now_secs};
use crate::storage::models::*;
use crate::storage::tools::{SyncShare, SyncSubscription};
use serde_json::json;
use std::path::{Path, PathBuf};

/// How often shared folders are checked for new or changed files.
pub const SYNC_EVERY_SECS: u64 = 30;
/// A file must be untouched this long before it is sent (still being saved?).
const SYNC_SETTLE_SECS: i64 = 3;
const SYNC_MAX_FILES: usize = 5000;
const SYNC_MAX_DEPTH: usize = 12;
/// Files offered to one colleague per check (the rest follow next time).
const SYNC_BATCH: usize = 300;

/// Built-in stickers: id → (emoji, words).
pub const STICKERS: [(&str, &str, &str); 24] = [
    ("thanks", "🙏", "Thank you!"),
    ("ok", "👍", "OK!"),
    ("on-it", "🫡", "On it!"),
    ("done", "✅", "Done!"),
    ("great", "🌟", "Great job!"),
    ("lol", "😂", "LOL"),
    ("coffee", "☕", "Coffee?"),
    ("lunch", "🍱", "Lunch?"),
    ("wow", "🤩", "Wow!"),
    ("sorry", "🙇", "Sorry!"),
    ("wait", "⏳", "One minute"),
    ("call", "📞", "Call me"),
    ("meeting", "📅", "In a meeting"),
    ("hello", "👋", "Hello!"),
    ("night", "🌙", "Good night"),
    ("congrats", "🎉", "Congrats!"),
    ("birthday", "🎂", "Happy birthday!"),
    ("diwali", "🪔", "Happy Diwali!"),
    ("party", "🥳", "Party!"),
    ("love", "❤️", "Love it!"),
    ("fire", "🔥", "On fire!"),
    ("think", "🤔", "Hmm…"),
    ("tired", "😴", "So tired"),
    ("cat", "🐱", "Meow!"),
];

pub fn sticker(id: &str) -> Option<(&'static str, &'static str, &'static str)> {
    STICKERS.iter().copied().find(|(i, _, _)| *i == id)
}

/// Chat list line for a sticker.
pub fn sticker_preview(id: &str) -> String {
    match sticker(id) {
        Some((_, e, w)) => format!("{} Sticker: {}", e, w),
        None => "Sticker".to_string(),
    }
}

/// What colleagues on LANX older than 1.7.0 see instead.
pub fn sticker_fallback(id: &str) -> String {
    match sticker(id) {
        Some((_, e, w)) => format!("{} {}", e, w),
        None => "[Sticker]".to_string(),
    }
}

/// A shared folder's relative path ("Reports/2026/Q3.xlsx"), checked: no
/// "..", no drive letters, every part a plain file name.
pub fn clean_rel_path(rel: &str) -> Option<String> {
    let parts: Vec<&str> = rel.split(['/', '\\']).collect();
    if parts.is_empty() || parts.len() > SYNC_MAX_DEPTH + 1 {
        return None;
    }
    let mut out = Vec::new();
    for p in parts {
        if p.is_empty() || p == "." || p == ".." || p.contains(':') || p.len() > 200 {
            return None;
        }
        let clean = super::transfer::sanitize_file_name(p);
        if clean != p {
            return None;
        }
        out.push(clean);
    }
    Some(out.join("/"))
}

/// Files LANX never syncs: Office lock files, temporary files, half-finished
/// downloads, Windows' own helper files and hidden ones.
fn skip_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    name.starts_with('.')
        || name.starts_with("~$")
        || lower.ends_with(".tmp")
        || lower.ends_with(".part")
        || lower.ends_with(".lanxpart")
        || lower.ends_with(".crdownload")
        || lower == "thumbs.db"
        || lower == "desktop.ini"
}

/// (relative path, full path, size, modified time) of the files in a folder.
pub fn scan_folder(root: &Path) -> Vec<(String, PathBuf, i64, i64)> {
    let mut out = Vec::new();
    let mut stack = vec![(root.to_path_buf(), String::new(), 0usize)];
    while let Some((dir, prefix, depth)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if skip_name(&name) {
                continue;
            }
            let Ok(meta) = e.metadata() else { continue };
            let rel = if prefix.is_empty() { name.clone() } else { format!("{}/{}", prefix, name) };
            if meta.is_dir() {
                if depth < SYNC_MAX_DEPTH {
                    stack.push((e.path(), rel, depth + 1));
                }
            } else if meta.is_file() {
                let mtime = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or(0);
                if clean_rel_path(&rel).is_some() {
                    out.push((rel, e.path(), meta.len() as i64, mtime));
                }
                if out.len() >= SYNC_MAX_FILES {
                    return out;
                }
            }
        }
    }
    out
}

impl NetworkService {
    // ------------------------------------------------------------- muted chats

    /// Notifications for this chat are off (muted).
    pub(crate) fn chat_muted(&self, conversation_id: &str) -> bool {
        self.db
            .get_conversation(conversation_id)
            .ok()
            .flatten()
            .is_some_and(|c| c.is_muted(now_secs()))
    }

    // ---------------------------------------------------------------- stickers

    pub async fn send_sticker(&self, conversation_id: &str, id: &str) -> Result<Message, String> {
        if sticker(id).is_none() {
            return Err("Unknown sticker".to_string());
        }
        self.send_typed(conversation_id, id, "sticker", None, Vec::new()).await
    }

    // ---------------------------------------------------------- shared folders

    /// Shares a folder in a chat; colleagues there can get a copy that stays up to date.
    pub async fn share_folder(&self, conversation_id: &str, path: &str) -> Result<Message, String> {
        let root = PathBuf::from(path.trim());
        if !root.is_dir() {
            return Err("That folder doesn't exist.".to_string());
        }
        let name: String = root
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "Shared folder".to_string())
            .chars()
            .take(100)
            .collect();
        let files = scan_folder(&root);
        let share = SyncShare {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.clone(),
            path: root.to_string_lossy().to_string(),
            conversation_id: conversation_id.to_string(),
            created_at: now_secs(),
            active: true,
            subscribers: Vec::new(),
        };
        self.db.insert_sync_share(&share).map_err(|e| e.to_string())?;
        let total: i64 = files.iter().map(|f| f.2).sum();
        let card = json!({ "kind": "sync", "name": name, "share_id": share.id, "files": files.len(), "bytes": total });
        let m = self.send_card(conversation_id, &card).await;
        if m.is_err() {
            let _ = self.db.set_sync_share_active(&share.id, false);
        }
        self.emit_sync_changed();
        m
    }

    fn emit_sync_changed(&self) {
        self.events.emit_json("lanx://sync-changed", json!({}));
    }

    async fn send_sync(&self, peer: &Peer, p: SyncPayload) -> Result<(), String> {
        let mut chan = self.connect_peer(peer).await.map_err(|_| format!("Could not reach {}.", peer.display_name))?;
        if !version_at_least(&chan.remote.app_version, FEATURES_TOOLS) {
            chan.close().await;
            return Err(format!("{} needs LANX {} or newer for shared folders.", peer.display_name, FEATURES_TOOLS));
        }
        let reply = NetworkService::send_acked(&mut chan, PacketPayload::Sync(p)).await;
        chan.close().await;
        match reply {
            Ok(a) if a.ok => Ok(()),
            Ok(a) => Err(a.reason.unwrap_or_else(|| "Refused".to_string())),
            Err(()) => Err(format!("Could not reach {}.", peer.display_name)),
        }
    }

    /// "Get this folder": copies of the shared folder go into `dest`.
    pub async fn subscribe_folder(&self, message_id: &str, dest: &str) -> Result<SyncSubscription, String> {
        let m = self
            .db
            .get_message_by_id(message_id)
            .map_err(|e| e.to_string())?
            .filter(|m| m.message_type == "card" && !m.is_outgoing)
            .ok_or("Shared folder not found")?;
        let card = super::org::parse_card(&m.content).filter(|c| c["kind"] == "sync").ok_or("Shared folder not found")?;
        let share_id = card["share_id"].as_str().unwrap_or("").to_string();
        let name = card["name"].as_str().unwrap_or("Shared folder").to_string();
        let dest = PathBuf::from(dest.trim());
        if !dest.is_absolute() {
            return Err("Choose a folder on this computer.".to_string());
        }
        std::fs::create_dir_all(&dest).map_err(|e| format!("Could not use that folder: {}", e))?;
        let owner = self.db.get_peer(&m.sender_id).map_err(|e| e.to_string())?.ok_or("Unknown colleague")?;
        let sub = SyncSubscription {
            share_id: share_id.clone(),
            owner_id: owner.id.clone(),
            owner_name: owner.display_name.clone(),
            name,
            dest_path: dest.to_string_lossy().to_string(),
            conversation_id: m.conversation_id.clone(),
            since: now_secs(),
            files: 0,
            bytes: 0,
            last_at: 0,
            status: "active".to_string(),
        };
        self.db.upsert_sync_subscription(&sub).map_err(|e| e.to_string())?;
        let p = SyncPayload { action: "subscribe".to_string(), share_id: share_id.clone() };
        if let Err(e) = self.send_sync(&owner, p).await {
            let _ = self.db.delete_sync_subscription(&share_id);
            return Err(format!("{} Try again when they're online.", e));
        }
        self.emit_sync_changed();
        self.db.sync_subscription(&share_id).map_err(|e| e.to_string())?.ok_or_else(|| "Shared folder not found".to_string())
    }

    /// Stops receiving a colleague's folder (the files already here stay).
    pub async fn unsubscribe_folder(&self, share_id: &str) -> Result<(), String> {
        let Some(sub) = self.db.sync_subscription(share_id).map_err(|e| e.to_string())? else { return Ok(()) };
        let _ = self.db.delete_sync_subscription(share_id);
        if let Ok(Some(owner)) = self.db.get_peer(&sub.owner_id) {
            let _ = self.send_sync(&owner, SyncPayload { action: "unsubscribe".to_string(), share_id: share_id.to_string() }).await;
        }
        self.emit_sync_changed();
        Ok(())
    }

    /// Stops sharing a folder (colleagues keep what they have).
    pub async fn stop_sharing_folder(&self, share_id: &str) -> Result<(), String> {
        self.db.set_sync_share_active(share_id, false).map_err(|e| e.to_string())?;
        for peer_id in self.db.sync_subscriber_ids(share_id).unwrap_or_default() {
            if let Ok(Some(peer)) = self.db.get_peer(&peer_id) {
                let _ = self.send_sync(&peer, SyncPayload { action: "stopped".to_string(), share_id: share_id.to_string() }).await;
            }
        }
        self.emit_sync_changed();
        Ok(())
    }

    /// Sends everything again (e.g. after a colleague lost their copy).
    pub fn resync_folder(&self, share_id: &str) -> Result<(), String> {
        self.db.reset_sync_sent(share_id).map_err(|e| e.to_string())?;
        let this = self.clone();
        let id = share_id.to_string();
        tauri::async_runtime::spawn(async move { this.sync_share_now(&id).await });
        Ok(())
    }

    pub(super) fn handle_sync(&self, peer: &Peer, p: SyncPayload) -> AckPayload {
        let ok = AckPayload { ok: true, reason: None };
        let no = |r: &str| AckPayload { ok: false, reason: Some(r.to_string()) };
        if peer.trust_state == "blocked" {
            return no("Not available");
        }
        match p.action.as_str() {
            "subscribe" => {
                let Some(share) = self.db.sync_share(&p.share_id).ok().flatten().filter(|s| s.active) else {
                    return no("This folder isn't shared any more.");
                };
                // Only colleagues in the chat where it was shared.
                let allowed = match self.db.get_conversation(&share.conversation_id).ok().flatten() {
                    Some(c) if c.kind == "group" => self.get_group(&c.id).is_some_and(|g| g.members.iter().any(|m| m.device_id == peer.id)),
                    Some(c) => c.peer_id == peer.id,
                    None => false,
                };
                if !allowed {
                    return no("This folder was shared in a chat you're not in.");
                }
                let _ = self.db.add_sync_subscriber(&share.id, &peer.id, now_secs());
                let this = self.clone();
                let id = share.id.clone();
                tauri::async_runtime::spawn(async move { this.sync_share_now(&id).await });
                self.emit_sync_changed();
                ok
            }
            "unsubscribe" => {
                let _ = self.db.remove_sync_subscriber(&p.share_id, &peer.id);
                self.emit_sync_changed();
                ok
            }
            "stopped" => {
                if self.db.sync_subscription(&p.share_id).ok().flatten().is_some_and(|s| s.owner_id == peer.id) {
                    let _ = self.db.set_sync_subscription_status(&p.share_id, "stopped");
                    self.emit_sync_changed();
                }
                ok
            }
            _ => no("Unknown request"),
        }
    }

    /// Looks for new or changed files in every shared folder.
    pub async fn run_sync_round(&self) {
        let _ = self.db.prune_sync_transfers(now_secs() - 3600);
        for share in self.db.sync_shares().unwrap_or_default().into_iter().filter(|s| s.active) {
            self.sync_share_now(&share.id).await;
        }
    }

    pub(crate) async fn sync_share_now(&self, share_id: &str) {
        let Some(share) = self.db.sync_share(share_id).ok().flatten().filter(|s| s.active) else { return };
        let subscribers = self.db.sync_subscriber_ids(share_id).unwrap_or_default();
        if subscribers.is_empty() {
            return;
        }
        let _ = self.db.sync_retry_failed(share_id);
        let root = PathBuf::from(&share.path);
        let files = tokio::task::spawn_blocking(move || scan_folder(&root)).await.unwrap_or_default();
        let now = now_secs();
        for peer_id in subscribers {
            let Ok(Some(peer)) = self.db.get_peer(&peer_id) else { continue };
            if peer.trust_state == "blocked" {
                continue;
            }
            let sent = self.db.sync_sent_map(share_id, &peer_id).unwrap_or_default();
            let mut queued = 0;
            for (rel, abs, size, mtime) in &files {
                if *mtime > now - SYNC_SETTLE_SECS {
                    continue;
                }
                if sent.get(rel).is_some_and(|(s, m)| s == size && m == mtime) {
                    continue;
                }
                if self.queue_sync_file(&peer, &share, abs, rel, *size).is_ok() {
                    let _ = self.db.mark_sync_sent(share_id, &peer_id, rel, *size, *mtime);
                    queued += 1;
                }
                if queued >= SYNC_BATCH {
                    break;
                }
            }
            if queued > 0 {
                self.kick_outbox(&peer_id, true);
            }
        }
    }

    fn queue_sync_file(&self, peer: &Peer, share: &SyncShare, abs: &Path, rel: &str, size: i64) -> Result<(), String> {
        let name = abs.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let t = TransferRecord {
            id: uuid::Uuid::new_v4().to_string(),
            peer_id: peer.id.clone(),
            peer_name: Some(peer.display_name.clone()),
            conversation_id: Some(share.conversation_id.clone()),
            file_name: name,
            file_size: size,
            file_hash: String::new(),
            direction: "outgoing".to_string(),
            status: "queued".to_string(),
            transferred_bytes: 0,
            local_path: Some(abs.to_string_lossy().to_string()),
            error_reason: None,
            created_at: now_secs(),
            completed_at: None,
            duration_ms: None,
            started_bytes: None,
            parent_id: None,
            temp_path: None,
            kind: "sync".to_string(),
        };
        self.db.insert_transfer(&t).map_err(|e| e.to_string())?;
        self.db.insert_sync_transfer(&t.id, &share.id, rel).map_err(|e| e.to_string())
    }

    /// Where a sync file goes on this computer: the chosen folder + its
    /// sub-folder (checked again, never outside the chosen folder).
    pub(super) fn sync_target_dir(&self, t: &TransferRecord) -> Result<PathBuf, String> {
        let (share_id, rel) = self.db.sync_transfer(&t.id).map_err(|e| e.to_string())?.ok_or("Not a shared-folder file")?;
        let sub = self
            .db
            .sync_subscription(&share_id)
            .map_err(|e| e.to_string())?
            .filter(|s| s.status == "active")
            .ok_or("You no longer get this folder.")?;
        let rel = clean_rel_path(&rel).ok_or("Bad path")?;
        let mut dir = PathBuf::from(&sub.dest_path);
        let parts: Vec<&str> = rel.split('/').collect();
        for p in &parts[..parts.len().saturating_sub(1)] {
            dir.push(p);
        }
        std::fs::create_dir_all(&dir).map_err(|e| super::transfer::friendly_io_error(&e))?;
        Ok(dir)
    }

    /// A shared-folder file arrived.
    pub(super) fn sync_file_arrived(&self, t: &TransferRecord) {
        if let Ok(Some((share_id, _))) = self.db.sync_transfer(&t.id) {
            let _ = self.db.count_sync_file(&share_id, t.file_size, now_secs());
            self.emit_sync_changed();
        }
    }

    /// Checks an offered shared-folder file: it must be for a folder this
    /// computer asked for, from the colleague who shares it.
    pub(super) fn accept_sync_offer(&self, peer: &Peer, share_id: &str, rel: &str) -> Result<String, String> {
        let sub = self
            .db
            .sync_subscription(share_id)
            .map_err(|e| e.to_string())?
            .filter(|s| s.status == "active" && s.owner_id == peer.id)
            .ok_or("Not getting this folder")?;
        clean_rel_path(rel).ok_or("Bad path")?;
        Ok(sub.conversation_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_folder_paths_stay_inside() {
        assert_eq!(clean_rel_path("Reports/2026/Q3.xlsx").as_deref(), Some("Reports/2026/Q3.xlsx"));
        assert_eq!(clean_rel_path("Reports\\Q3.xlsx").as_deref(), Some("Reports/Q3.xlsx"));
        for bad in ["../evil.exe", "a/../../b", "C:/Windows/x", "/abs", "a//b", "a/./b", "con?.txt", ""] {
            assert!(clean_rel_path(bad).is_none(), "{}", bad);
        }
    }

    #[test]
    fn junk_files_are_skipped() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("Sub/Deeper")).unwrap();
        for f in ["a.txt", "~$lock.docx", "b.tmp", ".hidden", "Thumbs.db", "Sub/c.pdf", "Sub/Deeper/d.xlsx"] {
            std::fs::write(dir.path().join(f), b"x").unwrap();
        }
        let mut rels: Vec<String> = scan_folder(dir.path()).into_iter().map(|f| f.0).collect();
        rels.sort();
        assert_eq!(rels, vec!["Sub/Deeper/d.xlsx", "Sub/c.pdf", "a.txt"]);
    }

    #[test]
    fn quiet_hours_cover_overnight() {
        let q = QuietHours { enabled: true, start: 19 * 60, end: 9 * 60, days: vec![1, 2, 3, 4, 5] };
        assert!(q.covers(1, 20 * 60), "Monday evening");
        assert!(q.covers(2, 8 * 60), "Tuesday early (started Monday)");
        assert!(!q.covers(2, 10 * 60), "Tuesday daytime");
        assert!(q.covers(6, 8 * 60), "Saturday early (started Friday)");
        assert!(!q.covers(6, 20 * 60), "Saturday evening isn't chosen");
        assert!(!q.covers(1, 8 * 60), "Monday early (Sunday not chosen)");
        let day = QuietHours { enabled: true, start: 13 * 60, end: 14 * 60, days: vec![0, 1, 2, 3, 4, 5, 6] };
        assert!(day.covers(3, 13 * 60 + 30) && !day.covers(3, 14 * 60));
        assert!(!QuietHours { enabled: false, ..q }.covers(1, 20 * 60));
    }

    #[test]
    fn stickers_have_fallbacks() {
        assert_eq!(sticker_fallback("thanks"), "🙏 Thank you!");
        assert_eq!(sticker_preview("coffee"), "☕ Sticker: Coffee?");
        assert!(sticker("rocket-launch").is_none());
    }
}
