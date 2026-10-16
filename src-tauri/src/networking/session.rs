//! Encrypted, authenticated TCP sessions between two LANX devices.
//!
//! 1. Client and server exchange signed `Handshake` / `HandshakeAck` packets in
//!    plaintext frames. Each carries a fresh X25519 public key, signed with the
//!    device's long-term Ed25519 identity, so a man-in-the-middle cannot swap keys.
//! 2. Both sides derive two ChaCha20-Poly1305 keys (one per direction) with
//!    HKDF-SHA256 over the X25519 shared secret.
//! 3. Every later frame is `[u32 length][ciphertext]`, using a per-direction
//!    frame counter as the nonce, so replayed, reordered or altered frames fail
//!    to decrypt.

use super::protocol::*;
use crate::security::DeviceIdentity;
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use hkdf::Hkdf;
use rand::rngs::OsRng;
use sha2::Sha256;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use x25519_dalek::{EphemeralSecret, PublicKey};

const FRAME_PACKET: u8 = 1;
const FRAME_DATA: u8 = 2;
/// Largest ciphertext frame accepted (one file chunk plus headroom).
const MAX_SECURE_FRAME: usize = FILE_CHUNK_SIZE + 64 * 1024;
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(8);

/// What this device tells the other side about itself.
#[derive(Debug, Clone)]
pub struct LocalProfile {
    pub display_name: String,
    pub hostname: String,
    pub tcp_port: u16,
    pub avatar_color: String,
    /// The LANX version this device reports (decides which packets it gets).
    pub app_version: String,
}

/// The verified identity of the device at the other end of a session.
#[derive(Debug, Clone)]
pub struct RemotePeer {
    pub device_id: String,
    pub display_name: String,
    pub public_key: String,
    pub hostname: String,
    pub tcp_port: u16,
    pub avatar_color: String,
    pub app_version: String,
    pub ip: String,
}

/// Who the client expects to reach (pinned identity), if known.
#[derive(Debug, Clone, Default)]
pub struct ExpectedPeer {
    pub device_id: Option<String>,
    pub public_key: Option<String>,
}

pub enum Frame {
    Packet(PacketEnvelope),
    Data(Vec<u8>),
}

pub struct SecureChannel {
    stream: TcpStream,
    send_cipher: ChaCha20Poly1305,
    recv_cipher: ChaCha20Poly1305,
    send_counter: u64,
    recv_counter: u64,
    identity: DeviceIdentity,
    local_name: String,
    pub remote: RemotePeer,
}

fn handshake_payload(eph: &PublicKey, me: &LocalProfile) -> HandshakePayload {
    HandshakePayload {
        ephemeral_key: hex::encode(eph.as_bytes()),
        hostname: me.hostname.clone(),
        tcp_port: me.tcp_port,
        avatar_color: me.avatar_color.clone(),
        app_version: me.app_version.clone(),
    }
}

fn parse_public_key(hex_key: &str) -> Result<PublicKey, String> {
    let bytes = hex::decode(hex_key).map_err(|_| "Malformed handshake key".to_string())?;
    let arr: [u8; 32] = bytes
        .try_into()
        .map_err(|_| "Handshake key must be 32 bytes".to_string())?;
    Ok(PublicKey::from(arr))
}

/// Returns (client_to_server_key, server_to_client_key).
/// Big socket buffers so a single connection can keep a fast network busy
/// (Windows' defaults can hold a Wi-Fi link to a few MB/s).
fn tune_socket(stream: &TcpStream) {
    let sock = socket2::SockRef::from(stream);
    let _ = sock.set_send_buffer_size(4 * 1024 * 1024);
    let _ = sock.set_recv_buffer_size(4 * 1024 * 1024);
}

