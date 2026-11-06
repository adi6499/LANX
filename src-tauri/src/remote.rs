//! LANX 2.0 remote control (like AnyDesk, on the office network).
//!
//! During a call, a colleague who sees your shared screen can ask to control
//! it. Nothing happens until you press Allow on this PC. Then their clicks,
//! scrolling and typing arrive over the call's encrypted WebRTC link, and the
//! window hands them to `input` here, which checks the permission every time:
//!
//! - only for the call you allowed, and only while it is still connected;
//! - your own mouse always wins: while you move it, theirs waits a moment;
//! - an orange frame around your screen and a bar with Stop show the whole time;
//! - Windows keeps the lock screen, Ctrl + Alt + Del and its "allow this app"
//!   prompts out of reach of every program, so only you can answer those.
//!
//! There is no unattended access: no password, no way in without a person
//! pressing Allow on this PC.
//!
//! LANX 2.1.0: their clicks always land where they point, this PC's own
//! mouse only pauses theirs when it really moves, and when Windows refuses
//! their input (a program opened "as administrator", or a Windows security
//! prompt) both sides are told, so the person at this PC can click it.

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU32, Ordering};
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager};

/// One screen of this PC, in real pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Screen {
    pub left: i32,
    pub top: i32,
    pub width: i32,
    pub height: i32,
    /// The part without the taskbar (where the Stop bar goes).
    pub work_left: i32,
    pub work_top: i32,
    pub work_width: i32,
    pub work_height: i32,
    pub primary: bool,
}

/// What the colleague in control did. Positions are 0..1 across the shared screen.
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(tag = "t", rename_all = "lowercase")]
pub enum InputEvent {
    Move { x: f64, y: f64 },
    /// 0 left, 1 middle, 2 right, 3 back, 4 forward.
    Button { b: u8, down: bool },
    /// Wheel turns in Windows units (120 = one notch); positive = up / right.
    Wheel { dx: i32, dy: i32 },
    /// A key by its place on the keyboard (the browser's `KeyboardEvent.code`).
    Key { code: String, down: bool },
    /// A shortcut pressed and released in order (Windows key, Alt + Tab…).
    Combo { codes: Vec<String> },
}

/// `lanx://remote` and `remote_info`.
#[derive(Debug, Clone, Serialize, Default)]
pub struct RemoteInfo {
    pub active: bool,
    pub call_id: String,
    pub peer_name: String,
    /// How many screens the shared picture could be (more than one: "Switch screen").
    pub screens: usize,
    pub screen: usize,
    /// Why it stopped: "stopped" | "call-ended".
    pub reason: Option<String>,
    /// LANX 2.1.0: Windows just refused some of their input (an admin program
    /// or a Windows security prompt is in front).
    pub blocked: bool,
}

/// What became of one batch of input.
#[derive(Debug, Clone, Serialize, Default)]
pub struct InputResult {
    /// Windows refused some of it (see `RemoteInfo::blocked`).
    pub blocked: bool,
}

struct Session {
    call_id: String,
    peer_name: String,
    screens: Vec<Screen>,
    current: usize,
    /// Keys held down for the colleague (scan code, extended), released on stop.
    keys: Vec<(u16, bool)>,
    /// Mouse buttons held down for the colleague (bit per button).
    buttons: u8,
    /// Where their pointer is on this screen (pixels), and where LANX last put
    /// the real one: clicks always happen where they point, even after their
    /// moves waited for this PC's own mouse.
    last: Option<(i32, i32)>,
    placed: Option<(i32, i32)>,
    /// When Windows last refused their input (ms on `clock`, 0 = never).
    blocked_at: i64,
}

type StillOk = Box<dyn Fn() -> bool + Send>;

static SESSION: Mutex<Option<Session>> = Mutex::new(None);
/// Is the allowed call still connected? (Checked every second by the guard.)
static STILL_OK: Mutex<Option<StillOk>> = Mutex::new(None);
static APP: Mutex<Option<AppHandle>> = Mutex::new(None);
/// The guard thread (frame, own-mouse watch, call check); 0 when none.
static GUARD_THREAD: AtomicU32 = AtomicU32::new(0);
/// When this PC's own mouse last moved (ms on `clock`, 0 = not yet).
static LOCAL_MOUSE_MS: AtomicI64 = AtomicI64::new(0);
/// Test copies never touch the real mouse and keyboard: what they would have done.
static DRY_LOG: Mutex<Vec<String>> = Mutex::new(Vec::new());
/// Test copies use a pretend clipboard (never the real one): (sequence, text).
static TEST_CLIPBOARD: Mutex<(u32, String)> = Mutex::new((1, String::new()));

/// While the person at this PC moves their own mouse, the colleague's mouse waits this long.
pub const LOCAL_WINS_MS: i64 = 600;
/// Only a real movement of this PC's own mouse counts: this many pixels
/// within `MOVE_WINDOW_MS` (a resting hand or a jittery sensor doesn't).
pub const LOCAL_MOVE_PX: i64 = 8;
const MOVE_WINDOW_MS: i64 = 200;
/// Physical mouse movement added up over the last `MOVE_WINDOW_MS`.
static PHYS_ACC: AtomicI64 = AtomicI64::new(0);
static PHYS_ACC_T: AtomicI64 = AtomicI64::new(0);
/// Test copies: pretend Windows refuses the input (an admin program in front).
static TEST_BLOCKED: AtomicBool = AtomicBool::new(false);
/// How often a refusal is reported (ms).
const BLOCKED_REPORT_MS: i64 = 4000;
/// The most text copied across in one go.
pub const CLIPBOARD_MAX_CHARS: usize = 200_000;
const MAX_EVENTS: usize = 300;

fn clock() -> i64 {
    static START: OnceLock<Instant> = OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_millis() as i64 + 1
}

/// Test copies (LANX_PROFILE) only pretend: the user's real mouse, keyboard
/// and clipboard are never touched by the automated tests.
fn dry_run() -> bool {
    cfg!(test) || crate::testmode::profile().is_some()
}

pub fn info() -> RemoteInfo {
    match SESSION.lock().as_ref() {
        Some(s) => RemoteInfo {
            active: true,
            call_id: s.call_id.clone(),
            peer_name: s.peer_name.clone(),
            screens: s.screens.len(),
            screen: s.current,
            reason: None,
            blocked: s.blocked_at != 0 && clock() - s.blocked_at < BLOCKED_REPORT_MS * 2,
        },
        None => RemoteInfo::default(),
    }
}

/// The screens a shared picture of `width` × `height` can be: the same shape
/// (the picture of a very large screen may be scaled down), exact size first,
/// then the main screen. A single window (another shape) matches none.
pub fn matching_screens(all: &[Screen], width: u32, height: u32) -> Vec<Screen> {
    let mut v: Vec<Screen> = if width == 0 || height == 0 {
        all.to_vec()
    } else {
        let ratio = width as f64 / height as f64;
        all.iter()
            .copied()
            .filter(|s| {
                let r = s.width as f64 / s.height.max(1) as f64;
                (r - ratio).abs() / ratio < 0.02 && width as i32 <= s.width + 2
            })
            .collect()
    };
    v.sort_by_key(|s| (!(s.width == width as i32 && s.height == height as i32), !s.primary, s.left, s.top));
    v
}

/// The pixel a 0..1 position on screen `s` points at.
pub fn to_pixel(s: &Screen, x: f64, y: f64) -> (i32, i32) {
    let fx = if x.is_finite() { x.clamp(0.0, 1.0) } else { 0.5 };
    let fy = if y.is_finite() { y.clamp(0.0, 1.0) } else { 0.5 };
    (
        s.left + (fx * (s.width - 1).max(0) as f64).round() as i32,
        s.top + (fy * (s.height - 1).max(0) as f64).round() as i32,
    )
}

/// A pixel in the 0..65535 units over the whole desktop (every screen) that
/// Windows' SendInput wants: rounded up, so Windows lands on that very pixel.
pub fn to_absolute(px: i32, py: i32, desk: (i32, i32, i32, i32)) -> (i32, i32) {
    let (vx, vy, vw, vh) = desk;
    let one = |p: i32, v0: i32, len: i32| -> i32 {
        let len = len.max(1) as i64;
        let off = (p - v0).clamp(0, len as i32 - 1) as i64;
        ((off * 65536 + len - 1) / len).clamp(0, 65535) as i32
    };
    (one(px, vx, vw), one(py, vy, vh))
}

