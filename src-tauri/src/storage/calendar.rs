//! LANX 2.5.0: the Calendar's own events (personal, on this PC). Meetings
//! with colleagues stay Organiser cards; the calendar shows both. Repeats are
//! worked out here (daily / weekly / monthly / yearly, optionally until a
//! date), and reminders are remembered so each one fires once.

use super::models::{CalendarEvent, Occurrence};
use super::Database;
use chrono::{Datelike, Local, NaiveDate, NaiveTime, TimeZone};
use rusqlite::{params, Result};

pub const REPEATS: [&str; 5] = ["none", "daily", "weekly", "monthly", "yearly"];
pub const COLORS: [&str; 8] = ["blue", "green", "red", "orange", "purple", "pink", "teal", "grey"];
pub const MAX_TITLE: usize = 200;
pub const MAX_TEXT: usize = 5000;
/// Occurrences are never expanded beyond this many (a daily event for years).
const MAX_OCCURRENCES: usize = 1000;
/// All-day reminders go off at this local hour on the day.
const ALL_DAY_REMINDER_HOUR: u32 = 9;

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn clean_event(mut e: CalendarEvent) -> CalendarEvent {
    e.title = e.title.trim().chars().take(MAX_TITLE).collect();
    if e.title.is_empty() {
        e.title = "Untitled".to_string();
    }
    e.details = e.details.trim().chars().take(MAX_TEXT).collect();
    e.location = e.location.trim().chars().take(MAX_TITLE).collect();
    if !REPEATS.contains(&e.repeat.as_str()) {
        e.repeat = "none".to_string();
    }
    if !COLORS.contains(&e.color.as_str()) {
        e.color = COLORS[0].to_string();
    }
    if e.end < e.start {
        e.end = e.start;
    }
    if e.all_day {
        // Whole days: start at local midnight, end at the next midnight (or later).
        let s = local_midnight(e.start);
        let n = local_midnight(e.end.max(e.start));
        e.start = s;
        e.end = if n <= s { s + 86_400 } else { n + if is_local_midnight(e.end) { 0 } else { 86_400 } };
    } else if e.end == e.start {
        e.end = e.start + 1800; // a timed event lasts at least half an hour
    }
    if let Some(u) = e.repeat_until {
        if u < e.start {
            e.repeat_until = None;
        }
    }
    if e.repeat == "none" {
        e.repeat_until = None;
    }
    if let Some(m) = e.reminder_mins {
        if m < 0 || m > 7 * 24 * 60 {
            e.reminder_mins = None;
        }
    }
    if e.id.trim().is_empty() || uuid::Uuid::parse_str(&e.id).is_err() {
        e.id = uuid::Uuid::new_v4().to_string();
    }
    e
}

fn local_midnight(ts: i64) -> i64 {
    let d = Local.timestamp_opt(ts, 0).single().map(|t| t.date_naive()).unwrap_or_else(|| Local::now().date_naive());
    Local.from_local_datetime(&d.and_time(NaiveTime::MIN)).single().map(|t| t.timestamp()).unwrap_or(ts)
}
fn is_local_midnight(ts: i64) -> bool {
    local_midnight(ts) == ts
}

fn days_in_month(y: i32, m: u32) -> u32 {
    let (ny, nm) = if m == 12 { (y + 1, 1) } else { (y, m + 1) };
    NaiveDate::from_ymd_opt(ny, nm, 1).and_then(|d| d.pred_opt()).map(|d| d.day()).unwrap_or(28)
}

/// The same wall-clock time `months` months later (day clamped to the month).
fn add_months(ts: i64, months: i32) -> Option<i64> {
    let t = Local.timestamp_opt(ts, 0).single()?;
    let total = t.year() * 12 + t.month0() as i32 + months;
    let (y, m0) = (total.div_euclid(12), total.rem_euclid(12) as u32);
    let day = t.day().min(days_in_month(y, m0 + 1));
    let d = NaiveDate::from_ymd_opt(y, m0 + 1, day)?;
    Local.from_local_datetime(&d.and_time(t.time())).single().map(|x| x.timestamp())
}