fn derive_keys(
    secret: EphemeralSecret,
    their: &PublicKey,
    client_pub: &PublicKey,
    server_pub: &PublicKey,
) -> Result<([u8; 32], [u8; 32]), String> {
    let shared = secret.diffie_hellman(their);
    if !shared.was_contributory() {
        return Err("Rejected weak handshake key".to_string());
    }
    let mut salt = Vec::with_capacity(64);
    salt.extend_from_slice(client_pub.as_bytes());
    salt.extend_from_slice(server_pub.as_bytes());
    let hk = Hkdf::<Sha256>::new(Some(&salt), shared.as_bytes());
    let mut okm = [0u8; 64];
    hk.expand(b"LANX v2 session keys", &mut okm)
        .map_err(|_| "Key derivation failed".to_string())?;
    let mut c2s = [0u8; 32];
    let mut s2c = [0u8; 32];
    c2s.copy_from_slice(&okm[..32]);
    s2c.copy_from_slice(&okm[32..]);
    Ok((c2s, s2c))
}

fn remote_from(envelope: &PacketEnvelope, hs: &HandshakePayload, ip: String) -> RemotePeer {
    RemotePeer {
        device_id: envelope.sender_id.clone(),
        display_name: envelope.sender_name.clone(),
        public_key: envelope.sender_pubkey.clone(),
        hostname: hs.hostname.clone(),
        tcp_port: hs.tcp_port,
        avatar_color: hs.avatar_color.clone(),
        app_version: hs.app_version.clone(),
        ip,
    }
}

pub fn normalize_ip(addr: &std::net::SocketAddr) -> String {
    match addr {
        std::net::SocketAddr::V4(v4) => {
            let s = v4.ip().to_string();
            if s.starts_with("127.") { "127.0.0.1".to_string() } else { s }
        }
        std::net::SocketAddr::V6(v6) => match v6.ip().to_ipv4_mapped() {
            Some(v4) => v4.to_string(),
            None => v6.ip().to_string(),
        },
    }
}

impl SecureChannel {
    /// Connects to `addr` and runs the client side of the handshake.
    pub async fn connect(
        addr: &str,
        identity: &DeviceIdentity,
        me: &LocalProfile,
        expected: &ExpectedPeer,
        connect_timeout: Duration,
    ) -> Result<SecureChannel, String> {
        let mut stream = match tokio::time::timeout(connect_timeout, TcpStream::connect(addr)).await
        {
            Ok(Ok(s)) => s,
            Ok(Err(e)) => return Err(format!("Could not reach {} ({})", addr, e.kind())),
            Err(_) => return Err(format!("{} did not answer (timed out)", addr)),
        };
        let _ = stream.set_nodelay(true);
        tune_socket(&stream);
        let remote_ip = stream
            .peer_addr()
            .map(|a| normalize_ip(&a))
            .unwrap_or_else(|_| addr.to_string());

        let secret = EphemeralSecret::random_from_rng(OsRng);
        let my_pub = PublicKey::from(&secret);
        let hello = PacketEnvelope::new(
            identity,
            &me.display_name,
            None,
            PacketPayload::Handshake(handshake_payload(&my_pub, me)),
        );
        write_framed_packet(&mut stream, &hello)
            .await
            .map_err(|e| format!("Handshake send failed: {}", e))?;

        let reply = match tokio::time::timeout(HANDSHAKE_TIMEOUT, read_framed_packet(&mut stream))
            .await
        {
            Ok(Ok(p)) => p,
            Ok(Err(e)) => return Err(format!("Handshake failed: {}", e)),
            Err(_) => return Err("Handshake timed out".to_string()),
        };
        if reply.version != PROTOCOL_VERSION {
            return Err("The other computer runs an incompatible LANX version. Update both to the latest LANX.".to_string());
        }
        if reply.verify_signature() != Ok(true) {
            return Err("Handshake signature invalid".to_string());
        }
        if reply.correlation_id.as_deref() != Some(hello.packet_id.as_str()) {
            return Err("Handshake reply did not match our request".to_string());
        }
        let hs = match &reply.payload {
            PacketPayload::HandshakeAck(h) => h.clone(),
            PacketPayload::Error(e) => return Err(e.message.clone()),
            _ => return Err("Unexpected handshake reply".to_string()),
        };
        if reply.sender_id == identity.device_id {
            return Err("That address is this computer.".to_string());
        }
        if let Some(id) = &expected.device_id {
            if &reply.sender_id != id {
                return Err("A different LANX device answered at this address (its IP may have changed). Waiting for it to be discovered again.".to_string());
            }
        }
        if let Some(pk) = &expected.public_key {
            if &reply.sender_pubkey != pk {
                return Err("Security warning: this device's identity key changed. Connection refused.".to_string());
            }
        }

        let their_pub = parse_public_key(&hs.ephemeral_key)?;
        let (c2s, s2c) = derive_keys(secret, &their_pub, &my_pub, &their_pub)?;

        Ok(SecureChannel {
            stream,
            send_cipher: ChaCha20Poly1305::new(Key::from_slice(&c2s)),
            recv_cipher: ChaCha20Poly1305::new(Key::from_slice(&s2c)),
            send_counter: 0,
            recv_counter: 0,
            identity: identity.clone(),
            local_name: me.display_name.clone(),
            remote: remote_from(&reply, &hs, remote_ip),
        })
    }

