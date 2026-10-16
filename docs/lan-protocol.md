# LANX Network & Messaging Protocol Specification (v1.0)

## 1. Overview

LANX implements a decentralized, serverless local-network protocol designed for secure, low-latency communication across computers on the same subnet (or reachable via manual IP routing).

The system consists of two protocol layers:
1. **UDP Discovery Protocol (Port 52925)**: Unicast/Broadcast beacon discovery for zero-configuration peer presence and IP/Port resolution.
2. **TCP Messaging & Transfer Protocol (Port 52926)**: Point-to-point, length-prefixed, authenticated communication for direct text messages and file transfers.

---

## 2. Binary Framing

To prevent buffer overflow, denial of service, and memory exhaustion attacks, all TCP socket communications use a strict length-prefixed frame:

```
+---------------------------+----------------------------------------------+
| Field                     | Size / Format                                |
+---------------------------+----------------------------------------------+
| Length Prefix             | 4 Bytes (32-bit unsigned integer, Big-Endian)|
| Packet Envelope (JSON)    | Length Bytes (UTF-8 Encoded JSON)            |
+---------------------------+----------------------------------------------+
```

### Strict Bounded Limits
- **Maximum Frame Size (`MAX_FRAME_SIZE`)**: `65,536` bytes (64 KB).
- Any incoming packet with an advertised length prefix greater than `65,536` or equal to `0` triggers immediate socket termination.
- **Maximum Text Message Length**: `4,096` characters.

---

## 3. Packet Envelope Schema

Every packet sent across the TCP connection is serialized as a JSON envelope containing cryptographic provenance:

```json
{
  "version": 1,
  "packet_id": "4f57a3e8-5690-410a-8bf8-028bb45e1b21",
  "correlation_id": "optional-request-packet-uuid",
  "packet_type": "message",
  "sender_id": "device-uuid-v4",
  "sender_name": "Alice Vance",
  "sender_pubkey": "64-character hex Ed25519 public key",
  "timestamp": 1774883400,
  "signature": "128-character hex Ed25519 digital signature",
  "payload": {
    "kind": "message",
    "data": {
      "message_id": "msg-uuid-v4",
      "conversation_id": "conv-uuid-v4",
      "content": "Hello from Alice!",
      "message_type": "text"
    }
  }
}
```

---

## 4. Cryptographic Identity & Signature Verification

1. **Persistent Device Keypair**: Each LANX node generates an **Ed25519** signing keypair during first run, saved in the local SQLite `settings` table (`identity_secret_key` and `identity_public_key`).
2. **Signing String**: The digital signature is computed over the deterministic string:
   ```
   LANX-V{version}:{packet_id}:{sender_id}:{sender_name}:{timestamp}:{payload_json}
   ```
3. **Verification**: The receiver verifies the Ed25519 signature against `sender_pubkey`. Packets with invalid signatures are discarded immediately.
4. **Key Change Warning**: When a packet arrives from a known `sender_id`, the receiver cross-references `sender_pubkey` with the SQLite `peers.public_key` column:
   - If `public_key` matches: Verified.
   - If `public_key` differs: Generates a **Security Alert (Key Mismatch)** and forces the peer's `trust_state` to `unverified`.

---

## 5. Packet Types & Handshake

### `hello` / `hello_ack`
Sent upon establishing a connection to exchange protocol capabilities, display name, and avatar color:
```json
{
  "kind": "hello",
  "data": {
    "hostname": "DESKTOP-ALICE",
    "tcp_port": 52926,
    "avatar_color": "#0284c7",
    "protocol_version": 1
  }
}
```

### `message`
Transmits a text payload:
```json
{
  "kind": "message",
  "data": {
    "message_id": "d9818815-5e5d-4f1b-a131-b66e1471d43a",
    "conversation_id": "conv-101",
    "content": "Meeting at 2pm in conference room B",
    "message_type": "text"
  }
}
```

### `message_ack` (Transactional Delivery Guarantee)
The receiving peer writes the incoming message to SQLite within a database transaction. **Only after the database transaction successfully commits**, the receiver returns `message_ack`:
```json
{
  "kind": "message_ack",
  "data": {
    "message_id": "d9818815-5e5d-4f1b-a131-b66e1471d43a",
    "status": "delivered",
    "db_committed": true,
    "reason": null
  }
}
```
Upon receiving `message_ack`, the sender updates its message status from `sending` to `delivered` and notifies the UI.

### `ping` / `pong`
Used to test socket reachability and calculate latency in milliseconds without modifying database state.

---

## 6. UDP Discovery Protocol (Port 52925)

Every 5 seconds, each LANX instance broadcasts a UDP beacon to `255.255.255.255:52925`:
```json
{
  "protocol": "LANX",
  "version": 1,
  "device_id": "device-uuid-v4",
  "display_name": "Alice Vance",
  "hostname": "DESKTOP-ALICE",
  "tcp_port": 52926,
  "public_key": "hex-ed25519-pubkey",
  "avatar_color": "#0284c7"
}
```
- **Peer Expiry**: Peers not heard from within **15 seconds** are marked `status = 'offline'` in SQLite, and an offline event is emitted to the UI.
- **Manual Peers**: If UDP broadcast is disabled by router AP isolation, users can add a peer by IP:port, which initiates a direct TCP connection.

---

## 7. Failure Modes & Mitigations

| Failure Mode | Protocol Behavior |
| :--- | :--- |
| **Peer Offline / Unreachable** | TCP connection attempt times out after 3000ms. Sender marks message `status = 'failed'` in SQLite and enables the "Retry" button. |
| **Network Interrupted Mid-Transmission** | Incomplete frame detected via length prefix EOF check. Receiver discards partial frame and does not commit or acknowledge. |
| **Duplicate Packet Retransmission** | Receiver checks `messages.id` in SQLite. If already present, skips insert and immediately re-sends `message_ack` to resolve sender's pending state. |
| **Oversized / Malformed Payload** | If length prefix > 65,536 bytes or JSON parsing fails, connection is abruptly dropped. |
| **Identity / Public Key Mismatch** | Peer trust changed to `unverified`, warning banner displayed, no automatic trust elevation. |
