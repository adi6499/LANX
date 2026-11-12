/** LANX 3.9.0: Announcements — hold to talk, let go: every chosen PC plays it at
 *  the same moment, so a room full of PCs sounds like one voice, not an echo.
 *  The recording goes to everyone first (in parts if long), then one small
 *  "play it at 12:00:03.400" on the sender's clock; each PC lines its clock up
 *  with the sender's and hands the sound card the exact moment. */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Loader2, Megaphone, Mic, Volume2, VolumeX, X } from "lucide-react";
import { announce, clockWith, myClock, perfAt, rand, sendBlob, together } from "../../lib/together";
import { PeoplePicker, Sheet, chosen, useOnline, presetPicked } from "./common";

const MAX_MS = 60000;
/** The play moment is this far ahead of "everyone has it". */
const LEAD_MS = 450;
const MUTE_KEY = "lanx.announcements.muted";

let ctx: AudioContext | null = null;
function audio(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  return ctx;
}
const muted = () => {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
};
const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
async function blobToB64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// ------------------------------------------------------------------ hearing them

interface Heard {
  id: string;
  from: string;
  fromName: string;
  buf: AudioBuffer | null;
  /** When to play, on the sender's clock (ms); null until "play" comes. */
  at: number | null;
  state: "coming" | "waiting" | "playing" | "done" | "held";
  src: AudioBufferSourceNode | null;
  ms: number;
}
const heard = new Map<string, Heard>();
const subs = new Set<() => void>();
let shown: Heard[] = [];
const changed = () => {
  shown = [...heard.values()].filter((h) => h.state !== "done").slice(-3);
  for (const s of subs) s();
};
const subscribe = (cb: () => void) => {
  subs.add(cb);
  return () => subs.delete(cb);
};

function play(h: Heard, fromStart = false) {
  if (!h.buf || h.at == null || h.state === "playing") return;
  if (muted() && !fromStart) {
    h.state = "held";
    return changed();
  }
  const c = audio();
  const src = c.createBufferSource();
  src.buffer = h.buf;
  src.connect(c.destination);
  const left = perfAt(h.at, h.from) - performance.now();
  const lat = (c.baseLatency || 0) + ((c as AudioContext & { outputLatency?: number }).outputLatency || 0);
  // On time: at the exact moment, with everyone. Late (it came slowly): from the start, now.
  if (!fromStart && left > 30) src.start(c.currentTime + Math.max(0.01, left / 1000 - lat));
  else src.start();
  h.src = src;
  h.state = "playing";
  src.onended = () => {
    h.state = "done";
    changed();
    window.setTimeout(() => heard.delete(h.id), 5000);
  };
  changed();
}

let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  together.on("pa", (e) => {
    const d = e.data;
    const id = String(d.id ?? d.blob ?? "");
    if (!id) return;
    let h = heard.get(id);
    if (!h) {
      h = { id, from: e.from_id, fromName: e.from_name, buf: null, at: null, state: "coming", src: null, ms: 0 };
      heard.set(id, h);
      // Line the clocks up while the recording arrives.
      void clockWith(e.from_id, 8).catch(() => {});
    }
    const hh = h;
    if (e.action === "blob" && typeof d.base64 === "string") {
      hh.ms = Number(d.ms) || 0;
      void audio()
        .decodeAudioData(b64ToBytes(d.base64).buffer)
        .then((buf) => {
          hh.buf = buf;
          hh.state = hh.at == null ? "waiting" : hh.state;
          play(hh);
          changed();
        })
        .catch(() => {
          heard.delete(hh.id);
          changed();
        });
    } else if (e.action === "event" && Number.isFinite(Number(d.at_ms))) {
      hh.at = Number(d.at_ms);
      if (hh.buf) play(hh);
    }
    changed();
  });
}

