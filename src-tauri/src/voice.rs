//! LANX 2.5.0: speech to text, on this PC, no internet (whisper.cpp through
//! `whisper-rs`). The model file is downloaded once by the window (it needs the
//! internet for that one download) into LANX's data folder; after that
//! everything runs locally. Used by dictation (the voice shortcut) and by the
//! voice recordings in Notes.

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

/// The models people can choose. Sizes are what Hugging Face serves.
pub const MODELS: [ModelInfo; 3] = [
    ModelInfo { id: "tiny", name: "Fast", file: "ggml-tiny.bin", min_bytes: 70_000_000, about: "75 MB · a sentence is written in a few seconds; fine for short, clear speech" },
    ModelInfo { id: "base", name: "Balanced", file: "ggml-base.bin", min_bytes: 140_000_000, about: "148 MB · good English and Hindi, the usual choice; about twice as slow as Fast" },
    ModelInfo { id: "small", name: "Best", file: "ggml-small.bin", min_bytes: 460_000_000, about: "488 MB · most accurate but slow: a 7-second sentence took 33 s on a new laptop (73 s with language on Detect automatically) — not for dictation" },
];
pub const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/";
/// The most audio one request may carry (16 kHz mono f32): 10 minutes.
pub const MAX_SAMPLES: usize = 16_000 * 600;
pub const SAMPLE_RATE: i32 = 16_000;

#[derive(Clone, Copy)]
pub struct ModelInfo {
    pub id: &'static str,
    pub name: &'static str,
    pub file: &'static str,
    pub min_bytes: u64,
    pub about: &'static str,
}

#[derive(serde::Serialize)]
pub struct ModelStatus {
    pub id: String,
    pub name: String,
    pub about: String,
    pub file: String,
    pub url: String,
    pub downloaded: bool,
    pub bytes: u64,
    pub partial_bytes: u64,
}

#[derive(serde::Serialize, Clone, Debug, PartialEq)]
pub struct Segment {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct Transcript {
    pub text: String,
    pub segments: Vec<Segment>,
    pub language: String,
    pub audio_secs: f32,
    pub took_ms: u64,
    pub model: String,
}

pub fn models_dir() -> PathBuf {
    crate::storage::data_dir(crate::testmode::profile().as_deref()).join("models")
}

pub fn model(id: &str) -> Option<ModelInfo> {
    MODELS.iter().copied().find(|m| m.id == id)
}

pub fn model_path(id: &str) -> Option<PathBuf> {
    model(id).map(|m| models_dir().join(m.file))
}

pub fn status() -> Vec<ModelStatus> {
    MODELS
        .iter()
        .map(|m| {
            let p = models_dir().join(m.file);
            let bytes = std::fs::metadata(&p).map(|x| x.len()).unwrap_or(0);
            let partial = std::fs::metadata(p.with_extension("bin.part")).map(|x| x.len()).unwrap_or(0);
            ModelStatus {
                id: m.id.to_string(),
                name: m.name.to_string(),
                about: m.about.to_string(),
                file: m.file.to_string(),
                url: format!("{MODEL_URL}{}", m.file),
                downloaded: bytes >= m.min_bytes,
                bytes,
                partial_bytes: partial,
            }
        })
        .collect()
}

/// Appends a piece of a model download (`offset` must match what is there).
pub fn append_model_chunk(id: &str, offset: u64, bytes: &[u8]) -> Result<u64, String> {
    let m = model(id).ok_or("Unknown model")?;
    let dir = models_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let part = dir.join(m.file).with_extension("bin.part");
    let have = std::fs::metadata(&part).map(|x| x.len()).unwrap_or(0);
    if offset == 0 && have > 0 {
        std::fs::remove_file(&part).map_err(|e| e.to_string())?;
    } else if offset != have {
        return Err(format!("Download out of step (have {have}, got {offset})"));
    }
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&part).map_err(|e| e.to_string())?;
    f.write_all(bytes).map_err(|e| e.to_string())?;
    Ok(offset + bytes.len() as u64)
}

