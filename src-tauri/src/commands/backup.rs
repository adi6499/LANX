//! Backup and restore commands (Settings → Backup).

use super::{AppState, err};
use crate::backup::{self, BackupInfo, BackupOverview, PickedBackup, RestoreNotice};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

fn version(app: &AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub fn get_backups(state: State<AppState>) -> Result<BackupOverview, String> {
    state.network.privacy.guard()?;
    Ok(backup::overview(&state.db))
}

#[tauri::command]
pub async fn backup_now(app: AppHandle, state: State<'_, AppState>) -> Result<BackupInfo, String> {
    state.network.privacy.guard()?;
    let db = state.db.clone();
    let v = version(&app);
    tauri::async_runtime::spawn_blocking(move || backup::create_backup(&db, "manual", &v))
        .await
        .map_err(err)?
}

#[tauri::command]
pub fn set_auto_backup(state: State<AppState>, enabled: bool) -> Result<BackupOverview, String> {
    state.network.privacy.guard()?;
    backup::set_auto_enabled(&state.db, enabled)?;
    Ok(backup::overview(&state.db))
}

/// Restores one of the backups in the Backups folder, then restarts LANX.
#[tauri::command]
pub fn restore_backup(app: AppHandle, state: State<AppState>, file_name: String) -> Result<(), String> {
    state.network.privacy.guard()?;
    let path = backup::backup_path(&state.db, &file_name)?;
    backup::stage_restore(&state.db, &path)?;
    crate::relaunch(&app);
    Ok(())
}

/// Saves a password-protected backup file where the user chooses.
#[tauri::command]
pub async fn export_backup(
    app: AppHandle,
    state: State<'_, AppState>,
    password: String,
) -> Result<Option<String>, String> {
    state.network.privacy.guard()?;
    backup::validate_password(&password)?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let name = format!("LANX backup {}.{}", chrono::Local::now().format("%Y-%m-%d"), backup::EXT);
    let mut builder = app
        .dialog()
        .file()
        .set_title("Save the LANX backup file")
        .set_file_name(&name)
        .add_filter("LANX backup", &[backup::EXT]);
    if let Some(w) = app.get_webview_window("main") {
        builder = builder.set_parent(&w);
    }
    builder.save_file(move |f| {
        let _ = tx.send(f);
    });
    let Some(mut dest) = rx.await.map_err(err)?.and_then(|f| f.into_path().ok()) else {
        return Ok(None);
    };
    if dest.extension().is_none_or(|e| e != backup::EXT) {
        dest.set_extension(backup::EXT);
    }
    let db = state.db.clone();
    let v = version(&app);
    let out = dest.clone();
    tauri::async_runtime::spawn_blocking(move || backup::export_backup(&db, &out, &password, &v))
        .await
        .map_err(err)??;
    Ok(Some(dest.to_string_lossy().to_string()))
}

/// Lets the user choose a backup file (from a USB drive, another PC, …).
#[tauri::command]
pub async fn pick_backup_file(app: AppHandle) -> Result<Option<PickedBackup>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut builder = app
        .dialog()
        .file()
        .set_title("Choose a LANX backup file")
        .add_filter("LANX backup", &[backup::EXT, "db"]);
    if let Some(w) = app.get_webview_window("main") {
        builder = builder.set_parent(&w);
    }
    builder.pick_file(move |f| {
        let _ = tx.send(f);
    });
    let Some(path) = rx.await.map_err(err)?.and_then(|f| f.into_path().ok()) else {
        return Ok(None);
    };
    backup::inspect_file(&path).map(Some)
}

/// Restores from a chosen file (password needed for encrypted files), then
/// restarts LANX. Returns "PASSWORD" when a password is needed.
#[tauri::command]
pub async fn restore_backup_file(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    password: Option<String>,
) -> Result<(), String> {
    state.network.privacy.guard()?;
    let db = state.db.clone();
    let src = PathBuf::from(path);
    let imported = tauri::async_runtime::spawn_blocking(move || {
        let info = backup::import_file(&db, &src, password.as_deref())?;
        backup::stage_restore(&db, std::path::Path::new(&info.path))?;
        Ok::<_, String>(info)
    })
    .await
    .map_err(err)??;
    let _ = imported;
    crate::relaunch(&app);
    Ok(())
}

#[tauri::command]
pub fn reveal_backups_folder(state: State<AppState>) -> Result<(), String> {
    let dir = backup::backups_dir(&state.db);
    std::fs::create_dir_all(&dir).map_err(err)?;
    tauri_plugin_opener::open_path(dir.to_string_lossy().to_string(), None::<&str>).map_err(err)
}

/// What happened to a restore at start-up (shown once).
#[tauri::command]
pub fn take_restore_notice() -> Option<RestoreNotice> {
    backup::take_notice()
}
