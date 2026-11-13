//! LANX 3.12.0: hands drive the whole PC on Linux — X11 sessions (Linux Mint's
//! Cinnamon, Ubuntu on Xorg, Xfce, MATE…). The real mouse and keyboard go through
//! XTest, the screens come from RandR, and other programs' windows are resized by
//! asking the window manager (EWMH), as panels and pagers do.
//!
//! Wayland sessions don't let any program move the pointer or other windows, so
//! there this stays off and says why.

use crate::remote::Screen;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::OnceLock;
use x11rb::connection::Connection;
use x11rb::protocol::randr::ConnectionExt as _;
use x11rb::protocol::xproto::{self, AtomEnum, ClientMessageEvent, ConnectionExt as _, EventMask, Window};
use x11rb::protocol::xtest::ConnectionExt as _;
use x11rb::rust_connection::RustConnection;

pub const WAYLAND_NOTE: &str = "Controlling the whole PC on Linux needs an X11 session — Linux Mint uses one already; on Ubuntu, pick “Ubuntu on Xorg” at the login screen.";

pub struct X {
    conn: RustConnection,
    root: Window,
    min_kc: u8,
    /// Keysyms per keycode, and the whole table (min_kc first).
    per: usize,
    map: Vec<u32>,
    /// A key with nothing on it, borrowed to type characters the layout lacks.
    spare: Option<u8>,
    atoms: HashMap<&'static str, u32>,
    /// Wheel units not yet sent (X turns the wheel a whole notch at a time).
    wheel: (i32, i32),
}

static X: OnceLock<Option<Mutex<X>>> = OnceLock::new();

/// A Wayland desktop (no program may drive the mouse there).
pub fn wayland() -> bool {
    std::env::var("XDG_SESSION_TYPE").map(|v| v.eq_ignore_ascii_case("wayland")).unwrap_or(false)
        || (std::env::var_os("WAYLAND_DISPLAY").is_some() && std::env::var_os("DISPLAY").is_none())
}

fn x() -> Option<&'static Mutex<X>> {
    X.get_or_init(|| {
        if wayland() {
            return None;
        }
        let (conn, n) = x11rb::connect(None).ok()?;
        let (root, min_kc) = {
            let setup = conn.setup();
            (setup.roots.get(n)?.root, setup.min_keycode)
        };
        // XTest is what lets a program press keys and move the pointer.
        conn.xtest_get_version(2, 2).ok()?.reply().ok()?;
        let mut x = X { conn, root, min_kc, per: 0, map: Vec::new(), spare: None, atoms: HashMap::new(), wheel: (0, 0) };
        x.load_map();
        Some(Mutex::new(x))
    })
    .as_ref()
}

/// Can hands drive this PC (an X11 desktop with XTest)?
pub fn available() -> bool {
    x().is_some()
}

impl X {
    fn load_map(&mut self) {
        let max_kc = self.conn.setup().max_keycode;
        let count = max_kc.saturating_sub(self.min_kc).saturating_add(1);
        if let Ok(Ok(r)) = self.conn.get_keyboard_mapping(self.min_kc, count).map(|c| c.reply()) {
            self.per = r.keysyms_per_keycode.max(1) as usize;
            self.map = r.keysyms;
            // The highest key with nothing on it.
            self.spare = (0..count as usize)
                .rev()
                .find(|&i| self.map[i * self.per..(i + 1) * self.per].iter().all(|&k| k == 0))
                .map(|i| self.min_kc + i as u8);
        }
    }

    fn atom(&mut self, name: &'static str) -> u32 {
        if let Some(a) = self.atoms.get(name) {
            return *a;
        }
        let a = self.conn.intern_atom(false, name.as_bytes()).ok().and_then(|c| c.reply().ok()).map(|r| r.atom).unwrap_or(0);
        self.atoms.insert(name, a);
        a
    }

    fn fake(&self, kind: u8, detail: u8, x: i16, y: i16) -> bool {
        self.conn.xtest_fake_input(kind, detail, x11rb::CURRENT_TIME, self.root, x, y, 0).is_ok()
    }

    fn flush(&self) -> bool {
        self.conn.flush().is_ok()
    }

