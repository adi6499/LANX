import { useEffect, useState } from "react";
import type { Sticker } from "../../types";
import { api } from "../../lib/api";

/** LANX 1.7.0: built-in stickers (the same list in every copy of LANX). */
let cache: Sticker[] | null = null;
export function useStickers(): Sticker[] {
  const [list, setList] = useState<Sticker[]>(cache ?? []);
  useEffect(() => {
    if (cache) return;
    api
      .listStickers()
      .then((l) => {
        cache = l;
        setList(l);
      })
      .catch(() => {});
  }, []);
  return list;
}

export function StickerPicker({ onPick }: { onPick: (id: string) => void }) {
  const stickers = useStickers();
  return (
    <div data-sticker-picker className="px-5 pt-2 grid grid-cols-8 gap-1 lanx-screen-in">
      {stickers.map((s) => (
        <button
          key={s.id}
          type="button"
          data-sticker={s.id}
          title={s.words}
          onClick={() => onPick(s.id)}
          className="group flex flex-col items-center gap-0.5 rounded-xl py-1.5 hover:bg-[var(--lanx-fill)] transition-transform active:scale-90"
        >
          <span className="text-[26px] leading-none transition-transform group-hover:scale-125 group-hover:-rotate-6">{s.emoji}</span>
          <span className="text-[9.5px] font-semibold text-slate-500 dark:text-slate-400 truncate max-w-full px-0.5">{s.words}</span>
        </button>
      ))}
    </div>
  );
}

/** A sticker in a chat. */
export function StickerBubble({ id, isOut }: { id: string; isOut: boolean }) {
  const stickers = useStickers();
  const s = stickers.find((x) => x.id === id);
  return (
    <div data-sticker-msg={id} className={`lanx-sticker-in flex flex-col ${isOut ? "items-end" : "items-start"} px-1`}>
      <span className="text-[64px] leading-none drop-shadow-[0_4px_10px_rgb(0_0_0/0.18)]">{s?.emoji ?? "💬"}</span>
      <span className="mt-1 rounded-full bg-[color-mix(in_srgb,var(--lanx-surface)_80%,transparent)] px-2.5 py-0.5 text-[11.5px] font-bold text-slate-700 dark:text-slate-200 shadow-sm">
        {s?.words ?? "Sticker"}
      </span>
    </div>
  );
}
