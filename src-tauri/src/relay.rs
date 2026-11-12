//! LANX 3.10.0: big meetings (up to 100 people). The organizer's PC relays
//! everyone's sound and picture — a selective forwarding unit: each PC sends its
//! microphone and its camera once (the camera in two sizes), and the relay
//! forwards to each PC only what that PC uses: the six loudest voices, the
//! people on its screen (small) and the one it shows large (sharp). Nothing is
//! decoded or re-encoded here: encrypted packets in, encrypted packets out.
//!
//! Every PC opens one connection to the relay with a fixed set of receive slots
//! (6 sound, 16 picture) and a data channel; the relay tells it who is in which
//! slot. Moving someone into a slot needs no renegotiation: the relay carries on
//! the slot's timestamps and waits for that person's next keyframe, so a tile
//! never shows the wrong face.

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Once, mpsc};
use std::thread;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde_json::json;
use str0m::change::SdpOffer;
use str0m::channel::ChannelId;
use str0m::media::{Direction, KeyframeRequestKind, MediaData, MediaKind, MediaTime, Mid, Rid};
use str0m::net::{Protocol, Receive};
use str0m::{Candidate, Event, IceConnectionState, Input, Output, Rtc};

pub const AUDIO_SLOTS: usize = 6;
pub const VIDEO_SLOTS: usize = 16;
pub const MAX_CLIENTS: usize = 100;
/// Someone counts as talking for this long after their voice was last heard.
const TALK_HOLD: Duration = Duration::from_millis(2500);
/// At most one keyframe request per picture (and size) this often.
const KEYFRAME_EVERY: Duration = Duration::from_millis(400);
/// Who is in which slot is worked out again this often.
const REASSIGN_EVERY: Duration = Duration::from_millis(150);
/// A voice this loud (dBov) or louder is talking.
const TALK_DBOV: i32 = -50;

enum Msg {
    Packet { data: Vec<u8>, source: SocketAddr, destination: SocketAddr },
    Join { id: String, offer: String, reply: mpsc::Sender<Result<String, String>> },
    Leave { id: String },
    Stats { reply: mpsc::Sender<serde_json::Value> },
    Alive { id: String, reply: mpsc::Sender<bool> },
}

#[derive(Debug, Clone)]
struct Slot {
    mid: Mid,
    /// Whose sound / picture is in it.
    source: Option<String>,
    /// Picture: which size (simulcast layer).
    rid: Option<Rid>,
    /// Picture: the source's keyframe has gone through (the tile may show it).
    ready: bool,
    /// The next write starts a new source: continue the slot's timestamps.
    fresh: bool,
    offset: i64,
    last_out: Option<u64>,
}
impl Slot {
    fn new(mid: Mid) -> Self {
        Slot { mid, source: None, rid: None, ready: false, fresh: true, offset: 0, last_out: None }
    }
    fn set(&mut self, source: Option<String>, rid: Option<Rid>) {
        if self.source != source || self.rid != rid {
            self.source = source;
            self.rid = rid;
            self.ready = false;
            self.fresh = true;
        }
    }
}

struct Client {
    id: String,
    rtc: Rtc,
    cid: Option<ChannelId>,
    /// What they send.
    mic: Option<Mid>,
    cam: Option<Mid>,
    /// Their camera comes in sizes (simulcast).
    simulcast: bool,
    /// What they receive.
    a: Vec<Slot>,
    v: Vec<Slot>,
    /// Who they show (in order), and who large.
    want: Vec<String>,
    big: Option<String>,
    /// Loudness (dBov, smoothed) and when their voice was last heard.
    level: f32,
    talked: Option<Instant>,
    keyframe_asked: HashMap<Option<Rid>, Instant>,
    /// Their slot list changed: tell them.
    dirty: bool,
    joined: Instant,
}

