//! LANX 1.6.0: organising — cards posted into a chat: notices (with "read
//! by" and "I've read it"), polls, tasks, approvals, shared checklists and
//! scheduled meetings.
//!
//! A card is a chat message (`message_type = "card"`) whose content is the
//! card as JSON. What people do with it (votes, ticks, decisions, RSVPs…) is
//! kept as small "key → value" entries per card; each change travels to
//! everyone in the chat as a `MessageAction { action: "card" }` and the newest
//! change of a key wins, so every computer shows the same card. Keys are
//! either for one person ("vote:<device id>" — only that person may set it)
//! or for the card ("status", "closed", "item:3"…) with rules on who may set
//! them. Older LANX copies get the card as plain text instead.

use super::protocol::*;
use super::{NetworkService, now_secs};
use crate::storage::models::*;
use serde_json::{Value, json};

const MAX_TEXT: usize = 200;
const MAX_LONG: usize = 4000;
const MAX_OPTIONS: usize = 10;
const MAX_ITEMS: usize = 50;
const MAX_PEOPLE: usize = 30;
/// Meetings remind everyone this long before they start.
const MEETING_REMINDER_SECS: i64 = 10 * 60;

pub const CARD_KINDS: [&str; 13] = ["notice", "poll", "task", "approval", "checklist", "event", "sync", "visitor", "kudos", "ticket", "report", "music", "game"];

/// LANX 2.7.0: where a song card's links may point (the music service's CDN
/// and JioSaavn's own site), so a card can never make LANX fetch anything else.
fn music_link(v: &Value, key: &str, hosts: &[&str]) -> String {
    let s = v.get(key).and_then(|x| x.as_str()).unwrap_or("").trim();
    if s.len() > 600 || !s.starts_with("https://") {
        return String::new();
    }
    let host = s[8..].split('/').next().unwrap_or("");
    if hosts.iter().any(|h| host == *h || host.ends_with(&format!(".{h}"))) { s.to_string() } else { String::new() }
}

/// LANX 1.8.0 kudos badges: id → (emoji, words).
pub const KUDOS_BADGES: [(&str, &str, &str); 6] = [
    ("thanks", "🙏", "Thank you"),
    ("teamwork", "🤝", "Great teamwork"),
    ("solver", "🧠", "Problem solver"),
    ("above", "🚀", "Above and beyond"),
    ("helper", "🫶", "Helping hand"),
    ("star", "⭐", "Star of the week"),
];

pub fn kudos_badge(id: &str) -> (&'static str, &'static str, &'static str) {
    KUDOS_BADGES.iter().copied().find(|(b, _, _)| *b == id).unwrap_or(KUDOS_BADGES[0])
}

/// The oldest LANX that shows this card as a card (older copies get text).
pub fn card_min_version(content: &str) -> &'static str {
    match parse_card(content).as_ref().and_then(|c| c["kind"].as_str().map(|s| s.to_string())).as_deref() {
        Some("sync") => FEATURES_TOOLS,
        Some("visitor" | "kudos") => FEATURES_OFFICE,
        Some("ticket") => FEATURES_HELP,
        Some("report") => FEATURES_REPORT,
        Some("music") => FEATURES_MUSIC,
        Some("game") => {
            let c = parse_card(content).unwrap_or_default();
            if c["players"].as_array().is_some_and(|p| p.len() > 2) {
                return FEATURES_MULTIPLAYER;
            }
            super::games::game_min_version(c["game"].as_str().unwrap_or(""))
        }
        _ => FEATURES_ORG,
    }
}

fn text(v: &Value, key: &str, max: usize) -> String {
    v.get(key)
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim()
        .chars()
        .map(|c| if c.is_control() && c != '\n' { ' ' } else { c })
        .take(max)
        .collect()
}

fn ids(v: &Value, key: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for x in v.get(key).and_then(|x| x.as_array()).cloned().unwrap_or_default() {
        if let Some(s) = x.as_str() {
            if !s.is_empty() && s.len() <= 64 && !out.iter().any(|o| o == s) {
                out.push(s.to_string());
            }
        }
        if out.len() >= MAX_PEOPLE {
            break;
        }
    }
    out
}

fn strings(v: &Value, key: &str, max_items: usize, max_len: usize) -> Vec<String> {
    v.get(key)
        .and_then(|x| x.as_array())
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter_map(|x| x.as_str())
        .map(|s| s.trim().chars().filter(|c| !c.is_control()).take(max_len).collect::<String>())
        .filter(|s| !s.is_empty())
        .take(max_items)
        .collect()
}

