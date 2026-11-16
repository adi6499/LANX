// LANX 2.9.0: the games you play alone — 2048, Snake and Minesweeper. Each
// keeps its own state and reports a finished game's score to the scoreboard.
// LANX 3.18.0 (Sprint 3): the rules are in lib/games/solo2048.ts, soloSnake.ts and soloMines.ts
// (tested there); Snake and Minesweeper are played by soloHooks.ts, shared with the 3D boards.

import { sfx } from "../../lib/gameSounds";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Flag, Pause, Play, RotateCcw } from "lucide-react";

export interface SoloProps {
  /** A game ended with this score (higher is better unless the game says otherwise). */
  onScore: (score: number) => void;
}

const btn = "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors active:scale-95";

/** LANX 3.16.0: a score also counts when you leave a game you had begun. (It was saved only at
 *  "game over": close the games window in the middle of your best game ever, and it was gone.)
 *  `reported` is the board's own "this game's score is in" mark.
 *  (2048 no longer needs it: since 3.18.0 its game in play is kept instead.) */
export function useScoreOnLeave(score: number, onScore: (score: number) => void, reported: { current: boolean }) {
  const last = useRef({ score, onScore });
  last.current = { score, onScore };
  useEffect(
    () => () => {
      if (reported.current || last.current.score <= 0) return;
      reported.current = true;
      last.current.onScore(last.current.score);
    },
    [reported],
  );
}

// ---------------------------------------------------------------- 2048

// LANX 3.16.0: the moves themselves live in lib/games/solo2048.ts (tested there).
import { type Grid, type Saved2048, addTile, canMove, empty, keep2048, load2048, move2048, topTile } from "../../lib/games/solo2048";
export { type Grid, type Saved2048, addTile, canMove, empty, keep2048, load2048, move2048, slideRow, topTile } from "../../lib/games/solo2048";

export const TILE: Record<number, string> = {
  2: "bg-slate-100 text-slate-700",
  4: "bg-amber-100 text-slate-700",
  8: "bg-orange-300 text-white",
  16: "bg-orange-400 text-white",
  32: "bg-orange-500 text-white",
  64: "bg-red-500 text-white",
  128: "bg-yellow-400 text-white",
  256: "bg-yellow-500 text-white",
  512: "bg-yellow-600 text-white",
  1024: "bg-amber-600 text-white",
  2048: "bg-emerald-500 text-white",
};

/** LANX 3.18.0: "New game" in the middle of a game asks first (one slip threw the game away). */
export function NewGameAsk({ score, onYes, onNo }: { score: number; onYes: () => void; onNo: () => void }) {
  return (
    <div data-solo-new-ask className="absolute inset-0 z-10 rounded-2xl bg-white/85 dark:bg-slate-900/85 flex flex-col items-center justify-center gap-3 px-6 text-center lanx-fade">
      <div className="text-[15px] font-bold">Start a new game?</div>
      <div className="text-[12.5px] text-slate-600 dark:text-slate-300">This game ends here, with a score of {score}.</div>
      <div className="flex items-center gap-2">
        <button type="button" data-solo-new-no onClick={onNo} className={`${btn} bg-emerald-500 text-white hover:bg-emerald-600`}>
          Keep playing
        </button>
        <button type="button" data-solo-new-yes onClick={onYes} className={`${btn} bg-slate-500/10 text-slate-700 dark:text-slate-200`}>
          New game
        </button>
      </div>
    </div>
  );
}

/** LANX 3.18.0: said once, when the 2048 tile is made (the game goes on). */
export function Made2048({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div data-solo-2048 className="rounded-full bg-emerald-500/15 px-3 py-1 text-[12px] font-semibold text-emerald-700 dark:text-emerald-300 lanx-fade">
      You made 2048! Keep going for a bigger tile.
    </div>
  );
}

