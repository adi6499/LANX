//! LANX 1.9.0 admin: one computer can become the office's "LANX admin" and
//! send office-wide settings — company apps, message clean-up and network
//! backups. There is no server: the settings travel to each colleague over
//! the normal encrypted connection, and a colleague's LANX only uses them
//! after the user says yes (and can leave again any time). Later changes are
//! only taken from that same admin computer.

use super::protocol::*;
use super::{NetworkService, now_secs};
use crate::storage::admin::PolicyPeer;
use crate::storage::models::*;
use serde::Serialize;
use serde_json::json;
use std::time::Duration;

/// How often the admin computer checks who still needs the latest settings.
pub const POLICY_EVERY_SECS: u64 = 30;

#[derive(Debug, Clone, Serialize)]
pub struct AdminState {
    /// This computer is the admin: the settings it sends.
    pub my_policy: Option<OfficePolicy>,
    /// The admin settings this computer follows.
    pub policy: Option<OfficePolicy>,
    /// An admin asks to manage this computer (waiting for yes / no).
    pub offer: Option<OfficePolicy>,
    /// The admin's view of every colleague.
    pub peers: Vec<PolicyPeer>,
    pub retention_days: i64,
    pub apps: Vec<AppView>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppView {
    #[serde(flatten)]
    pub app: AppLink,
    /// From the admin (can't be removed here).
    pub office: bool,
}

impl NetworkService {
    pub fn admin_state(&self) -> AdminState {
        AdminState {
            my_policy: self.db.my_policy(),
            policy: self.db.applied_policy(),
            offer: self.db.policy_offer(),
            peers: if self.db.my_policy().is_some() { self.db.policy_peers().unwrap_or_default() } else { Vec::new() },
            retention_days: self.db.effective_retention_days(),
            apps: self.db.effective_apps().into_iter().map(|(app, office)| AppView { app, office }).collect(),
        }
    }

    fn emit_admin(&self) {
        self.events.emit_json("lanx://admin-changed", json!({}));
    }

    /// Makes this computer the LANX admin (starting from its own settings).
    pub fn become_admin(&self) -> Result<AdminState, String> {
        if let Some(p) = self.db.applied_policy() {
            return Err(format!("This computer follows {}'s office settings. Leave them first (Admin → Office settings).", p.admin_name));
        }
        let s = self.db.get_settings().map_err(|e| e.to_string())?;
        let p = OfficePolicy {
            version: 1,
            admin_id: self.identity.device_id.clone(),
            admin_name: s.display_name.clone(),
            active: true,
            apps: s.apps.clone(),
            retention_days: 0,
            backup_dir: String::new(),
            backup_password: String::new(),
            at: now_secs(),
        };
        self.db.clear_policy_peers().map_err(|e| e.to_string())?;
        self.db.set_my_policy(Some(&p)).map_err(|e| e.to_string())?;
        self.kick_policy();
        self.emit_admin();
        Ok(self.admin_state())
    }

    /// The admin changes the office settings (everyone gets the new version).
    pub fn save_policy(&self, p: &OfficePolicy) -> Result<AdminState, String> {
        let old = self.db.my_policy().ok_or("This computer isn't the LANX admin.")?;
        let s = self.db.get_settings().map_err(|e| e.to_string())?;
        let mut p = p.cleaned();
        if !p.backup_dir.is_empty() && !p.backup_password.is_empty() {
            crate::backup::validate_password(&p.backup_password)?;
        }
        if !p.backup_dir.is_empty() && p.backup_password.is_empty() {
            return Err("Choose a password for the backup copies (needed to restore them).".to_string());
        }
        p.version = old.version + 1;
        p.admin_id = self.identity.device_id.clone();
        p.admin_name = s.display_name;
        p.active = true;
        p.at = now_secs();
        self.db.set_my_policy(Some(&p)).map_err(|e| e.to_string())?;
        self.kick_policy();
        self.emit_admin();
        Ok(self.admin_state())
    }

    /// The admin stops managing the office (colleagues go back to their own settings).
    pub async fn stop_admin(&self) -> Result<AdminState, String> {
        let old = self.db.my_policy().ok_or("This computer isn't the LANX admin.")?;
        let stop = OfficePolicy { version: old.version + 1, active: false, at: now_secs(), ..old };
        for pp in self.db.policy_peers().unwrap_or_default().into_iter().filter(|p| p.status == "accepted" || p.status == "waiting") {
            if let Ok(Some(peer)) = self.db.get_peer(&pp.peer_id) {
                let _ = self.send_policy(&peer, &stop).await;
            }
        }
        self.db.set_my_policy(None).map_err(|e| e.to_string())?;
        self.db.clear_policy_peers().map_err(|e| e.to_string())?;
        self.emit_admin();
        Ok(self.admin_state())
    }

    /// Yes / no to an admin who asks to manage this computer.
    pub async fn answer_policy_offer(&self, accept: bool) -> Result<AdminState, String> {
        let offer = self.db.policy_offer().ok_or("Nothing to answer.")?;
        self.db.set_policy_offer(None).map_err(|e| e.to_string())?;
        if accept {
            self.db.remove_declined_admin(&offer.admin_id).map_err(|e| e.to_string())?;
            self.db.set_applied_policy(Some(&offer)).map_err(|e| e.to_string())?;
        } else {
            self.db.add_declined_admin(&offer.admin_id).map_err(|e| e.to_string())?;
        }
        self.answer_admin(&offer.admin_id, offer.version, if accept { "accepted" } else { "declined" }).await;
        self.emit_admin();
        Ok(self.admin_state())
    }

