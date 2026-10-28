import { useEffect, useMemo, useRef, useState } from "react";
import { seatFor, type BoardProps } from "../boardProps";
import { drawGuess, isRightGuess, type DrawExtra, type DrawState } from "../../../lib/games/drawguess.ts";
import { PartyShell } from "./PartyShell";

const W = 520;
const H = 340;
const COLOURS = ["#0f172a", "#dc2626", "#2563eb", "#16a34a", "#f59e0b", "#9333ea"];

/** A piece of the drawing. LANX 2.17.0: tagged with the match round's seed (`s`) as well as the party
 *  round, so a rematch's round 1 never shows the last game's round-1 picture. */
export type Stroke = { kind: "stroke"; pts: [number, number][]; c: string; w: number; round: number; s?: string; __from?: number };
export type Clear = { kind: "clear"; round: number; s?: string; __from?: number };

/** This round's picture: the drawer's strokes since their last "clear" (the match stamps who sent each). */
export function roundStrokes(deltas: unknown[], seed: string, round: number, drawer: number | undefined): Stroke[] {
  const mine = (deltas as (Stroke | Clear)[]).filter((d) => d && typeof d === "object" && "round" in d && d.round === round && (d.s === undefined || d.s === seed) && (typeof d.__from !== "number" || drawer === undefined || d.__from === drawer));
  let from = 0;
  mine.forEach((d, i) => {
    if (d.kind === "clear") from = i + 1;
  });
  return mine.slice(from).filter((d): d is Stroke => d.kind === "stroke" && Array.isArray(d.pts) && d.pts.length > 0);
}

/** Someone guessed the word, or the drawer left: the host closes the round. */
export const drawRoundOver = (state: DrawState, extra: DrawExtra | null) => !!extra && state.open && (state.answers.some((a) => isRightGuess(a.text, extra.word)) || !!state.out[extra.drawer]);

/** What's happening in an open round, for the status line. */
export function drawLabel(state: DrawState, extra: DrawExtra | null, seat: number, name: (p: number) => string, total: number): string | undefined {
  if (!state.open || !extra) return undefined;
  const head = `Round ${state.round} of ${total}`;
  if (state.out[extra.drawer]) return `${head} — ${name(extra.drawer)} left, the round ends`;
  if (extra.drawer === seat) return `${head} — you draw, the others guess`;
  return `${head} — ${name(extra.drawer)} draws, guess now`;
}

export const DRAW_RULES = "Each round one of you draws a secret word on the shared board; the first right guess scores 10, the drawer 5. Everyone draws as often as everyone else.";