/// The keyboard's scan code for a browser key name (`KeyboardEvent.code`),
/// and whether it is an "extended" key. Keys by place, not letter, so the
/// keyboard layout chosen on this PC decides what gets typed.
pub fn scan_code(code: &str) -> Option<(u16, bool)> {
    if let Some(c) = code.strip_prefix("Key") {
        let i = "QWERTYUIOP".find(c).map(|i| 0x10 + i as u16);
        let j = || "ASDFGHJKL".find(c).map(|i| 0x1E + i as u16);
        let k = || "ZXCVBNM".find(c).map(|i| 0x2C + i as u16);
        return (c.len() == 1).then(|| i.or_else(j).or_else(k)).flatten().map(|s| (s, false));
    }
    if let Some(d) = code.strip_prefix("Digit") {
        let n: u16 = d.parse().ok().filter(|n| *n <= 9)?;
        return Some((if n == 0 { 0x0B } else { 0x01 + n }, false));
    }
    if let Some(f) = code.strip_prefix('F') {
        if let Ok(n) = f.parse::<u16>() {
            return match n {
                1..=10 => Some((0x3A + n, false)),
                11 => Some((0x57, false)),
                12 => Some((0x58, false)),
                _ => None,
            };
        }
    }
    let plain = |s: u16| Some((s, false));
    let ext = |s: u16| Some((s, true));
    match code {
        "Escape" => plain(0x01),
        "Minus" => plain(0x0C),
        "Equal" => plain(0x0D),
        "Backspace" => plain(0x0E),
        "Tab" => plain(0x0F),
        "BracketLeft" => plain(0x1A),
        "BracketRight" => plain(0x1B),
        "Enter" => plain(0x1C),
        "ControlLeft" => plain(0x1D),
        "Semicolon" => plain(0x27),
        "Quote" => plain(0x28),
        "Backquote" => plain(0x29),
        "ShiftLeft" => plain(0x2A),
        "Backslash" => plain(0x2B),
        "Comma" => plain(0x33),
        "Period" => plain(0x34),
        "Slash" => plain(0x35),
        "ShiftRight" => plain(0x36),
        "NumpadMultiply" => plain(0x37),
        "AltLeft" => plain(0x38),
        "Space" => plain(0x39),
        "CapsLock" => plain(0x3A),
        // Num Lock only switches when sent as an extended key.
        "NumLock" => ext(0x45),
        "ScrollLock" => plain(0x46),
        "Numpad7" => plain(0x47),
        "Numpad8" => plain(0x48),
        "Numpad9" => plain(0x49),
        "NumpadSubtract" => plain(0x4A),
        "Numpad4" => plain(0x4B),
        "Numpad5" => plain(0x4C),
        "Numpad6" => plain(0x4D),
        "NumpadAdd" => plain(0x4E),
        "Numpad1" => plain(0x4F),
        "Numpad2" => plain(0x50),
        "Numpad3" => plain(0x51),
        "Numpad0" => plain(0x52),
        "NumpadDecimal" => plain(0x53),
        "IntlBackslash" => plain(0x56),
        "NumpadEnter" => ext(0x1C),
        "ControlRight" => ext(0x1D),
        "NumpadDivide" => ext(0x35),
        "PrintScreen" => ext(0x37),
        "AltRight" => ext(0x38),
        "Home" => ext(0x47),
        "ArrowUp" => ext(0x48),
        "PageUp" => ext(0x49),
        "ArrowLeft" => ext(0x4B),
        "ArrowRight" => ext(0x4D),
        "End" => ext(0x4F),
        "ArrowDown" => ext(0x50),
        "PageDown" => ext(0x51),
        "Insert" => ext(0x52),
        "Delete" => ext(0x53),
        "MetaLeft" => ext(0x5B),
        "MetaRight" => ext(0x5C),
        "ContextMenu" => ext(0x5D),
        _ => None,
    }
}

const META_KEYS: [(u16, bool); 2] = [(0x5B, true), (0x5C, true)];
const KEY_L: (u16, bool) = (0x26, false);

// ------------------------------------------------------------------ Windows

#[cfg(windows)]
mod win {
    use super::Screen;
    use windows_sys::Win32::Foundation::{LPARAM, RECT};
    use windows_sys::Win32::Graphics::Gdi::{EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    pub fn screens() -> Vec<Screen> {
        unsafe extern "system" fn each(m: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> windows_sys::core::BOOL {
            // SAFETY: `data` is the Vec passed below, alive for the whole call.
            let out = unsafe { &mut *(data as *mut Vec<Screen>) };
            let mut info: MONITORINFO = unsafe { std::mem::zeroed() };
            info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
            if unsafe { GetMonitorInfoW(m, &mut info) } != 0 {
                let (r, w) = (info.rcMonitor, info.rcWork);
                out.push(Screen {
                    left: r.left,
                    top: r.top,
                    width: r.right - r.left,
                    height: r.bottom - r.top,
                    work_left: w.left,
                    work_top: w.top,
                    work_width: w.right - w.left,
                    work_height: w.bottom - w.top,
                    primary: info.dwFlags & 1 != 0, // MONITORINFOF_PRIMARY
                });
            }
            1
        }
        let mut out: Vec<Screen> = Vec::new();
        // SAFETY: enumerates the screens into `out` (see `each`).
        unsafe {
            EnumDisplayMonitors(std::ptr::null_mut(), std::ptr::null(), Some(each), &mut out as *mut _ as LPARAM);
        }
        out
    }

    /// The whole desktop (every screen): left, top, width, height.
    pub fn desktop() -> (i32, i32, i32, i32) {
        // SAFETY: plain metrics queries.
        unsafe {
            (
                GetSystemMetrics(SM_XVIRTUALSCREEN),
                GetSystemMetrics(SM_YVIRTUALSCREEN),
                GetSystemMetrics(SM_CXVIRTUALSCREEN),
                GetSystemMetrics(SM_CYVIRTUALSCREEN),
            )
        }
    }

    fn send(input: INPUT) -> bool {
        // SAFETY: one fully initialised INPUT.
        unsafe { SendInput(1, &input, std::mem::size_of::<INPUT>() as i32) == 1 }
    }

    pub fn mouse(flags: u32, dx: i32, dy: i32, data: i32) -> bool {
        send(INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT { dx, dy, mouseData: data as u32, dwFlags: flags, time: 0, dwExtraInfo: 0 },
            },
        })
    }

    pub fn move_to(ax: i32, ay: i32) -> bool {
        mouse(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK, ax, ay, 0)
    }

    pub fn button(b: u8, down: bool) -> bool {
        let (flags, data) = match (b, down) {
            (0, true) => (MOUSEEVENTF_LEFTDOWN, 0),
            (0, false) => (MOUSEEVENTF_LEFTUP, 0),
            (1, true) => (MOUSEEVENTF_MIDDLEDOWN, 0),
            (1, false) => (MOUSEEVENTF_MIDDLEUP, 0),
            (2, true) => (MOUSEEVENTF_RIGHTDOWN, 0),
            (2, false) => (MOUSEEVENTF_RIGHTUP, 0),
            (3, d) => (if d { MOUSEEVENTF_XDOWN } else { MOUSEEVENTF_XUP }, 1), // XBUTTON1
            (4, d) => (if d { MOUSEEVENTF_XDOWN } else { MOUSEEVENTF_XUP }, 2), // XBUTTON2
            _ => return false,
        };
        mouse(flags, 0, 0, data)
    }

    pub fn wheel(dx: i32, dy: i32) -> bool {
        let mut ok = true;
        if dy != 0 {
            ok &= mouse(MOUSEEVENTF_WHEEL, 0, 0, dy);
        }
        if dx != 0 {
            ok &= mouse(MOUSEEVENTF_HWHEEL, 0, 0, dx);
        }
        ok
    }

