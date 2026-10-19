//! LANX 1.8.0 office: emergency alerts, the intercom (a short voice message
//! that plays by itself when it arrives) and out-of-office automatic
//! replies. Visitor and kudos cards live in org.rs, birthdays in profiles,
//! remote help in calls.rs.

use super::protocol::*;
use super::{NetworkService, now_secs};
use crate::storage::models::*;
use crate::storage::office::AlertInfo;
use parking_lot::Mutex;
use serde_json::json;
use std::collections::{HashMap, HashSet};
use tauri::Manager;

/// Built-in emergencies: id → (emoji, what everyone is told).
pub const ALERT_KINDS: [(&str, &str, &str); 6] = [
    ("fire", "🔥", "Fire! Leave the building now by the nearest exit."),
    ("medical", "🚑", "Medical emergency. First-aiders, please come."),
    ("evacuate", "🚪", "Evacuate the building now."),
    ("assembly", "📣", "Everyone to the assembly point, please."),
    ("lockdown", "🔒", "Stay where you are and keep the doors closed."),
    ("custom", "🚨", "Emergency."),
];
/// The automatic reply starts with this (and is never answered automatically).
pub const AUTO_REPLY_PREFIX: &str = "🌴 Automatic reply: ";
/// One automatic reply per colleague in this time.
const AUTO_REPLY_EVERY_SECS: i64 = 12 * 3600;
/// Intercom messages: at most this long…
pub const INTERCOM_MAX_MS: u64 = 60_000;
/// …and only played by themselves if they arrive this soon after being sent.
const INTERCOM_FRESH_SECS: i64 = 120;
/// Raising an alert again this soon is refused (double clicks).
const ALERT_AGAIN_SECS: i64 = 5;

/// In-memory office state.
#[derive(Default)]
pub struct OfficeState {
    /// Incoming intercom messages still downloading (transfer ids).
    intercom_in: Mutex<HashSet<String>>,
    /// When each colleague last got an automatic reply.
    replied: Mutex<HashMap<String, i64>>,
    last_alert: Mutex<i64>,
}

pub fn alert_kind(kind: &str) -> (&'static str, &'static str, &'static str) {
    ALERT_KINDS.iter().copied().find(|(k, _, _)| *k == kind).unwrap_or(ALERT_KINDS[5])
}

/// The text colleagues on LANX older than 1.8.0 get instead of the alert.
pub fn alert_fallback(kind: &str, text: &str, from: &str) -> String {
    let (_, emoji, _) = alert_kind(kind);
    format!("{} EMERGENCY from {}: {}\n(This came as an emergency alert. Update LANX to get alerts full-screen.)", emoji, from, text)
}

/// Intercom files are voice notes whose file name starts with this.
pub fn is_intercom_file(name: &str) -> bool {
    name.starts_with("Intercom ")
}

fn clean_text(s: &str, max: usize) -> String {
    s.trim().chars().map(|c| if c.is_control() { ' ' } else { c }).take(max).collect()
}

impl NetworkService {
    fn my_name(&self) -> String {
        self.db.get_settings().map(|s| s.display_name).unwrap_or_else(|_| "A colleague".to_string())
    }

    fn emit_alert(&self, id: &str) {
        if let Ok(Some(a)) = self.db.alert(id) {
            self.events.emit_json("lanx://alert", &a);
        }
    }

    fn show_window_on_top(&self, on_top: bool) {
        if crate::testmode::quiet() {
            return; // side-by-side test copies don't jump over the user's work
        }
        if let Some(app) = self.events.app() {
            if let Some(w) = app.get_webview_window("main") {
                if on_top {
                    let _ = w.unminimize();
                    let _ = w.show();
                    let _ = w.set_always_on_top(true);
                    let _ = w.set_focus();
                } else {
                    let _ = w.set_always_on_top(false);
                }
            }
        }
    }

    fn alarm(&self, on: bool) {
        if self.events.app().is_none() || crate::testmode::quiet() {
            return; // unit tests and quiet test copies
        }
        if on {
            crate::sound::play_loop("alarm", 100);
        } else {
            crate::sound::stop_loop();
        }
    }

    // ------------------------------------------------------ emergency alerts

