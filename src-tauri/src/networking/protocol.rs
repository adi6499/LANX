use crate::security::DeviceIdentity;
use serde::{Deserialize, Serialize};
use std::io::{self, Error, ErrorKind};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use uuid::Uuid;

/// v2: every TCP connection starts with a signed X25519 handshake and is then
/// encrypted with ChaCha20-Poly1305 (see `session.rs`). v1 peers are rejected.
pub const PROTOCOL_VERSION: u8 = 2;
/// Maximum size of a plaintext (handshake) frame.
pub const MAX_FRAME_SIZE: usize = 65536;
/// Maximum UTF-8 byte length of one text message.
pub const MAX_MESSAGE_CONTENT_LEN: usize = 16384;
/// Size of one encrypted file-data chunk.
pub const FILE_CHUNK_SIZE: usize = 256 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HandshakePayload {
    /// Hex-encoded ephemeral X25519 public key for this connection only.
    pub ephemeral_key: String,
    pub hostname: String,
    pub tcp_port: u16,
    pub avatar_color: String,
    pub app_version: String,
}

/// Oldest app version that understands groups, secret messages, receipts,
/// typing and ring. Older peers are never sent those packets.
pub const FEATURES_V11: &str = "1.1.0";

/// Oldest app version that understands voice/video calls and `UpdateOffer`
/// ("Share LANX update"). Older peers would drop the connection on an unknown
/// packet kind, so they are never sent those (updates go to them as an
/// ordinary chat file instead).
pub const FEATURES_V12: &str = "1.2.0";

/// Oldest app version with voice/video calls. (The first 1.2.0 builds that
/// reached colleagues had update sharing only, so calls start at 1.2.2.)
pub const FEATURES_CALLS: &str = "1.2.2";

/// Oldest app version with multi-connection transfers, folders and the speed
/// test (`FileRangeRequest`, `FileRangeFinish`, `SpeedTest`, `FileOffer.folder`).
pub const FEATURES_FAST: &str = "1.2.3";

/// Oldest app version that can send and receive compressed file data
/// (`compress` in file requests, compressed data frames).
pub const FEATURES_COMPRESS: &str = "1.2.4";

/// Oldest app version with profiles (`ProfileRequest` / `ProfileReply`, and
/// `profile_rev` in discovery beacons).
pub const FEATURES_PROFILE: &str = "1.2.9";

/// Oldest app version with group meetings and recording notices (`Meeting`,
/// `CallPayload.recording`).
pub const FEATURES_MEETINGS: &str = "1.4.0";

/// Oldest app version with the 1.5.0 chat features: replies and @mentions on
/// messages (`MessagePayload.reply_to / reply_preview / mentions`), voice notes
/// (`FileOfferPayload.kind / media_ms`) and `MessageAction` (reactions, edit,
/// delete for everyone, pin). Older peers get plain messages and files.
pub const FEATURES_CHAT: &str = "1.5.0";

/// Oldest app version with 1.6.0 cards (notices, polls, tasks, approvals,
/// checklists, meetings): `message_type = "card"` and `MessageAction
/// { action: "card" }`. Older peers get the card as plain text.
pub const FEATURES_ORG: &str = "1.6.0";

/// Oldest app version with 1.7.0 tools: stickers (`message_type =
/// "sticker"`), shared folders (`Sync` packets, `FileOfferPayload.sync_id /
/// sync_path`, cards of kind "sync").
pub const FEATURES_TOOLS: &str = "1.7.0";

/// Oldest app version with 1.8.0 office features: emergency alerts (`Alert`
/// packets), intercom (`FileOfferPayload.intercom`), remote help
/// (`CallPayload.help`), birthdays in profiles, visitor and kudos cards.
pub const FEATURES_OFFICE: &str = "1.8.0";

/// Oldest app version with 1.9.0 admin features: office settings (`Policy`,
/// `PolicyAnswer` packets).
pub const FEATURES_ADMIN: &str = "1.9.0";

/// Oldest app version with 2.3.0 IT help desk: the "ticket" card
/// (`message_type = "card"`, kind "ticket"). Older peers get it as text.
pub const FEATURES_HELP: &str = "2.3.0";

/// Oldest app version with the 2.4.0 end-of-day report card (kind "report").
pub const FEATURES_REPORT: &str = "2.4.0";

