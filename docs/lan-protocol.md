# LANX network protocol (v2, LANX 1.0 – 1.2)

Two layers, both on the local network only:

| Layer | Port | Purpose |
|---|---|---|
| UDP discovery | 52925 | "I'm here" beacons so computers find each other |
| TCP sessions | 52926 | Encrypted messages and file transfers |

v1 (LANX 0.1) is not compatible: it had no encryption. A v2 node refuses v1 packets with a clear
"update LANX" error.

## 1. Device identity
On first run each computer creates an **Ed25519** key pair and a random device id, stored in
`%APPDATA%\LANX\lanx.db`. The first public key seen for a device id is **pinned**; a later packet or
beacon for that id with a different key is refused ("identity key changed").

The *security code* shown in the app is the first 8 bytes of `SHA-256(hex(public_key))`.

## 2. Discovery (UDP)
Every N seconds (default 5) each node sends a signed JSON beacon to the broadcast address of
**every active IPv4 adapter**, plus `255.255.255.255` and `127.0.0.1`:

```json
{ "protocol": "LANX", "version": 2, "device_id": "…", "display_name": "Asha",
  "hostname": "ACCOUNTS-PC", "tcp_port": 52926, "public_key": "<hex>",
  "avatar_color": "#0284c7", "status": "online", "timestamp": 1792130000,
  "signature": "<hex Ed25519 over the fields above>" }
```

- Unsigned, mis-signed, or pinned-key-mismatch beacons are ignored.
- A node seeing a peer come online replies with a unicast beacon, so both sides know within a second.
- No beacon for `max(15 s, 3 × interval + 2 s)` → peer shown offline.
- On quit a node sends `"status": "offline"` so others update at once.

## 3. Sessions (TCP)
### Framing
- Handshake frames (plaintext): `[u32 big-endian length][JSON envelope]`, max 64 KB.
- After the handshake: `[u32 length][ChaCha20-Poly1305 ciphertext]`, max 320 KB.
  The plaintext's first byte is the frame type: `1` = JSON packet, `2` = file data.
  The nonce is a per-direction frame counter, so dropped, replayed or reordered frames fail.

### Envelope (every JSON packet)
```json
{ "version": 2, "packet_id": "uuid", "correlation_id": "uuid|null",
  "sender_id": "…", "sender_name": "…", "sender_pubkey": "<hex>",
  "timestamp": 1792130000, "signature": "<hex>",
  "payload": { "kind": "message", "data": { … } } }
```
The signature covers `"LANX-PACKET-V2"` + JSON array of
`[version, packet_id, correlation_id, sender_id, sender_name, timestamp, payload]`.

### Handshake
1. Client → `handshake { ephemeral_key, hostname, tcp_port, avatar_color, app_version }` (signed).
2. Server checks signature, version, blocked list and pinned key, then → `handshake_ack { ephemeral_key, … }`
   with `correlation_id` = the client's packet id (signed).
3. Both compute X25519 over the ephemeral keys; HKDF-SHA256(salt = client_key‖server_key,
   info = "LANX v2 session keys") gives two 32-byte keys (client→server, server→client).
4. The client also checks it reached the device it expected (device id and pinned key).

### Packets after the handshake
| kind | direction | meaning |
|---|---|---|
| `message` → `message_ack` | sender → recipient | Text. Ack only after the recipient's DB commit. Duplicate ids are acked without re-inserting. |
| `ping` → `pong` | either | Reachability test |
| `file_offer` → `file_offer_ack` | sender → recipient | "May I send you X (size)?" Recipient stores it as *pending* |
| `file_request { offset }` | recipient → sender | Recipient accepted; pull from `offset` (resume) |
| `file_stream_start` | sender | Followed by encrypted data frames from `offset` to the end |
| `file_stream_end { sha256 }` | sender | Hash of the **whole** file |
| `file_result { ok }` | recipient | Recipient verified the hash and saved the file |
| `file_cancel { reason }` | either | Decline / cancel |
| `disconnect` | either | Closing |

## 4. Reliability
- **Offline outbox:** messages and file offers to an offline peer are stored as *queued* and sent
  when the peer's beacon or connection is seen (with a 15 s back-off after failures).
- **Resume:** received bytes are kept in `<name>.<id>.lanxpart`; *Resume* requests from that offset.
  The recipient re-hashes the partial data, so a corrupted partial file is detected and discarded.
- **Restart safety:** on start-up, interrupted transfers become *failed (resumable)* and in-flight
  messages become *queued*.
- **File names** from other computers are sanitised (no paths, reserved names or illegal characters);
  existing files are never overwritten (`name (1).ext`).

## 5. LANX 1.1 additions (same protocol v2)
New packet kinds are sent **only** to peers whose handshake reports `app_version >= 1.1.0`; for
older peers the item stays queued ("waiting for X to update"). New optional fields are omitted when
empty, so ordinary messages and offers keep the exact 1.0 wire format (1.0 re-serialises payloads to
verify signatures).

