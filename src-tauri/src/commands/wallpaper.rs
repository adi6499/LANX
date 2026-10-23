//! LANX 2.5.0: live wallpapers from the user's own files. The chosen picture
//! or video is copied into LANX's data folder (so it stays even if the
//! original moves) and read from there by the window.

use super::{err, AppState};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

const IMAGE: [&str; 6] = ["png", "jpg", "jpeg", "webp", "gif", "bmp"];
const VIDEO: [&str; 4] = ["mp4", "webm", "mov", "m4v"];
/// Videos bigger than this would make LANX heavy; pick a shorter clip.
const MAX_BYTES: u64 = 150 * 1024 * 1024;

pub fn wallpaper_dir() -> PathBuf {
    crate::storage::data_dir(crate::testmode::profile().as_deref()).join("wallpaper")
}

#[derive(serde::Serialize)]
pub struct WallpaperFile {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub bytes: u64,
}

/// Lets the user pick a picture or video and keeps a copy for the wallpaper.
#[tauri::command]
pub async fn pick_wallpaper(app: AppHandle, state: State<'_, AppState>) -> Result<Option<WallpaperFile>, String> {
    state.network.privacy.guard()?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut builder = app
        .dialog()
        .file()
        .set_title("Choose a picture or video")
        .add_filter("Pictures and videos", &[&IMAGE[..], &VIDEO[..]].concat())
        .add_filter("Videos", &VIDEO)
        .add_filter("Pictures", &IMAGE);
    if let Some(w) = app.get_webview_window("main") {
        builder = builder.set_parent(&w);
    }
    builder.pick_file(move |f| {
        let _ = tx.send(f);
    });
    let Some(src) = rx.await.map_err(err)?.and_then(|f| f.into_path().ok()) else { return Ok(None) };
    let ext = src.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    let kind = if IMAGE.contains(&ext.as_str()) {
        "image"
    } else if VIDEO.contains(&ext.as_str()) {
        "video"
    } else {
        return Err("Pick a picture (png, jpg, webp, gif) or a video (mp4, webm, mov).".to_string());
    };
    let size = std::fs::metadata(&src).map_err(err)?.len();
    if size > MAX_BYTES {
        return Err("That file is over 150 MB. A shorter clip works better as a wallpaper.".to_string());
    }
    let dir = wallpaper_dir();
    std::fs::create_dir_all(&dir).map_err(err)?;
    // One wallpaper at a time: old copies go.
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let _ = std::fs::remove_file(e.path());
        }
    }
    let name = src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| format!("wallpaper.{ext}"));
    let dest = dir.join(format!("wallpaper.{ext}"));
    std::fs::copy(&src, &dest).map_err(err)?;
    Ok(Some(WallpaperFile { path: dest.to_string_lossy().to_string(), name, kind: kind.to_string(), bytes: size }))
}

/// Removes the kept copy (when the wallpaper is switched off or changed).
#[tauri::command]
pub fn clear_wallpaper_file() -> Result<(), String> {
    let dir = wallpaper_dir();
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let _ = std::fs::remove_file(e.path());
        }
    }
    Ok(())
}
