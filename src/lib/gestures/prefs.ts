/** LANX 3.5.0: what Gesture control remembers. */
import { useEffect, useState } from "react";
import { api } from "../api";
import type { Speed } from "./interpret";
import type { CustomSign } from "./signs";

export interface GesturePrefs {
  /** The camera watches for hands (off until turned on). */
  enabled: boolean;
  /** The little camera picture in the corner. */
  preview: boolean;
  speed: Speed;
  hand: "auto" | "right" | "left";
  /** Flick the open hand for next / back / close. */
  swipes: boolean;
  /** ✌ (or Ctrl + Alt + J) to speak a command. */
  voice: boolean;
  /** A chosen camera (deviceId), or null for the usual one. */
  camera: string | null;
  /** LANX 3.6.1: hold the pointer still on a button to click it. */
  dwell: boolean;
  /** LANX 3.7.0: the hand drives the real mouse and keyboard in every program (Windows). */
  pc: boolean;
  /** In calls and meetings: raise a hand, palm to mute, wave to end, 👍 reacts. */
  calls: boolean;
  /** The keyboard opens when a hand picks a text box in LANX. */
  keyboard: boolean;
  /** Your own signs. */
  signs: CustomSign[];
}
export const DEFAULT_GESTURES: GesturePrefs = { enabled: false, preview: true, speed: "normal", hand: "auto", swipes: true, voice: true, camera: null, dwell: true, pc: false, calls: true, keyboard: true, signs: [] };
const EVENT = "lanx:gesture-prefs";

export async function loadGesturePrefs(): Promise<GesturePrefs> {
  try {
    const v = await api.getPref("gestures");
    return v ? { ...DEFAULT_GESTURES, ...(JSON.parse(v) as Partial<GesturePrefs>) } : DEFAULT_GESTURES;
  } catch {
    return DEFAULT_GESTURES;
  }
}
export async function saveGesturePrefs(p: GesturePrefs): Promise<void> {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: p }));
  await api.setPref("gestures", JSON.stringify(p));
}

/** The settings, kept current wherever they are changed. */
export function useGesturePrefs(): [GesturePrefs | null, (p: GesturePrefs) => void] {
  const [prefs, setPrefs] = useState<GesturePrefs | null>(null);
  useEffect(() => {
    let alive = true;
    loadGesturePrefs().then((p) => alive && setPrefs(p));
    const on = (e: Event) => setPrefs((e as CustomEvent<GesturePrefs>).detail);
    window.addEventListener(EVENT, on);
    return () => {
      alive = false;
      window.removeEventListener(EVENT, on);
    };
  }, []);
  return [prefs, (p) => void saveGesturePrefs(p).catch(() => {})];
}
