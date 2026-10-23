/** LANX 2.5.0: voice — recording the microphone as 16 kHz samples for the
 *  speech engine, turning saved recordings into samples, downloading the
 *  speech model, and what the dictation feature remembers. */
import { api } from "./api";

export const SAMPLE_RATE = 16_000;
export const DICTATE_SHORTCUT = "Ctrl + Alt + Space";

export interface DictationPrefs {
  hotkey: boolean;
  model: "tiny" | "base" | "small";
  /** "auto" | "en" | "hi" | "mr" | … */
  lang: string;
  /** Type the words into whatever program was in front (Windows). */
  typeInto: boolean;
}
export const DEFAULT_DICTATION: DictationPrefs = { hotkey: true, model: "base", lang: "auto", typeInto: true };
export const LANGS: { id: string; name: string }[] = [
  { id: "auto", name: "Detect automatically" },
  { id: "en", name: "English" },
  { id: "hi", name: "Hindi (हिन्दी)" },
  { id: "mr", name: "Marathi (मराठी)" },
  { id: "gu", name: "Gujarati" },
  { id: "ta", name: "Tamil" },
  { id: "te", name: "Telugu" },
  { id: "kn", name: "Kannada" },
  { id: "bn", name: "Bengali" },
];

export async function loadDictationPrefs(): Promise<DictationPrefs> {
  try {
    const v = await api.getPref("dictation");
    return v ? { ...DEFAULT_DICTATION, ...(JSON.parse(v) as Partial<DictationPrefs>) } : DEFAULT_DICTATION;
  } catch {
    return DEFAULT_DICTATION;
  }
}
export async function saveDictationPrefs(p: DictationPrefs): Promise<void> {
  await api.setPref("dictation", JSON.stringify(p));
  api.setDictationHotkey(p.hotkey).catch(() => {});
}

/** Records the microphone as 16 kHz mono samples until `stop()`. */
export interface PcmRecorder {
  stop: () => Promise<Float32Array>;
  /** 0..1, for a little level meter. */
  level: () => number;
  seconds: () => number;
}

const WORKLET = `
class LanxTap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("lanx-tap", LanxTap);
`;

export async function startPcmRecorder(): Promise<PcmRecorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  const src = ctx.createMediaStreamSource(stream);
  const tap = new AudioWorkletNode(ctx, "lanx-tap", { numberOfInputs: 1, numberOfOutputs: 0 });
  const chunks: Float32Array[] = [];
  let total = 0;
  let level = 0;
  const started = performance.now();
  tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
    const d = e.data;
    chunks.push(d);
    total += d.length;
    let s = 0;
    for (let i = 0; i < d.length; i++) s += d[i] * d[i];
    level = Math.min(1, Math.sqrt(s / d.length) * 6);
    if (total > SAMPLE_RATE * 600) stopInternal(); // 10 minutes at most
  };
  src.connect(tap);
  let stopped = false;
  const stopInternal = () => {
    if (stopped) return;
    stopped = true;
    try {
      src.disconnect();
      tap.disconnect();
    } catch {}
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  };
  return {
    stop: async () => {
      stopInternal();
      // The worklet's sample rate equals the context's (16 kHz) — no resampling needed.
      const out = new Float32Array(total);
      let o = 0;
      for (const c of chunks) {
        out.set(c, o);
        o += c.length;
      }
      return out;
    },
    level: () => (stopped ? 0 : level),
    seconds: () => (performance.now() - started) / 1000,
  };
}

/** A saved recording (webm/ogg/wav bytes) → 16 kHz mono samples. */
export async function decodeToPcm(bytes: Uint8Array): Promise<Float32Array> {
  const probe = new AudioContext();
  const decoded = await probe.decodeAudioData(bytes.slice(0).buffer);
  await probe.close();
  const frames = Math.ceil(decoded.duration * SAMPLE_RATE);
  const off = new OfflineAudioContext(1, frames, SAMPLE_RATE);
  const s = off.createBufferSource();
  s.buffer = decoded;
  s.connect(off.destination);
  s.start();
  const rendered = await off.startRendering();
  return rendered.getChannelData(0).slice(0);
}

export function fmtSecs(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

/** Downloads a speech model straight into LANX (needs the internet once). */
export async function downloadModel(id: string, url: string, onProgress: (done: number, total: number) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(url, { signal, redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}). Check the internet connection and try again.`);
  const total = Number(res.headers.get("content-length") || 0);
  const reader = res.body.getReader();
  let offset = 0;
  let buf: Uint8Array[] = [];
  let bufBytes = 0;
  const flush = async () => {
    if (!bufBytes) return;
    const joined = new Uint8Array(bufBytes);
    let o = 0;
    for (const b of buf) {
      joined.set(b, o);
      o += b.length;
    }
    offset = await api.voiceModelChunk(id, offset, joined);
    buf = [];
    bufBytes = 0;
    onProgress(offset, total);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf.push(value);
    bufBytes += value.length;
    if (bufBytes >= 4 * 1024 * 1024) await flush();
  }
  await flush();
  await api.voiceModelFinish(id);
}

/** Puts text where the cursor is in LANX's own window (message box, note…). */
export function insertAtCursor(text: string): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const editable = el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && /^(text|search|url|tel|email)$/.test(el.type)) || el.isContentEditable;
  if (!editable) return false;
  // execCommand keeps React's controlled inputs in step (it fires "input").
  const before = el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement ? el.value : el.textContent ?? "";
  const needsSpace = before.length > 0 && !/\s$/.test(before.slice(0, (el as HTMLTextAreaElement).selectionStart ?? before.length));
  document.execCommand("insertText", false, (needsSpace ? " " : "") + text);
  return true;
}
