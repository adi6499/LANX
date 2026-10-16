//! Voice and video calls (LANX 1.2), one-to-one.
//!
//! The audio and video flow directly between the two LANX windows with WebRTC
//! (DTLS-SRTP encrypted, straight across the LAN, no servers). This module
//! carries the call set-up over the encrypted LANX session, plays the
//! ringtones, enforces "one call at a time", times out unanswered calls and
//! writes every call into the chat ("Video call · 3:12", "Missed call").

use super::NetworkService;
use super::protocol::*;
use crate::events::AlertKind;
use crate::storage::models::Peer;
use serde::Serialize;
use std::time::Duration;

fn now_secs() -> i64 {
    chrono::Utc::now().timestamp()
}

#[derive(Debug, Clone, Serialize)]
pub struct CallInfo {
    pub call_id: String,
    pub conversation_id: String,
    pub peer_id: String,
    pub peer_name: String,
    pub avatar_color: String,
    /// Started as a video call.
    pub video: bool,
    pub outgoing: bool,
    /// ringing | active
    pub phase: String,
    pub started_at: i64,
    pub answered_at: Option<i64>,
    /// The chat is hidden (or LANX is locked): the UI shows no name.
    pub private: bool,
}

/// `lanx://call` — incoming | accepted | media | ended
#[derive(Debug, Clone, Serialize)]
pub struct CallEvent {
    pub action: String,
    pub call: CallInfo,
    pub sdp: Option<String>,
    pub video: Option<bool>,
    pub muted: Option<bool>,
    pub screen: Option<bool>,
    /// For "ended": hangup | declined | cancelled | timeout | busy | failed
    pub reason: Option<String>,
}

fn payload(call_id: &str, action: &str) -> CallPayload {
    CallPayload {
        call_id: call_id.to_string(),
        action: action.to_string(),
        video: None,
        sdp: None,
        muted: None,
        screen: None,
    }
}

impl NetworkService {
    pub fn current_call(&self) -> Option<CallInfo> {
        self.call.lock().clone()
    }

    fn emit_call(&self, action: &str, call: &CallInfo, extra: impl FnOnce(&mut CallEvent)) {
        let mut ev = CallEvent {
            action: action.to_string(),
            call: call.clone(),
            sdp: None,
            video: None,
            muted: None,
            screen: None,
            reason: None,
        };
        extra(&mut ev);
        self.events.emit_json("lanx://call", ev);
    }

    /// Takes the current call if it is `call_id` with this peer and passes `ok`.
    fn take_call_if(&self, call_id: &str, peer_id: Option<&str>, ok: impl Fn(&CallInfo) -> bool) -> Option<CallInfo> {
        let mut cur = self.call.lock();
        match cur.as_ref() {
            Some(c) if c.call_id == call_id && peer_id.is_none_or(|p| p == c.peer_id) && ok(c) => cur.take(),
            _ => None,
        }
    }

    /// Starts a looping ringtone (not in unit tests, which have no window).
    fn start_ringtone(&self, name: &str, max_volume: u32) {
        if self.events.app().is_none() {
            return;
        }
        let volume = self.db.get_settings().map(|s| s.sound_volume).unwrap_or(80);
        crate::sound::play_loop(name, volume.min(max_volume));
    }

    async fn send_call(&self, peer: &Peer, p: CallPayload) -> Result<(), String> {
        let unreachable = || format!("Could not reach {}.", peer.display_name);
        let mut chan = self.connect_peer(peer).await.map_err(|_| unreachable())?;
        if !version_at_least(&chan.remote.app_version, FEATURES_CALLS) {
            chan.close().await;
            return Err(format!(
                "{} needs LANX {} or newer for calls. Ask them to update.",
                peer.display_name, FEATURES_CALLS
            ));
        }
        let reply = NetworkService::send_acked(&mut chan, PacketPayload::Call(p)).await;
        chan.close().await;
        match reply {
            Ok(a) if a.ok => Ok(()),
            Ok(a) => Err(a.reason.unwrap_or_else(|| "The call was refused.".to_string())),
            Err(()) => Err(unreachable()),
        }
    }

    /// Writes the call into the chat. `outcome`: answered | missed | declined |
    /// no_answer | cancelled | busy | failed.
    fn record_call(&self, call: &CallInfo, outcome: &str) {
        let secs = call.answered_at.map(|a| (now_secs() - a).max(0)).unwrap_or(0);
        let content = serde_json::json!({ "video": call.video, "outcome": outcome, "secs": secs }).to_string();
        let sender = if call.outgoing { self.identity.device_id.clone() } else { call.peer_id.clone() };
        if let Some(m) = self.insert_event_message(&call.conversation_id, &sender, call.outgoing, "call", &content) {
            if outcome == "missed" {
                let _ = self.db.increment_unread(&call.conversation_id);
            }
            let fresh = self.db.get_conversation(&call.conversation_id).ok().flatten();
            self.events.message_received(&m, fresh.as_ref());
            self.events.update_tray(&self.db);
        }
    }