    pub fn key(scan: u16, ext: bool, down: bool) -> bool {
        let mut flags = KEYEVENTF_SCANCODE;
        if ext {
            flags |= KEYEVENTF_EXTENDEDKEY;
        }
        if !down {
            flags |= KEYEVENTF_KEYUP;
        }
        send(INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: 0, wScan: scan, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
        })
    }

    /// LANX 3.7.0: types text as characters (any language, emoji), whatever the keyboard layout.
    pub fn text(t: &str) -> bool {
        let mut inputs: Vec<INPUT> = Vec::with_capacity(t.encode_utf16().count() * 2);
        for unit in t.encode_utf16() {
            for flags in [KEYEVENTF_UNICODE, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP] {
                inputs.push(INPUT {
                    r#type: INPUT_KEYBOARD,
                    Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: 0, wScan: unit, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
                });
            }
        }
        // In batches: very long texts in one SendInput can be dropped.
        inputs.chunks(200).all(|c| {
            // SAFETY: fully initialised INPUTs, the count matches the slice.
            unsafe { SendInput(c.len() as u32, c.as_ptr(), std::mem::size_of::<INPUT>() as i32) == c.len() as u32 }
        })
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn cursor() -> Option<(i32, i32)> {
        let mut p = windows_sys::Win32::Foundation::POINT { x: 0, y: 0 };
        // SAFETY: writes into `p`.
        (unsafe { GetCursorPos(&mut p) } != 0).then_some((p.x, p.y))
    }
}

#[cfg(windows)]
pub fn screens() -> Vec<Screen> {
    win::screens()
}

#[cfg(not(windows))]
pub fn screens() -> Vec<Screen> {
    Vec::new()
}

// ---------------------------------------------------------------- the session

/// "Allow" was pressed for `call_id`. `width` × `height` is the size of the
/// screen picture being shared (to find which screen it is).
pub fn allow(app: &AppHandle, call_id: &str, peer_name: &str, width: u32, height: u32, still_ok: StillOk) -> Result<RemoteInfo, String> {
    let all = screens();
    let mut candidates = matching_screens(&all, width, height);
    if candidates.is_empty() && crate::testmode::remote_any_screen() {
        candidates = matching_screens(&all, 0, 0); // a test copy's fake screen picture
    }
    if candidates.is_empty() {
        return Err("You're sharing a single window. Share your whole screen so they can control it.".to_string());
    }
    stop("stopped"); // a previous one (another call) never carries over
    let first = candidates[0];
    *SESSION.lock() = Some(Session {
        call_id: call_id.to_string(),
        peer_name: peer_name.to_string(),
        screens: candidates,
        current: 0,
        keys: Vec::new(),
        buttons: 0,
        last: None,
        placed: None,
        blocked_at: 0,
    });
    *STILL_OK.lock() = Some(still_ok);
    *APP.lock() = Some(app.clone());
    LOCAL_MOUSE_MS.store(0, Ordering::SeqCst);
    start_guard(first);
    show_banner(app, &first);
    let i = info();
    let _ = app.emit("lanx://remote", i.clone());
    Ok(i)
}

/// Ends remote control (Stop, the call ended, or a new session): lets go of
/// every key and button the colleague was holding, removes the frame and bar.
pub fn stop(reason: &str) -> Option<RemoteInfo> {
    let s = SESSION.lock().take()?;
    release(&s);
    *STILL_OK.lock() = None;
    stop_guard();
    let app = APP.lock().clone();
    let ended = RemoteInfo { reason: Some(reason.to_string()), call_id: s.call_id.clone(), peer_name: s.peer_name.clone(), ..Default::default() };
    if let Some(app) = app {
        if let Some(w) = app.get_webview_window("remote") {
            let _ = w.hide();
        }
        let _ = app.emit("lanx://remote", ended.clone());
    }
    Some(ended)
}

/// Stops remote control if it belongs to `call_id` (the call ended).
pub fn stop_for_call(call_id: &str) {
    if SESSION.lock().as_ref().is_some_and(|s| s.call_id == call_id) {
        stop("call-ended");
    }
}

fn release(s: &Session) {
    for &(scan, ext) in s.keys.iter().rev() {
        inject_key(scan, ext, false, "release");
    }
    for b in 0..5u8 {
        if s.buttons & (1 << b) != 0 {
            inject_button(b, false);
        }
    }
}

/// The picture is of another screen than LANX guessed: try the next one.
pub fn next_screen(call_id: &str) -> Result<RemoteInfo, String> {
    let screen = {
        let mut g = SESSION.lock();
        let s = g.as_mut().filter(|s| s.call_id == call_id).ok_or("Remote control is off.")?;
        s.current = (s.current + 1) % s.screens.len().max(1);
        s.screens[s.current]
    };
    move_guard_frame(&screen);
    if let Some(app) = APP.lock().clone() {
        show_banner(&app, &screen);
        let _ = app.emit("lanx://remote", info());
    }
    Ok(info())
}

/// Whether this PC's own mouse is in use right now (the colleague's waits).
fn local_busy() -> bool {
    let t = LOCAL_MOUSE_MS.load(Ordering::SeqCst);
    t != 0 && clock() - t < LOCAL_WINS_MS
}

/// Adds a physical movement of `d` pixels at `now`; true when it adds up to a
/// real movement (pure, so it can be tested: (sum, window start) in and out).
pub fn physical_move(sum: i64, since: i64, now: i64, d: i64) -> (i64, i64, bool) {
    let (sum, since) = if now - since > MOVE_WINDOW_MS { (0, now) } else { (sum, since) };
    let sum = sum + d.max(0);
    (sum, since, sum >= LOCAL_MOVE_PX)
}

/// The colleague's mouse and keyboard, for the allowed call only.
pub fn input(call_id: &str, events: &[InputEvent]) -> Result<InputResult, String> {
    if events.len() > MAX_EVENTS {
        return Err("Too much at once.".to_string());
    }
    let mut refused = false;
    let report = {
        let mut g = SESSION.lock();
        let s = g.as_mut().filter(|s| s.call_id == call_id).ok_or("Remote control is off.")?;
        let busy = local_busy();
        // Before a click or a turn of the wheel: the real pointer goes to
        // where they point (it may have waited for this PC's own mouse).
        let place = |s: &mut Session, refused: &mut bool| {
            if let Some(p) = s.last {
                if s.placed != Some(p) {
                    if inject_move(p.0, p.1) {
                        s.placed = Some(p);
                    } else {
                        *refused = true;
                    }
                }
            }
        };
        for e in events {
            match e {
                InputEvent::Move { x, y } => {
                    let p = to_pixel(&s.screens[s.current], *x, *y);
                    s.last = Some(p);
                    if !busy {
                        place(s, &mut refused);
                    }
                }
                InputEvent::Button { b, down } => {
                    if *b > 4 {
                        continue;
                    }
                    let bit = 1u8 << b;
                    if *down {
                        if busy || s.buttons & bit != 0 {
                            continue;
                        }
                        s.buttons |= bit;
                    } else {
                        if s.buttons & bit == 0 {
                            continue;
                        }
                        s.buttons &= !bit;
                    }
                    if !busy {
                        place(s, &mut refused);
                    }
                    refused |= !inject_button(*b, *down);
                }
                InputEvent::Wheel { dx, dy } => {
                    if !busy {
                        place(s, &mut refused);
                        refused |= !inject_wheel((*dx).clamp(-2400, 2400), (*dy).clamp(-2400, 2400));
                    }
                }
                InputEvent::Key { code, down } => {
                    let Some(k) = scan_code(code) else { continue };
                    if *down {
                        // Windows + L would lock the PC with the colleague shut out.
                        if k == KEY_L && s.keys.iter().any(|h| META_KEYS.contains(h)) {
                            continue;
                        }
                        if !s.keys.contains(&k) {
                            s.keys.push(k);
                        }
                    } else {
                        if !s.keys.contains(&k) {
                            continue;
                        }
                        s.keys.retain(|h| *h != k);
                    }
                    refused |= !inject_key(k.0, k.1, *down, code);
                }
                InputEvent::Combo { codes } => {
                    let keys: Vec<(u16, bool, &str)> =
                        codes.iter().take(4).filter_map(|c| scan_code(c).map(|k| (k.0, k.1, c.as_str()))).collect();
                    if keys.len() != codes.len().min(4) || keys.is_empty() {
                        continue;
                    }
                    let has_meta = keys.iter().any(|k| META_KEYS.contains(&(k.0, k.1)));
                    if has_meta && keys.iter().any(|k| (k.0, k.1) == KEY_L) {
                        continue;
                    }
                    if dry_run() {
                        DRY_LOG.lock().push(format!("combo {}", keys.iter().map(|k| k.2).collect::<Vec<_>>().join("+")));
                        refused |= TEST_BLOCKED.load(Ordering::SeqCst);
                        continue;
                    }
                    for k in &keys {
                        refused |= !inject_key(k.0, k.1, true, k.2);
                    }
                    for k in keys.iter().rev() {
                        refused |= !inject_key(k.0, k.1, false, k.2);
                    }
                }
            }
        }
        // Tell the window (and the Stop bar) now and then, not for every key.
        let now = clock();
        let due = refused && (s.blocked_at == 0 || now - s.blocked_at >= BLOCKED_REPORT_MS);
        if refused {
            s.blocked_at = now;
        }
        due
    };
    if report {
        if let Some(app) = APP.lock().clone() {
            let _ = app.emit("lanx://remote", info());
        }
    }
    Ok(InputResult { blocked: refused })
}

