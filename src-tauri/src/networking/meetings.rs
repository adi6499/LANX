//! LANX 1.4.0: group meetings (video conferences).
//!
//! A meeting belongs to a group chat (people invited personally see it in
//! their chat with whoever invited them). Everyone in a meeting is connected
//! to everyone else directly: the LANX windows send the audio and video with
//! WebRTC (DTLS-SRTP encrypted, straight across the LAN, no server). This
//! module keeps who is in the meeting, sends the invitations (ringtone and
//! island), passes each pair's offer/answer, shares mute / camera / screen /
//! raised hand / recording, carries the meeting chat, and writes a summary
//! into the chat when you leave ("Meeting · 25 min · 4 people").
//!
//! Joining: the newcomer asks the person who invited them (then everyone else
//! it knows of) to "join"; each answers with who is in the meeting, and the
//! newcomer asks those too, so everybody learns about everybody even when
//! several people join at the same moment. For each pair, the one with the
//! smaller device id makes the WebRTC offer (never both at once).

use super::protocol::*;
use super::session::SecureChannel;
use super::{ACK_TIMEOUT, NetworkService, now_secs};
use crate::events::AlertKind;
use crate::storage::models::Peer;
use serde::Serialize;
use std::collections::{HashSet, VecDeque};
use std::time::Duration;

/// Most people in one meeting (everyone sends to everyone).
pub const MAX_PEOPLE: usize = 12;
/// LANX 3.10.0: most people in a big meeting (the organizer's PC relays them).
pub const MAX_BIG: usize = crate::relay::MAX_CLIENTS;
const MAX_CHAT_LEN: usize = 2000;
const MAX_TITLE_LEN: usize = 80;
const MAX_SDP_LEN: usize = 64 * 1024;
/// Meeting chat lines kept (and written into the summary).
const MAX_CHAT_KEPT: usize = 300;
/// The summary keeps at most this much chat text.
const MAX_SUMMARY_CHAT_CHARS: usize = 40_000;
/// How often a running meeting checks for people whose computer went away.
const WATCH_EVERY: Duration = Duration::from_secs(5);

/// Someone in the meeting.
#[derive(Debug, Clone, Serialize)]
pub struct MeetingPerson {
    pub device_id: String,
    pub name: String,
    pub avatar_color: String,
    pub muted: bool,
    pub camera: bool,
    pub screen: bool,
    pub hand: bool,
    pub recording: bool,
    pub is_me: bool,
    /// LANX 3.7.0: their last emoji reaction (👍…) and when they made it
    /// (their clock, milliseconds): the window floats a new one over their tile.
    pub reaction: Option<String>,
    pub reaction_at: i64,
    /// Newest change applied (changes can arrive out of order).
    #[serde(skip)]
    seq: u64,
}

/// A line in the meeting chat (`from` is empty for LANX's own notes such as
/// "Bharat joined").
#[derive(Debug, Clone, Serialize)]
pub struct MeetingChatLine {
    pub from: String,
    pub name: String,
    pub text: String,
    pub at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct MeetingInfo {
    pub meeting_id: String,
    pub title: String,
    /// The chat this meeting belongs to on this computer.
    pub conversation_id: String,
    pub group_id: Option<String>,
    pub host_id: String,
    pub host_name: String,
    /// Who invited us (ourselves for the person who started it).
    pub inviter_id: String,
    pub inviter_name: String,
    pub inviter_color: String,
    pub video: bool,
    /// invited | joined
    pub phase: String,
    pub started_at: i64,
    pub joined_at: Option<i64>,
    /// Everyone in the meeting, us included (empty while only invited).
    pub people: Vec<MeetingPerson>,
    pub chat: Vec<MeetingChatLine>,
    /// The chat is hidden (or LANX is locked): the invitation shows no names.
    pub private: bool,
    pub my_id: String,
    /// LANX 3.4: the phone (device id) that carries the meeting's sound and
    /// picture; none = this PC's window.
    pub on_phone: Option<String>,
    /// LANX 3.10.0: a big meeting: the organizer's PC (host_id) relays everyone's
    /// sound and picture, and passes on joins, changes and chat.
    pub relay: bool,
    /// Who the invitation said was in the meeting (asked when joining).
    #[serde(skip)]
    contacts: Vec<MeetingPersonPayload>,
    /// Everyone who was in the meeting while we were (id, name).
    #[serde(skip)]
    attendees: Vec<(String, String)>,
    /// LANX 3.10.0: changes the organizer passed on for people who aren't in our
    /// list yet (the list and the change travel separately and can swap places).
    #[serde(skip)]
    pending: Vec<MeetingPersonPayload>,
}

impl MeetingInfo {
    fn joined(&self) -> bool {
        self.phase == "joined"
    }

    /// Most people this meeting can have.
    fn max(&self) -> usize {
        if self.relay { MAX_BIG } else { MAX_PEOPLE }
    }

    /// This PC organizes (and, in a big meeting, relays) it.
    fn i_host(&self) -> bool {
        self.host_id == self.my_id
    }

    /// Where changes and chat go: everyone, or (a big meeting) the organizer.
    fn targets(&self) -> Vec<String> {
        if self.relay && !self.i_host() { vec![self.host_id.clone()] } else { self.others() }
    }

    fn person_mut(&mut self, id: &str) -> Option<&mut MeetingPerson> {
        self.people.iter_mut().find(|p| p.device_id == id)
    }

    fn has(&self, id: &str) -> bool {
        self.people.iter().any(|p| p.device_id == id)
    }

    fn others(&self) -> Vec<String> {
        self.people.iter().filter(|p| !p.is_me).map(|p| p.device_id.clone()).collect()
    }

    fn push_chat(&mut self, from: &str, name: &str, text: &str) -> MeetingChatLine {
        let line = MeetingChatLine {
            from: from.to_string(),
            name: name.to_string(),
            text: text.to_string(),
            at: now_secs(),
        };
        self.chat.push(line.clone());
        if self.chat.len() > MAX_CHAT_KEPT {
            let extra = self.chat.len() - MAX_CHAT_KEPT;
            self.chat.drain(..extra);
        }
        line
    }

    fn note(&mut self, text: &str) {
        self.push_chat("", "", text);
    }

    /// Adds someone (if new). Returns true when they were added.
    fn add(&mut self, person: MeetingPerson) -> bool {
        if self.has(&person.device_id) {
            return false;
        }
        if !self.attendees.iter().any(|(id, _)| id == &person.device_id) {
            self.attendees.push((person.device_id.clone(), person.name.clone()));
        }
        self.note(&format!("{} joined", person.name));
        self.people.push(person);
        true
    }

