//! Typed events sent to the React UI, plus desktop notifications and the tray
//! tooltip. Everything is a no-op when there is no app handle (unit tests).

use crate::storage::Database;
use crate::storage::models::{Conversation, Message, Peer, TransferRecord};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Default)]
pub struct Events {
    app: Option<AppHandle>,
}

#[derive(Serialize, Clone)]
struct PeerOfflinePayload<'a> {
    peer_id: &'a str,
}

#[derive(Serialize, Clone)]
struct IncomingMessagePayload<'a> {
    message: &'a Message,
    conversation: Option<&'a Conversation>,
}

#[derive(Serialize, Clone)]
struct MessageStatusPayload<'a> {
    message_id: &'a str,
    status: &'a str,
    error_reason: Option<&'a str>,
    message: &'a Message,
}

#[derive(Serialize, Clone)]
struct TransferProgressPayload<'a> {
    transfer_id: &'a str,
    transferred_bytes: u64,
    file_size: u64,
    bytes_per_sec: u64,
}

impl Events {
    pub fn new(app: Option<AppHandle>) -> Self {
        Self { app }
    }

    pub fn app(&self) -> Option<&AppHandle> {
        self.app.as_ref()
    }

    fn emit<S: Serialize + Clone>(&self, event: &str, payload: S) {
        if let Some(app) = &self.app {
            let _ = app.emit(event, payload);
        }
    }

    pub fn peer_updated(&self, peer: &Peer) {
        self.emit("lanx://peer-discovered", peer);
    }

    pub fn peer_offline(&self, peer_id: &str) {
        self.emit("lanx://peer-offline", PeerOfflinePayload { peer_id });
    }

    pub fn message_received(&self, message: &Message, conversation: Option<&Conversation>) {
        self.emit(
            "lanx://message-received",
            IncomingMessagePayload {
                message,
                conversation,
            },
        );
    }

    pub fn message_updated(&self, message: &Message) {
        self.emit(
            "lanx://message-status-updated",
            MessageStatusPayload {
                message_id: &message.id,
                status: &message.status,
                error_reason: message.error_reason.as_deref(),
                message,
            },
        );
    }

    pub fn transfer_updated(&self, transfer: &TransferRecord) {
        self.emit("lanx://transfer-updated", transfer);
    }

    pub fn transfer_progress(&self, transfer_id: &str, transferred: u64, total: u64, speed: u64) {
        self.emit(
            "lanx://transfer-progress",
            TransferProgressPayload {
                transfer_id,
                transferred_bytes: transferred,
                file_size: total,
                bytes_per_sec: speed,
            },
        );
    }

    /// Something changed in bulk (e.g. a manual peer was merged); the UI reloads.
    pub fn state_changed(&self) {
        self.emit("lanx://state-changed", ());
    }

    fn main_window_focused(app: &AppHandle) -> bool {
        app.get_webview_window("main")
            .map(|w| w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false))
            .unwrap_or(false)
    }

    /// Shows a Windows notification unless LANX is already in front.
    pub fn notify(&self, db: &Database, title: &str, body: &str) {
        let Some(app) = &self.app else { return };
        if !db
            .get_settings()
            .map(|s| s.notifications_enabled)
            .unwrap_or(true)
        {
            return;
        }
        if Self::main_window_focused(app) {
            return;
        }
        use tauri_plugin_notification::NotificationExt;
        let _ = app.notification().builder().title(title).body(body).show();
        if let Some(w) = app.get_webview_window("main") {
            if w.is_visible().unwrap_or(false) {
                let _ = w.request_user_attention(Some(tauri::UserAttentionType::Informational));
            }
        }
    }

    pub fn update_tray(&self, db: &Database) {
        let Some(app) = &self.app else { return };
        let unread = db.total_unread();
        let tip = if unread > 0 {
            format!("LANX — {} unread", unread)
        } else {
            "LANX — Local Network Messenger".to_string()
        };
        if let Some(tray) = app.tray_by_id("main") {
            let _ = tray.set_tooltip(Some(tip));
        }
    }
}