    fn u32s(&mut self, win: Window, prop: &'static str) -> Vec<u32> {
        let atom = self.atom(prop);
        self.conn
            .get_property(false, win, atom, AtomEnum::ANY, 0, 4096)
            .ok()
            .and_then(|c| c.reply().ok())
            .and_then(|r| r.value32().map(|v| v.collect()))
            .unwrap_or_default()
    }

    fn text_prop(&mut self, win: Window) -> String {
        let (utf8, name) = (self.atom("UTF8_STRING"), self.atom("_NET_WM_NAME"));
        let get = |p: u32, t: u32| self.conn.get_property(false, win, p, t, 0, 1024).ok().and_then(|c| c.reply().ok()).map(|r| String::from_utf8_lossy(&r.value).into_owned());
        get(name, utf8).filter(|s| !s.is_empty()).or_else(|| get(AtomEnum::WM_NAME.into(), AtomEnum::ANY.into())).unwrap_or_default()
    }

    /// Asks the window manager (as a pager would).
    fn tell_wm(&mut self, win: Window, what: &'static str, data: [u32; 5]) -> bool {
        let t = self.atom(what);
        let ev = ClientMessageEvent::new(32, win, t, data);
        self.conn.send_event(false, self.root, EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY, ev).is_ok() && self.flush()
    }
}

// ------------------------------------------------------------------ screens

pub fn screens() -> Vec<Screen> {
    let Some(m) = x() else { return Vec::new() };
    let mut x = m.lock();
    let root = x.root;
    let work = x.u32s(root, "_NET_WORKAREA");
    let wa = (work.len() >= 4).then(|| (work[0] as i32, work[1] as i32, work[2] as i32, work[3] as i32));
    let mut out = Vec::new();
    if let Ok(Ok(r)) = x.conn.randr_get_monitors(root, true).map(|c| c.reply()) {
        for mon in r.monitors {
            let (l, t, w, h) = (mon.x as i32, mon.y as i32, mon.width as i32, mon.height as i32);
            // The usable part: the screen, less the panels the work area leaves out.
            let (wl, wt, ww, wh) = match wa {
                Some((ax, ay, aw, ah)) => {
                    let (x0, y0) = (l.max(ax), t.max(ay));
                    let (x1, y1) = ((l + w).min(ax + aw), (t + h).min(ay + ah));
                    if x1 > x0 && y1 > y0 { (x0, y0, x1 - x0, y1 - y0) } else { (l, t, w, h) }
                }
                None => (l, t, w, h),
            };
            out.push(Screen { left: l, top: t, width: w, height: h, work_left: wl, work_top: wt, work_width: ww, work_height: wh, primary: mon.primary });
        }
    }
    if out.is_empty() {
        let s = &x.conn.setup().roots[0];
        let (w, h) = (s.width_in_pixels as i32, s.height_in_pixels as i32);
        let (wl, wt, ww, wh) = wa.unwrap_or((0, 0, w, h));
        out.push(Screen { left: 0, top: 0, width: w, height: h, work_left: wl, work_top: wt, work_width: ww, work_height: wh, primary: true });
    }
    if !out.iter().any(|s| s.primary) {
        out[0].primary = true;
    }
    out
}

// ------------------------------------------------------------------ mouse and keys

pub fn move_to(px: i32, py: i32) -> bool {
    let Some(m) = x() else { return false };
    let x = m.lock();
    x.fake(xproto::MOTION_NOTIFY_EVENT, 0, px.clamp(-32768, 32767) as i16, py.clamp(-32768, 32767) as i16) && x.flush()
}

pub fn cursor() -> Option<(i32, i32)> {
    let x = x()?.lock();
    let r = x.conn.query_pointer(x.root).ok()?.reply().ok()?;
    Some((r.root_x as i32, r.root_y as i32))
}

/// 0 left, 1 middle, 2 right, 3 back, 4 forward.
pub fn button(b: u8, down: bool) -> bool {
    let Some(m) = x() else { return false };
    let detail = match b {
        0 => 1,
        1 => 2,
        2 => 3,
        3 => 8,
        4 => 9,
        _ => return false,
    };
    let x = m.lock();
    x.fake(if down { xproto::BUTTON_PRESS_EVENT } else { xproto::BUTTON_RELEASE_EVENT }, detail, 0, 0) && x.flush()
}

