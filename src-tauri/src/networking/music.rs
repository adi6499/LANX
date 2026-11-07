//! LANX 3.8.0: Listen together. One PC (the host) plays music for colleagues
//! and every PC plays the same moment of the same song.
//!
//! Two things live here; the music itself is in the UI:
//! - party messages (invite, join, state, ready, status, leave, end, decline):
//!   checked, then passed straight to the window as `lanx://music`;
//! - a clock: a colleague's clock compared with ours over the network, the way
//!   NTP does it (four timestamps per round trip, the quickest round trips
//!   win). "Start at 12:00:03.250 on the host's clock" then means the same
//!   instant on every PC, to well under a millisecond on a normal office LAN.

use super::protocol::*;
use super::{NetworkService, now_secs};
use crate::storage::models::Peer;
use serde::Serialize;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const MUSIC_ACTIONS: [&str; 8] = ["invite", "join", "state", "ready", "status", "leave", "end", "decline"];
/// The song (with its next one) and where it is: a few kilobytes at most.
pub const MUSIC_DATA_MAX: usize = 24 * 1024;
/// Round trips per clock comparison (the UI asks for 4–24).
const CLOCK_MAX_SAMPLES: u32 = 32;

/// What the window is told (`lanx://music`).
#[derive(Debug, Clone, Serialize)]
pub struct MusicEvent {
    pub from_id: String,
    pub from_name: String,
    pub party_id: String,
    pub action: String,
    pub seq: u64,
    pub data: serde_json::Value,
    pub at: i64,
}

/// A colleague's clock against ours: `offset_ms` = their clock − ours.
#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
pub struct ClockSample {
    pub offset_ms: f64,
    /// The quickest round trip, minus the time their LANX held the question.
    pub delay_ms: f64,
    pub samples: u32,
}

/// This PC's clock: milliseconds since 1970, with fractions. A test copy can
/// be told to run a clock that is off (`LANX_TEST_CLOCK_SKEW_MS`), to prove
/// that colleagues still play together.
pub fn clock_ms() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs_f64() * 1000.0 + crate::testmode::clock_skew_ms()
}

/// One round trip: we asked at `t0` (our clock), they got it at `t1` and
/// answered at `t2` (their clock), the answer came back at `t3` (ours).
#[derive(Debug, Clone, Copy)]
pub struct RoundTrip {
    pub t0: f64,
    pub t1: f64,
    pub t2: f64,
    pub t3: f64,
}
impl RoundTrip {
    pub fn delay(&self) -> f64 {
        ((self.t3 - self.t0) - (self.t2 - self.t1)).max(0.0)
    }
    pub fn offset(&self) -> f64 {
        ((self.t1 - self.t0) + (self.t2 - self.t3)) / 2.0
    }
}

/// The offset from the quickest round trips (a slow one was held up on one
/// leg, which skews it): the middle of the best three.
pub fn best_offset(trips: &[RoundTrip]) -> Option<ClockSample> {
    let mut ok: Vec<&RoundTrip> = trips.iter().filter(|t| t.t3 >= t.t0 && t.t2 >= t.t1).collect();
    if ok.is_empty() {
        return None;
    }
    ok.sort_by(|a, b| a.delay().total_cmp(&b.delay()));
    let best: Vec<f64> = {
        let mut v: Vec<f64> = ok.iter().take(3).map(|t| t.offset()).collect();
        v.sort_by(|a, b| a.total_cmp(b));
        v
    };
    Some(ClockSample { offset_ms: best[best.len() / 2], delay_ms: ok[0].delay(), samples: trips.len() as u32 })
}

/// A party step is refused when its id, action or size is off.
pub fn check_music_step(p: &MusicPayload) -> Result<(), String> {
    if p.party_id.is_empty() || p.party_id.len() > 64 || !p.party_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("Bad party id.".to_string());
    }
    if !MUSIC_ACTIONS.contains(&p.action.as_str()) {
        return Err("Unknown step.".to_string());
    }
    if p.data.to_string().len() > MUSIC_DATA_MAX {
        return Err("The step is too big.".to_string());
    }
    Ok(())
}

impl NetworkService {
    async fn music_peer(&self, peer_id: &str) -> Result<Peer, String> {
        let peer = self.db.get_peer(peer_id).map_err(|e| e.to_string())?.ok_or("Colleague not found")?;
        if peer.trust_state == "blocked" {
            return Err("This colleague is blocked.".to_string());
        }
        if peer.status != "online" {
            return Err(format!("{} is offline right now.", peer.display_name));
        }
        Ok(peer)
    }

    /// Sends one party step to a colleague. `Ok(true)`: their LANX took it.
    pub async fn send_music(&self, peer_id: &str, mut p: MusicPayload) -> Result<bool, String> {
        self.privacy.guard()?;
        check_music_step(&p)?;
        p.at = now_secs();
        let peer = self.music_peer(peer_id).await?;
        let mut chan = self.connect_peer(&peer).await.map_err(|_| format!("Could not reach {}'s LANX.", peer.display_name))?;
        if !version_at_least(&chan.remote.app_version, FEATURES_LISTEN) {
            let v = chan.remote.app_version.clone();
            chan.close().await;
            return Err(format!("{}'s LANX ({}) needs {} or newer to listen together. Send them the update from Settings → Updates.", peer.display_name, v, FEATURES_LISTEN));
        }
        let reply = NetworkService::send_acked(&mut chan, PacketPayload::Music(p)).await;
        chan.close().await;
        match reply {
            Ok(a) if a.ok => Ok(true),
            Ok(a) => Err(a.reason.unwrap_or_else(|| format!("{}'s LANX did not take it.", peer.display_name))),
            Err(()) => Err(format!("No answer from {}'s LANX.", peer.display_name)),
        }
    }