    /// Sends an emergency alert to every colleague who is online. Those on
    /// 1.8.0+ get it full-screen with an alarm; older ones as a message.
    pub async fn raise_alert(&self, kind: &str, text: &str) -> Result<AlertInfo, String> {
        let now = now_secs();
        {
            let mut last = self.office.last_alert.lock();
            if now - *last < ALERT_AGAIN_SECS {
                return Err("An alert was just sent.".to_string());
            }
            *last = now;
        }
        let (kind, _, default_text) = alert_kind(kind);
        let text = clean_text(text, 300);
        let text = if text.is_empty() { default_text.to_string() } else { text };
        let me = self.identity.device_id.clone();
        let from_name = self.my_name();
        let a = AlertInfo {
            id: uuid::Uuid::new_v4().to_string(),
            from_id: me,
            from_name: from_name.clone(),
            kind: kind.to_string(),
            text: text.clone(),
            at: now,
            cleared_at: None,
            mine: true,
            my_ack: None,
            sent_to: Vec::new(),
            acks: Vec::new(),
        };
        self.db.insert_alert(&a).map_err(|e| e.to_string())?;
        let peers: Vec<Peer> = self
            .db
            .list_peers()
            .map_err(|e| e.to_string())?
            .into_iter()
            .filter(|p| p.trust_state != "blocked" && p.status == "online" && p.id != a.from_id)
            .collect();
        let payload = AlertPayload { alert_id: a.id.clone(), action: "raise".to_string(), kind: kind.to_string(), text: text.clone(), at: now, status: String::new() };
        let mut tasks = Vec::new();
        for peer in peers {
            let this = self.clone();
            let p = payload.clone();
            let from = from_name.clone();
            tasks.push(tauri::async_runtime::spawn(async move { this.deliver_alert(&peer, p, &from).await }));
        }
        for t in tasks {
            let _ = t.await;
        }
        self.emit_alert(&a.id);
        self.db.alert(&a.id).map_err(|e| e.to_string())?.ok_or_else(|| "Alert not found".to_string())
    }

    /// One colleague: the alert itself (1.8.0+) or a message (older).
    async fn deliver_alert(&self, peer: &Peer, p: AlertPayload, from: &str) {
        let Ok(mut chan) = self.connect_peer(peer).await else { return };
        if version_at_least(&chan.remote.app_version, FEATURES_OFFICE) {
            let id = p.alert_id.clone();
            let reply = NetworkService::send_acked(&mut chan, PacketPayload::Alert(p)).await;
            chan.close().await;
            if matches!(reply, Ok(ref a) if a.ok) {
                let _ = self.db.add_alert_target(&id, &peer.id, &peer.display_name, "alert");
            }
        } else {
            chan.close().await;
            if p.action == "raise" {
                if let Ok(conv) = self.db.get_or_create_conversation(&peer.id) {
                    if self.send_typed(&conv.id, &alert_fallback(&p.kind, &p.text, from), "text", None, Vec::new()).await.is_ok() {
                        let _ = self.db.add_alert_target(&p.alert_id, &peer.id, &peer.display_name, "text");
                    }
                }
            }
        }
    }

    /// "I'm safe" / "I need help" on a colleague's alert.
    pub async fn answer_alert(&self, alert_id: &str, status: &str) -> Result<AlertInfo, String> {
        let a = self.db.alert(alert_id).map_err(|e| e.to_string())?.ok_or("Alert not found")?;
        if a.mine {
            return Err("That's your own alert.".to_string());
        }
        let status = if status == "help" { "help" } else { "safe" };
        self.db.set_my_alert_ack(alert_id, status).map_err(|e| e.to_string())?;
        if self.db.unanswered_alerts(now_secs() - 24 * 3600).unwrap_or(0) == 0 {
            self.alarm(false);
            self.show_window_on_top(false);
        }
        if let Ok(Some(peer)) = self.db.get_peer(&a.from_id) {
            let p = AlertPayload { alert_id: alert_id.to_string(), action: "ack".to_string(), kind: a.kind.clone(), text: String::new(), at: now_secs(), status: status.to_string() };
            if let Ok(mut chan) = self.connect_peer(&peer).await {
                let _ = NetworkService::send_acked(&mut chan, PacketPayload::Alert(p)).await;
                chan.close().await;
            }
        }
        self.emit_alert(alert_id);
        self.db.alert(alert_id).map_err(|e| e.to_string())?.ok_or_else(|| "Alert not found".to_string())
    }

