//! LANX 3.15.0: the walkie-talkie — hold to talk, and colleagues hear you while you are
//! still talking (the Intercom records first and plays afterwards).
//!
//! How a transmission travels:
//! - the talker's PC opens one encrypted connection to every listener at once and sends
//!   `start`; each listener's PC answers "taken" or why not (switched off, that channel
//!   muted, LANX locked, someone else is talking, an older LANX);
//! - then the voice follows as `audio` steps on those same connections: small Opus pieces
//!   in order, with no answers, so nothing ever waits;
//! - `end` (or the connection closing) finishes it.
//!
//! One voice at a time: a PC that is hearing someone refuses a second talker ("busy"),
//! and while this PC is talking it refuses others too. Two people pressing in the same
//! half second: the PC with the smaller device id keeps the word and the other gives way
//! (both PCs know both ids, so they agree without asking anyone).
//!
//! The microphone, the Opus encoder and the loudspeaker are the window's (src/lib/talk).
//! This file only carries the pieces and keeps the rules.

use super::protocol::*;
use super::session::SecureChannel;
use super::{NetworkService, now_secs};
use crate::storage::models::Peer;
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashSet;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

pub const TALK_ACTIONS: [&str; 3] = ["start", "audio", "end"];
/// One hold of the button lasts at most this long.
pub const TALK_MAX_SECS: u64 = 60;
/// Voice pieces (20 ms each) in one step, and how big one may be (base64 characters).
const FRAMES_MAX: usize = 16;
const FRAME_CHARS_MAX: usize = 2000;
/// How long a start waits for the colleagues' PCs to answer.
const START_PATIENCE: Duration = Duration::from_millis(1500);
/// A transmission that has been silent this long is over (the talker's PC went away).
const QUIET: Duration = Duration::from_secs(4);
/// Two people pressing within this long of each other: one of them gives way.
const SAME_MOMENT: Duration = Duration::from_millis(500);
/// At most this many listeners (a whole office).
const LISTENERS_MAX: usize = 120;

#[derive(Default)]
pub struct TalkState {
    /// The one transmission this PC is hearing.
    incoming: Mutex<Option<Incoming>>,
    /// The transmission this PC is sending.
    outgoing: Mutex<Option<Outgoing>>,
}

struct Incoming {
    talk_id: String,
    peer_id: String,
    peer_name: String,
    channel: String,
    last: Instant,
}

struct Outgoing {
    talk_id: String,
    channel: String,
    started: Instant,
    last_audio: Instant,
    seq: u64,
    listeners: Vec<Listener>,
}

struct Listener {
    peer_id: String,
    tx: mpsc::UnboundedSender<TalkPayload>,
}

/// What the window is told (`lanx://talk`).
#[derive(Debug, Clone, Serialize)]
pub struct TalkEvent {
    pub talk_id: String,
    /// From a colleague: start | audio | end. About our own transmission: gave_way
    /// (someone else had the word first), joined (a colleague who was busy now hears
    /// us), stopped (it ran too long, or the window stopped sending).
    pub action: String,
    pub from_id: String,
    pub from_name: String,
    /// direct | all | group:<group id>
    pub channel: String,
    pub seq: u64,
    pub frames: Vec<String>,
}

/// Why a colleague's PC does not hear this transmission.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TalkRefusal {
    pub peer_id: String,
    pub name: String,
    /// old | off | muted | locked | busy | unreachable | group | other
    pub why: String,
    /// busy: who is talking there.
    pub who: Option<String>,
    /// old: their LANX version.
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TalkStarted {
    pub talk_id: String,
    /// The colleagues who hear it (device ids).
    pub listeners: Vec<String>,
    pub refused: Vec<TalkRefusal>,
}

fn plain(s: &str, min: usize, max: usize) -> bool {
    s.len() >= min && s.len() <= max && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// A step is refused when its id, channel, action or size is off.
pub fn check_talk(p: &TalkPayload) -> Result<(), String> {
    if !plain(&p.talk_id, 8, 64) {
        return Err("Bad transmission id.".to_string());
    }
    let channel_ok = match p.channel.as_str() {
        "direct" | "all" => true,
        c => c.strip_prefix("group:").is_some_and(|g| plain(g, 1, 64)),
    };
    if !channel_ok {
        return Err("Unknown channel.".to_string());
    }
    if !TALK_ACTIONS.contains(&p.action.as_str()) {
        return Err("Unknown step.".to_string());
    }
    let voice = p.action == "audio";
    if voice != !p.frames.is_empty() || p.frames.len() > FRAMES_MAX {
        return Err("Bad voice step.".to_string());
    }
    if p.frames.iter().any(|f| f.is_empty() || f.len() > FRAME_CHARS_MAX || !f.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'='))) {
        return Err("Bad voice piece.".to_string());
    }
    Ok(())
}