    fn remove(&mut self, id: &str) -> Option<MeetingPerson> {
        let i = self.people.iter().position(|p| p.device_id == id && !p.is_me)?;
        let p = self.people.remove(i);
        self.note(&format!("{} left", p.name));
        Some(p)
    }
}

/// `lanx://meeting` — invited | joined | person-joined | person-left | signal |
/// media | chat | declined | notice | ended | phone (3.4: it moved to a phone)
#[derive(Debug, Clone, Default, Serialize)]
pub struct MeetingEvent {
    pub action: String,
    pub meeting: Option<MeetingInfo>,
    /// Who it came from (device id).
    pub from: Option<String>,
    pub person: Option<MeetingPerson>,
    /// signal: offer | answer
    pub kind: Option<String>,
    pub sdp: Option<String>,
    /// chat / notice text.
    pub text: Option<String>,
    /// ended: left | declined | timeout | gone; person-left: left | offline | lost
    pub reason: Option<String>,
}

fn clean_title(t: &str) -> String {
    t.trim().chars().filter(|c| !c.is_control()).take(MAX_TITLE_LEN).collect()
}

fn person_from_payload(p: &MeetingPersonPayload) -> MeetingPerson {
    let (reaction, reaction_at) = received_reaction(p);
    MeetingPerson {
        device_id: p.device_id.clone(),
        name: if p.name.trim().is_empty() { "Someone".to_string() } else { p.name.chars().take(60).collect() },
        avatar_color: if p.avatar_color.is_empty() { "#64748b".to_string() } else { p.avatar_color.clone() },
        muted: p.muted,
        camera: p.camera,
        screen: p.screen,
        hand: p.hand,
        recording: p.recording,
        is_me: false,
        reaction,
        reaction_at,
        seq: 0,
    }
}

/// LANX 3.7.0: someone's reaction as we keep it: only the allowed ones (with
/// when it was made); anything else counts as no reaction.
fn received_reaction(p: &MeetingPersonPayload) -> (Option<String>, i64) {
    match p.reaction.as_deref().and_then(clean_reaction) {
        Some(r) => (Some(r), p.reaction_at),
        None => (None, 0),
    }
}

fn now_ms() -> u64 {
    chrono::Utc::now().timestamp_millis().max(0) as u64
}

impl NetworkService {
    pub fn current_meeting(&self) -> Option<MeetingInfo> {
        self.meeting.lock().clone()
    }

    /// LANX 3.4: the meeting's sound and picture move to a phone (`Some`
    /// device id) — the PC's window then leaves the WebRTC to it and shows
    /// "on your phone" — or back (`None`). The window and phones are told.
    pub fn set_meeting_phone(&self, meeting_id: &str, phone: Option<String>) -> Option<MeetingInfo> {
        let m = self.with_meeting(meeting_id, |m| {
            m.on_phone = phone;
            m.clone()
        })?;
        self.emit_meeting("phone", |_| {});
        Some(m)
    }

    fn emit_meeting(&self, action: &str, f: impl FnOnce(&mut MeetingEvent)) {
        let mut ev = MeetingEvent {
            action: action.to_string(),
            meeting: self.current_meeting(),
            ..Default::default()
        };
        f(&mut ev);
        self.events.emit_json("lanx://meeting", ev);
    }

    /// Runs `f` on the meeting if it is `meeting_id`.
    fn with_meeting<R>(&self, meeting_id: &str, f: impl FnOnce(&mut MeetingInfo) -> R) -> Option<R> {
        let mut cur = self.meeting.lock();
        cur.as_mut().filter(|m| m.meeting_id == meeting_id).map(f)
    }

    fn my_person(&self) -> MeetingPerson {
        let me = self.local_profile();
        MeetingPerson {
            device_id: self.identity.device_id.clone(),
            name: me.display_name,
            avatar_color: me.avatar_color,
            muted: false,
            camera: false,
            screen: false,
            hand: false,
            recording: false,
            is_me: true,
            reaction: None,
            reaction_at: 0,
            seq: 0,
        }
    }

    fn person_payload(&self, p: &MeetingPerson) -> MeetingPersonPayload {
        let mut out = MeetingPersonPayload {
            device_id: p.device_id.clone(),
            name: p.name.clone(),
            avatar_color: p.avatar_color.clone(),
            muted: p.muted,
            camera: p.camera,
            screen: p.screen,
            hand: p.hand,
            recording: p.recording,
            reaction: p.reaction.clone(),
            reaction_at: p.reaction_at,
            ..Default::default()
        };
        if p.is_me {
            out.public_key = self.identity.public_key_hex();
            out.tcp_port = self.local_profile().tcp_port;
        } else if let Ok(Some(peer)) = self.db.get_peer(&p.device_id) {
            out.public_key = peer.public_key.unwrap_or_default();
            out.ip = peer.last_ip;
            out.tcp_port = peer.tcp_port;
        }
        out
    }

    /// Makes sure someone named in a meeting can be contacted (adds them as a
    /// colleague when LANX hasn't met them yet, like group members).
    fn learn_person(&self, p: &MeetingPersonPayload) {
        if p.device_id == self.identity.device_id || p.public_key.is_empty() || p.ip.is_empty() || p.tcp_port == 0 {
            return;
        }
        if let Ok(None) = self.db.get_peer(&p.device_id) {
            let _ = self.db.upsert_peer(&Peer {
                id: p.device_id.clone(),
                display_name: p.name.clone(),
                hostname: String::new(),
                last_ip: p.ip.clone(),
                tcp_port: p.tcp_port,
                public_key: Some(p.public_key.clone()),
                trust_state: "unverified".to_string(),
                status: "offline".to_string(),
                last_seen: 0,
                avatar_color: p.avatar_color.clone(),
            });
        }
    }

    /// The meeting as told to others (invitation / answer to "join").
    fn roster(&self, m: &MeetingInfo, action: &str) -> MeetingPayload {
        MeetingPayload {
            meeting_id: m.meeting_id.clone(),
            action: action.to_string(),
            title: Some(m.title.clone()),
            group_id: m.group_id.clone(),
            host_id: Some(m.host_id.clone()),
            host_name: Some(m.host_name.clone()),
            started_at: Some(m.started_at),
            video: Some(m.video),
            people: m
                .people
                .iter()
                .map(|p| {
                    let mut x = self.person_payload(p);
                    if m.relay {
                        x.seq = p.seq;
                    }
                    x
                })
                .collect(),
            relay: m.relay.then_some(true),
            ..Default::default()
        }
    }

    /// LANX 3.10.0: the organizer of a big meeting tells everyone (but `except`) who is in it.
    fn push_roster(&self, meeting_id: &str, except: Option<&str>) {
        let Some(m) = self.current_meeting().filter(|m| m.meeting_id == meeting_id && m.joined() && m.relay && m.i_host()) else { return };
        let to: Vec<String> = m.others().into_iter().filter(|id| Some(id.as_str()) != except).collect();
        self.send_to_all(to, self.roster(&m, "roster"));
    }

    /// LANX 3.10.0: a big meeting ended for this PC (the organizer left, or their PC went away).
    fn end_relay_meeting(&self, meeting_id: &str, reason: &str) {
        let m = {
            let mut cur = self.meeting.lock();
            if cur.as_ref().is_some_and(|m| m.meeting_id == meeting_id) { cur.take() } else { None }
        };
        let Some(m) = m else { return };
        crate::sound::stop_loop();
        if m.joined() {
            self.record_meeting(&m, "attended");
        }
        self.events.emit_json(
            "lanx://meeting",
            MeetingEvent {
                action: "ended".to_string(),
                meeting: Some(m),
                reason: Some(reason.to_string()),
                ..Default::default()
            },
        );
    }

    fn bare(meeting_id: &str, action: &str) -> MeetingPayload {
        MeetingPayload {
            meeting_id: meeting_id.to_string(),
            action: action.to_string(),
            ..Default::default()
        }
    }

    async fn meeting_channel(&self, peer: &Peer) -> Result<SecureChannel, String> {
        let chan = self
            .connect_peer(peer)
            .await
            .map_err(|_| format!("Could not reach {}.", peer.display_name))?;
        if !version_at_least(&chan.remote.app_version, FEATURES_MEETINGS) {
            chan.close().await;
            return Err(format!(
                "{} needs LANX {} or newer for meetings. Ask them to update.",
                peer.display_name, FEATURES_MEETINGS
            ));
        }
        Ok(chan)
    }

