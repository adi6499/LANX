/** LANX 3.9.0: Karaoke — big lyrics, the line being sung filling up as it goes,
 *  the next lines below. It follows where the song really is (every screen
 *  refresh), so while listening together every PC shows the same line at the
 *  same moment. Esc or ✕ closes it. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Headphones, X } from "lucide-react";
import { type Song, player } from "../../lib/music";

export interface KaraokeLine {
  t: number;
  text: string;
}

/** The line being sung at `pos` (s): its index (-1 before the first) and how far through it (0–1). */
export function lineAt(lines: KaraokeLine[], pos: number): { i: number; p: number } {
  let i = -1;
  for (let k = 0; k < lines.length; k++) {
    if (lines[k].t <= pos) i = k;
    else break;
  }
  if (i < 0) return { i, p: 0 };
  // A line lasts until the next one (but not more than 7 s: after that it's a pause).
  const end = Math.min(lines[i + 1]?.t ?? lines[i].t + 5, lines[i].t + 7);
  return { i, p: Math.max(0, Math.min(1, (pos - lines[i].t) / Math.max(0.3, end - lines[i].t))) };
}

export function Karaoke({ song, lines, together, onClose }: { song: Song; lines: KaraokeLine[]; together: string | null; onClose: () => void }) {
  const timed = useMemo(() => lines.length > 1 && lines.some((l, k) => k > 0 && l.t !== lines[k - 1].t + 4), [lines]);
  const [at, setAt] = useState({ i: -1, p: 0 });
  const fill = useRef<HTMLSpanElement | null>(null);
  const wait = useRef<HTMLDivElement | null>(null);
  const shown = useRef(-2);

  useEffect(() => {
    let raf = 0;
    const frame = () => {
      const pos = player.positionNow();
      const now = lineAt(lines, pos);
      if (now.i !== shown.current) {
        shown.current = now.i;
        setAt(now);
      }
      // The fill moves every frame, without re-rendering.
      if (fill.current) fill.current.style.clipPath = `inset(0 ${(100 - now.p * 100).toFixed(2)}% 0 0)`;
      if (wait.current) {
        const next = lines[now.i + 1];
        const left = next ? next.t - pos : 0;
        wait.current.textContent = next && left > 3 && (now.i < 0 || pos - lines[now.i].t > 7) ? `♪  ${Math.ceil(left)}` : "";
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [lines, onClose]);

  const line = (k: number) => lines[k]?.text ?? "";
  return (
    <div data-karaoke className="absolute inset-0 z-20 overflow-hidden bg-[#0b1020] text-white" onMouseDown={(e) => e.stopPropagation()}>
      {song.cover && <img src={song.cover} alt="" className="lanx-cover-blur absolute inset-0 h-full w-full object-cover" style={{ filter: "blur(70px) saturate(1.3)", animation: "lanx-music-drift 24s ease-in-out infinite" }} />}
      <div className="absolute inset-0 bg-black/55" />
      <div className="relative flex h-full flex-col px-8 py-6">
        <div className="flex items-center gap-3">
          {song.cover && <img src={song.cover} alt="" className="h-12 w-12 rounded-xl object-cover shadow-xl" />}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[16px] font-bold">{song.title}</div>
            <div className="truncate text-[13px] text-white/65">{song.artist}</div>
          </div>
          {together && (
            <span data-karaoke-together className="inline-flex items-center gap-1.5 rounded-full bg-white/12 px-3 py-1.5 text-[12px] font-semibold">
              <Headphones className="h-3.5 w-3.5" /> {together}
            </span>
          )}
          <button type="button" data-karaoke-close onClick={onClose} title="Close karaoke (Esc)" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 hover:bg-white/25">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
          {!lines.length ? (
            <div className="text-[18px] text-white/60">No lyrics found for this song.</div>
          ) : !timed ? (
            <div className="max-w-[900px] text-[18px] leading-relaxed text-white/75">These lyrics have no timings, so they can't follow the song:<br />{lines.slice(0, 8).map((l) => l.text).join(" · ")}…</div>
          ) : (
            <>
              <div className="min-h-[1.4em] max-w-[1000px] text-[clamp(16px,2.2vw,24px)] font-semibold text-white/35">{line(at.i - 1)}</div>
              <div data-karaoke-line={at.i} className="relative max-w-[1100px] text-[clamp(28px,4.6vw,56px)] font-extrabold leading-tight" key={at.i}>
                <span className="text-white/35">{at.i >= 0 ? line(at.i) : line(0)}</span>
                <span ref={fill} aria-hidden className="absolute inset-0 text-white" style={{ clipPath: "inset(0 100% 0 0)" }}>
                  {at.i >= 0 ? line(at.i) : ""}
                </span>
              </div>
              <div ref={wait} data-karaoke-wait className="h-6 text-[18px] font-semibold tracking-widest text-sky-300" />
              <div className="max-w-[1000px] text-[clamp(18px,2.6vw,30px)] font-bold text-white/60">{line(at.i + 1)}</div>
              <div className="max-w-[1000px] text-[clamp(16px,2.2vw,24px)] font-semibold text-white/35">{line(at.i + 2)}</div>
            </>
          )}
        </div>
        <div className="text-center text-[12px] text-white/45">Lyrics from lrclib.net{together ? " · every PC listening shows the same line at the same moment" : ""}</div>
      </div>
    </div>
  );
}
