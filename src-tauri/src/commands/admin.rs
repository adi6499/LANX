//! LANX 1.9.0 admin commands: office settings (admin side and colleague
//! side), message clean-up, company apps, Excel export.

use super::{AppState, err};
use crate::networking::admin::AdminState;
use crate::storage::models::{AppLink, OfficePolicy, RETENTION_CHOICES};
use parking_lot::Mutex;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

/// Files this window exported (only these can be opened with `open_exported`).
static EXPORTED: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

#[tauri::command]
pub fn get_admin_state(state: State<AppState>) -> Result<AdminState, String> {
    state.network.privacy.guard()?;
    Ok(state.network.admin_state())
}

#[tauri::command]
pub fn become_admin(state: State<AppState>) -> Result<AdminState, String> {
    state.network.privacy.guard()?;
    state.network.become_admin()
}

#[tauri::command]
pub fn save_policy(state: State<AppState>, policy: OfficePolicy) -> Result<AdminState, String> {
    state.network.privacy.guard()?;
    state.network.save_policy(&policy)
}

#[tauri::command]
pub async fn stop_admin(state: State<'_, AppState>) -> Result<AdminState, String> {
    state.network.privacy.guard()?;
    state.network.stop_admin().await
}

#[tauri::command]
pub async fn answer_policy_offer(state: State<'_, AppState>, accept: bool) -> Result<AdminState, String> {
    state.network.privacy.guard()?;
    state.network.answer_policy_offer(accept).await
}

#[tauri::command]
pub async fn leave_policy(state: State<'_, AppState>) -> Result<AdminState, String> {
    state.network.privacy.guard()?;
    state.network.leave_policy().await
}

/// Your own message clean-up (when the admin hasn't chosen one).
#[tauri::command]
pub fn set_retention(state: State<AppState>, days: i64) -> Result<AdminState, String> {
    state.network.privacy.guard()?;
    if !RETENTION_CHOICES.contains(&days) {
        return Err("Unknown choice".to_string());
    }
    if state.db.applied_policy().is_some_and(|p| p.retention_days > 0) {
        return Err("Your LANX admin chose how long messages are kept.".to_string());
    }
    let mut s = state.db.get_settings().map_err(err)?;
    s.retention_days = days;
    state.db.save_settings(&s).map_err(err)?;
    Ok(state.network.admin_state())
}

/// Deletes old messages now (by the clean-up setting); returns how many.
#[tauri::command]
pub fn run_retention(state: State<AppState>) -> Result<usize, String> {
    state.network.privacy.guard()?;
    let n = state.db.apply_retention(crate::networking::now_secs());
    if n > 0 {
        state.network.events.emit_json("lanx://state-changed", ());
    }
    Ok(n)
}

/// Your own Apps launcher links.
#[tauri::command]
pub fn set_my_apps(state: State<AppState>, apps: Vec<AppLink>) -> Result<AdminState, String> {
    state.network.privacy.guard()?;
    let mut s = state.db.get_settings().map_err(err)?;
    s.apps = apps;
    state.db.save_settings(&s).map_err(err)?;
    Ok(state.network.admin_state())
}

/// Opens a link from the Apps launcher (web page, file or folder).
#[tauri::command]
pub fn open_app_link(app: AppHandle, state: State<AppState>, target: String) -> Result<(), String> {
    state.network.privacy.guard()?;
    if !state.db.effective_apps().iter().any(|(a, _)| a.target == target) {
        return Err("That link isn't in your Apps list.".to_string());
    }
    let lower = target.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        app.opener().open_url(&target, None::<&str>).map_err(err)
    } else if std::path::Path::new(&target).exists() {
        app.opener().open_path(&target, None::<&str>).map_err(err)
    } else {
        Err(format!("{} can't be found (is the network drive on?).", target))
    }
}

/// Saves rows as an Excel file (asks where); returns where it went.
#[tauri::command]
pub async fn export_excel(app: AppHandle, state: State<'_, AppState>, file_name: String, sheet: String, rows: Vec<Vec<String>>) -> Result<Option<String>, String> {
    state.network.privacy.guard()?;
    let name = crate::networking::transfer::sanitize_file_name(&format!("{}.xlsx", file_name.trim_end_matches(".xlsx")));
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut builder = app.dialog().file().set_title("Save as Excel").set_file_name(&name).add_filter("Excel workbook", &["xlsx"]);
    if let Some(w) = app.get_webview_window("main") {
        builder = builder.set_parent(&w);
    }
    if let Some(docs) = dirs::document_dir() {
        builder = builder.set_directory(docs);
    }
    builder.save_file(move |p| {
        let _ = tx.send(p);
    });
    let Some(path) = rx.await.map_err(err)?.and_then(|f| f.into_path().ok()) else { return Ok(None) };
    let path = if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("xlsx")) { path } else { path.with_extension("xlsx") };
    let p = path.clone();
    tauri::async_runtime::spawn_blocking(move || crate::export::write_xlsx(&p, &sheet, &rows)).await.map_err(err)??;
    EXPORTED.lock().push(path.clone());
    Ok(Some(path.to_string_lossy().to_string()))
}

/// Opens a file `export_excel` just saved.
#[tauri::command]
pub fn open_exported(app: AppHandle, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !EXPORTED.lock().contains(&p) {
        return Err("Not an exported file".to_string());
    }
    app.opener().open_path(path, None::<&str>).map_err(err)
}

/// LANX 1.9.0 test copies: writes an Excel file without asking (the save
/// dialog can't be automated). Only works in side-by-side test profiles.
#[tauri::command]
pub fn export_excel_to(state: State<AppState>, path: String, sheet: String, rows: Vec<Vec<String>>) -> Result<String, String> {
    if crate::testmode::profile().is_none() {
        return Err("Not available".to_string());
    }
    state.network.privacy.guard()?;
    crate::export::write_xlsx(std::path::Path::new(&path), &sheet, &rows)?;
    Ok(path)
}
