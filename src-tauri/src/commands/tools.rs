//! LANX 1.7.0 tools: chat folders / mute / archive / pin, search with
//! filters, stickers, screenshots, "Send to → LANX" and shared folders.

use super::{AppState, err, guard_conversation};
use crate::networking::now_secs;
use crate::storage::models::{Conversation, Message, SearchHit};
use crate::storage::tools::{SearchFilter, SyncShare, SyncSubscription};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

fn conversation(state: &AppState, id: &str) -> Result<Conversation, String> {
    state.db.get_conversation(id).map_err(err)?.ok_or_else(|| "Chat not found".to_string())
}

#[tauri::command]
pub fn set_chat_pinned(state: State<AppState>, conversation_id: String, pinned: bool) -> Result<Conversation, String> {
    guard_conversation(&state, &conversation_id)?;
    state.db.set_conversation_pinned(&conversation_id, pinned).map_err(err)?;
    conversation(&state, &conversation_id)
}

/// `minutes`: how long (-1 = until turned back on, 0 = turn sounds back on).
#[tauri::command]
pub fn set_chat_muted(state: State<AppState>, conversation_id: String, minutes: i64) -> Result<Conversation, String> {
    guard_conversation(&state, &conversation_id)?;
    let until = match minutes {
        m if m < 0 => -1,
        0 => 0,
        m => now_secs() + m.min(60 * 24 * 366) * 60,
    };
    state.db.set_conversation_muted(&conversation_id, until).map_err(err)?;
    state.network.events.update_tray(&state.db);
    conversation(&state, &conversation_id)
}

#[tauri::command]
pub fn set_chat_archived(state: State<AppState>, conversation_id: String, archived: bool) -> Result<Conversation, String> {
    guard_conversation(&state, &conversation_id)?;
    state.db.set_conversation_archived(&conversation_id, archived).map_err(err)?;
    conversation(&state, &conversation_id)
}

/// The chat folders a chat is in (ids from Settings → chat folders).
#[tauri::command]
pub fn set_chat_folders(state: State<AppState>, conversation_id: String, folders: Vec<String>) -> Result<Conversation, String> {
    guard_conversation(&state, &conversation_id)?;
    let known: Vec<String> = state.db.get_settings().map_err(err)?.chat_folders.into_iter().map(|f| f.id).collect();
    let mut list: Vec<String> = folders.into_iter().filter(|f| known.contains(f)).collect();
    list.dedup();
    state.db.set_conversation_folders(&conversation_id, &list).map_err(err)?;
    conversation(&state, &conversation_id)
}

#[tauri::command(async)]
pub fn search_messages_ex(state: State<AppState>, query: String, filter: SearchFilter) -> Result<Vec<SearchHit>, String> {
    let privacy = &state.network.privacy;
    privacy.guard()?;
    state.db.search_messages_ex(&query, &filter, 300, privacy.hidden_unlocked()).map_err(err)
}

/// The chat message a file was sent in (file library → "Show in chat").
#[tauri::command(async)]
pub fn message_for_transfer(state: State<AppState>, transfer_id: String) -> Result<Option<Message>, String> {
    let privacy = &state.network.privacy;
    privacy.guard()?;
    let m = state.db.message_for_transfer(&transfer_id).map_err(err)?;
    Ok(m.filter(|m| privacy.hidden_unlocked() || !state.db.is_conversation_hidden(&m.conversation_id)))
}

// ------------------------------------------------------------------ stickers

#[derive(Serialize)]
pub struct Sticker {
    id: &'static str,
    emoji: &'static str,
    words: &'static str,
}

#[tauri::command(async)]
pub fn list_stickers() -> Vec<Sticker> {
    crate::networking::tools::STICKERS.iter().map(|(id, emoji, words)| Sticker { id, emoji, words }).collect()
}

#[tauri::command]
pub async fn send_sticker(state: State<'_, AppState>, conversation_id: String, id: String) -> Result<Message, String> {
    guard_conversation(&state, &conversation_id)?;
    state.network.send_sticker(&conversation_id, &id).await
}

// --------------------------------------------------------------- screenshots

/// Hides LANX, pictures the whole screen, shows LANX again.
#[tauri::command]
pub async fn capture_screen(app: AppHandle, state: State<'_, AppState>) -> Result<tauri::ipc::Response, String> {
    state.network.privacy.guard()?;
    let main = app.get_webview_window("main");
    if let Some(w) = &main {
        let _ = w.hide();
    }
    tokio::time::sleep(std::time::Duration::from_millis(350)).await;
    let shot = tauri::async_runtime::spawn_blocking(crate::shell::capture_screen).await.map_err(err)?;
    if let Some(w) = &main {
        let _ = w.show();
        let _ = w.set_focus();
    }
    Ok(tauri::ipc::Response::new(crate::shell::capture_bytes(shot?)))
}

/// The picture taken with Ctrl + Alt + S (once).
#[tauri::command]
pub fn take_hotkey_capture(state: State<AppState>) -> Result<tauri::ipc::Response, String> {
    state.network.privacy.guard()?;
    let shot = crate::shell::take_last_capture().ok_or("No screenshot waiting")?;
    Ok(tauri::ipc::Response::new(crate::shell::capture_bytes(shot)))
}

