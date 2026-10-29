//! What a phone can ask this PC for, and what it is told about as it happens.
//!
//! Requests are JSON lines `{"id":…, "op":"…", …}` answered with
//! `{"id":…, "ok":true, …}` or `{"id":…, "ok":false, "error":"…"}`. Pushes
//! are `{"ev":"…", …}`. Everything goes through the same engine calls the
//! desktop window uses (`send_message_full`, `mark_read_and_notify`, …), so
//! a message from the phone is simply a message from this PC.

use super::PhoneService;
use crate::networking::tools::STICKERS;
use crate::storage::models::{Message, SearchHit, TransferRecord};
use parking_lot::Mutex;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

/// A connected phone.
pub(crate) struct Client {
    pub id: u64,
    pub device: super::PhoneDevice,
    pub ip: String,
}

const DEFAULT_PAGE: usize = 60;
const MAX_PAGE: usize = 200;
/// The most hits a search returns.
const SEARCH_LIMIT: usize = 100;
/// A phone hears about a transfer's progress at most this often.
const PROGRESS_EVERY: Duration = Duration::from_millis(500);

/// Per transfer: when the last progress push went out and the byte count it
/// carried. Every connected phone maps the same event on its own, so a push
/// with the *same* count inside the window is that same event seen by the
/// next phone and goes through too; a newer count inside the window is
/// dropped (the next one, half a second later, carries it).
static PROGRESS: LazyLock<Mutex<HashMap<String, (Instant, u64)>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn ok(id: &Value, mut body: serde_json::Map<String, Value>) -> String {
    body.insert("id".to_string(), id.clone());
    body.insert("ok".to_string(), Value::Bool(true));
    Value::Object(body).to_string()
}

fn fail(id: &Value, error: &str) -> String {
    json!({ "id": id, "ok": false, "error": error }).to_string()
}

fn obj(v: Value) -> serde_json::Map<String, Value> {
    match v {
        Value::Object(m) => m,
        _ => serde_json::Map::new(),
    }
}