    /// Runs the server side of the handshake on an accepted connection.
    /// `policy` may refuse the remote device (blocked, key mismatch, ...).
    pub async fn accept<F>(
        mut stream: TcpStream,
        identity: &DeviceIdentity,
        me: &LocalProfile,
        policy: F,
    ) -> Result<SecureChannel, String>
    where
        F: FnOnce(&PacketEnvelope) -> Result<(), (String, String)>,
    {
        let _ = stream.set_nodelay(true);
        tune_socket(&stream);
        let remote_ip = stream
            .peer_addr()
            .map(|a| normalize_ip(&a))
            .unwrap_or_default();

        let hello = match tokio::time::timeout(HANDSHAKE_TIMEOUT, read_framed_packet(&mut stream))
            .await
        {
            Ok(Ok(p)) => p,
            Ok(Err(e)) => return Err(format!("Handshake read failed: {}", e)),
            Err(_) => return Err("Handshake timed out".to_string()),
        };

        let refuse = |code: &str, message: &str, correlation: Option<String>| {
            PacketEnvelope::new(
                identity,
                &me.display_name,
                correlation,
                PacketPayload::Error(ErrorPayload {
                    code: code.to_string(),
                    message: message.to_string(),
                }),
            )
        };

        if hello.version != PROTOCOL_VERSION {
            let _ = write_framed_packet(
                &mut stream,
                &refuse(
                    "VERSION",
                    "Incompatible LANX version. Update both computers to the latest LANX.",
                    Some(hello.packet_id.clone()),
                ),
            )
            .await;
            return Err(format!("Peer uses protocol v{}", hello.version));
        }
        if hello.verify_signature() != Ok(true) {
            return Err("Rejected handshake with invalid signature".to_string());
        }
        let hs = match &hello.payload {
            PacketPayload::Handshake(h) => h.clone(),
            _ => return Err("First packet was not a handshake".to_string()),
        };
        if hello.sender_id == identity.device_id {
            let _ = write_framed_packet(
                &mut stream,
                &refuse("SELF", "That address is this computer.", Some(hello.packet_id.clone())),
            )
            .await;
            return Err("Refused connection from self".to_string());
        }
        if let Err((code, message)) = policy(&hello) {
            let _ = write_framed_packet(
                &mut stream,
                &refuse(&code, &message, Some(hello.packet_id.clone())),
            )
            .await;
            return Err(format!("Refused peer {}: {}", hello.sender_id, code));
        }

        let their_pub = parse_public_key(&hs.ephemeral_key)?;
        let secret = EphemeralSecret::random_from_rng(OsRng);
        let my_pub = PublicKey::from(&secret);
        let ack = PacketEnvelope::new(
            identity,
            &me.display_name,
            Some(hello.packet_id.clone()),
            PacketPayload::HandshakeAck(handshake_payload(&my_pub, me)),
        );
        write_framed_packet(&mut stream, &ack)
            .await
            .map_err(|e| format!("Handshake reply failed: {}", e))?;

        let (c2s, s2c) = derive_keys(secret, &their_pub, &their_pub, &my_pub)?;

        Ok(SecureChannel {
            stream,
            send_cipher: ChaCha20Poly1305::new(Key::from_slice(&s2c)),
            recv_cipher: ChaCha20Poly1305::new(Key::from_slice(&c2s)),
            send_counter: 0,
            recv_counter: 0,
            identity: identity.clone(),
            local_name: me.display_name.clone(),
            remote: remote_from(&hello, &hs, remote_ip),
        })
    }

