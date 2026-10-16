use crate::discovery::DiscoveryService;
use crate::networking::NetworkService;
use crate::security::DeviceIdentity;
use crate::storage::Database;
use crate::storage::models::*;
use std::net::{IpAddr, SocketAddr, TcpStream, ToSocketAddrs};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::State;

pub struct AppState {
    pub db: Arc<Database>,
    pub network_service: Arc<NetworkService>,
    pub discovery_service: Arc<DiscoveryService>,
    pub identity: Arc<DeviceIdentity>,
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Result<UserSettings, String> {
    state.db.get_settings().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_settings(state: State<AppState>, settings: UserSettings) -> Result<(), String> {
    state.db.save_settings(&settings).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn complete_onboarding(
    state: State<AppState>,
    display_name: String,
    avatar_color: String,
) -> Result<UserSettings, String> {
    let mut current = state.db.get_settings().map_err(|e| e.to_string())?;
    current.display_name = display_name;
    current.avatar_color = avatar_color;
    current.onboarding_completed = true;

    state
        .db
        .save_settings(&current)
        .map_err(|e| e.to_string())?;
    Ok(current)
}

#[tauri::command]
pub fn list_peers(state: State<AppState>) -> Result<Vec<Peer>, String> {
    state.db.list_peers().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_manual_peer(
    state: State<'_, AppState>,
    ip: String,
    port: u16,
    name: Option<String>,
) -> Result<Peer, String> {
    let _parsed: IpAddr = ip
        .parse()
        .map_err(|_| format!("Invalid IP address: {}", ip))?;

    state
        .network_service
        .connect_manual_peer(&ip, port, name)
        .await
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
    state
        .db
        .update_peer_trust(&peer_id, &trust_state)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_conversations(state: State<AppState>) -> Result<Vec<Conversation>, String> {
    state.db.get_conversations().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_or_create_conversation(
    state: State<AppState>,
    peer_id: String,
) -> Result<Conversation, String> {
    state
        .db
        .get_or_create_conversation(&peer_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_messages(
    state: State<AppState>,
    conversation_id: String,
) -> Result<Vec<Message>, String> {
    state
        .db
        .get_messages(&conversation_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn send_message(
    state: State<'_, AppState>,
    conversation_id: String,
    content: String,
) -> Result<Message, String> {
    state
        .network_service
        .send_direct_message(&conversation_id, &content)
        .await
}

#[tauri::command]
pub async fn retry_message(
    state: State<'_, AppState>,
    message_id: String,
) -> Result<Message, String> {
    state
        .network_service
        .retry_direct_message(&message_id)
        .await
}

#[tauri::command]
pub fn mark_conversation_read(
    state: State<AppState>,
    conversation_id: String,
) -> Result<(), String> {
    state
        .db
        .mark_conversation_read(&conversation_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_conversation(state: State<AppState>, conversation_id: String) -> Result<(), String> {
    state
        .db
        .delete_conversation(&conversation_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_transfers(state: State<AppState>) -> Result<Vec<TransferRecord>, String> {
    state.db.list_transfers().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cancel_transfer(state: State<AppState>, transfer_id: String) -> Result<(), String> {
    state
        .db
        .update_transfer_status(&transfer_id, "cancelled", 0)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn accept_transfer(state: State<AppState>, transfer_id: String) -> Result<(), String> {
    state
        .db
        .update_transfer_status(&transfer_id, "approved", 0)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_system_info(state: State<AppState>) -> Result<SystemInfo, String> {
    let settings = state.db.get_settings().map_err(|e| e.to_string())?;
    let db_path = state.db.get_path().to_string_lossy().to_string();
    let db_size = state.db.get_db_size_bytes();

    let local_ips = get_local_ip_addresses();

    Ok(SystemInfo {
        device_id: settings.device_id,
        hostname: settings.hostname,
        local_ips,
        database_path: db_path,
        database_size_bytes: db_size,
        os: "Windows".to_string(),
    })
}

#[tauri::command]
pub fn test_lan_connection(ip: String, port: u16) -> Result<ConnectionTestResult, String> {
    let addr_str = format!("{}:{}", ip, port);
    let addrs: Vec<SocketAddr> = addr_str
        .to_socket_addrs()
        .map_err(|e| format!("Cannot resolve address: {}", e))?
        .collect();

    if addrs.is_empty() {
        return Ok(ConnectionTestResult {
            reachable: false,
            ip,
            port,
            latency_ms: None,
            message: "Address resolution yielded no socket addresses".to_string(),
        });
    }

    let start = Instant::now();
    let timeout = Duration::from_millis(2000);

    match TcpStream::connect_timeout(&addrs[0], timeout) {
        Ok(_) => {
            let elapsed = start.elapsed().as_millis() as u64;
            Ok(ConnectionTestResult {
                reachable: true,
                ip,
                port,
                latency_ms: Some(elapsed),
                message: format!("Connection successful ({}ms)", elapsed),
            })
        }
        Err(e) => Ok(ConnectionTestResult {
            reachable: false,
            ip,
            port,
            latency_ms: None,
            message: format!("Connection failed: {}", e),
        }),
    }
}

fn get_local_ip_addresses() -> Vec<String> {
    let mut ips = Vec::new();
    // Resolve standard local hostname
    if let Ok(hostname) = std::env::var("COMPUTERNAME") {
        let host_port = format!("{}:0", hostname);
        if let Ok(addrs) = host_port.to_socket_addrs() {
            for a in addrs {
                if let IpAddr::V4(v4) = a.ip() {
                    let s = v4.to_string();
                    if !s.starts_with("127.") && !ips.contains(&s) {
                        ips.push(s);
                    }
                }
            }
        }
    }
    if ips.is_empty() {
        ips.push("127.0.0.1".to_string());
    }
    ips
}