/// What a listener's "no" means, for the talker's window.
fn refusal(peer: &Peer, reason: Option<&str>) -> TalkRefusal {
    let reason = reason.unwrap_or("");
    let (why, who) = match reason {
        "off" | "muted" | "locked" | "group" | "call" | "dnd" => (reason, None),
        r => match r.strip_prefix("busy:") {
            Some(name) => ("busy", Some(name.to_string())),
            None => ("other", None),
        },
    };
    TalkRefusal { peer_id: peer.id.clone(), name: peer.display_name.clone(), why: why.to_string(), who, version: None }
}

impl NetworkService {
    fn talk_emit(&self, action: &str, talk_id: &str, from: (&str, &str), channel: &str, seq: u64, frames: Vec<String>) {
        self.events.emit_json(
            "lanx://talk",
            TalkEvent { talk_id: talk_id.to_string(), action: action.to_string(), from_id: from.0.to_string(), from_name: from.1.to_string(), channel: channel.to_string(), seq, frames },
        );
    }

    /// This PC's own choices (the "talk" preference): listening at all, and the channels
    /// that are muted ("all", "group:<id>", "peer:<device id>").
    fn talk_prefs(&self) -> (bool, Vec<String>) {
        let v: serde_json::Value = self.db.get_setting("pref_talk").and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(serde_json::Value::Null);
        let muted = v["muted"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()).unwrap_or_default();
        (v["on"].as_bool().unwrap_or(true), muted)
    }

    // ------------------------------------------------------------------ talking

    /// Connects to one colleague and asks their PC to listen.
    async fn talk_reach(&self, peer: &Peer, start: TalkPayload) -> Result<SecureChannel, TalkRefusal> {
        let gone = || TalkRefusal { peer_id: peer.id.clone(), name: peer.display_name.clone(), why: "unreachable".to_string(), who: None, version: None };
        let mut chan = self.connect_peer(peer).await.map_err(|_| gone())?;
        if !version_at_least(&chan.remote.app_version, FEATURES_TALK) {
            let version = chan.remote.app_version.clone();
            chan.close().await;
            return Err(TalkRefusal { why: "old".to_string(), version: Some(version), ..gone() });
        }
        match NetworkService::send_acked(&mut chan, PacketPayload::Talk(start)).await {
            Ok(a) if a.ok => Ok(chan),
            Ok(a) => {
                chan.close().await;
                Err(refusal(peer, a.reason.as_deref()))
            }
            Err(()) => Err(gone()),
        }
    }

    /// The connection to one listener: voice steps go out in order, then it closes.
    fn talk_listener(peer_id: String, mut chan: SecureChannel) -> Listener {
        let (tx, mut rx) = mpsc::unbounded_channel::<TalkPayload>();
        tokio::spawn(async move {
            while let Some(step) = rx.recv().await {
                let last = step.action == "end";
                if chan.send(PacketPayload::Talk(step), None).await.is_err() || last {
                    break;
                }
            }
            chan.close().await;
        });
        Listener { peer_id, tx }
    }

