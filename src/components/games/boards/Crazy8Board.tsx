import { useMemo, useState } from "react";
import { seatFor, type BoardProps } from "../boardProps";
import { crazy8, crazy8Playable } from "../../../lib/games/crazy8.ts";
import { SUIT_SYMBOL, rankOf, sortHand } from "../../../lib/games/cards.ts";
import { CardBack, CardFace, OtherHands } from "./CardFace";

/** Crazy Eights: click a card that matches; an eight asks for a suit. */
export function Crazy8Board({ moves, canPlay, turn, seat, seats, starter = 0, seed = "", local, onMove }: BoardProps) {
  const n = Math.max(2, seats?.length ?? 2);
  const state = useMemo(() => crazy8.replay(moves, n, seed), [moves, n, seed]);
  const [eight, setEight] = useState<string | null>(null);
  if (!state) return null;
  const me = local ? turn : seat;
  const hand = sortHand(state.hands[me] ?? []);
  const top = state.pile[state.pile.length - 1];
  const stuck = canPlay && !hand.some((c) => crazy8Playable(state, c));
  const name = (p: number) => seatFor(seats, starter, p, n).name;
  const colour = (p: number) => seatFor(seats, starter, p, n).color;
  return (
    <div data-game-board="crazy8" className="flex w-full max-w-[600px] flex-col items-center gap-3">
      <OtherHands counts={state.hands.map((h) => h.length)} names={name} colours={colour} turn={turn} exclude={local ? undefined : me} />
      <div className="flex items-center gap-4">
        <div className="flex flex-col items-center gap-1">
          <CardBack count={state.stock.length} />
          <span className="text-[10.5px] text-slate-500">stock</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <CardFace card={top} testId={`pile:${top}`} />
          <span className="text-[10.5px] text-slate-500" data-crazy8-suit>
            suit {SUIT_SYMBOL[state.suit]}
          </span>
        </div>
        {stuck && state.stock.length > 0 && (
          <button type="button" data-crazy8-draw onClick={() => onMove("d")} className="rounded-full bg-indigo-600 px-4 py-1.5 text-[12.5px] font-semibold text-white">
            Draw a card
          </button>
        )}
        {stuck && state.stock.length === 0 && (
          <button type="button" data-crazy8-pass onClick={() => onMove("x")} className="rounded-full bg-amber-500 px-4 py-1.5 text-[12.5px] font-semibold text-white">
            Pass
          </button>
        )}
      </div>
      {eight && (
        <div className="flex items-center gap-2 text-[12.5px]" data-crazy8-pick-suit>
          <span>Name the suit:</span>
          {["S", "H", "D", "C"].map((s) => (
            <button key={s} type="button" data-crazy8-suit-pick={s} onClick={() => { onMove(`p:${eight}:${s}`); setEight(null); }} className={`h-8 w-8 rounded-full bg-white text-[18px] shadow ring-1 ring-black/20 ${s === "H" || s === "D" ? "text-rose-600" : "text-slate-900"}`}>
              {SUIT_SYMBOL[s]}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-col items-center gap-1">
        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{local ? `${name(turn)}'s cards` : "Your cards"}</div>
        <div className="flex flex-wrap justify-center gap-1.5" data-crazy8-hand>
          {hand.map((c) => {
            const ok = canPlay && crazy8Playable(state, c);
            return <CardFace key={c} card={c} testId={`hand:${c}`} dim={canPlay && !ok} onClick={ok ? () => (rankOf(c) === "8" ? setEight(c) : onMove(`p:${c}`)) : undefined} />;
          })}
        </div>
      </div>
    </div>
  );
}
