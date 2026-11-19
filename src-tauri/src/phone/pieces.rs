//! LANX 3.20.0: a file of any size from the phone, sent in pieces. One request carried the
//! whole file before, so it was refused above 1 GB, and a Wi-Fi drop near the end meant
//! starting again. Now the phone asks to start (the PC checks there is room on its disk),
//! sends the file a piece at a time, and after a drop asks how much arrived and goes on from
//! there. The only limit left is the free space on the PC's disk.
//!
//!   POST /api/upload-start   {conv, name, size}  or  {batch, path, size} (a file of a folder)
//!                            → {id, have: 0}
//!   POST /api/upload-piece?id=…&at=<bytes the PC has>   (the next piece, up to 32 MB)
//!                            → {have}   (409 {have} when `at` is not what the PC has)
//!   GET  /api/upload-status?id=…  → {have, size}
//!   POST /api/upload-finish?id=…  → {message} (into the chat), or {ok} (a file of a folder)
//!   POST /api/upload-cancel?id=…  → {ok}
//!
//! What has arrived so far is kept in "Phone uploads\pieces" (`<id>.lanxpart`, and `<id>.json`
//! saying what it is); pieces left behind are removed after two days.

use super::http::{upload_dir, BodyReader, Request, Response};
use super::PhoneService;
use serde_json::{json, Value};
use std::path::PathBuf;
use tokio::io::{AsyncRead, AsyncWriteExt};

/// One piece may be this big.
pub(super) const MAX_PIECE: u64 = 32 * 1024 * 1024;
/// Unfinished uploads older than this are removed.
const KEEP_SECS: u64 = 2 * 24 * 3600;

fn pieces_dir(svc: &PhoneService) -> PathBuf {
    upload_dir(svc).join("pieces")
}

/// An upload id from the phone: letters and digits only.
fn paths_for(svc: &PhoneService, id: &str) -> Option<(PathBuf, PathBuf)> {
    (id.len() >= 16 && id.len() <= 48 && id.chars().all(|c| c.is_ascii_alphanumeric())).then(|| {
        let d = pieces_dir(svc);
        (d.join(format!("{}.lanxpart", id)), d.join(format!("{}.json", id)))
    })
}

fn read_meta(svc: &PhoneService, id: &str) -> Option<(PathBuf, PathBuf, Value)> {
    let (part, meta) = paths_for(svc, id)?;
    let v: Value = serde_json::from_slice(&std::fs::read(&meta).ok()?).ok()?;
    Some((part, meta, v))
}

fn have_of(part: &std::path::Path) -> u64 {
    std::fs::metadata(part).map(|m| m.len()).unwrap_or(0)
}

