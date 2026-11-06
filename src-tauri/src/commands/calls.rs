//! Voice and video call commands. The window does the WebRTC part and hands
//! its offer/answer to these; see networking/calls.rs.

use super::{AppState, guard_conversation};
use crate::networking::calls::CallInfo;
use tauri::State;

#[tauri::command]
pub async fn call_start(
    state: State<'_, AppState>,
    conversation_id: String,
    video: bool,
    sdp: String,
    help: Option<String>,
) -> Result<CallInfo, String> {
    guard_conversation(&state, &conversation_id)?;
    state.network.start_call(&conversation_id, video, sdp, help).await
}

/// Answering works from the lock screen too (like a phone); the chats stay locked.
#[tauri::command]
pub async fn call_answer(
    state: State<'_, AppState>,
    call_id: String,
    sdp: String,
    video: bool,
) -> Result<CallInfo, String> {
    state.network.answer_call(&call_id, sdp, video).await
}

#[tauri::command]
pub async fn call_decline(state: State<'_, AppState>, call_id: String) -> Result<(), String> {
    state.network.decline_call(&call_id).await
}

#[tauri::command]
pub async fn call_hangup(state: State<'_, AppState>, call_id: String) -> Result<(), String> {
    crate::remote::stop_for_call(&call_id);
    state.network.hangup_call(&call_id).await
}

#[tauri::command]
pub async fn call_media(
    state: State<'_, AppState>,
    call_id: String,
    video: Option<bool>,
    muted: Option<bool>,
    screen: Option<bool>,
    recording: Option<bool>,
    reaction: Option<String>,
) -> Result<(), String> {
    state.network.call_media(&call_id, video, muted, screen, recording, reaction).await
}

#[tauri::command]
pub fn get_call(state: State<AppState>) -> Option<CallInfo> {
    state.network.current_call()
}
