//! LANX 2.5.0: personal notes (a small notebook inside LANX). Notes live only
//! on this PC, in the same database as the chats, so the daily backup keeps
//! them. Deleted notes stay in "Recently deleted" for 30 days.

use super::models::Note;
use super::Database;
use rusqlite::{params, Result};

/// How long a deleted note can still be brought back.
pub const KEEP_DELETED_SECS: i64 = 30 * 24 * 3600;
/// Sizes a note can have (a note is not a document).
pub const MAX_TITLE: usize = 200;
pub const MAX_BODY: usize = 200_000;
pub const COLORS: [&str; 7] = ["yellow", "green", "blue", "pink", "purple", "orange", "grey"];
pub const KINDS: [&str; 2] = ["note", "checklist"];

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Trims a note to what is allowed (long texts are cut, unknown colours and
/// kinds fall back to the defaults).
pub fn clean_note(mut n: Note) -> Note {
    n.title = n.title.trim().chars().take(MAX_TITLE).collect();
    if n.body.chars().count() > MAX_BODY {
        n.body = n.body.chars().take(MAX_BODY).collect();
    }
    n.body = n.body.replace("\r\n", "\n");
    if !COLORS.contains(&n.color.as_str()) {
        n.color = COLORS[0].to_string();
    }
    if !KINDS.contains(&n.kind.as_str()) {
        n.kind = KINDS[0].to_string();
    }
    if n.id.trim().is_empty() || uuid::Uuid::parse_str(&n.id).is_err() {
        n.id = uuid::Uuid::new_v4().to_string();
    }
    n
}

/// A short first line for the list (the title, or the first words of the body).
pub fn note_heading(n: &Note) -> String {
    if !n.title.is_empty() {
        return n.title.clone();
    }
    let first = n
        .body
        .lines()
        .map(|l| l.trim_start_matches("[ ] ").trim_start_matches("[x] ").trim())
        .find(|l| !l.is_empty())
        .unwrap_or("");
    let words: String = first.chars().take(60).collect();
    if words.is_empty() { "Untitled note".to_string() } else { words }
}

impl Database {
    fn row_to_note(r: &rusqlite::Row) -> rusqlite::Result<Note> {
        Ok(Note {
            id: r.get(0)?,
            title: r.get(1)?,
            body: r.get(2)?,
            kind: r.get(3)?,
            color: r.get(4)?,
            pinned: r.get::<_, i64>(5)? != 0,
            created_at: r.get(6)?,
            updated_at: r.get(7)?,
            deleted_at: r.get(8)?,
        })
    }

    /// All notes, pinned first, newest change first. `deleted` = the bin instead.
    pub fn list_notes(&self, deleted: bool) -> Result<Vec<Note>> {
        let conn = self.conn.lock();
        let mut st = conn.prepare(if deleted {
            "SELECT id, title, body, kind, color, pinned, created_at, updated_at, deleted_at FROM notes
             WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC"
        } else {
            "SELECT id, title, body, kind, color, pinned, created_at, updated_at, deleted_at FROM notes
             WHERE deleted_at IS NULL ORDER BY pinned DESC, updated_at DESC"
        })?;
        let rows = st.query_map([], Self::row_to_note)?;
        rows.collect()
    }

    pub fn get_note(&self, id: &str) -> Result<Option<Note>> {
        let conn = self.conn.lock();
        conn.query_row(
            "SELECT id, title, body, kind, color, pinned, created_at, updated_at, deleted_at FROM notes WHERE id = ?1",
            params![id],
            Self::row_to_note,
        )
        .map(Some)
        .or_else(|e| if e == rusqlite::Error::QueryReturnedNoRows { Ok(None) } else { Err(e) })
    }

    /// Creates or updates a note; returns it as stored.
    pub fn save_note(&self, note: Note) -> Result<Note> {
        let mut n = clean_note(note);
        let t = now();
        n.updated_at = t;
        let conn = self.conn.lock();
        let existing: Option<i64> =
            conn.query_row("SELECT created_at FROM notes WHERE id = ?1", params![n.id], |r| r.get(0)).ok();
        n.created_at = existing.unwrap_or(t);
        n.deleted_at = None;
        conn.execute(
            "INSERT INTO notes (id, title, body, kind, color, pinned, created_at, updated_at, deleted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL)
             ON CONFLICT(id) DO UPDATE SET title = excluded.title, body = excluded.body, kind = excluded.kind,
               color = excluded.color, pinned = excluded.pinned, updated_at = excluded.updated_at, deleted_at = NULL",
            params![n.id, n.title, n.body, n.kind, n.color, n.pinned as i64, n.created_at, n.updated_at],
        )?;
        Ok(n)
    }

    /// Moves a note to the bin (`for_good` = remove it now).
    pub fn delete_note(&self, id: &str, for_good: bool) -> Result<bool> {
        let conn = self.conn.lock();
        let n = if for_good {
            conn.execute("DELETE FROM notes WHERE id = ?1", params![id])?
        } else {
            conn.execute("UPDATE notes SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL", params![id, now()])?
        };
        Ok(n > 0)
    }

    pub fn restore_note(&self, id: &str) -> Result<bool> {
        let conn = self.conn.lock();
        let n = conn.execute("UPDATE notes SET deleted_at = NULL, updated_at = ?2 WHERE id = ?1", params![id, now()])?;
        Ok(n > 0)
    }

    /// Removes notes that have been in the bin for more than 30 days.
    pub fn purge_old_deleted_notes(&self) -> Result<usize> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < ?1", params![now() - KEEP_DELETED_SECS])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::Database;

    fn note(title: &str, body: &str) -> Note {
        Note {
            id: String::new(),
            title: title.into(),
            body: body.into(),
            kind: "note".into(),
            color: "blue".into(),
            pinned: false,
            created_at: 0,
            updated_at: 0,
            deleted_at: None,
        }
    }

    #[test]
    fn notes_are_saved_listed_binned_and_restored() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(dir.path()).unwrap();
        let a = db.save_note(note("Dolvi visit", "Call Marcus\nCheck PO 88")).unwrap();
        assert!(uuid::Uuid::parse_str(&a.id).is_ok() && a.created_at > 0);
        let mut b = db.save_note(note("", "[ ] bearings\n[x] invoices")).unwrap();
        assert_eq!(note_heading(&b), "bearings");
        b.pinned = true;
        let b = db.save_note(b).unwrap();
        let list = db.list_notes(false).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, b.id, "pinned first");
        assert!(db.delete_note(&a.id, false).unwrap());
        assert_eq!(db.list_notes(false).unwrap().len(), 1);
        assert_eq!(db.list_notes(true).unwrap().len(), 1);
        assert!(db.restore_note(&a.id).unwrap());
        assert_eq!(db.list_notes(false).unwrap().len(), 2);
        assert!(db.delete_note(&a.id, true).unwrap());
        assert!(db.get_note(&a.id).unwrap().is_none());
        // Cleaning: unknown colour/kind fall back, huge titles are cut.
        let mut odd = note(&"x".repeat(500), "hi");
        odd.color = "neon".into();
        odd.kind = "spreadsheet".into();
        let odd = db.save_note(odd).unwrap();
        assert_eq!(odd.title.len(), MAX_TITLE);
        assert_eq!(odd.color, "yellow");
        assert_eq!(odd.kind, "note");
    }
}
