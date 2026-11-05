import { useEffect, useState } from "react";
import { Hand, X } from "lucide-react";
import { EXAMPLES } from "../../lib/gestures/commands";
import { type GesturePrefs, useGesturePrefs } from "../../lib/gestures/prefs";

/** LANX 3.5.0: Gesture settings — on/off, which camera, pointer speed,
 *  which hand, and the list of gestures and spoken commands. */
const GUIDE: { sign: string; name: string; does: string }[] = [
  { sign: "✋", name: "Open hand", does: "Moves the pointer. It wraps round the button it is over." },
  { sign: "⏳", name: "Hold still on a button", does: "The button fills up and clicks — nothing to learn." },
  { sign: "🤏", name: "Pinch", does: "Click — right away, on whatever the pointer shows. Pinch twice: double-click. In a list, pinch and hold: the right-click menu." },
  { sign: "🤏", name: "Pinch and move", does: "Drag a slider or a game piece, or scroll a list like a phone." },
  { sign: "✊", name: "Fist", does: "Grab the page and move it. Let go while moving to fling it." },
  { sign: "🙌", name: "Two hands pinching", does: "Pull apart to zoom in, together to zoom out, turn to rotate." },
  { sign: "👋", name: "Flick sideways", does: "Next or previous: song, photo, PDF page. Flick up: close." },
  { sign: "👍", name: "Thumbs up (hold)", does: "Answer a call or join a meeting. Over a message: like it." },
  { sign: "👎", name: "Thumbs down (hold)", does: "Decline a call, or close what is open." },
  { sign: "✌️", name: "Victory (hold)", does: "LANX listens: say a command, like “call Bharat”." },
  { sign: "🤟", name: "Rock on (hold)", does: "The command wheel: music, notes, calendar, games." },
];

