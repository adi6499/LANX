/** LANX 2.0 remote control: the messages between the two call windows.
 *
 *  They travel on a WebRTC data channel inside the call (encrypted, straight
 *  across the office network). The person being helped must press Allow
 *  before anything they receive reaches their mouse and keyboard, and LANX's
 *  Rust side checks that permission again for every batch (see remote.rs). */

/** One thing the person in control did (positions 0..1 across the screen). */
export type RemoteInput =
  | { t: "move"; x: number; y: number }
  | { t: "button"; b: number; down: boolean }
  | { t: "wheel"; dx: number; dy: number }
  | { t: "key"; code: string; down: boolean }
  | { t: "combo"; codes: string[] };

export type RemoteMsg =
  /** "I'm LANX 2.0 or newer": remote control is possible. */
  | { t: "hello"; v: number }
  /** May I control your screen? */
  | { t: "req" }
  /** Asking no longer (they pressed Cancel). */
  | { t: "unreq" }
  | { t: "allow"; screens: number }
  | { t: "deny"; why?: "no" | "not-sharing" | "busy" }
  /** The person being helped took control back (or the bar's Stop). */
  | { t: "stop" }
  /** The person in control let go. */
  | { t: "release" }
  | { t: "in"; e: RemoteInput[] }
  /** Copied text, for the other PC's clipboard. */
  | { t: "clip"; text: string }
  /** "That's the wrong screen": try the next one. */
  | { t: "next-screen" }
  | { t: "screens"; screens: number; screen: number };

export const REMOTE_CHANNEL = "lanx-remote";
export const REMOTE_VERSION = 2;
export const CLIP_MAX = 200_000;

/** Keys that the controlling PC keeps for itself, as buttons. */
export const COMBOS: { id: string; label: string; codes: string[] }[] = [
  { id: "start", label: "Start menu (Windows key)", codes: ["MetaLeft"] },
  { id: "alttab", label: "Switch window (Alt + Tab)", codes: ["AltLeft", "Tab"] },
  { id: "desktop", label: "Show the desktop (Windows + D)", codes: ["MetaLeft", "KeyD"] },
  { id: "explorer", label: "Open File Explorer (Windows + E)", codes: ["MetaLeft", "KeyE"] },
  { id: "run", label: "Run box (Windows + R)", codes: ["MetaLeft", "KeyR"] },
];

/** Wraps the call's data channel: JSON messages both ways. */
export class RemoteLink {
  private ch: RTCDataChannel;
  onMessage: (m: RemoteMsg) => void = () => {};
  onOpen: () => void = () => {};

  constructor(ch: RTCDataChannel) {
    this.ch = ch;
    ch.onmessage = (e) => {
      if (typeof e.data !== "string" || e.data.length > CLIP_MAX * 4 + 1000) return;
      try {
        const m = JSON.parse(e.data) as RemoteMsg;
        if (m && typeof m === "object" && typeof m.t === "string") this.onMessage(m);
      } catch {
        /* not ours */
      }
    };
    ch.onopen = () => {
      this.send({ t: "hello", v: REMOTE_VERSION });
      this.onOpen();
    };
    if (ch.readyState === "open") queueMicrotask(() => ch.onopen?.(new Event("open")));
  }

  /** The caller makes the channel before its offer, so it is part of the call. */
  static create(pc: RTCPeerConnection): RemoteLink {
    return new RemoteLink(pc.createDataChannel(REMOTE_CHANNEL, { ordered: true }));
  }

  get open() {
    return this.ch.readyState === "open";
  }

  send(m: RemoteMsg) {
    if (this.ch.readyState !== "open") return;
    try {
      this.ch.send(JSON.stringify(m));
    } catch {
      /* closing */
    }
  }

  close() {
    this.ch.onmessage = null;
    this.ch.onopen = null;
    try {
      this.ch.close();
    } catch {
      /* already closed */
    }
  }
}

/** Where a point on the video element falls on the shared screen (0..1), or
 *  null in the black bars around the picture. */
export function videoPoint(video: HTMLVideoElement, clientX: number, clientY: number): { x: number; y: number } | null {
  const r = video.getBoundingClientRect();
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh || !r.width || !r.height) return null;
  const scale = Math.min(r.width / vw, r.height / vh); // object-fit: contain
  const w = vw * scale;
  const h = vh * scale;
  const left = r.left + (r.width - w) / 2;
  const top = r.top + (r.height - h) / 2;
  const x = (clientX - left) / w;
  const y = (clientY - top) / h;
  if (x < -0.01 || y < -0.01 || x > 1.01 || y > 1.01) return null;
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

/** Browser wheel steps to Windows wheel units (120 = one notch, positive =
 *  up); fractions add up across small touchpad steps. */
export function wheelUnits(delta: number, mode: number): number {
  if (mode === 1) return -delta * 40; // lines (3 per notch)
  if (mode === 2) return -delta * 360; // pages
  return -delta * 1.2; // pixels (100 per notch)
}
