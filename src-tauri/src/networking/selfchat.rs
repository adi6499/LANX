//! LANX 3.20.0: a chat between your phone and your own PC ("My PC" on the phone, "My phone" on
//! the PC). Nothing in it goes over the network to anyone: a file or a photo from the phone is
//! kept in the folder "From my phone" in this PC's Downloads, ready to take; a file dropped in
//! from the PC can be downloaded on the phone; text and links go both ways. It is an ordinary
//! chat in the database (kind "self", no colleague), so search, stars, reactions and the rest
//! work as in any other chat.

use super::NetworkService;
use crate::storage::models::{Conversation, Message, TransferRecord};
use std::path::{Path, PathBuf};

/// The one "My phone" chat.
pub const SELF_CHAT_ID: &str = "self-phone";
/// Who a message in it came from (kept in `receiver_id`, which this chat does not otherwise need).
pub const FROM_PHONE: &str = "phone";
pub const FROM_PC: &str = "pc";

/// Where files from the phone are kept: Downloads\From my phone (or, without a Downloads
/// folder, LANX's own data folder).
pub fn self_folder(app_data: &Path) -> PathBuf {
    // A test copy (its own profile) or a test keeps it in its own data folder, never in the real Downloads.
    if cfg!(test) || std::env::var("LANX_PROFILE").is_ok_and(|p| !p.trim().is_empty()) {
        return app_data.join("From my phone");
    }
    dirs::download_dir().unwrap_or_else(|| app_data.to_path_buf()).join("From my phone")
}

/// Free space on the disk that holds `path` (or its nearest existing parent), in bytes.
pub fn free_space(path: &Path) -> Option<u64> {
    let mut p = path.to_path_buf();
    while !p.exists() {
        if !p.pop() {
            return None;
        }
    }
    free_space_at(&p)
}

#[cfg(windows)]
fn free_space_at(p: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    let wide: Vec<u16> = p.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let mut free: u64 = 0;
    // SAFETY: a valid, nul-terminated path; the two other outputs may be null.
    let ok = unsafe { windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW(wide.as_ptr(), &mut free, std::ptr::null_mut(), std::ptr::null_mut()) };
    (ok != 0).then_some(free)
}

#[cfg(not(windows))]
fn free_space_at(p: &Path) -> Option<u64> {
    // `df -Pk <path>`: the fourth column of the second line is the space available, in KB.
    let out = std::process::Command::new("df").arg("-Pk").arg(p).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let line = text.lines().nth(1)?;
    line.split_whitespace().nth(3)?.parse::<u64>().ok().map(|kb| kb * 1024)
}

/// A short "5.0 GB" for messages.
pub fn size_words(bytes: u64) -> String {
    const GB: f64 = 1024.0 * 1024.0 * 1024.0;
    const MB: f64 = 1024.0 * 1024.0;
    let b = bytes as f64;
    if b >= GB {
        format!("{:.1} GB", b / GB)
    } else if b >= MB {
        format!("{:.0} MB", (b / MB).max(1.0))
    } else {
        format!("{} KB", (bytes / 1024).max(1))
    }
}

/// Is there room for `bytes` more at `path`? Half a gigabyte is always kept free, so that
/// Windows and LANX itself never run out. Err says, in plain words, what is missing.
pub fn check_room(path: &Path, bytes: u64) -> Result<(), String> {
    const KEEP: u64 = 512 * 1024 * 1024;
    match free_space(path) {
        Some(free) if free < bytes.saturating_add(KEEP) => Err(format!(
            "There is not enough room on this PC: the file is {}, and only {} is free on the disk. Make some room on the PC and send it again.",
            size_words(bytes),
            size_words(free.saturating_sub(KEEP.min(free)))
        )),
        _ => Ok(()),
    }
}

/// Moves a file or a folder (a rename where it can; a copy, then the original removed, from
/// one disk to another).
fn move_path(from: &Path, to: &Path) -> std::io::Result<()> {
    if std::fs::rename(from, to).is_ok() {
        return Ok(());
    }
    if from.is_dir() {
        copy_dir(from, to)?;
        std::fs::remove_dir_all(from)
    } else {
        std::fs::copy(from, to)?;
        std::fs::remove_file(from)
    }
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for e in std::fs::read_dir(from)? {
        let e = e?;
        let target = to.join(e.file_name());
        if e.file_type()?.is_dir() {
            copy_dir(&e.path(), &target)?;
        } else {
            std::fs::copy(e.path(), target)?;
        }
    }
    Ok(())
}