/// The download is complete: check the size and put the file in place.
pub fn finish_model(id: &str) -> Result<ModelStatus, String> {
    let m = model(id).ok_or("Unknown model")?;
    let dir = models_dir();
    let part = dir.join(m.file).with_extension("bin.part");
    let size = std::fs::metadata(&part).map(|x| x.len()).map_err(|_| "Nothing was downloaded".to_string())?;
    if size < m.min_bytes {
        let _ = std::fs::remove_file(&part);
        return Err("The download stopped early. Please try again.".to_string());
    }
    // A ggml file starts with the magic "lmgg" (0x67676d6c little-endian).
    let mut head = [0u8; 4];
    {
        use std::io::Read;
        let mut f = std::fs::File::open(&part).map_err(|e| e.to_string())?;
        f.read_exact(&mut head).map_err(|e| e.to_string())?;
    }
    if &head != b"lmgg" {
        let _ = std::fs::remove_file(&part);
        return Err("That file is not a speech model. Please try the download again.".to_string());
    }
    let dest = dir.join(m.file);
    let _ = std::fs::remove_file(&dest);
    std::fs::rename(&part, &dest).map_err(|e| e.to_string())?;
    drop_context();
    Ok(status().into_iter().find(|s| s.id == id).unwrap())
}

pub fn delete_model(id: &str) -> Result<(), String> {
    let m = model(id).ok_or("Unknown model")?;
    let p = models_dir().join(m.file);
    let _ = std::fs::remove_file(p.with_extension("bin.part"));
    if p.exists() {
        std::fs::remove_file(&p).map_err(|e| e.to_string())?;
    }
    drop_context();
    Ok(())
}

/// Little-endian 32-bit floats → samples (what the window records).
pub fn pcm_from_bytes(bytes: &[u8]) -> Result<Vec<f32>, String> {
    if bytes.len() % 4 != 0 {
        return Err("Audio data is damaged".to_string());
    }
    let n = bytes.len() / 4;
    if n > MAX_SAMPLES {
        return Err("That recording is too long (over 10 minutes). Split it up.".to_string());
    }
    Ok(bytes.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]).clamp(-1.0, 1.0)).collect())
}

/// Is there any sound worth transcribing? (Silence just wastes time.)
pub fn has_speech(samples: &[f32]) -> bool {
    if samples.len() < SAMPLE_RATE as usize / 4 {
        return false;
    }
    let rms = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt();
    rms > 0.004
}

/// Text from the transcript, tidied (whisper leaves spaces and repeats).
pub fn join_segments(segments: &[Segment]) -> String {
    let mut out = String::new();
    for s in segments {
        let t = s.text.trim();
        if t.is_empty() || t.starts_with('[') && t.ends_with(']') || t.starts_with('(') && t.ends_with(')') {
            continue; // "[BLANK_AUDIO]", "(music)"
        }
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(t);
    }
    out
}

struct Loaded {
    id: String,
    ctx: WhisperContext,
}
static CONTEXT: OnceLock<Mutex<Option<Loaded>>> = OnceLock::new();
/// LANX 2.5.2: set by "Cancel" in the window; the engine stops at its next step.
static ABORT: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
pub fn cancel_transcription() {
    ABORT.store(true, std::sync::atomic::Ordering::SeqCst);
}
fn slot() -> &'static Mutex<Option<Loaded>> {
    CONTEXT.get_or_init(|| Mutex::new(None))
}
fn drop_context() {
    if let Ok(mut g) = slot().lock() {
        *g = None;
    }
}

