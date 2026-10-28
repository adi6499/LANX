import { useMemo } from "react";
import { seatFor, type BoardProps } from "../boardProps";
import { mancala, type MancalaState } from "../../../lib/games/mancala.ts";

/** LANX 2.17.0: the stores by person ("Your store", "Sam's store"), never "top" or "bottom". */
export function mancalaStoreLabel(p: number, me: number, name: (p: number) => string) {
  return p === me ? "Your store" : `${name(p)}'s store`;
}

/** What the last move did, in words: an extra turn or a capture (null when it was a plain move). */
export function mancalaNews(s: MancalaState, me: number, name: (p: number) => string): string | null {
  if (s.mover < 0) return null;
  const you = s.mover === me;
  const who = name(s.mover);
  if (s.again && s.turn === s.mover) return you ? "Your last seed landed in your store — go again." : `${who}'s last seed landed in their store — ${who} goes again.`;
  if (s.captured > 0) return you ? `You captured ${s.captured} seeds.` : `${who} captured ${s.captured} seeds.`;
  return null;
}

/** Mancala: your six pits are nearest you; click one to sow its seeds. */
export function MancalaBoard({ moves, canPlay, turn, seat, seats, starter = 0, local, onMove }: BoardProps) {
  const state = useMemo(() => mancala.replay(moves, 2, ""), [moves]);
  if (!state) return null;
  const flip = seat === 1; // my pits at the bottom (in pass & play: the pits of whoever moves)
  const me = local ? -1 : seat;
  const name = (p: number) => seatFor(seats, starter, p, 2).name.split(" (")[0];
  const news = mancalaNews(state, me, name);
  const bottomPlayer = flip ? 1 : 0;
  const topPlayer = 1 - bottomPlayer;
  const pitsOf = (p: number) => (p === 0 ? [0, 1, 2, 3, 4, 5] : [7, 8, 9, 10, 11, 12]);
  const storeOf = (p: number) => (p === 0 ? 6 : 13);
  const Pit = ({ i, owner }: { i: number; owner: number }) => {
    const seeds = state.pits[i];
    const mine = owner === turn && canPlay && seeds > 0;
    return (
      <button
        type="button"
        data-mancala-pit={i}
        data-mancala-seeds={seeds}
        disabled={!mine}
        onClick={() => onMove(String(owner === 0 ? i : i - 7))}
        className={`relative h-16 w-16 rounded-full bg-[#c89b6a] shadow-inner flex items-center justify-center text-[18px] font-bold text-amber-950 ${mine ? "cursor-pointer ring-4 ring-amber-300 hover:bg-[#d7ad7e]" : "cursor-default"} ${state.last === i ? "outline outline-2 outline-emerald-500" : ""}`}
      >
        {seeds}
        <span className="absolute inset-0 flex flex-wrap items-center justify-center gap-[2px] p-3 opacity-40">
          {Array.from({ length: Math.min(seeds, 12) }, (_, k) => (
            <span key={k} className="g3-token h-1.5 w-1.5 rounded-full bg-amber-950" />
          ))}
        </span>
      </button>
    );
  };
  const Store = ({ p }: { p: number }) => (
    <div className="flex flex-col items-center gap-1.5">
      <div data-mancala-store={p} className="h-[150px] w-16 rounded-full bg-[#b58756] shadow-inner flex items-center justify-center text-[22px] font-bold text-amber-950">
        {state.pits[storeOf(p)]}
      </div>
      <div data-mancala-store-label={p} className="max-w-[84px] truncate text-center text-[11px] font-semibold text-amber-100" title={mancalaStoreLabel(p, me, name)}>
        {mancalaStoreLabel(p, me, name)}
      </div>
    </div>
  );
  return (
    <div data-game-board="mancala" className="flex flex-col items-center gap-2">
      <div data-mancala-news className="min-h-[18px] text-[12.5px] font-semibold text-slate-700 dark:text-slate-200">
        {news ?? ""}
      </div>
      <div className="flex items-center gap-3 rounded-[28px] bg-[#8b5a2b] p-4 shadow-lg">
        <Store p={topPlayer} />
        <div className="flex flex-col gap-3">
          <div className="flex gap-3">{[...pitsOf(topPlayer)].reverse().map((i) => <Pit key={i} i={i} owner={topPlayer} />)}</div>
          <div className="flex gap-3">{pitsOf(bottomPlayer).map((i) => <Pit key={i} i={i} owner={bottomPlayer} />)}</div>
        </div>
        <Store p={bottomPlayer} />
      </div>
    </div>
  );
}
