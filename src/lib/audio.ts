/** LANX 1.8.0: playing sound that arrives by itself (the intercom).
 *  Browsers only let a page play sound after the user has clicked in it, so
 *  the first click anywhere "unlocks" one shared audio player. */

let ctx: AudioContext | null = null;

export function unlockAudio() {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    /* no audio on this computer */
  }
}

/** The shared player, started (or woken) on demand — the game sounds use it (2.13.0). */
export function audioContext(): AudioContext | null {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Plays a recording; false if this computer won't play it right now. */
export async function playClip(data: ArrayBuffer): Promise<boolean> {
  try {
    if (ctx && ctx.state === "running") {
      const buf = await ctx.decodeAudioData(data.slice(0));
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start();
      return true;
    }
  } catch {
    /* try the plain way */
  }
  try {
    const url = URL.createObjectURL(new Blob([data]));
    const a = new Audio(url);
    a.onended = () => URL.revokeObjectURL(url);
    await a.play();
    return true;
  } catch {
    return false;
  }
}