export function Game2048({ onScore }: SoloProps) {
  // The game in play is kept (lib/games/solo2048.ts): it is still here after the games window,
  // or LANX, has been closed.
  const kept = useRef<Saved2048 | null | undefined>(undefined);
  if (kept.current === undefined) kept.current = load2048();
  const [grid, setGrid] = useState<Grid>(() => kept.current?.grid ?? addTile(addTile(empty())));
  const [score, setScore] = useState(() => kept.current?.score ?? 0);
  const [won, setWon] = useState(() => kept.current?.won ?? false);
  const [cheer, setCheer] = useState(false);
  const [over, setOver] = useState(false);
  const [asking, setAsking] = useState(false);
  const reported = useRef(false);
  const gridRef = useRef(grid);
  gridRef.current = grid;

  const fresh = () => {
    // (the game you give up for a new one counts)
    if (!reported.current && score > 0) onScore(score);
    const g = addTile(addTile(empty()));
    gridRef.current = g;
    setGrid(g);
    setScore(0);
    setWon(false);
    setCheer(false);
    setOver(false);
    setAsking(false);
    reported.current = false;
  };
  const reset = () => (score > 0 && !over ? setAsking(true) : fresh());

  const step = useCallback(
    (dir: "left" | "right" | "up" | "down") => {
      if (over || asking) return;
      const r = move2048(gridRef.current, dir);
      if (!r.moved) return;
      const next = addTile(r.grid);
      gridRef.current = next;
      setGrid(next);
      setScore((s) => s + r.gained);
      sfx(r.gained > 0 ? "merge" : "tap");
      if (!won && topTile(next) >= 2048) {
        setWon(true);
        setCheer(true);
        sfx("win");
      }
      if (!canMove(next)) {
        setOver(true);
        sfx("lose");
      }
    },
    [over, asking, won],
  );

  useEffect(() => {
    if (over && !reported.current) {
      reported.current = true;
      onScore(score);
    }
  }, [over, score, onScore]);
  useEffect(() => keep2048(over ? null : { grid, score, won }), [grid, score, won, over]);
  useEffect(() => {
    if (!cheer) return;
    const t = window.setTimeout(() => setCheer(false), 7000);
    return () => window.clearTimeout(t);
  }, [cheer]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const map: Record<string, "left" | "right" | "up" | "down"> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", a: "left", d: "right", w: "up", s: "down" };
      const d = map[e.key];
      if (d) {
        e.preventDefault();
        step(d);
      }
    };
    window.addEventListener("keydown", h);
    // LANX 3.5.0: a flick of the hand plays like an arrow key.
    const flick = (e: Event) => {
      const d = (e as CustomEvent<{ dir: string }>).detail.dir;
      e.preventDefault();
      h(new KeyboardEvent("keydown", { key: `Arrow${d[0].toUpperCase()}${d.slice(1)}` }));
    };
    window.addEventListener("lanx:gesture-swipe", flick);
    return () => {
      window.removeEventListener("keydown", h);
      window.removeEventListener("lanx:gesture-swipe", flick);
    };
  }, [step]);

  return (
    <div data-solo="2048" className="flex flex-col items-center gap-3">
      <div className="flex items-center gap-3 text-[13px]">
        <span className="rounded-full bg-slate-500/10 px-3 py-1 font-semibold" data-solo-score>
          Score {score}
        </span>
        <button type="button" data-solo-start onClick={reset} className={`${btn} bg-slate-500/10 text-slate-700 dark:text-slate-200`}>
          <RotateCcw className="h-3.5 w-3.5" /> New game
        </button>
      </div>
      <Made2048 show={cheer} />
      <div className="relative grid grid-cols-4 gap-2 rounded-2xl bg-slate-300 dark:bg-slate-700 p-2">
        {grid.flat().map((v, i) => (
          <div key={i} data-tile={v} className={`h-[72px] w-[72px] rounded-xl flex items-center justify-center font-black ${v >= 1024 ? "text-xl" : v >= 128 ? "text-2xl" : "text-3xl"} ${v ? `${TILE[v] ?? "bg-emerald-600 text-white"} lanx-pop` : "bg-slate-200/60 dark:bg-slate-600/60"}`}>
            {v || ""}
          </div>
        ))}
        {over && (
          <div className="absolute inset-0 rounded-2xl bg-white/70 dark:bg-slate-900/70 flex flex-col items-center justify-center gap-2 lanx-fade">
            <div className="text-xl font-bold">No moves left</div>
            <div className="text-[13px]">Score {score}</div>
          </div>
        )}
        {asking && <NewGameAsk score={score} onYes={fresh} onNo={() => setAsking(false)} />}
      </div>
      <div className="text-[11.5px] text-slate-500">Arrow keys or W A S D to slide. Tiles with the same number merge. Your game is kept when you close this.</div>
      <div className="grid grid-cols-3 gap-1 text-[12px]">
        <span />
        <button type="button" onClick={() => step("up")} className="rounded-lg bg-slate-500/10 px-3 py-1">▲</button>
        <span />
        <button type="button" onClick={() => step("left")} className="rounded-lg bg-slate-500/10 px-3 py-1">◀</button>
        <button type="button" onClick={() => step("down")} className="rounded-lg bg-slate-500/10 px-3 py-1">▼</button>
        <button type="button" onClick={() => step("right")} className="rounded-lg bg-slate-500/10 px-3 py-1">▶</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Snake

import { SNAKE_N, type SnakeState } from "../../lib/games/soloSnake";
import { useMinesGame, useSnakeGame } from "./soloHooks";

const CELL = 18;

export function SnakeGame({ onScore }: SoloProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const draw = useCallback((s: SnakeState) => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, SNAKE_N * CELL, SNAKE_N * CELL);
    if (s.food) {
      ctx.fillStyle = "#f43f5e";
      ctx.beginPath();
      ctx.arc(s.food[0] * CELL + CELL / 2, s.food[1] * CELL + CELL / 2, CELL / 2 - 2, 0, Math.PI * 2);
      ctx.fill();
    }
    s.snake.forEach(([x, y], i) => {
      ctx.fillStyle = i === 0 ? "#34d399" : "#10b981";
      ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
    });
  }, []);
  const { score, state, full, start, togglePause, game } = useSnakeGame(onScore, draw);

  useEffect(() => {
    draw(game.current);
  }, [draw, game]);

  return (
    <div data-solo="snake" data-solo-state={state} className="flex flex-col items-center gap-3">
      <div className="flex items-center gap-3 text-[13px]">
        <span className="rounded-full bg-slate-500/10 px-3 py-1 font-semibold" data-solo-score>
          Eaten {score}
        </span>
        {state === "running" || state === "paused" ? (
          <button type="button" data-solo-pause onClick={togglePause} className={`${btn} bg-slate-500/10 text-slate-700 dark:text-slate-200`}>
            {state === "running" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} {state === "running" ? "Pause" : "Go on"}
          </button>
        ) : (
          <button type="button" data-solo-start onClick={start} className={`${btn} bg-emerald-500 text-white hover:bg-emerald-600`}>
            <Play className="h-3.5 w-3.5" /> {state === "dead" ? "Play again" : "Start"}
          </button>
        )}
      </div>
      <div className="relative rounded-2xl overflow-hidden ring-1 ring-black/20">
        <canvas ref={canvas} width={SNAKE_N * CELL} height={SNAKE_N * CELL} />
        {state === "dead" && (
          <div className="absolute inset-0 bg-slate-900/70 text-white flex flex-col items-center justify-center gap-1 lanx-fade">
            <div className="text-xl font-bold">{full ? "You filled the board!" : "Ouch!"}</div>
            <div className="text-[13px]">You ate {score}</div>
          </div>
        )}
        {state === "paused" && <div className="absolute inset-0 bg-slate-900/50 text-white flex items-center justify-center text-xl font-bold">Paused</div>}
      </div>
      <div className="text-[11.5px] text-slate-500">Arrow keys or W A S D to steer; Space pauses. The game waits while LANX is hidden.</div>
    </div>
  );
}

