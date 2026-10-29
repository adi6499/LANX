//! The small web server behind "LANX on your phone": plain HTTP/1.1 on the
//! office network, written on tokio directly (no web framework, so LANX stays
//! one small program). It serves the phone page, pairs phones, takes uploads,
//! hands out files, and upgrades `/ws` to a WebSocket (see ws.rs).
//!
//! Only phones on the office network can use it: requests from outside private
//! address ranges are dropped, and everything but the page and pairing needs
//! the token a phone received when it was allowed in.

use super::{PhoneDevice, PhoneService, device_name_from_ua};
use serde_json::{Value, json};
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::net::TcpStream;

const MAX_HEAD: usize = 16 * 1024;
const MAX_JSON_BODY: u64 = 1024 * 1024;
/// A photo or video from the phone may be this big.
const MAX_UPLOAD: u64 = 1024 * 1024 * 1024;
const IDLE: Duration = Duration::from_secs(30);
const CHUNK: usize = 256 * 1024;

// The phone page, built by `npm run build:phone` into src-tauri/phone-dist;
// build.rs lists every file there as PHONE_FILES (and writes a placeholder
// page when it has not been built yet).
include!(concat!(env!("OUT_DIR"), "/phone_assets.rs"));

const CSP: &str = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

pub(super) struct Request {
    pub method: String,
    pub path: String,
    pub query: String,
    pub headers: Vec<(String, String)>,
    pub body_len: u64,
    pub http10: bool,
}

impl Request {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(n, _)| n == name).map(|(_, v)| v.as_str())
    }

    pub fn query_param(&self, key: &str) -> Option<String> {
        self.query
            .split('&')
            .filter_map(|kv| kv.split_once('=').or(Some((kv, ""))))
            .find(|(k, _)| *k == key)
            .map(|(_, v)| percent_decode(v))
    }

    fn wants_close(&self) -> bool {
        self.http10 || self.header("connection").is_some_and(|c| c.to_ascii_lowercase().contains("close"))
    }

    fn cookie(&self, name: &str) -> Option<String> {
        self.header("cookie")?
            .split(';')
            .filter_map(|kv| kv.trim().split_once('='))
            .find(|(k, _)| *k == name)
            .map(|(_, v)| v.trim().to_string())
    }

    /// The phone's token: a cookie (pictures, downloads) or a bearer header.
    pub fn token(&self) -> Option<String> {
        if let Some(a) = self.header("authorization") {
            if let Some(t) = a.strip_prefix("Bearer ").or_else(|| a.strip_prefix("bearer ")) {
                return Some(t.trim().to_string());
            }
        }
        self.cookie("lanx_phone")
    }
}

pub(super) enum Body {
    Bytes(Vec<u8>),
    File { file: tokio::fs::File, start: u64, len: u64 },
}

pub(super) struct Response {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Body,
}

impl Response {
    pub fn new(status: u16, content_type: &str, body: Vec<u8>) -> Self {
        Self {
            status,
            headers: vec![("Content-Type".to_string(), content_type.to_string())],
            body: Body::Bytes(body),
        }
    }

    pub fn json(status: u16, v: Value) -> Self {
        Self::new(status, "application/json; charset=utf-8", v.to_string().into_bytes())
    }

    pub fn error(status: u16, text: &str) -> Self {
        Self::json(status, json!({ "error": text }))
    }

    pub fn header(mut self, name: &str, value: &str) -> Self {
        self.headers.push((name.to_string(), value.to_string()));
        self
    }
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        202 => "Accepted",
        204 => "No Content",
        206 => "Partial Content",
        304 => "Not Modified",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        408 => "Request Timeout",
        410 => "Gone",
        413 => "Payload Too Large",
        416 => "Range Not Satisfiable",
        429 => "Too Many Requests",
        431 => "Request Header Fields Too Large",
        500 => "Internal Server Error",
        _ => "OK",
    }
}

/// Phones on the office network only (private, link-local and loopback
/// addresses); anything else — which could only arrive through a router
/// someone opened up — is dropped without an answer.
pub(super) fn is_local(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || (o[0] == 100 && (64..=127).contains(&o[1]))
        }
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_local(IpAddr::V4(v4));
            }
            let s = v6.segments();
            v6.is_loopback() || (s[0] & 0xfe00) == 0xfc00 || (s[0] & 0xffc0) == 0xfe80
        }
    }
}

pub(super) fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = &s[i + 1..i + 3];
                if let Ok(v) = u8::from_str_radix(hex, 16) {
                    out.push(v);
                    i += 3;
                    continue;
                }
                out.push(b'%');
                i += 1;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

