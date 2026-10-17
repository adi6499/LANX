//! File transfers of any size.
//!
//! Sender offers (`FileOffer`) -> recipient accepts -> recipient connects and
//! pulls the file (`FileRequest { offset }`), so an interrupted transfer
//! resumes from the bytes already on disk. Data travels in encrypted 256 KB
//! chunks; the sender signs the SHA-256 of the whole file at the end and the
//! recipient only keeps the file if its own hash matches.

use super::protocol::*;
use super::session::{Frame, SecureChannel};
use super::{ACK_TIMEOUT, NetworkService, now_secs};
use crate::storage::models::{Message, Peer, TransferRecord};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

const STALL_TIMEOUT: Duration = Duration::from_secs(30);
const RESULT_TIMEOUT: Duration = Duration::from_secs(120);
const PROGRESS_EVERY: Duration = Duration::from_millis(250);
const DB_PROGRESS_EVERY: Duration = Duration::from_secs(2);

#[derive(Serialize, Clone, Debug)]
pub struct SentFile {
    /// One per recipient (several in a group chat).
    pub transfers: Vec<TransferRecord>,
    pub message: Message,
}

pub fn is_image_name(name: &str) -> bool {
    let ext = Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp")
}

/// Images up to this size download without asking (setting "auto_download_images").
pub const AUTO_IMAGE_MAX_BYTES: u64 = 10 * 1024 * 1024;

pub(super) enum Outcome {
    Cancelled { notify_peer: bool, reason: String },
    Failed(String),
}

pub(super) struct Progress {
    last_emit: Instant,
    last_db: Instant,
    last_bytes: u64,
    speed: f64,
}

impl Progress {
    pub(super) fn new(start: u64) -> Self {
        let now = Instant::now();
        Self {
            last_emit: now,
            last_db: now,
            last_bytes: start,
            speed: 0.0,
        }
    }

    pub(super) fn tick(&mut self, svc: &NetworkService, id: &str, done: u64, total: u64, force: bool) {
        let elapsed = self.last_emit.elapsed();
        if !force && elapsed < PROGRESS_EVERY {
            return;
        }
        let secs = elapsed.as_secs_f64().max(0.001);
        let instant = (done.saturating_sub(self.last_bytes)) as f64 / secs;
        self.speed = if self.speed == 0.0 {
            instant
        } else {
            self.speed * 0.6 + instant * 0.4
        };
        self.last_emit = Instant::now();
        self.last_bytes = done;
        svc.events
            .transfer_progress(id, done, total, self.speed as u64);
        if force || self.last_db.elapsed() >= DB_PROGRESS_EVERY {
            self.last_db = Instant::now();
            let _ = svc.db.update_transfer_progress(id, done as i64);
        }
    }
}

pub fn format_size(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut v = bytes as f64;
    let mut i = 0;
    while v >= 1024.0 && i < UNITS.len() - 1 {
        v /= 1024.0;
        i += 1;
    }
    if i == 0 {
        format!("{} B", bytes)
    } else {
        format!("{:.1} {}", v, UNITS[i])
    }
}

/// Chat line for a file ("📎 report.pdf") or a folder ("📁 Q3 Accounts").
fn file_label(file_name: &str, folder: bool) -> String {
    if folder {
        format!("📁 {}", file_name.strip_suffix(".zip").unwrap_or(file_name))
    } else {
        format!("📎 {}", file_name)
    }
}

/// Makes a file name from another computer safe to create on Windows.
pub fn sanitize_file_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = base
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let mut s = cleaned.trim().trim_end_matches(['.', ' ']).to_string();
    if s.is_empty() || s.chars().all(|c| c == '.') {
        s = "file".to_string();
    }
    let stem = s.split('.').next().unwrap_or("").to_ascii_uppercase();
    const RESERVED: [&str; 22] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
        "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if RESERVED.contains(&stem.as_str()) {
        s = format!("_{}", s);
    }
    if s.chars().count() > 180 {
        let ext: String = Path::new(&s)
            .extension()
            .map(|e| e.to_string_lossy().chars().take(20).collect())
            .unwrap_or_default();
        let head: String = s.chars().take(180 - ext.len().min(20) - 1).collect();
        s = if ext.is_empty() {
            head
        } else {
            format!("{}.{}", head, ext)
        };
    }
    s
}

/// `name`, or `name (1).ext`, `name (2).ext`, ... if it already exists.
pub fn unique_destination(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let p = Path::new(name);
    let stem = p
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| name.to_string());
    let ext = p.extension().map(|e| e.to_string_lossy().to_string());
    for n in 1..10000 {
        let candidate = match &ext {
            Some(e) => format!("{} ({}).{}", stem, n, e),
            None => format!("{} ({})", stem, n),
        };
        let path = dir.join(candidate);
        if !path.exists() {
            return path;
        }
    }
    dir.join(format!("{}-{}", uuid::Uuid::new_v4(), name))
}

pub(super) fn friendly_io_error(e: &std::io::Error) -> String {
    match e.raw_os_error() {
        Some(112) | Some(39) => "Not enough disk space to save the file.".to_string(),
        Some(5) => "Windows denied access to the download folder.".to_string(),
        _ => format!("Could not write the file ({})", e),
    }
}

impl NetworkService {
    fn download_dir(&self) -> PathBuf {
        let configured = self
            .db
            .get_settings()
            .map(|s| s.default_download_dir)
            .unwrap_or_default();
        if !configured.trim().is_empty() {
            let p = PathBuf::from(configured.trim());
            if p.is_dir() || std::fs::create_dir_all(&p).is_ok() {
                return p;
            }
        }
        dirs::download_dir().unwrap_or_else(|| crate::storage::data_dir(None).join("Downloads"))
    }

