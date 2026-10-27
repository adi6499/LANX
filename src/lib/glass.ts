/** LANX 2.15.0: the glass *lens* — an SVG displacement filter that bends
 *  what shows through a panel near its edges, like a real pane of glass
 *  (refraction), with the red channel bent a touch more (dispersion). The
 *  browser runs it inside `backdrop-filter`, so it works over chats,
 *  pictures and the live wallpaper alike — a WebGL shader could only bend a
 *  picture it drew itself. components/GlassFilters.tsx puts the filter in
 *  the page; lib/background.ts prefixes the panels' filter with it.
 *  (2.15.1: the light that followed the mouse is gone — too busy.) */

const LENS_KEY = "lanx_glass_lens";
let lens = true;
try {
  lens = localStorage.getItem(LENS_KEY) !== "off";
} catch {
  /* no storage: the lens stays on */
}
/** Whether the refraction lens is on (Settings → Appearance → Glass). */
export const glassLensOn = () => lens;
export function setGlassLens(v: boolean) {
  lens = v;
  try {
    localStorage.setItem(LENS_KEY, v ? "on" : "off");
  } catch {
    /* fine */
  }
}
/** The part of `backdrop-filter` that bends the view: nothing when the lens is off. */
export const lensFilter = () => (lens ? "url(#lanx-lens) " : "");

let mapUrl: string | null = null;
/** The displacement map: neutral in the middle, bending outward towards the
 *  edges (a convex pane). Red = sideways, green = up and down; 128 = no bend.
 *  Drawn once, 128 × 128, and stretched over every panel by the filter. */
export function lensMapUrl(): string {
  if (mapUrl) return mapUrl;
  const N = 128;
  const c = document.createElement("canvas");
  c.width = N;
  c.height = N;
  const ctx = c.getContext("2d");
  if (!ctx) return "";
  const img = ctx.createImageData(N, N);
  const bend = (t: number) => Math.sign(t) * Math.pow(Math.abs(t) * 2, 3) * 0.5; // 0 in the middle, ±0.5 at the edge
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / (N - 1) - 0.5;
      const v = y / (N - 1) - 0.5;
      const i = (y * N + x) * 4;
      img.data[i] = Math.round(128 + bend(u) * 127);
      img.data[i + 1] = Math.round(128 + bend(v) * 127);
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  mapUrl = c.toDataURL("image/png");
  return mapUrl;
}
