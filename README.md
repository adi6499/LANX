# LANX — Local Network Messenger (v1.2)

LANX lets computers on the same office network **chat and send files of any size** to each other —
no internet, no server, no accounts. Computers find each other automatically. Everything is
**end-to-end encrypted** and stays on your network.

## For users

### Install
1. Run **`LANX-Setup-1.2.0.exe`**.
2. Windows asks *"Do you want to allow this app to make changes?"* → **Yes** (the installer needs
   this once, to install for all users and to allow LANX through Windows Firewall).
3. LANX opens. Type your name → **Launch LANX**. Done.

The installer sets up Windows Firewall for you, so there is **no firewall popup** and colleagues can
reach you straight away (also on networks Windows marked as "Public", but only from the same subnet).

**Upgrading:** just run the new installer — it replaces the old copy and keeps your chats.
Newer versions talk normally with colleagues on older ones; new features (calls need 1.2; groups,
secret messages, “Seen”, typing and the bell need 1.1) start working with them once they update too.
(0.1 is not compatible — update every PC from 0.1.)

After the first setup an **animated guide** shows how everything works (reopen it in
**Settings → Help**).

> **About the blue "Windows protected your PC" box** — see [docs/install-without-warnings.md](docs/install-without-warnings.md).
> In short: it appears only for files downloaded from the internet/email/WhatsApp that are not
> code-signed. Copy the installer over a USB drive or a shared folder (`\\PC-NAME\share`) and it does
> not appear; for internet distribution you need a code-signing certificate (setup is ready).

### Everyday use
- **Chat:** pick a colleague on the left (or **Peers → Chat**). Enter sends, Shift+Enter = new line.
- **Send files:** press the 📎 paperclip, or **drag files into the chat**. No size limit.
  The other person presses **Accept**. Files land in *Downloads* (change in **Settings → Files**).
- **Offline colleague?** Messages and files wait (shown as *Queued*) and are delivered automatically
  when they come back online.
- **Transfer interrupted?** Press **Resume** — it continues where it stopped.
- **Closing the window** keeps LANX running in the tray (near the clock) so messages still arrive.
  Right-click the tray icon → **Quit LANX** to exit.
- **Someone doesn't appear?** They may be on another subnet or Wi-Fi with "client isolation".
  Use **Peers → Connect by IP** (they can see their IP in **Settings → Network**).
- **Verify a colleague:** open their contact details (ⓘ) and compare the *Security code* with the one
  in *their* **Settings → Diagnostics**. If it matches, press **Mark as trusted**.
- **Search:** the **History** tab searches every message on this PC.

### New in 1.2
- **📞 Voice and 🎥 video calls** — the phone and camera buttons at the top of a one-to-one chat.
  Their LANX rings (even from the tray); they answer with one click. During a call: mute, camera on/off,
  share your screen, make the video bigger. Missed calls show in the chat with **Call back**.
  Calls go straight between the two computers (WebRTC, encrypted) — no internet or server.
- **Backups** — Settings → **Backup**. LANX saves a copy of your chats every day (keeps 7), or press
  **Back up now**. **Restore** goes back to any of them (LANX first keeps a copy of how things are, so a
  restore can be undone). **Save a backup file…** makes a password-protected file for a USB drive or a
  new computer; **Restore from a file…** brings it back. Secret messages are never backed up.
- **Hidden chats, clearer** — the crossed-out eye at the top of a chat hides it (and sets up a PIN on the
  spot if you have none). Hidden chats live in a purple **Hidden chats** section at the top of the chat
  list that opens with your PIN, and a hidden chat is clearly marked while it is open.

### New in 1.1
- **Groups** — the people icon at the top of the chat list. Everyone sees every message and file;
  you can see who has *seen* each message. The creator (👑 admin) can rename, add and remove people.