/// When a repeating event happens between `from` and `to` (seconds).
pub fn occurrences(e: &CalendarEvent, from: i64, to: i64) -> Vec<(i64, i64)> {
    let dur = (e.end - e.start).max(0);
    let until = e.repeat_until.map(|u| u + 86_399).unwrap_or(i64::MAX);
    let mut out = Vec::new();
    let mut push = |s: i64| {
        if s + dur > from && s < to && s <= until {
            out.push((s, s + dur));
        }
    };
    match e.repeat.as_str() {
        "daily" | "weekly" => {
            let step = if e.repeat == "daily" { 86_400 } else { 7 * 86_400 };
            let first = if from > e.end { ((from - e.end) / step).max(0) } else { 0 };
            let mut k = first;
            while k - first < MAX_OCCURRENCES as i64 {
                let s = e.start + k * step;
                if s >= to || s > until {
                    break;
                }
                push(s);
                k += 1;
            }
        }
        "monthly" | "yearly" => {
            let months = if e.repeat == "monthly" { 1 } else { 12 };
            let mut n = 0;
            while n < MAX_OCCURRENCES as i32 {
                let Some(s) = add_months(e.start, n * months) else { break };
                if s >= to || s > until {
                    break;
                }
                push(s);
                n += 1;
            }
        }
        _ => push(e.start),
    }
    out
}

/// When the reminder for an occurrence starting at `start` should go off.
pub fn reminder_time(e: &CalendarEvent, start: i64) -> Option<i64> {
    let mins = e.reminder_mins?;
    if e.all_day {
        let d = Local.timestamp_opt(start, 0).single()?.date_naive();
        let at = Local
            .from_local_datetime(&d.and_time(NaiveTime::from_hms_opt(ALL_DAY_REMINDER_HOUR, 0, 0)?))
            .single()?
            .timestamp();
        Some(at - mins * 60)
    } else {
        Some(start - mins * 60)
    }
}

impl Database {
    fn row_to_event(r: &rusqlite::Row) -> rusqlite::Result<CalendarEvent> {
        Ok(CalendarEvent {
            id: r.get(0)?,
            title: r.get(1)?,
            details: r.get(2)?,
            location: r.get(3)?,
            start: r.get(4)?,
            end: r.get(5)?,
            all_day: r.get::<_, i64>(6)? != 0,
            color: r.get(7)?,
            repeat: r.get(8)?,
            repeat_until: r.get(9)?,
            reminder_mins: r.get(10)?,
            created_at: r.get(11)?,
            updated_at: r.get(12)?,
        })
    }
    const COLS: &'static str = "id, title, details, location, start, end, all_day, color, repeat, repeat_until, reminder_mins, created_at, updated_at";

    pub fn list_all_events(&self) -> Result<Vec<CalendarEvent>> {
        let conn = self.conn.lock();
        let mut st = conn.prepare(&format!("SELECT {} FROM events WHERE deleted_at IS NULL ORDER BY start", Self::COLS))?;
        let rows = st.query_map([], Self::row_to_event)?;
        rows.collect()
    }

    pub fn get_event(&self, id: &str) -> Result<Option<CalendarEvent>> {
        let conn = self.conn.lock();
        conn.query_row(&format!("SELECT {} FROM events WHERE id = ?1 AND deleted_at IS NULL", Self::COLS), params![id], Self::row_to_event)
            .map(Some)
            .or_else(|e| if e == rusqlite::Error::QueryReturnedNoRows { Ok(None) } else { Err(e) })
    }

    /// Everything happening between `from` and `to`, repeats expanded.
    pub fn list_events(&self, from: i64, to: i64) -> Result<Vec<Occurrence>> {
        let all = self.list_all_events()?;
        let mut out = Vec::new();
        for e in all {
            // Non-repeating events outside the window are skipped cheaply.
            if e.repeat == "none" && (e.end <= from || e.start >= to) {
                continue;
            }
            for (s, t) in occurrences(&e, from, to) {
                out.push(Occurrence { event: e.clone(), start: s, end: t });
            }
        }
        out.sort_by_key(|o| (o.start, o.end));
        Ok(out)
    }