/// 120 = one notch (as on Windows); positive `dy` scrolls up, positive `dx` right.
pub fn wheel(dx: i32, dy: i32) -> bool {
    let Some(m) = x() else { return false };
    let mut x = m.lock();
    x.wheel.0 += dx;
    x.wheel.1 += dy;
    let mut ok = true;
    // X has whole notches only: buttons 4/5 (up/down) and 6/7 (left/right).
    while x.wheel.1.abs() >= 120 {
        let up = x.wheel.1 > 0;
        let b = if up { 4 } else { 5 };
        ok &= x.fake(xproto::BUTTON_PRESS_EVENT, b, 0, 0) && x.fake(xproto::BUTTON_RELEASE_EVENT, b, 0, 0);
        x.wheel.1 -= if up { 120 } else { -120 };
    }
    while x.wheel.0.abs() >= 120 {
        let right = x.wheel.0 > 0;
        let b = if right { 7 } else { 6 };
        ok &= x.fake(xproto::BUTTON_PRESS_EVENT, b, 0, 0) && x.fake(xproto::BUTTON_RELEASE_EVENT, b, 0, 0);
        x.wheel.0 -= if right { 120 } else { -120 };
    }
    ok && x.flush()
}

/// The Linux key number for a PC keyboard scan code (as Windows names keys).
pub fn evdev_of(scan: u16, ext: bool) -> Option<u16> {
    if !ext {
        return (scan > 0 && scan < 0x80).then_some(scan);
    }
    Some(match scan {
        0x1C => 96,  // keypad Enter
        0x1D => 97,  // right Ctrl
        0x35 => 98,  // keypad /
        0x37 => 99,  // Print Screen
        0x38 => 100, // right Alt
        0x45 => 69,  // Num Lock
        0x47 => 102, // Home
        0x48 => 103, // Up
        0x49 => 104, // Page Up
        0x4B => 105, // Left
        0x4D => 106, // Right
        0x4F => 107, // End
        0x50 => 108, // Down
        0x51 => 109, // Page Down
        0x52 => 110, // Insert
        0x53 => 111, // Delete
        0x5B => 125, // left Windows key
        0x5C => 126, // right Windows key
        0x5D => 127, // menu key
        _ => return None,
    })
}

pub fn key(scan: u16, ext: bool, down: bool) -> bool {
    let (Some(m), Some(ev)) = (x(), evdev_of(scan, ext)) else { return false };
    let x = m.lock();
    // X key numbers are the Linux ones plus 8.
    let kc = (ev + 8).min(255) as u8;
    x.fake(if down { xproto::KEY_PRESS_EVENT } else { xproto::KEY_RELEASE_EVENT }, kc, 0, 0) && x.flush()
}

/// The X keysym for a character.
pub fn keysym_of(c: char) -> u32 {
    let u = c as u32;
    match c {
        '\n' | '\r' => 0xff0d, // Return
        '\t' => 0xff09,        // Tab
        _ if (0x20..=0x7e).contains(&u) || (0xa0..=0xff).contains(&u) => u,
        _ => 0x0100_0000 + u,
    }
}

/// Types text as characters, whatever the keyboard layout: keys that have the
/// character are pressed (with Shift where needed); others are lent a spare key.
pub fn text(t: &str) -> bool {
    let Some(m) = x() else { return false };
    let x = m.lock();
    let shift = 50u8; // left Shift (Linux 42 + 8)
    let mut borrowed = false;
    let mut ok = true;
    for c in t.chars() {
        let ks = keysym_of(c);
        let found = x.map.iter().position(|&k| k == ks).map(|i| (x.min_kc + (i / x.per) as u8, i % x.per));
        match found {
            Some((kc, level)) if level < 2 => {
                if level == 1 {
                    ok &= x.fake(xproto::KEY_PRESS_EVENT, shift, 0, 0);
                }
                ok &= x.fake(xproto::KEY_PRESS_EVENT, kc, 0, 0) && x.fake(xproto::KEY_RELEASE_EVENT, kc, 0, 0);
                if level == 1 {
                    ok &= x.fake(xproto::KEY_RELEASE_EVENT, shift, 0, 0);
                }
            }
            _ => {
                let Some(spare) = x.spare else {
                    ok = false;
                    continue;
                };
                let per = x.per;
                let syms = vec![ks; per];
                ok &= x.conn.change_keyboard_mapping(1, spare, per as u8, &syms).is_ok() && x.flush();
                borrowed = true;
                // Programs re-read the keyboard when told it changed; give them a moment.
                std::thread::sleep(std::time::Duration::from_millis(12));
                ok &= x.fake(xproto::KEY_PRESS_EVENT, spare, 0, 0) && x.fake(xproto::KEY_RELEASE_EVENT, spare, 0, 0) && x.flush();
                std::thread::sleep(std::time::Duration::from_millis(8));
            }
        }
    }
    ok &= x.flush();
    if let (true, Some(spare)) = (borrowed, x.spare) {
        let per = x.per;
        let _ = x.conn.change_keyboard_mapping(1, spare, per as u8, &vec![0u32; per]);
        let _ = x.flush();
    }
    ok
}

