//! LANX 3.13.0: LANX's own call engine, for PCs whose web engine has no
//! video-calling part (Linux Mint / Ubuntu: WebKitGTK is built without
//! RTCPeerConnection). The page still does what it can — the camera and the
//! microphone, squeezing pictures and sound small (WebCodecs) and showing what
//! comes in — and this engine does the rest, speaking the same WebRTC as the
//! Windows PCs and the phones: the connection (ICE), the encryption (DTLS-SRTP),
//! the packets (RTP) and the data channels (SCTP). The page sees an ordinary
//! `RTCPeerConnection` (src/lib/ownrtc), so calls, meetings, big meetings, live
//! games and the phone camera all work the same way as on Windows.
//!
//! One engine thread serves every connection of this PC on shared UDP ports
//! (one per network address); what comes in for the page is batched per
//! connection and sent through a Tauri channel:
//! - control messages as a JSON array (`{ "t": "connected" }`, …);
//! - pictures, sound and data-channel messages as binary records:
//!   media   `1, mid_len, mid…, codec, flags(1 key, 2 contiguous), rtp: u64 LE, len: u32 LE, data…`
//!   channel `2, cid: u32 LE, binary, len: u32 LE, data…`

use std::collections::HashMap;
use std::net::{SocketAddr, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, mpsc};
use std::thread;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use str0m::change::{SdpAnswer, SdpOffer, SdpPendingOffer};
use str0m::channel::{ChannelConfig, ChannelId, Reliability};
use str0m::format::Codec;
use str0m::media::{Direction, Frequency, KeyframeRequestKind, MediaKind, MediaTime, Mid, Pt};
use str0m::net::{Protocol, Receive};
use str0m::{Candidate, Event, IceConnectionState, Input, Output, Rtc};
use tauri::ipc::{Channel, InvokeResponseBody};

/// At most one picture request (to the sender) per picture this often.
const KEYFRAME_EVERY: Duration = Duration::from_millis(400);
/// What the page gets in one message at most (then the next one starts).
const BATCH_MAX: usize = 512 * 1024;

