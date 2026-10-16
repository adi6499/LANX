//! LANX 1.2.3: faster transfers.
//!
//! - **Lanes.** A big file is pulled over several encrypted connections at
//!   once, each carrying one part (`FileRangeRequest { offset, end }`) straight
//!   to its place in the `.lanxpart` file. One TCP connection over Wi-Fi often
//!   cannot use the whole link; several usually can. How far each lane got is
//!   kept next to the part file (`.lanes`), so Resume continues every lane.
//!   At the end both sides hash the whole file (`FileRangeFinish` →
//!   `FileStreamEnd { sha256 }` → `FileResult`), so the integrity check is the
//!   same as for a single connection.
//! - **Speed test.** Measures the real network speed to a colleague over one
//!   connection and over several.
//!
//! Older senders (before 1.2.3) are pulled the old way, over one connection.

use super::protocol::*;
use super::session::{Frame, SecureChannel};
use super::transfer::{Outcome, Progress, friendly_io_error, unique_destination};
use super::{NetworkService, now_secs};
use crate::storage::models::{Peer, TransferRecord};
use parking_lot::Mutex;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

/// Files from this size are pulled over several connections.
pub const LANES_FROM_BYTES: u64 = 16 * 1024 * 1024;
const LANES_MAX: usize = 4;
const LANE_RETRIES: u32 = 4;
const LANE_STALL: Duration = Duration::from_secs(30);
/// How long the sender waits for the recipient to come back before it
/// shows the transfer as interrupted.
const SENDER_IDLE_GIVE_UP: Duration = Duration::from_secs(90);
const FINISH_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const SPEED_TEST_SECS: f64 = 3.0;
const SPEED_TEST_MAX_BYTES: u64 = 512 * 1024 * 1024;

