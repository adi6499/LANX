//! LANX 2.0 remote control commands (see remote.rs). The window carries the
//! colleague's clicks and keys over the call's WebRTC link and hands them in
//! here; every command checks that the allowed call is still connected.

use super::AppState;
use crate::remote::{self, InputEvent, InputResult, RemoteInfo};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

fn active_call(state: &AppState, call_id: &str) -> Result<crate::networking::calls::CallInfo, String> {
    state
        .network
        .current_call()
        .filter(|c| c.call_id == call_id && c.phase == "active")
        .ok_or_else(|| "This call has ended.".to_string())
}

/// The person at this PC pressed Allow. `width` × `height`: the screen picture
/// they share (it tells LANX which screen the colleague sees).
#[tauri::command]
pub async fn remote_allow(
    app: AppHandle,
    state: State<'_, AppState>,
    call_id: String,
    width: u32,
    height: u32,
) -> Result<RemoteInfo, String> {
    let call = active_call(&state, &call_id)?;
    let name = if call.peer_name.is_empty() { "Your colleague".to_string() } else { call.peer_name.clone() };
    let net = state.network.clone();
    let id = call_id.clone();
    let still_ok = Box::new(move || net.current_call().is_some_and(|c| c.call_id == id && c.phase == "active"));
    remote::allow(&app, &call_id, &name, width, height, still_ok)
}

/// LANX 2.1.0: runs off the main thread (which is busy drawing), so their
/// clicks and keys are never kept waiting; the window sends one batch at a
/// time, so they still happen in order.
#[tauri::command]
pub async fn remote_input(state: State<'_, AppState>, call_id: String, events: Vec<InputEvent>) -> Result<InputResult, String> {
    if active_call(&state, &call_id).is_err() {
        remote::stop_for_call(&call_id);
        return Err("This call has ended.".to_string());
    }
    remote::input(&call_id, &events)
}

/// Stop (the bar, the call window, or the colleague let go).
#[tauri::command]
pub fn remote_stop() {
    remote::stop("stopped");
}

#[tauri::command]
pub fn remote_next_screen(state: State<AppState>, call_id: String) -> Result<RemoteInfo, String> {
    active_call(&state, &call_id)?;
    remote::next_screen(&call_id)
}

#[tauri::command]
pub fn remote_info() -> RemoteInfo {
    remote::info()
}

/// A colleague asks for control: bring LANX to the front so the question is seen.
#[tauri::command]
pub fn remote_attention(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.request_user_attention(Some(tauri::UserAttentionType::Critical));
    }
}

#[derive(Serialize)]
pub struct ClipboardText {
    pub seq: u32,
    /// The copied text when it changed since `since` (and is text).
    pub text: Option<String>,
}

/// Copy and paste between the two PCs while one controls the other: only
/// during a connected call.
/// (Off the main thread too: another program may hold the clipboard a moment.)
#[tauri::command]
pub async fn clipboard_read(state: State<'_, AppState>, call_id: String, since: u32) -> Result<ClipboardText, String> {
    active_call(&state, &call_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let seq = remote::clipboard_seq();
        let text = if seq != since { remote::read_clipboard() } else { None };
        ClipboardText { seq, text }
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clipboard_write(state: State<'_, AppState>, call_id: String, text: String) -> Result<u32, String> {
    active_call(&state, &call_id)?;
    tauri::async_runtime::spawn_blocking(move || remote::write_clipboard(&text))
        .await
        .map_err(|e| e.to_string())?
}

/// Test copies only: what remote control would have done to the mouse and keyboard.
#[tauri::command]
pub fn remote_test_log() -> Result<Vec<String>, String> {
    crate::testmode::profile().ok_or("Only for test copies")?;
    Ok(remote::take_dry_log())
}

/// Test copies only: pretend Windows refuses their input (an admin program in front).
#[tauri::command]
pub fn remote_test_block(on: bool) -> Result<(), String> {
    crate::testmode::profile().ok_or("Only for test copies")?;
    remote::test_block(on);
    Ok(())
}

/// Test copies only: pretend the person copied `text`.
#[tauri::command]
pub fn remote_test_copy(text: String) -> Result<u32, String> {
    crate::testmode::profile().ok_or("Only for test copies")?;
    Ok(remote::test_copy(&text))
}

/// LANX 3.7.0: hand gestures drive this PC's own mouse and keyboard ("Control
/// the whole PC" and the air keyboard).
#[tauri::command]
pub fn hand_input(screen: usize, ops: Vec<remote::HandInput>) -> Result<(), String> {
    if ops.len() > 64 {
        return Err("Too much at once".to_string());
    }
    remote::hand_input(screen, &ops)
}

/// The screens hands can drive, in real pixels (the main one is marked).
#[tauri::command]
pub fn hand_screens() -> Vec<remote::Screen> {
    remote::screens()
}

/// LANX 3.7.0: "lock this PC" (a sign or a spoken command).
#[tauri::command]
pub fn lock_pc() -> Result<(), String> {
    remote::lock_pc()
}

/// Where the hands window is, in real pixels, and its screen's scale.
#[derive(Serialize)]
pub struct HudRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub scale: f64,
}

/// LANX 3.7.0: the small always-on-top window while hands control the whole PC
/// (the air keyboard and short notes), at the bottom of `screen`. `width` and
/// `height` are CSS pixels; 0 hides it. It never takes the keyboard (typing
/// goes to the program in front) and the real mouse clicks straight through it.
/// (async: a window made in a plain command can hang on Windows.)
#[tauri::command]
pub async fn hand_hud(app: AppHandle, screen: usize, width: f64, height: f64) -> Result<Option<HudRect>, String> {
    let existing = app.get_webview_window("hud");
    if !(width > 0.0 && height > 0.0) {
        if let Some(w) = existing {
            let _ = w.hide();
        }
        return Ok(None);
    }
    let w = match existing {
        Some(w) => w,
        None => tauri::WebviewWindowBuilder::new(&app, "hud", tauri::WebviewUrl::App("index.html".into()))
            .title("LANX hands")
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .focused(false)
            .focusable(false)
            .visible(false)
            .disable_drag_drop_handler()
            .build()
            .map_err(|e| e.to_string())?,
    };
    let _ = w.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
    let _ = w.set_ignore_cursor_events(true);
    let all = remote::screens();
    let s = all.get(screen).or_else(|| all.iter().find(|s| s.primary)).copied();
    let (wl, wt, ww, wh, left, top) = s.map(|s| (s.work_left, s.work_top, s.work_width, s.work_height, s.left, s.top)).unwrap_or((0, 0, 1920, 1040, 0, 0));
    let scale = app
        .available_monitors()
        .ok()
        .and_then(|ms| ms.into_iter().find(|m| m.position().x == left && m.position().y == top).map(|m| m.scale_factor()))
        .unwrap_or(1.0);
    let pw = (width * scale).round().min(ww.max(1) as f64) as i32;
    let ph = (height * scale).round().min(wh.max(1) as f64) as i32;
    let x = wl + (ww - pw) / 2;
    let y = wt + wh - ph - (12.0 * scale).round() as i32;
    let _ = w.set_size(tauri::PhysicalSize::new(pw as u32, ph as u32));
    let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
    crate::events::show_without_focus(&w);
    Ok(Some(HudRect { x, y, width: pw, height: ph, scale }))
}