// ---------------------------------------------------------------- Minesweeper

import { MS } from "../../lib/games/soloMines";
export { MINES, MS, type Sq, around, freshField, plant } from "../../lib/games/soloMines";

/** The flag-mode switch (a flag without a right mouse button). */
export function FlagMode({ on, set }: { on: boolean; set: (on: boolean) => void }) {
  return (
    <button
      type="button"
      data-solo-flagmode={on ? "on" : "off"}
      aria-pressed={on}
      title="While this is on, a click plants a flag instead of opening the square"
      onClick={() => set(!on)}
      className={`${btn} ${on ? "bg-rose-500 text-white hover:bg-rose-600" : "bg-slate-500/10 text-slate-700 dark:text-slate-200"}`}
    >
      <Flag className="h-3.5 w-3.5" /> Flags {on ? "on" : "off"}
    </button>
  );
}

export const MINES_HELP = "Click opens a square; right-click or F plants a flag (or switch Flags on). Click a number to open around it. The first click is always safe.";

export function Minesweeper({ onScore }: SoloProps) {
  const { game, seconds, flagsLeft, flagMode, setFlagMode, press, flag, reset } = useMinesGame(onScore);
  const { field, state } = game;
  const board = useRef<HTMLDivElement>(null);
  /** The arrow keys walk over the field; F plants a flag on the square you are on. */
  const key = (e: ReactKeyboardEvent, i: number) => {
    if (e.key === "f" || e.key === "F") {
      e.preventDefault();
      flag(i);
      return;
    }
    const r = Math.floor(i / MS);
    const c = i % MS;
    const to =
      e.key === "ArrowLeft" && c > 0 ? i - 1 : e.key === "ArrowRight" && c < MS - 1 ? i + 1 : e.key === "ArrowUp" && r > 0 ? i - MS : e.key === "ArrowDown" && r < MS - 1 ? i + MS : -1;
    if (to < 0) return;
    e.preventDefault();
    board.current?.querySelector<HTMLButtonElement>(`[data-mine-cell="${to}"]`)?.focus();
  };

  const COLOURS = ["", "text-blue-600", "text-emerald-700", "text-red-600", "text-indigo-800", "text-amber-800", "text-cyan-700", "text-black", "text-slate-500"];
  return (
    <div data-solo="mines" data-solo-state={state} className="flex flex-col items-center gap-3">
      <div className="flex items-center gap-3 text-[13px]">
        <span className="rounded-full bg-slate-500/10 px-3 py-1 font-semibold inline-flex items-center gap-1" data-solo-flags>
          <Flag className="h-3.5 w-3.5" /> {flagsLeft}
        </span>
        <span className="rounded-full bg-slate-500/10 px-3 py-1 font-semibold" data-solo-score>
          {seconds} s
        </span>
        <FlagMode on={flagMode} set={setFlagMode} />
        <button type="button" data-solo-start onClick={reset} className={`${btn} bg-slate-500/10 text-slate-700 dark:text-slate-200`}>
          <RotateCcw className="h-3.5 w-3.5" /> New field
        </button>
      </div>
      <div ref={board} className="relative grid grid-cols-9 gap-[2px] rounded-xl bg-slate-400 dark:bg-slate-600 p-[4px]">
        {field.map((s, i) => (
          <button
            key={i}
            type="button"
            data-mine-cell={i}
            data-mine-shows={s.open ? (s.mine ? "mine" : s.n) : s.flag ? "flag" : "closed"}
            onClick={() => press(i)}
            onKeyDown={(e) => key(e, i)}
            onContextMenu={(e) => {
              e.preventDefault();
              flag(i);
            }}
            className={`h-9 w-9 rounded-[5px] text-[14px] font-black flex items-center justify-center ${s.open ? (s.mine ? "bg-red-500 text-white" : "bg-slate-100 dark:bg-slate-300") : "bg-slate-200 dark:bg-slate-500 hover:bg-slate-300 dark:hover:bg-slate-400 shadow"} ${s.open && !s.mine ? COLOURS[s.n] : ""}`}
          >
            {s.open ? (s.mine ? "💣" : s.n || "") : s.flag ? "🚩" : ""}
          </button>
        ))}
        {state !== "playing" && (
          <div className="absolute inset-0 rounded-xl bg-white/70 dark:bg-slate-900/70 flex flex-col items-center justify-center gap-1 lanx-fade">
            <div className="text-xl font-bold">{state === "won" ? "Field cleared!" : "Boom."}</div>
            <div className="text-[13px]">{state === "won" ? `${seconds} seconds` : "Try a new field"}</div>
          </div>
        )}
      </div>
      <div className="text-[11.5px] text-slate-500 max-w-[360px] text-center">{MINES_HELP}</div>
    </div>
  );
}
