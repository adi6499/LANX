import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Shuffle, Trash2 } from "lucide-react";
import type { BoardProps } from "../boardProps";
import { SEA, SHIPS, answerShot, battleship, canPlace, fleetCells, randomFleet, type Fleet } from "../../../lib/games/battleship.ts";

type Secret = { fleet: Fleet };
const CELL = 30;

function Grid({ title, cells, onCell, testId }: { title: string; cells: (i: number) => { cls: string; text: string; can: boolean }; onCell?: (i: number) => void; testId: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{title}</div>
      <div data-sea-grid={testId} className="grid gap-[2px] rounded-lg bg-sky-900 p-[4px]" style={{ gridTemplateColumns: `repeat(${SEA}, ${CELL}px)` }}>
        {Array.from({ length: SEA * SEA }, (_, i) => {
          const c = cells(i);
          return (
            <button key={i} type="button" data-sea-cell={`${testId}:${i}`} disabled={!c.can} onClick={() => onCell?.(i)} className={`h-[30px] w-[30px] rounded-[3px] flex items-center justify-center text-[14px] ${c.cls} ${c.can ? "cursor-pointer" : "cursor-default"}`}>
              {c.text}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Sea Battle: place your fleet (kept on this PC), then call squares on theirs. */
export function BattleshipBoard({ moves, canPlay, turn, seat, secret, onSecret, onMove }: BoardProps) {
  const state = useMemo(() => battleship.replay(moves, 2, ""), [moves]);
  const fleet: Fleet = ((secret as Secret | undefined)?.fleet ?? []) as Fleet;
  const [horizontal, setHorizontal] = useState(true);
  const answered = useRef<number>(-1);
  const other = 1 - seat;
  const iAmReady = !!state?.ready[seat];
  const bothReady = !!state && state.ready[0] && state.ready[1];
  const myHits = useMemo(() => new Set((state?.known[other] ?? []).map((k, i) => (k === "h" || k === "s" ? i : -1)).filter((i) => i >= 0)), [state, other]);

  // Their shot waits for my answer: look at my fleet and answer at once.
  useEffect(() => {
    if (!state || state.pending < 0 || state.turn !== seat || !canPlay) return;
    if (answered.current === moves.length) return;
    answered.current = moves.length;
    const ans = answerShot(fleet, state.pending, myHits);
    onMove(`a:${state.pending}:${ans}`);
  }, [state, seat, canPlay, fleet, myHits, moves.length, onMove]);

  if (!state) return null;

  // ---- placing
  if (!iAmReady) {
    const placed = fleet.length;
    const nextLen = SHIPS[placed];
    const taken = fleetCells(fleet);
    const place = (i: number) => {
      if (nextLen === undefined) return;
      const cells = canPlace(fleet, i, nextLen, horizontal);
      if (!cells) return;
      onSecret?.({ fleet: [...fleet, { cells, len: nextLen }] });
    };
    return (
      <div data-game-board="battleship" data-sea-phase="place" className="flex flex-col items-center gap-3">
        <div className="text-[13px] font-semibold">{nextLen ? `Place your ship of ${nextLen} (${placed + 1} of ${SHIPS.length})` : "Fleet placed — press Ready"}</div>
        <Grid
          testId="mine"
          title="Your sea"
          cells={(i) => ({ cls: taken.has(i) ? "bg-slate-700 text-white" : "bg-sky-500/70 hover:bg-sky-400", text: taken.has(i) ? "▣" : "", can: nextLen !== undefined && !taken.has(i) })}
          onCell={place}
        />
        <div className="flex flex-wrap items-center justify-center gap-1.5 text-[12px]">
          <button type="button" data-sea-rotate onClick={() => setHorizontal((h) => !h)} className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 px-3 py-1.5 font-semibold">
            <RefreshCw className="h-3.5 w-3.5" /> {horizontal ? "Across" : "Down"}
          </button>
          <button type="button" data-sea-random onClick={() => onSecret?.({ fleet: randomFleet(Date.now() & 0xffffffff) })} className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 px-3 py-1.5 font-semibold">
            <Shuffle className="h-3.5 w-3.5" /> Place for me
          </button>
          <button type="button" data-sea-clear onClick={() => onSecret?.({ fleet: [] })} className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 px-3 py-1.5 font-semibold">
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </button>
          <button type="button" data-sea-ready disabled={fleet.length !== SHIPS.length || !canPlay} onClick={() => onMove(`${seat}@ready`)} className="inline-flex items-center gap-1 rounded-full bg-indigo-600 px-4 py-1.5 font-semibold text-white disabled:opacity-50">
            Ready
          </button>
        </div>
      </div>
    );
  }

  if (!bothReady) {
    return (
      <div data-game-board="battleship" data-sea-phase="wait" className="flex flex-col items-center gap-2 text-[13px]">
        <div className="font-semibold">Your fleet is in place.</div>
        <div className="text-slate-500">Waiting for the other captain to place theirs…</div>
      </div>
    );
  }

  // ---- firing
  const myTurnToFire = canPlay && turn === seat && state.pending < 0;
  const theirKnown = state.known[seat];
  const mineKnown = state.known[other];
  const taken = fleetCells(fleet);
  return (
    <div data-game-board="battleship" data-sea-phase="fire" className="flex flex-wrap items-start justify-center gap-5">
      <Grid
        testId="theirs"
        title={myTurnToFire ? "Their sea — call a square" : "Their sea"}
        cells={(i) => {
          const k = theirKnown[i];
          return { cls: k === "s" ? "bg-red-600 text-white" : k === "h" ? "bg-orange-500 text-white" : k === "m" ? "bg-sky-800 text-sky-200" : myTurnToFire ? "bg-sky-500/70 hover:bg-sky-400" : "bg-sky-500/70", text: k === "m" ? "•" : k ? "✕" : "", can: myTurnToFire && !k };
        }}
        onCell={(i) => onMove(`f:${i}`)}
      />
      <Grid
        testId="mine"
        title="Your sea"
        cells={(i) => {
          const k = mineKnown[i];
          const ship = taken.has(i);
          return { cls: k === "s" ? "bg-red-600 text-white" : k === "h" ? "bg-orange-500 text-white" : k === "m" ? "bg-sky-800 text-sky-200" : ship ? "bg-slate-700 text-white" : "bg-sky-500/70", text: k === "m" ? "•" : k ? "✕" : ship ? "▣" : "", can: false };
        }}
      />
    </div>
  );
}