impl Client {
    fn send_json(&mut self, v: serde_json::Value) {
        if let Some(mut ch) = self.cid.and_then(|c| self.rtc.channel(c)) {
            let _ = ch.write(false, v.to_string().as_bytes());
        }
    }
    fn slots_json(&self) -> serde_json::Value {
        json!({
            "t": "slots",
            "a": self.a.iter().map(|s| json!({ "mid": s.mid.to_string(), "id": s.source })).collect::<Vec<_>>(),
            "v": self.v.iter().map(|s| json!({ "mid": s.mid.to_string(), "id": s.source, "ready": s.ready })).collect::<Vec<_>>(),
        })
    }
    fn talking(&self, now: Instant) -> bool {
        self.talked.is_some_and(|t| now.duration_since(t) < TALK_HOLD)
    }
    /// Forwards one frame from `source` into the slots that carry it.
    fn forward(&mut self, source: &str, audio: bool, d: &MediaData, keyframes: &mut Vec<(String, Option<Rid>)>) {
        let slots = if audio { &mut self.a } else { &mut self.v };
        for slot in slots.iter_mut() {
            if slot.source.as_deref() != Some(source) {
                continue;
            }
            if !audio {
                // Only the size this slot wants (a camera without sizes: everything).
                if d.rid.is_some() && slot.rid.is_some() && d.rid != slot.rid {
                    continue;
                }
                if !slot.ready {
                    if !d.is_keyframe() {
                        keyframes.push((source.to_string(), slot.rid));
                        continue;
                    }
                    slot.ready = true;
                    self.dirty = true;
                }
            }
            let numer = d.time.numer();
            if slot.fresh {
                let step = if audio { d.time.denom() as i64 / 50 } else { d.time.denom() as i64 / 30 };
                slot.offset = match slot.last_out {
                    Some(last) => last as i64 + step - numer as i64,
                    None => 0,
                };
                slot.fresh = false;
            }
            let out = (numer as i64 + slot.offset).max(0) as u64;
            slot.last_out = Some(out);
            let Some(w) = self.rtc.writer(slot.mid) else { continue };
            let Some(pt) = w.match_params(d.params) else { continue };
            if let Err(e) = w.write(pt, d.network_time, MediaTime::new(out, d.time.frequency()), d.data.clone()) {
                eprintln!("[Relay] write to {} failed: {e:?}", self.id);
            }
        }
    }
}

struct Relay {
    sockets: Vec<UdpSocket>,
    /// Each socket's address (looked up once, not per packet).
    addrs: Vec<SocketAddr>,
    clients: Vec<Client>,
    speaker: Option<String>,
    next_assign: Instant,
}

impl Relay {
    fn find(&self, id: &str) -> Option<usize> {
        self.clients.iter().position(|c| c.id == id)
    }

    fn join(&mut self, id: String, offer: &str) -> Result<String, String> {
        if let Some(i) = self.find(&id) {
            self.clients[i].rtc.disconnect();
            self.remove(i);
        }
        if self.clients.len() >= MAX_CLIENTS {
            return Err(format!("The meeting is full ({MAX_CLIENTS} people)."));
        }
        let offer = SdpOffer::from_sdp_string(offer).map_err(|e| format!("Bad offer: {e:?}"))?;
        // One codec for sound and one for pictures, so any PC can receive anyone.
        let mut rtc = Rtc::builder().set_ice_lite(true).clear_codecs().enable_opus(true, false).enable_vp8(true).build(Instant::now());
        for addr in &self.addrs {
            if let Ok(c) = Candidate::host(*addr, "udp") {
                rtc.add_local_candidate(c);
            }
        }
        let answer = rtc.sdp_api().accept_offer(offer).map_err(|e| format!("The offer wasn't accepted: {e:?}"))?;
        self.clients.push(Client {
            id,
            rtc,
            cid: None,
            mic: None,
            cam: None,
            simulcast: false,
            a: Vec::new(),
            v: Vec::new(),
            want: Vec::new(),
            big: None,
            level: -127.0,
            talked: None,
            keyframe_asked: HashMap::new(),
            dirty: true,
            joined: Instant::now(),
        });
        self.next_assign = Instant::now();
        Ok(trim_answer(&answer.to_sdp_string()))
    }

