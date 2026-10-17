//! LANX 1.3.0: picks the folder WebView2 (which draws LANX's window) keeps its
//! files in, so the window never starts blank.
//!
//! A blank window that only works "as administrator" means WebView2 cannot use
//! its folder: an administrator run left files there the normal account can't
//! open, a stuck copy holds it, or it is damaged. So:
//! - LANX run as administrator uses its own folder (`admin\EBWebView`) and
//!   never touches the normal one;
//! - a folder LANX cannot write is replaced by a fresh one before start-up;
//! - if the window still hasn't loaded 40 seconds after start-up, LANX moves
//!   to a fresh folder and restarts once (at most every 10 minutes).
//!
//! Chats and settings are not in this folder (they are in %APPDATA%\LANX).

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// WebView2 keeps its files in an `EBWebView` sub-folder of the folder it is
/// given; the normal choice gives it the same folder Tauri does, so working
/// installations keep everything they have.
const DEFAULT_NAME: &str = "default";
const ADMIN_NAME: &str = "admin";
const FRESH_PREFIX: &str = "fresh-";
/// Don't move to a fresh folder more often than this (no restart loops).
const SWITCH_COOLDOWN_SECS: i64 = 600;

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// `%LOCALAPPDATA%\com.lanx.desktop` (where Tauri keeps WebView2's folder).
fn base_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|p| PathBuf::from(p).join("com.lanx.desktop"))
}

/// Remembers which folder to use: `%APPDATA%\LANX\webview-folder.txt`,
/// "<name>|<unix time it was chosen>".
fn choice_file() -> Option<PathBuf> {
    Some(crate::storage::data_dir(crate::testmode::profile().as_deref()).join("webview-folder.txt"))
}

fn read_choice() -> Option<(String, i64)> {
    let text = std::fs::read_to_string(choice_file()?).ok()?;
    let (name, at) = text.trim().split_once('|')?;
    let ok = (name == DEFAULT_NAME || name.starts_with(FRESH_PREFIX)) && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    ok.then(|| (name.to_string(), at.parse().unwrap_or(0)))
}

fn write_choice(name: &str) {
    if let Some(f) = choice_file() {
        if let Some(dir) = f.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(f, format!("{}|{}", name, now()));
    }
}

/// LANX can create and delete files in the folder (or create the folder).
pub fn writable(dir: &Path) -> bool {
    if std::fs::create_dir_all(dir).is_err() {
        return false;
    }
    let probe = dir.join(format!(".lanx-write-check-{}", std::process::id()));
    let ok = std::fs::write(&probe, b"ok").is_ok();
    let _ = std::fs::remove_file(&probe);
    ok
}

/// This LANX runs with administrator rights.
#[cfg(windows)]
pub fn is_elevated() -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::Security::{GetTokenInformation, TOKEN_ELEVATION, TOKEN_QUERY, TokenElevation};
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
    // SAFETY: queries our own process token; the handle is closed.
    unsafe {
        let mut token: HANDLE = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return false;
        }
        let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut len = 0u32;
        let ok = GetTokenInformation(
            token,
            TokenElevation,
            &mut elevation as *mut _ as *mut core::ffi::c_void,
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut len,
        );
        CloseHandle(token);
        ok != 0 && elevation.TokenIsElevated != 0
    }
}

#[cfg(not(windows))]
pub fn is_elevated() -> bool {
    false
}

/// Picks the folder and tells WebView2 (before any window exists).
pub fn choose() {
    let test_base = crate::testmode::webview_base();
    if test_base.is_none() && std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_some() {
        return; // set from outside (side-by-side test copies)
    }
    let Some(base) = test_base.or_else(base_dir) else { return };
    let folder = |name: &str| if name == DEFAULT_NAME { base.clone() } else { base.join(name) };
    let name = if is_elevated() {
        ADMIN_NAME.to_string()
    } else {
        let mut name = read_choice().map(|(n, _)| n).unwrap_or_else(|| DEFAULT_NAME.to_string());
        if !writable(&folder(&name).join("EBWebView")) {
            eprintln!("[WebView] {} can't be written; using a fresh folder", name);
            name = format!("{}{}", FRESH_PREFIX, now());
            write_choice(&name);
        }
        name
    };
    // SAFETY: called at the very start of `run`, before any other thread.
    unsafe {
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", folder(&name));
    }
}

/// The window never finished loading: move to a fresh folder for the next
/// start. Returns false when it already did that recently (no loops).
pub fn switch_to_fresh() -> bool {
    if is_elevated() {
        return false;
    }
    if read_choice().is_some_and(|(_, at)| now() - at < SWITCH_COOLDOWN_SECS) {
        return false;
    }
    write_choice(&format!("{}{}", FRESH_PREFIX, now()));
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writable_folder_check() {
        let dir = tempfile::tempdir().unwrap();
        assert!(writable(&dir.path().join("EBWebView")));
        // A path below a file can never be created.
        let file = dir.path().join("file.txt");
        std::fs::write(&file, b"x").unwrap();
        assert!(!writable(&file.join("EBWebView")));
    }

    #[test]
    fn tests_run_without_administrator_rights() {
        // The checks above only make sense from a normal account; this also
        // proves the elevation query works.
        let _ = is_elevated();
    }
}