fn percent_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

pub(super) fn content_type_for(name: &str) -> &'static str {
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "heic" => "image/heic",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "wav" => "audio/wav",
        "ogg" | "oga" => "audio/ogg",
        "pdf" => "application/pdf",
        "txt" | "log" | "md" => "text/plain; charset=utf-8",
        "zip" => "application/zip",
        _ => "application/octet-stream",
    }
}

fn find_head_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n").map(|i| i + 4)
}

fn parse_head(head: &[u8]) -> Option<Request> {
    let mut headers = [httparse::EMPTY_HEADER; 64];
    let mut req = httparse::Request::new(&mut headers);
    match req.parse(head) {
        Ok(httparse::Status::Complete(_)) => {}
        _ => return None,
    }
    let method = req.method?.to_string();
    let target = req.path?.to_string();
    let http10 = req.version == Some(0);
    let (path, query) = match target.split_once('?') {
        Some((p, q)) => (p.to_string(), q.to_string()),
        None => (target.clone(), String::new()),
    };
    let mut out = Vec::with_capacity(req.headers.len());
    for h in req.headers.iter() {
        out.push((h.name.to_ascii_lowercase(), String::from_utf8_lossy(h.value).trim().to_string()));
    }
    let body_len = out
        .iter()
        .find(|(n, _)| n == "content-length")
        .and_then(|(_, v)| v.parse::<u64>().ok())
        .unwrap_or(0);
    Some(Request { method, path: percent_decode(&path), query, headers: out, body_len, http10 })
}

/// Reads the request body (what the head left in `buf` first).
struct BodyReader<'a> {
    stream: &'a mut TcpStream,
    buf: &'a mut Vec<u8>,
    remaining: u64,
}

impl BodyReader<'_> {
    async fn next_chunk(&mut self, out: &mut Vec<u8>) -> std::io::Result<usize> {
        if self.remaining == 0 {
            return Ok(0);
        }
        if !self.buf.is_empty() {
            let n = (self.buf.len() as u64).min(self.remaining) as usize;
            out.extend_from_slice(&self.buf[..n]);
            self.buf.drain(..n);
            self.remaining -= n as u64;
            return Ok(n);
        }
        let want = (self.remaining.min(CHUNK as u64)) as usize;
        let mut tmp = vec![0u8; want];
        let n = tokio::time::timeout(IDLE, self.stream.read(&mut tmp))
            .await
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::TimedOut, "body timeout"))??;
        if n == 0 {
            return Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "body cut short"));
        }
        out.extend_from_slice(&tmp[..n]);
        self.remaining -= n as u64;
        Ok(n)
    }

    async fn read_all(&mut self) -> std::io::Result<Vec<u8>> {
        let mut out = Vec::with_capacity(self.remaining.min(CHUNK as u64) as usize);
        while self.remaining > 0 {
            self.next_chunk(&mut out).await?;
        }
        Ok(out)
    }

    async fn read_json(&mut self) -> Result<Value, Response> {
        if self.remaining > MAX_JSON_BODY {
            return Err(Response::error(413, "too large"));
        }
        let bytes = self.read_all().await.map_err(|_| Response::error(400, "body cut short"))?;
        serde_json::from_slice(&bytes).map_err(|_| Response::error(400, "bad json"))
    }

    async fn copy_to_file(&mut self, file: &mut tokio::fs::File) -> std::io::Result<u64> {
        let mut total = 0u64;
        let mut chunk = Vec::with_capacity(CHUNK);
        while self.remaining > 0 {
            chunk.clear();
            let n = self.next_chunk(&mut chunk).await?;
            file.write_all(&chunk[..n]).await?;
            total += n as u64;
        }
        file.flush().await?;
        Ok(total)
    }
}

async fn write_response(stream: &mut TcpStream, resp: Response, close: bool, head_only: bool) -> std::io::Result<()> {
    let len = match &resp.body {
        Body::Bytes(b) => b.len() as u64,
        Body::File { len, .. } => *len,
    };
    let mut head = format!("HTTP/1.1 {} {}\r\n", resp.status, reason(resp.status));
    for (n, v) in &resp.headers {
        head.push_str(&format!("{}: {}\r\n", n, v));
    }
    head.push_str(&format!("Content-Length: {}\r\n", len));
    head.push_str("X-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\n");
    head.push_str(if close { "Connection: close\r\n" } else { "Connection: keep-alive\r\n" });
    head.push_str("\r\n");
    stream.write_all(head.as_bytes()).await?;
    if head_only {
        return stream.flush().await;
    }
    match resp.body {
        Body::Bytes(b) => stream.write_all(&b).await?,
        Body::File { mut file, start, len } => {
            file.seek(std::io::SeekFrom::Start(start)).await?;
            let mut left = len;
            let mut buf = vec![0u8; CHUNK];
            while left > 0 {
                let want = (left.min(CHUNK as u64)) as usize;
                let n = file.read(&mut buf[..want]).await?;
                if n == 0 {
                    break;
                }
                stream.write_all(&buf[..n]).await?;
                left -= n as u64;
            }
        }
    }
    stream.flush().await
}

