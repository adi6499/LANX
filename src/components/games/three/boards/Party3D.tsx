// LANX 2.16.0: the party games' 3D presentation. Trivia Night and Math Rush
// show each question on a card that swings in, with answer tiles you press
// down, a countdown ring, the right answer revealed when the round closes
// and score bars that race. Werewolf plays under a sky that turns from day
// to night (moon and sun crossing), with role cards that flip over and the
// votes counted on each player. Draw & Guess puts the drawing on an easel
// for the guessers, draws the strokes smoothly as they arrive, and shows the
// word as letter boxes. Rules, timers, rooms and scoring are the same code
// as before (lib/games/party, werewolf, drawguess; boards/PartyShell).

import { useEffect, useMemo, useRef, useState } from "react";
import { seatFor, type BoardProps } from "../../boardProps";
import { mathRush, trivia, type MathExtra, type TriviaQ } from "../../../../lib/games/party.ts";
import { drawGuess, type DrawExtra } from "../../../../lib/games/drawguess.ts";
import { PartyShell, useClock } from "../../boards/PartyShell";
import { ROLE_TEXT, useWerewolf } from "../../boards/WerewolfBoard";
import { SeatDot } from "../ui";
import "../party3d.css";

/** Everyone's score as a bar that grows (the leader's is full). */
function ScoreBars({ scores, name, colour, me }: { scores: number[]; name: (p: number) => string; colour: (p: number) => string; me: number }) {
  const top = Math.max(1, ...scores);
  return (
    <div className="flex w-full max-w-[420px] flex-col gap-1" data-p3-scores>
      {scores.map((s, p) => (
        <div key={p} className="flex items-center gap-2 text-[11.5px]">
          <span className={`w-24 truncate ${p === me ? "font-bold" : ""}`}>{name(p)}</span>
          <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-500/15">
            <span className="p3-bar block h-full rounded-full" style={{ width: `${Math.max(3, (s / top) * 100)}%`, backgroundColor: colour(p) }} />
          </span>
          <span className="w-8 text-right tabular-nums font-semibold">{s}</span>
        </div>
      ))}
    </div>
  );
}

/** The round's clock as a ring that runs down. */
function Ring({ deadline, open, seconds }: { deadline: number; open: boolean; seconds: number }) {
  const left = useClock(deadline, open);
  const r = 22;
  const c = 2 * Math.PI * r;
  const frac = open ? Math.max(0, Math.min(1, left / seconds)) : 0;
  return (
    <svg className="p3-ring" width={56} height={56} viewBox="0 0 56 56" data-p3-ring={left}>
      <circle cx={28} cy={28} r={r} fill="none" stroke="rgba(100,116,139,0.2)" strokeWidth={5} />
      <circle className="p3-ring-left" cx={28} cy={28} r={r} fill="none" stroke={left <= 5 ? "#f43f5e" : "#6366f1"} strokeWidth={5} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} transform="rotate(-90 28 28)" />
      <text x={28} y={33} textAnchor="middle" fontSize={15} fontWeight={800} fill="currentColor">
        {open ? left : ""}
      </text>
    </svg>
  );
}

// ============================================================ Trivia Night

