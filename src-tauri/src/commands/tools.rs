//! LANX 1.7.0 tools: chat folders / mute / archive / pin, search with
//! filters, stickers, screenshots, "Send to → LANX" and shared folders.

use super::{AppState, err, guard_conversation};
use crate::networking::now_secs;
use crate::storage::models::{Conversation, Message, SearchHit};
use crate::storage::tools::{SearchFilter, SyncShare, SyncSubscription};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

fn conversation(state: &AppState, id: &str) -> Result<Conversation, String> {
    state.db.get_conversation(id).map_err(err)?.ok_or_else(|| "Chat not found".to_string())
}

#[tauri::command]
pub fn set_chat_pinned(state: State<AppState>, conversation_id: String, pinned: bool) -> Result<Conversation, String> {
    guard_conversation(&state, &conversation_id)?;
    state.db.set_conversation_pinned(&conversation_id, pinned).map_err(err)?;
    conversation(&state, &conversation_id)
}

/// `minutes`: how long (-1 = until turned back on, 0 = turn sounds back on).
#[tauri::command]
pub fn set_chat_muted(state: State<AppState>, conversation_id: String, minutes: i64) -> Result<Conversation, String> {
    guard_conversation(&state, &conversation_id)?;
    let until = match minutes {
        m if m < 0 => -1,
        0 => 0,
        m => now_secs() + m.min(60 * 24 * 366) * 60,
    };
    state.db.set_conversation_muted(&conversation_id, until).map_err(err)?;
    state.network.events.update_tray(&state.db);
    conversation(&state, &conversation_id)
}

#[tauri::command]
pub fn set_chat_archived(state: State<AppState>, conversation_id: String, archived: bool) -> Result<Conversation, String> {
    guard_conversation(&state, &conversation_id)?;
    state.db.set_conversation_archived(&conversation_id, archived).map_err(err)?;
    conversation(&state, &conversation_id)
}

/// The chat folders a chat is in (ids from Settings → chat folders).
#[tauri::command]
pub fn set_chat_folders(state: State<AppState>, conversation_id: String, folders: Vec<String>) -> Result<Conversation, String> {
    guard_conversation(&state, &conversation_id)?;
    let known: Vec<String> = state.db.get_settings().map_err(err)?.chat_folders.into_iter().map(|f| f.id).collect();
    let mut list: Vec<String> = folders.into_iter().filter(|f| known.contains(f)).collect();
    list.dedup();
    state.db.set_conversation_folders(&conversation_id, &list).map_err(err)?;
    conversation(&state, &conversation_id)
}

#[tauri::command]
pub fn search_messages_ex(state: State<AppState>, query: String, filter: SearchFilter) -> Result<Vec<SearchHit>, String> {
    let privacy = &state.network.privacy;
    privacy.guard()?;
    state.db.search_messages_ex(&query, &filter, 300, privacy.hidden_unlocked()).map_err(err)
}

/// The chat message a file was sent in (file library → "Show in chat").
#[tauri::command]
pub fn message_for_transfer(state: State<AppState>, transfer_id: String) -> Result<Option<Message>, String> {
    let privacy = &state.network.privacy;
    privacy.guard()?;
    let m = state.db.message_for_transfer(&transfer_id).map_err(err)?;
    Ok(m.filter(|m| privacy.hidden_unlocked() || !state.db.is_conversation_hidden(&m.conversation_id)))
}

// ------------------------------------------------------------------ stickers

#[derive(Serialize)]
pub struct Sticker {
    id: &'static str,
    emoji: &'static str,
    words: &'static str,
}

#[tauri::command]
pub fn list_stickers() -> Vec<Sticker> {
    crate::networking::tools::STICKERS.iter().map(|(id, emoji, words)| Sticker { id, emoji, words }).collect()
}

#[tauri::command]
pub async fn send_sticker(state: State<'_, AppState>, conversation_id: String, id: String) -> Result<Message, String> {
    guard_conversation(&state, &conversation_id)?;
    state.network.send_sticker(&conversation_id, &id).await
}

// --------------------------------------------------------------- screenshots

/// Hides LANX, pictures the whole screen, shows LANX again.
#[tauri::command]
pub async fn capture_screen(app: AppHandle, state: State<'_, AppState>) -> Result<tauri::ipc::Response, String> {
    state.network.privacy.guard()?;
    let main = app.get_webview_window("main");
    if let Some(w) = &main {
        let _ = w.hide();
    }
    tokio::time::sleep(std::time::Duration::from_millis(350)).await;
    let shot = tauri::async_runtime::spawn_blocking(crate::shell::capture_screen).await.map_err(err)?;
    if let Some(w) = &main {
        let _ = w.show();
        let _ = w.set_focus();
    }
    Ok(tauri::ipc::Response::new(crate::shell::capture_bytes(shot?)))
}

