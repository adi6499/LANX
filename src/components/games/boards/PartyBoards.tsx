import { useEffect, useMemo, useState } from "react";
import { seatFor, type BoardProps, type Seat } from "../boardProps";
import { allAnswered, mathRush, present, tapRoulette, trivia, type MathExtra, type RoundState, type TapExtra, type TriviaQ } from "../../../lib/games/party.ts";
import { wordOnGrid, wordPoints, wordbox, wordsByPlayer, type WordboxExtra } from "../../../lib/games/wordbox.ts";
import { PartyShell } from "./PartyShell";

const btn = "rounded-full px-4 py-1.5 text-[12.5px] font-semibold";

/** Names for the party boards (flat and 3D): "Asha", "Asha and Ben", "Asha, Ben and Cara". */
export function partyNames(seats: Seat[] | undefined, starter: number, n: number) {
  const name = (p: number) => seatFor(seats, starter, p, n).name.split(" (")[0];
  const list = (ps: number[]) => (ps.length <= 1 ? (ps.length ? name(ps[0]) : "nobody") : `${ps.slice(0, -1).map(name).join(", ")} and ${name(ps[ps.length - 1])}`);
  return { name, list, colour: (p: number) => seatFor(seats, starter, p, n).color };
}

/** "3 of 4 in" — counting only those still at the table. */
export const inCount = (s: RoundState) => {
  const ps = present(s);
  return `${ps.filter((p) => s.answers.some((a) => a.player === p)).length} of ${ps.length}`;
};

// ---------------------------------------------------------------- Tap Roulette

/** What the last Tap Roulette round came to, in words with names. */
export function tapResult(s: RoundState & { extra: TapExtra | null }, list: (ps: number[]) => string): string | null {
  if (s.open || s.round === 0 || !s.extra?.losers) return null;
  const { losers, drawn } = s.extra;
  return drawn ? `Everyone tapped in — the wheel picked ${list(losers)}.` : `${list(losers)} didn't tap in — ${losers.length > 1 ? "they lose" : "loses"} the round.`;
}