/// One TCP connection: requests until the browser closes it (or a WebSocket
/// upgrade hands it to ws.rs).
pub(super) async fn handle(svc: PhoneService, mut stream: TcpStream, peer: SocketAddr) {
    if !is_local(peer.ip()) {
        return;
    }
    let _ = stream.set_nodelay(true);
    let mut buf: Vec<u8> = Vec::with_capacity(4096);
    loop {
        let head_end = loop {
            if let Some(i) = find_head_end(&buf) {
                break i;
            }
            if buf.len() > MAX_HEAD {
                let _ = write_response(&mut stream, Response::error(431, "headers too large"), true, false).await;
                return;
            }
            let mut tmp = [0u8; 4096];
            let n = match tokio::time::timeout(IDLE, stream.read(&mut tmp)).await {
                Ok(Ok(n)) if n > 0 => n,
                _ => return,
            };
            buf.extend_from_slice(&tmp[..n]);
        };
        let Some(req) = parse_head(&buf[..head_end]) else {
            let _ = write_response(&mut stream, Response::error(400, "bad request"), true, false).await;
            return;
        };
        buf.drain(..head_end);

        if req.path == "/ws" && req.header("upgrade").is_some_and(|u| u.eq_ignore_ascii_case("websocket")) {
            let Some(key) = req.header("sec-websocket-key").map(|k| k.to_string()) else {
                let _ = write_response(&mut stream, Response::error(400, "missing key"), true, false).await;
                return;
            };
            let leftover = std::mem::take(&mut buf);
            super::ws::serve(svc, stream, leftover, &key, peer.ip().to_string()).await;
            return;
        }

        let head_only = req.method == "HEAD";
        let mut body = BodyReader { stream: &mut stream, buf: &mut buf, remaining: req.body_len };
        let resp = route(&svc, &req, &mut body).await;
        let unread = body.remaining;
        let close = req.wants_close() || unread > 0;
        if write_response(&mut stream, resp, close, head_only).await.is_err() {
            return;
        }
        if unread > 0 {
            // A refused upload: take the rest of the body before closing, or
            // Windows resets the connection and the browser never sees the
            // answer. Something huge is just dropped.
            if unread <= 4 * 1024 * 1024 {
                let mut body = BodyReader { stream: &mut stream, buf: &mut buf, remaining: unread };
                let mut sink = Vec::new();
                while body.remaining > 0 {
                    sink.clear();
                    if body.next_chunk(&mut sink).await.is_err() {
                        break;
                    }
                }
            }
            return;
        }
        if close {
            return;
        }
    }
}

/// A file of the page: (bytes, content type, long-lived cache).
fn static_file(path: &str) -> Option<(&'static [u8], &'static str, bool)> {
    let rel = match path {
        "/" | "/index.html" => "phone.html",
        p => p.strip_prefix('/')?,
    };
    if rel.is_empty() || rel.contains("..") {
        return None;
    }
    PHONE_FILES
        .iter()
        .find(|(name, _)| *name == rel)
        .map(|(name, bytes)| (*bytes, content_type_for(name), name.starts_with("assets/")))
}

