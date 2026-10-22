//! LANX 1.7.0 Windows helpers: screenshots (Ctrl + Alt + S anywhere, or the
//! button in a chat) and "Send to → LANX" in Explorer's right-click menu.

use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use tauri::{AppHandle, Emitter, Manager};

/// A screen picture: width, height and BGRA pixels (top row first).
pub struct Capture {
    pub width: u32,
    pub height: u32,
    pub bgra: Vec<u8>,
}

/// The last picture taken with the hotkey, until the window collects it.
static LAST_CAPTURE: Mutex<Option<Capture>> = Mutex::new(None);
/// Files and folders from "Send to → LANX", until the window collects them.
static PENDING_SEND: Mutex<Vec<String>> = Mutex::new(Vec::new());
static HOTKEY_THREAD: AtomicU32 = AtomicU32::new(0);
static HOTKEY_OK: AtomicBool = AtomicBool::new(false);

pub const HOTKEY_LABEL: &str = "Ctrl + Alt + S";

/// The whole desktop (every screen).
#[cfg(windows)]
pub fn capture_screen() -> Result<Capture, String> {
    use windows_sys::Win32::Graphics::Gdi::*;
    use windows_sys::Win32::UI::WindowsAndMessaging::*;
    unsafe {
        let x = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let y = GetSystemMetrics(SM_YVIRTUALSCREEN);
        let w = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        let h = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        if w <= 0 || h <= 0 {
            return Err("Could not see the screen.".to_string());
        }
        let screen = GetDC(std::ptr::null_mut());
        if screen.is_null() {
            return Err("Could not see the screen.".to_string());
        }
        let mem = CreateCompatibleDC(screen);
        let bmp = CreateCompatibleBitmap(screen, w, h);
        let old = SelectObject(mem, bmp);
        let copied = BitBlt(mem, 0, 0, w, h, screen, x, y, SRCCOPY | CAPTUREBLT);
        let mut info: BITMAPINFO = std::mem::zeroed();
        info.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        info.bmiHeader.biWidth = w;
        info.bmiHeader.biHeight = -h; // top row first
        info.bmiHeader.biPlanes = 1;
        info.bmiHeader.biBitCount = 32;
        info.bmiHeader.biCompression = BI_RGB;
        let mut bgra = vec![0u8; w as usize * h as usize * 4];
        let rows = GetDIBits(mem, bmp, 0, h as u32, bgra.as_mut_ptr() as *mut _, &mut info, DIB_RGB_COLORS);
        SelectObject(mem, old);
        DeleteObject(bmp);
        DeleteDC(mem);
        ReleaseDC(std::ptr::null_mut(), screen);
        if copied == 0 || rows == 0 {
            return Err("Could not take the screenshot.".to_string());
        }
        Ok(Capture { width: w as u32, height: h as u32, bgra })
    }
}

#[cfg(not(windows))]
pub fn capture_screen() -> Result<Capture, String> {
    Err("Screenshots need Windows.".to_string())
}

/// 8 bytes of size (width, height as little-endian u32) then the pixels: what
/// the window turns back into a picture.
pub fn capture_bytes(c: Capture) -> Vec<u8> {
    let mut out = Vec::with_capacity(8 + c.bgra.len());
    out.extend_from_slice(&c.width.to_le_bytes());
    out.extend_from_slice(&c.height.to_le_bytes());
    out.extend_from_slice(&c.bgra);
    out
}

pub fn take_last_capture() -> Option<Capture> {
    LAST_CAPTURE.lock().take()
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Ctrl + Alt + S was pressed: picture first (of what the user sees), then LANX.
fn on_hotkey(app: &AppHandle) {
    match capture_screen() {
        Ok(c) => {
            *LAST_CAPTURE.lock() = Some(c);
            show_main(app);
            let _ = app.emit_to("main", "lanx://screenshot-ready", ());
        }
        Err(e) => eprintln!("[Screenshot] {}", e),
    }
}

/// Starts listening for Ctrl + Alt + S (normal installation only, never test copies).
#[cfg(windows)]
pub fn start_hotkey(app: AppHandle, enabled: bool) {
    use windows_sys::Win32::System::Threading::GetCurrentThreadId;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{MOD_ALT, MOD_CONTROL, MOD_NOREPEAT, RegisterHotKey, UnregisterHotKey};
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetMessageW, MSG, PM_NOREMOVE, PeekMessageW, WM_APP, WM_HOTKEY, WM_USER};
    std::thread::spawn(move || unsafe {
        let mut msg: MSG = std::mem::zeroed();
        // Make sure this thread has a message queue before anyone posts to it.
        PeekMessageW(&mut msg, std::ptr::null_mut(), WM_USER, WM_USER, PM_NOREMOVE);
        HOTKEY_THREAD.store(GetCurrentThreadId(), Ordering::SeqCst);
        let set = |on: bool| {
            UnregisterHotKey(std::ptr::null_mut(), 1);
            let ok = on && RegisterHotKey(std::ptr::null_mut(), 1, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, b'S' as u32) != 0;
            HOTKEY_OK.store(ok, Ordering::SeqCst);
            if on && !ok {
                eprintln!("[Screenshot] {} is already used by another app", HOTKEY_LABEL);
            }
        };
        set(enabled);
        while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
            if msg.message == WM_HOTKEY {
                on_hotkey(&app);
            } else if msg.message == WM_APP + 1 {
                set(msg.wParam != 0);
            }
        }
    });
}

