//! LANX 1.9.1: keeps LANX's windows from going white.
//!
//! LANX's windows are drawn by Microsoft WebView2, which runs in helper
//! programs next to LANX. When a laptop sleeps and wakes, or Windows is busy
//! at start-up, those helpers can stop. LANX itself keeps running (messages
//! still arrive), but its window stays white for good. Now LANX notices:
//!
//! - the page's helper stopped or hangs: the page is loaded again;
//! - WebView2's main helper stopped: LANX restarts itself (hidden in the tray
//!   when its window was hidden), at most 3 times in 15 minutes;
//! - a check every 10 seconds catches the main helper disappearing without
//!   WebView2 reporting it (for example while the laptop was asleep).

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

/// Restarts allowed within `WINDOW_SECS` (then LANX stops trying: no loops).
const MAX_RESTARTS: usize = 3;
const WINDOW_SECS: i64 = 15 * 60;

static RESTARTING: AtomicBool = AtomicBool::new(false);

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// `%APPDATA%\LANX\window-restarts.txt`: when LANX last restarted to fix its window.
fn log_file() -> std::path::PathBuf {
    crate::storage::data_dir(crate::testmode::profile().as_deref()).join("window-restarts.txt")
}

/// Keeps the restarts of the last `WINDOW_SECS`; `None` when there were too many.
pub fn allow_restart(previous: &[i64], now: i64) -> Option<Vec<i64>> {
    let mut recent: Vec<i64> = previous.iter().copied().filter(|t| now - t < WINDOW_SECS && *t <= now).collect();
    if recent.len() >= MAX_RESTARTS {
        return None;
    }
    recent.push(now);
    Some(recent)
}

/// WebView2 can't draw any more: restart LANX (once at a time, not in a loop).
fn restart(app: &AppHandle, why: &str) {
    if RESTARTING.swap(true, Ordering::SeqCst) {
        return;
    }
    let file = log_file();
    let previous: Vec<i64> = std::fs::read_to_string(&file)
        .unwrap_or_default()
        .split_whitespace()
        .filter_map(|t| t.parse().ok())
        .collect();
    let Some(recent) = allow_restart(&previous, now()) else {
        eprintln!("[Window] WebView2 stopped ({}), but LANX restarted too often already", why);
        RESTARTING.store(false, Ordering::SeqCst);
        return;
    };
    let _ = std::fs::write(&file, recent.iter().map(|t| t.to_string()).collect::<Vec<_>>().join(" "));
    // Come back the way the user left it: hidden in the tray, or on screen.
    let hidden = app
        .get_webview_window("main")
        .map(|w| !w.is_visible().unwrap_or(false) || w.is_minimized().unwrap_or(false))
        .unwrap_or(true);
    eprintln!("[Window] WebView2 stopped ({}); restarting LANX{}", why, if hidden { " in the tray" } else { "" });
    crate::relaunch_with(app, hidden);
}

/// Watches one window's WebView2 helpers (main, island…).
#[cfg(windows)]
pub fn watch(app: &AppHandle, label: &str) {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use webview2_com::ProcessFailedEventHandler;
    let Some(w) = app.get_webview_window(label) else { return };
    let app = app.clone();
    let label = label.to_string();
    let _ = w.with_webview(move |pw| {
        // SAFETY: WebView2 COM calls on the window's own thread (with_webview).
        unsafe {
            let Ok(core) = pw.controller().CoreWebView2() else { return };
            let handler = ProcessFailedEventHandler::create(Box::new(move |sender, args| {
                let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
                if let Some(args) = args {
                    args.ProcessFailedKind(&mut kind)?;
                }
                if kind == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED {
                    restart(&app, "main helper stopped");
                } else if kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED
                    || kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE
                {
                    eprintln!("[Window] the {} page stopped; loading it again", label);
                    if let Some(s) = sender {
                        let _ = s.Reload();
                    }
                }
                Ok(())
            }));
            let mut token = 0i64;
            let _ = core.add_ProcessFailed(&handler, &mut token);
        }
    });
}

#[cfg(not(windows))]
pub fn watch(_app: &AppHandle, _label: &str) {}

