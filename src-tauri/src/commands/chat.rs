//! LANX 1.5.0 chat commands: replies and @mentions, reactions, edit / delete,
//! pins, stars, "remind me", "send later" and voice notes.

use super::{AppState, err, guard_conversation};
use crate::networking::transfer::SentFile;
use crate::storage::models::{Message, ScheduledMessage, SearchHit};
use tauri::State;

/// A message that may answer another one and @mention group members.
#[tauri::command]
pub async fn send_message_ex(
    state: State<'_, AppState>,
    conversation_id: String,
    content: String,
    reply_to: Option<String>,
    mentions: Option<Vec<String>>,
) -> Result<Message, String> {
    guard_conversation(&state, &conversation_id)?;
    state
        .network
        .send_message_full(&conversation_id, &content, reply_to, mentions.unwrap_or_default())
        .await
}

#[tauri::command]
pub fn react_message(state: State<AppState>, message_id: String, emoji: String) -> Result<Message, String> {
    state.network.privacy.guard()?;
    state.network.react_to_message(&message_id, &emoji)
}

#[tauri::command]
pub fn edit_message(
    state: State<AppState>,
    message_id: String,
    content: String,
    mentions: Option<Vec<String>>,
) -> Result<Message, String> {
    state.network.privacy.guard()?;
    state.network.edit_message(&message_id, &content, &mentions.unwrap_or_default())
}

#[tauri::command]
pub async fn delete_message_everyone(state: State<'_, AppState>, message_id: String) -> Result<Message, String> {
    state.network.privacy.guard()?;
    state.network.delete_for_everyone(&message_id).await
}

#[tauri::command]
pub fn delete_message_local(state: State<AppState>, message_id: String) -> Result<(), String> {
    state.network.privacy.guard()?;
    state.network.delete_for_me(&message_id)
}

#[tauri::command]
pub fn pin_message(state: State<AppState>, message_id: String, pinned: bool) -> Result<Message, String> {
    state.network.privacy.guard()?;
    state.network.pin_message(&message_id, pinned)
}

#[tauri::command]
pub fn star_message(state: State<AppState>, message_id: String, starred: bool) -> Result<Message, String> {
    state.network.privacy.guard()?;
    state.network.star_message(&message_id, starred)
}

/// Starred messages from every chat (hidden chats only when unlocked).
#[tauri::command(async)]
pub fn list_starred(state: State<AppState>) -> Result<Vec<SearchHit>, String> {
    let privacy = &state.network.privacy;
    privacy.guard()?;
    state.db.starred_messages(privacy.hidden_unlocked()).map_err(err)
}

#[tauri::command]
pub fn set_reminder(state: State<AppState>, message_id: String, remind_at: i64, no_reply: Option<bool>) -> Result<Message, String> {
    state.network.privacy.guard()?;
    state.network.set_reminder_ex(&message_id, remind_at, no_reply.unwrap_or(false))
}

/// LANX 2.2.0: forward messages (and files) to chats.
#[tauri::command]
pub async fn forward_messages(
    state: State<'_, AppState>,
    message_ids: Vec<String>,
    conversation_ids: Vec<String>,
) -> Result<crate::networking::everyday::ForwardResult, String> {
    state.network.privacy.guard()?;
    for c in &conversation_ids {
        super::guard_conversation(&state, c)?;
    }
    state.network.forward_messages(&message_ids, &conversation_ids).await
}

/// LANX 2.2.0: "Mark as unread" in the chat list.
#[tauri::command]
pub fn mark_chat_unread(state: State<AppState>, conversation_id: String) -> Result<crate::storage::models::Conversation, String> {
    super::guard_conversation(&state, &conversation_id)?;
    state.db.mark_unread(&conversation_id).map_err(|e| e.to_string())?;
    state.network.events.update_tray(&state.db);
    state
        .db
        .get_conversation(&conversation_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Chat not found".to_string())
}

/// LANX 2.2.0: why can or can't LANX reach this colleague?
#[tauri::command]
pub async fn check_connection(
    state: State<'_, AppState>,
    peer_id: String,
) -> Result<crate::networking::everyday::ConnectionCheck, String> {
    state.network.check_connection(&peer_id).await
}

#[tauri::command]
pub fn cancel_reminder(state: State<AppState>, message_id: String) -> Result<Message, String> {
    state.network.privacy.guard()?;
    state.network.cancel_reminder(&message_id)
}

#[tauri::command]
pub fn schedule_message(
    state: State<AppState>,
    conversation_id: String,
    content: String,
    send_at: i64,
    reply_to: Option<String>,
    mentions: Option<Vec<String>>,
) -> Result<ScheduledMessage, String> {
    guard_conversation(&state, &conversation_id)?;
    state
        .network
        .schedule_message(&conversation_id, &content, send_at, reply_to, mentions.unwrap_or_default())
}

#[tauri::command]
pub fn cancel_scheduled(state: State<AppState>, id: String, conversation_id: String) -> Result<(), String> {
    state.network.privacy.guard()?;
    state.network.cancel_scheduled(&id, &conversation_id)
}

#[tauri::command(async)]
pub fn list_scheduled(state: State<AppState>, conversation_id: String) -> Result<Vec<ScheduledMessage>, String> {
    guard_conversation(&state, &conversation_id)?;
    Ok(state.network.list_scheduled(&conversation_id))
}

/// A recorded voice note: raw bytes, with the chat, length and file type in
/// the `x-conversation`, `x-duration-ms` and `x-ext` headers.
#[tauri::command]
pub async fn send_voice_note(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> Result<Vec<SentFile>, String> {
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string())
    };
    let conversation_id = header("x-conversation").ok_or("No chat")?;
    let media_ms: u64 = header("x-duration-ms").and_then(|v| v.parse().ok()).unwrap_or(0);
    let ext = header("x-ext").unwrap_or_else(|| "webm".to_string());
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected the recording".to_string());
    };
    guard_conversation(&state, &conversation_id)?;
    state.network.send_voice_note(&conversation_id, bytes, media_ms, &ext).await
}

/// The sound of a voice note (raw bytes).
#[tauri::command(async)]
pub fn read_voice_note(state: State<AppState>, transfer_id: String) -> Result<tauri::ipc::Response, String> {
    state.network.privacy.guard()?;
    Ok(tauri::ipc::Response::new(state.network.voice_note_bytes(&transfer_id)?))
}
