/** LANX 3.9.0: Live quiz — like the quizzes on a big screen, but on every PC.
 *  Setup (questions, ready-made quizzes, who plays), then one full-window
 *  screen for host and players alike: lobby → question → reveal → leaderboard
 *  … → podium. The game itself (timing, scoring) is in lib/quiz.ts. */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { ArrowDown, ArrowUp, Brain, Check, ChevronRight, Clock, Loader2, LogOut, Plus, Trash2, Trophy, UserPlus, Users, X, Zap } from "lucide-react";
import { type Session, invite, msUntil } from "../../lib/together";
import {
  type Player,
  type Question,
  type QuizDef,
  type QuizState,
  LEAD_MS,
  MAX_OPTIONS,
  MIN_OPTIONS,
  READY,
  SECONDS,
  answer,
  blankQuestion,
  closeQuiz,
  finish,
  hostGame,
  myId,
  myPick,
  myResult,
  next,
  noteOpened,
  problem,
  quizStore,
  readState,
  startQuiz,
} from "../../lib/quiz";
import { PeoplePicker, Sheet, chosen, initials, primaryBtn, secondaryBtn, useMyName, useOnline, useTogether, presetPicked } from "./common";

// ------------------------------------------------------------------ small pieces

const useQuiz = () => useSyncExternalStore(quizStore.subscribe, quizStore.version, quizStore.version);

/** True once it is `hostMs` on `peer`'s clock. Timers on Windows fire on a ~15.6 ms tick, so the
 *  last few ms are waited out with a message loop, and the change is drawn right then (not queued
 *  behind other work): the moment lands within a few ms on every PC. */
function useAt(hostMs: number, peer: string): boolean {
  const [hit, setHit] = useState<number | null>(() => (msUntil(hostMs, peer) <= 0 ? hostMs : null));
  useEffect(() => {
    let t: number | undefined;
    let alive = true;
    const ch = new MessageChannel();
    const reach = () => flushSync(() => setHit(hostMs));
    const fine = () => {
      if (!alive) return;
      if (msUntil(hostMs, peer) <= 0) reach();
      else ch.port2.postMessage(0);
    };
    ch.port1.onmessage = fine;
    const tick = (first: boolean) => {
      const left = msUntil(hostMs, peer);
      if (left <= 0) return first ? setHit(hostMs) : reach();
      if (first) setHit(null);
      if (left <= 30) ch.port2.postMessage(0);
      else t = window.setTimeout(() => tick(false), Math.min(left - 25, 1000));
    };
    tick(true);
    return () => {
      alive = false;
      window.clearTimeout(t);
      ch.port1.close();
    };
  }, [hostMs, peer]);
  return hit === hostMs;
}
function useTick(on: boolean, every = 250) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => set((n) => n + 1), every);
    return () => window.clearInterval(t);
  }, [on, every]);
}

/** A bar that runs out (or fills) between two moments on `peer`'s clock (it may start later). Transform only. */
function Bar({ from, to, peer, fill = false, tone = "bg-sky-500" }: { from: number; to: number; peer: string; fill?: boolean; tone?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== "function") return;
    const total = Math.max(1, to - from);
    const until = msUntil(from, peer);
    const a = el.animate([{ transform: `scaleX(${fill ? 0 : 1})` }, { transform: `scaleX(${fill ? 1 : 0})` }], { duration: total, delay: Math.max(0, until), fill: "both", easing: "linear" });
    if (until < 0) a.currentTime = Math.min(total, -until);
    return () => a.cancel();
  }, [from, to, peer, fill]);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--lanx-fill)]">
      <div ref={ref} className={`h-full w-full origin-left rounded-full ${tone}`} style={{ transform: `scaleX(${fill ? 0 : 1})` }} />
    </div>
  );
}

