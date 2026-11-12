//! LANX 2.5.0: dictation and voice recordings — the window's side of `voice.rs`.

use super::{err, AppState};
use crate::voice::{self, ModelStatus, Transcript};
use std::path::PathBuf;
use tauri::{AppHandle, State};

#[tauri::command(async)]
pub fn voice_models() -> Vec<ModelStatus> {
    voice::status()
}

/// A piece of a model download (raw body). Headers: `x-model`, `x-offset`.
#[tauri::command]
pub fn voice_model_chunk(request: tauri::ipc::Request<'_>) -> Result<u64, String> {
    let header = |n: &str| request.headers().get(n).and_then(|v| v.to_str().ok()).map(|s| s.to_string());
    let id = header("x-model").ok_or("No model")?;
    let offset: u64 = header("x-offset").and_then(|v| v.parse().ok()).ok_or("No offset")?;
    match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => voice::append_model_chunk(&id, offset, bytes),
        _ => Err("Expected model data".to_string()),
    }
}

#[tauri::command(async)]
pub fn voice_model_finish(id: String) -> Result<ModelStatus, String> {
    voice::finish_model(&id)
}

#[tauri::command(async)]
pub fn voice_model_delete(id: String) -> Result<(), String> {
    voice::delete_model(&id)
}

/// Speech → text. Raw body: 16 kHz mono f32 little-endian samples.
/// Headers: `x-model` (tiny|base|small), `x-lang` (auto|en|hi|mr|…).
#[tauri::command]
pub async fn transcribe(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> Result<Transcript, String> {
    state.network.privacy.guard()?;
    let header = |n: &str| request.headers().get(n).and_then(|v| v.to_str().ok()).map(|s| s.to_string());
    let model = header("x-model").unwrap_or_else(|| "base".to_string());
    let lang = header("x-lang").unwrap_or_else(|| "auto".to_string());
    let samples = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => voice::pcm_from_bytes(bytes)?,
        _ => return Err("Expected audio data".to_string()),
    };
    tauri::async_runtime::spawn_blocking(move || voice::transcribe(&model, &lang, &samples)).await.map_err(err)?
}

/// Types text into the program that was in front when the dictation hotkey
/// was pressed (Windows). Returns false when there is no such program (then
/// the window puts the text where its own cursor is, or on the clipboard).
#[tauri::command]
pub fn type_text(app: AppHandle, text: String) -> Result<bool, String> {
    crate::shell::type_into_target(&app, &text)
}

/// LANX 2.5.2: "Cancel" while the words are being written down.
#[tauri::command]
pub fn transcribe_cancel() {
    crate::voice::cancel_transcription();
}

/// Turns the dictation shortcut on or off and picks its keys. Returns false
/// when Windows refused the keys (another program has them).
#[tauri::command]
pub async fn set_dictation_hotkey(enabled: bool, keys: Option<HotkeyCombo>) -> bool {
    let (mods, vk) = match &keys {
        Some(k) => (k.mods(), crate::shell::vk_for_code(&k.key).unwrap_or(0)),
        None => (crate::shell::DEFAULT_DICTATE_MODS, crate::shell::DEFAULT_DICTATE_VK),
    };
    if enabled && vk == 0 {
        return false;
    }
    crate::shell::set_dictation_hotkey(enabled, mods, vk);
    if !enabled || !crate::shell::hotkey_thread_running() {
        return true;
    }
    // The listener thread registers the keys; give it a moment, then report.
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    crate::shell::dictation_hotkey_working()
}

/// LANX 2.5.1: the dictation shortcut as the window stores it
/// (`KeyboardEvent.code`-style key name plus modifiers).
#[derive(serde::Deserialize, Clone, Default)]
pub struct HotkeyCombo {
    #[serde(default)]
    pub ctrl: bool,
    #[serde(default)]
    pub alt: bool,
    #[serde(default)]
    pub shift: bool,
    #[serde(default)]
    pub win: bool,
    #[serde(default)]
    pub key: String,
}

impl HotkeyCombo {
    /// Windows modifier flags: Alt 1, Ctrl 2, Shift 4, Win 8.
    pub fn mods(&self) -> u32 {
        (self.alt as u32) | ((self.ctrl as u32) << 1) | ((self.shift as u32) << 2) | ((self.win as u32) << 3)
    }
}