/// Saves an edited screenshot to Pictures\LANX Screenshots and shows it.
#[tauri::command(async)]
pub fn save_screenshot(state: State<AppState>, data_base64: String) -> Result<String, String> {
    state.network.privacy.guard()?;
    let tmp = state.network.save_pasted_image(&data_base64, "image/png")?;
    let dir = dirs::picture_dir().unwrap_or_else(|| dirs::home_dir().unwrap_or_default()).join("LANX Screenshots");
    std::fs::create_dir_all(&dir).map_err(err)?;
    let name = tmp.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "Screenshot.png".to_string());
    let path = crate::networking::transfer::unique_destination(&dir, &name);
    std::fs::rename(&tmp, &path).or_else(|_| std::fs::copy(&tmp, &path).map(|_| ())).map_err(err)?;
    Ok(path.to_string_lossy().to_string())
}

#[derive(Serialize)]
pub struct ToolsStatus {
    hotkey: &'static str,
    hotkey_working: bool,
}

#[tauri::command(async)]
pub fn get_tools_status() -> ToolsStatus {
    ToolsStatus { hotkey: crate::shell::HOTKEY_LABEL, hotkey_working: crate::shell::hotkey_working() }
}

/// Files and folders from Explorer's "Send to → LANX" (once).
#[tauri::command]
pub fn take_send_request(state: State<AppState>) -> Result<Vec<String>, String> {
    state.network.privacy.guard()?;
    Ok(crate::shell::take_send_request())
}

// ------------------------------------------------------------ PDFs open in LANX (2.14.0)

/// PDFs Windows asked LANX to open (a double-click in Explorer), once. They may be read afterwards.
#[tauri::command]
pub fn take_open_request(state: State<AppState>) -> Result<Vec<String>, String> {
    state.network.privacy.guard()?;
    let paths = crate::shell::take_open_request();
    for p in &paths {
        super::docs::allow_path(std::path::Path::new(p));
    }
    Ok(paths)
}

/// Which program Windows opens PDFs with for this user.
#[derive(Serialize, Clone)]
pub struct PdfDefault {
    pub is_lanx: bool,
    pub current: String,
}

#[tauri::command(async)]
pub fn pdf_default_status() -> PdfDefault {
    let prog = pdf_prog_id().unwrap_or_default();
    PdfDefault { is_lanx: prog.eq_ignore_ascii_case("LANX.pdf"), current: prog }
}

#[cfg(windows)]
fn reg_string(root: windows_sys::Win32::System::Registry::HKEY, sub: &str, value: &str) -> Option<String> {
    use windows_sys::Win32::System::Registry::{RegGetValueW, RRF_RT_REG_SZ};
    let w = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let sub = w(sub);
    let value = w(value);
    let mut size: u32 = 0;
    unsafe {
        if RegGetValueW(root, sub.as_ptr(), value.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), std::ptr::null_mut(), &mut size) != 0 || size == 0 {
            return None;
        }
        let mut buf = vec![0u16; size as usize / 2 + 1];
        if RegGetValueW(root, sub.as_ptr(), value.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), buf.as_mut_ptr() as *mut _, &mut size) != 0 {
            return None;
        }
        let n = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        Some(String::from_utf16_lossy(&buf[..n]))
    }
}

/// The ProgID Windows uses for .pdf: this user's own choice first, else the machine's.
fn pdf_prog_id() -> Option<String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Registry::{HKEY_CLASSES_ROOT, HKEY_CURRENT_USER};
        reg_string(HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.pdf\UserChoice", "ProgId")
            .filter(|s| !s.is_empty())
            .or_else(|| reg_string(HKEY_CLASSES_ROOT, ".pdf", ""))
    }
    #[cfg(not(windows))]
    {
        None
    }
}

