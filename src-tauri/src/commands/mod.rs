pub mod backup;
pub mod calls;

use crate::discovery::{DiscoveryService, local_ipv4_addresses};
use crate::networking::NetworkService;
use crate::networking::session::{ExpectedPeer, SecureChannel};
use crate::networking::transfer::SentFile;
use crate::security::DeviceIdentity;
use crate::storage::Database;
use crate::storage::models::*;
use std::net::IpAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_dialog::DialogExt;

pub struct AppState {
    pub db: Arc<Database>,
    pub network: NetworkService,
    pub discovery: Arc<DiscoveryService>,
    pub identity: Arc<DeviceIdentity>,
}

pub(crate) fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Turns "start with Windows" on or off to match the setting.
pub fn apply_autostart(app: &AppHandle, enabled: bool) {
    if crate::testmode::profile().is_some() {
        return; // side-by-side test copies never touch the real startup entry
    }
    let launcher = app.autolaunch();
    let current = launcher.is_enabled().unwrap_or(false);
    if enabled && !current {
        let _ = launcher.enable();
    } else if !enabled && current {
        let _ = launcher.disable();
    }
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Result<UserSettings, String> {
    state.db.get_settings().map_err(err)
}

#[tauri::command]
pub fn save_settings(
    app: AppHandle,
    state: State<AppState>,
    settings: UserSettings,
) -> Result<UserSettings, String> {
    state.network.privacy.guard()?;
    if settings.display_name.trim().is_empty() {
        return Err("Display name cannot be empty".to_string());
    }
    if settings.sound_choice == "custom" && !settings.custom_sound_path.is_empty() {
        crate::sound::load_custom(&settings.custom_sound_path)?;
    }
    state.db.save_settings(&settings).map_err(err)?;
    if settings.onboarding_completed {
        apply_autostart(&app, settings.launch_at_startup);
    }
    state.db.get_settings().map_err(err)
}

#[tauri::command]
pub fn complete_onboarding(
    app: AppHandle,
    state: State<AppState>,
    display_name: String,
    avatar_color: String,
    launch_at_startup: Option<bool>,
) -> Result<UserSettings, String> {
    let mut current = state.db.get_settings().map_err(err)?;
    let name = display_name.trim();
    if !name.is_empty() {
        current.display_name = name.to_string();
    }
    current.avatar_color = avatar_color;
    current.onboarding_completed = true;
    if let Some(v) = launch_at_startup {
        current.launch_at_startup = v;
    }
    state.db.save_settings(&current).map_err(err)?;
    apply_autostart(&app, current.launch_at_startup);
    Ok(current)
}

#[tauri::command]
pub fn list_peers(state: State<AppState>) -> Result<Vec<Peer>, String> {
    state.db.list_peers().map_err(err)
}

#[tauri::command]
pub async fn add_manual_peer(
    state: State<'_, AppState>,
    ip: String,
    port: u16,
    name: Option<String>,
) -> Result<Peer, String> {
    let ip = ip.trim().to_string();
    let _parsed: IpAddr = ip
        .parse()
        .map_err(|_| format!("\"{}\" is not a valid IP address (example: 192.168.1.25)", ip))?;
    state.network.connect_manual_peer(&ip, port, name).await
}

#[tauri::command]
pub fn update_peer_trust(
    state: State<AppState>,
    peer_id: String,
    trust_state: String,
) -> Result<(), String> {
    if !["unverified", "trusted", "blocked"].contains(&trust_state.as_str()) {
        return Err("Invalid trust state".to_string());
    }
    state.db.update_peer_trust(&peer_id, &trust_state).map_err(err)
}

#[tauri::command]
pub fn get_conversations(state: State<AppState>) -> Result<Vec<Conversation>, String> {
    let privacy = &state.network.privacy;
    privacy.guard()?;
    state.db.get_conversations(privacy.hidden_unlocked()).map_err(err)
}

/// Hidden chats can only be opened after "show hidden chats" with the PIN.
fn guard_conversation(state: &AppState, conversation_id: &str) -> Result<(), String> {
    let privacy = &state.network.privacy;
    privacy.guard()?;
    if state.db.is_conversation_hidden(conversation_id) && !privacy.hidden_unlocked() {
        return Err("HIDDEN".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn get_or_create_conversation(
    state: State<AppState>,
    peer_id: String,
) -> Result<Conversation, String> {
    state.db.get_or_create_conversation(&peer_id).map_err(err)
}

#[tauri::command]
pub fn get_messages(state: State<AppState>, conversation_id: String) -> Result<Vec<Message>, String> {
    guard_conversation(&state, &conversation_id)?;
    state.db.get_messages(&conversation_id).map_err(err)
}

#[tauri::command]
pub fn search_messages(state: State<AppState>, query: String) -> Result<Vec<SearchHit>, String> {
    let privacy = &state.network.privacy;
    privacy.guard()?;
    state
        .db
        .search_messages(&query, 200, privacy.hidden_unlocked())
        .map_err(err)
}

#[tauri::command]
pub async fn send_message(
    state: State<'_, AppState>,
    conversation_id: String,
    content: String,
) -> Result<Message, String> {
    state
        .network
        .send_direct_message(&conversation_id, &content)
        .await
}

#[tauri::command]
pub async fn retry_message(state: State<'_, AppState>, message_id: String) -> Result<Message, String> {
    state.network.retry_direct_message(&message_id).await
}

/// Marks a chat read (sends "seen", starts secret-message timers) and
/// returns its messages.
#[tauri::command]
pub fn mark_conversation_read(
    state: State<AppState>,
    conversation_id: String,
) -> Result<Vec<Message>, String> {
    guard_conversation(&state, &conversation_id)?;
    state.network.mark_read_and_notify(&conversation_id)
}

#[tauri::command]
pub fn delete_conversation(state: State<AppState>, conversation_id: String) -> Result<(), String> {
    state.db.delete_conversation(&conversation_id).map_err(err)?;
    state.network.events.update_tray(&state.db);
    Ok(())
}

#[tauri::command]
pub fn list_transfers(state: State<AppState>) -> Result<Vec<TransferRecord>, String> {
    let privacy = &state.network.privacy;
    privacy.guard()?;
    state.db.list_transfers(privacy.hidden_unlocked()).map_err(err)
}

#[tauri::command]
pub async fn send_files(
    state: State<'_, AppState>,
    conversation_id: String,
    paths: Vec<String>,
) -> Result<Vec<SentFile>, String> {
    state.network.send_files(&conversation_id, paths).await
}

/// Opens the Windows file picker, then sends the chosen files.
#[tauri::command]
pub async fn pick_and_send_files(
    app: AppHandle,
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<Vec<SentFile>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut builder = app.dialog().file().set_title("Choose files to send");
    if let Some(w) = app.get_webview_window("main") {
        builder = builder.set_parent(&w);
    }
    builder.pick_files(move |files| {
        let _ = tx.send(files);
    });
    let Some(files) = rx.await.map_err(err)? else {
        return Ok(Vec::new());
    };
    let paths: Vec<String> = files
        .into_iter()
        .filter_map(|f| f.into_path().ok())
        .map(|p| p.to_string_lossy().to_string())
        .collect();
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    state.network.send_files(&conversation_id, paths).await
}

#[tauri::command]
pub async fn accept_transfer(
    state: State<'_, AppState>,
    transfer_id: String,
) -> Result<TransferRecord, String> {
    state.network.accept_transfer(&transfer_id).await
}

#[tauri::command]
pub async fn cancel_transfer(
    state: State<'_, AppState>,
    transfer_id: String,
) -> Result<TransferRecord, String> {
    state.network.cancel_transfer(&transfer_id).await
}

#[tauri::command]
pub async fn retry_transfer(
    state: State<'_, AppState>,
    transfer_id: String,
) -> Result<TransferRecord, String> {
    state.network.retry_transfer(&transfer_id).await
}

fn transfer_file_path(state: &AppState, transfer_id: &str) -> Result<String, String> {
    let t = state
        .db
        .get_transfer(transfer_id)
        .map_err(err)?
        .ok_or_else(|| "Transfer not found".to_string())?;
    if t.direction == "incoming" && t.status != "completed" {
        return Err("The file has not finished downloading yet.".to_string());
    }
    let path = t.local_path.ok_or_else(|| "No file on disk".to_string())?;
    if !std::path::Path::new(&path).exists() {
        return Err("The file was moved or deleted.".to_string());
    }
    Ok(path)
}

#[tauri::command]
pub fn open_transfer_file(state: State<AppState>, transfer_id: String) -> Result<(), String> {
    let path = transfer_file_path(&state, &transfer_id)?;
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(err)
}

#[tauri::command]
pub fn reveal_transfer_file(state: State<AppState>, transfer_id: String) -> Result<(), String> {
    let path = transfer_file_path(&state, &transfer_id)?;
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(err)
}

#[tauri::command]
pub fn open_download_folder(state: State<AppState>) -> Result<(), String> {
    let s = state.db.get_settings().map_err(err)?;
    let dir = if s.default_download_dir.trim().is_empty() {
        dirs::download_dir().unwrap_or_default()
    } else {
        std::path::PathBuf::from(s.default_download_dir.trim())
    };
    let _ = std::fs::create_dir_all(&dir);
    tauri_plugin_opener::open_path(dir.to_string_lossy().to_string(), None::<&str>).map_err(err)
}

#[tauri::command]
pub fn clear_finished_transfers(state: State<AppState>) -> Result<usize, String> {
    state.db.clear_finished_transfers().map_err(err)
}

#[tauri::command]
pub async fn pick_download_dir(app: AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut builder = app.dialog().file().set_title("Choose where received files are saved");
    if let Some(w) = app.get_webview_window("main") {
        builder = builder.set_parent(&w);
    }
    builder.pick_folder(move |folder| {
        let _ = tx.send(folder);
    });
    Ok(rx
        .await
        .map_err(err)?
        .and_then(|f| f.into_path().ok())
        .map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn get_system_info(app: AppHandle, state: State<AppState>) -> Result<SystemInfo, String> {
    let settings = state.db.get_settings().map_err(err)?;
    let mut local_ips = local_ipv4_addresses();
    if local_ips.is_empty() {
        local_ips.push("127.0.0.1".to_string());
    }
    Ok(SystemInfo {
        device_id: settings.device_id,
        hostname: settings.hostname,
        local_ips,
        database_path: state.db.get_path().to_string_lossy().to_string(),
        database_size_bytes: state.db.get_db_size_bytes(),
        os: "Windows".to_string(),
        app_version: app.package_info().version.to_string(),
        fingerprint: state.identity.fingerprint(),
        tcp_listening: state.network.is_listening(),
        udp_listening: state.discovery.is_listening(),
    })
}

/// Tries a real LANX handshake with the address, so the result says whether
/// LANX (not just "something") answered.
#[tauri::command]
pub async fn test_lan_connection(
    state: State<'_, AppState>,
    ip: String,
    port: u16,
) -> Result<ConnectionTestResult, String> {
    let addr = format!("{}:{}", ip.trim(), port);
    let start = Instant::now();
    let result = SecureChannel::connect(
        &addr,
        &state.identity,
        &state.network.local_profile(),
        &ExpectedPeer::default(),
        Duration::from_millis(3000),
    )
    .await;
    let ms = start.elapsed().as_millis() as u64;
    Ok(match result {
        Ok(chan) => {
            let r = chan.remote.clone();
            chan.close().await;
            ConnectionTestResult {
                reachable: true,
                ip,
                port,
                latency_ms: Some(ms),
                message: format!(
                    "Connected to LANX on {} ({}) — encrypted handshake OK in {} ms",
                    r.hostname, r.display_name, ms
                ),
            }
        }
        Err(e) => ConnectionTestResult {
            reachable: false,
            ip,
            port,
            latency_ms: None,
            message: format!(
                "{}. Check that LANX is running on that computer and both are on the same network.",
                e
            ),
        },
    })
}

// ------------------------------------------------------------------ groups

#[tauri::command]
pub fn create_group(
    state: State<AppState>,
    name: String,
    member_ids: Vec<String>,
) -> Result<Conversation, String> {
    state.network.privacy.guard()?;
    state.network.create_group(&name, &member_ids)
}

#[tauri::command]
pub fn update_group(
    state: State<AppState>,
    group_id: String,
    name: Option<String>,
    add: Vec<String>,
    remove: Vec<String>,
) -> Result<GroupInfo, String> {
    state.network.privacy.guard()?;
    state.network.update_group(&group_id, name, &add, &remove)
}

#[tauri::command]
pub fn leave_group(state: State<AppState>, group_id: String) -> Result<(), String> {
    state.network.privacy.guard()?;
    state.network.leave_group(&group_id)
}

#[tauri::command]
pub fn get_group(state: State<AppState>, group_id: String) -> Result<Option<GroupInfo>, String> {
    guard_conversation(&state, &group_id)?;
    Ok(state.network.get_group(&group_id))
}

// ------------------------------------------------------- lock and hidden

fn emit_lock(state: &AppState) -> crate::privacy::LockStatus {
    let status = state.network.privacy.status(&state.db);
    state.network.events.emit_json("lanx://lock-changed", status.clone());
    status
}

#[tauri::command]
pub fn get_lock_status(state: State<AppState>) -> crate::privacy::LockStatus {
    state.network.privacy.status(&state.db)
}

#[tauri::command]
pub fn unlock(state: State<AppState>, pin: String) -> Result<crate::privacy::LockStatus, String> {
    match crate::privacy::check_pin(&state.db, &pin) {
        crate::privacy::PinCheck::Ok => {
            state.network.privacy.unlock();
            Ok(emit_lock(&state))
        }
        crate::privacy::PinCheck::NoPin => {
            state.network.privacy.unlock();
            Ok(emit_lock(&state))
        }
        other => Err(crate::privacy::pin_error_text(&other)),
    }
}

// ------------------------------------------------- desktop island (1.2.7)

/// The island window collects the alerts waiting for it.
#[tauri::command]
pub fn island_take(state: State<AppState>) -> Vec<crate::events::IslandAlert> {
    state.network.events.island_take()
}

/// The island has nothing left to show: hide its window.
#[tauri::command]
pub fn island_hide(app: AppHandle) {
    if let Some(w) = app.get_webview_window("island") {
        let _ = w.hide();
    }
}

/// Clicked in the island: bring LANX to the front, on that chat.
#[tauri::command]
pub fn island_open(app: AppHandle, state: State<AppState>, conversation_id: Option<String>) {
    if let Some(w) = app.get_webview_window("island") {
        let _ = w.hide();
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    if let Some(id) = conversation_id {
        state
            .network
            .events
            .emit_json("lanx://open-conversation", serde_json::json!({ "conversation_id": id }));
    }
}

#[tauri::command]
pub fn lock_app(state: State<AppState>) -> crate::privacy::LockStatus {
    if crate::privacy::pin_is_set(&state.db) {
        state.network.privacy.lock();
    }
    emit_lock(&state)
}

#[tauri::command]
pub fn set_pin(
    state: State<AppState>,
    current: Option<String>,
    new_pin: Option<String>,
) -> Result<crate::privacy::LockStatus, String> {
    state.network.privacy.guard()?;
    crate::privacy::set_pin(&state.db, current.as_deref(), new_pin.as_deref())?;
    if new_pin.is_none() {
        state.network.privacy.set_hidden_unlocked(false);
        state.network.events.state_changed();
    }
    Ok(emit_lock(&state))
}

#[tauri::command]
pub fn unlock_hidden(state: State<AppState>, pin: String) -> Result<crate::privacy::LockStatus, String> {
    state.network.privacy.guard()?;
    match crate::privacy::check_pin(&state.db, &pin) {
        crate::privacy::PinCheck::Ok => {
            state.network.privacy.set_hidden_unlocked(true);
            state.network.events.state_changed();
            Ok(emit_lock(&state))
        }
        other => Err(crate::privacy::pin_error_text(&other)),
    }
}

#[tauri::command]
pub fn hide_hidden_chats(state: State<AppState>) -> crate::privacy::LockStatus {
    state.network.privacy.set_hidden_unlocked(false);
    state.network.events.state_changed();
    emit_lock(&state)
}

#[tauri::command]
pub fn set_conversation_hidden(
    state: State<AppState>,
    conversation_id: String,
    hidden: bool,
) -> Result<(), String> {
    state.network.privacy.guard()?;
    if !crate::privacy::pin_is_set(&state.db) {
        return Err("Set a PIN first (Settings → Privacy) so hidden chats stay protected.".to_string());
    }
    if !hidden && !state.network.privacy.hidden_unlocked() {
        return Err("HIDDEN".to_string());
    }
    state
        .db
        .set_conversation_hidden(&conversation_id, hidden)
        .map_err(err)?;
    state.network.events.update_tray(&state.db);
    state.network.events.state_changed();
    Ok(())
}

// ------------------------------------------------- secret, typing, ring

#[tauri::command]
pub fn set_secret_mode(
    state: State<AppState>,
    conversation_id: String,
    ttl: u32,
) -> Result<Message, String> {
    guard_conversation(&state, &conversation_id)?;
    state.network.set_secret_mode(&conversation_id, ttl)
}

#[tauri::command]
pub fn send_typing(state: State<AppState>, conversation_id: String) {
    if state.network.privacy.guard().is_ok() {
        state.network.send_typing(&conversation_id);
    }
}

#[tauri::command]
pub async fn ring(state: State<'_, AppState>, conversation_id: String) -> Result<usize, String> {
    guard_conversation(&state, &conversation_id)?;
    state.network.ring(&conversation_id).await
}

/// Hides the window from screenshots while a secret chat is open.
#[tauri::command]
pub fn set_content_protection(app: AppHandle, enabled: bool) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_content_protected(enabled);
    }
}

// ------------------------------------------------ images and broadcast

#[tauri::command]
pub async fn send_pasted_image(
    state: State<'_, AppState>,
    conversation_id: String,
    data_base64: String,
    mime: String,
) -> Result<Vec<SentFile>, String> {
    guard_conversation(&state, &conversation_id)?;
    let path = state.network.save_pasted_image(&data_base64, &mime)?;
    state
        .network
        .send_files(&conversation_id, vec![path.to_string_lossy().to_string()])
        .await
}

#[tauri::command]
pub fn get_image_preview(state: State<AppState>, transfer_id: String) -> Result<Option<String>, String> {
    state.network.privacy.guard()?;
    Ok(state.network.image_preview(&transfer_id))
}

#[tauri::command]
pub async fn broadcast_message(
    state: State<'_, AppState>,
    peer_ids: Vec<String>,
    content: Option<String>,
    paths: Vec<String>,
) -> Result<crate::networking::extras::BroadcastResult, String> {
    state.network.privacy.guard()?;
    state.network.broadcast(&peer_ids, content, paths).await
}

/// LANX 1.2.3: network speed to a colleague (one connection vs several).
#[tauri::command]
pub async fn speed_test(
    state: State<'_, AppState>,
    peer_id: String,
) -> Result<crate::networking::lanes::SpeedTestResult, String> {
    state.network.privacy.guard()?;
    state.network.speed_test(&peer_id).await
}

/// LANX 1.2.3: choose a folder to send (it is packed and sent as one transfer).
#[tauri::command]
pub async fn pick_folder_to_send(app: AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut builder = app.dialog().file().set_title("Choose a folder to send");
    if let Some(w) = app.get_webview_window("main") {
        builder = builder.set_parent(&w);
    }
    builder.pick_folder(move |folder| {
        let _ = tx.send(folder);
    });
    Ok(rx
        .await
        .map_err(err)?
        .and_then(|f| f.into_path().ok())
        .map(|p| p.to_string_lossy().to_string()))
}

/// File picker that only returns the chosen paths (used by "Message everyone").
#[tauri::command]
pub async fn pick_files(app: AppHandle) -> Result<Vec<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut builder = app.dialog().file().set_title("Choose files");
    if let Some(w) = app.get_webview_window("main") {
        builder = builder.set_parent(&w);
    }
    builder.pick_files(move |files| {
        let _ = tx.send(files);
    });
    Ok(rx
        .await
        .map_err(err)?
        .unwrap_or_default()
        .into_iter()
        .filter_map(|f| f.into_path().ok())
        .map(|p| p.to_string_lossy().to_string())
        .collect())
}

// ------------------------------------------------------- LANX updates

#[tauri::command]
pub fn get_update_status(
    state: State<AppState>,
) -> Result<crate::networking::update::UpdateStatus, String> {
    state.network.privacy.guard()?;
    Ok(state.network.update_status())
}

/// "Update now" / "Install now". Returns "downloading", "installing" or
/// "dry_run" (side-by-side test copies).
#[tauri::command]
pub async fn install_update(state: State<'_, AppState>) -> Result<String, String> {
    state.network.privacy.guard()?;
    state.network.install_update().await
}

/// File picker for the installer to share (its .sig must be next to it).
#[tauri::command]
pub async fn pick_update_installer(app: AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut builder = app
        .dialog()
        .file()
        .set_title("Choose the LANX installer to share (LANX-Setup-….exe)")
        .add_filter("LANX installer", &["exe"]);
    if let Some(w) = app.get_webview_window("main") {
        builder = builder.set_parent(&w);
    }
    builder.pick_file(move |f| {
        let _ = tx.send(f);
    });
    Ok(rx
        .await
        .map_err(err)?
        .and_then(|f| f.into_path().ok())
        .map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn share_update(
    state: State<'_, AppState>,
    path: String,
) -> Result<crate::networking::update::SharedInstaller, String> {
    state.network.privacy.guard()?;
    let network = state.network.clone();
    // Checking and copying the installer reads the whole file.
    tauri::async_runtime::spawn_blocking(move || network.share_update(&path))
        .await
        .map_err(err)?
}

#[tauri::command]
pub fn stop_sharing_update(state: State<AppState>) -> Result<(), String> {
    state.network.privacy.guard()?;
    state.network.stop_sharing_update()
}

/// "Remind me tomorrow". Returns when the banner comes back (unix seconds).
#[tauri::command]
pub fn snooze_update(state: State<AppState>) -> Result<i64, String> {
    state.network.privacy.guard()?;
    state.network.snooze_update()
}

#[tauri::command]
pub fn set_update_auto_chat(state: State<AppState>, enabled: bool) -> Result<(), String> {
    state.network.privacy.guard()?;
    state.network.set_update_auto_chat(enabled)
}

/// For colleagues on LANX 1.1 or older: the installer as a chat file.
#[tauri::command]
pub async fn send_update_as_file(
    state: State<'_, AppState>,
    peer_ids: Vec<String>,
) -> Result<crate::networking::extras::BroadcastResult, String> {
    state.network.privacy.guard()?;
    state.network.send_update_as_file(&peer_ids).await
}

// ------------------------------------------------------------------ sounds

#[tauri::command]
pub async fn pick_sound_file(app: AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut builder = app
        .dialog()
        .file()
        .set_title("Choose a sound (.wav)")
        .add_filter("WAV sound", &["wav"]);
    if let Some(w) = app.get_webview_window("main") {
        builder = builder.set_parent(&w);
    }
    builder.pick_file(move |f| {
        let _ = tx.send(f);
    });
    let Some(path) = rx.await.map_err(err)?.and_then(|f| f.into_path().ok()) else {
        return Ok(None);
    };
    let p = path.to_string_lossy().to_string();
    crate::sound::load_custom(&p)?;
    Ok(Some(p))
}

/// Plays a sound: a built-in name, "custom", "bell", or None for the user's
/// chosen message sound. `volume` overrides the saved volume (for previews).
#[tauri::command]
pub fn play_sound(state: State<AppState>, name: Option<String>, volume: Option<u32>, custom_path: Option<String>) {
    let s = state.db.get_settings().ok();
    let choice = name.unwrap_or_else(|| s.as_ref().map(|s| s.sound_choice.clone()).unwrap_or_default());
    let path = custom_path.unwrap_or_else(|| s.as_ref().map(|s| s.custom_sound_path.clone()).unwrap_or_default());
    let vol = volume.unwrap_or_else(|| s.as_ref().map(|s| s.sound_volume).unwrap_or(80));
    crate::sound::play(&choice, &path, vol);
}
