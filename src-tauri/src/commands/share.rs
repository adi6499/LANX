//! LANX 2.5.0: "Share on WhatsApp". WhatsApp has no way for other programs to
//! hand it a file, so: text goes straight into WhatsApp (the desktop app if it
//! is installed, else WhatsApp Web) with the chat left for the user to pick;
//! a file is put on the clipboard and WhatsApp is opened, so one Ctrl+V in the
//! chosen chat sends it.

use super::{err, AppState};
use std::path::PathBuf;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

#[derive(serde::Deserialize)]
pub struct ShareRequest {
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub phone: Option<String>,
    #[serde(default)]
    pub file: Option<String>,
}

/// A WhatsApp number from however it was typed: digits only, Indian numbers
/// without a country code get 91. Returns None for extensions like "112".
pub fn wa_number(raw: &str) -> Option<String> {
    let t = raw.trim();
    let mut digits: String = t.chars().filter(|c| c.is_ascii_digit()).collect();
    if t.starts_with("00") {
        digits = digits.trim_start_matches("00").to_string();
    } else if !t.starts_with('+') && digits.len() == 11 && digits.starts_with('0') {
        digits = digits[1..].to_string(); // 0 98765 43210
    }
    match digits.len() {
        10 => Some(format!("91{digits}")),
        11..=15 => Some(digits),
        _ => None,
    }
}

/// Percent-encoding for a URL query value (letters, digits and -_.~ stay).
pub fn encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// Is WhatsApp Desktop installed (does it handle whatsapp:// links)?
#[cfg(windows)]
fn desktop_app_installed() -> bool {
    use windows_sys::Win32::System::Registry::{RegCloseKey, RegOpenKeyExW, HKEY_CLASSES_ROOT, KEY_READ};
    let name: Vec<u16> = "whatsapp\0".encode_utf16().collect();
    let mut key = std::ptr::null_mut();
    // SAFETY: a read-only registry lookup of a key name we own the buffer of.
    let ok = unsafe { RegOpenKeyExW(HKEY_CLASSES_ROOT, name.as_ptr(), 0, KEY_READ, &mut key) } == 0;
    if ok {
        unsafe { RegCloseKey(key) };
    }
    ok
}
#[cfg(not(windows))]
fn desktop_app_installed() -> bool {
    false
}

/// Puts a file on the clipboard the way Explorer's "Copy" does, so WhatsApp
/// (and anything else) can paste it.
pub(crate) fn copy_file_to_clipboard(path: &PathBuf) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let p = path.to_string_lossy().replace('\'', "''");
        let out = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &format!("Set-Clipboard -LiteralPath '{p}'")])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(err)?;
        if !out.status.success() {
            return Err("Could not copy the file to the clipboard.".to_string());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        use std::io::Write;
        let uri = format!("file://{}\n", path.to_string_lossy());
        for (cmd, args) in [("wl-copy", vec!["-t", "text/uri-list"]), ("xclip", vec!["-selection", "clipboard", "-t", "text/uri-list"])] {
            if let Ok(mut child) = std::process::Command::new(cmd).args(&args).stdin(std::process::Stdio::piped()).spawn() {
                if let Some(mut stdin) = child.stdin.take() {
                    let _ = stdin.write_all(uri.as_bytes());
                }
                if child.wait().map(|s| s.success()).unwrap_or(false) {
                    return Ok(());
                }
            }
        }
        Err("Could not copy the file to the clipboard (wl-copy or xclip is needed).".to_string())
    }
}

/// Opens WhatsApp with the text (and number) filled in; a file is copied to
/// the clipboard first. Returns "copied" when a file was put on the clipboard,
/// else "opened".
#[tauri::command(async)]
pub fn share_whatsapp(app: AppHandle, state: State<AppState>, req: ShareRequest) -> Result<String, String> {
    state.network.privacy.guard()?;
    let mut copied = false;
    if let Some(file) = req.file.as_deref().filter(|f| !f.trim().is_empty()) {
        let p = PathBuf::from(file);
        if !super::docs::is_allowed(&state, &p) || !p.is_file() {
            return Err("LANX can only share files you chose, received or saved.".to_string());
        }
        copy_file_to_clipboard(&p)?;
        copied = true;
    }
    let text = req.text.unwrap_or_default();
    let phone = req.phone.as_deref().and_then(wa_number);
    let mut q = String::new();
    if let Some(p) = &phone {
        q.push_str(&format!("phone={p}&"));
    }
    if !text.is_empty() {
        q.push_str(&format!("text={}", encode(&text)));
    }
    let q = q.trim_end_matches('&').to_string();
    let web = match &phone {
        Some(p) => format!("https://wa.me/{p}{}", if text.is_empty() { String::new() } else { format!("?text={}", encode(&text)) }),
        None => format!("https://wa.me/{}", if text.is_empty() { String::new() } else { format!("?text={}", encode(&text)) }),
    };
    let opened = desktop_app_installed() && app.opener().open_url(format!("whatsapp://send?{q}"), None::<&str>).is_ok();
    if !opened {
        app.opener().open_url(&web, None::<&str>).map_err(err)?;
    }
    Ok(if copied { "copied" } else { "opened" }.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_and_text_are_prepared_for_whatsapp() {
        assert_eq!(wa_number("98765 43210").as_deref(), Some("919876543210"));
        assert_eq!(wa_number("+91 98765-43210").as_deref(), Some("919876543210"));
        assert_eq!(wa_number("0098765432109").as_deref(), Some("98765432109"));
        assert_eq!(wa_number("09876543210").as_deref(), Some("919876543210"));
        assert_eq!(wa_number("Ext. 112"), None);
        assert_eq!(encode("PO 88 ready — ₹1,200"), "PO%2088%20ready%20%E2%80%94%20%E2%82%B91%2C200");
    }
}
