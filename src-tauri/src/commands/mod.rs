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

fn err<E: std::fmt::Display>(e: E) -> String {
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
    if settings.display_name.trim().is_empty() {
        return Err("Display name cannot be empty".to_string());
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
    state.db.get_conversations().map_err(err)
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
    state.db.get_messages(&conversation_id).map_err(err)
}

#[tauri::command]
pub fn search_messages(state: State<AppState>, query: String) -> Result<Vec<SearchHit>, String> {
    state.db.search_messages(&query, 200).map_err(err)
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

#[tauri::command]
pub fn mark_conversation_read(state: State<AppState>, conversation_id: String) -> Result<(), String> {
    state.db.mark_conversation_read(&conversation_id).map_err(err)?;
    state.network.events.update_tray(&state.db);
    Ok(())
}

#[tauri::command]
pub fn delete_conversation(state: State<AppState>, conversation_id: String) -> Result<(), String> {
    state.db.delete_conversation(&conversation_id).map_err(err)?;
    state.network.events.update_tray(&state.db);
    Ok(())
}

#[tauri::command]
pub fn list_transfers(state: State<AppState>) -> Result<Vec<TransferRecord>, String> {
    state.db.list_transfers().map_err(err)
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
