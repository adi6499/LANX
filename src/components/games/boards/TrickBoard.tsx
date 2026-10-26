import { useMemo } from "react";
import { seatFor, type BoardProps } from "../boardProps";
import { TRICK_RULES, euchre, hearts, spades, trickPlayable, type TrickState } from "../../../lib/games/tricks.ts";
import { SUIT_SYMBOL, sortHand } from "../../../lib/games/cards.ts";
import { CardBack, CardFace } from "./CardFace";

/** Hearts, Spades and Euchre share this table: four seats, a trick in the middle, your hand below. */
function TrickTable({ game, moves, canPlay, turn, seat, seats, starter = 0, seed = "", local, onMove }: BoardProps & { game: "hearts" | "spades" | "euchre" }) {
  const def = game === "hearts" ? hearts : game === "spades" ? spades : euchre;
  const rules = TRICK_RULES[game];
  const state = useMemo(() => def.replay(moves, 4, seed) as TrickState | null, [def, moves, seed]);
  if (!state) return null;
  const me = local ? turn : seat;
  const name = (p: number) => seatFor(seats, starter, p, 4).name;
  const colour = (p: number) => seatFor(seats, starter, p, 4).color;
  const hand = sortHand(state.hands[me] ?? []);
  const playable = canPlay && state.phase === 2 ? trickPlayable(state, me, rules) : [];
  const bidding = state.phase === 0 && game === "spades";
  const ordering = state.phase === 0 && game === "euchre";
  const naming = state.phase === 1 && game === "euchre";
  const tricks = state.trick.length ? state.trick : state.lastTrick;
  const seatBox = (p: number) => (
    <div key={p} data-trick-seat={p} className={`flex min-w-[120px] flex-col items-center gap-1 rounded-xl px-2 py-1 ${p === turn && state.phase === 2 ? "bg-indigo-500/10 ring-1 ring-indigo-500/40" : ""}`}>
      <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colour(p) }} /> {name(p)}
        {game !== "hearts" && <span className="text-slate-400 font-normal">· team {p % 2 === 0 ? "1+3" : "2+4"}</span>}
      </span>
      <span className="text-[11px] text-slate-500">
        {state.won[p]} tricks{game === "spades" && state.bids[p] >= 0 ? ` · bid ${state.bids[p] === 0 ? "nil" : state.bids[p]}` : ""} · {state.scores[p]} pts
      </span>
      {p !== me || local ? <CardBack small count={state.hands[p]?.length ?? 0} /> : null}
    </div>
  );
  return (
    <div data-game-board={game} className="flex w-full max-w-[680px] flex-col items-center gap-3">
      <div className="flex flex-wrap justify-center gap-2">{[0, 1, 2, 3].map(seatBox)}</div>
      <div className="flex min-h-[80px] items-center justify-center gap-2 rounded-2xl bg-emerald-800 px-4 py-2" data-trick-table>
        {game === "euchre" && (
          <span className="mr-2 text-[12px] font-semibold text-emerald-100" data-euchre-trump>
            {state.trump ? `trump ${SUIT_SYMBOL[state.trump]}` : state.upcard ? `turned up: ${state.upcard}` : ""}
          </span>
        )}
        {tricks.map((t) => (
          <div key={t.player} className="flex flex-col items-center gap-0.5">
            <CardFace card={t.card} small testId={`trick:${t.card}`} />
            <span className="text-[10px] text-emerald-100">{name(t.player)}</span>
          </div>
        ))}
        {!tricks.length && <span className="text-[12px] text-emerald-100">{bidding ? "Bidding…" : ordering || naming ? "Choosing trump…" : "Lead a card"}</span>}
      </div>
      {bidding && canPlay && (
        <div className="flex flex-wrap items-center justify-center gap-1.5 text-[12.5px]" data-spades-bid>
          <span>Your bid:</span>
          {Array.from({ length: 14 }, (_, k) => (
            <button key={k} type="button" data-spades-bid-n={k} onClick={() => onMove(`b:${k}`)} className="h-8 min-w-8 rounded-full bg-white px-2 text-[12.5px] font-bold text-slate-900 shadow ring-1 ring-black/20 hover:bg-indigo-600 hover:text-white">
              {k === 0 ? "nil" : k}
            </button>
          ))}
        </div>
      )}
      {ordering && canPlay && (
        <div className="flex items-center gap-2 text-[12.5px]" data-euchre-order>
          <button type="button" data-euchre-orderup onClick={() => onMove("o")} className="rounded-full bg-indigo-600 px-4 py-1.5 font-semibold text-white">
            Order it up ({state.upcard && SUIT_SYMBOL[state.upcard[1]]})
          </button>
          <button type="button" data-euchre-pass onClick={() => onMove("x")} className="rounded-full bg-slate-500/10 px-4 py-1.5 font-semibold">
            Pass
          </button>
        </div>
      )}
      {naming && canPlay && (
        <div className="flex items-center gap-2 text-[12.5px]" data-euchre-name>
          <span>Name trump:</span>
          {["S", "H", "D", "C"].filter((s) => !state.upcard || s !== state.upcard[1]).map((s) => (
            <button key={s} type="button" data-euchre-trump-pick={s} onClick={() => onMove(`t:${s}`)} className={`h-8 w-8 rounded-full bg-white text-[18px] shadow ring-1 ring-black/20 ${s === "H" || s === "D" ? "text-rose-600" : "text-slate-900"}`}>
              {SUIT_SYMBOL[s]}
            </button>
          ))}
          <button type="button" data-euchre-pass onClick={() => onMove("x")} className="rounded-full bg-slate-500/10 px-4 py-1.5 font-semibold">
            Pass
          </button>
        </div>
      )}
      <div className="flex flex-col items-center gap-1">
        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{local ? `${name(turn)}'s cards` : "Your cards"}</div>
        <div className="flex flex-wrap justify-center gap-1" data-trick-hand>
          {hand.map((c) => {
            const ok = playable.includes(c);
            return <CardFace key={c} card={c} small testId={`hand:${c}`} dim={canPlay && state.phase === 2 && !ok} onClick={ok ? () => onMove(`p:${c}`) : undefined} />;
          })}
        </div>
      </div>
      {state.log.length > 0 && (
        <div className="text-[11px] text-slate-500" data-trick-log>
          {state.log[state.log.length - 1]}
        </div>
      )}
    </div>
  );
}

export const HeartsBoard = (p: BoardProps) => <TrickTable {...p} game="hearts" />;
export const SpadesBoard = (p: BoardProps) => <TrickTable {...p} game="spades" />;
export const EuchreBoard = (p: BoardProps) => <TrickTable {...p} game="euchre" />;