/// The picture taken with Ctrl + Alt + S (once).
#[tauri::command]
pub fn take_hotkey_capture(state: State<AppState>) -> Result<tauri::ipc::Response, String> {
    state.network.privacy.guard()?;
    let shot = crate::shell::take_last_capture().ok_or("No screenshot waiting")?;
    Ok(tauri::ipc::Response::new(crate::shell::capture_bytes(shot)))
}

/// Saves an edited screenshot to Pictures\LANX Screenshots and shows it.
#[tauri::command]
pub fn save_screenshot(state: State<AppState>, data_base64: String) -> Result<String, String> {
    state.network.privacy.guard()?;
    let tmp = state.network.save_pasted_image(&data_base64, "image/png")?;
    let dir = dirs::picture_dir().unwrap_or_else(|| dirs::home_dir().unwrap_or_default()).join("LANX Screenshots");
    std::fs::create_dir_all(&dir).map_err(err)?;
    let name = tmp.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "Screenshot.png".to_string());
    let path = crate::networking::transfer::unique_destination(&dir, &name);
    std::fs::rename(&tmp, &path).or_else(|_| std::fs::copy(&tmp, &path).map(|_| ())).map_err(err)?;
    Ok(path.to_string_lossy().to_string())
}

#[derive(Serialize)]
pub struct ToolsStatus {
    hotkey: &'static str,
    hotkey_working: bool,
}

#[tauri::command]
pub fn get_tools_status() -> ToolsStatus {
    ToolsStatus { hotkey: crate::shell::HOTKEY_LABEL, hotkey_working: crate::shell::hotkey_working() }
}

/// Files and folders from Explorer's "Send to → LANX" (once).
#[tauri::command]
pub fn take_send_request(state: State<AppState>) -> Result<Vec<String>, String> {
    state.network.privacy.guard()?;
    Ok(crate::shell::take_send_request())
}

// ------------------------------------------------------------ shared folders

#[tauri::command]
pub async fn pick_folder(app: AppHandle, title: String) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut builder = app.dialog().file().set_title(title);
    if let Some(w) = app.get_webview_window("main") {
        builder = builder.set_parent(&w);
    }
    builder.pick_folder(move |folder| {
        let _ = tx.send(folder);
    });
    Ok(rx.await.map_err(err)?.and_then(|f| f.into_path().ok()).map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn share_folder(state: State<'_, AppState>, conversation_id: String, path: String) -> Result<Message, String> {
    guard_conversation(&state, &conversation_id)?;
    state.network.share_folder(&conversation_id, &path).await
}

#[tauri::command]
pub async fn subscribe_folder(state: State<'_, AppState>, message_id: String, dest: String) -> Result<SyncSubscription, String> {
    state.network.privacy.guard()?;
    state.network.subscribe_folder(&message_id, &dest).await
}

#[tauri::command]
pub async fn unsubscribe_folder(state: State<'_, AppState>, share_id: String) -> Result<(), String> {
    state.network.privacy.guard()?;
    state.network.unsubscribe_folder(&share_id).await
}

#[tauri::command]
pub async fn stop_sharing_folder(state: State<'_, AppState>, share_id: String) -> Result<(), String> {
    state.network.privacy.guard()?;
    state.network.stop_sharing_folder(&share_id).await
}

#[tauri::command]
pub fn resync_folder(state: State<AppState>, share_id: String) -> Result<(), String> {
    state.network.privacy.guard()?;
    state.network.resync_folder(&share_id)
}

#[derive(Serialize)]
pub struct SharedFolderInfo {
    #[serde(flatten)]
    share: SyncShare,
    waiting: i64,
}

#[derive(Serialize)]
pub struct SyncOverview {
    shares: Vec<SharedFolderInfo>,
    subscriptions: Vec<SyncSubscription>,
}

#[tauri::command]
pub fn list_sync(state: State<AppState>) -> Result<SyncOverview, String> {
    state.network.privacy.guard()?;
    let shares = state
        .db
        .sync_shares()
        .map_err(err)?
        .into_iter()
        .filter(|s| s.active)
        .map(|s| {
            let waiting = state.db.sync_pending_count(&s.id).unwrap_or(0);
            SharedFolderInfo { share: s, waiting }
        })
        .collect();
    Ok(SyncOverview { shares, subscriptions: state.db.sync_subscriptions().map_err(err)? })
}

/// Opens a shared folder (yours or your copy of a colleague's) in Explorer.
#[tauri::command]
pub fn open_sync_folder(app: AppHandle, state: State<AppState>, share_id: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    state.network.privacy.guard()?;
    let path = match state.db.sync_share(&share_id).map_err(err)? {
        Some(s) => s.path,
        None => state.db.sync_subscription(&share_id).map_err(err)?.ok_or("Shared folder not found")?.dest_path,
    };
    app.opener().open_path(path, None::<&str>).map_err(err)
}
