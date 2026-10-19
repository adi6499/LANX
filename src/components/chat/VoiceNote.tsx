import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Pause, Play, Send, Trash2 } from "lucide-react";
import { api, errorText } from "../../lib/api";

/** LANX 1.5.0: voice notes — a player in the chat bubble, and the recorder
 *  that takes the message box's place while you talk. */

const BARS = 36;

function clockText(secs: number) {
  const s = Math.max(0, Math.round(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Length from the chat line "🎤 Voice note · 0:12" (milliseconds). */
export function voiceMsFromLabel(label: string): number {
  const m = /Voice note · (\d+):(\d\d)/.exec(label);
  return m ? (Number(m[1]) * 60 + Number(m[2])) * 1000 : 0;
}

/** Loudness bars (0–1) for a recording. */
async function peaksOf(buf: ArrayBuffer): Promise<number[]> {
  const ac = new AudioContext();
  try {
    const audio = await ac.decodeAudioData(buf.slice(0));
    const data = audio.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / BARS));
    const out: number[] = [];
    for (let i = 0; i < BARS; i++) {
      let peak = 0;
      for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j += 16) peak = Math.max(peak, Math.abs(data[j]));
      out.push(peak);
    }
    const max = Math.max(0.05, ...out);
    return out.map((p) => Math.max(0.12, p / max));
  } finally {
    ac.close().catch(() => {});
  }
}

const FLAT = Array.from({ length: BARS }, (_, i) => 0.25 + 0.2 * Math.abs(Math.sin(i * 1.7)));

