//! LANX 3.13.1 (Linux): LANX draws with the graphics chip where that is safe.
//!
//! Until now LANX told its web engine (WebKitGTK) never to use its normal drawing path
//! (`WEBKIT_DISABLE_DMABUF_RENDERER=1`), because that path shows a blank window on some
//! PCs (NVIDIA's own driver, virtual machines). With today's WebKitGTK that switch turns
//! the graphics chip off altogether (webkit://gpu says "Policy: never"): every frame is
//! painted by the processor, and on an office PC LANX stutters and seems to hang. Now:
//!
//! - an ordinary PC (Intel or AMD graphics with the system's own driver) uses the chip;
//! - PCs where that is known to go wrong keep the careful way: NVIDIA's own driver,
//!   virtual machines, graphics drivers LANX doesn't know, no graphics driver at all;
//! - if LANX dies while starting with the chip, the next start is careful, and stays so
//!   for that LANX version (after a second time: for good);
//! - `lanx --safe-graphics` / `--fast-graphics` / `--auto-graphics` choose by hand and are
//!   remembered (the app icon's right-click menu has them), and a `WEBKIT_…` variable
//!   someone set by hand is always left alone.
//!
//! The choice is a plain function of a few facts (`decide`), so it is tested without a PC.

use std::path::{Path, PathBuf};

/// How LANX's window is drawn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// The web engine's normal way: the graphics chip does the drawing.
    Fast,
    /// The careful way: the processor paints every frame (works everywhere, slower).
    Safe,
}

/// A choice given on the command line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Arg {
    Fast,
    Safe,
    /// Forget what was chosen or noticed before: let LANX choose again.
    Auto,
}

/// What `graphics.txt` (next to LANX's data) remembers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Saved {
    ByHand(Mode),
    /// LANX died while starting with the chip, `times` time(s), last with LANX `version`.
    Failed { times: u32, version: String },
}

impl Saved {
    pub fn parse(text: &str) -> Option<Saved> {
        let mut it = text.split_whitespace();
        match it.next()? {
            "fast" => Some(Saved::ByHand(Mode::Fast)),
            "safe" => Some(Saved::ByHand(Mode::Safe)),
            "failed" => Some(Saved::Failed { times: it.next()?.parse().ok()?, version: it.next()?.to_string() }),
            _ => None,
        }
    }

    pub fn text(&self) -> String {
        match self {
            Saved::ByHand(Mode::Fast) => "fast".into(),
            Saved::ByHand(Mode::Safe) => "safe".into(),
            Saved::Failed { times, version } => format!("failed {times} {version}"),
        }
    }
}