/// Removes unfinished uploads left behind (a phone that never came back).
pub(super) fn tidy(svc: &PhoneService) {
    let Ok(rd) = std::fs::read_dir(pieces_dir(svc)) else { return };
    let now = std::time::SystemTime::now();
    for e in rd.flatten() {
        let old = e
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| now.duration_since(t).ok())
            .is_some_and(|age| age.as_secs() > KEEP_SECS);
        if old {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

pub(super) async fn start<S: AsyncRead + Unpin>(svc: &PhoneService, body: &mut BodyReader<'_, S>) -> Response {
    if let Err(e) = svc.network.privacy.guard() {
        return Response::error(423, &e);
    }
    let v = match body.read_json().await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let size = v["size"].as_u64().unwrap_or(0);
    if size == 0 {
        return Response::error(400, "empty file");
    }
    let conv = v["conv"].as_str().unwrap_or("").to_string();
    let batch = v["batch"].as_str().unwrap_or("").to_string();
    if conv.is_empty() && batch.is_empty() {
        return Response::error(400, "conv missing");
    }
    if !conv.is_empty() && svc.network.db.is_conversation_hidden(&conv) && !svc.network.privacy.hidden_unlocked() {
        return Response::error(403, "HIDDEN");
    }
    if !conv.is_empty() && svc.network.db.get_conversation(&conv).ok().flatten().is_none() {
        return Response::error(404, "no such chat");
    }
    // Room on the disk: for the pieces, and (in "My phone") where the file is kept after.
    let dir = pieces_dir(svc);
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return Response::error(500, &format!("cannot create folder: {}", e));
    }
    if let Err(e) = crate::networking::selfchat::check_room(&dir, size) {
        return Response::error(507, &e);
    }
    let id = format!("{}", uuid::Uuid::new_v4().simple());
    let Some((part, meta)) = paths_for(svc, &id) else {
        return Response::error(500, "bad id");
    };
    let info = json!({
        "conv": conv,
        "batch": batch,
        "path": v["path"].as_str().unwrap_or(""),
        "name": v["name"].as_str().unwrap_or(""),
        "size": size,
    });
    if std::fs::write(&meta, info.to_string()).is_err() || std::fs::File::create(&part).is_err() {
        return Response::error(500, "cannot write");
    }
    Response::json(200, json!({ "id": id, "have": 0 }))
}

pub(super) async fn piece<S: AsyncRead + Unpin>(svc: &PhoneService, req: &Request, body: &mut BodyReader<'_, S>) -> Response {
    if let Err(e) = svc.network.privacy.guard() {
        return Response::error(423, &e);
    }
    let id = req.query_param("id").unwrap_or_default();
    let Some((part, _meta, info)) = read_meta(svc, &id) else {
        return Response::error(404, "no such upload");
    };
    let size = info["size"].as_u64().unwrap_or(0);
    let have = have_of(&part);
    let at: u64 = req.query_param("at").and_then(|a| a.parse().ok()).unwrap_or(u64::MAX);
    if req.body_len == 0 || req.body_len > MAX_PIECE {
        return Response::error(413, "piece too large");
    }
    if at != have || have + req.body_len > size {
        // The phone and the PC disagree on how much arrived (a piece was cut off): it starts from here.
        return Response::json(409, json!({ "have": have, "size": size }));
    }
    let mut file = match tokio::fs::OpenOptions::new().append(true).open(&part).await {
        Ok(f) => f,
        Err(e) => return Response::error(500, &format!("cannot write: {}", e)),
    };
    let mut chunk = Vec::with_capacity(256 * 1024);
    let mut written = 0u64;
    let mut cut = false;
    while body.remaining > 0 {
        chunk.clear();
        match body.next_chunk(&mut chunk).await {
            Ok(n) => {
                if file.write_all(&chunk[..n]).await.is_err() {
                    cut = true;
                    break;
                }
                written += n as u64;
            }
            Err(_) => {
                cut = true;
                break;
            }
        }
    }
    let _ = file.flush().await;
    drop(file);
    if cut || written != req.body_len {
        // Only whole pieces count: what came of this one is taken back off.
        if let Ok(f) = std::fs::OpenOptions::new().write(true).open(&part) {
            let _ = f.set_len(have);
        }
        return Response::error(400, "piece cut short");
    }
    Response::json(200, json!({ "have": have + written, "size": size }))
}

pub(super) fn status(svc: &PhoneService, req: &Request) -> Response {
    let id = req.query_param("id").unwrap_or_default();
    let Some((part, _meta, info)) = read_meta(svc, &id) else {
        return Response::error(404, "no such upload");
    };
    Response::json(200, json!({ "have": have_of(&part), "size": info["size"].as_u64().unwrap_or(0) }))
}

pub(super) fn cancel(svc: &PhoneService, req: &Request) -> Response {
    let id = req.query_param("id").unwrap_or_default();
    if let Some((part, meta)) = paths_for(svc, &id) {
        let _ = std::fs::remove_file(part);
        let _ = std::fs::remove_file(meta);
    }
    Response::json(200, json!({ "ok": true }))
}

pub(super) async fn finish(svc: &PhoneService, req: &Request) -> Response {
    if let Err(e) = svc.network.privacy.guard() {
        return Response::error(423, &e);
    }
    let id = req.query_param("id").unwrap_or_default();
    let Some((part, meta, info)) = read_meta(svc, &id) else {
        return Response::error(404, "no such upload");
    };
    let size = info["size"].as_u64().unwrap_or(0);
    let have = have_of(&part);
    if have != size {
        return Response::json(409, json!({ "have": have, "size": size }));
    }
    let raw = info["name"].as_str().unwrap_or("").trim().to_string();
    let batch = info["batch"].as_str().unwrap_or("").to_string();
    // A file of a folder: it goes to its place in the folder being put together.
    if !batch.is_empty() {
        let rel = info["path"].as_str().unwrap_or("");
        let target = match super::http::folder_target(svc, &batch, rel) {
            Ok(p) => p,
            Err(r) => return r,
        };
        if let Err(e) = std::fs::rename(&part, &target).or_else(|_| std::fs::copy(&part, &target).map(|_| ()).and_then(|_| std::fs::remove_file(&part))) {
            return Response::error(500, &format!("cannot save: {}", e));
        }
        let _ = std::fs::remove_file(&meta);
        return Response::json(200, json!({ "ok": true }));
    }
    let conv = info["conv"].as_str().unwrap_or("").to_string();
    let name = crate::networking::transfer::sanitize_file_name(if raw.is_empty() { "file" } else { &raw });
    let dir = upload_dir(svc);
    let path = crate::networking::transfer::unique_destination(&dir, &name);
    if let Err(e) = std::fs::rename(&part, &path) {
        return Response::error(500, &format!("cannot save: {}", e));
    }
    let _ = std::fs::remove_file(&meta);
    match svc.network.send_files(&conv, vec![path.to_string_lossy().to_string()]).await {
        Ok(sent) => super::http::announce_sent(svc, sent),
        Err(e) => {
            let _ = std::fs::remove_file(&path);
            Response::error(400, &e)
        }
    }
}