async fn route(svc: &PhoneService, req: &Request, body: &mut BodyReader<'_>) -> Response {
    let method = req.method.as_str();
    let path = req.path.as_str();

    if let Some((bytes, ctype, hashed)) = static_file(path) {
        if method != "GET" && method != "HEAD" {
            return Response::error(405, "method not allowed");
        }
        let etag = format!("W/\"{}\"", svc.app_version);
        if req.header("if-none-match") == Some(etag.as_str()) {
            return Response::new(304, ctype, Vec::new()).header("ETag", &etag);
        }
        // Vite names assets by their content hash: those may be kept for good.
        let mut r = Response::new(200, ctype, bytes.to_vec())
            .header("ETag", &etag)
            .header("Cache-Control", if hashed { "public, max-age=31536000, immutable" } else { "no-cache" });
        if ctype.starts_with("text/html") {
            r = r.header("Content-Security-Policy", CSP);
        }
        return r;
    }

    match (method, path) {
        ("POST", "/api/pair") => {
            let v = match body.read_json().await {
                Ok(v) => v,
                Err(r) => return r,
            };
            let code = v["code"].as_str().unwrap_or("");
            let ua = req.header("user-agent").unwrap_or("");
            let name = v["name"]
                .as_str()
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .map(|s| s.chars().take(60).collect::<String>())
                .unwrap_or_else(|| device_name_from_ua(ua));
            let ip = body.stream.peer_addr().map(|a| a.ip().to_string()).unwrap_or_default();
            match svc.claim(code, &name, &ip) {
                Ok(id) => Response::json(202, json!({ "request": id })),
                Err("wrong") => {
                    // A wrong code costs a moment (10 wrong tries cancel the code).
                    tokio::time::sleep(Duration::from_millis(600)).await;
                    Response::error(403, "wrong")
                }
                Err("busy") => Response::error(429, "busy"),
                Err(_) => Response::error(410, "no-code"),
            }
        }
        ("GET", p) if p.starts_with("/api/pair/") => {
            let id = &p["/api/pair/".len()..];
            let r = svc.poll(id);
            let mut resp = Response::json(200, serde_json::to_value(&r).unwrap_or(Value::Null));
            if let Some(t) = &r.token {
                resp = resp.header("Set-Cookie", &cookie_for(t));
            }
            resp
        }
        ("POST", "/api/session") => {
            // The home-screen copy of the page has no cookie yet: it shows its
            // token and gets the cookie (for pictures and downloads).
            let v = match body.read_json().await {
                Ok(v) => v,
                Err(r) => return r,
            };
            let token = v["token"].as_str().unwrap_or("").to_string();
            match svc.device_for_token(&token) {
                Some(d) => Response::json(200, json!({ "ok": true, "device": d.name })).header("Set-Cookie", &cookie_for(&token)),
                None => Response::error(401, "unauthorized"),
            }
        }
        ("POST", "/api/upload") => {
            let Some(device) = authenticated(svc, req) else { return Response::error(401, "unauthorized") };
            upload(svc, req, body, &device).await
        }
        ("GET", p) | ("HEAD", p) if p.starts_with("/api/file/") => {
            if authenticated(svc, req).is_none() {
                return Response::error(401, "unauthorized");
            }
            serve_file(svc, req, &p["/api/file/".len()..]).await
        }
        ("GET", "/api/ping") => Response::json(200, json!({ "ok": true, "version": svc.app_version })),
        _ => Response::error(404, "not found"),
    }
}

fn cookie_for(token: &str) -> String {
    format!("lanx_phone={}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax", token)
}

fn authenticated(svc: &PhoneService, req: &Request) -> Option<PhoneDevice> {
    svc.device_for_token(&req.token()?)
}

/// Where photos and files from phones are kept on this PC.
pub(super) fn upload_dir(svc: &PhoneService) -> PathBuf {
    svc.network.app_data_dir().join("Phone uploads")
}

async fn upload(svc: &PhoneService, req: &Request, body: &mut BodyReader<'_>, _device: &PhoneDevice) -> Response {
    if let Err(e) = svc.network.privacy.guard() {
        return Response::error(423, &e);
    }
    let Some(conv) = req.query_param("conv").filter(|c| !c.is_empty()) else {
        return Response::error(400, "conv missing");
    };
    if svc.network.db.is_conversation_hidden(&conv) && !svc.network.privacy.hidden_unlocked() {
        return Response::error(403, "HIDDEN");
    }
    let raw_name = req.query_param("name").unwrap_or_default();
    let name = crate::networking::transfer::sanitize_file_name(if raw_name.trim().is_empty() { "photo.jpg" } else { raw_name.trim() });
    if req.body_len == 0 {
        return Response::error(400, "empty file");
    }
    if req.body_len > MAX_UPLOAD {
        return Response::error(413, "too large");
    }
    let dir = upload_dir(svc);
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return Response::error(500, &format!("cannot create folder: {}", e));
    }
    let path = crate::networking::transfer::unique_destination(&dir, &name);
    let part = PathBuf::from(format!("{}.lanxpart", path.display()));
    let mut file = match tokio::fs::File::create(&part).await {
        Ok(f) => f,
        Err(e) => return Response::error(500, &format!("cannot write: {}", e)),
    };
    let copied = body.copy_to_file(&mut file).await;
    drop(file);
    if copied.is_err() || copied.as_ref().ok() != Some(&req.body_len) {
        let _ = std::fs::remove_file(&part);
        return Response::error(400, "upload cut short");
    }
    if let Err(e) = std::fs::rename(&part, &path) {
        let _ = std::fs::remove_file(&part);
        return Response::error(500, &format!("cannot save: {}", e));
    }
    match svc.network.send_files(&conv, vec![path.to_string_lossy().to_string()]).await {
        Ok(sent) => {
            let Some(first) = sent.into_iter().next() else {
                return Response::error(500, "nothing sent");
            };
            let conversation = svc.network.db.get_conversation(&conv).ok().flatten();
            // The desktop window and every phone see the new file message.
            svc.network.events.message_received(&first.message, conversation.as_ref());
            let enriched = super::api::enrich(svc, &first.message);
            svc.broadcast(&json!({ "ev": "message", "message": enriched, "conversation": conversation }).to_string());
            Response::json(200, json!({ "message": super::api::enrich(svc, &first.message) }))
        }
        Err(e) => {
            let _ = std::fs::remove_file(&path);
            Response::error(400, &e)
        }
    }
}