function Segmented<T extends string>({ value, options, onChange, name }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; name: string }) {
  return (
    <div data-gesture-setting={name} className="grid gap-[3px] rounded-[10px] bg-[var(--lanx-fill)] p-[3px]" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button key={o.id} type="button" data-value={o.id} onClick={() => onChange(o.id)} className={`rounded-[8px] px-2 py-1 text-[12px] font-semibold transition-colors ${value === o.id ? "bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : "text-slate-500"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function GestureSettingsModal({ onClose }: { onClose: () => void }) {
  const [prefs, setPrefs] = useGesturePrefs();
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((d) => setCams(d.filter((x) => x.kind === "videoinput")))
      .catch(() => {});
  }, [prefs?.enabled]);
  if (!prefs) return null;
  const set = (p: Partial<GesturePrefs>) => setPrefs({ ...prefs, ...p });
  const row = "flex items-center justify-between gap-3 py-2";
  const label = "text-[12.5px] text-slate-700 dark:text-slate-200";

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/30 backdrop-blur-sm lanx-fade" onMouseDown={onClose}>
      <div data-gesture-settings className="w-[620px] max-w-[94vw] max-h-[92vh] overflow-y-auto rounded-[22px] lanx-sheet p-5 lanx-rise" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-[15px] font-bold text-slate-900 dark:text-white">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-white"><Hand className="h-4 w-4" /></span>
            Gestures: use LANX with your hands
          </h3>
          <button type="button" onClick={onClose} className="lanx-tool p-1 text-slate-400"><X className="h-4 w-4" /></button>
        </div>
        <p className="mt-2 text-[12px] text-slate-500">
          The camera follows your hand and LANX moves with it. The picture is looked at <b>on this PC only</b>. Nothing is recorded or sent anywhere, and the camera stops when LANX is hidden or locked.
        </p>

        <div className="mt-3 rounded-xl lanx-group px-3 divide-y divide-[var(--lanx-line)]">
          <label className={row}>
            <span className="text-[13px] font-semibold text-slate-900 dark:text-white">Follow my hand with the camera</span>
            <input type="checkbox" data-gesture-enable checked={prefs.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="h-4 w-4" />
          </label>
          {cams.length > 1 && (
            <label className={row}>
              <span className={label}>Camera</span>
              <select value={prefs.camera ?? ""} onChange={(e) => set({ camera: e.target.value || null })} className="lanx-field max-w-[60%] rounded-[10px] px-2 py-1 text-[12.5px] text-slate-900 dark:text-white">
                <option value="">The usual camera</option>
                {cams.map((c, i) => <option key={c.deviceId} value={c.deviceId}>{c.label || `Camera ${i + 1}`}</option>)}
              </select>
            </label>
          )}
          <div className={row}>
            <span className={label}>Pointer speed<span className="block text-[11px] text-slate-400">Fast: a small hand movement crosses the whole screen.</span></span>
            <div className="w-[220px]"><Segmented name="speed" value={prefs.speed} onChange={(v) => set({ speed: v })} options={[{ id: "slow", label: "Slow" }, { id: "normal", label: "Normal" }, { id: "fast", label: "Fast" }]} /></div>
          </div>
          <div className={row}>
            <span className={label}>Pointer hand<span className="block text-[11px] text-slate-400">When both hands are up, this one moves the pointer.</span></span>
            <div className="w-[220px]"><Segmented name="hand" value={prefs.hand} onChange={(v) => set({ hand: v })} options={[{ id: "auto", label: "Either" }, { id: "right", label: "Right" }, { id: "left", label: "Left" }]} /></div>
          </div>
          <label className={row}>
            <span className={label}>Show the camera picture in the corner</span>
            <input type="checkbox" checked={prefs.preview} onChange={(e) => set({ preview: e.target.checked })} className="h-4 w-4" />
          </label>
          <label className={row}>
            <span className={label}>Click by holding still on a button<span className="block text-[11px] text-slate-400">The button fills up for a moment, then clicks. Move away to stop it.</span></span>
            <input type="checkbox" data-gesture-dwell checked={prefs.dwell} onChange={(e) => set({ dwell: e.target.checked })} className="h-4 w-4" />
          </label>
          <label className={row}>
            <span className={label}>Flick to skip, go back or close</span>
            <input type="checkbox" checked={prefs.swipes} onChange={(e) => set({ swipes: e.target.checked })} className="h-4 w-4" />
          </label>
          <label className={row}>
            <span className={label}>Spoken commands<span className="block text-[11px] text-slate-400">Hold up ✌, or press Ctrl + Alt + J (works without a camera too).</span></span>
            <input type="checkbox" data-gesture-voice-toggle checked={prefs.voice} onChange={(e) => set({ voice: e.target.checked })} className="h-4 w-4" />
          </label>
        </div>

        <h4 className="mt-4 mb-2 text-[12px] font-bold uppercase tracking-wide text-slate-400">The gestures</h4>
        <div className="grid grid-cols-2 gap-2">
          {GUIDE.map((g) => (
            <div key={g.name} className="flex items-start gap-2.5 rounded-xl lanx-group p-2.5">
              <span className="w-9 shrink-0 text-center text-[20px] leading-7">{g.sign}</span>
              <span className="min-w-0">
                <span className="block text-[12.5px] font-semibold text-slate-900 dark:text-white">{g.name}</span>
                <span className="block text-[11.5px] text-slate-500">{g.does}</span>
              </span>
            </div>
          ))}
        </div>

        <h4 className="mt-4 mb-2 text-[12px] font-bold uppercase tracking-wide text-slate-400">Things you can say</h4>
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((x) => <span key={x} className="rounded-full lanx-group px-2.5 py-1 text-[11.5px] text-slate-600 dark:text-slate-300">“{x}”</span>)}
        </div>
        <p className="mt-2 text-[11px] text-slate-400">Spoken commands use the speech model from Voice settings. Hinglish works too: “Bharat ko call karo”, “agla gaana”.</p>

        <div className="mt-3 rounded-xl lanx-group p-3 text-[11.5px] text-slate-600 dark:text-slate-300">
          <b>For the best tracking:</b> sit about an arm’s length from the camera, with light on your face rather than a bright window behind you. Hold your hand up at chest height, palm towards the screen.
        </div>
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={onClose} className="px-4 py-1.5 rounded-full bg-slate-700 hover:bg-slate-800 text-white text-[12.5px] font-semibold">Done</button>
        </div>
      </div>
    </div>
  );
}