/// What the choice depends on.
#[derive(Debug, Clone, Default)]
pub struct Facts {
    /// A drawing variable someone set by hand (its value), if any.
    pub env: Option<String>,
    pub arg: Option<Arg>,
    pub saved: Option<Saved>,
    /// The last start with the chip died before it had settled.
    pub failed_start: bool,
    pub nvidia: bool,
    pub virtual_machine: bool,
    /// The kernel drivers of this PC's graphics chips (those programs can draw with).
    pub drivers: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Decision {
    pub mode: Mode,
    /// In plain words, for the start-up log and Settings.
    pub why: String,
    /// Tell the web engine to stay off the chip (never when a variable was set by hand).
    pub set_switch: bool,
    /// `None`: leave graphics.txt alone; `Some(None)`: forget it; `Some(Some(x))`: write x.
    pub remember: Option<Option<Saved>>,
}

/// The system's own drivers for Intel and AMD graphics: what every Linux desktop is tested on.
const KNOWN_GOOD: [&str; 4] = ["i915", "xe", "amdgpu", "radeon"];

fn suitable(f: &Facts) -> Result<(), String> {
    if f.virtual_machine {
        return Err("this is a virtual machine".into());
    }
    if f.nvidia {
        return Err("NVIDIA's own graphics driver".into());
    }
    if f.drivers.is_empty() {
        return Err("no graphics chip LANX can draw with".into());
    }
    if let Some(other) = f.drivers.iter().find(|d| !KNOWN_GOOD.contains(&d.as_str())) {
        return Err(format!("the graphics driver \"{other}\""));
    }
    Ok(())
}

pub fn decide(f: &Facts, version: &str) -> Decision {
    let d = |mode: Mode, why: String, remember| Decision { mode, why, set_switch: mode == Mode::Safe, remember };
    if let Some(value) = &f.env {
        let mode = if value == "0" { Mode::Fast } else { Mode::Safe };
        return Decision { mode, why: "a WEBKIT_… variable set by hand".into(), set_switch: false, remember: None };
    }
    match f.arg {
        Some(Arg::Fast) => return d(Mode::Fast, "chosen by hand".into(), Some(Some(Saved::ByHand(Mode::Fast)))),
        Some(Arg::Safe) => return d(Mode::Safe, "chosen by hand".into(), Some(Some(Saved::ByHand(Mode::Safe)))),
        Some(Arg::Auto) | None => {}
    }
    let auto = f.arg == Some(Arg::Auto);
    let saved = if auto { None } else { f.saved.clone() };
    let forget = if auto && f.saved.is_some() { Some(None) } else { None };
    let failed = |times: u32| Some(Some(Saved::Failed { times, version: version.to_string() }));
    match &saved {
        Some(Saved::ByHand(Mode::Fast)) if f.failed_start => {
            // Chosen by hand, but LANX didn't come up: never leave LANX unable to open.
            return d(Mode::Safe, "the graphics chip failed when LANX started".into(), failed(2));
        }
        Some(Saved::ByHand(mode)) => return d(*mode, "chosen by hand".into(), None),
        _ => {}
    }
    if let Err(why) = suitable(f) {
        return d(Mode::Safe, why, forget);
    }
    let before = match &saved {
        Some(Saved::Failed { times, .. }) => *times,
        _ => 0,
    };
    if f.failed_start {
        return d(Mode::Safe, "the graphics chip failed when LANX started".into(), failed(before + 1));
    }
    if let Some(Saved::Failed { times, version: at }) = &saved {
        // Once: careful for that LANX version (a newer LANX tries the chip again). Twice: for good.
        if *times >= 2 || at == version {
            return d(Mode::Safe, "the graphics chip failed when LANX started".into(), None);
        }
    }
    d(Mode::Fast, format!("{} graphics", f.drivers.join(" + ")), forget)
}

fn saved_file(data_dir: &Path) -> PathBuf {
    data_dir.join("graphics.txt")
}

/// "A start with the chip is under way" (holds that LANX's process number).
fn mark_file(data_dir: &Path) -> PathBuf {
    data_dir.join("graphics.trying")
}

#[cfg(target_os = "linux")]
mod live {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::OnceLock;
    use std::time::{Duration, Instant};

    /// A start that has run this long with the chip has settled (crashes at start take seconds).
    const SETTLE_MS: u64 = 40_000;

    static CHOSEN: OnceLock<(Mode, String, bool, PathBuf)> = OnceLock::new();
    static WATCHING: AtomicBool = AtomicBool::new(false);
    static UNTIL: AtomicU64 = AtomicU64::new(0);
    static SHOWN: AtomicBool = AtomicBool::new(false);

    /// Milliseconds on a clock that only runs forward. (The PC's date and time can be set
    /// back while LANX runs — a PC that also has Windows often corrects its clock by hours
    /// just after it starts — and that must not keep a start "under way" for hours.)
    fn now_ms() -> u64 {
        static FIRST: OnceLock<Instant> = OnceLock::new();
        FIRST.get_or_init(Instant::now).elapsed().as_millis() as u64
    }