export function VoiceNote({
  transferId,
  durationMs,
  state,
  progress,
  onAccent,
}: {
  transferId: string | null;
  durationMs: number;
  /** ready (on this computer) | arriving | failed */
  state: "ready" | "arriving" | "failed";
  progress?: number;
  onAccent: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [peaks, setPeaks] = useState<number[]>(FLAT);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [rate, setRate] = useState(1);
  const [problem, setProblem] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const total = Math.max(1, durationMs / 1000);

  useEffect(() => {
    if (state !== "ready" || !transferId) return;
    let gone = false;
    let objectUrl: string | null = null;
    api
      .readVoiceNote(transferId)
      .then(async (buf) => {
        if (gone) return;
        objectUrl = URL.createObjectURL(new Blob([buf], { type: "audio/webm" }));
        setUrl(objectUrl);
        try {
          const p = await peaksOf(buf);
          if (!gone) setPeaks(p);
        } catch {
          /* keep the plain bars */
        }
      })
      .catch((e) => !gone && setProblem(errorText(e)));
    return () => {
      gone = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [state, transferId]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate, url]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a || !url) return;
    if (a.paused) {
      // Only one voice note plays at a time.
      document.querySelectorAll<HTMLAudioElement>("audio[data-voice-audio]").forEach((x) => x !== a && x.pause());
      void a.play().catch(() => {});
    } else a.pause();
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !url) return;
    const r = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    a.currentTime = frac * total;
    setPos(a.currentTime);
  };

  const frac = Math.min(1, pos / total);
  const tone = onAccent ? "text-white" : "text-sky-600 dark:text-sky-400";
  const played = onAccent ? "bg-white" : "bg-sky-500";
  const rest = onAccent ? "bg-white/40" : "bg-slate-400/50 dark:bg-slate-500/60";

  return (
    <div data-voice-note={state} className="flex items-center gap-2.5 min-w-[230px] py-0.5">
      <button
        type="button"
        onClick={toggle}
        disabled={!url}
        aria-label={playing ? "Pause voice note" : "Play voice note"}
        className={`h-9 w-9 shrink-0 rounded-full flex items-center justify-center transition-transform active:scale-90 disabled:opacity-60 ${
          onAccent ? "bg-white/20 hover:bg-white/30" : "bg-sky-500 text-white hover:bg-sky-600"
        }`}
      >
        {state === "arriving" || (state === "ready" && !url && !problem) ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : playing ? (
          <Pause className="h-4 w-4 fill-current" />
        ) : (
          <Play className="h-4 w-4 fill-current ml-0.5" />
        )}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex h-7 cursor-pointer items-center gap-[2px]" onClick={seek} data-voice-wave>
          {peaks.map((p, i) => (
            <span key={i} className={`w-[3px] rounded-full ${i / BARS < frac ? played : rest}`} style={{ height: `${Math.round(p * 100)}%` }} />
          ))}
        </div>
        <div className={`mt-0.5 flex items-center justify-between text-[10px] ${onAccent ? "text-white/80" : "text-slate-500 dark:text-slate-400"}`}>
          <span className="tabular-nums" data-voice-time>
            {state === "arriving"
              ? `Arriving… ${progress ? `${Math.round(progress)}%` : ""}`
              : state === "failed"
                ? "Couldn't arrive"
                : problem
                  ? problem
                  : playing || pos > 0
                    ? `${clockText(pos)} / ${clockText(total)}`
                    : clockText(total)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Mic className={`h-3 w-3 ${tone}`} />
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setRate((r) => (r === 1 ? 1.5 : r === 1.5 ? 2 : 1))}
        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${onAccent ? "bg-white/20" : "bg-slate-500/10 text-slate-600 dark:text-slate-300"}`}
        title="Playback speed"
      >
        {rate}×
      </button>
      {url && (
        <audio
          ref={audioRef}
          src={url}
          preload="auto"
          data-voice-audio
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setPos(0);
          }}
          onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
        />
      )}
    </div>
  );
}

const MAX_MS = 10 * 60 * 1000;

/** Records a voice note; Send or the bin end it. */
export function VoiceRecorder({
  onSend,
  onCancel,
  onError,
}: {
  onSend: (data: Blob, durationMs: number, ext: string) => void;
  onCancel: () => void;
  onError: (text: string) => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(40).fill(0.1));
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const sendOnStop = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let gone = false;
    let ctx: AudioContext | null = null;
    let timer: number | undefined;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: { ideal: 1 } },
        });
        if (gone) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const type = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
        const rec = new MediaRecorder(stream, { mimeType: type || undefined, audioBitsPerSecond: 64_000 });
        recRef.current = rec;
        rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
        rec.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          const ms = Date.now() - started.current;
          if (sendOnStop.current && chunks.current.length) {
            const ext = type.includes("ogg") ? "ogg" : "webm";
            onSend(new Blob(chunks.current, { type: type || "audio/webm" }), ms, ext);
          }
        };
        rec.start(250);
        started.current = Date.now();
        ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(stream);
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        src.connect(an);
        const buf = new Float32Array(an.fftSize);
        timer = window.setInterval(() => {
          an.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          const level = Math.min(1, Math.sqrt(sum / buf.length) * 6);
          setLevels((l) => [...l.slice(1), Math.max(0.08, level)]);
          const ms = Date.now() - started.current;
          setElapsed(ms);
          if (ms >= MAX_MS) finish(true);
        }, 100);
      } catch {
        onError("No microphone found, or Windows blocked it (Settings → Privacy → Microphone).");
        onCancel();
      }
    })();
    return () => {
      gone = true;
      window.clearInterval(timer);
      ctx?.close().catch(() => {});
      if (recRef.current && recRef.current.state !== "inactive") {
        sendOnStop.current = false;
        recRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = (send: boolean) => {
    const rec = recRef.current;
    sendOnStop.current = send;
    if (rec && rec.state !== "inactive") rec.stop();
    if (!send) onCancel();
  };

  return (
    <div data-voice-recorder className="flex-1 flex items-center gap-2 rounded-[20px] bg-red-500/10 shadow-[inset_0_0_0_1px_rgb(239_68_68/0.35)] pl-2 pr-1 py-1 lanx-fade">
      <button
        type="button"
        onClick={() => finish(false)}
        aria-label="Discard the voice note"
        title="Discard"
        className="h-8 w-8 rounded-full flex items-center justify-center text-slate-500 hover:text-red-600 hover:bg-red-500/10"
      >
        <Trash2 className="h-4 w-4" />
      </button>
      <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
      <span className="text-[13px] font-semibold tabular-nums text-red-600 dark:text-red-400" data-voice-elapsed>
        {clockText(elapsed / 1000)}
      </span>
      <div className="flex-1 flex h-7 items-center gap-[2px] overflow-hidden">
        {levels.map((l, i) => (
          <span key={i} className="w-[3px] rounded-full bg-red-400/80" style={{ height: `${Math.round(l * 100)}%` }} />
        ))}
      </div>
      <button
        type="button"
        data-voice-send
        onClick={() => finish(true)}
        disabled={elapsed < 600}
        aria-label="Send the voice note"
        title="Send"
        className="h-8 w-8 rounded-full bg-sky-500 hover:bg-sky-600 text-white flex items-center justify-center disabled:opacity-40 active:scale-90 transition-transform"
      >
        <Send className="h-4 w-4" />
      </button>
    </div>
  );
}
