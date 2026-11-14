import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Clock, Film, ImageIcon, Link2, Loader2, Wallpaper, X } from "lucide-react";
// The "Light" clock: a weight the rest of LANX doesn't use (loaded with this screen only).
import "@fontsource/plus-jakarta-sans/200.css";
import { api, errorText, isTauri } from "../lib/api";
import { BUILTIN, DEFAULT_WALLPAPER, type WallTone, type WallpaperChoice, fileKind, measureTone, mimeOf, startBuiltin } from "../lib/wallpaper";
import { CLOCK_STYLES, DEFAULT_WALLSCREEN, type WallScreenPrefs, dateLine, loadWallScreen, saveWallScreen, timeParts } from "../lib/wallscreen";
import { loadWallpaperChoice } from "./WallpaperLayer";

/** LANX 3.14.0: the wallpaper screen — a live wallpaper over the whole screen, with a big
 *  clock and the date like a phone's lock screen. Move the mouse for the buttons:
 *  choose a wallpaper (LANX's own, a file of yours, or a link), set the clock, close.
 *  Esc closes it; the arrow keys step through LANX's wallpapers. */

type Shown = { kind: "builtin"; id: string } | { kind: "file"; path: string; name: string };

export function WallScreen({ reduceMotion, unread, onClose }: { reduceMotion: boolean; unread: number; onClose: () => void }) {
  const [prefs, setPrefs] = useState<WallScreenPrefs | null>(null);
  const [app, setApp] = useState<WallpaperChoice>(DEFAULT_WALLPAPER);
  const [sheet, setSheet] = useState<"wall" | "clock" | null>(null);
  const [controls, setControls] = useState(true);
  const [here, setHere] = useState(false);
  const [closing, setClosing] = useState(false);
  const [now, setNow] = useState(() => new Date());
  /** Goes up when the kept file changes (its path can stay the same). */
  const [rev, setRev] = useState(0);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileGone, setFileGone] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /** How bright the wallpaper is: a bright one is darkened a little more, so the white clock stays easy to read. */
  const [tone, setTone] = useState<WallTone | null>(null);
  const hideTimer = useRef(0);
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;

  useEffect(() => {
    let alive = true;
    void loadWallScreen().then((p) => alive && setPrefs(p));
    void loadWallpaperChoice().then((c) => alive && setApp(c));
    return () => {
      alive = false;
    };
  }, []);

  const update = useCallback((next: WallScreenPrefs) => {
    setPrefs(next);
    void saveWallScreen(next);
  }, []);

  const p = prefs ?? DEFAULT_WALLSCREEN;
  const shown: Shown = useMemo(() => {
    if (p.source === "file" && p.path) return { kind: "file", path: p.path, name: p.name ?? p.path };
    if (p.source === "app") {
      if (app.kind === "file" && app.path) return { kind: "file", path: app.path, name: app.name ?? app.path };
      if (app.kind === "builtin") return { kind: "builtin", id: app.id ?? "aurora" };
      return { kind: "builtin", id: "bloom" };
    }
    return { kind: "builtin", id: p.id ?? "bloom" };
  }, [p.source, p.path, p.name, p.id, app]);
  const shownKey = shown.kind === "builtin" ? `b:${shown.id}` : `f:${shown.path}:${rev}`;
  const media = shown.kind === "file" ? fileKind(shown.name) ?? fileKind(shown.path) ?? "image" : null;

  // Full screen while it shows (and back to how the window was).
  useEffect(() => {
    if (!isTauri) return;
    let was = false;
    let gone = false;
    void import("@tauri-apps/api/window")
      .then(async ({ getCurrentWindow }) => {
        const w = getCurrentWindow();
        was = await w.isFullscreen().catch(() => false);
        if (!gone && !was) await w.setFullscreen(true);
      })
      .catch(() => {});
    return () => {
      gone = true;
      void import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) => (was ? undefined : getCurrentWindow().setFullscreen(false)))
        .catch(() => {});
    };
  }, []);

  // It fades in, and the wallpaper settles (like a phone waking up).
  useEffect(() => {
    const r = requestAnimationFrame(() => setHere(true));
    return () => cancelAnimationFrame(r);
  }, []);
  const close = useCallback(() => {
    setClosing(true);
    window.setTimeout(onClose, reduceMotion ? 0 : 220);
  }, [onClose, reduceMotion]);

  // The clock: on the second, or on the minute when seconds are off.
  useEffect(() => {
    let timer = 0;
    const tick = () => {
      setNow(new Date());
      const step = p.seconds ? 1000 : 60000;
      timer = window.setTimeout(tick, step - (Date.now() % step) + 20);
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [p.seconds]);

  // A built-in wallpaper: drawn live. (Looked at shortly after it starts, and now and then:
  // "Day and night" is bright by day and dark at night.)
  useEffect(() => {
    setTone(null);
    const canvas = canvasRef.current;
    if (shown.kind !== "builtin" || !canvas) return;
    const stop = startBuiltin(canvas, shown.id, reduceMotion, true);
    const look = () => setTone(measureTone(canvas, 0));
    const first = window.setTimeout(look, 700);
    const later = window.setInterval(look, 60000);
    return () => {
      stop();
      window.clearTimeout(first);
      window.clearInterval(later);
    };
  }, [shownKey, reduceMotion]);

  // A file: read once (a link in the browser preview is shown as it is).
  useEffect(() => {
    setFileGone(false);
    if (shown.kind !== "file") {
      setFileUrl(null);
      return;
    }
    if (!isTauri || /^https?:\/\//.test(shown.path)) {
      setFileUrl(shown.path);
      return;
    }
    let url: string | null = null;
    let alive = true;
    setFileUrl(null);
    api
      .readFileBytes(shown.path)
      .then((bytes) => {
        if (!alive) return;
        url = URL.createObjectURL(new Blob([bytes.slice(0)], { type: mimeOf(shown.name) }));
        setFileUrl(url);
      })
      .catch(() => alive && setFileGone(true));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [shownKey]);

  // The screen stays awake (where the web engine can ask for that).
  useEffect(() => {
    if (!p.awake) return;
    type Lock = { release: () => Promise<void> };
    const wl = (navigator as Navigator & { wakeLock?: { request: (k: "screen") => Promise<Lock> } }).wakeLock;
    if (!wl) return;
    let lock: Lock | null = null;
    let alive = true;
    const ask = () => {
      if (document.hidden) return;
      wl.request("screen")
        .then((l) => {
          if (alive) lock = l;
          else void l.release();
        })
        .catch(() => {});
    };
    ask();
    document.addEventListener("visibilitychange", ask);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", ask);
      void lock?.release().catch(() => {});
    };
  }, [p.awake]);

  // The buttons show when the mouse moves and go again after a few seconds.
  const poke = useCallback(() => {
    setControls(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!sheetRef.current) setControls(false);
    }, 3500);
  }, []);
  useEffect(() => {
    poke();
    return () => window.clearTimeout(hideTimer.current);
  }, [poke, sheet]);

  const pickBuiltin = useCallback(
    (id: string) => {
      if (prefs) update({ ...prefs, source: "builtin", id });
    },
    [prefs, update],
  );
  const step = useCallback(
    (dir: 1 | -1) => {
      const at = shown.kind === "builtin" ? BUILTIN.findIndex((b) => b.id === shown.id) : -1;
      pickBuiltin(BUILTIN[(at + dir + BUILTIN.length) % BUILTIN.length].id);
    },
    [shown, pickBuiltin],
  );

  // Esc closes (a sheet first); the arrows step through LANX's wallpapers.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (sheetRef.current) setSheet(null);
        else close();
      } else if (!sheetRef.current && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
        e.preventDefault();
        step(e.key === "ArrowRight" ? 1 : -1);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [close, step]);

  const style = CLOCK_STYLES.find((c) => c.id === p.clock) ?? CLOCK_STYLES[0];
  // Your own "Darken" is the least; a bright wallpaper gets a little more by itself.
  // (LANX’s own wallpapers are made for a white clock; only a really bright one needs it.)
  const auto = shown.kind === "file" ? (tone === "light" ? 34 : tone === "mid" ? 22 : 0) : tone === "light" ? 24 : 0;
  const dim = Math.max(p.dim, auto);
  const time = timeParts(now, p.hour12);
  const ease = reduceMotion ? "none" : undefined;
  const visible = here && !closing && prefs !== null;

  return (
    <div
      data-wallscreen
      data-wallscreen-shown={shown.kind === "builtin" ? shown.id : media}
      role="dialog"
      aria-label="Wallpaper screen"
      className="fixed inset-0 z-[58] overflow-hidden bg-black text-white select-none"
      style={{ opacity: visible ? 1 : 0, transition: ease ?? "opacity 320ms ease", cursor: controls ? "default" : "none" }}
      onMouseMove={poke}
      onTouchStart={poke}
    >
      {/* the wallpaper */}
      <div
        className="absolute inset-0"
        style={{ transform: visible || reduceMotion ? "scale(1)" : "scale(1.06)", transition: ease ?? "transform 1100ms cubic-bezier(0.2, 0.7, 0.2, 1)" }}
        onClick={() => (sheet ? setSheet(null) : poke())}
      >
        {shown.kind === "builtin" && <canvas key={shown.id} ref={canvasRef} className="h-full w-full" />}
        {shown.kind === "file" && fileUrl && media === "image" && <img key={shownKey} src={fileUrl} alt="" draggable={false} onLoad={(e) => setTone(measureTone(e.currentTarget, 0))} onError={() => setFileGone(true)} className={`h-full w-full object-cover ${reduceMotion ? "" : "lanx-wallscreen-drift"}`} />}
        {shown.kind === "file" && fileUrl && media === "video" && (
          <video key={shownKey} src={fileUrl} autoPlay={!reduceMotion} loop muted playsInline disablePictureInPicture onLoadedData={(e) => setTone(measureTone(e.currentTarget, 0))} onError={() => setFileGone(true)} className="h-full w-full object-cover" />
        )}
        <div className="absolute inset-0" data-wallscreen-dim data-tone={tone ?? ""} style={{ background: `rgba(0, 0, 0, ${dim / 100})`, transition: ease ?? "background 600ms ease" }} />
      </div>

      {/* the date and the time */}
      <div
        className="pointer-events-none absolute inset-x-0 flex flex-col items-center px-6 text-center"
        style={{
          top: "11vh",
          opacity: visible ? 1 : 0,
          transform: visible || reduceMotion ? "translateY(0)" : "translateY(14px)",
          transition: ease ?? "opacity 600ms ease 120ms, transform 700ms cubic-bezier(0.2, 0.7, 0.2, 1) 120ms",
          textShadow: "0 1px 18px rgba(0, 0, 0, 0.28)",
        }}
      >
        {p.date && (
          <div data-wallscreen-date style={{ fontSize: "clamp(17px, 2.7vh, 34px)", fontWeight: 600, letterSpacing: "0.01em", opacity: 0.94 }}>
            {dateLine(now)}
          </div>
        )}
        <div
          data-wallscreen-time
          className="flex items-baseline"
          style={{ fontFamily: style.font, fontWeight: style.weight, fontSize: "clamp(84px, 22vh, 300px)", lineHeight: 1.04, letterSpacing: style.spacing, fontVariantNumeric: "tabular-nums" }}
        >
          <span>{time.main}</span>
          {p.seconds && <span style={{ fontSize: "0.4em", opacity: 0.8, marginLeft: "0.14em" }}>{time.seconds}</span>}
          {time.suffix && <span style={{ fontSize: "0.15em", fontWeight: 600, opacity: 0.86, marginLeft: "0.4em", letterSpacing: "0.05em" }}>{time.suffix}</span>}
        </div>
        {fileGone && <div className="mt-4 rounded-full bg-black/55 px-4 py-1.5 text-[13px]">That picture or video can’t be opened any more. Choose another wallpaper.</div>}
      </div>

      {/* new messages while it shows */}
      {unread > 0 && !sheet && (
        <button type="button" data-wallscreen-unread onClick={close} className="absolute left-1/2 -translate-x-1/2 rounded-full px-4 py-2 text-[13px] font-semibold text-white" style={{ bottom: 92, background: "rgba(20, 20, 26, 0.78)", border: "1px solid rgba(255, 255, 255, 0.14)" }}>
          {unread} new message{unread === 1 ? "" : "s"} · back to LANX
        </button>
      )}

      {/* the sheets */}
      {sheet === "wall" && prefs && (
        <WallpaperSheet
          prefs={prefs}
          app={app}
          shown={shown}
          onPick={update}
          onNewFile={() => setRev((n) => n + 1)}
        />
      )}
      {sheet === "clock" && prefs && <ClockSheet prefs={prefs} now={now} onPick={update} />}

      {/* the buttons */}
      <div data-wallscreen-controls data-shown={controls ? "yes" : "no"} className="absolute inset-x-0 bottom-6 flex justify-center" style={{ opacity: controls ? 1 : 0, transition: ease ?? "opacity 300ms ease", pointerEvents: controls ? "auto" : "none" }}>
        <div className="flex items-center gap-1 rounded-[18px] p-1.5" style={PANEL}>
          <BarButton id="wall" label="Wallpaper" on={sheet === "wall"} onClick={() => setSheet((s) => (s === "wall" ? null : "wall"))}>
            <Wallpaper className="h-[17px] w-[17px]" />
          </BarButton>
          <BarButton id="clock" label="Clock" on={sheet === "clock"} onClick={() => setSheet((s) => (s === "clock" ? null : "clock"))}>
            <Clock className="h-[17px] w-[17px]" />
          </BarButton>
          <BarButton id="close" label="Close" on={false} onClick={close}>
            <X className="h-[17px] w-[17px]" />
          </BarButton>
        </div>
      </div>
    </div>
  );
}

