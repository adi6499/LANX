//! LANX 3.14.0: the wallpaper screen (a live wallpaper over the whole screen, with a big
//! clock). Its picture or video can be one of your own files or come from a link; either
//! way LANX keeps one copy in its data folder (so it is there without the internet and
//! even if the original moves), separate from the wallpaper behind the chats.
//!
//! A link is fetched with the system's own downloader (curl; wget on Linux PCs without
//! curl), never through a shell: only https, a few redirects, at most 150 MB and three
//! minutes. What arrives is kept only if it really is a picture or a video (by its first
//! bytes, not by what the link calls itself).

use super::wallpaper::{pick_into, WallpaperFile, MAX_WALLPAPER_BYTES};
use super::{err, AppState};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::{AppHandle, State};

pub fn wallscreen_dir() -> PathBuf {
    // Unit tests never touch the real LANX folder.
    if cfg!(test) {
        return std::env::temp_dir().join("lanx-test-wallscreen");
    }
    crate::storage::data_dir(crate::testmode::profile().as_deref()).join("wallscreen")
}

/// Lets the user pick a picture or video and keeps a copy for the wallpaper screen.
#[tauri::command]
pub async fn pick_wallscreen_file(app: AppHandle, state: State<'_, AppState>) -> Result<Option<WallpaperFile>, String> {
    state.network.privacy.guard()?;
    pick_into(&app, wallscreen_dir(), "screen").await
}

/// Removes the kept copy (when a built-in wallpaper is chosen instead).
#[tauri::command(async)]
pub fn clear_wallscreen_file() -> Result<(), String> {
    if let Ok(rd) = std::fs::read_dir(wallscreen_dir()) {
        for e in rd.flatten() {
            let _ = std::fs::remove_file(e.path());
        }
    }
    Ok(())
}

/// A link LANX is willing to fetch: https, an ordinary web address, nothing odd in it.
pub fn clean_link(url: &str) -> Result<String, String> {
    let u = url.trim();
    let Some(rest) = u.strip_prefix("https://") else {
        return Err("Use a link that starts with https://".to_string());
    };
    if u.len() > 2000 || u.chars().any(|c| c.is_control() || c.is_whitespace() || matches!(c, '"' | '\'' | '`' | '<' | '>' | '\\')) {
        return Err("That doesn't look like a link to a picture or video.".to_string());
    }
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    let plain = host.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':'));
    if host.is_empty() || !plain || !host.contains('.') || host.starts_with(['.', '-', ':']) {
        return Err("That doesn't look like a link to a picture or video.".to_string());
    }
    Ok(u.to_string())
}

/// What a file is, by its first bytes: (extension, "image" | "video").
pub fn sniff(h: &[u8]) -> Option<(&'static str, &'static str)> {
    if h.starts_with(&[0x89, b'P', b'N', b'G']) {
        return Some(("png", "image"));
    }
    if h.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some(("jpg", "image"));
    }
    if h.starts_with(b"GIF87a") || h.starts_with(b"GIF89a") {
        return Some(("gif", "image"));
    }
    if h.len() >= 12 && &h[..4] == b"RIFF" && &h[8..12] == b"WEBP" {
        return Some(("webp", "image"));
    }
    if h.len() >= 12 && &h[4..8] == b"ftyp" {
        return match &h[8..12] {
            b"qt  " => Some(("mov", "video")),
            // Pictures in a video wrapper (iPhone photos, AVIF): the window can't show them.
            b"heic" | b"heix" | b"mif1" | b"msf1" | b"avif" | b"avis" => None,
            _ => Some(("mp4", "video")),
        };
    }
    if h.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) {
        return Some(("webm", "video"));
    }
    None
}

/// A name to show for a link's file: its last part, ending in what the file really is.
pub fn link_name(url: &str, ext: &str) -> String {
    let whole = url.split(['?', '#']).next().unwrap_or("");
    // (What comes after the host name: a link with no path has no file name.)
    let path = whole.strip_prefix("https://").unwrap_or(whole).split_once('/').map(|(_, p)| p).unwrap_or("");
    let last = path.trim_end_matches('/').rsplit('/').next().unwrap_or("");
    let stem = last.rsplit_once('.').map(|(s, _)| s).unwrap_or(last);
    let stem: String = stem.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ' ')).take(60).collect();
    let stem = stem.trim();
    if stem.is_empty() {
        format!("From a link.{ext}")
    } else {
        format!("{stem}.{ext}")
    }
}

#[cfg(not(windows))]
fn on_path(name: &str) -> bool {
    std::env::var_os("PATH").is_some_and(|p| std::env::split_paths(&p).any(|d| d.join(name).is_file()))
}