    async fn send_meeting(&self, peer: &Peer, p: MeetingPayload) -> Result<(), String> {
        let mut chan = self.meeting_channel(peer).await?;
        if p.relay == Some(true) && !version_at_least(&chan.remote.app_version, FEATURES_BIG_MEETINGS) {
            chan.close().await;
            return Err(format!("{} needs LANX {} or newer for big meetings. Ask them to update.", peer.display_name, FEATURES_BIG_MEETINGS));
        }
        let p = p.for_version(&chan.remote.app_version);
        let reply = NetworkService::send_acked(&mut chan, PacketPayload::Meeting(p)).await;
        chan.close().await;
        match reply {
            Ok(a) if a.ok => Ok(()),
            Ok(a) => Err(a.reason.unwrap_or_else(|| format!("{} refused.", peer.display_name))),
            Err(()) => Err(format!("Could not reach {}.", peer.display_name)),
        }
    }

    /// "join" is answered with who is in the meeting.
    async fn ask_to_join(&self, peer: &Peer, p: MeetingPayload) -> Result<MeetingPayload, String> {
        let unreachable = || format!("Could not reach {}.", peer.display_name);
        let meeting_id = p.meeting_id.clone();
        let mut chan = self.meeting_channel(peer).await?;
        let p = p.for_version(&chan.remote.app_version);
        let sent = match chan.send(PacketPayload::Meeting(p), None).await {
            Ok(s) => s,
            Err(_) => {
                chan.close().await;
                return Err(unreachable());
            }
        };
        let reply = chan.recv_packet_timeout(ACK_TIMEOUT).await;
        chan.close().await;
        let reply = reply.map_err(|_| unreachable())?;
        if reply.correlation_id.as_deref() != Some(sent.packet_id.as_str()) {
            return Err(unreachable());
        }
        match reply.payload {
            PacketPayload::Meeting(r) if r.action == "roster" && r.meeting_id == meeting_id => Ok(r),
            PacketPayload::Ack(a) => Err(a.reason.unwrap_or_else(|| "Not in this meeting.".to_string())),
            _ => Err(unreachable()),
        }
    }

    /// Sends `p` to each of `to` in the background.
    fn send_to_all(&self, to: Vec<String>, p: MeetingPayload) {
        for id in to {
            if id == self.identity.device_id {
                continue;
            }
            let this = self.clone();
            let p = p.clone();
            tauri::async_runtime::spawn(async move {
                let Ok(Some(peer)) = this.db.get_peer(&id) else { return };
                let action = p.action.clone();
                if let Err(e) = this.send_meeting(&peer, p).await {
                    eprintln!("[Meeting] {} to {} failed: {}", action, peer.display_name, e);
                }
            });
        }
    }

    fn start_meeting_ringtone(&self) {
        if self.events.app().is_none() {
            return;
        }
        let volume = self.db.get_settings().map(|s| s.sound_volume).unwrap_or(80);
        crate::sound::play_loop("ringtone", volume);
    }

    // ------------------------------------------------------------ starting

    /// Starts a meeting in a group chat (everyone online in it is invited) or
    /// a one-to-one chat (that colleague is invited; more can be added).
    pub async fn start_meeting(&self, conversation_id: &str, video: bool, title: Option<String>, big: bool) -> Result<MeetingInfo, String> {
        let conv = self
            .db
            .get_conversation(conversation_id)
            .map_err(|e| e.to_string())?
            .ok_or("Chat not found")?;
        let (invitees, group_id, default_title) = if conv.kind == "group" {
            let g = self.get_group(&conv.id).ok_or("Group not found")?;
            if g.membership != "member" {
                return Err("You are no longer in this group.".to_string());
            }
            let ids: Vec<String> = g.members.iter().filter(|m| !m.is_me).map(|m| m.device_id.clone()).collect();
            (ids, Some(g.id.clone()), g.name.clone())
        } else {
            (vec![conv.peer_id.clone()], None, format!("Meeting with {}", conv.peer_name))
        };
        let online: Vec<String> = invitees
            .iter()
            .filter_map(|id| self.db.get_peer(id).ok().flatten())
            .filter(|p| p.status == "online" && p.trust_state != "blocked")
            .map(|p| p.id)
            .collect();
        if online.is_empty() {
            return Err(if group_id.is_some() {
                "Nobody else in this group is online right now.".to_string()
            } else {
                format!("{} is offline right now.", conv.peer_name)
            });
        }
        if self.call.lock().is_some() {
            return Err("You're in a call. Hang up first.".to_string());
        }
        // LANX 3.10.0: more people than a meeting can have: a big meeting (this PC relays).
        let big = big || online.len() + 1 > MAX_PEOPLE;
        let mut online = online;
        online.truncate(if big { MAX_BIG - 1 } else { MAX_PEOPLE - 1 });
        let me = self.my_person();
        let now = now_secs();
        let title = title.map(|t| clean_title(&t)).filter(|t| !t.is_empty()).unwrap_or_else(|| clean_title(&default_title));
        let info = MeetingInfo {
            meeting_id: uuid::Uuid::new_v4().to_string(),
            title,
            conversation_id: conv.id.clone(),
            group_id,
            host_id: me.device_id.clone(),
            host_name: me.name.clone(),
            inviter_id: me.device_id.clone(),
            inviter_name: me.name.clone(),
            inviter_color: me.avatar_color.clone(),
            video,
            phase: "joined".to_string(),
            started_at: now,
            joined_at: Some(now),
            people: vec![me.clone()],
            chat: Vec::new(),
            private: false,
            my_id: me.device_id.clone(),
            contacts: Vec::new(),
            attendees: vec![(me.device_id.clone(), me.name.clone())],
            pending: Vec::new(),
            on_phone: None,
            relay: big,
        };
        {
            let mut cur = self.meeting.lock();
            if cur.is_some() {
                return Err("You're already in a meeting.".to_string());
            }
            *cur = Some(info.clone());
        }
        if big {
            if let Err(e) = crate::relay::start(&info.meeting_id) {
                self.meeting.lock().take();
                return Err(e);
            }
        }
        self.spawn_watch(info.meeting_id.clone());
        let this = self.clone();
        let id = info.meeting_id.clone();
        tauri::async_runtime::spawn(async move {
            this.send_invites(&id, online).await;
        });
        Ok(info)
    }

    /// Invites colleagues; returns what went wrong (also shown as notices).
    async fn send_invites(&self, meeting_id: &str, peer_ids: Vec<String>) -> Vec<String> {
        let Some(m) = self.current_meeting().filter(|m| m.meeting_id == meeting_id && m.joined()) else {
            return Vec::new();
        };
        let invite = self.roster(&m, "invite");
        let mut tasks = Vec::new();
        for id in peer_ids {
            let this = self.clone();
            let p = invite.clone();
            tasks.push(tauri::async_runtime::spawn(async move {
                let peer = this.db.get_peer(&id).ok().flatten()?;
                this.send_meeting(&peer, p).await.err()
            }));
        }
        let mut problems = Vec::new();
        for t in tasks {
            if let Ok(Some(p)) = t.await {
                problems.push(p);
            }
        }
        for p in &problems {
            self.emit_meeting("notice", |e| e.text = Some(p.clone()));
        }
        problems
    }

    /// Invites more colleagues into the meeting we are in.
    pub async fn invite_to_meeting(&self, meeting_id: &str, peer_ids: &[String]) -> Result<Vec<String>, String> {
        let m = self
            .current_meeting()
            .filter(|m| m.meeting_id == meeting_id && m.joined())
            .ok_or("You're not in this meeting.")?;
        let mut ids: Vec<String> = Vec::new();
        let mut problems = Vec::new();
        for id in peer_ids {
            if m.has(id) || ids.contains(id) || id == &self.identity.device_id {
                continue;
            }
            match self.db.get_peer(id).ok().flatten() {
                Some(p) if p.trust_state == "blocked" => problems.push(format!("{} is blocked.", p.display_name)),
                Some(p) if p.status != "online" => problems.push(format!("{} is offline right now.", p.display_name)),
                Some(p) => ids.push(p.id),
                None => {}
            }
        }
        if m.people.len() + ids.len() > m.max() {
            return Err(if m.relay {
                format!("A big meeting can have at most {} people.", MAX_BIG)
            } else {
                format!("This meeting can have at most {} people. Start it with more people and it runs as a big meeting (up to {}).", MAX_PEOPLE, MAX_BIG)
            });
        }
        problems.extend(self.send_invites(meeting_id, ids).await);
        Ok(problems)
    }

