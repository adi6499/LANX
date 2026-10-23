import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, Settings2, Square, X } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { api, errorText } from "../../lib/api";
import { DEFAULT_DICTATION, DICTATE_SHORTCUT, type DictationPrefs, type PcmRecorder, fmtSecs, insertAtCursor, loadDictationPrefs, startPcmRecorder } from "../../lib/voice";

/** LANX 2.5.0: dictation, like Wispr Flow. Press Ctrl + Alt + Space (anywhere
 *  in Windows, or inside LANX), speak, press it again: the words are typed
 *  where you were — the LANX message box or note, or the program that was in
 *  front. */

type Phase = "idle" | "listening" | "working";

export function DictationOverlay({ onError, onOpenSettings, external }: { onError: (t: string) => void; onOpenSettings: () => void; external?: { start: number } | null }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [level, setLevel] = useState(0);
  const [secs, setSecs] = useState(0);
  const [lastText, setLastText] = useState<string | null>(null);
  const rec = useRef<PcmRecorder | null>(null);
  const fromOutside = useRef(false);
  const prefs = useRef<DictationPrefs>(DEFAULT_DICTATION);
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;

  const start = useCallback(async (outside: boolean) => {
    if (phaseRef.current !== "idle") return;
    prefs.current = await loadDictationPrefs();
    const models = await api.voiceModels().catch(() => []);
    if (!models.find((m) => m.id === prefs.current.model)?.downloaded) {
      onError("Dictation needs the speech model first: open Voice settings and download it (one time).");
      onOpenSettings();
      return;
    }
    try {
      fromOutside.current = outside;
      rec.current = await startPcmRecorder();
      setPhase("listening");
      setLastText(null);
    } catch (e) {
      onError(`Microphone: ${errorText(e)}`);
    }
  }, [onError, onOpenSettings]);

  const stop = useCallback(async () => {
    const r = rec.current;
    if (!r || phaseRef.current !== "listening") return;
    rec.current = null;
    setPhase("working");
    try {
      const pcm = await r.stop();
      if (pcm.length < 16_000 / 2) {
        setPhase("idle");
        return;
      }
      const t = await api.transcribe(pcm, prefs.current.model, prefs.current.lang);
      const text = t.text.trim();
      if (!text) {
        onError("I didn't catch any words. Try speaking a little closer to the microphone.");
        setPhase("idle");
        return;
      }
      setLastText(text);
      let placed = false;
      if (fromOutside.current && prefs.current.typeInto) {
        placed = await api.typeText(text).catch(() => false);
      }
      if (!placed) placed = insertAtCursor(text);
      if (!placed) {
        await navigator.clipboard.writeText(text).catch(() => {});
        onError("Typed text copied — press Ctrl+V where you want it.");
      }
    } catch (e) {
      onError(errorText(e));
    } finally {
      setPhase("idle");
    }
  }, [onError]);

  const toggle = useCallback((outside: boolean) => (phaseRef.current === "listening" ? void stop() : void start(outside)), [start, stop]);

  // The Windows hotkey (through Rust) and the same keys inside LANX.
  useEffect(() => {
    let un: (() => void) | null = null;
    listen<boolean>("lanx://dictate", (e) => toggle(!!e.payload)).then((f) => (un = f)).catch(() => {});
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.code === "Space") {
        e.preventDefault();
        toggle(false);
      } else if (e.key === "Escape" && phaseRef.current === "listening") {
        rec.current?.stop();
        rec.current = null;
        setPhase("idle");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      un?.();
      window.removeEventListener("keydown", onKey);
    };
  }, [toggle]);

  // Started from a menu.
  useEffect(() => {
    if (external) void start(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [external?.start]);

  useEffect(() => {
    if (phase !== "listening") return;
    const t = window.setInterval(() => {
      setLevel(rec.current?.level() ?? 0);
      setSecs(rec.current?.seconds() ?? 0);
    }, 100);
    return () => window.clearInterval(t);
  }, [phase]);

  if (phase === "idle" && !lastText) return null;
  return (
    <div data-dictation={phase} className="fixed left-1/2 -translate-x-1/2 bottom-6 z-[70] flex items-center gap-3 rounded-full bg-slate-900/90 text-white px-4 py-2 shadow-2xl backdrop-blur lanx-rise">
      {phase === "listening" && (
        <>
          <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-red-500">
            <Mic className="h-4 w-4" />
            <span className="absolute inset-0 rounded-full bg-red-500/60 animate-ping" style={{ transform: `scale(${1 + level})` }} />
          </span>
          <div className="flex items-end gap-0.5 h-5">
            {Array.from({ length: 12 }, (_, i) => (
              <span key={i} className="w-1 rounded-sm bg-emerald-400" style={{ height: `${Math.max(15, Math.min(100, level * 100 * (0.5 + Math.sin(i * 1.3 + secs * 9) * 0.5 + 0.5)))}%` }} />
            ))}
          </div>
          <span className="text-[12.5px] font-semibold">Listening… {fmtSecs(secs)}</span>
          <span className="text-[11px] text-white/70">{DICTATE_SHORTCUT} or</span>
          <button type="button" data-dictation-stop onClick={() => stop()} className="h-7 px-3 rounded-full bg-white text-slate-900 text-[12px] font-semibold inline-flex items-center gap-1"><Square className="h-3 w-3" /> Done</button>
        </>
      )}
      {phase === "working" && (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-[12.5px] font-semibold">Writing it down…</span>
        </>
      )}
      {phase === "idle" && lastText && (
        <>
          <Mic className="h-4 w-4 text-emerald-400" />
          <span className="text-[12px] max-w-[480px] truncate" title={lastText}>{lastText}</span>
          <button type="button" onClick={() => navigator.clipboard.writeText(lastText).then(() => onError("Copied")).catch(() => {})} className="text-[11px] text-white/80 underline">copy</button>
          <button type="button" onClick={onOpenSettings} className="text-white/70 hover:text-white" title="Voice settings"><Settings2 className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={() => setLastText(null)} className="text-white/70 hover:text-white"><X className="h-3.5 w-3.5" /></button>
        </>
      )}
    </div>
  );
}