/// Oldest app version with the 2.7.0 song card (kind "music"): a song from the
/// music picker that plays inside LANX. Older peers get the title and a link.
pub const FEATURES_MUSIC: &str = "2.7.0";
/// LANX 2.9.0: games between two colleagues (`Game` packets, "game" cards).
pub const FEATURES_GAMES: &str = "2.9.0";
/// LANX 2.9.1: the Chain Reaction game (a 2.9.0 copy would refuse it).
pub const FEATURES_CHAIN_REACTION: &str = "2.9.1";
/// LANX 2.10.0: games for more than two players (a host relays the table's state).
pub const FEATURES_MULTIPLAYER: &str = "2.10.0";
/// LANX 2.11.0: ten more games (checkers, dots & boxes, gomoku, hex, go, mancala, memory, minesweeper versus, sea battle, mahjong).
pub const FEATURES_GAMES_B: &str = "2.11.0";
/// LANX 2.12.0: the rest of the games (dice, cards, party, aim-and-shoot, live) and "delta" steps.
pub const FEATURES_GAMES_C: &str = "2.12.0";
/// LANX 2.17.0: games whose rules were brought in line with how people really play them
/// (a copy with the old rules would replay the same moves differently, so both need 2.17.0).
pub const FEATURES_RULES_2170: &str = "2.17.0";
/// The games whose rules changed in 2.17.0 (mirrors RULES_2170 in src/lib/games.ts).
pub const RULES_2170_GAMES: [&str; 39] = [
    "ludo",
    "dots",
    "memory",
    "minesvs",
    "mahjong",
    "battleship",
    "go",
    "hex",
    "checkers",
    "taproulette",
    "mathrush",
    "trivia",
    "drawguess",
    "wordbox",
    "paintfight",
    "werewolf",
    "airhockey",
    "foosball",
    "spinnerwars",
    "hearts",
    "spades",
    "euchre",
    "blackjack",
    "ginrummy",
    "holdem",
    "ocho",
    "crazy8",
    "gofish",
    "snakes",
    "bankroll",
    "backgammon",
    "dominoes",
    "carrom",
    "pool",
    "cuppong",
    "bowling",
    "darts",
    "minigolf",
    "archery",
];

/// LANX 1.9.0: the admin computer's office settings. Answered with `Ack`
/// whose reason is the colleague's status (waiting | accepted | declined | …).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyPayload {
    pub policy: crate::storage::models::OfficePolicy,
}

/// LANX 1.9.0: a colleague accepted / declined / left the office settings.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PolicyAnswerPayload {
    pub version: i64,
    pub status: String,
}

/// LANX 2.9.0: one step of a game between two colleagues (accepting a
/// challenge, a move, resigning, a rematch…). Answered with `Ack`. The game
/// itself lives in the UI on both computers; LANX only carries the steps.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GamePayload {
    /// The match: the id of the challenge card.
    pub match_id: String,
    /// tictactoe | connect4 | reversi | chess
    pub game: String,
    /// accept | decline | move | resign | rematch | leave | state
    pub action: String,
    /// Counts up within a match, so a step that arrives late or twice is ignored.
    #[serde(default)]
    pub seq: u64,
    /// The step itself (the whole move list, the round number…), small JSON.
    #[serde(default)]
    pub data: serde_json::Value,
    #[serde(default)]
    pub at: i64,
}

/// LANX 1.8.0: an emergency alert. Answered with `Ack`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AlertPayload {
    pub alert_id: String,
    /// raise | ack | clear
    pub action: String,
    /// fire | medical | evacuate | assembly | lockdown | custom
    pub kind: String,
    pub text: String,
    pub at: i64,
    /// For "ack": safe | help
    #[serde(default)]
    pub status: String,
}

/// LANX 1.7.0: shared folders. Answered with `Ack`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SyncPayload {
    /// subscribe | unsubscribe | stopped
    pub action: String,
    pub share_id: String,
}

/// LANX 1.5.0: something done to an existing message, sent to everyone in
/// the chat. Answered with `Ack`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MessageActionPayload {
    pub action_id: String,
    pub message_id: String,
    /// react | edit | delete | pin | unpin
    pub action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    /// react: the emoji ("" takes the reaction back).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub emoji: Option<String>,
    /// edit: the new text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mentions: Vec<String>,
    /// When it was done (unix seconds) — the newest change wins.
    pub at: i64,
    /// LANX 1.6.0 card: which entry changed ("vote:<id>", "status"…)…
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    /// …and its new value (JSON).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
}

/// LANX 1.4.0: someone in a meeting, as the others see them. The address and
/// key let a newcomer reach people it has never met (like group members).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct MeetingPersonPayload {
    pub device_id: String,
    pub name: String,
    #[serde(default)]
    pub avatar_color: String,
    #[serde(default)]
    pub public_key: String,
    #[serde(default)]
    pub ip: String,
    #[serde(default)]
    pub tcp_port: u16,
    #[serde(default)]
    pub muted: bool,
    #[serde(default)]
    pub camera: bool,
    #[serde(default)]
    pub screen: bool,
    #[serde(default)]
    pub hand: bool,
    #[serde(default)]
    pub recording: bool,
}