    // ------------------------------------------------------------- joining

    /// Joins the meeting we were invited to.
    pub async fn join_meeting(&self, meeting_id: &str) -> Result<MeetingInfo, String> {
        let me = self.my_person();
        let contacts: Vec<String> = {
            let mut cur = self.meeting.lock();
            match cur.as_mut() {
                Some(m) if m.meeting_id == meeting_id && m.phase == "invited" => {
                    m.phase = "joined".to_string();
                    m.joined_at = Some(now_secs());
                    m.people = vec![me.clone()];
                    m.attendees = vec![(me.device_id.clone(), me.name.clone())];
                    if m.relay {
                        // A big meeting: everything goes through the organizer.
                        vec![m.host_id.clone()]
                    } else {
                        let mut c = vec![m.inviter_id.clone()];
                        c.extend(m.contacts.iter().map(|p| p.device_id.clone()));
                        c
                    }
                }
                Some(m) if m.meeting_id == meeting_id => return Ok(m.clone()),
                _ => return Err("This meeting invitation has ended.".to_string()),
            }
        };
        crate::sound::stop_loop();
        let relay = self.with_meeting(meeting_id, |m| m.relay).unwrap_or(false);
        let mut asked: HashSet<String> = HashSet::new();
        let mut queue: VecDeque<String> = contacts.into();
        let mut reached = 0;
        while let Some(id) = queue.pop_front() {
            if id == me.device_id || !asked.insert(id.clone()) {
                continue;
            }
            if self.with_meeting(meeting_id, |m| m.joined()) != Some(true) {
                return Err("You left the meeting.".to_string());
            }
            let Some(peer) = self.db.get_peer(&id).ok().flatten() else { continue };
            if peer.trust_state == "blocked" {
                continue;
            }
            let mut ask = Self::bare(meeting_id, "join");
            let mine = self.with_meeting(meeting_id, |m| m.people.iter().find(|p| p.is_me).cloned()).flatten();
            ask.person = Some(self.person_payload(mine.as_ref().unwrap_or(&me)));
            let Ok(roster) = self.ask_to_join(&peer, ask).await else { continue };
            reached += 1;
            for p in &roster.people {
                if p.device_id == me.device_id {
                    continue;
                }
                self.learn_person(p);
                if !relay && !asked.contains(&p.device_id) {
                    queue.push_back(p.device_id.clone());
                }
            }
            let mut added = Vec::new();
            self.with_meeting(meeting_id, |m| {
                if let Some(t) = roster.title.as_deref().map(clean_title).filter(|t| !t.is_empty()) {
                    m.title = t;
                }
                if let Some(h) = &roster.host_id {
                    m.host_id = h.clone();
                }
                if let Some(h) = &roster.host_name {
                    m.host_name = h.clone();
                }
                if let Some(s) = roster.started_at {
                    m.started_at = s;
                }
                for p in &roster.people {
                    if p.device_id == me.device_id {
                        continue;
                    }
                    // What someone says about themselves is the latest truth
                    // (others may not have heard their newest change yet).
                    if p.device_id == peer.id {
                        if let Some(who) = m.person_mut(&peer.id) {
                            who.muted = p.muted;
                            who.camera = p.camera;
                            who.screen = p.screen;
                            who.hand = p.hand;
                            who.recording = p.recording;
                            (who.reaction, who.reaction_at) = received_reaction(p);
                            continue;
                        }
                    }
                    if m.people.len() >= m.max() {
                        continue;
                    }
                    let mut person = person_from_payload(p);
                    // Names as this computer knows them.
                    if let Ok(Some(known)) = self.db.get_peer(&p.device_id) {
                        person.name = known.display_name;
                        person.avatar_color = known.avatar_color;
                    }
                    if m.add(person.clone()) {
                        added.push(person);
                    }
                }
            });
        }
        if reached == 0 {
            // Nobody answered: everyone has left.
            let mut cur = self.meeting.lock();
            if cur.as_ref().is_some_and(|m| m.meeting_id == meeting_id) {
                cur.take();
            }
            return Err("This meeting has ended.".to_string());
        }
        self.spawn_watch(meeting_id.to_string());
        self.emit_meeting("joined", |_| {});
        self.current_meeting()
            .filter(|m| m.meeting_id == meeting_id)
            .ok_or_else(|| "You left the meeting.".to_string())
    }

