//! "Share LANX update": a colleague who has a newer, official LANX installer
//! offers it over the office network, and LANX on older PCs shows
//! "LANX x.y.z is available — Update now".
//!
//! Why: an installer that arrives through WhatsApp, e-mail or a browser carries
//! Windows' "came from the internet" mark, so SmartScreen shows the blue
//! "Windows protected your PC" box for an unsigned program. Files that LANX
//! writes itself carry no such mark, so an update received through LANX opens
//! with only the usual "allow this app to make changes?" (UAC) question.
//!
//! Safety:
//! - offers arrive only over an authenticated session from a known colleague
//!   (pinned key, not blocked) and are only sent to LANX 1.2+;
//! - only versions newer than this PC's LANX are accepted;
//! - every installer carries the LANX release signature (Ed25519 over version,
//!   SHA-256 and size, made by `npm run release`), so a colleague's PC cannot
//!   pass any other program off as a LANX update;
//! - the downloaded file must match that SHA-256, and its Windows version
//!   information must say LANX <version>;
//! - nothing runs until the user presses Update now / Install now, and the
//!   file is checked again (and kept locked against changes) while Windows
//!   starts it.

use super::protocol::*;
use super::session::{RemotePeer, SecureChannel};
use super::{ACK_TIMEOUT, NetworkService, now_secs};
use crate::security::DeviceIdentity;
use crate::storage::models::{Peer, ReleaseInfo, TransferRecord};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// Public half of the LANX release key (see scripts/release-key.mjs).
const RELEASE_PUBLIC_KEY: &str = include_str!("../../release-key.pub");
/// Installer switches: progress bar only, close LANX, update in place, then
/// start LANX again (Tauri's NSIS installer).
pub const INSTALLER_ARGS: &str = "/P /R /UPDATE";
const MAX_INSTALLER_BYTES: u64 = 1024 * 1024 * 1024;
/// How often a colleague whose version is unknown or behind is asked for it.
const PROBE_EVERY: Duration = Duration::from_secs(60);
/// "Remind me tomorrow".
pub const SNOOZE_SECS: i64 = 24 * 3600;
/// A ready update is announced again at most this often.
const REMIND_EVERY_SECS: i64 = 20 * 3600;
const SHARE_SETTING: &str = "update_share";
const SNOOZE_SETTING: &str = "update_snoozed_until";
const REMINDED_SETTING: &str = "update_reminded_at";
const AUTO_CHAT_SETTING: &str = "update_auto_chat";
/// JSON map peer id -> version already sent to them as a chat file.
const CHAT_SENT_SETTING: &str = "update_chat_sent";

#[derive(Clone, Debug)]
pub struct UpdateConfig {
    /// This PC's LANX version.
    pub app_version: String,
    /// Hex Ed25519 public key that signs LANX releases.
    pub release_key: String,
    /// Also require the installer's Windows version info to say LANX <version>.
    pub check_exe_version: bool,
    /// Check everything but do not start the installer (side-by-side tests).
    pub dry_run: bool,
    /// Where installers are kept (default `%APPDATA%\LANX\Updates`).
    pub dir: Option<PathBuf>,
    /// Where the installer leaves a copy of itself and its .sig (default
    /// `<LANX program folder>\updates`, see windows/installer-hooks.nsh).
    pub install_dir: Option<PathBuf>,
}

impl Default for UpdateConfig {
    fn default() -> Self {
        Self {
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            release_key: RELEASE_PUBLIC_KEY.trim().to_string(),
            check_exe_version: cfg!(windows),
            dry_run: crate::testmode::install_dry_run(),
            dir: None,
            install_dir: std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.join("updates"))),
        }
    }
}

/// In-memory state of the update feature.
#[derive(Default)]
pub struct UpdateRuntime {
    /// Downloads started by "Update now": install as soon as they are checked.
    install_after_download: HashSet<String>,
    /// Colleagues recently asked for their version.
    probes: HashMap<String, Instant>,
    /// Colleagues an offer is being prepared for right now.
    offering: HashSet<String>,
    /// Version being downloaded in the background.
    auto_download: Option<String>,
    /// Version whose installer was started.
    installing: Option<String>,
    /// Installer starts recorded instead of run (dry run).
    pub(crate) dry_runs: Vec<String>,
}

fn default_origin() -> String {
    "chosen".to_string()
}

/// The installer this PC passes on to colleagues.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct SharedInstaller {
    pub path: String,
    pub file_name: String,
    #[serde(flatten)]
    pub release: ReleaseInfo,
    /// "chosen" (picked in Settings, or installed from a folder that had its
    /// .sig) | "passed_on" (received through LANX). Only chosen installers
    /// are also sent as chat files to colleagues on LANX 1.1, so they don't
    /// get one copy from every updated PC.
    #[serde(default = "default_origin")]
    pub origin: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct AvailableUpdate {
    pub version: String,
    /// "available" (offered) | "downloading" | "ready" | "failed" | "installing"
    pub state: String,
    /// Colleague offering it; empty when it is the installer this PC shares.
    pub from_name: String,
    pub from_online: bool,
    pub file_size: u64,
    pub transfer_id: Option<String>,
    pub transferred_bytes: u64,
    pub error: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct ColleagueUpdate {
    pub peer_id: String,
    pub display_name: String,
    pub online: bool,
    pub app_version: Option<String>,
    /// Their LANX is older than the newest one known on the network.
    pub behind: bool,
    /// "up_to_date" | "behind" | "unknown", and while this PC shares an
    /// installer: "old_version" (needs it as a chat file) | "chat_sent" |
    /// "waiting" | "offered" | "downloading" | "received" | "failed" |
    /// "declined" | "not_offered"
    pub state: String,
    pub detail: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct UpdateStatus {
    pub current_version: String,
    /// Newest LANX seen on the network (this PC, colleagues, offers).
    pub latest_version: String,
    pub available: Option<AvailableUpdate>,
    pub sharing: Option<SharedInstaller>,
    pub colleagues: Vec<ColleagueUpdate>,
    /// "Remind me tomorrow" was pressed: hide the banner until then.
    pub snoozed_until: Option<i64>,
    /// Send the shared installer once as a chat file to colleagues on 1.1.
    pub auto_chat: bool,
}

// ------------------------------------------------------------- checks

/// Exactly the bytes the release signature covers (also in release-key.mjs).
pub fn release_message(version: &str, sha256: &str, size: u64) -> Vec<u8> {
    format!("LANX-RELEASE-V1\n{}\n{}\n{}", version, sha256, size).into_bytes()
}

/// Checks the LANX release signature and the shape of what it covers.
pub fn verify_release(key_hex: &str, r: &ReleaseInfo) -> Result<(), String> {
    if !valid_version(&r.version) {
        return Err(format!("\"{}\" is not a LANX version number.", r.version));
    }
    if r.sha256.len() != 64 || !r.sha256.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')) {
        return Err("The installer checksum is malformed.".to_string());
    }
    if r.size == 0 || r.size > MAX_INSTALLER_BYTES {
        return Err("The installer size is not plausible.".to_string());
    }
    match DeviceIdentity::verify_signature(
        key_hex,
        &release_message(&r.version, &r.sha256, r.size),
        &r.signature,
    ) {
        Ok(true) => Ok(()),
        _ => Err("It is not an official LANX release (the release signature does not match).".to_string()),
    }
}

fn hash_reader(mut f: impl Read) -> std::io::Result<(String, u64)> {
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1024 * 1024];
    let mut total = 0u64;
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        total += n as u64;
    }
    Ok((hex::encode(hasher.finalize()), total))
}