    fn remove(&mut self, i: usize) {
        let gone = self.clients.remove(i).id;
        for c in &mut self.clients {
            for s in c.a.iter_mut().chain(c.v.iter_mut()) {
                if s.source.as_deref() == Some(gone.as_str()) {
                    s.set(None, None);
                    c.dirty = true;
                }
            }
        }
        self.next_assign = Instant::now();
    }

    fn transmit(&self, t: &str0m::net::Transmit) {
        let k = self.addrs.iter().position(|a| *a == t.source).unwrap_or(0);
        if let Some(s) = self.sockets.get(k) {
            let _ = s.send_to(&t.contents, t.destination);
        }
    }

    /// Polls one connection (`only`, after a packet of its own) or every one,
    /// until there is nothing more to do; returns the next deadline. (What one
    /// connection's packet makes the others send goes out at the end of the batch.)
    fn poll(&mut self, only: Option<usize>) -> Instant {
        let mut deadline = Instant::now() + Duration::from_millis(50);
        loop {
            let mut events: Vec<(usize, Event)> = Vec::new();
            let mut transmits = Vec::new();
            for (i, c) in self.clients.iter_mut().enumerate() {
                if only.is_some_and(|o| o != i) || !c.rtc.is_alive() {
                    continue;
                }
                loop {
                    match c.rtc.poll_output() {
                        Ok(Output::Timeout(t)) => {
                            deadline = deadline.min(t);
                            break;
                        }
                        Ok(Output::Transmit(t)) => transmits.push(t),
                        Ok(Output::Event(e)) => events.push((i, e)),
                        Err(e) => {
                            eprintln!("[Relay] {} stopped: {e:?}", c.id);
                            c.rtc.disconnect();
                            break;
                        }
                    }
                }
            }
            for t in &transmits {
                self.transmit(t);
            }
            if events.is_empty() {
                return deadline;
            }
            for (i, e) in events {
                self.event(i, e);
            }
        }
    }