    /// Starts a transmission to these colleagues. Returns once their PCs have answered
    /// (or after a second and a half): who hears it, and who does not and why.
    pub async fn talk_start(&self, channel: &str, peer_ids: Vec<String>) -> Result<TalkStarted, String> {
        self.privacy.guard()?;
        if self.in_a_call() {
            return Err("You are in a call. The walkie-talkie waits until it is over.".to_string());
        }
        let talk_id = uuid::Uuid::new_v4().to_string();
        let start = TalkPayload { talk_id: talk_id.clone(), channel: channel.to_string(), action: "start".to_string(), seq: 0, frames: Vec::new(), at: now_secs() };
        check_talk(&start)?;
        if let Some(i) = self.talk.incoming.lock().as_ref() {
            if i.last.elapsed() < QUIET {
                return Err(format!("{} is talking.", i.peer_name));
            }
        }
        self.talk_finish(None, "end");
        let now = Instant::now();
        *self.talk.outgoing.lock() = Some(Outgoing { talk_id: talk_id.clone(), channel: channel.to_string(), started: now, last_audio: now, seq: 0, listeners: Vec::new() });

        let me = self.identity.device_id.clone();
        let mut seen = HashSet::new();
        let peers: Vec<Peer> = peer_ids
            .into_iter()
            .filter(|id| *id != me && seen.insert(id.clone()))
            .take(LISTENERS_MAX)
            .filter_map(|id| self.db.get_peer(&id).ok().flatten())
            .filter(|p| p.trust_state != "blocked")
            .collect();
        let mut waiting: Vec<Peer> = peers.clone();
        let mut set = tokio::task::JoinSet::new();
        for peer in peers {
            let this = self.clone();
            let start = start.clone();
            set.spawn(async move {
                let answer = this.talk_reach(&peer, start).await;
                (peer, answer)
            });
        }
        let deadline = tokio::time::Instant::now() + START_PATIENCE;
        let mut listeners = Vec::new();
        let mut refused = Vec::new();
        loop {
            match tokio::time::timeout_at(deadline, set.join_next()).await {
                Ok(Some(Ok((peer, answer)))) => {
                    waiting.retain(|w| w.id != peer.id);
                    match answer {
                        Ok(chan) => listeners.push(Self::talk_listener(peer.id.clone(), chan)),
                        Err(no) => refused.push(no),
                    }
                }
                Ok(Some(Err(_))) => {}
                Ok(None) => break,
                Err(_) => {
                    // The rest did not answer in time: not for this transmission.
                    set.abort_all();
                    break;
                }
            }
        }
        for peer in waiting {
            refused.push(TalkRefusal { peer_id: peer.id, name: peer.display_name, why: "unreachable".to_string(), who: None, version: None });
        }

        let ids: Vec<String> = listeners.iter().map(|l| l.peer_id.clone()).collect();
        {
            let mut out = self.talk.outgoing.lock();
            match out.as_mut() {
                Some(o) if o.talk_id == talk_id => o.listeners = listeners,
                _ => {
                    // It was taken from us meanwhile (someone else had the word first).
                    drop(out);
                    let end = TalkPayload { action: "end".to_string(), ..start };
                    for l in listeners {
                        let _ = l.tx.send(end.clone());
                    }
                    let who = self.talk.incoming.lock().as_ref().map(|i| i.peer_name.clone());
                    return Err(format!("{} is talking.", who.unwrap_or_else(|| "Someone else".to_string())));
                }
            }
        }
        self.talk_watch(talk_id.clone());
        // A colleague who was hearing someone else gets one more try a moment later.
        for busy in refused.iter().filter(|r| r.why == "busy") {
            self.talk_try_again(talk_id.clone(), start.clone(), busy.peer_id.clone());
        }
        Ok(TalkStarted { talk_id, listeners: ids, refused })
    }

