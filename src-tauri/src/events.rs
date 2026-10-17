//! Typed events sent to the React UI, plus desktop notifications and the tray
//! tooltip. Everything is a no-op when there is no app handle (unit tests).

use crate::storage::Database;
use crate::storage::models::{Conversation, Message, Peer, TransferRecord};
use parking_lot::Mutex;
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Default)]
pub struct Events {
    app: Option<AppHandle>,
    /// Alerts waiting for the desktop island window to pick them up.
    island: Arc<Mutex<Vec<IslandAlert>>>,
}

/// LANX 1.2.7: an alert for the desktop Dynamic Island, the small window at
/// the top of the screen that shows (with the delivery cat) new messages and
/// files while LANX is hidden or behind other programs.
#[derive(Serialize, Clone, Debug, Default)]
pub struct IslandAlert {
    pub id: String,
    /// "message" | "file"
    pub kind: String,
    pub title: String,
    pub body: String,
    pub conversation_id: Option<String>,
    pub avatar_color: Option<String>,
    /// Group name, for group messages.
    pub group: Option<String>,
    pub transfer_id: Option<String>,
    pub file_name: Option<String>,
    pub file_size: Option<i64>,
    /// The file waits for the user's OK (Accept / Later buttons).
    pub needs_accept: bool,
    /// Hidden chat or locked LANX: nothing personal is shown, no buttons.
    pub private: bool,
}

/// Size of the island window (logical pixels): room for the island, the cat
/// hanging below it and the cat's speech bubble.
pub const ISLAND_W: f64 = 560.0;
pub const ISLAND_H: f64 = 330.0;


#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AlertKind {
    Message,
    File,
    Ring,
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
        Self { app, island: Arc::default() }
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

    /// A LANX update was offered, downloaded, checked or shared; the UI asks
    /// for the new update status.
    pub fn update_changed(&self) {
        self.emit("lanx://update-changed", ());
    }

    fn main_window_focused(app: &AppHandle) -> bool {
        app.get_webview_window("main")
            .map(|w| w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false))
            .unwrap_or(false)
    }

    /// Generic event for the UI.
    pub fn emit_json<S: Serialize + Clone>(&self, event: &str, payload: S) {
        self.emit(event, payload);
    }

    /// Plays LANX's own sound for this kind of alert (if sounds are on).
    pub fn play_sound(&self, db: &Database, kind: AlertKind) {
        if self.app.is_none() {
            return; // unit tests
        }
        let Ok(s) = db.get_settings() else { return };
        if !s.sound_enabled {
            return;
        }
        let name = match kind {
            AlertKind::Ring => "bell",
            _ => s.sound_choice.as_str(),
        };
        crate::sound::play(name, &s.custom_sound_path, s.sound_volume);
    }

    /// New message / file: when LANX is not in front, plays the LANX sound and
    /// shows a Windows notification. A ring always sounds and flashes the
    /// taskbar until the user looks.
    pub fn notify(&self, db: &Database, kind: AlertKind, title: &str, body: &str) {
        let Some(app) = &self.app else { return };
        let settings = db.get_settings().ok();
        let focused = Self::main_window_focused(app);
        if focused && kind != AlertKind::Ring {
            return;
        }
        let sound_on = settings.as_ref().map(|s| s.sound_enabled).unwrap_or(true);
        self.play_sound(db, kind);
        if settings.as_ref().map(|s| s.notifications_enabled).unwrap_or(true) && !focused {
            use tauri_plugin_notification::NotificationExt;
            let mut builder = app.notification().builder().title(title).body(body);
            if sound_on {
                builder = builder.silent(); // LANX already played its own sound
            }
            let _ = builder.show();
        }
        if let Some(w) = app.get_webview_window("main") {
            let attention = if kind == AlertKind::Ring {
                tauri::UserAttentionType::Critical
            } else {
                tauri::UserAttentionType::Informational
            };
            if !focused {
                let _ = w.request_user_attention(Some(attention));
            }
        }
    }

    /// New message / file with details for the desktop island: when LANX is
    /// not in front and notifications are on, the island (with the cat)
    /// replaces the Windows notification. Otherwise as `notify`.
    pub fn notify_island(&self, db: &Database, kind: AlertKind, title: &str, body: &str, alert: IslandAlert) {
        let Some(app) = &self.app else { return };
        let notifications = db.get_settings().map(|s| s.notifications_enabled).unwrap_or(true);
        if notifications && !Self::main_window_focused(app) && self.show_island(app, alert) {
            self.play_sound(db, kind);
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.request_user_attention(Some(tauri::UserAttentionType::Informational));
            }
            return;
        }
        self.notify(db, kind, title, body);
    }

    /// Queues the alert and shows the island window at the top centre of the
    /// screen without taking the keyboard away from what the user is doing.
    fn show_island(&self, app: &AppHandle, alert: IslandAlert) -> bool {
        let Some(w) = app.get_webview_window("island") else { return false };
        {
            let mut q = self.island.lock();
            q.retain(|a| a.id != alert.id);
            q.push(alert);
            let extra = q.len().saturating_sub(6);
            q.drain(0..extra);
        }
        place_island(app, &w);
        show_without_focus(&w);
        move_to_current_desktop(&w);
        let _ = app.emit_to("island", "lanx://island-alert", ());
        true
    }

    /// The island window collects the alerts waiting for it.
    pub fn island_take(&self) -> Vec<IslandAlert> {
        std::mem::take(&mut *self.island.lock())
    }

    /// Incoming call: bring LANX to the front, flash the taskbar and show a
    /// notification. (The ringtone itself is played by the call code.)
    pub fn incoming_call(&self, db: &Database, title: &str) {
        let Some(app) = &self.app else { return };
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.request_user_attention(Some(tauri::UserAttentionType::Critical));
        }
        let notifications = db.get_settings().map(|s| s.notifications_enabled).unwrap_or(true);
        if notifications && !Self::main_window_focused(app) {
            use tauri_plugin_notification::NotificationExt;
            let _ = app
                .notification()
                .builder()
                .title(title)
                .body("Open LANX to answer")
                .silent()
                .show();
        }
    }

    pub fn update_tray(&self, db: &Database) {
        // (also see place_island / show_without_focus below)
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

/// The screen the user is working on (where the window in front is), so the
/// island appears there; else LANX's own screen, else the main screen.
fn active_monitor(app: &AppHandle) -> Option<tauri::Monitor> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::RECT;
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowRect};
        // SAFETY: plain Win32 queries on the current foreground window.
        let centre = unsafe {
            let fg = GetForegroundWindow();
            let mut r: RECT = std::mem::zeroed();
            (!fg.is_null() && GetWindowRect(fg, &mut r) != 0).then(|| ((r.left + r.right) / 2, (r.top + r.bottom) / 2))
        };
        if let (Some((cx, cy)), Ok(monitors)) = (centre, app.available_monitors()) {
            let found = monitors.into_iter().find(|m| {
                let (p, s) = (m.position(), m.size());
                cx >= p.x && cx < p.x + s.width as i32 && cy >= p.y && cy < p.y + s.height as i32
            });
            if found.is_some() {
                return found;
            }
        }
    }
    app.get_webview_window("main")
        .and_then(|m| m.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())
}

