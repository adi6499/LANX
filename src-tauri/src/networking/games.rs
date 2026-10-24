//! LANX 2.9.0: games between two colleagues — tic-tac-toe, Connect Four,
//! Reversi and chess — played inside LANX over the office network.
//!
//! The challenge is a "game" card in the chat (older copies see it as text).
//! Every step after that (accept, a move, resign, rematch…) is a small `Game`
//! packet straight to the other PC, acknowledged, and handed to the UI as a
//! `lanx://game` event. LANX keeps no game state here: both UIs run the same
//! rules and every step carries the whole position, so a packet that is
//! missed or arrives twice never leaves the two boards different.

use super::protocol::*;
use super::{NetworkService, now_secs};
use crate::storage::models::Peer;
use serde::Serialize;

/// The games LANX knows. Anything else is refused on both sides.
pub const GAME_IDS: [&str; 5] = ["tictactoe", "connect4", "reversi", "chess", "chainreaction"];
/// The steps a match can take.
pub const GAME_ACTIONS: [&str; 7] = ["accept", "decline", "move", "resign", "rematch", "leave", "state"];
/// A step's data as JSON is at most this long (a whole chess game is ~2 KB).
pub const GAME_DATA_MAX: usize = 8 * 1024;

pub fn game_name(id: &str) -> &'static str {
    match id {
        "tictactoe" => "Tic-tac-toe",
        "connect4" => "Connect Four",
        "reversi" => "Reversi",
        "chess" => "Chess",
        "chainreaction" => "Chain Reaction",
        _ => "Game",
    }
}

/// The oldest LANX that knows this game.
pub fn game_min_version(id: &str) -> &'static str {
    match id {
        "chainreaction" => FEATURES_CHAIN_REACTION,
        _ => FEATURES_GAMES,
    }
}

/// What the UI gets for every step a colleague sends.
#[derive(Serialize, Clone, Debug)]
pub struct GameEvent {
    pub from_id: String,
    pub from_name: String,
    pub match_id: String,
    pub game: String,
    pub action: String,
    pub seq: u64,
    pub data: serde_json::Value,
    pub at: i64,
}

/// A step is refused when its match id, game, action or size is off.
pub fn check_game_step(p: &GamePayload) -> Result<(), String> {
    if p.match_id.is_empty() || p.match_id.len() > 64 || !p.match_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("Bad match id.".to_string());
    }
    if !GAME_IDS.contains(&p.game.as_str()) {
        return Err("Unknown game.".to_string());
    }
    if !GAME_ACTIONS.contains(&p.action.as_str()) {
        return Err("Unknown step.".to_string());
    }
    if p.data.to_string().len() > GAME_DATA_MAX {
        return Err("The step is too big.".to_string());
    }
    Ok(())
}

impl NetworkService {
    /// Sends one step of a game to the colleague you play with. `Ok(true)`
    /// means their LANX took it; an `Err` says in plain words why not.
    pub async fn send_game(&self, peer_id: &str, mut p: GamePayload) -> Result<bool, String> {
        self.privacy.guard()?;
        check_game_step(&p)?;
        p.at = now_secs();
        let peer = self.db.get_peer(peer_id).map_err(|e| e.to_string())?.ok_or("Colleague not found")?;
        if peer.trust_state == "blocked" {
            return Err("This colleague is blocked.".to_string());
        }
        if peer.status != "online" {
            return Err(format!("{} is offline right now.", peer.display_name));
        }
        let mut chan = self.connect_peer(&peer).await.map_err(|_| format!("Could not reach {}'s LANX.", peer.display_name))?;
        let min = game_min_version(&p.game);
        if !version_at_least(&chan.remote.app_version, min) {
            let v = chan.remote.app_version.clone();
            chan.close().await;
            return Err(format!(
                "{}'s LANX ({}) is older than {} and does not have {} yet. Send them the update from Settings → Updates.",
                peer.display_name,
                v,
                min,
                game_name(&p.game)
            ));
        }
        let reply = NetworkService::send_acked(&mut chan, PacketPayload::Game(p)).await;
        chan.close().await;
        match reply {
            Ok(a) if a.ok => Ok(true),
            Ok(a) => Err(a.reason.unwrap_or_else(|| "The other LANX did not take the step.".to_string())),
            Err(()) => Err(format!("No answer from {}'s LANX.", peer.display_name)),
        }
    }

    /// A step from a colleague: checked, then straight to the UI.
    pub(super) fn handle_game(&self, peer: &Peer, p: GamePayload) -> AckPayload {
        let no = |r: &str| AckPayload { ok: false, reason: Some(r.to_string()) };
        if peer.trust_state == "blocked" {
            return no("Not available");
        }
        if let Err(e) = check_game_step(&p) {
            return no(&e);
        }
        if self.privacy.is_locked() {
            return no("LANX is locked on that PC right now.");
        }
        self.events.game(&GameEvent {
            from_id: peer.id.clone(),
            from_name: peer.display_name.clone(),
            match_id: p.match_id,
            game: p.game,
            action: p.action,
            seq: p.seq,
            data: p.data,
            at: now_secs(),
        });
        AckPayload { ok: true, reason: None }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn step(game: &str, action: &str) -> GamePayload {
        GamePayload { match_id: "m-1".to_string(), game: game.to_string(), action: action.to_string(), seq: 1, data: json!({ "cell": 4 }), at: 0 }
    }

    #[test]
    fn steps_are_checked() {
        assert!(check_game_step(&step("chess", "move")).is_ok());
        assert!(check_game_step(&step("ludo", "move")).is_err(), "unknown game");
        assert!(check_game_step(&step("chess", "cheat")).is_err(), "unknown step");
        let mut bad = step("chess", "move");
        bad.match_id = "../x".to_string();
        assert!(check_game_step(&bad).is_err(), "odd match id");
        let mut big = step("chess", "state");
        big.data = json!("x".repeat(GAME_DATA_MAX));
        assert!(check_game_step(&big).is_err(), "too big");
    }

    #[test]
    fn games_have_names() {
        assert_eq!(game_name("connect4"), "Connect Four");
        assert_eq!(game_name("chainreaction"), "Chain Reaction");
        assert_eq!(game_name("nope"), "Game");
    }

    #[test]
    fn newer_games_need_newer_copies() {
        assert_eq!(game_min_version("chess"), FEATURES_GAMES);
        assert_eq!(game_min_version("chainreaction"), FEATURES_CHAIN_REACTION);
        assert!(check_game_step(&step("chainreaction", "move")).is_ok());
    }
}
