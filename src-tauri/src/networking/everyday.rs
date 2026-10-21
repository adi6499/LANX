//! LANX 2.2.0 everyday helpers: forwarding messages and files, and a
//! plain-language connection check for one colleague. ("Mark as unread" is
//! in storage; "remind me if no reply" rides on the reminders in chat.rs.)

use super::NetworkService;
use super::protocol::is_newer;
use crate::storage::models::Message;
use serde::Serialize;
use std::time::{Duration, Instant};

/// The mark at the start of a forwarded text. LANX 2.2.0 shows it as a small
/// "Forwarded" label; older copies simply show the words (nothing else
/// changes on the wire).
pub const FORWARD_MARK: &str = "↪ Forwarded\n";
/// The most messages, and the most chats, in one forward.
pub const MAX_FORWARD: usize = 20;

#[derive(Debug, Clone, Serialize, Default)]
pub struct ForwardResult {
    /// Messages sent (one per message per chat).
    pub sent: usize,
    pub problems: Vec<String>,
}

/// One line of the connection check: ok = Some(true) ✓, Some(false) ✗, None = not checked.
#[derive(Debug, Clone, Serialize)]
pub struct CheckStep {
    pub label: String,
    pub ok: Option<bool>,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConnectionCheck {
    pub ok: bool,
    /// What it means, in one or two plain sentences.
    pub verdict: String,
    pub steps: Vec<CheckStep>,
    pub latency_ms: Option<u64>,
}

/// The text of a forwarded message (marked once, even when forwarded again).
pub fn forwarded_text(content: &str) -> String {
    let body = content.strip_prefix(FORWARD_MARK).unwrap_or(content);
    format!("{FORWARD_MARK}{body}")
}

/// Same /24 network (the usual office set-up)?
pub fn same_subnet(a: &str, b: &str) -> bool {
    let net = |s: &str| {
        s.parse::<std::net::Ipv4Addr>().ok().map(|ip| {
            let o = ip.octets();
            [o[0], o[1], o[2]]
        })
    };
    matches!((net(a), net(b)), (Some(x), Some(y)) if x == y)
}

fn ago(secs: i64) -> String {
    match secs.max(0) {
        s if s < 90 => format!("{s} seconds ago"),
        s if s < 2 * 3600 => format!("{} minutes ago", s / 60),
        s if s < 2 * 86400 => format!("{} hours ago", s / 3600),
        s => format!("{} days ago", s / 86400),
    }
}

impl NetworkService {
    /// Forwards messages (texts, files, stickers, cards as text) to chats.
    pub async fn forward_messages(&self, message_ids: &[String], conversation_ids: &[String]) -> Result<ForwardResult, String> {
        if message_ids.is_empty() || conversation_ids.is_empty() {
            return Err("Choose what to forward and where.".to_string());
        }
        if message_ids.len() > MAX_FORWARD || conversation_ids.len() > MAX_FORWARD {
            return Err(format!("At most {MAX_FORWARD} messages and {MAX_FORWARD} chats at a time."));
        }
        let mut msgs = Vec::new();
        for id in message_ids {
            let m = self
                .db
                .get_message_by_id(id)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "Message not found".to_string())?;
            msgs.push(m);
        }
        msgs.sort_by_key(|m| m.timestamp);
        let mut r = ForwardResult::default();
        for conv in conversation_ids {
            for m in &msgs {
                match self.forward_one(conv, m).await {
                    Ok(()) => r.sent += 1,
                    Err(e) => {
                        if !r.problems.contains(&e) {
                            r.problems.push(e);
                        }
                    }
                }
            }
        }
        Ok(r)
    }

    async fn forward_one(&self, conv: &str, m: &Message) -> Result<(), String> {
        if m.deleted {
            return Err("A deleted message can't be forwarded.".to_string());
        }
        if m.ttl_secs.is_some() {
            return Err("Secret messages can't be forwarded.".to_string());
        }
        match m.message_type.as_str() {
            "text" => self.send_message_full(conv, &forwarded_text(&m.content), None, Vec::new()).await.map(|_| ()),
            "card" => {
                let text = forwarded_text(&super::org::card_fallback(&m.content));
                self.send_message_full(conv, &text, None, Vec::new()).await.map(|_| ())
            }
            "sticker" => self.send_sticker(conv, &m.content).await.map(|_| ()),
            "file" => {
                let path = m
                    .transfer_id
                    .as_deref()
                    .and_then(|t| self.db.get_transfer(t).ok().flatten())
                    .and_then(|t| t.local_path)
                    .filter(|p| std::path::Path::new(p).is_file())
                    .ok_or_else(|| "A file that isn't on this PC (not accepted yet, or moved) can't be forwarded.".to_string())?;
                self.send_files(conv, vec![path]).await.map(|_| ())
            }
            _ => Err("That kind of message can't be forwarded.".to_string()),
        }
    }

