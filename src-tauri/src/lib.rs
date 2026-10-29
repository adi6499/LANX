pub mod backup;
pub mod commands;
pub mod discovery;
pub mod events;
pub mod export;
pub mod networking;
pub mod phone;
pub mod privacy;
pub mod recordings;
pub mod remote;
pub mod security;
pub mod shell;
pub mod sound;
pub mod storage;
pub mod testmode;
pub mod voice;
pub mod webview_folder;
pub mod window_doctor;

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
/// LANX 1.3.0: the main window's page has loaded (see webview_folder.rs).
static UI_READY: AtomicBool = AtomicBool::new(false);
/// LANX 2.5.3: started with --minimized (stays in the tray until clicked).
static START_HIDDEN: AtomicBool = AtomicBool::new(false);
/// LANX 2.5.3: the main window has been shown once at start-up.
static SHOWN_ONCE: AtomicBool = AtomicBool::new(false);

/// The main window's page calls this once it has drawn itself. LANX 2.5.3:
/// that is when the window is shown, so start-up never shows a blank white
/// window (a reload later never pops the window up again).
#[tauri::command]
fn ui_ready(window: tauri::Window) {
    if window.label() == "main" {
        UI_READY.store(true, Ordering::SeqCst);
        if !START_HIDDEN.load(Ordering::SeqCst) && !SHOWN_ONCE.swap(true, Ordering::SeqCst) {
            show_main_window(window.app_handle());
        }
    }
}

/// If the window is shown but its page never loads (a blank window), WebView2
/// can't use its folder: move to a fresh one and restart LANX once.
fn watch_for_blank_window(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut waited = 0u64;
        let mut visible_for = 0u64;
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            if UI_READY.load(Ordering::SeqCst) {
                return;
            }
            waited += 2;
            let visible = app
                .get_webview_window("main")
                .map(|w| w.is_visible().unwrap_or(false))
                .unwrap_or(false);
            visible_for = if visible { visible_for + 2 } else { 0 };
            if waited >= 40 && visible_for >= 20 {
                if webview_folder::switch_to_fresh() {
                    eprintln!("[WebView] the window did not load; restarting with a fresh WebView2 folder");
                    relaunch(&app);
                }
                return;
            }
        }
    });
}

fn show_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub(crate) fn quit_app(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Some(state) = app.try_state::<AppState>() {
            if let Some(call) = state.network.current_call() {
                let _ = state.network.hangup_call(&call.call_id).await;
            }
            state.discovery.announce_offline().await;
            state.discovery.stop();
            state.phone.stop();
            state.network.stop();
        }
        app.exit(0);
    });
}

/// Restarts LANX (used after a restore is staged). The new copy waits for this
/// one to exit, so the single-instance guard and WebView2 don't trip over it.
pub fn relaunch(app: &AppHandle) {
    relaunch_with(app, false);
}

/// Restarts LANX; `hidden`: the new LANX starts in the tray (LANX 1.9.1).
pub fn relaunch_with(app: &AppHandle, hidden: bool) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
        if let Some(state) = app.try_state::<AppState>() {
            state.discovery.announce_offline().await;
            state.discovery.stop();
            state.network.stop();
        }
        if let Ok(exe) = std::env::current_exe() {
            let mut cmd = std::process::Command::new(exe);
            cmd.arg("--wait-for-exit").arg(std::process::id().to_string());
            if hidden {
                cmd.arg("--minimized");
            }
            let _ = cmd.spawn();
        }
        app.exit(0);
    });
}

