import { useEffect, useRef, useState } from "react";
import { api, events } from "../lib/api";
import { DEFAULT_WALLPAPER, type WallpaperChoice, fileKind, mimeOf, startBuiltin } from "../lib/wallpaper";

/** LANX 2.5.0: the live wallpaper behind the whole window (a built-in
 *  animation, or the user's own picture / video, looping). The settings panel
 *  fires "lanx-wallpaper" on the window when the choice changes. */

export async function loadWallpaperChoice(): Promise<WallpaperChoice> {
  try {
    const v = await api.getPref("wallpaper");
    return v ? { ...DEFAULT_WALLPAPER, ...(JSON.parse(v) as Partial<WallpaperChoice>) } : DEFAULT_WALLPAPER;
  } catch {
    return DEFAULT_WALLPAPER;
  }
}

/** `fileSrc` (the phone page): where to load a picture / video file from,
 *  instead of reading its bytes. */
export function WallpaperLayer({ reduceMotion, fileSrc }: { reduceMotion: boolean; fileSrc?: (c: WallpaperChoice) => string }) {
  const [choice, setChoice] = useState<WallpaperChoice>(DEFAULT_WALLPAPER);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let alive = true;
    const refresh = () => loadWallpaperChoice().then((c) => alive && setChoice(c));
    void refresh();
    const onChange = (e: Event) => {
      const c = (e as CustomEvent<WallpaperChoice>).detail;
      if (c) setChoice({ ...DEFAULT_WALLPAPER, ...c });
      else void refresh();
    };
    window.addEventListener("lanx-wallpaper", onChange);
    // 3.4: chosen on the phone — the PC follows.
    let off: (() => void) | undefined;
    if (!fileSrc)
      void events
        .onWallpaperChanged((p) => {
          if (p?.from === "phone") void refresh();
        })
        .then((u) => {
          if (alive) off = u;
          else u();
        })
        .catch(() => {});
    return () => {
      alive = false;
      off?.();
      window.removeEventListener("lanx-wallpaper", onChange);
    };
  }, [fileSrc]);

  // The window shows the layer through when a wallpaper is on.
  useEffect(() => {
    document.documentElement.classList.toggle("lanx-has-wallpaper", choice.kind !== "none");
    return () => document.documentElement.classList.remove("lanx-has-wallpaper");
  }, [choice.kind]);

  // Built-in: draw it.
  useEffect(() => {
    if (choice.kind !== "builtin" || !canvasRef.current) return;
    return startBuiltin(canvasRef.current, choice.id ?? "aurora", reduceMotion);
  }, [choice.kind, choice.id, reduceMotion]);

  // File: read it once into a blob URL (works without any web server).
  useEffect(() => {
    if (choice.kind !== "file" || !choice.path) {
      setFileUrl(null);
      return;
    }
    if (fileSrc) {
      setFileUrl(fileSrc(choice));
      return;
    }
    let url: string | null = null;
    let alive = true;
    api
      .readFileBytes(choice.path)
      .then((bytes) => {
        if (!alive) return;
        url = URL.createObjectURL(new Blob([bytes.slice(0)], { type: mimeOf(choice.name ?? choice.path ?? "") }));
        setFileUrl(url);
      })
      .catch(() => alive && setFileUrl(null));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [choice.kind, choice.path, choice.name, fileSrc]);

  if (choice.kind === "none") return null;
  const kind = choice.kind === "file" ? fileKind(choice.name ?? choice.path ?? "") : null;
  const filter = choice.blur ? `blur(${choice.blur}px)` : undefined;
  return (
    <div data-wallpaper={choice.kind === "builtin" ? choice.id : kind ?? "file"} className="absolute inset-0 -z-10 overflow-hidden pointer-events-none" aria-hidden="true">
      {choice.kind === "builtin" && <canvas ref={canvasRef} className="h-full w-full" style={{ filter }} />}
      {choice.kind === "file" && fileUrl && kind === "image" && <img src={fileUrl} alt="" className="h-full w-full object-cover" style={{ filter }} />}
      {choice.kind === "file" && fileUrl && kind === "video" && (
        <video src={fileUrl} autoPlay loop muted playsInline disablePictureInPicture className="h-full w-full object-cover" style={{ filter }} {...(reduceMotion ? { autoPlay: false } : {})} />
      )}
      <div className="absolute inset-0" data-wallpaper-dim style={{ background: `rgba(10, 14, 24, ${Math.min(80, Math.max(0, choice.dim)) / 100})` }} />
    </div>
  );
}