    fn event(&mut self, i: usize, e: Event) {
        match e {
            Event::IceConnectionStateChange(IceConnectionState::Disconnected) => self.clients[i].rtc.disconnect(),
            Event::MediaAdded(m) => {
                let c = &mut self.clients[i];
                match (m.direction, m.kind) {
                    (Direction::RecvOnly, MediaKind::Audio) => c.mic = Some(m.mid),
                    (Direction::RecvOnly, MediaKind::Video) => {
                        c.cam = Some(m.mid);
                        c.simulcast = m.simulcast.is_some();
                    }
                    (Direction::SendOnly, MediaKind::Audio) => c.a.push(Slot::new(m.mid)),
                    (Direction::SendOnly, MediaKind::Video) => c.v.push(Slot::new(m.mid)),
                    _ => {}
                }
                c.dirty = true;
            }
            Event::ChannelOpen(cid, _) => {
                let c = &mut self.clients[i];
                c.cid = Some(cid);
                c.dirty = true;
            }
            Event::ChannelData(d) => {
                let Ok(v) = serde_json::from_slice::<serde_json::Value>(&d.data) else { return };
                if v["t"] == "want" {
                    let c = &mut self.clients[i];
                    c.want = v["ids"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).take(64).collect()).unwrap_or_default();
                    c.big = v["big"].as_str().map(String::from);
                    self.next_assign = Instant::now();
                }
            }
            Event::MediaData(d) => {
                let (source, audio) = {
                    let c = &mut self.clients[i];
                    let audio = Some(d.mid) == c.mic;
                    if !audio && Some(d.mid) != c.cam {
                        return;
                    }
                    if audio {
                        if let Some(l) = d.ext_vals.audio_level {
                            let db = -(l as i32).abs();
                            c.level = c.level * 0.8 + db as f32 * 0.2;
                            if db >= TALK_DBOV || d.ext_vals.voice_activity == Some(true) {
                                c.talked = Some(Instant::now());
                            }
                        }
                    } else if !d.contiguous {
                        // Packets went missing: ask for a fresh picture.
                        ask_keyframe(c, d.rid);
                    }
                    (c.id.clone(), audio)
                };
                let mut keyframes = Vec::new();
                for (j, c) in self.clients.iter_mut().enumerate() {
                    if j != i {
                        c.forward(&source, audio, &d, &mut keyframes);
                    }
                }
                for (who, rid) in keyframes {
                    if let Some(k) = self.find(&who) {
                        ask_keyframe(&mut self.clients[k], rid);
                    }
                }
            }
            Event::KeyframeRequest(req) => {
                // A PC wants a fresh picture in one of its slots: ask whoever is in it.
                let Some((who, rid)) = self.clients[i].v.iter().find(|s| s.mid == req.mid).and_then(|s| s.source.clone().map(|w| (w, s.rid))) else { return };
                if let Some(k) = self.find(&who) {
                    ask_keyframe(&mut self.clients[k], rid);
                }
            }
            _ => {}
        }
    }

    /// Who is in which slot: the loudest voices, and the people each PC shows.
    fn assign(&mut self) {
        let now = Instant::now();
        // The voices: talking now, the loudest first.
        let mut voices: Vec<(String, f32)> = self.clients.iter().filter(|c| c.mic.is_some() && c.talking(now)).map(|c| (c.id.clone(), c.level)).collect();
        voices.sort_by(|a, b| b.1.total_cmp(&a.1));
        let voices: Vec<String> = voices.into_iter().map(|v| v.0).take(AUDIO_SLOTS + 1).collect();
        let speaker = voices.first().cloned().or_else(|| self.speaker.clone().filter(|s| self.find(s).is_some()));
        let has_cam: Vec<String> = self.clients.iter().filter(|c| c.cam.is_some()).map(|c| c.id.clone()).collect();
        let simulcast: HashMap<String, bool> = self.clients.iter().map(|c| (c.id.clone(), c.simulcast)).collect();
        for c in &mut self.clients {
            let me = c.id.clone();
            let want_a: Vec<(String, Option<Rid>)> = voices.iter().filter(|v| **v != me).take(AUDIO_SLOTS).map(|v| (v.clone(), None)).collect();
            if fill(&mut c.a, &want_a) {
                c.dirty = true;
            }
            let mut want_v: Vec<String> = c.want.iter().filter(|w| **w != me && has_cam.contains(w)).cloned().collect();
            want_v.dedup();
            let want_v: Vec<(String, Option<Rid>)> = want_v
                .into_iter()
                .take(VIDEO_SLOTS)
                .map(|w| {
                    let rid = simulcast.get(&w).copied().unwrap_or(false).then(|| if c.big.as_deref() == Some(w.as_str()) { Rid::from("h") } else { Rid::from("q") });
                    (w, rid)
                })
                .collect();
            if fill(&mut c.v, &want_v) {
                c.dirty = true;
            }
        }
        if speaker != self.speaker {
            self.speaker = speaker.clone();
            for c in &mut self.clients {
                c.send_json(json!({ "t": "speaker", "id": speaker }));
            }
        }
        for c in &mut self.clients {
            if c.dirty && c.cid.is_some() {
                c.dirty = false;
                let msg = c.slots_json();
                c.send_json(msg);
            }
        }
    }

    fn stats(&self) -> serde_json::Value {
        json!({
            "clients": self.clients.iter().map(|c| json!({
                "id": c.id,
                "alive": c.rtc.is_alive(),
                "secs": c.joined.elapsed().as_secs(),
                "mic": c.mic.is_some(),
                "cam": c.cam.is_some(),
                "simulcast": c.simulcast,
                "talking": c.talking(Instant::now()),
                "audio": c.a.iter().filter_map(|s| s.source.clone()).collect::<Vec<_>>(),
                "video": c.v.iter().filter(|s| s.source.is_some()).map(|s| json!({ "id": s.source, "ready": s.ready, "rid": s.rid.map(|r| r.to_string()) })).collect::<Vec<_>>(),
            })).collect::<Vec<_>>(),
            "speaker": self.speaker,
        })
    }
}

