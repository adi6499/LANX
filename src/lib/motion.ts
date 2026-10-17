/** Animation helpers: the "glass reveal" for look changes (like the GROZ
 *  site's dark-mode switch) and a hook that lets windows animate out. */
import { useEffect, useState } from "react";

/** Animations are off in Settings, or Windows asks for less motion. */
export const lessMotion = () =>
  document.documentElement.classList.contains("lanx-still") ||
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Settings → Appearance → Animations. */
export const setMotion = (off: boolean) => document.documentElement.classList.toggle("lanx-still", off);

export type Origin = { x: number; y: number } | null;

/** The centre of the clicked element (where a reveal starts). */
export function originOf(e?: { currentTarget?: EventTarget | null } | null): Origin {
  const el = e?.currentTarget as HTMLElement | null | undefined;
  const r = el?.getBoundingClientRect?.();
  return r && r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
}

type ViewTransitionDoc = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

/** Changes the look with a glass reveal: the new look grows as a soft
 *  circle from `origin` while the old one frosts over, or cross-fades when
 *  there is no origin. Instant when animations are off or unsupported. */
export function revealChange(change: () => void, origin: Origin = null) {
  const doc = document as ViewTransitionDoc;
  if (!doc.startViewTransition || lessMotion()) {
    change();
    return;
  }
  const root = document.documentElement;
  const x = origin?.x ?? innerWidth / 2;
  const y = origin?.y ?? innerHeight / 2;
  root.style.setProperty("--vt-x", `${Math.round(x)}px`);
  root.style.setProperty("--vt-y", `${Math.round(y)}px`);
  root.style.setProperty("--vt-r", `${Math.ceil(Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)))}px`);
  const cls = origin ? "lanx-reveal" : "lanx-crossfade";
  root.classList.add(cls);
  try {
    doc.startViewTransition(change).finished.finally(() => root.classList.remove(cls));
  } catch {
    root.classList.remove(cls);
    change();
  }
}

/** Keeps something on screen for `ms` after it closes so it can animate
 *  out: `closing` is true during that time. */
export function usePresence(open: boolean, ms = 200) {
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) {
      setShown(true);
      return;
    }
    if (lessMotion()) {
      setShown(false);
      return;
    }
    const t = window.setTimeout(() => setShown(false), ms);
    return () => window.clearTimeout(t);
  }, [open, ms]);
  return { mounted: open || shown, closing: !open && shown };
}

/** CSS custom property for a staggered entrance (`lanx-item-in`). */
export const stagger = (i: number, step = 28, max = 12) =>
  ({ ["--d" as string]: `${Math.min(i, max) * step}ms` }) as React.CSSProperties;