/// The system's downloader, told to fetch `url` into `target` (https only).
fn downloader(url: &str, target: &Path) -> Result<std::process::Command, String> {
    use std::process::Command;
    const AGENT: &str = "Mozilla/5.0 (LANX wallpaper)";
    let curl_args = ["-fsSL", "--proto", "=https", "--proto-redir", "=https", "--max-redirs", "5", "--connect-timeout", "20", "-A", AGENT, "-o"];
    #[cfg(windows)]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
        let curl = Path::new(&root).join("System32").join("curl.exe");
        let mut cmd = if curl.is_file() {
            let mut c = Command::new(curl);
            c.args(curl_args).arg(target).arg("--").arg(url);
            c
        } else {
            // Windows from before 2018 has no curl. The link and the file are handed over
            // as values (never as part of the script).
            let mut c = Command::new("powershell.exe");
            c.args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "$ProgressPreference = 'SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol = 'Tls12'; Invoke-WebRequest -Uri $env:LANX_LINK -OutFile $env:LANX_OUT -UseBasicParsing -TimeoutSec 60 -MaximumRedirection 5 -Headers @{ 'User-Agent' = $env:LANX_AGENT }",
            ])
            .env("LANX_LINK", url)
            .env("LANX_OUT", target)
            .env("LANX_AGENT", AGENT);
            c
        };
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    };
    #[cfg(not(windows))]
    let mut cmd = if on_path("curl") {
        let mut c = Command::new("curl");
        c.args(curl_args).arg(target).arg("--").arg(url);
        c
    } else if on_path("wget") {
        // (Many Linux Mint PCs have wget and no curl.)
        let mut c = Command::new("wget");
        c.args(["-q", "--https-only", "--max-redirect=5", "--timeout=30", "--tries=2", "-U", AGENT, "-O"]).arg(target).arg("--").arg(url);
        c
    } else {
        return Err("This PC has neither curl nor wget to fetch a link. Download the picture yourself and choose the file instead.".to_string());
    };
    cmd.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    Ok(cmd)
}

/// Fetches the link into `part`, stopping a download that grows too big or takes too long.
fn fetch(url: &str, part: &Path, max_bytes: u64, max_time: Duration) -> Result<(), String> {
    let mut child = downloader(url, part)?.spawn().map_err(|_| "LANX could not start the download.".to_string())?;
    let started = Instant::now();
    let stop = |child: &mut std::process::Child, why: &str| {
        let _ = child.kill();
        let _ = child.wait();
        let _ = std::fs::remove_file(part);
        Err(why.to_string())
    };
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(_)) => {
                let _ = std::fs::remove_file(part);
                return Err("The link could not be downloaded (no internet, or the link is wrong).".to_string());
            }
            Ok(None) => {}
            Err(e) => return stop(&mut child, &err(e)),
        }
        if std::fs::metadata(part).map(|m| m.len()).unwrap_or(0) > max_bytes {
            return stop(&mut child, "That file is over 150 MB. A shorter clip works better as a wallpaper.");
        }
        if started.elapsed() > max_time {
            return stop(&mut child, "The download took too long. Try a smaller picture or video.");
        }
        std::thread::sleep(Duration::from_millis(150));
    }
}