/// Is a program called `name` running that `parent` started?
#[cfg(windows)]
pub fn has_child_named(parent: u32, name: &str) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
    };
    // SAFETY: walks a snapshot of the process list; the handle is closed.
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return true; // can't tell: assume all is well
        }
        let mut e: PROCESSENTRY32W = std::mem::zeroed();
        e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut found = false;
        let mut more = Process32FirstW(snap, &mut e) != 0;
        while more {
            if e.th32ParentProcessID == parent {
                let len = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
                if String::from_utf16_lossy(&e.szExeFile[..len]).eq_ignore_ascii_case(name) {
                    found = true;
                    break;
                }
            }
            more = Process32NextW(snap, &mut e) != 0;
        }
        CloseHandle(snap);
        found
    }
}

#[cfg(not(windows))]
pub fn has_child_named(_parent: u32, _name: &str) -> bool {
    true
}

/// LANX 3.12.0: while the main window is out of sight (in the tray or minimised) its
/// web page is asked to use less memory — WebView2 lets go of caches and spare
/// pages — and back to normal when it shows. A 4 GB PC feels the difference.
#[cfg(windows)]
pub fn set_memory_low(app: &AppHandle, low: bool) {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use windows::core::Interface;
    let Some(w) = app.get_webview_window("main") else { return };
    let _ = w.with_webview(move |pw| {
        // SAFETY: WebView2 COM calls on the window's own thread (with_webview).
        unsafe {
            let Ok(core) = pw.controller().CoreWebView2() else { return };
            if let Ok(c) = core.cast::<ICoreWebView2_19>() {
                let level = if low { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL };
                let _ = c.SetMemoryUsageTargetLevel(level);
            }
        }
    });
}

/// Every 15 seconds: out of sight → less memory (unless hands are driving the PC,
/// which keeps working while LANX is hidden and needs its speed).
#[cfg(windows)]
pub fn start_memory_checks(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let mut low = false;
        loop {
            std::thread::sleep(std::time::Duration::from_secs(15));
            let Some(w) = app.get_webview_window("main") else { continue };
            let hidden = !w.is_visible().unwrap_or(true) || w.is_minimized().unwrap_or(false);
            let hands = app
                .try_state::<crate::commands::AppState>()
                .and_then(|s| s.db.get_setting("pref_gestures"))
                .and_then(|v| serde_json::from_str::<serde_json::Value>(&v).ok())
                .is_some_and(|p| p["enabled"].as_bool() == Some(true) && p["pc"].as_bool() == Some(true));
            let want = hidden && !hands;
            if want != low {
                low = want;
                set_memory_low(&app, low);
            }
        }
    });
}
#[cfg(not(windows))]
pub fn start_memory_checks(_app: &AppHandle) {}

/// Every 10 seconds: is WebView2's main helper still running? Missing twice
/// in a row (after it had started) means the window can't draw any more.
pub fn start_checks(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let me = std::process::id();
        let mut seen = false;
        let mut missing = 0;
        loop {
            std::thread::sleep(std::time::Duration::from_secs(10));
            if RESTARTING.load(Ordering::SeqCst) {
                return;
            }
            if has_child_named(me, "msedgewebview2.exe") {
                seen = true;
                missing = 0;
            } else if seen {
                missing += 1;
                if missing >= 2 {
                    restart(&app, "main helper gone");
                    return;
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restarts_are_limited() {
        let t = 1_000_000;
        assert_eq!(allow_restart(&[], t), Some(vec![t]));
        assert_eq!(allow_restart(&[t - 100, t - 50], t), Some(vec![t - 100, t - 50, t]));
        // A fourth within 15 minutes: no (no restart loops).
        assert_eq!(allow_restart(&[t - 300, t - 200, t - 100], t), None);
        // Old ones (and impossible future ones) don't count.
        assert_eq!(allow_restart(&[t - 2000, t - 1000, t + 50], t), Some(vec![t]));
    }

    #[cfg(windows)]
    #[test]
    fn finds_its_own_child_programs() {
        let me = std::process::id();
        assert!(!has_child_named(me, "msedgewebview2.exe"));
        let mut child = std::process::Command::new("ping")
            .args(["-n", "3", "127.0.0.1"])
            .stdout(std::process::Stdio::null())
            .spawn()
            .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(300));
        let found = has_child_named(me, "PING.EXE");
        let _ = child.kill();
        let _ = child.wait();
        assert!(found);
    }
}