    /// Saves a transfer and tells the UI (update installers are not chat
    /// files: the UI hears about them as an update change).
    pub(crate) fn save_and_emit(&self, t: &TransferRecord) {
        let _ = self.db.save_transfer(t);
        // Re-read: the database adds the timing (start, how long it took) as
        // the status changes, and the screen should show it right away.
        let fresh = self.db.get_transfer(&t.id).ok().flatten();
        let t = fresh.as_ref().unwrap_or(t);
        if t.kind == "update" {
            self.events.update_changed();
        } else {
            self.events.transfer_updated(t);
        }
    }

    fn update_file_message(&self, transfer_id: &str, status: &str, reason: Option<String>) {
        if let Ok(Some(mut m)) = self.db.get_message_by_transfer(transfer_id) {
            if m.is_outgoing {
                self.set_message_status(&mut m, status, reason);
            }
        }
    }

    // ------------------------------------------------------------- sending

    pub async fn send_files(
        &self,
        conversation_id: &str,
        paths: Vec<String>,
    ) -> Result<Vec<SentFile>, String> {
        let conv = self
            .db
            .get_conversation(conversation_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Conversation not found".to_string())?;

        // Who receives a copy: the contact, or every other group member.
        let recipients: Vec<Peer> = if conv.kind == "group" {
            let g = self.get_group(&conv.id).ok_or("Group not found")?;
            if g.membership != "member" {
                return Err("You are no longer in this group.".to_string());
            }
            g.members
                .iter()
                .filter(|m| !m.is_me)
                .filter_map(|m| self.db.get_peer(&m.device_id).ok().flatten())
                .collect()
        } else {
            let peer = self
                .db
                .get_peer(&conv.peer_id)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "Peer not found".to_string())?;
            if peer.trust_state == "blocked" {
                return Err("You blocked this contact. Unblock them in People to send files.".to_string());
            }
            vec![peer]
        };
        if recipients.is_empty() {
            return Err("Nobody else is in this group.".to_string());
        }
        let is_group = conv.kind == "group";

        let mut sent = Vec::new();
        let mut problems = Vec::new();
        for path in paths {
            let p = PathBuf::from(&path);
            let meta = match std::fs::metadata(&p) {
                Ok(m) => m,
                Err(_) => {
                    problems.push(format!("Cannot read {}", path));
                    continue;
                }
            };
            // LANX 1.2.3: a folder is packed into one zip and sent as one file.
            let (p, meta, kind) = if meta.is_dir() {
                let outbox = super::folders::outbox_dir(self.db.get_path().parent().unwrap_or(Path::new(".")));
                let src = p.clone();
                match tokio::task::spawn_blocking(move || super::folders::pack_folder(&src, &outbox)).await {
                    Ok(Ok(packed)) => match std::fs::metadata(&packed.zip) {
                        Ok(m) => (packed.zip, m, "folder"),
                        Err(e) => {
                            problems.push(e.to_string());
                            continue;
                        }
                    },
                    Ok(Err(e)) => {
                        problems.push(e);
                        continue;
                    }
                    Err(e) => {
                        problems.push(e.to_string());
                        continue;
                    }
                }
            } else {
                (p, meta, "file")
            };
            let file_name = p
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "file".to_string());
            let now = now_secs();
            // In a group every member gets their own transfer; the chat
            // message points at their shared parent id.
            let parent = if is_group { Some(uuid::Uuid::new_v4().to_string()) } else { None };
            let mut transfers = Vec::new();
            for peer in &recipients {
                let transfer = TransferRecord {
                    id: uuid::Uuid::new_v4().to_string(),
                    peer_id: peer.id.clone(),
                    peer_name: Some(peer.display_name.clone()),
                    conversation_id: Some(conv.id.clone()),
                    file_name: file_name.clone(),
                    file_size: meta.len() as i64,
                    file_hash: String::new(),
                    direction: "outgoing".to_string(),
                    status: "queued".to_string(),
                    transferred_bytes: 0,
                    local_path: Some(p.to_string_lossy().to_string()),
                    error_reason: None,
                    created_at: now,
                    completed_at: None,
                    duration_ms: None,
                    started_bytes: None,
                    parent_id: parent.clone(),
                    temp_path: None,
                    kind: kind.to_string(),
                };
                self.db.insert_transfer(&transfer).map_err(|e| e.to_string())?;
                transfers.push(transfer);
            }
            let message = Message {
                id: uuid::Uuid::new_v4().to_string(),
                conversation_id: conv.id.clone(),
                sender_id: self.identity.device_id.clone(),
                receiver_id: if is_group { conv.id.clone() } else { recipients[0].id.clone() },
                content: file_label(&file_name, kind == "folder"),
                message_type: "file".to_string(),
                timestamp: now,
                status: "sending".to_string(),
                error_reason: None,
                is_outgoing: true,
                transfer_id: Some(parent.clone().unwrap_or_else(|| transfers[0].id.clone())),
                ttl_secs: None,
                expire_at: None,
                deliveries: None,
            };
            self.db.insert_message(&message).map_err(|e| e.to_string())?;
            sent.push(SentFile { transfers, message });
        }

