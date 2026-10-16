pub mod commands;
pub mod discovery;
pub mod events;
pub mod networking;
pub mod security;
pub mod storage;
pub mod testmode;

use commands::AppState;
use discovery::DiscoveryService;
use events::Events;
use networking::NetworkService;
use security::DeviceIdentity;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use storage::Database;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WindowEvent};

static TRAY_HINT_SHOWN: AtomicBool = AtomicBool::new(false);

fn show_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn quit_app(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Some(state) = app.try_state::<AppState>() {
            state.discovery.announce_offline().await;
            state.discovery.stop();
            state.network.stop();
        }
        app.exit(0);
    });
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open LANX", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit LANX", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &sep, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("LANX — Local Network Messenger")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main_window(app),
            "quit" => quit_app(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

fn fatal_startup_error(app: &tauri::App, message: String) -> ! {
    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
    app.dialog()
        .message(message)
        .title("LANX could not start")
        .kind(MessageDialogKind::Error)
        .blocking_show();
    std::process::exit(1);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let profile = testmode::profile();
    let mut builder = tauri::Builder::default();

    if profile.is_none() {
        // A second launch just brings the running LANX to the front.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }));
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .setup(move |app| {
            let data_dir = storage::data_dir(profile.as_deref());
            let db = match Database::open(&data_dir) {
                Ok(db) => Arc::new(db),
                Err(e) => fatal_startup_error(
                    app,
                    format!(
                        "LANX could not open its database in {}.\n\n{}",
                        data_dir.display(),
                        e
                    ),
                ),
            };
            let identity = match DeviceIdentity::load_or_create(&db.conn.lock()) {
                Ok(i) => Arc::new(i),
                Err(e) => fatal_startup_error(app, format!("LANX identity error: {}", e)),
            };
            if let Some(p) = &profile {
                // Side-by-side test copy (see testmode.rs).
                if let Some(port) = testmode::tcp_port() {
                    let _ = db.set_setting("tcp_messaging_port", &port.to_string());
                }
                if let Some(port) = testmode::udp_port() {
                    let _ = db.set_setting("udp_discovery_port", &port.to_string());
                }
                if testmode::quiet() {
                    let _ = db.set_setting("notifications_enabled", "false");
                    let _ = db.set_setting("launch_at_startup", "false");
                }
                let _ = db.set_setting(
                    "hostname",
                    &format!("{}-{}", std::env::var("COMPUTERNAME").unwrap_or_default(), p),
                );
            }
            let _ = db.recover_after_restart();

            let events = Events::new(Some(app.handle().clone()));
            let network = NetworkService::new(db.clone(), (*identity).clone(), events.clone());
            network.start();
            let discovery = Arc::new(DiscoveryService::new(network.clone()));
            discovery.start();

            app.manage(AppState {
                db: db.clone(),
                network,
                discovery,
                identity,
            });

            if let Err(e) = build_tray(app) {
                eprintln!("[Tray] Could not create tray icon: {}", e);
            }
            events.update_tray(&db);

            let start_hidden = std::env::args().any(|a| a == "--minimized");
            if let Some(w) = app.get_webview_window("main") {
                if profile.is_some() {
                    let _ = w.set_title(&format!("LANX — test profile {}", profile.as_deref().unwrap_or("")));
                }
                if !start_hidden {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let keep_running = app
                    .try_state::<AppState>()
                    .and_then(|s| s.db.get_settings().ok())
                    .map(|s| s.close_to_tray)
                    .unwrap_or(true);
                api.prevent_close();
                if keep_running {
                    let _ = window.hide();
                    if !TRAY_HINT_SHOWN.swap(true, Ordering::SeqCst) {
                        use tauri_plugin_notification::NotificationExt;
                        let _ = app
                            .notification()
                            .builder()
                            .title("LANX is still running")
                            .body("You will keep receiving messages. Right-click the LANX tray icon to quit.")
                            .show();
                    }
                } else {
                    quit_app(app);
                }
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
            commands::search_messages,
            commands::send_message,
            commands::retry_message,
            commands::mark_conversation_read,
            commands::delete_conversation,
            commands::list_transfers,
            commands::send_files,
            commands::pick_and_send_files,
            commands::accept_transfer,
            commands::cancel_transfer,
            commands::retry_transfer,
            commands::open_transfer_file,
            commands::reveal_transfer_file,
            commands::open_download_folder,
            commands::clear_finished_transfers,
            commands::pick_download_dir,
            commands::get_system_info,
            commands::test_lan_connection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LANX desktop application");
}