/// "1.2.1" matches the Windows file version "1.2.1.0".
pub fn version_matches(file_version: &str, version: &str) -> bool {
    let parse = |v: &str| {
        let mut p: Vec<u32> = v
            .split('.')
            .map(|x| x.trim().parse().unwrap_or(u32::MAX))
            .collect();
        while p.len() > 3 && p.last() == Some(&0) {
            p.pop();
        }
        p
    };
    parse(file_version) == parse(version)
}

/// The installer's own Windows version information must say LANX <version>.
pub fn check_exe_version(path: &Path, version: &str) -> Result<(), String> {
    match sys::exe_version(path) {
        Some(info)
            if info.product_name.eq_ignore_ascii_case("LANX") && version_matches(&info.version, version) =>
        {
            Ok(())
        }
        Some(info) => Err(format!(
            "The file says it is \"{} {}\", not LANX {}.",
            info.product_name, info.version, version
        )),
        None => Err("The file has no version information, so it is not a LANX installer.".to_string()),
    }
}

fn verify_open_installer(file: &File, path: &Path, r: &ReleaseInfo, cfg: &UpdateConfig) -> Result<(), String> {
    verify_release(&cfg.release_key, r)?;
    let (sha, size) = hash_reader(file).map_err(|e| format!("The installer could not be read ({}).", e))?;
    if size != r.size || sha != r.sha256 {
        return Err(format!(
            "The file is not the official LANX {} installer (its checksum differs).",
            r.version
        ));
    }
    if cfg.check_exe_version {
        check_exe_version(path, &r.version)?;
    }
    Ok(())
}

/// Size, SHA-256, release signature and (on Windows) the version inside the .exe.
pub fn verify_installer(path: &Path, r: &ReleaseInfo, cfg: &UpdateConfig) -> Result<(), String> {
    let file = File::open(path).map_err(|_| "The installer file could not be opened.".to_string())?;
    verify_open_installer(&file, path, r, cfg)
}

/// Checks the installer once more, keeping it locked against changes, and
/// asks Windows to start it. Ok(false) = dry run (checked, not started).
fn start_installer(path: &Path, r: &ReleaseInfo, cfg: &UpdateConfig) -> Result<bool, String> {
    let file = sys::open_locked(path).map_err(|_| {
        "The installer is missing or in use by another program. Press Update now again.".to_string()
    })?;
    verify_open_installer(&file, path, r, cfg)
        .map_err(|e| format!("The installer failed LANX's safety check: {}", e))?;
    if cfg.dry_run {
        return Ok(false);
    }
    sys::shell_execute(path, INSTALLER_ARGS, sys::SHOW_NORMAL)?;
    drop(file);
    Ok(true)
}

fn version_key(v: &str) -> (u32, u32, u32) {
    let mut p = v.split('.').map(|x| x.parse::<u32>().unwrap_or(0));
    (
        p.next().unwrap_or(0),
        p.next().unwrap_or(0),
        p.next().unwrap_or(0),
    )
}

/// The message that goes with the installer when it is sent as a chat file.
fn chat_text(share: &SharedInstaller) -> String {
    format!(
        "LANX {} update: open the attached installer and click Yes when Windows asks. It came through LANX, so \
         there is no blue \"Windows protected your PC\" box. After this, LANX updates arrive by themselves.",
        share.release.version
    )
}

fn can_get_updates(peer: &Peer) -> bool {
    peer.public_key.is_some() && peer.trust_state != "blocked" && !peer.id.starts_with("manual-")
}

fn same_file(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => false,
    }
}

impl NetworkService {
    pub fn update_config(&self) -> UpdateConfig {
        self.update_cfg.lock().clone()
    }

    pub fn set_update_config(&self, cfg: UpdateConfig) {
        *self.update_cfg.lock() = cfg;
    }

    pub(crate) fn updates_dir(&self) -> PathBuf {
        self.update_config()
            .dir
            .unwrap_or_else(|| self.app_data_dir().join("Updates"))
    }

    fn share_setting(&self) -> Option<SharedInstaller> {
        serde_json::from_str(&self.db.get_setting(SHARE_SETTING)?).ok()
    }

    /// The installer this PC shares, if it is still on disk.
    pub fn shared_installer(&self) -> Option<SharedInstaller> {
        let s = self.share_setting()?;
        let len = std::fs::metadata(&s.path).ok()?.len();
        (len == s.release.size).then_some(s)
    }

    // --------------------------------------------------------- sharing

    /// Starts sharing an official installer the user picked. It needs the
    /// `.sig` file that `npm run release` writes next to it.
    pub fn share_update(&self, path: &str) -> Result<SharedInstaller, String> {
        let src = PathBuf::from(path.trim());
        let name = src
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if !src.is_file() {
            return Err("That file could not be found.".to_string());
        }
        let mut sig_path = src.clone().into_os_string();
        sig_path.push(".sig");
        let raw = std::fs::read_to_string(&sig_path).map_err(|_| {
            format!(
                "\"{name}\" has no LANX release signature next to it (\"{name}.sig\"). Only installers made with \
                 npm run release can be shared: keep the .sig file in the same folder as the .exe."
            )
        })?;
        let release: ReleaseInfo = serde_json::from_str(&raw)
            .map_err(|_| format!("\"{}.sig\" is damaged.", name))?;
        let cfg = self.update_config();
        verify_installer(&src, &release, &cfg)?;
        if is_newer(&cfg.app_version, &release.version) {
            return Err(format!(
                "That is LANX {}, older than the LANX {} on this PC. Choose a newer installer.",
                release.version, cfg.app_version
            ));
        }
        self.adopt_installer(&src, release, "chosen")
    }

