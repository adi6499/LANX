//! LANX 3.8.0 Listen together: send a party step to a colleague, compare a
//! colleague's clock with ours, and read our own clock (the UI lines its
//! audio clock up with it).

use super::AppState;
use crate::networking::music::{clock_ms, ClockSample, PHONE_SHARE, PHONE_SHARE_MAX};
use crate::networking::protocol::{MusicPayload, TogetherPayload};
use tauri::State;

#[tauri::command]
pub async fn send_music(state: State<'_, AppState>, peer_id: String, step: MusicPayload) -> Result<bool, String> {
    state.network.send_music(&peer_id, step).await
}

/// LANX 3.9.0: a step of a together session (quiz, bell, announcement, presenting, watching).
#[tauri::command]
pub async fn send_together(state: State<'_, AppState>, peer_id: String, step: TogetherPayload) -> Result<bool, String> {
    state.network.send_together(&peer_id, step).await
}

#[tauri::command]
pub async fn music_clock(state: State<'_, AppState>, peer_id: String, samples: Option<u32>) -> Result<ClockSample, String> {
    state.network.music_clock(&peer_id, samples.unwrap_or(12)).await
}

#[tauri::command]
pub fn music_now() -> f64 {
    clock_ms()
}

/// LANX 3.9.0: the window tells this PC's phones what it is listening to
/// together (the song and the plan, on the host's clock), so they can play along.
#[tauri::command]
pub fn music_phone_share(state: State<'_, AppState>, share: serde_json::Value) -> Result<(), String> {
    if share.to_string().len() > PHONE_SHARE_MAX {
        return Err("Too big to share with the phone.".to_string());
    }
    *PHONE_SHARE.lock() = share.clone();
    state.network.events.emit_json("lanx://music-phone", share);
    Ok(())
}

/// LANX 3.9.0 Watch together: lend this video file to colleagues watching with this PC.
#[tauri::command]
pub async fn watch_serve(path: String) -> Result<crate::watch::WatchServe, String> {
    crate::watch::serve(&path).await
}

#[tauri::command]
pub fn watch_stop() {
    crate::watch::stop();
}
