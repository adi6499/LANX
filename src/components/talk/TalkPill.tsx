import { useEffect, useState, useSyncExternalStore } from "react";
import { Play, Radio } from "lucide-react";
import { replay, talkStore } from "../../lib/talk";

/** LANX 3.15.0: a small note at the bottom of the window while a colleague talks on the
 *  walkie-talkie (or when something came in that this PC could not play yet). Clicking
 *  it opens the walkie-talkie on that channel, to answer with one press. */
export function TalkPill({ onOpen }: { onOpen: (channel?: string) => void }) {
  const t = useSyncExternalStore(talkStore.subscribe, talkStore.get, talkStore.get);
  const [, tick] = useState(0);
  const unheard = t.clips.find((c) => !c.heard);
  // (The line about something not heard goes after a while by itself.)
  const fresh = unheard && Date.now() - unheard.at < 10 * 60000 ? unheard : null;
  useEffect(() => {
    if (!fresh) return;
    const id = window.setInterval(() => tick((n) => n + 1), 30000);
    return () => window.clearInterval(id);
  }, [fresh]);

  const talking = t.talking && !t.talking.test ? t.talking : null;
  if (!t.hearing && !talking && !fresh) return null;
  const level = t.hearing?.level ?? talking?.level ?? 0;
  return (
    <div data-talk-pill data-state={t.hearing ? "hearing" : talking ? "talking" : "missed"} className="fixed bottom-6 left-1/2 z-[57] flex -translate-x-1/2 items-center gap-2 rounded-full lanx-sheet py-1.5 pl-2 pr-3 text-[12.5px] lanx-rise">
      <button type="button" data-talk-pill-open onClick={() => onOpen(t.hearing?.channel ?? talking?.channel ?? fresh?.channel)} className="flex items-center gap-2 text-left">
        <span className={`flex h-7 w-7 items-center justify-center rounded-full text-white ${t.hearing ? "bg-emerald-500" : talking ? "bg-rose-500" : "bg-sky-500"}`}>
          <Radio className="h-3.5 w-3.5" />
        </span>
        <span className="max-w-[300px] truncate font-semibold text-slate-800 dark:text-slate-100">
          {t.hearing ? `${t.hearing.fromName} is talking` : talking ? `Talking to ${talking.label}` : `${fresh?.fromName} talked on the walkie-talkie`}
        </span>
        {(t.hearing || talking) && (
          <span aria-hidden className="flex h-4 items-end gap-[2px]">
            {[0.35, 0.7, 1, 0.6, 0.3].map((w, i) => (
              <span key={i} className={`w-[3px] rounded-full ${t.hearing ? "bg-emerald-500" : "bg-rose-500"}`} style={{ height: `${Math.round(4 + level * w * 12)}px`, transition: "height 90ms linear" }} />
            ))}
          </span>
        )}
      </button>
      {!t.hearing && !talking && fresh && (
        <button type="button" data-talk-pill-play onClick={() => replay(fresh.id)} title="Play it" className="flex h-7 items-center gap-1 rounded-full bg-[var(--lanx-fill)] px-2.5 font-semibold text-slate-700 dark:text-slate-200">
          <Play className="h-3 w-3" /> Play
        </button>
      )}
    </div>
  );
}
