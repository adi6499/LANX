import { useEffect, useMemo, useState } from "react";
import type { BoardProps } from "../boardProps";
import { mathRush, tapRoulette, trivia, type MathExtra, type TapExtra, type TriviaQ } from "../../../lib/games/party.ts";
import { wordPoints, wordbox, type WordboxExtra } from "../../../lib/games/wordbox.ts";
import { PartyShell } from "./PartyShell";

const btn = "rounded-full px-4 py-1.5 text-[12.5px] font-semibold";

// ---------------------------------------------------------------- Tap Roulette

export function TapRouletteBoard({ moves, canPlay, seat, seats, starter = 0, seed = "", host, local, onMove }: BoardProps) {
  const n = Math.max(2, seats?.length ?? 2);
  const state = useMemo(() => tapRoulette.replay(moves, n, seed), [moves, n, seed]);
  if (!state) return null;
  const me = seat;
  const tapped = state.answers.some((a) => a.player === me);
  const allIn = state.answers.length >= n;
  void local;
  return (
    <PartyShell state={state} rounds={5} seconds={10} host={!!host} seats={seats} starter={starter} n={n} allIn={allIn} onMove={onMove} testId="taproulette">
      <div className="flex flex-col items-center gap-2">
        {state.open ? (
          <button type="button" data-tap-in disabled={!canPlay || tapped} onClick={() => onMove(`${me}@a:in`)} className={`h-32 w-32 rounded-full text-[18px] font-black text-white shadow-lg ${tapped ? "bg-emerald-500" : "bg-rose-600 hover:bg-rose-500 active:scale-95"} disabled:opacity-80`}>
            {tapped ? "IN" : "TAP"}
          </button>
        ) : (
          <div className="text-[13px] text-slate-500">Everyone taps in; the app picks one loser each round. Five rounds.</div>
        )}
        <div className="text-[11.5px] text-slate-500">{state.answers.length} of {n} in</div>
      </div>
    </PartyShell>
  );
}

// ---------------------------------------------------------------- Math Rush

