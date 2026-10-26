import { useEffect, useMemo, useRef, useState } from "react";
import { seatFor, type BoardProps } from "../boardProps";
import { drawGuess, type DrawExtra } from "../../../lib/games/drawguess.ts";
import { PartyShell } from "./PartyShell";

const W = 520;
const H = 340;
const COLOURS = ["#0f172a", "#dc2626", "#2563eb", "#16a34a", "#f59e0b", "#9333ea"];

type Stroke = { kind: "stroke"; pts: [number, number][]; c: string; w: number; round: number };
type Clear = { kind: "clear"; round: number };

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

  // Repaint from every stroke of this round whenever one arrives.
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
    const mine = (deltas as (Stroke | Clear)[]).filter((d) => d && typeof d === "object" && "round" in d && d.round === round);
    let from = 0;
    mine.forEach((d, i) => {
      if (d.kind === "clear") from = i + 1;
    });
    for (const d of mine.slice(from)) {
      if (d.kind !== "stroke" || d.pts.length < 1) continue;
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
  }, [deltas, round]);

  useEffect(() => setGuess(""), [round]);
  if (!state) return null;
  const name = (p: number) => seatFor(seats, starter, p, n).name;
  const guessedBy = extra?.guessedBy;
  const right = state.open && extra ? state.answers.some((a) => a.text.trim().toLowerCase() === extra.word) : false;

  const pos = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = canvas.current!.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * W), Math.round(((e.clientY - r.top) / r.height) * H)];
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
        <div className="flex flex-wrap items-start justify-center gap-4">
          <div className="flex flex-col items-center gap-2">
            {iDraw ? (
              <div className="text-[13px] font-semibold" data-draw-word>
                Draw: <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-amber-800 dark:text-amber-200">{extra.word}</span>
              </div>
            ) : (
              <div className="text-[13px] text-slate-500" data-draw-hint>
                {extra.word.length} letters — type your guess
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
                <button type="button" data-draw-clear onClick={() => onDelta?.({ kind: "clear", round } satisfies Clear)} className="h-6 rounded-full bg-rose-500/10 px-2 text-[11px] font-semibold text-rose-700">
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
              {state.answers.slice(-6).map((a, i) => (
                <div key={i} className={a.text.trim().toLowerCase() === extra.word ? "font-bold text-emerald-600" : ""}>
                  <span className="text-slate-500">{name(a.player)}:</span> {a.text.trim().toLowerCase() === extra.word && !iDraw && a.player !== seat ? "got it!" : a.text}
                </div>
              ))}
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
