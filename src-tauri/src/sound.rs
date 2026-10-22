//! LANX's own sounds. The built-in sounds are synthesised once into small WAV
//! buffers; a user-chosen .wav file can replace the message sound. Playback is
//! native (winmm PlaySound) so it works while LANX is hidden in the tray.

use std::f32::consts::PI;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

pub const BUILTIN: [&str; 8] = ["chime", "soft", "ding", "pop", "bell", "ringtone", "ringback", "alarm"];

/// A ringtone is looping: short alert sounds would cut it off, so they wait.
static LOOPING: AtomicBool = AtomicBool::new(false);
const RATE: u32 = 44_100;
const MAX_CUSTOM_BYTES: u64 = 5 * 1024 * 1024;

/// One struck tone: (start s, frequency Hz, decay s, [(partial ratio, amp)]).
struct Note {
    start: f32,
    freq: f32,
    decay: f32,
    partials: &'static [(f32, f32)],
}

const WARM: &[(f32, f32)] = &[(1.0, 1.0), (2.0, 0.25), (3.0, 0.1)];
const PURE: &[(f32, f32)] = &[(1.0, 1.0)];
const BELL: &[(f32, f32)] = &[(1.0, 1.0), (2.0, 0.5), (3.0, 0.25), (4.2, 0.15), (5.4, 0.08)];
const DING: &[(f32, f32)] = &[(1.0, 1.0), (2.756, 0.2), (5.404, 0.08)];

fn recipe(name: &str) -> (f32, Vec<Note>) {
    let n = |start, freq, decay, partials| Note { start, freq, decay, partials };
    match name {
        "soft" => (0.8, vec![n(0.0, 659.25, 0.3, PURE), n(0.09, 987.77, 0.4, PURE)]),
        "ding" => (1.1, vec![n(0.0, 1567.98, 0.45, DING)]),
        "pop" => (0.16, vec![n(0.0, 700.0, 0.04, WARM)]),
        "bell" => (
            1.7,
            vec![
                n(0.0, 1046.5, 0.45, BELL),
                n(0.33, 1046.5, 0.45, BELL),
                n(0.66, 1046.5, 0.55, BELL),
            ],
        ),
        // Incoming call: a bright three-note marimba phrase, twice, then a pause
        // (the file loops while ringing).
        "ringtone" => (
            2.6,
            vec![
                n(0.0, 659.25, 0.22, WARM),
                n(0.14, 830.61, 0.22, WARM),
                n(0.28, 987.77, 0.35, WARM),
                n(0.7, 659.25, 0.22, WARM),
                n(0.84, 830.61, 0.22, WARM),
                n(0.98, 987.77, 0.45, WARM),
            ],
        ),
        // LANX 1.8.0 emergency alert: a loud two-tone siren (loops until answered).
        "alarm" => (
            1.6,
            vec![
                n(0.0, 987.77, 0.16, WARM),
                n(0.2, 739.99, 0.16, WARM),
                n(0.4, 987.77, 0.16, WARM),
                n(0.6, 739.99, 0.16, WARM),
                n(0.8, 987.77, 0.16, WARM),
                n(1.0, 739.99, 0.16, WARM),
                n(1.2, 987.77, 0.16, WARM),
                n(1.4, 739.99, 0.16, WARM),
            ],
        ),
        // Caller hears this while the other side rings: a soft double tone.
        "ringback" => (3.0, vec![n(0.0, 440.0, 0.7, PURE), n(0.0, 480.0, 0.7, PURE)]),
        // "chime" (default)
        _ => (0.75, vec![n(0.0, 880.0, 0.25, WARM), n(0.11, 1318.51, 0.35, WARM)]),
    }
}

/// Renders a built-in sound as a 16-bit mono WAV file in memory.
pub fn synth(name: &str) -> Vec<u8> {
    let (length, notes) = recipe(name);
    let total = (length * RATE as f32) as usize;
    let mut samples = vec![0f32; total];
    for note in &notes {
        let start = (note.start * RATE as f32) as usize;
        for (i, s) in samples.iter_mut().enumerate().skip(start) {
            let t = (i - start) as f32 / RATE as f32;
            let attack = (t / 0.004).min(1.0);
            let env = attack * (-t / note.decay).exp();
            // "pop" sweeps upwards for a short bubbly click.
            let freq = if name == "pop" { note.freq + 900.0 * t / 0.06 } else { note.freq };
            let mut v = 0.0;
            for (ratio, amp) in note.partials {
                v += amp * (2.0 * PI * freq * ratio * t).sin();
            }
            *s += v * env;
        }
    }
    let peak = samples.iter().fold(0f32, |m, s| m.max(s.abs())).max(1e-6);
    let pcm: Vec<i16> = samples
        .iter()
        .map(|s| (s / peak * 0.8 * i16::MAX as f32) as i16)
        .collect();
    wav_bytes(&pcm)
}

