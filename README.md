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
From 1.2 on, LANX can update itself over the office network (see *Share LANX update* below).
1.2 talks normally with colleagues still on 1.0 or 1.1; newer features start working with them once
they update too. (0.1 is not compatible — update every PC from 0.1.)

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

### New in 1.2: everyone on the same version (Share LANX update)
- **Start it once:** install the new version on your PC straight from `release\` (with the `.sig`
  file next to the `.exe`) — your LANX then shares it by itself. Or use **Settings → Updates →
  Choose installer…** on any PC that has the `.exe` and its `.sig`.
- **Colleagues on 1.2 or newer:** LANX downloads and checks the update in the background, then shows
  **“LANX x.y.z is ready to install — Update LANX now”**. One click; Windows asks *“allow this app to
  make changes?”* → **Yes**; LANX updates and reopens with all chats. **Remind me tomorrow** hides it
  for a day; it comes back (with a reminder) every day until they update.
- **Colleagues still on 1.1 or older** can't show that button yet: LANX sends them the installer
  once as a chat file (they open it from the chat). This can be turned off in Settings → Updates.
- **Who is behind:** every colleague's LANX version shows in **Peers** (“Behind · 1.2.1 available”
  or “Up to date”) and in **Settings → Updates**.
- **Spreads by itself:** every PC that updated passes the update on, so nobody depends on one PC.
- **No blue “Windows protected your PC” box**: that box is only for files from the internet, e-mail
  or WhatsApp; files received through LANX are not marked that way.
- **Safe:** only official LANX releases (signed by `npm run release`), only newer versions, only from
  known colleagues, checked again right before Windows starts it, and never without a click.

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
- **Hidden chats** — a chat's details (ⓘ) → *Hide this chat*; 👁 bottom-left shows them with your PIN.
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
`src-tauri/tauri.conf.json`, then `npm run release`. It writes `release/LANX-Setup-<version>.exe`
plus `.sha256.txt` and `.sig` (the LANX release signature that lets colleagues' LANX accept it as an
update; keep the `.sig` next to the `.exe`).

**Release key:** the signature is made with `signing/lanx-release-key.pem` (created on the first
`npm run release`, git-ignored, excluded from `pack-source`). **Back this file up** (USB drive or
password manager) and never share it. Its public half, `src-tauri/release-key.pub`, is built into
the app. If the key is ever lost: `node scripts/release-key.mjs --new`; colleagues then install the
next version by hand once.

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
    update.rs                Share LANX update: offers, release-signature checks, installer start
    tests.rs                 end-to-end tests (two/three nodes over loopback)
  src/discovery/             signed UDP beacons on every network adapter
  src/storage/               SQLite schema + migrations, queries
  src/events.rs              UI events, Windows notifications, tray tooltip
  src/testmode.rs            switches for side-by-side test copies (LANX_PROFILE=…)
  windows/installer-hooks.nsh  firewall rules added/removed by the installer
  release-key.pub            public half of the LANX release key (built into the app)
scripts/release-key.mjs      creates the release key, signs installers (.sig)
docs/lan-protocol.md         wire protocol v2
docs/install-without-warnings.md  SmartScreen, firewall and code signing
```

### Data
Each PC stores its chats, contacts and its private key in `%APPDATA%\LANX\lanx.db`.
Nothing is sent anywhere except directly to the colleague you are talking to.