/// `--wait-for-exit <pid>`: wait (up to 20 s) for the previous LANX to close.
fn wait_for_previous_instance() {
    let args: Vec<String> = std::env::args().collect();
    let Some(i) = args.iter().position(|a| a == "--wait-for-exit") else {
        return;
    };
    let Some(pid) = args.get(i + 1).and_then(|p| p.parse::<u32>().ok()) else {
        return;
    };
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject};
        const SYNCHRONIZE: u32 = 0x0010_0000;
        let h = OpenProcess(SYNCHRONIZE, 0, pid);
        if !h.is_null() {
            WaitForSingleObject(h, 20_000);
            CloseHandle(h);
        }
    }
    #[cfg(not(windows))]
    {
        // Linux: wait (up to 20 s) for the previous copy to be gone.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
        while std::path::Path::new(&format!("/proc/{pid}")).exists() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    }
    // Give WebView2 a moment to let go of its data folder.
    std::thread::sleep(std::time::Duration::from_millis(1200));
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open LANX", true, None::<&str>)?;
    let lock = MenuItem::with_id(app, "lock", "Lock LANX", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit LANX", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &lock, &sep, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("LANX — Local Network Messenger")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main_window(app),
            "lock" => {
                if let Some(state) = app.try_state::<AppState>() {
                    if privacy::pin_is_set(&state.db) {
                        state.network.privacy.lock();
                        let status = state.network.privacy.status(&state.db);
                        state.network.events.emit_json("lanx://lock-changed", status);
                    } else {
                        show_main_window(app);
                        state.network.events.emit_json("lanx://open-privacy-settings", ());
                    }
                }
            }
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
    // LANX for Linux: WebKitGTK's DMA-BUF renderer shows a blank window on some
    // PCs (virtual machines, some NVIDIA drivers). The older renderer works
    // everywhere; people who know better can set the variable themselves.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        // SAFETY: set before any other thread exists (first thing in `run`).
        unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") };
    }
    wait_for_previous_instance();
    let profile = testmode::profile();
    if profile.is_none() || testmode::webview_base().is_some() {
        webview_folder::choose();
    }
    // LANX 1.4.0: recordings cut short by LANX closing get their name back.
    std::thread::spawn(recordings::recover_leftovers);
    let mut builder = tauri::Builder::default();

    if profile.is_none() {
        // A second launch just brings the running LANX to the front.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            show_main_window(app);
            // LANX 1.7.0: Explorer's "Send to → LANX".
            shell::queue_send(app, shell::send_paths(&args));
            // LANX 2.14.0: a PDF double-clicked in Explorer opens in LANX.
            shell::queue_open(app, shell::open_paths(&args));
        }));
    }

    builder
        // Calls: LANX's own page may use the microphone, camera and screen
        // (nothing else is ever loaded in the window).
        .on_permission_request(|_, kind| {
            use tauri::webview::{PermissionKind, PermissionResponse};
            match kind {
                PermissionKind::Microphone | PermissionKind::Camera | PermissionKind::DisplayCapture => {
                    PermissionResponse::Allow
                }
                _ => PermissionResponse::Default,
            }
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .setup(move |app| {
            let data_dir = storage::data_dir(profile.as_deref());
            let app_version = app.package_info().version.to_string();
            match backup::apply_pending_restore(&data_dir, &app_version) {
                Ok(Some(info)) => backup::set_notice(
                    true,
                    format!("Chats restored from the backup of {}.", backup::describe_time(info.created_at)),
                ),
                Ok(None) => {}
                Err(e) => backup::set_notice(false, format!("The restore did not happen: {}", e)),
            }
            // Folders packed for sending more than a week ago.
            networking::folders::clean_outbox(&networking::folders::outbox_dir(&data_dir), 7);
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
                if let Some(port) = testmode::phone_port() {
                    let _ = db.set_setting("phone_port", &port.to_string());
                }
                if testmode::phone_on() {
                    let _ = db.set_setting("phone_enabled", "true");
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
            // LANX 3.0: "LANX on your phone" (serves only when switched on in Settings).
            let phone = phone::PhoneService::new(network.clone(), app_version.clone());
            phone.start();

            app.manage(AppState {
                db: db.clone(),
                network,
                discovery,
                identity,
                phone,
            });

            if profile.is_none() || testmode::webview_base().is_some() {
                watch_for_blank_window(app.handle());
            }

            if let Err(e) = build_tray(app) {
                eprintln!("[Tray] Could not create tray icon: {}", e);
            }
            events.update_tray(&db);

            // Keep "start with Windows" in step with the setting (e.g. after an
            // upgrade from 0.1, where onboarding never ran under 1.0).
            if let Ok(s) = db.get_settings() {
                if s.onboarding_completed {
                    commands::apply_autostart(app.handle(), s.launch_at_startup);
                }
            }

            // Daily automatic backup (first check a little after start-up).
            {
                let db = db.clone();
                let version = app_version.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(testmode::backup_delay_secs())).await;
                    loop {
                        let (db2, v) = (db.clone(), version.clone());
                        let _ = tauri::async_runtime::spawn_blocking(move || backup::auto_backup_if_due(&db2, &v)).await;
                        // LANX 1.9.0: message clean-up (when one is set).
                        let db3 = db.clone();
                        let _ = tauri::async_runtime::spawn_blocking(move || db3.apply_retention(chrono::Utc::now().timestamp())).await;
                        tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
                    }
                });
            }

            // LANX 1.2.7: the desktop Dynamic Island, a small see-through window
            // at the top of the screen for alerts while LANX is hidden.
            match tauri::WebviewWindowBuilder::new(app, "island", tauri::WebviewUrl::App("index.html".into()))
                .title("LANX alerts")
                .inner_size(events::ISLAND_W, events::ISLAND_H)
                .decorations(false)
                .transparent(true)
                .shadow(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .resizable(false)
                .maximizable(false)
                .minimizable(false)
                .focused(false)
                // Like a Windows notification: showing or clicking it never
                // takes the keyboard away from what the user is typing in.
                .focusable(false)
                .visible(false)
                .disable_drag_drop_handler()
                .build()
            {
                Ok(w) => {
                    let _ = w.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
                    events::place_island(app.handle(), &w);
                }
                Err(e) => eprintln!("[Island] Could not create the alert window: {}", e),
            }

            // LANX 1.9.1: if WebView2 stops (a laptop waking up, a busy
            // start-up), reload the page or restart LANX instead of staying white.
            window_doctor::watch(app.handle(), "main");
            window_doctor::watch(app.handle(), "island");
            window_doctor::start_checks(app.handle());

            // LANX 1.7.0: "Send to → LANX" while LANX wasn't running, the
            // screenshot key and the Explorer menu entry (never for test copies).
            let args: Vec<String> = std::env::args().collect();
            shell::remember_send(shell::send_paths(&args));
            shell::remember_open(shell::open_paths(&args));
            if profile.is_none() {
                let s = db.get_settings().ok();
                // LANX 2.5.0: the dictation hotkey follows its preference (on unless turned off).
                let (dict_on, mods, vk) = commands::voice::dictation_startup(db.get_setting("pref_dictation").as_deref());
                shell::set_dictation_hotkey(dict_on, mods, vk);
                shell::start_hotkey(app.handle().clone(), s.as_ref().map(|s| s.screenshot_hotkey).unwrap_or(true));
                shell::apply_send_to(s.as_ref().map(|s| s.send_to_menu).unwrap_or(true));
            }

            let start_hidden = std::env::args().any(|a| a == "--minimized");
            START_HIDDEN.store(start_hidden, Ordering::SeqCst);
            if let Some(w) = app.get_webview_window("main") {
                if profile.is_some() {
                    let _ = w.set_title(&format!("LANX — test profile {}", profile.as_deref().unwrap_or("")));
                }
            }
            // LANX 2.5.3: the window is shown by ui_ready, once its page has
            // drawn. If the page never reports in, show it after 6 seconds
            // anyway — the blank-window watchdog needs to see it.
            {
                let app = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(6)).await;
                    if !START_HIDDEN.load(Ordering::SeqCst) && !SHOWN_ONCE.swap(true, Ordering::SeqCst) {
                        eprintln!("[Window] the page did not report in; showing the window anyway");
                        show_main_window(&app);
                    }
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "remote" {
                // LANX 2.0: the remote-control Stop bar only ever hides.
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
                return;
            }
            if window.label() == "island" {
                // The alert window only ever hides.
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
                return;
            }
            if let WindowEvent::Focused(true) = event {
                // LANX came to the front: its own island takes over.
                use tauri::Emitter;
                let _ = window.app_handle().emit_to("island", "lanx://island-dismiss", ());
            }
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
            commands::create_group,
            commands::update_group,
            commands::leave_group,
            commands::get_group,
            commands::get_lock_status,
            commands::unlock,
            commands::lock_app,
            ui_ready,
            commands::island_take,
            commands::get_peer_profiles,
            commands::search_network,
            commands::refresh_peer_profile,
            commands::island_hide,
            commands::island_open,
            commands::set_pin,
            commands::unlock_hidden,
            commands::hide_hidden_chats,
            commands::set_conversation_hidden,
            commands::set_secret_mode,
            commands::send_typing,
            commands::ring,
            commands::set_content_protection,
            commands::send_pasted_image,
            commands::get_image_preview,
            commands::broadcast_message,
            commands::pick_files,
            commands::pick_sound_file,
            commands::play_sound,
            commands::get_update_status,
            commands::install_update,
            commands::pick_update_installer,
            commands::share_update,
            commands::stop_sharing_update,
            commands::send_update_as_file,
            commands::snooze_update,
            commands::set_update_auto_chat,
            commands::backup::get_backups,
            commands::backup::backup_now,
            commands::backup::set_auto_backup,
            commands::backup::restore_backup,
            commands::backup::export_backup,
            commands::backup::pick_backup_file,
            commands::backup::restore_backup_file,
            commands::backup::reveal_backups_folder,
            commands::backup::take_restore_notice,
            commands::backup::set_net_backup,
            commands::backup::net_backup_now,
            commands::send_update_to,
            commands::unsend_update,
            commands::set_update_send_everyone,
            commands::chat::forward_messages,
            commands::chat::mark_chat_unread,
            commands::chat::check_connection,
            commands::remote::remote_allow,
            commands::remote::remote_input,
            commands::remote::remote_stop,
            commands::remote::remote_next_screen,
            commands::remote::remote_info,
            commands::remote::remote_attention,
            commands::remote::clipboard_read,
            commands::remote::clipboard_write,
            commands::remote::remote_test_log,
            commands::remote::remote_test_copy,
            commands::remote::remote_test_block,
            commands::admin::get_admin_state,
            commands::admin::become_admin,
            commands::admin::save_policy,
            commands::admin::stop_admin,
            commands::admin::answer_policy_offer,
            commands::admin::leave_policy,
            commands::admin::set_retention,
            commands::admin::run_retention,
            commands::admin::set_my_apps,
            commands::admin::open_app_link,
            commands::admin::export_excel,
            commands::admin::open_exported,
            commands::admin::export_excel_to,
            commands::calls::call_start,
            commands::calls::call_answer,
            commands::calls::call_decline,
            commands::calls::call_hangup,
            commands::calls::call_media,
            commands::calls::get_call,
            commands::meetings::meeting_start,
            commands::meetings::meeting_invite,
            commands::meetings::meeting_join,
            commands::meetings::meeting_rejoin,
            commands::meetings::meeting_decline,
            commands::meetings::meeting_leave,
            commands::meetings::meeting_signal,
            commands::meetings::meeting_media,
            commands::meetings::meeting_chat,
            commands::meetings::meeting_drop,
            commands::meetings::get_meeting,
            commands::meetings::recording_begin,
            commands::meetings::recording_chunk,
            commands::meetings::recording_end,
            commands::meetings::recording_cancel,
            commands::meetings::open_recording,
            commands::meetings::reveal_recording,
            commands::meetings::open_recordings_folder,
            commands::chat::send_message_ex,
            commands::chat::react_message,
            commands::chat::edit_message,
            commands::chat::delete_message_everyone,
            commands::chat::delete_message_local,
            commands::chat::pin_message,
            commands::chat::star_message,
            commands::chat::list_starred,
            commands::chat::set_reminder,
            commands::chat::cancel_reminder,
            commands::chat::schedule_message,
            commands::chat::cancel_scheduled,
            commands::chat::list_scheduled,
            commands::chat::send_voice_note,
            commands::chat::read_voice_note,
            commands::org::send_card,
            commands::org::card_action,
            commands::org::list_cards,
            commands::org::get_it_helpers,
            commands::org::set_it_helpers,
            commands::org::get_report_to,
            commands::org::set_report_to,
            commands::notes::list_notes,
            commands::notes::save_note,
            commands::notes::delete_note,
            commands::notes::restore_note,
            commands::docs::pick_documents,
            commands::docs::transfer_file_path,
            commands::docs::read_file_bytes,
            commands::docs::save_file_bytes,
            commands::docs::open_document,
            commands::calendar::list_events,
            commands::calendar::list_all_events,
            commands::calendar::save_event,
            commands::calendar::delete_event,
            commands::calendar::export_events_ics,
            commands::calendar::get_pref,
            commands::calendar::set_pref,
            commands::share::share_whatsapp,
            commands::memes::save_meme_file,
            commands::memes::download_meme,
            commands::memes::copy_file_to_clipboard,
            commands::games::send_game,
            commands::wallpaper::pick_wallpaper,
            commands::wallpaper::clear_wallpaper_file,
            commands::voice::voice_models,
            commands::voice::voice_model_chunk,
            commands::voice::voice_model_finish,
            commands::voice::voice_model_delete,
            commands::voice::transcribe,
            commands::voice::transcribe_cancel,
            commands::voice::type_text,
            commands::voice::set_dictation_hotkey,
            commands::voice::save_note_audio,
            commands::voice::delete_note_audio,
            commands::tools::set_chat_pinned,
            commands::tools::set_chat_muted,
            commands::tools::set_chat_archived,
            commands::tools::set_chat_folders,
            commands::tools::search_messages_ex,
            commands::tools::message_for_transfer,
            commands::tools::list_stickers,
            commands::tools::send_sticker,
            commands::tools::capture_screen,
            commands::tools::take_hotkey_capture,
            commands::tools::save_screenshot,
            commands::tools::get_tools_status,
            commands::tools::take_send_request,
            commands::tools::take_open_request,
            commands::tools::pdf_default_status,
            commands::tools::choose_pdf_app,
            commands::tools::open_default_apps,
            commands::docs::save_file_in_folder,
            commands::docs::open_folder,
            commands::tools::pick_folder,
            commands::tools::share_folder,
            commands::tools::subscribe_folder,
            commands::tools::unsubscribe_folder,
            commands::tools::stop_sharing_folder,
            commands::tools::resync_folder,
            commands::tools::list_sync,
            commands::tools::open_sync_folder,
            commands::office::raise_alert,
            commands::office::answer_alert,
            commands::office::clear_alert,
            commands::office::list_alerts,
            commands::office::send_intercom,
            commands::speed_test,
            commands::pick_folder_to_send,
            commands::phone::phone_status,
            commands::phone::phone_set_enabled,
            commands::phone::phone_start_pairing,
            commands::phone::phone_cancel_pairing,
            commands::phone::phone_answer,
            commands::phone::phone_forget,
            commands::phone::phone_qr,
            commands::phone::phone_cert_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LANX desktop application");
}