/// Checks a card and returns it tidied (only known fields, sensible sizes).
pub fn clean_card(v: &Value) -> Result<Value, String> {
    let kind = v.get("kind").and_then(|k| k.as_str()).unwrap_or("");
    let card = match kind {
        "notice" => {
            let title = text(v, "title", 120);
            let body = text(v, "body", MAX_LONG);
            if title.is_empty() && body.is_empty() {
                return Err("Write the notice first.".to_string());
            }
            json!({ "kind": kind, "title": title, "body": body,
                    "important": v.get("important").and_then(|x| x.as_bool()).unwrap_or(false),
                    "ack": v.get("ack").and_then(|x| x.as_bool()).unwrap_or(true) })
        }
        "poll" => {
            let question = text(v, "question", MAX_TEXT);
            let options = strings(v, "options", MAX_OPTIONS, 100);
            if question.is_empty() {
                return Err("Write the question.".to_string());
            }
            if options.len() < 2 {
                return Err("A poll needs at least two answers.".to_string());
            }
            json!({ "kind": kind, "question": question, "options": options,
                    "multi": v.get("multi").and_then(|x| x.as_bool()).unwrap_or(false) })
        }
        "task" => {
            let title = text(v, "title", MAX_TEXT);
            if title.is_empty() {
                return Err("Say what needs doing.".to_string());
            }
            json!({ "kind": kind, "title": title, "notes": text(v, "notes", 2000),
                    "assignee": text(v, "assignee", 64),
                    "due": v.get("due").and_then(|x| x.as_i64()).filter(|d| *d > 0),
                    "from_message": v.get("from_message").and_then(|x| x.as_str()).filter(|s| s.len() <= 64) })
        }
        "approval" => {
            let title = text(v, "title", MAX_TEXT);
            let approvers = ids(v, "approvers");
            if title.is_empty() {
                return Err("Say what needs approving.".to_string());
            }
            if approvers.is_empty() {
                return Err("Choose who should approve it.".to_string());
            }
            json!({ "kind": kind, "title": title, "details": text(v, "details", 2000),
                    "amount": text(v, "amount", 40), "approvers": approvers })
        }
        "checklist" => {
            let title = text(v, "title", MAX_TEXT);
            let items = strings(v, "items", MAX_ITEMS, MAX_TEXT);
            if title.is_empty() {
                return Err("Give the checklist a title.".to_string());
            }
            if items.is_empty() {
                return Err("Add at least one item.".to_string());
            }
            json!({ "kind": kind, "title": title, "items": items })
        }
        "event" => {
            let title = text(v, "title", MAX_TEXT);
            let start = v.get("start").and_then(|x| x.as_i64()).unwrap_or(0);
            if title.is_empty() {
                return Err("Give the meeting a title.".to_string());
            }
            if start <= 0 {
                return Err("Pick when the meeting is.".to_string());
            }
            let minutes = v.get("minutes").and_then(|x| x.as_i64()).unwrap_or(30).clamp(5, 600);
            json!({ "kind": kind, "title": title, "start": start, "minutes": minutes,
                    "attendees": ids(v, "attendees"), "place": text(v, "place", 120),
                    "video": v.get("video").and_then(|x| x.as_bool()).unwrap_or(true),
                    "agenda": text(v, "agenda", 2000) })
        }
        "sync" => {
            let name = text(v, "name", 120);
            let share_id = text(v, "share_id", 64);
            if share_id.is_empty() {
                return Err("Unknown shared folder.".to_string());
            }
            json!({ "kind": kind, "name": if name.is_empty() { "Shared folder".to_string() } else { name }, "share_id": share_id,
                    "files": v.get("files").and_then(|x| x.as_u64()).unwrap_or(0),
                    "bytes": v.get("bytes").and_then(|x| x.as_u64()).unwrap_or(0) })
        }
        "visitor" => {
            let visitor = text(v, "visitor", 80);
            let host = text(v, "host", 64);
            if visitor.is_empty() {
                return Err("Write the visitor's name.".to_string());
            }
            if host.is_empty() {
                return Err("Choose who the visitor is for.".to_string());
            }
            json!({ "kind": kind, "visitor": visitor, "company": text(v, "company", 80), "host": host,
                    "host_name": text(v, "host_name", 80), "note": text(v, "note", 300) })
        }
        "report" => {
            let to = ids(v, "to");
            if to.is_empty() {
                return Err("Choose who the report is for (your manager).".to_string());
            }
            let done = text(v, "done", 2000);
            let pending = text(v, "pending", 2000);
            let blockers = text(v, "blockers", 2000);
            if done.is_empty() && pending.is_empty() && blockers.is_empty() {
                return Err("Write at least one line.".to_string());
            }
            json!({ "kind": kind, "to": to, "done": done, "pending": pending, "blockers": blockers,
                    "day": v.get("day").and_then(|x| x.as_i64()).filter(|d| *d > 0) })
        }
        "ticket" => {
            let title = text(v, "title", MAX_TEXT);
            if title.is_empty() {
                return Err("Say what the problem is.".to_string());
            }
            let helpers = ids(v, "helpers");
            if helpers.is_empty() {
                return Err("Choose who should help (your IT person).".to_string());
            }
            json!({ "kind": kind, "title": title, "details": text(v, "details", 2000), "helpers": helpers,
                    "pc": text(v, "pc", 80), "app": text(v, "app", 40), "os": text(v, "os", 60),
                    "shot": v.get("shot").and_then(|x| x.as_bool()).unwrap_or(false) })
        }
        "game" => {
            let game = text(v, "game", 20);
            if !super::games::GAME_IDS.contains(&game.as_str()) {
                return Err("Unknown game.".to_string());
            }
            let id = text(v, "id", 64);
            if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
                return Err("Bad challenge.".to_string());
            }
            let to = text(v, "to", 64);
            if to.is_empty() {
                return Err("Choose who to play with.".to_string());
            }
            // 2.10.0: a table of several players (ids and names, in turn order).
            let players = ids(v, "players");
            let names = strings(v, "names", MAX_PEOPLE, 80);
            if players.len() > 2 {
                json!({ "kind": kind, "id": id, "game": game, "to": to, "to_name": text(v, "to_name", 80), "from_name": text(v, "from_name", 80),
                        "players": players, "names": names })
            } else {
                json!({ "kind": kind, "id": id, "game": game, "to": to, "to_name": text(v, "to_name", 80), "from_name": text(v, "from_name", 80) })
            }
        }
        "music" => {
            let title = text(v, "title", 160);
            if title.is_empty() {
                return Err("Pick a song first.".to_string());
            }
            let stream = music_link(v, "stream", &["saavncdn.com"]);
            if stream.is_empty() {
                return Err("This song has no stream LANX can play.".to_string());
            }
            json!({ "kind": kind, "id": text(v, "id", 64), "title": title, "artist": text(v, "artist", 160),
                    "cover": music_link(v, "cover", &["saavncdn.com"]), "url": music_link(v, "url", &["jiosaavn.com"]),
                    "stream": stream, "duration": v.get("duration").and_then(|x| x.as_i64()).filter(|d| *d > 0).unwrap_or(0) })
        }
        "kudos" => {
            let to = text(v, "to", 64);
            if to.is_empty() {
                return Err("Choose who the kudos are for.".to_string());
            }
            let (badge, _, _) = kudos_badge(v.get("badge").and_then(|b| b.as_str()).unwrap_or(""));
            json!({ "kind": kind, "to": to, "to_name": text(v, "to_name", 80), "badge": badge, "note": text(v, "note", 300) })
        }
        _ => return Err("Unknown kind of card.".to_string()),
    };
    Ok(card)
}