/** One flat, even panel (no glow, no bands). */
const PANEL: React.CSSProperties = { background: "rgba(20, 20, 26, 0.86)", border: "1px solid rgba(255, 255, 255, 0.12)" };

function BarButton({ id, label, on, onClick, children }: { id: string; label: string; on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      data-wallscreen-button={id}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex items-center gap-2 rounded-[13px] px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-white/10"
      style={on ? { background: "rgba(255, 255, 255, 0.16)" } : undefined}
    >
      {children}
      {label}
    </button>
  );
}

function WallpaperSheet({ prefs, app, shown, onPick, onNewFile }: { prefs: WallScreenPrefs; app: WallpaperChoice; shown: Shown; onPick: (p: WallScreenPrefs) => void; onNewFile: () => void }) {
  const [busy, setBusy] = useState<"file" | "link" | null>(null);
  const [link, setLink] = useState(prefs.link ?? "");
  const [problem, setProblem] = useState("");

  const keepFile = (f: { path: string; name: string }, from?: string) => {
    onPick({ ...prefs, source: "file", path: f.path, name: f.name, link: from });
    onNewFile();
  };
  const pickFile = async () => {
    setProblem("");
    setBusy("file");
    try {
      const f = await api.pickWallScreenFile();
      if (f) keepFile(f);
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const fromLink = async () => {
    const u = link.trim();
    if (!u || busy) return;
    setProblem("");
    setBusy("link");
    try {
      keepFile(await api.wallScreenFromLink(u), u);
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const appName = app.kind === "builtin" ? BUILTIN.find((b) => b.id === app.id)?.name ?? "LANX’s wallpaper" : app.name ?? "LANX’s wallpaper";
  return (
    <div data-wallscreen-sheet="wall" className="absolute left-1/2 -translate-x-1/2 rounded-[22px] p-5 lanx-wallscreen-rise" style={{ ...PANEL, bottom: 88, width: "min(1000px, calc(100vw - 48px))", maxHeight: "calc(100vh - 150px)", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
      <div className="mb-3 text-[13px] font-semibold text-white/90">Choose a wallpaper</div>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(112px, 1fr))" }}>
        {app.kind !== "none" && (
          <Tile id="app" label="Same as LANX" hint={appName} on={prefs.source === "app"} onClick={() => onPick({ ...prefs, source: "app" })}>
            {app.kind === "builtin" ? <Still id={app.id ?? "aurora"} /> : <FileFace video={fileKind(app.name ?? app.path ?? "") === "video"} />}
          </Tile>
        )}
        {BUILTIN.map((b) => (
          <Tile key={b.id} id={b.id} label={b.name} hint={b.hint} on={prefs.source !== "app" && shown.kind === "builtin" && shown.id === b.id} onClick={() => onPick({ ...prefs, source: "builtin", id: b.id })}>
            <Still id={b.id} />
          </Tile>
        ))}
        {prefs.path && (
          <Tile id="kept" label={prefs.name ?? "Your file"} hint={prefs.link ? "From a link" : "Your file"} on={prefs.source === "file"} onClick={() => onPick({ ...prefs, source: "file" })}>
            <FileFace video={fileKind(prefs.name ?? prefs.path) === "video"} />
          </Tile>
        )}
        <button type="button" data-wallscreen-file onClick={pickFile} className="group flex flex-col items-center gap-1.5 text-left">
          <span className="flex h-[70px] w-full items-center justify-center gap-1.5 rounded-[13px] border border-dashed border-white/30 text-white/70 transition-colors group-hover:border-white/60 group-hover:text-white">
            {busy === "file" ? <Loader2 className="h-4 w-4 animate-spin" /> : <><ImageIcon className="h-4 w-4" /><Film className="h-4 w-4" /></>}
          </span>
          <span className="w-full truncate text-center text-[11px] font-medium text-white/80">Your picture or video…</span>
        </button>
      </div>

      <div className="mt-4 text-[13px] font-semibold text-white/90">Or use a link</div>
      <div className="mt-2 flex items-center gap-2">
        <div className="flex h-10 flex-1 items-center gap-2 rounded-[12px] px-3" style={{ background: "rgba(255, 255, 255, 0.08)", border: "1px solid rgba(255, 255, 255, 0.12)" }}>
          <Link2 className="h-4 w-4 shrink-0 text-white/50" />
          <input
            data-wallscreen-link
            type="url"
            value={link}
            spellCheck={false}
            placeholder="Paste a link to a picture or video (https://…)"
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void fromLink();
            }}
            className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-white/40 select-text"
          />
        </div>
        <button type="button" data-wallscreen-link-use onClick={fromLink} disabled={!link.trim() || busy !== null} className="flex h-10 items-center gap-2 rounded-[12px] bg-white px-4 text-[13px] font-semibold text-slate-900 disabled:opacity-40">
          {busy === "link" ? <><Loader2 className="h-4 w-4 animate-spin" /> Getting it…</> : "Use this link"}
        </button>
      </div>
      {problem ? (
        <p data-wallscreen-problem className="mt-2 text-[12px] text-rose-300">{problem}</p>
      ) : (
        <p className="mt-2 text-[11.5px] text-white/45">LANX downloads it once and keeps a copy on this PC, so it also shows without the internet. Use the address of the picture or video itself (right-click it → Copy image address), up to 150 MB. A bright wallpaper is darkened a little by itself so the clock stays easy to read.</p>
      )}

      <label className="mt-4 flex items-center gap-3 text-[12.5px] text-white/80">
        Darken
        <input data-wallscreen-dim-slider type="range" min={0} max={60} value={prefs.dim} onChange={(e) => onPick({ ...prefs, dim: Number(e.target.value) })} className="flex-1" />
      </label>
    </div>
  );
}

function Tile({ id, label, hint, on, onClick, children }: { id: string; label: string; hint: string; on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" data-wallscreen-tile={id} data-on={on ? "yes" : "no"} title={hint} onClick={onClick} className="group flex flex-col items-center gap-1.5">
      <span className="relative block h-[70px] w-full overflow-hidden rounded-[13px]" style={{ outline: on ? "3px solid #fff" : "1px solid rgba(255, 255, 255, 0.16)", outlineOffset: on ? 2 : 0 }}>
        {children}
        {on && (
          <span className="absolute inset-0 m-auto flex h-5 w-5 items-center justify-center rounded-full bg-white">
            <Check className="h-3 w-3 text-slate-900" strokeWidth={3} />
          </span>
        )}
      </span>
      <span className="w-full truncate text-center text-[11px] font-medium text-white/80">{label}</span>
    </button>
  );
}

/** A built-in wallpaper, held still (the small picture in the list). */
function Still({ id }: { id: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    return startBuiltin(ref.current, id, true);
  }, [id]);
  // Drawn six times bigger and shrunk: the lights and raindrops are sized for a screen,
  // and on a tile-sized canvas they would fill the whole picture.
  return <canvas ref={ref} className="absolute left-0 top-0" style={{ width: "600%", height: "600%", transform: "scale(0.16667)", transformOrigin: "0 0" }} />;
}

function FileFace({ video }: { video: boolean }) {
  return <span className="flex h-full w-full items-center justify-center bg-white/10 text-white/80">{video ? <Film className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}</span>;
}

function ClockSheet({ prefs, now, onPick }: { prefs: WallScreenPrefs; now: Date; onPick: (p: WallScreenPrefs) => void }) {
  const sample = timeParts(now, prefs.hour12).main;
  return (
    <div data-wallscreen-sheet="clock" className="absolute left-1/2 -translate-x-1/2 rounded-[22px] p-5 lanx-wallscreen-rise" style={{ ...PANEL, bottom: 88, width: "min(460px, calc(100vw - 48px))" }} onClick={(e) => e.stopPropagation()}>
      <div className="mb-3 text-[13px] font-semibold text-white/90">Clock</div>
      <div className="grid grid-cols-4 gap-2">
        {CLOCK_STYLES.map((c) => (
          <button key={c.id} type="button" data-wallscreen-clock={c.id} data-on={prefs.clock === c.id ? "yes" : "no"} onClick={() => onPick({ ...prefs, clock: c.id })} className="flex flex-col items-center gap-1 rounded-[13px] px-1 py-2.5" style={{ background: "rgba(255, 255, 255, 0.07)", outline: prefs.clock === c.id ? "2px solid #fff" : "1px solid rgba(255, 255, 255, 0.12)" }}>
            <span style={{ fontFamily: c.font, fontWeight: c.weight, fontSize: 24, lineHeight: 1.1, letterSpacing: c.spacing, fontVariantNumeric: "tabular-nums" }}>{sample}</span>
            <span className="text-[10.5px] font-medium text-white/70">{c.name}</span>
          </button>
        ))}
      </div>
      <div className="mt-4 space-y-1">
        <Row label="Time">
          <div className="flex rounded-[10px] p-0.5" style={{ background: "rgba(255, 255, 255, 0.08)" }}>
            {[true, false].map((h12) => (
              <button key={String(h12)} type="button" data-wallscreen-hours={h12 ? "12" : "24"} onClick={() => onPick({ ...prefs, hour12: h12 })} className="rounded-[8px] px-3 py-1 text-[12px] font-semibold" style={prefs.hour12 === h12 ? { background: "#fff", color: "#0f172a" } : { color: "rgba(255, 255, 255, 0.75)" }}>
                {h12 ? "12-hour" : "24-hour"}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Show seconds">
          <Switch id="seconds" on={prefs.seconds} onChange={(v) => onPick({ ...prefs, seconds: v })} />
        </Row>
        <Row label="Show the date">
          <Switch id="date" on={prefs.date} onChange={(v) => onPick({ ...prefs, date: v })} />
        </Row>
        <Row label="Keep the screen on">
          <Switch id="awake" on={prefs.awake} onChange={(v) => onPick({ ...prefs, awake: v })} />
        </Row>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex h-10 items-center justify-between text-[13px] text-white/85">
      <span>{label}</span>
      {children}
    </div>
  );
}

function Switch({ id, on, onChange }: { id: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} data-wallscreen-switch={id} data-on={on ? "yes" : "no"} onClick={() => onChange(!on)} className="relative h-6 w-10 rounded-full transition-colors" style={{ background: on ? "#34c759" : "rgba(255, 255, 255, 0.22)" }}>
      <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all" style={{ left: on ? 18 : 2 }} />
    </button>
  );
}
