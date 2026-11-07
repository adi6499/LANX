//! LANX 3.9.0: Watch together — this PC lends one video file to the colleagues
//! watching with it. A small web server on the office network serves only that
//! file, behind a random code in the address, in pieces (HTTP ranges) so their
//! video starts at once and can jump anywhere. Nothing else is ever served.

use rand::RngCore;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

#[derive(Clone)]
struct Lent {
    token: String,
    path: PathBuf,
    size: u64,
    mime: &'static str,
}
static LENT: parking_lot::Mutex<Option<Lent>> = parking_lot::Mutex::new(None);
static PORT: parking_lot::Mutex<Option<u16>> = parking_lot::Mutex::new(None);

/// What the window tells colleagues: where the video is (on this PC's address).
#[derive(Debug, Clone, Serialize)]
pub struct WatchServe {
    pub port: u16,
    pub token: String,
    pub name: String,
    pub size: u64,
    pub mime: String,
}

pub fn mime_for(name: &str) -> Option<&'static str> {
    let ext = Path::new(name).extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "ogv" => "video/ogg",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        _ => return None,
    })
}

/// `Range: bytes=…` → the first and last byte to send (inclusive), or None for the whole file.
pub fn parse_range(header: &str, size: u64) -> Option<(u64, u64)> {
    let spec = header.trim().strip_prefix("bytes=")?.split(',').next()?.trim();
    let (a, b) = spec.split_once('-')?;
    if size == 0 {
        return None;
    }
    let (start, end) = if a.is_empty() {
        let n: u64 = b.parse().ok()?;
        (size.saturating_sub(n), size - 1)
    } else {
        let start: u64 = a.parse().ok()?;
        let end = if b.is_empty() { size - 1 } else { b.parse::<u64>().ok()?.min(size - 1) };
        (start, end)
    };
    (start <= end && start < size).then_some((start, end))
}

/// Lends this file (instead of any earlier one) and says where it is.
pub async fn serve(path: &str) -> Result<WatchServe, String> {
    let p = PathBuf::from(path);
    let meta = tokio::fs::metadata(&p).await.map_err(|_| "That file can't be opened.".to_string())?;
    if !meta.is_file() {
        return Err("That isn't a file.".to_string());
    }
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("video").to_string();
    let mime = mime_for(&name).ok_or("LANX can show MP4, WebM, MOV and MKV videos (and MP3 / M4A sound).")?;
    let mut bytes = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    let token = hex::encode(bytes);
    *LENT.lock() = Some(Lent { token: token.clone(), path: p, size: meta.len(), mime });
    let port = ensure_server().await?;
    Ok(WatchServe { port, token, name, size: meta.len(), mime: mime.to_string() })
}

/// Stops lending (the server stays, serving nothing).
pub fn stop() {
    *LENT.lock() = None;
}

