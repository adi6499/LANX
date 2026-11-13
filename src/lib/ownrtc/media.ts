/** LANX 3.13.0: the page's half of LANX's own call engine — the camera and the
 *  microphone squeezed small (WebCodecs) and handed to the engine (src-tauri
 *  ownrtc.rs), and what comes in shown and played. Used where the web engine has
 *  no RTCPeerConnection (Linux); see ./index.ts for the stand-in itself.
 *
 *  One encoder per camera (or microphone) and setting: in a meeting, the same
 *  squeezed picture goes to everyone who gets that setting. */
import { invoke } from "@tauri-apps/api/core";

/** Who gets a picture or a piece of sound: a connection and its media line. */
export interface Target {
  /** The engine's connection number (0 until it is open). */
  conn(): number;
  /** The media line, once agreed. */
  mid(): string | null;
  /** Sending now (connected, direction includes "send"). */
  live(): boolean;
}

export interface VideoSettings {
  maxBitrate: number;
  scale: number;
  fps: number;
}

const MAX_W = 1280;
const MAX_H = 720;
/** Linux PCs squeeze in software: a lighter picture keeps them smooth. */
const SOFT_MAX_W = 960;
const SOFT_MAX_H = 540;
const KEY_EVERY_MS = 4000;

const now = () => performance.now();

/** Sends one squeezed piece to every target, in order (one at a time per encoder). */
class Writer {
  private chain: Promise<unknown> = Promise.resolve();
  pending = 0;
  constructor(private audio: boolean) {}
  write(rtp: number, data: Uint8Array, targets: Target[]) {
    const to = targets
      .filter((t) => t.live() && t.conn() > 0 && t.mid() !== null)
      .map((t) => `${t.conn()}:${t.mid()}`)
      .join(",");
    if (!to) return;
    this.pending++;
    const header = `k=${this.audio ? "a" : "v"};t=${Math.round(rtp)};to=${to}`;
    this.chain = this.chain
      .then(() => invoke("ownrtc_write", data, { headers: { "x-ownrtc": header } }))
      .catch(() => {})
      .finally(() => this.pending--);
  }
}

// ------------------------------------------------------------------ sound

let ctx: AudioContext | null = null;
let worklet: Promise<boolean> = Promise.resolve(false);
/** Sound straight to the speakers too (not only through the page's <audio>): set when
 *  the web engine can't play a stream of made sound (see index.ts). */
export const sound = { direct: false };
/** One sound context for everything (48 kHz, Opus's own rate). */
export function audioContext(): AudioContext {
  if (!ctx) {
    const c = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
    ctx = c;
    worklet = c.audioWorklet.addModule("/lanx-ownrtc-audio.js").then(
      () => true,
      (e) => {
        console.warn("[ownrtc] audio worklet unavailable, using the older way", e);
        return false;
      },
    );
    // (Sound may only start after a click: the first click anywhere starts it.)
    const wake = () => void c.resume().catch(() => {});
    for (const ev of ["pointerdown", "keydown"]) document.addEventListener(ev, wake, { capture: true });
    wake();
  }
  return ctx;
}