export function Trivia3D({ moves, canPlay, seat, seats, starter = 0, seed = "", host, onMove }: BoardProps) {
  const n = Math.max(2, seats?.length ?? 2);
  const state = useMemo(() => trivia.replay(moves, n, seed), [moves, n, seed]);
  const name = (p: number) => seatFor(seats, starter, p, n).name;
  const colour = (p: number) => seatFor(seats, starter, p, n).color;
  const q = state?.extra as TriviaQ | null;
  const mine = state?.answers.find((a) => a.player === seat);
  // Keys 1–4 answer.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!state?.open || !q || mine || !canPlay) return;
      const k = Number(e.key) - 1;
      if (k >= 0 && k < q.options.length) onMove(`${seat}@a:${k}`);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [state?.open, q, mine, canPlay, onMove, seat]);
  if (!state) return null;
  const reveal = !state.open && state.round > 0 && !!q;
  return (
    <PartyShell state={state} rounds={10} seconds={20} host={!!host} seats={seats} starter={starter} n={n} allIn={state.answers.length >= n} onMove={onMove} testId="trivia">
      <div className="p3-scene flex w-full max-w-[560px] flex-col items-center gap-3" data-g3-board="trivia">
        {q && (state.open || reveal) ? (
          <>
            <div key={state.round} className="p3-card w-full rounded-2xl bg-white px-5 py-4 text-center dark:bg-slate-800">
              <div className="mb-1 text-[10.5px] font-bold uppercase tracking-wider text-indigo-500">Question {state.round}</div>
              <div className="text-[17px] font-bold" data-trivia-question>
                {q.q}
              </div>
            </div>
            <div className="flex w-full items-center gap-3">
              <div className="grid flex-1 grid-cols-2 gap-2">
                {q.options.map((o, i) => {
                  const chosen = !!mine && Number(mine.text) === i;
                  const cls = reveal ? (i === q.a ? "p3-right" : chosen ? "p3-wrong" : "opacity-60") : "";
                  return (
                    <button key={i} type="button" data-trivia-option={i} data-p3-chosen={chosen ? "" : undefined} disabled={!canPlay || !!mine || !state.open} onClick={() => onMove(`${seat}@a:${i}`)} className={`p3-tile rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold ${chosen ? "bg-indigo-600 text-white" : "bg-white text-slate-900 dark:bg-slate-800 dark:text-white"} ${cls}`}>
                      <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-500/15 text-[11px]">{i + 1}</span>
                      {o}
                    </button>
                  );
                })}
              </div>
              {state.open && <Ring deadline={state.deadline} open={state.open} seconds={20} />}
            </div>
            <div className="flex items-center gap-1.5 text-[11.5px] text-slate-500" data-trivia-answered>
              {state.answers.map((a) => (
                <SeatDot key={a.player} color={colour(a.player)} size={10} />
              ))}
              <span>
                {state.answers.length} of {n} answered{reveal ? ` · the answer: ${q.options[q.a]}` : ""}
              </span>
            </div>
          </>
        ) : (
          <div className="text-[13px] text-slate-500">Ten questions, four options each. Right: 10 points; first right: 15. Keys 1–4 answer.</div>
        )}
        <ScoreBars scores={state.scores} name={name} colour={colour} me={seat} />
      </div>
    </PartyShell>
  );
}

// ============================================================ Math Rush

export function MathRush3D({ moves, canPlay, seat, seats, starter = 0, seed = "", host, onMove }: BoardProps) {
  const n = Math.max(2, seats?.length ?? 2);
  const state = useMemo(() => mathRush.replay(moves, n, seed), [moves, n, seed]);
  const [text, setText] = useState("");
  useEffect(() => setText(""), [state?.round]);
  const name = (p: number) => seatFor(seats, starter, p, n).name;
  const colour = (p: number) => seatFor(seats, starter, p, n).color;
  if (!state) return null;
  const q = state.extra as MathExtra | null;
  const mine = state.answers.find((a) => a.player === seat);
  const reveal = !state.open && state.round > 0 && !!q;
  const send = () => {
    if (!text.trim()) return;
    onMove(`${seat}@a:${text.trim()}`);
  };
  const press = (k: string) => {
    if (!canPlay || mine || !state.open) return;
    if (k === "⌫") setText((t) => t.slice(0, -1));
    else if (k === "⏎") send();
    else setText((t) => (t.length < 4 ? t + k : t));
  };
  const firstRight = q ? state.answers.find((a) => Number(a.text) === q.answer) : undefined;
  return (
    <PartyShell state={state} rounds={10} seconds={15} host={!!host} seats={seats} starter={starter} n={n} allIn={state.answers.length >= n} onMove={onMove} testId="mathrush">
      <div className="p3-scene flex w-full max-w-[520px] flex-col items-center gap-3" data-g3-board="mathrush">
        {q && (state.open || reveal) ? (
          <div className="flex items-center gap-4">
            <div key={state.round} className={`p3-card rounded-2xl bg-white px-6 py-4 text-center dark:bg-slate-800 ${reveal ? (mine && Number(mine.text) === q.answer ? "ring-4 ring-emerald-400" : mine ? "ring-4 ring-rose-400" : "") : ""}`}>
              <div className="text-[36px] font-black tracking-wide tabular-nums" data-math-question>
                {q.question} = {reveal ? q.answer : state.open ? (mine ? mine.text : text || "?") : "?"}
              </div>
              {reveal && <div className="text-[12px] text-slate-500">{firstRight ? `${name(firstRight.player)} was first` : "nobody got it"}</div>}
              {state.open && mine && (
                <div className="text-[13px] font-semibold text-emerald-600" data-math-sent>
                  Sent — waiting for the others
                </div>
              )}
            </div>
            {state.open && <Ring deadline={state.deadline} open={state.open} seconds={15} />}
          </div>
        ) : (
          <div className="text-[13px] text-slate-500">Ten quick sums. First right answer: 3 points; others right: 1.</div>
        )}
        {state.open && q && !mine && (
          <div className="flex flex-col items-center gap-2">
            <input data-math-input type="number" value={text} disabled={!canPlay} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} className="w-36 rounded-lg border border-slate-300 px-3 py-1.5 text-center text-[16px] dark:border-slate-600 dark:bg-slate-800" autoFocus />
            <div className="grid grid-cols-4 gap-1.5" data-math-keypad>
              {["7", "8", "9", "⌫", "4", "5", "6", "0", "1", "2", "3", "⏎"].map((k) => (
                <button key={k} type="button" data-math-key={k} onClick={() => press(k)} className={`p3-key h-10 w-12 rounded-xl text-[16px] font-bold ${k === "⏎" ? "bg-indigo-600 text-white" : "bg-white text-slate-900 dark:bg-slate-800 dark:text-white"}`}>
                  {k}
                </button>
              ))}
            </div>
            <button type="button" data-math-send disabled={!canPlay} onClick={send} className="sr-only">
              Answer
            </button>
          </div>
        )}
        <ScoreBars scores={state.scores} name={name} colour={colour} me={seat} />
      </div>
    </PartyShell>
  );
}