pub fn parse_card(content: &str) -> Option<Value> {
    serde_json::from_str::<Value>(content).ok().filter(|v| v.get("kind").and_then(|k| k.as_str()).is_some_and(|k| CARD_KINDS.contains(&k)))
}

/// One line for the chat list: "📊 Poll: Lunch?".
pub fn card_preview(content: &str) -> String {
    let Some(v) = parse_card(content) else { return "Card".to_string() };
    let t = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
    let line = match v["kind"].as_str().unwrap_or("") {
        "notice" => format!("📢 {}", if t("title").is_empty() { t("body") } else { t("title") }),
        "poll" => format!("📊 Poll: {}", t("question")),
        "task" => format!("✅ Task: {}", t("title")),
        "approval" => format!("🖊️ Approval: {}", t("title")),
        "checklist" => format!("☑️ Checklist: {}", t("title")),
        "event" => format!("📅 Meeting: {}", t("title")),
        "sync" => format!("📁 Shared folder: {}", t("name")),
        "visitor" => format!("🛎️ Visitor: {}{}", t("visitor"), if t("company").is_empty() { String::new() } else { format!(" ({})", t("company")) }),
        "kudos" => format!("{} Kudos to {}: {}", kudos_badge(&t("badge")).1, t("to_name"), kudos_badge(&t("badge")).2),
        "ticket" => format!("🛟 IT help: {}", t("title")),
        "report" => "📋 End-of-day report".to_string(),
        "music" => format!("🎵 {} — {}", t("title"), t("artist")),
        "game" => match v["players"].as_array().map(|p| p.len()).unwrap_or(0) {
            n if n > 2 => format!("🎮 {}: {}'s table ({} players)", super::games::game_name(&t("game")), t("from_name"), n),
            _ => format!("🎮 {}: {} vs {}", super::games::game_name(&t("game")), t("from_name"), t("to_name")),
        },
        _ => "Card".to_string(),
    };
    crate::storage::preview_text(&line)
}