/// Test copies: pretend Windows refuses (true) or accepts (false) their input.
pub fn test_block(on: bool) {
    TEST_BLOCKED.store(on, Ordering::SeqCst);
}

/// Each returns false when Windows refused the input.
fn inject_move(px: i32, py: i32) -> bool {
    #[cfg(windows)]
    {
        if !dry_run() {
            let (ax, ay) = to_absolute(px, py, win::desktop());
            return win::move_to(ax, ay);
        }
    }
    DRY_LOG.lock().push(format!("move {},{}", px, py));
    !TEST_BLOCKED.load(Ordering::SeqCst)
}

fn inject_button(b: u8, down: bool) -> bool {
    #[cfg(windows)]
    {
        if !dry_run() {
            return win::button(b, down);
        }
    }
    DRY_LOG.lock().push(format!("button {} {}", b, if down { "down" } else { "up" }));
    !TEST_BLOCKED.load(Ordering::SeqCst)
}

fn inject_wheel(dx: i32, dy: i32) -> bool {
    #[cfg(windows)]
    {
        if !dry_run() {
            return win::wheel(dx, dy);
        }
    }
    DRY_LOG.lock().push(format!("wheel {},{}", dx, dy));
    !TEST_BLOCKED.load(Ordering::SeqCst)
}

fn inject_key(scan: u16, ext: bool, down: bool, name: &str) -> bool {
    #[cfg(windows)]
    {
        if !dry_run() {
            return win::key(scan, ext, down);
        }
    }
    #[cfg(not(windows))]
    let _ = (scan, ext);
    DRY_LOG.lock().push(format!("key {} {}", name, if down { "down" } else { "up" }));
    !TEST_BLOCKED.load(Ordering::SeqCst)
}

/// Test copies: what remote control would have done (and forget it).
pub fn take_dry_log() -> Vec<String> {
    std::mem::take(&mut *DRY_LOG.lock())
}

// ------------------------------------------- LANX 3.7.0: hands drive this PC

/// One thing a hand gesture does to this PC's own mouse or keyboard ("Control
/// the whole PC"): the pointer goes to a 0..1 spot on a screen, a mouse button
/// or a key goes down or up, the wheel turns, or text is typed (the air keyboard).
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum HandInput {
    /// Straight there (before a click, so it lands exactly where the fingers met).
    Move { x: f64, y: f64 },
    /// LANX 3.7.1: glide there (the hand's newest place; see `glide`).
    Aim { x: f64, y: f64 },
    /// LANX 3.7.1: scroll this much, spread smoothly over the next moments.
    Scroll { dx: i32, dy: i32 },
    /// 0 left, 1 middle, 2 right.
    Button { button: u8, down: bool },
    /// 120 = one notch; positive `dy` scrolls up.
    Wheel { dx: i32, dy: i32 },
    /// A key by place (`KeyboardEvent.code`): "Enter", "ArrowLeft", "ControlLeft"…
    Key { code: String, down: bool },
    Text { text: String },
}

/// LANX 3.7.1: the hand pointer glides. The camera sees the hand 15–20 times a
/// second; moving the mouse only then looks steppy. Here the mouse is eased
/// towards the hand's newest place about 120 times a second (and scrolling is
/// spread out the same way), so it moves like a real mouse.
mod glide {
    use super::{dry_run, inject_move, inject_wheel, DRY_LOG, TEST_BLOCKED};
    use parking_lot::Mutex;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::{Duration, Instant};

    /// How quickly it catches up (seconds to cover about two-thirds of the way).
    const TAU: f64 = 0.045;
    const STEP: Duration = Duration::from_millis(8);
    /// No new place for this long: it rests (and the next aim starts from wherever the mouse is).
    const REST: Duration = Duration::from_millis(1500);
    /// Scrolling is let out at this share per step (about 90% within a tenth of a second).
    const SCROLL_SHARE: f64 = 0.18;

    struct State {
        x: f64,
        y: f64,
        tx: f64,
        ty: f64,
        sent: (i32, i32),
        wx: f64,
        wy: f64,
        at: Instant,
    }
    static STATE: Mutex<Option<State>> = Mutex::new(None);
    static RUNNING: AtomicBool = AtomicBool::new(false);

    fn here() -> Option<(i32, i32)> {
        #[cfg(windows)]
        {
            super::win::cursor()
        }
        #[cfg(not(windows))]
        {
            None
        }
    }

    fn with<R>(px: i32, py: i32, f: impl FnOnce(&mut State) -> R) -> R {
        let mut g = STATE.lock();
        let fresh = g.as_ref().map(|s| s.at.elapsed() > REST).unwrap_or(true);
        if fresh {
            let (cx, cy) = here().unwrap_or((px, py));
            *g = Some(State { x: cx as f64, y: cy as f64, tx: px as f64, ty: py as f64, sent: (cx, cy), wx: 0.0, wy: 0.0, at: Instant::now() });
        }
        let s = g.as_mut().expect("just set");
        s.at = Instant::now();
        f(s)
    }

    fn start() {
        if RUNNING.swap(true, Ordering::SeqCst) {
            return;
        }
        std::thread::Builder::new()
            .name("lanx-hand-glide".into())
            .spawn(|| {
                let mut last = Instant::now();
                let mut resting = false;
                loop {
                    // Resting (no hand for a while): look in far less often.
                    std::thread::sleep(if resting { Duration::from_millis(120) } else { STEP });
                    let dt = last.elapsed().as_secs_f64().min(0.05);
                    last = Instant::now();
                    let (to, wheel) = {
                        let mut g = STATE.lock();
                        let Some(s) = g.as_mut() else {
                            resting = true;
                            continue;
                        };
                        resting = s.at.elapsed() > REST && s.wx.abs() < 1.0 && s.wy.abs() < 1.0;
                        if resting {
                            continue;
                        }
                        let k = 1.0 - (-dt / TAU).exp();
                        s.x += (s.tx - s.x) * k;
                        s.y += (s.ty - s.y) * k;
                        if (s.tx - s.x).abs() < 0.5 && (s.ty - s.y).abs() < 0.5 {
                            s.x = s.tx;
                            s.y = s.ty;
                        }
                        let p = (s.x.round() as i32, s.y.round() as i32);
                        let to = (p != s.sent).then(|| {
                            s.sent = p;
                            p
                        });
                        // Whole wheel units only; what is left waits for the next step.
                        let take = |v: &mut f64| {
                            let part = if v.abs() < 4.0 { *v } else { *v * SCROLL_SHARE.max(4.0 / v.abs()) };
                            let n = part.trunc();
                            *v -= n;
                            n as i32
                        };
                        let wheel = (take(&mut s.wx), take(&mut s.wy));
                        (to, wheel)
                    };
                    if let Some((x, y)) = to {
                        inject_move(x, y);
                    }
                    if wheel != (0, 0) {
                        inject_wheel(wheel.0, wheel.1);
                    }
                }
            })
            .map_err(|_| RUNNING.store(false, Ordering::SeqCst))
            .ok();
    }

