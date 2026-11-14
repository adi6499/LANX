/** LANX 3.15.0: the walkie-talkie's sound — the microphone made into small Opus pieces
 *  (20 ms each) while the button is held, and a colleague's pieces played as they come.
 *  It uses the web engine's own Opus (WebCodecs) and the two little sound workers LANX's
 *  call engine for Linux already has (public/lanx-ownrtc-audio.js), on Windows and Linux
 *  alike. */

let ctx: AudioContext | null = null;
let worklet: Promise<boolean> = Promise.resolve(false);

/** One sound context for the walkie-talkie (48 kHz: Opus's own rate). */
export function talkContext(): AudioContext {
  if (!ctx) {
    const c = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
    ctx = c;
    worklet = c.audioWorklet.addModule("/lanx-ownrtc-audio.js").then(
      () => true,
      () => false,
    );
    // (Sound may only start after a click or a key: the first one anywhere starts it.)
    const wake = () => void c.resume().catch(() => {});
    for (const ev of ["pointerdown", "keydown"]) document.addEventListener(ev, wake, { capture: true });
    wake();
  }
  return ctx;
}

/** Whether this PC can play a colleague's voice right now (it can't before the first
 *  click after LANX started). */
export function canPlay(): boolean {
  const c = talkContext();
  if (c.state !== "running") void c.resume().catch(() => {});
  return c.state === "running";
}

export function talkSupported(): boolean {
  return typeof AudioEncoder !== "undefined" && typeof AudioDecoder !== "undefined" && typeof AudioWorkletNode !== "undefined";
}

const toB64 = (bytes: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};
const fromB64 = (b64: string): Uint8Array | null => {
  try {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
};
/** How loud a piece is, 0…1 (for the little meters). */
const loudness = (pcm: Float32Array): number => {
  let sum = 0;
  for (let i = 0; i < pcm.length; i += 4) sum += pcm[i] * pcm[i];
  return Math.min(1, Math.sqrt(sum / Math.max(1, pcm.length / 4)) * 5);
};

// ------------------------------------------------------------------ the microphone

let micStream: MediaStream | null = null;
let micRelease = 0;
/** The microphone stays open this long after the button is let go, so the next press
 *  (an answer, usually) loses no first word. */
const MIC_WARM_MS = 20000;

async function microphone(): Promise<MediaStream> {
  window.clearTimeout(micRelease);
  if (micStream && micStream.getAudioTracks().some((t) => t.readyState === "live")) return micStream;
  micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: { ideal: 1 } } });
  return micStream;
}
function microphoneLater() {
  window.clearTimeout(micRelease);
  micRelease = window.setTimeout(() => {
    micStream?.getTracks().forEach((t) => t.stop());
    micStream = null;
  }, MIC_WARM_MS);
}
/** Lets go of the microphone at once (LANX is closing, or the walkie-talkie was switched off). */
export function dropMicrophone() {
  window.clearTimeout(micRelease);
  micStream?.getTracks().forEach((t) => t.stop());
  micStream = null;
}

/** The microphone while the button is held: `onFrames` gets the voice in small batches
 *  (Opus pieces, base64), `onLevel` how loud it is. */
export class TalkMic {
  private encoder: AudioEncoder | null = null;
  private nodes: AudioNode[] = [];
  private batch: string[] = [];
  private samples = 0;
  private closed = false;
  /** Pieces made so far (20 ms each). */
  made = 0;

  constructor(
    private onFrames: (frames: string[]) => void,
    private onLevel: (level: number) => void,
    /** Pieces per batch: 2 = a batch every 40 ms. */
    private perBatch = 2,
  ) {}