/// The answer goes back over the network (to a guest, through the organizer's
/// messages): every channel shares the first one's connection (BUNDLE), so the
/// relay's addresses are listed once, not in each of the 25 channels.
fn trim_answer(sdp: &str) -> String {
    let mut out = String::with_capacity(sdp.len());
    let mut media = 0;
    for line in sdp.lines() {
        if line.starts_with("m=") {
            media += 1;
        }
        if media > 1 && (line.starts_with("a=candidate:") || line == "a=end-of-candidates") {
            continue;
        }
        out.push_str(line);
        out.push_str("\r\n");
    }
    out
}

/// Puts the wanted sources into the slots, keeping whoever is already placed.
/// Returns true when something changed.
fn fill(slots: &mut [Slot], want: &[(String, Option<Rid>)]) -> bool {
    let mut changed = false;
    // Those no longer wanted leave their slot.
    for s in slots.iter_mut() {
        if let Some(src) = &s.source {
            match want.iter().find(|(w, _)| w == src) {
                None => {
                    s.set(None, None);
                    changed = true;
                }
                Some((_, rid)) if *rid != s.rid => {
                    let src = s.source.clone();
                    s.set(src, *rid);
                    changed = true;
                }
                _ => {}
            }
        }
    }
    // Newcomers go into free slots.
    for (w, rid) in want {
        if slots.iter().any(|s| s.source.as_deref() == Some(w.as_str())) {
            continue;
        }
        if let Some(s) = slots.iter_mut().find(|s| s.source.is_none()) {
            s.set(Some(w.clone()), *rid);
            changed = true;
        }
    }
    changed
}

fn ask_keyframe(c: &mut Client, rid: Option<Rid>) {
    let Some(cam) = c.cam else { return };
    let now = Instant::now();
    if c.keyframe_asked.get(&rid).is_some_and(|t| now.duration_since(*t) < KEYFRAME_EVERY) {
        return;
    }
    c.keyframe_asked.insert(rid, now);
    if let Some(mut w) = c.rtc.writer(cam) {
        let rid = if c.simulcast { rid } else { None };
        let _ = w.request_keyframe(rid, KeyframeRequestKind::Pli);
    }
}

fn run(mut relay: Relay, rx: mpsc::Receiver<Msg>, running: Arc<AtomicBool>) {
    let mut deadline = Instant::now();
    while running.load(Ordering::SeqCst) {
        let now = Instant::now();
        if now >= deadline {
            for c in &mut relay.clients {
                if c.rtc.is_alive() {
                    let _ = c.rtc.handle_input(Input::Timeout(now));
                }
            }
        }
        // Someone's connection ended: free their slots everywhere.
        while let Some(i) = relay.clients.iter().position(|c| !c.rtc.is_alive()) {
            relay.remove(i);
        }
        deadline = relay.poll(None);
        if now >= relay.next_assign {
            relay.assign();
            relay.next_assign = now + REASSIGN_EVERY;
            deadline = deadline.min(relay.poll(None));
        }
        let wait = deadline.min(relay.next_assign).saturating_duration_since(Instant::now());
        let mut msg = match rx.recv_timeout(wait) {
            Ok(m) => Some(m),
            Err(mpsc::RecvTimeoutError::Timeout) => None,
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
        };
        // Everything that has come in (up to a batch), then the others are polled once.
        let mut n = 0;
        while let Some(m) = msg.take() {
            match m {
                Msg::Packet { data, source, destination } => {
                    let Ok(contents) = data.as_slice().try_into() else { continue };
                    let input = Input::Receive(Instant::now(), Receive { proto: Protocol::Udp, source, destination, contents });
                    if let Some(i) = relay.clients.iter().position(|c| c.rtc.is_alive() && c.rtc.accepts(&input)) {
                        if let Err(e) = relay.clients[i].rtc.handle_input(input) {
                            eprintln!("[Relay] {} input failed: {e:?}", relay.clients[i].id);
                            relay.clients[i].rtc.disconnect();
                        } else {
                            deadline = deadline.min(relay.poll(Some(i)));
                        }
                    }
                }
                Msg::Join { id, offer, reply } => {
                    let _ = reply.send(relay.join(id, &offer));
                }
                Msg::Leave { id } => {
                    if let Some(i) = relay.find(&id) {
                        relay.clients[i].rtc.disconnect();
                        relay.remove(i);
                    }
                }
                Msg::Stats { reply } => {
                    let _ = reply.send(relay.stats());
                }
                Msg::Alive { id, reply } => {
                    let _ = reply.send(relay.clients.iter().any(|c| c.id == id && c.rtc.is_alive()));
                }
            }
            n += 1;
            if n < 256 {
                msg = rx.try_recv().ok();
            }
        }
    }
}

