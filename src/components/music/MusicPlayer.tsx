import { useEffect, useState } from "react";
import { Music2, Pause, Play, SkipBack, SkipForward, Volume2, X } from "lucide-react";
import { type PlayerState, type Song, fmtTime, player } from "../../lib/music";
import { TogetherLine } from "./ListenTogether";

/** LANX 2.7.0: the little player at the bottom right. It appears when a song
 *  plays (from the music picker or a song card) and stays while you chat. */
export function MusicPlayer({ onOpenMusic }: { onOpenMusic?: () => void }) {
  const [ps, setPs] = useState<PlayerState>(player.state());
  useEffect(() => {
    const un = player.subscribe(setPs);
    const onPlay = (e: Event) => void player.play((e as CustomEvent<Song>).detail);
    const onQueue = (e: Event) => player.enqueue((e as CustomEvent<Song>).detail);
    window.addEventListener("lanx:play-song", onPlay);
    window.addEventListener("lanx:queue-song", onQueue);
    return () => {
      un();
      window.removeEventListener("lanx:play-song", onPlay);
      window.removeEventListener("lanx:queue-song", onQueue);
    };
  }, []);
  if (!ps.song) return null;
  const s = ps.song;
  const pct = ps.duration ? Math.min(100, (ps.position / ps.duration) * 100) : 0;
  return (
    <div data-music-player={ps.playing ? "playing" : "paused"} className="fixed right-6 bottom-[92px] z-[55] w-[360px] max-w-[92vw] rounded-2xl bg-slate-900/92 text-white shadow-2xl backdrop-blur lanx-rise overflow-hidden">
      <div className="flex items-center gap-3 px-3 pt-3">
        <button type="button" onClick={onOpenMusic} title="Open the music picker" className="h-11 w-11 shrink-0 rounded-lg overflow-hidden bg-white/10 flex items-center justify-center">
          {s.cover ? <img src={s.cover} alt="" className="h-full w-full object-cover" /> : <Music2 className="h-5 w-5" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-semibold" title={s.title}>{s.title}</div>
          <div className="truncate text-[11px] text-white/70">{s.artist}</div>
          {ps.error && <div className="text-[10.5px] text-amber-300">{ps.error}</div>}
        </div>
        <button type="button" data-music-prev onClick={() => player.prev()} className="h-8 w-8 rounded-full hover:bg-white/15 flex items-center justify-center"><SkipBack className="h-4 w-4" /></button>
        <button type="button" data-music-toggle onClick={() => player.toggle()} className="h-9 w-9 rounded-full bg-white text-slate-900 flex items-center justify-center">{ps.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}</button>
        <button type="button" data-music-next onClick={() => player.next()} disabled={ps.index + 1 >= ps.queue.length} className="h-8 w-8 rounded-full hover:bg-white/15 disabled:opacity-30 flex items-center justify-center"><SkipForward className="h-4 w-4" /></button>
        <button type="button" data-music-stop onClick={() => player.stop()} title="Stop and hide" className="h-7 w-7 rounded-full hover:bg-white/15 flex items-center justify-center text-white/70"><X className="h-3.5 w-3.5" /></button>
      </div>
      <div className="flex items-center gap-2 px-3 pb-2.5 pt-2 text-[10.5px] text-white/70 tabular-nums">
        <span>{fmtTime(ps.position)}</span>
        <input type="range" min={0} max={Math.max(1, Math.round(ps.duration))} value={Math.round(ps.position)} onChange={(e) => player.seek(Number(e.target.value))} className="flex-1 accent-sky-400" style={{ background: `linear-gradient(to right, #38bdf8 ${pct}%, rgba(255,255,255,0.2) ${pct}%)` }} />
        <span>{fmtTime(ps.duration)}</span>
        <Volume2 className="h-3.5 w-3.5 ml-1" />
        <input type="range" min={0} max={100} value={Math.round(ps.volume * 100)} onChange={(e) => player.setVolume(Number(e.target.value) / 100)} className="w-16 accent-sky-400" />
      </div>
      <TogetherLine
        onOpen={() => {
          onOpenMusic?.();
          window.setTimeout(() => window.dispatchEvent(new Event("lanx:together-open")), 250);
        }}
      />
      {ps.queue.length > 1 && <div className="px-3 pb-2 text-[10px] text-white/50">Next: {ps.queue[ps.index + 1] ? ps.queue[ps.index + 1].title : "end of the queue"} · {ps.queue.length} in the queue</div>}
    </div>
  );
}
