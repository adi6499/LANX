import { useMemo, useState } from "react";
import type { BoardProps } from "../boardProps";
import { checkers, checkersMoves } from "../../../lib/games/checkers.ts";

/** Checkers: click a piece, then a square it may go to (a jump shows its landing square). */
export function CheckersBoard({ moves, canPlay, turn, seat, onMove }: BoardProps) {
  const state = useMemo(() => checkers.replay(moves, 2, ""), [moves]);
  const legal = useMemo(() => (state ? checkersMoves(state) : []), [state]);
  const [from, setFrom] = useState<number | null>(null);
  const targets = useMemo(() => legal.filter((m) => Number(m.split("-")[0]) === from), [legal, from]);
  const flip = seat === 1;
  const cells = state?.cells ?? [];
  const canMoveFrom = (i: number) => legal.some((m) => Number(m.split("-")[0]) === i);
  const tap = (i: number) => {
    if (!canPlay) return;
    const piece = cells[i];
    const dest = targets.find((m) => Number(m.split("-").pop()) === i);
    if (dest) {
      setFrom(null);
      onMove(dest);
      return;
    }
    if (piece && piece.p === turn && canMoveFrom(i)) setFrom(from === i ? null : i);
    else setFrom(null);
  };
  const order = Array.from({ length: 64 }, (_, k) => (flip ? 63 - k : k));
  return (
    <div data-game-board="checkers" className="rounded-xl overflow-hidden ring-1 ring-black/20 shadow-lg select-none grid grid-cols-8" style={{ width: 8 * 50 }}>
      {order.map((i) => {
        const r = Math.floor(i / 8);
        const c = i % 8;
        const dark = (r + c) % 2 === 1;
        const piece = cells[i];
        const isTarget = targets.some((m) => Number(m.split("-").pop()) === i);
        const movable = canPlay && !!piece && piece.p === turn && canMoveFrom(i);
        return (
          <button
            key={i}
            type="button"
            data-checkers-square={i}
            onClick={() => tap(i)}
            className={`relative h-[50px] w-[50px] flex items-center justify-center ${dark ? "bg-[#7a5230]" : "bg-[#e9d5b5]"} ${from === i ? "!bg-amber-400" : ""} ${isTarget ? "!bg-emerald-400" : ""} ${canPlay && (movable || isTarget) ? "cursor-pointer" : "cursor-default"}`}
          >
            {piece && (
              <span className={`h-9 w-9 rounded-full shadow-md flex items-center justify-center text-[16px] lanx-pop ${piece.p === 0 ? "bg-rose-600 ring-2 ring-rose-300" : "bg-slate-900 ring-2 ring-slate-500"} ${movable ? "ring-4 ring-amber-300" : ""}`}>
                {piece.king && <span className="text-amber-300">♛</span>}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
