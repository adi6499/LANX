// The three real-time games. The host's PC runs the physics (lib/games/sim)
// and streams snapshots over a data channel (lib/gameChannel.ts); the
// others send their pointer and keys. Goals and knock-outs are written as
// moves by the host so the match keeps score.
import { useEffect, useMemo, useRef, useState } from "react";
import { sfx } from "../../../lib/gameSounds";
import { seatFor, type BoardProps } from "../boardProps";
import { GameChannel } from "../../../lib/gameChannel";
import { airhockey, foosball, spinnerWars } from "../../../lib/games/realtime.ts";
import { AH_H, AH_W, GOAL_W, PADDLE_R, PUCK_R, ahStart, ahStep, type AHState } from "../../../lib/games/sim/airhockey.ts";
import { BALL_R, FB_H, FB_W, GOAL_H, MAN_H, MAN_W, RODS, fbStart, fbStep, menOf, type FBInput, type FBState } from "../../../lib/games/sim/foosball.ts";
import { ARENA_R, SPIN_R, spinReset, spinStart, spinStep, type SpinState } from "../../../lib/games/sim/spinner.ts";

/** The channel, the host's loop and the guests' input pump, shared by the three games. */
export function useLive<S, I>(p: BoardProps, start: () => S, stepFn: (s: S, inputs: (I | null)[]) => void, snapshot: (s: S) => unknown, restore: (snap: unknown) => S) {
  const n = Math.max(2, p.seats?.length ?? 2);
  const players = useMemo(() => Array.from({ length: n }, (_, i) => i), [n]);
  const channel = useRef<GameChannel | null>(null);
  const fed = useRef(0);
  const inputs = useRef<(I | null)[]>(Array(n).fill(null));
  const myInput = useRef<I | null>(null);
  const sim = useRef<S | null>(null);
  const [view, setView] = useState<S>(start);
  const onDelta = p.onDelta;
  useEffect(() => {
    if (p.local) return;
    const ch = new GameChannel({ me: p.seat, host: !!p.host, players, sendDelta: (d) => onDelta?.(d) });
    channel.current = ch;
    const off = ch.onMessage((from, data) => {
      const d = data as { t: string; i?: I; s?: unknown };
      if (!d) return;
      if (d.t === "i" && p.host) inputs.current[from] = d.i ?? null;
      else if (d.t === "s" && !p.host && d.s !== undefined) setView(restore(d.s));
    });
    return () => {
      off();
      ch.close();
      channel.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.host, p.seat, p.local, players.length]);
  // Feed new deltas to the channel (offers, answers, relayed messages).
  useEffect(() => {
    const ds = p.deltas ?? [];
    for (; fed.current < ds.length; fed.current++) channel.current?.feed(ds[fed.current]);
  }, [p.deltas]);
  // The host (or pass & play) runs the game.
  useEffect(() => {
    if (!p.host && !p.local) return;
    sim.current = start();
    let tick = 0;
    const t = window.setInterval(() => {
      const s = sim.current;
      if (!s) return;
      const ins = inputs.current.map((x, i) => (i === p.seat ? myInput.current : x));
      stepFn(s, ins);
      tick++;
      if (tick % 2 === 0) {
        setView({ ...(s as object) } as S);
        if (!p.local) channel.current?.send({ t: "s", s: snapshot(s) });
      }
    }, 16);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.host, p.local]);
  // Guests pump their input to the host.
  useEffect(() => {
    if (p.host || p.local) return;
    const t = window.setInterval(() => {
      if (myInput.current) channel.current?.send({ t: "i", i: myInput.current });
    }, 33);
    return () => window.clearInterval(t);
  }, [p.host, p.local]);
  return { view, setInput: (i: I | null) => (myInput.current = i), sim, n, live: channel.current?.live ?? false, inputs };
}

export const label = (p: BoardProps, i: number, n: number) => seatFor(p.seats, p.starter ?? 0, i, n);

/** Goals, bounces and knock-outs as sounds, worked out from the positions every PC already sees (2.13.0). */
export function useArcadeSfx(scores: number[], ball: { vx: number; vy: number } | null, outs = 0) {
  const prev = useRef({ scores: "", vx: 0, vy: 0, outs: 0 });
  useEffect(() => {
    const p = prev.current;
    const s = scores.join(",");
    if (p.scores && s !== p.scores) sfx("score");
    if (ball) {
      const flipX = p.vx !== 0 && ball.vx !== 0 && Math.sign(ball.vx) !== Math.sign(p.vx);
      const flipY = p.vy !== 0 && ball.vy !== 0 && Math.sign(ball.vy) !== Math.sign(p.vy);
      if (flipX || flipY) sfx("bounce");
    }
    if (outs > p.outs) sfx("boom");
    prev.current = { scores: s, vx: ball?.vx ?? 0, vy: ball?.vy ?? 0, outs };
  });
}

// ---------------------------------------------------------------- Air Hockey

/** LANX 2.16.0: Air Hockey's live game (the same for the flat and the 3D table). */
export function useAirHockey(p: BoardProps) {
  const rec = useMemo(() => airhockey.replay(p.moves, 2, ""), [p.moves]);
  const live = useLive<AHState, { x: number; y: number }>(p, ahStart, (s, ins) => {
    const g = ahStep(s, ins);
    if (g >= 0 && (p.host || p.local)) {
      p.onMove(`g:${g}`);
      if (s.goals[g] >= 5) p.onMove(`end:${g}`);
    }
  }, (s) => ({ puck: s.puck, paddles: s.paddles, goals: s.goals, pause: s.pause }), (snap) => ({ ...(snap as AHState), lastGoal: -1 }));
  useArcadeSfx(live.view.goals, live.view.puck);
  return { rec, ...live };
}

export function AirHockeyBoard(p: BoardProps) {
  const { rec, view, setInput } = useAirHockey(p);
  const canvas = useRef<HTMLCanvasElement>(null);
  const flip = p.seat === 1; // my goal at the bottom
  const scale = 0.78;
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    const s = view;
    ctx.save();
    ctx.clearRect(0, 0, AH_W * scale, AH_H * scale);
    ctx.scale(scale, scale);
    if (flip) {
      ctx.translate(AH_W, AH_H);
      ctx.rotate(Math.PI);
    }
    ctx.fillStyle = "#e0f2fe";
    ctx.fillRect(0, 0, AH_W, AH_H);
    ctx.strokeStyle = "#0ea5e9";
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, AH_W - 4, AH_H - 4);
    ctx.beginPath();
    ctx.moveTo(0, AH_H / 2);
    ctx.lineTo(AH_W, AH_H / 2);
    ctx.stroke();
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(AH_W / 2 - GOAL_W / 2, 0, GOAL_W, 6);
    ctx.fillRect(AH_W / 2 - GOAL_W / 2, AH_H - 6, GOAL_W, 6);
    s.paddles.forEach((pad, i) => {
      ctx.fillStyle = label(p, i, 2).color;
      ctx.beginPath();
      ctx.arc(pad.x, pad.y, PADDLE_R, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = "#0f172a";
    ctx.beginPath();
    ctx.arc(s.puck.x, s.puck.y, PUCK_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }, [view, flip, p]);
  const goals = rec?.goals ?? [0, 0];
  return (
    <div data-game-board="airhockey" className="flex flex-col items-center gap-2">
      <div className="text-[13px] font-semibold" data-live-score>
        {label(p, 0, 2).name} {goals[0]} — {goals[1]} {label(p, 1, 2).name} <span className="text-slate-400 font-normal">· first to 5</span>
      </div>
      <canvas
        ref={canvas}
        data-live-canvas
        width={AH_W * scale}
        height={AH_H * scale}
        className="rounded-xl shadow-lg ring-1 ring-black/10 touch-none"
        style={{ cursor: "none" }}
        onPointerMove={(e) => {
          if (!p.canPlay && !p.local) return;
          const r = e.currentTarget.getBoundingClientRect();
          let x = ((e.clientX - r.left) / r.width) * AH_W;
          let y = ((e.clientY - r.top) / r.height) * AH_H;
          if (flip) {
            x = AH_W - x;
            y = AH_H - y;
          }
          setInput({ x, y });
        }}
        onPointerLeave={() => setInput(null)}
      />
      <div className="text-[11px] text-slate-500">{p.local ? "Pass & play: one pointer moves the paddle on the bottom half; the other paddle stays put." : "Move the mouse over your half to move your paddle."}</div>
    </div>
  );
}

// ---------------------------------------------------------------- Table Soccer

/** LANX 2.16.0: Table Soccer's live game and controls (rod 1-4, the pointer's height, kick). */
export function useFoosball(p: BoardProps) {
  const rec = useMemo(() => foosball.replay(p.moves, 2, ""), [p.moves]);
  const rod = useRef(2);
  const pointerY = useRef(FB_H / 2);
  const kick = useRef(false);
  const live = useLive<FBState, FBInput>(p, fbStart, (s, ins) => {
    const g = fbStep(s, ins);
    if (g >= 0 && (p.host || p.local)) {
      p.onMove(`g:${g}`);
      if (s.goals[g] >= 5) p.onMove(`end:${g}`);
    }
  }, (s) => ({ ball: s.ball, rodY: s.rodY, kick: s.kick, goals: s.goals, pause: s.pause }), (snap) => ({ ...(snap as FBState), lastGoal: -1 }));
  useArcadeSfx(live.view.goals, live.view.ball);
  const side = p.local ? 0 : p.seat;
  const setInput = live.setInput;
  const push = () => setInput({ rod: rod.current, y: pointerY.current, kick: kick.current });
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key >= "1" && e.key <= "4") {
        rod.current = Number(e.key) - 1;
        push();
      }
      if (e.key === " ") {
        kick.current = true;
        push();
        window.setTimeout(() => {
          kick.current = false;
          push();
        }, 120);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const kickNow = () => {
    kick.current = true;
    push();
    window.setTimeout(() => {
      kick.current = false;
      push();
    }, 120);
  };
  /** Picks the rod nearest a point across the pitch (table units) and kicks. */
  const pickRod = (x: number) => {
    let best = rod.current;
    let bd = 60;
    RODS.forEach((rd, k) => {
      const rx = side === 0 ? rd.x : FB_W - rd.x;
      if (Math.abs(rx - x) < bd) {
        bd = Math.abs(rx - x);
        best = k;
      }
    });
    rod.current = best;
    kickNow();
  };
  const moveTo = (y: number) => {
    pointerY.current = y;
    push();
  };
  return { rec, ...live, side, rod, pickRod, moveTo, kickNow };
}

export function FoosballBoard(p: BoardProps) {
  const { rec, view, side, rod, pickRod, moveTo } = useFoosball(p);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scale = 0.6;
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    const s = view;
    ctx.save();
    ctx.clearRect(0, 0, FB_W * scale, FB_H * scale);
    ctx.scale(scale, scale);
    ctx.fillStyle = "#15803d";
    ctx.fillRect(0, 0, FB_W, FB_H);
    ctx.strokeStyle = "#f8fafc";
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, FB_W - 4, FB_H - 4);
    ctx.beginPath();
    ctx.moveTo(FB_W / 2, 0);
    ctx.lineTo(FB_W / 2, FB_H);
    ctx.stroke();
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, FB_H / 2 - GOAL_H / 2, 6, GOAL_H);
    ctx.fillRect(FB_W - 6, FB_H / 2 - GOAL_H / 2, 6, GOAL_H);
    for (const sd of [0, 1]) {
      ctx.fillStyle = label(p, sd, 2).color;
      RODS.forEach((r, k) => {
        const x = sd === 0 ? r.x : FB_W - r.x;
        ctx.fillStyle = "#94a3b8";
        ctx.fillRect(x - 2, 0, 4, FB_H);
        ctx.fillStyle = label(p, sd, 2).color;
        for (const m of menOf(sd, k, s.rodY[sd][k])) ctx.fillRect(m.x - MAN_W / 2, m.y - MAN_H / 2, MAN_W, MAN_H);
        if (sd === side && k === rod.current) {
          ctx.strokeStyle = "#facc15";
          ctx.lineWidth = 3;
          ctx.strokeRect(x - 8, 0, 16, FB_H);
        }
      });
    }
    ctx.fillStyle = "#f8fafc";
    ctx.beginPath();
    ctx.arc(s.ball.x, s.ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }, [view, side, p]);
  const goals = rec?.goals ?? [0, 0];
  return (
    <div data-game-board="foosball" className="flex flex-col items-center gap-2">
      <div className="text-[13px] font-semibold" data-live-score>
        {label(p, 0, 2).name} {goals[0]} — {goals[1]} {label(p, 1, 2).name} <span className="text-slate-400 font-normal">· first to 5</span>
      </div>
      <canvas
        ref={canvas}
        data-live-canvas
        width={FB_W * scale}
        height={FB_H * scale}
        className="rounded-xl shadow-lg ring-1 ring-black/10 touch-none"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          moveTo(((e.clientY - r.top) / r.height) * FB_H);
        }}
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          pickRod(((e.clientX - r.left) / r.width) * FB_W);
        }}
      />
      <div className="text-[11px] text-slate-500">Keys 1–4 (or click a rod) pick a rod; move the mouse up and down; click or Space to kick.</div>
    </div>
  );
}