        if !sent.is_empty() {
            for peer in &recipients {
                self.kick_outbox(&peer.id, true);
            }
        }
        if sent.is_empty() && !problems.is_empty() {
            return Err(problems.join("\n"));
        }
        Ok(sent)
    }

    /// Sends one queued offer on an open session. Returns false if the
    /// connection broke (the offer stays queued).
    pub(super) async fn deliver_offer(
        &self,
        chan: &mut SecureChannel,
        mut t: TransferRecord,
        modern: bool,
    ) -> bool {
        if t.kind == "update" {
            return self.deliver_update_offer(chan, t).await;
        }
        let group_id = t.parent_id.as_ref().and(t.conversation_id.clone());
        if group_id.is_some() && !modern {
            let reason = format!(
                "Waiting for {} to update to LANX 1.1",
                t.peer_name.clone().unwrap_or_else(|| "them".to_string())
            );
            if t.error_reason.as_deref() != Some(reason.as_str()) {
                t.error_reason = Some(reason);
                self.save_and_emit(&t);
            }
            return true;
        }
        let folder = (t.kind == "folder" && version_at_least(&chan.remote.app_version, FEATURES_FAST)).then_some(true);
        let offer = PacketPayload::FileOffer(FileOfferPayload {
            transfer_id: t.id.clone(),
            file_name: t.file_name.clone(),
            file_size: t.file_size.max(0) as u64,
            group_id,
            folder,
        });
        let sent = match chan.send(offer, None).await {
            Ok(p) => p,
            Err(_) => return false,
        };
        let reply = match chan.recv_packet_timeout(ACK_TIMEOUT).await {
            Ok(r) if r.correlation_id.as_deref() == Some(sent.packet_id.as_str()) => r,
            _ => return false,
        };
        // The recipient may have acted already (e.g. auto-accept started).
        if let Ok(Some(current)) = self.db.get_transfer(&t.id) {
            if current.status != "queued" {
                return true;
            }
        }
        match reply.payload {
            PacketPayload::FileOfferAck(a) if a.accepted => {
                t.status = "pending".to_string();
                t.error_reason = None;
                self.save_and_emit(&t);
                self.update_file_message(&t.id, "delivered", None);
            }
            PacketPayload::FileOfferAck(a) => {
                let reason = a.reason.unwrap_or_else(|| "Recipient refused the file".to_string());
                t.status = "failed".to_string();
                t.error_reason = Some(reason.clone());
                self.save_and_emit(&t);
                self.update_file_message(&t.id, "failed", Some(reason));
            }
            PacketPayload::Error(e) => {
                t.status = "failed".to_string();
                t.error_reason = Some(e.message.clone());
                self.save_and_emit(&t);
                self.update_file_message(&t.id, "failed", Some(e.message));
            }
            _ => return false,
        }
        true
    }

    /// Sender side: stream the file to a recipient that asked for it.
    pub(super) async fn serve_file(
        &self,
        mut chan: SecureChannel,
        peer: &Peer,
        req: FileRequestPayload,
        correlation: String,
    ) {
        let corr = Some(correlation);
        let refuse = |code: &str, msg: &str| {
            PacketPayload::Error(ErrorPayload {
                code: code.to_string(),
                message: msg.to_string(),
            })
        };

        let mut t = match self.db.get_transfer(&req.transfer_id) {
            Ok(Some(t)) if t.direction == "outgoing" && t.peer_id == peer.id => t,
            _ => {
                let _ = chan
                    .send(refuse("NOT_FOUND", "This file is no longer offered."), corr)
                    .await;
                return;
            }
        };
        if matches!(t.status.as_str(), "cancelled" | "declined") {
            let _ = chan
                .send(
                    PacketPayload::FileCancel(FileCancelPayload {
                        transfer_id: t.id.clone(),
                        reason: Some("The sender cancelled this file.".to_string()),
                    }),
                    corr,
                )
                .await;
            return;
        }
        if self.active_transfers.lock().contains_key(&t.id) {
            let _ = chan
                .send(refuse("BUSY", "This file is already being transferred."), corr)
                .await;
            return;
        }

        let path = PathBuf::from(t.local_path.clone().unwrap_or_default());
        let mut file = match tokio::fs::File::open(&path).await {
            Ok(f) => f,
            Err(_) => {
                let reason = "The file was moved or deleted on the sender's computer.";
                let _ = chan.send(refuse("FILE_MISSING", reason), corr).await;
                t.status = "failed".to_string();
                t.error_reason = Some(reason.to_string());
                self.save_and_emit(&t);
                return;
            }
        };
        let size = file.metadata().await.map(|m| m.len()).unwrap_or(0);
        if size != t.file_size.max(0) as u64 {
            let reason = "The file changed after it was offered. Send it again.";
            let _ = chan.send(refuse("FILE_CHANGED", reason), corr).await;
            t.status = "failed".to_string();
            t.error_reason = Some(reason.to_string());
            self.save_and_emit(&t);
            return;
        }
        let offset = req.offset.min(size);
        if chan
            .send(
                PacketPayload::FileStreamStart(FileStreamStartPayload {
                    transfer_id: t.id.clone(),
                    offset,
                    file_size: size,
                }),
                corr,
            )
            .await
            .is_err()
        {
            return;
        }

        let token = CancellationToken::new();
        self.active_transfers.lock().insert(t.id.clone(), token.clone());
        t.status = "transferring".to_string();
        t.error_reason = None;
        t.transferred_bytes = offset as i64;
        self.save_and_emit(&t);

        let result: Result<String, Outcome> = async {
            let mut hasher = Sha256::new();
            let mut buf = vec![0u8; FILE_CHUNK_SIZE];
            // Hash the part the recipient already has.
            let mut hashed = 0u64;
            while hashed < offset {
                let want = ((offset - hashed) as usize).min(buf.len());
                let n = file
                    .read(&mut buf[..want])
                    .await
                    .map_err(|e| Outcome::Failed(format!("Read error: {}", e)))?;
                if n == 0 {
                    return Err(Outcome::Failed("File shrank while reading".to_string()));
                }
                hasher.update(&buf[..n]);
                hashed += n as u64;
            }
            file.seek(std::io::SeekFrom::Start(offset))
                .await
                .map_err(|e| Outcome::Failed(format!("Read error: {}", e)))?;

            let mut sent = offset;
            let mut progress = Progress::new(offset);
            let mut comp = super::lanes::ChunkCompressor::new(req.compress == Some(true), &t.file_name);
            loop {
                if token.is_cancelled() {
                    let reason = self
                        .remote_cancels
                        .lock()
                        .remove(&t.id);
                    return Err(match reason {
                        Some(r) => Outcome::Cancelled { notify_peer: false, reason: r },
                        None => Outcome::Cancelled {
                            notify_peer: true,
                            reason: "You cancelled this transfer.".to_string(),
                        },
                    });
                }
                let n = file
                    .read(&mut buf)
                    .await
                    .map_err(|e| Outcome::Failed(format!("Read error: {}", e)))?;
                if n == 0 {
                    break;
                }
                hasher.update(&buf[..n]);
                let saved = chan.send_file_chunk(&buf[..n], &mut comp).await.map_err(|_| {
                    Outcome::Failed("Connection lost. The recipient can resume.".to_string())
                })?;
                self.bytes_saved.fetch_add(saved, std::sync::atomic::Ordering::Relaxed);
                sent += n as u64;
                progress.tick(self, &t.id, sent, size, false);
            }
            if sent != size {
                return Err(Outcome::Failed("File changed while sending".to_string()));
            }
            progress.tick(self, &t.id, sent, size, true);

            let digest = hex::encode(hasher.finalize());
            chan.send(
                PacketPayload::FileStreamEnd(FileStreamEndPayload {
                    transfer_id: t.id.clone(),
                    sha256: digest.clone(),
                }),
                None,
            )
            .await
            .map_err(|_| Outcome::Failed("Connection lost at the end of the transfer.".to_string()))?;
            chan.flush().await.ok();

            match chan.recv_packet_timeout(RESULT_TIMEOUT).await {
                Ok(p) => match p.payload {
                    PacketPayload::FileResult(r) if r.ok => Ok(digest),
                    PacketPayload::FileResult(r) => Err(Outcome::Failed(
                        r.reason.unwrap_or_else(|| "Recipient could not save the file".to_string()),
                    )),
                    PacketPayload::FileCancel(c) => Err(Outcome::Cancelled {
                        notify_peer: false,
                        reason: c.reason.unwrap_or_else(|| "Cancelled by recipient".to_string()),
                    }),
                    _ => Err(Outcome::Failed("Unexpected reply from recipient".to_string())),
                },
                Err(e) => Err(Outcome::Failed(e)),
            }
        }
        .await;

        self.active_transfers.lock().remove(&t.id);
        match result {
            Ok(digest) => {
                t.status = "completed".to_string();
                t.file_hash = digest;
                t.transferred_bytes = size as i64;
                t.error_reason = None;
                t.completed_at = Some(now_secs());
                self.save_and_emit(&t);
                chan.close().await;
            }
            Err(Outcome::Cancelled { notify_peer, reason }) => {
                if notify_peer {
                    let _ = chan
                        .send(
                            PacketPayload::FileCancel(FileCancelPayload {
                                transfer_id: t.id.clone(),
                                reason: Some("The sender cancelled this file.".to_string()),
                            }),
                            None,
                        )
                        .await;
                }
                t.status = "cancelled".to_string();
                t.error_reason = Some(reason);
                t.completed_at = Some(now_secs());
                self.save_and_emit(&t);
            }
            Err(Outcome::Failed(reason)) => {
                // Don't overwrite a cancel that arrived on another connection.
                let current = self.db.get_transfer(&t.id).ok().flatten();
                if current.map(|c| c.status == "transferring").unwrap_or(true) {
                    t.status = "failed".to_string();
                    t.error_reason = Some(reason);
                    if let Ok(Some(c)) = self.db.get_transfer(&t.id) {
                        t.transferred_bytes = c.transferred_bytes;
                    }
                    self.save_and_emit(&t);
                }
            }
        }
    }

    // ----------------------------------------------------------- receiving

    pub(super) fn handle_file_offer(&self, peer: &Peer, o: FileOfferPayload) -> FileOfferAckPayload {
        let ack = |accepted: bool, reason: Option<&str>| FileOfferAckPayload {
            transfer_id: o.transfer_id.clone(),
            accepted,
            reason: reason.map(|r| r.to_string()),
        };
        if let Ok(Some(existing)) = self.db.get_transfer(&o.transfer_id) {
            if existing.peer_id != peer.id || existing.direction != "incoming" {
                return ack(false, Some("Duplicate transfer id"));
            }
            // Sender pressed Retry after a broken transfer: resume it.
            if existing.status == "failed" && existing.temp_path.is_some() {
                let this = self.clone();
                let id = existing.id.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = this.accept_transfer(&id).await;
                });
            }
            return ack(true, None);
        }
        if uuid::Uuid::parse_str(&o.transfer_id).is_err() {
            return ack(false, Some("Invalid transfer id"));
        }

        // Group file: only from a member of a group we are in.
        let conv = match &o.group_id {
            Some(gid) => {
                let Some(g) = self.get_group(gid) else {
                    return ack(false, Some("Not a member of this group"));
                };
                if g.membership != "member" || !g.members.iter().any(|m| m.device_id == peer.id) {
                    return ack(false, Some("Not a member of this group"));
                }
                match self.db.get_conversation(gid) {
                    Ok(Some(c)) => c,
                    _ => return ack(false, Some("Recipient database error")),
                }
            }
            None => match self.db.get_or_create_conversation(&peer.id) {
                Ok(c) => c,
                Err(_) => return ack(false, Some("Recipient database error")),
            },
        };
        let name = sanitize_file_name(&o.file_name);
        let now = now_secs();
        let t = TransferRecord {
            id: o.transfer_id.clone(),
            peer_id: peer.id.clone(),
            peer_name: Some(peer.display_name.clone()),
            conversation_id: Some(conv.id.clone()),
            file_name: name.clone(),
            file_size: o.file_size.min(i64::MAX as u64) as i64,
            file_hash: String::new(),
            direction: "incoming".to_string(),
            status: "pending".to_string(),
            transferred_bytes: 0,
            local_path: None,
            error_reason: None,
            created_at: now,
            completed_at: None,
            duration_ms: None,
            started_bytes: None,
            parent_id: None,
            temp_path: None,
            kind: if o.folder == Some(true) { "folder" } else { "file" }.to_string(),
        };
        if self.db.insert_transfer(&t).is_err() {
            return ack(false, Some("Recipient database error"));
        }
        let msg = Message {
            id: uuid::Uuid::new_v4().to_string(),
            conversation_id: conv.id.clone(),
            sender_id: peer.id.clone(),
            receiver_id: self.identity.device_id.clone(),
            content: file_label(&name, o.folder == Some(true)),
            message_type: "file".to_string(),
            timestamp: now,
            status: "delivered".to_string(),
            error_reason: None,
            is_outgoing: false,
            transfer_id: Some(t.id.clone()),
            ttl_secs: None,
            expire_at: None,
            deliveries: None,
        };
        let _ = self.db.insert_message(&msg);
        let _ = self.db.increment_unread(&conv.id);
        let conv = self.db.get_conversation(&conv.id).ok().flatten();
        self.events.transfer_updated(&t);
        self.events.message_received(&msg, conv.as_ref());
        self.events.update_tray(&self.db);

        let settings = self.db.get_settings().ok();
        let trusted_auto = settings.as_ref().is_some_and(|s| s.auto_download_transfers)
            && peer.trust_state == "trusted";
        let image_auto = settings.as_ref().is_some_and(|s| s.auto_download_images)
            && is_image_name(&name)
            && o.file_size <= AUTO_IMAGE_MAX_BYTES;
        let auto = trusted_auto || image_auto;
        if auto {
            let this = self.clone();
            let id = t.id.clone();
            tauri::async_runtime::spawn(async move {
                let _ = this.accept_transfer(&id).await;
            });
        }
        let hidden = conv.as_ref().is_some_and(|c| c.is_hidden);
        let where_from = match &o.group_id {
            Some(_) => format!("{} in {}", peer.display_name, conv.as_ref().map(|c| c.peer_name.as_str()).unwrap_or("a group")),
            None => peer.display_name.clone(),
        };
        let (title, body) = if hidden || self.privacy.is_locked() {
            ("LANX".to_string(), "You have a new file".to_string())
        } else if auto {
            (
                format!("Receiving a file from {}", where_from),
                format!("{} ({})", name, format_size(o.file_size)),
            )
        } else {
            (
                format!("{} wants to send you a file", where_from),
                format!("{} ({}) — open LANX to accept", name, format_size(o.file_size)),
            )
        };
        let private = hidden || self.privacy.is_locked();
        let alert = crate::events::IslandAlert {
            id: msg.transfer_id.clone().unwrap_or_else(|| msg.id.clone()),
            kind: "file".into(),
            title: if private { title.clone() } else { where_from.clone() },
            body: if private { body.clone() } else { name.clone() },
            conversation_id: (!private).then(|| msg.conversation_id.clone()),
            avatar_color: (!private).then(|| peer.avatar_color.clone()),
            transfer_id: (!private).then(|| msg.transfer_id.clone()).flatten(),
            file_name: (!private).then(|| name.clone()),
            file_size: Some(o.file_size as i64),
            needs_accept: !private && !auto,
            private,
            ..Default::default()
        };
        self.events.notify_island(&self.db, crate::events::AlertKind::File, &title, &body, alert);
        ack(true, None)
    }

    pub(super) fn handle_remote_cancel(&self, peer: &Peer, c: FileCancelPayload) {
        let Ok(Some(mut t)) = self.db.get_transfer(&c.transfer_id) else {
            return;
        };
        if t.peer_id != peer.id {
            return;
        }
        let reason = c.reason.unwrap_or_else(|| format!("Cancelled by {}", peer.display_name));
        if let Some(token) = self.active_transfers.lock().get(&t.id).cloned() {
            self.remote_cancels.lock().insert(t.id.clone(), reason.clone());
            token.cancel();
            if !self.end_idle_lane_session(&t.id) {
                return;
            }
            self.remote_cancels.lock().remove(&t.id);
        }
        if matches!(t.status.as_str(), "completed" | "cancelled" | "declined") {
            return;
        }
        t.status = if t.direction == "outgoing" && t.status == "pending" {
            "declined".to_string()
        } else {
            "cancelled".to_string()
        };
        t.error_reason = Some(reason);
        t.completed_at = Some(now_secs());
        if let Some(tmp) = t.temp_path.take() {
            super::lanes::remove_plan(Path::new(&tmp));
            let _ = std::fs::remove_file(tmp);
        }
        self.save_and_emit(&t);
    }

    /// Recipient accepts (or resumes) an incoming file. Outgoing transfers
    /// are re-offered instead.
    pub async fn accept_transfer(&self, transfer_id: &str) -> Result<TransferRecord, String> {
        let mut t = self
            .db
            .get_transfer(transfer_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Transfer not found".to_string())?;
        if t.direction != "incoming" {
            return Ok(self.requeue_offer(t));
        }
        if self.active_transfers.lock().contains_key(&t.id) {
            return Ok(t);
        }
        if !matches!(t.status.as_str(), "pending" | "failed") {
            return Err("This file can no longer be accepted.".to_string());
        }

        // LANX updates go to LANX's own folder, not Downloads.
        let dir = if t.kind == "update" { self.updates_dir() } else { self.download_dir() };
        std::fs::create_dir_all(&dir).map_err(|e| friendly_io_error(&e))?;
        if t.temp_path.is_none() {
            let short: String = t.id.chars().take(8).collect();
            t.temp_path = Some(
                dir.join(format!("{}.{}.lanxpart", t.file_name, short))
                    .to_string_lossy()
                    .to_string(),
            );
        }
        t.status = "transferring".to_string();
        t.error_reason = None;
        self.save_and_emit(&t);

        let token = CancellationToken::new();
        self.active_transfers.lock().insert(t.id.clone(), token.clone());
        let this = self.clone();
        let task_t = t.clone();
        tauri::async_runtime::spawn(async move { this.run_download(task_t, dir, token).await });
        Ok(t)
    }

    async fn run_download(self, mut t: TransferRecord, dir: PathBuf, token: CancellationToken) {
        let result = self.download_inner(&mut t, &dir, &token).await;
        self.active_transfers.lock().remove(&t.id);
        let peer_name = t.peer_name.clone().unwrap_or_else(|| "a colleague".to_string());
        match result {
            Ok(final_path) => {
                // A folder arrives as a zip: unpack it next to where it landed.
                let (final_path, note) = if t.kind == "folder" {
                    self.unpack_received_folder(final_path, &dir).await
                } else {
                    (final_path, None)
                };
                t.status = "completed".to_string();
                t.local_path = Some(final_path.to_string_lossy().to_string());
                t.transferred_bytes = t.file_size;
                t.error_reason = note;
                t.temp_path = None;
                t.completed_at = Some(now_secs());
                self.save_and_emit(&t);
                if t.kind == "update" {
                    self.update_downloaded(&t);
                    return;
                }
                let hidden = t
                    .conversation_id
                    .as_deref()
                    .is_some_and(|c| self.db.is_conversation_hidden(c));
                if hidden || self.privacy.is_locked() {
                    self.events.notify(&self.db, crate::events::AlertKind::File, "LANX", "A file finished downloading");
                } else {
                    self.events.notify(
                        &self.db,
                        crate::events::AlertKind::File,
                        &format!("File received from {}", peer_name),
                        &t.file_name,
                    );
                }
            }
            Err(Outcome::Cancelled { notify_peer, reason }) => {
                if let Some(tmp) = t.temp_path.take() {
                    super::lanes::remove_plan(Path::new(&tmp));
                    let _ = tokio::fs::remove_file(tmp).await;
                }
                t.status = "cancelled".to_string();
                t.error_reason = Some(reason);
                t.completed_at = Some(now_secs());
                self.save_and_emit(&t);
                if notify_peer {
                    self.send_cancel_to_peer(&t.peer_id, &t.id, "The recipient cancelled this file.");
                }
                if t.kind == "update" {
                    self.update_download_failed(&t);
                }
            }
            Err(Outcome::Failed(reason)) => {
                t.status = "failed".to_string();
                t.error_reason = Some(reason);
                if let Some(tmp) = &t.temp_path {
                    t.transferred_bytes = super::lanes::bytes_on_disk(Path::new(tmp), t.file_size.max(0) as u64) as i64;
                }
                self.save_and_emit(&t);
                if t.kind == "update" {
                    self.update_download_failed(&t);
                }
            }
        }
    }

    async fn download_inner(
        &self,
        t: &mut TransferRecord,
        dir: &Path,
        token: &CancellationToken,
    ) -> Result<PathBuf, Outcome> {
        let cancelled_locally = || Outcome::Cancelled {
            notify_peer: true,
            reason: "You cancelled this transfer.".to_string(),
        };
        let peer = self
            .db
            .get_peer(&t.peer_id)
            .ok()
            .flatten()
            .ok_or_else(|| Outcome::Failed("The sender is unknown.".to_string()))?;
        let temp = PathBuf::from(t.temp_path.clone().unwrap_or_default());
        let size = t.file_size.max(0) as u64;

        let mut chan = tokio::select! {
            _ = token.cancelled() => return Err(cancelled_locally()),
            c = self.connect_peer(&peer) => c.map_err(|e| Outcome::Failed(
                if e.contains("Security") || e.contains("version") { e }
                else { format!("{} is not reachable right now. Press Resume when they are online.", peer.display_name) }
            ))?,
        };

        // LANX 1.2.3: big files over several connections at once.
        let fast = version_at_least(&chan.remote.app_version, FEATURES_FAST);
        let has_plan = super::lanes::has_plan(&temp);
        if fast && t.kind != "update" && (has_plan || size >= super::lanes::LANES_FROM_BYTES) {
            return self.download_lanes(t, dir, token, &peer, chan).await;
        }
        if has_plan {
            // Started over several connections, but the sender went back to
            // an older LANX: the part file has gaps, so start again.
            super::lanes::remove_plan(&temp);
            let _ = std::fs::remove_file(&temp);
        }
        let mut offset = std::fs::metadata(&temp).map(|m| m.len()).unwrap_or(0);
        if offset > size {
            offset = 0;
        }
        let compress = version_at_least(&chan.remote.app_version, FEATURES_COMPRESS).then_some(true);
        let req = chan
            .send(
                PacketPayload::FileRequest(FileRequestPayload {
                    transfer_id: t.id.clone(),
                    offset,
                    compress,
                }),
                None,
            )
            .await
            .map_err(Outcome::Failed)?;
        let start = match chan.recv_packet_timeout(Duration::from_secs(20)).await {
            Ok(p) if p.correlation_id.as_deref() == Some(req.packet_id.as_str()) => match p.payload {
                PacketPayload::FileStreamStart(s) => s,
                PacketPayload::FileCancel(c) => {
                    return Err(Outcome::Cancelled {
                        notify_peer: false,
                        reason: c.reason.unwrap_or_else(|| "The sender cancelled this file.".to_string()),
                    });
                }
                PacketPayload::Error(e) => return Err(Outcome::Failed(e.message)),
                _ => return Err(Outcome::Failed("Unexpected reply from sender".to_string())),
            },
            Ok(_) => return Err(Outcome::Failed("Unexpected reply from sender".to_string())),
            Err(e) => return Err(Outcome::Failed(e)),
        };
        if start.file_size != size {
            return Err(Outcome::Failed(
                "The file changed on the sender's computer. Ask them to send it again.".to_string(),
            ));
        }
        if start.offset > offset {
            return Err(Outcome::Failed("Sender resumed from an invalid position".to_string()));
        }
        offset = start.offset;

        let mut file = tokio::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&temp)
            .await
            .map_err(|e| Outcome::Failed(friendly_io_error(&e)))?;
        file.set_len(offset)
            .await
            .map_err(|e| Outcome::Failed(friendly_io_error(&e)))?;

        let mut hasher = Sha256::new();
        if offset > 0 {
            let mut buf = vec![0u8; 1024 * 1024];
            let mut hashed = 0u64;
            while hashed < offset {
                let n = file
                    .read(&mut buf)
                    .await
                    .map_err(|e| Outcome::Failed(friendly_io_error(&e)))?;
                if n == 0 {
                    break;
                }
                let n = (n as u64).min(offset - hashed) as usize;
                hasher.update(&buf[..n]);
                hashed += n as u64;
            }
        }
        file.seek(std::io::SeekFrom::Start(offset))
            .await
            .map_err(|e| Outcome::Failed(friendly_io_error(&e)))?;

        let mut received = offset;
        let mut progress = Progress::new(offset);
        progress.tick(self, &t.id, received, size, true);
        let expected_hash = loop {
            let frame = tokio::select! {
                _ = token.cancelled() => {
                    let remote = self.remote_cancels.lock().remove(&t.id);
                    return Err(match remote {
                        Some(r) => Outcome::Cancelled { notify_peer: false, reason: r },
                        None => cancelled_locally(),
                    });
                }
                f = tokio::time::timeout(STALL_TIMEOUT, chan.recv_frame()) => f,
            };
            let frame = match frame {
                Err(_) => {
                    return Err(Outcome::Failed(
                        "The transfer stalled. Press Resume to continue.".to_string(),
                    ));
                }
                Ok(Err(_)) => {
                    return Err(Outcome::Failed(
                        "Connection lost. Press Resume to continue where it stopped.".to_string(),
                    ));
                }
                Ok(Ok(f)) => f,
            };
            match frame {
                Frame::Data(d) => {
                    received += d.len() as u64;
                    if received > size {
                        return Err(Outcome::Failed("Received more data than expected".to_string()));
                    }
                    file.write_all(&d)
                        .await
                        .map_err(|e| Outcome::Failed(friendly_io_error(&e)))?;
                    hasher.update(&d);
                    progress.tick(self, &t.id, received, size, false);
                }
                Frame::Packet(p) => match p.payload {
                    PacketPayload::FileStreamEnd(e) => break e.sha256,
                    PacketPayload::FileCancel(c) => {
                        return Err(Outcome::Cancelled {
                            notify_peer: false,
                            reason: c.reason.unwrap_or_else(|| "The sender cancelled this file.".to_string()),
                        });
                    }
                    PacketPayload::Error(e) => return Err(Outcome::Failed(e.message)),
                    _ => {}
                },
            }
        };
        file.flush()
            .await
            .map_err(|e| Outcome::Failed(friendly_io_error(&e)))?;
        file.sync_all()
            .await
            .map_err(|e| Outcome::Failed(friendly_io_error(&e)))?;
        drop(file);
        progress.tick(self, &t.id, received, size, true);

        if received != size {
            return Err(Outcome::Failed("The transfer ended early. Press Resume.".to_string()));
        }
        let digest = hex::encode(hasher.finalize());
        if digest != expected_hash.to_lowercase() {
            let _ = tokio::fs::remove_file(&temp).await;
            t.temp_path = None;
            let _ = chan
                .send(
                    PacketPayload::FileResult(FileResultPayload {
                        transfer_id: t.id.clone(),
                        ok: false,
                        reason: Some("Integrity check failed on the recipient's computer".to_string()),
                    }),
                    None,
                )
                .await;
            return Err(Outcome::Failed(
                "The file was damaged in transit (checksum mismatch). Press Retry to download it again."
                    .to_string(),
            ));
        }

        let final_path = unique_destination(dir, &t.file_name);
        tokio::fs::rename(&temp, &final_path)
            .await
            .map_err(|e| Outcome::Failed(friendly_io_error(&e)))?;
        if t.kind == "update" {
            // Signature, checksum and version info must all match before the
            // installer is kept (and before the sender hears it arrived).
            if let Err(reason) = self.check_downloaded_update(t, &final_path) {
                let _ = tokio::fs::remove_file(&final_path).await;
                t.temp_path = None;
                let _ = chan
                    .send(
                        PacketPayload::FileResult(FileResultPayload {
                            transfer_id: t.id.clone(),
                            ok: false,
                            reason: Some("The installer failed LANX's safety check on the recipient's computer".to_string()),
                        }),
                        None,
                    )
                    .await;
                return Err(Outcome::Failed(reason));
            }
        }
        t.file_hash = digest;
        let _ = chan
            .send(
                PacketPayload::FileResult(FileResultPayload {
                    transfer_id: t.id.clone(),
                    ok: true,
                    reason: None,
                }),
                None,
            )
            .await;
        chan.close().await;
        Ok(final_path)
    }

    /// Unpacks a received folder into Downloads\<Folder> (or "<Folder> (1)").
    /// Returns where it is, plus a note if it had to stay a zip.
    async fn unpack_received_folder(&self, zip: PathBuf, dir: &Path) -> (PathBuf, Option<String>) {
        let name = zip
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "Folder".to_string());
        let target = unique_destination(dir, &sanitize_file_name(&name));
        let (z, tgt) = (zip.clone(), target.clone());
        match tokio::task::spawn_blocking(move || super::folders::unpack_zip(&z, &tgt)).await {
            Ok(Ok(_)) => {
                let _ = tokio::fs::remove_file(&zip).await;
                (target, None)
            }
            Ok(Err(e)) => {
                let _ = tokio::fs::remove_dir_all(&target).await;
                (zip, Some(format!("Saved as a .zip — it could not be unpacked ({}).", e)))
            }
            Err(e) => {
                let _ = tokio::fs::remove_dir_all(&target).await;
                (zip, Some(format!("Saved as a .zip — it could not be unpacked ({}).", e)))
            }
        }
    }

    // ------------------------------------------------------ user controls

    pub async fn retry_transfer(&self, transfer_id: &str) -> Result<TransferRecord, String> {
        let t = self
            .db
            .get_transfer(transfer_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Transfer not found".to_string())?;
        if t.direction == "incoming" {
            return self.accept_transfer(transfer_id).await;
        }
        Ok(self.requeue_offer(t))
    }

    /// Sender side Retry: offer the file again (the recipient resumes if it
    /// already has part of it).
    fn requeue_offer(&self, mut t: TransferRecord) -> TransferRecord {
        if !matches!(t.status.as_str(), "failed" | "queued") {
            return t;
        }
        t.status = "queued".to_string();
        t.error_reason = None;
        self.save_and_emit(&t);
        self.update_file_message(&t.id, "sending", None);
        self.kick_outbox(&t.peer_id, true);
        t
    }

    pub async fn cancel_transfer(&self, transfer_id: &str) -> Result<TransferRecord, String> {
        let mut t = self
            .db
            .get_transfer(transfer_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Transfer not found".to_string())?;
        if let Some(token) = self.active_transfers.lock().get(&t.id).cloned() {
            token.cancel();
            if !self.end_idle_lane_session(&t.id) {
                return Ok(t);
            }
            t.status = "failed".to_string(); // fall through: cancelled below
        }
        // A queued offer never reached the recipient, so there is no one to tell.
        let tell_peer = t.direction == "incoming" || t.status != "queued";
        match (t.direction.as_str(), t.status.as_str()) {
            ("incoming", "pending") => {
                t.status = "declined".to_string();
                t.error_reason = Some("You declined this file.".to_string());
            }
            ("incoming", "failed") | ("outgoing", "queued" | "pending" | "failed") => {
                t.status = "cancelled".to_string();
                t.error_reason = Some("You cancelled this transfer.".to_string());
            }
            _ => return Err("This transfer has already finished.".to_string()),
        }
        t.completed_at = Some(now_secs());
        if let Some(tmp) = t.temp_path.take() {
            super::lanes::remove_plan(Path::new(&tmp));
            let _ = tokio::fs::remove_file(tmp).await;
        }
        self.save_and_emit(&t);
        if t.direction == "outgoing" {
            self.update_file_message(&t.id, "failed", Some("Cancelled".to_string()));
        }
        if tell_peer {
            let reason = if t.direction == "incoming" {
                "The recipient declined this file."
            } else {
                "The sender cancelled this file."
            };
            self.send_cancel_to_peer(&t.peer_id, &t.id, reason);
        }
        Ok(t)
    }

    /// Best effort: tell the other side a transfer was cancelled. If they are
    /// offline they find out the next time they ask for the file.
    fn send_cancel_to_peer(&self, peer_id: &str, transfer_id: &str, reason: &str) {
        let this = self.clone();
        let peer_id = peer_id.to_string();
        let transfer_id = transfer_id.to_string();
        let reason = reason.to_string();
        tauri::async_runtime::spawn(async move {
            let Ok(Some(peer)) = this.db.get_peer(&peer_id) else {
                return;
            };
            if let Ok(mut chan) = this.connect_peer(&peer).await {
                let _ = chan
                    .send(
                        PacketPayload::FileCancel(FileCancelPayload {
                            transfer_id,
                            reason: Some(reason),
                        }),
                        None,
                    )
                    .await;
                chan.close().await;
            }
        });
    }
}
