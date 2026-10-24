//! LANX 2.6.0: the hidden meme & GIF picker (type `/meme` in a chat). The
//! pictures it makes or fetches are kept in LANX's own folder, from where they
//! are sent in a chat, put on the clipboard (paste into WhatsApp, Outlook,
//! Word…) or shared through WhatsApp.

use std::path::PathBuf;
use tauri::State;

use super::{err, AppState};

pub fn memes_dir() -> PathBuf {
    crate::storage::data_dir(crate::testmode::profile().as_deref()).join("memes")
}

#[derive(serde::Serialize)]
pub struct SavedMeme {
    pub file: String,
    pub bytes: u64,
}

/// Saves a picture or GIF the picker made or fetched (raw body; `x-ext` =
/// png | jpg | gif | webp | mp4, `x-name` = a word or two for the file name).
#[tauri::command]
pub fn save_meme_file(state: State<AppState>, request: tauri::ipc::Request<'_>) -> Result<SavedMeme, String> {
    state.network.privacy.guard()?;
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok()).map(|s| s.to_string());
    let ext = header("x-ext")
        .map(|s| s.to_ascii_lowercase())
        .filter(|s| ["png", "jpg", "jpeg", "gif", "webp", "mp4", "m4a"].contains(&s.as_str()))
        .unwrap_or_else(|| "png".to_string());
    let hint: String = header("x-name")
        .unwrap_or_default()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == ' ' || *c == '-')
        .take(40)
        .collect::<String>()
        .trim()
        .replace(' ', "-")
        .to_ascii_lowercase();
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(b) => b,
        _ => return Err("Expected picture data".to_string()),
    };
    if bytes.is_empty() {
        return Err("The picture is empty".to_string());
    }
    if bytes.len() > 30 * 1024 * 1024 {
        return Err("That file is too big (over 30 MB).".to_string());
    }
    let dir = memes_dir();
    std::fs::create_dir_all(&dir).map_err(err)?;
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let short = &uuid::Uuid::new_v4().to_string()[..6];
    let name = if hint.is_empty() { format!("meme-{stamp}-{short}.{ext}") } else { format!("{hint}-{stamp}-{short}.{ext}") };
    let path = dir.join(&name);
    std::fs::write(&path, bytes).map_err(err)?;
    Ok(SavedMeme { file: path.to_string_lossy().to_string(), bytes: bytes.len() as u64 })
}

/// Picture hosts the picker may download from (nothing else, ever).
const DOWNLOAD_HOSTS: [&str; 6] = ["i.redd.it", "preview.redd.it", "i.imgflip.com", "api.memegen.link", "media.tenor.com", "c.tenor.com"];

/// Downloads a meme picture into LANX's meme folder (for hosts the page itself
/// may not fetch from). `ext` = png | jpg | gif | webp.
#[tauri::command]
pub async fn download_meme(state: State<'_, AppState>, url: String, ext: String, name: String) -> Result<SavedMeme, String> {
    state.network.privacy.guard()?;
    let u = url.trim().to_string();
    let host = u.strip_prefix("https://").and_then(|r| r.split('/').next()).unwrap_or("");
    if host.is_empty() || !DOWNLOAD_HOSTS.contains(&host) || u.len() > 600 || u.contains('\'') || u.contains('"') {
        return Err("LANX only downloads memes from the meme services it knows.".to_string());
    }
    let ext = ext.to_ascii_lowercase();
    if !["png", "jpg", "jpeg", "gif", "webp"].contains(&ext.as_str()) {
        return Err("Not a picture.".to_string());
    }
    let hint: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || *c == ' ' || *c == '-').take(40).collect::<String>().trim().replace(' ', "-").to_ascii_lowercase();
    let dir = memes_dir();
    std::fs::create_dir_all(&dir).map_err(err)?;
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let short = &uuid::Uuid::new_v4().to_string()[..6];
    let path = dir.join(if hint.is_empty() { format!("meme-{stamp}-{short}.{ext}") } else { format!("{hint}-{stamp}-{short}.{ext}") });
    let target = path.clone();
    tauri::async_runtime::spawn_blocking(move || fetch_to_file(&u, &target)).await.map_err(err)??;
    let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    if bytes < 100 {
        let _ = std::fs::remove_file(&path);
        return Err("The picture could not be downloaded.".to_string());
    }
    Ok(SavedMeme { file: path.to_string_lossy().to_string(), bytes })
}

#[cfg(windows)]
fn fetch_to_file(url: &str, target: &std::path::Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let t = target.to_string_lossy().replace('\'', "''");
    let script = format!("[Net.ServicePointManager]::SecurityProtocol = 'Tls12'; Invoke-WebRequest -Uri '{url}' -OutFile '{t}' -UseBasicParsing -TimeoutSec 40 -Headers @{{ 'User-Agent' = 'LANX' }}");
    let out = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(err)?;
    if !out.status.success() {
        return Err("The picture could not be downloaded (no internet, or the post is gone).".to_string());
    }
    Ok(())
}

#[cfg(not(windows))]
fn fetch_to_file(url: &str, target: &std::path::Path) -> Result<(), String> {
    let out = std::process::Command::new("curl").args(["-fsSL", "--max-time", "40", "-A", "LANX", "-o"]).arg(target).arg(url).output().map_err(err)?;
    if !out.status.success() {
        return Err("The picture could not be downloaded.".to_string());
    }
    Ok(())
}

/// Puts a file LANX chose, received or saved on the clipboard: as the file
/// itself (WhatsApp Desktop, Explorer, Outlook paste it) and, for a picture,
/// also as a picture (WhatsApp Web in a browser, Word, Paint).
#[tauri::command]
pub fn copy_file_to_clipboard(state: State<AppState>, path: String) -> Result<(), String> {
    state.network.privacy.guard()?;
    let p = PathBuf::from(&path);
    if !super::docs::is_allowed(&state, &p) || !p.is_file() {
        return Err("LANX can only copy files you chose, received or saved.".to_string());
    }
    copy_picture_and_file(&p)
}

#[cfg(windows)]
fn copy_picture_and_file(path: &std::path::Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let p = path.to_string_lossy().replace('\'', "''");
    let is_picture = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| ["png", "jpg", "jpeg", "gif", "bmp", "webp"].contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false);
    // One clipboard entry with both the file and (for pictures) the image.
    let script = format!(
        "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; \
         $d = New-Object System.Windows.Forms.DataObject; \
         $files = New-Object System.Collections.Specialized.StringCollection; [void]$files.Add('{p}'); $d.SetFileDropList($files); \
         if ({pic}) {{ try {{ $img = [System.Drawing.Image]::FromFile('{p}'); $d.SetImage($img) }} catch {{}} }} \
         [System.Windows.Forms.Clipboard]::SetDataObject($d, $true)",
        pic = if is_picture { "$true" } else { "$false" }
    );
    let out = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-STA", "-Command", &script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(err)?;
    if !out.status.success() {
        // Fall back to the plain file copy LANX already uses for WhatsApp.
        return super::share::copy_file_to_clipboard(&path.to_path_buf());
    }
    Ok(())
}

#[cfg(not(windows))]
fn copy_picture_and_file(path: &std::path::Path) -> Result<(), String> {
    super::share::copy_file_to_clipboard(&path.to_path_buf())
}
