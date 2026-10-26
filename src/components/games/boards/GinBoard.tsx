import { useMemo, useState } from "react";
import { seatFor, type BoardProps } from "../boardProps";
import { deadwood, ginrummy } from "../../../lib/games/ginrummy.ts";
import { sortHand } from "../../../lib/games/cards.ts";
import { CardBack, CardFace } from "./CardFace";

/** Gin Rummy: draw (stock or pile), then click a card to discard — or knock. */
export function GinBoard({ moves, canPlay, turn, seat, seats, starter = 0, seed = "", local, onMove }: BoardProps) {
  const state = useMemo(() => ginrummy.replay(moves, 2, seed), [moves, seed]);
  const [knocking, setKnocking] = useState(false);
  if (!state) return null;
  const me = local ? turn : seat;
  const name = (p: number) => seatFor(seats, starter, p, 2).name;
  const hand = sortHand(state.hands[me] ?? []);
  const dw = deadwood(hand);
  const melded = new Set(dw.melds.flat());
  const top = state.discard[state.discard.length - 1];
  const drawing = canPlay && state.phase === "draw";
  const discarding = canPlay && state.phase === "discard";
  const canKnockWith = (c: string) => deadwood(hand.filter((x) => x !== c)).points <= 10;
  const other = 1 - me;
  return (
    <div data-game-board="ginrummy" className="flex w-full max-w-[640px] flex-col items-center gap-3">
      <div className="flex items-center gap-6 text-[12.5px] font-semibold" data-gin-scores>
        <span>
          {name(0)} {state.scores[0]}
        </span>
        <span>
          {name(1)} {state.scores[1]}
        </span>
        <span className="text-slate-500 font-normal">round {state.round}</span>
      </div>
      {!local && (
        <div className="flex items-center gap-2 text-[11.5px] text-slate-500">
          {name(other)}: <CardBack small count={state.hands[other].length} />
        </div>
      )}
      <div className="flex items-center gap-4">
        <button type="button" data-gin-stock disabled={!drawing} onClick={() => onMove("ds")} className={`flex flex-col items-center gap-1 rounded-xl p-1 ${drawing ? "ring-2 ring-indigo-500 cursor-pointer" : ""}`}>
          <CardBack count={state.stock.length} />
          <span className="text-[10.5px] text-slate-500">stock</span>
        </button>
        <button type="button" data-gin-discard disabled={!drawing} onClick={() => onMove("dd")} className={`flex flex-col items-center gap-1 rounded-xl p-1 ${drawing ? "ring-2 ring-indigo-500 cursor-pointer" : ""}`}>
          {top ? <CardFace card={top} /> : <span className="h-16 w-12 rounded-md bg-slate-200" />}
          <span className="text-[10.5px] text-slate-500">discard</span>
        </button>
        {discarding && (
          <button type="button" data-gin-knock-toggle onClick={() => setKnocking((k) => !k)} disabled={!hand.some(canKnockWith)} className={`rounded-full px-4 py-1.5 text-[12.5px] font-semibold ${knocking ? "bg-amber-500 text-white" : "bg-slate-500/10"} disabled:opacity-50`}>
            {knocking ? "Knocking — pick the discard" : "Knock"}
          </button>
        )}
      </div>
      {state.lastKnock && state.log.length > 0 && (
        <div className="text-[11px] text-slate-500" data-gin-log>
          {state.log[state.log.length - 1]}
        </div>
      )}
      <div className="flex flex-col items-center gap-1">
        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
          {local ? `${name(turn)}'s cards` : "Your cards"} · deadwood {dw.points} {drawing ? "— draw first" : discarding ? (knocking ? "— choose the card to discard and knock" : "— click a card to discard") : ""}
        </div>
        <div className="flex flex-wrap justify-center gap-1" data-gin-hand>
          {hand.map((c) => (
            <CardFace key={c} card={c} small lit={melded.has(c)} testId={`hand:${c}`} dim={knocking && !canKnockWith(c)} onClick={discarding && c !== state.tookDiscard && (!knocking || canKnockWith(c)) ? () => { onMove(`${knocking ? "k" : "x"}:${c}`); setKnocking(false); } : undefined} />
          ))}
        </div>
        <div className="text-[10.5px] text-slate-500">Raised cards are in a set or run.</div>
      </div>
    </div>
  );
}
