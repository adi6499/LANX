import { useMemo, useState } from "react";
import { namesIn, seatFor, type BoardProps } from "../boardProps";
import { gofish } from "../../../lib/games/gofish.ts";
import { RANK_NAME, RANKS, rankOf, sortHand } from "../../../lib/games/cards.ts";
import { CardBack, CardFace, OtherHands } from "./CardFace";

/** Go Fish: pick a rank you hold, then who to ask. */
export function GoFishBoard({ moves, canPlay, turn, seat, seats, starter = 0, seed = "", local, onMove }: BoardProps) {
  const n = Math.max(2, seats?.length ?? 2);
  const state = useMemo(() => gofish.replay(moves, n, seed), [moves, n, seed]);
  const [rank, setRank] = useState<string | null>(null);
  if (!state) return null;
  const me = local ? turn : seat;
  const hand = sortHand(state.hands[me] ?? []);
  const name = (p: number) => seatFor(seats, starter, p, n).name;
  const colour = (p: number) => seatFor(seats, starter, p, n).color;
  const ranksHeld = RANKS.filter((r) => hand.some((c) => rankOf(c) === r));
  return (
    <div data-game-board="gofish" className="flex w-full max-w-[600px] flex-col items-center gap-3">
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[12.5px] font-semibold" data-gofish-books>
        {state.books.map((b, p) => (
          <span key={p} className="inline-flex items-center gap-1.5">
            <span className="g3-token h-3.5 w-3.5 rounded-full" style={{ backgroundColor: colour(p) }} /> {b} {b === 1 ? "book" : "books"}
          </span>
        ))}
        <span className="inline-flex items-center gap-1 text-slate-500 font-normal">
          <CardBack small count={state.stock.length} /> stock
        </span>
      </div>
      <OtherHands counts={state.hands.map((h) => h.length)} names={name} colours={colour} turn={turn} exclude={local ? undefined : me} gone={state.gone} />
      {state.event && (
        <div className="rounded-full bg-sky-500/15 px-3 py-1 text-[12px] text-sky-800 dark:text-sky-200" data-gofish-event>
          {namesIn(state.event, seats, starter, n)}
        </div>
      )}
      {canPlay && (
        <div className="flex flex-col items-center gap-2 text-[12.5px]" data-gofish-ask>
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <span>Ask for:</span>
            {ranksHeld.map((r) => (
              <button key={r} type="button" data-gofish-rank={r} onClick={() => setRank(rank === r ? null : r)} className={`h-8 min-w-8 rounded-full px-2 text-[13px] font-bold ${rank === r ? "bg-indigo-600 text-white" : "bg-white text-slate-900 shadow ring-1 ring-black/20"}`}>
                {RANK_NAME[r] ?? r}
              </button>
            ))}
          </div>
          {rank && (
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              <span>from:</span>
              {state.hands.map((h, p) =>
                p === me || h.length === 0 || state.gone[p] ? null : (
                  <button key={p} type="button" data-gofish-ask-player={p} onClick={() => { onMove(`a:${p}:${rank}`); setRank(null); }} className="rounded-full bg-indigo-600 px-3 py-1 font-semibold text-white">
                    {name(p)}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      )}
      <div className="flex flex-col items-center gap-1">
        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{local ? `${name(turn)}'s cards` : "Your cards"}</div>
        <div className="flex flex-wrap justify-center gap-1.5" data-gofish-hand>
          {hand.map((c) => (
            <CardFace key={c} card={c} small lit={rank !== null && rankOf(c) === rank} testId={`hand:${c}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