/** Draw & Guess: the drawer sketches the word; the others type guesses. */
export function DrawGuessBoard({ moves, canPlay, seat, seats, starter = 0, seed = "", host, deltas = [], onDelta, onMove }: BoardProps) {
  const n = Math.max(2, seats?.length ?? 2);
  const state = useMemo(() => drawGuess.replay(moves, n, seed), [moves, n, seed]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<[number, number][] | null>(null);
  const [colour, setColour] = useState(COLOURS[0]);
  const [width, setWidth] = useState(4);
  const [guess, setGuess] = useState("");
  const extra = state?.extra as DrawExtra | null;
  const iDraw = !!extra && extra.drawer === seat;
  const round = state?.round ?? 0;
  const strokes = useMemo(() => roundStrokes(deltas, seed, round, extra?.drawer), [deltas, seed, round, extra?.drawer]);

  // Repaint from every stroke of this round whenever one arrives.
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
    for (const d of strokes) {
      ctx.strokeStyle = d.c;
      ctx.lineWidth = d.w;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(d.pts[0][0], d.pts[0][1]);
      for (const [x, y] of d.pts.slice(1)) ctx.lineTo(x, y);
      if (d.pts.length === 1) ctx.lineTo(d.pts[0][0] + 0.1, d.pts[0][1]);
      ctx.stroke();
    }
  }, [strokes, state?.open]);

  useEffect(() => setGuess(""), [round]);
  if (!state) return null;
  const name = (p: number) => seatFor(seats, starter, p, n).name.split(" (")[0];
  const total = drawGuess.total(state, n);
  const guessedBy = extra?.guessedBy;
  const right = state.open && extra ? state.answers.some((a) => isRightGuess(a.text, extra.word)) : false;

  const pos = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = canvas.current!.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * W), Math.round(((e.clientY - r.top) / r.height) * H)];
  };
  const flush = () => {
    const pts = drawing.current;
    if (!pts || !pts.length) return;
    onDelta?.({ kind: "stroke", pts, c: colour, w: width, round, s: seed } satisfies Stroke);
    drawing.current = [pts[pts.length - 1]];
  };
  const sendGuess = () => {
    if (!guess.trim()) return;
    onMove(`${seat}@a:${guess.trim()}`);
    setGuess("");
  };
  return (
    <PartyShell state={state} rounds={total} seconds={drawGuess.rules.seconds} host={!!host} seats={seats} starter={starter} n={n} seat={seat} allIn={drawRoundOver(state, extra)} onMove={onMove} testId="drawguess" roundLabel={drawLabel(state, extra, seat, name, total)}>
      {state.open && extra ? (
        <div className="flex flex-wrap items-start justify-center gap-4">
          <div className="flex flex-col items-center gap-2">
            {iDraw ? (
              <div className="text-[13px] font-semibold" data-draw-word>
                Draw: <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-amber-800 dark:text-amber-200">{extra.word}</span>
              </div>
            ) : (
              <div className="text-[13px] text-slate-500" data-draw-hint>
                {extra.word.replace(/ /g, "").length} letters{extra.word.includes(" ") ? ", two words" : ""} — type your guess
              </div>
            )}
            <canvas
              ref={canvas}
              data-draw-canvas
              width={W}
              height={H}
              className={`w-full max-w-[520px] rounded-xl bg-white shadow ring-1 ring-black/10 ${iDraw && canPlay ? "cursor-crosshair touch-none" : ""}`}
              onPointerDown={(e) => {
                if (!iDraw || !canPlay) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                drawing.current = [pos(e)];
                flush();
              }}
              onPointerMove={(e) => {
                if (!drawing.current) return;
                drawing.current.push(pos(e));
                if (drawing.current.length >= 12) flush();
              }}
              onPointerUp={() => {
                flush();
                drawing.current = null;
              }}
            />
            {iDraw && (
              <div className="flex items-center gap-1.5" data-draw-tools>
                {COLOURS.map((c) => (
                  <button key={c} type="button" onClick={() => setColour(c)} className={`h-6 w-6 rounded-full ${colour === c ? "ring-2 ring-offset-2 ring-indigo-500" : ""}`} style={{ backgroundColor: c }} />
                ))}
                {[3, 6, 12].map((w) => (
                  <button key={w} type="button" onClick={() => setWidth(w)} className={`h-6 rounded-full px-2 text-[11px] font-semibold ${width === w ? "bg-indigo-600 text-white" : "bg-slate-500/10"}`}>
                    {w === 3 ? "thin" : w === 6 ? "mid" : "thick"}
                  </button>
                ))}
                <button type="button" data-draw-clear onClick={() => onDelta?.({ kind: "clear", round, s: seed } satisfies Clear)} className="h-6 rounded-full bg-rose-500/10 px-2 text-[11px] font-semibold text-rose-700">
                  Clear
                </button>
              </div>
            )}
          </div>
          <div className="flex w-[200px] flex-col gap-2">
            {!iDraw && (
              <div className="flex items-center gap-1.5">
                <input data-draw-guess value={guess} disabled={!canPlay || right} onChange={(e) => setGuess(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendGuess()} placeholder="your guess" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-[13px] dark:border-slate-600 dark:bg-slate-800" autoFocus />
                <button type="button" data-draw-send disabled={!canPlay || right} onClick={sendGuess} className="rounded-full bg-indigo-600 px-3 py-1.5 text-[12.5px] font-semibold text-white">
                  Go
                </button>
              </div>
            )}
            <div className="flex flex-col gap-0.5 text-[12px]" data-draw-guesses>
              {state.answers.slice(-6).map((a, i) => {
                const hit = isRightGuess(a.text, extra.word);
                return (
                  <div key={i} className={hit ? "font-bold text-emerald-600" : ""} data-draw-hit={hit ? "1" : undefined}>
                    <span className="text-slate-500">{name(a.player)}:</span> {hit && !iDraw && a.player !== seat ? "got it!" : a.text}
                  </div>
                );
              })}
            </div>
            {guessedBy !== undefined && <div className="text-[12px] font-semibold text-emerald-600">{name(guessedBy)} got it!</div>}
          </div>
        </div>
      ) : (
        <div className="max-w-[480px] text-center text-[13px] text-slate-500">{DRAW_RULES}</div>
      )}
    </PartyShell>
  );
}