    pub fn save_event(&self, event: CalendarEvent) -> Result<CalendarEvent> {
        let mut e = clean_event(event);
        let t = now();
        e.updated_at = t;
        let conn = self.conn.lock();
        let existing: Option<i64> = conn.query_row("SELECT created_at FROM events WHERE id = ?1", params![e.id], |r| r.get(0)).ok();
        e.created_at = existing.unwrap_or(t);
        conn.execute(
            "INSERT INTO events (id, title, details, location, start, end, all_day, color, repeat, repeat_until, reminder_mins, created_at, updated_at, deleted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, NULL)
             ON CONFLICT(id) DO UPDATE SET title = excluded.title, details = excluded.details, location = excluded.location,
               start = excluded.start, end = excluded.end, all_day = excluded.all_day, color = excluded.color, repeat = excluded.repeat,
               repeat_until = excluded.repeat_until, reminder_mins = excluded.reminder_mins, updated_at = excluded.updated_at, deleted_at = NULL",
            params![e.id, e.title, e.details, e.location, e.start, e.end, e.all_day as i64, e.color, e.repeat, e.repeat_until, e.reminder_mins, e.created_at, e.updated_at],
        )?;
        // A changed time means its old reminders no longer apply.
        conn.execute("DELETE FROM event_alerts WHERE event_id = ?1", params![e.id])?;
        Ok(e)
    }

    pub fn delete_event(&self, id: &str) -> Result<bool> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM event_alerts WHERE event_id = ?1", params![id])?;
        let n = conn.execute("UPDATE events SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL", params![id, now()])?;
        Ok(n > 0)
    }

    /// Reminders that should go off now (each once). Returns (event, occurrence start).
    pub fn take_due_event_alerts(&self, now_ts: i64) -> Result<Vec<(CalendarEvent, i64)>> {
        let all = self.list_all_events()?;
        let mut due = Vec::new();
        for e in all.into_iter().filter(|e| e.reminder_mins.is_some()) {
            let ahead = e.reminder_mins.unwrap_or(0) * 60 + 86_400 + 60;
            for (s, _) in occurrences(&e, now_ts - 3600, now_ts + ahead) {
                let Some(at) = reminder_time(&e, s) else { continue };
                // Fire within an hour of the planned time (LANX may have been closed).
                if at <= now_ts && now_ts - at < 3600 {
                    due.push((e.clone(), s));
                }
            }
        }
        let conn = self.conn.lock();
        let mut out = Vec::new();
        for (e, s) in due {
            let inserted = conn.execute("INSERT OR IGNORE INTO event_alerts (event_id, occurrence) VALUES (?1, ?2)", params![e.id, s])?;
            if inserted > 0 {
                out.push((e, s));
            }
        }
        Ok(out)
    }
}

