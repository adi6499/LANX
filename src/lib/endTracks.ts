/** LANX 3.15.0: ending a track of pictures or sound that LANX makes itself (the pictures of
 *  its own call engine, the phone's camera), in the one order the Linux web engine
 *  (WebKitGTK) survives.
 *
 *  Ending such a track while a <video> on the page still shows its picture makes the
 *  engine rearrange that running player. Its player (waiting for the page to draw the
 *  picture) and its page (waiting for the player to let go) then wait for each other for
 *  good: the whole LANX window froze when a call ended. Taking the stream off a player is
 *  the engine's ordinary, safe way to stop it. So: first off the page's players, and only
 *  a moment later (when the last picture has been drawn) the tracks themselves end. */

/** Takes these tracks off every <video> and <audio> on the page that plays them; how many players that were. */
export function offPlayers(tracks: MediaStreamTrack[]): number {
  if (!tracks.length) return 0;
  let n = 0;
  // (By id: the engine may hand out a fresh object for the same track.)
  const ids = new Set(tracks.map((t) => t.id));
  for (const el of Array.from(document.querySelectorAll<HTMLMediaElement>("video, audio"))) {
    const s = el.srcObject;
    if (!(s instanceof MediaStream) || !s.getTracks().some((t) => ids.has(t.id))) continue;
    try {
      el.pause();
    } catch {
      /* not playing */
    }
    el.srcObject = null;
    n++;
  }
  return n;
}

/** Off the page's players now; the tracks end a moment later, then `then` runs. */
export function endTracks(tracks: MediaStreamTrack[], then?: () => void) {
  offPlayers(tracks);
  window.setTimeout(() => {
    for (const t of tracks) {
      try {
        t.stop();
      } catch {
        /* ended already */
      }
    }
    then?.();
  }, 400);
}

let safeStop = false;
/** Linux (WebKitGTK) only, once at start: every `track.stop()` in LANX goes that safe way.
 *  A camera that a <video> still shows (your own picture in a call, the gestures' camera)
 *  first comes off that player and ends a moment later; a track nothing shows ends at
 *  once, as always. Without this the window could freeze when a call ended. */
export function installSafeStop() {
  if (safeStop || typeof MediaStreamTrack === "undefined") return;
  safeStop = true;
  const proto = MediaStreamTrack.prototype;
  const stop = proto.stop;
  proto.stop = function (this: MediaStreamTrack) {
    if (this.readyState !== "live" || !offPlayers([this])) return stop.call(this);
    window.setTimeout(() => stop.call(this), 250);
  };
  (window as unknown as { __lanxSafeStop?: boolean }).__lanxSafeStop = true;
}