    /// "All clear" for an alert you raised.
    pub async fn clear_alert(&self, alert_id: &str) -> Result<AlertInfo, String> {
        let a = self.db.alert(alert_id).map_err(|e| e.to_string())?.ok_or("Alert not found")?;
        if !a.mine {
            return Err("Only the person who sent the alert can call the all-clear.".to_string());
        }
        self.db.clear_alert(alert_id, now_secs()).map_err(|e| e.to_string())?;
        let from = self.my_name();
        for (peer_id, how) in self.db.alert_targets(alert_id).unwrap_or_default() {
            let Ok(Some(peer)) = self.db.get_peer(&peer_id) else { continue };
            let this = self.clone();
            let p = AlertPayload { alert_id: alert_id.to_string(), action: "clear".to_string(), kind: a.kind.clone(), text: String::new(), at: now_secs(), status: String::new() };
            let text = format!("✅ ALL CLEAR from {}: {}", from, a.text);
            tauri::async_runtime::spawn(async move {
                if how == "alert" {
                    if let Ok(mut chan) = this.connect_peer(&peer).await {
                        let _ = NetworkService::send_acked(&mut chan, PacketPayload::Alert(p)).await;
                        chan.close().await;
                    }
                } else if let Ok(conv) = this.db.get_or_create_conversation(&peer.id) {
                    let _ = this.send_typed(&conv.id, &text, "text", None, Vec::new()).await;
                }
            });
        }
        self.emit_alert(alert_id);
        self.db.alert(alert_id).map_err(|e| e.to_string())?.ok_or_else(|| "Alert not found".to_string())
    }

    pub(super) fn handle_alert(&self, peer: &Peer, p: AlertPayload) -> AckPayload {
        let ok = AckPayload { ok: true, reason: None };
        let no = |r: &str| AckPayload { ok: false, reason: Some(r.to_string()) };
        if peer.trust_state == "blocked" {
            return no("Not available");
        }
        if uuid::Uuid::parse_str(&p.alert_id).is_err() {
            return no("Bad alert");
        }
        match p.action.as_str() {
            "raise" => {
                let (kind, _, default_text) = alert_kind(&p.kind);
                let text = clean_text(&p.text, 300);
                let a = AlertInfo {
                    id: p.alert_id.clone(),
                    from_id: peer.id.clone(),
                    from_name: peer.display_name.clone(),
                    kind: kind.to_string(),
                    text: if text.is_empty() { default_text.to_string() } else { text },
                    // Their clock may be off: when it arrived here.
                    at: now_secs(),
                    cleared_at: None,
                    mine: false,
                    my_ack: None,
                    sent_to: Vec::new(),
                    acks: Vec::new(),
                };
                if self.db.insert_alert(&a).is_err() {
                    return no("Could not save the alert");
                }
                // An emergency always gets through: Do not disturb, quiet
                // hours and muted chats don't apply.
                self.alarm(true);
                self.show_window_on_top(true);
                self.emit_alert(&a.id);
                ok
            }
            "ack" => {
                if self.db.alert(&p.alert_id).ok().flatten().is_some_and(|a| a.mine) {
                    let status = if p.status == "help" { "help" } else { "safe" };
                    let _ = self.db.set_alert_ack(&p.alert_id, &peer.id, &peer.display_name, status, now_secs());
                    self.emit_alert(&p.alert_id);
                }
                ok
            }
            "clear" => {
                if self.db.alert(&p.alert_id).ok().flatten().is_some_and(|a| !a.mine && a.from_id == peer.id) {
                    let _ = self.db.clear_alert(&p.alert_id, now_secs());
                    if self.db.unanswered_alerts(now_secs() - 24 * 3600).unwrap_or(0) == 0 {
                        self.alarm(false);
                        self.show_window_on_top(false);
                    }
                    self.emit_alert(&p.alert_id);
                }
                ok
            }
            _ => no("Unknown alert action"),
        }
    }

    pub fn recent_alerts(&self) -> Vec<AlertInfo> {
        self.db.recent_alerts(now_secs() - 30 * 24 * 3600).unwrap_or_default()
    }

    // --------------------------------------------------------------- intercom

    /// Push-to-talk: a short recording that plays by itself for colleagues
    /// who are online (it also stays in the chat as a voice note).
    pub async fn send_intercom(&self, conversation_id: &str, data: &[u8], media_ms: u64, ext: &str) -> Result<Vec<crate::networking::transfer::SentFile>, String> {
        if media_ms > INTERCOM_MAX_MS + 2000 {
            return Err("Intercom messages are up to a minute. Send a voice note instead.".to_string());
        }
        let conv = self.db.get_conversation(conversation_id).map_err(|e| e.to_string())?.ok_or("Chat not found")?;
        if conv.kind == "direct" {
            let peer = self.db.get_peer(&conv.peer_id).map_err(|e| e.to_string())?.ok_or("Contact not found")?;
            if peer.status != "online" {
                return Err(format!("{} is offline. Send a voice note instead.", peer.display_name));
            }
        }
        self.send_voice_file(conversation_id, data, media_ms, ext, "Intercom").await
    }

