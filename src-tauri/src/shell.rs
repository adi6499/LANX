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
/// LANX 2.5.1: the dictation shortcut is the user's choice (Voice settings),
/// kept as Windows modifier flags (Alt 1, Ctrl 2, Shift 4, Win 8) and a
/// virtual-key code. The default is Ctrl + Alt + D.
pub const DEFAULT_DICTATE_MODS: u32 = 2 | 1;
pub const DEFAULT_DICTATE_VK: u32 = b'D' as u32;
static DICTATE_MODS: AtomicU32 = AtomicU32::new(DEFAULT_DICTATE_MODS);
static DICTATE_VK: AtomicU32 = AtomicU32::new(DEFAULT_DICTATE_VK);
static DICTATE_ON: AtomicBool = AtomicBool::new(true);
static DICTATE_OK: AtomicBool = AtomicBool::new(false);
/// The window that was in front when dictation started (where the text goes).
static DICTATE_TARGET: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);

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
        // LANX 2.5.0: the dictation shortcut starts / stops listening.
        let set_dictate = |on: bool| {
            UnregisterHotKey(std::ptr::null_mut(), 2);
            let (mods, vk) = (DICTATE_MODS.load(Ordering::SeqCst), DICTATE_VK.load(Ordering::SeqCst));
            let ok = on && vk != 0 && RegisterHotKey(std::ptr::null_mut(), 2, mods | MOD_NOREPEAT, vk) != 0;
            DICTATE_OK.store(ok, Ordering::SeqCst);
            if on && !ok {
                eprintln!("[Dictation] {} is already used by another app", dictate_label());
            }
        };
        set(enabled);
        set_dictate(DICTATE_ON.load(Ordering::SeqCst));
        while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
            if msg.message == WM_HOTKEY {
                if msg.wParam == 2 {
                    on_dictate_hotkey(&app);
                } else {
                    on_hotkey(&app);
                }
            } else if msg.message == WM_APP + 1 {
                set(msg.wParam != 0);
            } else if msg.message == WM_APP + 2 {
                set_dictate(msg.wParam != 0);
            }
        }
    });
}

#[cfg(not(windows))]
pub fn start_hotkey(_app: AppHandle, _enabled: bool) {}

/// Dictation hotkey pressed: remember which program is in front (the text
/// goes back there) and tell the window to start or stop listening.
#[cfg(windows)]
fn on_dictate_hotkey(app: &AppHandle) {
    use tauri::{Emitter, Manager};
    use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    // SAFETY: a plain query of the foreground window.
    let fg = unsafe { GetForegroundWindow() } as isize;
    let ours = app.get_webview_window("main").and_then(|w| w.hwnd().ok()).map(|h| h.0 as isize).unwrap_or(0);
    DICTATE_TARGET.store(if fg == ours { 0 } else { fg }, Ordering::SeqCst);
    let _ = app.emit_to("main", "lanx://dictate", fg != ours);
}

/// Turns the dictation shortcut on or off and sets its keys (after a
/// settings change, and at start-up from the saved preference).
pub fn set_dictation_hotkey(enabled: bool, mods: u32, vk: u32) {
    DICTATE_MODS.store(mods, Ordering::SeqCst);
    DICTATE_VK.store(vk, Ordering::SeqCst);
    DICTATE_ON.store(enabled, Ordering::SeqCst);
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::UI::WindowsAndMessaging::{PostThreadMessageW, WM_APP};
        let tid = HOTKEY_THREAD.load(Ordering::SeqCst);
        if tid != 0 {
            PostThreadMessageW(tid, WM_APP + 2, enabled as usize, 0);
        }
    }
}

pub fn dictation_hotkey_working() -> bool {
    DICTATE_OK.load(Ordering::SeqCst)
}

/// Whether the shortcut listener thread exists (never in test copies).
pub fn hotkey_thread_running() -> bool {
    HOTKEY_THREAD.load(Ordering::SeqCst) != 0
}

