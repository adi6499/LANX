/** LANX 2.5.0: voice — recording the microphone as 16 kHz samples for the
 *  speech engine, turning saved recordings into samples, downloading the
 *  speech model, and what the dictation feature remembers. */
import { useEffect, useState } from "react";
import { api } from "./api";

export const SAMPLE_RATE = 16_000;

/** LANX 2.5.1: the dictation shortcut, chosen by the user. `key` is the
 *  browser's key name (KeyboardEvent.code): "KeyD", "Space", "F9", "Digit3"… */
export interface HotkeyCombo {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  win: boolean;
  key: string;
}
export const DEFAULT_KEYS: HotkeyCombo = { ctrl: true, alt: true, shift: false, win: false, key: "KeyD" };
/** Keys the shortcut may use (the same list the Windows side understands). */
const KEY_OK = /^(Key[A-Z]|Digit[0-9]|Numpad([0-9]|Multiply|Add|Subtract|Decimal|Divide)|F([1-9]|1[0-9]|2[0-4])|Space|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Insert|Delete|Home|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Pause|ScrollLock|CapsLock)$/;
const KEY_WORDS: Record<string, string> = {
  Space: "Space", Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'",
  Comma: ",", Period: ".", Slash: "/", Insert: "Insert", Delete: "Delete", Home: "Home", End: "End", PageUp: "Page Up", PageDown: "Page Down",
  ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Pause: "Pause", ScrollLock: "Scroll Lock", CapsLock: "Caps Lock",
  NumpadMultiply: "Numpad *", NumpadAdd: "Numpad +", NumpadSubtract: "Numpad -", NumpadDecimal: "Numpad .", NumpadDivide: "Numpad /",
};
export function keyName(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return "Numpad " + code.slice(6);
  return KEY_WORDS[code] ?? code;
}
/** "Ctrl + Alt + D" */
export function hotkeyLabel(k: HotkeyCombo): string {
  return [k.ctrl && "Ctrl", k.alt && "Alt", k.shift && "Shift", k.win && "Win", keyName(k.key)].filter(Boolean).join(" + ");
}
export const DICTATE_SHORTCUT = hotkeyLabel(DEFAULT_KEYS);
export function isValidCombo(k: Partial<HotkeyCombo> | null | undefined): k is HotkeyCombo {
  if (!k || typeof k.key !== "string" || !KEY_OK.test(k.key)) return false;
  const fkey = /^F([1-9]|1[0-9]|2[0-4])$/.test(k.key);
  return fkey || !!(k.ctrl || k.alt || k.shift || k.win);
}
/** The keys of a key press, or null when it is only a modifier or not a usable combination. */
export function comboFromEvent(e: KeyboardEvent): HotkeyCombo | null {
  const k: HotkeyCombo = { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, win: e.metaKey, key: e.code };
  return isValidCombo(k) ? k : null;
}
export function matchesCombo(e: KeyboardEvent, k: HotkeyCombo): boolean {
  return e.code === k.key && e.ctrlKey === k.ctrl && e.altKey === k.alt && e.shiftKey === k.shift && e.metaKey === k.win;
}

/** The shortcut's label, kept current when it is changed in Voice settings. */
export function useDictationLabel(): string {
  const [label, setLabel] = useState(hotkeyLabel(DEFAULT_KEYS));
  useEffect(() => {
    loadDictationPrefs().then((p) => setLabel(hotkeyLabel(p.keys))).catch(() => {});
    const on = (e: Event) => setLabel(hotkeyLabel((e as CustomEvent<DictationPrefs>).detail.keys));
    window.addEventListener("lanx:dictation-prefs", on);
    return () => window.removeEventListener("lanx:dictation-prefs", on);
  }, []);
  return label;
}

export interface DictationPrefs {
  hotkey: boolean;
  /** LANX 2.5.1: which keys. */
  keys: HotkeyCombo;
  model: "tiny" | "base" | "small";
  /** "auto" | "en" | "hi" | "mr" | … */
  lang: string;
  /** Type the words into whatever program was in front (Windows). */
  typeInto: boolean;
}
export const DEFAULT_DICTATION: DictationPrefs = { hotkey: true, keys: DEFAULT_KEYS, model: "base", lang: "auto", typeInto: true };
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
    if (!v) return DEFAULT_DICTATION;
    const p = { ...DEFAULT_DICTATION, ...(JSON.parse(v) as Partial<DictationPrefs>) };
    if (!isValidCombo(p.keys)) p.keys = DEFAULT_KEYS;
    return p;
  } catch {
    return DEFAULT_DICTATION;
  }
}
export async function saveDictationPrefs(p: DictationPrefs): Promise<void> {
  await api.setPref("dictation", JSON.stringify(p));
  api.setDictationHotkey(p.hotkey, p.keys).catch(() => {});
  window.dispatchEvent(new CustomEvent("lanx:dictation-prefs", { detail: p }));
}

/** Records the microphone as 16 kHz mono samples until `stop()`. */
export interface PcmRecorder {
  stop: () => Promise<Float32Array>;
  /** 0..1, for a little level meter. */
  level: () => number;
  seconds: () => number;
}

/** The microphone tap: /lanx-tap.js (a file of LANX's own — the window's
 *  security policy does not run scripts from in-memory blobs, which is why
 *  2.5.0 reported "Failed to load worklet module script"). Resolves to a
 *  function that hands over each block of samples. */
async function openTap(ctx: AudioContext, onSamples: (d: Float32Array) => void): Promise<{ node: AudioNode; close: () => void }> {
  try {
    await ctx.audioWorklet.addModule("/lanx-tap.js");
    const tap = new AudioWorkletNode(ctx, "lanx-tap", { numberOfInputs: 1, numberOfOutputs: 0 });
    tap.port.onmessage = (e: MessageEvent<Float32Array>) => onSamples(e.data);
    return { node: tap, close: () => { tap.port.onmessage = null; tap.disconnect(); } };
  } catch (e) {
    // Older engine without worklets: the classic (deprecated) processor still works everywhere.
    console.warn("lanx-tap worklet unavailable, using ScriptProcessorNode", e);
    const sp = ctx.createScriptProcessor(4096, 1, 1);
    sp.onaudioprocess = (ev) => onSamples(ev.inputBuffer.getChannelData(0).slice(0));
    const sink = ctx.createGain();
    sink.gain.value = 0;
    sp.connect(sink);
    sink.connect(ctx.destination);
    return { node: sp, close: () => { sp.onaudioprocess = null; sp.disconnect(); sink.disconnect(); } };
  }
}

export async function startPcmRecorder(): Promise<PcmRecorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  const chunks: Float32Array[] = [];
  let total = 0;
  let level = 0;
  const started = performance.now();
  let stopped = false;
  let stopInternal = () => {};
  const tap = await openTap(ctx, (d) => {
    if (stopped) return;
    chunks.push(d);
    total += d.length;
    let s = 0;
    for (let i = 0; i < d.length; i++) s += d[i] * d[i];
    level = Math.min(1, Math.sqrt(s / d.length) * 6);
    if (total > SAMPLE_RATE * 600) stopInternal(); // 10 minutes at most
  });
  const src = ctx.createMediaStreamSource(stream);
  src.connect(tap.node);
  stopInternal = () => {
    if (stopped) return;
    stopped = true;
    try {
      src.disconnect();
      tap.close();
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