fn wav_bytes(pcm: &[i16]) -> Vec<u8> {
    let data_len = (pcm.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&RATE.to_le_bytes());
    out.extend_from_slice(&(RATE * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for s in pcm {
        out.extend_from_slice(&s.to_le_bytes());
    }
    out
}

fn builtin(name: &str) -> &'static [u8] {
    static CACHE: OnceLock<Vec<(&'static str, Vec<u8>)>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| BUILTIN.iter().map(|n| (*n, synth(n))).collect());
    cache
        .iter()
        .find(|(n, _)| *n == name)
        .or_else(|| cache.first())
        .map(|(_, b)| b.as_slice())
        .unwrap_or(&[])
}

/// Checks that a file is a WAV that Windows can play from memory.
pub fn load_custom(path: &str) -> Result<Vec<u8>, String> {
    let meta = std::fs::metadata(path).map_err(|_| "Sound file not found.".to_string())?;
    if meta.len() > MAX_CUSTOM_BYTES {
        return Err("Choose a .wav file smaller than 5 MB.".to_string());
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("That is not a .wav sound file.".to_string());
    }
    Ok(bytes)
}

/// Buffer for the current custom sound. PlaySound reads it while playing, so
/// it lives here until replaced (after stopping playback).
fn custom_slot() -> &'static Mutex<Option<(String, &'static [u8])>> {
    static SLOT: OnceLock<Mutex<Option<(String, &'static [u8])>>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
}

fn custom_bytes(path: &str) -> Option<&'static [u8]> {
    let mut slot = custom_slot().lock().ok()?;
    if let Some((p, b)) = slot.as_ref() {
        if p == path {
            return Some(b);
        }
    }
    let bytes = load_custom(path).ok()?;
    stop();
    // Leaked on purpose: a handful of small buffers at most per session,
    // and PlaySound may still be reading the old one asynchronously.
    let leaked: &'static [u8] = Box::leak(bytes.into_boxed_slice());
    *slot = Some((path.to_string(), leaked));
    Some(leaked)
}

#[cfg(windows)]
fn play_bytes(bytes: &'static [u8], volume: u32) {
    use windows_sys::Win32::Media::Audio::{
        PlaySoundW, SND_ASYNC, SND_MEMORY, SND_NODEFAULT, waveOutSetVolume,
    };
    if bytes.is_empty() {
        return;
    }
    let v = (volume.min(100) * 0xFFFF / 100) & 0xFFFF;
    unsafe {
        waveOutSetVolume(std::ptr::null_mut(), v | (v << 16));
        PlaySoundW(
            bytes.as_ptr() as *const u16,
            std::ptr::null_mut(),
            SND_MEMORY | SND_ASYNC | SND_NODEFAULT,
        );
    }
}

#[cfg(not(windows))]
fn play_bytes(bytes: &'static [u8], volume: u32) {
    unix_audio::play(bytes, volume, false);
}

#[cfg(windows)]
fn loop_bytes(bytes: &'static [u8], volume: u32) {
    use windows_sys::Win32::Media::Audio::{
        PlaySoundW, SND_ASYNC, SND_LOOP, SND_MEMORY, SND_NODEFAULT, waveOutSetVolume,
    };
    let v = (volume.min(100) * 0xFFFF / 100) & 0xFFFF;
    unsafe {
        waveOutSetVolume(std::ptr::null_mut(), v | (v << 16));
        PlaySoundW(
            bytes.as_ptr() as *const u16,
            std::ptr::null_mut(),
            SND_MEMORY | SND_ASYNC | SND_LOOP | SND_NODEFAULT,
        );
    }
}

#[cfg(not(windows))]
fn loop_bytes(bytes: &'static [u8], volume: u32) {
    unix_audio::play(bytes, volume, true);
}

/// Starts a ringtone ("ringtone" or "ringback") that repeats until
/// `stop_loop`.
pub fn play_loop(name: &str, volume: u32) {
    LOOPING.store(true, Ordering::SeqCst);
    loop_bytes(builtin(name), volume.max(30));
}

pub fn stop_loop() {
    if LOOPING.swap(false, Ordering::SeqCst) {
        stop();
    }
}

#[cfg(windows)]
pub fn stop() {
    use windows_sys::Win32::Media::Audio::PlaySoundW;
    unsafe {
        PlaySoundW(std::ptr::null(), std::ptr::null_mut(), 0);
    }
}

#[cfg(not(windows))]
pub fn stop() {
    unix_audio::stop();
}

/// LANX for Linux: sounds go through the desktop's own player (PulseAudio's
/// `paplay`, PipeWire's `pw-play`, ALSA's `aplay`), whichever is installed.
/// Each WAV buffer is written once to a small file in the temp folder.
#[cfg(not(windows))]
mod unix_audio {
    use std::path::PathBuf;
    use std::process::{Child, Command, Stdio};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Mutex, OnceLock};

    static CURRENT: Mutex<Option<Child>> = Mutex::new(None);
    static GENERATION: AtomicU64 = AtomicU64::new(0);

    fn player() -> Option<&'static str> {
        static P: OnceLock<Option<&'static str>> = OnceLock::new();
        *P.get_or_init(|| {
            ["paplay", "pw-play", "aplay", "ffplay"].into_iter().find(|name| {
                Command::new(name)
                    .arg("--version")
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status()
                    .is_ok()
            })
        })
    }

    fn file_for(bytes: &'static [u8]) -> Option<PathBuf> {
        let mut h: u64 = 0xcbf2_9ce4_8422_2325;
        for b in bytes.iter().step_by(97).take(4096) {
            h ^= *b as u64;
            h = h.wrapping_mul(0x0100_0000_01b3);
        }
        let path = std::env::temp_dir().join(format!("lanx-sound-{:016x}-{}.wav", h, bytes.len()));
        if !path.exists() {
            std::fs::write(&path, bytes).ok()?;
        }
        Some(path)
    }

    fn spawn(player: &str, path: &PathBuf, volume: u32) -> Option<Child> {
        let mut c = Command::new(player);
        match player {
            "paplay" => {
                c.arg(format!("--volume={}", volume.min(100) * 65536 / 100));
            }
            "pw-play" => {
                c.arg(format!("--volume={:.2}", volume.min(100) as f32 / 100.0));
            }
            "aplay" => {
                c.arg("-q");
            }
            "ffplay" => {
                c.args(["-nodisp", "-autoexit", "-loglevel", "quiet", "-volume", &volume.min(100).to_string()]);
            }
            _ => {}
        }
        c.arg(path).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().ok()
    }

    pub fn play(bytes: &'static [u8], volume: u32, repeat: bool) {
        if bytes.is_empty() {
            return;
        }
        let (Some(player), Some(path)) = (player(), file_for(bytes)) else { return };
        stop();
        let my_gen = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
        std::thread::spawn(move || loop {
            let Some(mut child) = spawn(player, &path, volume) else { return };
            if let Ok(mut cur) = CURRENT.lock() {
                *cur = Some(child);
            } else {
                let _ = child.wait();
                return;
            }
            // Wait for this playback to finish (or be killed by `stop`).
            loop {
                std::thread::sleep(std::time::Duration::from_millis(80));
                let done = match CURRENT.lock() {
                    Ok(mut cur) => match cur.as_mut() {
                        Some(c) => c.try_wait().map(|s| s.is_some()).unwrap_or(true),
                        None => true,
                    },
                    Err(_) => true,
                };
                if done {
                    break;
                }
            }
            if !repeat || !super::LOOPING.load(Ordering::SeqCst) || GENERATION.load(Ordering::SeqCst) != my_gen {
                return;
            }
        });
    }

    pub fn stop() {
        GENERATION.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut cur) = CURRENT.lock() {
            if let Some(mut c) = cur.take() {
                let _ = c.kill();
                let _ = c.wait();
            }
        }
    }
}