/// What arrived in `part` becomes the one wallpaper-screen file in `dir`, if it is a
/// picture or a video.
pub fn keep_download(part: &Path, dir: &Path, url: &str) -> Result<WallpaperFile, String> {
    use std::io::Read;
    let bytes = std::fs::metadata(part).map(|m| m.len()).unwrap_or(0);
    let mut head = [0u8; 64];
    let n = std::fs::File::open(part).and_then(|mut f| f.read(&mut head)).unwrap_or(0);
    let found = if bytes > MAX_WALLPAPER_BYTES { None } else { sniff(&head[..n]) };
    let Some((ext, kind)) = found else {
        let _ = std::fs::remove_file(part);
        let page = String::from_utf8_lossy(&head[..n]).trim_start().starts_with('<');
        return Err(if bytes > MAX_WALLPAPER_BYTES {
            "That file is over 150 MB. A shorter clip works better as a wallpaper.".to_string()
        } else if page {
            "That link is a web page, not a picture or video. Open the picture itself, copy its address (right-click → Copy image address) and paste that.".to_string()
        } else {
            "That link is not a picture or video LANX can show. Use a png, jpg, gif or webp picture, or an mp4, mov or webm video.".to_string()
        });
    };
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            if e.path() != part {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    let dest = dir.join(format!("screen.{ext}"));
    std::fs::rename(part, &dest).map_err(err)?;
    Ok(WallpaperFile { path: dest.to_string_lossy().to_string(), name: link_name(url, ext), kind: kind.to_string(), bytes })
}

/// Downloads the picture or video behind a link and keeps it for the wallpaper screen.
#[tauri::command]
pub async fn wallscreen_from_link(state: State<'_, AppState>, url: String) -> Result<WallpaperFile, String> {
    state.network.privacy.guard()?;
    let url = clean_link(&url)?;
    let dir = wallscreen_dir();
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(&dir).map_err(err)?;
        let part = dir.join("download.lanxpart");
        let _ = std::fs::remove_file(&part);
        fetch(&url, &part, MAX_WALLPAPER_BYTES, Duration::from_secs(180))?;
        keep_download(&part, &dir, &url)
    })
    .await
    .map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_ordinary_https_links_are_fetched() {
        assert_eq!(clean_link("  https://example.com/a/b.jpg?x=1 ").as_deref(), Ok("https://example.com/a/b.jpg?x=1"));
        assert!(clean_link("https://images.example.co.in:8443/p.png").is_ok());
        for bad in [
            "http://example.com/a.jpg",
            "file:///C:/Windows/win.ini",
            "example.com/a.jpg",
            "https://",
            "https:///a.jpg",
            "https://localhost/a.jpg",
            "https://user:pw@example.com/a.jpg",
            "https://example.com/a b.jpg",
            "https://example.com/a.jpg\n-o/etc/passwd",
            "https://example.com/\"; rm -rf",
            "https://-example.com/a.jpg",
            "-o https://example.com/a.jpg",
            "https://exa<mple.com/a.jpg",
        ] {
            assert!(clean_link(bad).is_err(), "{bad}");
        }
        assert!(clean_link(&format!("https://example.com/{}", "a".repeat(2100))).is_err());
    }

    #[test]
    fn a_file_is_known_by_its_first_bytes() {
        assert_eq!(sniff(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]), Some(("png", "image")));
        assert_eq!(sniff(&[0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10]), Some(("jpg", "image")));
        assert_eq!(sniff(b"GIF89a\x01\x00"), Some(("gif", "image")));
        assert_eq!(sniff(b"RIFF\x24\x00\x00\x00WEBPVP8 "), Some(("webp", "image")));
        assert_eq!(sniff(b"\x00\x00\x00\x20ftypisom\x00\x00\x02\x00"), Some(("mp4", "video")));
        assert_eq!(sniff(b"\x00\x00\x00\x14ftypqt  \x00\x00\x00\x00"), Some(("mov", "video")));
        assert_eq!(sniff(&[0x1A, 0x45, 0xDF, 0xA3, 0x9F, 0x42]), Some(("webm", "video")));
        // not pictures or videos LANX can show
        assert_eq!(sniff(b"<!DOCTYPE html><html>"), None);
        assert_eq!(sniff(b"\x00\x00\x00\x1cftypavif\x00\x00\x00\x00"), None);
        assert_eq!(sniff(b"RIFF\x24\x00\x00\x00WAVEfmt "), None);
        assert_eq!(sniff(b"MZ\x90\x00"), None);
        assert_eq!(sniff(b""), None);
    }

    #[test]
    fn the_name_shown_ends_in_what_the_file_is() {
        assert_eq!(link_name("https://example.com/photos/Sunset over hills.JPEG?w=1920", "jpg"), "Sunset over hills.jpg");
        assert_eq!(link_name("https://example.com/v/clip.php", "mp4"), "clip.mp4");
        assert_eq!(link_name("https://example.com/", "png"), "From a link.png");
        assert_eq!(link_name("https://example.com", "png"), "From a link.png");
        assert_eq!(link_name("https://example.com/%E2%9C%93/", "webp"), "E29C93.webp");
    }

    #[test]
    fn what_arrives_is_kept_only_if_it_is_a_picture_or_video() {
        let dir = tempfile::tempdir().unwrap();
        let part = dir.path().join("download.lanxpart");
        // an old wallpaper is replaced by the new one
        std::fs::write(dir.path().join("screen.png"), b"old").unwrap();
        let mut jpg = vec![0xFF, 0xD8, 0xFF, 0xE0];
        jpg.extend_from_slice(&[7u8; 2000]);
        std::fs::write(&part, &jpg).unwrap();
        let kept = keep_download(&part, dir.path(), "https://example.com/a/hills.png").unwrap();
        assert_eq!((kept.kind.as_str(), kept.name.as_str(), kept.bytes), ("image", "hills.jpg", 2004));
        assert!(kept.path.ends_with("screen.jpg"));
        let names: Vec<String> = std::fs::read_dir(dir.path()).unwrap().flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
        assert_eq!(names, vec!["screen.jpg".to_string()]);
        // a web page is refused, and the wallpaper there stays
        std::fs::write(&part, b"<!doctype html><html><body>a page</body></html>").unwrap();
        let refused = keep_download(&part, dir.path(), "https://example.com/page").unwrap_err();
        assert!(refused.contains("web page"), "{refused}");
        assert!(!part.exists());
        assert!(dir.path().join("screen.jpg").exists());
        // so is any other kind of file, with its own reason
        std::fs::write(&part, b"%PDF-1.7 not a picture at all").unwrap();
        let refused = keep_download(&part, dir.path(), "https://example.com/a.pdf").unwrap_err();
        assert!(refused.contains("not a picture or video LANX can show"), "{refused}");
        assert!(!part.exists() && dir.path().join("screen.jpg").exists());
    }
}
