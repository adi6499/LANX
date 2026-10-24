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

/** The camera: HD for one-to-one calls, a little less for meetings (many
 *  pictures are sent at once). LANX 2.8.0: Full HD looked sharp on paper but
 *  stuttered on office laptops (the encoder could not keep up); HD at a
 *  steady 30 fps feels live. Falls back to whatever the camera can do. */
export async function getCamera(kind: "call" | "meeting"): Promise<MediaStreamTrack | null> {
  const hd = kind === "call" ? { width: 1280, height: 720 } : { width: 960, height: 540 };
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
  maxaveragebitrate: "64000", // LANX 2.8.0: clear voice; more only adds delay
  maxplaybackrate: "48000",
  minptime: "10",
  ptime: "20",
};
/** Start at a sensible rate and climb (2.8.0: starting high stalled on Wi-Fi). */
const VIDEO_START = "x-google-start-bitrate=1000;x-google-min-bitrate=250";

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
  opts: { maxBitrate: number; scale?: number; screen?: boolean; audio?: boolean; live?: boolean; fps?: number }
): Promise<void> {
  if (!sender) return;
  try {
    const p = sender.getParameters() as SendParams;
    if (!p.encodings?.length) return; // not negotiated yet
    const e = p.encodings[0] as Encoding;
    e.maxBitrate = Math.round(opts.maxBitrate);
    e.priority = "high";
    e.networkPriority = "high";
    if (!opts.audio) {
      e.scaleResolutionDownBy = Math.max(1, opts.scale ?? 1);
      e.maxFramerate = opts.fps ?? 30;
      // A shown screen keeps its sharpness; while someone controls it
      // (`live`, LANX 2.1.0) the frame rate matters as much, or every
      // click looks late. A camera (2.8.0) keeps its motion smooth: a
      // softer picture is fine, a stuttering one is not.
      p.degradationPreference = opts.screen ? (opts.live ? "balanced" : "maintain-resolution") : "maintain-framerate";
    }
    await sender.setParameters(p);
  } catch {
    /* an older WebView ignores what it doesn't know */
  }
}

/** LANX 2.8.0: ask for H.264 first (office laptops encode it in hardware, so
 *  the CPU stays free and frames are never late), then VP8 (cheap), then the
 *  heavier ones. Call before an offer or answer is made. */
export function preferCodecs(pc: RTCPeerConnection): void {
  try {
    const caps = RTCRtpReceiver.getCapabilities?.("video");
    if (!caps?.codecs?.length) return;
    const rank = (c: { mimeType: string; sdpFmtpLine?: string }) => {
      const m = c.mimeType.toLowerCase();
      const f = (c.sdpFmtpLine ?? "").toLowerCase();
      if (m === "video/h264") return f.includes("packetization-mode=1") ? (f.includes("42e01f") || f.includes("42001f") ? 0 : 1) : 2;
      if (m === "video/vp8") return 3;
      if (m === "video/vp9") return 4;
      if (m === "video/av1") return 5;
      return 6; // rtx / red / ulpfec stay after their codecs
    };
    const ordered = [...caps.codecs].sort((a, b) => rank(a) - rank(b));
    for (const t of pc.getTransceivers()) {
      const kind = t.receiver.track?.kind ?? t.sender.track?.kind;
      if (kind === "video" && typeof t.setCodecPreferences === "function") t.setCodecPreferences(ordered);
    }
  } catch {
    /* an older WebView: the default order is used */
  }
}

/** LANX 2.8.0: keeps a call real-time. Every two seconds it reads how the
 *  picture is doing (encoder or network limited? packets lost? round trip?)
 *  and steps the picture down a notch at once — smaller and lighter, never
 *  late — then back up after ten quiet seconds. Returns a stop function. */
