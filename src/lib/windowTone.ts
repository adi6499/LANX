/** LANX 3.17.1: the colour behind the page follows LANX's look.
 *
 *  At start-up that colour is LANX's dark start-up colour (tauri.conf.json), so a window that
 *  opens before its page has drawn is never white. Once LANX is up, the same colour shows for
 *  a moment along the edges while the window is resized — so it is set to the page's own
 *  colour then (else a light LANX would get dark edges, as a dark LANX had white ones). */
import { invoke } from "@tauri-apps/api/core";

let last = "";

export function syncWindowTone() {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const read = () => {
    const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(getComputedStyle(document.body).backgroundColor);
    if (!m || (m[4] !== undefined && Number(m[4]) < 1)) return;
    const key = m.slice(1, 4).join(",");
    if (key === last) return;
    last = key;
    void invoke("window_tone", { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) }).catch(() => {});
  };
  // After the new look has been applied (a hidden window may get no frames: the timer).
  requestAnimationFrame(read);
  setTimeout(read, 300);
}
