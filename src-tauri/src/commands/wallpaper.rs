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
    // Unit tests never touch the real LANX folder (switching the wallpaper
    // off removes the kept copy).
    if cfg!(test) {
        return std::env::temp_dir().join("lanx-test-wallpaper");
    }
    crate::storage::data_dir(crate::testmode::profile().as_deref()).join("wallpaper")
}

#[derive(Debug, serde::Serialize)]
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
    pick_into(&app, wallpaper_dir(), "wallpaper").await
}

/// Shows the file picker and keeps a copy of the chosen picture or video as
/// `<base>.<ext>`, the one file in `dir` (LANX 3.14.0: the wallpaper screen keeps its own).
pub(super) async fn pick_into(app: &AppHandle, dir: PathBuf, base: &str) -> Result<Option<WallpaperFile>, String> {
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
    std::fs::create_dir_all(&dir).map_err(err)?;
    // One wallpaper at a time: old copies go.
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let _ = std::fs::remove_file(e.path());
        }
    }
    let name = src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| format!("{base}.{ext}"));
    let dest = dir.join(format!("{base}.{ext}"));
    std::fs::copy(&src, &dest).map_err(err)?;
    Ok(Some(WallpaperFile { path: dest.to_string_lossy().to_string(), name, kind: kind.to_string(), bytes: size }))
}

/// Removes the kept copy (when the wallpaper is switched off or changed).
#[tauri::command(async)]
pub fn clear_wallpaper_file() -> Result<(), String> {
    let dir = wallpaper_dir();
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let _ = std::fs::remove_file(e.path());
        }
    }
    Ok(())
}

// ------------------------------------------------- the phone (LANX 3.4)

/// The built-in wallpapers (src/lib/wallpaper.ts draws them).
pub const BUILTIN_IDS: [&str; 9] = ["aurora", "ocean", "night", "bokeh", "rain", "meadow", "bloom", "silk", "horizon"];
/// Biggest wallpaper file accepted (also from the phone).
pub const MAX_WALLPAPER_BYTES: u64 = MAX_BYTES;

/// "image" / "video" by the file's name, or None for anything else.
pub fn kind_of(name: &str) -> Option<&'static str> {
    let ext = std::path::Path::new(name).extension()?.to_string_lossy().to_ascii_lowercase();
    if IMAGE.contains(&ext.as_str()) {
        Some("image")
    } else if VIDEO.contains(&ext.as_str()) {
        Some("video")
    } else {
        None
    }
}

/// True when `path` is a file inside LANX's wallpaper folder.
fn in_wallpaper_dir(path: &str) -> Option<PathBuf> {
    let p = std::fs::canonicalize(path).ok()?;
    let dir = std::fs::canonicalize(wallpaper_dir()).ok()?;
    (p.starts_with(&dir) && p.is_file()).then_some(p)
}

/// The wallpaper file in use (the phone shows it too) and its original name:
/// only the copy in LANX's wallpaper folder that the "wallpaper" preference
/// names, never a file anywhere else.
pub fn current_file(db: &crate::storage::Database) -> Option<(PathBuf, String)> {
    let v: serde_json::Value = serde_json::from_str(&db.get_setting("pref_wallpaper")?).ok()?;
    if v["kind"] != "file" {
        return None;
    }
    let path = in_wallpaper_dir(v["path"].as_str()?)?;
    let name = v["name"].as_str().map(str::to_string).unwrap_or_else(|| path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default());
    Some((path, name))
}

/// Where a picture or video sent from the phone goes (`wallpaper.<ext>`)
/// and its kind; anything but a picture or video is refused. The upload is
/// written next to it first and only then takes its place (`take_upload`),
/// so a cut-short upload leaves the wallpaper as it was.
pub fn new_file_for(name: &str) -> Result<(PathBuf, PathBuf, &'static str), String> {
    let kind = kind_of(name).ok_or_else(|| "Pick a picture (png, jpg, webp, gif) or a video (mp4, webm, mov).".to_string())?;
    let ext = std::path::Path::new(name).extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    let dir = wallpaper_dir();
    std::fs::create_dir_all(&dir).map_err(err)?;
    Ok((dir.join("upload.lanxpart"), dir.join(format!("wallpaper.{ext}")), kind))
}

/// The finished upload becomes the one wallpaper file (old copies go).
pub fn take_upload(part: &std::path::Path, dest: &std::path::Path) -> Result<(), String> {
    if let Ok(rd) = std::fs::read_dir(wallpaper_dir()) {
        for e in rd.flatten() {
            if e.path() != part {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    std::fs::rename(part, dest).map_err(err)
}

/// A wallpaper choice from the phone, checked and tidied (the same shape
/// src/lib/wallpaper.ts keeps): a built-in LANX knows, a file in the
/// wallpaper folder, or none; darken 0–80, blur 0–20.
pub fn clean_choice(v: &serde_json::Value) -> Result<serde_json::Value, String> {
    let dim = v["dim"].as_i64().unwrap_or(20).clamp(0, 80);
    let blur = v["blur"].as_i64().unwrap_or(0).clamp(0, 20);
    match v["kind"].as_str().unwrap_or("none") {
        "none" => Ok(serde_json::json!({ "kind": "none", "dim": dim, "blur": blur })),
        "builtin" => {
            let id = v["id"].as_str().unwrap_or("");
            if !BUILTIN_IDS.contains(&id) {
                return Err("Unknown wallpaper".to_string());
            }
            Ok(serde_json::json!({ "kind": "builtin", "id": id, "dim": dim, "blur": blur }))
        }
        "file" => {
            let path = in_wallpaper_dir(v["path"].as_str().unwrap_or("")).ok_or_else(|| "That wallpaper file is gone. Pick it again.".to_string())?;
            let name: String = v["name"].as_str().unwrap_or("").chars().filter(|c| !c.is_control()).take(120).collect();
            Ok(serde_json::json!({ "kind": "file", "path": path.to_string_lossy(), "name": name, "dim": dim, "blur": blur }))
        }
        _ => Err("Unknown wallpaper".to_string()),
    }
}