- **Message everyone** — the 📣 megaphone sends one message and/or files to many colleagues at once.
- **🔔 Bell** — in any chat header; rings the colleague's LANX (bell sound, taskbar flash,
  notification). In a group it rings everyone online.
- **Secret chats** — the ⏱ timer in a chat header. Messages disappear for both people 30 s–1 week
  after they're read, are never searchable, and LANX blocks screenshots while the chat is open.
- **PIN lock** — Settings → Privacy. LANX asks for the PIN at start-up and after you've been away;
  🔒 bottom-left (or the tray icon) locks it immediately.
- **Hidden chats** — see “New in 1.2” above.
- **“Seen” and typing…** — see when messages were read and when someone is typing (can be turned
  off in Settings → Privacy).
- **Screenshots & pictures** — paste a screenshot with **Ctrl+V**; pictures under 10 MB download
  by themselves and show as previews.
- **Sounds** — LANX's own sounds (Chime, Soft, Ding, Pop) or your own .wav, with volume
  (Settings → Sounds).

## For developers

### Stack
Tauri 2 (Rust) · React 19 + TypeScript · Tailwind 4 · SQLite (WAL) · Windows 10/11.

### Prerequisites (one time)
- Node.js 20+
- Rust (`winget install Rustlang.Rustup`)
- Visual Studio 2022 Build Tools with "Desktop development with C++"
  (`winget install Microsoft.VisualStudio.2022.BuildTools --override "--passive --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"`)

### Commands
| What | Command |
|---|---|
| Install JS packages | `npm install` |
| Run the app with live reload | `npm run app` |
| UI only, in a browser (demo data) | `npm run dev` → http://localhost:1420 |
| Type-check + all Rust tests | `npm test` |
| Build the installer | `npm run release` → `release/LANX-Setup-<version>.exe` |
| Small source zip to share | `npm run pack-source` → `release/LANX-source-<version>.zip` (≈1 MB) |

> **Never zip the whole folder.** `node_modules` and `src-tauri/target` are rebuilt automatically and
> are ~11 GB — that is why the old `LANAPPLICATION.zip` was 2.9 GB. Use `npm run pack-source`.

To release a new version, bump `version` in `package.json`, `src-tauri/Cargo.toml` and
`src-tauri/tauri.conf.json`, then `npm run release`.

### Project layout
```
src/                         React UI
  App.tsx                    state, live events, drag-and-drop
  components/                Sidebar, ConversationPanel, FileCard, TransfersView, PeopleView,
                             HistoryView, ContextPanel, SettingsModal, OnboardingModal
  lib/api.ts                 typed bridge to the Rust commands (+ browser demo data)
src-tauri/
  src/lib.rs                 app shell: tray, close-to-tray, single instance, autostart, startup
  src/commands/              Tauri commands called by the UI
  src/networking/
    session.rs               encrypted sessions (signed X25519 handshake, ChaCha20-Poly1305)
    protocol.rs              packet types and signatures
    mod.rs                   messaging, offline outbox, incoming connections
    transfer.rs              resumable file transfer with SHA-256 verification
    tests.rs                 end-to-end tests (two/three nodes over loopback)
  src/discovery/             signed UDP beacons on every network adapter
  src/storage/               SQLite schema + migrations, queries
  src/networking/calls.rs    call set-up, ringing, missed calls (media itself is WebRTC in the window)
  src/backup.rs              daily/manual backups, encrypted backup files, restore on restart
  src/events.rs              UI events, Windows notifications, tray tooltip
  src/testmode.rs            switches for side-by-side test copies (LANX_PROFILE=…)
  windows/installer-hooks.nsh  firewall rules added/removed by the installer
docs/lan-protocol.md         wire protocol v2
docs/install-without-warnings.md  SmartScreen, firewall and code signing
```

### Data
Each PC stores its chats, contacts and its private key in `%APPDATA%\LANX\lanx.db`.
Nothing is sent anywhere except directly to the colleague you are talking to.
