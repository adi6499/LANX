# LANX on your phone (LANX 3.0)

Your PC's LANX serves a small web page on the office Wi-Fi. A phone on the same
Wi-Fi scans a QR code (or types an 8-digit code), you tap **Allow** on the PC,
and the phone then reads and sends **your** chats through that PC — same name,
same colleagues, same history. There is no server anywhere: the phone talks only
to your PC, and only while LANX is running there.

## Setting it up

On the PC: **Settings → Phone** → switch on *Use LANX on your phone* → **Show a
code**. A QR code, the address and an 8-digit code appear (good for ten minutes).

On the phone (same Wi-Fi): open the camera, point it at the QR code, tap the
link. The PC asks **Allow this phone?** → **Allow**. That's it. The phone can
also open the address in its browser and type the code.

Add it to the Home Screen (Share → Add to Home Screen on iPhone) to open it like
an app. A Home Screen copy has its own storage, so it asks for the code once
more and the PC asks *Allow?* again.

## What works

- Chats: the list, each chat's history (60 at a time, *Earlier messages* for
  more), sending text, replies shown, delivered/seen ticks, typing.
- Photos, videos and files both ways: the phone uploads to the PC, which sends
  them on like any file it sends; files colleagues sent show once the PC has
  downloaded them. Pictures show inline; videos play; anything else downloads.
- Reading a chat on the phone marks it read on the PC (and sends "seen").
- **Who's in**: the same list as the PC, tap a person to chat.
- (3.1) Hold a message: quick reactions, Reply, Forward, Copy, Star, Pin,
  Remind me (with "only if nobody replied"), Edit, Delete for me / everyone.
  The **+** button: a file, a sticker (the 24 LANX stickers), a quick reply
  ("/" in the box lists them), "Send later" (the chat shows what is waiting;
  cancel from the phone). @mentions in groups, a pinned bar, search (type in
  the search box, Enter), Starred messages.
- (3.1) Groups: create (name + people), tap the group's name for its page —
  rename, add or remove people (the one who made it), leave.
- (3.1) Files tab: everything the PC sent or received, with progress; Accept,
  Decline, Cancel, Try again; download finished files to the phone.
- (3.2) More tab: Cards (the PC's own card code runs on the phone through the
  bridge: see, answer, create), Notes, Calendar, Games (the PC's games panel,
  flat boards), Send kudos, End-of-day report, Emergency (answer / raise),
  My status + out of office, My profile, a person's details (Who's in → ⓘ).