// ---------------------------------------------------------------- Spinner Wars

/** LANX 2.16.0: Spinner Wars' live game (rounds, knock-outs, the winner) for the flat and 3D arenas. */
export function useSpinner(p: BoardProps) {
  const n = Math.max(2, p.seats?.length ?? 2);
  const rec = useMemo(() => spinnerWars.replay(p.moves, n, ""), [p.moves, n]);
  const live = useLive<SpinState, { x: number; y: number }>(
    p,
    () => spinStart(n),
    (s, ins) => {
      const outs = spinStep(s, ins);
      if (!(p.host || p.local)) return;
      for (const o of outs) p.onMove(`out:${o}`);
      const alive = s.spinners.map((sp, i) => (sp.out ? -1 : i)).filter((i) => i >= 0);
      if (alive.length <= 1 && s.pause === 0) {
        if (alive.length === 1) s.wins[alive[0]]++;
        const champ = s.wins.findIndex((w) => w >= 2);
        if (champ >= 0 || s.round >= 3) p.onMove(`end:${champ >= 0 ? champ : s.wins.indexOf(Math.max(...s.wins))}`);
        else {
          p.onMove("round");
          spinReset(s);
        }
      }
    },
    (s) => ({ spinners: s.spinners, round: s.round, pause: s.pause, wins: s.wins }),
    (snap) => snap as SpinState,
  );
  useArcadeSfx(live.view.wins, null, live.view.spinners.filter((x) => x.out).length);
  return { rec, ...live };
}