    /// Marks an arriving voice note as an intercom message (plays when it's here).
    pub(super) fn intercom_offer(&self, transfer_id: &str) {
        self.office.intercom_in.lock().insert(transfer_id.to_string());
    }

    /// An intercom message finished downloading: tell the window to play it
    /// (or just show it, when the chat is muted / Do not disturb / quiet hours).
    pub(super) fn intercom_arrived(&self, t: &TransferRecord) {
        if !self.office.intercom_in.lock().remove(&t.id) {
            return;
        }
        let conv = t.conversation_id.clone().unwrap_or_default();
        let quiet = self.chat_muted(&conv)
            || self.db.get_settings().map(|s| s.profile.effective(now_secs()).status == "dnd" || s.quiet_hours.active_now()).unwrap_or(false)
            || self.privacy.is_locked()
            || self.db.is_conversation_hidden(&conv) && !self.privacy.hidden_unlocked();
        self.events.emit_json(
            "lanx://intercom",
            json!({ "transfer_id": t.id, "conversation_id": conv, "peer_id": t.peer_id, "name": t.peer_name, "quiet": quiet }),
        );
    }

    /// The offer of an outgoing intercom message: only when it's still fresh.
    pub(super) fn intercom_fresh(&self, t: &TransferRecord) -> bool {
        is_intercom_file(&t.file_name) && now_secs() - t.created_at <= INTERCOM_FRESH_SECS
    }

    // --------------------------------------------------------- out of office

    /// Someone messaged you directly while you're "out of office": answer once
    /// (per 12 hours) with your message.
    pub(super) fn maybe_auto_reply(&self, peer: &Peer, conversation_id: &str, content: &str) {
        let Ok(s) = self.db.get_settings() else { return };
        let now = now_secs();
        if !s.out_of_office.active(now) || content.starts_with(AUTO_REPLY_PREFIX) || peer.trust_state == "blocked" {
            return;
        }
        {
            let mut replied = self.office.replied.lock();
            if replied.get(&peer.id).is_some_and(|t| now - t < AUTO_REPLY_EVERY_SECS) {
                return;
            }
            replied.insert(peer.id.clone(), now);
        }
        let back = if s.out_of_office.until > 0 {
            chrono::DateTime::from_timestamp(s.out_of_office.until, 0)
                .map(|d| format!(" until {}", d.with_timezone(&chrono::Local).format("%a %d %b, %H:%M")))
                .unwrap_or_default()
        } else {
            String::new()
        };
        let text = if s.out_of_office.message.trim().is_empty() {
            format!("I'm out of the office{}. I'll reply when I'm back.", back)
        } else {
            s.out_of_office.message.trim().to_string()
        };
        let this = self.clone();
        let conv = conversation_id.to_string();
        let content = format!("{}{}", AUTO_REPLY_PREFIX, text);
        tauri::async_runtime::spawn(async move {
            // A moment later, so it lands after their message.
            tokio::time::sleep(std::time::Duration::from_millis(400)).await;
            if let Ok(m) = this.send_typed(&conv, &content, "text", None, Vec::new()).await {
                // Shows up in the open chat like a message you typed.
                let c = this.db.get_conversation(&conv).ok().flatten();
                this.events.message_received(&m, c.as_ref());
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alerts_have_text_and_fallbacks() {
        assert_eq!(alert_kind("fire").1, "🔥");
        assert_eq!(alert_kind("nonsense").0, "custom");
        let t = alert_fallback("medical", "Help at reception", "Asha");
        assert!(t.starts_with("🚑 EMERGENCY from Asha: Help at reception"));
    }

    #[test]
    fn birthdays_and_out_of_office_are_checked() {
        assert_eq!(clean_birthday("3-7"), "03-07");
        assert_eq!(clean_birthday("02-29"), "02-29");
        assert_eq!(clean_birthday("02-30"), "");
        assert_eq!(clean_birthday("13-01"), "");
        assert_eq!(clean_birthday("hello"), "");
        let o = OutOfOffice { enabled: true, until: 100, message: "Back Monday".into() };
        assert!(o.active(50) && !o.active(100));
        assert!(OutOfOffice { enabled: true, until: 0, message: String::new() }.active(i64::MAX));
        assert!(!OutOfOffice::default().active(0));
    }

    #[test]
    fn intercom_files_are_recognised() {
        assert!(is_intercom_file("Intercom 2026-10-19 10-00-00 ab12.webm"));
        assert!(!is_intercom_file("Voice note 2026-10-19.webm"));
    }
}
