//! LANX 1.6.0 organising commands: post a card (notice, poll, task, approval,
//! checklist, meeting), act on one, and list them all for the Organiser.

use super::{AppState, err, guard_conversation};
use crate::storage::models::{Message, SearchHit};
use tauri::State;

#[tauri::command]
pub async fn send_card(state: State<'_, AppState>, conversation_id: String, card: serde_json::Value) -> Result<Message, String> {
    guard_conversation(&state, &conversation_id)?;
    state.network.send_card(&conversation_id, &card).await
}

/// Vote, tick, decide, answer: `key` names what changes, `value` is the new value.
#[tauri::command]
pub fn card_action(state: State<AppState>, message_id: String, key: String, value: serde_json::Value) -> Result<Message, String> {
    state.network.privacy.guard()?;
    state.network.card_action(&message_id, &key, &value)
}

#[tauri::command]
pub fn list_cards(state: State<AppState>) -> Result<Vec<SearchHit>, String> {
    let privacy = &state.network.privacy;
    privacy.guard()?;
    state.db.list_cards(privacy.hidden_unlocked()).map_err(err)
}

/// LANX 2.3.0 IT help desk: who the IT helpers are (peer ids), saved so the
/// Help button can pre-tick them. Anyone can see them; anyone can set them
/// (typically the admin does it once).
#[tauri::command]
pub fn get_it_helpers(state: State<AppState>) -> Vec<String> {
    state
        .db
        .get_setting("it_helpers")
        .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn set_it_helpers(state: State<AppState>, peer_ids: Vec<String>) -> Result<(), String> {
    state.network.privacy.guard()?;
    let ids: Vec<String> = peer_ids.into_iter().filter(|p| !p.is_empty() && p.len() <= 64).take(20).collect();
    let json = serde_json::to_string(&ids).map_err(err)?;
    state.db.set_setting("it_helpers", &json).map_err(err)?;
    Ok(())
}