    /// Keeps a checked installer in the Updates folder and offers it to
    /// colleagues from now on.
    fn adopt_installer(&self, src: &Path, release: ReleaseInfo, origin: &str) -> Result<SharedInstaller, String> {
        let cfg = self.update_config();
        let dir = self.updates_dir();
        std::fs::create_dir_all(&dir).map_err(|e| format!("Could not create {} ({})", dir.display(), e))?;
        let file_name = format!("LANX-Setup-{}.exe", release.version);
        let dest = dir.join(&file_name);
        if !same_file(src, &dest) {
            let tmp = dir.join(format!("{}.copying", file_name));
            std::fs::copy(src, &tmp).map_err(|e| format!("Could not copy the installer ({})", e))?;
            std::fs::rename(&tmp, &dest).map_err(|e| format!("Could not copy the installer ({})", e))?;
            verify_installer(&dest, &release, &cfg)?;
        }
        let share = SharedInstaller {
            path: dest.to_string_lossy().to_string(),
            file_name,
            release,
            origin: origin.to_string(),
        };
        if let Some(old) = self.share_setting() {
            if old.release.version != share.release.version {
                self.withdraw_offers(&old.release.version);
            }
        }
        let json = serde_json::to_string(&share).map_err(|e| e.to_string())?;
        self.db.set_setting(SHARE_SETTING, &json).map_err(|e| e.to_string())?;
        self.events.update_changed();
        self.offer_update_to_online_peers();
        Ok(share)
    }

    pub fn stop_sharing_update(&self) -> Result<(), String> {
        if let Some(s) = self.share_setting() {
            self.withdraw_offers(&s.release.version);
        }
        self.db.set_setting(SHARE_SETTING, "").map_err(|e| e.to_string())?;
        self.events.update_changed();
        Ok(())
    }

