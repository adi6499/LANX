//! LANX 1.2.9: profiles — avatar (photo / character / initials), status and
//! "about me". Each computer puts a short fingerprint of its profile in its
//! discovery beacon; when a colleague's fingerprint changes, we ask them for
//! the full profile over the encrypted connection (so a photo travels only
//! when it changes).

use super::protocol::*;
use super::{NetworkService, now_secs};
use crate::storage::models::Profile;
use std::time::{Duration, Instant};

/// Don't ask the same colleague again within this time after a try.
const PROFILE_RETRY: Duration = Duration::from_secs(20);

impl NetworkService {
    /// What colleagues see about this computer's user right now (an expired
    /// status is cleared).
    pub fn local_profile_full(&self) -> Profile {
        self.db
            .get_settings()
            .map(|s| s.profile.effective(now_secs()))
            .unwrap_or_default()
    }

    /// Short fingerprint for the discovery beacon.
    pub fn local_profile_rev(&self) -> u64 {
        self.local_profile_full().rev()
    }

    /// The user's own status says "do not disturb" (no sounds or pop-ups).
    pub fn do_not_disturb(&self) -> bool {
        self.local_profile_full().status == "dnd"
    }

    /// A colleague's beacon says their profile is at `rev`: fetch it when ours
    /// is different (at most once per PROFILE_RETRY per colleague).
    pub fn check_peer_profile(&self, peer_id: &str, rev: u64) {
        if self.db.peer_profile_rev(peer_id) == Some(rev) {
            return;
        }
        {
            let mut tries = self.profile_tries.lock();
            if tries.get(peer_id).is_some_and(|t| t.elapsed() < PROFILE_RETRY) {
                return;
            }
            tries.insert(peer_id.to_string(), Instant::now());
        }
        let this = self.clone();
        let id = peer_id.to_string();
        tauri::async_runtime::spawn(async move {
            if this.fetch_peer_profile(&id).await.is_ok() {
                this.profile_tries.lock().remove(&id);
            }
        });
    }

    /// Asks a colleague for their profile and keeps it.
    pub async fn fetch_peer_profile(&self, peer_id: &str) -> Result<Profile, String> {
        let peer = self
            .db
            .get_peer(peer_id)
            .map_err(|e| e.to_string())?
            .ok_or("Unknown colleague")?;
        if peer.trust_state == "blocked" {
            return Err("Blocked".into());
        }
        let mut chan = self
            .connect_peer(&peer)
            .await
            .map_err(|_| format!("Could not reach {}", peer.display_name))?;
        if !version_at_least(&chan.remote.app_version, FEATURES_PROFILE) {
            chan.close().await;
            return Err("Older LANX: no profile".into());
        }
        let sent = chan.send(PacketPayload::ProfileRequest, None).await?;
        let reply = chan.recv_packet_timeout(Duration::from_secs(10)).await;
        chan.close().await;
        let reply = reply?;
        match reply.payload {
            PacketPayload::ProfileReply(r) if reply.correlation_id.as_deref() == Some(sent.packet_id.as_str()) => {
                let profile = r.profile.cleaned();
                // Keep their fingerprint as sent, so the next beacon matches.
                self.db.set_peer_profile(peer_id, r.rev, &profile).map_err(|e| e.to_string())?;
                self.events.emit_json(
                    "lanx://peer-profile",
                    serde_json::json!({ "peer_id": peer_id, "profile": &profile }),
                );
                Ok(profile)
            }
            _ => Err("No profile in the reply".into()),
        }
    }

    /// Answer to a colleague's ProfileRequest.
    pub(super) fn profile_reply(&self, blocked: bool) -> ProfileReplyPayload {
        let profile = if blocked { Profile::default() } else { self.local_profile_full() };
        ProfileReplyPayload { rev: profile.rev(), profile }
    }

    /// The picture to show for a colleague in alerts: their character
    /// ("🐱") or photo (data URL), if they chose one.
    pub fn island_avatar(&self, peer_id: &str) -> Option<String> {
        let p = self.db.peer_profile(peer_id)?;
        if let Some(e) = p.avatar.strip_prefix("emoji:") {
            Some(e.to_string())
        } else if p.avatar == "photo" && !p.photo.is_empty() {
            Some(p.photo)
        } else {
            None
        }
    }
}