    /// Why can or can't LANX reach this colleague? Checks, step by step, what
    /// a person from IT would check, and says what it means.
    pub async fn check_connection(&self, peer_id: &str) -> Result<ConnectionCheck, String> {
        let peer = self
            .db
            .get_peer(peer_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Contact not found".to_string())?;
        let name = peer.display_name.split_whitespace().next().unwrap_or("They").to_string();
        let now = chrono::Utc::now().timestamp();
        let mut steps = Vec::new();

        // 1. Their PC's "I'm here" signals arrive.
        let seen = peer.status == "online";
        steps.push(CheckStep {
            label: format!("LANX sees {name}'s PC on the network"),
            ok: Some(seen),
            detail: if seen {
                format!("Heard from it {}", ago(now - peer.last_seen))
            } else {
                format!("Last heard from it {}", ago(now - peer.last_seen))
            },
        });

        // 2. The same network as this PC.
        let mine = crate::discovery::local_ipv4_addresses();
        let same = mine.iter().any(|ip| same_subnet(ip, &peer.last_ip));
        steps.push(CheckStep {
            label: "On the same network as this PC".to_string(),
            ok: Some(same),
            detail: format!("Their address {} · this PC {}", peer.last_ip, if mine.is_empty() { "none".to_string() } else { mine.join(", ") }),
        });

        // 3. Their PC answers at all.
        let addr = format!("{}:{}", peer.last_ip, peer.tcp_port);
        let start = Instant::now();
        let tcp = tokio::time::timeout(Duration::from_millis(2500), tokio::net::TcpStream::connect(&addr)).await;
        let tcp_ms = start.elapsed().as_millis() as u64;
        let (answers, refused) = match &tcp {
            Ok(Ok(_)) => (true, false),
            Ok(Err(e)) => (false, e.kind() == std::io::ErrorKind::ConnectionRefused),
            Err(_) => (false, false),
        };
        drop(tcp);
        steps.push(CheckStep {
            label: format!("{name}'s PC answers"),
            ok: Some(answers),
            detail: if answers {
                format!("Answered in {tcp_ms} ms")
            } else if refused {
                "The PC is on, but nothing is listening for LANX".to_string()
            } else {
                "No answer within 2.5 seconds".to_string()
            },
        });

        // 4. A real, encrypted LANX connection.
        let mut version = None;
        let mut latency = None;
        let mut secure_err = None;
        if answers {
            let t = Instant::now();
            match self.connect_peer(&peer).await {
                Ok(chan) => {
                    latency = Some(t.elapsed().as_millis() as u64);
                    version = Some(chan.remote.app_version.clone());
                    chan.close().await;
                }
                Err(e) => secure_err = Some(e),
            }
        }
        let lanx_ok = version.is_some();
        steps.push(CheckStep {
            label: "Secure LANX connection".to_string(),
            ok: answers.then_some(lanx_ok),
            detail: match (&latency, &secure_err) {
                (Some(ms), _) => format!("Encrypted connection made in {ms} ms"),
                (None, Some(e)) => e.clone(),
                _ => "Not tried (their PC didn't answer)".to_string(),
            },
        });

        // 5. Versions.
        if let Some(v) = &version {
            let mine_v = self.update_config().app_version;
            let older = is_newer(&mine_v, v);
            steps.push(CheckStep {
                label: "LANX version".to_string(),
                ok: Some(!older),
                detail: if v == &mine_v {
                    format!("Both on LANX {v}")
                } else if older {
                    format!("{name} has LANX {v}, older than this PC's {mine_v}: newer features wait until they update")
                } else {
                    format!("{name} has a newer LANX ({v}) than this PC ({mine_v})")
                },
            });
        }

        let verdict = if lanx_ok {
            format!("All good: messages, files and calls reach {name} ({} ms).", latency.unwrap_or(tcp_ms))
        } else if answers {
            format!(
                "{name}'s PC answers, but LANX couldn't connect securely ({}). If {name} reinstalled Windows or LANX, open their contact and check the security code.",
                secure_err.unwrap_or_default()
            )
        } else if refused {
            format!("{name}'s PC is on, but LANX isn't running there. Ask {name} to open LANX.")
        } else if !same {
            format!(
                "{name}'s PC is on a different network ({}). Ask IT to connect the two networks, or use Peers → Connect by IP if they can reach each other.",
                peer.last_ip
            )
        } else if seen {
            format!(
                "{name}'s PC is on the network but doesn't let LANX in: most likely Windows Firewall on that PC. Installing LANX again there sets the firewall up."
            )
        } else {
            format!("{name}'s PC isn't answering: it may be switched off, asleep, or on Wi-Fi that keeps computers apart.")
        };
        Ok(ConnectionCheck { ok: lanx_ok, verdict, steps, latency_ms: latency })
    }
}

#[cfg(test)]
mod unit {
    use super::*;

    #[test]
    fn forwarded_text_is_marked_once() {
        assert_eq!(forwarded_text("Hello"), "↪ Forwarded\nHello");
        assert_eq!(forwarded_text(&forwarded_text("Hello")), "↪ Forwarded\nHello");
    }

    #[test]
    fn subnets() {
        assert!(same_subnet("192.168.29.21", "192.168.29.5"));
        assert!(!same_subnet("192.168.29.21", "192.168.30.5"));
        assert!(!same_subnet("bad", "192.168.29.5"));
    }
}