#[cfg(not(windows))]
pub fn start_hotkey(_app: AppHandle, _enabled: bool) {}

/// Turns the hotkey on or off (after a settings change).
pub fn set_hotkey(enabled: bool) {
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::UI::WindowsAndMessaging::{PostThreadMessageW, WM_APP};
        let tid = HOTKEY_THREAD.load(Ordering::SeqCst);
        if tid != 0 {
            PostThreadMessageW(tid, WM_APP + 1, enabled as usize, 0);
        }
    }
    #[cfg(not(windows))]
    let _ = enabled;
}

/// Is Ctrl + Alt + S working (false if another app took it first)?
pub fn hotkey_working() -> bool {
    HOTKEY_OK.load(Ordering::SeqCst)
}

// ------------------------------------------------------------- Send to LANX

/// The files and folders after `--send` (Explorer adds them to the shortcut's command).
pub fn send_paths(args: &[String]) -> Vec<String> {
    let Some(i) = args.iter().position(|a| a == "--send") else { return Vec::new() };
    args[i + 1..]
        .iter()
        .filter(|a| !a.starts_with("--") && std::path::Path::new(a.as_str()).exists())
        .take(500)
        .cloned()
        .collect()
}

/// Remembers files from "Send to → LANX" and tells the window.
pub fn queue_send(app: &AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    {
        let mut pending = PENDING_SEND.lock();
        for p in paths {
            if !pending.contains(&p) {
                pending.push(p);
            }
        }
    }
    show_main(app);
    let _ = app.emit_to("main", "lanx://send-request", ());
}

/// At start-up (LANX wasn't running yet): just remember them.
pub fn remember_send(paths: Vec<String>) {
    PENDING_SEND.lock().extend(paths);
}

pub fn take_send_request() -> Vec<String> {
    std::mem::take(&mut *PENDING_SEND.lock())
}

fn send_to_shortcut() -> Option<std::path::PathBuf> {
    Some(dirs::config_dir()?.join("Microsoft").join("Windows").join("SendTo").join("LANX.lnk"))
}

/// Adds or removes "LANX" in Explorer's "Send to" menu (this Windows user).
pub fn apply_send_to(enabled: bool) {
    let Some(link) = send_to_shortcut() else { return };
    if !enabled {
        if link.exists() {
            let _ = std::fs::remove_file(&link);
        }
        return;
    }
    if link.exists() {
        return;
    }
    let Ok(exe) = std::env::current_exe() else { return };
    #[cfg(not(windows))]
    let _ = exe; // the "Send to" menu is a Windows thing
    #[cfg(windows)]
    std::thread::spawn(move || {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let q = |p: &std::path::Path| p.to_string_lossy().replace('\'', "''");
        let script = format!(
            "$s = (New-Object -ComObject WScript.Shell).CreateShortcut('{link}'); \
             $s.TargetPath = '{exe}'; $s.Arguments = '--send'; $s.IconLocation = '{exe},0'; \
             $s.Description = 'Send to a colleague with LANX'; $s.Save()",
            link = q(&link),
            exe = q(&exe),
        );
        let _ = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &script])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn send_to_reads_only_real_paths_after_the_flag() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.txt");
        std::fs::write(&f, b"x").unwrap();
        let fs = f.to_string_lossy().to_string();
        let args = vec!["lanx.exe".to_string(), "--send".to_string(), fs.clone(), "C:\\nope\\gone.txt".to_string()];
        assert_eq!(send_paths(&args), vec![fs.clone()]);
        assert!(send_paths(&["lanx.exe".to_string(), fs]).is_empty());
    }
}
