//! LANX 2.5.0: files for the PDF tools and the Notes app — choosing a file,
//! reading its bytes into the window, saving bytes to a file the user picks.
//!
//! The window may only read files it was given: ones the user picked in a
//! dialog, received files (through `transfer_file_path`), files LANX saved,
//! and anything in the LANX download folder.

use super::{err, AppState};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// Files the window is allowed to read (chosen, received or saved this session).
static OPENED: Mutex<Option<HashSet<PathBuf>>> = Mutex::new(None);
/// The biggest file the PDF tools open (a PDF, not a video).
pub const MAX_READ_BYTES: u64 = 200 * 1024 * 1024;

fn allow(path: &Path) {
    if let Ok(mut g) = OPENED.lock() {
        g.get_or_insert_with(HashSet::new).insert(path.to_path_buf());
    }
}

fn allowed(path: &Path, download_dir: &Path) -> bool {
    if OPENED.lock().ok().and_then(|g| g.as_ref().map(|s| s.contains(path))).unwrap_or(false) {
        return true;
    }
    let p = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let d = std::fs::canonicalize(download_dir).unwrap_or_else(|_| download_dir.to_path_buf());
    if p.starts_with(&d) {
        return true;
    }
    // The wallpaper copy LANX keeps in its own data folder.
    let w = super::wallpaper::wallpaper_dir();
    let w = std::fs::canonicalize(&w).unwrap_or(w);
    p.starts_with(&w)
}

/// May the window read / share this file? (Used by the WhatsApp sharing too.)
pub(crate) fn is_allowed(state: &State<AppState>, path: &Path) -> bool {
    allowed(path, &download_dir(state))
}

fn download_dir(state: &State<AppState>) -> PathBuf {
    state
        .db
        .get_settings()
        .ok()
        .map(|s| PathBuf::from(s.default_download_dir))
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| dirs::download_dir().unwrap_or_default())
}

/// Lets the user pick PDFs (and pictures, for "pictures → PDF").
#[tauri::command]
pub async fn pick_documents(app: AppHandle, state: State<'_, AppState>, kind: String) -> Result<Vec<String>, String> {
    state.network.privacy.guard()?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut builder = app.dialog().file().set_title(if kind == "images" { "Choose pictures" } else { "Choose a PDF" });
    builder = match kind.as_str() {
        "images" => builder.add_filter("Pictures", &["png", "jpg", "jpeg", "webp", "bmp", "gif"]),
        "any" => builder.add_filter("PDF and pictures", &["pdf", "png", "jpg", "jpeg", "webp", "bmp", "gif"]),
        _ => builder.add_filter("PDF files", &["pdf"]),
    };
    if let Some(w) = app.get_webview_window("main") {
        builder = builder.set_parent(&w);
    }
    builder.pick_files(move |files| {
        let _ = tx.send(files);
    });
    let files = rx.await.map_err(err)?.unwrap_or_default();
    let mut out = Vec::new();
    for f in files {
        if let Ok(p) = f.into_path() {
            allow(&p);
            out.push(p.to_string_lossy().to_string());
        }
    }
    Ok(out)
}

/// Where a received (or sent) file is on this PC, so the PDF tools can open it.
#[tauri::command]
pub fn transfer_file_path(state: State<AppState>, transfer_id: String) -> Result<String, String> {
    state.network.privacy.guard()?;
    let t = state.db.get_transfer(&transfer_id).map_err(err)?.ok_or("File not found")?;
    if t.direction == "incoming" && t.status != "completed" {
        return Err("The file hasn't fully arrived yet.".to_string());
    }
    let path = t.local_path.ok_or("The file isn't on this computer.")?;
    let p = PathBuf::from(&path);
    if !p.is_file() {
        return Err("The file is no longer where LANX saved it.".to_string());
    }
    allow(&p);
    Ok(path)
}

/// The bytes of a file the window was given (raw, not JSON).
#[tauri::command]
pub fn read_file_bytes(state: State<AppState>, path: String) -> Result<tauri::ipc::Response, String> {
    state.network.privacy.guard()?;
    let p = PathBuf::from(&path);
    if !allowed(&p, &download_dir(&state)) {
        return Err("LANX can only open files you chose or received.".to_string());
    }
    let meta = std::fs::metadata(&p).map_err(|_| "File not found".to_string())?;
    if meta.len() > MAX_READ_BYTES {
        return Err("That file is too big to open here (over 200 MB).".to_string());
    }
    Ok(tauri::ipc::Response::new(std::fs::read(&p).map_err(err)?))
}

fn save_to(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(err)?;
    }
    std::fs::write(path, bytes).map_err(err)
}

/// Saves raw bytes (the body) to a file the user picks. Headers: `x-file-name`
/// (suggested name) and `x-kind` ("pdf" or "txt"). Test copies save straight
/// into their download folder (no dialog). Returns the path, or null if the
/// user cancelled.
#[tauri::command]
pub async fn save_file_bytes(app: AppHandle, state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> Result<Option<String>, String> {
    state.network.privacy.guard()?;
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok()).map(|s| s.to_string());
    let kind = header("x-kind").unwrap_or_else(|| "pdf".to_string());
    let ext = match kind.as_str() {
        "txt" => "txt",
        "ics" => "ics",
        _ => "pdf",
    };
    let suggested = header("x-file-name").unwrap_or_else(|| format!("LANX.{ext}"));
    let suggested = crate::networking::transfer::sanitize_file_name(&suggested);
    let suggested = if suggested.to_ascii_lowercase().ends_with(&format!(".{ext}")) { suggested } else { format!("{suggested}.{ext}") };
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(b) => b.clone(),
        _ => return Err("Expected file data".to_string()),
    };
    if bytes.is_empty() {
        return Err("Nothing to save".to_string());
    }

    if crate::testmode::profile().is_some() {
        let dir = download_dir(&state);
        let path = crate::networking::transfer::unique_destination(&dir, &suggested);
        save_to(&path, &bytes)?;
        allow(&path);
        return Ok(Some(path.to_string_lossy().to_string()));
    }

    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut builder = app
        .dialog()
        .file()
        .set_title(match ext {
            "txt" => "Save note",
            "ics" => "Save calendar",
            _ => "Save PDF",
        })
        .set_file_name(&suggested)
        .add_filter(
            match ext {
                "txt" => "Text file",
                "ics" => "Calendar file",
                _ => "PDF file",
            },
            &[ext],
        );
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
    let path = if path.extension().is_some_and(|e| e.eq_ignore_ascii_case(ext)) { path } else { path.with_extension(ext) };
    save_to(&path, &bytes)?;
    allow(&path);
    Ok(Some(path.to_string_lossy().to_string()))
}

/// Opens a file LANX saved or was given, with the normal program for it.
#[tauri::command]
pub fn open_document(app: AppHandle, state: State<AppState>, path: String) -> Result<(), String> {
    state.network.privacy.guard()?;
    let p = PathBuf::from(&path);
    if !allowed(&p, &download_dir(&state)) {
        return Err("LANX can only open files you chose or received.".to_string());
    }
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_path(path, None::<&str>).map_err(err)
}
