// The three real-time games. The host's PC runs the physics (lib/games/sim)
// and streams snapshots over a data channel (lib/gameChannel.ts); the
// others send their pointer and keys. Goals and knock-outs are written as
// moves by the host so the match keeps score.
// LANX 2.17.0: each match round has one live session on a PC, shared by every
// board showing it (the flat one, the 3D one, the hidden copy that keeps a
// host's table going): one simulation, one channel, one loop. A new round
// (a rematch) is a new session; a session starts from the recorded score;
// the loop stops at the end; the relay is fed by sequence number.
import { useEffect, useMemo, useRef, useState } from "react";
import { sfx } from "../../../lib/gameSounds";
import { namesIn, seatFor, type BoardProps } from "../boardProps";
import { GameChannel } from "../../../lib/gameChannel";
import { airhockey, foosball, spinnerChampion, spinnerWars, type RealtimeState } from "../../../lib/games/realtime.ts";
import { AH_H, AH_W, GOAL_W, PADDLE_R, PUCK_R, ahStart, ahStep, type AHState } from "../../../lib/games/sim/airhockey.ts";
import { BALL_R, FB_H, FB_W, GOAL_H, MAN_H, MAN_W, RODS, fbStart, fbStep, menOf, type FBInput, type FBState } from "../../../lib/games/sim/foosball.ts";
import { ARENA_R, SPIN_R, spinReset, spinStart, spinStep, type SpinState } from "../../../lib/games/sim/spinner.ts";
import { hostName } from "./PartyShell";

type Post = (move: string) => void;

/** How a live game runs: where it starts (from the record), one step, and what goes over the wire. */
export interface LiveSpec<S, I> {
  start: () => S;
  step: (s: S, inputs: (I | null)[], post: Post) => void;
  snapshot: (s: S) => unknown;
  restore: (snap: unknown) => S;
  /** The record says the game is over: stop running it. */
  over: boolean;
}

type Hooks<S, I> = { spec: LiveSpec<S, I>; onMove: Post; onDelta?: (d: unknown) => void };

const sessions = new Map<string, LiveSession<unknown, unknown>>();

/** One match round's live game on this PC. */
class LiveSession<S, I> {
  view: S;
  /** A guest has had a snapshot from the host. */
  ready: boolean;
  myInput: I | null = null;
  readonly channel: GameChannel | null = null;
  private sim: S | null = null;
  private inputs: (I | null)[];
  private ended = false;
  private subs = new Map<(v: S) => void, { current: Hooks<S, I> }>();
  private last: { current: Hooks<S, I> };
  private timers: number[] = [];
  private bye = 0;
  private seen = new Set<string>();
  private seenObj = new WeakSet<object>();
  private nonce = Math.random().toString(36).slice(2, 8);
  private sent = 0;

  constructor(
    readonly key: string,
    readonly cfg: { host: boolean; local: boolean; seat: number; n: number },
    hooks: { current: Hooks<S, I> },
    existing: unknown[],
  ) {
    this.last = hooks;
    this.inputs = Array(cfg.n).fill(null);
    this.view = hooks.current.spec.start();
    this.ready = cfg.host || cfg.local;
    if (!cfg.local) {
      // The host's new channel never takes an answer meant for an earlier one.
      if (cfg.host) for (const d of existing) this.mark(d);
      const players = Array.from({ length: cfg.n }, (_, i) => i);
      this.channel = new GameChannel({ me: cfg.seat, host: cfg.host, players, sendDelta: (d) => this.hooks().onDelta?.({ ...(d as object), seq: `${this.nonce}.${++this.sent}` }) });
      this.channel.onMessage((from, data) => {
        const d = data as { t?: string; i?: I; s?: unknown } | null;
        if (!d) return;
        if (d.t === "i" && cfg.host) {
          if (from >= 0 && from < cfg.n) this.inputs[from] = d.i ?? null;
        } else if (d.t === "s" && !cfg.host && d.s !== undefined) {
          this.view = this.hooks().spec.restore(d.s);
          this.ready = true;
          this.emit();
        }
      });
    }
    if (cfg.host || cfg.local) {
      this.sim = hooks.current.spec.start();
      let tick = 0;
      this.timers.push(
        window.setInterval(() => {
          const s = this.sim;
          // Paused while no board shows it (a board closing, the next one opening), stopped at the end.
          if (!s || !this.subs.size || this.ended || this.hooks().spec.over) return;
          const ins = this.inputs.map((x, i) => (i === cfg.seat ? this.myInput : x));
          this.hooks().spec.step(s, ins, (m) => {
            if (this.ended) return;
            if (m.startsWith("end:")) this.ended = true;
            this.hooks().onMove(m);
          });
          if (++tick % 2 === 0 || this.ended) {
            this.view = { ...(s as object) } as S;
            this.emit();
            if (!cfg.local) this.channel?.send({ t: "s", s: this.hooks().spec.snapshot(s) });
          }
        }, 16),
      );
    } else {
      this.timers.push(
        window.setInterval(() => {
          if (this.myInput && this.subs.size) this.channel?.send({ t: "i", i: this.myInput });
        }, 33),
      );
    }
  }
  private hooks(): Hooks<S, I> {
    const any = this.subs.values().next().value as { current: Hooks<S, I> } | undefined;
    return (any ?? this.last).current;
  }
  private emit() {
    for (const fn of this.subs.keys()) fn(this.view);
  }
  /** Seen this delta before? (By its sequence number; the relay keeps only the last 600.) */
  private mark(d: unknown): boolean {
    if (!d || typeof d !== "object") return true;
    const seq = (d as { seq?: unknown }).seq;
    if (typeof seq === "string") {
      if (this.seen.has(seq)) return true;
      this.seen.add(seq);
      if (this.seen.size > 5000) this.seen = new Set([...this.seen].slice(-2500));
      return false;
    }
    if (this.seenObj.has(d)) return true;
    this.seenObj.add(d);
    return false;
  }
  feed(ds: readonly unknown[]) {
    if (!this.channel) return;
    for (const d of ds) if (!this.mark(d)) this.channel.feed(d);
  }
  attach(fn: (v: S) => void, hooks: { current: Hooks<S, I> }) {
    window.clearTimeout(this.bye);
    this.subs.set(fn, hooks);
    this.last = hooks;
  }
  detach(fn: (v: S) => void) {
    this.subs.delete(fn);
    if (this.subs.size) return;
    // Give the next board (the hidden copy taking over, the 3D board after the flat one) a moment.
    window.clearTimeout(this.bye);
    this.bye = window.setTimeout(() => this.close(), 2500);
  }
  private close() {
    if (this.subs.size) return;
    for (const t of this.timers) window.clearInterval(t);
    this.channel?.close();
    if (sessions.get(this.key) === (this as unknown)) sessions.delete(this.key);
  }
}

