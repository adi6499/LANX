use crate::security::DeviceIdentity;
use serde::{Deserialize, Serialize};
use std::io::{self, Error, ErrorKind};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use uuid::Uuid;

pub const PROTOCOL_VERSION: u8 = 1;
pub const MAX_FRAME_SIZE: usize = 65536; // 64 KB strict maximum payload frame
pub const MAX_MESSAGE_CONTENT_LEN: usize = 4096;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PacketType {
    Hello,
    HelloAck,
    Message,
    MessageAck,
    Ping,
    Pong,
    Disconnect,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelloPayload {
    pub hostname: String,
    pub tcp_port: u16,
    pub avatar_color: String,
    pub protocol_version: u8,
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
pub struct ErrorPayload {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data")]
pub enum PacketPayload {
    Hello(HelloPayload),
    HelloAck(HelloPayload),
    Message(MessagePayload),
    MessageAck(MessageAckPayload),
    Ping,
    Pong,
    Disconnect,
    Error(ErrorPayload),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PacketEnvelope {
    pub version: u8,
    pub packet_id: String,
    pub correlation_id: Option<String>,
    pub packet_type: PacketType,
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
        packet_type: PacketType,
        correlation_id: Option<String>,
        payload: PacketPayload,
    ) -> Self {
        let packet_id = Uuid::new_v4().to_string();
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let sender_id = identity.device_id.clone();
        let sender_pubkey = identity.public_key_hex();

        let signing_content = Self::compute_signing_bytes(
            PROTOCOL_VERSION,
            &packet_id,
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
            packet_type,
            sender_id,
            sender_name: sender_name.to_string(),
            sender_pubkey,
            timestamp,
            signature,
            payload,
        }
    }

    pub fn compute_signing_bytes(
        version: u8,
        packet_id: &str,
        sender_id: &str,
        sender_name: &str,
        timestamp: i64,
        payload: &PacketPayload,
    ) -> Vec<u8> {
        let payload_json = serde_json::to_string(payload).unwrap_or_default();
        format!(
            "LANX-V{}:{}:{}:{}:{}:{}",
            version, packet_id, sender_id, sender_name, timestamp, payload_json
        )
        .into_bytes()
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
            &self.sender_id,
            &self.sender_name,
            self.timestamp,
            &self.payload,
        );

        DeviceIdentity::verify_signature(&self.sender_pubkey, &signing_bytes, &self.signature)
    }
}

// Framing helpers
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
