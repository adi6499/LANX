/** LANX 3.7.0: Gesture settings → "Your signs": the signs taught so far, and
 *  teaching a new one (what it does, then three looks at it with the camera). */
import { useEffect, useRef, useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { parseCommand } from "../../lib/gestures/commands";
import type { Frame } from "../../lib/gestures/engine";
import type { GesturePrefs } from "../../lib/gestures/prefs";
import { type CustomSign, SignTeacher, type TeachStep } from "../../lib/gestures/signs";

/** Ready-made things a sign can do (anything a spoken command can do works). */
const CHOICES = ["open keyboard", "mute or unmute", "play music", "next song", "raise or lower hand", "take a screenshot", "lock this pc", "open notes", "show lanx", "press ctrl c"];

export function YourSigns({ prefs, set }: { prefs: GesturePrefs; set: (p: Partial<GesturePrefs>) => void }) {
  const [teaching, setTeaching] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const signs = prefs.signs ?? [];
  return (
    <div data-gesture-signs>
      {signs.length > 0 && (
        <div className="mb-2 rounded-xl lanx-group px-3 divide-y divide-[var(--lanx-line)]">
          {signs.map((s) => (
            <div key={s.id} data-sign-row={s.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 text-[12.5px] text-slate-700 dark:text-slate-200">
                🖐 <b>{s.name || s.command}</b>
                {s.name && <span className="text-slate-400"> — “{s.command}”</span>}
              </span>
              <button type="button" title="Forget this sign" onClick={() => set({ signs: signs.filter((x) => x.id !== s.id) })} className="lanx-tool p-1 text-slate-400 hover:text-red-500">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      {saved && !teaching && <p className="mb-2 text-[12px] text-emerald-600 dark:text-emerald-400">Saved “{saved}”. Try it: hold the sign up for a moment.</p>}
      {teaching ? (
        <TeachSign
          others={signs}
          cameraOn={prefs.enabled}
          onCameraOn={() => set({ enabled: true })}
          onCancel={() => setTeaching(false)}
          onDone={(s) => {
            set({ signs: [...signs, s] });
            setSaved(s.name || s.command);
            setTeaching(false);
          }}
        />
      ) : (
        <button type="button" data-teach-sign onClick={() => (setTeaching(true), setSaved(null))} className="flex items-center gap-1.5 rounded-full bg-sky-500 px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:bg-sky-600">
          <Plus className="h-3.5 w-3.5" /> Teach a sign
        </button>
      )}
    </div>
  );
}

function TeachSign({ others, cameraOn, onCameraOn, onCancel, onDone }: { others: CustomSign[]; cameraOn: boolean; onCameraOn: () => void; onCancel: () => void; onDone: (s: CustomSign) => void }) {
  const [command, setCommand] = useState("");
  const [name, setName] = useState("");
  const [step, setStep] = useState<"what" | "show">("what");
  const [t, setT] = useState<TeachStep>({ phase: "show", got: 0, p: 0, hand: false });
  const [problem, setProblem] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const teacher = useRef<SignTeacher | null>(null);
  const paused = useRef(false);
  const done = useRef({ onDone, command, name });
  done.current = { onDone, command, name };
  const intent = command.trim() ? parseCommand(command) : null;
  const understood = !!intent && intent.kind !== "unknown";

  useEffect(() => {
    if (step !== "show" || !cameraOn) return;
    teacher.current = new SignTeacher(others);
    paused.current = false;
    // The gesture layer hands its camera frames over for a while (and does nothing else).
    window.dispatchEvent(new CustomEvent("lanx:gesture-teach", { detail: { on: true } }));
    const on = (e: Event) => {
      const f = (e as CustomEvent<Frame>).detail;
      drawHand(canvas.current, f);
      if (paused.current || !teacher.current) return;
      const s = teacher.current.update(f);
      if (s.phase === "problem") {
        paused.current = true;
        setProblem(s.text);
        return;
      }
      setT(s);
      if (s.phase === "done") {
        paused.current = true;
        const d = done.current;
        d.onDone({ id: `s${Date.now().toString(36)}`, name: d.name.trim(), command: d.command.trim(), samples: s.samples, reach: s.reach });
      }
    };
    window.addEventListener("lanx:gesture-frame", on);
    return () => {
      window.removeEventListener("lanx:gesture-frame", on);
      window.dispatchEvent(new CustomEvent("lanx:gesture-teach", { detail: { on: false } }));
    };
  }, [step, cameraOn]); // eslint-disable-line react-hooks/exhaustive-deps

  if (step === "what") {
    return (
      <div data-teach="what" className="rounded-xl lanx-group p-3">
        <label className="block text-[12.5px] font-semibold text-slate-900 dark:text-white">
          What should it do?
          <span className="block text-[11px] font-normal text-slate-400">Say it like a spoken command: “call Bharat”, “open notes”, “type I'm in a meeting”.</span>
        </label>
        <input data-teach-command autoFocus value={command} onChange={(e) => setCommand(e.target.value)} placeholder="open keyboard" className="lanx-field mt-1.5 w-full rounded-[10px] px-2.5 py-1.5 text-[13px] text-slate-900 dark:text-white" />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {CHOICES.map((c) => (
            <button key={c} type="button" onClick={() => setCommand(c)} className={`rounded-full px-2.5 py-1 text-[11.5px] ${command === c ? "bg-sky-500 text-white" : "bg-[var(--lanx-fill)] text-slate-600 dark:text-slate-300"}`}>
              {c}
            </button>
          ))}
        </div>
        {command.trim() && !understood && <p className="mt-2 text-[11.5px] text-amber-600 dark:text-amber-400">LANX doesn't know that one. Try one of the above, or “call …”, “message … …”, “open …”.</p>}
        <label className="mt-3 block text-[12.5px] font-semibold text-slate-900 dark:text-white">
          Its name <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <input data-teach-name value={name} onChange={(e) => setName(e.target.value)} placeholder="Rock on" className="lanx-field mt-1.5 w-full rounded-[10px] px-2.5 py-1.5 text-[13px] text-slate-900 dark:text-white" />
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-[var(--lanx-fill)]">Cancel</button>
          <button type="button" data-teach-next disabled={!understood} onClick={() => setStep("show")} className="rounded-full bg-sky-500 px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:bg-sky-600 disabled:opacity-40">Next: show the sign</button>
        </div>
      </div>
    );
  }

  const got = t.phase === "done" ? 3 : t.phase === "problem" ? 0 : t.got;
  const say =
    !cameraOn ? "The camera is off."
    : problem ? problem
    : t.phase === "lower" ? "Got it. Lower your hand, then show the sign again."
    : t.phase === "show" && !t.hand ? "Hold your sign up to the camera, palm towards the screen."
    : t.phase === "show" ? "Hold it still…"
    : "Saved.";
  return (
    <div data-teach="show" data-teach-got={got} className="flex gap-3 rounded-xl lanx-group p-3">
      <canvas ref={canvas} width={160} height={120} className="h-[120px] w-[160px] shrink-0 rounded-xl bg-slate-900/80" />
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-semibold text-slate-900 dark:text-white">Show the sign three times</div>
        <div className="mt-2 flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${i < got ? "bg-emerald-500 text-white" : "bg-[var(--lanx-fill)] text-slate-400"}`}>
              {i < got ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
          ))}
        </div>
        {t.phase === "show" && t.hand && !problem && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--lanx-fill)]">
            <div className="h-full origin-left rounded-full bg-sky-500 transition-transform duration-100" style={{ transform: `scaleX(${t.p})` }} />
          </div>
        )}
        <p data-teach-say className={`mt-2 text-[12px] ${problem ? "text-amber-600 dark:text-amber-400" : "text-slate-600 dark:text-slate-300"}`}>{say}</p>
        <div className="mt-2 flex gap-2">
          {!cameraOn && <button type="button" onClick={onCameraOn} className="rounded-full bg-emerald-500 px-3 py-1 text-[12px] font-semibold text-white">Turn the camera on</button>}
          {problem && (
            <button
              type="button"
              data-teach-again
              onClick={() => {
                teacher.current?.reset();
                setProblem(null);
                setT({ phase: "show", got: 0, p: 0, hand: false });
                paused.current = false;
              }}
              className="rounded-full bg-sky-500 px-3 py-1 text-[12px] font-semibold text-white"
            >
              Try again
            </button>
          )}
          <button type="button" onClick={onCancel} className="rounded-full px-3 py-1 text-[12px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-[var(--lanx-fill)]">Cancel</button>
        </div>
      </div>
    </div>
  );
}

const BONES: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];

/** The hand's lines (mirrored, like a mirror) — what the camera sees while teaching. */
function drawHand(cv: HTMLCanvasElement | null, f: Frame) {
  const ctx = cv?.getContext("2d");
  if (!cv || !ctx) return;
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  for (const h of f.hands) {
    ctx.beginPath();
    for (const [a, b] of BONES) {
      ctx.moveTo((1 - h.lm[a * 3]) * cv.width, h.lm[a * 3 + 1] * cv.height);
      ctx.lineTo((1 - h.lm[b * 3]) * cv.width, h.lm[b * 3 + 1] * cv.height);
    }
    ctx.stroke();
  }
}
