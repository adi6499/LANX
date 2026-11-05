// LANX 2.9.0: the games you play alone — 2048, Snake and Minesweeper. Each
// keeps its own state and reports a finished game's score to the scoreboard.

import { sfx } from "../../lib/gameSounds";
import { useCallback, useEffect, useRef, useState } from "react";
import { Flag, Pause, Play, RotateCcw } from "lucide-react";

export interface SoloProps {
  /** A game ended with this score (higher is better unless the game says otherwise). */
  onScore: (score: number) => void;
}

const btn = "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors active:scale-95";

// ---------------------------------------------------------------- 2048

export type Grid = number[][];
const SIZE = 4;
export const empty = (): Grid => Array.from({ length: SIZE }, () => Array(SIZE).fill(0));

export function addTile(g: Grid): Grid {
  const free: [number, number][] = [];
  g.forEach((row, r) => row.forEach((v, c) => v === 0 && free.push([r, c])));
  if (!free.length) return g;
  const [r, c] = free[Math.floor(Math.random() * free.length)];
  const next = g.map((row) => [...row]);
  next[r][c] = Math.random() < 0.9 ? 2 : 4;
  return next;
}

export function slideRow(row: number[]): { row: number[]; gained: number } {
  const vals = row.filter((v) => v);
  const out: number[] = [];
  let gained = 0;
  for (let i = 0; i < vals.length; i++) {
    if (vals[i] === vals[i + 1]) {
      out.push(vals[i] * 2);
      gained += vals[i] * 2;
      i++;
    } else out.push(vals[i]);
  }
  while (out.length < SIZE) out.push(0);
  return { row: out, gained };
}

const rotate = (g: Grid): Grid => g[0].map((_, c) => g.map((row) => row[c]).reverse());

export function move2048(g: Grid, dir: "left" | "right" | "up" | "down"): { grid: Grid; gained: number; moved: boolean } {
  let turns = { left: 0, up: 1, right: 2, down: 3 }[dir];
  let work = g;
  for (let i = 0; i < turns; i++) work = rotate(work);
  let gained = 0;
  const slid = work.map((row) => {
    const s = slideRow(row);
    gained += s.gained;
    return s.row;
  });
  let back = slid;
  for (let i = 0; i < (4 - turns) % 4; i++) back = rotate(back);
  turns = 0;
  const moved = back.some((row, r) => row.some((v, c) => v !== g[r][c]));
  return { grid: back, gained, moved };
}

export const canMove = (g: Grid) => (["left", "right", "up", "down"] as const).some((d) => move2048(g, d).moved);

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

