// Development only (gesture-lab.html, never in the app): Gesture control over
// a page of test targets — buttons, a long list, a slider, a list box, a
// drawing canvas and a zoomable picture — for building and checking it
// without starting LANX itself.
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "../App.css";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { GestureLayer, type GestureActions } from "../components/gestures/GestureLayer";
import { GestureSettingsModal } from "../components/gestures/GestureSettingsModal";
import { DEFAULT_GESTURES, saveGesturePrefs } from "../lib/gestures/prefs";

declare global {
  interface Window {
    __lab: { log: string[] };
  }
}
window.__lab = { log: [] };
const note = (s: string) => window.__lab.log.push(s);

function Lab() {
  const [clicks, setClicks] = useState<Record<string, number>>({});
  const [range, setRange] = useState(20);
  const [pick, setPick] = useState("b");
  const [zoom, setZoom] = useState(1);
  const [turn, setTurn] = useState(0);
  const [settings, setSettings] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const zoomEl = useRef<HTMLDivElement>(null);
  const hit = (id: string) => {
    note(`click:${id}`);
    setClicks((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }));
  };
  useEffect(() => {
    const el = zoomEl.current;
    if (!el) return;
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ scale: number; rotate: number }>).detail;
      e.preventDefault();
      setZoom((z) => Math.min(4, Math.max(0.25, z * d.scale)));
      setTurn((t) => t + d.rotate);
    };
    el.addEventListener("lanx:gesture-zoom", on);
    return () => el.removeEventListener("lanx:gesture-zoom", on);
  }, []);
  useEffect(() => {
    const onSwipe = (e: Event) => note(`swipe:${(e as CustomEvent<{ dir: string }>).detail.dir}`);
    const onKey = (e: KeyboardEvent) => note(`key:${e.key}`);
    window.addEventListener("lanx:gesture-swipe", onSwipe);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("lanx:gesture-swipe", onSwipe);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  const draw = useRef<{ x: number; y: number } | null>(null);
  const actions: GestureActions = {
    yes: () => (note("sign:yes"), false),
    no: () => (note("sign:no"), false),
    run: async (i) => (note(`intent:${JSON.stringify(i)}`), "done"),
    names: () => ["Bharat (Manager)", "Asha (Staff)"],
    close: () => false,
    // 3.7.0: a pretend call the tests switch on (window.__labCall = "call" | "meeting").
    inCall: () => (window as unknown as { __labCall?: "call" | "meeting" }).__labCall ?? null,
    react: (emoji) => (note(`react:${emoji}`), !!(window as unknown as { __labCall?: string }).__labCall),
    toggleMute: () => (note("mute-toggle"), (window as unknown as { __labCall?: string }).__labCall ? true : null),
    toggleHand: () => (note("hand-toggle"), (window as unknown as { __labCall?: string }).__labCall === "meeting" ? true : null),
    hangup: () => (note("hangup"), !!(window as unknown as { __labCall?: string }).__labCall),
  };
  return (
    <div className="h-screen flex gap-4 p-4">
      <div className="w-[300px] flex flex-col gap-3">
        <div className="flex gap-2">
          {["a", "b", "c"].map((id) => (
            <button key={id} type="button" data-lab-btn={id} onClick={() => hit(id)} onDoubleClick={() => note(`dbl:${id}`)} className="h-9 w-9 rounded-full bg-sky-500 text-white text-[12px] font-bold">
              {id.toUpperCase()}
              {clicks[id] ? <sup>{clicks[id]}</sup> : null}
            </button>
          ))}
          <button type="button" data-lab-settings onClick={() => setSettings(true)} className="ml-auto rounded-full bg-slate-700 px-3 text-[12px] text-white">Settings</button>
        </div>
        <div data-lab-ctx onContextMenu={(e) => { e.preventDefault(); note("contextmenu"); setMenu("open"); }} className="rounded-xl bg-white p-3 text-[12px] shadow cursor-pointer">
          Right-click me {menu && "(menu opened)"}
        </div>
        <input data-lab-range type="range" min={0} max={100} value={range} onChange={(e) => setRange(Number(e.target.value))} />
        <div data-lab-range-value>{range}</div>
        <select data-lab-select value={pick} onChange={(e) => { setPick(e.target.value); note(`select:${e.target.value}`); }} className="rounded border px-2 py-1">
          <option value="a">Apple</option>
          <option value="b">Banana</option>
          <option value="c">Cherry</option>
        </select>
        <input data-lab-text placeholder="Type here" className="rounded border px-2 py-1" />
        <div data-lab-list className="flex-1 overflow-y-auto rounded-xl bg-white shadow">
          {Array.from({ length: 80 }, (_, i) => (
            <div key={i} data-lab-row={i} onClick={() => hit(`row${i}`)} className="cursor-pointer border-b px-3 py-2.5 text-[12.5px]">Row {i}</div>
          ))}
        </div>
      </div>
      <div className="flex-1 flex flex-col gap-3">
        <canvas
          ref={canvas}
          data-lab-canvas
          width={500}
          height={260}
          className="rounded-xl bg-white shadow"
          onPointerDown={(e) => {
            (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
            draw.current = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };
            note("canvas:down");
          }}
          onPointerMove={(e) => {
            const c = canvas.current?.getContext("2d");
            if (!c || !draw.current) return;
            c.beginPath();
            c.moveTo(draw.current.x, draw.current.y);
            draw.current = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };
            c.lineTo(draw.current.x, draw.current.y);
            c.stroke();
            note("canvas:move");
          }}
          onPointerUp={() => {
            draw.current = null;
            note("canvas:up");
          }}
        />
        <div ref={zoomEl} data-lab-zoom className="flex-1 flex items-center justify-center overflow-hidden rounded-xl bg-white shadow">
          <div data-lab-zoom-box data-zoom={zoom.toFixed(2)} data-turn={turn.toFixed(0)} className="h-24 w-24 rounded-2xl bg-emerald-500" style={{ transform: `scale(${zoom}) rotate(${turn}deg)` }} />
        </div>
      </div>
      <GestureLayer actions={actions} locked={false} onError={(t) => note(`error:${t}`)} onOpenSettings={() => setSettings(true)} onOpenVoiceSettings={() => note("voice-settings")} />
      {settings && <GestureSettingsModal onClose={() => setSettings(false)} />}
    </div>
  );
}

const q = new URLSearchParams(location.search);
void saveGesturePrefs({ ...DEFAULT_GESTURES, enabled: q.get("on") !== "0", preview: true }).then(() =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Lab />
    </StrictMode>
  )
);
