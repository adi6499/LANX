// LANX 2.16.0: Rapier, the rigid-body physics engine, loaded only when a
// board needs it (dice that tumble, pins that topple, seeds that settle).
// Everything Rapier simulates here is *presentation*: the result was already
// decided by the game's rules (lib/games), the same on every PC, and the
// simulation is steered so it ends on that result. A physics glitch can
// never change a score.

export type Rapier = typeof import("@dimforge/rapier3d-compat");

let loading: Promise<Rapier> | null = null;

/** Loads and starts Rapier once (about 4 MB of WebAssembly, from inside the app). */
export function loadRapier(): Promise<Rapier> {
  if (!loading) {
    loading = import("@dimforge/rapier3d-compat").then(async (R) => {
      await R.init();
      return R;
    });
    loading.catch(() => {
      loading = null; // try again next time
    });
  }
  return loading;
}

/** A small seeded random generator for throws (so both PCs see the same tumble). */
export function seeded(seed: number): () => number {
  let x = seed >>> 0 || 0x9e3779b9;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** One recorded pose per frame, per body: position and rotation (quaternion). */
export interface Track {
  p: Float32Array; // x,y,z per frame
  q: Float32Array; // x,y,z,w per frame
  frames: number;
}

export function makeTrack(frames: number): Track {
  return { p: new Float32Array(frames * 3), q: new Float32Array(frames * 4), frames: 0 };
}