/// The card as plain text, for colleagues whose LANX is older than 1.6.0.
pub fn card_fallback(content: &str) -> String {
    let Some(v) = parse_card(content) else { return content.to_string() };
    let t = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
    let update = "\n(Update LANX to answer here.)";
    match v["kind"].as_str().unwrap_or("") {
        "notice" => format!("📢 NOTICE{}: {}\n{}", if v["important"].as_bool() == Some(true) { " (important)" } else { "" }, t("title"), t("body")),
        "poll" => {
            let opts: Vec<String> = v["options"].as_array().cloned().unwrap_or_default().iter().enumerate()
                .map(|(i, o)| format!("{}. {}", i + 1, o.as_str().unwrap_or(""))).collect();
            format!("📊 POLL: {}\n{}{}", t("question"), opts.join("\n"), update)
        }
        "task" => format!("✅ TASK: {}\n{}{}", t("title"), t("notes"), update),
        "approval" => format!("🖊️ APPROVAL NEEDED: {}\n{}{}{}", t("title"), t("details"), if t("amount").is_empty() { String::new() } else { format!("\nAmount: {}", t("amount")) }, update),
        "checklist" => {
            let items: Vec<String> = v["items"].as_array().cloned().unwrap_or_default().iter()
                .map(|o| format!("☐ {}", o.as_str().unwrap_or(""))).collect();
            format!("☑️ CHECKLIST: {}\n{}", t("title"), items.join("\n"))
        }
        "event" => {
            let start = v["start"].as_i64().unwrap_or(0);
            let when = chrono::DateTime::from_timestamp(start, 0)
                .map(|d| d.with_timezone(&chrono::Local).format("%a %d %b, %H:%M").to_string())
                .unwrap_or_default();
            format!("📅 MEETING: {}\n{} ({} min){}", t("title"), when, v["minutes"].as_i64().unwrap_or(30), update)
        }
        "sync" => format!("📁 SHARED FOLDER: {}{}", t("name"), update),
        "visitor" => format!(
            "🛎️ VISITOR for {}: {}{} is at reception.{}{}",
            if t("host_name").is_empty() { "you".to_string() } else { t("host_name") },
            t("visitor"),
            if t("company").is_empty() { String::new() } else { format!(" ({})", t("company")) },
            if t("note").is_empty() { String::new() } else { format!("\n{}", t("note")) },
            "\n(Reply here in the chat.)"
        ),
        "kudos" => {
            let (_, e, w) = kudos_badge(&t("badge"));
            format!("{} KUDOS to {}: {}{}", e, t("to_name"), w, if t("note").is_empty() { String::new() } else { format!("\n{}", t("note")) })
        }
        "ticket" => format!(
            "🛟 IT HELP NEEDED: {}\n{}\nFrom: {} · LANX {} · {}{}",
            t("title"), t("details"), t("pc"), t("app"), t("os"),
            if v["shot"].as_bool() == Some(true) { "\n(A screenshot was sent in this chat.)" } else { "" }
        ),
        "report" => {
            let sec = |label: &str, k: &str| if t(k).is_empty() { String::new() } else { format!("\n{}:\n{}", label, t(k)) };
            format!("📋 END-OF-DAY REPORT{}{}{}", sec("Done", "done"), sec("Still to do", "pending"), sec("Blockers", "blockers"))
        }
        "music" => format!("🎵 SONG: {} — {}{}\n(Update LANX to play it here.)", t("title"), t("artist"), if t("url").is_empty() { String::new() } else { format!("\n{}", t("url")) }),
        "game" => match v["players"].as_array().map(|p| p.len()).unwrap_or(0) {
            n if n > 2 => format!("🎮 GAME: {} opens a {} table for {} players.\n(Update LANX to 2.10.0 to join it here.)", t("from_name"), super::games::game_name(&t("game")), n),
            _ => format!("🎮 GAME: {} challenges you to {}.\n(Update LANX to {} to play it here.)", t("from_name"), super::games::game_name(&t("game")), super::games::game_min_version(&t("game"))),
        },
        _ => content.to_string(),
    }
}