    /// A party step from a colleague: checked, then straight to the window.
    pub(super) fn handle_music(&self, peer: &Peer, p: MusicPayload) -> AckPayload {
        let no = |r: &str| AckPayload { ok: false, reason: Some(r.to_string()) };
        if peer.trust_state == "blocked" {
            return no("Not available");
        }
        if let Err(e) = check_music_step(&p) {
            return no(&e);
        }
        if self.privacy.is_locked() && p.action == "invite" {
            return no("LANX is locked on that PC right now.");
        }
        self.events.music(&MusicEvent {
            from_id: peer.id.clone(),
            from_name: peer.display_name.clone(),
            party_id: p.party_id,
            action: p.action,
            seq: p.seq,
            data: p.data,
            at: now_secs(),
        });
        AckPayload { ok: true, reason: None }
    }

    /// Compares a colleague's clock with ours: `samples` round trips over one
    /// connection (no new connection per question, so no handshake in the timing).
    pub async fn music_clock(&self, peer_id: &str, samples: u32) -> Result<ClockSample, String> {
        let peer = self.music_peer(peer_id).await?;
        let mut chan = self.connect_peer(&peer).await.map_err(|_| format!("Could not reach {}'s LANX.", peer.display_name))?;
        if !version_at_least(&chan.remote.app_version, FEATURES_LISTEN) {
            chan.close().await;
            return Err(format!("{}'s LANX needs {} or newer to listen together.", peer.display_name, FEATURES_LISTEN));
        }
        let mut trips = Vec::new();
        for _ in 0..samples.clamp(1, CLOCK_MAX_SAMPLES) {
            // (Whole microseconds on the wire: see ClockPayload.)
            let t0 = us(clock_ms()) as f64 / 1000.0;
            let Ok(sent) = chan.send(PacketPayload::Clock(ClockPayload { t0: us(t0), t1: 0, t2: 0 }), None).await else { break };
            let Ok(reply) = chan.recv_packet_timeout(Duration::from_secs(2)).await else { break };
            let t3 = clock_ms();
            if let PacketPayload::ClockReply(c) = reply.payload {
                if reply.correlation_id.as_deref() == Some(sent.packet_id.as_str()) && c.t0 == us(t0) {
                    trips.push(RoundTrip { t0, t1: c.t1 as f64 / 1000.0, t2: c.t2 as f64 / 1000.0, t3 });
                }
            }
        }
        chan.close().await;
        best_offset(&trips).ok_or_else(|| format!("{}'s LANX didn't answer the clock check.", peer.display_name))
    }
}

/// Milliseconds → whole microseconds (the wire's unit).
pub fn us(ms: f64) -> i64 {
    (ms * 1000.0).round() as i64
}

/// The answer to a clock question that `arrived` at this time (our clock, ms).
pub fn clock_reply(q: ClockPayload, arrived: f64) -> ClockPayload {
    ClockPayload { t0: q.t0, t1: us(arrived), t2: us(clock_ms()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn step(action: &str) -> MusicPayload {
        MusicPayload { party_id: "p-1".into(), action: action.into(), seq: 1, data: json!({ "song": { "id": "x" } }), at: 0 }
    }

    #[test]
    fn steps_are_checked() {
        for a in MUSIC_ACTIONS {
            assert!(check_music_step(&step(a)).is_ok(), "{a}");
        }
        assert!(check_music_step(&step("explode")).is_err());
        let mut bad = step("state");
        bad.party_id = "../x".into();
        assert!(check_music_step(&bad).is_err());
        let mut big = step("state");
        big.data = json!("x".repeat(MUSIC_DATA_MAX));
        assert!(check_music_step(&big).is_err());
    }

    #[test]
    fn the_clock_offset_comes_from_the_quickest_trips() {
        // Their clock is 1000 ms ahead; the network takes 1 ms each way, and
        // one trip was held up 30 ms on the way back (it must not count).
        let trip = |t0: f64, back: f64| RoundTrip { t0, t1: t0 + 1.0 + 1000.0, t2: t0 + 1.2 + 1000.0, t3: t0 + 2.2 + back };
        let trips = [trip(0.0, 0.0), trip(10.0, 30.0), trip(20.0, 0.0), trip(30.0, 0.4)];
        let s = best_offset(&trips).unwrap();
        assert!((s.offset_ms - 1000.0).abs() < 0.25, "{s:?}");
        assert!((s.delay_ms - 2.0).abs() < 1e-9, "{s:?}");
        assert_eq!(s.samples, 4);
        assert!(best_offset(&[]).is_none());
    }
}