/// A small PDF that says what it is, for the "Open with" box.
#[cfg(windows)]
fn sample_pdf() -> Vec<u8> {
    let objs = [
        "<</Type/Catalog/Pages 2 0 R>>",
        "<</Type/Pages/Kids[3 0 R]/Count 1>>",
        "<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
        "",
        "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    ];
    let stream = "BT /F1 22 Tf 60 760 Td (LANX opens your PDF files.) Tj ET";
    let mut out = String::from("%PDF-1.4\n");
    let mut offsets = Vec::new();
    for (i, o) in objs.iter().enumerate() {
        offsets.push(out.len());
        if i == 3 {
            out.push_str(&format!("4 0 obj<</Length {}>>stream\n{stream}\nendstream\nendobj\n", stream.len()));
        } else {
            out.push_str(&format!("{} 0 obj{o}endobj\n", i + 1));
        }
    }
    let xref = out.len();
    out.push_str(&format!("xref\n0 {}\n0000000000 65535 f \n", objs.len() + 1));
    for off in offsets {
        out.push_str(&format!("{off:010} 00000 n \n"));
    }
    out.push_str(&format!("trailer<</Size {}/Root 1 0 R>>\nstartxref\n{xref}\n%%EOF\n", objs.len() + 1));
    out.into_bytes()
}

/// Windows' own "How do you want to open .pdf files?" box (with "Always"):
/// the one way a program may become the default — the person chooses.
#[tauri::command(async)]
pub fn choose_pdf_app(app: AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let sample = dir.join("LANX sample.pdf");
        std::fs::write(&sample, sample_pdf()).map_err(|e| e.to_string())?;
        let hwnd = app.get_webview_window("main").and_then(|w| w.hwnd().ok()).map(|h| h.0 as isize).unwrap_or(0);
        std::thread::spawn(move || unsafe {
            use windows_sys::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
            use windows_sys::Win32::UI::Shell::{OAIF_FORCE_REGISTRATION, OAIF_REGISTER_EXT, OPENASINFO, SHOpenWithDialog};
            let _ = CoInitializeEx(std::ptr::null(), COINIT_APARTMENTTHREADED as u32);
            let file: Vec<u16> = sample.to_string_lossy().encode_utf16().chain(std::iter::once(0)).collect();
            let info = OPENASINFO { pcszFile: file.as_ptr(), pcszClass: std::ptr::null(), oaifInFlags: OAIF_REGISTER_EXT | OAIF_FORCE_REGISTRATION };
            let _ = SHOpenWithDialog(hwnd as *mut _, &info);
            CoUninitialize();
        });
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("Only on Windows".to_string())
    }
}

/// Windows Settings → Default apps.
#[tauri::command(async)]
pub fn open_default_apps(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url("ms-settings:defaultapps", None::<&str>).map_err(|e| e.to_string())
}

// ------------------------------------------------------------ shared folders

#[tauri::command]
pub async fn pick_folder(app: AppHandle, state: State<'_, AppState>, title: String) -> Result<Option<String>, String> {
    // Test copies: their download folder, with no dialog (the PDF tools' Split and pictures).
    if crate::testmode::profile().is_some() {
        let dir = super::docs::download_dir(&state);
        let _ = std::fs::create_dir_all(&dir);
        super::docs::allow_dir(&dir);
        return Ok(Some(dir.to_string_lossy().to_string()));
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut builder = app.dialog().file().set_title(title);
    if let Some(w) = app.get_webview_window("main") {
        builder = builder.set_parent(&w);
    }
    builder.pick_folder(move |folder| {
        let _ = tx.send(folder);
    });
    let picked = rx.await.map_err(err)?.and_then(|f| f.into_path().ok());
    if let Some(p) = &picked {
        super::docs::allow_dir(p); // the PDF tools may save into it and open it (2.14.0)
    }
    Ok(picked.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn share_folder(state: State<'_, AppState>, conversation_id: String, path: String) -> Result<Message, String> {
    guard_conversation(&state, &conversation_id)?;
    state.network.share_folder(&conversation_id, &path).await
}

#[tauri::command]
pub async fn subscribe_folder(state: State<'_, AppState>, message_id: String, dest: String) -> Result<SyncSubscription, String> {
    state.network.privacy.guard()?;
    state.network.subscribe_folder(&message_id, &dest).await
}

#[tauri::command]
pub async fn unsubscribe_folder(state: State<'_, AppState>, share_id: String) -> Result<(), String> {
    state.network.privacy.guard()?;
    state.network.unsubscribe_folder(&share_id).await
}

#[tauri::command]
pub async fn stop_sharing_folder(state: State<'_, AppState>, share_id: String) -> Result<(), String> {
    state.network.privacy.guard()?;
    state.network.stop_sharing_folder(&share_id).await
}

#[tauri::command(async)]
pub fn resync_folder(state: State<AppState>, share_id: String) -> Result<(), String> {
    state.network.privacy.guard()?;
    state.network.resync_folder(&share_id)
}

#[derive(Serialize)]
pub struct SharedFolderInfo {
    #[serde(flatten)]
    share: SyncShare,
    waiting: i64,
}

#[derive(Serialize)]
pub struct SyncOverview {
    shares: Vec<SharedFolderInfo>,
    subscriptions: Vec<SyncSubscription>,
}

#[tauri::command(async)]
pub fn list_sync(state: State<AppState>) -> Result<SyncOverview, String> {
    state.network.privacy.guard()?;
    let shares = state
        .db
        .sync_shares()
        .map_err(err)?
        .into_iter()
        .filter(|s| s.active)
        .map(|s| {
            let waiting = state.db.sync_pending_count(&s.id).unwrap_or(0);
            SharedFolderInfo { share: s, waiting }
        })
        .collect();
    Ok(SyncOverview { shares, subscriptions: state.db.sync_subscriptions().map_err(err)? })
}

/// Opens a shared folder (yours or your copy of a colleague's) in Explorer.
#[tauri::command(async)]
pub fn open_sync_folder(app: AppHandle, state: State<AppState>, share_id: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    state.network.privacy.guard()?;
    let path = match state.db.sync_share(&share_id).map_err(err)? {
        Some(s) => s.path,
        None => state.db.sync_subscription(&share_id).map_err(err)?.ok_or("Shared folder not found")?.dest_path,
    };
    app.opener().open_path(path, None::<&str>).map_err(err)
}