- (3.2) Secure connection: the PC also listens over HTTPS (port 52931 by
  default, same fallback as the others) with a certificate it made itself
  (`<data dir>\phone-tls\`, CA + a server certificate for every local IP,
  renewed when IPs change). `GET /lanx-ca.crt` / `/lanx-ca.mobileconfig`
  hand the CA to the phone; More → Secure connection walks the user through
  installing it (iOS: Settings → Profile Downloaded → Install, then General
  → About → Certificate Trust Settings) and opening `https://…/#token=…`.
  Only on the secure page: voice notes and intercom (`POST /api/voice`,
  `/api/intercom`, the phone's MediaRecorder), and alerts when the page is
  closed (web push: `/api/push/key`, `/api/push/subscribe`, `sw.js`; the PC
  sends through the phone's push service when that phone has no open
  connection — needs internet; iPhone needs the Home Screen copy).
- Light and dark follow the phone.
- Removing a phone in Settings disconnects it at once; its token is dead.

## What it does not do (on purpose, for now)

- Works only on the office Wi-Fi (or through the company VPN), while the PC is
  on and LANX is running. A page on the internet cannot reach LAN PCs.
- The phone shows new messages while the page is open. Closed or in the
  background it gets no alerts: browsers only allow that for secure (HTTPS)
  sites, which a LAN address cannot be.
- No calls or meetings on the phone (the PC's own call window and the phone
  would fight over one call; a later release), no remote control or PDF tools.
- On the plain (HTTP) page the messages travel between phone and PC
  protected only by the Wi-Fi's own encryption; the secure page (3.2) encrypts
  them with the PC's certificate. Between PCs LANX stays end-to-end encrypted
  as before. Never open the phone ports on a router: the server only answers
  private (office) addresses anyway.
- One identity: the phone is a window into the PC's LANX, not a second peer, so
  nothing needs merging and colleagues see one "you".

## How it works

- `src-tauri/src/phone/mod.rs` — `PhoneService`: the setting (`phone_enabled`),
  the port (`phone_port`, default 52930, moved to a free one like the messaging
  port; the last port used is tried first), pairing codes, allowed phones
  (`phone_devices` in settings, token hashes only), connected clients.
- `src-tauri/src/phone/http.rs` — a small HTTP/1.1 server on tokio: the page
  and its assets (embedded at build time, see below), `POST /api/pair`
  (202 + request id, or 403 wrong / 410 no code / 429 busy), `GET /api/pair/<id>`
  (waiting / allowed + token + cookie / denied / expired), `POST /api/session`
  (cookie for a bearer token), `POST /api/upload?conv=&name=` (raw body, up to
  1 GB, streamed to `<data dir>\Phone uploads` then sent with `send_files`),
  `GET /api/file/<transfer id>` (with byte ranges, so videos play), `GET /ws`.
  Requests from outside private address ranges are dropped unanswered.
- `src-tauri/src/phone/ws.rs` — the WebSocket (handshake + frames, written
  out). First message `{"op":"auth","token":…}`; then requests
  `{"id","op",…}` → `{"id","ok",…}` and pushes `{"ev",…}`.
- `src-tauri/src/phone/api.rs` — the ops (`hello`, `conversations`, `peers`,
  `messages`, `send`, `read`, `typing`, `open`; 3.1: `react`, `sticker`,
  `edit`, `delete`, `forward`, `star`, `pin`, `starred`, `search`, `later`,
  `scheduled`, `cancel_later`, `remind`, `cancel_remind`, `group_create`,
  `group`, `group_update`, `group_leave`, `transfers`, `accept`, `cancel`,
  `retry`; pushes also `progress` (≤ 2/s per transfer), `scheduled`,
  `reminder`) call the same engine functions
  the window uses (`send_message_full`, `mark_read_and_notify`, …); every
  window event passes through `Events::emit`, which the phone server taps
  (`events.rs`) and maps to pushes (`message`, `transfer`, `deleted`, `peer`,
  `peer-offline`, `profile`, `typing`, `read`, `reload`, `lock`). PIN lock and
  hidden chats are respected exactly as in the window.
- `src/phone/` — the page (React + the app's own CSS tokens, no Tauri):
  `client.ts` (pairing, the socket, uploads, every op), `PhoneApp.tsx`
  (connect, the state and navigation), `ChatView.tsx` (a chat, the composer,
  the message actions), `screens.tsx` (chats, who's in, files, groups, search
  results, forward picker), `parts.tsx` (bubbles, sheets), `phone.css`. Built by `vite.phone.config.ts` into
  `src-tauri/phone-dist/`; `build.rs` lists every file there for
  `include_bytes!`, so `lanx.exe` carries the whole page.
- `src/components/phone/` — Settings → Phone (`PhonePanel`), the QR code drawn
  from modules the engine computes (`phone_qr`, `qrcode` crate), and the
  *Allow this phone?* dialog (`PhoneAskDialog`, mounted in `App.tsx`).

## Building and testing

- `npm run build` builds the desktop page and then the phone page
  (`npm run build:phone` alone rebuilds just the phone page). `npm run release`
  does everything as before. `cargo test phone::` runs the server tests (a real
  phone session against two engines on loopback, pairing, frames, ranges).
- `npm run dev:phone` serves the page from Vite with `/api` and `/ws` proxied to
  a running LANX (`LANX_PHONE_TARGET`, default `http://127.0.0.1:52930`).
- Test copies: `LANX_PHONE=1` starts with the server on, `LANX_PHONE_PORT=…`
  picks its port; with `LANX_BIND=127.0.0.1` the QR address is loopback.
  The end-to-end script (`run300.mjs`) drives two copies and a phone-sized
  headless Edge through pairing, chat both ways, a photo, typing, read marks,
  dark mode, a reload and removal; `run310.mjs` adds the 3.1 extras (react,
  reply, edit, star, pin, remind, sticker, quick reply, send later, forward,
  delete, search, starred, a group with an @mention, accepting a file).

## Troubleshooting

- *The phone can't reach the PC*: same Wi-Fi? Guest Wi-Fi networks often
  isolate devices. Windows Firewall already allows `lanx.exe` (the installer's
  rule covers every port). If the PC has several adapters, Settings lets you
  pick the address; the Wi-Fi/Ethernet one is first.
- *The code says "isn't right"*: codes expire after ten minutes and after ten
  wrong tries; tap **New code**.
- *Pictures don't show on a Home Screen copy*: it pairs again (new code) and
  gets its own cookie.