export function Game2048({ onScore }: SoloProps) {
  const [grid, setGrid] = useState<Grid>(() => addTile(addTile(empty())));
  const [score, setScore] = useState(0);
  const [over, setOver] = useState(false);
  const reported = useRef(false);

  const reset = () => {
    setGrid(addTile(addTile(empty())));
    setScore(0);
    setOver(false);
    reported.current = false;
  };

  const step = useCallback(
    (dir: "left" | "right" | "up" | "down") => {
      if (over) return;
      setGrid((g) => {
        const r = move2048(g, dir);
        if (!r.moved) return g;
        const next = addTile(r.grid);
        setScore((s) => s + r.gained);
        sfx(r.gained > 0 ? "merge" : "tap");
        if (!canMove(next)) {
          setOver(true);
          sfx("lose");
        }
        return next;
      });
    },
    [over],
  );

  useEffect(() => {
    if (over && !reported.current) {
      reported.current = true;
      onScore(score);
    }
  }, [over, score, onScore]);

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
      </div>
      <div className="text-[11.5px] text-slate-500">Arrow keys or W A S D to slide. Tiles with the same number merge.</div>
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

const N = 20;
const CELL = 18;
type Dir = "U" | "D" | "L" | "R";
type Pt = [number, number];

export function SnakeGame({ onScore }: SoloProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [score, setScore] = useState(0);
  const [state, setState] = useState<"ready" | "running" | "paused" | "dead">("ready");
  const snake = useRef<Pt[]>([[10, 10], [9, 10], [8, 10]]);
  const dir = useRef<Dir>("R");
  const nextDir = useRef<Dir>("R");
  const food = useRef<Pt>([15, 10]);
  const eaten = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  const placeFood = () => {
    for (;;) {
      const p: Pt = [Math.floor(Math.random() * N), Math.floor(Math.random() * N)];
      if (!snake.current.some(([x, y]) => x === p[0] && y === p[1])) {
        food.current = p;
        return;
      }
    }
  };

  const draw = useCallback(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, N * CELL, N * CELL);
    ctx.fillStyle = "#f43f5e";
    ctx.beginPath();
    ctx.arc(food.current[0] * CELL + CELL / 2, food.current[1] * CELL + CELL / 2, CELL / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    snake.current.forEach(([x, y], i) => {
      ctx.fillStyle = i === 0 ? "#34d399" : "#10b981";
      ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
    });
  }, []);

  const reset = () => {
    snake.current = [[10, 10], [9, 10], [8, 10]];
    dir.current = "R";
    nextDir.current = "R";
    eaten.current = 0;
    setScore(0);
    placeFood();
    draw();
    setState("running");
  };

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    if (state !== "running") return;
    let alive = true;
    const tick = () => {
      if (!alive || stateRef.current !== "running") return;
      dir.current = nextDir.current;
      const [hx, hy] = snake.current[0];
      const d = dir.current;
      const head: Pt = [hx + (d === "R" ? 1 : d === "L" ? -1 : 0), hy + (d === "D" ? 1 : d === "U" ? -1 : 0)];
      const hit = head[0] < 0 || head[1] < 0 || head[0] >= N || head[1] >= N || snake.current.some(([x, y]) => x === head[0] && y === head[1]);
      if (hit) {
        setState("dead");
        sfx("boom");
        onScore(eaten.current);
        return;
      }
      snake.current = [head, ...snake.current];
      if (head[0] === food.current[0] && head[1] === food.current[1]) {
        eaten.current += 1;
        sfx("eat");
        setScore(eaten.current);
        placeFood();
      } else snake.current.pop();
      draw();
      window.setTimeout(tick, Math.max(60, 140 - eaten.current * 4));
    };
    const t = window.setTimeout(tick, 140);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [state, draw, onScore]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const map: Record<string, Dir> = { ArrowUp: "U", ArrowDown: "D", ArrowLeft: "L", ArrowRight: "R", w: "U", s: "D", a: "L", d: "R" };
      const nd = map[e.key];
      if (nd) {
        e.preventDefault();
        const opposite: Record<Dir, Dir> = { U: "D", D: "U", L: "R", R: "L" };
        if (opposite[dir.current] !== nd) nextDir.current = nd;
        if (stateRef.current === "ready" || stateRef.current === "dead") reset();
      } else if (e.key === " ") {
        e.preventDefault();
        setState((s) => (s === "running" ? "paused" : s === "paused" ? "running" : s));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div data-solo="snake" className="flex flex-col items-center gap-3">
      <div className="flex items-center gap-3 text-[13px]">
        <span className="rounded-full bg-slate-500/10 px-3 py-1 font-semibold" data-solo-score>
          Eaten {score}
        </span>
        {state === "running" || state === "paused" ? (
          <button type="button" onClick={() => setState(state === "running" ? "paused" : "running")} className={`${btn} bg-slate-500/10 text-slate-700 dark:text-slate-200`}>
            {state === "running" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} {state === "running" ? "Pause" : "Go on"}
          </button>
        ) : (
          <button type="button" data-solo-start onClick={reset} className={`${btn} bg-emerald-500 text-white hover:bg-emerald-600`}>
            <Play className="h-3.5 w-3.5" /> {state === "dead" ? "Play again" : "Start"}
          </button>
        )}
      </div>
      <div className="relative rounded-2xl overflow-hidden ring-1 ring-black/20">
        <canvas ref={canvas} width={N * CELL} height={N * CELL} />
        {state === "dead" && (
          <div className="absolute inset-0 bg-slate-900/70 text-white flex flex-col items-center justify-center gap-1 lanx-fade">
            <div className="text-xl font-bold">Ouch!</div>
            <div className="text-[13px]">You ate {score}</div>
          </div>
        )}
        {state === "paused" && <div className="absolute inset-0 bg-slate-900/50 text-white flex items-center justify-center text-xl font-bold">Paused</div>}
      </div>
      <div className="text-[11.5px] text-slate-500">Arrow keys or W A S D to steer; Space pauses.</div>
    </div>
  );
}

// ---------------------------------------------------------------- Minesweeper

