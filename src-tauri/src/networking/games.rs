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
pub const GAME_IDS: [&str; 46] = ["tictactoe", "connect4", "reversi", "chess", "chainreaction", "checkers", "dots", "gomoku", "hex", "go", "mancala", "memory", "minesvs", "battleship", "mahjong", "snakes", "ludo", "backgammon", "dominoes", "bankroll", "crazy8", "ocho", "gofish", "blackjack", "hearts", "spades", "euchre", "ginrummy", "holdem", "taproulette", "mathrush", "trivia", "wordbox", "paintfight", "drawguess", "werewolf", "darts", "archery", "cuppong", "bowling", "minigolf", "pool", "carrom", "airhockey", "foosball", "spinnerwars"];
/// The steps a match can take.
pub const GAME_ACTIONS: [&str; 8] = ["accept", "decline", "move", "resign", "rematch", "leave", "state", "delta"];
/// A step's data as JSON is at most this long (a whole chess game is ~2 KB).
pub const GAME_DATA_MAX: usize = 32 * 1024;

pub fn game_name(id: &str) -> &'static str {
    match id {
        "tictactoe" => "Tic-tac-toe",
        "connect4" => "Connect Four",
        "reversi" => "Reversi",
        "chess" => "Chess",
        "chainreaction" => "Chain Reaction",
        "checkers" => "Checkers",
        "dots" => "Dots & Boxes",
        "gomoku" => "Gomoku",
        "hex" => "Hex",
        "go" => "Go",
        "mancala" => "Mancala",
        "memory" => "Memory",
        "minesvs" => "Minesweeper Versus",
        "battleship" => "Sea Battle",
        "mahjong" => "Mahjong Duels",
        "snakes" => "Snakes & Ladders",
        "ludo" => "Ludo",
        "backgammon" => "Backgammon",
        "dominoes" => "Dominoes",
        "bankroll" => "Bankroll",
        "crazy8" => "Crazy Eights",
        "ocho" => "Ocho",
        "gofish" => "Go Fish",
        "blackjack" => "Blackjack 21",
        "hearts" => "Hearts",
        "spades" => "Spades",
        "euchre" => "Euchre",
        "ginrummy" => "Gin Rummy",
        "holdem" => "Texas Hold'em",
        "taproulette" => "Tap Roulette",
        "mathrush" => "Math Rush",
        "trivia" => "Trivia Night",
        "wordbox" => "Wordbox",
        "paintfight" => "Paint Fight",
        "drawguess" => "Draw & Guess",
        "werewolf" => "Werewolf",
        "darts" => "Darts",
        "archery" => "Archery",
        "cuppong" => "Cup Pong",
        "bowling" => "Bowling",
        "minigolf" => "Mini Golf",
        "pool" => "8-Ball Pool",
        "carrom" => "Carrom",
        "airhockey" => "Air Hockey",
        "foosball" => "Table Soccer",
        "spinnerwars" => "Spinner Wars",
        _ => "Game",
    }
}

/// The oldest LANX that knows this game.
pub fn game_min_version(id: &str) -> &'static str {
    if RULES_2171_GAMES.contains(&id) {
        return FEATURES_RULES_2171;
    }
    if RULES_2170_GAMES.contains(&id) {
        return FEATURES_RULES_2170;
    }
    match id {
        "chainreaction" => FEATURES_CHAIN_REACTION,
        "tictactoe" | "connect4" | "reversi" | "chess" => FEATURES_GAMES,
        "checkers" | "dots" | "gomoku" | "hex" | "go" | "mancala" | "memory" | "minesvs" | "battleship" | "mahjong" => FEATURES_GAMES_B,
        _ => FEATURES_GAMES_C,
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
        // A table of several players (the state carries the seats) needs 2.10.0 on their side.
        let table = p.data.get("seats").and_then(|s| s.as_array()).is_some_and(|s| s.len() > 2);
        let mut min = game_min_version(&p.game);
        if table && version_at_least(FEATURES_MULTIPLAYER, min) {
            min = FEATURES_MULTIPLAYER;
        }
        if !version_at_least(&chan.remote.app_version, min) {
            let v = chan.remote.app_version.clone();
            chan.close().await;
            return Err(format!(
                "{}'s LANX ({}) needs {} or newer to play {} with you. Send them the update from Settings → Updates.",
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
    pub(super) fn handle_game(&self, peer: &Peer, p: GamePayload, remote_version: &str) -> AckPayload {
        let no = |r: &str| AckPayload { ok: false, reason: Some(r.to_string()) };
        if peer.trust_state == "blocked" {
            return no("Not available");
        }
        if let Err(e) = check_game_step(&p) {
            return no(&e);
        }
        // LANX 2.17.0: a copy with older rules for this game would see a different board.
        let min = game_min_version(&p.game);
        if !version_at_least(remote_version, min) {
            return no(&format!("{} has new rules in LANX {}. Update LANX (Settings → Updates) to keep playing.", game_name(&p.game), min));
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
        assert!(check_game_step(&step("chaupar", "move")).is_err(), "unknown game");
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
        assert_eq!(game_min_version("gomoku"), FEATURES_GAMES_B);
        // 2.17.0 changed the rules of these (and every 2.12.0 game): both PCs need 2.17.0.
        assert_eq!(game_min_version("go"), FEATURES_RULES_2170);
        assert_eq!(game_min_version("holdem"), FEATURES_RULES_2170);
        assert_eq!(game_min_version("ludo"), FEATURES_RULES_2171);
        assert_eq!(game_min_version("hearts"), FEATURES_RULES_2170);
        assert_eq!(game_min_version("chess"), FEATURES_GAMES);
        assert!(RULES_2170_GAMES.iter().all(|g| GAME_IDS.contains(g)));
        assert_eq!(game_name("foosball"), "Table Soccer");
        assert!(check_game_step(&step("drawguess", "delta")).is_ok());
        assert_eq!(GAME_IDS.len(), 46);
        assert_eq!(game_name("mahjong"), "Mahjong Duels");
        assert!(check_game_step(&step("battleship", "move")).is_ok());
        assert!(check_game_step(&step("chainreaction", "move")).is_ok());
    }
}