/** Encodes one microphone track for everyone who gets it. */
class AudioPump {
  readonly targets = new Set<Target>();
  private writer = new Writer(true);
  private encoder: AudioEncoder | null = null;
  private nodes: AudioNode[] = [];
  private samples = 0;
  private closed = false;
  constructor(readonly track: MediaStreamTrack) {
    void this.start();
  }
  private async start() {
    const ctx = audioContext();
    const workletOk = await worklet;
    if (this.closed) return;
    const encoder = new AudioEncoder({
      output: (chunk) => {
        const b = new Uint8Array(chunk.byteLength);
        chunk.copyTo(b);
        this.writer.write((chunk.timestamp * 48) / 1000, b, [...this.targets]);
      },
      error: (e) => console.warn("[ownrtc] sound encoder", e),
    });
    const base = { codec: "opus", sampleRate: 48000, numberOfChannels: 1, bitrate: 64000 };
    const rich = { ...base, opus: { frameDuration: 20000, useinbandfec: true, packetlossperc: 5, complexity: 5 } } as AudioEncoderConfig;
    const ok = await AudioEncoder.isConfigSupported(rich).then((s) => !!s.supported, () => false);
    encoder.configure(ok ? rich : (base as AudioEncoderConfig));
    this.encoder = encoder;
    const src = ctx.createMediaStreamSource(new MediaStream([this.track]));
    const sink = ctx.createGain();
    sink.gain.value = 0;
    sink.connect(ctx.destination);
    const take = (pcm: Float32Array<ArrayBuffer>) => {
      if (this.closed || encoder.state !== "configured" || !this.targets.size) return;
      const ts = Math.round((this.samples / 48000) * 1e6);
      this.samples += pcm.length;
      encoder.encode(new AudioData({ format: "f32-planar", sampleRate: 48000, numberOfFrames: pcm.length, numberOfChannels: 1, timestamp: ts, data: pcm }));
    };
    if (workletOk) {
      const node = new AudioWorkletNode(ctx, "lanx-cap", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit" });
      node.port.onmessage = (e) => take(e.data as Float32Array<ArrayBuffer>);
      src.connect(node).connect(sink);
      this.nodes = [src, node, sink];
    } else {
      // The older way (main thread): 960-sample pieces cut from bigger ones.
      const sp = ctx.createScriptProcessor(1024, 1, 1);
      let buf = new Float32Array(960);
      let fill = 0;
      sp.onaudioprocess = (e) => {
        const ch = e.inputBuffer.getChannelData(0);
        let i = 0;
        while (i < ch.length) {
          const n = Math.min(ch.length - i, 960 - fill);
          buf.set(ch.subarray(i, i + n), fill);
          fill += n;
          i += n;
          if (fill === 960) {
            take(buf);
            buf = new Float32Array(960);
            fill = 0;
          }
        }
      };
      src.connect(sp).connect(sink);
      this.nodes = [src, sp, sink];
    }
  }
  close() {
    this.closed = true;
    for (const n of this.nodes) n.disconnect();
    try {
      this.encoder?.close();
    } catch {
      /* closed */
    }
  }
}

// ------------------------------------------------------------------ pictures

type TrackProcessor = { readable: ReadableStream<VideoFrame> };
const Processor = (globalThis as unknown as { MediaStreamTrackProcessor?: new (o: { track: MediaStreamTrack }) => TrackProcessor }).MediaStreamTrackProcessor;

/** Where the camera players live (in the page, out of sight: a web engine may not
 *  update a player that isn't in it). */
function holder(): HTMLElement {
  let h = document.getElementById("lanx-ownrtc-holder");
  if (!h) {
    h = document.createElement("div");
    h.id = "lanx-ownrtc-holder";
    h.setAttribute("aria-hidden", "true");
    h.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;overflow:hidden;opacity:0.01;pointer-events:none;z-index:-1";
    document.body.append(h);
  }
  return h;
}

/** Encodes one camera (or screen) track for everyone who gets it. Frames come
 *  straight from the track where the web engine can (MediaStreamTrackProcessor),
 *  else from a player in the page on a steady clock (a worker's: it keeps time when
 *  LANX is behind other windows or minimised). */
class VideoPump {
  readonly targets = new Map<Target, VideoSettings>();
  private writer = new Writer(false);
  private video: HTMLVideoElement | null = null;
  private ticker: Worker | null = null;
  private tickMs = 0;
  private reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
  private encoder: VideoEncoder | null = null;
  private config = "";
  private canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private lastFrame = 0;
  private lastKey = 0;
  private wantKey = true;
  private closed = false;
  /** Frames sent and skipped (the computer couldn't keep up) in this 2-second stretch
   *  and the one before, for the quality watch. */
  private load = { since: 0, sent: 0, skipped: 0, sentBefore: 0, skippedBefore: 0 };
  framesOut = 0;
  private count(skipped: boolean, t: number) {
    const l = this.load;
    if (t - l.since > 2000) {
      l.sentBefore = t - l.since > 4000 ? 0 : l.sent;
      l.skippedBefore = t - l.since > 4000 ? 0 : l.skipped;
      l.sent = 0;
      l.skipped = 0;
      l.since = t;
    }
    if (skipped) l.skipped++;
    else l.sent++;
  }
  /** The computer can't keep up: more than a fifth of the frames had to be skipped
   *  lately (one late frame is nothing). */
  overloaded(): boolean {
    const l = this.load;
    if (now() - l.since > 4000) return false;
    const skipped = l.skipped + l.skippedBefore;
    return skipped >= 4 && skipped > (skipped + l.sent + l.sentBefore) / 5;
  }
  constructor(readonly track: MediaStreamTrack) {
    if (Processor) {
      try {
        this.reader = new Processor({ track }).readable.getReader();
        void this.read();
        return;
      } catch {
        this.reader = null;
      }
    }
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.autoplay = true;
    v.width = 2;
    v.height = 2;
    v.srcObject = new MediaStream([track]);
    holder().append(v);
    this.video = v;
    void v.play().catch(() => {});
    // The page's own clock, if the worker's can't start (or never ticks).
    const fallback = () => {
      this.ticker?.terminate();
      this.ticker = null;
      const tick = () => {
        if (this.closed) return;
        this.grab();
        window.setTimeout(tick, this.tickMs || 33);
      };
      tick();
    };
    try {
      let ticked = false;
      const w = new Worker("/lanx-ticker.js");
      w.onmessage = () => {
        ticked = true;
        this.grab();
      };
      w.onerror = () => {
        if (this.ticker === w) fallback();
      };
      this.ticker = w;
      window.setTimeout(() => {
        if (!ticked && this.ticker === w && !this.closed) fallback();
      }, 1500);
    } catch {
      fallback();
    }
    this.retime();
  }
  /** What everyone together gets: the most careful of their settings. */
  settings(): VideoSettings {
    let s: VideoSettings | null = null;
    for (const x of this.targets.values()) {
      s = s ? { maxBitrate: Math.min(s.maxBitrate, x.maxBitrate), scale: Math.max(s.scale, x.scale), fps: Math.min(s.fps, x.fps) } : { ...x };
    }
    return s ?? { maxBitrate: 1_000_000, scale: 1, fps: 30 };
  }
  /** (Settings changed: the clock follows the frame rate.) */
  retime() {
    const ms = Math.max(16, Math.round(1000 / Math.max(1, this.settings().fps)));
    if (ms === this.tickMs) return;
    this.tickMs = ms;
    this.ticker?.postMessage(ms);
  }
  key() {
    this.wantKey = true;
  }
  private async read() {
    const r = this.reader!;
    while (!this.closed) {
      let res: ReadableStreamReadResult<VideoFrame>;
      try {
        res = await r.read();
      } catch {
        return;
      }
      if (res.done || !res.value) return;
      const f = res.value;
      try {
        this.take(f, f.displayWidth, f.displayHeight);
      } finally {
        f.close();
      }
    }
  }
  private grab() {
    const v = this.video;
    if (!v || v.videoWidth < 2) {
      if (v && v.paused) void v.play().catch(() => {});
      return;
    }
    this.take(v, v.videoWidth, v.videoHeight);
  }
  /** For support and tests: frames seen, and why some were not sent. */
  readonly seen = { frames: 0, idle: 0, ended: 0, early: 0, busy: 0, waiting: 0, failed: 0 };
  private take(src: VideoFrame | HTMLVideoElement, sw: number, sh: number) {
    this.seen.frames++;
    if (this.closed || !this.targets.size || sw < 2) {
      this.seen.idle++;
      return;
    }
    if (this.track.readyState !== "live") {
      this.seen.ended++;
      return;
    }
    const set = this.settings();
    const t = now();
    if (t - this.lastFrame < 1000 / Math.max(1, set.fps) - 6) {
      this.seen.early++;
      return;
    }
    if (this.writer.pending > 6 || (this.encoder && this.encoder.encodeQueueSize > 1)) {
      // The computer (or the hand-over) can't keep up: skip this one.
      this.seen.busy++;
      if (this.writer.pending > 6) this.seen.waiting++;
      this.count(true, t);
      return;
    }
    this.count(false, t);
    this.lastFrame = t;
    const soft = document.documentElement.classList.contains("lanx-linux");
    const maxW = soft ? SOFT_MAX_W : MAX_W;
    const maxH = soft ? SOFT_MAX_H : MAX_H;
    const fit = Math.min(1, maxW / sw, maxH / sh) / Math.max(1, set.scale);
    const w = Math.max(2, Math.round((sw * fit) / 2) * 2);
    const h = Math.max(2, Math.round((sh * fit) / 2) * 2);
    const cfg = `${w}x${h}@${Math.round(set.maxBitrate)}@${set.fps}`;
    if (cfg !== this.config || !this.encoder || this.encoder.state !== "configured") this.configure(w, h, set);
    const ts = Math.round(t * 1000);
    let frame: VideoFrame;
    try {
      if (w === sw && h === sh) frame = new VideoFrame(src, { timestamp: ts });
      else {
        if (!this.canvas || this.canvas.width !== w || this.canvas.height !== h) {
          this.canvas = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
        }
        const g = this.canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
        if (!g) return;
        g.drawImage(src, 0, 0, w, h);
        frame = new VideoFrame(this.canvas, { timestamp: ts });
      }
    } catch (e) {
      this.seen.failed++;
      if (this.seen.failed < 4) console.warn("[ownrtc] a camera frame could not be read", e);
      return;
    }
    const key = this.wantKey || t - this.lastKey > KEY_EVERY_MS;
    if (key) {
      this.wantKey = false;
      this.lastKey = t;
    }
    try {
      this.encoder!.encode(frame, { keyFrame: key });
      this.framesOut++;
    } catch {
      this.config = "";
    } finally {
      frame.close();
    }
  }
  private configure(w: number, h: number, set: VideoSettings) {
    const sizeChanged = !this.config.startsWith(`${w}x${h}@`);
    const config = {
      codec: "vp8",
      width: w,
      height: h,
      bitrate: Math.max(150_000, Math.round(set.maxBitrate)),
      framerate: set.fps,
      latencyMode: "realtime",
    } as VideoEncoderConfig;
    const label = `${w}x${h}@${Math.round(set.maxBitrate)}@${set.fps}`;
    if (this.encoder && this.encoder.state === "configured" && !sizeChanged) {
      // Only the rate changed: the encoder carries on with the new one.
      try {
        this.encoder.configure(config);
        this.config = label;
        return;
      } catch {
        /* make a new one */
      }
    }
    try {
      this.encoder?.close();
    } catch {
      /* closed */
    }
    const enc = new VideoEncoder({
      output: (chunk) => {
        const b = new Uint8Array(chunk.byteLength);
        chunk.copyTo(b);
        this.writer.write((chunk.timestamp * 90) / 1000, b, [...this.targets.keys()]);
      },
      error: (e) => {
        console.warn("[ownrtc] picture encoder", e);
        this.config = "";
      },
    });
    enc.configure(config);
    this.encoder = enc;
    this.config = label;
    this.wantKey = true;
  }
  close() {
    this.closed = true;
    try {
      this.encoder?.close();
    } catch {
      /* closed */
    }
    void this.reader?.cancel().catch(() => {});
    this.ticker?.terminate();
    if (this.video) {
      this.video.srcObject = null;
      this.video.remove();
    }
  }
}

// ------------------------------------------------------------------ who sends what

const audioPumps = new Map<string, AudioPump>();
const videoPumps = new Map<string, VideoPump>();
// (For support and tests: what is being sent.)
(window as unknown as { __lanxOwnRtc?: unknown }).__lanxOwnRtc = { audioPumps, videoPumps };

/** Where a sender's pieces come from: (re)attaches the target to the right encoder
 *  (one per camera or microphone; settings are per target). */
export class SendSlot {
  private pumpKey: string | null = null;
  constructor(
    private kind: "audio" | "video",
    private target: Target,
  ) {}
  set(track: MediaStreamTrack | null, settings: VideoSettings) {
    const key = !track || track.readyState === "ended" ? null : track.id;
    if (key !== this.pumpKey) {
      this.detach();
      if (!track || !key) return;
      if (this.kind === "audio") {
        let p = audioPumps.get(key);
        if (!p) audioPumps.set(key, (p = new AudioPump(track)));
        p.targets.add(this.target);
      } else {
        let p = videoPumps.get(key);
        if (!p) videoPumps.set(key, (p = new VideoPump(track)));
        p.key();
      }
      this.pumpKey = key;
    }
    if (this.kind === "video" && key) {
      const p = videoPumps.get(key);
      if (p) {
        p.targets.set(this.target, { ...settings });
        p.retime();
      }
    }
  }
  key() {
    if (this.pumpKey) videoPumps.get(this.pumpKey)?.key();
  }
  /** The computer couldn't keep up lately (for getStats' "qualityLimitationReason"). */
  busy(): boolean {
    const p = this.pumpKey ? videoPumps.get(this.pumpKey) : undefined;
    return !!p && p.overloaded();
  }
  frames(): number {
    return (this.pumpKey ? videoPumps.get(this.pumpKey)?.framesOut : 0) ?? 0;
  }
  detach() {
    if (!this.pumpKey) return;
    if (this.kind === "audio") {
      const p = audioPumps.get(this.pumpKey);
      if (p) {
        p.targets.delete(this.target);
        if (!p.targets.size) {
          p.close();
          audioPumps.delete(this.pumpKey);
        }
      }
    } else {
      const p = videoPumps.get(this.pumpKey);
      if (p) {
        p.targets.delete(this.target);
        if (!p.targets.size) {
          p.close();
          videoPumps.delete(this.pumpKey);
        } else p.retime();
      }
    }
    this.pumpKey = null;
  }
}

// ------------------------------------------------------------------ what comes in

/** A track that says "muted" until something arrives (like a browser's). */
function markMutable(track: MediaStreamTrack) {
  let muted = true;
  Object.defineProperty(track, "muted", { configurable: true, get: () => muted });
  return (m: boolean) => {
    if (m === muted) return;
    muted = m;
    try {
      track.dispatchEvent(new Event(m ? "mute" : "unmute"));
    } catch {
      /* ignore */
    }
  };
}

const VIDEO_CODECS: Record<number, string> = { 2: "vp8", 3: "vp09.00.10.08", 4: "avc1.42e01f" };

/** Shows the pictures of one incoming media line on a canvas whose stream is the track. */
export class VideoSink {
  readonly track: MediaStreamTrack;
  private canvas = document.createElement("canvas");
  private g: CanvasRenderingContext2D | null;
  private decoder: VideoDecoder | null = null;
  private codec = 0;
  private waitingKey = true;
  private askedAt = 0;
  private setMuted: (m: boolean) => void;
  framesIn = 0;
  decodeMs = 0;
  private fpsMark = { at: now(), n: 0, fps: 0 };
  constructor(private askKey: () => void) {
    this.canvas.width = 2;
    this.canvas.height = 2;
    this.g = this.canvas.getContext("2d", { alpha: false });
    const stream = (this.canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream();
    this.track = stream.getVideoTracks()[0];
    this.setMuted = markMutable(this.track);
  }
  fps(): number {
    return this.fpsMark.fps;
  }
  paused(p: boolean) {
    if (p) this.setMuted(true);
  }
  private ask() {
    const t = now();
    if (t - this.askedAt > 300) {
      this.askedAt = t;
      this.askKey();
    }
  }
  private reset() {
    try {
      this.decoder?.close();
    } catch {
      /* closed */
    }
    this.decoder = null;
    this.waitingKey = true;
  }
  push(codec: number, key: boolean, rtp: number, data: Uint8Array) {
    const name = VIDEO_CODECS[codec];
    if (!name) return;
    if (codec !== this.codec) {
      this.reset();
      this.codec = codec;
    }
    if (this.waitingKey && !key) {
      this.ask();
      return;
    }
    if (!this.decoder || this.decoder.state === "closed") {
      const dec = new VideoDecoder({
        output: (f) => this.show(f),
        error: () => {
          this.reset();
          this.ask();
        },
      });
      dec.configure({ codec: name, optimizeForLatency: true } as VideoDecoderConfig);
      this.decoder = dec;
    }
    if (this.decoder.decodeQueueSize > 4 && !key) return;
    this.waitingKey = false;
    try {
      this.decoder.decode(new EncodedVideoChunk({ type: key ? "key" : "delta", timestamp: Math.round((rtp / 90) * 1000), data }));
    } catch {
      this.reset();
      this.ask();
    }
  }
  private show(f: VideoFrame) {
    const t0 = now();
    try {
      const w = f.displayWidth;
      const h = f.displayHeight;
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
      this.g?.drawImage(f, 0, 0, w, h);
    } finally {
      f.close();
    }
    this.decodeMs += now() - t0;
    this.framesIn++;
    this.setMuted(false);
    const m = this.fpsMark;
    m.n++;
    if (t0 - m.at >= 1000) {
      m.fps = (m.n * 1000) / (t0 - m.at);
      m.at = t0;
      m.n = 0;
    }
  }
  close() {
    this.reset();
    this.track.stop();
  }
}

/** Plays the sound of one incoming media line; its track is a stream of that sound
 *  (for the page's <audio> and its "who is talking" meters). */
export class AudioSink {
  readonly track: MediaStreamTrack;
  private dest: MediaStreamAudioDestinationNode;
  private post: ((pcm: Float32Array) => void) | null = null;
  private nodes: AudioNode[] = [];
  private decoder: AudioDecoder | null = null;
  private setMuted: (m: boolean) => void;
  private closed = false;
  constructor() {
    const c = audioContext();
    this.dest = c.createMediaStreamDestination();
    this.track = this.dest.stream.getAudioTracks()[0];
    this.setMuted = markMutable(this.track);
    void this.start(c);
  }
  private async start(c: AudioContext) {
    const ok = await worklet;
    if (this.closed) return;
    if (ok) {
      const node = new AudioWorkletNode(c, "lanx-play", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
      this.post = (pcm) => node.port.postMessage(pcm, [pcm.buffer]);
      this.nodes = [node];
    } else {
      // The older way: a script node plays from a short queue.
      const q: Float32Array[] = [];
      let head = 0;
      const sp = c.createScriptProcessor(1024, 0, 1);
      sp.onaudioprocess = (e) => {
        const out = e.outputBuffer.getChannelData(0);
        let i = 0;
        while (i < out.length && q.length) {
          const cur = q[0];
          const n = Math.min(out.length - i, cur.length - head);
          out.set(cur.subarray(head, head + n), i);
          i += n;
          head += n;
          if (head >= cur.length) {
            q.shift();
            head = 0;
          }
        }
        out.fill(0, i);
      };
      this.post = (pcm) => {
        q.push(pcm);
        while (q.length > 8) q.shift();
      };
      this.nodes = [sp];
    }
    const src = this.nodes[0];
    src.connect(this.dest);
    if (sound.direct) src.connect(c.destination);
  }
  paused(p: boolean) {
    if (p) this.setMuted(true);
  }
  push(rtp: number, data: Uint8Array) {
    if (this.closed) return;
    if (!this.decoder || this.decoder.state === "closed") {
      const dec = new AudioDecoder({
        output: (d) => {
          try {
            const n = d.numberOfFrames;
            const pcm = new Float32Array(n);
            const fmt = String(d.format ?? "");
            if (fmt.startsWith("f32")) d.copyTo(pcm, { planeIndex: 0, format: "f32-planar" } as AudioDataCopyToOptions);
            else {
              // (16-bit pieces: made into the -1…1 the player wants.)
              const s16 = new Int16Array(n * (fmt.endsWith("planar") ? 1 : d.numberOfChannels));
              d.copyTo(s16, { planeIndex: 0 });
              const step = fmt.endsWith("planar") ? 1 : d.numberOfChannels;
              for (let i = 0; i < n; i++) pcm[i] = s16[i * step] / 32768;
            }
            this.post?.(pcm);
            this.setMuted(false);
          } catch {
            /* a piece that could not be read: silence */
          } finally {
            d.close();
          }
        },
        error: () => {
          this.decoder = null;
        },
      });
      dec.configure({ codec: "opus", sampleRate: 48000, numberOfChannels: 1 });
      this.decoder = dec;
    }
    try {
      this.decoder.decode(new EncodedAudioChunk({ type: "key", timestamp: Math.round((rtp / 48) * 1000), data }));
    } catch {
      this.decoder = null;
    }
  }
  close() {
    this.closed = true;
    for (const n of this.nodes) n.disconnect();
    try {
      this.decoder?.close();
    } catch {
      /* closed */
    }
    this.track.stop();
  }
}