// ============================================================ Werewolf

export function Werewolf3D(p: BoardProps) {
  const { state, n, name, colour, myRole, peeks, left, start, attack, peekAt, vote, done, canPlay, seat, host } = useWerewolf(p);
  const [roleOpen, setRoleOpen] = useState(false);
  useEffect(() => setRoleOpen(false), [myRole?.role]);
  const stars = useMemo(() => Array.from({ length: 26 }, (_, i) => ({ left: `${(i * 37) % 100}%`, top: `${(i * 23) % 60}%` })), []);
  if (!state) return null;
  const alive = state.alive;
  const iAmAlive = alive[seat];
  const votesFor = (q: number) => Object.values(state.votes).filter((v) => v === q).length;
  const myVote = state.votes[seat];
  const acting = state.phase === "night" ? iAmAlive && (myRole?.role === "wolf" || myRole?.role === "seer") : state.phase === "day" && iAmAlive;
  const pick = (q: number) => {
    if (state.phase === "night") (myRole?.role === "wolf" ? attack : peekAt)(q);
    else vote(q);
  };
  return (
    <div data-game-board="werewolf" data-g3-board="werewolf" data-ww-phase={state.phase} className="flex w-full max-w-[680px] flex-col items-center gap-3">
      <div className="p3-sky w-full rounded-2xl px-4 pb-4 pt-16" data-p3-sky={state.phase}>
        <span className="p3-moon" />
        <span className="p3-sun" />
        {stars.map((s, i) => (
          <span key={i} className="p3-star" style={s} />
        ))}
        <div className="relative text-center text-[15px] font-bold">
          {state.phase === "lobby" ? "The village gathers" : state.phase === "night" ? `Night ${state.round} · ${left}s` : state.phase === "day" ? `Day ${state.round} · ${left}s · ${Object.keys(state.votes).length} of ${alive.filter(Boolean).length} voted` : state.winner === "village" ? "The village wins" : "The werewolves win"}
        </div>
        <div className="relative mt-3 flex flex-wrap justify-center gap-2" data-ww-players>
          {alive.map((a, q) => {
            const can = acting && a && q !== seat && canPlay && !done && !(state.phase === "day" && myVote !== undefined);
            return (
              <button
                key={q}
                type="button"
                data-ww-player={q}
                data-ww-alive={a ? "1" : undefined}
                data-ww-target={can ? q : undefined}
                disabled={!can}
                onClick={() => pick(q)}
                className={`relative flex w-[92px] flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[11.5px] font-semibold transition-transform ${a ? "bg-white/90 text-slate-900 shadow" : "p3-out bg-white/40 text-slate-500"} ${can ? "cursor-pointer hover:-translate-y-0.5" : "cursor-default"} ${myVote === q ? "ring-2 ring-indigo-500" : ""}`}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full text-[17px] text-white" style={{ backgroundColor: colour(q) }}>
                  {a ? name(q).slice(0, 1).toUpperCase() : "✕"}
                </span>
                <span className="w-full truncate text-center">{name(q)}</span>
                {state.roles && <span className="text-[10px] text-slate-500">{state.roles[q]}</span>}
                {state.phase === "day" && votesFor(q) > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[10.5px] text-white" data-ww-votes={q}>
                    {votesFor(q)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      {myRole && state.phase !== "lobby" && (
        <button type="button" onClick={() => setRoleOpen((o) => !o)} className="p3-scene" data-ww-role={myRole.role} aria-label="Your role card (click to turn over)">
          <div className="p3-flip relative h-[88px] w-[300px]" data-p3-open={roleOpen ? "" : undefined}>
            <div className="p3-face absolute inset-0 flex items-center justify-center rounded-2xl bg-indigo-700 text-[13px] font-semibold text-white shadow-lg">Your role — click to look (keep it to yourself)</div>
            <div className="p3-face p3-face-back absolute inset-0 flex flex-col items-center justify-center rounded-2xl bg-amber-50 px-3 text-[12.5px] text-amber-900 shadow-lg">
              <div>{ROLE_TEXT[myRole.role]}</div>
              {myRole.role === "wolf" && myRole.wolves.length > 1 && <div>Your pack: {myRole.wolves.filter((q) => q !== seat).map(name).join(", ")}.</div>}
              {peeks.length > 0 && <div className="mt-0.5">Peeks: {peeks.map((x) => `${name(x.target)} is ${x.wolf ? "a werewolf" : "not a werewolf"}`).join("; ")}</div>}
            </div>
          </div>
        </button>
      )}
      {state.phase === "lobby" &&
        (host ? (
          <button type="button" data-ww-start onClick={start} className="rounded-full bg-indigo-600 px-5 py-2 text-[13px] font-semibold text-white">
            Deal roles & start the first night
          </button>
        ) : (
          <div className="text-[13px] text-slate-500">Waiting for the host to deal the roles…</div>
        ))}
      {state.phase === "lobby" && <div className="text-[12px] text-slate-500">{n} players: {Math.max(1, Math.floor(n / 4))} werewolf{Math.floor(n / 4) > 1 ? "s" : ""}, a seer, villagers.</div>}
      {state.phase === "night" && <div className="text-[12.5px] text-slate-500" data-ww-night>{acting ? (done ? "Done — wait for the dawn." : myRole?.role === "wolf" ? "Pick your victim above." : "Pick someone to peek at above.") : "The village sleeps…"}</div>}
      {state.phase === "day" && (
        <div className="flex items-center gap-2 text-[12.5px]" data-ww-day>
          {iAmAlive ? (
            <>
              <span className="text-slate-500">{myVote !== undefined ? "Vote cast." : "Click a player to vote them out."}</span>
              <button type="button" data-ww-skip disabled={!canPlay || myVote !== undefined} onClick={() => vote("skip")} className="rounded-full bg-slate-500/10 px-3 py-1 text-[12px] font-semibold disabled:opacity-50">
                Skip this vote
              </button>
            </>
          ) : (
            <span className="text-slate-500">You are out — watch and whisper nothing.</span>
          )}
        </div>
      )}
      <div className="max-w-full text-center text-[11.5px] text-slate-600 dark:text-slate-300" data-ww-log>
        {state.log.slice(-3).map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  );
}

// ============================================================ Draw & Guess

const DW = 520;
const DH = 340;
const INK = ["#0f172a", "#dc2626", "#2563eb", "#16a34a", "#f59e0b", "#9333ea"];
type Stroke = { kind: "stroke"; pts: [number, number][]; c: string; w: number; round: number; __from?: number };
type Clear = { kind: "clear"; round: number; __from?: number };

/** A smooth line through the points (curves between midpoints). */
function smooth(ctx: CanvasRenderingContext2D, pts: [number, number][], upto = pts.length) {
  const p = pts.slice(0, Math.max(1, upto));
  ctx.beginPath();
  ctx.moveTo(p[0][0], p[0][1]);
  if (p.length === 1) ctx.lineTo(p[0][0] + 0.1, p[0][1]);
  for (let i = 1; i < p.length - 1; i++) {
    const mx = (p[i][0] + p[i + 1][0]) / 2;
    const my = (p[i][1] + p[i + 1][1]) / 2;
    ctx.quadraticCurveTo(p[i][0], p[i][1], mx, my);
  }
  if (p.length > 1) ctx.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
  ctx.stroke();
}

export function DrawGuess3D({ moves, canPlay, seat, seats, starter = 0, seed = "", host, deltas = [], onDelta, onMove }: BoardProps) {
  const n = Math.max(2, seats?.length ?? 2);
  const state = useMemo(() => drawGuess.replay(moves, n, seed), [moves, n, seed]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<[number, number][] | null>(null);
  const shownStrokes = useRef(0);
  const [colour, setColour] = useState(INK[0]);
  const [width, setWidth] = useState(4);
  const [guess, setGuess] = useState("");
  const extra = state?.extra as DrawExtra | null;
  const iDraw = !!extra && extra.drawer === seat;
  const round = state?.round ?? 0;
  // Only the drawer's strokes count (the match stamps who sent each one).
  const strokes = useMemo(() => {
    const mine = (deltas as (Stroke | Clear)[]).filter((d) => d && typeof d === "object" && "round" in d && d.round === round && (typeof d.__from !== "number" || !extra || d.__from === extra.drawer));
    let from = 0;
    mine.forEach((d, i) => {
      if (d.kind === "clear") from = i + 1;
    });
    return mine.slice(from).filter((d): d is Stroke => d.kind === "stroke" && d.pts.length > 0);
  }, [deltas, round, extra]);
  // Paint: everything already shown at once, new strokes drawn on smoothly (for the guessers).
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const paintAll = (upto: number) => {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, DW, DH);
      strokes.slice(0, upto).forEach((d) => {
        ctx.strokeStyle = d.c;
        ctx.lineWidth = d.w;
        smooth(ctx, d.pts);
      });
    };
    if (strokes.length < shownStrokes.current || iDraw) {
      paintAll(strokes.length);
      shownStrokes.current = strokes.length;
      return;
    }
    paintAll(shownStrokes.current);
    const fresh = strokes.slice(shownStrokes.current);
    shownStrokes.current = strokes.length;
    if (!fresh.length) return;
    let raf = 0;
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 180);
      paintAll(strokes.length - fresh.length);
      fresh.forEach((d) => {
        ctx.strokeStyle = d.c;
        ctx.lineWidth = d.w;
        smooth(ctx, d.pts, Math.max(1, Math.round(d.pts.length * k)));
      });
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [strokes, iDraw]);
  useEffect(() => {
    setGuess("");
    shownStrokes.current = 0;
  }, [round]);
  if (!state) return null;
  const name = (p: number) => seatFor(seats, starter, p, n).name;
  const guessedBy = extra?.guessedBy;
  const right = state.open && extra ? state.answers.some((a) => a.text.trim().toLowerCase() === extra.word) : false;
  const pos = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = canvas.current!.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * DW), Math.round(((e.clientY - r.top) / r.height) * DH)];
  };
  const flush = () => {
    const pts = drawing.current;
    if (!pts || !pts.length) return;
    onDelta?.({ kind: "stroke", pts, c: colour, w: width, round } satisfies Stroke);
    drawing.current = [pts[pts.length - 1]];
  };
  const sendGuess = () => {
    if (!guess.trim()) return;
    onMove(`${seat}@a:${guess.trim()}`);
    setGuess("");
  };
  return (
    <PartyShell state={state} rounds={8} seconds={75} host={!!host} seats={seats} starter={starter} n={n} allIn={right} onMove={onMove} testId="drawguess" roundLabel={state.open && extra ? `Round ${state.round}: ${name(extra.drawer)} draws` : undefined}>
      {state.open && extra ? (
        <div className="flex flex-wrap items-start justify-center gap-5" data-g3-board="drawguess">
          <div className="p3-scene flex flex-col items-center gap-2">
            {iDraw ? (
              <div className="text-[13px] font-semibold" data-draw-word>
                Draw: <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-amber-800 dark:text-amber-200">{extra.word}</span>
              </div>
            ) : (
              <div className="flex items-center gap-1" data-draw-hint>
                {extra.word.split("").map((ch, i) => (ch === " " ? <span key={i} className="w-3" /> : <span key={i} className="h-6 w-5 border-b-2 border-slate-400" />))}
                <span className="ml-2 text-[12px] text-slate-500">{extra.word.replace(/ /g, "").length} letters</span>
              </div>
            )}
            <canvas
              ref={canvas}
              data-draw-canvas
              width={DW}
              height={DH}
              className={`w-full max-w-[520px] rounded-lg bg-white ${iDraw ? "shadow ring-1 ring-black/10" : "p3-easel"} ${iDraw && canPlay ? "cursor-crosshair touch-none" : ""}`}
              onPointerDown={(e) => {
                if (!iDraw || !canPlay) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                drawing.current = [pos(e)];
                flush();
              }}
              onPointerMove={(e) => {
                if (!drawing.current) return;
                drawing.current.push(pos(e));
                // Draw your own line at once (smoothly); send it in pieces.
                const ctx = canvas.current?.getContext("2d");
                if (ctx && drawing.current.length >= 2) {
                  ctx.strokeStyle = colour;
                  ctx.lineWidth = width;
                  ctx.lineCap = "round";
                  smooth(ctx, drawing.current.slice(-3));
                }
                if (drawing.current.length >= 12) flush();
              }}
              onPointerUp={() => {
                flush();
                drawing.current = null;
              }}
            />
            {iDraw && (
              <div className="flex items-center gap-1.5" data-draw-tools>
                {INK.map((c) => (
                  <button key={c} type="button" onClick={() => setColour(c)} className={`h-6 w-6 rounded-full transition-transform ${colour === c ? "scale-110 ring-2 ring-indigo-500 ring-offset-2" : ""}`} style={{ backgroundColor: c }} />
                ))}
                {[3, 6, 12].map((w) => (
                  <button key={w} type="button" onClick={() => setWidth(w)} className={`h-6 rounded-full px-2 text-[11px] font-semibold ${width === w ? "bg-indigo-600 text-white" : "bg-slate-500/10"}`}>
                    {w === 3 ? "thin" : w === 6 ? "mid" : "thick"}
                  </button>
                ))}
                <button type="button" data-draw-clear onClick={() => onDelta?.({ kind: "clear", round } satisfies Clear)} className="h-6 rounded-full bg-rose-500/10 px-2 text-[11px] font-semibold text-rose-700">
                  Clear
                </button>
              </div>
            )}
          </div>
          <div className="flex w-[210px] flex-col gap-2">
            {!iDraw && (
              <div className="flex items-center gap-1.5">
                <input data-draw-guess value={guess} disabled={!canPlay || right} onChange={(e) => setGuess(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendGuess()} placeholder="your guess" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-[13px] dark:border-slate-600 dark:bg-slate-800" autoFocus />
                <button type="button" data-draw-send disabled={!canPlay || right} onClick={sendGuess} className="rounded-full bg-indigo-600 px-3 py-1.5 text-[12.5px] font-semibold text-white">
                  Go
                </button>
              </div>
            )}
            <div className="flex flex-col gap-1 text-[12px]" data-draw-guesses>
              {state.answers.slice(-7).map((a, i) => {
                const hit = a.text.trim().toLowerCase() === extra.word;
                return (
                  <div key={`${state.answers.length}-${i}`} className={`p3-guess rounded-lg px-2 py-1 ${hit ? "bg-emerald-500/15 font-bold text-emerald-700 dark:text-emerald-300" : "bg-slate-500/5"}`}>
                    <span className="text-slate-500">{name(a.player)}:</span> {hit && !iDraw && a.player !== seat ? "got it!" : a.text}
                  </div>
                );
              })}
            </div>
            {guessedBy !== undefined && <div className="text-[12px] font-semibold text-emerald-600">{name(guessedBy)} got it!</div>}
          </div>
        </div>
      ) : (
        <div className="text-[13px] text-slate-500">Each round one of you draws a secret word on the shared board; the first right guess scores 10, the drawer 5.</div>
      )}
    </PartyShell>
  );
}