    /// Glide towards (px, py).
    pub fn aim(px: i32, py: i32) -> bool {
        if dry_run() {
            DRY_LOG.lock().push(format!("aim {},{}", px, py));
            return !TEST_BLOCKED.load(Ordering::SeqCst);
        }
        with(px, py, |s| {
            s.tx = px as f64;
            s.ty = py as f64;
        });
        start();
        true
    }

    /// The mouse was put straight there: glide on from there.
    pub fn snap(px: i32, py: i32) {
        if dry_run() {
            return;
        }
        with(px, py, |s| {
            s.x = px as f64;
            s.y = py as f64;
            s.tx = s.x;
            s.ty = s.y;
            s.sent = (px, py);
        });
    }

    /// Scroll by (dx, dy) wheel units, let out smoothly.
    pub fn scroll(dx: i32, dy: i32) -> bool {
        if dry_run() {
            return inject_wheel(dx, dy);
        }
        let mut g = STATE.lock();
        match g.as_mut() {
            Some(s) => {
                s.wx += dx as f64;
                s.wy += dy as f64;
                s.at = Instant::now();
            }
            None => {
                drop(g);
                return inject_wheel(dx, dy);
            }
        }
        drop(g);
        start();
        true
    }
}

/// The most typed in one go (the air keyboard sends a key or a word at a time).
const MAX_HAND_TEXT: usize = 4000;
/// Test copies on a PC without screens pretend to have this one.
const PRETEND_SCREEN: Screen = Screen { left: 0, top: 0, width: 1920, height: 1080, work_left: 0, work_top: 0, work_width: 1920, work_height: 1040, primary: true };

fn inject_text(text: &str) -> bool {
    #[cfg(windows)]
    {
        if !dry_run() {
            return win::text(text);
        }
    }
    DRY_LOG.lock().push(format!("text {}", text));
    !TEST_BLOCKED.load(Ordering::SeqCst)
}

/// Does `ops` in order on screen number `screen` (of `screens()`; the main one
/// when there is no such screen).
pub fn hand_input(screen: usize, ops: &[HandInput]) -> Result<(), String> {
    if !cfg!(windows) && !dry_run() {
        return Err("Controlling the whole PC with your hands works on Windows for now.".to_string());
    }
    let all = screens();
    let s = all.get(screen).or_else(|| all.iter().find(|s| s.primary)).or(all.first()).copied().unwrap_or(PRETEND_SCREEN);
    let mut ok = true;
    for op in ops {
        ok &= match op {
            HandInput::Move { x, y } => {
                let (px, py) = to_pixel(&s, *x, *y);
                glide::snap(px, py);
                inject_move(px, py)
            }
            HandInput::Aim { x, y } => {
                let (px, py) = to_pixel(&s, *x, *y);
                glide::aim(px, py)
            }
            HandInput::Scroll { dx, dy } => glide::scroll((*dx).clamp(-2400, 2400), (*dy).clamp(-2400, 2400)),
            HandInput::Button { button, down } => match button {
                0..=2 => inject_button(*button, *down),
                _ => return Err("Unknown mouse button".to_string()),
            },
            HandInput::Wheel { dx, dy } => inject_wheel((*dx).clamp(-2400, 2400), (*dy).clamp(-2400, 2400)),
            HandInput::Key { code, down } => {
                let (scan, ext) = scan_code(code).ok_or_else(|| format!("Unknown key {code}"))?;
                inject_key(scan, ext, *down, code)
            }
            HandInput::Text { text } => {
                if text.len() > MAX_HAND_TEXT {
                    return Err("That is too much to type in one go.".to_string());
                }
                text.is_empty() || inject_text(text)
            }
        };
    }
    if ok {
        Ok(())
    } else {
        Err("Windows didn't take it: the program in front may be running as administrator.".to_string())
    }
}

/// LANX 3.7.0 ("lock this PC" by a sign or a spoken command).
pub fn lock_pc() -> Result<(), String> {
    if dry_run() {
        DRY_LOG.lock().push("lock".to_string());
        return Ok(());
    }
    #[cfg(windows)]
    let r = std::process::Command::new("rundll32.exe").args(["user32.dll,LockWorkStation"]).status();
    #[cfg(not(windows))]
    let r = std::process::Command::new("loginctl").arg("lock-session").status();
    match r {
        Ok(s) if s.success() => Ok(()),
        _ => Err("This PC didn't lock.".to_string()),
    }
}

// ------------------------------------------------------------------ clipboard

/// The clipboard's change counter (it goes up whenever anything is copied).
pub fn clipboard_seq() -> u32 {
    if dry_run() {
        return TEST_CLIPBOARD.lock().0;
    }
    #[cfg(windows)]
    // SAFETY: plain query.
    unsafe {
        windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber()
    }
    #[cfg(not(windows))]
    0
}

/// The copied text, if any.
pub fn read_clipboard() -> Option<String> {
    if dry_run() {
        let t = TEST_CLIPBOARD.lock().1.clone();
        return (!t.is_empty()).then_some(t);
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::DataExchange::{CloseClipboard, GetClipboardData, OpenClipboard};
        use windows_sys::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
        use windows_sys::Win32::System::Ole::CF_UNICODETEXT;
        // SAFETY: the clipboard is opened, read within the locked block's size, and closed.
        unsafe {
            if !open_clipboard(|| OpenClipboard(std::ptr::null_mut()) != 0) {
                return None;
            }
            let mut text = None;
            let h = GetClipboardData(CF_UNICODETEXT as u32);
            if !h.is_null() {
                let p = GlobalLock(h) as *const u16;
                if !p.is_null() {
                    let max = (GlobalSize(h) / 2).min(CLIPBOARD_MAX_CHARS * 2);
                    let slice = std::slice::from_raw_parts(p, max);
                    let end = slice.iter().position(|&c| c == 0).unwrap_or(max);
                    text = Some(String::from_utf16_lossy(&slice[..end]));
                    GlobalUnlock(h);
                }
            }
            CloseClipboard();
            text.filter(|t| !t.is_empty())
        }
    }
    #[cfg(not(windows))]
    None
}

/// Puts `text` on the clipboard; returns the new change counter.
pub fn write_clipboard(text: &str) -> Result<u32, String> {
    let text: String = text.chars().take(CLIPBOARD_MAX_CHARS).collect();
    if dry_run() {
        let mut c = TEST_CLIPBOARD.lock();
        c.0 += 1;
        c.1 = text;
        return Ok(c.0);
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::GlobalFree;
        use windows_sys::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData};
        use windows_sys::Win32::System::Memory::{GMEM_MOVEABLE, GlobalAlloc, GlobalLock, GlobalUnlock};
        use windows_sys::Win32::System::Ole::CF_UNICODETEXT;
        let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
        // SAFETY: a movable block of the right size is filled, handed to the
        // clipboard (which then owns it) or freed if that fails.
        unsafe {
            if !open_clipboard(|| OpenClipboard(std::ptr::null_mut()) != 0) {
                return Err("The clipboard is busy.".to_string());
            }
            EmptyClipboard();
            let h = GlobalAlloc(GMEM_MOVEABLE, wide.len() * 2);
            let mut ok = false;
            if !h.is_null() {
                let p = GlobalLock(h) as *mut u16;
                if !p.is_null() {
                    std::ptr::copy_nonoverlapping(wide.as_ptr(), p, wide.len());
                    GlobalUnlock(h);
                    ok = !SetClipboardData(CF_UNICODETEXT as u32, h).is_null();
                }
                if !ok {
                    GlobalFree(h);
                }
            }
            CloseClipboard();
            if !ok {
                return Err("Could not copy the text.".to_string());
            }
        }
        Ok(clipboard_seq())
    }
    #[cfg(not(windows))]
    Err("Needs Windows.".to_string())
}

/// Another program may have the clipboard open for a moment: try a few times.
#[cfg(windows)]
fn open_clipboard(open: impl Fn() -> bool) -> bool {
    for _ in 0..8 {
        if open() {
            return true;
        }
        std::thread::sleep(std::time::Duration::from_millis(15));
    }
    false
}