    fn talk_try_again(&self, talk_id: String, start: TalkPayload, peer_id: String) {
        let this = self.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(900)).await;
            let ours = |this: &NetworkService| this.talk.outgoing.lock().as_ref().is_some_and(|o| o.talk_id == talk_id);
            if !ours(&this) {
                return;
            }
            let Some(peer) = this.db.get_peer(&peer_id).ok().flatten() else { return };
            let Ok(Ok(chan)) = tokio::time::timeout(START_PATIENCE, this.talk_reach(&peer, start.clone())).await else { return };
            let listener = Self::talk_listener(peer.id.clone(), chan);
            let mut out = this.talk.outgoing.lock();
            match out.as_mut() {
                Some(o) if o.talk_id == talk_id => {
                    o.listeners.push(listener);
                    drop(out);
                    this.talk_emit("joined", &talk_id, (&peer.id, &peer.display_name), &start.channel, 0, Vec::new());
                }
                _ => {
                    let _ = listener.tx.send(TalkPayload { action: "end".to_string(), ..start });
                }
            }
        });
    }

    /// Ends our transmission by itself when it runs too long or the window stops sending.
    fn talk_watch(&self, talk_id: String) {
        let this = self.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_millis(500)).await;
                let stop = match this.talk.outgoing.lock().as_ref() {
                    Some(o) if o.talk_id == talk_id => o.started.elapsed() > Duration::from_secs(TALK_MAX_SECS + 2) || o.last_audio.elapsed() > QUIET,
                    _ => return,
                };
                if stop {
                    this.talk_finish(Some(&talk_id), "stopped");
                    return;
                }
            }
        });
    }

    /// The next voice pieces of our transmission. Returns how many colleagues still hear it.
    pub fn talk_audio(&self, talk_id: &str, frames: Vec<String>) -> Result<usize, String> {
        let mut out = self.talk.outgoing.lock();
        let Some(o) = out.as_mut().filter(|o| o.talk_id == talk_id) else {
            return Err("That transmission has ended.".to_string());
        };
        o.seq += 1;
        o.last_audio = Instant::now();
        let step = TalkPayload { talk_id: talk_id.to_string(), channel: o.channel.clone(), action: "audio".to_string(), seq: o.seq, frames, at: 0 };
        check_talk(&step)?;
        o.listeners.retain(|l| l.tx.send(step.clone()).is_ok());
        Ok(o.listeners.len())
    }

    /// Ends our transmission (the button was let go).
    pub fn talk_end(&self, talk_id: &str) {
        self.talk_finish(Some(talk_id), "end");
    }

    /// Ends our transmission: this one (`Some`) or whichever is running. `tell`: what the
    /// window hears about it when it did not ask ("stopped", "gave_way").
    fn talk_finish(&self, talk_id: Option<&str>, tell: &str) {
        let done = {
            let mut out = self.talk.outgoing.lock();
            match out.as_ref() {
                Some(o) if talk_id.is_none_or(|id| id == o.talk_id) => out.take(),
                _ => None,
            }
        };
        let Some(o) = done else { return };
        let end = TalkPayload { talk_id: o.talk_id.clone(), channel: o.channel.clone(), action: "end".to_string(), seq: o.seq + 1, frames: Vec::new(), at: now_secs() };
        for l in &o.listeners {
            let _ = l.tx.send(end.clone());
        }
        if tell != "end" {
            self.talk_emit(tell, &o.talk_id, (&self.identity.device_id, ""), &o.channel, 0, Vec::new());
        }
    }

    // ------------------------------------------------------------------ hearing

    /// A step from a colleague. `start` is answered; the voice and the end are not.
    /// This PC is in a call that was answered, or in a meeting: its microphone and
    /// loudspeaker belong to that.
    fn in_a_call(&self) -> bool {
        self.current_call().is_some_and(|c| c.phase == "active") || self.current_meeting().is_some()
    }

    pub(super) fn handle_talk(&self, peer: &Peer, p: TalkPayload) -> Option<AckPayload> {
        if check_talk(&p).is_err() {
            return (p.action == "start").then(|| AckPayload { ok: false, reason: Some("other".to_string()) });
        }
        match p.action.as_str() {
            "start" => Some(self.talk_start_in(peer, &p)),
            "audio" => {
                {
                    let mut incoming = self.talk.incoming.lock();
                    match incoming.as_mut() {
                        Some(i) if i.talk_id == p.talk_id && i.peer_id == peer.id => i.last = Instant::now(),
                        _ => return None,
                    }
                }
                self.talk_emit("audio", &p.talk_id, (&peer.id, &peer.display_name), &p.channel, p.seq, p.frames);
                None
            }
            _ => {
                self.talk_end_in(&peer.id, &p.talk_id);
                None
            }
        }
    }

    fn talk_start_in(&self, peer: &Peer, p: &TalkPayload) -> AckPayload {
        let no = |r: &str| AckPayload { ok: false, reason: Some(r.to_string()) };
        if peer.trust_state == "blocked" {
            return no("other");
        }
        if self.privacy.is_locked() {
            return no("locked");
        }
        let (on, muted) = self.talk_prefs();
        if !on {
            return no("off");
        }
        let key = if p.channel == "direct" { format!("peer:{}", peer.id) } else { p.channel.clone() };
        if muted.contains(&key) {
            return no("muted");
        }
        // "Do not disturb" (the status, or quiet hours): no voice comes out of this PC,
        // as with the intercom.
        if self.db.get_settings().map(|s| s.profile.effective(now_secs()).status == "dnd" || s.quiet_hours.active_now()).unwrap_or(false) {
            return no("dnd");
        }
        // Nobody talks into a call or a meeting.
        if self.in_a_call() {
            return no("call");
        }
        if let Some(group) = p.channel.strip_prefix("group:") {
            let member = self.get_group(group).is_some_and(|g| g.membership == "member" && g.members.iter().any(|m| m.device_id == peer.id));
            if !member {
                return no("group");
            }
        }
        // One voice at a time. (Locks: always `incoming` first, then `outgoing`.)
        let mut gave_way = None;
        {
            let mut incoming = self.talk.incoming.lock();
            if let Some(i) = incoming.as_ref() {
                if i.peer_id != peer.id && i.last.elapsed() < QUIET {
                    return no(&format!("busy:{}", i.peer_name));
                }
            }
            let mut out = self.talk.outgoing.lock();
            if let Some(o) = out.as_ref() {
                let theirs_first = o.started.elapsed() < SAME_MOMENT && peer.id < self.identity.device_id;
                if !theirs_first {
                    return no(&format!("busy:{}", self.local_profile().display_name));
                }
                gave_way = out.take();
            }
            *incoming = Some(Incoming { talk_id: p.talk_id.clone(), peer_id: peer.id.clone(), peer_name: peer.display_name.clone(), channel: p.channel.clone(), last: Instant::now() });
        }
        if let Some(o) = gave_way {
            let end = TalkPayload { talk_id: o.talk_id.clone(), channel: o.channel.clone(), action: "end".to_string(), seq: o.seq + 1, frames: Vec::new(), at: now_secs() };
            for l in &o.listeners {
                let _ = l.tx.send(end.clone());
            }
            self.talk_emit("gave_way", &o.talk_id, (&peer.id, &peer.display_name), &o.channel, 0, Vec::new());
        }
        self.talk_emit("start", &p.talk_id, (&peer.id, &peer.display_name), &p.channel, 0, Vec::new());
        AckPayload { ok: true, reason: None }
    }

    /// A colleague's transmission is over: they said so, or their connection closed.
    pub(super) fn talk_end_in(&self, peer_id: &str, talk_id: &str) {
        let ended = {
            let mut incoming = self.talk.incoming.lock();
            match incoming.as_ref() {
                Some(i) if i.talk_id == talk_id && i.peer_id == peer_id => incoming.take(),
                _ => None,
            }
        };
        if let Some(i) = ended {
            self.talk_emit("end", &i.talk_id, (&i.peer_id, &i.peer_name), &i.channel, 0, Vec::new());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn step(action: &str, channel: &str, frames: &[&str]) -> TalkPayload {
        TalkPayload { talk_id: "0f8fad5b-d9cb-469f-a165-70867728950e".into(), channel: channel.into(), action: action.into(), seq: 1, frames: frames.iter().map(|f| f.to_string()).collect(), at: 0 }
    }

    #[test]
    fn steps_are_checked() {
        assert!(check_talk(&step("start", "direct", &[])).is_ok());
        assert!(check_talk(&step("start", "all", &[])).is_ok());
        assert!(check_talk(&step("start", "group:7c9e6679-7425-40de-944b-e07fc1f90ae7", &[])).is_ok());
        assert!(check_talk(&step("audio", "all", &["T3B1cw==", "AAEC+/8="])).is_ok());
        assert!(check_talk(&step("end", "direct", &[])).is_ok());
        // off: the channel, the step, voice where none belongs (and none where it does)
        for bad in [step("start", "everyone", &[]), step("start", "group:", &[]), step("start", "group:a b", &[]), step("shout", "all", &[]), step("start", "all", &["AAEC"]), step("audio", "all", &[]), step("end", "all", &["AAEC"])] {
            assert!(check_talk(&bad).is_err(), "{bad:?}");
        }
        // off: what is not base64, too many pieces, too big a piece
        assert!(check_talk(&step("audio", "all", &["<script>"])).is_err());
        assert!(check_talk(&step("audio", "all", &["AAEC"; 17])).is_err());
        let big = "A".repeat(2001);
        assert!(check_talk(&step("audio", "all", &[&big])).is_err());
        let mut odd = step("start", "all", &[]);
        odd.talk_id = "../../x".into();
        assert!(check_talk(&odd).is_err());
    }

    #[test]
    fn a_no_is_told_in_words_the_window_knows() {
        let peer = Peer {
            id: "p1".into(),
            display_name: "Bharat".into(),
            hostname: String::new(),
            last_ip: String::new(),
            tcp_port: 0,
            public_key: None,
            trust_state: "trusted".into(),
            status: "online".into(),
            last_seen: 0,
            avatar_color: String::new(),
        };
        assert_eq!(refusal(&peer, Some("off")).why, "off");
        assert_eq!(refusal(&peer, Some("muted")).why, "muted");
        assert_eq!(refusal(&peer, Some("locked")).why, "locked");
        let busy = refusal(&peer, Some("busy:Asha (Accounts)"));
        assert_eq!((busy.why.as_str(), busy.who.as_deref(), busy.name.as_str()), ("busy", Some("Asha (Accounts)"), "Bharat"));
        assert_eq!(refusal(&peer, Some("something new")).why, "other");
        assert_eq!(refusal(&peer, None).why, "other");
    }
}
