//! What a phone can ask this PC for, and what it is told about as it happens.
//!
//! Requests are JSON lines `{"id":…, "op":"…", …}` answered with
//! `{"id":…, "ok":true, …}` or `{"id":…, "ok":false, "error":"…"}`. Pushes
//! are `{"ev":"…", …}`. Everything goes through the same engine calls the
//! desktop window uses (`send_message_full`, `mark_read_and_notify`, …), so
//! a message from the phone is simply a message from this PC.

use super::PhoneService;
use crate::storage::models::{Message, TransferRecord};
use serde_json::{Value, json};

/// A connected phone.
pub(crate) struct Client {
    pub id: u64,
    pub device: super::PhoneDevice,
    pub ip: String,
}

const DEFAULT_PAGE: usize = 60;
const MAX_PAGE: usize = 200;

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
            match svc.network.send_message_full(conv, text, reply_to, vec![]).await {
                Ok(m) => {
                    let conversation = db.get_conversation(conv).ok().flatten();
                    // The desktop window shows it like any message of this PC.
                    svc.network.events.message_received(&m, conversation.as_ref());
                    let enriched = enrich(svc, &m);
                    svc.broadcast(&json!({ "ev": "message", "message": enriched, "conversation": conversation, "from_phone": client.id }).to_string());
                    ok(&id, obj(json!({ "message": enrich(svc, &m) })))
                }
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