/// Plays a built-in sound by name, or the custom file when name == "custom".
pub fn play(name: &str, custom_path: &str, volume: u32) {
    if LOOPING.load(Ordering::SeqCst) {
        return;
    }
    let bytes = if name == "custom" {
        custom_bytes(custom_path).unwrap_or_else(|| builtin("chime"))
    } else {
        builtin(name)
    };
    play_bytes(bytes, volume);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_sounds_are_valid_wavs() {
        for name in BUILTIN {
            let wav = synth(name);
            assert_eq!(&wav[0..4], b"RIFF");
            assert_eq!(&wav[8..12], b"WAVE");
            let data_len = u32::from_le_bytes(wav[40..44].try_into().unwrap()) as usize;
            assert_eq!(wav.len(), 44 + data_len, "{}", name);
            assert!(data_len > 1000, "{} has audio", name);
            // Not silent and not clipped.
            let peak = wav[44..]
                .chunks(2)
                .map(|c| i16::from_le_bytes([c[0], c[1]]).unsigned_abs())
                .max()
                .unwrap();
            assert!(peak > 20_000 && peak < i16::MAX as u16, "{} peak {}", name, peak);
        }
    }

    #[test]
    fn custom_sound_must_be_a_wav() {
        let dir = tempfile::tempdir().unwrap();
        let good = dir.path().join("my.wav");
        std::fs::write(&good, synth("ding")).unwrap();
        assert!(load_custom(good.to_str().unwrap()).is_ok());
        let bad = dir.path().join("song.mp3");
        std::fs::write(&bad, b"ID3\x03\x00not a wav file at all, just bytes......").unwrap();
        assert!(load_custom(bad.to_str().unwrap()).is_err());
        assert!(load_custom("C:\\nope\\missing.wav").is_err());
    }
}