export const MS = 9;
export const MINES = 10;
export interface Sq {
  mine: boolean;
  open: boolean;
  flag: boolean;
  n: number;
}

export function freshField(): Sq[] {
  return Array.from({ length: MS * MS }, () => ({ mine: false, open: false, flag: false, n: 0 }));
}

export function around(i: number): number[] {
  const r = Math.floor(i / MS);
  const c = i % MS;
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const rr = r + dr;
    const cc = c + dc;
    if (rr >= 0 && rr < MS && cc >= 0 && cc < MS) out.push(rr * MS + cc);
  }
  return out;
}

export function plant(field: Sq[], safe: number): Sq[] {
  const f = field.map((s) => ({ ...s }));
  const keep = new Set([safe, ...around(safe)]);
  let left = MINES;
  while (left) {
    const i = Math.floor(Math.random() * MS * MS);
    if (f[i].mine || keep.has(i)) continue;
    f[i].mine = true;
    left--;
  }
  f.forEach((s, i) => {
    s.n = around(i).filter((j) => f[j].mine).length;
  });
  return f;
}

export function Minesweeper({ onScore }: SoloProps) {
  const [field, setField] = useState<Sq[]>(freshField);
  const [planted, setPlanted] = useState(false);
  const [state, setState] = useState<"playing" | "won" | "lost">("playing");
  const [start, setStart] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (state !== "playing" || start === null) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [state, start]);

  const seconds = start === null ? 0 : Math.floor(((state === "playing" ? now : now) - start) / 1000);
  const flags = field.filter((s) => s.flag).length;

  const reset = () => {
    setField(freshField());
    setPlanted(false);
    setState("playing");
    setStart(null);
  };

  const open = (i: number) => {
    if (state !== "playing") return;
    let f = field;
    if (!planted) {
      f = plant(field, i);
      setPlanted(true);
      setStart(Date.now());
    }
    if (f[i].flag || f[i].open) return;
    f = f.map((s) => ({ ...s }));
    if (f[i].mine) {
      f.forEach((s) => {
        if (s.mine) s.open = true;
      });
      setField(f);
      setState("lost");
      sfx("boom");
      return;
    }
    const stack = [i];
    while (stack.length) {
      const j = stack.pop()!;
      if (f[j].open || f[j].flag) continue;
      f[j].open = true;
      if (f[j].n === 0) for (const k of around(j)) if (!f[k].open && !f[k].mine) stack.push(k);
    }
    sfx("tap");
    setField(f);
    if (f.every((s) => s.open || s.mine)) {
      setState("won");
      sfx("win");
      const took = Math.max(1, Math.floor((Date.now() - (start ?? Date.now())) / 1000));
      onScore(took);
    }
  };

  const toggleFlag = (i: number) => {
    if (state !== "playing" || field[i].open) return;
    sfx("flag");
    setField((f) => f.map((s, j) => (j === i ? { ...s, flag: !s.flag } : s)));
  };

  const COLOURS = ["", "text-blue-600", "text-emerald-700", "text-red-600", "text-indigo-800", "text-amber-800", "text-cyan-700", "text-black", "text-slate-500"];
  return (
    <div data-solo="mines" className="flex flex-col items-center gap-3">
      <div className="flex items-center gap-3 text-[13px]">
        <span className="rounded-full bg-slate-500/10 px-3 py-1 font-semibold inline-flex items-center gap-1" data-solo-flags>
          <Flag className="h-3.5 w-3.5" /> {MINES - flags}
        </span>
        <span className="rounded-full bg-slate-500/10 px-3 py-1 font-semibold" data-solo-score>
          {seconds} s
        </span>
        <button type="button" data-solo-start onClick={reset} className={`${btn} bg-slate-500/10 text-slate-700 dark:text-slate-200`}>
          <RotateCcw className="h-3.5 w-3.5" /> New field
        </button>
      </div>
      <div className="relative grid grid-cols-9 gap-[2px] rounded-xl bg-slate-400 dark:bg-slate-600 p-[4px]">
        {field.map((s, i) => (
          <button
            key={i}
            type="button"
            data-mine-cell={i}
            onClick={() => open(i)}
            onContextMenu={(e) => {
              e.preventDefault();
              toggleFlag(i);
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
      <div className="text-[11.5px] text-slate-500">Click to open a square; right-click to plant a flag. The first click is always safe.</div>
    </div>
  );
}
