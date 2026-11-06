/** LANX 3.7.1: what the hands are doing right now — for the practice guide and the
 *  little hint ("✋ Moving · pinch to click"). The gesture layer fills it in every
 *  camera frame; listeners hear about changes of state at once and about the
 *  pointer's place at most every 50 ms (no re-render storm). */
import { useSyncExternalStore } from "react";
import type { CursorMode, Sign } from "./interpret";

export interface GestureLive {
  /** The camera is on and watching. */
  on: boolean;
  /** Controlling the whole PC (the real mouse) rather than LANX only. */
  pc: boolean;
  /** Hands being followed. */
  tracking: number;
  /** What the main hand is doing; null without a pointer. */
  mode: CursorMode | null;
  /** The pointer, in LANX's window (CSS px); null when not over LANX. */
  x: number | null;
  y: number | null;
  /** A sign being held (👍 ✌ 🤟 👎). */
  holding: Sign | null;
}

const PLACE_MS = 50;
/** What listeners were last told (a stable snapshot), and the newest. */
let shown: GestureLive = { on: false, pc: false, tracking: 0, mode: null, x: null, y: null, holding: null };
let latest = shown;
let timer = 0;
let shownAt = 0;
const subs = new Set<() => void>();

function emit() {
  timer = 0;
  shownAt = performance.now();
  shown = latest;
  for (const fn of subs) fn();
}

export function setGestureLive(next: Partial<GestureLive>) {
  latest = { ...latest, ...next };
  const changed = latest.on !== shown.on || latest.pc !== shown.pc || latest.tracking !== shown.tracking || latest.mode !== shown.mode || latest.holding !== shown.holding;
  if (changed) {
    window.clearTimeout(timer);
    emit();
  } else if ((latest.x !== shown.x || latest.y !== shown.y) && !timer) {
    timer = window.setTimeout(emit, Math.max(0, PLACE_MS - (performance.now() - shownAt)));
  }
}

const subscribe = (fn: () => void) => {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
};
/** The newest state, without waiting. */
export const gestureLive = (): GestureLive => latest;
export function useGestureLive(): GestureLive {
  return useSyncExternalStore(subscribe, () => shown, () => shown);
}

/** What the hand is doing, in a few words with what to do next (null: no hand). */
export function hintFor(s: Pick<GestureLive, "on" | "tracking" | "mode" | "holding">): string | null {
  if (!s.on || s.tracking === 0) return null;
  if (s.holding) return { yes: "👍 Hold it… (answers a call)", no: "👎 Hold it… (declines, closes)", listen: "✌ Hold it… then speak", wheel: "🤟 Hold it… (keyboard and menu)" }[s.holding];
  switch (s.mode) {
    case "point": return "✋ Moving · pinch to click · fist to scroll";
    case "press": return "🤏 Click — open your fingers";
    case "drag": return "🤏 Dragging — open your fingers to drop";
    case "grab": return "✊ Scrolling — open your hand to let go";
    case "zoom": return "🙌 Zooming — move your hands apart or together";
    case "frame": return "🙌 Window size — lower a hand to stop";
    default: return "✋ Hold your hand still a moment…";
  }
}
let hintShown: string | null = null;
/** The hint, re-rendering only when it changes (not as the pointer moves). */
export function useGestureHint(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => (hintShown = hintFor(shown)),
    () => hintShown,
  );
}