// ------------------------------------------------------------------ other programs' windows

/// A window to resize: its X id, title, outer box (with its frame) and frame sizes.
pub struct XWindow {
    pub id: u32,
    pub title: String,
    pub outer: (i32, i32, i32, i32),
    /// The frame round it: left, right, top, bottom.
    pub frame: (i32, i32, i32, i32),
    pub maximised: bool,
    pub resizable: bool,
}

fn describe(x: &mut X, w: Window) -> Option<XWindow> {
    let hidden = x.atom("_NET_WM_STATE_HIDDEN");
    let (mv, mh) = (x.atom("_NET_WM_STATE_MAXIMIZED_VERT"), x.atom("_NET_WM_STATE_MAXIMIZED_HORZ"));
    let state = x.u32s(w, "_NET_WM_STATE");
    if state.contains(&hidden) {
        return None;
    }
    let types = x.u32s(w, "_NET_WM_WINDOW_TYPE");
    let bad = [x.atom("_NET_WM_WINDOW_TYPE_DESKTOP"), x.atom("_NET_WM_WINDOW_TYPE_DOCK")];
    if types.iter().any(|t| bad.contains(t)) {
        return None;
    }
    let title = x.text_prop(w);
    // LANX's own see-through hands window is never the one meant.
    if title == "LANX hands" || title == "LANX alerts" {
        return None;
    }
    let g = x.conn.get_geometry(w).ok()?.reply().ok()?;
    let at = x.conn.translate_coordinates(w, x.root, 0, 0).ok()?.reply().ok()?;
    let fe = x.u32s(w, "_NET_FRAME_EXTENTS");
    let frame = if fe.len() >= 4 { (fe[0] as i32, fe[1] as i32, fe[2] as i32, fe[3] as i32) } else { (0, 0, 0, 0) };
    let outer = (at.dst_x as i32 - frame.0, at.dst_y as i32 - frame.2, g.width as i32 + frame.0 + frame.1, g.height as i32 + frame.2 + frame.3);
    // Fixed-size windows say so in their size hints (smallest = largest).
    let hints = x.u32s(w, "WM_NORMAL_HINTS");
    let fixed = hints.len() >= 9 && hints[0] & (1 << 4) != 0 && hints[0] & (1 << 5) != 0 && hints[5] == hints[7] && hints[6] == hints[8];
    Some(XWindow { id: w, title: if title.trim().is_empty() { "this window".to_string() } else { title }, outer, frame, maximised: state.contains(&mv) && state.contains(&mh), resizable: !fixed })
}

/// The window under (px, py) — the top-most one there — else the one in front.
pub fn window_at(px: i32, py: i32) -> Result<XWindow, String> {
    let m = x().ok_or_else(|| WAYLAND_NOTE.to_string())?;
    let mut x = m.lock();
    let root = x.root;
    let mut stack = x.u32s(root, "_NET_CLIENT_LIST_STACKING");
    if stack.is_empty() {
        stack = x.u32s(root, "_NET_CLIENT_LIST");
    }
    for &w in stack.iter().rev() {
        if let Some(d) = describe(&mut x, w) {
            let (l, t, wd, ht) = d.outer;
            if px >= l && px < l + wd && py >= t && py < t + ht {
                return Ok(d);
            }
        }
    }
    let active = x.u32s(root, "_NET_ACTIVE_WINDOW");
    active.first().copied().filter(|&w| w != 0).and_then(|w| describe(&mut x, w)).ok_or_else(|| "There's no window there to resize — hold your hands up around one.".to_string())
}

