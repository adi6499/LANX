import { useEffect, useMemo, useState } from "react";
import type { BoardProps } from "../boardProps";
import { checkers, checkersMoves, checkersRouteStep } from "../../../lib/games/checkers.ts";

/** LANX 2.17.0: the words under a board while two capture routes reach the same square. */
export const CHECKERS_ROUTE_NOTE = "Two ways to jump there — click the square marked blue to jump through first (or your piece to start again).";

/** Checkers: click a piece, then a square it may go to (a jump shows its landing square).
 *  When two capture routes end on the same square, you click the hops to say which (2.17.0). */
export function CheckersBoard({ moves, canPlay, turn, seat, onMove }: BoardProps) {
  const state = useMemo(() => checkers.replay(moves, 2, ""), [moves]);
  const legal = useMemo(() => (state ? checkersMoves(state) : []), [state]);
  const [from, setFrom] = useState<number | null>(null);
  /** The capture routes still possible after the squares clicked so far (null: no choice to make). */
  const [routes, setRoutes] = useState<string[] | null>(null);
  useEffect(() => {
    setFrom(null);
    setRoutes(null);
  }, [moves.length]);
  const targets = useMemo(() => legal.filter((m) => Number(m.split("-")[0]) === from), [legal, from]);
  const step = useMemo(() => (routes ? checkersRouteStep(routes) : null), [routes]);
  const flip = seat === 1;
  const cells = state?.cells ?? [];
  const canMoveFrom = (i: number) => legal.some((m) => Number(m.split("-")[0]) === i);
  const send = (m: string) => {
    setFrom(null);
    setRoutes(null);
    onMove(m);
  };
  const tap = (i: number) => {
    if (!canPlay) return;
    if (routes && step) {
      if (step.next.includes(i)) {
        const left = routes.filter((m) => Number(m.split("-")[step.path.length]) === i);
        if (left.length === 1) send(left[0]);
        else setRoutes(left);
        return;
      }
      setRoutes(null);
      if (i === from) return;
    }
    const piece = cells[i];
    const ends = targets.filter((m) => Number(m.split("-").pop()) === i);
    if (ends.length === 1) {
      send(ends[0]);
      return;
    }
    if (ends.length > 1) {
      setRoutes(ends);
      return;
    }
    if (piece && piece.p === turn && canMoveFrom(i)) setFrom(from === i ? null : i);
    else setFrom(null);
  };
  const order = Array.from({ length: 64 }, (_, k) => (flip ? 63 - k : k));
  return (
    <div className="flex flex-col items-center gap-2">
      <div data-game-board="checkers" className="rounded-xl overflow-hidden ring-1 ring-black/20 shadow-lg select-none grid grid-cols-8" style={{ width: 8 * 50 }}>
        {order.map((i) => {
          const r = Math.floor(i / 8);
          const c = i % 8;
          const dark = (r + c) % 2 === 1;
          const piece = cells[i];
          const isTarget = !step && targets.some((m) => Number(m.split("-").pop()) === i);
          const isNext = !!step?.next.includes(i);
          const onPath = !!step && step.path.includes(i) && i !== from;
          const isEnd = !!routes && routes.some((m) => Number(m.split("-").pop()) === i) && i !== from;
          const movable = canPlay && !!piece && piece.p === turn && canMoveFrom(i);
          return (
            <button
              key={i}
              type="button"
              data-checkers-square={i}
              data-checkers-next={isNext ? "1" : undefined}
              onClick={() => tap(i)}
              className={`relative h-[50px] w-[50px] flex items-center justify-center ${dark ? "bg-[#7a5230]" : "bg-[#e9d5b5]"} ${from === i ? "!bg-amber-400" : ""} ${isTarget || isEnd ? "!bg-emerald-400" : ""} ${onPath ? "!bg-amber-200" : ""} ${isNext ? "!bg-sky-400" : ""} ${canPlay && (movable || isTarget || isNext) ? "cursor-pointer" : "cursor-default"}`}
            >
              {piece && (
                <span className={`g3-token h-9 w-9 rounded-full shadow-md flex items-center justify-center text-[16px] lanx-pop ${piece.p === 0 ? "bg-rose-600 ring-2 ring-rose-300" : "bg-slate-900 ring-2 ring-slate-500"} ${movable ? "ring-4 ring-amber-300" : ""}`}>
                  {piece.king && <span className="text-amber-300">♛</span>}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {step && (
        <div data-checkers-routes className="max-w-[400px] text-center text-[12px] font-semibold text-slate-700 dark:text-slate-200">
          {CHECKERS_ROUTE_NOTE}
        </div>
      )}
    </div>
  );
}
