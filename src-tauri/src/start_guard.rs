//! LANX 3.11: LANX always opens.
//!
//! - Every running LANX leaves a mark ("still answering") from its window thread every
//!   2 seconds. On Linux, a new launch that finds the running copy has stopped answering
//!   replaces it — otherwise the new launch would only ask the stuck copy to show itself
//!   and nothing would ever appear ("sometimes it doesn't open").
//! - `--restart` (the app icon's "Restart LANX" on Linux) replaces the running copy anyway.
//! - On Linux desktops without a tray, closing the window minimises LANX instead of hiding
//!   it where nobody can find it.
//! - What happened at start-up goes into a small log next to LANX's data (logs/start.log),
//!   so "it doesn't open" can be looked into.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn beat_file(data_dir: &Path) -> PathBuf {
    data_dir.join("running.beat")
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn read_beat(data_dir: &Path) -> Option<(u32, u64)> {
    let text = std::fs::read_to_string(beat_file(data_dir)).ok()?;
    let mut it = text.split_whitespace();
    Some((it.next()?.parse().ok()?, it.next()?.parse().ok()?))
}

/// Appends a line to logs/start.log (kept small).
pub fn log(data_dir: &Path, line: &str) {
    let dir = data_dir.join("logs");
    let _ = std::fs::create_dir_all(&dir);
    let file = dir.join("start.log");
    if std::fs::metadata(&file).map(|m| m.len() > 200_000).unwrap_or(false) {
        let _ = std::fs::rename(&file, dir.join("start.old.log"));
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&file) {
        let when = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
        let _ = writeln!(f, "{when} [{}] {line}", std::process::id());
    }
}

/// Start-up facts worth having when someone says LANX didn't open.
pub fn log_start(data_dir: &Path, version: &str) {
    let env = |k: &str| std::env::var(k).unwrap_or_default();
    log(
        data_dir,
        &format!(
            "LANX {version} starting on {} — desktop {:?}, session {:?}, wayland {:?}, gdk {:?}, nvidia {}, args {:?}",
            std::env::consts::OS,
            env("XDG_CURRENT_DESKTOP"),
            env("XDG_SESSION_TYPE"),
            env("WAYLAND_DISPLAY"),
            env("GDK_BACKEND"),
            Path::new("/proc/driver/nvidia/version").exists(),
            std::env::args().skip(1).collect::<Vec<_>>()
        ),
    );
    // A crash is written down too (it would otherwise vanish with the terminal nobody opened).
    let dir = data_dir.to_path_buf();
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log(&dir, &format!("CRASH: {info}"));
        previous(info);
    }));
}

/// Leaves the "still answering" mark from the window thread every 2 seconds: when that
/// thread is stuck the mark gets old, which is how a new launch can tell.
pub fn start_heartbeat(app: &tauri::AppHandle, data_dir: PathBuf) {
    let app = app.clone();
    let pid = std::process::id();
    let _ = std::thread::Builder::new().name("lanx-heartbeat".into()).spawn(move || loop {
        let file = beat_file(&data_dir);
        let _ = app.run_on_main_thread(move || {
            let _ = std::fs::write(&file, format!("{pid} {}", now_ms()));
        });
        std::thread::sleep(Duration::from_secs(2));
    });
}

/// Linux: before the "only one LANX" check, replace a running copy that stopped answering
/// (or any running copy, with `force`: the "Restart LANX" action).
#[cfg(target_os = "linux")]
pub fn replace_stuck_copy(data_dir: &Path, force: bool) {
    let pids: Vec<u32> = if force {
        // Every LANX of this user (an older one, say, still running after an update, which
        // leaves no mark).
        other_copies()
    } else {
        let Some((pid, at)) = read_beat(data_dir) else { return };
        if pid == std::process::id() || !is_my_lanx(pid) || now_ms().saturating_sub(at) < 12_000 {
            return; // gone, or it answers: the usual "show yourself" will do
        }
        // Old mark: maybe the PC just woke up. A copy that is fine answers within a few seconds.
        for _ in 0..10 {
            std::thread::sleep(Duration::from_millis(500));
            if read_beat(data_dir).is_some_and(|(p, t)| p != pid || t != at) {
                return;
            }
        }
        vec![pid]
    };
    for pid in pids {
        log(data_dir, &format!("replacing LANX {pid} ({})", if force { "Restart LANX" } else { "it stopped answering" }));
        let signal = |sig: &str| {
            let _ = std::process::Command::new("kill").args([sig, &pid.to_string()]).status();
        };
        signal("-TERM");
        for _ in 0..20 {
            if !Path::new(&format!("/proc/{pid}")).exists() {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        if Path::new(&format!("/proc/{pid}")).exists() {
            signal("-KILL");
            std::thread::sleep(Duration::from_millis(500));
        }
    }
}

/// This user's other running LANX copies.
#[cfg(target_os = "linux")]
fn other_copies() -> Vec<u32> {
    let me = std::process::id();
    std::fs::read_dir("/proc")
        .map(|d| {
            d.flatten()
                .filter_map(|e| e.file_name().to_str()?.parse::<u32>().ok())
                .filter(|&p| p != me && is_my_lanx(p))
                .collect()
        })
        .unwrap_or_default()
}

/// The process is this user's LANX (same program; another user's can't even be read).
#[cfg(target_os = "linux")]
fn is_my_lanx(pid: u32) -> bool {
    let Ok(exe) = std::fs::read_link(format!("/proc/{pid}/exe")) else { return false };
    let me = std::env::current_exe().ok();
    let name = |p: &Path| p.file_name().map(|n| n.to_string_lossy().trim_end_matches(" (deleted)").to_string());
    me.as_deref().and_then(name).is_some_and(|m| name(&exe).as_deref() == Some(m.as_str()))
}

/// Linux: whether this desktop shows tray icons (a StatusNotifier host: KDE, Cinnamon, MATE,
/// Budgie, Ubuntu's GNOME…). Without one, a window hidden "in the tray" can't be found.
#[cfg(target_os = "linux")]
pub fn tray_visible() -> bool {
    std::process::Command::new("gdbus")
        .args([
            "call",
            "--session",
            "--timeout",
            "2",
            "--dest",
            "org.freedesktop.DBus",
            "--object-path",
            "/org/freedesktop/DBus",
            "--method",
            "org.freedesktop.DBus.NameHasOwner",
            "org.kde.StatusNotifierWatcher",
        ])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains("true"))
        .unwrap_or(false)
}

#[cfg(not(target_os = "linux"))]
pub fn tray_visible() -> bool {
    true
}
