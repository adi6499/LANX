//! LANX 2.0 remote control commands (see remote.rs). The window carries the
//! colleague's clicks and keys over the call's WebRTC link and hands them in
//! here; every command checks that the allowed call is still connected.

use super::AppState;
use crate::remote::{self, InputEvent, RemoteInfo};
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

#[tauri::command]
pub fn remote_input(state: State<AppState>, call_id: String, events: Vec<InputEvent>) -> Result<(), String> {
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
#[tauri::command]
pub fn clipboard_read(state: State<AppState>, call_id: String, since: u32) -> Result<ClipboardText, String> {
    active_call(&state, &call_id)?;
    let seq = remote::clipboard_seq();
    let text = if seq != since { remote::read_clipboard() } else { None };
    Ok(ClipboardText { seq, text })
}

#[tauri::command]
pub fn clipboard_write(state: State<AppState>, call_id: String, text: String) -> Result<u32, String> {
    active_call(&state, &call_id)?;
    remote::write_clipboard(&text)
}

/// Test copies only: what remote control would have done to the mouse and keyboard.
#[tauri::command]
pub fn remote_test_log() -> Result<Vec<String>, String> {
    crate::testmode::profile().ok_or("Only for test copies")?;
    Ok(remote::take_dry_log())
}

/// Test copies only: pretend the person copied `text`.
#[tauri::command]
pub fn remote_test_copy(text: String) -> Result<u32, String> {
    crate::testmode::profile().ok_or("Only for test copies")?;
    Ok(remote::test_copy(&text))
}
