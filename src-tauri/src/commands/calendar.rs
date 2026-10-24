//! LANX 2.5.0: the Calendar's commands, plus a few remembered preferences
//! (holidays, wallpaper, signature) the new tools keep as small JSON texts.

use super::{err, AppState};
use crate::storage::models::{CalendarEvent, Occurrence};
use tauri::State;

#[tauri::command]
pub fn list_events(state: State<AppState>, from: i64, to: i64) -> Result<Vec<Occurrence>, String> {
    state.network.privacy.guard()?;
    if to <= from || to - from > 400 * 86_400 {
        return Err("Pick a shorter period.".to_string());
    }
    state.db.list_events(from, to).map_err(err)
}

#[tauri::command]
pub fn list_all_events(state: State<AppState>) -> Result<Vec<CalendarEvent>, String> {
    state.network.privacy.guard()?;
    state.db.list_all_events().map_err(err)
}

#[tauri::command]
pub fn save_event(state: State<AppState>, event: CalendarEvent) -> Result<CalendarEvent, String> {
    state.network.privacy.guard()?;
    state.db.save_event(event).map_err(err)
}

#[tauri::command]
pub fn delete_event(state: State<AppState>, id: String) -> Result<bool, String> {
    state.network.privacy.guard()?;
    state.db.delete_event(&id).map_err(err)
}

/// The whole calendar as .ics text (the window saves it as a file).
#[tauri::command]
pub fn export_events_ics(state: State<AppState>) -> Result<String, String> {
    state.network.privacy.guard()?;
    let all = state.db.list_all_events().map_err(err)?;
    Ok(crate::storage::calendar::to_ics(&all))
}

/// Small JSON preferences of the 2.5.0 tools. Only these keys, so the window
/// can't poke at other settings.
const PREF_KEYS: [&str; 17] = ["holidays", "wallpaper", "signature", "calendar_prefs", "share_link", "dictation", "memes", "memes_fav", "memes_recent", "memes_cache", "music_fav", "music_recent", "music_artists", "music_albums", "music_playlists", "music_cache", "games_stats"];
const MAX_PREF_BYTES: usize = 2 * 1024 * 1024;

#[tauri::command]
pub fn get_pref(state: State<AppState>, key: String) -> Result<Option<String>, String> {
    if !PREF_KEYS.contains(&key.as_str()) {
        return Err("Unknown preference".to_string());
    }
    Ok(state.db.get_setting(&format!("pref_{key}")))
}

#[tauri::command]
pub fn set_pref(state: State<AppState>, key: String, value: String) -> Result<(), String> {
    if !PREF_KEYS.contains(&key.as_str()) {
        return Err("Unknown preference".to_string());
    }
    if value.len() > MAX_PREF_BYTES {
        return Err("That is too big to keep as a preference.".to_string());
    }
    state.db.set_setting(&format!("pref_{key}"), &value).map_err(err)
}
