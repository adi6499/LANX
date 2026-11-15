// LANX 3.17.0: a clock for work that must go on while LANX is hidden or minimised — the host of
// a party game closing a round when its time is up, or opening the next one.
//
// A page's own timers slow down when the window is hidden: to once a second at first, and after
// five minutes out of sight to once a minute (the web engine does that to every hidden page). A
// round that should have closed after ten seconds then closed up to a minute late, and everyone
// at the table waited for the host's PC. A worker's timers are left alone, so the worker's clock
// (the same one LANX's recorder uses) ticks beside the page's; whichever comes first is used.
// (Both, because on Linux the worker's ticks reach the page late: see ownrtc/media.ts.)
//
// A PC that is asleep runs nothing at all: there the work is done the moment it wakes.

/** Calls `fn` about every `ms` milliseconds, also while the window is hidden. Returns the stop. */
export function steadyInterval(fn: () => void, ms: number): () => void {
  let last = 0;
  let stopped = false;
  const run = () => {
    if (stopped) return;
    const now = Date.now();
    if (now - last < ms * 0.6) return; // the other clock was here a moment ago
    last = now;
    fn();
  };
  const page = setInterval(run, ms);
  let worker: Worker | null = null;
  try {
    if (typeof Worker === "function") {
      worker = new Worker("/lanx-ticker.js");
      worker.onmessage = run;
      worker.onerror = () => {
        worker?.terminate();
        worker = null;
      };
      worker.postMessage(ms);
    }
  } catch {
    worker = null; // the page's clock alone
  }
  return () => {
    stopped = true;
    clearInterval(page);
    worker?.terminate();
    worker = null;
  };
}

/** Calls `fn` once, `ms` milliseconds from now, also when the window is hidden meanwhile. Returns the cancel. */
export function steadyTimeout(fn: () => void, ms: number): () => void {
  const due = Date.now() + ms;
  const stop = steadyInterval(
    () => {
      if (Date.now() < due) return;
      stop();
      fn();
    },
    Math.max(50, Math.min(500, Math.round(ms / 8))),
  );
  return stop;
}