/// A chat file by transfer id (a picture inline, anything else as a download),
/// with byte ranges so videos play on the phone.
async fn serve_file(svc: &PhoneService, req: &Request, transfer_id: &str) -> Response {
    if let Err(e) = svc.network.privacy.guard() {
        return Response::error(423, &e);
    }
    let Some(t) = super::api::find_transfer(svc, transfer_id) else {
        return Response::error(404, "no such file");
    };
    if let Some(conv) = &t.conversation_id {
        if svc.network.db.is_conversation_hidden(conv) && !svc.network.privacy.hidden_unlocked() {
            return Response::error(403, "HIDDEN");
        }
    }
    if t.direction == "incoming" && t.status != "completed" {
        return Response::error(404, "not downloaded yet");
    }
    let Some(path) = t.local_path.clone() else {
        return Response::error(404, "no file on disk");
    };
    let Ok(file) = tokio::fs::File::open(&path).await else {
        return Response::error(404, "the file was moved or deleted");
    };
    let total = match file.metadata().await {
        Ok(m) => m.len(),
        Err(_) => return Response::error(404, "unreadable"),
    };
    let ctype = content_type_for(&t.file_name);
    let inline = ctype.starts_with("image/") || ctype.starts_with("video/") || ctype.starts_with("audio/") || ctype == "application/pdf";
    let ascii: String = t
        .file_name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || " ._-()".contains(c) { c } else { '_' })
        .collect();
    let disposition = format!(
        "{}; filename=\"{}\"; filename*=UTF-8''{}",
        if inline { "inline" } else { "attachment" },
        ascii,
        percent_encode(&t.file_name)
    );
    let (status, start, len) = match req.header("range").and_then(|r| parse_range(r, total)) {
        Some(Ok((s, e))) => (206, s, e - s + 1),
        Some(Err(())) => {
            return Response::new(416, "text/plain", Vec::new()).header("Content-Range", &format!("bytes */{}", total));
        }
        None => (200, 0, total),
    };
    let mut resp = Response {
        status,
        headers: vec![
            ("Content-Type".to_string(), ctype.to_string()),
            ("Content-Disposition".to_string(), disposition),
            ("Accept-Ranges".to_string(), "bytes".to_string()),
            ("Cache-Control".to_string(), "private, max-age=3600".to_string()),
        ],
        body: Body::File { file, start, len },
    };
    if status == 206 {
        resp = resp.header("Content-Range", &format!("bytes {}-{}/{}", start, start + len - 1, total));
    }
    resp
}

/// `bytes=a-b` / `bytes=a-` / `bytes=-n` → Some(Ok((first, last))), or
/// Some(Err) when it cannot be satisfied; None when it is not a range header
/// this server understands (the whole file is sent then).
pub(super) fn parse_range(header: &str, total: u64) -> Option<Result<(u64, u64), ()>> {
    let spec = header.trim().strip_prefix("bytes=")?;
    if total == 0 || spec.contains(',') {
        return None;
    }
    let (a, b) = spec.split_once('-')?;
    let r = if a.is_empty() {
        let n: u64 = b.trim().parse().ok()?;
        if n == 0 {
            return Some(Err(()));
        }
        (total.saturating_sub(n), total - 1)
    } else {
        let start: u64 = a.trim().parse().ok()?;
        let end: u64 = if b.trim().is_empty() { total - 1 } else { b.trim().parse().ok()? };
        if start >= total {
            return Some(Err(()));
        }
        (start, end.min(total - 1))
    };
    if r.0 > r.1 {
        return Some(Err(()));
    }
    Some(Ok(r))
}
