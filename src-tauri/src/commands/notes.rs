//! LANX 2.5.0: the Notes app's commands.

use super::{err, AppState};
use crate::storage::models::Note;
use tauri::State;

#[tauri::command(async)]
pub fn list_notes(state: State<AppState>, deleted: Option<bool>) -> Result<Vec<Note>, String> {
    state.network.privacy.guard()?;
    let _ = state.db.purge_old_deleted_notes();
    state.db.list_notes(deleted.unwrap_or(false)).map_err(err)
}

#[tauri::command]
pub fn save_note(state: State<AppState>, note: Note) -> Result<Note, String> {
    state.network.privacy.guard()?;
    state.db.save_note(note).map_err(err)
}

#[tauri::command]
pub fn delete_note(state: State<AppState>, id: String, for_good: Option<bool>) -> Result<bool, String> {
    state.network.privacy.guard()?;
    state.db.delete_note(&id, for_good.unwrap_or(false)).map_err(err)
}

#[tauri::command]
pub fn restore_note(state: State<AppState>, id: String) -> Result<bool, String> {
    state.network.privacy.guard()?;
    state.db.restore_note(&id).map_err(err)
}