    fn gather(data_dir: &Path) -> (Facts, bool) {
        let var = |k: &str| std::env::var(k).ok();
        let env = match var("WEBKIT_DISABLE_COMPOSITING_MODE") {
            Some(v) if v != "0" => Some(v),
            _ => var("WEBKIT_DISABLE_DMABUF_RENDERER"),
        };
        let args: Vec<String> = std::env::args().skip(1).collect();
        let has = |name: &str| args.iter().any(|a| a == name);
        let arg = if has("--safe-graphics") {
            Some(Arg::Safe)
        } else if has("--fast-graphics") {
            Some(Arg::Fast)
        } else if has("--auto-graphics") {
            Some(Arg::Auto)
        } else {
            None
        };
        let saved = std::fs::read_to_string(saved_file(data_dir)).ok().and_then(|t| Saved::parse(&t));
        let me = std::process::id();
        let running = |pid: u32| pid != me && crate::start_guard::is_my_lanx(pid);
        let marked = std::fs::read_to_string(mark_file(data_dir)).ok().and_then(|t| t.trim().parse::<u32>().ok());
        let other_copy = marked.is_some_and(running) || crate::start_guard::read_beat(data_dir).is_some_and(|(pid, _)| running(pid));
        let failed_start = marked.is_some_and(|pid| pid != me && !running(pid));
        let virtual_machine = std::fs::read_to_string("/proc/cpuinfo")
            .map(|t| t.lines().any(|l| l.starts_with("flags") && l.split_whitespace().any(|w| w == "hypervisor")))
            .unwrap_or(false);
        let mut drivers: Vec<String> = Vec::new();
        if let Ok(dir) = std::fs::read_dir("/sys/class/drm") {
            for entry in dir.flatten() {
                if !entry.file_name().to_string_lossy().starts_with("renderD") {
                    continue;
                }
                if let Some(name) = std::fs::read_link(entry.path().join("device/driver")).ok().and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_string())) {
                    if !drivers.contains(&name) {
                        drivers.push(name);
                    }
                }
            }
        }
        drivers.sort();
        let mut facts = Facts { env, arg, saved, failed_start, nvidia: Path::new("/proc/driver/nvidia/version").exists(), virtual_machine, drivers };
        // Test copies only (needs LANX_PROFILE): pretend this is a real PC with these drivers.
        if let Some(pretend) = crate::testmode::graphics_drivers() {
            facts.drivers = pretend;
            facts.virtual_machine = false;
            facts.nvidia = false;
        }
        (facts, other_copy)
    }

    /// First thing at start, before any other thread exists: chooses how the window is drawn
    /// and sets the web engine's switch for it. Returns a line for the start-up log.
    pub fn choose(data_dir: &Path, version: &str) -> String {
        let (facts, other_copy) = gather(data_dir);
        let d = decide(&facts, version);
        if d.set_switch {
            // SAFETY: no other thread exists yet (the caller's promise; nothing above starts one).
            unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") };
        }
        if facts.failed_start {
            let _ = std::fs::remove_file(mark_file(data_dir));
        }
        match &d.remember {
            Some(Some(saved)) => {
                let _ = std::fs::create_dir_all(data_dir);
                let _ = std::fs::write(saved_file(data_dir), saved.text());
            }
            Some(None) => {
                let _ = std::fs::remove_file(saved_file(data_dir));
            }
            None => {}
        }
        // A second launch only asks the running LANX to show itself and goes: it must not
        // leave a "start under way" mark behind. ("Restart LANX" replaces the running one.)
        let staying = !other_copy || std::env::args().any(|a| a == "--restart");
        let watch = d.mode == Mode::Fast && facts.env.is_none();
        let _ = CHOSEN.set((d.mode, d.why.clone(), watch, data_dir.to_path_buf()));
        if watch && staying {
            arm();
        }
        format!(
            "graphics: {} ({}) — drivers {:?}, nvidia {}, virtual machine {}, remembered {:?}",
            if d.mode == Mode::Fast { "the graphics chip" } else { "careful, without the chip" },
            d.why,
            facts.drivers,
            facts.nvidia,
            facts.virtual_machine,
            facts.saved.as_ref().map(|s| s.text())
        )
    }

    /// Leaves the "start under way" mark and takes it away once the start has settled.
    fn arm() {
        let Some((_, _, true, data_dir)) = CHOSEN.get() else { return };
        let _ = std::fs::create_dir_all(data_dir);
        let _ = std::fs::write(mark_file(data_dir), std::process::id().to_string());
        UNTIL.store(now_ms() + SETTLE_MS, Ordering::SeqCst);
        if WATCHING.swap(true, Ordering::SeqCst) {
            return;
        }
        let _ = std::thread::Builder::new().name("lanx-graphics".into()).spawn(|| {
            while now_ms() < UNTIL.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_secs(1));
            }
            WATCHING.store(false, Ordering::SeqCst);
            settle(SHOWN.load(Ordering::SeqCst));
        });
    }

    /// The start went well (or LANX is leaving on purpose): the mark goes; and once the
    /// window has really been on screen with the chip, an old failure is forgotten.
    fn settle(proved: bool) {
        let Some((_, _, _, data_dir)) = CHOSEN.get() else { return };
        let mark = mark_file(data_dir);
        if std::fs::read_to_string(&mark).ok().and_then(|t| t.trim().parse::<u32>().ok()) == Some(std::process::id()) {
            let _ = std::fs::remove_file(&mark);
        }
        if proved && matches!(std::fs::read_to_string(saved_file(data_dir)).ok().and_then(|t| Saved::parse(&t)), Some(Saved::Failed { .. })) {
            let _ = std::fs::remove_file(saved_file(data_dir));
        }
    }

    /// LANX's window is shown for the first time: that is when the chip really starts to draw
    /// (a LANX started hidden in the tray may get here hours after it started).
    pub fn shown() {
        if !SHOWN.swap(true, Ordering::SeqCst) {
            arm();
        }
    }

    /// LANX is closing on purpose: that is not a failed start.
    pub fn leaving() {
        settle(false);
    }

    /// For Settings → Diagnostics.
    pub fn summary() -> String {
        match CHOSEN.get() {
            Some((Mode::Fast, why, _, _)) => format!("Uses the graphics chip ({why})"),
            Some((Mode::Safe, why, _, _)) => format!("Careful drawing, without the graphics chip ({why})"),
            None => String::new(),
        }
    }
}

