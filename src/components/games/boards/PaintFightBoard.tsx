import { useMemo } from "react";
import { seatFor, type BoardProps } from "../boardProps";
import { PAINT, paintFight, paintGrid } from "../../../lib/games/paintfight.ts";
import { PartyShell } from "./PartyShell";

/** Paint Fight: tap squares to paint them yours before the clock runs out. */
export function PaintFightBoard({ moves, canPlay, seat, seats, starter = 0, seed = "", host, onMove }: BoardProps) {
  const n = Math.max(2, seats?.length ?? 2);
  const state = useMemo(() => paintFight.replay(moves, n, seed), [moves, n, seed]);
  const grid = useMemo(() => (state ? paintGrid(state.answers) : []), [state]);
  if (!state) return null;
  const colour = (p: number) => seatFor(seats, starter, p, n).color;
  const mine = colour(seat);
  return (
    <PartyShell state={state} rounds={3} seconds={30} host={!!host} seats={seats} starter={starter} n={n} onMove={onMove} testId="paintfight">
      {state.open ? (
        <div className="grid gap-[2px] rounded-xl bg-slate-300 p-[4px] dark:bg-slate-700" style={{ gridTemplateColumns: `repeat(${PAINT}, 26px)` }} data-paint-grid>
          {grid.map((owner, i) => (
            <button
              key={i}
              type="button"
              data-paint-cell={i}
              data-paint-owner={owner >= 0 ? owner : undefined}
              disabled={!canPlay || owner === seat}
              onPointerDown={() => canPlay && owner !== seat && onMove(`${seat}@a:${i}`)}
              className="h-[26px] w-[26px] rounded-[3px] transition-colors"
              style={{ backgroundColor: owner >= 0 ? colour(owner) : "#f8fafc", outline: owner === seat ? `2px solid ${mine}` : undefined }}
            />
          ))}
        </div>
      ) : (
        <div className="text-[13px] text-slate-500">Thirty seconds a round: tap as many squares as you can. The last tap on a square keeps it. Three rounds.</div>
      )}
    </PartyShell>
  );
}
