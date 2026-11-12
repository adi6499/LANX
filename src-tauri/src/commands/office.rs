//! LANX 1.8.0 office commands: emergency alerts and the intercom. (Visitor
//! and kudos cards use `send_card`; birthdays live in the profile; remote
//! help is `call_start` with `help`.)

use super::{AppState, guard_conversation};
use crate::networking::transfer::SentFile;
use crate::storage::office::AlertInfo;
use tauri::State;

#[tauri::command]
pub async fn raise_alert(state: State<'_, AppState>, kind: String, text: String) -> Result<AlertInfo, String> {
    state.network.privacy.guard()?;
    state.network.raise_alert(&kind, &text).await
}

/// Answers work even while LANX is locked (an emergency shows over the lock screen).
#[tauri::command]
pub async fn answer_alert(state: State<'_, AppState>, alert_id: String, status: String) -> Result<AlertInfo, String> {
    state.network.answer_alert(&alert_id, &status).await
}

#[tauri::command]
pub async fn clear_alert(state: State<'_, AppState>, alert_id: String) -> Result<AlertInfo, String> {
    state.network.clear_alert(&alert_id).await
}

#[tauri::command(async)]
pub fn list_alerts(state: State<AppState>) -> Vec<AlertInfo> {
    state.network.recent_alerts()
}

/// Push-to-talk: raw bytes, with the chat, length and file type in the
/// `x-conversation`, `x-duration-ms` and `x-ext` headers.
#[tauri::command]
pub async fn send_intercom(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> Result<Vec<SentFile>, String> {
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok()).map(|s| s.to_string());
    let conversation_id = header("x-conversation").ok_or("No chat")?;
    let media_ms: u64 = header("x-duration-ms").and_then(|v| v.parse().ok()).unwrap_or(0);
    let ext = header("x-ext").unwrap_or_else(|| "webm".to_string());
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected the recording".to_string());
    };
    guard_conversation(&state, &conversation_id)?;
    state.network.send_intercom(&conversation_id, bytes, media_ms, &ext).await
}