    /// Cancels offers of `version` that colleagues have not finished.
    fn withdraw_offers(&self, version: &str) {
        for (t, r) in self.db.update_transfers("outgoing").unwrap_or_default() {
            if r.version == version && matches!(t.status.as_str(), "queued" | "pending" | "transferring") {
                let this = self.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = this.cancel_transfer(&t.id).await;
                });
            }
        }
    }

    pub fn offer_update_to_online_peers(&self) {
        if self.shared_installer().is_none() {
            return;
        }
        for p in self.db.list_peers().unwrap_or_default() {
            if p.status == "online" {
                self.maybe_offer_update(&p.id);
            }
        }
    }

    /// Records the LANX version a colleague reported in a handshake.
    pub(crate) fn note_peer_version(&self, remote: &RemotePeer) {
        if self.db.set_peer_app_version(&remote.device_id, &remote.app_version) {
            self.events.update_changed(); // version badges in Peers
            if self.share_setting().is_some() {
                self.maybe_offer_update(&remote.device_id);
            }
        }
    }

    /// Newest LANX version known on the network (this PC, colleagues,
    /// offered or shared installers).
    pub fn latest_known_version(&self) -> String {
        let mut latest = self.update_config().app_version;
        let mut bump = |v: &str| {
            if valid_version(v) && is_newer(v, &latest) {
                latest = v.to_string();
            }
        };
        for (_, v) in self.db.peers_with_versions().unwrap_or_default() {
            if let Some(v) = v {
                bump(&v);
            }
        }
        for (_, r) in self.db.update_transfers("incoming").unwrap_or_default() {
            bump(&r.version);
        }
        if let Some(s) = self.share_setting() {
            bump(&s.release.version);
        }
        latest
    }

    /// A colleague came online (or their version changed): learn their
    /// version if it may be out of date, offer them the shared installer if
    /// they are behind, and resume a background download that was waiting
    /// for them.
    pub(crate) fn maybe_offer_update(&self, peer_id: &str) {
        self.auto_download_updates(true);
        if !self.updates.lock().offering.insert(peer_id.to_string()) {
            return; // already being looked at
        }
        let this = self.clone();
        let peer_id = peer_id.to_string();
        tauri::async_runtime::spawn(async move {
            this.check_colleague(&peer_id).await;
            this.updates.lock().offering.remove(&peer_id);
        });
    }

    async fn check_colleague(&self, peer_id: &str) {
        let Ok(Some(peer)) = self.db.get_peer(peer_id) else {
            return;
        };
        if !can_get_updates(&peer) {
            return;
        }
        let share = self.shared_installer();
        let latest = self.latest_known_version();
        let mut version = self.db.peer_app_version(peer_id);
        // Unknown, or behind (they may have updated since): ask again.
        if version.as_ref().is_none_or(|v| is_newer(&latest, v)) {
            let due = {
                let mut u = self.updates.lock();
                let due = u.probes.get(peer_id).is_none_or(|t| t.elapsed() >= PROBE_EVERY);
                if due {
                    u.probes.insert(peer_id.to_string(), Instant::now());
                }
                due
            };
            if due && peer.status == "online" {
                // Any handshake tells us their version (connect_peer records it).
                if let Ok(chan) = self.connect_peer(&peer).await {
                    chan.close().await;
                }
                version = self.db.peer_app_version(peer_id);
            }
        }
        let (Some(share), Some(v)) = (share, version) else {
            return;
        };
        if !is_newer(&share.release.version, &v) {
            return;
        }
        if !version_at_least(&v, FEATURES_V12) {
            self.events.update_changed(); // listed under "send as a chat file"
            self.auto_send_chat_installer(&peer, &share).await;
            return;
        }
        if self.db.update_offered(peer_id, &share.release.version) {
            return;
        }
        let t = TransferRecord {
            id: uuid::Uuid::new_v4().to_string(),
            peer_id: peer.id.clone(),
            peer_name: Some(peer.display_name.clone()),
            conversation_id: None,
            file_name: share.file_name.clone(),
            file_size: share.release.size as i64,
            file_hash: share.release.sha256.clone(),
            direction: "outgoing".to_string(),
            status: "queued".to_string(),
            transferred_bytes: 0,
            local_path: Some(share.path.clone()),
            error_reason: None,
            created_at: now_secs(),
            completed_at: None,
            parent_id: None,
            temp_path: None,
            kind: "update".to_string(),
        };
        if self.db.insert_transfer(&t).is_ok() && self.db.insert_update_offer(&t.id, &share.release).is_ok() {
            self.events.update_changed();
            self.kick_outbox(&peer.id, true);
        }
    }

    /// Sends one queued update offer (outbox). Returns false if the
    /// connection broke (the offer stays queued).
    pub(super) async fn deliver_update_offer(&self, chan: &mut SecureChannel, mut t: TransferRecord) -> bool {
        let remote = chan.remote.app_version.clone();
        let name = t.peer_name.clone().unwrap_or_else(|| "They".to_string());
        let release = self.db.get_update_offer(&t.id);
        let on_disk = t
            .local_path
            .as_ref()
            .and_then(|p| std::fs::metadata(p).ok())
            .map(|m| m.len());
        let problem = match &release {
            None => Some("The update details are missing.".to_string()),
            Some(_) if !version_at_least(&remote, FEATURES_V12) => Some(format!(
                "{} has LANX {}, which cannot receive updates yet: send the installer as a chat file.",
                name, remote
            )),
            Some(r) if !is_newer(&r.version, &remote) => Some(format!("{} already has LANX {}.", name, remote)),
            Some(r) if on_disk != Some(r.size) => Some("The installer is no longer on this PC.".to_string()),
            _ => None,
        };
        let (None, Some(r)) = (problem.clone(), release) else {
            t.status = "cancelled".to_string();
            t.error_reason = problem;
            t.completed_at = Some(now_secs());
            self.save_and_emit(&t);
            return true;
        };
        let offer = PacketPayload::UpdateOffer(UpdateOfferPayload {
            transfer_id: t.id.clone(),
            version: r.version,
            file_size: r.size,
            sha256: r.sha256,
            signature: r.signature,
        });
        let sent = match chan.send(offer, None).await {
            Ok(p) => p,
            Err(_) => return false,
        };
        let reply = match chan.recv_packet_timeout(ACK_TIMEOUT).await {
            Ok(r) if r.correlation_id.as_deref() == Some(sent.packet_id.as_str()) => r,
            _ => return false,
        };
        if let Ok(Some(current)) = self.db.get_transfer(&t.id) {
            if current.status != "queued" {
                // Withdrawn while the offer was on its way: take it back.
                let accepted = matches!(&reply.payload, PacketPayload::FileOfferAck(a) if a.accepted);
                if current.status == "cancelled" && accepted {
                    let cancel = PacketPayload::FileCancel(FileCancelPayload {
                        transfer_id: t.id.clone(),
                        reason: Some("The update is no longer shared.".to_string()),
                    });
                    if chan.send(cancel, None).await.is_err() {
                        return false;
                    }
                }
                return true;
            }
        }
        match reply.payload {
            PacketPayload::FileOfferAck(a) if a.accepted => {
                t.status = "pending".to_string();
                t.error_reason = None;
            }
            PacketPayload::FileOfferAck(a) => {
                t.status = "declined".to_string();
                t.error_reason = a.reason;
                t.completed_at = Some(now_secs());
            }
            PacketPayload::Error(e) => {
                t.status = "failed".to_string();
                t.error_reason = Some(e.message);
            }
            _ => return false,
        }
        self.save_and_emit(&t);
        true
    }

    /// Sends the shared installer as an ordinary chat file, for colleagues
    /// whose LANX is older than 1.2 (they open it from the chat).
    pub async fn send_update_as_file(
        &self,
        peer_ids: &[String],
    ) -> Result<super::extras::BroadcastResult, String> {
        let share = self
            .shared_installer()
            .ok_or("Choose the installer to share first (Settings → Updates).")?;
        let result = self.broadcast(peer_ids, Some(chat_text(&share)), vec![share.path.clone()]).await?;
        for id in peer_ids {
            self.mark_chat_sent(id, &share.release.version);
        }
        self.events.update_changed();
        Ok(result)
    }

    pub fn auto_chat_enabled(&self) -> bool {
        self.db.get_setting(AUTO_CHAT_SETTING).is_none_or(|v| v != "false")
    }

    pub fn set_update_auto_chat(&self, enabled: bool) -> Result<(), String> {
        self.db
            .set_setting(AUTO_CHAT_SETTING, if enabled { "true" } else { "false" })
            .map_err(|e| e.to_string())?;
        if enabled {
            self.offer_update_to_online_peers();
        }
        self.events.update_changed();
        Ok(())
    }

    fn chat_sent(&self) -> HashMap<String, String> {
        self.db
            .get_setting(CHAT_SENT_SETTING)
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default()
    }

    fn mark_chat_sent(&self, peer_id: &str, version: &str) {
        let mut sent = self.chat_sent();
        sent.insert(peer_id.to_string(), version.to_string());
        if let Ok(json) = serde_json::to_string(&sent) {
            let _ = self.db.set_setting(CHAT_SENT_SETTING, &json);
        }
    }

    /// A colleague on LANX 1.1 or older cannot show "Update now": send them
    /// the installer once as an ordinary chat file. Only the PC whose user
    /// chose the installer does this (not every PC it was passed on to).
    async fn auto_send_chat_installer(&self, peer: &Peer, share: &SharedInstaller) {
        if share.origin != "chosen" || !self.auto_chat_enabled() {
            return;
        }
        if self.chat_sent().get(&peer.id) == Some(&share.release.version) {
            return;
        }
        self.mark_chat_sent(&peer.id, &share.release.version);
        let _ = self
            .broadcast(&[peer.id.clone()], Some(chat_text(share)), vec![share.path.clone()])
            .await;
        self.events.update_changed();
    }

    // -------------------------------------------------------- receiving

    /// A colleague offers a LANX installer.
    pub(super) fn handle_update_offer(&self, peer: &Peer, o: UpdateOfferPayload) -> FileOfferAckPayload {
        let ack = |accepted: bool, reason: Option<String>| FileOfferAckPayload {
            transfer_id: o.transfer_id.clone(),
            accepted,
            reason,
        };
        if !can_get_updates(peer) {
            return ack(false, Some("Updates are only accepted from known colleagues.".to_string()));
        }
        if uuid::Uuid::parse_str(&o.transfer_id).is_err() {
            return ack(false, Some("Invalid transfer id".to_string()));
        }
        if let Ok(Some(existing)) = self.db.get_transfer(&o.transfer_id) {
            if existing.peer_id != peer.id || existing.direction != "incoming" || existing.kind != "update" {
                return ack(false, Some("Duplicate transfer id".to_string()));
            }
            return ack(true, None);
        }
        let cfg = self.update_config();
        let release = ReleaseInfo {
            version: o.version.clone(),
            sha256: o.sha256.to_ascii_lowercase(),
            size: o.file_size,
            signature: o.signature.clone(),
        };
        if let Err(e) = verify_release(&cfg.release_key, &release) {
            return ack(false, Some(e));
        }
        if !is_newer(&release.version, &cfg.app_version) {
            return ack(
                false,
                Some(format!("This computer already has LANX {}.", cfg.app_version)),
            );
        }
        let first_for_version = !self.db.update_transfers("incoming").unwrap_or_default().iter().any(|(t, r)| {
            r.version == release.version && !matches!(t.status.as_str(), "cancelled" | "declined")
        });
        let t = TransferRecord {
            id: o.transfer_id.clone(),
            peer_id: peer.id.clone(),
            peer_name: Some(peer.display_name.clone()),
            conversation_id: None,
            file_name: format!("LANX-Setup-{}.exe", release.version),
            file_size: release.size as i64,
            file_hash: String::new(),
            direction: "incoming".to_string(),
            status: "pending".to_string(),
            transferred_bytes: 0,
            local_path: None,
            error_reason: None,
            created_at: now_secs(),
            completed_at: None,
            parent_id: None,
            temp_path: None,
            kind: "update".to_string(),
        };
        if self.db.insert_transfer(&t).is_err() || self.db.insert_update_offer(&t.id, &release).is_err() {
            return ack(false, Some("Recipient database error".to_string()));
        }
        self.events.update_changed();
        if first_for_version {
            let from = if self.privacy.is_locked() {
                "a colleague".to_string()
            } else {
                peer.display_name.clone()
            };
            self.events.notify(
                &self.db,
                crate::events::AlertKind::File,
                &format!("LANX {} is available", release.version),
                &format!("From {}. Open LANX and click Update LANX now.", from),
            );
            let _ = self.db.set_setting(REMINDED_SETTING, &now_secs().to_string());
        }
        self.auto_download_updates(false);
        ack(true, None)
    }

    /// Fetches the newest offered update in the background (from one online
    /// colleague at a time) and checks it, so "Update LANX now" installs at
    /// once. Nothing is started without the click. Broken downloads are only
    /// retried when `retry_failed` (a colleague just came online), so a
    /// colleague who stopped sharing is not asked again and again.
    pub(crate) fn auto_download_updates(&self, retry_failed: bool) {
        let cfg = self.update_config();
        let incoming = self.db.update_transfers("incoming").unwrap_or_default();
        let Some(newest) = incoming
            .iter()
            .map(|(_, r)| r.version.clone())
            .filter(|v| is_newer(v, &cfg.app_version))
            .max_by_key(|v| version_key(v))
        else {
            return;
        };
        let sources: Vec<&TransferRecord> = incoming
            .iter()
            .filter(|(_, r)| r.version == newest)
            .map(|(t, _)| t)
            .collect();
        let have_it = sources.iter().any(|t| {
            t.status == "transferring"
                || (t.status == "completed" && t.local_path.as_ref().is_some_and(|p| Path::new(p).is_file()))
        });
        if have_it {
            return;
        }
        let online: HashSet<String> = self
            .db
            .list_peers()
            .unwrap_or_default()
            .into_iter()
            .filter(|p| p.status == "online")
            .map(|p| p.id)
            .collect();
        // A file that failed the safety check is only tried again on request.
        let Some(t) = sources.into_iter().find(|t| {
            online.contains(&t.peer_id)
                && (t.status == "pending"
                    || (retry_failed
                        && t.status == "failed"
                        && !t.error_reason.as_deref().unwrap_or_default().contains("safety check")))
        }) else {
            return;
        };
        {
            let mut u = self.updates.lock();
            if u.auto_download.is_some() {
                return;
            }
            u.auto_download = Some(newest);
        }
        let this = self.clone();
        let id = t.id.clone();
        tauri::async_runtime::spawn(async move {
            if this.accept_transfer(&id).await.is_err() {
                this.updates.lock().auto_download = None;
            }
        });
    }

    /// Called when an update finished downloading (before the sender is told
    /// it arrived): it must pass every check, otherwise it is thrown away.
    pub(super) fn check_downloaded_update(&self, t: &TransferRecord, path: &Path) -> Result<(), String> {
        let release = self
            .db
            .get_update_offer(&t.id)
            .ok_or("The update details are missing.")?;
        verify_installer(path, &release, &self.update_config())
            .map_err(|e| format!("This update failed LANX's safety check and was deleted: {}", e))
    }

    /// An update finished downloading and passed the checks.
    pub(super) fn update_downloaded(&self, t: &TransferRecord) {
        self.events.update_changed();
        let install = {
            let mut u = self.updates.lock();
            u.auto_download = None;
            u.install_after_download.remove(&t.id)
        };
        if install {
            let this = self.clone();
            let id = t.id.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = this.launch_update(Some(id)).await {
                    this.report_install_problem(&e);
                }
            });
        }
    }

    pub(super) fn update_download_failed(&self, t: &TransferRecord) {
        {
            let mut u = self.updates.lock();
            u.install_after_download.remove(&t.id);
            u.auto_download = None;
        }
        self.events.update_changed();
        // Another colleague may have the same update.
        self.auto_download_updates(false);
    }

    // -------------------------------------------------------- reminders

    /// "Remind me tomorrow": hides the banner for a day.
    pub fn snooze_update(&self) -> Result<i64, String> {
        let until = now_secs() + SNOOZE_SECS;
        self.db
            .set_setting(SNOOZE_SETTING, &until.to_string())
            .map_err(|e| e.to_string())?;
        self.events.update_changed();
        Ok(until)
    }

    fn setting_secs(&self, key: &str) -> i64 {
        self.db
            .get_setting(key)
            .and_then(|v| v.parse().ok())
            .unwrap_or(0)
    }

    /// Called every few minutes: once a day (and never while snoozed) a
    /// notification reminds the user that a newer LANX is waiting.
    /// Returns true if it reminded.
    pub fn remind_about_update(&self) -> bool {
        let now = now_secs();
        if self.setting_secs(SNOOZE_SETTING) > now || now - self.setting_secs(REMINDED_SETTING) < REMIND_EVERY_SECS {
            return false;
        }
        let Some(a) = self.update_status().available else {
            return false;
        };
        if a.state == "installing" {
            return false;
        }
        let _ = self.db.set_setting(REMINDED_SETTING, &now.to_string());
        self.events.notify(
            &self.db,
            crate::events::AlertKind::File,
            &format!("LANX {} is waiting to be installed", a.version),
            "Open LANX and click Update LANX now. It takes a few seconds and keeps your chats.",
        );
        self.events.update_changed();
        true
    }

    fn report_install_problem(&self, reason: &str) {
        #[derive(Serialize, Clone)]
        struct Problem<'a> {
            message: &'a str,
        }
        self.events.emit_json("lanx://update-problem", Problem { message: reason });
    }

    // ------------------------------------------------------- installing

    /// "Update now": installs the best available update — at once if it is
    /// downloaded, otherwise as soon as it has been downloaded and checked.
    /// Returns "downloading", "installing" or "dry_run".
    pub async fn install_update(&self) -> Result<String, String> {
        let a = self
            .update_status()
            .available
            .ok_or("There is no newer LANX to install.")?;
        match a.state.as_str() {
            "ready" => self.launch_update(a.transfer_id).await,
            "installing" => Ok("installing".to_string()),
            "downloading" => {
                if let Some(id) = a.transfer_id {
                    self.updates.lock().install_after_download.insert(id);
                }
                Ok("downloading".to_string())
            }
            _ => {
                let id = a.transfer_id.ok_or("There is no newer LANX to install.")?;
                self.updates.lock().install_after_download.insert(id.clone());
                match self.accept_transfer(&id).await {
                    Ok(_) => Ok("downloading".to_string()),
                    Err(e) => {
                        self.updates.lock().install_after_download.remove(&id);
                        Err(e)
                    }
                }
            }
        }
    }

    /// Starts a downloaded installer (or the one this PC shares, if newer).
    async fn launch_update(&self, transfer_id: Option<String>) -> Result<String, String> {
        let (path, release) = match &transfer_id {
            Some(id) => {
                let t = self
                    .db
                    .get_transfer(id)
                    .map_err(|e| e.to_string())?
                    .filter(|t| t.status == "completed")
                    .ok_or("The update has not been downloaded yet.")?;
                let release = self.db.get_update_offer(id).ok_or("The update details are missing.")?;
                (PathBuf::from(t.local_path.unwrap_or_default()), release)
            }
            None => {
                let s = self.shared_installer().ok_or("The installer is no longer on this PC.")?;
                (PathBuf::from(s.path), s.release)
            }
        };
        let cfg = self.update_config();
        let version = release.version.clone();
        let (p, r, c) = (path.clone(), release, cfg.clone());
        let started = tauri::async_runtime::spawn_blocking(move || start_installer(&p, &r, &c))
            .await
            .map_err(|e| e.to_string())?;
        let started = match started {
            Ok(s) => s,
            Err(e) => {
                // A file that no longer passes the checks is not kept.
                if e.contains("safety check") {
                    if let Some(id) = &transfer_id {
                        if let Ok(Some(mut t)) = self.db.get_transfer(id) {
                            let _ = std::fs::remove_file(&path);
                            t.status = "failed".to_string();
                            t.error_reason = Some(e.clone());
                            t.local_path = None;
                            t.transferred_bytes = 0;
                            self.save_and_emit(&t);
                        }
                    }
                }
                return Err(e);
            }
        };
        if !started {
            let line = format!("\"{}\" {}", path.display(), INSTALLER_ARGS);
            let _ = std::fs::write(self.updates_dir().join("install-dry-run.txt"), format!("{}\n", line));
            self.updates.lock().dry_runs.push(line);
            self.events.update_changed();
            return Ok("dry_run".to_string());
        }
        self.updates.lock().installing = Some(version);
        self.events.update_changed();
        // The installer replaces LANX: quit cleanly (it starts LANX again).
        if let Some(app) = self.events.app().cloned() {
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_millis(1500)).await;
                crate::quit_app(&app);
            });
        }
        Ok("installing".to_string())
    }

    // ------------------------------------------------------------ status

    pub fn update_status(&self) -> UpdateStatus {
        let cfg = self.update_config();
        let installing = self.updates.lock().installing.clone();
        let peers: HashMap<String, Peer> = self
            .db
            .list_peers()
            .unwrap_or_default()
            .into_iter()
            .map(|p| (p.id.clone(), p))
            .collect();
        let share = self.shared_installer();

        // The newest update for this PC, from the most useful source.
        let mut best: Option<((u32, u32, u32), u8, AvailableUpdate)> = None;
        let mut consider = |rank: u8, a: AvailableUpdate| {
            let key = version_key(&a.version);
            if best.as_ref().is_none_or(|(k, r, _)| (key, rank) > (*k, *r)) {
                best = Some((key, rank, a));
            }
        };
        for (t, r) in self.db.update_transfers("incoming").unwrap_or_default() {
            if !is_newer(&r.version, &cfg.app_version) {
                continue;
            }
            let online = peers.get(&t.peer_id).is_some_and(|p| p.status == "online");
            let (state, rank) = match t.status.as_str() {
                "completed" if t.local_path.as_ref().is_some_and(|p| Path::new(p).is_file()) => ("ready", 4),
                "transferring" => ("downloading", 3),
                "pending" => ("available", if online { 2 } else { 1 }),
                "failed" => ("failed", if online { 1 } else { 0 }),
                _ => continue,
            };
            consider(
                rank,
                AvailableUpdate {
                    version: r.version.clone(),
                    state: state.to_string(),
                    from_name: t.peer_name.clone().unwrap_or_else(|| "a colleague".to_string()),
                    from_online: online,
                    file_size: r.size,
                    transfer_id: Some(t.id.clone()),
                    transferred_bytes: t.transferred_bytes.max(0) as u64,
                    error: t.error_reason.clone(),
                },
            );
        }
        if let Some(s) = &share {
            if is_newer(&s.release.version, &cfg.app_version) {
                consider(
                    5,
                    AvailableUpdate {
                        version: s.release.version.clone(),
                        state: "ready".to_string(),
                        from_name: String::new(),
                        from_online: true,
                        file_size: s.release.size,
                        transfer_id: None,
                        transferred_bytes: s.release.size,
                        error: None,
                    },
                );
            }
        }
        let mut available = best.map(|(_, _, a)| a);
        if let (Some(a), Some(v)) = (available.as_mut(), installing.as_ref()) {
            if &a.version == v {
                a.state = "installing".to_string();
            }
        }

        // Every colleague's version; while sharing, also how far their
        // update has got.
        let latest = self.latest_known_version();
        let outgoing = if share.is_some() {
            self.db.update_transfers("outgoing").unwrap_or_default()
        } else {
            Vec::new()
        };
        let chat_sent = self.chat_sent();
        let mut colleagues = Vec::new();
        for (p, v) in self.db.peers_with_versions().unwrap_or_default() {
            if p.id.starts_with("manual-") || p.trust_state == "blocked" {
                continue;
            }
            let behind = v.as_ref().is_some_and(|v| is_newer(&latest, v));
            let (mut state, mut detail) = match &v {
                None => ("unknown", None),
                Some(_) if behind => ("behind", None),
                Some(_) => ("up_to_date", None),
            };
            if let (Some(s), Some(v)) = (&share, &v) {
                let sv = &s.release.version;
                let offer = outgoing
                    .iter()
                    .find(|(t, r)| t.peer_id == p.id && &r.version == sv && t.status != "cancelled");
                if is_newer(sv, v) {
                    (state, detail) = if !version_at_least(v, FEATURES_V12) {
                        if chat_sent.get(&p.id) == Some(sv) {
                            ("chat_sent", None)
                        } else {
                            ("old_version", None)
                        }
                    } else {
                        match offer {
                            Some((t, _)) => match t.status.as_str() {
                                "queued" => ("waiting", t.error_reason.clone()),
                                "pending" => ("offered", None),
                                "transferring" => ("downloading", None),
                                "completed" => ("received", None),
                                "declined" => ("declined", t.error_reason.clone()),
                                _ => ("failed", t.error_reason.clone()),
                            },
                            None => ("not_offered", None),
                        }
                    };
                }
            }
            colleagues.push(ColleagueUpdate {
                peer_id: p.id.clone(),
                display_name: p.display_name.clone(),
                online: p.status == "online",
                app_version: v.clone(),
                behind,
                state: state.to_string(),
                detail,
            });
        }
        let snoozed = self.setting_secs(SNOOZE_SETTING);

        UpdateStatus {
            current_version: cfg.app_version,
            latest_version: latest,
            available,
            sharing: share,
            colleagues,
            snoozed_until: (snoozed > now_secs()).then_some(snoozed),
            auto_chat: self.auto_chat_enabled(),
        }
    }

    // ------------------------------------------------------ housekeeping

    /// At start-up: an installer of the version now running is kept and
    /// passed on to colleagues (that is how updates spread from PC to PC);
    /// older offers and their files are removed.
    pub fn update_housekeeping(&self) {
        self.cleanup_and_adopt_received();
        self.adopt_installed_copy();
    }

    /// The installer leaves a copy of itself in `<LANX folder>\updates`, with
    /// its .sig if it had one next to it (the PC it was installed from a
    /// release folder). Such a PC starts sharing that version by itself.
    fn adopt_installed_copy(&self) {
        let cfg = self.update_config();
        let Some(dir) = cfg.install_dir.clone() else {
            return;
        };
        if self
            .shared_installer()
            .is_some_and(|s| !is_newer(&cfg.app_version, &s.release.version))
        {
            return; // already sharing this version (or a newer one)
        }
        let exe = dir.join(format!("LANX-Setup-{}.exe", cfg.app_version));
        let mut sig = exe.clone().into_os_string();
        sig.push(".sig");
        let Some(release) = std::fs::read_to_string(&sig)
            .ok()
            .and_then(|raw| serde_json::from_str::<ReleaseInfo>(&raw).ok())
        else {
            return;
        };
        if release.version == cfg.app_version && verify_installer(&exe, &release, &cfg).is_ok() {
            let _ = self.adopt_installer(&exe, release, "chosen");
        }
    }

    fn cleanup_and_adopt_received(&self) {
        let cfg = self.update_config();
        let updates_dir = std::fs::canonicalize(self.updates_dir()).ok();
        let in_updates_dir = |p: &Path| {
            updates_dir.as_ref().is_some_and(|d| {
                std::fs::canonicalize(p).is_ok_and(|c| c.starts_with(d))
            })
        };
        for (mut t, r) in self.db.update_transfers("incoming").unwrap_or_default() {
            if is_newer(&r.version, &cfg.app_version) {
                continue; // still to be installed
            }
            let path = t.local_path.clone().map(PathBuf::from);
            if t.status == "completed" && r.version == cfg.app_version {
                if let Some(p) = &path {
                    let better = self
                        .share_setting()
                        .is_none_or(|s| is_newer(&r.version, &s.release.version) || !Path::new(&s.path).is_file());
                    if better
                        && verify_installer(p, &r, &cfg).is_ok()
                        && self.adopt_installer(p, r.clone(), "passed_on").is_ok()
                    {
                        continue;
                    }
                }
            }
            if !matches!(t.status.as_str(), "pending" | "failed" | "completed") {
                continue;
            }
            let shared = self.share_setting().map(|s| PathBuf::from(s.path));
            for p in [path, t.temp_path.clone().map(PathBuf::from)].into_iter().flatten() {
                if in_updates_dir(&p) && shared.as_ref().is_none_or(|s| !same_file(s, &p)) {
                    let _ = std::fs::remove_file(&p);
                }
            }
            t.status = "cancelled".to_string();
            t.error_reason = Some(format!("This PC already has LANX {}.", cfg.app_version));
            t.temp_path = None;
            t.completed_at = Some(now_secs());
            let _ = self.db.save_transfer(&t);
        }
    }
}