/// May `actor` set `key` to `value` on this card (made by `creator`)?
/// Returns the value as stored.
pub fn check_card_change(card: &Value, creator: &str, actor: &str, key: &str, value: &Value) -> Result<Value, String> {
    let kind = card["kind"].as_str().unwrap_or("");
    let own = |prefix: &str| key.strip_prefix(prefix).is_some_and(|who| who == actor);
    let no = |why: &str| Err(why.to_string());
    match kind {
        "notice" if own("ack:") => Ok(json!(value.as_bool().unwrap_or(true))),
        "poll" if own("vote:") => {
            let n = card["options"].as_array().map(|a| a.len()).unwrap_or(0);
            let mut picks: Vec<u64> = value.as_array().cloned().unwrap_or_default().iter().filter_map(|x| x.as_u64()).filter(|i| (*i as usize) < n).collect();
            picks.sort_unstable();
            picks.dedup();
            if card["multi"].as_bool() != Some(true) && picks.len() > 1 {
                return no("Pick one answer.");
            }
            Ok(json!(picks))
        }
        "poll" if key == "closed" => {
            if actor != creator {
                return no("Only the person who asked can close the poll.");
            }
            Ok(json!(value.as_bool().unwrap_or(true)))
        }
        "task" if key == "status" => {
            let assignee = card["assignee"].as_str().unwrap_or("");
            if !assignee.is_empty() && actor != assignee && actor != creator {
                return no("Only the person it's for, or who made it, can change it.");
            }
            match value.as_str() {
                Some(s @ ("open" | "done")) => Ok(json!(s)),
                _ => no("Unknown task state"),
            }
        }
        "approval" if own("decision:") => {
            let approvers: Vec<&str> = card["approvers"].as_array().map(|a| a.iter().filter_map(|x| x.as_str()).collect()).unwrap_or_default();
            if !approvers.contains(&actor) {
                return no("You aren't asked to approve this.");
            }
            let d = value["d"].as_str().unwrap_or("");
            if d != "approved" && d != "rejected" {
                return no("Approve or reject.");
            }
            let note: String = value["note"].as_str().unwrap_or("").trim().chars().filter(|c| !c.is_control()).take(300).collect();
            Ok(json!({ "d": d, "note": note }))
        }
        "checklist" if key.starts_with("item:") => {
            let i: usize = key[5..].parse().map_err(|_| "Unknown item".to_string())?;
            if i >= MAX_ITEMS * 2 {
                return no("Unknown item");
            }
            Ok(json!(value.as_bool().unwrap_or(false)))
        }
        "checklist" if key.starts_with("add:") => {
            let id = &key[4..];
            if id.is_empty() || id.len() > 40 {
                return no("Unknown item");
            }
            let t: String = value.as_str().unwrap_or("").trim().chars().filter(|c| !c.is_control()).take(MAX_TEXT).collect();
            if t.is_empty() {
                return no("Write the item.");
            }
            Ok(json!(t))
        }
        "event" if own("rsvp:") => match value.as_str() {
            Some(s @ ("yes" | "no" | "maybe")) => Ok(json!(s)),
            _ => no("Answer yes, no or maybe."),
        },
        "event" if key == "cancelled" => {
            if actor != creator {
                return no("Only the organiser can cancel the meeting.");
            }
            Ok(json!(value.as_bool().unwrap_or(true)))
        }
        // LANX 1.8.0: the person the visitor came for answers; reception
        // marks them as met (or gone).
        // LANX 2.9.0: how the match ended ("Asha won", "Draw"…), set by either player.
        "game" if key == "result" => {
            let to = card["to"].as_str().unwrap_or("");
            if actor != creator && actor != to {
                return no("Only the two players can record the result.");
            }
            match value.as_str() {
                Some(s) if !s.is_empty() => Ok(json!(s.chars().take(80).collect::<String>())),
                _ => no("Say how it ended."),
            }
        }
        "visitor" if key == "reply" => {
            if actor != card["host"].as_str().unwrap_or("") {
                return no("Only the person the visitor came for can answer.");
            }
            let r = value["r"].as_str().unwrap_or("");
            if !matches!(r, "coming" | "5min" | "send-in" | "busy") {
                return no("Unknown answer");
            }
            let note: String = value["note"].as_str().unwrap_or("").trim().chars().filter(|c| !c.is_control()).take(120).collect();
            Ok(json!({ "r": r, "note": note }))
        }
        "visitor" if key == "status" => {
            if actor != creator {
                return no("Only reception can change this.");
            }
            match value.as_str() {
                Some(s @ ("waiting" | "met" | "left")) => Ok(json!(s)),
                _ => no("Unknown visitor state"),
            }
        }
        "kudos" if own("plus:") => Ok(json!(value.as_bool().unwrap_or(true))),
        // LANX 2.3.0 IT help desk: a helper (or the person who asked) moves
        // the ticket along; a helper can mark that they are on it.
        "ticket" if key == "status" => {
            let helpers: Vec<&str> = card["helpers"].as_array().map(|a| a.iter().filter_map(|x| x.as_str()).collect()).unwrap_or_default();
            if actor != creator && !helpers.contains(&actor) {
                return no("Only your IT helper, or the person who asked, can change this.");
            }
            match value.as_str() {
                Some(s @ ("open" | "working" | "resolved")) => Ok(json!(s)),
                _ => no("Unknown ticket state"),
            }
        }
        "report" if own("ack:") => {
            let to: Vec<&str> = card["to"].as_array().map(|a| a.iter().filter_map(|x| x.as_str()).collect()).unwrap_or_default();
            if !to.contains(&actor) {
                return no("Only the manager it's for can tick it.");
            }
            Ok(json!(value.as_bool().unwrap_or(true)))
        }
        "ticket" if own("taken:") => {
            let helpers: Vec<&str> = card["helpers"].as_array().map(|a| a.iter().filter_map(|x| x.as_str()).collect()).unwrap_or_default();
            if !helpers.contains(&actor) {
                return no("Only an IT helper can take this.");
            }
            Ok(json!(value.as_bool().unwrap_or(true)))
        }
        _ => no("That can't be changed on this card."),
    }
}

