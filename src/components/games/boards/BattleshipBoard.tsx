import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Shuffle, Trash2 } from "lucide-react";
import { seatFor, type BoardProps } from "../boardProps";
import { SEA, SHIPS, afloat, answerShot, battleship, canPlace, fleetCells, placeProblem, randomFleet, shipName, type BattleshipState, type Fleet } from "../../../lib/games/battleship.ts";

type Secret = { fleet: Fleet };
const CELL = 30;

// ---------------------------------------------------------------- words both boards (flat and 3D) use (2.17.0)

/** Why a ship can't go where it was clicked. */
export const placeHint = (why: "edge" | "touch") => (why === "touch" ? "Ships can't touch, not even at the corners." : "That ship doesn't fit there — it would stick out past the edge. Try another square, or turn it (Across / Down).");

/** This PC is marked ready but has no fleet (it was lost): no answer would be true, so none is given. */
export const LOST_FLEET = "Your fleet isn't on this PC any more, so their shots can't be answered and this game can't go on. Press Leave game, then start a new match.";

/** What the last shot did, for this player: "You sank Sam's Cruiser!", "Sam missed." … */
export function seaNews(s: BattleshipState, moves: string[], seat: number, name: (p: number) => string): string | null {
  const a = /^a:\d+:([mhs])/.exec(moves[moves.length - 1] ?? "");
  if (!a) return null;
  const mine = s.shooter === seat;
  const other = name(1 - seat);
  if (a[1] === "s") {
    const ship = shipName(s.lastSunk?.ship ?? -1);
    return mine ? `You sank ${other}'s ${ship}!` : `${other} sank your ${ship}.`;
  }
  if (a[1] === "h") return mine ? "Hit! Their turn to fire." : `${other} hit one of your ships. Your turn to fire.`;
  return mine ? "Miss. Their turn to fire." : `${other} missed. Your turn to fire.`;
}