export function watchQuality(
  pc: RTCPeerConnection,
  getSender: () => RTCRtpSender | null | undefined,
  getBudget: () => { maxBitrate: number; scale: number },
  opts: { screen: () => boolean; live?: () => boolean; onLevel?: (level: number, why: string) => void }
): () => void {
  const SCALE = [1, 1.5, 2, 3];
  const RATE = [1, 0.6, 0.4, 0.25];
  const FPS = [30, 30, 24, 20];
  let level = 0;
  let good = 0;
  let applied = -1;
  const apply = (why: string) => {
    const b = getBudget();
    void tuneSender(getSender(), {
      maxBitrate: Math.max(200_000, b.maxBitrate * RATE[level]),
      scale: b.scale * SCALE[level],
      screen: opts.screen(),
      live: opts.live?.() ?? false,
      fps: FPS[level],
    });
    if (applied !== level) opts.onLevel?.(level, why);
    applied = level;
  };
  const timer = window.setInterval(async () => {
    if (pc.connectionState !== "connected") return;
    let reason = "none";
    let lost = 0;
    let rtt = 0;
    try {
      (await pc.getStats()).forEach((x) => {
        if (x.type === "outbound-rtp" && x.kind === "video") reason = x.qualityLimitationReason ?? "none";
        if (x.type === "remote-inbound-rtp" && x.kind === "video") {
          lost = Math.max(lost, x.fractionLost ?? 0);
          rtt = Math.max(rtt, x.roundTripTime ?? 0);
        }
        if (x.type === "candidate-pair" && x.state === "succeeded" && x.nominated) rtt = Math.max(rtt, x.currentRoundTripTime ?? 0);
      });
    } catch {
      return;
    }
    const bad = reason === "cpu" || reason === "bandwidth" || lost > 0.03 || rtt > 0.2;
    const fine = reason === "none" && lost < 0.01 && rtt < 0.12;
    if (bad) {
      good = 0;
      if (level < 3) {
        level += 1;
        apply(reason !== "none" ? reason : lost > 0.03 ? "loss" : "delay");
      }
    } else if (fine) {
      good += 1;
      if (good >= 5 && level > 0) {
        level -= 1;
        good = 0;
        apply("recovered");
      }
    } else good = 0;
    if (applied < 0) apply("start");
  }, 2000);
  return () => window.clearInterval(timer);
}

/** LANX 2.1.0: show each frame of a shared screen as soon as it arrives
 *  (no waiting buffer: on the office network frames arrive in time). */
export function liveReceiver(receiver: RTCRtpReceiver, live: boolean) {
  const r = receiver as unknown as Record<string, number | null>;
  try {
    if ("jitterBufferTarget" in receiver) r.jitterBufferTarget = live ? 0 : null;
    else if ("playoutDelayHint" in receiver) r.playoutDelayHint = live ? 0 : null;
  } catch {
    /* an older WebView */
  }
}

/** LANX 2.1.0: how fast their screen reaches us: frames per second and
 *  about how long a frame takes (network + waiting + decoding), from the
 *  difference between two stats readings. */
export interface PictureStats {
  fps: number;
  delayMs: number;
}
export async function pictureStats(
  pc: RTCPeerConnection,
  prev: { buf: number; out: number; dec: number; frames: number } | null
): Promise<{ stats: PictureStats | null; snap: { buf: number; out: number; dec: number; frames: number } | null }> {
  let fps = 0;
  let rtt = 0;
  let snap: { buf: number; out: number; dec: number; frames: number } | null = null;
  (await pc.getStats()).forEach((x) => {
    if (x.type === "inbound-rtp" && x.kind === "video") {
      fps = x.framesPerSecond ?? 0;
      snap = { buf: x.jitterBufferDelay ?? 0, out: x.jitterBufferEmittedCount ?? 0, dec: x.totalDecodeTime ?? 0, frames: x.framesDecoded ?? 0 };
    }
    if (x.type === "candidate-pair" && x.state === "succeeded" && x.nominated) rtt = x.currentRoundTripTime ?? 0;
  });
  const now = snap as { buf: number; out: number; dec: number; frames: number } | null;
  if (!now || !prev || now.out <= prev.out || now.frames <= prev.frames) return { stats: null, snap: now };
  const wait = (now.buf - prev.buf) / (now.out - prev.out);
  const decode = (now.dec - prev.dec) / (now.frames - prev.frames);
  return { stats: { fps: Math.round(fps), delayMs: Math.round((wait + decode + rtt / 2) * 1000) }, snap: now };
}

/** Voice: 64 kbps Opus with loss repair — clear, and never a queue of sound. */
export const VOICE_BITRATE = 64_000;

/** Video for a call or meeting of `people` (us included). LANX 2.8.0: office
 *  Wi-Fi and laptop encoders are the limit, not the wire — budgets that
 *  stay smooth; the quality watch climbs or steps down from here. */
export function videoBudget(people: number, screen: boolean): { maxBitrate: number; scale: number } {
  if (screen) return { maxBitrate: people <= 2 ? 5_000_000 : people <= 4 ? 3_000_000 : 2_000_000, scale: 1 };
  if (people <= 2) return { maxBitrate: 2_500_000, scale: 1 };
  if (people <= 4) return { maxBitrate: 1_200_000, scale: 1.5 };
  if (people <= 6) return { maxBitrate: 800_000, scale: 2 };
  return { maxBitrate: 600_000, scale: 2 };
}

/** "4:05" / "1:02:09" */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
