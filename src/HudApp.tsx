/** LANX 3.7.0: the hands window — a small, see-through, always-on-top window at
 *  the bottom of the screen while hands control the whole PC: the air keyboard,
 *  and short notes ("👍 Answered", "Listening…"). The main window decides what it
 *  shows and sends it here; this window never takes the keyboard, and the real
 *  mouse clicks straight through it. */
import { useEffect, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { AirKeyboard } from "./components/gestures/AirKeyboard";
import { KB_SIZE } from "./lib/gestures/keyboard";
import { HUD_EVENT, HUD_NOTE_H, type HudState } from "./lib/gestures/hud";

export default function HudApp() {
  const [s, setS] = useState<HudState | null>(null);
  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    let off: (() => void) | undefined;
    let gone = false;
    void listen<HudState>(HUD_EVENT, (e) => setS(e.payload))
      .then((u) => {
        if (gone) return u();
        off = u;
        // Ready: the main window sends what to show.
        void emit("lanx:hud-ready").catch(() => {});
      })
      .catch(() => {});
    return () => {
      gone = true;
      off?.();
    };
  }, []);
  useEffect(() => {
    if (s) document.documentElement.classList.toggle("dark", s.dark);
  }, [s?.dark]);
  if (!s) return null;
  return (
    <div className="flex h-screen w-screen select-none flex-col items-center justify-end overflow-hidden">
      <div className="flex w-full shrink-0 items-center justify-center px-2" style={{ height: HUD_NOTE_H }}>
        {s.note && (
          <div data-hud-note className={`max-w-full truncate rounded-full px-4 py-2 text-[13px] font-medium text-white ${s.noteTone === "red" ? "bg-red-500" : "bg-slate-900/90"}`}>
            {s.note}
          </div>
        )}
      </div>
      {s.kb && <AirKeyboard state={s.kb} width={KB_SIZE.w} height={KB_SIZE.h} hover={s.hover} pressed={s.pressed} listening={s.listening} />}
    </div>
  );
}