/** Always there: an announcement from a colleague, as it plays. */
export function AnnounceLayer() {
  useEffect(listen, []);
  const list = useSyncExternalStore(subscribe, () => shown);
  const [, setTick] = useState(0);
  if (!list.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[88] flex w-[380px] max-w-[92vw] -translate-x-1/2 flex-col gap-2">
      {list.map((h) => (
        <div key={h.id} data-announcement={h.state} className="pointer-events-auto flex items-center gap-3 rounded-2xl lanx-sheet p-3 shadow-2xl lanx-rise">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-600">{h.state === "coming" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Megaphone className="h-5 w-5" />}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-semibold text-slate-900 dark:text-white">Announcement from {h.fromName}</div>
            <div className="text-[12px] text-slate-500">{h.state === "playing" ? "Playing on every PC now" : h.state === "held" ? "Announcements are muted here" : "Arriving…"}</div>
          </div>
          {h.state === "held" ? (
            <button type="button" onClick={() => play(h, true)} className="rounded-full bg-sky-500 px-3 py-1.5 text-[12px] font-bold text-white">
              Play
            </button>
          ) : (
            <button
              type="button"
              title={muted() ? "Play announcements here" : "Mute announcements on this PC"}
              onClick={() => {
                try {
                  localStorage.setItem(MUTE_KEY, muted() ? "0" : "1");
                } catch {
                  /* private window */
                }
                setTick((n) => n + 1);
              }}
              className="lanx-tool p-1.5 text-slate-400"
            >
              {muted() ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
          )}
          <button
            type="button"
            title="Stop"
            onClick={() => {
              try {
                h.src?.stop();
              } catch {
                /* not started */
              }
              h.state = "done";
              changed();
            }}
            className="lanx-tool p-1.5 text-slate-400"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ making one

export function AnnounceSetup({ onClose }: { onClose: () => void }) {
  const online = useOnline();
  const [picked, setPicked] = useState<Record<string, boolean>>(presetPicked);
  const [phase, setPhase] = useState<"idle" | "recording" | "sending" | "sent">("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [ms, setMs] = useState(0);
  const [level, setLevel] = useState(0);
  const rec = useRef<{ mr: MediaRecorder; stream: MediaStream; chunks: Blob[]; t0: number; timer: number; raf: number } | null>(null);
  const people = chosen(online, picked);

  const start = async () => {
    if (rec.current || !people.length) return;
    setProblem(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mr = new MediaRecorder(stream, MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 32000 } : undefined);
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      mr.start(200);
      const c = audio();
      const an = c.createAnalyser();
      an.fftSize = 512;
      c.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      const t0 = performance.now();
      const r = { mr, stream, chunks, t0, timer: 0, raf: 0 };
      const meter = () => {
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(peak / 128);
        setMs(performance.now() - t0);
        r.raf = requestAnimationFrame(meter);
      };
      r.raf = requestAnimationFrame(meter);
      r.timer = window.setTimeout(() => void stop(), MAX_MS);
      rec.current = r;
      setPhase("recording");
    } catch (e) {
      setProblem(`The microphone didn't start: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const stop = async () => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    window.clearTimeout(r.timer);
    cancelAnimationFrame(r.raf);
    const length = performance.now() - r.t0;
    const done = new Promise<void>((res) => (r.mr.onstop = () => res()));
    r.mr.stop();
    await done;
    r.stream.getTracks().forEach((t) => t.stop());
    setLevel(0);
    if (length < 400) {
      setPhase("idle");
      setProblem("Hold the button while you talk, then let go.");
      return;
    }
    setPhase("sending");
    const id = `pa-${rand()}`;
    const b64 = await blobToB64(new Blob(r.chunks, { type: r.mr.mimeType || "audio/webm" }));
    const f: Record<string, string> = {};
    // Everyone gets the recording first…
    await Promise.all(
      people.map(async (p) => {
        const err = await sendBlob(p.id, id, "pa", id, b64, { id, ms: Math.round(length) });
        if (err) f[p.id] = err;
      }),
    );
    const got = people.filter((p) => !f[p.id]);
    // …then one moment for all, a little ahead.
    if (got.length) Object.assign(f, await announce("pa", got, { id, at_ms: Math.round((await myClock()) + LEAD_MS) }, id));
    setFailed(f);
    setPhase(got.length ? "sent" : "idle");
    if (!got.length) setProblem("No one could be reached.");
  };
  useEffect(
    () => () => {
      const r = rec.current;
      if (r) {
        r.mr.stop();
        r.stream.getTracks().forEach((t) => t.stop());
      }
    },
    [],
  );
  const reached = people.filter((p) => !failed[p.id]).length;
  return (
    <Sheet title="Announcement" subtitle="Hold to talk, let go: it plays on every chosen PC at the same moment" icon={<Megaphone className="h-5 w-5" />} onClose={onClose} tag="pa">
      <PeoplePicker picked={picked} onChange={(p) => (setPicked(p), setPhase("idle"))} failed={failed} />
      <div className="mt-5 flex flex-col items-center gap-3">
        <button
          type="button"
          data-announce-hold
          disabled={!people.length || phase === "sending"}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            void start();
          }}
          onPointerUp={() => void stop()}
          onPointerCancel={() => void stop()}
          onKeyDown={(e) => (e.key === " " || e.key === "Enter") && !e.repeat && void start()}
          onKeyUp={(e) => (e.key === " " || e.key === "Enter") && void stop()}
          className={`relative flex h-28 w-28 select-none items-center justify-center rounded-full text-white shadow-xl transition-transform disabled:opacity-40 ${phase === "recording" ? "scale-105 bg-rose-500" : "bg-sky-500 hover:bg-sky-600"}`}
        >
          <span className="absolute inset-0 rounded-full border-4 border-white/40" style={{ transform: `scale(${1 + level * 0.35})`, transition: "transform 80ms linear" }} />
          {phase === "sending" ? <Loader2 className="h-9 w-9 animate-spin" /> : <Mic className="h-9 w-9" />}
        </button>
        <div className="text-[13px] text-slate-600 dark:text-slate-300">
          {!people.length
            ? "Choose who hears it first."
            : phase === "recording"
              ? `Recording… ${Math.floor(ms / 1000)} s — let go to send`
              : phase === "sending"
                ? "Sending…"
                : phase === "sent"
                  ? `Played on ${reached} PC${reached === 1 ? "" : "s"} at the same moment. Hold again for another.`
                  : "Hold the button (or Space) while you talk"}
        </div>
        {problem && <div className="text-[12.5px] text-amber-600">{problem}</div>}
      </div>
    </Sheet>
  );
}

/** For tests: what this PC heard (and when it is due, page time). */
(window as unknown as { __lanxAnnouncements?: unknown }).__lanxAnnouncements = {
  list: () => [...heard.values()].map((h) => ({ id: h.id, state: h.state, due: h.at == null ? null : perfAt(h.at, h.from), seconds: h.buf?.duration ?? null })),
};