impl NetworkService {
    /// Posts a card into a chat.
    pub async fn send_card(&self, conversation_id: &str, card: &Value) -> Result<Message, String> {
        let card = clean_card(card)?;
        let content = card.to_string();
        if content.len() > MAX_MESSAGE_CONTENT_LEN {
            return Err("The card is too long.".to_string());
        }
        let m = self.send_typed(conversation_id, &content, "card", None, Vec::new()).await?;
        self.card_reminders(&m);
        Ok(m)
    }

    fn creator_of(&self, m: &Message) -> String {
        if m.is_outgoing { self.identity.device_id.clone() } else { m.sender_id.clone() }
    }

    /// Something you did on a card (vote, tick, decision, RSVP…).
    pub fn card_action(&self, message_id: &str, key: &str, value: &Value) -> Result<Message, String> {
        let m = self
            .db
            .get_message_by_id(message_id)
            .map_err(|e| e.to_string())?
            .filter(|m| m.message_type == "card" && !m.deleted)
            .ok_or("Card not found")?;
        let card = parse_card(&m.content).ok_or("Card not found")?;
        let me = self.identity.device_id.clone();
        let value = check_card_change(&card, &self.creator_of(&m), &me, key, value)?;
        let at = now_secs().max(self.db.card_entry_at(message_id, key).unwrap_or(0) + 1);
        let json = value.to_string();
        self.db.set_card_state(message_id, key, &me, &json, at).map_err(|e| e.to_string())?;
        self.queue_card_action(&m.conversation_id, message_id, key, &json, at)?;
        let fresh = self.db.get_message_full(message_id).ok().flatten().ok_or("Card not found")?;
        self.events.message_updated(&fresh);
        if card["kind"] == "task" && key == "status" && value == "done" {
            let _ = self.db.cancel_reminder(message_id);
        }
        Ok(fresh)
    }

    /// A colleague's change to a card (from `handle_message_action`).
    pub(super) fn apply_remote_card_change(&self, peer: &Peer, m: &Message, key: &str, value: &str, at: i64) -> Result<bool, String> {
        if m.message_type != "card" || m.deleted {
            return Ok(false);
        }
        let card = parse_card(&m.content).ok_or("Not a card")?;
        let v: Value = serde_json::from_str(value).map_err(|_| "Bad value".to_string())?;
        let stored = check_card_change(&card, &self.creator_of(m), &peer.id, key, &v)?;
        self.db
            .set_card_state(&m.id, key, &peer.id, &stored.to_string(), at)
            .map_err(|e| e.to_string())
    }

