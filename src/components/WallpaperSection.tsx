import { useEffect, useRef, useState } from "react";
import { Check, Film, ImageIcon, Loader2 } from "lucide-react";
import { api, errorText } from "../lib/api";
import { BUILTIN, DEFAULT_WALLPAPER, type WallpaperChoice, startBuiltin } from "../lib/wallpaper";
import { loadWallpaperChoice } from "./WallpaperLayer";

/** LANX 2.5.0: Settings → Appearance → Live wallpaper. */
export function WallpaperSection({ onError }: { onError: (t: string) => void }) {
  const [choice, setChoice] = useState<WallpaperChoice>(DEFAULT_WALLPAPER);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadWallpaperChoice().then(setChoice);
  }, []);

  const apply = async (next: WallpaperChoice) => {
    setChoice(next);
    window.dispatchEvent(new CustomEvent("lanx-wallpaper", { detail: next }));
    try {
      await api.setPref("wallpaper", JSON.stringify(next));
    } catch (e) {
      onError(errorText(e));
    }
  };
  const pickFile = async () => {
    setBusy(true);
    try {
      const f = await api.pickWallpaper();
      if (f) await apply({ ...choice, kind: "file", path: f.path, name: f.name, id: undefined });
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const off = async () => {
    await apply({ ...choice, kind: "none", path: undefined, name: undefined });
    api.clearWallpaperFile().catch(() => {});
  };

  return (
    <div data-wallpaper-section className="space-y-3">
      <div className="grid grid-cols-4 gap-2.5">
        <button type="button" data-wallpaper-off onClick={off} className="group flex flex-col items-center gap-1">
          <span className={`relative block h-14 w-full rounded-[11px] bg-[var(--lanx-fill)] ${choice.kind === "none" ? "ring-[3px] ring-sky-500 ring-offset-2 ring-offset-transparent" : "ring-1 ring-black/10 dark:ring-white/10"}`}>
            {choice.kind === "none" && <span className="absolute inset-0 m-auto h-5 w-5 rounded-full bg-white/90 shadow flex items-center justify-center"><Check className="h-3 w-3 text-slate-800" strokeWidth={3} /></span>}
          </span>
          <span className="text-[10px] font-medium text-slate-600 dark:text-slate-300">Off</span>
        </button>
        {BUILTIN.map((b) => (
          <Preview key={b.id} id={b.id} name={b.name} hint={b.hint} on={choice.kind === "builtin" && choice.id === b.id} onPick={() => apply({ ...choice, kind: "builtin", id: b.id, path: undefined, name: undefined })} />
        ))}
        <button type="button" data-wallpaper-file onClick={pickFile} className="group flex flex-col items-center gap-1">
          <span className={`relative block h-14 w-full rounded-[11px] border-2 border-dashed ${choice.kind === "file" ? "border-sky-500" : "border-slate-300 dark:border-slate-600"} flex items-center justify-center text-slate-500`}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="flex gap-1"><ImageIcon className="h-4 w-4" /><Film className="h-4 w-4" /></span>}
          </span>
          <span className="text-[10px] font-medium text-slate-600 dark:text-slate-300 truncate max-w-full">{choice.kind === "file" && choice.name ? choice.name : "Your picture or video…"}</span>
        </button>
      </div>
      {choice.kind !== "none" && (
        <div className="grid grid-cols-2 gap-3 text-[11.5px] text-slate-600 dark:text-slate-300">
          <label className="flex items-center gap-2">Darken <input type="range" min={0} max={80} value={choice.dim} onChange={(e) => apply({ ...choice, dim: Number(e.target.value) })} className="flex-1" /></label>
          <label className="flex items-center gap-2">Blur <input type="range" min={0} max={20} value={choice.blur} onChange={(e) => apply({ ...choice, blur: Number(e.target.value) })} className="flex-1" /></label>
        </div>
      )}
      <p className="text-[10.5px] text-slate-400">Built-in wallpapers are drawn by LANX and loop without a seam. A video of your own plays on a loop (mp4, webm, mov; pictures png, jpg, webp, gif). The "Solid" glass preset hides it; "Frosted" or "Crystal" let it show through.</p>
    </div>
  );
}

function Preview({ id, name, hint, on, onPick }: { id: string; name: string; hint: string; on: boolean; onPick: () => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    return startBuiltin(ref.current, id, true);
  }, [id]);
  return (
    <button type="button" data-wallpaper-builtin={id} title={hint} onClick={onPick} className="group flex flex-col items-center gap-1">
      <span className={`relative block h-14 w-full rounded-[11px] overflow-hidden ${on ? "ring-[3px] ring-sky-500 ring-offset-2 ring-offset-transparent" : "ring-1 ring-black/10 dark:ring-white/10 group-hover:scale-[1.04]"} transition-all`}>
        <canvas ref={ref} className="h-full w-full" />
        {on && <span className="absolute inset-0 m-auto h-5 w-5 rounded-full bg-white/90 shadow flex items-center justify-center"><Check className="h-3 w-3 text-slate-800" strokeWidth={3} /></span>}
      </span>
      <span className="text-[10px] font-medium text-slate-600 dark:text-slate-300">{name}</span>
    </button>
  );
}