    /// "Join again" from a meeting line in the chat.
    pub async fn rejoin_meeting(&self, message_id: &str) -> Result<MeetingInfo, String> {
        let msg = self
            .db
            .get_message_by_id(message_id)
            .map_err(|e| e.to_string())?
            .filter(|m| m.message_type == "meeting")
            .ok_or("Meeting not found")?;
        let v: serde_json::Value = serde_json::from_str(&msg.content).unwrap_or_default();
        let meeting_id = v["meeting_id"].as_str().unwrap_or_default().to_string();
        if meeting_id.is_empty() {
            return Err("This meeting has ended.".to_string());
        }
        let contacts: Vec<MeetingPersonPayload> = v["people"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|p| {
                        let id = p["id"].as_str()?.to_string();
                        (id != self.identity.device_id).then(|| MeetingPersonPayload {
                            device_id: id,
                            name: p["name"].as_str().unwrap_or_default().to_string(),
                            ..Default::default()
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        let Some(first) = contacts.first().cloned() else {
            return Err("This meeting has ended.".to_string());
        };
        if self.call.lock().is_some() {
            return Err("You're in a call. Hang up first.".to_string());
        }
        let info = MeetingInfo {
            meeting_id: meeting_id.clone(),
            title: v["title"].as_str().map(clean_title).unwrap_or_default(),
            conversation_id: msg.conversation_id.clone(),
            group_id: v["group_id"].as_str().map(|s| s.to_string()),
            host_id: v["host_id"].as_str().unwrap_or_default().to_string(),
            host_name: v["host_name"].as_str().unwrap_or_default().to_string(),
            inviter_id: first.device_id.clone(),
            inviter_name: first.name.clone(),
            inviter_color: "#64748b".to_string(),
            video: v["video"].as_bool().unwrap_or(true),
            phase: "invited".to_string(),
            started_at: now_secs(),
            joined_at: None,
            people: Vec::new(),
            chat: Vec::new(),
            private: false,
            my_id: self.identity.device_id.clone(),
            contacts,
            attendees: Vec::new(),
            pending: Vec::new(),
            on_phone: None,
            relay: v["relay"].as_bool().unwrap_or(false),
        };
        {
            let mut cur = self.meeting.lock();
            match cur.as_ref() {
                Some(m) if m.meeting_id == meeting_id && m.joined() => return Ok(m.clone()),
                Some(m) if m.meeting_id == meeting_id => {}
                Some(_) => return Err("You're already in a meeting.".to_string()),
                None => {}
            }
            *cur = Some(info);
        }
        crate::sound::stop_loop();
        self.join_meeting(&meeting_id).await
    }

    /// Says no to an invitation.
    pub async fn decline_meeting(&self, meeting_id: &str) -> Result<(), String> {
        let m = {
            let mut cur = self.meeting.lock();
            if cur.as_ref().is_some_and(|m| m.meeting_id == meeting_id && m.phase == "invited") { cur.take() } else { None }
        };
        let Some(m) = m else { return Ok(()) };
        crate::sound::stop_loop();
        self.record_meeting(&m, "declined");
        self.send_to_all(vec![m.inviter_id.clone()], Self::bare(meeting_id, "decline"));
        // LANX 3.4: the PC's window and the phones stop showing the invitation
        // (it may have been declined on the other one).
        self.events.emit_json(
            "lanx://meeting",
            MeetingEvent {
                action: "ended".to_string(),
                meeting: Some(m),
                reason: Some("declined".to_string()),
                ..Default::default()
            },
        );
        Ok(())
    }

    /// Leaves the meeting (or declines it while it is still an invitation).
    pub async fn leave_meeting(&self, meeting_id: &str) -> Result<(), String> {
        let (m, only_invited) = {
            let mut cur = self.meeting.lock();
            match cur.as_ref().filter(|m| m.meeting_id == meeting_id).map(|m| m.joined()) {
                Some(true) => (cur.take(), false),
                Some(false) => (None, true),
                None => (None, false),
            }
        };
        if only_invited {
            return self.decline_meeting(meeting_id).await;
        }
        let Some(m) = m else { return Ok(()) };
        crate::sound::stop_loop();
        self.record_meeting(&m, "attended");
        // (A big meeting: a guest tells the organizer, who tells the others; the
        // organizer leaving ends it for everyone, and their PC stops relaying.)
        self.send_to_all(m.targets(), Self::bare(meeting_id, "leave"));
        if m.relay && m.i_host() {
            crate::relay::stop(meeting_id);
        }
        let ev = MeetingEvent {
            action: "ended".to_string(),
            meeting: Some(m),
            reason: Some("left".to_string()),
            ..Default::default()
        };
        self.events.emit_json("lanx://meeting", ev);
        Ok(())
    }

    // --------------------------------------------------------- in the meeting

    /// Passes this window's WebRTC offer/answer to one person in the meeting.
    pub async fn meeting_signal(&self, meeting_id: &str, to: &str, kind: &str, sdp: String) -> Result<(), String> {
        if kind != "offer" && kind != "answer" {
            return Err("Unknown signal".to_string());
        }
        if sdp.len() > MAX_SDP_LEN {
            return Err("Signal too large".to_string());
        }
        if self.with_meeting(meeting_id, |m| m.joined() && m.has(to)) != Some(true) {
            return Err("They are not in this meeting.".to_string());
        }
        let peer = self.db.get_peer(to).map_err(|e| e.to_string())?.ok_or("Unknown colleague")?;
        let mut p = Self::bare(meeting_id, "signal");
        p.kind = Some(kind.to_string());
        p.sdp = Some(sdp);
        self.send_meeting(&peer, p).await
    }

    /// Tells everyone about our mute / camera / screen / hand / recording, and
    /// (LANX 3.7.0) an emoji reaction (only the allowed ones; others are dropped).
    #[allow(clippy::too_many_arguments)]
    pub async fn meeting_media(
        &self,
        meeting_id: &str,
        muted: Option<bool>,
        camera: Option<bool>,
        screen: Option<bool>,
        hand: Option<bool>,
        recording: Option<bool>,
        reaction: Option<String>,
    ) -> Result<(), String> {
        let seq = now_ms();
        let reaction = reaction.as_deref().and_then(clean_reaction);
        let update = self.with_meeting(meeting_id, |m| {
            if !m.joined() {
                return None;
            }
            let my_id = m.my_id.clone();
            let me = m.person_mut(&my_id)?;
            let was_recording = me.recording;
            if let Some(v) = muted {
                me.muted = v;
            }
            if let Some(v) = camera {
                me.camera = v;
            }
            if let Some(v) = screen {
                me.screen = v;
            }
            if let Some(v) = hand {
                me.hand = v;
            }
            if let Some(v) = recording {
                me.recording = v;
            }
            if let Some(r) = reaction {
                me.reaction = Some(r);
                me.reaction_at = seq as i64;
            }
            me.seq = seq;
            let me = me.clone();
            if me.recording != was_recording {
                m.note(if me.recording { "● You started recording" } else { "You stopped recording" });
            }
            Some((me, m.targets()))
        });
        let Some(Some((me, others))) = update else {
            return Err("You're not in this meeting.".to_string());
        };
        let mut p = Self::bare(meeting_id, "media");
        p.person = Some(self.person_payload(&me));
        p.seq = Some(seq);
        self.send_to_all(others, p);
        Ok(())
    }

    /// Sends a line to the meeting chat.
    pub async fn meeting_chat(&self, meeting_id: &str, text: &str) -> Result<MeetingChatLine, String> {
        let text = text.trim();
        if text.is_empty() {
            return Err("Type a message first.".to_string());
        }
        if text.chars().count() > MAX_CHAT_LEN {
            return Err(format!("Meeting chat messages can be at most {} characters.", MAX_CHAT_LEN));
        }
        let me = self.my_person();
        let r = self.with_meeting(meeting_id, |m| m.joined().then(|| (m.push_chat(&me.device_id, &me.name, text), m.targets())));
        let Some(Some((line, others))) = r else {
            return Err("You're not in this meeting.".to_string());
        };
        let mut p = Self::bare(meeting_id, "chat");
        p.text = Some(text.to_string());
        self.send_to_all(others, p);
        Ok(line)
    }

    /// LANX 3.10.0: this window's one connection to a big meeting's relay — its
    /// offer, the relay's answer (this PC's own relay, or the organizer's).
    pub async fn meeting_relay_offer(&self, meeting_id: &str, sdp: String) -> Result<String, String> {
        if sdp.len() > MAX_SDP_LEN {
            return Err("Signal too large".to_string());
        }
        let (host, i_host) = self
            .with_meeting(meeting_id, |m| (m.joined() && m.relay).then(|| (m.host_id.clone(), m.i_host())))
            .flatten()
            .ok_or("You're not in this big meeting.")?;
        if i_host {
            return crate::relay::join(meeting_id, &self.identity.device_id, &sdp);
        }
        let peer = self.db.get_peer(&host).map_err(|e| e.to_string())?.ok_or("The organizer's PC isn't known here.")?;
        let mut p = Self::bare(meeting_id, "signal");
        p.kind = Some("relay-offer".to_string());
        p.sdp = Some(sdp);
        let unreachable = || format!("Could not reach {}'s PC.", peer.display_name);
        let mut chan = self.meeting_channel(&peer).await?;
        let sent = match chan.send(PacketPayload::Meeting(p), None).await {
            Ok(s) => s,
            Err(_) => {
                chan.close().await;
                return Err(unreachable());
            }
        };
        let reply = chan.recv_packet_timeout(ACK_TIMEOUT).await;
        chan.close().await;
        let reply = reply.map_err(|_| unreachable())?;
        if reply.correlation_id.as_deref() != Some(sent.packet_id.as_str()) {
            return Err(unreachable());
        }
        match reply.payload {
            PacketPayload::Meeting(r) if r.kind.as_deref() == Some("relay-answer") => r.sdp.ok_or_else(unreachable),
            PacketPayload::Ack(a) => Err(a.reason.unwrap_or_else(unreachable)),
            _ => Err(unreachable()),
        }
    }

    /// The window lost its connection to someone for good: show them as gone.
    pub fn meeting_drop(&self, meeting_id: &str, peer_id: &str) {
        if let Some(Some(p)) = self.with_meeting(meeting_id, |m| m.remove(peer_id)) {
            self.emit_meeting("person-left", |e| {
                e.from = Some(p.device_id.clone());
                e.person = Some(p);
                e.reason = Some("lost".to_string());
            });
        }
    }

    /// Notices people whose computer left the network while in the meeting.
    fn spawn_watch(&self, meeting_id: String) {
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(WATCH_EVERY).await;
                let Some(Some((others, relay, i_host))) = this.with_meeting(&meeting_id, |m| m.joined().then(|| (m.targets(), m.relay, m.i_host()))) else {
                    return;
                };
                for id in others {
                    let offline = this.db.get_peer(&id).ok().flatten().is_none_or(|p| p.status != "online");
                    if !offline {
                        continue;
                    }
                    // A big meeting's organizer went away: it has ended.
                    if relay && !i_host {
                        this.end_relay_meeting(&meeting_id, "gone");
                        return;
                    }
                    // LANX 3.10.0: their connection to this PC's relay is still up: still here
                    // (beacons over Wi-Fi can go missing for a while).
                    if relay && crate::relay::alive(&meeting_id, &id) {
                        continue;
                    }
                    let removed = this.with_meeting(&meeting_id, |m| m.remove(&id)).flatten();
                    if relay {
                        crate::relay::leave(&meeting_id, &id);
                        this.push_roster(&meeting_id, None);
                        // …and if their PC can still be reached, it hears it isn't in the meeting any more.
                        if let Some(r) = this.current_meeting().filter(|m| m.meeting_id == meeting_id).map(|m| this.roster(&m, "roster")) {
                            this.send_to_all(vec![id.clone()], r);
                        }
                    }
                    if let Some(p) = removed {
                        this.emit_meeting("person-left", |e| {
                            e.from = Some(p.device_id.clone());
                            e.person = Some(p);
                            e.reason = Some("offline".to_string());
                        });
                    }
                }
            }
        });
    }

    fn spawn_invite_timeout(&self, meeting_id: String) {
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_secs(crate::testmode::ring_timeout_secs())).await;
            let m = {
                let mut cur = this.meeting.lock();
                if cur.as_ref().is_some_and(|m| m.meeting_id == meeting_id && m.phase == "invited") { cur.take() } else { None }
            };
            let Some(m) = m else { return };
            crate::sound::stop_loop();
            this.record_meeting(&m, "missed");
            let title = if m.private {
                "Missed meeting".to_string()
            } else {
                format!("Missed meeting with {}", m.inviter_name)
            };
            this.events.notify(&this.db, AlertKind::Message, &title, "Open LANX to join");
            let mut p = Self::bare(&meeting_id, "decline");
            p.text = Some("no_answer".to_string());
            this.send_to_all(vec![m.inviter_id.clone()], p);
            let ev = MeetingEvent {
                action: "ended".to_string(),
                meeting: Some(m),
                reason: Some("timeout".to_string()),
                ..Default::default()
            };
            this.events.emit_json("lanx://meeting", ev);
        });
    }

    /// Writes the meeting into its chat. `outcome`: attended | missed | declined.
    fn record_meeting(&self, m: &MeetingInfo, outcome: &str) {
        let secs = if outcome == "attended" { m.joined_at.map(|j| (now_secs() - j).max(0)).unwrap_or(0) } else { 0 };
        let mut people: Vec<(String, String)> = m.attendees.clone();
        let mut add = |id: &str, name: &str| {
            if !id.is_empty() && !people.iter().any(|(i, _)| i == id) {
                people.push((id.to_string(), name.to_string()));
            }
        };
        if outcome != "attended" {
            add(&m.inviter_id, &m.inviter_name);
            for c in &m.contacts {
                add(&c.device_id, &c.name);
            }
        }
        let attended = if outcome == "attended" { m.attendees.len() } else { 0 };
        let mut chat: Vec<&MeetingChatLine> = Vec::new();
        let mut chars = 0;
        for line in m.chat.iter().rev() {
            chars += line.text.len() + line.name.len();
            if chars > MAX_SUMMARY_CHAT_CHARS {
                break;
            }
            chat.push(line);
        }
        chat.reverse();
        let content = serde_json::json!({
            "meeting_id": m.meeting_id,
            "title": m.title,
            "outcome": outcome,
            "secs": secs,
            "video": m.video,
            "relay": m.relay,
            "group_id": m.group_id,
            "host_id": m.host_id,
            "host_name": m.host_name,
            "attended": attended,
            "people": people.iter().map(|(id, name)| serde_json::json!({ "id": id, "name": name })).collect::<Vec<_>>(),
            "chat": chat,
        })
        .to_string();
        let outgoing = m.host_id == self.identity.device_id;
        let sender = if outgoing { self.identity.device_id.clone() } else { m.inviter_id.clone() };
        if let Some(msg) = self.insert_event_message(&m.conversation_id, &sender, outgoing, "meeting", &content) {
            if outcome == "missed" {
                let _ = self.db.increment_unread(&m.conversation_id);
            }
            let fresh = self.db.get_conversation(&m.conversation_id).ok().flatten();
            self.events.message_received(&msg, fresh.as_ref());
            self.events.update_tray(&self.db);
        }
    }

    /// "Recording saved" line in a chat (content: path, name, size, secs, kind).
    pub fn add_recording_line(&self, conversation_id: &str, content: &str) {
        let me = self.identity.device_id.clone();
        if let Some(msg) = self.insert_event_message(conversation_id, &me, true, "recording", content) {
            let fresh = self.db.get_conversation(conversation_id).ok().flatten();
            self.events.message_received(&msg, fresh.as_ref());
        }
    }

    // ------------------------------------------------------------- receiving

    /// `handle_meeting`, with the answer (who is in the meeting) as a copy
    /// running `remote_version` may see it (LANX 3.7.0: no reactions for older ones).
    pub(super) fn handle_meeting_from(&self, peer: &Peer, p: MeetingPayload, remote_version: &str) -> PacketPayload {
        match self.handle_meeting(peer, p) {
            PacketPayload::Meeting(r) => PacketPayload::Meeting(r.for_version(remote_version)),
            other => other,
        }
    }

    pub(super) fn handle_meeting(&self, peer: &Peer, p: MeetingPayload) -> PacketPayload {
        let ack = |ok: bool, reason: Option<String>| PacketPayload::Ack(AckPayload { ok, reason });
        let ended = || ack(false, Some("This meeting has ended.".to_string()));
        if peer.trust_state == "blocked" {
            return ack(false, Some("Not available".to_string()));
        }
        let in_it = |s: &Self| s.with_meeting(&p.meeting_id, |m| m.joined()) == Some(true);
        match p.action.as_str() {
            "invite" => self.handle_meeting_invite(peer, p),
            "join" => {
                let r = self.with_meeting(&p.meeting_id, |m| {
                    if !m.joined() {
                        return Err("This meeting has ended.".to_string());
                    }
                    if m.relay && !m.i_host() {
                        return Err(format!("{}'s PC runs this big meeting: join through them.", m.host_name));
                    }
                    let mut added = None;
                    if !m.has(&peer.id) {
                        if m.people.len() >= m.max() {
                            return Err(format!("The meeting is full ({} people).", m.max()));
                        }
                        let mut person = p.person.as_ref().map(person_from_payload).unwrap_or_else(|| person_from_payload(&MeetingPersonPayload::default()));
                        person.device_id = peer.id.clone();
                        person.name = peer.display_name.clone();
                        person.avatar_color = peer.avatar_color.clone();
                        m.add(person.clone());
                        added = Some(person);
                    }
                    Ok((m.clone(), added))
                });
                match r {
                    Some(Ok((m, added))) => {
                        if let Some(person) = added {
                            self.emit_meeting("person-joined", |e| {
                                e.from = Some(person.device_id.clone());
                                e.person = Some(person);
                            });
                            // A big meeting: the organizer tells everyone else.
                            if m.relay {
                                self.push_roster(&p.meeting_id, Some(&peer.id));
                            }
                        }
                        PacketPayload::Meeting(self.roster(&m, "roster"))
                    }
                    Some(Err(reason)) => ack(false, Some(reason)),
                    None => ended(),
                }
            }
            "signal" if p.kind.as_deref() == Some("relay-offer") => {
                // LANX 3.10.0: a guest's connection to this PC's relay.
                let ok = self.with_meeting(&p.meeting_id, |m| m.joined() && m.relay && m.i_host() && m.has(&peer.id)) == Some(true);
                if !ok {
                    return ack(false, Some("Not in this big meeting.".to_string()));
                }
                let Some(sdp) = p.sdp.clone().filter(|s| s.len() <= MAX_SDP_LEN) else {
                    return ack(false, Some("Bad signal".to_string()));
                };
                match crate::relay::join(&p.meeting_id, &peer.id, &sdp) {
                    Ok(answer) => {
                        let mut r = Self::bare(&p.meeting_id, "signal");
                        r.kind = Some("relay-answer".to_string());
                        r.sdp = Some(answer);
                        PacketPayload::Meeting(r)
                    }
                    Err(e) => ack(false, Some(e)),
                }
            }
            "signal" => {
                if !in_it(self) {
                    return ended();
                }
                let (Some(kind), Some(sdp)) = (p.kind.clone(), p.sdp.clone()) else {
                    return ack(false, Some("Empty signal".to_string()));
                };
                if (kind != "offer" && kind != "answer") || sdp.len() > MAX_SDP_LEN {
                    return ack(false, Some("Bad signal".to_string()));
                }
                // They know the meeting's id, so they were invited: someone
                // whose "join" hasn't reached us yet is added now.
                let added = self
                    .with_meeting(&p.meeting_id, |m| {
                        if m.has(&peer.id) || m.people.len() >= m.max() {
                            return None;
                        }
                        let person = MeetingPerson {
                            device_id: peer.id.clone(),
                            name: peer.display_name.clone(),
                            avatar_color: peer.avatar_color.clone(),
                            muted: false,
                            camera: false,
                            screen: false,
                            hand: false,
                            recording: false,
                            is_me: false,
                            reaction: None,
                            reaction_at: 0,
                            seq: 0,
                        };
                        m.add(person.clone()).then_some(person)
                    })
                    .flatten();
                if let Some(person) = added {
                    self.emit_meeting("person-joined", |e| {
                        e.from = Some(person.device_id.clone());
                        e.person = Some(person);
                    });
                }
                if self.with_meeting(&p.meeting_id, |m| m.has(&peer.id)) != Some(true) {
                    return ack(false, Some("The meeting is full.".to_string()));
                }
                self.emit_meeting("signal", |e| {
                    e.from = Some(peer.id.clone());
                    e.kind = Some(kind);
                    e.sdp = Some(sdp);
                });
                ack(true, None)
            }
            "leave" => {
                // LANX 3.10.0: the organizer of a big meeting left: it ends for everyone.
                let big = self.with_meeting(&p.meeting_id, |m| (m.relay, m.host_id == peer.id, m.i_host()));
                if let Some((true, true, false)) = big {
                    self.end_relay_meeting(&p.meeting_id, "host-left");
                    return ack(true, None);
                }
                if let Some((true, _, true)) = big {
                    crate::relay::leave(&p.meeting_id, &peer.id);
                }
                if let Some(Some(person)) = self.with_meeting(&p.meeting_id, |m| m.remove(&peer.id)) {
                    self.emit_meeting("person-left", |e| {
                        e.from = Some(person.device_id.clone());
                        e.person = Some(person);
                        e.reason = Some("left".to_string());
                    });
                    if big == Some((true, false, true)) {
                        self.push_roster(&p.meeting_id, None);
                    }
                }
                ack(true, None)
            }
            "roster" => {
                // LANX 3.10.0: the organizer of a big meeting says who is in it now.
                let dropped = self
                    .with_meeting(&p.meeting_id, |m| m.joined() && m.relay && peer.id == m.host_id && !p.people.iter().any(|x| x.device_id == m.my_id))
                    .unwrap_or(false);
                if dropped {
                    self.end_relay_meeting(&p.meeting_id, "dropped");
                    return ack(true, None);
                }
                let r = self.with_meeting(&p.meeting_id, |m| {
                    if !(m.joined() && m.relay && peer.id == m.host_id) {
                        return None;
                    }
                    let mut joined = Vec::new();
                    let mut left = Vec::new();
                    for x in &p.people {
                        if x.device_id == m.my_id {
                            continue;
                        }
                        if let Some(who) = m.person_mut(&x.device_id) {
                            if x.seq < who.seq {
                                continue; // we already have a newer change of theirs
                            }
                            who.seq = x.seq;
                            who.muted = x.muted;
                            who.camera = x.camera;
                            who.screen = x.screen;
                            who.hand = x.hand;
                            who.recording = x.recording;
                            (who.reaction, who.reaction_at) = received_reaction(x);
                        } else if m.people.len() < m.max() {
                            self.learn_person(x);
                            let mut person = person_from_payload(x);
                            person.seq = x.seq;
                            if let Some(i) = m.pending.iter().position(|q| q.device_id == x.device_id) {
                                let q = m.pending.remove(i);
                                if q.seq >= person.seq {
                                    person.muted = q.muted;
                                    person.camera = q.camera;
                                    person.screen = q.screen;
                                    person.hand = q.hand;
                                    person.recording = q.recording;
                                    (person.reaction, person.reaction_at) = received_reaction(&q);
                                    person.seq = q.seq;
                                }
                            }
                            if let Ok(Some(known)) = self.db.get_peer(&x.device_id) {
                                person.name = known.display_name;
                                person.avatar_color = known.avatar_color;
                            }
                            if m.add(person.clone()) {
                                joined.push(person);
                            }
                        }
                    }
                    let gone: Vec<String> = m.people.iter().filter(|q| !q.is_me && !p.people.iter().any(|x| x.device_id == q.device_id)).map(|q| q.device_id.clone()).collect();
                    for g in gone {
                        if let Some(q) = m.remove(&g) {
                            left.push(q);
                        }
                    }
                    Some((joined, left))
                });
                let Some(Some((joined, left))) = r else { return ended() };
                for person in joined {
                    self.emit_meeting("person-joined", |e| {
                        e.from = Some(person.device_id.clone());
                        e.person = Some(person);
                    });
                }
                for person in left {
                    self.emit_meeting("person-left", |e| {
                        e.from = Some(person.device_id.clone());
                        e.person = Some(person);
                        e.reason = Some("left".to_string());
                    });
                }
                self.emit_meeting("media", |_| {});
                ack(true, None)
            }
            "media" => {
                let Some(state) = p.person.clone() else {
                    return ack(false, Some("Empty change".to_string()));
                };
                let seq = p.seq.unwrap_or(0);
                // LANX 3.10.0: in a big meeting the organizer passes on others' changes.
                let target = self
                    .with_meeting(&p.meeting_id, |m| {
                        if m.relay && peer.id == m.host_id && !state.device_id.is_empty() && state.device_id != m.my_id { state.device_id.clone() } else { peer.id.clone() }
                    })
                    .unwrap_or_else(|| peer.id.clone());
                let pass_on = self.with_meeting(&p.meeting_id, |m| m.relay && m.i_host() && peer.id != m.my_id).unwrap_or(false);
                let r = self.with_meeting(&p.meeting_id, |m| {
                    if !m.joined() {
                        return None;
                    }
                    if m.relay && peer.id == m.host_id && m.person_mut(&target).is_none() {
                        if m.pending.len() < MAX_BIG {
                            m.pending.retain(|q| q.device_id != target);
                            let mut q = state.clone();
                            q.device_id = target.clone();
                            q.seq = seq;
                            m.pending.push(q);
                        }
                        return Some(None);
                    }
                    let who = m.person_mut(&target)?;
                    if seq != 0 && seq < who.seq {
                        return Some(None); // an older change arrived late
                    }
                    let was_recording = who.recording;
                    who.muted = state.muted;
                    who.camera = state.camera;
                    who.screen = state.screen;
                    who.hand = state.hand;
                    who.recording = state.recording;
                    (who.reaction, who.reaction_at) = received_reaction(&state);
                    who.seq = seq;
                    let who = who.clone();
                    if who.recording != was_recording {
                        let text = if who.recording {
                            format!("● {} started recording", who.name)
                        } else {
                            format!("{} stopped recording", who.name)
                        };
                        m.note(&text);
                    }
                    Some(Some((who, was_recording)))
                });
                match r {
                    Some(Some(Some((who, was_recording)))) => {
                        if pass_on {
                            let mut f = p.clone();
                            let mut pp = self.person_payload(&who);
                            pp.seq = who.seq;
                            f.person = Some(pp);
                            let to = self.with_meeting(&p.meeting_id, |m| m.others()).unwrap_or_default().into_iter().filter(|id| *id != peer.id).collect();
                            self.send_to_all(to, f);
                        }
                        let started = who.recording && !was_recording;
                        let name = who.name.clone();
                        self.emit_meeting("media", |e| {
                            e.from = Some(who.device_id.clone());
                            e.person = Some(who);
                        });
                        if started {
                            self.emit_meeting("notice", |e| {
                                e.text = Some(format!("{} started recording this meeting.", name))
                            });
                        }
                        ack(true, None)
                    }
                    Some(Some(None)) => ack(true, None),
                    _ => ended(),
                }
            }
            "chat" => {
                let text = p.text.clone().unwrap_or_default();
                let text = text.trim();
                if text.is_empty() || text.chars().count() > MAX_CHAT_LEN {
                    return ack(false, Some("Message rejected (empty or too long)".to_string()));
                }
                // LANX 3.10.0: in a big meeting the organizer passes on everyone's chat.
                let from = self
                    .with_meeting(&p.meeting_id, |m| match &p.person {
                        Some(x) if m.relay && peer.id == m.host_id && !x.device_id.is_empty() && x.device_id != m.my_id => x.device_id.clone(),
                        _ => peer.id.clone(),
                    })
                    .unwrap_or_else(|| peer.id.clone());
                let pass_on = self.with_meeting(&p.meeting_id, |m| m.relay && m.i_host()).unwrap_or(false);
                let r = self.with_meeting(&p.meeting_id, |m| {
                    (m.joined() && m.has(&from)).then(|| {
                        let name = m.people.iter().find(|x| x.device_id == from).map(|x| x.name.clone()).unwrap_or_default();
                        m.push_chat(&from, &name, text)
                    })
                });
                match r {
                    Some(Some(line)) => {
                        if pass_on {
                            let mut f = p.clone();
                            if let Some(who) = self.with_meeting(&p.meeting_id, |m| m.people.iter().find(|x| x.device_id == from).cloned()).flatten() {
                                f.person = Some(self.person_payload(&who));
                            }
                            let to = self.with_meeting(&p.meeting_id, |m| m.others()).unwrap_or_default().into_iter().filter(|id| *id != peer.id).collect();
                            self.send_to_all(to, f);
                        }
                        self.emit_meeting("chat", |e| {
                            e.from = Some(from.clone());
                            e.text = Some(line.text.clone());
                        });
                        ack(true, None)
                    }
                    _ => ended(),
                }
            }
            "decline" => {
                if in_it(self) {
                    let text = match p.text.as_deref() {
                        Some("no_answer") => format!("{} didn't answer.", peer.display_name),
                        Some("busy") => format!("{} is busy in another call.", peer.display_name),
                        _ => format!("{} can't join right now.", peer.display_name),
                    };
                    self.emit_meeting("declined", |e| {
                        e.from = Some(peer.id.clone());
                        e.text = Some(text);
                    });
                }
                ack(true, None)
            }
            _ => ack(false, Some("Unknown meeting action".to_string())),
        }
    }

    fn handle_meeting_invite(&self, peer: &Peer, p: MeetingPayload) -> PacketPayload {
        let ack = |ok: bool, reason: Option<String>| PacketPayload::Ack(AckPayload { ok, reason });
        if self.meeting.lock().as_ref().is_some_and(|m| m.meeting_id == p.meeting_id) {
            return ack(true, None); // already invited / already in it
        }
        let busy = self.call.lock().is_some() || self.meeting.lock().is_some();
        if busy {
            let me = self.db.get_settings().map(|s| s.display_name).unwrap_or_default();
            return ack(false, Some(format!("{} is busy in another call.", me)));
        }
        // The group chat when we are in that group, otherwise the chat with
        // whoever invited us.
        let group = p.group_id.as_deref().and_then(|g| self.get_group(g)).filter(|g| g.membership == "member");
        let conv_id = match &group {
            Some(g) => g.id.clone(),
            None => match self.db.get_or_create_conversation(&peer.id) {
                Ok(c) => c.id,
                Err(_) => return ack(false, Some("Could not open the chat".to_string())),
            },
        };
        let hidden = self.db.is_conversation_hidden(&conv_id);
        let private = hidden && !self.privacy.hidden_unlocked() || self.privacy.is_locked();
        let relay = p.relay == Some(true);
        let contacts: Vec<MeetingPersonPayload> = p
            .people
            .iter()
            .filter(|x| x.device_id != self.identity.device_id)
            .take(if relay { MAX_BIG } else { MAX_PEOPLE })
            .cloned()
            .collect();
        for c in &contacts {
            self.learn_person(c);
        }
        let title = p.title.as_deref().map(clean_title).filter(|t| !t.is_empty()).unwrap_or_else(|| format!("Meeting with {}", peer.display_name));
        let info = MeetingInfo {
            meeting_id: p.meeting_id.clone(),
            title,
            conversation_id: conv_id,
            group_id: group.map(|g| g.id),
            host_id: p.host_id.clone().unwrap_or_else(|| peer.id.clone()),
            host_name: p.host_name.clone().unwrap_or_else(|| peer.display_name.clone()),
            inviter_id: peer.id.clone(),
            inviter_name: peer.display_name.clone(),
            inviter_color: peer.avatar_color.clone(),
            video: p.video.unwrap_or(true),
            phase: "invited".to_string(),
            started_at: p.started_at.unwrap_or_else(now_secs),
            joined_at: None,
            people: Vec::new(),
            chat: Vec::new(),
            private,
            my_id: self.identity.device_id.clone(),
            contacts,
            attendees: Vec::new(),
            pending: Vec::new(),
            on_phone: None,
            relay,
        };
        {
            let mut cur = self.meeting.lock();
            if cur.is_some() {
                return ack(false, Some("Busy in another call.".to_string()));
            }
            *cur = Some(info.clone());
        }
        self.start_meeting_ringtone();
        self.spawn_invite_timeout(info.meeting_id.clone());
        let title = if private {
            "🎥 Meeting invitation".to_string()
        } else {
            format!("🎥 {} invited you to a meeting", peer.display_name)
        };
        self.events.incoming_call(&self.db, &title);
        self.emit_meeting("invited", |e| e.from = Some(peer.id.clone()));
        ack(true, None)
    }
}

#[cfg(test)]
impl MeetingInfo {
    pub fn person_mut_for_test(&mut self, id: &str) -> Option<&mut MeetingPerson> {
        self.person_mut(id)
    }
}