/// How many connections to use for this many remaining bytes.
pub fn lane_count(remaining: u64) -> usize {
    if remaining >= 64 * 1024 * 1024 {
        LANES_MAX
    } else if remaining >= LANES_FROM_BYTES {
        2
    } else {
        1
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Lane {
    pub start: u64,
    pub end: u64,
    /// Bytes of this lane already on disk.
    pub done: u64,
}

impl Lane {
    fn remaining(&self) -> u64 {
        (self.end - self.start).saturating_sub(self.done)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LanePlan {
    pub size: u64,
    pub lanes: Vec<Lane>,
}

impl LanePlan {
    pub fn done(&self) -> u64 {
        self.lanes.iter().map(|l| l.done).sum()
    }

    /// A fresh plan: `prefix` bytes are already on disk (from an older
    /// single-connection attempt); the rest is split evenly.
    pub fn new(size: u64, prefix: u64) -> Self {
        let prefix = prefix.min(size);
        let mut lanes = vec![Lane { start: 0, end: prefix, done: prefix }];
        let rest = size - prefix;
        let n = lane_count(rest).max(1) as u64;
        let step = rest.div_ceil(n).max(1);
        let mut at = prefix;
        while at < size {
            let end = (at + step).min(size);
            lanes.push(Lane { start: at, end, done: 0 });
            at = end;
        }
        lanes.retain(|l| l.end > l.start);
        Self { size, lanes }
    }

    fn valid(&self, size: u64) -> bool {
        self.size == size
            && self.lanes.iter().all(|l| l.start <= l.end && l.end <= size && l.done <= l.end - l.start)
    }
}

fn plan_path(temp: &Path) -> PathBuf {
    let mut p = temp.as_os_str().to_owned();
    p.push(".lanes");
    PathBuf::from(p)
}

fn save_plan(temp: &Path, plan: &LanePlan) {
    if let Ok(json) = serde_json::to_vec(plan) {
        let tmp = plan_path(temp).with_extension("lanes-tmp");
        if std::fs::write(&tmp, json).is_ok() {
            let _ = std::fs::rename(&tmp, plan_path(temp));
        }
    }
}

fn load_plan(temp: &Path, size: u64) -> Option<LanePlan> {
    let bytes = std::fs::read(plan_path(temp)).ok()?;
    let plan: LanePlan = serde_json::from_slice(&bytes).ok()?;
    plan.valid(size).then_some(plan)
}

pub fn remove_plan(temp: &Path) {
    let _ = std::fs::remove_file(plan_path(temp));
}

pub fn has_plan(temp: &Path) -> bool {
    plan_path(temp).exists()
}

/// Bytes of a part file that really arrived (with lanes the file already has
/// its final size, so its length says nothing).
pub fn bytes_on_disk(temp: &Path, size: u64) -> u64 {
    match load_plan(temp, size) {
        Some(p) => p.done(),
        None => std::fs::metadata(temp).map(|m| m.len()).unwrap_or(0),
    }
}

/// Lets parts of the file be written in any order without Windows first
/// filling the gaps with zeros.
#[cfg(windows)]
fn make_sparse(file: &std::fs::File) {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::System::IO::DeviceIoControl;
    use windows_sys::Win32::System::Ioctl::FSCTL_SET_SPARSE;
    let mut returned = 0u32;
    unsafe {
        DeviceIoControl(
            file.as_raw_handle() as _,
            FSCTL_SET_SPARSE,
            std::ptr::null(),
            0,
            std::ptr::null_mut(),
            0,
            &mut returned,
            std::ptr::null_mut(),
        );
    }
}

#[cfg(not(windows))]
fn make_sparse(_file: &std::fs::File) {}

fn hash_file(path: &Path) -> Result<String, String> {
    use std::io::Read;
    let mut f = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

/// Sender-side state of a transfer being pulled over lanes.
pub(crate) struct LaneSession {
    token: CancellationToken,
    active: usize,
    base: u64,
    sent: Arc<AtomicU64>,
    progress: Progress,
    hash: watch::Receiver<Option<Result<String, String>>>,
    idle_epoch: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct SpeedTestResult {
    /// MB/s over one connection.
    pub single_mbps: f64,
    /// MB/s over several connections at once.
    pub multi_mbps: f64,
    pub connections: usize,
}

enum LaneEnd {
    Done,
    Cancelled(String),
    Broken(String),
}

impl NetworkService {
    // ============================================================ recipient

    /// Pulls a file over several connections. `first` is an open session to
    /// the sender (already known to run 1.2.3 or newer).
    pub(super) async fn download_lanes(
        &self,
        t: &mut TransferRecord,
        dir: &Path,
        token: &CancellationToken,
        peer: &Peer,
        first: SecureChannel,
    ) -> Result<PathBuf, Outcome> {
        let temp = PathBuf::from(t.temp_path.clone().unwrap_or_default());
        let size = t.file_size.max(0) as u64;

        // Where every lane stands.
        let plan = match load_plan(&temp, size) {
            Some(p) if temp.exists() => p,
            _ => {
                // A part file without a lane plan came from a single
                // connection: its bytes are a complete prefix.
                let prefix = std::fs::metadata(&temp).map(|m| m.len()).unwrap_or(0).min(size);
                LanePlan::new(size, prefix)
            }
        };
        {
            let f = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .open(&temp)
                .map_err(|e| Outcome::Failed(friendly_io_error(&e)))?;
            make_sparse(&f);
            f.set_len(size).map_err(|e| Outcome::Failed(friendly_io_error(&e)))?;
        }
        save_plan(&temp, &plan);

        let done_total = Arc::new(AtomicU64::new(plan.done()));
        let plan = Arc::new(Mutex::new(plan));
        let lanes_token = token.child_token();
        let mut first = Some(first);
        let mut set = tokio::task::JoinSet::new();
        let indexes: Vec<usize> = {
            let p = plan.lock();
            (0..p.lanes.len()).filter(|&i| p.lanes[i].remaining() > 0).collect()
        };
        for i in indexes {
            let this = self.clone();
            let peer = peer.clone();
            let id = t.id.clone();
            let temp = temp.clone();
            let plan = plan.clone();
            let done_total = done_total.clone();
            let tok = lanes_token.clone();
            let chan = first.take();
            set.spawn(async move { this.run_lane(&id, &peer, &temp, i, plan, done_total, tok, chan).await });
        }
        if let Some(c) = first.take() {
            c.close().await; // nothing left to fetch on it
        }

        // Progress and the saved plan while the lanes run.
        let mut progress = Progress::new(done_total.load(Ordering::Relaxed));
        progress.tick(self, &t.id, done_total.load(Ordering::Relaxed), size, true);
        let mut last_save = Instant::now();
        let mut failure: Option<Outcome> = None;
        loop {
            tokio::select! {
                joined = set.join_next() => {
                    match joined {
                        None => break,
                        Some(Ok(LaneEnd::Done)) => {}
                        Some(Ok(LaneEnd::Cancelled(reason))) => {
                            failure.get_or_insert(Outcome::Cancelled { notify_peer: false, reason });
                            lanes_token.cancel();
                        }
                        Some(Ok(LaneEnd::Broken(reason))) => {
                            failure.get_or_insert(Outcome::Failed(reason));
                            lanes_token.cancel();
                        }
                        Some(Err(_)) => {
                            failure.get_or_insert(Outcome::Failed("A transfer lane stopped unexpectedly.".to_string()));
                            lanes_token.cancel();
                        }
                    }
                }
                _ = tokio::time::sleep(Duration::from_millis(250)) => {
                    progress.tick(self, &t.id, done_total.load(Ordering::Relaxed), size, false);
                    if last_save.elapsed() >= Duration::from_secs(1) {
                        last_save = Instant::now();
                        save_plan(&temp, &plan.lock().clone());
                    }
                }
            }
        }
        save_plan(&temp, &plan.lock().clone());
        if token.is_cancelled() {
            let remote = self.remote_cancels.lock().remove(&t.id);
            return Err(match remote {
                Some(r) => Outcome::Cancelled { notify_peer: false, reason: r },
                None => Outcome::Cancelled {
                    notify_peer: true,
                    reason: "You cancelled this transfer.".to_string(),
                },
            });
        }
        if let Some(f) = failure {
            return Err(f);
        }
        let received = done_total.load(Ordering::Relaxed);
        progress.tick(self, &t.id, received, size, true);
        if received != size {
            return Err(Outcome::Failed("The transfer ended early. Press Resume.".to_string()));
        }

        // Both sides hash the whole file; only a match is kept.
        let local = {
            let temp = temp.clone();
            tokio::task::spawn_blocking(move || hash_file(&temp))
        };
        let mut chan = self.connect_peer(peer).await.map_err(|_| {
            Outcome::Failed(format!("{} went offline at the very end. Press Resume.", peer.display_name))
        })?;
        let req = chan
            .send(PacketPayload::FileRangeFinish(TransferRefPayload { transfer_id: t.id.clone() }), None)
            .await
            .map_err(Outcome::Failed)?;
        let expected = match chan.recv_packet_timeout(FINISH_TIMEOUT).await {
            Ok(p) if p.correlation_id.as_deref() == Some(req.packet_id.as_str()) => match p.payload {
                PacketPayload::FileStreamEnd(e) => e.sha256,
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
        let digest = local
            .await
            .map_err(|e| Outcome::Failed(e.to_string()))?
            .map_err(|e| Outcome::Failed(format!("Could not read the received file ({})", e)))?;
        let refuse = |reason: &str| {
            PacketPayload::FileResult(FileResultPayload {
                transfer_id: t.id.clone(),
                ok: false,
                reason: Some(reason.to_string()),
            })
        };
        if digest != expected.to_lowercase() {
            let _ = tokio::fs::remove_file(&temp).await;
            remove_plan(&temp);
            t.temp_path = None;
            let _ = chan.send(refuse("Integrity check failed on the recipient's computer"), None).await;
            return Err(Outcome::Failed(
                "The file was damaged in transit (checksum mismatch). Press Retry to download it again.".to_string(),
            ));
        }
        remove_plan(&temp);
        let final_path = unique_destination(dir, &t.file_name);
        tokio::fs::rename(&temp, &final_path)
            .await
            .map_err(|e| Outcome::Failed(friendly_io_error(&e)))?;
        if t.kind == "update" {
            if let Err(reason) = self.check_downloaded_update(t, &final_path) {
                let _ = tokio::fs::remove_file(&final_path).await;
                t.temp_path = None;
                let _ = chan
                    .send(refuse("The installer failed LANX's safety check on the recipient's computer"), None)
                    .await;
                return Err(Outcome::Failed(reason));
            }
        }
        t.file_hash = digest;
        let _ = chan
            .send(
                PacketPayload::FileResult(FileResultPayload { transfer_id: t.id.clone(), ok: true, reason: None }),
                None,
            )
            .await;
        chan.close().await;
        Ok(final_path)
    }

    /// One lane: pulls its part, reconnecting a few times if the connection drops.
    #[allow(clippy::too_many_arguments)]
    async fn run_lane(
        &self,
        transfer_id: &str,
        peer: &Peer,
        temp: &Path,
        index: usize,
        plan: Arc<Mutex<LanePlan>>,
        done_total: Arc<AtomicU64>,
        token: CancellationToken,
        mut chan: Option<SecureChannel>,
    ) -> LaneEnd {
        let mut file = match tokio::fs::OpenOptions::new().write(true).open(temp).await {
            Ok(f) => f,
            Err(e) => return LaneEnd::Broken(friendly_io_error(&e)),
        };
        let mut attempt = 0;
        let mut last_error = String::new();
        loop {
            let (pos, end) = {
                let p = plan.lock();
                let l = &p.lanes[index];
                (l.start + l.done, l.end)
            };
            if pos >= end {
                return LaneEnd::Done;
            }
            if token.is_cancelled() {
                return LaneEnd::Cancelled("You cancelled this transfer.".to_string());
            }
            if attempt > LANE_RETRIES {
                return LaneEnd::Broken(if last_error.is_empty() {
                    "Connection lost. Press Resume to continue where it stopped.".to_string()
                } else {
                    last_error
                });
            }
            if attempt > 0 {
                tokio::time::sleep(Duration::from_millis(500 * (1 << attempt.min(4)))).await;
            }
            attempt += 1;
            let mut c = match chan.take() {
                Some(c) => c,
                None => {
                    let connected = tokio::select! {
                        _ = token.cancelled() => None,
                        c = self.connect_peer(peer) => Some(c),
                    };
                    match connected {
                        None => continue, // cancelled: handled at the top of the loop
                        Some(Ok(c)) => c,
                        Some(Err(_)) => {
                            last_error = format!(
                                "{} is not reachable right now. Press Resume when they are online.",
                                peer.display_name
                            );
                            continue;
                        }
                    }
                }
            };
            let req = match c
                .send(
                    PacketPayload::FileRangeRequest(FileRangeRequestPayload {
                        transfer_id: transfer_id.to_string(),
                        offset: pos,
                        end,
                    }),
                    None,
                )
                .await
            {
                Ok(r) => r,
                Err(_) => continue,
            };
            match c.recv_packet_timeout(Duration::from_secs(20)).await {
                Ok(p) if p.correlation_id.as_deref() == Some(req.packet_id.as_str()) => match p.payload {
                    PacketPayload::FileStreamStart(s) if s.offset == pos => {}
                    PacketPayload::FileCancel(cn) => {
                        return LaneEnd::Cancelled(cn.reason.unwrap_or_else(|| "The sender cancelled this file.".to_string()));
                    }
                    PacketPayload::Error(e) if e.code == "BUSY" => {
                        last_error = e.message;
                        continue;
                    }
                    PacketPayload::Error(e) => return LaneEnd::Broken(e.message),
                    _ => return LaneEnd::Broken("Unexpected reply from sender".to_string()),
                },
                _ => continue,
            }
            if file.seek(std::io::SeekFrom::Start(pos)).await.is_err() {
                return LaneEnd::Broken("Could not write the file".to_string());
            }
            let mut at = pos;
            let end_seen = loop {
                let frame = tokio::select! {
                    _ = token.cancelled() => {
                        let _ = file.flush().await;
                        return LaneEnd::Cancelled("You cancelled this transfer.".to_string());
                    }
                    f = tokio::time::timeout(LANE_STALL, c.recv_frame()) => f,
                };
                match frame {
                    Ok(Ok(Frame::Data(d))) => {
                        let n = d.len() as u64;
                        if at + n > end {
                            return LaneEnd::Broken("Received more data than expected".to_string());
                        }
                        if let Err(e) = file.write_all(&d).await {
                            return LaneEnd::Broken(friendly_io_error(&e));
                        }
                        at += n;
                        plan.lock().lanes[index].done += n;
                        done_total.fetch_add(n, Ordering::Relaxed);
                    }
                    Ok(Ok(Frame::Packet(p))) => match p.payload {
                        PacketPayload::FileRangeEnd(_) => break true,
                        PacketPayload::FileCancel(cn) => {
                            let _ = file.flush().await;
                            return LaneEnd::Cancelled(cn.reason.unwrap_or_else(|| "The sender cancelled this file.".to_string()));
                        }
                        PacketPayload::Error(e) => return LaneEnd::Broken(e.message),
                        _ => {}
                    },
                    Ok(Err(_)) => {
                        last_error = "Connection lost. Press Resume to continue where it stopped.".to_string();
                        break false;
                    }
                    Err(_) => {
                        last_error = "The transfer stalled. Press Resume to continue.".to_string();
                        break false;
                    }
                }
            };
            let _ = file.flush().await;
            if end_seen && at == end {
                c.close().await;
                let _ = file.sync_data().await;
                return LaneEnd::Done;
            }
            // Progress was made: try again without using up the retries.
            if at > pos {
                attempt = 0;
            }
        }
    }

    // =============================================================== sender

    fn lane_transfer(&self, peer: &Peer, transfer_id: &str) -> Result<TransferRecord, (String, String)> {
        match self.db.get_transfer(transfer_id) {
            Ok(Some(t)) if t.direction == "outgoing" && t.peer_id == peer.id => {
                if matches!(t.status.as_str(), "cancelled" | "declined") {
                    Err(("CANCELLED".into(), "The sender cancelled this file.".into()))
                } else {
                    Ok(t)
                }
            }
            _ => Err(("NOT_FOUND".into(), "This file is no longer offered.".into())),
        }
    }

    async fn refuse(chan: &mut SecureChannel, corr: Option<String>, code: &str, msg: &str, transfer_id: &str) {
        let payload = if code == "CANCELLED" {
            PacketPayload::FileCancel(FileCancelPayload {
                transfer_id: transfer_id.to_string(),
                reason: Some(msg.to_string()),
            })
        } else {
            PacketPayload::Error(ErrorPayload { code: code.to_string(), message: msg.to_string() })
        };
        let _ = chan.send(payload, corr).await;
    }

    /// Joins (or starts) the sender-side lane session of a transfer.
    fn join_lane_session(&self, t: &mut TransferRecord, path: &Path) -> Option<(CancellationToken, Arc<AtomicU64>)> {
        let mut sessions = self.lane_sessions.lock();
        if let Some(s) = sessions.get_mut(&t.id) {
            s.active += 1;
            return Some((s.token.clone(), s.sent.clone()));
        }
        // A single-connection transfer of the same file is running.
        if self.active_transfers.lock().contains_key(&t.id) {
            return None;
        }
        let token = CancellationToken::new();
        self.active_transfers.lock().insert(t.id.clone(), token.clone());
        let (tx, rx) = watch::channel(None);
        let p = path.to_path_buf();
        tauri::async_runtime::spawn(async move {
            let r = tokio::task::spawn_blocking(move || hash_file(&p))
                .await
                .unwrap_or_else(|e| Err(e.to_string()));
            let _ = tx.send(Some(r));
        });
        let base = t.transferred_bytes.max(0) as u64;
        let sent = Arc::new(AtomicU64::new(0));
        sessions.insert(
            t.id.clone(),
            LaneSession {
                token: token.clone(),
                active: 1,
                base,
                sent: sent.clone(),
                progress: Progress::new(base),
                hash: rx,
                idle_epoch: 0,
            },
        );
        drop(sessions);
        t.status = "transferring".to_string();
        t.error_reason = None;
        self.save_and_emit(t);
        Some((token, sent))
    }

    /// A lane connection closed. When none is left the sender waits a
    /// while for the recipient to resume, then shows the transfer as
    /// interrupted.
    fn leave_lane_session(&self, transfer_id: &str) {
        let epoch = {
            let mut sessions = self.lane_sessions.lock();
            let Some(s) = sessions.get_mut(transfer_id) else { return };
            s.active = s.active.saturating_sub(1);
            if s.active > 0 {
                return;
            }
            s.idle_epoch += 1;
            s.idle_epoch
        };
        let this = self.clone();
        let id = transfer_id.to_string();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(SENDER_IDLE_GIVE_UP).await;
            let expired = {
                let sessions = this.lane_sessions.lock();
                sessions.get(&id).is_some_and(|s| s.active == 0 && s.idle_epoch == epoch)
            };
            if expired {
                this.end_lane_session(&id);
                if let Ok(Some(mut t)) = this.db.get_transfer(&id) {
                    if t.status == "transferring" {
                        t.status = "failed".to_string();
                        t.error_reason = Some("Connection lost. The recipient can resume.".to_string());
                        this.save_and_emit(&t);
                    }
                }
            }
        });
    }

    fn end_lane_session(&self, transfer_id: &str) {
        self.lane_sessions.lock().remove(transfer_id);
        self.active_transfers.lock().remove(transfer_id);
    }

    /// Ends a sender-side lane session that has no connection open right
    /// now (so nobody else will). True if there was one.
    pub(crate) fn end_idle_lane_session(&self, transfer_id: &str) -> bool {
        let idle = self.lane_sessions.lock().get(transfer_id).is_some_and(|s| s.active == 0);
        if idle {
            self.end_lane_session(transfer_id);
        }
        idle
    }

    fn lane_progress(&self, transfer_id: &str, size: u64) {
        let mut sessions = self.lane_sessions.lock();
        if let Some(s) = sessions.get_mut(transfer_id) {
            let done = (s.base + s.sent.load(Ordering::Relaxed)).min(size);
            s.progress.tick(self, transfer_id, done, size, false);
        }
    }

    /// Sender: stream bytes `offset..end` on this connection.
    pub(super) async fn serve_range(&self, mut chan: SecureChannel, peer: &Peer, req: FileRangeRequestPayload, corr: String) {
        let corr = Some(corr);
        let mut t = match self.lane_transfer(peer, &req.transfer_id) {
            Ok(t) => t,
            Err((code, msg)) => return Self::refuse(&mut chan, corr, &code, &msg, &req.transfer_id).await,
        };
        let path = PathBuf::from(t.local_path.clone().unwrap_or_default());
        let mut file = match tokio::fs::File::open(&path).await {
            Ok(f) => f,
            Err(_) => {
                return Self::refuse(&mut chan, corr, "FILE_MISSING", "The file was moved or deleted on the sender's computer.", &t.id).await;
            }
        };
        let size = file.metadata().await.map(|m| m.len()).unwrap_or(0);
        if size != t.file_size.max(0) as u64 {
            return Self::refuse(&mut chan, corr, "FILE_CHANGED", "The file changed after it was offered. Send it again.", &t.id).await;
        }
        if req.offset > req.end || req.end > size {
            return Self::refuse(&mut chan, corr, "BAD_RANGE", "Invalid part of the file requested.", &t.id).await;
        }
        let Some((token, sent)) = self.join_lane_session(&mut t, &path) else {
            return Self::refuse(&mut chan, corr, "BUSY", "This file is already being transferred.", &t.id).await;
        };
        let ok = async {
            chan.send(
                PacketPayload::FileStreamStart(FileStreamStartPayload {
                    transfer_id: t.id.clone(),
                    offset: req.offset,
                    file_size: size,
                }),
                corr,
            )
            .await
            .ok()?;
            file.seek(std::io::SeekFrom::Start(req.offset)).await.ok()?;
            let mut buf = vec![0u8; FILE_CHUNK_SIZE];
            let mut at = req.offset;
            while at < req.end {
                if token.is_cancelled() {
                    let reason = self.remote_cancels.lock().get(&t.id).cloned();
                    if reason.is_none() {
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
                    return Some(false);
                }
                let want = ((req.end - at) as usize).min(buf.len());
                let n = file.read(&mut buf[..want]).await.ok()?;
                if n == 0 {
                    return None;
                }
                chan.send_data(&buf[..n]).await.ok()?;
                at += n as u64;
                sent.fetch_add(n as u64, Ordering::Relaxed);
                self.lane_progress(&t.id, size);
            }
            chan.send(PacketPayload::FileRangeEnd(TransferRefPayload { transfer_id: t.id.clone() }), None)
                .await
                .ok()?;
            chan.flush().await.ok()?;
            Some(true)
        }
        .await;
        match ok {
            Some(false) => {
                // Cancelled (here or by the recipient).
                let reason = self
                    .remote_cancels
                    .lock()
                    .remove(&t.id)
                    .unwrap_or_else(|| "You cancelled this transfer.".to_string());
                self.end_lane_session(&t.id);
                if let Ok(Some(mut cur)) = self.db.get_transfer(&t.id) {
                    if !matches!(cur.status.as_str(), "cancelled" | "completed") {
                        cur.status = "cancelled".to_string();
                        cur.error_reason = Some(reason);
                        cur.completed_at = Some(now_secs());
                        self.save_and_emit(&cur);
                    }
                }
            }
            _ => {
                chan.close().await;
                self.leave_lane_session(&t.id);
            }
        }
    }

    /// Sender: all lanes arrived — send the whole file's hash and wait for
    /// the recipient's verdict.
    pub(super) async fn serve_finish(&self, mut chan: SecureChannel, peer: &Peer, req: TransferRefPayload, corr: String) {
        let corr = Some(corr);
        let mut t = match self.lane_transfer(peer, &req.transfer_id) {
            Ok(t) => t,
            Err((code, msg)) => return Self::refuse(&mut chan, corr, &code, &msg, &req.transfer_id).await,
        };
        let path = PathBuf::from(t.local_path.clone().unwrap_or_default());
        let rx = self.lane_sessions.lock().get_mut(&t.id).map(|s| {
            s.active += 1;
            s.hash.clone()
        });
        let digest = match rx {
            Some(mut rx) => {
                let r = loop {
                    if let Some(r) = rx.borrow().clone() {
                        break r;
                    }
                    if rx.changed().await.is_err() {
                        break Err("hash task stopped".to_string());
                    }
                };
                self.leave_lane_session(&t.id);
                r
            }
            // LANX restarted between the lanes and the end: hash now.
            None => {
                let p = path.clone();
                tokio::task::spawn_blocking(move || hash_file(&p))
                    .await
                    .unwrap_or_else(|e| Err(e.to_string()))
            }
        };
        let digest = match digest {
            Ok(d) => d,
            Err(_) => {
                return Self::refuse(&mut chan, corr, "FILE_MISSING", "The file could not be read on the sender's computer.", &t.id).await;
            }
        };
        if chan
            .send(
                PacketPayload::FileStreamEnd(FileStreamEndPayload { transfer_id: t.id.clone(), sha256: digest.clone() }),
                corr,
            )
            .await
            .is_err()
        {
            return;
        }
        let verdict = chan.recv_packet_timeout(Duration::from_secs(120)).await;
        self.end_lane_session(&t.id);
        let size = t.file_size.max(0);
        match verdict.map(|p| p.payload) {
            Ok(PacketPayload::FileResult(r)) if r.ok => {
                t.status = "completed".to_string();
                t.file_hash = digest;
                t.transferred_bytes = size;
                t.error_reason = None;
                t.completed_at = Some(now_secs());
                self.events.transfer_progress(&t.id, size as u64, size as u64, 0);
                self.save_and_emit(&t);
            }
            Ok(PacketPayload::FileResult(r)) => {
                t.status = "failed".to_string();
                t.error_reason = Some(r.reason.unwrap_or_else(|| "Recipient could not save the file".to_string()));
                self.save_and_emit(&t);
            }
            _ => {
                t.status = "failed".to_string();
                t.error_reason = Some("Connection lost at the end of the transfer.".to_string());
                self.save_and_emit(&t);
            }
        }
        chan.close().await;
    }

    // ========================================================= speed test

    /// Measures the network speed to a colleague: one connection, then several.
    pub async fn speed_test(&self, peer_id: &str) -> Result<SpeedTestResult, String> {
        let peer = self
            .db
            .get_peer(peer_id)
            .map_err(|e| e.to_string())?
            .ok_or("Colleague not found")?;
        if peer.status != "online" {
            return Err(format!("{} is offline right now.", peer.display_name));
        }
        let single = self.speed_lane(&peer, SPEED_TEST_SECS).await?;
        let mut set = tokio::task::JoinSet::new();
        for _ in 0..LANES_MAX {
            let this = self.clone();
            let peer = peer.clone();
            set.spawn(async move { this.speed_lane(&peer, SPEED_TEST_SECS).await });
        }
        let mut multi = 0.0;
        while let Some(r) = set.join_next().await {
            multi += r.map_err(|e| e.to_string())??;
        }
        Ok(SpeedTestResult {
            single_mbps: (single * 10.0).round() / 10.0,
            multi_mbps: (multi * 10.0).round() / 10.0,
            connections: LANES_MAX,
        })
    }

    /// Sends random data for `secs` seconds; returns MB/s the other side received.
    async fn speed_lane(&self, peer: &Peer, secs: f64) -> Result<f64, String> {
        let mut chan = self.connect_peer(peer).await.map_err(|_| format!("Could not reach {}.", peer.display_name))?;
        if !version_at_least(&chan.remote.app_version, FEATURES_FAST) {
            chan.close().await;
            return Err(format!("{} needs LANX {} or newer for the speed test.", peer.display_name, FEATURES_FAST));
        }
        chan.send(PacketPayload::SpeedTest(SpeedTestPayload { phase: "start".into(), bytes: None }), None)
            .await?;
        let mut buf = vec![0u8; FILE_CHUNK_SIZE];
        rand::thread_rng().fill_bytes(&mut buf);
        let started = Instant::now();
        let mut sent = 0u64;
        while started.elapsed().as_secs_f64() < secs && sent < SPEED_TEST_MAX_BYTES {
            chan.send_data(&buf).await?;
            sent += buf.len() as u64;
        }
        let end = chan
            .send(PacketPayload::SpeedTest(SpeedTestPayload { phase: "end".into(), bytes: Some(sent) }), None)
            .await?;
        chan.flush().await?;
        let reply = chan.recv_packet_timeout(Duration::from_secs(60)).await?;
        let elapsed = started.elapsed().as_secs_f64().max(0.001);
        chan.close().await;
        match reply.payload {
            PacketPayload::SpeedTest(r) if reply.correlation_id.as_deref() == Some(end.packet_id.as_str()) => {
                Ok(r.bytes.unwrap_or(0) as f64 / elapsed / (1024.0 * 1024.0))
            }
            _ => Err("The speed test did not finish.".to_string()),
        }
    }

    /// Receiving end of a speed test: count and drop the data.
    pub(super) async fn serve_speed_test(&self, mut chan: SecureChannel) {
        let mut got = 0u64;
        loop {
            match tokio::time::timeout(Duration::from_secs(30), chan.recv_frame()).await {
                Ok(Ok(Frame::Data(d))) => got += d.len() as u64,
                Ok(Ok(Frame::Packet(p))) => {
                    if let PacketPayload::SpeedTest(s) = p.payload {
                        if s.phase == "end" {
                            let _ = chan
                                .send(
                                    PacketPayload::SpeedTest(SpeedTestPayload { phase: "result".into(), bytes: Some(got) }),
                                    Some(p.packet_id),
                                )
                                .await;
                            let _ = chan.flush().await;
                            break;
                        }
                    }
                }
                _ => break,
            }
        }
        chan.close().await;
    }
}