// ------------------------------------------------------------ Windows

#[cfg(windows)]
mod sys {
    use std::ffi::OsStr;
    use std::fs::File;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::fs::OpenOptionsExt;
    use std::path::Path;

    pub const SHOW_NORMAL: i32 = windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    #[cfg(test)]
    pub const SHOW_HIDDEN: i32 = windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;

    pub struct ExeVersion {
        pub product_name: String,
        /// Fixed product version, "a.b.c.d".
        pub version: String,
    }

    fn wide(s: &OsStr) -> Vec<u16> {
        s.encode_wide().chain(Some(0)).collect()
    }

    /// Reads the version resource of an .exe (what Explorer shows under
    /// Properties → Details).
    pub fn exe_version(path: &Path) -> Option<ExeVersion> {
        use windows_sys::Win32::Storage::FileSystem::{
            GetFileVersionInfoSizeW, GetFileVersionInfoW, VS_FIXEDFILEINFO, VerQueryValueW,
        };
        let file = wide(path.as_os_str());
        let mut handle = 0u32;
        // SAFETY: plain Win32 calls on a NUL-terminated path and a buffer of
        // the size Windows asked for; VerQueryValueW returns pointers into it.
        unsafe {
            let size = GetFileVersionInfoSizeW(file.as_ptr(), &mut handle);
            if size == 0 {
                return None;
            }
            let mut buf = vec![0u8; size as usize];
            if GetFileVersionInfoW(file.as_ptr(), 0, size, buf.as_mut_ptr().cast()) == 0 {
                return None;
            }
            let query = |sub: &str| -> Option<(*const u8, u32)> {
                let sub = wide(OsStr::new(sub));
                let mut ptr = std::ptr::null_mut();
                let mut len = 0u32;
                if VerQueryValueW(buf.as_ptr().cast(), sub.as_ptr(), &mut ptr, &mut len) == 0 || ptr.is_null() {
                    None
                } else {
                    Some((ptr as *const u8, len))
                }
            };
            let (fixed, len) = query("\\")?;
            if (len as usize) < std::mem::size_of::<VS_FIXEDFILEINFO>() {
                return None;
            }
            let fixed = std::ptr::read_unaligned(fixed as *const VS_FIXEDFILEINFO);
            if fixed.dwSignature != 0xFEEF_04BD {
                return None;
            }
            let version = format!(
                "{}.{}.{}.{}",
                fixed.dwProductVersionMS >> 16,
                fixed.dwProductVersionMS & 0xFFFF,
                fixed.dwProductVersionLS >> 16,
                fixed.dwProductVersionLS & 0xFFFF
            );
            let mut langs: Vec<String> = Vec::new();
            if let Some((p, len)) = query("\\VarFileInfo\\Translation") {
                let words = std::slice::from_raw_parts(p as *const u16, (len / 2) as usize);
                for pair in words.chunks_exact(2) {
                    langs.push(format!("{:04x}{:04x}", pair[0], pair[1]));
                }
            }
            langs.extend(["040904b0", "040904e4", "000004b0"].map(String::from));
            let product_name = langs
                .iter()
                .find_map(|l| {
                    let (p, len) = query(&format!("\\StringFileInfo\\{}\\ProductName", l))?;
                    let chars = std::slice::from_raw_parts(p as *const u16, len as usize);
                    Some(String::from_utf16_lossy(chars).trim_end_matches('\0').trim().to_string())
                })
                .unwrap_or_default();
            Some(ExeVersion { product_name, version })
        }
    }

