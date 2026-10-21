import { useEffect, useRef, useState } from "react";
import { Radio, X } from "lucide-react";
import { api, errorText } from "../../lib/api";
import { FloatingMenu } from "../FloatingMenu";

/** LANX 1.8.0: the intercom — hold the button and talk; when you let go it
 *  plays by itself for the colleague (or everyone online in the group). */
const MAX_MS = 60_000;

export function IntercomButton({
  conversationId,
  name,
  disabled,
  onError,
  onSent,
}: {
  conversationId: string;
  name: string;
  disabled?: boolean;
  onError: (text: string) => void;
  onSent: (sent: Awaited<ReturnType<typeof api.sendIntercom>>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [talking, setTalking] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [status, setStatus] = useState("");
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const ctxRef = useRef<AudioContext | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // The microphone stays ready while the panel is open (no delay when you press).
  useEffect(() => {
    if (!open) return;
    let gone = false;
    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: { ideal: 1 } } })
      .then((s) => {
        if (gone) return s.getTracks().forEach((t) => t.stop());
        streamRef.current = s;
        const ctx = new AudioContext();
        ctxRef.current = ctx;
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        ctx.createMediaStreamSource(s).connect(an);
        const buf = new Float32Array(an.fftSize);
        timer.current = window.setInterval(() => {
          an.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 6));
          if (recRef.current?.state === "recording") {
            const ms = Date.now() - started.current;
            setElapsed(ms);
            if (ms >= MAX_MS) stop(true);
          }
        }, 100);
      })
      .catch(() => {
        onError("No microphone found, or Windows blocked it (Settings → Privacy → Microphone).");
        setOpen(false);
      });
    const close = (e: MouseEvent) => {
      const t = e.target as Element | null;
      // (The panel is drawn at the top of the page, outside wrapRef.)
      if (wrapRef.current?.contains(t) || t?.closest?.("[data-intercom-panel]") || recRef.current) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => {
      gone = true;
      window.removeEventListener("mousedown", close);
      window.clearInterval(timer.current);
      ctxRef.current?.close().catch(() => {});
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const start = () => {
    const s = streamRef.current;
    if (!s || recRef.current) return;
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
    const rec = new MediaRecorder(s, { mimeType: type || undefined, audioBitsPerSecond: 48_000 });
    chunks.current = [];
    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    rec.onstop = async () => {
      const ms = Date.now() - started.current;
      recRef.current = null;
      setTalking(false);
      if (!(rec as MediaRecorder & { send?: boolean }).send || ms < 400 || !chunks.current.length) {
        setStatus(ms < 400 ? "Hold the button while you talk." : "");
        return;
      }
      const blob = new Blob(chunks.current, { type: type || "audio/webm" });
      setStatus("Sending…");
      try {
        const sent = await api.sendIntercom(conversationId, new Uint8Array(await blob.arrayBuffer()), ms, type.includes("ogg") ? "ogg" : "webm");
        onSent(sent);
        setStatus(`Sent — it plays for ${name} now.`);
      } catch (err) {
        setStatus("");
        onError(errorText(err));
      }
    };
    recRef.current = rec;
    started.current = Date.now();
    setElapsed(0);
    setStatus("");
    setTalking(true);
    rec.start(200);
  };

  const stop = (send: boolean) => {
    const rec = recRef.current;
    if (!rec || rec.state === "inactive") return;
    (rec as MediaRecorder & { send?: boolean }).send = send;
    rec.stop();
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        ref={btnRef}
        data-intercom
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        title={`Intercom: hold to talk to ${name}`}
        className={`lanx-tool h-9 w-9 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-orange-500 disabled:opacity-40 ${open ? "!bg-orange-500/15 !text-orange-600" : ""}`}
      >
        <Radio className="h-[17px] w-[17px]" />
      </button>
      {open && (
        <FloatingMenu
          anchor={btnRef}
          onClose={() => !recRef.current && setOpen(false)}
          data-intercom-panel
          className="w-72 rounded-[18px] lanx-menu p-4 shadow-xl lanx-menu-in text-center"
        >
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-bold text-slate-900 dark:text-white">📻 Intercom</span>
            <button type="button" onClick={() => setOpen(false)} className="lanx-tool p-1 text-slate-400">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Hold the button and talk. When you let go, it plays by itself for {name}.</p>
          <button
            type="button"
            data-intercom-talk
            onPointerDown={(e) => {
              e.preventDefault();
              (e.currentTarget as Element).setPointerCapture(e.pointerId);
              start();
            }}
            onPointerUp={() => stop(true)}
            onPointerCancel={() => stop(false)}
            onKeyDown={(e) => {
              if ((e.key === " " || e.key === "Enter") && !e.repeat) {
                e.preventDefault();
                start();
              }
            }}
            onKeyUp={(e) => (e.key === " " || e.key === "Enter") && stop(true)}
            className={`relative mx-auto mt-4 flex h-28 w-28 select-none items-center justify-center rounded-full text-white shadow-lg transition-transform ${
              talking ? "scale-110 bg-red-500" : "bg-orange-500 hover:bg-orange-600"
            }`}
          >
            {talking && <span className="absolute inset-0 rounded-full bg-red-400/60" style={{ transform: `scale(${1 + level * 0.6})`, transition: "transform 0.1s" }} />}
            <span className="relative text-[13px] font-bold leading-tight">{talking ? `Talking… ${Math.floor(elapsed / 1000)}s` : "Hold to talk"}</span>
          </button>
          <p className="mt-3 h-4 text-[11px] text-slate-500 dark:text-slate-400" data-intercom-status>
            {status}
          </p>
        </FloatingMenu>
      )}
    </div>
  );
}
