import { useEffect, useState } from "react";

/** Plays through a list of frames once whenever the list changes; returns the frame to show. */
export function useFrames<T>(frames: T[], stepMs = 16): { frame: T | null; playing: boolean } {
  const [k, setK] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!frames.length) {
      setK(0);
      setPlaying(false);
      return;
    }
    let i = 0;
    setK(0);
    setPlaying(frames.length > 1);
    const t = window.setInterval(() => {
      i += 1;
      if (i >= frames.length - 1) {
        window.clearInterval(t);
        setK(frames.length - 1);
        setPlaying(false);
        return;
      }
      setK(i);
    }, stepMs);
    return () => window.clearInterval(t);
  }, [frames, stepMs]);
  return { frame: frames.length ? frames[Math.min(k, frames.length - 1)] : null, playing };
}

/** A value that swings back and forth over time (a power meter, a wobbling sight). */
export function useSwing(period = 1400, running = true): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = () => {
      const t = ((performance.now() - t0) % period) / period;
      setV(t < 0.5 ? t * 2 : 2 - t * 2);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [period, running]);
  return v;
}
