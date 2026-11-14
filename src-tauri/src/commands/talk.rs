//! LANX 3.15.0: the walkie-talkie. The window holds the microphone and the Opus encoder;
//! these start a transmission, pass its voice on and end it (networking/talk.rs).

use super::voice::HotkeyCombo;
use super::AppState;
use crate::networking::talk::TalkStarted;
use tauri::State;

/// Starts a transmission on a channel (`direct`, `all`, `group:<id>`) to these colleagues.
#[tauri::command]
pub async fn talk_start(state: State<'_, AppState>, channel: String, peers: Vec<String>) -> Result<TalkStarted, String> {
    state.network.talk_start(&channel, peers).await
}

/// The next voice pieces (Opus, 20 ms each, base64). Returns how many colleagues hear it.
#[tauri::command]
pub fn talk_audio(state: State<AppState>, talk_id: String, frames: Vec<String>) -> Result<usize, String> {
    state.network.talk_audio(&talk_id, frames)
}

#[tauri::command]
pub fn talk_end(state: State<AppState>, talk_id: String) {
    state.network.talk_end(&talk_id);
}

// ------------------------------------------------------------------ the talk key

/// The walkie-talkie key as the walkie-talkie's screen shows it.
#[derive(serde::Serialize, Debug, PartialEq)]
pub struct TalkKeyState {
    /// This LANX can have a key that works from other programs (the Windows
    /// installation; not test copies, not Linux).
    pub available: bool,
    /// Windows gave LANX the keys (false: off, or another program has them).
    pub working: bool,
    pub label: String,
}

#[tauri::command]
pub fn talk_key_state() -> TalkKeyState {
    TalkKeyState { available: crate::shell::hotkey_thread_running(), working: crate::shell::talk_hotkey_working(), label: crate::shell::talk_label() }
}

/// Turns the walkie-talkie key on or off and picks its keys. Returns false when
/// Windows refused the keys (another program, or another LANX shortcut, has them).
#[tauri::command]
pub async fn set_talk_key(enabled: bool, keys: Option<HotkeyCombo>) -> bool {
    let (mods, vk) = match &keys {
        Some(k) => (k.mods(), crate::shell::vk_for_code(&k.key).unwrap_or(0)),
        None => (crate::shell::DEFAULT_TALK_MODS, crate::shell::DEFAULT_TALK_VK),
    };
    if enabled && vk == 0 {
        return false;
    }
    crate::shell::set_talk_hotkey(enabled, mods, vk);
    if !enabled || !crate::shell::hotkey_thread_running() {
        return true;
    }
    // The listener thread registers the keys; give it a moment, then report.
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    crate::shell::talk_hotkey_working()
}

/// What the saved walkie-talkie preference says at start-up: the key on or off and
/// which keys (the default keys when none were chosen or the saved ones make no sense).
pub fn key_startup(pref: Option<&str>) -> (bool, u32, u32) {
    let v: serde_json::Value = pref.and_then(|p| serde_json::from_str(p).ok()).unwrap_or(serde_json::Value::Null);
    // (A walkie-talkie that is switched off has no key either.)
    let flag = |name: &str| v.get(name).and_then(|b| b.as_bool()).unwrap_or(true);
    let on = flag("on") && flag("key");
    let keys: Option<HotkeyCombo> = v.get("keys").cloned().and_then(|k| serde_json::from_value(k).ok());
    match keys.and_then(|k| crate::shell::vk_for_code(&k.key).map(|vk| (k.mods(), vk))) {
        Some((mods, vk)) => (on, mods, vk),
        None => (on, crate::shell::DEFAULT_TALK_MODS, crate::shell::DEFAULT_TALK_VK),
    }
}

#[cfg(test)]
mod key_tests {
    use super::*;

    #[test]
    fn the_talk_key_from_the_saved_preference() {
        assert_eq!(key_startup(None), (true, 3, b'T' as u32), "Ctrl + Alt + T unless chosen otherwise");
        assert_eq!(key_startup(Some(r#"{"on":true,"key":false}"#)), (false, 3, b'T' as u32));
        assert_eq!(key_startup(Some(r#"{"on":false,"key":true}"#)), (false, 3, b'T' as u32), "the walkie-talkie is off: no key");
        let saved = r#"{"on":true,"key":true,"keys":{"ctrl":false,"alt":false,"shift":false,"win":false,"key":"F9"}}"#;
        assert_eq!(key_startup(Some(saved)), (true, 0, 0x78));
        let odd = r#"{"keys":{"ctrl":true,"key":"Nonsense"}}"#;
        assert_eq!(key_startup(Some(odd)), (true, 3, b'T' as u32), "unknown keys fall back to the default");
        assert_eq!(key_startup(Some("not json")), (true, 3, b'T' as u32));
    }

    #[test]
    fn the_talk_key_in_words() {
        crate::shell::set_talk_hotkey(false, 2 | 4, 0x78);
        assert_eq!(crate::shell::talk_label(), "Ctrl + Shift + F9");
        assert!(!talk_key_state().working, "switched off: not working");
        crate::shell::set_talk_hotkey(false, crate::shell::DEFAULT_TALK_MODS, crate::shell::DEFAULT_TALK_VK);
        assert_eq!(crate::shell::talk_label(), "Ctrl + Alt + T");
    }
}