/** The five ships of one side, the sunk ones struck through. `sunkBy` is the player who has been sinking them. */
export function FleetList({ s, sunkBy, title }: { s: BattleshipState; sunkBy: number; title: string }) {
  const left = new Set(afloat(s, sunkBy));
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-[11.5px]" data-sea-fleet={title}>
      <span className="font-semibold text-slate-500">{title}</span>
      {SHIPS.map((len, k) => (
        <span key={k} data-sea-ship={k} data-sea-sunk={left.has(k) ? undefined : "1"} className={left.has(k) ? "text-slate-700 dark:text-slate-200" : "text-slate-400 line-through"}>
          {shipName(k)} {len}
        </span>
      ))}
    </div>
  );
}

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
export function BattleshipBoard({ moves, canPlay, turn, seat, seats, starter = 0, secret, onSecret, onMove }: BoardProps) {
  const state = useMemo(() => battleship.replay(moves, 2, ""), [moves]);
  const fleet: Fleet = ((secret as Secret | undefined)?.fleet ?? []) as Fleet;
  const [horizontal, setHorizontal] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  const answered = useRef<number>(-1);
  const other = 1 - seat;
  const iAmReady = !!state?.ready[seat];
  const bothReady = !!state && state.ready[0] && state.ready[1];
  // LANX 2.17.0: ready, but the fleet is gone from this PC — never answer "miss" for a sea we can't see.
  const lost = iAmReady && fleet.length !== SHIPS.length;
  const myHits = useMemo(() => new Set((state?.known[other] ?? []).map((k, i) => (k === "h" || k === "s" ? i : -1)).filter((i) => i >= 0)), [state, other]);
  const name = (p: number) => seatFor(seats, starter, p, 2).name.split(" (")[0];

  // Their shot waits for my answer: look at my fleet and answer at once.
  useEffect(() => {
    if (!state || state.pending < 0 || state.turn !== seat || !canPlay || lost) return;
    if (answered.current === moves.length) return;
    answered.current = moves.length;
    const ans = answerShot(fleet, state.pending, myHits);
    onMove(`a:${state.pending}:${ans}`);
  }, [state, seat, canPlay, fleet, myHits, moves.length, onMove, lost]);

  if (!state) return null;

  // ---- placing
  if (!iAmReady) {
    const placed = fleet.length;
    const nextLen = SHIPS[placed];
    const taken = fleetCells(fleet);
    const place = (i: number) => {
      if (nextLen === undefined) return;
      const why = placeProblem(fleet, i, nextLen, horizontal);
      if (why) {
        setHint(placeHint(why));
        return;
      }
      const cells = canPlace(fleet, i, nextLen, horizontal);
      if (!cells) return;
      setHint(null);
      onSecret?.({ fleet: [...fleet, { cells, len: nextLen }] });
    };
    return (
      <div data-game-board="battleship" data-sea-phase="place" className="flex flex-col items-center gap-3">
        <div className="text-[13px] font-semibold">{nextLen ? `Place your ${shipName(placed)} — ${nextLen} squares (${placed + 1} of ${SHIPS.length})` : "Fleet placed — press Ready"}</div>
        <Grid
          testId="mine"
          title="Your sea"
          cells={(i) => ({ cls: taken.has(i) ? "bg-slate-700 text-white" : "bg-sky-500/70 hover:bg-sky-400", text: taken.has(i) ? "▣" : "", can: nextLen !== undefined && !taken.has(i) })}
          onCell={place}
        />
        <div data-sea-hint className="min-h-[18px] text-center text-[12px] font-semibold text-amber-700 dark:text-amber-300">
          {hint ?? ""}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-1.5 text-[12px]">
          <button
            type="button"
            data-sea-rotate
            onClick={() => {
              setHint(null);
              setHorizontal((h) => !h);
            }}
            className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 px-3 py-1.5 font-semibold"
          >
            <RefreshCw className="h-3.5 w-3.5" /> {horizontal ? "Across" : "Down"}
          </button>
          <button
            type="button"
            data-sea-random
            onClick={() => {
              setHint(null);
              onSecret?.({ fleet: randomFleet(Date.now() & 0xffffffff) });
            }}
            className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 px-3 py-1.5 font-semibold"
          >
            <Shuffle className="h-3.5 w-3.5" /> Place for me
          </button>
          <button
            type="button"
            data-sea-clear
            onClick={() => {
              setHint(null);
              onSecret?.({ fleet: [] });
            }}
            className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 px-3 py-1.5 font-semibold"
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </button>
          <button type="button" data-sea-ready disabled={fleet.length !== SHIPS.length || !canPlay} onClick={() => onMove(`${seat}@ready`)} className="inline-flex items-center gap-1 rounded-full bg-indigo-600 px-4 py-1.5 font-semibold text-white disabled:opacity-50">
            Ready
          </button>
        </div>
      </div>
    );
  }

  if (lost) {
    return (
      <div data-game-board="battleship" data-sea-phase={bothReady ? "fire" : "wait"} data-sea-lost className="flex max-w-[420px] flex-col items-center gap-2 text-center text-[13px]">
        <div className="font-semibold text-rose-700 dark:text-rose-300">Your fleet was lost</div>
        <div className="text-slate-600 dark:text-slate-300">{LOST_FLEET}</div>
      </div>
    );
  }

  if (!bothReady) {
    return (
      <div data-game-board="battleship" data-sea-phase="wait" className="flex flex-col items-center gap-2 text-[13px]">
        <div className="font-semibold">Your fleet is in place.</div>
        <div className="text-slate-500">Waiting for {name(other)} to place theirs…</div>
      </div>
    );
  }

  // ---- firing
  const myTurnToFire = canPlay && turn === seat && state.pending < 0;
  const theirKnown = state.known[seat];
  const mineKnown = state.known[other];
  const taken = fleetCells(fleet);
  const news = seaNews(state, moves, seat, name);
  const cls = (k: string, idle: string) => (k === "s" ? "bg-red-700 text-white" : k === "h" ? "bg-orange-500 text-white" : k === "m" ? "bg-sky-800 text-sky-200" : idle);
  return (
    <div data-game-board="battleship" data-sea-phase="fire" className="flex flex-col items-center gap-2">
      <div data-sea-news className="min-h-[18px] text-[13px] font-semibold text-slate-700 dark:text-slate-200">
        {news ?? ""}
      </div>
      <div className="flex flex-wrap items-start justify-center gap-5">
        <div className="flex flex-col items-center gap-1.5">
          <Grid
            testId="theirs"
            title={myTurnToFire ? `${name(other)}'s sea — call a square` : `${name(other)}'s sea`}
            cells={(i) => {
              const k = theirKnown[i];
              return { cls: cls(k, myTurnToFire ? "bg-sky-500/70 hover:bg-sky-400" : "bg-sky-500/70"), text: k === "m" ? "•" : k ? "✕" : "", can: myTurnToFire && !k };
            }}
            onCell={(i) => onMove(`f:${i}`)}
          />
          <FleetList s={state} sunkBy={seat} title="Their ships:" />
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <Grid
            testId="mine"
            title="Your sea"
            cells={(i) => {
              const k = mineKnown[i];
              const ship = taken.has(i);
              return { cls: cls(k, ship ? "bg-slate-700 text-white" : "bg-sky-500/70"), text: k === "m" ? "•" : k ? "✕" : ship ? "▣" : "", can: false };
            }}
          />
          <FleetList s={state} sunkBy={other} title="Your ships:" />
        </div>
      </div>
    </div>
  );
}