    /// Opens a file so that nobody can change or replace it while it is open.
    pub fn open_locked(path: &Path) -> std::io::Result<File> {
        const FILE_SHARE_READ: u32 = 1;
        std::fs::OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ)
            .open(path)
    }

    /// Asks Windows to start a program the way Explorer would (an installer
    /// that needs administrator rights gets the UAC question). Returns once
    /// the user has answered it.
    pub fn shell_execute(path: &Path, args: &str, show: i32) -> Result<(), String> {
        let file = wide(path.as_os_str());
        let params = wide(OsStr::new(args));
        let dir = wide(path.parent().map(|p| p.as_os_str()).unwrap_or_default());
        // COM wants its own apartment, so run on a fresh thread.
        let outcome = std::thread::spawn(move || {
            use windows_sys::Win32::Foundation::{CloseHandle, GetLastError};
            use windows_sys::Win32::System::Com::{
                COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE, CoInitializeEx, CoUninitialize,
            };
            use windows_sys::Win32::UI::Shell::{
                SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW, ShellExecuteExW,
            };
            let verb = wide(OsStr::new("open"));
            // SAFETY: every pointer refers to a NUL-terminated buffer that
            // lives until the call returns; the process handle is closed.
            unsafe {
                let com = CoInitializeEx(std::ptr::null(), (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32);
                let mut info: SHELLEXECUTEINFOW = std::mem::zeroed();
                info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
                info.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI;
                info.lpVerb = verb.as_ptr();
                info.lpFile = file.as_ptr();
                info.lpParameters = params.as_ptr();
                info.lpDirectory = dir.as_ptr();
                info.nShow = show;
                let ok = ShellExecuteExW(&mut info);
                let error = GetLastError();
                if !info.hProcess.is_null() {
                    CloseHandle(info.hProcess);
                }
                if com >= 0 {
                    CoUninitialize();
                }
                if ok != 0 { Ok(()) } else { Err(error) }
            }
        })
        .join()
        .map_err(|_| "Windows could not start the installer.".to_string())?;
        outcome.map_err(|code| match code {
            1223 => "You answered No to the Windows question, so nothing was changed. Press Update now when you are ready."
                .to_string(),
            2 | 3 => "The installer file is missing. Press Update now again.".to_string(),
            c => format!("Windows could not start the installer (error {}).", c),
        })
    }
}

