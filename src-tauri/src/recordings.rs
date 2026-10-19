//! LANX 1.4.0: saving meeting and call recordings.
//!
//! The window records the meeting (its picture and everyone's sound) and hands
//! the data over in pieces while recording; this writes them straight into
//! `Documents\LANX Recordings`, as "<name>.mp4.part" until the recording ends.
//! If LANX stops in the middle, the part file is kept and renamed at the next
//! start, so nothing recorded is lost.

use parking_lot::Mutex;
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// A recording can't grow beyond this (about 10 hours of a busy meeting).
const MAX_BYTES: u64 = 20 * 1024 * 1024 * 1024;
const PART: &str = "part";

struct Open {
    file: std::fs::File,
    part: PathBuf,
    path: PathBuf,
    bytes: u64,
}

fn open() -> &'static Mutex<HashMap<String, Open>> {
    static OPEN: OnceLock<Mutex<HashMap<String, Open>>> = OnceLock::new();
    OPEN.get_or_init(|| Mutex::new(HashMap::new()))
}

/// `Documents\LANX Recordings` (test copies keep theirs in their own folder).
pub fn folder() -> PathBuf {
    if let Some(p) = crate::testmode::profile() {
        return crate::storage::data_dir(Some(&p)).join("Recordings");
    }
    dirs::document_dir()
        .unwrap_or_else(|| crate::storage::data_dir(None))
        .join("LANX Recordings")
}

/// A file name Windows accepts, from a meeting title.
fn safe_name(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| if c.is_control() || r#"<>:"/\|?*"#.contains(c) { ' ' } else { c })
        .collect();
    let words: Vec<&str> = cleaned.split_whitespace().collect();
    let name: String = words.join(" ").chars().take(60).collect();
    let name = name.trim_end_matches(['.', ' ']).to_string();
    if name.is_empty() { "Recording".to_string() } else { name }
}

/// Starts a recording file. `ext`: mp4 | webm. Returns (id, file name).
pub fn begin(title: &str, ext: &str) -> Result<(String, String), String> {
    if ext != "mp4" && ext != "webm" {
        return Err("Unsupported recording format".to_string());
    }
    let dir = folder();
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not create {}: {}", dir.display(), e))?;
    let stamp = chrono::Local::now().format("%Y-%m-%d %H-%M").to_string();
    let base = format!("{} - {}", safe_name(title), stamp);
    let mut path = dir.join(format!("{}.{}", base, ext));
    let mut n = 2;
    while path.exists() || part_of(&path).exists() {
        path = dir.join(format!("{} ({}).{}", base, n, ext));
        n += 1;
    }
    let part = part_of(&path);
    let file = std::fs::File::create(&part).map_err(|e| format!("Could not save the recording: {}", e))?;
    let id = uuid::Uuid::new_v4().to_string();
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    open().lock().insert(id.clone(), Open { file, part, path, bytes: 0 });
    Ok((id, name))
}

fn part_of(path: &Path) -> PathBuf {
    let mut s = path.as_os_str().to_owned();
    s.push(format!(".{}", PART));
    PathBuf::from(s)
}

/// Adds a piece of the recording. Returns the size so far.
pub fn append(id: &str, data: &[u8]) -> Result<u64, String> {
    let mut all = open().lock();
    let rec = all.get_mut(id).ok_or("This recording has already ended.")?;
    if rec.bytes + data.len() as u64 > MAX_BYTES {
        return Err("The recording is too large; it was stopped.".to_string());
    }
    rec.file
        .write_all(data)
        .map_err(|e| format!("Could not save the recording (is the disk full?): {}", e))?;
    rec.bytes += data.len() as u64;
    Ok(rec.bytes)
}

/// Finishes the file. Returns (path, size).
pub fn finish(id: &str) -> Result<(PathBuf, u64), String> {
    let rec = open().lock().remove(id).ok_or("This recording has already ended.")?;
    let Open { mut file, part, path, bytes } = rec;
    let _ = file.flush();
    drop(file);
    if bytes == 0 {
        let _ = std::fs::remove_file(&part);
        return Err("Nothing was recorded.".to_string());
    }
    std::fs::rename(&part, &path).map_err(|e| format!("Could not finish the recording: {}", e))?;
    Ok((path, bytes))
}

/// Throws a recording away (it failed to start properly).
pub fn cancel(id: &str) {
    if let Some(rec) = open().lock().remove(id) {
        drop(rec.file);
        let _ = std::fs::remove_file(&rec.part);
    }
}

/// Recordings cut short by LANX closing get their proper name back.
pub fn recover_leftovers() {
    let Ok(entries) = std::fs::read_dir(folder()) else { return };
    for e in entries.flatten() {
        let p = e.path();
        if p.extension().and_then(|x| x.to_str()) != Some(PART) {
            continue;
        }
        let target = p.with_extension("");
        if !target.exists() && e.metadata().map(|m| m.len() > 0).unwrap_or(false) {
            let _ = std::fs::rename(&p, &target);
        } else if e.metadata().map(|m| m.len() == 0).unwrap_or(false) {
            let _ = std::fs::remove_file(&p);
        }
    }
}

/// `path` if it is a recording inside the recordings folder (chat lines can
/// only open LANX's own recordings).
pub fn inside_folder(path: &str) -> Option<PathBuf> {
    let base = std::fs::canonicalize(folder()).ok()?;
    let p = std::fs::canonicalize(path).ok()?;
    let ext = p.extension().and_then(|x| x.to_str()).map(|x| x.to_ascii_lowercase());
    (p.starts_with(&base) && p.is_file() && matches!(ext.as_deref(), Some("mp4") | Some("webm"))).then_some(p)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles_become_safe_file_names() {
        assert_eq!(safe_name("Budget: Q3/Q4 <review>?"), "Budget Q3 Q4 review");
        assert_eq!(safe_name("   "), "Recording");
        assert_eq!(safe_name("Ends with dots..."), "Ends with dots");
        assert!(safe_name(&"x".repeat(200)).len() <= 60);
    }

    #[test]
    fn part_file_sits_next_to_the_recording() {
        let p = part_of(Path::new(r"C:\r\Meeting - 2026-10-17 10-00.mp4"));
        assert!(p.to_string_lossy().ends_with("10-00.mp4.part"));
        assert_eq!(p.with_extension(""), PathBuf::from(r"C:\r\Meeting - 2026-10-17 10-00.mp4"));
    }
}