// ------------------------------------------------------------------ the one relay of this PC

struct Running {
    meeting_id: String,
    tx: mpsc::Sender<Msg>,
    running: Arc<AtomicBool>,
}
static RELAY: Mutex<Option<Running>> = Mutex::new(None);
static CRYPTO: Once = Once::new();

/// The addresses colleagues can reach this PC on (the test copies: loopback, so
/// no firewall question pops up; their windows are told they may use it).
fn relay_addresses() -> Vec<IpAddr> {
    let bind = crate::testmode::bind_addr();
    if !bind.is_unspecified() {
        return vec![IpAddr::V4(bind)];
    }
    let mut v: Vec<IpAddr> = crate::discovery::local_ipv4_addresses().iter().filter_map(|s| s.parse().ok()).collect();
    if v.is_empty() {
        v.push(IpAddr::V4(std::net::Ipv4Addr::LOCALHOST));
    }
    v
}

/// Starts this PC's relay for a big meeting (once).
pub fn start(meeting_id: &str) -> Result<(), String> {
    let mut cur = RELAY.lock();
    if let Some(r) = cur.as_ref() {
        if r.meeting_id == meeting_id {
            return Ok(());
        }
        r.running.store(false, Ordering::SeqCst);
    }
    CRYPTO.call_once(|| str0m::crypto::from_feature_flags().install_process_default());
    let mut sockets = Vec::new();
    for ip in relay_addresses() {
        if let Ok(s) = UdpSocket::bind(SocketAddr::new(ip, 0)) {
            sockets.push(s);
        }
    }
    if sockets.is_empty() {
        return Err("The meeting relay couldn't open a network port.".to_string());
    }
    let (tx, rx) = mpsc::channel();
    let running = Arc::new(AtomicBool::new(true));
    for s in &sockets {
        let s = s.try_clone().map_err(|e| e.to_string())?;
        let tx = tx.clone();
        let running = running.clone();
        let destination = s.local_addr().map_err(|e| e.to_string())?;
        let _ = s.set_read_timeout(Some(Duration::from_millis(500)));
        thread::Builder::new()
            .name("lanx-relay-in".into())
            .spawn(move || {
                let mut buf = vec![0u8; 2048];
                while running.load(Ordering::SeqCst) {
                    match s.recv_from(&mut buf) {
                        Ok((n, source)) => {
                            if tx.send(Msg::Packet { data: buf[..n].to_vec(), source, destination }).is_err() {
                                return;
                            }
                        }
                        Err(e) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {}
                        // (Windows reports an ICMP "port unreachable" from a PC that left as an error here.)
                        Err(_) => thread::sleep(Duration::from_millis(5)),
                    }
                }
            })
            .map_err(|e| e.to_string())?;
    }
    let addrs = sockets.iter().filter_map(|s| s.local_addr().ok()).collect();
    let relay = Relay { sockets, addrs, clients: Vec::new(), speaker: None, next_assign: Instant::now() };
    let r2 = running.clone();
    thread::Builder::new().name("lanx-relay".into()).spawn(move || run(relay, rx, r2)).map_err(|e| e.to_string())?;
    *cur = Some(Running { meeting_id: meeting_id.to_string(), tx, running });
    Ok(())
}

