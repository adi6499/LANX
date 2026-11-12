//! LANX 3.0: Settings → "Use on your phone" (see phone/mod.rs).

use crate::commands::AppState;
use crate::phone::PhoneStatus;
use serde::Serialize;
use tauri::State;

#[tauri::command(async)]
pub fn phone_status(state: State<AppState>) -> PhoneStatus {
    state.phone.status()
}

#[tauri::command]
pub fn phone_set_enabled(state: State<AppState>, enabled: bool) -> Result<PhoneStatus, String> {
    state.network.privacy.guard()?;
    state.phone.set_enabled(enabled)?;
    Ok(state.phone.status())
}

/// A new code (and QR) for the next phone; turns the server on if needed.
#[tauri::command]
pub fn phone_start_pairing(state: State<AppState>) -> Result<PhoneStatus, String> {
    state.network.privacy.guard()?;
    if !state.phone.enabled() {
        state.phone.set_enabled(true)?;
    }
    state.phone.start_pairing();
    Ok(state.phone.status())
}

#[tauri::command]
pub fn phone_cancel_pairing(state: State<AppState>) -> PhoneStatus {
    state.phone.cancel_pairing();
    state.phone.status()
}

/// "Allow this phone?" — yes or no.
#[tauri::command]
pub fn phone_answer(state: State<AppState>, request_id: String, allow: bool) -> Result<PhoneStatus, String> {
    state.network.privacy.guard()?;
    state.phone.answer(&request_id, allow)?;
    Ok(state.phone.status())
}

/// Removes a phone: it has to scan again to come back.
#[tauri::command]
pub fn phone_forget(state: State<AppState>, device_id: String) -> Result<PhoneStatus, String> {
    state.network.privacy.guard()?;
    state.phone.forget(&device_id)?;
    Ok(state.phone.status())
}

/// LANX 3.2: where this PC's certificate authority (`ca.pem`) is, for
/// "Reveal" in Settings.
#[tauri::command(async)]
pub fn phone_cert_path(state: State<AppState>) -> String {
    state.phone.cert_path()
}

/// A QR code as a square of dark/light modules ("1"/"0", row by row).
#[derive(Serialize)]
pub struct QrData {
    pub size: usize,
    pub modules: String,
}

#[tauri::command(async)]
pub fn phone_qr(text: String) -> Result<QrData, String> {
    let code = qrcode::QrCode::with_error_correction_level(text.as_bytes(), qrcode::EcLevel::M).map_err(|e| e.to_string())?;
    let size = code.width();
    let modules = code
        .to_colors()
        .into_iter()
        .map(|c| if c == qrcode::Color::Dark { '1' } else { '0' })
        .collect();
    Ok(QrData { size, modules })
}

/// LANX 3.6.2: the phone as this PC's camera — an offer or a stop for the phones
/// (all connected ones, or `device_id`). Returns how many phones it reached.
#[tauri::command]
pub async fn phone_cam_send(state: State<'_, AppState>, payload: serde_json::Value, device_id: Option<String>) -> Result<usize, String> {
    state.network.privacy.guard()?;
    Ok(state.phone.cam_send(payload, device_id.as_deref()))
}