/// Puts the island window at the top centre of the screen in use.
pub fn place_island(app: &AppHandle, w: &tauri::WebviewWindow) {
    if let Some(m) = active_monitor(app) {
        let scale = m.scale_factor();
        let width = (ISLAND_W * scale).round() as i32;
        let pos = m.position();
        let x = pos.x + (m.size().width as i32 - width) / 2;
        let y = pos.y + (4.0 * scale).round() as i32;
        let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
    }
}

/// Shows a window on top of everything without activating it, so typing in
/// another program is never interrupted.
#[cfg(windows)]
fn show_without_focus(w: &tauri::WebviewWindow) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, ShowWindow, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SW_SHOWNOACTIVATE,
    };
    match w.hwnd() {
        Ok(h) => unsafe {
            let hwnd = h.0 as _;
            ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
        },
        Err(_) => {
            let _ = w.show();
        }
    }
}

#[cfg(not(windows))]
fn show_without_focus(w: &tauri::WebviewWindow) {
    let _ = w.show();
}

/// Windows virtual desktops (Win+Tab): bring the island to the desktop the
/// user is on, so it is never shown on a desktop nobody is looking at.
#[cfg(windows)]
fn move_to_current_desktop(w: &tauri::WebviewWindow) {
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};
    use windows::Win32::UI::Shell::{IVirtualDesktopManager, VirtualDesktopManager};
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    let Ok(hwnd) = w.hwnd() else { return };
    // SAFETY: documented COM interface, used on our own window only.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let Ok(mgr) = CoCreateInstance::<_, IVirtualDesktopManager>(&VirtualDesktopManager, None, CLSCTX_ALL) else {
            return;
        };
        if mgr.IsWindowOnCurrentVirtualDesktop(hwnd).map(|b| b.as_bool()).unwrap_or(true) {
            return;
        }
        let fg = GetForegroundWindow();
        if fg.is_invalid() {
            return;
        }
        if let Ok(id) = mgr.GetWindowDesktopId(fg) {
            let _ = mgr.MoveWindowToDesktop(hwnd, &id);
        }
    }
}

#[cfg(not(windows))]
fn move_to_current_desktop(_w: &tauri::WebviewWindow) {}