    fn spawn_ring_timeout(&self, call_id: String) {
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_secs(crate::testmode::ring_timeout_secs())).await;
            let Some(call) = this.take_call_if(&call_id, None, |c| c.phase == "ringing") else {
                return;
            };
            crate::sound::stop_loop();
            if call.outgoing {
                this.record_call(&call, "no_answer");
                if let Ok(Some(peer)) = this.db.get_peer(&call.peer_id) {
                    let _ = this.send_call(&peer, payload(&call.call_id, "cancel")).await;
                }
            } else {
                this.record_call(&call, "missed");
                this.notify_missed(&call);
            }
            this.emit_call("ended", &call, |e| e.reason = Some("timeout".to_string()));
        });
    }

    fn notify_missed(&self, call: &CallInfo) {
        let title = if call.private {
            "Missed call".to_string()
        } else {
            format!("Missed {} call from {}", if call.video { "video" } else { "voice" }, call.peer_name)
        };
        self.events.notify(&self.db, AlertKind::Message, &title, "Open LANX to call back");
    }

    /// Starts a call: `sdp` is this window's WebRTC offer.
    pub async fn start_call(&self, conversation_id: &str, video: bool, sdp: String) -> Result<CallInfo, String> {
        let conv = self
            .db
            .get_conversation(conversation_id)
            .map_err(|e| e.to_string())?
            .ok_or("Chat not found")?;
        if conv.kind != "direct" {
            return Err("Calls work in one-to-one chats.".to_string());
        }
        let peer = self
            .db
            .get_peer(&conv.peer_id)
            .map_err(|e| e.to_string())?
            .ok_or("Contact not found")?;
        if peer.trust_state == "blocked" {
            return Err(format!("You blocked {}.", peer.display_name));
        }
        if peer.status != "online" {
            return Err(format!("{} is offline right now.", peer.display_name));
        }
        let call = CallInfo {
            call_id: uuid::Uuid::new_v4().to_string(),
            conversation_id: conv.id.clone(),
            peer_id: peer.id.clone(),
            peer_name: peer.display_name.clone(),
            avatar_color: peer.avatar_color.clone(),
            video,
            outgoing: true,
            phase: "ringing".to_string(),
            started_at: now_secs(),
            answered_at: None,
            private: false,
        };
        {
            let mut cur = self.call.lock();
            if cur.is_some() {
                return Err("You're already in a call.".to_string());
            }
            *cur = Some(call.clone());
        }
        let mut invite = payload(&call.call_id, "invite");
        invite.video = Some(video);
        invite.sdp = Some(sdp);
        if let Err(e) = self.send_call(&peer, invite).await {
            self.take_call_if(&call.call_id, None, |_| true);
            return Err(e);
        }
        if self.current_call().is_some_and(|c| c.call_id == call.call_id && c.phase == "ringing") {
            self.start_ringtone("ringback", 60);
        }
        self.spawn_ring_timeout(call.call_id.clone());
        Ok(call)
    }

    /// Answers the ringing call: `sdp` is this window's WebRTC answer.
    pub async fn answer_call(&self, call_id: &str, sdp: String, video: bool) -> Result<CallInfo, String> {
        let call = {
            let mut cur = self.call.lock();
            match cur.as_mut() {
                Some(c) if c.call_id == call_id && !c.outgoing && c.phase == "ringing" => {
                    c.phase = "active".to_string();
                    c.answered_at = Some(now_secs());
                    c.clone()
                }
                _ => return Err("This call has ended.".to_string()),
            }
        };
        crate::sound::stop_loop();
        let peer = self
            .db
            .get_peer(&call.peer_id)
            .map_err(|e| e.to_string())?
            .ok_or("Contact not found")?;
        let mut accept = payload(call_id, "accept");
        accept.sdp = Some(sdp);
        accept.video = Some(video);
        if let Err(e) = self.send_call(&peer, accept).await {
            if let Some(c) = self.take_call_if(call_id, None, |_| true) {
                self.record_call(&c, "failed");
                self.emit_call("ended", &c, |ev| ev.reason = Some("failed".to_string()));
            }
            return Err(e);
        }
        Ok(call)
    }

    /// Declines a ringing incoming call.
    pub async fn decline_call(&self, call_id: &str) -> Result<(), String> {
        let Some(call) = self.take_call_if(call_id, None, |c| !c.outgoing && c.phase == "ringing") else {
            return Ok(());
        };
        crate::sound::stop_loop();
        self.record_call(&call, "declined");
        if let Ok(Some(peer)) = self.db.get_peer(&call.peer_id) {
            let _ = self.send_call(&peer, payload(call_id, "decline")).await;
        }
        Ok(())
    }

    /// Ends the call (or cancels it while it is still ringing).
    pub async fn hangup_call(&self, call_id: &str) -> Result<(), String> {
        let Some(call) = self.take_call_if(call_id, None, |_| true) else {
            return Ok(());
        };
        crate::sound::stop_loop();
        let (action, outcome) = match (call.phase.as_str(), call.outgoing) {
            ("ringing", true) => ("cancel", "cancelled"),
            ("ringing", false) => ("decline", "declined"),
            _ => ("hangup", "answered"),
        };
        self.record_call(&call, outcome);
        if let Ok(Some(peer)) = self.db.get_peer(&call.peer_id) {
            let _ = self.send_call(&peer, payload(call_id, action)).await;
        }
        Ok(())
    }

    /// Tells the other side about mute / camera / screen sharing.
    pub async fn call_media(&self, call_id: &str, video: Option<bool>, muted: Option<bool>, screen: Option<bool>) -> Result<(), String> {
        let Some(call) = self.current_call().filter(|c| c.call_id == call_id) else {
            return Ok(());
        };
        let Some(peer) = self.db.get_peer(&call.peer_id).ok().flatten() else {
            return Ok(());
        };
        let mut p = payload(call_id, "media");
        p.video = video;
        p.muted = muted;
        p.screen = screen;
        self.send_call(&peer, p).await
    }

    pub(super) fn handle_call(&self, peer: &Peer, c: CallPayload) -> AckPayload {
        let ok = AckPayload { ok: true, reason: None };
        let ended = || AckPayload { ok: false, reason: Some("This call has ended.".to_string()) };
        match c.action.as_str() {
            "invite" => {
                if peer.trust_state == "blocked" {
                    return AckPayload { ok: false, reason: Some("Not available".to_string()) };
                }
                let Ok(conv) = self.db.get_or_create_conversation(&peer.id) else {
                    return AckPayload { ok: false, reason: Some("Could not open the chat".to_string()) };
                };
                let video = c.video.unwrap_or(false);
                let private = conv.is_hidden && !self.privacy.hidden_unlocked() || self.privacy.is_locked();
                let call = CallInfo {
                    call_id: c.call_id.clone(),
                    conversation_id: conv.id.clone(),
                    peer_id: peer.id.clone(),
                    peer_name: if private { String::new() } else { peer.display_name.clone() },
                    avatar_color: peer.avatar_color.clone(),
                    video,
                    outgoing: false,
                    phase: "ringing".to_string(),
                    started_at: now_secs(),
                    answered_at: None,
                    private,
                };
                {
                    let mut cur = self.call.lock();
                    if cur.is_some() {
                        drop(cur);
                        // Still show that they tried.
                        let mut missed = call.clone();
                        missed.peer_name = peer.display_name.clone();
                        self.record_call(&missed, "busy");
                        let me = self.db.get_settings().map(|s| s.display_name).unwrap_or_default();
                        return AckPayload { ok: false, reason: Some(format!("{} is on another call.", me)) };
                    }
                    *cur = Some(call.clone());
                }
                self.start_ringtone("ringtone", 100);
                self.spawn_ring_timeout(call.call_id.clone());
                let title = if private {
                    "📞 Incoming call".to_string()
                } else {
                    format!("📞 {} is {}calling you", peer.display_name, if video { "video " } else { "" })
                };
                self.events.incoming_call(&self.db, &title);
                self.emit_call("incoming", &call, |e| {
                    e.sdp = c.sdp.clone();
                    e.video = Some(video);
                });
                ok
            }
            "accept" => {
                let call = {
                    let mut cur = self.call.lock();
                    match cur.as_mut() {
                        Some(x) if x.call_id == c.call_id && x.peer_id == peer.id && x.outgoing && x.phase == "ringing" => {
                            x.phase = "active".to_string();
                            x.answered_at = Some(now_secs());
                            x.clone()
                        }
                        _ => return ended(),
                    }
                };
                crate::sound::stop_loop();
                self.emit_call("accepted", &call, |e| {
                    e.sdp = c.sdp.clone();
                    e.video = c.video;
                });
                ok
            }
            "decline" | "cancel" | "hangup" => {
                let Some(call) = self.take_call_if(&c.call_id, Some(&peer.id), |_| true) else {
                    return ended();
                };
                crate::sound::stop_loop();
                let (outcome, reason) = match (c.action.as_str(), call.phase.as_str()) {
                    (_, "active") => ("answered", "hangup"),
                    ("decline", _) => ("declined", "declined"),
                    _ => ("missed", "cancelled"),
                };
                self.record_call(&call, outcome);
                if outcome == "missed" && !call.outgoing {
                    self.notify_missed(&call);
                }
                self.emit_call("ended", &call, |e| e.reason = Some(reason.to_string()));
                ok
            }
            "media" => match self.current_call() {
                Some(call) if call.call_id == c.call_id && call.peer_id == peer.id => {
                    self.emit_call("media", &call, |e| {
                        e.video = c.video;
                        e.muted = c.muted;
                        e.screen = c.screen;
                    });
                    ok
                }
                _ => ended(),
            },
            _ => AckPayload { ok: false, reason: Some("Unknown call action".to_string()) },
        }
    }
}
