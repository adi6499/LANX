//! Group meeting and recording commands (LANX 1.4.0). The window does the
//! WebRTC and the recording itself; see networking/meetings.rs and
//! recordings.rs.

use super::{AppState, err, guard_conversation};
use crate::networking::meetings::{MeetingChatLine, MeetingInfo};
use serde::Serialize;
use tauri::State;

#[tauri::command]
pub async fn meeting_start(
    state: State<'_, AppState>,
    conversation_id: String,
    video: bool,
    title: Option<String>,
) -> Result<MeetingInfo, String> {
    guard_conversation(&state, &conversation_id)?;
    state.network.start_meeting(&conversation_id, video, title).await
}

/// Invites more colleagues; returns who couldn't be invited and why.
#[tauri::command]
pub async fn meeting_invite(state: State<'_, AppState>, meeting_id: String, peer_ids: Vec<String>) -> Result<Vec<String>, String> {
    state.network.invite_to_meeting(&meeting_id, &peer_ids).await
}

/// Joining works from the lock screen too (like answering a call).
#[tauri::command]
pub async fn meeting_join(state: State<'_, AppState>, meeting_id: String) -> Result<MeetingInfo, String> {
    state.network.join_meeting(&meeting_id).await
}

/// "Join again" on a meeting line in a chat.
#[tauri::command]
pub async fn meeting_rejoin(state: State<'_, AppState>, message_id: String) -> Result<MeetingInfo, String> {
    state.network.privacy.guard()?;
    state.network.rejoin_meeting(&message_id).await
}

#[tauri::command]
pub async fn meeting_decline(state: State<'_, AppState>, meeting_id: String) -> Result<(), String> {
    state.network.decline_meeting(&meeting_id).await
}

#[tauri::command]
pub async fn meeting_leave(state: State<'_, AppState>, meeting_id: String) -> Result<(), String> {
    state.network.leave_meeting(&meeting_id).await
}

#[tauri::command]
pub async fn meeting_signal(
    state: State<'_, AppState>,
    meeting_id: String,
    to: String,
    kind: String,
    sdp: String,
) -> Result<(), String> {
    state.network.meeting_signal(&meeting_id, &to, &kind, sdp).await
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn meeting_media(
    state: State<'_, AppState>,
    meeting_id: String,
    muted: Option<bool>,
    camera: Option<bool>,
    screen: Option<bool>,
    hand: Option<bool>,
    recording: Option<bool>,
) -> Result<(), String> {
    state
        .network
        .meeting_media(&meeting_id, muted, camera, screen, hand, recording)
        .await
}

#[tauri::command]
pub async fn meeting_chat(state: State<'_, AppState>, meeting_id: String, text: String) -> Result<MeetingChatLine, String> {
    state.network.meeting_chat(&meeting_id, &text).await
}

#[tauri::command]
pub fn meeting_drop(state: State<AppState>, meeting_id: String, peer_id: String) {
    state.network.meeting_drop(&meeting_id, &peer_id);
}

#[tauri::command]
pub fn get_meeting(state: State<AppState>) -> Option<MeetingInfo> {
    state.network.current_meeting()
}

// ------------------------------------------------------------- recordings

#[derive(Serialize)]
pub struct RecordingStarted {
    pub id: String,
    pub name: String,
}

#[tauri::command]
pub fn recording_begin(title: String, ext: String) -> Result<RecordingStarted, String> {
    let (id, name) = crate::recordings::begin(&title, &ext)?;
    Ok(RecordingStarted { id, name })
}

/// A piece of the recording, sent as raw bytes with the recording's id in the
/// `x-recording` header.
#[tauri::command]
pub fn recording_chunk(request: tauri::ipc::Request<'_>) -> Result<u64, String> {
    let id = request
        .headers()
        .get("x-recording")
        .and_then(|v| v.to_str().ok())
        .ok_or("No recording id")?
        .to_string();
    match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => crate::recordings::append(&id, bytes),
        _ => Err("Expected recording data".to_string()),
    }
}

/// Finishes the recording and puts a line in the chat ("Recording saved").
#[tauri::command]
pub fn recording_end(
    state: State<AppState>,
    id: String,
    conversation_id: Option<String>,
    title: String,
    kind: String,
    secs: i64,
) -> Result<String, String> {
    let (path, size) = crate::recordings::finish(&id)?;
    let path_text = path.to_string_lossy().to_string();
    if let Some(conv) = conversation_id.filter(|c| !c.is_empty()) {
        let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let content = serde_json::json!({
            "path": path_text,
            "name": name,
            "size": size,
            "secs": secs.max(0),
            "kind": if kind == "call" { "call" } else { "meeting" },
            "title": title.chars().take(80).collect::<String>(),
        })
        .to_string();
        state.network.add_recording_line(&conv, &content);
    }
    Ok(path_text)
}

#[tauri::command]
pub fn recording_cancel(id: String) {
    crate::recordings::cancel(&id);
}

#[tauri::command]
pub fn open_recording(path: String) -> Result<(), String> {
    let p = crate::recordings::inside_folder(&path).ok_or("This recording was moved or deleted.")?;
    tauri_plugin_opener::open_path(p.to_string_lossy().to_string(), None::<&str>).map_err(err)
}

#[tauri::command]
pub fn reveal_recording(path: String) -> Result<(), String> {
    let p = crate::recordings::inside_folder(&path).ok_or("This recording was moved or deleted.")?;
    tauri_plugin_opener::reveal_item_in_dir(p).map_err(err)
}

#[tauri::command]
pub fn open_recordings_folder() -> Result<String, String> {
    let dir = crate::recordings::folder();
    std::fs::create_dir_all(&dir).map_err(err)?;
    tauri_plugin_opener::open_path(dir.to_string_lossy().to_string(), None::<&str>).map_err(err)?;
    Ok(dir.to_string_lossy().to_string())
}
