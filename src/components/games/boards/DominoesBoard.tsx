import { useMemo, useState } from "react";
import { namesIn, seatFor, type BoardProps } from "../boardProps";
import { dominoPlayable, dominoes, type Tile } from "../../../lib/games/dominoes.ts";

const PIPS = ["", "•", "••", "•••", "••••", "•••••", "••••••"];

function TileView({ t, horizontal, lit, onClick, testId }: { t: Tile; horizontal: boolean; lit?: boolean; onClick?: () => void; testId?: string }) {
  const Half = ({ v }: { v: number }) => (
    <span className={`flex items-center justify-center ${horizontal ? "h-9 w-9" : "h-9 w-9"} text-[11px] leading-[11px] tracking-[-1px] text-slate-900 ${v === 0 ? "" : ""}`} style={{ wordBreak: "break-all", padding: 3, textAlign: "center" }}>
      {PIPS[v]}
    </span>
  );
  return (
    <button type="button" data-domino={testId} onClick={onClick} disabled={!onClick} className={`inline-flex ${horizontal ? "flex-row" : "flex-col"} rounded-md bg-amber-50 shadow ring-1 ring-black/20 ${lit ? "ring-2 ring-indigo-500 -translate-y-1" : ""} ${onClick ? "cursor-pointer hover:bg-white" : "cursor-default"} overflow-hidden`}>
      <Half v={t[0]} />
      <span className={horizontal ? "w-px bg-slate-400 self-stretch" : "h-px bg-slate-400 self-stretch"} />
      <Half v={t[1]} />
    </button>
  );
}

/** Dominoes: click a tile from your hand, then (if both ends fit) which end. */
export function DominoesBoard({ moves, canPlay, turn, seat, seats, starter = 0, seed = "", local, onMove }: BoardProps) {
  const n = Math.max(2, Math.min(4, seats?.length ?? 2));
  const state = useMemo(() => dominoes.replay(moves, n, seed), [moves, n, seed]);
  const [pick, setPick] = useState<Tile | null>(null);
  if (!state) return null;
  const colour = (p: number) => seatFor(seats, starter, p, n).color;
  const name = (p: number) => seatFor(seats, starter, p, n).name.split(" (")[0];
  const me = local ? turn : seat;
  const hand = state.hands[me] ?? [];
  const playable = canPlay ? dominoPlayable(state, hand) : [];
  const endsFor = (t: Tile) => playable.filter((p) => p.tile === t).map((p) => p.end);
  const play = (t: Tile, end: "l" | "r") => {
    setPick(null);
    onMove(`p:${t[0]}-${t[1]}:${end}`);
  };
  const choose = (t: Tile) => {
    const ends = endsFor(t);
    if (!ends.length) return;
    if (ends.length === 1 || !state.line.length) play(t, ends[0]);
    else setPick(pick === t ? null : t);
  };
  return (
    <div data-game-board="dominoes" className="flex w-full max-w-[560px] flex-col items-center gap-3">
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[12.5px] font-semibold" data-domino-hands>
        {state.hands.map((h, p) => (
          <span key={p} className={`inline-flex items-center gap-1.5 ${p === turn && state.winner === null ? "underline decoration-2 underline-offset-4" : ""} ${state.out[p] ? "line-through opacity-50" : ""}`}>
            <span className="h-3.5 w-3.5 rounded-sm" style={{ backgroundColor: colour(p) }} /> {name(p)} {state.out[p] ? "left" : `${h.length} tiles`}
          </span>
        ))}
      </div>
      <div data-domino-line className="flex min-h-[48px] w-full flex-wrap items-center justify-center gap-1 rounded-2xl bg-emerald-800 p-3">
        {state.line.length === 0 && (
          <span className="text-[12px] text-emerald-100" data-domino-lead>
            {name(state.turn)} has the {state.lead[0] === state.lead[1] ? "highest double" : "heaviest tile"} and sets {state.lead[0]}-{state.lead[1]} to start.
          </span>
        )}
        {state.line.map((t, i) => (
          <TileView key={i} t={t} horizontal lit={false} testId={`line:${i}`} />
        ))}
      </div>
      {state.event && (
        <div className="text-[12px] text-slate-600 dark:text-slate-300" data-domino-event>
          {namesIn(state.event, seats, starter, n)}
        </div>
      )}
      {pick && (
        <div className="flex items-center gap-2 text-[12px]" data-domino-ends>
          <span>Put {pick[0]}-{pick[1]} on the</span>
          <button type="button" data-domino-end="l" onClick={() => play(pick, "l")} className="rounded-full bg-indigo-600 px-3 py-1 font-semibold text-white">
            ← left
          </button>
          <button type="button" data-domino-end="r" onClick={() => play(pick, "r")} className="rounded-full bg-indigo-600 px-3 py-1 font-semibold text-white">
            right →
          </button>
        </div>
      )}
      <div className="flex flex-col items-center gap-1">
        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{local ? `${name(turn)}'s tiles` : "Your tiles"}</div>
        <div data-domino-hand className="flex flex-wrap justify-center gap-1.5">
          {hand.map((t, i) => {
            const ok = endsFor(t).length > 0;
            return <TileView key={i} t={t} horizontal={false} lit={pick === t} onClick={ok ? () => choose(t) : undefined} testId={`hand:${t[0]}-${t[1]}`} />;
          })}
        </div>
      </div>
      {canPlay && playable.length === 0 && state.winner === null && (
        <button type="button" data-domino-pass onClick={() => onMove("x")} className="rounded-full bg-amber-500 px-4 py-1.5 text-[12.5px] font-semibold text-white hover:bg-amber-600">
          Nothing fits — pass
        </button>
      )}
    </div>
  );
}
