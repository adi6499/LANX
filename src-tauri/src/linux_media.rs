//! LANX 3.12.0: the camera and microphone in LANX for Linux.
//!
//! WebKitGTK — the browser engine LANX uses on Linux — keeps the camera and
//! microphone switched off, and refuses every request for them unless the
//! program answers "yes". LANX never answered, so on Linux hand gestures could
//! not start (and nothing could use the microphone). Here they are switched on,
//! and requests from LANX's own page (never from anywhere else) are allowed.
#![cfg(target_os = "linux")]

use webkit2gtk::glib::prelude::*;
use webkit2gtk::{DeviceInfoPermissionRequest, PermissionRequestExt, SettingsExt, UserMediaPermissionRequest, WebViewExt};

/// Pages that may use the camera: LANX's own (and the development server while LANX is being built).
fn ours(uri: &str) -> bool {
    uri.starts_with("tauri://") || (cfg!(debug_assertions) && uri.starts_with("http://localhost:"))
}

pub fn enable(window: &tauri::WebviewWindow) {
    let pretend = crate::testmode::fake_camera();
    let r = window.with_webview(move |wv| {
        let view = wv.inner();
        if let Some(s) = WebViewExt::settings(&view) {
            s.set_enable_media_stream(true);
            s.set_enable_mediasource(true);
            // (Calls need WebRTC, which Ubuntu's and Mint's WebKitGTK are built without;
            // where the engine has it, this turns it on.)
            s.set_enable_webrtc(true);
            s.set_media_playback_requires_user_gesture(false);
            // Test copies on a PC without a camera: WebKit's pretend camera and microphone.
            if pretend {
                s.set_enable_mock_capture_devices(true);
            }
        }
        view.connect_permission_request(|view, req| {
            let media = req.is::<UserMediaPermissionRequest>() || req.is::<DeviceInfoPermissionRequest>();
            if !media {
                return false;
            }
            if view.uri().is_some_and(|u| ours(u.as_str())) {
                req.allow();
            } else {
                req.deny();
            }
            true
        });
    });
    if let Err(e) = r {
        eprintln!("[LANX] camera and microphone could not be switched on: {e}");
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn only_lanx_itself_gets_the_camera() {
        assert!(super::ours("tauri://localhost/index.html"));
        assert!(!super::ours("https://example.com/"));
        assert!(!super::ours("file:///home/x/page.html"));
    }
}