/** The live session for this board's match round: the view to draw and where to put this player's input. */
export function useLive<S, I>(p: BoardProps, game: string, spec: LiveSpec<S, I>) {
  const n = Math.max(2, p.seats?.length ?? 2);
  const key = `${game}|${p.seed ?? ""}|${p.local ? "local" : p.host ? "host" : "guest"}|${p.seat}|${n}`;
  const hooks = useRef<Hooks<S, I>>({ spec, onMove: p.onMove, onDelta: p.onDelta });
  hooks.current = { spec, onMove: p.onMove, onDelta: p.onDelta };
  const session = useRef<LiveSession<S, I> | null>(null);
  const [view, setView] = useState<S>(() => (sessions.get(key) as LiveSession<S, I> | undefined)?.view ?? spec.start());
  const [ready, setReady] = useState(!!p.host || !!p.local);
  const deltas = useRef(p.deltas ?? []);
  deltas.current = p.deltas ?? [];
  useEffect(() => {
    let s = sessions.get(key) as LiveSession<S, I> | undefined;
    if (!s) {
      s = new LiveSession<S, I>(key, { host: !!p.host, local: !!p.local, seat: p.seat, n }, hooks, deltas.current);
      sessions.set(key, s as LiveSession<unknown, unknown>);
    }
    const mine = s;
    const fn = (v: S) => {
      setView(v);
      setReady(mine.ready);
    };
    mine.attach(fn, hooks);
    session.current = mine;
    setView(mine.view);
    setReady(mine.ready);
    mine.feed(deltas.current);
    return () => {
      mine.detach(fn);
      if (session.current === mine) session.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // Feed new deltas to the channel (offers, answers, relayed messages) — each one once.
  useEffect(() => {
    session.current?.feed(p.deltas ?? []);
  }, [p.deltas]);
  const setInput = useRef((i: I | null) => {
    if (session.current) session.current.myInput = i;
  }).current;
  return { view, setInput, n, ready, live: session.current?.channel?.live ?? false };
}

export const label = (p: BoardProps, i: number, n: number) => seatFor(p.seats, p.starter ?? 0, i, n);
const short = (p: BoardProps, i: number, n: number) => label(p, i, n).name.split(" (")[0];

/** LANX 2.17.0: what's happening, in words, for the live boards (flat and 3D). */
export function liveStatus(p: BoardProps, rec: RealtimeState | null, n: number, ready: boolean, now: { pause: number; round?: number; meOut?: boolean }): string {
  if (rec?.winner !== null && rec?.winner !== undefined) return `Game over — ${short(p, rec.winner, n)} wins${rec.reason ? ` (${namesIn(rec.reason, p.seats, p.starter ?? 0, n)})` : ""}`;
  if (!ready) return `Waiting for ${hostName(p.seats)}'s table to start…`;
  if (now.round !== undefined) {
    if (now.meOut) return `Round ${now.round} — you're out, watching`;
    return now.pause > 0 ? `Round ${now.round} — get ready…` : `Round ${now.round} — bump the others out`;
  }
  return now.pause > 0 ? "Get ready — the ball's coming" : "Play on — first to 5";
}

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
  const recRef = useRef(rec);
  recRef.current = rec;
  const live = useLive<AHState, { x: number; y: number }>(p, "airhockey", {
    start: () => ahStart(recRef.current?.goals),
    step: (s, ins, post) => {
      const g = ahStep(s, ins);
      if (g >= 0) {
        post(`g:${g}`);
        if (s.goals[g] >= 5) post(`end:${g}`);
      }
    },
    snapshot: (s) => ({ puck: s.puck, paddles: s.paddles, goals: s.goals, pause: s.pause }),
    restore: (snap) => ({ ...(snap as AHState), lastGoal: -1 }),
    over: rec?.winner !== null && rec?.winner !== undefined,
  });
  useArcadeSfx(live.view.goals, live.view.puck);
  const status = liveStatus(p, rec, 2, live.ready, { pause: live.view.pause });
  return { rec, status, ...live };
}

export function AirHockeyBoard(p: BoardProps) {
  const { rec, view, setInput, status } = useAirHockey(p);
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
      <div className="text-[12px] text-slate-500" data-live-status>
        {status}
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
  const recRef = useRef(rec);
  recRef.current = rec;
  const rod = useRef(2);
  const pointerY = useRef(FB_H / 2);
  const kick = useRef(false);
  const live = useLive<FBState, FBInput>(p, "foosball", {
    start: () => fbStart(recRef.current?.goals),
    step: (s, ins, post) => {
      const g = fbStep(s, ins);
      if (g >= 0) {
        post(`g:${g}`);
        if (s.goals[g] >= 5) post(`end:${g}`);
      }
    },
    snapshot: (s) => ({ ball: s.ball, rodY: s.rodY, kick: s.kick, goals: s.goals, pause: s.pause }),
    restore: (snap) => ({ ...(snap as FBState), lastGoal: -1, slow: 0, serves: 0 }),
    over: rec?.winner !== null && rec?.winner !== undefined,
  });
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
  const status = liveStatus(p, rec, 2, live.ready, { pause: live.view.pause });
  return { rec, status, ...live, side, rod, pickRod, moveTo, kickNow };
}

export function FoosballBoard(p: BoardProps) {
  const { rec, view, side, rod, pickRod, moveTo, status } = useFoosball(p);
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
      <div className="text-[12px] text-slate-500" data-live-status>
        {status}
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
  const recRef = useRef(rec);
  recRef.current = rec;
  const live = useLive<SpinState, { x: number; y: number }>(p, "spinnerwars", {
    start: () => spinStart(n, recRef.current ?? undefined),
    step: (s, ins, post) => {
      // Whoever left the table stays out (the record already says so: no "out:" for them).
      const left = recRef.current?.left ?? [];
      left.forEach((l, i) => l && s.spinners[i] && (s.spinners[i].out = true));
      for (const o of spinStep(s, ins)) post(`out:${o}`);
      if (s.pause > 0) return;
      const alive = s.spinners.map((sp, i) => (sp.out ? -1 : i)).filter((i) => i >= 0);
      if (alive.length > 1) return;
      if (alive.length === 1) s.wins[alive[0]]++;
      // First to two round wins; after three rounds the most round wins — and while that's a tie, play on.
      const champ = spinnerChampion(s.wins, s.round, left);
      if (champ !== null) post(`end:${champ}`);
      else {
        post("round");
        spinReset(s);
        left.forEach((l, i) => l && s.spinners[i] && (s.spinners[i].out = true));
      }
    },
    snapshot: (s) => ({ spinners: s.spinners, round: s.round, pause: s.pause, wins: s.wins }),
    restore: (snap) => snap as SpinState,
    over: rec?.winner !== null && rec?.winner !== undefined,
  });
  useArcadeSfx(live.view.wins, null, live.view.spinners.filter((x) => x.out).length);
  const status = liveStatus(p, rec, n, live.ready, { pause: live.view.pause, round: live.view.round, meOut: !!live.view.spinners[p.seat]?.out });
  return { rec, status, ...live };
}

export function SpinnerBoard(p: BoardProps) {
  const { rec, n, view, setInput, status } = useSpinner(p);
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
            {rec?.left[i] && <span className="font-normal text-slate-400">(left)</span>}
          </span>
        ))}
        <span className="text-slate-400 font-normal">round wins · first to 2</span>
      </div>
      <div className="text-[12px] text-slate-500" data-live-status>
        {status}
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
      <div className="text-[11px] text-slate-500">Your spinner chases the mouse. Bump the others out; the ring around a spinner is its spin left. First to win two rounds; a tie at the top plays on.</div>
    </div>
  );
}