/// What the saved dictation preference says at start-up: on/off and the keys
/// (the default keys when none were chosen or the saved ones make no sense).
pub fn dictation_startup(pref: Option<&str>) -> (bool, u32, u32) {
    let v: serde_json::Value = pref.and_then(|p| serde_json::from_str(p).ok()).unwrap_or(serde_json::Value::Null);
    let on = v.get("hotkey").and_then(|b| b.as_bool()).unwrap_or(true);
    let keys: Option<HotkeyCombo> = v.get("keys").cloned().and_then(|k| serde_json::from_value(k).ok());
    match keys.and_then(|k| crate::shell::vk_for_code(&k.key).map(|vk| (k.mods(), vk))) {
        Some((mods, vk)) => (on, mods, vk),
        None => (on, crate::shell::DEFAULT_DICTATE_MODS, crate::shell::DEFAULT_DICTATE_VK),
    }
}

#[cfg(test)]
mod hotkey_tests {
    use super::*;

    #[test]
    fn keys_from_the_saved_preference() {
        assert_eq!(dictation_startup(None), (true, 3, b'D' as u32));
        assert_eq!(dictation_startup(Some(r#"{"hotkey":false}"#)), (false, 3, b'D' as u32));
        let saved = r#"{"hotkey":true,"keys":{"ctrl":true,"alt":false,"shift":true,"win":false,"key":"F9"}}"#;
        assert_eq!(dictation_startup(Some(saved)), (true, 2 | 4, 0x78));
        let odd = r#"{"keys":{"ctrl":true,"key":"Nonsense"}}"#;
        assert_eq!(dictation_startup(Some(odd)), (true, 3, b'D' as u32), "unknown keys fall back to the default");
        assert_eq!(crate::shell::vk_for_code("Space"), Some(0x20));
        assert_eq!(crate::shell::vk_for_code("Digit7"), Some(b'7' as u32));
        assert_eq!(crate::shell::vk_for_code("Numpad3"), Some(0x63));
        assert_eq!(crate::shell::vk_for_code("KeyÄ"), None);
    }
}

pub fn notes_audio_dir() -> PathBuf {
    crate::storage::data_dir(crate::testmode::profile().as_deref()).join("notes-audio")
}

#[derive(serde::Serialize)]
pub struct SavedAudio {
    pub file: String,
    pub bytes: u64,
}

/// Saves a voice recording for a note (raw body, header `x-ext` webm|ogg|wav).
#[tauri::command(async)]
pub fn save_note_audio(state: State<AppState>, request: tauri::ipc::Request<'_>) -> Result<SavedAudio, String> {
    state.network.privacy.guard()?;
    let ext = request
        .headers()
        .get("x-ext")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_ascii_lowercase())
        .filter(|s| ["webm", "ogg", "wav", "m4a", "mp3"].contains(&s.as_str()))
        .unwrap_or_else(|| "webm".to_string());
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(b) => b,
        _ => return Err("Expected audio data".to_string()),
    };
    if bytes.is_empty() {
        return Err("Nothing was recorded".to_string());
    }
    if bytes.len() > 100 * 1024 * 1024 {
        return Err("That recording is too big (over 100 MB).".to_string());
    }
    let dir = notes_audio_dir();
    std::fs::create_dir_all(&dir).map_err(err)?;
    let name = format!("rec-{}-{}.{ext}", chrono::Local::now().format("%Y%m%d-%H%M%S"), &uuid::Uuid::new_v4().to_string()[..8]);
    let path = dir.join(&name);
    std::fs::write(&path, bytes).map_err(err)?;
    Ok(SavedAudio { file: path.to_string_lossy().to_string(), bytes: bytes.len() as u64 })
}

#[tauri::command(async)]
pub fn delete_note_audio(state: State<AppState>, file: String) -> Result<(), String> {
    state.network.privacy.guard()?;
    let p = PathBuf::from(&file);
    let dir = notes_audio_dir();
    let inside = std::fs::canonicalize(&p).ok().zip(std::fs::canonicalize(&dir).ok()).map(|(a, b)| a.starts_with(b)).unwrap_or(false);
    if !inside {
        return Err("Not a note recording".to_string());
    }
    if p.exists() {
        std::fs::remove_file(&p).map_err(err)?;
    }
    Ok(())
}
