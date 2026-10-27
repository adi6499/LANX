// LANX 2.16.0: the React side of the 3D boards. useScene() makes a scene
// once for a canvas and frees it when the board closes (or the game
// changes); Fallback catches any 3D failure and shows the flat board
// instead, so a game always opens.

import { Component, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import type { BoardProps } from "../boardProps";
import { markWebGLBroken } from "./support";

/** Anything a 3D board builds: it must be able to free itself. */
export interface SceneLike {
  dispose(): void;
}

/**
 * Creates a scene for the host element once, and disposes it on unmount.
 * Returns [ref for the host div, the scene (null until made), a failure flag].
 */
export function useScene<T extends SceneLike>(make: (host: HTMLDivElement) => T): [React.RefObject<HTMLDivElement | null>, T | null, boolean] {
  const host = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const makeRef = useRef(make);
  makeRef.current = make;
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let s: T | null = null;
    try {
      s = makeRef.current(el);
      setScene(s);
    } catch (e) {
      console.warn("LANX 3D board failed", e);
      markWebGLBroken();
      setFailed(true);
    }
    return () => {
      try {
        s?.dispose();
      } catch {
        /* closing */
      }
      setScene(null);
    };
  }, []);
  return [host, scene, failed];
}

/** Shows the flat board when a 3D board throws (bad driver, lost context…). */
export class Fallback extends Component<{ flat: ComponentType<BoardProps>; props: BoardProps; children: ReactNode }, { broken: boolean }> {
  state = { broken: false };
  static getDerivedStateFromError() {
    return { broken: true };
  }
  componentDidCatch(e: unknown) {
    console.warn("LANX 3D board failed; showing the flat one", e);
    markWebGLBroken();
  }
  render() {
    if (this.state.broken) {
      const Flat = this.props.flat;
      return (
        <div data-g3-fallback className="contents">
          <Flat {...this.props.props} />
        </div>
      );
    }
    return this.props.children;
  }
}

/** The canvas box of a 3D board: fills the width it is given, at a set aspect. */
export function SceneBox({ hostRef, aspect = 1.4, minH = 320, maxH = 560, className = "", children, testId }: { hostRef: React.RefObject<HTMLDivElement | null>; aspect?: number; minH?: number; maxH?: number; className?: string; children?: ReactNode; testId?: string }) {
  return (
    <div className={`relative w-full ${className}`} style={{ aspectRatio: `${aspect}`, minHeight: minH, maxHeight: maxH }} data-g3-scene={testId}>
      <div ref={hostRef} className="absolute inset-0" />
      {children}
    </div>
  );
}

/** Re-runs `fn` whenever the deps change, but not while the scene is missing. */
export function useSceneEffect<T>(scene: T | null, fn: (s: T) => void | (() => void), deps: unknown[]) {
  useEffect(() => {
    if (!scene) return;
    return fn(scene) ?? undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, ...deps]);
}