#[derive(Debug, Clone, Deserialize)]
pub struct MediaSpec {
    pub kind: String,
    pub dir: String,
    #[serde(default)]
    pub stream: Option<String>,
    #[serde(default)]
    pub track: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ChannelSpec {
    pub label: String,
    #[serde(default = "yes")]
    pub ordered: bool,
    #[serde(default)]
    pub max_retransmits: Option<u16>,
    #[serde(default)]
    pub max_life: Option<u16>,
    #[serde(default)]
    pub protocol: Option<String>,
}
fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct MediaInfo {
    pub mid: String,
    pub kind: String,
    /// From this PC's side: what it sends / receives.
    pub dir: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct OfferOut {
    pub sdp: String,
    /// The mid of each requested media, in order.
    pub mids: Vec<String>,
    /// The page's number for each requested data channel, in order.
    pub cids: Vec<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AnswerOut {
    pub sdp: String,
    pub media: Vec<MediaInfo>,
}

type Reply<T> = mpsc::Sender<Result<T, String>>;

enum Msg {
    Packet { data: Vec<u8>, source: SocketAddr, destination: SocketAddr },
    Open { events: Channel<InvokeResponseBody>, reply: Reply<u32> },
    Offer { id: u32, media: Vec<MediaSpec>, channels: Vec<ChannelSpec>, reply: Reply<OfferOut> },
    AcceptAnswer { id: u32, sdp: String, reply: Reply<Vec<MediaInfo>> },
    AcceptOffer { id: u32, sdp: String, reply: Reply<AnswerOut> },
    Write { audio: bool, rtp: u64, targets: Vec<(u32, String)>, data: Vec<u8> },
    Send { id: u32, cid: u32, binary: bool, data: Vec<u8> },
    NewChannel { id: u32, spec: ChannelSpec, reply: Reply<u32> },
    CloseChannel { id: u32, cid: u32 },
    Keyframe { id: u32, mid: String },
    Stats { id: u32, reply: Reply<Value> },
    Close { id: u32 },
}

struct Conn {
    id: u32,
    rtc: Rtc,
    events: Channel<InvokeResponseBody>,
    pending: Option<SdpPendingOffer>,
    last_local: Option<String>,
    /// The page's channel numbers ↔ the engine's.
    channels: Vec<ChannelId>,
    /// The payload type this PC sends with, per media (looked up once).
    send_pt: HashMap<Mid, Pt>,
    keyframe_asked: HashMap<Mid, Instant>,
    /// What waits to go to the page: binary records, and control messages.
    out: Vec<u8>,
    ctrl: Vec<Value>,
    told_closed: bool,
    // The latest numbers, for getStats().
    peer: Value,
    egress: HashMap<String, Value>,
    ingress: HashMap<String, Value>,
}

impl Conn {
    fn cid_of(&mut self, c: ChannelId) -> u32 {
        if let Some(i) = self.channels.iter().position(|x| *x == c) {
            return i as u32;
        }
        self.channels.push(c);
        (self.channels.len() - 1) as u32
    }
    fn channel(&self, cid: u32) -> Option<ChannelId> {
        self.channels.get(cid as usize).copied()
    }
    fn pt_for(&mut self, mid: Mid, audio: bool) -> Option<Pt> {
        if let Some(pt) = self.send_pt.get(&mid) {
            return Some(*pt);
        }
        let w = self.rtc.writer(mid)?;
        let want = if audio { Codec::Opus } else { Codec::Vp8 };
        let pt = w.payload_params().find(|p| p.spec().codec == want).map(|p| p.pt())?;
        self.send_pt.insert(mid, pt);
        Some(pt)
    }
    fn ask_keyframe(&mut self, mid: Mid) {
        let now = Instant::now();
        if self.keyframe_asked.get(&mid).is_some_and(|t| now.duration_since(*t) < KEYFRAME_EVERY) {
            return;
        }
        self.keyframe_asked.insert(mid, now);
        if let Some(mut w) = self.rtc.writer(mid) {
            let _ = w.request_keyframe(None, KeyframeRequestKind::Pli);
        }
    }
    /// Sends what waits to the page.
    fn flush(&mut self) {
        if !self.ctrl.is_empty() {
            let msg = Value::Array(std::mem::take(&mut self.ctrl)).to_string();
            let _ = self.events.send(InvokeResponseBody::Json(msg));
        }
        if !self.out.is_empty() {
            let _ = self.events.send(InvokeResponseBody::Raw(std::mem::take(&mut self.out)));
        }
    }
    fn push_record(&mut self, rec: &[u8]) {
        if self.out.len() + rec.len() > BATCH_MAX {
            let _ = self.events.send(InvokeResponseBody::Raw(std::mem::take(&mut self.out)));
        }
        self.out.extend_from_slice(rec);
    }
}

fn kind_of(s: &str) -> Result<MediaKind, String> {
    match s {
        "audio" => Ok(MediaKind::Audio),
        "video" => Ok(MediaKind::Video),
        other => Err(format!("unknown media kind {other}")),
    }
}
fn dir_of(s: &str) -> Direction {
    match s {
        "sendonly" => Direction::SendOnly,
        "recvonly" => Direction::RecvOnly,
        "inactive" => Direction::Inactive,
        _ => Direction::SendRecv,
    }
}
fn dir_name(d: Direction) -> &'static str {
    match d {
        Direction::SendOnly => "sendonly",
        Direction::RecvOnly => "recvonly",
        Direction::Inactive => "inactive",
        Direction::SendRecv => "sendrecv",
    }
}
fn codec_code(c: Codec) -> u8 {
    match c {
        Codec::Opus => 1,
        Codec::Vp8 => 2,
        Codec::Vp9 => 3,
        Codec::H264 => 4,
        _ => 0,
    }
}
fn channel_config(spec: &ChannelSpec) -> ChannelConfig {
    let reliability = match (spec.max_retransmits, spec.max_life) {
        (Some(n), _) => Reliability::MaxRetransmits { retransmits: n },
        (None, Some(ms)) => Reliability::MaxPacketLifetime { lifetime: ms },
        _ => Reliability::Reliable,
    };
    ChannelConfig { label: spec.label.clone(), ordered: spec.ordered, reliability, negotiated: None, protocol: spec.protocol.clone().unwrap_or_default() }
}

/// The audio and video sections of a session description, in order: (mid, kind).
pub fn sections(sdp: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut kind: Option<String> = None;
    for line in sdp.lines() {
        let line = line.trim_end();
        if let Some(rest) = line.strip_prefix("m=") {
            kind = rest.split(' ').next().map(String::from);
        } else if let Some(mid) = line.strip_prefix("a=mid:") {
            if let Some(k) = kind.as_deref().filter(|k| *k == "audio" || *k == "video") {
                out.push((mid.to_string(), k.to_string()));
            }
        }
    }
    out
}

fn media_infos(rtc: &Rtc, sdp: &str) -> Vec<MediaInfo> {
    sections(sdp)
        .into_iter()
        .map(|(mid, kind)| {
            let dir = rtc.media(Mid::from(mid.as_str())).map(|m| dir_name(m.direction())).unwrap_or("inactive");
            MediaInfo { mid, kind, dir: dir.to_string() }
        })
        .collect()
}

/// One media record for the page (see the top of this file).
fn media_record(mid: &str, codec: u8, key: bool, contiguous: bool, rtp: u64, data: &[u8]) -> Vec<u8> {
    let mut r = Vec::with_capacity(data.len() + mid.len() + 16);
    r.push(1);
    r.push(mid.len().min(255) as u8);
    r.extend_from_slice(&mid.as_bytes()[..mid.len().min(255)]);
    r.push(codec);
    r.push(u8::from(key) | (u8::from(contiguous) << 1));
    r.extend_from_slice(&rtp.to_le_bytes());
    r.extend_from_slice(&(data.len() as u32).to_le_bytes());
    r.extend_from_slice(data);
    r
}
fn channel_record(cid: u32, binary: bool, data: &[u8]) -> Vec<u8> {
    let mut r = Vec::with_capacity(data.len() + 10);
    r.push(2);
    r.extend_from_slice(&cid.to_le_bytes());
    r.push(u8::from(binary));
    r.extend_from_slice(&(data.len() as u32).to_le_bytes());
    r.extend_from_slice(data);
    r
}

fn ms(d: Option<Duration>) -> Value {
    d.map(|d| json!(d.as_secs_f64() * 1000.0)).unwrap_or(Value::Null)
}

struct Engine {
    sockets: Vec<UdpSocket>,
    addrs: Vec<SocketAddr>,
    conns: Vec<Conn>,
}

impl Engine {
    fn find(&mut self, id: u32) -> Option<&mut Conn> {
        self.conns.iter_mut().find(|c| c.id == id)
    }
    fn index(&self, id: u32) -> Option<usize> {
        self.conns.iter().position(|c| c.id == id)
    }

    fn open(&mut self, id: u32, events: Channel<InvokeResponseBody>) {
        // Full ICE (a Linux PC may call another Linux PC); one codec for sound and
        // one for pictures that every web engine can send and show.
        let mut rtc = Rtc::builder()
            .clear_codecs()
            .enable_opus(true, false)
            .enable_vp8(true)
            .set_stats_interval(Some(Duration::from_secs(1)))
            .build(Instant::now());
        for addr in &self.addrs {
            if let Ok(c) = Candidate::host(*addr, "udp") {
                rtc.add_local_candidate(c);
            }
        }
        self.conns.push(Conn {
            id,
            rtc,
            events,
            pending: None,
            last_local: None,
            channels: Vec::new(),
            send_pt: HashMap::new(),
            keyframe_asked: HashMap::new(),
            out: Vec::new(),
            ctrl: Vec::new(),
            told_closed: false,
            peer: json!({}),
            egress: HashMap::new(),
            ingress: HashMap::new(),
        });
    }

    fn offer(&mut self, id: u32, media: Vec<MediaSpec>, channels: Vec<ChannelSpec>) -> Result<OfferOut, String> {
        let c = self.find(id).ok_or("That connection is closed.")?;
        let mut api = c.rtc.sdp_api();
        let mut mids = Vec::new();
        for m in &media {
            mids.push(api.add_media(kind_of(&m.kind)?, dir_of(&m.dir), m.stream.clone(), m.track.clone(), None).to_string());
        }
        let new_channels: Vec<ChannelId> = channels.iter().map(|ch| api.add_channel_with_config(channel_config(ch))).collect();
        let applied = api.apply();
        let cids = new_channels.into_iter().map(|x| c.cid_of(x)).collect();
        let sdp = match applied {
            Some((offer, pending)) => {
                c.pending = Some(pending);
                let s = offer.to_sdp_string();
                c.last_local = Some(s.clone());
                s
            }
            // Nothing new to agree on: the description stays as it was.
            None => c.last_local.clone().ok_or("There is nothing to offer yet.")?,
        };
        Ok(OfferOut { sdp, mids, cids })
    }

    fn accept_answer(&mut self, id: u32, sdp: &str) -> Result<Vec<MediaInfo>, String> {
        let c = self.find(id).ok_or("That connection is closed.")?;
        let pending = c.pending.take().ok_or("No offer is waiting for an answer.")?;
        let answer = SdpAnswer::from_sdp_string(sdp).map_err(|e| format!("Bad answer: {e:?}"))?;
        c.rtc.sdp_api().accept_answer(pending, answer).map_err(|e| format!("The answer wasn't accepted: {e:?}"))?;
        c.send_pt.clear();
        let local = c.last_local.clone().unwrap_or_default();
        Ok(media_infos(&c.rtc, &local))
    }

    fn accept_offer(&mut self, id: u32, sdp: &str) -> Result<AnswerOut, String> {
        let c = self.find(id).ok_or("That connection is closed.")?;
        let offer = SdpOffer::from_sdp_string(sdp).map_err(|e| format!("Bad offer: {e:?}"))?;
        c.pending = None;
        let answer = c.rtc.sdp_api().accept_offer(offer).map_err(|e| format!("The offer wasn't accepted: {e:?}"))?;
        c.send_pt.clear();
        let s = answer.to_sdp_string();
        c.last_local = Some(s.clone());
        let media = media_infos(&c.rtc, &s);
        Ok(AnswerOut { sdp: s, media })
    }

    fn write(&mut self, audio: bool, rtp: u64, targets: Vec<(u32, String)>, data: Vec<u8>) -> Vec<u32> {
        let data: Arc<[u8]> = data.into();
        let freq = if audio { Frequency::FORTY_EIGHT_KHZ } else { Frequency::NINETY_KHZ };
        let mut touched = Vec::new();
        for (id, mid) in targets {
            let Some(c) = self.find(id) else { continue };
            let mid = Mid::from(mid.as_str());
            let Some(pt) = c.pt_for(mid, audio) else { continue };
            let Some(w) = c.rtc.writer(mid) else { continue };
            if w.write(pt, Instant::now(), MediaTime::new(rtp, freq), data.clone()).is_ok() {
                touched.push(id);
            }
        }
        touched
    }

    fn transmit(&self, t: &str0m::net::Transmit) {
        let k = self.addrs.iter().position(|a| *a == t.source).unwrap_or(0);
        if let Some(s) = self.sockets.get(k) {
            let _ = s.send_to(&t.contents, t.destination);
        }
    }

    /// Polls one connection (or all) until there is nothing more to do; returns
    /// the next deadline.
    fn poll(&mut self, only: Option<u32>) -> Instant {
        let mut deadline = Instant::now() + Duration::from_millis(100);
        let mut transmits = Vec::new();
        for i in 0..self.conns.len() {
            if only.is_some_and(|o| o != self.conns[i].id) || !self.conns[i].rtc.is_alive() {
                continue;
            }
            loop {
                match self.conns[i].rtc.poll_output() {
                    Ok(Output::Timeout(t)) => {
                        deadline = deadline.min(t);
                        break;
                    }
                    Ok(Output::Transmit(t)) => transmits.push(t),
                    Ok(Output::Event(e)) => event(&mut self.conns[i], e),
                    Err(e) => {
                        eprintln!("[OwnRtc] connection {} stopped: {e:?}", self.conns[i].id);
                        self.conns[i].rtc.disconnect();
                        break;
                    }
                }
            }
        }
        for t in &transmits {
            self.transmit(t);
        }
        deadline
    }

    /// Ended connections tell the page once and go.
    fn sweep(&mut self) {
        for c in &mut self.conns {
            if !c.rtc.is_alive() && !c.told_closed {
                c.told_closed = true;
                c.ctrl.push(json!({ "t": "state", "s": "closed" }));
            }
        }
        for c in &mut self.conns {
            c.flush();
        }
        self.conns.retain(|c| c.rtc.is_alive());
    }

    fn stats(&mut self, id: u32) -> Result<Value, String> {
        let c = self.find(id).ok_or("That connection is closed.")?;
        Ok(json!({ "peer": c.peer, "egress": c.egress, "ingress": c.ingress }))
    }
}

/// What one event means for the page.
fn event(c: &mut Conn, e: Event) {
    match e {
        Event::Connected => c.ctrl.push(json!({ "t": "state", "s": "connected" })),
        Event::IceConnectionStateChange(s) => {
            let s = match s {
                IceConnectionState::New => "new",
                IceConnectionState::Checking => "checking",
                IceConnectionState::Connected => "connected",
                IceConnectionState::Completed => "completed",
                IceConnectionState::Disconnected => "disconnected",
            };
            c.ctrl.push(json!({ "t": "ice", "s": s }));
        }
        Event::MediaAdded(m) => {
            c.ctrl.push(json!({ "t": "media", "mid": m.mid.to_string(), "kind": if m.kind == MediaKind::Audio { "audio" } else { "video" }, "dir": dir_name(m.direction) }));
        }
        Event::MediaChanged(m) => c.ctrl.push(json!({ "t": "dir", "mid": m.mid.to_string(), "dir": dir_name(m.direction) })),
        Event::MediaData(d) => {
            let key = d.is_keyframe();
            let video = d.params.spec().codec != Codec::Opus;
            if video && !d.contiguous {
                // Packets went missing: ask for a fresh picture.
                c.ask_keyframe(d.mid);
            }
            let rec = media_record(&d.mid.to_string(), codec_code(d.params.spec().codec), key, d.contiguous, d.time.numer(), &d.data);
            c.push_record(&rec);
        }
        Event::KeyframeRequest(r) => c.ctrl.push(json!({ "t": "key", "mid": r.mid.to_string() })),
        Event::StreamPaused(p) => c.ctrl.push(json!({ "t": "paused", "mid": p.mid.to_string(), "paused": p.paused })),
        Event::ChannelOpen(cid, label) => {
            let n = c.cid_of(cid);
            c.ctrl.push(json!({ "t": "open", "cid": n, "label": label }));
        }
        Event::ChannelData(d) => {
            let n = c.cid_of(d.id);
            let rec = channel_record(n, d.binary, &d.data);
            c.push_record(&rec);
        }
        Event::ChannelClose(cid) => {
            let n = c.cid_of(cid);
            c.ctrl.push(json!({ "t": "close", "cid": n }));
        }
        Event::ChannelBufferedAmountLow(cid) => {
            let n = c.cid_of(cid);
            c.ctrl.push(json!({ "t": "low", "cid": n }));
        }
        Event::PeerStats(s) => {
            c.peer = json!({
                "rtt": ms(s.rtt),
                "lossOut": s.egress_loss_fraction,
                "lossIn": s.ingress_loss_fraction,
                "bytesOut": s.peer_bytes_tx,
                "bytesIn": s.peer_bytes_rx,
                "bwe": s.bwe_tx.map(|b| b.as_f64()),
            });
        }
        Event::MediaEgressStats(s) => {
            c.egress.insert(
                s.mid.to_string(),
                json!({ "bytes": s.bytes, "packets": s.packets, "nacks": s.nacks, "plis": s.plis, "firs": s.firs, "rtt": ms(s.rtt), "loss": s.loss }),
            );
        }
        Event::MediaIngressStats(s) => {
            c.ingress.insert(
                s.mid.to_string(),
                json!({ "bytes": s.bytes, "packets": s.packets, "nacks": s.nacks, "plis": s.plis, "firs": s.firs, "jitter": s.jitter, "rtt": ms(s.rtt) }),
            );
        }
        _ => {}
    }
}

fn run(mut eng: Engine, rx: mpsc::Receiver<Msg>, running: Arc<AtomicBool>) {
    let mut deadline = Instant::now();
    while running.load(Ordering::SeqCst) {
        let now = Instant::now();
        if now >= deadline {
            for c in &mut eng.conns {
                if c.rtc.is_alive() {
                    let _ = c.rtc.handle_input(Input::Timeout(now));
                }
            }
            deadline = eng.poll(None);
            eng.sweep();
        }
        let wait = deadline.saturating_duration_since(Instant::now()).min(Duration::from_millis(100));
        let mut msg = match rx.recv_timeout(wait) {
            Ok(m) => Some(m),
            Err(mpsc::RecvTimeoutError::Timeout) => None,
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
        };
        // Everything that has come in (up to a batch), then the page hears of it at once.
        let mut n = 0;
        while let Some(m) = msg.take() {
            match m {
                Msg::Packet { data, source, destination } => {
                    let Ok(contents) = data.as_slice().try_into() else { continue };
                    let input = Input::Receive(Instant::now(), Receive { proto: Protocol::Udp, source, destination, contents });
                    if let Some(i) = eng.conns.iter().position(|c| c.rtc.is_alive() && c.rtc.accepts(&input)) {
                        let id = eng.conns[i].id;
                        if let Err(e) = eng.conns[i].rtc.handle_input(input) {
                            eprintln!("[OwnRtc] connection {id}: {e:?}");
                            eng.conns[i].rtc.disconnect();
                        }
                        deadline = deadline.min(eng.poll(Some(id)));
                    }
                }
                Msg::Open { events, reply } => {
                    let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
                    eng.open(id, events);
                    let _ = reply.send(Ok(id));
                }
                Msg::Offer { id, media, channels, reply } => {
                    let _ = reply.send(eng.offer(id, media, channels));
                    deadline = deadline.min(eng.poll(Some(id)));
                }
                Msg::AcceptAnswer { id, sdp, reply } => {
                    let _ = reply.send(eng.accept_answer(id, &sdp));
                    deadline = deadline.min(eng.poll(Some(id)));
                }
                Msg::AcceptOffer { id, sdp, reply } => {
                    let _ = reply.send(eng.accept_offer(id, &sdp));
                    deadline = deadline.min(eng.poll(Some(id)));
                }
                Msg::Write { audio, rtp, targets, data } => {
                    for id in eng.write(audio, rtp, targets, data) {
                        deadline = deadline.min(eng.poll(Some(id)));
                    }
                }
                Msg::Send { id, cid, binary, data } => {
                    if let Some(c) = eng.find(id) {
                        if let Some(ch) = c.channel(cid) {
                            if let Some(mut w) = c.rtc.channel(ch) {
                                let _ = w.write(binary, &data);
                            }
                        }
                    }
                    deadline = deadline.min(eng.poll(Some(id)));
                }
                Msg::NewChannel { id, spec, reply } => {
                    let r = match eng.find(id) {
                        Some(c) => {
                            let ch = c.rtc.direct_api().create_data_channel(channel_config(&spec));
                            Ok(c.cid_of(ch))
                        }
                        None => Err("That connection is closed.".to_string()),
                    };
                    let _ = reply.send(r);
                    deadline = deadline.min(eng.poll(Some(id)));
                }
                Msg::CloseChannel { id, cid } => {
                    if let Some(c) = eng.find(id) {
                        if let Some(ch) = c.channel(cid) {
                            c.rtc.direct_api().close_data_channel(ch);
                        }
                    }
                    deadline = deadline.min(eng.poll(Some(id)));
                }
                Msg::Keyframe { id, mid } => {
                    if let Some(c) = eng.find(id) {
                        c.ask_keyframe(Mid::from(mid.as_str()));
                    }
                    deadline = deadline.min(eng.poll(Some(id)));
                }
                Msg::Stats { id, reply } => {
                    let _ = reply.send(eng.stats(id));
                }
                Msg::Close { id } => {
                    if let Some(i) = eng.index(id) {
                        eng.conns[i].rtc.disconnect();
                        eng.conns[i].told_closed = true;
                    }
                }
            }
            n += 1;
            if n < 256 {
                msg = rx.try_recv().ok();
            }
        }
        eng.sweep();
        if eng.conns.is_empty() && IDLE.lock().as_ref().is_some_and(|t| t.elapsed() > Duration::from_secs(60)) {
            // Nobody has used the engine for a minute: it stops (and starts again, with
            // this PC's addresses of the moment, when needed).
            let mut cur = ENGINE.lock();
            if let Some(r) = cur.as_ref() {
                if Arc::ptr_eq(&r.running, &running) {
                    r.running.store(false, Ordering::SeqCst);
                    *cur = None;
                }
            }
            return;
        } else if !eng.conns.is_empty() {
            *IDLE.lock() = Some(Instant::now());
        }
    }
}

// ------------------------------------------------------------------ the one engine of this PC

struct Running {
    tx: mpsc::Sender<Msg>,
    running: Arc<AtomicBool>,
}
static ENGINE: Mutex<Option<Running>> = Mutex::new(None);
static IDLE: Mutex<Option<Instant>> = Mutex::new(None);
static NEXT_ID: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(1);

fn start() -> Result<mpsc::Sender<Msg>, String> {
    let mut cur = ENGINE.lock();
    if let Some(r) = cur.as_ref() {
        if r.running.load(Ordering::SeqCst) {
            return Ok(r.tx.clone());
        }
    }
    crate::relay::crypto_ready();
    let mut sockets = Vec::new();
    for ip in crate::relay::relay_addresses() {
        if let Ok(s) = UdpSocket::bind(SocketAddr::new(ip, 0)) {
            sockets.push(s);
        }
    }
    if sockets.is_empty() {
        return Err("LANX couldn't open a network port for the call.".to_string());
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
            .name("lanx-ownrtc-in".into())
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
                        Err(_) => thread::sleep(Duration::from_millis(5)),
                    }
                }
            })
            .map_err(|e| e.to_string())?;
    }
    let addrs = sockets.iter().filter_map(|s| s.local_addr().ok()).collect();
    let eng = Engine { sockets, addrs, conns: Vec::new() };
    let r2 = running.clone();
    *IDLE.lock() = Some(Instant::now());
    thread::Builder::new().name("lanx-ownrtc".into()).spawn(move || run(eng, rx, r2)).map_err(|e| e.to_string())?;
    *cur = Some(Running { tx: tx.clone(), running });
    Ok(tx)
}