const OPT = [
  { shape: "▲", solid: "bg-rose-500", soft: "bg-rose-500/10 dark:bg-rose-500/15", bar: "bg-rose-500/70" },
  { shape: "◆", solid: "bg-blue-500", soft: "bg-blue-500/10 dark:bg-blue-500/15", bar: "bg-blue-500/70" },
  { shape: "●", solid: "bg-amber-500", soft: "bg-amber-500/12 dark:bg-amber-500/15", bar: "bg-amber-500/70" },
  { shape: "■", solid: "bg-violet-500", soft: "bg-violet-500/10 dark:bg-violet-500/15", bar: "bg-violet-500/70" },
];
const COLORS = ["#0ea5e9", "#f59e0b", "#10b981", "#a855f7", "#ef4444", "#14b8a6", "#6366f1", "#ec4899"];
const colorFor = (id: string) => COLORS[[...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length];
const pts = (n: number) => n.toLocaleString("en-IN");
const nth = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;
const secs = (ms: number) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Face({ id, name, size = 28 }: { id: string; name: string; size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full font-bold text-white" style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background: colorFor(id) }}>
      {initials(name)}
    </span>
  );
}
function Chip({ id, name, dim = false, tone = "" }: { id: string; name: string; dim?: boolean; tone?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full py-1 pl-1 pr-3 text-[12.5px] font-semibold lanx-msg ${tone || "bg-[var(--lanx-fill)] text-slate-700 dark:text-slate-200"} ${dim ? "opacity-50" : ""}`}>
      <Face id={id} name={name} size={22} />
      {name}
    </span>
  );
}

// ------------------------------------------------------------------ setup

const DRAFT = "lanx.quiz.draft";
const clone = (d: QuizDef): QuizDef => ({ title: d.title, questions: d.questions.map((x) => ({ ...x, options: [...x.options] })) });
function loadDraft(): QuizDef | null {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT) ?? "null") as QuizDef | null;
    if (d && typeof d.title === "string" && Array.isArray(d.questions) && d.questions.length) return clone(d);
  } catch {
    /* none kept */
  }
  return null;
}
function saveDraft(d: QuizDef) {
  try {
    localStorage.setItem(DRAFT, JSON.stringify(d));
  } catch {
    /* fine */
  }
}

function QuestionEditor({ q, i, count, onChange, onMove, onRemove }: { q: Question; i: number; count: number; onChange: (q: Question) => void; onMove: (d: -1 | 1) => void; onRemove: () => void }) {
  const setOpt = (j: number, text: string) => onChange({ ...q, options: q.options.map((o, k) => (k === j ? text : o)) });
  const dropOpt = (j: number) => onChange({ ...q, options: q.options.filter((_, k) => k !== j), correct: q.correct === j ? 0 : q.correct > j ? q.correct - 1 : q.correct });
  return (
    <div data-quiz-q={i} className="rounded-2xl lanx-group p-3">
      <div className="flex items-center gap-2">
        <span className="w-5 shrink-0 text-center text-[12px] font-bold text-slate-400">{i + 1}</span>
        <input
          data-quiz-q-text
          value={q.text}
          onChange={(e) => onChange({ ...q, text: e.target.value })}
          placeholder="Type a question"
          maxLength={200}
          className="lanx-field min-w-0 flex-1 rounded-xl px-3 py-2 text-[13.5px] font-semibold text-slate-900 placeholder:font-normal placeholder:text-slate-400 dark:text-white"
        />
        <label className="flex items-center gap-1 rounded-xl bg-[var(--lanx-fill)] px-2 py-2 text-[12px] font-semibold text-slate-600 dark:text-slate-300" title="Time to answer">
          <Clock className="h-3.5 w-3.5" />
          <select value={q.seconds} onChange={(e) => onChange({ ...q, seconds: Number(e.target.value) })} className="bg-transparent outline-none">
            {SECONDS.map((s) => (
              <option key={s} value={s}>
                {s} s
              </option>
            ))}
          </select>
        </label>
        <div className="flex shrink-0 items-center">
          <button type="button" title="Move up" disabled={i === 0} onClick={() => onMove(-1)} className="lanx-tool p-1.5 text-slate-400 disabled:opacity-30">
            <ArrowUp className="h-4 w-4" />
          </button>
          <button type="button" title="Move down" disabled={i === count - 1} onClick={() => onMove(1)} className="lanx-tool p-1.5 text-slate-400 disabled:opacity-30">
            <ArrowDown className="h-4 w-4" />
          </button>
          <button type="button" title="Remove question" disabled={count === 1} onClick={onRemove} className="lanx-tool p-1.5 text-slate-400 hover:text-rose-500 disabled:opacity-30">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-1 gap-1.5 pl-7 sm:grid-cols-2">
        {q.options.map((o, j) => (
          <div key={j} className="flex items-center gap-1.5">
            <button
              type="button"
              data-quiz-right={j}
              title={q.correct === j ? "The right answer" : "Make this the right answer"}
              onClick={() => onChange({ ...q, correct: j })}
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] transition-colors ${q.correct === j ? "bg-emerald-500 text-white" : `${OPT[j].soft} text-slate-500`}`}
            >
              {q.correct === j ? <Check className="h-4 w-4" /> : OPT[j].shape}
            </button>
            <input
              value={o}
              onChange={(e) => setOpt(j, e.target.value)}
              placeholder={`Answer ${j + 1}`}
              maxLength={90}
              className="lanx-field min-w-0 flex-1 rounded-xl px-2.5 py-1.5 text-[13px] text-slate-800 placeholder:text-slate-400 dark:text-slate-100"
            />
            {q.options.length > MIN_OPTIONS && (
              <button type="button" title="Remove this answer" onClick={() => dropOpt(j)} className="lanx-tool p-1 text-slate-400">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
        {q.options.length < MAX_OPTIONS && (
          <button type="button" onClick={() => onChange({ ...q, options: [...q.options, ""] })} className="flex items-center gap-1.5 rounded-xl px-2 py-1.5 text-[12.5px] font-semibold text-sky-600 hover:bg-[var(--lanx-fill)] dark:text-sky-400">
            <Plus className="h-3.5 w-3.5" /> Answer
          </button>
        )}
      </div>
    </div>
  );
}

export function QuizSetup({ onClose, onStarted }: { onClose: () => void; onStarted: (sessionId: string) => void }) {
  const [def, setDef] = useState<QuizDef>(() => loadDraft() ?? clone(READY[0].quiz));
  const [picked, setPicked] = useState<Record<string, boolean>>(presetPicked);
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const peers = useOnline();
  const myName = useMyName();
  const people = chosen(peers, picked);
  const listEnd = useRef<HTMLDivElement>(null);
  // An old "why not" goes once something changes.
  useEffect(() => setErr(""), [def, picked]);

  const setQ = (i: number, x: Question) => setDef((d) => ({ ...d, questions: d.questions.map((y, k) => (k === i ? x : y)) }));
  const move = (i: number, by: -1 | 1) =>
    setDef((d) => {
      const qs = [...d.questions];
      const j = i + by;
      if (j < 0 || j >= qs.length) return d;
      [qs[i], qs[j]] = [qs[j], qs[i]];
      return { ...d, questions: qs };
    });
  const remove = (i: number) => setDef((d) => ({ ...d, questions: d.questions.filter((_, k) => k !== i) }));
  const add = () => {
    setDef((d) => ({ ...d, questions: [...d.questions, blankQuestion()] }));
    window.setTimeout(() => listEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 30);
  };

  const start = async () => {
    const p = problem(def);
    if (p) return setErr(p);
    if (!people.length) return setErr("Choose who plays.");
    setErr("");
    setFailed({});
    setBusy(true);
    saveDraft(def);
    try {
      const r = await startQuiz(def, people, myName || "A colleague");
      if (!r.invited) {
        closeQuiz(r.sessionId);
        setFailed(Object.fromEntries(r.failed.map((f) => [f.id, f.why])));
        setErr("Nobody could be invited — see why next to each name.");
        return;
      }
      onStarted(r.sessionId);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="Live quiz" subtitle="Questions on everyone's screen at the same moment; quick right answers score more" icon={<Brain className="h-5 w-5" />} onClose={onClose} tag="quiz" wide>
      <div data-quiz-setup className="grid gap-4 md:grid-cols-[minmax(0,1fr)_250px]">
        <div className="min-w-0 space-y-3">
          <input
            data-quiz-title
            value={def.title}
            onChange={(e) => setDef((d) => ({ ...d, title: e.target.value }))}
            placeholder="Name your quiz"
            maxLength={80}
            className="lanx-field w-full rounded-xl px-3 py-2.5 text-[15px] font-bold text-slate-900 placeholder:font-semibold placeholder:text-slate-400 dark:text-white"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-[12px] font-semibold text-slate-500">Start from</span>
            {READY.map((r) => (
              <button
                key={r.key}
                type="button"
                data-quiz-preset={r.key}
                onClick={() => setDef(clone(r.quiz))}
                className={`rounded-full px-3 py-1.5 text-[12px] font-semibold ${def.title === r.quiz.title ? "bg-sky-500 text-white" : "bg-[var(--lanx-fill)] text-slate-700 hover:bg-[var(--lanx-fill-2)] dark:text-slate-200"}`}
              >
                {r.label}
              </button>
            ))}
            <button type="button" data-quiz-preset="blank" onClick={() => setDef({ title: "", questions: [blankQuestion()] })} className="rounded-full px-3 py-1.5 text-[12px] font-semibold text-slate-500 hover:bg-[var(--lanx-fill)]">
              Blank
            </button>
          </div>
          <div className="space-y-2">
            {def.questions.map((x, i) => (
              <QuestionEditor key={i} q={x} i={i} count={def.questions.length} onChange={(y) => setQ(i, y)} onMove={(d) => move(i, d)} onRemove={() => remove(i)} />
            ))}
            <div ref={listEnd} />
            <button type="button" data-quiz-add-q onClick={add} disabled={def.questions.length >= 50} className={`${secondaryBtn} w-full border-dashed`}>
              <Plus className="h-4 w-4" /> Add a question
            </button>
          </div>
        </div>
        <div className="md:sticky md:top-0 md:self-start">
          <div className="rounded-2xl lanx-group p-3">
            <PeoplePicker picked={picked} onChange={setPicked} failed={failed} />
          </div>
          <div className="mt-3 text-[12px] text-slate-500">
            {def.questions.length} question{def.questions.length === 1 ? "" : "s"} · about {Math.ceil(def.questions.reduce((a, x) => a + x.seconds + 12, 0) / 60)} min
          </div>
          {err && (
            <div data-quiz-error className="mt-2 rounded-xl bg-amber-500/10 px-3 py-2 text-[12.5px] font-medium text-amber-700 dark:text-amber-400">
              {err}
            </div>
          )}
          <button type="button" data-quiz-start disabled={busy} onClick={start} className={`${primaryBtn} mt-3`}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            {people.length ? `Invite ${people.length === 1 ? people[0].name.split(" ")[0] : `${people.length} people`}` : "Invite"}
          </button>
          <p className="mt-2 text-[11.5px] leading-snug text-slate-400">They get an invite to join. You start the first question when everyone's in.</p>
        </div>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ the screen

export function QuizScreen({ session, onClose }: { session: Session; onClose: () => void }) {
  useTogether();
  useQuiz();
  const isHost = session.role === "host";
  const state = readState(session.state);
  const [confirm, setConfirm] = useState(false);
  const peer = session.hostId;

  const sub = !state
    ? `Hosted by ${session.hostName}`
    : state.phase === "lobby"
      ? isHost
        ? `${session.members.size} joined · ${state.total} questions`
        : `Hosted by ${session.hostName} · ${state.total} questions`
      : state.phase === "end"
        ? "Final results"
        : `Question ${state.index + 1} of ${state.total}`;
  const leaveNow = () => {
    if (isHost && state?.phase !== "end" && !confirm) return setConfirm(true);
    onClose();
  };

  let body: React.ReactNode;
  if (!state)
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="h-6 w-6 animate-spin" />
        <div className="text-[14px]">Joining {session.hostName}'s quiz…</div>
      </div>
    );
  else if (state.phase === "lobby") body = isHost ? <HostLobby key="lobby" session={session} state={state} /> : <MemberLobby key="lobby" session={session} state={state} />;
  else if (state.phase === "question") body = <QuestionView key={`q${state.index}-${state.opens_at_us}`} session={session} state={state} peer={peer} />;
  else if (state.phase === "reveal") body = <RevealView key={`r${state.index}`} session={session} state={state} />;
  else if (state.phase === "board") body = <BoardView key={`b${state.index}`} session={session} state={state} />;
  else body = <EndView key="end" session={session} state={state} onClose={onClose} />;

  return (
    <div data-quiz-screen={session.role} data-quiz-phase={state?.phase ?? "joining"} className="fixed inset-0 z-[77] flex flex-col bg-[#f2f3f7] text-slate-900 lanx-fade dark:bg-[#0f1014] dark:text-white">
      <header className="flex items-center gap-3 border-b border-[var(--lanx-line)] px-5 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-400">
          <Brain className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold tracking-tight">{state?.title ?? "Live quiz"}</div>
          <div className="truncate text-[12px] text-slate-500">{sub}</div>
        </div>
        {isHost && (
          <span title="Playing" className="inline-flex items-center gap-1.5 rounded-full bg-[var(--lanx-fill)] px-3 py-1.5 text-[12.5px] font-semibold text-slate-600 dark:text-slate-300">
            <Users className="h-3.5 w-3.5" /> {session.members.size}
          </span>
        )}
        {confirm ? (
          <div className="flex items-center gap-1.5 lanx-fade">
            <span className="text-[12.5px] font-medium text-slate-500">End it for everyone?</span>
            <button type="button" data-quiz-end-confirm onClick={onClose} className="rounded-full bg-rose-500 px-3 py-1.5 text-[12.5px] font-bold text-white hover:bg-rose-600">
              End quiz
            </button>
            <button type="button" onClick={() => setConfirm(false)} className={secondaryBtn}>
              Keep playing
            </button>
          </div>
        ) : (
          <button type="button" data-quiz-close onClick={leaveNow} className={secondaryBtn}>
            {isHost ? <X className="h-4 w-4" /> : <LogOut className="h-4 w-4" />}
            {isHost ? (state?.phase === "end" ? "Close" : "End") : "Leave"}
          </button>
        )}
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[920px] flex-col px-6 py-6">{body}</div>
      </main>
    </div>
  );
}

type St<P extends QuizState["phase"]> = Extract<QuizState, { phase: P }>;

// -- lobby

function HostLobby({ session, state }: { session: Session; state: St<"lobby"> }) {
  const g = hostGame(session.id);
  const members = [...session.members.values()];
  const invited = [...session.invited.entries()];
  const [more, setMore] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const peers = useOnline();
  const exclude = [...session.members.keys(), ...session.invited.keys()];
  const sendMore = async () => {
    const people = chosen(peers, picked);
    if (!people.length) return;
    setSending(true);
    const f = await invite(session, people, { title: state.title, questions: state.total });
    setSending(false);
    setFailed(f);
    setPicked({});
    if (!Object.keys(f).length) setMore(false);
  };
  return (
    <div className="flex flex-1 flex-col lanx-rise">
      <div className="text-center">
        <div className="text-[30px] font-bold leading-tight tracking-tight">{state.title}</div>
        <div className="mt-1 text-[14px] text-slate-500">
          {state.total} questions · {members.length ? "people are joining" : "waiting for people to join"}
        </div>
      </div>
      <div className="mx-auto mt-8 w-full max-w-[640px] space-y-3">
        <div className="rounded-2xl lanx-group p-4">
          <div className="text-[12px] font-semibold text-slate-500">Joined · {members.length}</div>
          <div data-quiz-joined className="mt-2 flex min-h-[30px] flex-wrap gap-1.5">
            {members.length ? members.map((m) => <Chip key={m.id} id={m.id} name={m.name} />) : <span className="text-[13px] text-slate-400">Nobody yet — invites are on their screens.</span>}
          </div>
          {invited.length > 0 && (
            <>
              <div className="mt-4 text-[12px] font-semibold text-slate-500">Invited, not in yet · {invited.length}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {invited.map(([id, name]) => (
                  <Chip key={id} id={id} name={name} dim />
                ))}
              </div>
            </>
          )}
          {!!g?.failed.length && (
            <div data-quiz-failed className="mt-4 rounded-xl bg-amber-500/10 px-3 py-2 text-[12.5px] text-amber-700 dark:text-amber-400">
              <div className="font-semibold">Couldn't invite</div>
              {g.failed.map((f) => (
                <div key={f.id}>
                  {f.name} — {f.why}
                </div>
              ))}
            </div>
          )}
        </div>
        {more ? (
          <div className="rounded-2xl lanx-group p-3 lanx-fade">
            <PeoplePicker picked={picked} onChange={setPicked} failed={failed} exclude={exclude} />
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" onClick={() => setMore(false)} className={secondaryBtn}>
                Cancel
              </button>
              <button
                type="button"
                disabled={sending || !chosen(peers, picked).length}
                onClick={sendMore}
                className="inline-flex items-center gap-1.5 rounded-full bg-sky-500 px-4 py-2 text-[12.5px] font-bold text-white hover:bg-sky-600 disabled:opacity-40"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Invite
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setMore(true)} className={`${secondaryBtn} w-full`}>
            <UserPlus className="h-4 w-4" /> Invite more people
          </button>
        )}
      </div>
      <div className="mt-auto pt-8">
        <div className="mx-auto w-full max-w-[360px]">
          <button type="button" data-quiz-next disabled={!members.length} onClick={() => next(session.id)} className={`${primaryBtn} py-3 text-[15px]`}>
            Start the quiz <ChevronRight className="h-4 w-4" />
          </button>
          {!members.length && <div className="mt-2 text-center text-[12px] text-slate-400">You can start once someone has joined.</div>}
        </div>
      </div>
    </div>
  );
}

function MemberLobby({ session, state }: { session: Session; state: St<"lobby"> }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center lanx-rise">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-white lanx-pop">
        <Check className="h-7 w-7" />
      </span>
      <div className="mt-4 text-[26px] font-bold tracking-tight">You're in</div>
      <div className="mt-1 text-[14px] text-slate-500">
        Waiting for {session.hostName} to start “{state.title}”
      </div>
      {state.players.length > 0 && (
        <div className="mt-6 flex max-w-[620px] flex-wrap justify-center gap-1.5">
          {state.players.map((p) => (
            <Chip key={p.id} id={p.id} name={p.name} />
          ))}
        </div>
      )}
      <p className="mt-8 max-w-[420px] text-[12.5px] leading-relaxed text-slate-400">Each question opens on everyone's screen at the same moment. Tap the answer you think is right — quick right answers score more.</p>
    </div>
  );
}

// -- question

function OptionTile({ i, text, state, onPick, label }: { i: number; text: string; state: "idle" | "picked" | "faded" | "off"; onPick?: () => void; label?: React.ReactNode }) {
  const o = OPT[i];
  const picked = state === "picked";
  return (
    <button
      type="button"
      data-quiz-option={i}
      disabled={!onPick}
      onClick={onPick}
      className={`flex min-h-[92px] items-center gap-3.5 rounded-2xl px-4 py-3 text-left transition-[transform,opacity,background-color] duration-200 ${onPick ? "active:scale-[0.98]" : "cursor-default"} ${picked ? `${o.solid} text-white` : `${o.soft} text-slate-900 dark:text-white`} ${state === "faded" ? "opacity-35" : ""} ${onPick ? "hover:-translate-y-px" : ""}`}
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[16px] ${picked ? "bg-white/25 text-white" : `${o.solid} text-white`}`}>{o.shape}</span>
      <span className="min-w-0 flex-1 text-[18px] font-semibold leading-snug">{text}</span>
      {label}
    </button>
  );
}

function QuestionView({ session, state, peer }: { session: Session; state: St<"question">; peer: string }) {
  const isHost = session.role === "host";
  const opensAt = state.opens_at_us / 1000;
  const closesAt = state.closes_at_us / 1000;
  const opened = useAt(opensAt, peer);
  const closed = useAt(closesAt, peer);
  useTick(opened && !closed, 200);
  useLayoutEffect(() => {
    if (opened) noteOpened(session.id, state.index, isHost ? "host" : "member");
  }, [opened, session.id, state.index, isHost]);
  const pick = isHost ? null : myPick(session.id, state.index);
  const left = Math.max(0, Math.ceil(msUntil(closesAt, peer) / 1000));

  const g = isHost ? hostGame(session.id) : null;
  const answeredIds = g ? [...g.answers.keys()] : [];
  const members = [...session.members.values()];
  const shown = opened ? left : state.seconds;
  // The question is laid out (unseen) while it waits, so at the moment itself only visibility flips:
  // cheap, so it lands at the same instant even on a busy PC.
  return (
    <div className="relative flex flex-1 flex-col">
      {!opened && (
        <div data-quiz-ready className="absolute inset-0 z-10 flex flex-col items-center justify-center text-center lanx-fade">
          <div className="text-[13px] font-bold uppercase tracking-[0.12em] text-sky-600 dark:text-sky-400">
            Question {state.index + 1} of {state.total}
          </div>
          <div className="mt-2 text-[32px] font-bold tracking-tight">Get ready…</div>
          <div className="mt-6 w-[260px]">
            <Bar from={opensAt - LEAD_MS} to={opensAt} peer={peer} fill />
          </div>
        </div>
      )}
      <div data-quiz-open={opened ? "1" : undefined} aria-hidden={!opened} className={`flex flex-1 flex-col ${opened ? "lanx-fade" : "invisible"}`}>
        <div className="flex items-center gap-3">
          <Bar from={opensAt} to={closesAt} peer={peer} tone={opened && left <= 5 ? "bg-amber-500" : "bg-sky-500"} />
          <span
            data-quiz-left
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[17px] font-bold tabular-nums ${opened && left <= 5 && !closed ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" : "bg-[var(--lanx-fill)]"}`}
          >
            {shown}
          </span>
        </div>
        <div className="my-auto py-6">
          <div className={`mx-auto max-w-[760px] text-center text-[28px] font-bold leading-tight tracking-tight ${opened ? "lanx-rise" : ""}`}>{state.text}</div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {state.options.map((text, i) => (
            <OptionTile
              key={i}
              i={i}
              text={text}
              state={isHost ? "idle" : pick ? (pick.choice === i ? "picked" : "faded") : closed ? "faded" : "idle"}
              onPick={opened && !isHost && !closed && (!pick || pick.sent === "failed") ? () => void answer(session, state.index, i) : undefined}
            />
          ))}
        </div>
        <div className="mt-4 flex min-h-[44px] items-center justify-center gap-3 text-[13.5px] text-slate-500">
          {isHost ? (
            <>
              <span data-quiz-answered={answeredIds.length} className="font-semibold text-slate-700 dark:text-slate-200">
                {answeredIds.length} of {members.length} answered
              </span>
              <span className="flex -space-x-1.5">
                {answeredIds.slice(0, 12).map((id) => (
                  <span key={id} className="rounded-full ring-2 ring-[#f2f3f7] lanx-pop dark:ring-[#0f1014]">
                    <Face id={id} name={session.members.get(id)?.name ?? "?"} size={24} />
                  </span>
                ))}
              </span>
              <button type="button" data-quiz-next onClick={() => next(session.id)} className={secondaryBtn}>
                {closed ? "Show the answer" : "Stop and show the answer"}
              </button>
            </>
          ) : pick ? (
            pick.sent === "failed" ? (
              <span className="font-medium text-amber-600 dark:text-amber-400">Couldn't reach {session.hostName} — tap your answer again.</span>
            ) : (
              <span data-quiz-sent className="inline-flex items-center gap-1.5 font-medium">
                {pick.sent === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 text-emerald-500" />}
                Answer in — waiting for the others
              </span>
            )
          ) : closed ? (
            <span className="font-medium">Time's up</span>
          ) : (
            <span>Tap your answer</span>
          )}
        </div>
      </div>
    </div>
  );
}

// -- reveal

function RevealView({ session, state }: { session: Session; state: St<"reveal"> }) {
  const isHost = session.role === "host";
  const pick = isHost ? null : myPick(session.id, state.index);
  const res = isHost ? null : myResult(session.id, state.index);
  const most = Math.max(1, ...state.counts);
  const choice = res ? res.choice : (pick?.choice ?? -1);
  let banner: React.ReactNode = null;
  if (!isHost) {
    const right = res ? res.right : choice === state.correct;
    banner =
      choice >= 0 && right ? (
        <div data-quiz-verdict="right" className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-white lanx-pop">
          <Check className="h-5 w-5" />
          <span className="text-[17px] font-bold">Correct!</span>
          {res && <span className="text-[17px] font-bold tabular-nums">+{pts(res.points)}</span>}
        </div>
      ) : pick && res && res.choice < 0 ? (
        <div data-quiz-verdict="late" className="rounded-2xl bg-[var(--lanx-fill)] px-4 py-3 text-center text-[15px] font-semibold lanx-pop">
          Your answer came in after time was up
        </div>
      ) : choice >= 0 ? (
        <div data-quiz-verdict="wrong" className="rounded-2xl bg-rose-500/12 px-4 py-3 text-center text-[16px] font-bold text-rose-600 lanx-pop dark:text-rose-400">
          Not this time
        </div>
      ) : (
        <div data-quiz-verdict="none" className="rounded-2xl bg-[var(--lanx-fill)] px-4 py-3 text-center text-[15px] font-semibold lanx-pop">
          No answer this time
        </div>
      );
  }
  return (
    <div data-quiz-reveal className="flex flex-1 flex-col lanx-fade">
      <div className="mx-auto max-w-[760px] text-center text-[24px] font-bold leading-tight tracking-tight">{state.text}</div>
      {banner && <div className="mx-auto mt-4 w-full max-w-[420px]">{banner}</div>}
      <div className="mt-6 space-y-2">
        {state.options.map((text, i) => {
          const right = i === state.correct;
          const o = OPT[i];
          return (
            <div key={i} data-quiz-count={i} className={`relative overflow-hidden rounded-2xl px-4 py-3 transition-opacity ${right ? "bg-emerald-500/12 ring-2 ring-emerald-500" : "lanx-group opacity-70"}`}>
              <div className="flex items-center gap-3">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[13px] text-white ${o.solid}`}>{o.shape}</span>
                <span className="min-w-0 flex-1 text-[16px] font-semibold">{text}</span>
                {choice === i && <span className="rounded-full bg-[var(--lanx-fill)] px-2 py-0.5 text-[11.5px] font-semibold text-slate-600 dark:text-slate-300">Your answer</span>}
                <span className="w-10 text-right text-[16px] font-bold tabular-nums">{state.counts[i]}</span>
                <span className="flex w-6 justify-center">{right && <Check className="h-5 w-5 text-emerald-500" />}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--lanx-fill)]">
                <div className={`h-full origin-left rounded-full ${right ? "bg-emerald-500" : o.bar}`} style={{ transform: `scaleX(${state.counts[i] / most})`, transition: "transform 0.7s var(--ease-out-soft)" }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[13.5px] text-slate-500">
        <span>
          {state.answered} of {state.players} answered
        </span>
        {state.fastest ? (
          <span data-quiz-fastest={state.fastest.id} className="inline-flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-200">
            <Zap className="h-4 w-4 text-amber-500" /> Fastest: {state.fastest.id === myId(session.id) ? "you" : state.fastest.name} · {secs(state.fastest.ms)}
          </span>
        ) : (
          <span>Nobody got this one</span>
        )}
      </div>
      {isHost && (
        <div className="mx-auto mt-auto w-full max-w-[360px] pt-8">
          <button type="button" data-quiz-next onClick={() => next(session.id)} className={`${primaryBtn} py-3 text-[15px]`}>
            Leaderboard <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

// -- leaderboard

function Rows({ list, me, from = 0 }: { list: Player[]; me: string; from?: number }) {
  return (
    <div className="space-y-1.5">
      {list.map((p, i) => (
        <div
          key={p.id}
          data-quiz-row={p.id}
          className={`flex items-center gap-3 rounded-2xl px-4 py-2.5 ${p.id === me ? "bg-sky-500/12 ring-1 ring-sky-500/40" : "lanx-group"}`}
          style={{ animation: "lanx-msg 0.36s var(--ease-out-soft) both", animationDelay: `${(from + i) * 45}ms` }}
        >
          <span className="w-7 text-center text-[15px] font-bold tabular-nums text-slate-500">{p.rank}</span>
          <Face id={p.id} name={p.name} size={30} />
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">
            {p.name}
            {p.id === me && <span className="ml-1.5 text-[12px] font-semibold text-sky-600 dark:text-sky-400">you</span>}
          </span>
          {p.gained > 0 && <span className="text-[12.5px] font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">+{pts(p.gained)}</span>}
          <span className="w-20 text-right text-[16px] font-bold tabular-nums">{pts(p.score)}</span>
        </div>
      ))}
    </div>
  );
}

function BoardView({ session, state }: { session: Session; state: St<"board"> }) {
  const isHost = session.role === "host";
  const me = isHost ? "" : myId(session.id);
  const top = state.board.slice(0, 8);
  const mine = state.board.find((p) => p.id === me);
  const last = state.index + 1 >= state.total;
  return (
    <div data-quiz-board className="flex flex-1 flex-col lanx-fade">
      <div className="text-center">
        <div className="text-[13px] font-bold uppercase tracking-[0.12em] text-sky-600 dark:text-sky-400">
          After question {state.index + 1} of {state.total}
        </div>
        <div className="mt-1 text-[28px] font-bold tracking-tight">Leaderboard</div>
      </div>
      <div className="mx-auto mt-6 w-full max-w-[620px]">
        {state.board.length ? <Rows list={top} me={me} /> : <div className="text-center text-[14px] text-slate-400">No scores yet.</div>}
        {mine && !top.includes(mine) && (
          <div className="mt-3 border-t border-[var(--lanx-line)] pt-3">
            <Rows list={[mine]} me={me} from={top.length} />
          </div>
        )}
      </div>
      {isHost && (
        <div className="mx-auto mt-auto w-full max-w-[360px] pt-8">
          <button type="button" data-quiz-next onClick={() => next(session.id)} className={`${primaryBtn} py-3 text-[15px]`}>
            {last ? (
              <>
                <Trophy className="h-4 w-4" /> Final results
              </>
            ) : (
              <>
                Next question <ChevronRight className="h-4 w-4" />
              </>
            )}
          </button>
          {!last && (
            <button type="button" onClick={() => finish(session.id)} className="mt-2 w-full text-center text-[12px] font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
              Finish here
            </button>
          )}
        </div>
      )}
      {!isHost && <div className="mt-auto pt-8 text-center text-[13px] text-slate-400">{session.hostName} will start the next one.</div>}
    </div>
  );
}

// -- the end

const PODIUM = [
  { place: 2, h: 104, tone: "bg-slate-400/20 dark:bg-slate-400/15", medal: "bg-slate-400", delay: 160 },
  { place: 1, h: 148, tone: "bg-amber-400/25 dark:bg-amber-400/15", medal: "bg-amber-500", delay: 320 },
  { place: 3, h: 76, tone: "bg-orange-500/15 dark:bg-orange-500/12", medal: "bg-orange-500", delay: 0 },
];

function EndView({ session, state, onClose }: { session: Session; state: St<"end">; onClose: () => void }) {
  const isHost = session.role === "host";
  const me = isHost ? "" : myId(session.id);
  const mine = state.board.find((p) => p.id === me);
  // By position on the board (ties share a rank but each stands on a step).
  const podium = PODIUM.map((s) => ({ ...s, p: state.board[s.place - 1] })).filter((s) => s.p);
  return (
    <div data-quiz-end className="flex flex-1 flex-col lanx-fade">
      <div className="text-center">
        <div className="text-[13px] font-bold uppercase tracking-[0.12em] text-sky-600 dark:text-sky-400">Final results</div>
        <div className="mt-1 text-[28px] font-bold tracking-tight">{state.board[0] ? `${state.board[0].id === me ? "You win" : `${state.board[0].name} wins`}!` : "That's the quiz"}</div>
        {mine && (
          <div data-quiz-mine className="mt-1 text-[14px] text-slate-500">
            You came {nth(mine.rank)} of {state.board.length} · {pts(mine.score)} points · {mine.right} of {state.total} right
          </div>
        )}
      </div>
      {podium.length > 0 && (
        <div className="mx-auto mt-8 flex items-end justify-center gap-3">
          {podium.map(({ p, place, h, tone, medal, delay }) => (
            <div key={place} data-quiz-podium={place} className="flex w-[150px] flex-col items-center" style={{ animation: "lanx-rise 0.5s var(--ease-out-soft) both", animationDelay: `${delay}ms` }}>
              <Face id={p.id} name={p.name} size={place === 1 ? 56 : 46} />
              <div className="mt-2 w-full truncate text-center text-[14px] font-bold">{p.id === me ? "You" : p.name}</div>
              <div className="text-[12.5px] font-semibold tabular-nums text-slate-500">{pts(p.score)}</div>
              <div className={`mt-2 flex w-full items-start justify-center rounded-t-2xl pt-3 ${tone}`} style={{ height: h }}>
                <span className={`flex h-8 w-8 items-center justify-center rounded-full text-[14px] font-bold text-white ${medal}`}>{place}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {state.board.length > 3 && (
        <div className="mx-auto mt-6 w-full max-w-[620px]">
          <Rows list={state.board.slice(3)} me={me} from={3} />
        </div>
      )}
      <div className="mx-auto mt-auto w-full max-w-[360px] pt-8">
        {isHost ? (
          <button type="button" data-quiz-done onClick={onClose} className={`${primaryBtn} py-3 text-[15px]`}>
            Close quiz
          </button>
        ) : (
          <>
            <button type="button" data-quiz-done onClick={onClose} className={`${secondaryBtn} w-full py-2.5`}>
              <LogOut className="h-4 w-4" /> Leave
            </button>
            <div className="mt-2 text-center text-[12px] text-slate-400">This closes for everyone when {session.hostName} closes the quiz.</div>
          </>
        )}
      </div>
    </div>
  );
}
