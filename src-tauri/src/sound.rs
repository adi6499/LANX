//! LANX's own sounds. The built-in sounds are synthesised once into small WAV
//! buffers; a user-chosen .wav file can replace the message sound. Playback is
//! native (winmm PlaySound) so it works while LANX is hidden in the tray.

use std::f32::consts::PI;
use std::sync::{Mutex, OnceLock};

pub const BUILTIN: [&str; 5] = ["chime", "soft", "ding", "pop", "bell"];
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
fn play_bytes(_bytes: &'static [u8], _volume: u32) {}

#[cfg(windows)]
pub fn stop() {
    use windows_sys::Win32::Media::Audio::PlaySoundW;
    unsafe {
        PlaySoundW(std::ptr::null(), std::ptr::null_mut(), 0);
    }
}

#[cfg(not(windows))]
pub fn stop() {}

/// Plays a built-in sound by name, or the custom file when name == "custom".
pub fn play(name: &str, custom_path: &str, volume: u32) {
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