/// The calendar as an .ics file (for Outlook, Google Calendar, phones).
pub fn to_ics(events: &[CalendarEvent]) -> String {
    fn esc(s: &str) -> String {
        s.replace('\\', "\\\\").replace(';', "\\;").replace(',', "\\,").replace('\n', "\\n")
    }
    fn stamp(ts: i64) -> String {
        chrono::Utc.timestamp_opt(ts, 0).single().map(|t| t.format("%Y%m%dT%H%M%SZ").to_string()).unwrap_or_default()
    }
    fn day(ts: i64) -> String {
        Local.timestamp_opt(ts, 0).single().map(|t| t.format("%Y%m%d").to_string()).unwrap_or_default()
    }
    let mut s = String::from("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//LANX//Calendar//EN\r\nCALSCALE:GREGORIAN\r\n");
    for e in events {
        s.push_str("BEGIN:VEVENT\r\n");
        s.push_str(&format!("UID:{}@lanx\r\n", e.id));
        s.push_str(&format!("DTSTAMP:{}\r\n", stamp(e.updated_at.max(1))));
        if e.all_day {
            s.push_str(&format!("DTSTART;VALUE=DATE:{}\r\nDTEND;VALUE=DATE:{}\r\n", day(e.start), day(e.end)));
        } else {
            s.push_str(&format!("DTSTART:{}\r\nDTEND:{}\r\n", stamp(e.start), stamp(e.end)));
        }
        s.push_str(&format!("SUMMARY:{}\r\n", esc(&e.title)));
        if !e.location.is_empty() {
            s.push_str(&format!("LOCATION:{}\r\n", esc(&e.location)));
        }
        if !e.details.is_empty() {
            s.push_str(&format!("DESCRIPTION:{}\r\n", esc(&e.details)));
        }
        let freq = match e.repeat.as_str() {
            "daily" => Some("DAILY"),
            "weekly" => Some("WEEKLY"),
            "monthly" => Some("MONTHLY"),
            "yearly" => Some("YEARLY"),
            _ => None,
        };
        if let Some(f) = freq {
            match e.repeat_until {
                Some(u) => s.push_str(&format!("RRULE:FREQ={};UNTIL={}\r\n", f, stamp(u + 86_399))),
                None => s.push_str(&format!("RRULE:FREQ={}\r\n", f)),
            }
        }
        if let Some(m) = e.reminder_mins {
            s.push_str(&format!("BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Reminder\r\nTRIGGER:-PT{}M\r\nEND:VALARM\r\n", m));
        }
        s.push_str("END:VEVENT\r\n");
    }
    s.push_str("END:VCALENDAR\r\n");
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::Database;
    use chrono::Timelike;

    fn ev(title: &str, start: i64, end: i64, repeat: &str) -> CalendarEvent {
        CalendarEvent {
            id: String::new(),
            title: title.into(),
            details: String::new(),
            location: String::new(),
            start,
            end,
            all_day: false,
            color: "blue".into(),
            repeat: repeat.into(),
            repeat_until: None,
            reminder_mins: None,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn repeats_expand_inside_a_window_only() {
        // 1 Jan 2026 10:00 local → use a fixed instant and plain arithmetic.
        let base = Local.with_ymd_and_hms(2026, 1, 1, 10, 0, 0).single().unwrap().timestamp();
        let hour = 3600;
        let daily = ev("Stand-up", base, base + hour, "daily");
        let week = occurrences(&daily, base + 2 * 86_400, base + 9 * 86_400);
        assert_eq!(week.len(), 7);
        assert_eq!(week[0].0, base + 2 * 86_400);
        let mut weekly = ev("Review", base, base + hour, "weekly");
        weekly.repeat_until = Some(base + 15 * 86_400);
        assert_eq!(occurrences(&weekly, base - 1, base + 60 * 86_400).len(), 3, "until stops it");
        let monthly = ev("Rent", Local.with_ymd_and_hms(2026, 1, 31, 9, 0, 0).single().unwrap().timestamp(), 0, "monthly");
        let m = occurrences(&monthly, 0, Local.with_ymd_and_hms(2026, 5, 1, 0, 0, 0).single().unwrap().timestamp());
        assert_eq!(m.len(), 4, "Jan, Feb (28th), Mar, Apr (30th)");
        let feb = Local.timestamp_opt(m[1].0, 0).single().unwrap();
        assert_eq!((feb.month(), feb.day(), feb.hour()), (2, 28, 9));
        let yearly = ev("Birthday", base, base, "yearly");
        assert_eq!(occurrences(&yearly, base - 1, base + 3 * 366 * 86_400).len(), 4);
        let single = ev("Once", base, base + hour, "none");
        assert!(occurrences(&single, base + hour, base + 2 * hour).is_empty());
        assert_eq!(occurrences(&single, base + 60, base + 2 * hour).len(), 1, "overlapping counts");
    }

    #[test]
    fn events_save_list_remind_and_export() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(dir.path()).unwrap();
        let t0 = now() + 3600;
        let mut e = ev("Dolvi site visit", t0, t0 + 7200, "none");
        e.reminder_mins = Some(60);
        e.location = "Dolvi".into();
        let e = db.save_event(e).unwrap();
        assert!(uuid::Uuid::parse_str(&e.id).is_ok());
        let list = db.list_events(now(), now() + 86_400).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].event.title, "Dolvi site visit");
        // Reminder: not yet (an hour before is "now"); fires once.
        let due = db.take_due_event_alerts(now()).unwrap();
        assert_eq!(due.len(), 1);
        assert!(db.take_due_event_alerts(now() + 10).unwrap().is_empty(), "only once");
        // All-day event is snapped to whole days.
        let mut all = ev("Diwali", t0, t0, "none");
        all.all_day = true;
        let all = db.save_event(all).unwrap();
        assert!(is_local_midnight(all.start) && all.end - all.start == 86_400);
        let ics = to_ics(&db.list_all_events().unwrap());
        assert!(ics.contains("BEGIN:VEVENT") && ics.contains("SUMMARY:Dolvi site visit") && ics.contains("VALUE=DATE"));
        assert!(db.delete_event(&e.id).unwrap());
        assert_eq!(db.list_all_events().unwrap().len(), 1);
        // Bad input is tidied, never rejected.
        let mut odd = ev("", t0 + 100, t0, "hourly");
        odd.color = "ultraviolet".into();
        let odd = db.save_event(odd).unwrap();
        assert_eq!((odd.title.as_str(), odd.repeat.as_str(), odd.color.as_str()), ("Untitled", "none", "blue"));
        assert_eq!(odd.end, odd.start + 1800);
    }
}