export function TapRouletteBoard({ moves, canPlay, seat, seats, starter = 0, seed = "", host, onMove }: BoardProps) {
  const n = Math.max(2, seats?.length ?? 2);
  const state = useMemo(() => tapRoulette.replay(moves, n, seed), [moves, n, seed]);
  if (!state) return null;
  const { list } = partyNames(seats, starter, n);
  const tapped = state.answers.some((a) => a.player === seat);
  const result = tapResult(state, list);
  return (
    <PartyShell state={state} rounds={tapRoulette.total(state, n)} seconds={tapRoulette.rules.seconds} host={!!host} seats={seats} starter={starter} n={n} seat={seat} answered={tapped} verb="tap in now" allIn={allAnswered(state)} onMove={onMove} testId="taproulette">
      <div className="flex flex-col items-center gap-2">
        {state.open ? (
          <button type="button" data-tap-in disabled={!canPlay || tapped || state.out[seat]} onClick={() => onMove(`${seat}@a:in`)} className={`h-32 w-32 rounded-full text-[18px] font-black text-white shadow-lg ${tapped ? "bg-emerald-500" : "bg-rose-600 hover:bg-rose-500 active:scale-95"} disabled:opacity-80`}>
            {tapped ? "IN" : "TAP"}
          </button>
        ) : result ? (
          <div className="text-[15px] font-bold" data-tap-result>
            {result}
          </div>
        ) : (
          <div className="max-w-[460px] text-center text-[13px] text-slate-500">Tap in before the clock runs out — anyone who doesn't loses the round. If everyone's in, the app picks one loser at random. Five rounds; a point for each round you survive.</div>
        )}
        {state.open && <div className="text-[11.5px] text-slate-500">{inCount(state)} in</div>}
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
  const { list } = partyNames(seats, starter, n);
  const q = state.extra as MathExtra | null;
  const mine = state.answers.find((a) => a.player === seat);
  const reveal = !state.open && state.round > 0 && !!q;
  const send = () => {
    if (!text.trim()) return;
    onMove(`${seat}@a:${text.trim()}`);
  };
  return (
    <PartyShell state={state} rounds={mathRush.total(state, n)} seconds={mathRush.rules.seconds} host={!!host} seats={seats} starter={starter} n={n} seat={seat} answered={!!mine} allIn={allAnswered(state)} onMove={onMove} testId="mathrush">
      {(state.open || reveal) && q ? (
        <div className="flex flex-col items-center gap-2">
          <div className="text-[34px] font-black tracking-wide" data-math-question>
            {q.question} = {reveal ? q.answer : "?"}
          </div>
          {reveal ? (
            <div className="text-[13px] text-slate-600 dark:text-slate-300" data-math-reveal>
              {mine ? (Number(mine.text) === q.answer ? "You got it. " : `You said ${mine.text}. `) : ""}
              Right: {list(state.answers.filter((a) => Number(a.text) === q.answer).map((a) => a.player))}
            </div>
          ) : mine ? (
            <div className="text-[13px] font-semibold text-emerald-600" data-math-sent>
              Sent — waiting for the others ({inCount(state)} in)
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
        <div className="text-[13px] text-slate-500">Ten quick sums, 15 seconds each. A point for every right answer.</div>
      )}
    </PartyShell>
  );
}

// ---------------------------------------------------------------- Trivia Night

export function TriviaBoard({ moves, canPlay, seat, seats, starter = 0, seed = "", host, onMove }: BoardProps) {
  const n = Math.max(2, seats?.length ?? 2);
  const state = useMemo(() => trivia.replay(moves, n, seed), [moves, n, seed]);
  if (!state) return null;
  const { list } = partyNames(seats, starter, n);
  const q = state.extra as TriviaQ | null;
  const mine = state.answers.find((a) => a.player === seat);
  const reveal = !state.open && state.round > 0 && !!q;
  return (
    <PartyShell state={state} rounds={trivia.total(state, n)} seconds={trivia.rules.seconds} host={!!host} seats={seats} starter={starter} n={n} seat={seat} answered={!!mine} allIn={allAnswered(state)} onMove={onMove} testId="trivia">
      {(state.open || reveal) && q ? (
        <div className="flex w-full max-w-[520px] flex-col items-center gap-3">
          <div className="text-center text-[17px] font-bold" data-trivia-question>
            {q.q}
          </div>
          <div className="grid w-full grid-cols-2 gap-2">
            {q.options.map((o, i) => (
              <button
                key={i}
                type="button"
                data-trivia-option={i}
                disabled={!canPlay || !!mine || !state.open}
                onClick={() => onMove(`${seat}@a:${i}`)}
                className={`rounded-xl px-3 py-2 text-[13px] font-semibold shadow ring-1 ring-black/10 ${reveal && i === q.a ? "bg-emerald-500 text-white" : mine && Number(mine.text) === i ? "bg-indigo-600 text-white" : "bg-white text-slate-900 hover:bg-indigo-50 dark:bg-slate-800 dark:text-white"} disabled:opacity-80`}
              >
                {o}
              </button>
            ))}
          </div>
          <div className="text-[11.5px] text-slate-500" data-trivia-answered>
            {reveal ? `The answer: ${q.options[q.a]} — right: ${list(state.answers.filter((a) => Number(a.text) === q.a).map((a) => a.player))}` : `${inCount(state)} answered`}
          </div>
        </div>
      ) : (
        <div className="text-[13px] text-slate-500">Ten questions, four options each. 10 points for every right answer.</div>
      )}
    </PartyShell>
  );
}

// ---------------------------------------------------------------- Wordbox

let dictionary: Set<string> | null = null;
let loadingDict: Promise<Set<string> | null> | null = null;
/** The English word list (about 270,000 words), loaded the first time a Wordbox board opens. */
export function loadWordList(): Promise<Set<string> | null> {
  if (dictionary) return Promise.resolve(dictionary);
  loadingDict ??= import("../../../../node_modules/word-list/words.txt?raw")
    .then((m) => {
      dictionary = new Set((m.default as string).split("\n").map((w) => w.trim().toUpperCase()));
      return dictionary;
    })
    .catch(() => null);
  return loadingDict;
}

/** LANX 2.17.0: the word list for both Wordbox boards (null while it loads). */
export function useWordList(): Set<string> | null {
  const [dict, setDict] = useState<Set<string> | null>(dictionary);
  useEffect(() => {
    let live = true;
    void loadWordList().then((d) => live && setDict(d));
    return () => {
      live = false;
    };
  }, []);
  return dict;
}

/** Why a word can't be sent (on the flat board as on the 3D one), or null when it can. */
export function wordProblem(raw: string, grid: string[], mine: string[], dict: Set<string> | null): string | null {
  const w = raw.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(w)) return "Letters only.";
  if (w.length < 3) return "Three letters or more.";
  if (mine.includes(w)) return "Already have it.";
  if (!wordOnGrid(grid, w)) return "Those letters don't touch on the grid.";
  if (dict && !dict.has(w)) return `"${w}" isn't in the word list.`;
  return null;
}

/** After a round: everyone's words, with the ones two of you found struck through (they score nobody). */
export function WordLists({ answers, n, name, colour, me }: { answers: { player: number; text: string }[]; n: number; name: (p: number) => string; colour: (p: number) => string; me: number }) {
  const lists = wordsByPlayer(answers, n);
  return (
    <div className="flex w-full max-w-[640px] flex-wrap justify-center gap-3" data-wordbox-lists>
      {lists.map((words, p) => (
        <div key={p} className="min-w-[120px] rounded-xl bg-white/80 px-3 py-2 text-[12px] shadow ring-1 ring-black/5 dark:bg-slate-800/80" data-wordbox-list={p}>
          <div className={`mb-1 flex items-center gap-1.5 font-semibold ${p === me ? "text-indigo-600 dark:text-indigo-300" : ""}`}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colour(p) }} /> {name(p)} <span className="font-normal text-slate-400">+{words.reduce((t, w) => t + w.points, 0)}</span>
          </div>
          {words.length ? (
            <div className="flex flex-wrap gap-x-2 gap-y-0.5">
              {words.map((w) => (
                <span key={w.word} data-wordbox-word={w.word} data-wordbox-shared={w.shared ? "1" : undefined} className={w.shared ? "text-slate-400 line-through" : ""} title={w.shared ? "Someone else found it too — no points" : `${w.points} point${w.points === 1 ? "" : "s"}`}>
                  {w.word}
                  {!w.shared && <span className="ml-0.5 text-[10px] text-slate-400">{w.points}</span>}
                </span>
              ))}
            </div>
          ) : (
            <div className="text-slate-400">no words</div>
          )}
        </div>
      ))}
    </div>
  );
}