/// LANX 1.4.0: group meetings. Everyone in a meeting talks to everyone else
/// directly (WebRTC between the LANX windows, no server); these packets carry
/// the invitations, who is in the meeting, each pair's offer/answer, and
/// changes (mute, camera, screen, raised hand, recording, chat).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MeetingPayload {
    pub meeting_id: String,
    /// invite | join | roster | decline | leave | signal | media | chat
    pub action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// The group chat the meeting belongs to (none: invited personally).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub video: Option<bool>,
    /// invite / roster: who is in the meeting.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub people: Vec<MeetingPersonPayload>,
    /// join / media: the sender as they are now.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub person: Option<MeetingPersonPayload>,
    /// signal: "offer" | "answer"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sdp: Option<String>,
    /// chat: the message; decline: why ("busy").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// media: when the change was made (milliseconds), so a late older change
    /// never overwrites a newer one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seq: Option<u64>,
}

/// LANX 1.2.9: a colleague's profile, with its fingerprint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileReplyPayload {
    pub rev: u64,
    pub profile: crate::storage::models::Profile,
}

/// A plain "major.minor.patch" version (what LANX installers are named after).
pub fn valid_version(v: &str) -> bool {
    let parts: Vec<&str> = v.split('.').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.len() <= 5 && p.chars().all(|c| c.is_ascii_digit()))
}

/// `version` is strictly newer than `than`.
pub fn is_newer(version: &str, than: &str) -> bool {
    !version_at_least(than, version)
}

/// `version` (e.g. "1.0.0") is at least `min`.
pub fn version_at_least(version: &str, min: &str) -> bool {
    let parse = |v: &str| -> Vec<u32> {
        v.split(['.', '-', '+'])
            .take(3)
            .map(|p| p.parse().unwrap_or(0))
            .collect()
    };
    let (a, b) = (parse(version), parse(min));
    for i in 0..3 {
        let (x, y) = (a.get(i).copied().unwrap_or(0), b.get(i).copied().unwrap_or(0));
        if x != y {
            return x > y;
        }
    }
    true
}