    fn nonce(counter: u64) -> [u8; 12] {
        let mut n = [0u8; 12];
        n[4..].copy_from_slice(&counter.to_be_bytes());
        n
    }

    async fn write_frame(&mut self, kind: u8, body: &[u8]) -> Result<(), String> {
        let mut plain = Vec::with_capacity(body.len() + 1);
        plain.push(kind);
        plain.extend_from_slice(body);
        let nonce = Self::nonce(self.send_counter);
        let cipher = self
            .send_cipher
            .encrypt(Nonce::from_slice(&nonce), plain.as_slice())
            .map_err(|_| "Encryption failed".to_string())?;
        self.send_counter += 1;

        let mut out = Vec::with_capacity(cipher.len() + 4);
        out.extend_from_slice(&(cipher.len() as u32).to_be_bytes());
        out.extend_from_slice(&cipher);
        self.stream
            .write_all(&out)
            .await
            .map_err(|e| format!("Connection lost while sending ({})", e.kind()))
    }

    /// Builds, signs and sends a packet over the encrypted session.
    pub async fn send(
        &mut self,
        payload: PacketPayload,
        correlation_id: Option<String>,
    ) -> Result<PacketEnvelope, String> {
        let pkt = PacketEnvelope::new(&self.identity, &self.local_name, correlation_id, payload);
        let json = serde_json::to_vec(&pkt).map_err(|e| e.to_string())?;
        self.write_frame(FRAME_PACKET, &json).await?;
        Ok(pkt)
    }

    pub async fn send_data(&mut self, data: &[u8]) -> Result<(), String> {
        self.write_frame(FRAME_DATA, data).await
    }

    pub async fn flush(&mut self) -> Result<(), String> {
        self.stream.flush().await.map_err(|e| e.to_string())
    }

    pub async fn recv_frame(&mut self) -> Result<Frame, String> {
        let mut len_buf = [0u8; 4];
        self.stream
            .read_exact(&mut len_buf)
            .await
            .map_err(|e| format!("Connection closed ({})", e.kind()))?;
        let len = u32::from_be_bytes(len_buf) as usize;
        if len < 17 || len > MAX_SECURE_FRAME {
            return Err(format!("Invalid encrypted frame length {}", len));
        }
        let mut body = vec![0u8; len];
        self.stream
            .read_exact(&mut body)
            .await
            .map_err(|e| format!("Connection closed ({})", e.kind()))?;
        let nonce = Self::nonce(self.recv_counter);
        let plain = self
            .recv_cipher
            .decrypt(Nonce::from_slice(&nonce), body.as_slice())
            .map_err(|_| "Encrypted frame failed authentication".to_string())?;
        self.recv_counter += 1;

        match plain.first() {
            Some(&FRAME_PACKET) => {
                let pkt: PacketEnvelope = serde_json::from_slice(&plain[1..])
                    .map_err(|e| format!("Malformed packet: {}", e))?;
                if pkt.sender_id != self.remote.device_id
                    || pkt.sender_pubkey != self.remote.public_key
                    || pkt.verify_signature() != Ok(true)
                {
                    return Err("Packet identity does not match session".to_string());
                }
                Ok(Frame::Packet(pkt))
            }
            Some(&FRAME_DATA) => Ok(Frame::Data(plain[1..].to_vec())),
            _ => Err("Unknown frame type".to_string()),
        }
    }

    /// Receives the next control packet; a data frame here is a protocol error.
    pub async fn recv_packet(&mut self) -> Result<PacketEnvelope, String> {
        match self.recv_frame().await? {
            Frame::Packet(p) => Ok(p),
            Frame::Data(_) => Err("Unexpected file data".to_string()),
        }
    }

    pub async fn recv_packet_timeout(&mut self, t: Duration) -> Result<PacketEnvelope, String> {
        match tokio::time::timeout(t, self.recv_packet()).await {
            Ok(r) => r,
            Err(_) => Err("Timed out waiting for reply".to_string()),
        }
    }

    pub async fn close(mut self) {
        let _ = self.send(PacketPayload::Disconnect, None).await;
        let _ = self.stream.shutdown().await;
    }
}