export function MathRushBoard({ moves, canPlay, seat, seats, starter = 0, seed = "", host, onMove }: BoardProps) {
  const n = Math.max(2, seats?.length ?? 2);
  const state = useMemo(() => mathRush.replay(moves, n, seed), [moves, n, seed]);
  const [text, setText] = useState("");
  useEffect(() => setText(""), [state?.round]);
  if (!state) return null;
  const q = state.extra as MathExtra | null;
  const answered = state.answers.some((a) => a.player === seat);
  const send = () => {
    if (!text.trim()) return;
    onMove(`${seat}@a:${text.trim()}`);
  };
  return (
    <PartyShell state={state} rounds={10} seconds={15} host={!!host} seats={seats} starter={starter} n={n} allIn={state.answers.length >= n} onMove={onMove} testId="mathrush">
      {state.open && q ? (
        <div className="flex flex-col items-center gap-2">
          <div className="text-[34px] font-black tracking-wide" data-math-question>
            {q.question} = ?
          </div>
          {answered ? (
            <div className="text-[13px] font-semibold text-emerald-600" data-math-sent>
              Sent — waiting for the others
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input data-math-input type="number" value={text} disabled={!canPlay} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} className="w-32 rounded-lg border border-slate-300 px-3 py-1.5 text-[16px] dark:border-slate-600 dark:bg-slate-800" autoFocus />
              <button type="button" data-math-send disabled={!canPlay} onClick={send} className={`${btn} bg-indigo-600 text-white`}>
                Answer
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="text-[13px] text-slate-500">Ten quick sums. First right answer: 3 points; others right: 1.</div>
      )}
    </PartyShell>
  );
}

// ---------------------------------------------------------------- Trivia Night

export function TriviaBoard({ moves, canPlay, seat, seats, starter = 0, seed = "", host, onMove }: BoardProps) {
  const n = Math.max(2, seats?.length ?? 2);
  const state = useMemo(() => trivia.replay(moves, n, seed), [moves, n, seed]);
  if (!state) return null;
  const q = state.extra as TriviaQ | null;
  const mine = state.answers.find((a) => a.player === seat);
  return (
    <PartyShell state={state} rounds={10} seconds={20} host={!!host} seats={seats} starter={starter} n={n} allIn={state.answers.length >= n} onMove={onMove} testId="trivia">
      {state.open && q ? (
        <div className="flex w-full max-w-[520px] flex-col items-center gap-3">
          <div className="text-center text-[17px] font-bold" data-trivia-question>
            {q.q}
          </div>
          <div className="grid w-full grid-cols-2 gap-2">
            {q.options.map((o, i) => (
              <button key={i} type="button" data-trivia-option={i} disabled={!canPlay || !!mine} onClick={() => onMove(`${seat}@a:${i}`)} className={`rounded-xl px-3 py-2 text-[13px] font-semibold shadow ring-1 ring-black/10 ${mine && Number(mine.text) === i ? "bg-indigo-600 text-white" : "bg-white text-slate-900 hover:bg-indigo-50 dark:bg-slate-800 dark:text-white"} disabled:opacity-70`}>
                {o}
              </button>
            ))}
          </div>
          <div className="text-[11.5px] text-slate-500">{state.answers.length} of {n} answered</div>
        </div>
      ) : (
        <div className="text-[13px] text-slate-500">Ten questions, four options each. Right: 10 points; first right: 15.</div>
      )}
    </PartyShell>
  );
}

// ---------------------------------------------------------------- Wordbox

export function WordboxBoard({ moves, canPlay, seat, seats, starter = 0, seed = "", host, onMove }: BoardProps) {
  const n = Math.max(2, seats?.length ?? 2);
  const state = useMemo(() => wordbox.replay(moves, n, seed), [moves, n, seed]);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    setText("");
    setNote("");
  }, [state?.round]);
  if (!state) return null;
  const grid = (state.extra as WordboxExtra | null)?.grid ?? [];
  const mine = state.answers.filter((a) => a.player === seat).map((a) => a.text.toUpperCase());
  const send = () => {
    const w = text.trim().toUpperCase();
    if (!w) return;
    if (w.length < 3) {
      setNote("Three letters or more.");
      return;
    }
    if (mine.includes(w)) {
      setNote("Already have it.");
      return;
    }
    onMove(`${seat}@a:${w}`);
    setText("");
    setNote("");
  };
  return (
    <PartyShell state={state} rounds={3} seconds={90} host={!!host} seats={seats} starter={starter} n={n} onMove={onMove} testId="wordbox">
      {state.open && grid.length === 16 ? (
        <div className="flex flex-wrap items-start justify-center gap-5">
          <div className="grid grid-cols-4 gap-1.5" data-wordbox-grid>
            {grid.map((ch, i) => (
              <div key={i} className="flex h-14 w-14 items-center justify-center rounded-xl bg-amber-50 text-[24px] font-black text-slate-900 shadow ring-1 ring-black/10">
                {ch === "Q" ? "Qu" : ch}
              </div>
            ))}
          </div>
          <div className="flex w-[220px] flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <input data-wordbox-input value={text} disabled={!canPlay} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="type a word" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-[14px] uppercase dark:border-slate-600 dark:bg-slate-800" autoFocus />
              <button type="button" data-wordbox-send disabled={!canPlay} onClick={send} className={`${btn} bg-indigo-600 text-white`}>
                Add
              </button>
            </div>
            {note && <div className="text-[11.5px] text-rose-600">{note}</div>}
            <div className="flex flex-wrap gap-1" data-wordbox-mine>
              {mine.map((w) => (
                <span key={w} className="rounded-full bg-white px-2 py-0.5 text-[11.5px] font-semibold text-slate-900 shadow ring-1 ring-black/10">
                  {w} <span className="text-slate-400">{wordPoints(w)}</span>
                </span>
              ))}
            </div>
            <div className="text-[10.5px] text-slate-500">Letters must touch, no square twice. A word two of you found scores nobody. No dictionary here — play fair.</div>
          </div>
        </div>
      ) : (
        <div className="text-[13px] text-slate-500">Three rounds of 90 seconds on a fresh letter grid.</div>
      )}
    </PartyShell>
  );
}

export type { TapExtra };
