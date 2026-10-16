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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessagePayload {
    pub message_id: String,
    pub conversation_id: String,
    pub content: String,
    pub message_type: String, // "text"
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