/// Test copies: pretend the person at this PC copied `text`.
pub fn test_copy(text: &str) -> u32 {
    let mut c = TEST_CLIPBOARD.lock();
    c.0 += 1;
    c.1 = text.to_string();
    c.0
}

// ------------------------------------------------------------ guard thread

/// A thread for the session: every second it checks that the call is still
/// on (and ends remote control when it isn't); on a normal installation it
/// also draws the orange frame and watches this PC's own mouse.
#[cfg(windows)]
fn start_guard(screen: Screen) {
    use windows_sys::Win32::System::Threading::GetCurrentThreadId;
    use windows_sys::Win32::UI::WindowsAndMessaging::*;
    let real = !dry_run() || crate::testmode::remote_frame();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || unsafe {
        let mut msg: MSG = std::mem::zeroed();
        PeekMessageW(&mut msg, std::ptr::null_mut(), WM_USER, WM_USER, PM_NOREMOVE);
        let _ = tx.send(GetCurrentThreadId());
        let hook = if real { frame::watch_mouse() } else { std::ptr::null_mut() };
        let mut frame_win = if real { frame::create(&screen) } else { std::ptr::null_mut() };
        let timer = SetTimer(std::ptr::null_mut(), 0, 1000, None);
        while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
            if msg.message == WM_TIMER && msg.hwnd.is_null() {
                let ok = STILL_OK.lock().as_ref().map(|f| f()).unwrap_or(false);
                if !ok {
                    // (stop() posts WM_QUIT to this thread, which ends the loop.)
                    std::thread::spawn(|| stop("call-ended"));
                }
                frame::keep_on_top(frame_win);
                continue;
            }
            if msg.message == WM_APP + 7 {
                let now = SESSION.lock().as_ref().map(|s| s.screens[s.current]);
                if let Some(s) = now {
                    if !frame_win.is_null() {
                        DestroyWindow(frame_win);
                        frame_win = frame::create(&s);
                    }
                }
                continue;
            }
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        KillTimer(std::ptr::null_mut(), timer);
        if !frame_win.is_null() {
            DestroyWindow(frame_win);
        }
        if !hook.is_null() {
            UnhookWindowsHookEx(hook);
        }
    });
    let tid = rx.recv_timeout(std::time::Duration::from_secs(2)).unwrap_or(0);
    GUARD_THREAD.store(tid, Ordering::SeqCst);
}

#[cfg(not(windows))]
fn start_guard(_screen: Screen) {}

fn stop_guard() {
    let tid = GUARD_THREAD.swap(0, Ordering::SeqCst);
    #[cfg(windows)]
    if tid != 0 {
        use windows_sys::Win32::UI::WindowsAndMessaging::{PostThreadMessageW, WM_QUIT};
        // SAFETY: asks our own guard thread to finish.
        unsafe {
            PostThreadMessageW(tid, WM_QUIT, 0, 0);
        }
    }
    #[cfg(not(windows))]
    let _ = tid;
}

fn move_guard_frame(_screen: &Screen) {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{PostThreadMessageW, WM_APP};
        let tid = GUARD_THREAD.load(Ordering::SeqCst);
        if tid != 0 {
            // SAFETY: a private message to our own guard thread.
            unsafe {
                PostThreadMessageW(tid, WM_APP + 7, 0, 0);
            }
        }
    }
}

#[cfg(windows)]
mod frame {
    use super::{LOCAL_MOUSE_MS, Screen, clock};
    use std::sync::atomic::Ordering;
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows_sys::Win32::Graphics::Gdi::*;
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    const KEY: u32 = 0x00FF00FF; // magenta: see-through
    const ORANGE: u32 = 0x0016_73F9; // #F97316 (BGR)

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe extern "system" fn paint(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
        // SAFETY: standard window procedure for our own frame window.
        unsafe {
            match msg {
                WM_PAINT => {
                    let mut ps: PAINTSTRUCT = std::mem::zeroed();
                    let dc = BeginPaint(hwnd, &mut ps);
                    let mut r: RECT = std::mem::zeroed();
                    GetClientRect(hwnd, &mut r);
                    let clear = CreateSolidBrush(KEY);
                    FillRect(dc, &r, clear);
                    DeleteObject(clear);
                    let t = ((r.bottom - r.top) / 240).clamp(4, 10);
                    let edge = CreateSolidBrush(ORANGE);
                    for e in [
                        RECT { left: 0, top: 0, right: r.right, bottom: t },
                        RECT { left: 0, top: r.bottom - t, right: r.right, bottom: r.bottom },
                        RECT { left: 0, top: 0, right: t, bottom: r.bottom },
                        RECT { left: r.right - t, top: 0, right: r.right, bottom: r.bottom },
                    ] {
                        FillRect(dc, &e, edge);
                    }
                    DeleteObject(edge);
                    EndPaint(hwnd, &ps);
                    0
                }
                WM_ERASEBKGND => 1,
                WM_NCHITTEST => HTTRANSPARENT as LRESULT,
                _ => DefWindowProcW(hwnd, msg, wp, lp),
            }
        }
    }

    /// A see-through, click-through window with an orange edge around `s`
    /// (left out of screen sharing, so only the person at this PC sees it).
    pub unsafe fn create(s: &Screen) -> HWND {
        // SAFETY: registers (once) and creates our own window on this thread.
        unsafe {
            let inst = GetModuleHandleW(std::ptr::null());
            let class = wide("LANXRemoteFrame");
            let mut wc: WNDCLASSW = std::mem::zeroed();
            wc.lpfnWndProc = Some(paint);
            wc.hInstance = inst;
            wc.lpszClassName = class.as_ptr();
            RegisterClassW(&wc); // fails harmlessly when already registered
            let title = wide("LANX remote control");
            let hwnd = CreateWindowExW(
                WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
                class.as_ptr(),
                title.as_ptr(),
                WS_POPUP,
                s.left,
                s.top,
                s.width,
                s.height,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                inst,
                std::ptr::null(),
            );
            if hwnd.is_null() {
                return hwnd;
            }
            SetLayeredWindowAttributes(hwnd, KEY, 255, LWA_COLORKEY);
            SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
            ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            hwnd
        }
    }

    pub unsafe fn keep_on_top(hwnd: HWND) {
        if !hwnd.is_null() {
            // SAFETY: re-raises our own window without activating it.
            unsafe {
                SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE);
            }
        }
    }

    unsafe extern "system" fn mouse_hook(code: i32, wp: WPARAM, lp: LPARAM) -> LRESULT {
        // SAFETY: Windows passes an MSLLHOOKSTRUCT for HC_ACTION.
        unsafe {
            if code == HC_ACTION as i32 {
                let info = &*(lp as *const MSLLHOOKSTRUCT);
                if info.flags & LLMHF_INJECTED == 0 {
                    let now = clock();
                    if wp as u32 == WM_MOUSEMOVE {
                        // The pointer hasn't moved yet: the distance to where it is.
                        let mut cur = windows_sys::Win32::Foundation::POINT { x: 0, y: 0 };
                        GetCursorPos(&mut cur);
                        let d = ((info.pt.x - cur.x).abs() + (info.pt.y - cur.y).abs()) as i64;
                        let (sum, since, real) = super::physical_move(
                            super::PHYS_ACC.load(Ordering::SeqCst),
                            super::PHYS_ACC_T.load(Ordering::SeqCst),
                            now,
                            d,
                        );
                        super::PHYS_ACC.store(sum, Ordering::SeqCst);
                        super::PHYS_ACC_T.store(since, Ordering::SeqCst);
                        if real {
                            LOCAL_MOUSE_MS.store(now, Ordering::SeqCst);
                        }
                    } else {
                        // A click or the wheel on this PC's own mouse.
                        LOCAL_MOUSE_MS.store(now, Ordering::SeqCst);
                    }
                }
            }
            CallNextHookEx(std::ptr::null_mut(), code, wp, lp)
        }
    }

    /// Notices when the person at this PC moves or clicks their own mouse
    /// (the colleague's mouse is "injected" and doesn't count).
    pub unsafe fn watch_mouse() -> HHOOK {
        // SAFETY: a low-level mouse hook on this thread, removed when it ends.
        unsafe { SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook), GetModuleHandleW(std::ptr::null()), 0) }
    }
}

