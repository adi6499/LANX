pub mod commands;
pub mod discovery;
pub mod networking;
pub mod security;
pub mod storage;

use commands::AppState;
use discovery::DiscoveryService;
use networking::NetworkService;
use security::DeviceIdentity;
use std::sync::Arc;
use storage::Database;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db = Arc::new(Database::new().expect("Failed to initialize LANX SQLite database"));
    let identity = Arc::new(
        DeviceIdentity::load_or_create(&db.conn.lock())
            .expect("Failed to initialize or load device cryptographic identity"),
    );

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup({
            let db = db.clone();
            let identity = identity.clone();
            move |app| {
                let app_handle = app.handle().clone();

                let network_service = Arc::new(NetworkService::new(
                    db.clone(),
                    (*identity).clone(),
                    Some(app_handle.clone()),
                ));
                network_service.start();

                let discovery_service = Arc::new(DiscoveryService::new(
                    db.clone(),
                    (*identity).clone(),
                    Some(app_handle),
                ));
                discovery_service.start();

                app.manage(AppState {
                    db,
                    network_service,
                    discovery_service,
                    identity,
                });

                Ok(())
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::complete_onboarding,
            commands::list_peers,
            commands::add_manual_peer,
            commands::update_peer_trust,
            commands::get_conversations,
            commands::get_or_create_conversation,
            commands::get_messages,
            commands::send_message,
            commands::retry_message,
            commands::mark_conversation_read,
            commands::delete_conversation,
            commands::list_transfers,
            commands::cancel_transfer,
            commands::accept_transfer,
            commands::get_system_info,
            commands::test_lan_connection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LANX desktop application");
}