/// Transcribes 16 kHz mono samples. `language`: "auto", "en", "hi", "mr", …
/// Blocking — call from a blocking thread. The model stays loaded for next time.
pub fn transcribe(model_id: &str, language: &str, samples: &[f32]) -> Result<Transcript, String> {
    let started = Instant::now();
    let m = model(model_id).ok_or("Unknown model")?;
    let path = models_dir().join(m.file);
    if !path.exists() {
        return Err("The speech model isn't downloaded yet. Open Voice settings to get it.".to_string());
    }
    let audio_secs = samples.len() as f32 / SAMPLE_RATE as f32;
    if !has_speech(samples) {
        return Ok(Transcript { text: String::new(), segments: vec![], language: language.to_string(), audio_secs, took_ms: 0, model: model_id.to_string() });
    }
    ABORT.store(false, std::sync::atomic::Ordering::SeqCst);
    let mut guard = slot().lock().map_err(|_| "Speech engine busy".to_string())?;
    if guard.as_ref().map(|l| l.id != model_id).unwrap_or(true) {
        let mut cp = WhisperContextParameters::default();
        cp.use_gpu(false);
        let ctx = WhisperContext::new_with_params(&path.to_string_lossy(), cp).map_err(|e| format!("Could not load the speech model: {e:?}"))?;
        *guard = Some(Loaded { id: model_id.to_string(), ctx });
    }
    let loaded = guard.as_ref().unwrap();
    let mut state = loaded.ctx.create_state().map_err(|e| format!("Speech engine: {e:?}"))?;
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(2, 12) as i32;
    params.set_n_threads(threads);
    let lang = if language.is_empty() || language == "auto" { "auto" } else { language };
    params.set_language(Some(lang));
    params.set_translate(false);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_suppress_blank(true);
    params.set_no_context(true);
    params.set_token_timestamps(false);
    params.set_abort_callback_safe(|| ABORT.load(std::sync::atomic::Ordering::Relaxed));
    // Whisper needs at least a second of audio; pad short clips with silence.
    let mut audio = samples.to_vec();
    if audio.len() < SAMPLE_RATE as usize * 3 / 2 {
        audio.resize(SAMPLE_RATE as usize * 3 / 2, 0.0);
    }
    // LANX 2.5.2: a short clip needs only part of the engine's 30-second
    // window. A shorter window makes a 7-second sentence 2-3× quicker.
    let secs_used = (audio.len() as f32 / SAMPLE_RATE as f32).max(1.5);
    let ctx = ((secs_used / 30.0) * 1500.0).ceil() as i32 + 128;
    params.set_audio_ctx(ctx.clamp(320, 1500));
    state.full(params, &audio).map_err(|e| {
        if ABORT.load(std::sync::atomic::Ordering::SeqCst) {
            "Cancelled".to_string()
        } else {
            format!("Speech engine: {e:?}")
        }
    })?;
    if ABORT.load(std::sync::atomic::Ordering::SeqCst) {
        return Err("Cancelled".to_string());
    }
    let n = state.full_n_segments().map_err(|e| format!("Speech engine: {e:?}"))?;
    let mut segments = Vec::with_capacity(n as usize);
    for i in 0..n {
        let text = state.full_get_segment_text(i).unwrap_or_default();
        let t0 = state.full_get_segment_t0(i).unwrap_or(0);
        let t1 = state.full_get_segment_t1(i).unwrap_or(0);
        segments.push(Segment { start_ms: t0 * 10, end_ms: t1 * 10, text });
    }
    let detected = state.full_lang_id_from_state().ok().and_then(|id| whisper_rs::get_lang_str(id).map(|s| s.to_string())).unwrap_or_else(|| lang.to_string());
    let text = join_segments(&segments);
    Ok(Transcript { text, segments, language: detected, audio_secs, took_ms: started.elapsed().as_millis() as u64, model: model_id.to_string() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audio_helpers_behave() {
        let bytes: Vec<u8> = [0.5f32, -0.25, 2.0].iter().flat_map(|f| f.to_le_bytes()).collect();
        assert_eq!(pcm_from_bytes(&bytes).unwrap(), vec![0.5, -0.25, 1.0]);
        assert!(pcm_from_bytes(&bytes[..5]).is_err());
        assert!(!has_speech(&vec![0.0; 16_000]), "silence is not speech");
        let tone: Vec<f32> = (0..16_000).map(|i| (i as f32 * 0.05).sin() * 0.3).collect();
        assert!(has_speech(&tone));
        let segs = vec![
            Segment { start_ms: 0, end_ms: 900, text: " Hello ".into() },
            Segment { start_ms: 900, end_ms: 1200, text: "[BLANK_AUDIO]".into() },
            Segment { start_ms: 1200, end_ms: 2000, text: " the truck is here.".into() },
        ];
        assert_eq!(join_segments(&segs), "Hello the truck is here.");
        assert!(model("base").is_some() && model("huge").is_none());
        assert!(status().iter().all(|s| !s.downloaded || s.bytes > 0));
    }
}
