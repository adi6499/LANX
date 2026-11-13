//! LANX 3.13.0: the page's way into LANX's own call engine (crate::ownrtc), used
//! where the web engine has no RTCPeerConnection (Linux). The page's stand-in
//! lives in src/lib/ownrtc.

use tauri::ipc::{Channel, InvokeBody, InvokeResponseBody, Request};

use crate::ownrtc::{AnswerOut, ChannelSpec, MediaInfo, MediaSpec, OfferOut};

/// Whether the page should use the engine even though its web engine has calls
/// (test copies only: LANX_OWN_RTC=1, so Windows can test the Linux way).
#[tauri::command]
pub fn ownrtc_forced() -> bool {
    crate::testmode::own_rtc()
}

#[tauri::command(async)]
pub fn ownrtc_open(events: Channel<InvokeResponseBody>) -> Result<u32, String> {
    crate::ownrtc::open(events)
}

#[tauri::command(async)]
pub fn ownrtc_offer(id: u32, media: Vec<MediaSpec>, channels: Vec<ChannelSpec>) -> Result<OfferOut, String> {
    crate::ownrtc::offer(id, media, channels)
}

#[tauri::command(async)]
pub fn ownrtc_accept_answer(id: u32, sdp: String) -> Result<Vec<MediaInfo>, String> {
    crate::ownrtc::accept_answer(id, sdp)
}

#[tauri::command(async)]
pub fn ownrtc_accept_offer(id: u32, sdp: String) -> Result<AnswerOut, String> {
    crate::ownrtc::accept_offer(id, sdp)
}

#[tauri::command(async)]
pub fn ownrtc_new_channel(id: u32, spec: ChannelSpec) -> Result<u32, String> {
    crate::ownrtc::new_channel(id, spec)
}

#[tauri::command(async)]
pub fn ownrtc_stats(id: u32) -> Result<serde_json::Value, String> {
    crate::ownrtc::stats(id)
}

fn header<'a>(request: &'a Request<'_>, name: &str) -> Result<&'a str, String> {
    request.headers().get(name).and_then(|v| v.to_str().ok()).ok_or_else(|| format!("No {name} header"))
}

/// A squeezed picture or piece of sound, as raw bytes; `x-ownrtc` says what and
/// where to. (Kept in order: not async — it only hands the bytes over.)
#[tauri::command]
pub fn ownrtc_write(request: Request<'_>) -> Result<(), String> {
    let h = header(&request, "x-ownrtc")?.to_string();
    match request.body() {
        InvokeBody::Raw(bytes) => crate::ownrtc::write(&h, bytes.clone()),
        _ => Err("Expected media bytes".to_string()),
    }
}

/// A data-channel message, as raw bytes; `x-ownrtc` = `id:cid:0|1`.
#[tauri::command]
pub fn ownrtc_send(request: Request<'_>) -> Result<(), String> {
    let h = header(&request, "x-ownrtc")?.to_string();
    match request.body() {
        InvokeBody::Raw(bytes) => crate::ownrtc::send(&h, bytes.clone()),
        _ => Err("Expected message bytes".to_string()),
    }
}

#[tauri::command]
pub fn ownrtc_close_channel(id: u32, cid: u32) {
    crate::ownrtc::close_channel(id, cid);
}

#[tauri::command]
pub fn ownrtc_keyframe(id: u32, mid: String) {
    crate::ownrtc::keyframe(id, mid);
}

#[tauri::command]
pub fn ownrtc_close(id: u32) {
    crate::ownrtc::close(id);
}
