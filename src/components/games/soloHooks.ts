// LANX 3.18.0 (Sprint 3): Snake and Minesweeper are each played by ONE piece of code, used by the
// flat board and by the 3D board alike. (Each board had its own copy of the game, so every fault
// was there twice.) The rules themselves are in lib/games/soloSnake.ts and soloMines.ts.

import { useCallback, useEffect, useRef, useState } from "react";
import { sfx } from "../../lib/gameSounds";
import { type SnakeDir, type SnakeState, snakeDelay, snakeMayRestart, snakeStart, snakeStep, snakeTurn } from "../../lib/games/soloSnake";
import { MINES, type MinesGame, flagsOn, minesChord, minesFlag, minesOpen, minesSeconds, minesStart } from "../../lib/games/soloMines";

/** A key pressed while typing somewhere is not for the game. */
const typing = (e: KeyboardEvent) => !!(e.target as HTMLElement | null)?.closest?.("input, textarea, [contenteditable=true]");

const STEER: Record<string, SnakeDir> = { ArrowUp: "U", ArrowDown: "D", ArrowLeft: "L", ArrowRight: "R", w: "U", s: "D", a: "L", d: "R" };

export type SnakePhase = "ready" | "running" | "paused" | "dead";

/** Snake. `paint` draws a position: `ms` is the time until the next step, `moving` whether the
 *  snake got there by a step (the 3D board glides it there). */
export function useSnakeGame(onScore: (score: number) => void, paint: (s: SnakeState, ms: number, moving: boolean) => void) {
  const [score, setScore] = useState(0);
  const [state, setState] = useState<SnakePhase>("ready");
  const [full, setFull] = useState(false);
  const game = useRef<SnakeState>(null as unknown as SnakeState);
  if (!game.current) game.current = snakeStart();
  const stateRef = useRef(state);
  stateRef.current = state;
  const paintRef = useRef(paint);
  paintRef.current = paint;
  const scoreRef = useRef(onScore);
  scoreRef.current = onScore;
  const crashedAt = useRef(0);

  const start = useCallback(() => {
    game.current = snakeStart();
    setScore(0);
    setFull(false);
    paintRef.current(game.current, snakeDelay(0), false);
    stateRef.current = "running";
    setState("running");
  }, []);

  const togglePause = useCallback(() => setState((s) => (s === "running" ? "paused" : s === "paused" ? "running" : s)), []);

  useEffect(() => {
    if (state !== "running") return;
    let alive = true;
    let t = 0;
    const tick = () => {
      if (!alive) return;
      const before = game.current;
      const next = snakeStep(before);
      game.current = next;
      if (next.eaten !== before.eaten) {
        sfx("eat");
        setScore(next.eaten);
      }
      if (next.dead) {
        crashedAt.current = Date.now();
        if (next.full) paintRef.current(next, snakeDelay(next.eaten), true);
        setFull(next.full);
        setState("dead");
        sfx(next.full ? "win" : "boom");
        scoreRef.current(next.eaten);
        return;
      }
      paintRef.current(next, snakeDelay(next.eaten), true);
      t = window.setTimeout(tick, snakeDelay(next.eaten));
    };
    t = window.setTimeout(tick, 140);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [state]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const nd = STEER[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (nd) {
        e.preventDefault();
        const st = stateRef.current;
        if (st === "running") game.current = snakeTurn(game.current, nd);
        else if (st === "ready" || (st === "dead" && snakeMayRestart(e.repeat, Date.now() - crashedAt.current))) {
          start();
          game.current = snakeTurn(game.current, nd);
        }
      } else if (e.key === " ") {
        e.preventDefault();
        if (!e.repeat) togglePause();
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
    // The game waits while LANX cannot be seen (it used to run on, into the wall).
    const hidden = () => {
      if (document.hidden) setState((s) => (s === "running" ? "paused" : s));
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("keydown", h);
      window.removeEventListener("lanx:gesture-swipe", flick);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [start, togglePause]);

  return { score, state, full, start, togglePause, game };
}

/** Minesweeper. */
export function useMinesGame(onScore: (seconds: number) => void) {
  const [game, setGame] = useState<MinesGame>(minesStart);
  const [flagMode, setFlagMode] = useState(false);
  // The clock that never goes backwards (the PC's own clock can be set back in the middle of a game).
  const [start, setStart] = useState<number | null>(null);
  const [end, setEnd] = useState<number | null>(null);
  const [now, setNow] = useState(() => performance.now());
  const gameRef = useRef(game);
  const startRef = useRef(start);
  const flagModeRef = useRef(flagMode);
  flagModeRef.current = flagMode;
  const scoreRef = useRef(onScore);
  scoreRef.current = onScore;

  useEffect(() => {
    if (game.state !== "playing" || start === null) return;
    const t = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(t);
  }, [game.state, start]);

  const apply = useCallback((next: MinesGame, sound: "tap" | "flag") => {
    if (next === gameRef.current) return;
    gameRef.current = next;
    setGame(next);
    const t = performance.now();
    if (next.planted && startRef.current === null) {
      startRef.current = t;
      setStart(t);
      setNow(t);
    }
    if (next.state === "lost") {
      setEnd(t);
      sfx("boom");
    } else if (next.state === "won") {
      setEnd(t);
      sfx("win");
      scoreRef.current(Math.max(1, minesSeconds(startRef.current, t)));
    } else sfx(sound);
  }, []);

  const open = useCallback((i: number) => apply(minesOpen(gameRef.current, i), "tap"), [apply]);
  const flag = useCallback((i: number) => apply(minesFlag(gameRef.current, i), "flag"), [apply]);
  /** A click or tap on a square: opens it; plants a flag in flag mode; on an open number, opens around it. */
  const press = useCallback(
    (i: number) => {
      const sq = gameRef.current.field[i];
      if (!sq) return;
      if (sq.open) apply(minesChord(gameRef.current, i), "tap");
      else if (flagModeRef.current) flag(i);
      else open(i);
    },
    [apply, flag, open],
  );
  const reset = useCallback(() => {
    const g = minesStart();
    gameRef.current = g;
    setGame(g);
    startRef.current = null;
    setStart(null);
    setEnd(null);
  }, []);

  return { game, seconds: minesSeconds(start, end ?? now), flagsLeft: Math.max(0, MINES - flagsOn(game)), flagMode, setFlagMode, press, open, flag, reset };
}