// New optional fields are skipped when empty so that ordinary messages keep
// the exact 1.0 wire format (1.0 re-serialises payloads to check signatures).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MessagePayload {
    pub message_id: String,
    pub conversation_id: String,
    pub content: String,
    pub message_type: String, // "text" | "secret_setting"
    /// Secret message: delete this many seconds after it is read.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ttl_secs: Option<u32>,
    /// Set for group messages.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    /// LANX 1.5.0 (only sent to 1.5.0 or newer): the message this answers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reply_to: Option<String>,
    /// "Asha: the text…" of that message.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reply_preview: Option<String>,
    /// Device ids @mentioned (group chats).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mentions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadReceiptPayload {
    pub message_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRefPayload {
    /// None = the direct chat with the sender.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GroupMemberPayload {
    pub device_id: String,
    pub display_name: String,
    pub public_key: String,
    pub ip: String,
    pub tcp_port: u16,
    pub avatar_color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupUpdatePayload {
    pub group_id: String,
    pub name: String,
    pub admin_id: String,
    pub version: i64,
    pub avatar_color: String,
    pub members: Vec<GroupMemberPayload>,
}

/// Call set-up (LANX 1.2). The audio/video itself is WebRTC between the two
/// LANX windows; these packets carry the offer/answer and the call's state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallPayload {
    pub call_id: String,
    /// invite | accept | decline | cancel | hangup | media
    pub action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub video: Option<bool>,
    /// WebRTC session description (offer for invite, answer for accept).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sdp: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub muted: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub screen: Option<bool>,
    /// LANX 1.4.0: the sender started / stopped recording the call (only sent
    /// to 1.4.0 or newer, so the other side always sees the notice).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recording: Option<bool>,
    /// LANX 1.8.0 remote help (invites only, to 1.8.0+): "view" = the caller
    /// asks to see the other person's screen; "show" = the caller will show theirs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub help: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AckPayload {
    pub ok: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageAckPayload {
    pub message_id: String,
    pub status: String, // "delivered" | "failed"
    pub db_committed: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileOfferPayload {
    pub transfer_id: String,
    pub file_name: String,
    pub file_size: u64,
    /// Set when the file is shared in a group chat.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    /// LANX 1.2.3: the file is a folder packed as a zip; unpack it on arrival.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder: Option<bool>,
    /// LANX 1.5.0 (only sent to 1.5.0 or newer): "voice" for a voice note.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    /// LANX 1.5.0: a voice note's length in milliseconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media_ms: Option<u64>,
    /// LANX 1.7.0 (only to 1.7.0+): a file of a shared folder…
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sync_id: Option<String>,
    /// …and where in it ("Reports/2026/Q3.xlsx").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sync_path: Option<String>,
    /// LANX 1.8.0 (only to 1.8.0+): a voice note sent on the intercom — it
    /// plays by itself when it arrives.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub intercom: Option<bool>,
}

/// LANX 1.2: "I have the official installer of LANX `version`; pull it with
/// `FileRequest { transfer_id }` if you want it." Answered with
/// `FileOfferAck`. `signature` is the LANX release signature (Ed25519 over
/// version, sha256 and file_size, see `update.rs`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateOfferPayload {
    pub transfer_id: String,
    pub version: String,
    pub file_size: u64,
    /// SHA-256 of the installer, hex encoded.
    pub sha256: String,
    pub signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileOfferAckPayload {
    pub transfer_id: String,
    /// The offer was recorded and is waiting for the recipient to accept it.
    pub accepted: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileRequestPayload {
    pub transfer_id: String,
    /// Resume position: bytes the receiver already holds.
    pub offset: u64,
    /// LANX 1.2.4: the receiver accepts compressed data frames.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compress: Option<bool>,
}

/// LANX 1.2.3: send only bytes `offset..end` of the file on this connection
/// (one of several parallel lanes). Answered like `FileRequest` with
/// `FileStreamStart`, data frames, then `FileRangeEnd`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileRangeRequestPayload {
    pub transfer_id: String,
    pub offset: u64,
    pub end: u64,
    /// LANX 1.2.4: the receiver accepts compressed data frames.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compress: Option<bool>,
}

/// LANX 1.2.3: identifies a transfer (`FileRangeEnd`, `FileRangeFinish`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferRefPayload {
    pub transfer_id: String,
}

/// LANX 1.2.3 network speed test: `start`, data frames, `end`; the receiver
/// answers `result` with the bytes it got.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeedTestPayload {
    pub phase: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileStreamStartPayload {
    pub transfer_id: String,
    pub offset: u64,
    pub file_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileStreamEndPayload {
    pub transfer_id: String,
    /// SHA-256 of the whole file, hex encoded.
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileResultPayload {
    pub transfer_id: String,
    pub ok: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileCancelPayload {
    pub transfer_id: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorPayload {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum PacketPayload {
    Handshake(HandshakePayload),
    HandshakeAck(HandshakePayload),
    Message(MessagePayload),
    MessageAck(MessageAckPayload),
    Ping,
    Pong,
    FileOffer(FileOfferPayload),
    FileOfferAck(FileOfferAckPayload),
    FileRequest(FileRequestPayload),
    FileStreamStart(FileStreamStartPayload),
    FileStreamEnd(FileStreamEndPayload),
    FileResult(FileResultPayload),
    FileCancel(FileCancelPayload),
    Disconnect,
    Error(ErrorPayload),
    // LANX 1.1 (only sent to peers reporting app_version >= 1.1.0)
    ReadReceipt(ReadReceiptPayload),
    Typing(ChatRefPayload),
    Ring(ChatRefPayload),
    GroupUpdate(GroupUpdatePayload),
    GroupLeave(ChatRefPayload),
    Ack(AckPayload),
    // LANX 1.2.3 (only sent to peers reporting app_version >= 1.2.3)
    FileRangeRequest(FileRangeRequestPayload),
    FileRangeEnd(TransferRefPayload),
    FileRangeFinish(TransferRefPayload),
    SpeedTest(SpeedTestPayload),
    // LANX 1.2 (only sent to peers reporting app_version >= 1.2.0)
    UpdateOffer(UpdateOfferPayload),
    Call(CallPayload),
    // LANX 1.2.9 (only sent to peers reporting app_version >= 1.2.9)
    ProfileRequest,
    ProfileReply(ProfileReplyPayload),
    // LANX 1.4.0 (only sent to peers reporting app_version >= 1.4.0)
    Meeting(MeetingPayload),
    // LANX 1.5.0 (only sent to peers reporting app_version >= 1.5.0)
    MessageAction(MessageActionPayload),
    // LANX 1.7.0 (only sent to peers reporting app_version >= 1.7.0)
    Sync(SyncPayload),
    // LANX 1.8.0 (only sent to peers reporting app_version >= 1.8.0)
    Alert(AlertPayload),
    // LANX 1.9.0 (only sent to peers reporting app_version >= 1.9.0)
    Policy(PolicyPayload),
    PolicyAnswer(PolicyAnswerPayload),
    // LANX 2.9.0 (only sent to peers reporting app_version >= 2.9.0)
    Game(GamePayload),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PacketEnvelope {
    pub version: u8,
    pub packet_id: String,
    pub correlation_id: Option<String>,
    pub sender_id: String,
    pub sender_name: String,
    pub sender_pubkey: String,
    pub timestamp: i64,
    pub signature: String,
    pub payload: PacketPayload,
}

impl PacketEnvelope {
    pub fn new(
        identity: &DeviceIdentity,
        sender_name: &str,
        correlation_id: Option<String>,
        payload: PacketPayload,
    ) -> Self {
        let packet_id = Uuid::new_v4().to_string();
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let sender_id = identity.device_id.clone();

        let signing_content = Self::compute_signing_bytes(
            PROTOCOL_VERSION,
            &packet_id,
            correlation_id.as_deref(),
            &sender_id,
            sender_name,
            timestamp,
            &payload,
        );
        let signature = identity.sign_bytes(&signing_content);

        Self {
            version: PROTOCOL_VERSION,
            packet_id,
            correlation_id,
            sender_id,
            sender_name: sender_name.to_string(),
            sender_pubkey: identity.public_key_hex(),
            timestamp,
            signature,
            payload,
        }
    }

    /// Unambiguous signing input: a JSON array of every field except the
    /// signature and the public key (which verifies it).
    pub fn compute_signing_bytes(
        version: u8,
        packet_id: &str,
        correlation_id: Option<&str>,
        sender_id: &str,
        sender_name: &str,
        timestamp: i64,
        payload: &PacketPayload,
    ) -> Vec<u8> {
        let mut out = b"LANX-PACKET-V2".to_vec();
        let body = serde_json::to_vec(&(
            version,
            packet_id,
            correlation_id,
            sender_id,
            sender_name,
            timestamp,
            payload,
        ))
        .unwrap_or_default();
        out.extend_from_slice(&body);
        out
    }

    pub fn verify_signature(&self) -> Result<bool, String> {
        if self.version != PROTOCOL_VERSION {
            return Err(format!(
                "Unsupported protocol version: got {}, expected {}",
                self.version, PROTOCOL_VERSION
            ));
        }

        let signing_bytes = Self::compute_signing_bytes(
            self.version,
            &self.packet_id,
            self.correlation_id.as_deref(),
            &self.sender_id,
            &self.sender_name,
            self.timestamp,
            &self.payload,
        );

        DeviceIdentity::verify_signature(&self.sender_pubkey, &signing_bytes, &self.signature)
    }
}

// Plaintext framing, used only for the handshake before encryption starts.
pub async fn write_framed_packet<W: AsyncWrite + Unpin>(
    writer: &mut W,
    packet: &PacketEnvelope,
) -> io::Result<()> {
    let json_bytes = serde_json::to_vec(packet).map_err(|e| {
        Error::new(
            ErrorKind::InvalidData,
            format!("Serialization error: {}", e),
        )
    })?;

    if json_bytes.len() > MAX_FRAME_SIZE {
        return Err(Error::new(
            ErrorKind::InvalidData,
            format!("Packet exceeds max frame size of {} bytes", MAX_FRAME_SIZE),
        ));
    }

    let len_prefix = (json_bytes.len() as u32).to_be_bytes();
    writer.write_all(&len_prefix).await?;
    writer.write_all(&json_bytes).await?;
    writer.flush().await?;
    Ok(())
}

pub async fn read_framed_packet<R: AsyncRead + Unpin>(
    reader: &mut R,
) -> io::Result<PacketEnvelope> {
    let mut len_buf = [0u8; 4];
    reader.read_exact(&mut len_buf).await?;
    let length = u32::from_be_bytes(len_buf) as usize;

    if length == 0 {
        return Err(Error::new(ErrorKind::UnexpectedEof, "Frame length is zero"));
    }

    if length > MAX_FRAME_SIZE {
        return Err(Error::new(
            ErrorKind::InvalidData,
            format!(
                "Frame length {} exceeds strict maximum limit {}",
                length, MAX_FRAME_SIZE
            ),
        ));
    }

    let mut body_buf = vec![0u8; length];
    reader.read_exact(&mut body_buf).await?;

    let packet: PacketEnvelope = serde_json::from_slice(&body_buf).map_err(|e| {
        Error::new(
            ErrorKind::InvalidData,
            format!("Deserialization error: {}", e),
        )
    })?;

    Ok(packet)
}
