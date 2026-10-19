/** LANX 1.4.0: records a meeting or a call — everyone's picture side by side
 *  (or the shared screen large) plus everyone's sound, mixed — and hands the
 *  recording to LANX piece by piece, which saves it straight into
 *  Documents\LANX Recordings. Everyone in the meeting is told (see the
 *  meeting / call layers); nothing is sent anywhere else. */
import { api, errorText } from "./api";

export interface RecTile {
  id: string;
  name: string;
  color: string;
  /** Their camera or shared screen (null: show their initial). */
  video: MediaStreamTrack | null;
  /** Their microphone. */
  audio: MediaStreamTrack | null;
  screen?: boolean;
  muted?: boolean;
}

export interface RecordingResult {
  path: string;
  secs: number;
  name: string;
}

/** Recordings are Full HD at 25 frames a second (the layout is drawn at
 *  1280×720 and scaled up, so the pictures themselves stay sharp). */
const W = 1280;
const H = 720;
const SCALE = 1.5;
const FPS = 25;

const TYPES = [
  'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
  "video/mp4",
  'video/webm;codecs="vp9,opus"',
  'video/webm;codecs="vp8,opus"',
  "video/webm",
];

export function recordingSupported(): boolean {
  return typeof MediaRecorder !== "undefined" && typeof HTMLCanvasElement.prototype.captureStream === "function";
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export class Recorder {
  private canvas = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D;
  private audio: AudioContext | null = null;
  private mix: MediaStreamAudioDestinationNode | null = null;
  private sources = new Map<string, MediaStreamAudioSourceNode>();
  private videos = new Map<string, HTMLVideoElement>();
  private rec: MediaRecorder | null = null;
  private ticker: Worker | null = null;
  private fallback: number | null = null;
  private saving: Promise<void> = Promise.resolve();
  private failed: string | null = null;
  private id = "";
  name = "";
  startedAt = 0;

  constructor(
    private opts: {
      title: string;
      kind: "meeting" | "call";
      conversationId: string | null;
      tiles: () => RecTile[];
      /** Saving failed (disk full…): the recording stops itself. */
      onFailed: (text: string) => void;
    }
  ) {
    this.canvas.width = W * SCALE;
    this.canvas.height = H * SCALE;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Recording isn't available on this computer.");
    this.ctx = ctx;
  }

  get seconds() {
    return this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0;
  }

  async start(): Promise<void> {
    const type = TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
    const ext = type.startsWith("video/mp4") ? "mp4" : "webm";
    const { id, name } = await api.recordingBegin(this.opts.title, ext);
    this.id = id;
    this.name = name;
    try {
      this.audio = new AudioContext();
      await this.audio.resume().catch(() => {});
      this.mix = this.audio.createMediaStreamDestination();
      // A silent tone keeps the sound track going while nobody talks.
      const quiet = this.audio.createGain();
      quiet.gain.value = 0;
      const osc = this.audio.createOscillator();
      osc.connect(quiet).connect(this.mix);
      osc.start();
      this.tick();
      const picture = this.canvas.captureStream(FPS);
      const stream = new MediaStream([...picture.getVideoTracks(), ...this.mix.stream.getAudioTracks()]);
      this.rec = new MediaRecorder(stream, {
        mimeType: type || undefined,
        videoBitsPerSecond: 8_000_000,
        audioBitsPerSecond: 192_000,
      });
      this.rec.ondataavailable = (e) => {
        if (e.data.size) this.saving = this.saving.then(() => this.save(e.data));
      };
      this.rec.start(1000);
      this.startedAt = Date.now();
      try {
        this.ticker = new Worker("/lanx-ticker.js");
        this.ticker.onmessage = () => this.tick();
        this.ticker.postMessage(Math.round(1000 / FPS));
      } catch {
        this.fallback = window.setInterval(() => this.tick(), Math.round(1000 / FPS));
      }
    } catch (e) {
      this.cleanup();
      await api.recordingCancel(this.id).catch(() => {});
      throw e;
    }
  }

  /** Stops and saves. Returns where it was saved. */
  async stop(): Promise<RecordingResult> {
    const rec = this.rec;
    const secs = this.seconds;
    if (rec && rec.state !== "inactive") {
      await new Promise<void>((resolve) => {
        rec.onstop = () => resolve();
        rec.stop();
      });
    }
    await this.saving;
    this.cleanup();
    const path = await api.recordingEnd(this.id, this.opts.conversationId, this.opts.title, this.opts.kind, secs);
    return { path, secs, name: this.name };
  }

  private async save(data: Blob) {
    if (this.failed) return;
    try {
      await api.recordingChunk(this.id, new Uint8Array(await data.arrayBuffer()));
    } catch (e) {
      this.failed = errorText(e);
      this.opts.onFailed(this.failed);
    }
  }

  private cleanup() {
    this.ticker?.terminate();
    this.ticker = null;
    if (this.fallback) window.clearInterval(this.fallback);
    this.fallback = null;
    for (const v of this.videos.values()) v.srcObject = null;
    this.videos.clear();
    for (const s of this.sources.values()) s.disconnect();
    this.sources.clear();
    this.audio?.close().catch(() => {});
    this.audio = null;
  }

  /** Keeps the sound mix and the picture up to date (15 times a second). */
  private tick() {
    let tiles: RecTile[] = [];
    try {
      tiles = this.opts.tiles();
    } catch {
      return;
    }
    this.syncSound(tiles);
    this.draw(tiles);
  }

  private syncSound(tiles: RecTile[]) {
    if (!this.audio || !this.mix) return;
    const want = new Set<string>();
    for (const t of tiles) {
      const a = t.audio;
      if (!a || a.readyState !== "live") continue;
      want.add(a.id);
      if (!this.sources.has(a.id)) {
        try {
          const src = this.audio.createMediaStreamSource(new MediaStream([a]));
          src.connect(this.mix);
          this.sources.set(a.id, src);
        } catch {
          /* that track can't be mixed */
        }
      }
    }
    for (const [id, src] of this.sources) {
      if (!want.has(id)) {
        src.disconnect();
        this.sources.delete(id);
      }
    }
  }

  private videoFor(track: MediaStreamTrack): HTMLVideoElement {
    let v = this.videos.get(track.id);
    if (!v) {
      v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.srcObject = new MediaStream([track]);
      v.play().catch(() => {});
      this.videos.set(track.id, v);
    }
    return v;
  }

  private draw(tiles: RecTile[]) {
    const ctx = this.ctx;
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#0b1020";
    ctx.fillRect(0, 0, W, H);
    const live = new Set<string>();
    const sharer = tiles.find((t) => t.screen && t.video?.readyState === "live");
    const top = 44;
    if (sharer) {
      const others = tiles.filter((t) => t !== sharer);
      const side = others.length ? 240 : 0;
      this.tile(sharer, 8, top, W - side - 16, H - top - 8, live, true);
      const h = Math.min(150, (H - top - 8) / Math.max(1, others.length) - 8);
      others.slice(0, 5).forEach((t, i) => this.tile(t, W - side, top + i * (h + 8), side - 8, h, live, false));
    } else {
      const n = Math.max(1, tiles.length);
      const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
      const rows = Math.ceil(n / cols);
      const gap = 8;
      const cw = (W - gap * (cols + 1)) / cols;
      const ch = (H - top - gap * rows) / rows;
      tiles.forEach((t, i) => {
        const r = Math.floor(i / cols);
        const inRow = Math.min(cols, n - r * cols);
        const x0 = (W - (inRow * cw + (inRow - 1) * gap)) / 2;
        this.tile(t, x0 + (i % cols) * (cw + gap), top + r * (ch + gap), cw, ch, live, false);
      });
    }
    for (const [id, v] of this.videos) {
      if (!live.has(id)) {
        v.srcObject = null;
        this.videos.delete(id);
      }
    }
    // Top bar: "● REC 12:34" and the title.
    ctx.fillStyle = "#ef4444";
    ctx.beginPath();
    ctx.arc(22, 22, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = "600 17px Segoe UI, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    const s = this.seconds;
    const clock = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    ctx.fillText(`REC ${clock}`, 36, 23);
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText(`${this.opts.title} · LANX`, W - 16, 23);
    ctx.textAlign = "left";
  }

  private tile(t: RecTile, x: number, y: number, w: number, h: number, live: Set<string>, contain: boolean) {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 14);
    ctx.clip();
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(x, y, w, h);
    const v = t.video && t.video.readyState === "live" ? this.videoFor(t.video) : null;
    if (t.video) live.add(t.video.id);
    if (v && v.videoWidth > 0) {
      const vr = v.videoWidth / v.videoHeight;
      const tr = w / h;
      let dw = w;
      let dh = h;
      if (contain ? vr > tr : vr < tr) dh = w / vr;
      else dw = h * vr;
      ctx.drawImage(v, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    } else {
      const r = Math.min(w, h) * 0.2;
      ctx.fillStyle = t.color || "#64748b";
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = `700 ${Math.round(r * 0.8)}px Segoe UI, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(initials(t.name), x + w / 2, y + h / 2 + 1);
      ctx.textAlign = "left";
    }
    // Name label.
    ctx.font = "600 14px Segoe UI, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    const label = `${t.muted ? "🔇 " : ""}${t.name}`;
    const lw = Math.min(w - 16, ctx.measureText(label).width + 18);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath();
    ctx.roundRect(x + 8, y + h - 34, lw, 26, 13);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, x + 17, y + h - 21, lw - 18);
    ctx.restore();
  }
}