#[cfg(not(windows))]
mod sys {
    use std::fs::File;
    use std::path::Path;

    pub const SHOW_NORMAL: i32 = 1;

    pub struct ExeVersion {
        pub product_name: String,
        pub version: String,
    }

    pub fn exe_version(_path: &Path) -> Option<ExeVersion> {
        None
    }

    pub fn open_locked(path: &Path) -> std::io::Result<File> {
        File::open(path)
    }

    pub fn shell_execute(_path: &Path, _args: &str, _show: i32) -> Result<(), String> {
        Err("Installing updates is only available on Windows.".to_string())
    }
}

#[cfg(all(test, windows))]
pub(crate) mod win_tests {
    use super::*;

    #[test]
    fn reads_windows_version_info() {
        let notepad = Path::new(r"C:\Windows\System32\notepad.exe");
        let info = sys::exe_version(notepad).expect("notepad has version info");
        assert!(info.product_name.contains("Windows"), "got {}", info.product_name);
        assert!(info.version.starts_with("10.") || info.version.starts_with("11."), "got {}", info.version);
        assert!(check_exe_version(notepad, "1.2.0").is_err());

        // A real LANX installer from an earlier release, if this PC has one.
        let release = Path::new(env!("CARGO_MANIFEST_DIR")).join("../release/LANX-Setup-1.1.0.exe");
        if release.is_file() {
            check_exe_version(&release, "1.1.0").expect("LANX 1.1.0 installer");
            assert!(check_exe_version(&release, "1.2.0").is_err());
        }
        assert!(sys::exe_version(Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml").as_path()).is_none());
    }

    #[test]
    fn locked_file_can_still_be_started_by_windows() {
        // ShellExecuteEx works while LANX holds the read-only lock (the same
        // calls "Update now" makes, with a harmless program, hidden).
        let dir = tempfile::tempdir().unwrap();
        let exe = dir.path().join("lanx-launch-test.exe");
        std::fs::copy(r"C:\Windows\System32\whoami.exe", &exe).unwrap();
        let lock = sys::open_locked(&exe).unwrap();
        assert!(std::fs::OpenOptions::new().write(true).open(&exe).is_err(), "writers are kept out");
        sys::shell_execute(&exe, "/?", sys::SHOW_HIDDEN).expect("Windows starts the locked file");
        drop(lock);
        assert!(sys::shell_execute(&dir.path().join("missing.exe"), "", sys::SHOW_HIDDEN).is_err());
    }
}