/// The Windows key code for a key named the way the browser names it
/// (`KeyboardEvent.code`): "KeyD", "Digit3", "F9", "Space", "Comma"…
pub fn vk_for_code(code: &str) -> Option<u32> {
    let c = code.trim();
    if let Some(l) = c.strip_prefix("Key") {
        let b = l.as_bytes();
        return (b.len() == 1 && b[0].is_ascii_uppercase()).then(|| b[0] as u32);
    }
    if let Some(d) = c.strip_prefix("Digit") {
        let b = d.as_bytes();
        return (b.len() == 1 && b[0].is_ascii_digit()).then(|| b[0] as u32);
    }
    if let Some(d) = c.strip_prefix("Numpad") {
        let b = d.as_bytes();
        if b.len() == 1 && b[0].is_ascii_digit() {
            return Some(0x60 + (b[0] - b'0') as u32);
        }
        return match d {
            "Multiply" => Some(0x6A),
            "Add" => Some(0x6B),
            "Subtract" => Some(0x6D),
            "Decimal" => Some(0x6E),
            "Divide" => Some(0x6F),
            _ => None,
        };
    }
    if let Some(n) = c.strip_prefix('F') {
        if let Ok(n) = n.parse::<u32>() {
            return (1..=24).contains(&n).then(|| 0x70 + n - 1);
        }
    }
    Some(match c {
        "Space" => 0x20,
        "Backquote" => 0xC0,
        "Minus" => 0xBD,
        "Equal" => 0xBB,
        "BracketLeft" => 0xDB,
        "BracketRight" => 0xDD,
        "Backslash" => 0xDC,
        "Semicolon" => 0xBA,
        "Quote" => 0xDE,
        "Comma" => 0xBC,
        "Period" => 0xBE,
        "Slash" => 0xBF,
        "Insert" => 0x2D,
        "Delete" => 0x2E,
        "Home" => 0x24,
        "End" => 0x23,
        "PageUp" => 0x21,
        "PageDown" => 0x22,
        "ArrowUp" => 0x26,
        "ArrowDown" => 0x28,
        "ArrowLeft" => 0x25,
        "ArrowRight" => 0x27,
        "Pause" => 0x13,
        "ScrollLock" => 0x91,
        "CapsLock" => 0x14,
        _ => return None,
    })
}

/// "Ctrl + Alt + D" for the current dictation keys.
pub fn dictate_label() -> String {
    let (mods, vk) = (DICTATE_MODS.load(Ordering::SeqCst), DICTATE_VK.load(Ordering::SeqCst));
    let mut parts: Vec<String> = Vec::new();
    if mods & 2 != 0 {
        parts.push("Ctrl".to_string());
    }
    if mods & 1 != 0 {
        parts.push("Alt".to_string());
    }
    if mods & 4 != 0 {
        parts.push("Shift".to_string());
    }
    if mods & 8 != 0 {
        parts.push("Win".to_string());
    }
    parts.push(match vk {
        0x20 => "Space".to_string(),
        0x30..=0x39 | 0x41..=0x5A => char::from(vk as u8).to_string(),
        0x70..=0x87 => format!("F{}", vk - 0x70 + 1),
        0x60..=0x69 => format!("Numpad {}", vk - 0x60),
        other => format!("key {}", other),
    });
    parts.join(" + ")
}

/// Types text into the program that was in front when dictation started.
/// Ok(false) when there is none (LANX itself was in front).
#[cfg(windows)]
pub fn type_into_target(_app: &AppHandle, text: &str) -> Result<bool, String> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE};
    use windows_sys::Win32::UI::WindowsAndMessaging::{IsWindow, SetForegroundWindow};
    let target = DICTATE_TARGET.swap(0, Ordering::SeqCst);
    if target == 0 || crate::testmode::profile().is_some() {
        return Ok(false);
    }
    let hwnd = target as windows_sys::Win32::Foundation::HWND;
    // SAFETY: Win32 calls on a window handle we recorded moments ago.
    unsafe {
        if IsWindow(hwnd) == 0 {
            return Ok(false);
        }
        SetForegroundWindow(hwnd);
        std::thread::sleep(std::time::Duration::from_millis(120));
        let mut inputs: Vec<INPUT> = Vec::with_capacity(text.encode_utf16().count() * 2);
        for unit in text.encode_utf16() {
            for flags in [KEYEVENTF_UNICODE, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP] {
                let mut inp: INPUT = std::mem::zeroed();
                inp.r#type = INPUT_KEYBOARD;
                inp.Anonymous.ki = KEYBDINPUT { wVk: 0, wScan: unit, dwFlags: flags, time: 0, dwExtraInfo: 0 };
                inputs.push(inp);
            }
        }
        // In batches: very long texts in one SendInput can be dropped.
        for chunk in inputs.chunks(200) {
            let sent = SendInput(chunk.len() as u32, chunk.as_ptr(), std::mem::size_of::<INPUT>() as i32);
            if sent == 0 {
                return Err("Windows did not accept the typed text (the program may be running as administrator).".to_string());
            }
            std::thread::sleep(std::time::Duration::from_millis(8));
        }
    }
    Ok(true)
}

#[cfg(not(windows))]
pub fn type_into_target(_app: &AppHandle, _text: &str) -> Result<bool, String> {
    Ok(false)
}

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