  async start(): Promise<void> {
    const c = talkContext();
    const [stream, workletOk] = await Promise.all([microphone(), worklet]);
    if (this.closed) return microphoneLater();
    const encoder = new AudioEncoder({
      output: (chunk) => {
        const b = new Uint8Array(chunk.byteLength);
        chunk.copyTo(b);
        this.made++;
        this.batch.push(toB64(b));
        if (this.batch.length >= this.perBatch) this.flush();
      },
      error: () => {},
    });
    const base = { codec: "opus", sampleRate: 48000, numberOfChannels: 1, bitrate: 24000 };
    const voice = { ...base, opus: { frameDuration: 20000, useinbandfec: true, packetlossperc: 0, complexity: 5 } } as AudioEncoderConfig;
    const ok = await AudioEncoder.isConfigSupported(voice).then(
      (s) => !!s.supported,
      () => false,
    );
    if (this.closed) {
      encoder.close();
      return microphoneLater();
    }
    encoder.configure(ok ? voice : (base as AudioEncoderConfig));
    this.encoder = encoder;
    const src = c.createMediaStreamSource(stream);
    const sink = c.createGain();
    sink.gain.value = 0;
    sink.connect(c.destination);
    const take = (pcm: Float32Array<ArrayBuffer>) => {
      if (this.closed || encoder.state !== "configured") return;
      this.onLevel(loudness(pcm));
      const ts = Math.round((this.samples / 48000) * 1e6);
      this.samples += pcm.length;
      encoder.encode(new AudioData({ format: "f32-planar", sampleRate: 48000, numberOfFrames: pcm.length, numberOfChannels: 1, timestamp: ts, data: pcm }));
    };
    if (workletOk) {
      const node = new AudioWorkletNode(c, "lanx-cap", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit" });
      node.port.onmessage = (e) => take(e.data as Float32Array<ArrayBuffer>);
      src.connect(node).connect(sink);
      this.nodes = [src, node, sink];
    } else {
      // The older way (main thread): 960-sample pieces cut from bigger ones.
      const sp = c.createScriptProcessor(1024, 1, 1);
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

  private flush() {
    if (!this.batch.length) return;
    const frames = this.batch;
    this.batch = [];
    this.onFrames(frames);
  }

  /** Lets go: what is still in the encoder comes out first. */
  async stop(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const n of this.nodes) n.disconnect();
    try {
      if (this.encoder?.state === "configured") await this.encoder.flush();
    } catch {
      /* nothing left */
    }
    this.flush();
    try {
      this.encoder?.close();
    } catch {
      /* closed */
    }
    microphoneLater();
  }
}

// ------------------------------------------------------------------ the loudspeaker

/** Plays one transmission as its pieces come in. `whole`: it is all here already (a
 *  replay), so nothing may be dropped for being late. */
export class TalkSpeaker {
  private post: ((pcm: Float32Array) => void) | null = null;
  private waiting: Float32Array[] = [];
  private nodes: AudioNode[] = [];
  private gain: GainNode;
  private decoder: AudioDecoder | null = null;
  private at = 0;
  private closed = false;
  /** Pieces played so far, and the loudest of them (for tests and the meter). */
  played = 0;
  peak = 0;

  constructor(
    volume: number,
    private onLevel: (level: number) => void,
    private whole = false,
  ) {
    const c = talkContext();
    this.gain = c.createGain();
    this.gain.gain.value = Math.min(1.5, Math.max(0, volume));
    this.gain.connect(c.destination);
    void this.start(c);
  }

  private async start(c: AudioContext) {
    const ok = await worklet;
    if (this.closed) return;
    if (ok) {
      // Live: start once 80 ms are here, never hold more than 400 ms. A replay: all of it.
      const processorOptions = this.whole ? { startAt: 960, maxQueued: 48000 * 90 } : { startAt: 3840, maxQueued: 19200 };
      const node = new AudioWorkletNode(c, "lanx-play", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1], processorOptions });
      this.post = (pcm) => node.port.postMessage(pcm, [pcm.buffer]);
      node.connect(this.gain);
      this.nodes = [node];
    } else {
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
        while (!this.whole && q.length > 20) q.shift();
      };
      sp.connect(this.gain);
      this.nodes = [sp];
    }
    for (const pcm of this.waiting.splice(0)) this.post?.(pcm);
  }

  setVolume(v: number) {
    this.gain.gain.value = Math.min(1.5, Math.max(0, v));
  }

  push(frames: string[]) {
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
              const step = fmt.endsWith("planar") ? 1 : d.numberOfChannels;
              const s16 = new Int16Array(n * step);
              d.copyTo(s16, { planeIndex: 0 });
              for (let i = 0; i < n; i++) pcm[i] = s16[i * step] / 32768;
            }
            const level = loudness(pcm);
            this.played++;
            this.peak = Math.max(this.peak, level);
            this.onLevel(level);
            if (this.post) this.post(pcm);
            else this.waiting.push(pcm);
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
    for (const f of frames) {
      const data = fromB64(f);
      if (!data || !data.length) continue;
      try {
        this.decoder.decode(new EncodedAudioChunk({ type: "key", timestamp: this.at, data }));
      } catch {
        this.decoder = null;
        return;
      }
      this.at += 20000;
    }
  }

  /** The transmission is over: what is still waiting plays out, then it goes. */
  finish(afterMs = 700) {
    if (this.closed) return;
    const dec = this.decoder;
    void (dec && dec.state === "configured" ? dec.flush().catch(() => {}) : Promise.resolve()).then(() => {
      window.setTimeout(() => this.close(), afterMs);
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const n of this.nodes) n.disconnect();
    this.gain.disconnect();
    try {
      this.decoder?.close();
    } catch {
      /* closed */
    }
  }
}

// ------------------------------------------------------------------ the little tones

type Tone = "go" | "over" | "incoming" | "busy" | "nobody";
/** A walkie-talkie's own sounds: "go" (you may talk), "over" (a transmission ended),
 *  "incoming" (someone starts), "busy" / "nobody" (it did not go out). */
export function tone(kind: Tone, volume = 1) {
  const c = talkContext();
  if (c.state !== "running") return;
  const notes: Record<Tone, [number, number, number][]> = {
    // [frequency, start, length] in Hz and seconds
    go: [[880, 0, 0.06], [1320, 0.07, 0.08]],
    over: [[1040, 0, 0.07], [780, 0.08, 0.1]],
    incoming: [[660, 0, 0.07], [990, 0.08, 0.07]],
    busy: [[330, 0, 0.12], [330, 0.18, 0.12]],
    nobody: [[392, 0, 0.14], [294, 0.16, 0.2]],
  };
  const out = c.createGain();
  out.gain.value = 0.16 * Math.min(1.5, Math.max(0, volume));
  out.connect(c.destination);
  let end = 0;
  for (const [hz, at, len] of notes[kind]) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "sine";
    o.frequency.value = hz;
    const t0 = c.currentTime + at;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(1, t0 + 0.008);
    g.gain.setValueAtTime(1, t0 + len - 0.02);
    g.gain.linearRampToValueAtTime(0, t0 + len);
    o.connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + len + 0.01);
    end = Math.max(end, at + len);
  }
  window.setTimeout(() => out.disconnect(), (end + 0.2) * 1000);
}