/// The size of a file, or of everything in a folder.
fn size_of(p: &Path) -> u64 {
    if p.is_dir() {
        std::fs::read_dir(p).map(|rd| rd.flatten().map(|e| size_of(&e.path())).sum()).unwrap_or(0)
    } else {
        std::fs::metadata(p).map(|m| m.len()).unwrap_or(0)
    }
}

/// A free name in `dir` for `name` ("report.pdf", then "report (2).pdf" …), for files and folders.
fn free_name(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() && !e.contains(' ') && e.len() <= 8 => (s.to_string(), format!(".{}", e)),
        _ => (name.to_string(), String::new()),
    };
    (2..10_000).map(|i| dir.join(format!("{} ({}){}", stem, i, ext))).find(|p| !p.exists()).unwrap_or(first)
}

impl NetworkService {
    /// The "My phone" chat, made the first time it is needed. Pinned, at the top of the list.
    pub fn ensure_self_chat(&self) -> Result<Conversation, String> {
        self.db.ensure_self_conversation(SELF_CHAT_ID).map_err(|e| e.to_string())
    }

    pub fn is_self_chat(conv: &Conversation) -> bool {
        conv.kind == "self"
    }

    /// Where the "My phone" chat keeps what comes from the phone.
    pub fn self_chat_folder(&self) -> PathBuf {
        self_folder(&self.app_data_dir())
    }

    /// A file from the phone lands here while it is being sent; anything from there is "from the phone".
    fn from_phone(&self, p: &Path) -> bool {
        p.starts_with(self.app_data_dir().join("Phone uploads"))
    }

    /// Text from the phone into the "My phone" chat.
    pub fn send_self_text(&self, conversation_id: &str, content: &str, reply_to: Option<String>) -> Result<Message, String> {
        let trimmed = content.trim();
        if trimmed.is_empty() {
            return Err("Message content cannot be empty".to_string());
        }
        if trimmed.len() > super::MAX_MESSAGE_CONTENT_LEN {
            return Err("Message is too long. Send it as a file instead.".to_string());
        }
        let conv = self.db.get_conversation(conversation_id).map_err(|e| e.to_string())?.ok_or("Conversation not found")?;
        let reply = self.reply_for(&conv.id, reply_to.as_deref());
        self.send_self_message(&conv, trimmed, "text", reply, true)
    }

    /// Text (or a card) in the "My phone" chat: kept, shown on the PC and on the phone, sent to nobody.
    pub(super) fn send_self_message(&self, conv: &Conversation, content: &str, message_type: &str, reply: Option<(String, String)>, from_phone: bool) -> Result<Message, String> {
        let now = super::now_secs();
        let msg = Message {
            id: uuid::Uuid::new_v4().to_string(),
            conversation_id: conv.id.clone(),
            sender_id: self.identity.device_id.clone(),
            receiver_id: (if from_phone { FROM_PHONE } else { FROM_PC }).to_string(),
            content: content.to_string(),
            message_type: message_type.to_string(),
            timestamp: now,
            status: "read".to_string(),
            error_reason: None,
            is_outgoing: true,
            transfer_id: None,
            reply_to: reply.as_ref().map(|r| r.0.clone()),
            reply_preview: reply.map(|r| r.1),
            ..Default::default()
        };
        self.db.insert_message(&msg).map_err(|e| e.to_string())?;
        if !from_phone {
            self.tell_phones(&msg);
        }
        Ok(msg)
    }

    /// Something the PC put into "My phone": the phones hear of it at once (the PC window has it
    /// already). What came from the phone is told by the phone server itself.
    fn tell_phones(&self, msg: &Message) {
        let conv = self.db.get_conversation(&msg.conversation_id).ok().flatten();
        self.events.message_received(msg, conv.as_ref());
    }