    /// Stop following the admin's settings.
    pub async fn leave_policy(&self) -> Result<AdminState, String> {
        let p = self.db.applied_policy().ok_or("This computer doesn't follow office settings.")?;
        self.db.set_applied_policy(None).map_err(|e| e.to_string())?;
        self.db.add_declined_admin(&p.admin_id).map_err(|e| e.to_string())?;
        self.answer_admin(&p.admin_id, p.version, "left").await;
        self.emit_admin();
        Ok(self.admin_state())
    }

    async fn answer_admin(&self, admin_id: &str, version: i64, status: &str) {
        let Ok(Some(peer)) = self.db.get_peer(admin_id) else { return };
        let Ok(mut chan) = self.connect_peer(&peer).await else { return };
        let _ = NetworkService::send_acked(&mut chan, PacketPayload::PolicyAnswer(PolicyAnswerPayload { version, status: status.to_string() })).await;
        chan.close().await;
    }

    /// Sends the latest settings to colleagues who don't have them yet.
    pub(super) fn kick_policy(&self) {
        let this = self.clone();
        tauri::async_runtime::spawn(async move { this.run_policy_round(true).await });
    }

    /// Every 30 s on the admin computer: colleagues online who haven't got
    /// (or answered) the latest version get it.
    pub async fn run_policy_round(&self, force: bool) {
        let Some(p) = self.db.my_policy() else { return };
        let known: std::collections::HashMap<String, PolicyPeer> = self.db.policy_peers().unwrap_or_default().into_iter().map(|x| (x.peer_id.clone(), x)).collect();
        let now = now_secs();
        for peer in self.db.list_peers().unwrap_or_default() {
            if peer.trust_state == "blocked" || peer.status != "online" || peer.id == p.admin_id {
                continue;
            }
            let fresh = known.get(&peer.id).is_some_and(|k| {
                k.version >= p.version && matches!(k.status.as_str(), "accepted" | "declined" | "left" | "other-admin")
                    || (!force && now - k.at < 120 && k.version >= p.version)
            });
            if fresh {
                continue;
            }
            let _ = self.send_policy(&peer, &p).await;
        }
        self.emit_admin();
    }

    /// One colleague: sends the settings and keeps their answer.
    async fn send_policy(&self, peer: &Peer, p: &OfficePolicy) -> Result<(), String> {
        let mut chan = tokio::time::timeout(Duration::from_secs(8), self.connect_peer(peer))
            .await
            .map_err(|_| "timeout".to_string())?
            .map_err(|e| e.to_string())?;
        let app_version = chan.remote.app_version.clone();
        if !version_at_least(&app_version, FEATURES_ADMIN) {
            chan.close().await;
            let _ = self.db.set_policy_peer(&PolicyPeer { peer_id: peer.id.clone(), version: 0, status: "old".into(), app_version, at: now_secs() });
            return Ok(());
        }
        let reply = NetworkService::send_acked(&mut chan, PacketPayload::Policy(PolicyPayload { policy: p.clone() })).await;
        chan.close().await;
        let status = match reply {
            Ok(a) => a.reason.unwrap_or_else(|| if a.ok { "waiting".into() } else { "refused".into() }),
            Err(()) => return Err("no answer".into()),
        };
        let _ = self.db.set_policy_peer(&PolicyPeer { peer_id: peer.id.clone(), version: p.version, status, app_version, at: now_secs() });
        Ok(())
    }

    /// A colleague's admin computer sent office settings.
    pub(super) fn handle_policy(&self, peer: &Peer, payload: PolicyPayload) -> AckPayload {
        let ok = |status: &str| AckPayload { ok: true, reason: Some(status.to_string()) };
        let p = payload.policy.cleaned();
        if peer.trust_state == "blocked" || p.admin_id != peer.id {
            return AckPayload { ok: false, reason: Some("refused".into()) };
        }
        if self.db.my_policy().is_some() {
            return ok("other-admin");
        }
        match self.db.applied_policy() {
            Some(cur) if cur.admin_id == peer.id => {
                if !p.active {
                    let _ = self.db.set_applied_policy(None);
                    self.emit_admin();
                    self.events.emit_json("lanx://admin-notice", json!({ "text": format!("{} no longer manages LANX settings. Your own settings apply again.", peer.display_name) }));
                    return ok("left");
                }
                if p.version > cur.version {
                    let _ = self.db.set_applied_policy(Some(&p));
                    self.emit_admin();
                }
                ok("accepted")
            }
            Some(_) => ok("other-admin"),
            None => {
                if !p.active {
                    let _ = self.db.set_policy_offer(None);
                    self.emit_admin();
                    return ok("left");
                }
                if self.db.declined_admins().contains(&peer.id) {
                    return ok("declined");
                }
                let newer = self.db.policy_offer().is_none_or(|o| o.admin_id != p.admin_id || o.version < p.version);
                if newer {
                    let _ = self.db.set_policy_offer(Some(&p));
                    self.emit_admin();
                    self.events.emit_json("lanx://policy-offer", &p);
                }
                ok("waiting")
            }
        }
    }

    /// A colleague answered (accepted / declined / left) the admin's settings.
    pub(super) fn handle_policy_answer(&self, peer: &Peer, a: PolicyAnswerPayload) -> AckPayload {
        if self.db.my_policy().is_some() && matches!(a.status.as_str(), "accepted" | "declined" | "left") {
            let app_version = self.db.policy_peers().unwrap_or_default().into_iter().find(|x| x.peer_id == peer.id).map(|x| x.app_version).unwrap_or_default();
            let _ = self.db.set_policy_peer(&PolicyPeer {
                peer_id: peer.id.clone(),
                version: a.version.max(0),
                status: a.status.clone(),
                app_version,
                at: now_secs(),
            });
            self.emit_admin();
        }
        AckPayload { ok: true, reason: None }
    }
}