fn sender(meeting_id: &str) -> Result<mpsc::Sender<Msg>, String> {
    RELAY.lock().as_ref().filter(|r| r.meeting_id == meeting_id).map(|r| r.tx.clone()).ok_or_else(|| "This PC isn't running that meeting.".to_string())
}

/// Someone's offer (their one connection to the relay) → the relay's answer.
pub fn join(meeting_id: &str, id: &str, offer: &str) -> Result<String, String> {
    let tx = sender(meeting_id)?;
    let (rtx, rrx) = mpsc::channel();
    tx.send(Msg::Join { id: id.to_string(), offer: offer.to_string(), reply: rtx }).map_err(|_| "The meeting relay stopped.".to_string())?;
    rrx.recv_timeout(Duration::from_secs(5)).map_err(|_| "The meeting relay didn't answer.".to_string())?
}

/// Someone left: their connection closes and their slots go to others.
pub fn leave(meeting_id: &str, id: &str) {
    if let Ok(tx) = sender(meeting_id) {
        let _ = tx.send(Msg::Leave { id: id.to_string() });
    }
}

/// The meeting ended (on this PC): the relay stops.
pub fn stop(meeting_id: &str) {
    let mut cur = RELAY.lock();
    if cur.as_ref().is_some_and(|r| r.meeting_id == meeting_id) {
        if let Some(r) = cur.take() {
            r.running.store(false, Ordering::SeqCst);
        }
    }
}

/// For support and tests: who is connected, who is in whose slots.
/// Whether `id`'s picture-and-sound connection to this PC's relay is up (a
/// better sign they are still in the meeting than their network beacons, which
/// Wi-Fi can drop for a while).
pub fn alive(meeting_id: &str, id: &str) -> bool {
    let Ok(tx) = sender(meeting_id) else { return false };
    let (reply, rx) = mpsc::channel();
    if tx.send(Msg::Alive { id: id.to_string(), reply }).is_err() {
        return false;
    }
    rx.recv_timeout(Duration::from_secs(2)).unwrap_or(false)
}

pub fn stats() -> serde_json::Value {
    let Some(tx) = RELAY.lock().as_ref().map(|r| r.tx.clone()) else { return json!(null) };
    let (rtx, rrx) = mpsc::channel();
    if tx.send(Msg::Stats { reply: rtx }).is_err() {
        return json!(null);
    }
    rrx.recv_timeout(Duration::from_secs(2)).unwrap_or(json!(null))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn slots(n: usize) -> Vec<Slot> {
        (0..n).map(|i| Slot::new(Mid::from(i.to_string().as_str()))).collect()
    }

    #[test]
    fn slots_keep_who_is_placed_and_fill_free_ones() {
        let mut s = slots(3);
        assert!(fill(&mut s, &[("a".into(), None), ("b".into(), None)]));
        assert_eq!(s.iter().map(|x| x.source.clone()).collect::<Vec<_>>(), vec![Some("a".into()), Some("b".into()), None]);
        // b stays where it was; a leaves; c and d come — only one free slot more.
        assert!(fill(&mut s, &[("b".into(), None), ("c".into(), None), ("d".into(), None)]));
        assert_eq!(s[1].source.as_deref(), Some("b"));
        assert!(s.iter().any(|x| x.source.as_deref() == Some("c")));
        assert!(s.iter().any(|x| x.source.as_deref() == Some("d")));
        // Nothing new: nothing changes.
        assert!(!fill(&mut s, &[("b".into(), None), ("c".into(), None), ("d".into(), None)]));
        // A new size for b: its slot waits for a keyframe again.
        s[1].ready = true;
        assert!(fill(&mut s, &[("b".into(), Some(Rid::from("h"))), ("c".into(), None), ("d".into(), None)]));
        assert!(!s[1].ready && s[1].fresh);
    }
}
