//! The live connection between a phone and this PC: a WebSocket (RFC 6455)
//! carrying JSON lines both ways. Written out here (handshake, frames, pings)
//! rather than pulled in as a library — it is a page of code.
//!
//! The phone's first message must be `{"op":"auth","token":…}`; after that it
//! asks for things (api.rs) and is told about new messages as they happen.

use super::PhoneService;
use super::api::{self, Client};
use base64::Engine;
use sha1::{Digest, Sha1};
use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, ReadBuf};
use tokio::sync::mpsc;

const GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
/// A single frame or an assembled message may be this big.
const MAX_MESSAGE: usize = 4 * 1024 * 1024;
const AUTH_WAIT: Duration = Duration::from_secs(10);
const PING_EVERY: Duration = Duration::from_secs(30);
/// No frame at all (not even a pong) for this long: the phone is gone.
const DEAD_AFTER: Duration = Duration::from_secs(95);

pub const OP_CONT: u8 = 0;
pub const OP_TEXT: u8 = 1;
pub const OP_BINARY: u8 = 2;
pub const OP_CLOSE: u8 = 8;
pub const OP_PING: u8 = 9;
pub const OP_PONG: u8 = 10;

/// Sec-WebSocket-Accept for a client key.
pub fn accept_key(key: &str) -> String {
    let digest = Sha1::digest(format!("{}{}", key.trim(), GUID).as_bytes());
    base64::engine::general_purpose::STANDARD.encode(digest)
}

/// A server frame (never masked). `mask` is for the test client.
pub fn encode_frame(opcode: u8, payload: &[u8], mask: Option<[u8; 4]>) -> Vec<u8> {
    let mut out = Vec::with_capacity(payload.len() + 14);
    out.push(0x80 | (opcode & 0x0f));
    let mask_bit = if mask.is_some() { 0x80 } else { 0 };
    let len = payload.len();
    if len < 126 {
        out.push(mask_bit | len as u8);
    } else if len <= u16::MAX as usize {
        out.push(mask_bit | 126);
        out.extend_from_slice(&(len as u16).to_be_bytes());
    } else {
        out.push(mask_bit | 127);
        out.extend_from_slice(&(len as u64).to_be_bytes());
    }
    match mask {
        Some(m) => {
            out.extend_from_slice(&m);
            out.extend(payload.iter().enumerate().map(|(i, b)| b ^ m[i % 4]));
        }
        None => out.extend_from_slice(payload),
    }
    out
}

/// One frame: (opcode, fin, payload), unmasked.
pub async fn read_frame<R: AsyncRead + Unpin>(r: &mut R) -> std::io::Result<(u8, bool, Vec<u8>)> {
    let mut h = [0u8; 2];
    r.read_exact(&mut h).await?;
    let fin = h[0] & 0x80 != 0;
    let opcode = h[0] & 0x0f;
    let masked = h[1] & 0x80 != 0;
    let mut len = (h[1] & 0x7f) as u64;
    if len == 126 {
        let mut b = [0u8; 2];
        r.read_exact(&mut b).await?;
        len = u16::from_be_bytes(b) as u64;
    } else if len == 127 {
        let mut b = [0u8; 8];
        r.read_exact(&mut b).await?;
        len = u64::from_be_bytes(b);
    }
    if len > MAX_MESSAGE as u64 {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "frame too large"));
    }
    let mask = if masked {
        let mut m = [0u8; 4];
        r.read_exact(&mut m).await?;
        Some(m)
    } else {
        None
    };
    let mut payload = vec![0u8; len as usize];
    r.read_exact(&mut payload).await?;
    if let Some(m) = mask {
        for (i, b) in payload.iter_mut().enumerate() {
            *b ^= m[i % 4];
        }
    }
    Ok((opcode, fin, payload))
}

/// Bytes that arrived with the HTTP head, then the socket.
pub struct Prefixed<R> {
    pre: Vec<u8>,
    pos: usize,
    inner: R,
}

impl<R> Prefixed<R> {
    pub fn new(pre: Vec<u8>, inner: R) -> Self {
        Self { pre, pos: 0, inner }
    }
}

impl<R: AsyncRead + Unpin> AsyncRead for Prefixed<R> {
    fn poll_read(self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &mut ReadBuf<'_>) -> Poll<std::io::Result<()>> {
        let this = self.get_mut();
        if this.pos < this.pre.len() {
            let n = buf.remaining().min(this.pre.len() - this.pos);
            buf.put_slice(&this.pre[this.pos..this.pos + n]);
            this.pos += n;
            return Poll::Ready(Ok(()));
        }
        Pin::new(&mut this.inner).poll_read(cx, buf)
    }
}

/// What the writer task sends besides text lines.
enum Control {
    Pong(Vec<u8>),
    Close,
}