    /// Task due dates and meetings remind the people concerned by themselves.
    pub(super) fn card_reminders(&self, m: &Message) {
        let Some(card) = parse_card(&m.content) else { return };
        let me = self.identity.device_id.as_str();
        let creator = self.creator_of(m);
        let now = now_secs();
        let at = match card["kind"].as_str() {
            Some("task") => {
                let assignee = card["assignee"].as_str().unwrap_or("");
                let mine = assignee == me || (assignee.is_empty() && creator == me);
                card["due"].as_i64().filter(|_| mine)
            }
            Some("event") => {
                let attending = creator == me
                    || card["attendees"].as_array().is_some_and(|a| a.iter().any(|x| x.as_str() == Some(me)))
                    || card["attendees"].as_array().is_none_or(|a| a.is_empty());
                card["start"].as_i64().filter(|_| attending).map(|s| s - MEETING_REMINDER_SECS)
            }
            _ => None,
        };
        if let Some(at) = at.filter(|a| *a > now) {
            let _ = self.db.set_reminder(&m.id, &m.conversation_id, at);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cards_are_checked_and_tidied() {
        let p = clean_card(&json!({ "kind": "poll", "question": " Lunch? ", "options": ["Canteen", "", "Dhaba"], "evil": 1 })).unwrap();
        assert_eq!(p, json!({ "kind": "poll", "question": "Lunch?", "options": ["Canteen", "Dhaba"], "multi": false }));
        assert!(clean_card(&json!({ "kind": "poll", "question": "?", "options": ["one"] })).is_err());
        assert!(clean_card(&json!({ "kind": "approval", "title": "PO 431" })).is_err(), "needs an approver");
        assert!(clean_card(&json!({ "kind": "rocket" })).is_err());
        let e = clean_card(&json!({ "kind": "event", "title": "Review", "start": 2_000_000_000, "minutes": 9999 })).unwrap();
        assert_eq!(e["minutes"], 600);
        assert_eq!(e["video"], true);

        // LANX 2.3.0 IT help desk ticket.
        let t = clean_card(&json!({ "kind": "ticket", "title": " Printer stuck ", "helpers": ["it1", "it2"], "pc": "ACCTS-01", "app": "2.3.0", "os": "Windows 11", "shot": true })).unwrap();
        assert_eq!((t["title"].as_str(), t["helpers"].as_array().map(|a| a.len()), t["shot"].as_bool()), (Some("Printer stuck"), Some(2), Some(true)));
        assert!(clean_card(&json!({ "kind": "ticket", "title": "x" })).is_err(), "needs a helper");
        assert!(clean_card(&json!({ "kind": "ticket", "helpers": ["it1"] })).is_err(), "needs a title");

        // LANX 2.4.0 end-of-day report.
        let r = clean_card(&json!({ "kind": "report", "to": ["mgr"], "done": " Shipped PO 12 ", "pending": "", "blockers": "none" })).unwrap();
        assert_eq!((r["to"].as_array().map(|a| a.len()), r["done"].as_str()), (Some(1), Some("Shipped PO 12")));
        assert!(clean_card(&json!({ "kind": "report", "to": ["mgr"] })).is_err(), "needs at least one line");
        assert!(clean_card(&json!({ "kind": "report", "done": "x" })).is_err(), "needs a manager");
    }

    #[test]
    fn only_the_right_people_change_a_card() {
        let poll = clean_card(&json!({ "kind": "poll", "question": "Q", "options": ["a", "b", "c"] })).unwrap();
        assert_eq!(check_card_change(&poll, "asha", "bharat", "vote:bharat", &json!([2, 2])).unwrap(), json!([2]));
        assert!(check_card_change(&poll, "asha", "bharat", "vote:chetan", &json!([0])).is_err(), "no voting for others");
        assert!(check_card_change(&poll, "asha", "bharat", "vote:bharat", &json!([0, 1])).is_err(), "single choice");
        assert!(check_card_change(&poll, "asha", "bharat", "closed", &json!(true)).is_err());
        assert!(check_card_change(&poll, "asha", "asha", "closed", &json!(true)).is_ok());

        let task = clean_card(&json!({ "kind": "task", "title": "Send invoice", "assignee": "bharat" })).unwrap();
        assert!(check_card_change(&task, "asha", "bharat", "status", &json!("done")).is_ok());
        assert!(check_card_change(&task, "asha", "asha", "status", &json!("open")).is_ok());
        assert!(check_card_change(&task, "asha", "chetan", "status", &json!("done")).is_err());

        let appr = clean_card(&json!({ "kind": "approval", "title": "PO", "approvers": ["chetan"] })).unwrap();
        assert!(check_card_change(&appr, "asha", "chetan", "decision:chetan", &json!({ "d": "approved", "note": "ok" })).is_ok());
        assert!(check_card_change(&appr, "asha", "bharat", "decision:bharat", &json!({ "d": "approved" })).is_err());
        assert!(check_card_change(&appr, "asha", "chetan", "decision:chetan", &json!({ "d": "maybe" })).is_err());

        // Ticket: a helper or the person who asked moves it; others can't.
        let tk = clean_card(&json!({ "kind": "ticket", "title": "VPN down", "helpers": ["it1"] })).unwrap();
        assert!(check_card_change(&tk, "asha", "it1", "status", &json!("working")).is_ok());
        assert!(check_card_change(&tk, "asha", "asha", "status", &json!("resolved")).is_ok());
        assert!(check_card_change(&tk, "asha", "bharat", "status", &json!("working")).is_err());
        assert!(check_card_change(&tk, "asha", "chetan", "status", &json!("flying")).is_err());
        assert!(check_card_change(&tk, "asha", "it1", "taken:it1", &json!(true)).is_ok());
        assert!(check_card_change(&tk, "asha", "asha", "taken:asha", &json!(true)).is_err(), "only a helper takes it");

        // Report: only the manager it's for can tick it.
        let rp = clean_card(&json!({ "kind": "report", "to": ["mgr"], "done": "x" })).unwrap();
        assert!(check_card_change(&rp, "asha", "mgr", "ack:mgr", &json!(true)).is_ok());
        assert!(check_card_change(&rp, "asha", "bharat", "ack:bharat", &json!(true)).is_err());

        let ev = clean_card(&json!({ "kind": "event", "title": "Review", "start": 5 })).unwrap();
        assert!(check_card_change(&ev, "asha", "bharat", "rsvp:bharat", &json!("maybe")).is_ok());
        assert!(check_card_change(&ev, "asha", "bharat", "cancelled", &json!(true)).is_err());
    }

    #[test]
    fn older_copies_get_readable_text() {
        let c = clean_card(&json!({ "kind": "poll", "question": "Lunch?", "options": ["Canteen", "Dhaba"] })).unwrap().to_string();
        assert_eq!(card_fallback(&c), "📊 POLL: Lunch?\n1. Canteen\n2. Dhaba\n(Update LANX to answer here.)");
        assert_eq!(card_preview(&c), "📊 Poll: Lunch?");
    }
}

#[cfg(test)]
mod game_card_tests {
    use super::*;

    #[test]
    fn a_challenge_card_is_checked_and_tidied() {
        let good = json!({ "kind": "game", "id": "m-7f3a", "game": "chess", "to": "peer-b", "to_name": "Bharat", "from_name": "Asha", "extra": 1 });
        let c = clean_card(&good).unwrap();
        assert_eq!(c["kind"], "game");
        assert_eq!(c["game"], "chess");
        assert!(c.get("extra").is_none(), "unknown fields are dropped");
        let text = c.to_string();
        assert!(card_min_version(&text) == FEATURES_GAMES, "older copies get text instead");
        assert!(card_preview(&text).contains("Chess"));
        assert!(card_fallback(&text).contains("Update LANX"));
        assert!(clean_card(&json!({ "kind": "game", "id": "m1", "game": "chaupar", "to": "x" })).is_err(), "unknown game");
        let chain = clean_card(&json!({ "kind": "game", "id": "m2", "game": "chainreaction", "to": "peer-b" })).unwrap().to_string();
        assert_eq!(card_min_version(&chain), FEATURES_CHAIN_REACTION, "Chain Reaction needs 2.9.1 on the other side");
        assert!(card_preview(&chain).contains("Chain Reaction"));
        // 2.10.0: a table of three needs the newer copy everywhere; a card for two keeps the older rule.
        let table = clean_card(&json!({ "kind": "game", "id": "m3", "game": "chainreaction", "to": "peer-b", "from_name": "Asha",
                                        "players": ["peer-a", "peer-b", "peer-c"], "names": ["Asha", "Bharat", "Chitra"] })).unwrap();
        assert_eq!(table["players"].as_array().map(|p| p.len()), Some(3));
        assert_eq!(card_min_version(&table.to_string()), FEATURES_MULTIPLAYER);
        assert!(card_preview(&table.to_string()).contains("3 players"));
        assert!(card_fallback(&table.to_string()).contains("2.10.0"));
        let pair = clean_card(&json!({ "kind": "game", "id": "m4", "game": "chainreaction", "to": "peer-b", "players": ["peer-a", "peer-b"] })).unwrap();
        assert!(pair.get("players").is_none(), "two players need no table");
        assert!(clean_card(&json!({ "kind": "game", "id": "../m", "game": "chess", "to": "x" })).is_err(), "odd id");
        assert!(clean_card(&json!({ "kind": "game", "id": "m1", "game": "chess" })).is_err(), "no opponent");
        // Only the two players record how it ended.
        assert!(check_card_change(&c, "peer-a", "peer-b", "result", &json!("Bharat won")).is_ok());
        assert!(check_card_change(&c, "peer-a", "peer-a", "result", &json!("Draw")).is_ok());
        assert!(check_card_change(&c, "peer-a", "peer-z", "result", &json!("Zed won")).is_err());
    }
}

mod music_card_tests {
    use super::*;

    #[test]
    fn a_song_card_is_checked_and_tidied() {
        let good = json!({ "kind": "music", "id": "abc", "title": "Tum Hi Ho &amp; more", "artist": "Mithoon",
            "cover": "https://c.saavncdn.com/430/x-500x500.jpg", "url": "https://www.jiosaavn.com/song/tum-hi-ho/x",
            "stream": "https://aac.saavncdn.com/430/x_320.mp4", "duration": 262 });
        let c = clean_card(&good).expect("a proper song card");
        assert_eq!(c["kind"], "music");
        assert_eq!(c["stream"], "https://aac.saavncdn.com/430/x_320.mp4");
        assert_eq!(c["duration"], 262);
        let text = c.to_string();
        assert!(card_min_version(&text) == FEATURES_MUSIC, "older copies get text instead");
        assert!(card_preview(&text).starts_with("🎵 "), "{}", card_preview(&text));
        let fallback = card_fallback(&text);
        assert!(fallback.contains("Mithoon") && fallback.contains("https://www.jiosaavn.com/song/tum-hi-ho/x") && fallback.contains("Update LANX"), "{fallback}");

        // Links that are not the music service's are dropped; a foreign stream means no card.
        let odd = json!({ "kind": "music", "title": "X", "artist": "Y", "cover": "https://evil.example/a.jpg",
            "url": "javascript:alert(1)", "stream": "https://aac.saavncdn.com/ok.mp4" });
        let c = clean_card(&odd).unwrap();
        assert_eq!(c["cover"], "");
        assert_eq!(c["url"], "");
        let foreign = json!({ "kind": "music", "title": "X", "artist": "Y", "stream": "https://evil.example/x.mp4" });
        assert!(clean_card(&foreign).is_err());
        let untitled = json!({ "kind": "music", "stream": "https://aac.saavncdn.com/ok.mp4" });
        assert!(clean_card(&untitled).is_err());
    }
}
