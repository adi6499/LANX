# LANX — Local Network Messenger (v1.2)

LANX lets computers on the same office network **chat and send files of any size** to each other —
no internet, no server, no accounts. Computers find each other automatically. Everything is
**end-to-end encrypted** and stays on your network.

## For users

### Install
1. Run **`LANX-Setup-1.2.4.exe`**.
2. Windows asks *"Do you want to allow this app to make changes?"* → **Yes** (the installer needs
   this once, to install for all users and to allow LANX through Windows Firewall).
3. LANX opens. Type your name → **Launch LANX**. Done.

The installer sets up Windows Firewall for you, so there is **no firewall popup** and colleagues can
reach you straight away (also on networks Windows marked as "Public", but only from the same subnet).

**Upgrading:** just run the new installer — it replaces the old copy and keeps your chats.
From 1.2 on, LANX can update itself over the office network (see *Share LANX update* below).
Newer versions talk normally with colleagues on older ones; new features (calls need 1.2.2; groups,
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
- **Send files:** press the 📎 paperclip, or **drag files (or whole folders) into the chat**. No size limit.
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

### New in 1.9.1: no more white window
- After a laptop wakes from sleep (or at a busy Windows start-up), LANX's window could turn **white for good** while LANX kept
  running behind it. The window is drawn by Microsoft WebView2, whose helper programs can stop at such moments. LANX now notices
  that and repairs itself: it loads the page again, or restarts itself (back in the tray if it was hidden there). Chats, messages
  and files are never affected. At most 3 automatic restarts in 15 minutes, so it can never get stuck restarting.

### New in 1.9.0: admin
- **Admin panel** (shield button at the bottom-left, next to Settings).
- **LANX admin for the office (optional).** Admin → Office settings → "Make this computer the LANX admin". That computer then
  sends everyone the same **company apps**, **message clean-up** and **network backup folder**. Each colleague gets a question
  ("Asha is the LANX admin … Use the office settings?") and nothing changes until they say yes; they can stop following any time,
  and the admin can never read anyone's messages. The admin sees every computer: who follows the settings, who said no, who still
  needs LANX 1.9, and can **export that list to Excel**.
- **Apps launcher** (grid button above the chat list): your company's websites, shared folders and files in one click — the admin's
  apps for everyone, plus your own (Admin → Apps). Only web addresses and file/folder paths, never programs with commands.
- **Message clean-up.** Admin → Message clean-up: keep everything (default), or delete messages older than 2 years / 1 year / 6 months /
  90 days / 30 days. Checked every hour; **starred messages are always kept**; received files stay in Downloads.
- **Export to Excel or PDF.** Any chat: the info panel (ⓘ) → "Export to Excel" or "PDF / print" (choose "Microsoft Print to PDF").
  Admin → Export also does the staff directory to Excel.
- **Backups to a network folder.** Settings → Backups → "Also copy backups to a network folder": each daily backup is also saved,
  **locked with a password**, in a shared folder on another computer or a NAS (`\\SERVER\Backups`), the newest 7 per computer. Restore
  one with "Restore from a file" and its password. The LANX admin can set the folder for everyone.
- The tool buttons above the chat list now have their own row.

### New in 1.8.0: office
The **Office** button (building icon above the chat list) holds most of these.
- **Emergency alert.** Office → Emergency: pick Fire, Medical help, Evacuate, Assembly point, Stay inside or your own words,
  then **press and hold** the red button. Every colleague whose LANX is on gets a full-screen red alert with an alarm — even in
  Do not disturb, quiet hours or with LANX hidden in the tray — and answers **I'm safe** or **I need help**. You see who answered
  in a red bar at the top, and press **All clear** when it's over. Colleagues on older LANX get it as a message.
- **Intercom (walkie-talkie).** The 📻 button at the top of a chat: hold **Hold to talk**, speak, let go. It plays by itself on
  their computer straight away (to everyone online in a group), and stays in the chat as a voice note. Muted chats, Do not disturb
  and quiet hours don't play it out loud.
- **Reception desk.** Office → Reception (tick "This computer is the reception desk" to get a 🛎️ button above the chat list):
  type the visitor's name and company and choose who they're here to see. That colleague gets a visitor card and answers
  **Coming now**, **In 5 minutes**, **Send them in** or **Not available**; reception sees the answer and marks **They've met**.
- **Remote help.** The 🛟 button in a one-to-one chat: **Ask to see their screen** (to help them) or **Show them my screen**
  (when you need help). It's a voice call where the other person must agree and chooses which screen to share; either side can
  stop any time. (Seeing only — nobody controls the other computer.)
- **Birthdays.** Add yours in Settings → Profile (day and month only). On the day, colleagues see "🎂 … has a birthday today!"
  above the chat list with a **Wish** button (sends a 🎂 sticker), and Office → Birthdays lists the next 60 days.
- **Kudos.** Office → Kudos: thank a colleague with a badge (Thank you, Great teamwork, Problem solver, Above and beyond, Helping
  hand, Star of the week) and a note, in your chat with them or in a group. Others can 👏 clap; the month's top list is in Office → Kudos.
- **Out of office.** Office → Out of office: until when and your message. Anyone who messages you directly gets your automatic
  reply (once every 12 hours each), and your status shows "On leave".
- **Staff directory.** Peers → **Directory**: everyone with job title, department, phone, email and birthday, grouped by department, searchable.
- The ✎ button above the chat list now holds New chat, New group and Message everyone.
- Works with older versions: alerts, visitor and kudos cards reach older copies as text; birthdays and remote help need 1.8.0 on both sides.

### New in 1.7.0: tools
- **Chat folders, mute, archive, pin.** Right-click any chat in the list: **Pin to the top**, **Mute…** (1 hour, 8 hours,
  1 day, 1 week or until you turn it back on), **Chat folders…** and **Archive**. Folders (e.g. "Clients", "Site team")
  appear as buttons above your chats, next to **All**, **Unread** and **Archived**; the folder button with ＋ makes, renames
  and deletes folders. Muted chats show 🔕 and make no sound or pop-up (in groups you still hear an @mention).
- **Quiet hours** (Settings → General) — no sounds or pop-ups for messages, files and rings at the times and days you choose,
  e.g. 19:00 to 09:00. Messages still arrive; calls still come through.
- **Screenshot tool.** Press **Ctrl + Alt + S** anywhere in Windows (or the ✂ button next to the message box). Drag to choose
  the part you want, then mark it up: **arrows, boxes, pen, highlighter, text and blur** (to hide private numbers). Then
  **Send** it to any chat, **Copy** it, or **Save** it (Pictures → LANX Screenshots).
- **"Send to → LANX" in File Explorer.** Right-click files or folders → **Send to** → **LANX** (on Windows 11 first
  "Show more options"), pick one or more chats or colleagues, press **Send**. Turn it off in Settings → General.
- **Better search.** The **History** tab now has filters: Messages / Files / Links / Notices & tasks, in which chat, from whom,
  and when (today, past 7 days…). Click a result to jump straight to that message. Typing in the search box above your
  chats also offers **Search all messages for "…"**.
- **File library.** **Files → Library** shows every file you sent or received, with pictures as thumbnails. Filter by type
  (pictures, documents & PDFs, spreadsheets, videos, audio, zip), chat, sent/received; sort by date, size or name; open it,
  show it in its folder, or jump to the chat message.
- **Stickers.** The sticker button next to the message box: 24 big, friendly stickers (Thank you!, On it!, Coffee?, Happy Diwali!…).
- **Shared folders that stay in sync.** In a chat, press **+** → **Share a folder**. Colleagues press **Get this folder** on the card
  and choose where it goes. New and changed files then reach them by themselves (checked every 30 seconds while both computers
  are on), inside the same sub-folders. It works one way (from the person who shares), and nothing is ever deleted on the
  receiving side. See and manage everything in **Files → Shared folders** (open, send everything again, stop sharing / stop getting).
- Works with older versions: stickers and shared-folder cards reach colleagues on older LANX as plain text; shared folders,
  stickers and the rest start working with them once they update to 1.7.0.

### New in 1.6.0: organising
Press **+** next to the message box in any chat to post one of these. Everyone in the chat sees it update live.
- **Notices** — an announcement (mark it *important*); everyone presses **I've read it**, and you see who has
  read and confirmed it.
- **Polls** — a question with answers to tap (one or several); results show as bars with who voted.
- **Tasks** — what needs doing, for whom, and by when. They get a reminder on the due date and tick it off when done.
  Point at any message → **⋯ → Make a task…** to turn it into a task.
- **Approvals** — ask one or more colleagues to approve or reject (with an amount and details); they can add a note.
- **Checklists** — a shared list everyone can tick off and add to.
- **Schedule a meeting** — date, time, length, who, place and agenda; people answer Going / Maybe / Can't, everyone
  is reminded 10 minutes before, and a **Start meeting** button opens the LANX video meeting at the time.
- **Organiser** (clipboard button above the chat list, with a red number for what waits for you) — all notices,
  tasks, approvals, meetings, polls and checklists from every chat in one place, with **For me** on top.
- Colleagues on an older LANX get these as readable text until they update.

### New in 1.5.0: better chatting
Point at any message to get a small bar: quick reactions, **Reply** and **⋯** for everything else.
- **Reactions** — 👍 ❤️ 😂 😮 and more under any message; everyone sees who reacted. Click yours again to take it back.
- **Reply** — answer a specific message; the reply shows a quote you can click to jump to the original.
- **@mentions** — in group chats type **@** and pick a colleague. They get a "mentioned you" alert and the message is highlighted for them.
- **Edit** your messages (for 24 hours) — everyone sees the new text and "edited".
- **Delete for everyone** (for 2 days) or **Delete for me**.
- **Pin** important messages at the top of a chat, for everyone.
- **Star** messages to keep them: the ⭐ button at the top of the chat list shows all starred messages from every chat.
- **Remind me** about a message (in 20 minutes, 1 hour, tomorrow morning, next Monday or a time you pick) — it pops up with the cat island when due.
- **Send later** — type a message, press the calendar button and choose when; it waits above the message box (send now or cancel) and goes out by itself.
- **Quick replies** — type **/** to pick a ready-made answer ("On my way", "Received, thanks 👍"…); edit the list right there.
- **Voice notes** — when the message box is empty, press the microphone, talk, press send. Colleagues get it automatically and
  play it in the chat (with a waveform and 1×/1.5×/2× speed).
- Works with older versions: colleagues on 1.4 or earlier still get your messages and voice notes (as audio files); reactions,
  edits and the rest reach them once they update.

### New in 1.4.0: group meetings, recording, best-quality voice and video
- **Group video meetings.** Open a group chat and press **Meet**: everyone online in the group is
  invited (their LANX rings, with the cat on the Dynamic Island). Join with video or voice only.
  Up to 12 people; everyone is connected straight to everyone else across the office network —
  no server, nothing leaves the building.
- **In the meeting:** a grid of everyone (the person talking gets a green ring), mute, camera,
  **share your screen** (shown large), **raise your hand**, a **meeting chat**, **People** (see who
  is in and **invite more colleagues**), and **Make smaller** to keep chatting while the meeting
  runs in a small window with a pill on the Dynamic Island.
- **Recording** — meetings and one-to-one calls. Press record (meetings ask first). **Everyone sees
  "● Recording · Asha"** and a line in the chat, so nobody is recorded without knowing. The video
  (everyone's picture side by side, or the shared screen large, plus everyone's sound) is saved in
  Full HD on your PC in **Documents\LANX Recordings**; a "Recording saved" card in the chat has
  **Play** and **Show in folder**. Recordings never leave your computer.
- **Meeting summary in the chat:** "Meeting · 25 min · 4 people" with who was there and the meeting
  chat. Left by mistake? **Join again** on that card. Missed one? It shows as a missed meeting.
- **Maximum voice and video quality.** An office network is far faster than the internet links Zoom
  or Teams are tuned for, so LANX now asks for much more: 128 kbps Opus voice with lost-packet repair,
  Full HD camera in one-to-one calls (HD in meetings), up to 6 Mbps per picture, and screen sharing
  at full resolution and 30 frames a second that keeps text sharp. It starts sharp instead of slowly
  getting clearer, and only steps the picture down when a meeting gets large.
- Meetings need LANX 1.4.0 on both sides (older PCs are told to update); calls still work with
  1.2.2 and newer.

### New in 1.3.0: everyone sees everyone
- **More reliable discovery.** Before, LANX found colleagues only by broadcasting on the network, and
  Wi-Fi routers (and laptops saving power) often lose those broadcasts — so one PC could see another
  without being seen back. Now every PC also says hello **directly** to each colleague it knows.
- **Colleagues introduce each other.** Each PC shares where it sees the others; if you can see jines and
  jines can see Noopur, you and Noopur meet directly — even if the router drops the broadcasts between you.
- **Network search.** At start-up, and every 2 minutes while someone you know is missing (for example
  after the router gave their PC a new address), LANX looks for LANX on your local network. Peers has a
  **Search the network** button to look right away.
- Less flicker: a colleague counts as offline after 30 seconds without any sign (was 15).
- Works together with older versions (they are found and introduced too).
- **No more blank window at start-up.** If LANX couldn't use its WebView2 folder (for example after it
  was once run as administrator), the window stayed blank unless started as administrator. Now an
  administrator run uses its own folder, a folder LANX can't write is replaced by a fresh one, and if
  the window still hasn't loaded after 40 seconds LANX restarts itself once with a fresh folder.
  Chats and settings are not affected.

### New in 1.2.9: profiles — photo, status and about me
- **Avatar** — Settings → Profile: your **photo** (zoom and drag to frame it), a fun **character**
  (🐱 🦊 🐼 🦁 🚀 …) on your colour, or your initials. Colleagues see it in their chat list, chats,
  Peers, calls and the Dynamic Island.
- **Status** — Available, Busy, In a meeting, At lunch, Working from home, On the road, On leave or
  Do not disturb, plus your own words ("At Dolvi site till 4 pm"), clearing itself after 30 min,
  1 h, 4 h, today or this week. Click your name at the bottom of the chat list to change it quickly.
- **About me** — job title, department, phone/extension, email and a line about you, shown in your
  contact details (with copy buttons).
- **🌙 Do not disturb** — no sounds, pop-ups or cat while it's on; messages still arrive.
- A small copy of the photo travels only to colleagues on your network, and only when it changes.
  Colleagues on older versions keep seeing your initials until they update.

### New in 1.2.8: the cat rings bells and answers calls
- **Rings 🔔** — when someone rings you, the Dynamic Island opens and the cat rings a little bell
  (also on the desktop when LANX is hidden, instead of the Windows pop-up). When you ring someone,
  the cat rings it for you.
- **Calls 📞** — while a voice or video call is ringing, the island shows who it is and the cat holds a
  buzzing phone, with **Answer / Decline** (or **Cancel** for your own call). During the call the island
  becomes a small green pill with the call time; click it to show the call.
- The desktop island now appears without a title bar, fully see-through around the island and the cat.

### New in 1.2.7: Dynamic Island, the delivery cat, and how long files took
- **How long it took** — finished files show it, e.g. "⚡ 40.1 MB in 3.2 s · 12.5 MB/s", on both computers.
- **Dynamic Island** — a black capsule at the top of LANX, like the iPhone: it shows a file someone
  wants to send you (Accept / Later), what is being received or sent (click it for speed and time
  left), and "Received in 3.2 s" when it's done. New messages from other chats show there too.
- **The delivery cat 🐱** — a cartoon cat in a parcel box (files) or holding a letter (messages) drops
  down from the island on two strings, swings, blinks and waves; it cheers when you accept and climbs
  back up. Turn it off in Settings → Appearance → Delivery cat.
- **Even when LANX is hidden** (closed to the tray or behind other programs) the island appears at the
  top of the screen, with the cat. Click it to open the chat; files can be accepted right there. It
  never takes the keyboard away from what you're typing. Hidden chats, secret messages and a locked
  LANX show only "You have a new message". (If LANX is quit from the tray, nothing runs.)

### New in 1.2.6: smooth animations
- **Glass reveal** — switching Light/Dark, or picking a background, makes the new look grow as a soft
  circle from what you clicked while the old one frosts over.
- Windows (Settings, New group, PIN) spring open and fade away; the details panel slides in and out;
  the Settings list has a highlight that glides to the page you pick.
- **Messages you send spring up** from the message box; messages you receive pop in from the left.
  Opening a chat jumps straight to the newest message.
- Chats, Peers, Files and History fade in, with rows and cards appearing one after another; cards lift
  slightly under the mouse; unread counts pop; unlocking zooms the lock card away.
- Settings → Appearance → **Animations** turns them off (for slower computers). Windows' own
  "reduce animations" setting is respected too.

### New in 1.2.5: a new look, your colours everywhere
- **Glass design** — the chat list, details panel, top bars, message box and Settings are now
  see-through "glass" panels floating over a soft background, like on a Mac or iPhone.
- **Your background colours the whole app** — Settings → **Appearance** → Background: 11 ready-made
  colours or pick any colour. The chat list, chats, Peers, Files, History, Settings and the lock screen
  all follow it, in light and dark mode.
- **Accent colour** — choose the colour of your message bubbles, buttons and switches (10 colours or any colour).
- **Glass sliders** — **Transparency** (solid ↔ clear) and **Frost** (clear ↔ frosted), plus one-tap
  **Solid / Frosted / Crystal**. Everything changes live while you drag. On an older or slower PC,
  choose **Solid**.
- Messages scroll softly underneath the frosted top bar and message box; Settings has a Mac-style
  list with coloured icons and a live preview of your choices.

### New in 1.2.4: even faster
- **Compression while sending** — documents, spreadsheets, text, code and database files are squeezed
  on the fly (often 2–5× less data on the network). Photos, videos and zip files are sent as they are.
- **8 connections** for files over 256 MB.
- The speed test warns if a file is being sent at the same time (the result would be too low).

### New in 1.2.3: faster sending, whole folders
- **Big files travel over several connections at once** (4–8), which uses Wi-Fi much better than one.
  Still encrypted, still resumable, still checked at the end. (Both PCs need 1.2.3; with older versions
  LANX uses one connection as before — and they get the update automatically.)
- **Send whole folders** — the folder button next to 📎, or drag a folder into the chat. LANX packs it
  (compressing documents and code; photos and videos are left as they are), sends it as one transfer,
  and on 1.2.3 it arrives as a normal folder in Downloads. Older versions receive a .zip.
- **Test speed** — in a colleague's details (ⓘ). Shows the real network speed between the two PCs over
  1 and 4 connections. If it's slow, one PC is usually on 2.4 GHz/weak Wi-Fi: a cable or the 5 GHz
  Wi-Fi helps most.

### New in 1.2: calls, backups, clearer hidden chats
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
  src/networking/calls.rs    call set-up, ringing, missed calls (media itself is WebRTC in the window)
  src/backup.rs              daily/manual backups, encrypted backup files, restore on restart
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