export const WORDBOX_RULES = "Letters must touch (diagonals too), no square twice; Qu is one tile. 3–4 letters: 1 point, 5: 2, 6: 3, 7: 5, 8 or more: 11. A word two of you found scores nobody.";

export function WordboxBoard({ moves, canPlay, seat, seats, starter = 0, seed = "", host, onMove }: BoardProps) {
  const n = Math.max(2, seats?.length ?? 2);
  const state = useMemo(() => wordbox.replay(moves, n, seed), [moves, n, seed]);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const dict = useWordList();
  useEffect(() => {
    setText("");
    setNote("");
  }, [state?.round]);
  if (!state) return null;
  const { name, colour } = partyNames(seats, starter, n);
  const grid = (state.extra as WordboxExtra | null)?.grid ?? [];
  const mine = state.answers.filter((a) => a.player === seat).map((a) => a.text.toUpperCase());
  const send = () => {
    if (!text.trim()) return;
    const problem = wordProblem(text, grid, mine, dict);
    if (problem) {
      setNote(problem);
      return;
    }
    onMove(`${seat}@a:${text.trim().toUpperCase()}`);
    setText("");
    setNote("");
  };
  return (
    <PartyShell state={state} rounds={wordbox.total(state, n)} seconds={wordbox.rules.seconds} host={!!host} seats={seats} starter={starter} n={n} seat={seat} verb="find words now" onMove={onMove} testId="wordbox">
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
            {note && (
              <div className="text-[11.5px] text-rose-600" data-wordbox-note>
                {note}
              </div>
            )}
            <div className="flex flex-wrap gap-1" data-wordbox-mine>
              {mine.map((w) => (
                <span key={w} className="rounded-full bg-white px-2 py-0.5 text-[11.5px] font-semibold text-slate-900 shadow ring-1 ring-black/10">
                  {w} <span className="text-slate-400">{wordPoints(w)}</span>
                </span>
              ))}
            </div>
            <div className="text-[10.5px] text-slate-500">
              {WORDBOX_RULES} {dict ? "Words are checked against an English word list." : "Loading the word list…"}
            </div>
          </div>
        </div>
      ) : !state.open && state.round > 0 ? (
        <WordLists answers={state.answers} n={n} name={name} colour={colour} me={seat} />
      ) : (
        <div className="max-w-[480px] text-center text-[13px] text-slate-500">Three rounds of 90 seconds on a fresh letter grid. {WORDBOX_RULES}</div>
      )}
    </PartyShell>
  );
}

export type { TapExtra };