/// A JSON array of strings (anything else: empty).
fn strings(v: &Value) -> Vec<String> {
    v.as_array()
        .map(|a| a.iter().filter_map(|s| s.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default()
}

/// The transfer behind a chat file message: its own record, or (a file sent
/// to a group) one of the per-member copies that share the message's id.
pub(crate) fn find_transfer(svc: &PhoneService, id: &str) -> Option<TransferRecord> {
    let db = &svc.network.db;
    if let Ok(Some(t)) = db.get_transfer(id) {
        return Some(t);
    }
    db.list_transfers(true)
        .ok()?
        .into_iter()
        .find(|t| t.parent_id.as_deref() == Some(id))
}

fn transfer_json(t: &TransferRecord) -> Value {
    json!({
        "id": t.id,
        "file_name": t.file_name,
        "file_size": t.file_size,
        "status": t.status,
        "direction": t.direction,
        "kind": t.kind,
        "transferred_bytes": t.transferred_bytes,
        "is_image": crate::networking::transfer::is_image_name(&t.file_name),
        "ready": t.direction == "outgoing" || t.status == "completed",
        "peer_name": t.peer_name,
        "conversation_id": t.conversation_id,
        "created_at": t.created_at,
        "completed_at": t.completed_at,
        "error_reason": t.error_reason,
        "parent_id": t.parent_id,
    })
}

/// A message as the phone sees it: the message, plus its file (if any).
pub(crate) fn enrich(svc: &PhoneService, m: &Message) -> Value {
    let mut v = obj(serde_json::to_value(m).unwrap_or(Value::Null));
    let transfer = m
        .transfer_id
        .as_deref()
        .and_then(|id| find_transfer(svc, id))
        .map(|t| transfer_json(&t))
        .unwrap_or(Value::Null);
    v.insert("transfer".to_string(), transfer);
    Value::Object(v)
}

/// Search results (and starred messages) as the phone sees them.
fn hits_json(svc: &PhoneService, hits: &[SearchHit]) -> Value {
    Value::Array(
        hits.iter()
            .map(|h| json!({ "message": enrich(svc, &h.message), "peer_name": h.peer_name, "peer_avatar_color": h.peer_avatar_color }))
            .collect(),
    )
}

/// The built-in stickers, so the phone can show a picker without a copy of
/// the list.
fn stickers() -> Value {
    Value::Array(STICKERS.iter().map(|(id, emoji, label)| json!({ "id": id, "emoji": emoji, "label": label })).collect())
}

fn me(svc: &PhoneService) -> Value {
    let s = svc.network.db.get_settings().ok();
    let now = crate::networking::now_secs();
    json!({
        "id": svc.network.identity.device_id,
        "name": s.as_ref().map(|s| s.display_name.clone()).unwrap_or_default(),
        "color": s.as_ref().map(|s| s.avatar_color.clone()).unwrap_or_default(),
        "hostname": s.as_ref().map(|s| s.hostname.clone()).unwrap_or_default(),
        "profile": s.as_ref().map(|s| s.profile.effective(now)),
    })
}

fn hidden_ok(svc: &PhoneService) -> bool {
    svc.network.privacy.hidden_unlocked()
}

fn conversations(svc: &PhoneService) -> Value {
    serde_json::to_value(svc.network.db.get_conversations(hidden_ok(svc)).unwrap_or_default()).unwrap_or(Value::Array(vec![]))
}

fn peers(svc: &PhoneService) -> (Value, Value) {
    let db = &svc.network.db;
    let peers = serde_json::to_value(db.list_peers().unwrap_or_default()).unwrap_or(Value::Array(vec![]));
    let profiles = serde_json::to_value(db.peer_profiles().unwrap_or_default()).unwrap_or(Value::Object(Default::default()));
    (peers, profiles)
}

fn conversation_allowed(svc: &PhoneService, conv: &str) -> Result<(), &'static str> {
    if svc.network.db.is_conversation_hidden(conv) && !hidden_ok(svc) {
        return Err("HIDDEN");
    }
    Ok(())
}

/// A message the phone may touch: it exists, and its chat is not a hidden
/// chat while hidden chats are locked.
fn message_for(svc: &PhoneService, message_id: &str) -> Result<Message, String> {
    let m = svc
        .network
        .db
        .get_message_by_id(message_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Message not found".to_string())?;
    conversation_allowed(svc, &m.conversation_id).map_err(|e| e.to_string())?;
    Ok(m)
}

/// A transfer the phone may touch (same rule, by the transfer's chat).
fn transfer_for(svc: &PhoneService, transfer_id: &str) -> Result<TransferRecord, String> {
    let t = svc
        .network
        .db
        .get_transfer(transfer_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Transfer not found".to_string())?;
    if let Some(conv) = &t.conversation_id {
        conversation_allowed(svc, conv).map_err(|e| e.to_string())?;
    }
    Ok(t)
}

/// The reply for an engine call that gives back the changed message.
fn message_reply(svc: &PhoneService, id: &Value, r: Result<Message, String>) -> String {
    match r {
        Ok(m) => ok(id, obj(json!({ "message": enrich(svc, &m) }))),
        Err(e) => fail(id, &e),
    }
}

/// A message the phone just sent: the desktop window shows it like any
/// message of this PC, and every phone sees it echoed. Returns it enriched.
fn announce(svc: &PhoneService, client: &Client, m: &Message) -> Value {
    let conversation = svc.network.db.get_conversation(&m.conversation_id).ok().flatten();
    svc.network.events.message_received(m, conversation.as_ref());
    let enriched = enrich(svc, m);
    svc.broadcast(&json!({ "ev": "message", "message": enriched, "conversation": conversation, "from_phone": client.id }).to_string());
    enriched
}

/// One request from the phone → one reply line.
pub(super) async fn handle_op(svc: &PhoneService, client: &Client, text: &str) -> String {
    let v: Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => return fail(&Value::Null, "bad json"),
    };
    let id = v.get("id").cloned().unwrap_or(Value::Null);
    let op = v["op"].as_str().unwrap_or("");
    if let Err(e) = svc.network.privacy.guard() {
        return fail(&id, &e);
    }
    let db = &svc.network.db;
    match op {
        "auth" => {
            // Already authenticated when the connection was opened.
            ok(&id, obj(json!({ "device": client.device.name, "version": svc.app_version })))
        }
        "hello" => {
            let (peers, profiles) = peers(svc);
            let quick_replies = db.get_settings().map(|s| s.quick_replies).unwrap_or_default();
            ok(
                &id,
                obj(json!({
                    "me": me(svc),
                    "conversations": conversations(svc),
                    "peers": peers,
                    "profiles": profiles,
                    "version": svc.app_version,
                    "now": crate::networking::now_secs(),
                    "device": client.device.name,
                    "ip": client.ip,
                    "quick_replies": quick_replies,
                    "stickers": stickers(),
                })),
            )
        }
        "conversations" => ok(&id, obj(json!({ "conversations": conversations(svc) }))),
        "peers" => {
            let (peers, profiles) = peers(svc);
            ok(&id, obj(json!({ "peers": peers, "profiles": profiles, "me": me(svc) })))
        }
        "messages" => {
            let conv = v["conv"].as_str().unwrap_or("");
            if let Err(e) = conversation_allowed(svc, conv) {
                return fail(&id, e);
            }
            let before = v["before"].as_i64();
            let limit = v["limit"].as_u64().map(|l| l as usize).unwrap_or(DEFAULT_PAGE).clamp(1, MAX_PAGE);
            let all = match db.get_messages(conv) {
                Ok(m) => m,
                Err(e) => return fail(&id, &e.to_string()),
            };
            let eligible: Vec<&Message> = all.iter().filter(|m| before.is_none_or(|b| m.timestamp < b)).collect();
            let more = eligible.len() > limit;
            let page: Vec<Value> = eligible[eligible.len().saturating_sub(limit)..].iter().map(|m| enrich(svc, m)).collect();
            let conversation = db.get_conversation(conv).ok().flatten();
            ok(&id, obj(json!({ "messages": page, "more": more, "conversation": conversation })))
        }
        "send" => {
            let conv = v["conv"].as_str().unwrap_or("");
            if let Err(e) = conversation_allowed(svc, conv) {
                return fail(&id, e);
            }
            let text = v["text"].as_str().unwrap_or("");
            let reply_to = v["reply_to"].as_str().map(|s| s.to_string());
            let mentions = strings(&v["mentions"]);
            match svc.network.send_message_full(conv, text, reply_to, mentions).await {
                Ok(m) => {
                    let message = announce(svc, client, &m);
                    ok(&id, obj(json!({ "message": message })))
                }
                Err(e) => fail(&id, &e),
            }
        }
        "sticker" => {
            let conv = v["conv"].as_str().unwrap_or("");
            if let Err(e) = conversation_allowed(svc, conv) {
                return fail(&id, e);
            }
            let sticker = v["sticker"].as_str().unwrap_or("");
            match svc.network.send_sticker(conv, sticker).await {
                Ok(m) => {
                    let message = announce(svc, client, &m);
                    ok(&id, obj(json!({ "message": message })))
                }
                Err(e) => fail(&id, &e),
            }
        }
        "react" => {
            let mid = v["message_id"].as_str().unwrap_or("");
            if let Err(e) = message_for(svc, mid) {
                return fail(&id, &e);
            }
            // The same emoji again takes it back (the engine's rule).
            let emoji = v["emoji"].as_str().unwrap_or("");
            message_reply(svc, &id, svc.network.react_to_message(mid, emoji))
        }
        "edit" => {
            let mid = v["message_id"].as_str().unwrap_or("");
            if let Err(e) = message_for(svc, mid) {
                return fail(&id, &e);
            }
            let text = v["text"].as_str().unwrap_or("");
            let mentions = strings(&v["mentions"]);
            message_reply(svc, &id, svc.network.edit_message(mid, text, &mentions))
        }
        "delete" => {
            let mid = v["message_id"].as_str().unwrap_or("");
            if let Err(e) = message_for(svc, mid) {
                return fail(&id, &e);
            }
            if v["everyone"].as_bool().unwrap_or(false) {
                message_reply(svc, &id, svc.network.delete_for_everyone(mid).await)
            } else {
                match svc.network.delete_for_me(mid) {
                    Ok(()) => ok(&id, serde_json::Map::new()),
                    Err(e) => fail(&id, &e),
                }
            }
        }
        "forward" => {
            let message_ids = strings(&v["message_ids"]);
            let conversation_ids = strings(&v["conversation_ids"]);
            for mid in &message_ids {
                if let Err(e) = message_for(svc, mid) {
                    return fail(&id, &e);
                }
            }
            for conv in &conversation_ids {
                if let Err(e) = conversation_allowed(svc, conv) {
                    return fail(&id, e);
                }
            }
            match svc.network.forward_messages(&message_ids, &conversation_ids).await {
                Ok(r) => {
                    // The copies went out without a word to the window; a
                    // reload shows them there (and on every phone).
                    svc.network.events.state_changed();
                    ok(&id, obj(json!({ "sent": r.sent, "problems": r.problems })))
                }
                Err(e) => fail(&id, &e),
            }
        }
        "star" | "pin" => {
            let mid = v["message_id"].as_str().unwrap_or("");
            if let Err(e) = message_for(svc, mid) {
                return fail(&id, &e);
            }
            let on = v["on"].as_bool().unwrap_or(true);
            let r = if op == "star" { svc.network.star_message(mid, on) } else { svc.network.pin_message(mid, on) };
            message_reply(svc, &id, r)
        }
        "starred" => match db.starred_messages(hidden_ok(svc)) {
            Ok(hits) => ok(&id, obj(json!({ "hits": hits_json(svc, &hits) }))),
            Err(e) => fail(&id, &e.to_string()),
        },
        "search" => {
            let query = v["query"].as_str().unwrap_or("");
            match db.search_messages(query, SEARCH_LIMIT, hidden_ok(svc)) {
                Ok(hits) => ok(&id, obj(json!({ "hits": hits_json(svc, &hits) }))),
                Err(e) => fail(&id, &e.to_string()),
            }
        }
        "later" => {
            let conv = v["conv"].as_str().unwrap_or("");
            if let Err(e) = conversation_allowed(svc, conv) {
                return fail(&id, e);
            }
            let text = v["text"].as_str().unwrap_or("");
            let at = v["at"].as_i64().unwrap_or(0);
            let reply_to = v["reply_to"].as_str().map(|s| s.to_string());
            let mentions = strings(&v["mentions"]);
            match svc.network.schedule_message(conv, text, at, reply_to, mentions) {
                Ok(s) => ok(&id, obj(json!({ "scheduled": s }))),
                Err(e) => fail(&id, &e),
            }
        }
        "scheduled" => {
            let conv = v["conv"].as_str().unwrap_or("");
            if let Err(e) = conversation_allowed(svc, conv) {
                return fail(&id, e);
            }
            ok(&id, obj(json!({ "items": svc.network.list_scheduled(conv) })))
        }
        "cancel_later" => {
            // ("id" is the request's own id, so the item's id has its own key.)
            let sid = v["scheduled_id"].as_str().unwrap_or("");
            let conv = v["conv"].as_str().unwrap_or("");
            if let Err(e) = conversation_allowed(svc, conv) {
                return fail(&id, e);
            }
            // Only an item of *this* chat: the chat is what the phone was
            // allowed to see.
            if !svc.network.list_scheduled(conv).iter().any(|s| s.id == sid) {
                return fail(&id, "Scheduled message not found");
            }
            match svc.network.cancel_scheduled(sid, conv) {
                Ok(()) => ok(&id, serde_json::Map::new()),
                Err(e) => fail(&id, &e),
            }
        }
        "remind" => {
            let mid = v["message_id"].as_str().unwrap_or("");
            if let Err(e) = message_for(svc, mid) {
                return fail(&id, &e);
            }
            let at = v["at"].as_i64().unwrap_or(0);
            let no_reply = v["no_reply"].as_bool().unwrap_or(false);
            message_reply(svc, &id, svc.network.set_reminder_ex(mid, at, no_reply))
        }
        "cancel_remind" => {
            let mid = v["message_id"].as_str().unwrap_or("");
            if let Err(e) = message_for(svc, mid) {
                return fail(&id, &e);
            }
            message_reply(svc, &id, svc.network.cancel_reminder(mid))
        }
        "group_create" => {
            let name = v["name"].as_str().unwrap_or("");
            let members = strings(&v["member_ids"]);
            match svc.network.create_group(name, &members) {
                Ok(c) => {
                    svc.network.events.state_changed();
                    ok(&id, obj(json!({ "conversation": c })))
                }
                Err(e) => fail(&id, &e),
            }
        }
        "group" => {
            // A group's id is its chat's id.
            let gid = v["group_id"].as_str().unwrap_or("");
            if let Err(e) = conversation_allowed(svc, gid) {
                return fail(&id, e);
            }
            match svc.network.get_group(gid) {
                Some(g) => ok(&id, obj(json!({ "group": g }))),
                None => fail(&id, "Group not found"),
            }
        }
        "group_update" => {
            let gid = v["group_id"].as_str().unwrap_or("");
            if let Err(e) = conversation_allowed(svc, gid) {
                return fail(&id, e);
            }
            let name = v["name"].as_str().map(|s| s.to_string());
            let add = strings(&v["add"]);
            let remove = strings(&v["remove"]);
            // (update_group tells the window itself.)
            match svc.network.update_group(gid, name, &add, &remove) {
                Ok(g) => ok(&id, obj(json!({ "group": g }))),
                Err(e) => fail(&id, &e),
            }
        }
        "group_leave" => {
            let gid = v["group_id"].as_str().unwrap_or("");
            if let Err(e) = conversation_allowed(svc, gid) {
                return fail(&id, e);
            }
            match svc.network.leave_group(gid) {
                Ok(()) => {
                    svc.network.events.state_changed();
                    ok(&id, serde_json::Map::new())
                }
                Err(e) => fail(&id, &e),
            }
        }
        "transfers" => match db.list_transfers(hidden_ok(svc)) {
            Ok(list) => {
                // Chat files only: LANX updates and folder-sync copies are
                // the PC's business.
                let transfers: Vec<Value> = list.iter().filter(|t| t.kind != "update" && t.kind != "sync").map(transfer_json).collect();
                ok(&id, obj(json!({ "transfers": transfers })))
            }
            Err(e) => fail(&id, &e.to_string()),
        },
        "accept" | "cancel" | "retry" => {
            let tid = v["transfer_id"].as_str().unwrap_or("");
            if let Err(e) = transfer_for(svc, tid) {
                return fail(&id, &e);
            }
            let r = match op {
                "accept" => svc.network.accept_transfer(tid).await,
                "cancel" => svc.network.cancel_transfer(tid).await,
                _ => svc.network.retry_transfer(tid).await,
            };
            match r {
                Ok(t) => ok(&id, obj(json!({ "transfer": transfer_json(&t) }))),
                Err(e) => fail(&id, &e),
            }
        }
        "read" => {
            let conv = v["conv"].as_str().unwrap_or("");
            if let Err(e) = conversation_allowed(svc, conv) {
                return fail(&id, e);
            }
            match svc.network.mark_read_and_notify(conv) {
                Ok(_) => {
                    let conversation = db.get_conversation(conv).ok().flatten();
                    svc.network.events.emit_json("lanx://phone-read", json!({ "conversation_id": conv }));
                    svc.broadcast(&json!({ "ev": "read", "conversation_id": conv, "conversation": conversation }).to_string());
                    ok(&id, obj(json!({ "conversation": conversation })))
                }
                Err(e) => fail(&id, &e),
            }
        }
        "typing" => {
            let conv = v["conv"].as_str().unwrap_or("");
            if conversation_allowed(svc, conv).is_ok() {
                svc.network.send_typing(conv);
            }
            ok(&id, serde_json::Map::new())
        }
        "open" => {
            // A chat with a colleague from the "Who's in" list (made if new).
            let peer = v["peer_id"].as_str().unwrap_or("");
            if db.get_peer(peer).ok().flatten().is_none() {
                return fail(&id, "Peer not found");
            }
            match db.get_or_create_conversation(peer) {
                Ok(c) => {
                    if let Err(e) = conversation_allowed(svc, &c.id) {
                        return fail(&id, e);
                    }
                    svc.network.events.state_changed();
                    ok(&id, obj(json!({ "conversation": c })))
                }
                Err(e) => fail(&id, &e.to_string()),
            }
        }
        "ping" => ok(&id, obj(json!({ "now": crate::networking::now_secs() }))),
        _ => fail(&id, "unknown op"),
    }
}

/// Is a progress push for this transfer due (see `PROGRESS`)?
fn progress_due(transfer_id: &str, bytes: u64) -> bool {
    let now = Instant::now();
    let mut map = PROGRESS.lock();
    // Transfers come and go; forget the ones that went quiet.
    if map.len() > 64 {
        map.retain(|_, (at, _)| now.duration_since(*at) < Duration::from_secs(30));
    }
    match map.get(transfer_id) {
        Some((at, last)) if now.duration_since(*at) < PROGRESS_EVERY => *last == bytes,
        _ => {
            map.insert(transfer_id.to_string(), (now, bytes));
            true
        }
    }
}

/// An event the desktop window got → what the phones get (None: not theirs).
pub(super) fn map_event(svc: &PhoneService, name: &str, payload: &Value) -> Option<String> {
    let hidden_blocked = |conv: Option<&str>| conv.is_some_and(|c| svc.network.db.is_conversation_hidden(c) && !hidden_ok(svc));
    let line = match name {
        "lanx://message-received" => {
            let m: Message = serde_json::from_value(payload["message"].clone()).ok()?;
            if hidden_blocked(Some(&m.conversation_id)) {
                return None;
            }
            json!({ "ev": "message", "message": enrich(svc, &m), "conversation": payload["conversation"] })
        }
        "lanx://message-status-updated" => {
            let m: Message = serde_json::from_value(payload["message"].clone()).ok()?;
            if hidden_blocked(Some(&m.conversation_id)) {
                return None;
            }
            json!({ "ev": "message", "message": enrich(svc, &m) })
        }
        "lanx://messages-deleted" => json!({ "ev": "deleted", "message_ids": payload["message_ids"], "conversation_ids": payload["conversation_ids"] }),
        "lanx://transfer-updated" => {
            let t: TransferRecord = serde_json::from_value(payload.clone()).ok()?;
            if t.kind == "update" || hidden_blocked(t.conversation_id.as_deref()) {
                return None;
            }
            json!({ "ev": "transfer", "transfer": transfer_json(&t) })
        }
        "lanx://transfer-progress" => {
            // Many a second while a file moves: the phone gets two a second
            // per file (the throttle runs first, so the lookup below is rare).
            let tid = payload["transfer_id"].as_str()?;
            if !progress_due(tid, payload["transferred_bytes"].as_u64().unwrap_or(0)) {
                return None;
            }
            let conv = svc.network.db.get_transfer(tid).ok().flatten().and_then(|t| t.conversation_id);
            if hidden_blocked(conv.as_deref()) {
                return None;
            }
            json!({
                "ev": "progress",
                "transfer_id": tid,
                "transferred_bytes": payload["transferred_bytes"],
                "file_size": payload["file_size"],
                "bytes_per_sec": payload["bytes_per_sec"],
            })
        }
        "lanx://scheduled-changed" => {
            if hidden_blocked(payload["conversation_id"].as_str()) {
                return None;
            }
            json!({ "ev": "scheduled", "conversation_id": payload["conversation_id"], "problem": payload["problem"] })
        }
        "lanx://reminder" => {
            let m: Message = serde_json::from_value(payload["message"].clone()).ok()?;
            if hidden_blocked(Some(&m.conversation_id)) {
                return None;
            }
            json!({
                "ev": "reminder",
                "message": enrich(svc, &m),
                "conversation_id": payload["conversation_id"],
                "title": payload["title"],
                "text": payload["text"],
            })
        }
        "lanx://peer-discovered" => json!({ "ev": "peer", "peer": payload }),
        "lanx://peer-offline" => json!({ "ev": "peer-offline", "peer_id": payload["peer_id"] }),
        "lanx://peer-profile" => json!({ "ev": "profile", "peer_id": payload["peer_id"], "profile": payload["profile"] }),
        "lanx://typing" => {
            let conv = payload["conversation_id"].as_str();
            if hidden_blocked(conv) {
                return None;
            }
            json!({ "ev": "typing", "conversation_id": payload["conversation_id"], "display_name": payload["display_name"] })
        }
        "lanx://state-changed" | "lanx://admin-changed" => json!({ "ev": "reload" }),
        "lanx://lock-changed" => json!({ "ev": "lock", "locked": payload["locked"].as_bool().unwrap_or(false) }),
        _ => return None,
    };
    Some(line.to_string())
}