| kind / field | meaning |
|---|---|
| `message.ttl_secs` | Secret message: both sides delete it this long after it is read (max 1 week unread) |
| `message` with `message_type: "secret_setting"`, content = seconds | Turn secret mode on/off for the chat |
| `message.group_id`, `file_offer.group_id` | Group message / group file |
| `read_receipt { message_ids, group_id? }` → `ack` | "Seen" (direct: message becomes read; group: per-member) |
| `typing { group_id? }` | Best-effort "typing…" (no ack, rate-limited) |
| `ring { group_id? }` → `ack` | Bell: recipient plays a bell, flashes the taskbar, shows a notification |
| `group_update { group_id, name, admin_id, version, members[] }` → `ack` | Full group state from the admin; accepted only from the current admin and only if `version` is newer. Members include each device's public key, last IP and port, so members can reach each other directly |
| `group_leave { group_id }` → `ack` | A member left; the admin then sends a new version to everyone |

Group messages are sent to each member separately over their own encrypted session; delivery and
"seen" are tracked per member, and offline members receive group changes first, then messages.
Secret messages are wiped from disk with SQLite `secure_delete`.

## 6. LANX 1.2: Share LANX update (same protocol v2)
A PC that has an official LANX installer offers it to colleagues whose LANX is older. The new packet
kind is sent **only** to peers whose handshake reports `app_version >= 1.2.0` (an older LANX would
drop the connection on an unknown kind). Colleagues on 1.1 or older are instead sent the installer
as an ordinary chat file, once, from Settings → Updates.

| kind | meaning |
|---|---|
| `update_offer { transfer_id, version, file_size, sha256, signature }` → `file_offer_ack` | "I have the LANX `version` installer." The recipient stores it as a pending *update* (not a chat file) and shows "Update now" |

After "Update now" the recipient pulls the installer with the usual `file_request` / data frames /
`file_stream_end` / `file_result`, so it is encrypted, resumable and SHA-256 checked like any file.

**Release signature.** `npm run release` signs every installer with the LANX release key (Ed25519;
private key in `signing/`, never committed; public key built into the app from
`src-tauri/release-key.pub`) and writes `LANX-Setup-<version>.exe.sig`:

```json
{ "format": "lanx-release-1", "version": "1.2.0", "sha256": "<hex>", "size": 6123456, "signature": "<hex>" }
```

The signature covers the UTF-8 bytes `"LANX-RELEASE-V1\n<version>\n<sha256>\n<size>"`.

**What the recipient checks**
1. The offer comes over an authenticated session from a known colleague (pinned key, not blocked,
   not an unverified manual address).
2. `version` is a plain `a.b.c` and newer than its own LANX.
3. The release signature is valid for `version`, `sha256` and `file_size`.
4. After downloading (before `file_result` is sent): size and SHA-256 match the signed values, and
   the `.exe`'s Windows version information says product name `LANX`, product version `version`.
   A file that fails is deleted and the sender is told it failed.
5. Nothing runs without a click. Right before starting it, LANX opens the file so nobody can change
   it, checks it once more, and asks Windows to start it (`ShellExecuteEx`, so the installer's own
   UAC question appears) with `/P /R /UPDATE`: progress bar only, LANX is closed and updated in place,
   then started again. Chats are kept (they live in `%APPDATA%\LANX`).

Installers are kept in `%APPDATA%\LANX\Updates` (not Downloads). Files LANX writes carry no
"downloaded from the internet" mark, so Windows SmartScreen's blue box does not appear. When LANX
next starts as the new version, it keeps that installer and offers it to colleagues itself, so
updates spread from PC to PC even when the first sharer is switched off.

**Keeping everyone on the same version**
- Every handshake reports `app_version`; LANX stores it per peer. When a colleague comes online and
  their version is unknown or behind the newest one known, LANX opens a short session just to learn
  it (at most once a minute per colleague). Peers and Settings → Updates show it, with "Behind".
- The recipient downloads an offered update in the background from one online colleague at a time
  and checks it; the banner then offers "Update LANX now". "Remind me tomorrow" hides it for 24 h,
  and a notification repeats at most once every 20 h until LANX is updated. Failed downloads are
  retried when a colleague who has it comes online (never ones that failed the safety check).
- Colleagues on 1.1 or older get the installer once as an ordinary chat file, only from the PC where
  it was chosen (not from every PC it was passed on to); this can be turned off.
- The installer keeps a copy of itself in `<LANX folder>\updates`, with its `.sig` if one was next to
  it. On start-up LANX shares a verified copy of the version it runs, so installing a release straight
  from the release folder is enough to start sharing it.

## 7. LANX 1.2: voice and video calls (same protocol v2)
Sent only to peers whose handshake reports `app_version >= 1.2.0`.

| kind | meaning |
|---|---|
| `call { call_id, action: "invite", video, sdp }` → `ack` | Start a call; `sdp` is the caller's WebRTC offer. `ack.ok = false` with a reason when the callee is busy or blocked the caller |
| `call { action: "accept", sdp, video }` → `ack` | Answer; `sdp` is the WebRTC answer |
| `call { action: "decline" \| "cancel" \| "hangup" }` → `ack` | Decline a ringing call / give up while ringing / end an active call |
| `call { action: "media", video?, muted?, screen? }` → `ack` | Camera, mute and screen-sharing state |

Only the two devices in a call may change it (checked by device id). Unanswered calls end after 45 s on
both sides. The audio and video travel directly between the two LANX windows over WebRTC (DTLS-SRTP),
using LAN addresses only (no STUN/TURN servers). Both sides write the call into the chat as a
`message_type: "call"` record (`{"video", "outcome", "secs"}`), which is never sent over the network.