async fn ensure_server() -> Result<u16, String> {
    if let Some(p) = *PORT.lock() {
        return Ok(p);
    }
    let listener = TcpListener::bind((crate::testmode::bind_addr(), 0)).await.map_err(|e| format!("Couldn't open the video server: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    *PORT.lock() = Some(port);
    tokio::spawn(async move {
        loop {
            if let Ok((s, _)) = listener.accept().await {
                tokio::spawn(async move {
                    let _ = tokio::time::timeout(Duration::from_secs(3600), handle(s)).await;
                });
            }
        }
    });
    Ok(port)
}

async fn handle(mut s: TcpStream) -> std::io::Result<()> {
    let _ = s.set_nodelay(true);
    // The request head (no body is ever needed).
    let mut head = Vec::with_capacity(1024);
    let mut buf = [0u8; 1024];
    loop {
        let n = tokio::time::timeout(Duration::from_secs(10), s.read(&mut buf)).await.map_err(|_| std::io::ErrorKind::TimedOut)??;
        if n == 0 {
            return Ok(());
        }
        head.extend_from_slice(&buf[..n]);
        if head.windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
        if head.len() > 16 * 1024 {
            return Ok(());
        }
    }
    let text = String::from_utf8_lossy(&head);
    let mut lines = text.split("\r\n");
    let first = lines.next().unwrap_or("");
    let mut parts = first.split(' ');
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");
    let range = lines.find_map(|l| l.split_once(':').filter(|(k, _)| k.trim().eq_ignore_ascii_case("range")).map(|(_, v)| v.trim().to_string()));

    let lent = LENT.lock().clone();
    let ok_token = lent.as_ref().is_some_and(|l| target.strip_prefix("/w/").and_then(|r| r.split('/').next()) == Some(l.token.as_str()));
    if (method != "GET" && method != "HEAD") || !ok_token {
        s.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await?;
        return Ok(());
    }
    let l = lent.expect("checked");
    let (start, end, status) = match range.as_deref().map(|r| parse_range(r, l.size)) {
        Some(Some((a, b))) => (a, b, "206 Partial Content"),
        Some(None) => {
            let h = format!("HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", l.size);
            s.write_all(h.as_bytes()).await?;
            return Ok(());
        }
        None => (0, l.size.saturating_sub(1), "200 OK"),
    };
    let len = if l.size == 0 { 0 } else { end - start + 1 };
    let mut h = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {}\r\nContent-Length: {len}\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store\r\nConnection: close\r\n",
        l.mime
    );
    if status.starts_with("206") {
        h.push_str(&format!("Content-Range: bytes {start}-{end}/{}\r\n", l.size));
    }
    h.push_str("\r\n");
    s.write_all(h.as_bytes()).await?;
    if method == "HEAD" || len == 0 {
        return Ok(());
    }
    let mut f = tokio::fs::File::open(&l.path).await?;
    f.seek(std::io::SeekFrom::Start(start)).await?;
    let mut left = len;
    let mut chunk = vec![0u8; 256 * 1024];
    while left > 0 {
        let want = (left as usize).min(chunk.len());
        let n = f.read(&mut chunk[..want]).await?;
        if n == 0 {
            break;
        }
        s.write_all(&chunk[..n]).await?;
        left -= n as u64;
    }
    s.flush().await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges() {
        assert_eq!(parse_range("bytes=0-", 100), Some((0, 99)));
        assert_eq!(parse_range("bytes=10-19", 100), Some((10, 19)));
        assert_eq!(parse_range("bytes=90-200", 100), Some((90, 99)));
        assert_eq!(parse_range("bytes=-10", 100), Some((90, 99)));
        assert_eq!(parse_range("bytes=100-", 100), None);
        assert_eq!(parse_range("chunks=1-2", 100), None);
        assert_eq!(mime_for("Training Day 1.MP4"), Some("video/mp4"));
        assert_eq!(mime_for("notes.txt"), None);
    }

    #[tokio::test]
    async fn serves_only_the_lent_file_in_pieces() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("clip.mp4");
        std::fs::write(&p, (0..=255u8).cycle().take(10_000).collect::<Vec<_>>()).unwrap();
        let w = serve(p.to_str().unwrap()).await.unwrap();
        assert_eq!(w.size, 10_000);
        let get = |path: String, range: Option<&'static str>| async move {
            let mut s = TcpStream::connect(("127.0.0.1", w.port)).await.unwrap();
            let r = range.map(|r| format!("Range: {r}\r\n")).unwrap_or_default();
            s.write_all(format!("GET {path} HTTP/1.1\r\nHost: x\r\n{r}\r\n").as_bytes()).await.unwrap();
            let mut out = Vec::new();
            s.read_to_end(&mut out).await.unwrap();
            out
        };
        let part = get(format!("/w/{}/clip.mp4", w.token), Some("bytes=256-511")).await;
        let text = String::from_utf8_lossy(&part);
        assert!(text.starts_with("HTTP/1.1 206"), "{text}");
        assert!(text.contains("Content-Range: bytes 256-511/10000"));
        let body = &part[part.windows(4).position(|x| x == b"\r\n\r\n").unwrap() + 4..];
        assert_eq!(body.len(), 256);
        assert_eq!(body[0], 0);
        assert_eq!(body[255], 255);
        // A wrong code gets nothing.
        let no = get("/w/0000/clip.mp4".to_string(), None).await;
        assert!(String::from_utf8_lossy(&no).starts_with("HTTP/1.1 404"));
        stop();
        let gone = get(format!("/w/{}/clip.mp4", w.token), None).await;
        assert!(String::from_utf8_lossy(&gone).starts_with("HTTP/1.1 404"));
    }
}
