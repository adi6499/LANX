//! LANX 3.8.0 Listen together: send a party step to a colleague, compare a
//! colleague's clock with ours, and read our own clock (the UI lines its
//! audio clock up with it).

use super::AppState;
use crate::networking::music::{clock_ms, ClockSample};
use crate::networking::protocol::MusicPayload;
use tauri::State;

#[tauri::command]
pub async fn send_music(state: State<'_, AppState>, peer_id: String, step: MusicPayload) -> Result<bool, String> {
    state.network.send_music(&peer_id, step).await
}

#[tauri::command]
pub async fn music_clock(state: State<'_, AppState>, peer_id: String, samples: Option<u32>) -> Result<ClockSample, String> {
    state.network.music_clock(&peer_id, samples.unwrap_or(12)).await
}

#[tauri::command]
pub fn music_now() -> f64 {
    clock_ms()
}