// ---------------------------------------------------------------- Stop bar

const BAR_W: f64 = 440.0;
const BAR_H: f64 = 64.0;

/// The bar at the bottom of the shared screen: "Bharat is controlling your
/// PC · Stop". It never takes the keyboard from the program in use.
fn show_banner(app: &AppHandle, s: &Screen) {
    let w = match app.get_webview_window("remote") {
        Some(w) => w,
        None => match tauri::WebviewWindowBuilder::new(app, "remote", tauri::WebviewUrl::App("index.html".into()))
            .title("LANX remote control")
            .inner_size(BAR_W, BAR_H)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .focused(false)
            .focusable(false)
            .visible(false)
            .disable_drag_drop_handler()
            .build()
        {
            Ok(w) => {
                let _ = w.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
                // LANX 1.9.1: the Stop bar must not stay white either.
                crate::window_doctor::watch(app, "remote");
                w
            }
            Err(e) => {
                eprintln!("[Remote] Could not show the Stop bar: {}", e);
                return;
            }
        },
    };
    let scale = app
        .available_monitors()
        .ok()
        .and_then(|ms| ms.into_iter().find(|m| m.position().x == s.left && m.position().y == s.top))
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);
    let (pw, ph) = ((BAR_W * scale).round() as i32, (BAR_H * scale).round() as i32);
    let _ = w.set_size(tauri::PhysicalSize::new(pw as u32, ph as u32));
    let x = s.work_left + (s.work_width - pw) / 2;
    let y = s.work_top + s.work_height - ph - (12.0 * scale).round() as i32;
    let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
    crate::events::show_without_focus(&w);
}

/// Real-hardware check (run by hand: `cargo test -- --ignored`): moves the
/// mouse to known pixels on every screen, reads it back, puts it back.
#[cfg(all(test, windows))]
mod real {
    #[test]
    #[ignore]
    fn mouse_lands_on_the_right_pixel() {
        // Like LANX itself (real pixels on scaled screens, e.g. 150 %).
        // SAFETY: sets this test process's own DPI mode.
        unsafe {
            use windows_sys::Win32::UI::HiDpi::*;
            SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        }
        let screens = super::win::screens();
        eprintln!("screens: {:?}", screens);
        let start = super::win::cursor().unwrap();
        let desk = super::win::desktop();
        let mut misses = Vec::new();
        for s in screens {
            for (x, y) in [(0.0, 0.0), (0.5, 0.5), (1.0, 1.0), (0.25, 0.8)] {
                let (px, py) = super::to_pixel(&s, x, y);
                let (ax, ay) = super::to_absolute(px, py, desk);
                super::win::move_to(ax, ay);
                std::thread::sleep(std::time::Duration::from_millis(40));
                let got = super::win::cursor().unwrap();
                if got != (px, py) {
                    misses.push(format!("wanted {px},{py} got {},{}", got.0, got.1));
                }
            }
        }
        let (ax, ay) = super::to_absolute(start.0, start.1, desk);
        super::win::move_to(ax, ay);
        assert!(misses.is_empty(), "{:?}", misses);
    }
}