    /// Files (or folders) in the "My phone" chat. From the phone, each is moved into the
    /// "From my phone" folder, as it is (a folder stays a folder). From the PC, each stays
    /// where it is, ready for the phone to download (a folder is packed into one zip, as for
    /// a colleague). Nothing is sent to anyone.
    pub(super) async fn send_self_files(&self, conv: &Conversation, paths: Vec<String>) -> Result<Vec<super::transfer::SentFile>, String> {
        let mut sent = Vec::new();
        let mut problems = Vec::new();
        for path in paths {
            let src = PathBuf::from(&path);
            if !src.exists() {
                problems.push(format!("Cannot read {}", path));
                continue;
            }
            let phone = self.from_phone(&src);
            let (place, kind, direction) = if phone {
                let dir = self.self_chat_folder();
                if let Err(e) = std::fs::create_dir_all(&dir) {
                    problems.push(format!("Cannot make the folder {}: {}", dir.display(), e));
                    continue;
                }
                let name = src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "file".to_string());
                let dest = free_name(&dir, &name);
                let is_dir = src.is_dir();
                let (from, to) = (src.clone(), dest.clone());
                match tokio::task::spawn_blocking(move || move_path(&from, &to)).await {
                    Ok(Ok(())) => (dest, if is_dir { "folder" } else { "file" }, "incoming"),
                    Ok(Err(e)) => {
                        problems.push(format!("Cannot keep {}: {}", name, e));
                        continue;
                    }
                    Err(e) => {
                        problems.push(e.to_string());
                        continue;
                    }
                }
            } else if src.is_dir() {
                let outbox = super::folders::outbox_dir(self.db.get_path().parent().unwrap_or(Path::new(".")));
                let from = src.clone();
                match tokio::task::spawn_blocking(move || super::folders::pack_folder(&from, &outbox)).await {
                    Ok(Ok(packed)) => (packed.zip, "folder", "outgoing"),
                    Ok(Err(e)) => {
                        problems.push(e);
                        continue;
                    }
                    Err(e) => {
                        problems.push(e.to_string());
                        continue;
                    }
                }
            } else {
                (src.clone(), "file", "outgoing")
            };
            let file_name = place.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "file".to_string());
            let size = size_of(&place) as i64;
            let now = super::now_secs();
            let transfer = TransferRecord {
                id: uuid::Uuid::new_v4().to_string(),
                peer_id: self.identity.device_id.clone(),
                peer_name: Some("My phone".to_string()),
                conversation_id: Some(conv.id.clone()),
                file_name: file_name.clone(),
                file_size: size,
                file_hash: String::new(),
                direction: direction.to_string(),
                status: "completed".to_string(),
                transferred_bytes: size,
                local_path: Some(place.to_string_lossy().to_string()),
                error_reason: None,
                created_at: now,
                completed_at: Some(now),
                duration_ms: None,
                started_bytes: None,
                parent_id: None,
                temp_path: None,
                kind: kind.to_string(),
            };
            self.db.insert_transfer(&transfer).map_err(|e| e.to_string())?;
            let message = Message {
                id: uuid::Uuid::new_v4().to_string(),
                conversation_id: conv.id.clone(),
                sender_id: self.identity.device_id.clone(),
                receiver_id: (if phone { FROM_PHONE } else { FROM_PC }).to_string(),
                content: super::transfer::file_label(&file_name, kind == "folder" && !phone),
                message_type: "file".to_string(),
                timestamp: now,
                status: "read".to_string(),
                error_reason: None,
                is_outgoing: true,
                transfer_id: Some(transfer.id.clone()),
                ..Default::default()
            };
            self.db.insert_message(&message).map_err(|e| e.to_string())?;
            self.events.transfer_updated(&transfer);
            if !phone {
                self.tell_phones(&message);
            }
            sent.push(super::transfer::SentFile { transfers: vec![transfer], message });
        }
        if sent.is_empty() && !problems.is_empty() {
            return Err(problems.join("\n"));
        }
        Ok(sent)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn free_names_and_sizes() {
        let dir = std::env::temp_dir().join(format!("lanx-self-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(free_name(&dir, "a.zip"), dir.join("a.zip"));
        std::fs::write(dir.join("a.zip"), b"1234").unwrap();
        assert_eq!(free_name(&dir, "a.zip"), dir.join("a (2).zip"));
        std::fs::create_dir_all(dir.join("Photos")).unwrap();
        assert_eq!(free_name(&dir, "Photos"), dir.join("Photos (2)"));
        std::fs::write(dir.join("Photos").join("x.jpg"), b"123456").unwrap();
        assert_eq!(size_of(&dir.join("Photos")), 6);
        // A folder moved as it is, with what is in it.
        move_path(&dir.join("Photos"), &dir.join("Moved")).unwrap();
        assert!(dir.join("Moved").join("x.jpg").exists() && !dir.join("Photos").exists());
        assert!(free_space(&dir).unwrap_or(0) > 0, "the free space of a real disk is known");
        assert!(check_room(&dir, u64::MAX / 4).is_err(), "no disk is that big");
        assert!(check_room(&dir, 1).is_ok());
        assert_eq!(size_words(5 * 1024 * 1024 * 1024), "5.0 GB");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