fn tx() -> Result<mpsc::Sender<Msg>, String> {
    let cur = ENGINE.lock();
    cur.as_ref().filter(|r| r.running.load(Ordering::SeqCst)).map(|r| r.tx.clone()).ok_or_else(|| "The call engine stopped.".to_string())
}

fn ask<T>(make: impl FnOnce(Reply<T>) -> Msg, sender: mpsc::Sender<Msg>) -> Result<T, String> {
    let (reply, rx) = mpsc::channel();
    sender.send(make(reply)).map_err(|_| "The call engine stopped.".to_string())?;
    rx.recv_timeout(Duration::from_secs(5)).map_err(|_| "The call engine didn't answer.".to_string())?
}

pub fn open(events: Channel<InvokeResponseBody>) -> Result<u32, String> {
    let sender = start()?;
    ask(|reply| Msg::Open { events, reply }, sender)
}
pub fn offer(id: u32, media: Vec<MediaSpec>, channels: Vec<ChannelSpec>) -> Result<OfferOut, String> {
    ask(|reply| Msg::Offer { id, media, channels, reply }, tx()?)
}
pub fn accept_answer(id: u32, sdp: String) -> Result<Vec<MediaInfo>, String> {
    ask(|reply| Msg::AcceptAnswer { id, sdp, reply }, tx()?)
}
pub fn accept_offer(id: u32, sdp: String) -> Result<AnswerOut, String> {
    ask(|reply| Msg::AcceptOffer { id, sdp, reply }, tx()?)
}
pub fn new_channel(id: u32, spec: ChannelSpec) -> Result<u32, String> {
    ask(|reply| Msg::NewChannel { id, spec, reply }, tx()?)
}
pub fn stats(id: u32) -> Result<Value, String> {
    ask(|reply| Msg::Stats { id, reply }, tx()?)
}
/// "a" or "v", the RTP time, and where to: `id:mid,id:mid`.
pub fn write(header: &str, data: Vec<u8>) -> Result<(), String> {
    let mut audio = None;
    let mut rtp = None;
    let mut targets = Vec::new();
    for part in header.split(';') {
        let (k, v) = part.split_once('=').unwrap_or((part, ""));
        match k {
            "k" => audio = Some(v == "a"),
            "t" => rtp = v.parse::<u64>().ok(),
            "to" => {
                for t in v.split(',').filter(|t| !t.is_empty()) {
                    if let Some((id, mid)) = t.split_once(':') {
                        if let Ok(id) = id.parse() {
                            targets.push((id, mid.to_string()));
                        }
                    }
                }
            }
            _ => {}
        }
    }
    let (Some(audio), Some(rtp)) = (audio, rtp) else { return Err("bad write header".into()) };
    tx()?.send(Msg::Write { audio, rtp, targets, data }).map_err(|_| "The call engine stopped.".to_string())
}
/// `id:cid:0|1` (1 = binary).
pub fn send(header: &str, data: Vec<u8>) -> Result<(), String> {
    let mut it = header.split(':');
    let (Some(id), Some(cid), Some(b)) = (it.next(), it.next(), it.next()) else { return Err("bad send header".into()) };
    let (Ok(id), Ok(cid)) = (id.parse(), cid.parse()) else { return Err("bad send header".into()) };
    tx()?.send(Msg::Send { id, cid, binary: b == "1", data }).map_err(|_| "The call engine stopped.".to_string())
}
pub fn close_channel(id: u32, cid: u32) {
    if let Ok(t) = tx() {
        let _ = t.send(Msg::CloseChannel { id, cid });
    }
}
pub fn keyframe(id: u32, mid: String) {
    if let Ok(t) = tx() {
        let _ = t.send(Msg::Keyframe { id, mid });
    }
}
pub fn close(id: u32) {
    if let Ok(t) = tx() {
        let _ = t.send(Msg::Close { id });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sections_lists_audio_and_video_in_order() {
        let sdp = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:1\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=mid:2\r\n";
        assert_eq!(sections(sdp), vec![("0".to_string(), "audio".to_string()), ("1".to_string(), "video".to_string())]);
    }

    #[test]
    fn write_headers_are_read() {
        // (No engine runs in tests: the header is read, then sending fails.)
        assert_eq!(write("k=v;t=90000", vec![1]).unwrap_err(), "The call engine stopped.");
        assert_eq!(write("t=1;to=1:0", vec![1]).unwrap_err(), "bad write header");
        assert_eq!(send("1:0", vec![]).unwrap_err(), "bad send header");
    }

    #[test]
    fn records_carry_what_the_page_reads() {
        let r = media_record("1", 2, true, true, 0x0102_0304_0506, &[9, 8, 7]);
        assert_eq!(&r[..5], &[1, 1, b'1', 2, 3]);
        assert_eq!(u64::from_le_bytes(r[5..13].try_into().unwrap()), 0x0102_0304_0506);
        assert_eq!(u32::from_le_bytes(r[13..17].try_into().unwrap()), 3);
        assert_eq!(&r[17..], &[9, 8, 7]);
        let c = channel_record(5, false, b"hi");
        assert_eq!(c, vec![2, 5, 0, 0, 0, 0, 2, 0, 0, 0, b'h', b'i']);
    }

    /// Two engines' worth of connections in one: an offer, its answer, and the two
    /// sides connect over loopback, open a data channel and pass a picture.
    #[test]
    fn two_connections_meet_and_pass_a_picture_and_a_message() {
        crate::relay::crypto_ready();
        let sock = UdpSocket::bind("127.0.0.1:0").unwrap();
        let addr = sock.local_addr().unwrap();
        let mk = || {
            let mut rtc = Rtc::builder().clear_codecs().enable_opus(true, false).enable_vp8(true).build(Instant::now());
            rtc.add_local_candidate(Candidate::host(addr, "udp").unwrap());
            rtc
        };
        let mut a = mk();
        let mut b = mk();
        let mut api = a.sdp_api();
        let vmid = api.add_media(MediaKind::Video, Direction::SendRecv, None, None, None);
        let ch = api.add_channel("t".into());
        let (offer, pending) = api.apply().unwrap();
        let answer = b.sdp_api().accept_offer(SdpOffer::from_sdp_string(&offer.to_sdp_string()).unwrap()).unwrap();
        let infos = media_infos(&b, &answer.to_sdp_string());
        assert_eq!(infos, vec![MediaInfo { mid: vmid.to_string(), kind: "video".into(), dir: "sendrecv".into() }]);
        a.sdp_api().accept_answer(pending, SdpAnswer::from_sdp_string(&answer.to_sdp_string()).unwrap()).unwrap();
        // Shuttle packets between the two in memory (both "live" on one address).
        let mut now = Instant::now();
        let (mut got_open, mut got_msg, mut got_pic) = (false, false, false);
        let mut wrote = false;
        for _ in 0..4000 {
            now += Duration::from_millis(2);
            for (from, to) in [(0, 1), (1, 0)] {
                let (x, y) = if from == 0 { (&mut a, &mut b) } else { (&mut b, &mut a) };
                let mut sends = Vec::new();
                loop {
                    match x.poll_output().unwrap() {
                        Output::Timeout(_) => break,
                        Output::Transmit(t) => sends.push(t.contents.to_vec()),
                        Output::Event(e) => match (to, e) {
                            (0, Event::ChannelOpen(_, label)) => got_open = label == "t",
                            (0, Event::ChannelData(d)) => got_msg = d.data == b"hello",
                            (0, Event::MediaData(d)) => got_pic = d.is_keyframe() && d.data.len() > 10,
                            _ => {}
                        },
                    }
                }
                for p in sends {
                    let input = Input::Receive(now, Receive { proto: Protocol::Udp, source: addr, destination: addr, contents: p.as_slice().try_into().unwrap() });
                    y.handle_input(input).unwrap();
                }
                x.handle_input(Input::Timeout(now)).unwrap();
            }
            if a.is_connected() && !wrote {
                // A (tiny, made-up) VP8 key frame: first byte's lowest bit 0 = key.
                let mut frame = vec![0x10u8, 0x02, 0x00, 0x9d, 0x01, 0x2a, 0x40, 0x01, 0xf0, 0x00];
                frame.extend(std::iter::repeat_n(0u8, 400));
                if let Some(pt) = a.writer(vmid).and_then(|w| w.payload_params().find(|p| p.spec().codec == Codec::Vp8).map(|p| p.pt())) {
                    a.writer(vmid).unwrap().write(pt, now, MediaTime::new(9000, Frequency::NINETY_KHZ), frame).unwrap();
                }
                if let Some(mut c) = a.channel(ch) {
                    if c.write(false, b"hello").is_ok() {
                        wrote = true;
                    }
                }
            }
            if got_msg && got_pic {
                break;
            }
        }
        assert!(got_msg, "the message arrived");
        assert!(got_pic, "the picture arrived");
        let _ = got_open;
    }
}