#[cfg(all(test, windows))]
mod frame_check {
    /// Run by hand (`cargo test -- --ignored`): shows the orange frame for a
    /// moment and checks it is see-through, click-through and topmost.
    #[test]
    #[ignore]
    fn frame_is_click_through() {
        use windows_sys::Win32::UI::WindowsAndMessaging::*;
        let s = super::win::screens()[0];
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || unsafe {
            let h = super::frame::create(&s);
            tx.send(h as usize).unwrap();
            let mut msg: MSG = std::mem::zeroed();
            let t = SetTimer(std::ptr::null_mut(), 0, 1500, None);
            while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                if msg.message == WM_TIMER && msg.hwnd.is_null() {
                    break;
                }
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            KillTimer(std::ptr::null_mut(), t);
            DestroyWindow(h);
        });
        let h = rx.recv().unwrap() as windows_sys::Win32::Foundation::HWND;
        assert!(!h.is_null(), "no frame window: {}", std::io::Error::last_os_error());
        std::thread::sleep(std::time::Duration::from_millis(300));
        unsafe {
            let ex = GetWindowLongW(h, GWL_EXSTYLE) as u32;
            let mut aff = 0u32;
            GetWindowDisplayAffinity(h, &mut aff);
            let hit = WindowFromPoint(windows_sys::Win32::Foundation::POINT { x: s.left + 2, y: s.top + s.height / 2 });
            eprintln!("visible={} ex={:#x} affinity={:#x} hit_is_frame={}", IsWindowVisible(h), ex, aff, hit == h);
            assert!(IsWindowVisible(h) != 0);
            assert!(ex & WS_EX_TRANSPARENT != 0 && ex & WS_EX_LAYERED != 0 && ex & WS_EX_TOPMOST != 0);
            assert_ne!(hit, h);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scr(left: i32, top: i32, width: i32, height: i32, primary: bool) -> Screen {
        Screen { left, top, width, height, work_left: left, work_top: top, work_width: width, work_height: height - 48, primary }
    }

    #[test]
    fn picks_the_screen_by_its_shape() {
        let a = scr(0, 0, 1920, 1080, true);
        let b = scr(1920, 0, 2560, 1440, false);
        let c = scr(-1280, 0, 1280, 1024, false);
        let all = [a, b, c];
        assert_eq!(matching_screens(&all, 1920, 1080), vec![a, b]); // exact first, same shape next
        assert_eq!(matching_screens(&all, 2560, 1440)[0], b);
        assert_eq!(matching_screens(&all, 1280, 1024), vec![c]);
        // A single window (another shape) is none of them.
        assert!(matching_screens(&all, 1200, 700).is_empty());
        // A maximised window (screen minus taskbar) isn't the screen either.
        assert!(matching_screens(&[a], 1920, 1032).is_empty());
        // A 5K screen shared scaled down to 4K still matches.
        let big = scr(0, 0, 5120, 2880, true);
        assert_eq!(matching_screens(&[big], 3840, 2160), vec![big]);
        // Size unknown: every screen, main one first.
        assert_eq!(matching_screens(&[b, a], 0, 0), vec![a, b]);
        // Two identical screens: the main one first.
        let d = scr(1920, 0, 1920, 1080, false);
        assert_eq!(matching_screens(&[d, a], 1920, 1080), vec![a, d]);
    }

    #[test]
    fn positions_map_to_pixels_and_windows_units() {
        let s = scr(1920, 0, 2560, 1440, false);
        assert_eq!(to_pixel(&s, 0.0, 0.0), (1920, 0));
        assert_eq!(to_pixel(&s, 1.0, 1.0), (1920 + 2559, 1439));
        assert_eq!(to_pixel(&s, 0.5, 0.5), (1920 + 1280, 720));
        // Out-of-range and broken numbers stay on the screen.
        assert_eq!(to_pixel(&s, -3.0, 9.0), (1920, 1439));
        assert_eq!(to_pixel(&s, f64::NAN, f64::INFINITY), (1920 + 1280, 720));
        // Desktop of two screens, one left of the main one.
        let desk = (-1280, 0, 1280 + 1920, 1080);
        assert_eq!(to_absolute(-1280, 0, desk), (0, 0));
        let (ax, _) = to_absolute(1919, 1079, desk);
        assert_eq!(ax, 65516); // last pixel, rounded up
        // Windows turns units back into pixels as floor(u * width / 65536).
        for p in [-1280, -1, 0, 1, 640, 1919] {
            let (ax, _) = to_absolute(p, 0, desk);
            assert_eq!(-1280 + (ax as i64 * 3200 / 65536) as i32, p);
        }
    }

    #[test]
    fn only_real_movement_of_this_pcs_mouse_counts() {
        // A few pixels of jitter don't count; a real move within 0.2 s does.
        let (sum, since, real) = physical_move(0, 0, 1000, 3);
        assert_eq!((sum, since, real), (3, 1000, false));
        let (sum, since, real) = physical_move(sum, since, 1100, 3);
        assert!(!real);
        let (sum, since, real) = physical_move(sum, since, 1150, 3);
        assert!(real && sum == 9 && since == 1000);
        // Movements far apart don't add up.
        let (sum, since, real) = physical_move(9, 1000, 1300, 3);
        assert_eq!((sum, since, real), (3, 1300, false));
    }

    #[test]
    fn keys_map_by_place() {
        assert_eq!(scan_code("KeyA"), Some((0x1E, false)));
        assert_eq!(scan_code("KeyQ"), Some((0x10, false)));
        assert_eq!(scan_code("KeyM"), Some((0x32, false)));
        assert_eq!(scan_code("KeyL"), Some(KEY_L));
        assert_eq!(scan_code("Digit1"), Some((0x02, false)));
        assert_eq!(scan_code("Digit0"), Some((0x0B, false)));
        assert_eq!(scan_code("F1"), Some((0x3B, false)));
        assert_eq!(scan_code("F10"), Some((0x44, false)));
        assert_eq!(scan_code("F12"), Some((0x58, false)));
        assert_eq!(scan_code("ArrowLeft"), Some((0x4B, true)));
        assert_eq!(scan_code("MetaLeft"), Some((0x5B, true)));
        assert_eq!(scan_code("Enter"), Some((0x1C, false)));
        assert_eq!(scan_code("NumpadEnter"), Some((0x1C, true)));
        for bad in ["", "Key", "KeyAA", "Digit10", "F13", "Fn", "Pause", "<script>"] {
            assert_eq!(scan_code(bad), None, "{bad}");
        }
        // Every letter and digit has its own code.
        let mut seen = std::collections::HashSet::new();
        for c in 'A'..='Z' {
            assert!(seen.insert(scan_code(&format!("Key{c}")).unwrap()), "{c}");
        }
        for d in 0..=9 {
            assert!(seen.insert(scan_code(&format!("Digit{d}")).unwrap()), "{d}");
        }
    }

    // (One test for the session: it is shared, process-wide state.)
    #[test]
    fn session_rules() {
        let call = "call-1";
        let mv = InputEvent::Move { x: 0.5, y: 0.5 };
        // Nothing is allowed before Allow.
        assert!(input(call, std::slice::from_ref(&mv)).is_err());
        let s = scr(0, 0, 1920, 1080, true);
        *SESSION.lock() = Some(Session {
            call_id: call.into(),
            peer_name: "Bharat".into(),
            screens: vec![s],
            current: 0,
            keys: Vec::new(),
            buttons: 0,
            last: None,
            placed: None,
            blocked_at: 0,
        });
        take_dry_log();
        // Another call can't use this permission.
        assert!(input("call-2", std::slice::from_ref(&mv)).is_err());
        let key = |c: &str, down| InputEvent::Key { code: c.into(), down };
        input(
            call,
            &[
                mv.clone(),
                InputEvent::Button { b: 0, down: true },
                InputEvent::Button { b: 0, down: true }, // a repeat is ignored
                InputEvent::Button { b: 0, down: false },
                InputEvent::Button { b: 2, down: false }, // never pressed: ignored
                InputEvent::Wheel { dx: 0, dy: -120 },
                key("ShiftLeft", true),
                key("KeyA", true),
                key("KeyA", false),
                key("Nope", true),
                key("MetaLeft", true),
                key("KeyL", true), // Windows + L would lock them out
                key("KeyL", false),
                InputEvent::Combo { codes: vec!["MetaLeft".into(), "KeyL".into()] },
                InputEvent::Combo { codes: vec!["MetaLeft".into(), "KeyD".into()] },
                InputEvent::Combo { codes: vec!["MetaLeft".into(), "Bogus".into()] },
            ],
        )
        .unwrap();
        assert_eq!(
            take_dry_log(),
            vec![
                "move 960,540",
                "button 0 down",
                "button 0 up",
                "wheel 0,-120",
                "key ShiftLeft down",
                "key KeyA down",
                "key KeyA up",
                "key MetaLeft down",
                "combo MetaLeft+KeyD",
            ]
        );
        // Their own mouse wins: the colleague's pointer waits, key-ups still pass.
        LOCAL_MOUSE_MS.store(clock(), Ordering::SeqCst);
        input(call, &[mv.clone(), InputEvent::Button { b: 0, down: true }, key("ShiftLeft", false)]).unwrap();
        assert_eq!(take_dry_log(), vec!["key ShiftLeft up"]);
        // They moved while waiting: once this PC's mouse rests, their click
        // happens where they now point (not where the pointer was left).
        input(call, &[InputEvent::Move { x: 0.25, y: 0.25 }]).unwrap();
        assert!(take_dry_log().is_empty(), "still waiting");
        LOCAL_MOUSE_MS.store(0, Ordering::SeqCst);
        input(call, &[InputEvent::Button { b: 0, down: true }, InputEvent::Button { b: 0, down: false }]).unwrap();
        assert_eq!(take_dry_log(), vec!["move 480,270", "button 0 down", "button 0 up"]);
        // Windows refusing their input is reported (an admin program in front).
        assert!(!input(call, &[key("KeyA", true), key("KeyA", false)]).unwrap().blocked);
        test_block(true);
        assert!(input(call, &[key("KeyA", true), key("KeyA", false)]).unwrap().blocked);
        assert!(info().blocked);
        test_block(false);
        take_dry_log();
        // Too much at once is refused.
        assert!(input(call, &vec![mv.clone(); MAX_EVENTS + 1]).is_err());
        // Stop lets go of everything still held (Windows key here).
        let ended = stop("stopped").unwrap();
        assert_eq!(ended.reason.as_deref(), Some("stopped"));
        assert_eq!(take_dry_log(), vec!["key release up"]);
        assert!(input(call, &[mv]).is_err());
        assert!(!info().active);
        // The pretend clipboard (test copies never use the real one).
        let before = clipboard_seq();
        let seq = write_clipboard("hello").unwrap();
        assert!(seq > before);
        assert_eq!(read_clipboard().as_deref(), Some("hello"));
        assert!(test_copy("from me") > seq);
        assert_eq!(read_clipboard().as_deref(), Some("from me"));

        // LANX 3.7.0: hands drive this PC (here in the same test: the log is shared).
        take_dry_log();
        let ops: Vec<HandInput> = serde_json::from_str(
            r#"[{"op":"move","x":0.5,"y":0.5},{"op":"button","button":0,"down":true},{"op":"button","button":0,"down":false},
                {"op":"wheel","dx":0,"dy":-240},{"op":"key","code":"Enter","down":true},{"op":"key","code":"Enter","down":false},{"op":"text","text":"hi 👋"}]"#,
        )
        .unwrap();
        hand_input(99, &ops).unwrap();
        let log = take_dry_log();
        assert_eq!(log.len(), 7, "{log:?}");
        assert!(log[0].starts_with("move "));
        assert_eq!(&log[1..], ["button 0 down", "button 0 up", "wheel 0,-240", "key Enter down", "key Enter up", "text hi 👋"]);
        // 3.7.1: gliding and smooth scrolling (test copies write them down straight away).
        let ops: Vec<HandInput> = serde_json::from_str(r#"[{"op":"aim","x":0.0,"y":0.0},{"op":"scroll","dx":0,"dy":-90}]"#).unwrap();
        hand_input(99, &ops).unwrap();
        let log = take_dry_log();
        assert!(log.len() == 2 && log[0].starts_with("aim ") && log[1] == "wheel 0,-90", "{log:?}");
        // Unknown keys and buttons, and too much text, are refused before anything happens.
        assert!(hand_input(0, &[HandInput::Key { code: "<script>".into(), down: true }]).is_err());
        assert!(hand_input(0, &[HandInput::Button { button: 7, down: true }]).is_err());
        assert!(hand_input(0, &[HandInput::Text { text: "x".repeat(MAX_HAND_TEXT + 1) }]).is_err());
        assert!(take_dry_log().is_empty());
        lock_pc().unwrap();
        assert_eq!(take_dry_log(), vec!["lock"]);
    }
}
