/** LANX 3.2 phone page: hold the button, talk, let go — a voice note or an
 *  intercom message, recorded with the phone's microphone (secure page only). */
import { useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";
import { type Recording, startRecording } from "./media";
import { Sheet } from "./parts";

export function RecordSheet({ mode, onClose, onDone, onProblem }: { mode: "voice" | "intercom"; onClose: () => void; onDone: (rec: Recording) => void; onProblem: (e: unknown) => void }) {
  const [state, setState] = useState<"idle" | "recording" | "stopping">("idle");
  const [secs, setSecs] = useState(0);
  const rec = useRef<Awaited<ReturnType<typeof startRecording>> | null>(null);
  const timer = useRef(0);

  useEffect(() => () => {
    window.clearInterval(timer.current);
    rec.current?.cancel();
  }, []);

  const begin = async () => {
    if (state !== "idle") return;
    try {
      rec.current = await startRecording();
      setState("recording");
      const t0 = Date.now();
      timer.current = window.setInterval(() => setSecs(Math.floor((Date.now() - t0) / 1000)), 250);
    } catch (e) {
      onProblem(new Error("The phone did not allow the microphone. Allow it for this page in the phone's settings."));
      onClose();
      void e;
    }
  };
  const end = async () => {
    if (state !== "recording" || !rec.current) return;
    setState("stopping");
    window.clearInterval(timer.current);
    const r = await rec.current.stop();
    rec.current = null;
    if (r) onDone(r);
    else {
      onProblem(new Error("That was too short — hold the button while you talk."));
      onClose();
    }
  };
  const limit = mode === "intercom" ? 60 : 600;
  useEffect(() => {
    if (state === "recording" && secs >= limit) void end();
  }, [secs, state, limit]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Sheet title={mode === "intercom" ? "Intercom" : "Voice note"} onClose={onClose} hook="record">
      <p className="text-[12.5px] text-slate-500 dark:text-slate-400">
        {mode === "intercom" ? "Hold, talk (up to a minute), let go — it plays out loud on their PC." : "Hold the button while you talk, let go to send."}
      </p>
      <div className="my-5 flex flex-col items-center gap-2">
        <button
          type="button"
          data-ph-record
          data-ph-record-state={state}
          onPointerDown={(e) => {
            if (e.button === 0) void begin();
          }}
          onPointerUp={() => void end()}
          onPointerCancel={() => void end()}
          onPointerLeave={() => void end()}
          className={`ph-hold flex h-24 w-24 items-center justify-center rounded-full text-white shadow-lg select-none ${state === "recording" ? "bg-rose-500 scale-110" : "bg-sky-500"} transition-transform`}
          aria-label="Hold to record"
        >
          <Mic className="h-10 w-10" />
        </button>
        <div className="text-[13px] font-semibold text-slate-700 dark:text-slate-200" data-ph-record-secs={secs}>
          {state === "recording" ? `Recording · ${secs}s` : state === "stopping" ? "Sending…" : "Hold to record"}
        </div>
      </div>
    </Sheet>
  );
}