/// Fills the screen with it (true) or not (false).
pub fn maximise(id: u32, on: bool) -> bool {
    let Some(m) = x() else { return false };
    let mut x = m.lock();
    let (mv, mh) = (x.atom("_NET_WM_STATE_MAXIMIZED_VERT"), x.atom("_NET_WM_STATE_MAXIMIZED_HORZ"));
    // 1 add, 0 remove; source 2 = a pager, which window managers obey.
    x.tell_wm(id, "_NET_WM_STATE", [on as u32, mv, mh, 2, 0])
}

/// Puts the window's outer box at (ox, oy) with outer size (ow, oh).
pub fn place(id: u32, frame: (i32, i32, i32, i32), ox: i32, oy: i32, ow: i32, oh: i32) -> bool {
    let Some(m) = x() else { return false };
    let mut x = m.lock();
    let (cw, ch) = ((ow - frame.0 - frame.1).max(1), (oh - frame.2 - frame.3).max(1));
    // NorthWest gravity: x, y are where the frame's top-left goes. Bits 8–11: x, y, width
    // and height are given. Bits 12–13: source 2 (a pager).
    let flags = 1u32 | (0xF << 8) | (2 << 12);
    x.tell_wm(id, "_NET_MOVERESIZE_WINDOW", [flags, ox as u32, oy as u32, cw as u32, ch as u32])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_and_characters_map_to_x() {
        assert_eq!(evdev_of(0x1E, false), Some(0x1E), "A");
        assert_eq!(evdev_of(0x48, true), Some(103), "Up");
        assert_eq!(evdev_of(0x5B, true), Some(125), "Windows key");
        assert_eq!(evdev_of(0x99, true), None);
        assert_eq!(keysym_of('a'), 0x61);
        assert_eq!(keysym_of('é'), 0xe9);
        assert_eq!(keysym_of('\n'), 0xff0d);
        assert_eq!(keysym_of('अ'), 0x0100_0905);
    }

    /// Needs an X display (run on Linux: DISPLAY=:97 cargo test -- --ignored x11_live).
    #[test]
    #[ignore]
    fn x11_live_mouse_moves_and_reads_back() {
        assert!(available(), "an X11 display with XTest");
        assert!(!screens().is_empty());
        assert!(move_to(123, 77));
        std::thread::sleep(std::time::Duration::from_millis(50));
        assert_eq!(cursor(), Some((123, 77)));
    }

    /// Needs an X display with a window manager and `xeyes -geometry 300x200+100+100` open.
    #[test]
    #[ignore]
    fn x11_live_resizes_and_fills_a_window() {
        let pause = || std::thread::sleep(std::time::Duration::from_millis(500));
        let w = window_at(200, 180).expect("a window there");
        assert!(w.title.to_lowercase().contains("xeyes"), "found “{}”", w.title);
        assert!(w.resizable && !w.maximised);
        let (ox, oy, ow, oh) = w.outer;
        assert!(place(w.id, w.frame, ox, oy, ow + 200, oh + 120));
        pause();
        let w2 = window_at(200, 180).expect("still there");
        assert!((w2.outer.2 - (ow + 200)).abs() <= 4 && (w2.outer.3 - (oh + 120)).abs() <= 4, "{:?} → {:?}", w.outer, w2.outer);
        assert!((w2.outer.0 - ox).abs() <= 4 && (w2.outer.1 - oy).abs() <= 4, "it stays where it was: {:?} → {:?}", w.outer, w2.outer);
        assert!(maximise(w.id, true));
        pause();
        let w3 = window_at(200, 180).expect("still there");
        assert!(w3.maximised, "{:?}", w3.outer);
        let s = screens()[0];
        assert!(w3.outer.2 >= s.work_width - 8 && w3.outer.3 >= s.work_height - 8, "fills the screen: {:?} vs {}x{}", w3.outer, s.work_width, s.work_height);
        assert!(maximise(w.id, false));
        pause();
        assert!(!window_at(200, 180).expect("still there").maximised);
    }

    #[test]
    #[ignore]
    fn x11_live_types_text_and_keys() {
        // (Only that X takes them; what lands where is the window manager's business.)
        assert!(text("Hello, wörld ✓"));
        assert!(key(0x1C, false, true) && key(0x1C, false, false), "Enter");
        assert!(button(0, true) && button(0, false), "a click");
        assert!(wheel(0, -240), "two notches down");
    }
}
