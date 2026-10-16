# LANX — Local Network Desktop Messenger

LANX is a 100% free, premium-quality Windows desktop messaging application inspired by the reliability of IP Messenger, but built with an Apple-inspired minimal interface, modern authenticated encryption, and local SQLite persistence.

Computers on the same LAN (Wi-Fi, Ethernet, or Office subnet) discover one another, exchange messages, and transfer files without requiring any cloud server, third-party subscription, or active internet connection.

---

## Technology Stack

- **Desktop Framework:** Tauri 2
- **Native Networking & Storage Engine:** Rust 1.99.0
- **Frontend:** React 19, TypeScript (strict mode), Vite 8
- **Styling & Aesthetics:** Tailwind CSS v4, Lucide icons, Apple-inspired minimal glassmorphism
- **Storage:** Local SQLite database with transaction-safe WAL journal mode and versioned migrations
- **Networking Architecture:** UDP broadcast peer discovery (port 52925) + Authenticated TCP direct messaging and streaming file transfer (port 52926)
- **Integrity Verification:** SHA-256 cryptographic verification for file payloads and transcripts

---

## Milestone 1 — Foundation Status

Milestone 1 is completely implemented, verified, and operational:

- [x] **Working Tauri 2 Desktop Project:** Configured with React 19, TypeScript, and Vite.
- [x] **Prerequisites Resolved:** Installed Rust (rustc 1.99.0, cargo 1.99.0) and portable MinGW-w64 toolchain without requiring administrative elevation.
- [x] **Production Windows Build:** Native executable compiled at `src-tauri/target/debug/lanx.exe`.
- [x] **Apple-Inspired Desktop Shell:**
  - **Left Sidebar:** LANX brand identity, live peer count indicator, instant search, navigation tabs (Chats, Peers, Files, History), and recent conversation list.
  - **Main Conversation Panel:** Header with online indicator, peer IP, cryptographic trust status badge, message history with delivery checkmarks, and composer.
  - **Contextual Panel:** Collapsible side drawer with hardware/socket details, trust verification toggle, and shared file transfer history.
  - **Peers View:** Comprehensive grid of discovered LAN peers, status pulses, and manual "Connect by IP" dialog.
  - **Files View:** Transfer queue with live progress, direction indicators, and SHA-256 checksums.
  - **History View:** Audit logs and SQLite database telemetry.
- [x] **First-Run Onboarding Modal:** Display name customization, avatar palette selector, persistent device identity initialization, and Windows Firewall explanation.
- [x] **Settings Modal:** Profile details, Appearance (System, Dark, Light theme persistence), LAN Discovery port settings, and Database telemetry.
- [x] **Local SQLite Database & Migrations:** Rust-managed database (`lanx.db` in `%APPDATA%\LANX\`) with versioned migrations, WAL mode, transaction-safe message writes, and foreign key cascades.
- [x] **Automated Tests:** 100% passing Rust unit tests for migrations, settings persistence, and message/peer storage.

---

## Project Structure

```
LANAPPLICATION/
├── src/                          # React + TypeScript Frontend
│   ├── components/               # Modular UI Components
│   │   ├── ContextPanel.tsx      # Peer details, trust toggles, shared transfers
│   │   ├── ConversationPanel.tsx # Chat transcript, delivery badges, composer
│   │   ├── HistoryView.tsx       # Searchable transcripts & SQLite stats
│   │   ├── OnboardingModal.tsx   # First-run welcome & profile setup
│   │   ├── PeopleView.tsx        # Discovered peers & manual IP connect
│   │   ├── SettingsModal.tsx     # Profile, theme, network, diagnostics
│   │   ├── Sidebar.tsx           # Brand header, tabs, search, conversations
│   │   └── TransfersView.tsx     # File queue, progress, SHA-256 hashes
│   ├── lib/
│   │   └── api.ts                # Tauri IPC invoke client with web fallback
│   ├── types/
│   │   └── index.ts              # Strict TypeScript definitions
│   ├── App.css                   # Tailwind tokens & sleek scrollbar styling
│   ├── App.tsx                   # Main application controller
│   └── main.tsx                  # React entry point
├── src-tauri/                    # Native Rust Engine
│   ├── src/
│   │   ├── commands/             # Tauri IPC command handlers
│   │   │   └── mod.rs
│   │   ├── storage/              # SQLite database & migrations
│   │   │   ├── models.rs         # Typed Rust structs
│   │   │   ├── schema.rs         # Versioned schema migrations
│   │   │   ├── tests.rs          # Automated tests for persistence
│   │   │   └── mod.rs            # Database connection & CRUD operations
│   │   ├── lib.rs                # Tauri initialization & state injection
│   │   └── main.rs               # Windows executable entry point
│   ├── Cargo.toml                # Rust dependencies
│   └── tauri.conf.json           # Tauri desktop configuration
├── index.html                    # Root HTML with Google Fonts
├── package.json                  # NPM scripts & dependencies
└── vite.config.ts                # Vite configuration with Tailwind plugin
```

---

## Build & Test Instructions

### 1. Run Automated Rust Tests
```powershell
cd src-tauri
cargo test
```

### 2. Run TypeScript Type Check & Frontend Build
```powershell
npm run build
```

### 3. Run Development Server
```powershell
npm run dev
```

### 4. Build Native Windows Desktop Executable
```powershell
cd src-tauri
cargo build
```
The executable is produced at `src-tauri/target/debug/lanx.exe`.

---

## Milestone 2 Protocol Design (Next Milestone)

In Milestone 2, real LAN socket communication will be established:
1. **UDP Broadcast Discovery (Port 52925):**
   - Packet format: JSON beacon with `device_id`, `display_name`, `hostname`, `tcp_port`, and `avatar_color`.
   - Interval: Configurable (default 5 seconds). Peers not heard from within 15 seconds transition to `offline`.
2. **TCP Authenticated Direct Messaging (Port 52926):**
   - Framing: 4-byte length prefix + JSON payload.
   - Handshake: Exchange of device ID and public key / shared verification.
   - Delivery Acknowledgement: Recipient replies with `ACK` containing `message_id`, updating database status from `sending` to `delivered`.
