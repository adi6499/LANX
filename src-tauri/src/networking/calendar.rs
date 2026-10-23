//! LANX 2.5.0: calendar reminders ("📅 Coming up") — checked with the other
//! timers every few seconds; each occurrence reminds once.

use super::Inner;
use crate::events::{AlertKind, IslandAlert};
use chrono::{Local, TimeZone};
use serde::Serialize;

#[derive(Serialize, Clone)]
struct CalendarAlertEvent {
    event_id: String,
    title: String,
    text: String,
    start: i64,
}

impl Inner {
    pub(super) fn calendar_alerts(&self, now: i64) {
        for (e, start) in self.db.take_due_event_alerts(now).unwrap_or_default() {
            let when = Local.timestamp_opt(start, 0).single();
            let time = match (e.all_day, when) {
                (true, Some(d)) => d.format("%a %-d %b").to_string(),
                (false, Some(d)) => d.format("%-I:%M %p").to_string(),
                _ => String::new(),
            };
            let mut text = if e.all_day { format!("Today · {time}") } else { format!("At {time}") };
            if !e.location.is_empty() {
                text.push_str(&format!(" · {}", e.location));
            }
            let private = self.privacy.is_locked();
            let title = if private { "📅 Coming up".to_string() } else { format!("📅 {}", e.title) };
            let body = if private { "Open LANX to see it".to_string() } else { text.clone() };
            self.events.emit_json(
                "lanx://calendar-alert",
                CalendarAlertEvent { event_id: e.id.clone(), title: title.clone(), text: body.clone(), start },
            );
            let alert = IslandAlert {
                id: format!("event-{}-{}", e.id, start),
                kind: "message".into(),
                title: title.clone(),
                body: body.clone(),
                conversation_id: None,
                private,
                ..Default::default()
            };
            self.events.notify_island(&self.db, AlertKind::Ring, &title, &body, alert);
        }
    }
}