/// Reads whole messages (text), answering pings and assembling fragments.
/// Returns None when the phone closed or the connection broke.
async fn next_text<R: AsyncRead + Unpin>(r: &mut R, ctl: &mpsc::UnboundedSender<Control>) -> Option<String> {
    let mut pending: Option<Vec<u8>> = None;
    loop {
        let (opcode, fin, payload) = match tokio::time::timeout(DEAD_AFTER, read_frame(r)).await {
            Ok(Ok(f)) => f,
            _ => return None,
        };
        match opcode {
            OP_TEXT | OP_BINARY => {
                if opcode == OP_BINARY {
                    return None; // the phone only ever sends JSON
                }
                if fin {
                    return String::from_utf8(payload).ok();
                }
                pending = Some(payload);
            }
            OP_CONT => {
                let Some(mut p) = pending.take() else { return None };
                if p.len() + payload.len() > MAX_MESSAGE {
                    return None;
                }
                p.extend_from_slice(&payload);
                if fin {
                    return String::from_utf8(p).ok();
                }
                pending = Some(p);
            }
            OP_PING => {
                let _ = ctl.send(Control::Pong(payload));
            }
            OP_PONG => {}
            OP_CLOSE => {
                let _ = ctl.send(Control::Close);
                return None;
            }
            _ => return None,
        }
    }
}

/// Finishes the handshake and runs the connection until the phone leaves.
/// The connection is the bare socket or (LANX 3.2) one wrapped in TLS.
pub(super) async fn serve<S: AsyncRead + AsyncWrite + Unpin + Send + 'static>(svc: PhoneService, mut stream: S, leftover: Vec<u8>, key: &str, ip: String) {
    let head = format!(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {}\r\n\r\n",
        accept_key(key)
    );
    if stream.write_all(head.as_bytes()).await.is_err() {
        return;
    }
    let (rd, mut wr) = tokio::io::split(stream);
    let mut reader = Prefixed::new(leftover, rd);

    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    let (ctl_tx, mut ctl_rx) = mpsc::unbounded_channel::<Control>();
    let writer_cancel = tokio_util::sync::CancellationToken::new();
    let writer_stop = writer_cancel.clone();
    let writer = tokio::spawn(async move {
        let mut ping = tokio::time::interval(PING_EVERY);
        ping.tick().await;
        loop {
            tokio::select! {
                _ = writer_stop.cancelled() => {
                    let _ = wr.write_all(&encode_frame(OP_CLOSE, &1000u16.to_be_bytes(), None)).await;
                    break;
                }
                msg = rx.recv() => match msg {
                    Some(text) => {
                        if wr.write_all(&encode_frame(OP_TEXT, text.as_bytes(), None)).await.is_err() { break; }
                    }
                    None => break,
                },
                c = ctl_rx.recv() => match c {
                    Some(Control::Pong(p)) => {
                        if wr.write_all(&encode_frame(OP_PONG, &p, None)).await.is_err() { break; }
                    }
                    Some(Control::Close) | None => {
                        let _ = wr.write_all(&encode_frame(OP_CLOSE, &1000u16.to_be_bytes(), None)).await;
                        break;
                    }
                },
                _ = ping.tick() => {
                    if wr.write_all(&encode_frame(OP_PING, b"lanx", None)).await.is_err() { break; }
                }
            }
        }
        let _ = wr.shutdown().await;
    });

    // First message: the token.
    let device = match tokio::time::timeout(AUTH_WAIT, next_text(&mut reader, &ctl_tx)).await {
        Ok(Some(text)) => {
            let v: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
            let id = v.get("id").cloned().unwrap_or(serde_json::Value::Null);
            let token = v["token"].as_str().unwrap_or("");
            match (v["op"].as_str(), svc.device_for_token(token)) {
                (Some("auth"), Some(d)) => {
                    let _ = tx.send(serde_json::json!({ "id": id, "ok": true, "device": d.name, "version": svc.app_version }).to_string());
                    Some(d)
                }
                _ => {
                    let _ = tx.send(serde_json::json!({ "id": id, "ok": false, "error": "unauthorized" }).to_string());
                    None
                }
            }
        }
        _ => None,
    };
    let Some(device) = device else {
        tokio::time::sleep(Duration::from_millis(50)).await;
        writer_cancel.cancel();
        let _ = writer.await;
        return;
    };

    let (client_id, cancel) = svc.register_client(&device.id, tx.clone());
    let client = Client { id: client_id, device: device.clone(), ip };

    // Everything the desktop window hears about, the phone hears too.
    let forward_cancel = cancel.clone();
    let forward_svc = svc.clone();
    let forward_tx = tx.clone();
    let forward = tokio::spawn(async move {
        let Some(mut events) = forward_svc.network.events.subscribe() else { return };
        loop {
            tokio::select! {
                _ = forward_cancel.cancelled() => break,
                ev = events.recv() => match ev {
                    Ok(ev) => {
                        if let Some(line) = api::map_event(&forward_svc, &ev.0, &ev.1) {
                            if forward_tx.send(line).is_err() { break; }
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        let _ = forward_tx.send(serde_json::json!({ "ev": "reload" }).to_string());
                    }
                    Err(_) => break,
                }
            }
        }
    });

    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            text = next_text(&mut reader, &ctl_tx) => match text {
                Some(text) => {
                    let reply = api::handle_op(&svc, &client, &text).await;
                    if tx.send(reply).is_err() { break; }
                }
                None => break,
            }
        }
    }

    forward.abort();
    svc.unregister_client(client_id);
    writer_cancel.cancel();
    let _ = writer.await;
}