#[cfg(target_os = "linux")]
pub use live::{choose, leaving, shown, summary};

/// Only Linux chooses; elsewhere there is nothing to say.
#[cfg(not(target_os = "linux"))]
pub fn summary() -> String {
    String::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn intel() -> Facts {
        Facts { drivers: vec!["i915".into()], ..Facts::default() }
    }

    #[test]
    fn an_ordinary_pc_uses_the_chip() {
        let d = decide(&intel(), "3.13.1");
        assert_eq!(d.mode, Mode::Fast);
        assert!(!d.set_switch);
        assert_eq!(d.remember, None);
        assert_eq!(decide(&Facts { drivers: vec!["amdgpu".into()], ..Facts::default() }, "3.13.1").mode, Mode::Fast);
        assert_eq!(decide(&Facts { drivers: vec!["amdgpu".into(), "i915".into()], ..Facts::default() }, "3.13.1").mode, Mode::Fast);
    }

    #[test]
    fn risky_pcs_stay_careful() {
        for f in [
            Facts { nvidia: true, drivers: vec!["nvidia".into()], ..Facts::default() },
            Facts { nvidia: true, drivers: vec!["i915".into()], ..Facts::default() },
            Facts { virtual_machine: true, drivers: vec!["i915".into()], ..Facts::default() },
            Facts { drivers: vec![], ..Facts::default() },
            Facts { drivers: vec!["nouveau".into()], ..Facts::default() },
            Facts { drivers: vec!["i915".into(), "nouveau".into()], ..Facts::default() },
            Facts { drivers: vec!["vmwgfx".into()], ..Facts::default() },
            Facts { drivers: vec!["virtio_gpu".into()], ..Facts::default() },
        ] {
            let d = decide(&f, "3.13.1");
            assert_eq!(d.mode, Mode::Safe, "{f:?}");
            assert!(d.set_switch, "{f:?}");
            assert_eq!(d.remember, None, "{f:?}");
        }
    }

    #[test]
    fn a_variable_set_by_hand_is_left_alone() {
        let on = decide(&Facts { env: Some("1".into()), ..intel() }, "3.13.1");
        assert_eq!((on.mode, on.set_switch, on.remember.clone()), (Mode::Safe, false, None));
        let off = decide(&Facts { env: Some("0".into()), nvidia: true, arg: Some(Arg::Safe), ..intel() }, "3.13.1");
        assert_eq!((off.mode, off.set_switch, off.remember), (Mode::Fast, false, None));
    }

    #[test]
    fn a_choice_by_hand_is_remembered_and_wins() {
        let safe = decide(&Facts { arg: Some(Arg::Safe), ..intel() }, "3.13.1");
        assert_eq!((safe.mode, safe.remember), (Mode::Safe, Some(Some(Saved::ByHand(Mode::Safe)))));
        // remembered: careful even on a good PC; the chip even on a risky one
        assert_eq!(decide(&Facts { saved: Some(Saved::ByHand(Mode::Safe)), ..intel() }, "3.13.1").mode, Mode::Safe);
        let fast = decide(&Facts { arg: Some(Arg::Fast), nvidia: true, ..Facts::default() }, "3.13.1");
        assert_eq!((fast.mode, fast.remember), (Mode::Fast, Some(Some(Saved::ByHand(Mode::Fast)))));
        assert_eq!(decide(&Facts { saved: Some(Saved::ByHand(Mode::Fast)), nvidia: true, ..Facts::default() }, "3.13.1").mode, Mode::Fast);
        // "choose again" forgets it
        let auto = decide(&Facts { arg: Some(Arg::Auto), saved: Some(Saved::ByHand(Mode::Safe)), ..intel() }, "3.13.1");
        assert_eq!((auto.mode, auto.remember), (Mode::Fast, Some(None)));
        let auto = decide(&Facts { arg: Some(Arg::Auto), saved: Some(Saved::ByHand(Mode::Fast)), nvidia: true, ..Facts::default() }, "3.13.1");
        assert_eq!((auto.mode, auto.remember), (Mode::Safe, Some(None)));
    }

    #[test]
    fn a_failed_start_makes_the_next_one_careful() {
        // first time: careful for this LANX version
        let first = decide(&Facts { failed_start: true, ..intel() }, "3.13.1");
        assert_eq!(first.mode, Mode::Safe);
        let once = Saved::Failed { times: 1, version: "3.13.1".into() };
        assert_eq!(first.remember, Some(Some(once.clone())));
        assert_eq!(decide(&Facts { saved: Some(once.clone()), ..intel() }, "3.13.1").mode, Mode::Safe);
        // a newer LANX tries the chip once more…
        let newer = decide(&Facts { saved: Some(once.clone()), ..intel() }, "3.14.0");
        assert_eq!((newer.mode, newer.remember), (Mode::Fast, None));
        // …and if that fails too, LANX stays careful for good
        let second = decide(&Facts { saved: Some(once), failed_start: true, ..intel() }, "3.14.0");
        let twice = Saved::Failed { times: 2, version: "3.14.0".into() };
        assert_eq!((second.mode, second.remember), (Mode::Safe, Some(Some(twice.clone()))));
        assert_eq!(decide(&Facts { saved: Some(twice), ..intel() }, "3.15.0").mode, Mode::Safe);
    }

    #[test]
    fn the_chip_chosen_by_hand_never_keeps_lanx_from_opening() {
        let d = decide(&Facts { saved: Some(Saved::ByHand(Mode::Fast)), failed_start: true, ..intel() }, "3.13.1");
        assert_eq!(d.mode, Mode::Safe);
        assert_eq!(d.remember, Some(Some(Saved::Failed { times: 2, version: "3.13.1".into() })));
        // asked for again on the command line: tried again
        let again = decide(&Facts { arg: Some(Arg::Fast), saved: Some(Saved::Failed { times: 2, version: "3.13.1".into() }), failed_start: true, ..intel() }, "3.13.1");
        assert_eq!(again.mode, Mode::Fast);
    }

    #[test]
    fn what_is_remembered_reads_back() {
        for s in [Saved::ByHand(Mode::Fast), Saved::ByHand(Mode::Safe), Saved::Failed { times: 2, version: "3.13.1".into() }] {
            assert_eq!(Saved::parse(&s.text()), Some(s));
        }
        assert_eq!(Saved::parse(""), None);
        assert_eq!(Saved::parse("failed x 3.13.1"), None);
        assert_eq!(Saved::parse("something else"), None);
    }
}
