//! LANX 2.9.0 games: the one command the UI needs — send a step of a game
//! (accept, move, resign, rematch…) to the colleague you play with. The
//! challenge itself goes out as a "game" card through `send_card`.

use super::AppState;
use crate::networking::protocol::GamePayload;
use tauri::State;

#[tauri::command]
pub async fn send_game(state: State<'_, AppState>, peer_id: String, step: GamePayload) -> Result<bool, String> {
    state.network.send_game(&peer_id, step).await
}
