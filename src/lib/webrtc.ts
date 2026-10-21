/** Shared WebRTC helpers (calls and LANX 1.4.0 meetings). Everything stays on
 *  the LAN: no internet (STUN/TURN) servers are ever used.
 *
 *  Quality: an office network is many times faster than the internet links
 *  that Zoom or Teams are tuned for, so LANX asks for much more — clear
 *  high-bitrate voice with loss protection, HD camera pictures at high
 *  bitrates, and razor-sharp screen sharing — and only steps down when a
 *  meeting gets large (everyone sends to everyone). */

/** Waits until the browser has listed this computer's network addresses, so
 *  one offer/answer carries everything. */
export function iceGathered(pc: RTCPeerConnection, ms = 2500): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    const check = () => pc.iceGatheringState === "complete" && done();
    const timer = setTimeout(done, ms);
    pc.addEventListener("icegatheringstatechange", check);
  });
}

/** The microphone, cleaned up for talking (echo / noise / level), at the
 *  full 48 kHz Opus rate. */
export async function getMic(): Promise<MediaStreamTrack | null> {
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: { ideal: 1 },
        sampleRate: { ideal: 48000 },
        sampleSize: { ideal: 16 },
      },
    });
    const t = s.getAudioTracks()[0] ?? null;
    if (t) t.contentHint = "speech";
    return t;
  } catch {
    return null;
  }
}

/** The camera: Full HD for one-to-one calls, HD for meetings (many pictures
 *  are sent at once). Falls back to whatever the camera can do. */
export async function getCamera(kind: "call" | "meeting"): Promise<MediaStreamTrack | null> {
  const hd = kind === "call" ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
  for (const video of [
    { width: { ideal: hd.width }, height: { ideal: hd.height }, frameRate: { ideal: 30, max: 30 } },
    true as const,
  ]) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video });
      const t = s.getVideoTracks()[0] ?? null;
      if (t) t.contentHint = "motion";
      return t;
    } catch {
      /* try the simpler request */
    }
  }
  return null;
}

export const getMeetingCam = () => getCamera("meeting");

/** Screen sharing: the full screen resolution at up to 30 fps, tuned so text
 *  stays sharp. */
export async function getScreen(wholeScreen = false): Promise<MediaStreamTrack | null> {
  const video: MediaTrackConstraints & { displaySurface?: string } = {
    frameRate: { ideal: 30, max: 30 },
    width: { max: 3840 },
    height: { max: 2160 },
  };
  // LANX 2.0: remote control needs a whole screen, not a single window.
  if (wholeScreen) video.displaySurface = "monitor";
  const s = await navigator.mediaDevices.getDisplayMedia({ video, audio: false });
  const t = s.getVideoTracks()[0] ?? null;
  if (t) t.contentHint = "detail";
  return t;
}

const VIDEO_CODECS = new Set(["VP8", "VP9", "H264", "AV1"]);
const OPUS: Record<string, string> = {
  useinbandfec: "1", // repairs lost sound packets
  usedtx: "0", // never drop to "comfort noise"
  stereo: "0",
  "sprop-stereo": "0",
  maxaveragebitrate: "128000", // studio-clear voice
  maxplaybackrate: "48000",
  minptime: "10",
};
/** Start sharp instead of ramping up from a blurry picture. */
const VIDEO_START = "x-google-start-bitrate=2500;x-google-min-bitrate=300";

function mergeParams(existing: string, extra: Record<string, string>) {
  const map = new Map<string, string>();
  for (const part of existing.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k) map.set(k, v.join("="));
  }
  for (const [k, v] of Object.entries(extra)) map.set(k, v);
  return [...map].map(([k, v]) => (v === "" ? k : `${k}=${v}`)).join(";");
}

/** Raises the codec settings in a session description: high-bitrate Opus
 *  voice with loss protection, and video that starts at a sharp bitrate.
 *  Applied to the other side's description, so it tunes what we send. */
export function tuneSdp(sdp: string): string {
  const nl = sdp.includes("\r\n") ? "\r\n" : "\n";
  const lines = sdp.split(/\r?\n/);
  const codec = new Map<string, string>();
  const hasFmtp = new Set<string>();
  for (const l of lines) {
    const r = /^a=rtpmap:(\d+) ([\w-]+)\//.exec(l);
    if (r) codec.set(r[1], r[2].toUpperCase());
    const f = /^a=fmtp:(\d+) /.exec(l);
    if (f) hasFmtp.add(f[1]);
  }
  const out: string[] = [];
  for (const l of lines) {
    const f = /^a=fmtp:(\d+) (.*)$/.exec(l);
    if (f) {
      const name = codec.get(f[1]);
      if (name === "OPUS") {
        out.push(`a=fmtp:${f[1]} ${mergeParams(f[2], OPUS)}`);
        continue;
      }
      if (name && VIDEO_CODECS.has(name) && !f[2].includes("x-google-start-bitrate")) {
        out.push(`${l};${VIDEO_START}`);
        continue;
      }
    }
    out.push(l);
    const r = /^a=rtpmap:(\d+) ([\w-]+)\//.exec(l);
    if (r && !hasFmtp.has(r[1])) {
      const name = r[2].toUpperCase();
      if (name === "OPUS") out.push(`a=fmtp:${r[1]} ${mergeParams("", OPUS)}`);
      else if (VIDEO_CODECS.has(name)) out.push(`a=fmtp:${r[1]} ${VIDEO_START}`);
    }
  }
  return out.join(nl);
}

type Encoding = RTCRtpEncodingParameters & { priority?: string; networkPriority?: string };
type SendParams = RTCRtpSendParameters & { degradationPreference?: string };

/** Sets how much a sender may use (bits per second) and what it keeps when
 *  the network or computer is busy: sharpness for screens, smooth motion for
 *  cameras, and voice always first. */
export async function tuneSender(
  sender: RTCRtpSender | null | undefined,
  opts: { maxBitrate: number; scale?: number; screen?: boolean; audio?: boolean }
): Promise<void> {
  if (!sender) return;
  try {
    const p = sender.getParameters() as SendParams;
    if (!p.encodings?.length) return; // not negotiated yet
    const e = p.encodings[0] as Encoding;
    e.maxBitrate = opts.maxBitrate;
    e.priority = "high";
    e.networkPriority = "high";
    if (!opts.audio) {
      e.scaleResolutionDownBy = opts.scale ?? 1;
      e.maxFramerate = 30;
      p.degradationPreference = opts.screen ? "maintain-resolution" : "balanced";
    }
    await sender.setParameters(p);
  } catch {
    /* an older WebView ignores what it doesn't know */
  }
}

/** Voice: 128 kbps Opus (far beyond phone quality). */
export const VOICE_BITRATE = 128_000;

/** Video for a call or meeting of `people` (us included). */
export function videoBudget(people: number, screen: boolean): { maxBitrate: number; scale: number } {
  if (screen) return { maxBitrate: people <= 2 ? 8_000_000 : people <= 4 ? 6_000_000 : 3_000_000, scale: 1 };
  if (people <= 2) return { maxBitrate: 6_000_000, scale: 1 };
  if (people <= 4) return { maxBitrate: 2_500_000, scale: 1 };
  if (people <= 6) return { maxBitrate: 1_500_000, scale: 1.5 };
  return { maxBitrate: 1_000_000, scale: 2 };
}

/** "4:05" / "1:02:09" */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