export function SpinnerBoard(p: BoardProps) {
  const { rec, n, view, setInput } = useSpinner(p);
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = (ARENA_R + 30) * 2;
  const scale = 0.85;
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    const s = view;
    ctx.save();
    ctx.clearRect(0, 0, size * scale, size * scale);
    ctx.scale(scale, scale);
    ctx.translate(size / 2, size / 2);
    ctx.fillStyle = "#1e293b";
    ctx.beginPath();
    ctx.arc(0, 0, ARENA_R + 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#334155";
    ctx.beginPath();
    ctx.arc(0, 0, ARENA_R, 0, Math.PI * 2);
    ctx.fill();
    s.spinners.forEach((sp, i) => {
      if (sp.out) return;
      ctx.fillStyle = label(p, i, n).color;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, SPIN_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, SPIN_R * (sp.spin / 100), 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.restore();
  }, [view, n, p, size]);
  const mine = view.spinners[p.seat];
  return (
    <div data-game-board="spinnerwars" className="flex flex-col items-center gap-2">
      <div className="flex flex-wrap justify-center gap-x-3 text-[12.5px] font-semibold" data-live-score>
        {(rec?.out ?? []).map((o, i) => (
          <span key={i} className={`inline-flex items-center gap-1 ${o ? "line-through opacity-50" : ""}`}>
            <span className="g3-token h-2.5 w-2.5 rounded-full" style={{ backgroundColor: label(p, i, n).color }} /> {label(p, i, n).name} {view.wins[i] ?? 0}
          </span>
        ))}
        <span className="text-slate-400 font-normal">round {view.round}/3</span>
      </div>
      <canvas
        ref={canvas}
        data-live-canvas
        width={size * scale}
        height={size * scale}
        className="rounded-full shadow-lg touch-none"
        onPointerMove={(e) => {
          if (!mine || mine.out) return;
          const r = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - r.left) / r.width) * size - size / 2;
          const y = ((e.clientY - r.top) / r.height) * size - size / 2;
          setInput({ x: x - mine.x, y: y - mine.y });
        }}
        onPointerLeave={() => setInput(null)}
      />
      <div className="text-[11px] text-slate-500">Your spinner chases the mouse. Bump the others out; the ring around a spinner is its spin left.</div>
    </div>
  );
}
