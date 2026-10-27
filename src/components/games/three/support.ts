// LANX 2.16.0: whether this PC can show the 3D boards. Kept apart from the
// 3D code itself so the games window can ask without loading three.js.

let webglOk: boolean | null = null;

/** Whether this PC can draw WebGL at all (checked once). */
export function canWebGL(): boolean {
  if (webglOk !== null) return webglOk;
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") ?? c.getContext("webgl")) as WebGLRenderingContext | null;
    webglOk = !!gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webglOk = false;
  }
  return webglOk;
}

/** A board lost its WebGL context or failed: the games show flat boards on this PC until LANX restarts. */
export function markWebGLBroken() {
  webglOk = false;
}
