/** LANX 3.7.0: "What's new" — after an update, the first time LANX opens it
 *  shows what the new version brings. A new install shows nothing (it is all
 *  new). Settings → Updates shows it again any time. */
import { getVersion } from "@tauri-apps/api/app";
import { api } from "./api";

export interface ReleaseItem {
  /** An emoji for the line. */
  icon: string;
  title: string;
  text: string;
}
export interface Release {
  version: string;
  title: string;
  items: ReleaseItem[];
}

/** Newest first. Plain words: this is read by everyone, not only IT. */
export const RELEASES: Release[] = [
  {
    version: "3.13.1",
    title: "Smooth on Linux",
    items: [
      { icon: "⚡", title: "LANX on Linux uses the graphics chip", text: "Until now LANX on Linux drew every picture with the processor alone, to be safe on every PC. That made it stutter and seem to hang. Now it draws with the PC’s graphics chip, like on Windows: scrolling, typing and opening chats are smooth." },
      { icon: "🚀", title: "Opens right away on Linux", text: "On Linux, LANX used to wait six seconds before it showed its window, every time it started. Now the window appears as soon as it is ready." },
      { icon: "🛟", title: "Still careful where it must be", text: "PCs with NVIDIA’s own driver, virtual machines and PCs without a known graphics driver keep the careful way. If LANX ever fails to open with the graphics chip, it goes back to the careful way by itself." },
      { icon: "💡", title: "Good to know", text: "Nothing changes on Windows. On Linux you can choose by hand: right-click the LANX icon in the applications menu → “Open with the graphics chip” or “Open without the graphics chip”. Settings → Diagnostics shows which one is in use." },
    ],
  },
  {
    version: "3.13.0",
    title: "Calls and meetings on Linux Mint",
    items: [
      { icon: "📞", title: "Voice and video calls on Linux", text: "LANX for Linux can now call and be called — voice and video, with Windows PCs, phones and other Linux PCs. Mint’s web engine has no calling part, so LANX now brings its own." },
      { icon: "👥", title: "Meetings on Linux", text: "Join or start a meeting from Linux Mint like on Windows: cameras, microphones and screen pictures from everyone." },
      { icon: "🎲", title: "Live games and the phone camera on Linux", text: "Games that play live with a colleague and using your phone as the PC’s camera now work on Linux too — they use the same new calling part." },
      { icon: "💡", title: "Good to know", text: "Nothing changes on Windows. On Linux the picture is a little smaller (up to 960 × 540) to stay smooth on older PCs. Everyone on the call needs LANX 3.0 or newer, as before." },
    ],
  },
  {
    version: "3.12.0",
    title: "Linux as good as Windows, and light on 4 GB",
    items: [
      { icon: "📷", title: "The camera works on Linux", text: "LANX for Linux never answered the camera's “may I?”, so it was always refused. Now hand gestures start on Linux too." },
      { icon: "🖐️", title: "Hands control the whole PC on Linux Mint", text: "Settings → Gestures → Control the whole PC now works on Linux Mint (and other Linux desktops that use X11): move the mouse, click, scroll, type with the air keyboard and resize any window with two hands — like on Windows." },
      { icon: "🪶", title: "Lighter on memory", text: "LANX's small windows (alerts, the hands bar) used to load the whole app; now they load only their own part, are made only when needed and put away when unused. While LANX sits in the tray on Windows it gives memory back." },
      { icon: "⚡", title: "Smoother on 4 GB PCs", text: "On PCs with 4 GB of memory or less, LANX draws the light look Linux uses: no frosted glass, soft shadows or ever-moving decorations — the same LANX, just quicker." },
      { icon: "🎲", title: "Ludo and Snakes & Ladders look real", text: "A wooden frame, a printed cardboard board, glossy pieces that stand on a base, wooden ladders and snakes with scales — like the real board games." },
      { icon: "🎆", title: "Fireworks when someone wins", text: "In every game: the board goes dark, fireworks go up and a banner says who won." },
      { icon: "⛶", title: "Play full screen", text: "Games → Full screen makes the board as big as your screen (Esc to come back)." },
      { icon: "🎵", title: "Music made for the phone", text: "On LANX on your phone, tap a song to play it; one ⋯ next to each song opens big buttons for play next, my songs, playlists, sending and WhatsApp. The player bar shows only once something plays." },
      { icon: "💡", title: "Good to know", text: "Calls and meetings on Linux Mint aren't here yet: Mint's web engine has no video-calling part, so LANX needs its own — that is the next big step." },
    ],
  },
  {
    version: "3.11.2",
    title: "Resize any window with your hands, and a real Snakes & Ladders",
    items: [
      { icon: "👐", title: "Resize any window with two hands", text: "With “Control the whole PC” on, hold both open hands up around a window — Excel, a browser, anything. Hands apart make it bigger, together smaller; keep going past the screen and it fills it. Lower a hand and it stays that size." },
      { icon: "🐍", title: "Snakes & Ladders, drawn properly", text: "A bright board in a wooden frame, wooden ladders, striped snakes with heads, and real pawns that wait at the start. After each roll the die tumbles, then your pawn hops square by square, climbs the ladder or slides down the snake." },
      { icon: "💡", title: "Good to know", text: "Snakes & Ladders still plays with colleagues on older LANX — only the look is new. Gestures: Settings → Gestures lists every move, including the new two-hand resize." },
    ],
  },
  {
    version: "3.11.1",
    title: "Online means online",
    items: [
      { icon: "🟢", title: "Colleagues who are there show online", text: "Some PCs could not find anyone all day, and nobody could find them, when Windows had set aside the port LANX uses for this (it happens on PCs with Hyper-V, WSL or Docker, and changes after each restart). LANX now keeps trying and moves to a free port, and colleagues still find that PC." },
      { icon: "🔄", title: "The list puts itself right", text: "The online dots are checked again every 15 seconds and whenever you come back to LANX, so a colleague who is there never stays grey. Group dots follow too." },
      { icon: "⏳", title: "No more flicking to offline", text: "A colleague whose PC answered slowly could flick to offline and back. LANX now waits for the answer, and gives colleagues who announce themselves less often as long as they need." },
      { icon: "💡", title: "Good to know", text: "Each PC needs 3.11.1 for its own part of the fix: send the update to everyone from Settings → Updates. Settings → Diagnostics shows which port this PC finds colleagues on." },
    ],
  },
  {
    version: "3.11.0",
    title: "Faster and smoother, and Linux made easy",
    items: [
      { icon: "⚡", title: "Chats open at once", text: "Even a chat with years of messages opens straight away: it shows the newest ones, and older ones appear as you scroll up. Measured on Windows: 1.5 seconds before, about a tenth of a second now." },
      { icon: "⌨️", title: "Typing keeps up", text: "Typing in a long chat no longer slows LANX down: each key appears at once instead of the whole conversation being redrawn." },
      { icon: "🪟", title: "No more freezing while LANX works", text: "Reading a long chat, a picture or a file now happens in the background, so the window keeps moving." },
      { icon: "🐧", title: "Smoother on Linux", text: "On Linux, chats open about ten times faster, scrolling runs nearly twice as smooth, and typing no longer stutters." },
      { icon: "✅", title: "LANX always opens on Linux", text: "If an earlier LANX got stuck, opening LANX replaces it. Right-click the LANX icon → Restart LANX does the same. On desktops without a tray, closing LANX keeps it in the taskbar." },
      { icon: "📦", title: "Easy to install on Linux", text: "One line in the Terminal installs (or updates) LANX on Ubuntu, Debian, Mint and Fedora: see the download page. Fedora gets its own package now." },
    ],
  },
  {
    version: "3.10.0",
    title: "Big meetings: up to 100 people",
    items: [
      { icon: "👥", title: "Meetings for the whole office", text: "A group meeting can now have up to 100 people (it was 12). Start a meeting in a group as usual: with more than 12 people, LANX makes it a big meeting by itself." },
      { icon: "🛰️", title: "The organizer's PC passes it on", text: "In a big meeting each PC sends its picture and voice once, to the organizer's PC, which passes them to everyone. So 100 people don't need 100 connections each, and every PC stays smooth." },
      { icon: "🗣️", title: "You see who's talking", text: "Up to 16 pictures a page (cameras first; flip pages at the top). Whoever is talking pops up in a small window, even when they're on another page, and the six loudest voices are heard." },
      { icon: "🎉", title: "Together, inside a call", text: "The new Together button in a meeting starts a quiz, a presentation, a video, music or a bell with everyone in the call, already ticked." },
      { icon: "💡", title: "Good to know", text: "Everyone needs LANX 3.10.0 or newer, joining from a PC (phones join meetings of up to 12). The meeting ends when the organizer leaves, so the organizer's PC should stay on and plugged in." },
    ],
  },
  {
    version: "3.9.0",
    title: "Together: quiz, karaoke, bells, announcements, presenting, watching",
    items: [
      { icon: "🎉", title: "Together", text: "Wrench menu → Together: everything below, with colleagues, on all your PCs at once — each lined up to the host's clock to the millisecond." },
      { icon: "📱", title: "Phones join Listen together", text: "When your PC listens together, your phone can play along in step (Music on the phone → Play on this phone too), or join an invite itself." },
      { icon: "🎤", title: "Karaoke", text: "Big lyrics, the line being sung filling up as it goes. Listening together, every PC shows the same line at the same moment." },
      { icon: "🧠", title: "Live quiz", text: "Ask questions on everyone's screen; the fastest right answer wins — fair to the millisecond, whatever each PC's clock says." },
      { icon: "📢", title: "Announcements", text: "Hold to talk, let go: every chosen PC plays it at the same moment, so a room of PCs sounds like one voice." },
      { icon: "🔔", title: "Bells and timers", text: "Lunch, tea, stand-up: rings on every chosen PC at the same second, with a countdown on screen." },
      { icon: "🖥️", title: "Present to everyone", text: "Open a PDF or pictures; everyone who joins follows your page and your pointer. No projector needed." },
      { icon: "🎬", title: "Watch together", text: "A video file from your PC (or a link) plays on every PC in step — you play, pause and jump for everyone." },
    ],
  },
  {
    version: "3.8.0",
    title: "Listen together, and the right pictures",
    items: [
      { icon: "🎧", title: "Listen together", text: "Play music for colleagues: everyone who joins hears the same moment of the same song on their own PC — in step to the millisecond. Music → Together, pick who, and they get an invite. You choose the songs; they can change their volume or leave." },
      { icon: "🖼️", title: "Every song with its own picture", text: "A song shows its film's or album's own cover — not the picture of some party-mix compilation it was copied onto — and Discover's pictures are sharp instead of blurry." },
      { icon: "✨", title: "Music screens move as they should", text: "Now playing’s sliding covers and drifting colours now work in the installed LANX — they were being blocked. So are the gesture guide’s and Ludo’s animations." },
      { icon: "🔎", title: "Each song once in search", text: "Search used to list the same song ten times, once per compilation. Now each recording appears once: the original. (Lofi, remix and instrumental versions still show — they are different recordings.)" },
    ],
  },
  {
    version: "3.7.1",
    title: "Smoother hands, and easy to learn",
    items: [
      { icon: "🧈", title: "The mouse glides", text: "Your hand moves the mouse smoothly now — about 120 small steps a second instead of a jump with every camera picture. Dragging and scrolling glide too, in LANX and in every other program." },
      { icon: "🎓", title: "Learn hand gestures", text: "A short hands-on practice: show your hand, point, pinch a button, drag a ball, scroll with a fist, type in the air. Each step ticks off when LANX sees you do it. The hand button's menu → Learn." },
      { icon: "💬", title: "LANX tells you what it sees", text: "A few words by the hand button — “✋ Moving · pinch to click”, “✊ Scrolling — open your hand to let go” — so you always know what your hand is doing." },
    ],
  },
  {
    version: "3.7.0",
    title: "Your hands, for the whole PC",
    items: [
      { icon: "🖱️", title: "Control the whole PC with your hand", text: "Turn it on in Gesture settings: your hand moves the real mouse in every program — Chrome, Excel, File Explorer. Pinch to click, make a fist to scroll. It keeps working while LANX is minimised." },
      { icon: "⌨️", title: "Type in the air", text: "A keyboard you type on by pointing and pinching, with word suggestions and 🎤 to type what you say. It comes up when you pinch a text box; over other programs hold up 🤟." },
      { icon: "🤙", title: "Signs of your own", text: "Teach LANX a hand sign and choose what it does — open the keyboard, mute, play music, call someone, take a screenshot, lock the PC. Gesture settings → Your signs." },
      { icon: "🙋", title: "Hands in calls and meetings", text: "Raise your hand high to raise it in a meeting, hold your palm up to the camera to mute, 👍 sends a reaction everyone sees, and a wave ends the call (make a fist to stay)." },
      { icon: "🗣️", title: "New things to say", text: "“Open keyboard”, “type see you at 5”, “press ctrl c”, “take a screenshot”, “lock this PC”, “show LANX”." },
    ],
  },
  {
    version: "3.6.2",
    title: "Your phone as the PC's camera",
    items: [
      { icon: "📱", title: "No camera on the PC? Use your phone's", text: "For video calls, meetings and hand gestures: open LANX on your paired phone and tap Allow." },
      { icon: "🤏", title: "A pinch clicks at once", text: "On whatever the pointer is showing. In a list, pinch and hold for the right-click menu." },
      { icon: "🐧", title: "Smoother on Linux", text: "LANX scrolls and moves much more smoothly there." },
    ],
  },
  {
    version: "3.6.1",
    title: "Gestures for everyone",
    items: [
      { icon: "✋", title: "A hand button", text: "In the top row of icons: gestures on and off in one click." },
      { icon: "⏳", title: "Hold still to click", text: "Rest the pointer on a button — it fills up, then clicks." },
      { icon: "🎨", title: "Readable on any wallpaper", text: "Panels stay solid enough for every bit of text to read clearly." },
    ],
  },
];

const parts = (v: string) => v.split(".").map((n) => Number(n) || 0);
/** a is newer than b. */
export function newer(a: string, b: string): boolean {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

/** What to show after an update from `seen` to `now` (newest first, at most three
 *  versions). Nothing for a new install. Unknown `seen` (an update from before
 *  3.7.0, which didn't keep it): just this version's. */
export function releasesSince(seen: string | null, now: string, isNewInstall: boolean): Release[] {
  if (isNewInstall || seen === now) return [];
  const list = seen ? RELEASES.filter((r) => newer(r.version, seen) && !newer(r.version, now)) : RELEASES.filter((r) => r.version === now);
  return list.slice(0, 3);
}

export function releaseNotes(version: string): Release | null {
  return RELEASES.find((r) => r.version === version) ?? null;
}

/** On start: what this update brings (and remember that it was shown). */
export async function whatsNewOnStart(onboarded: boolean): Promise<Release[]> {
  if (!("__TAURI_INTERNALS__" in window)) return [];
  const now = await getVersion();
  const seen = await api.getPref("whats_new").catch(() => null);
  if (seen !== now) await api.setPref("whats_new", now).catch(() => {});
  return releasesSince(seen, now, !onboarded);
}
