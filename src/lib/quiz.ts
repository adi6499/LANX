/** LANX 3.9.0: Live quiz — the questions, the ready-made quizzes, and the game.
 *
 *  - The host's PC runs the game: it opens each question at one instant on
 *    every screen (host time + 1.5 s), closes it, scores, and publishes what
 *    everyone sees. The right answer never leaves the host before the reveal.
 *  - Members answer with the moment they tapped, on the host's clock (their
 *    clock is lined up with the host's when they join). So a PC whose clock is
 *    off, or whose answer took longer to arrive, is scored for when the person
 *    actually tapped — the fastest person wins, not the fastest network.
 *  - Points: a right answer is 500 + up to 500 more for speed. Whole numbers
 *    only on the wire (see together.ts). */
import { type Session, type Step, clockWith, host, hostNow, leave, publish, tell, together } from "./together";

export type Question = { text: string; options: string[]; correct: number; seconds: number };
export type QuizDef = { title: string; questions: Question[] };

export type Player = { id: string; name: string; score: number; gained: number; rank: number; right: number };
export type Fastest = { id: string; name: string; ms: number };
export type Phase = "lobby" | "question" | "reveal" | "board" | "end";

/** What the host publishes (all whole numbers; never the right answer while a question is open). */
export type QuizState =
  | { phase: "lobby"; title: string; total: number; players: { id: string; name: string }[] }
  | { phase: "question"; title: string; index: number; total: number; text: string; options: string[]; seconds: number; opens_at_us: number; closes_at_us: number }
  | { phase: "reveal"; title: string; index: number; total: number; text: string; options: string[]; correct: number; counts: number[]; answered: number; players: number; fastest: Fastest | null }
  | { phase: "board"; title: string; index: number; total: number; board: Player[] }
  | { phase: "end"; title: string; total: number; board: Player[] };

/** What the host tells one member after each question. */
export type Result = { index: number; choice: number; right: boolean; points: number; score: number; rank: number; players: number };

/** An answer may be stamped up to this long after the close (a tap on the last frame). */
export const GRACE_MS = 300;
/** A question opens this long after the host publishes it, on every screen at once. */
export const LEAD_MS = 1500;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;
export const SECONDS = [10, 20, 30, 45, 60];

// ------------------------------------------------------------------ ready-made quizzes

const q = (text: string, options: string[], correct: number, seconds = 20): Question => ({ text, options, correct, seconds });

export const READY: { key: string; label: string; quiz: QuizDef }[] = [
  {
    key: "office",
    label: "Office fun",
    quiz: {
      title: "Office fun",
      questions: [
        q("In office chat, what does “EOD” usually mean?", ["End of day", "Every other day", "End of discussion", "Edit on demand"], 0),
        q("Which shortcut locks a Windows PC straight away?", ["Ctrl + L", "Windows + L", "Alt + Tab", "Windows + D"], 1),
        q("Which keys undo your last action in most programs?", ["Ctrl + Y", "Ctrl + U", "Ctrl + Z", "Alt + F4"], 2),
        q("What does “CC” stand for on an email?", ["Common contact", "Copy check", "Central copy", "Carbon copy"], 3),
        q("How many hours are there in a week?", ["144", "168", "160", "172"], 1),
        q("If today is Monday, what day is it 100 days from now?", ["Wednesday", "Tuesday", "Thursday", "Monday"], 0),
      ],
    },
  },
  {
    key: "india",
    label: "General knowledge (India)",
    quiz: {
      title: "General knowledge (India)",
      questions: [
        q("What is India's national animal?", ["Lion", "Elephant", "Tiger", "Peacock"], 2),
        q("Who wrote “Jana Gana Mana”?", ["Rabindranath Tagore", "Bankim Chandra Chattopadhyay", "Sarojini Naidu", "Subramania Bharati"], 0),
        q("How many spokes does the Ashoka Chakra on the flag have?", ["22", "24", "20", "26"], 1),
        q("In which year did India become a republic?", ["1947", "1949", "1950", "1952"], 2),
        q("Which city is called the “Silicon Valley of India”?", ["Hyderabad", "Pune", "Chennai", "Bengaluru"], 3),
        q("How many states does India have?", ["28", "29", "26", "30"], 0),
      ],
    },
  },
  {
    key: "tech",
    label: "Tech basics",
    quiz: {
      title: "Tech basics",
      questions: [
        q("What does “CPU” stand for?", ["Computer Personal Unit", "Central Processing Unit", "Core Program Utility", "Central Power Unit"], 1),
        q("How many bits make one byte?", ["4", "10", "8", "16"], 2),
        q("What does “LAN” stand for?", ["Local Area Network", "Large Access Node", "Linked App Network", "Long Area Network"], 0),
        q("How many megabytes are in a gigabyte, as Windows counts?", ["100", "256", "10,000", "1,024"], 3),
        q("What does the “s” in https:// tell you?", ["The site is small", "The connection is encrypted", "The site is in South Asia", "The page is saved"], 1),
        q("Which of these should you never share, not even with IT?", ["Your PC's name", "Your desk number", "Your password", "Your email address"], 2),
      ],
    },
  },
];

export const blankQuestion = (): Question => ({ text: "", options: ["", "", "", ""], correct: 0, seconds: 20 });

/** The quiz as it will be played: trimmed, empty answers dropped, the right one still pointed at. */
export function tidy(def: QuizDef): QuizDef {
  return {
    title: def.title.trim() || "Live quiz",
    questions: def.questions.map((x) => {
      const kept = x.options.map((o, i) => ({ o: o.trim(), i })).filter((o) => o.o);
      const correct = Math.max(
        0,
        kept.findIndex((o) => o.i === x.correct),
      );
      const seconds = SECONDS.includes(x.seconds) ? x.seconds : 20;
      return { text: x.text.trim(), options: kept.map((o) => o.o), correct, seconds };
    }),
  };
}
/** Why this quiz can't start yet ("" = it can). */
export function problem(def: QuizDef): string {
  if (!def.questions.length) return "Add a question.";
  for (let i = 0; i < def.questions.length; i++) {
    const x = def.questions[i];
    if (!x.text.trim()) return `Question ${i + 1} needs its question.`;
    if (x.options.filter((o) => o.trim()).length < MIN_OPTIONS) return `Question ${i + 1} needs at least two answers.`;
    if (!x.options[x.correct]?.trim()) return `Question ${i + 1}: the right answer is empty.`;
  }
  return "";
}

// ------------------------------------------------------------------ reading what arrives

const int = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : d);
const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
function readBoard(v: unknown): Player[] {
  return arr(v)
    .map(rec)
    .map((p) => ({ id: str(p.id), name: str(p.name, "Someone"), score: int(p.score), gained: int(p.gained), rank: int(p.rank, 1), right: int(p.right) }))
    .filter((p) => p.id);
}
/** The published state, checked (a colleague's PC sent it). */
export function readState(x: unknown): QuizState | null {
  const d = rec(x);
  const title = str(d.title, "Live quiz");
  const total = int(d.total);
  const options = arr(d.options)
    .map((o) => str(o))
    .slice(0, MAX_OPTIONS);
  switch (d.phase) {
    case "lobby":
      return {
        phase: "lobby",
        title,
        total,
        players: arr(d.players)
          .map(rec)
          .map((p) => ({ id: str(p.id), name: str(p.name, "Someone") })),
      };
    case "question":
      if (options.length < MIN_OPTIONS) return null;
      return { phase: "question", title, index: int(d.index), total, text: str(d.text), options, seconds: int(d.seconds, 20), opens_at_us: int(d.opens_at_us), closes_at_us: int(d.closes_at_us) };
    case "reveal": {
      if (options.length < MIN_OPTIONS) return null;
      const f = d.fastest ? rec(d.fastest) : null;
      return {
        phase: "reveal",
        title,
        index: int(d.index),
        total,
        text: str(d.text),
        options,
        correct: int(d.correct, -1),
        counts: options.map((_, i) => int(arr(d.counts)[i])),
        answered: int(d.answered),
        players: int(d.players),
        fastest: f && str(f.id) ? { id: str(f.id), name: str(f.name, "Someone"), ms: int(f.ms) } : null,
      };
    }
    case "board":
      return { phase: "board", title, index: int(d.index), total, board: readBoard(d.board) };
    case "end":
      return { phase: "end", title, total, board: readBoard(d.board) };
  }
  return null;
}

// ------------------------------------------------------------------ the store the screens watch

let version = 0;
const subs = new Set<() => void>();
function bump() {
  version += 1;
  for (const l of subs) l();
}
export const quizStore = {
  subscribe(l: () => void) {
    subs.add(l);
    return () => void subs.delete(l);
  },
  version: () => version,
};

// ------------------------------------------------------------------ host: running the game

type Answer = { choice: number; at: number; right: boolean; points: number };
type Score = { id: string; name: string; score: number; gained: number; right: number };
export type HostGame = {
  session: Session;
  def: QuizDef;
  phase: Phase;
  index: number;
  /** host ms */
  opensAt: number;
  closesAt: number;
  /** this question's answers, by member */
  answers: Map<string, Answer>;
  scores: Map<string, Score>;
  /** who couldn't be invited, and why */
  failed: { id: string; name: string; why: string }[];
  timer: number | undefined;
};
const games = new Map<string, HostGame>();
export const hostGame = (sessionId: string) => games.get(sessionId) ?? null;

function board(g: HostGame): Player[] {
  const list = [...g.scores.values()].sort((a, b) => b.score - a.score || b.right - a.right || a.name.localeCompare(b.name));
  let rank = 0;
  return list.map((p, i) => {
    if (i === 0 || p.score !== list[i - 1].score) rank = i + 1;
    return { id: p.id, name: p.name, score: p.score, gained: p.gained, rank, right: p.right };
  });
}
const players = (g: HostGame) => [...g.session.members.values()].map((m) => ({ id: m.id, name: m.name }));
function show(g: HostGame, state: QuizState) {
  publish(g.session, state as unknown as Record<string, unknown>);
  bump();
}
function lobby(g: HostGame) {
  show(g, { phase: "lobby", title: g.def.title, total: g.def.questions.length, players: players(g) });
}
function clear(g: HostGame) {
  window.clearTimeout(g.timer);
  g.timer = undefined;
}

/** Host: starts a quiz and invites `people`. `invited` = how many invites went out. */
export async function startQuiz(def: QuizDef, people: { id: string; name: string }[], myName: string): Promise<{ sessionId: string; invited: number; failed: { id: string; name: string; why: string }[] }> {
  const quiz = tidy(def);
  const first: QuizState = { phase: "lobby", title: quiz.title, total: quiz.questions.length, players: [] };
  const { session, failed } = await host("quiz", people, myName, first as unknown as Record<string, unknown>, { title: quiz.title, questions: quiz.questions.length });
  const why = people.filter((p) => failed[p.id]).map((p) => ({ id: p.id, name: p.name, why: failed[p.id] }));
  const s = session as unknown as Session;
  games.set(s.id, { session: s, def: quiz, phase: "lobby", index: -1, opensAt: 0, closesAt: 0, answers: new Map(), scores: new Map(), failed: why, timer: undefined });
  bump();
  return { sessionId: s.id, invited: s.invited.size + s.members.size, failed: why };
}

function ask(g: HostGame, index: number) {
  clear(g);
  const x = g.def.questions[index];
  g.phase = "question";
  g.index = index;
  g.answers = new Map();
  for (const p of g.scores.values()) p.gained = 0;
  g.opensAt = Math.round(hostNow()) + LEAD_MS;
  g.closesAt = g.opensAt + x.seconds * 1000;
  show(g, { phase: "question", title: g.def.title, index, total: g.def.questions.length, text: x.text, options: x.options, seconds: x.seconds, opens_at_us: g.opensAt * 1000, closes_at_us: g.closesAt * 1000 });
  g.timer = window.setTimeout(() => reveal(g), g.closesAt + GRACE_MS - hostNow());
}

function reveal(g: HostGame) {
  if (g.phase !== "question") return;
  clear(g);
  const x = g.def.questions[g.index];
  const counts = x.options.map(() => 0);
  let fastest: Fastest | null = null;
  let best = Infinity;
  for (const [id, a] of g.answers) {
    counts[a.choice] += 1;
    const p = g.scores.get(id);
    if (p) {
      p.score += a.points;
      p.gained = a.points;
      if (a.right) p.right += 1;
    }
    if (a.right && a.at < best) {
      best = a.at;
      fastest = { id, name: p?.name ?? g.session.members.get(id)?.name ?? "Someone", ms: Math.max(0, Math.round(a.at - g.opensAt)) };
    }
  }
  g.phase = "reveal";
  show(g, { phase: "reveal", title: g.def.title, index: g.index, total: g.def.questions.length, text: x.text, options: x.options, correct: x.correct, counts, answered: g.answers.size, players: g.session.members.size, fastest });
  // Each player hears how they did.
  const b = board(g);
  for (const m of g.session.members.values()) {
    const a = g.answers.get(m.id);
    const me = b.find((p) => p.id === m.id);
    const r: Result = { index: g.index, choice: a?.choice ?? -1, right: !!a?.right, points: a?.points ?? 0, score: me?.score ?? 0, rank: me?.rank ?? b.length, players: b.length };
    void tell(g.session, "result", { id: m.id, ...r }, m.id);
  }
}

/** Host: on to what comes next (start → question → reveal → leaderboard → next question … → podium). */
export function next(sessionId: string) {
  const g = games.get(sessionId);
  if (!g) return;
  const total = g.def.questions.length;
  if (g.phase === "lobby") ask(g, 0);
  else if (g.phase === "question") reveal(g);
  else if (g.phase === "reveal") {
    g.phase = "board";
    show(g, { phase: "board", title: g.def.title, index: g.index, total, board: board(g) });
  } else if (g.phase === "board") {
    if (g.index + 1 < total) ask(g, g.index + 1);
    else finish(sessionId);
  }
}
/** Host: straight to the podium. */
export function finish(sessionId: string) {
  const g = games.get(sessionId);
  if (!g) return;
  clear(g);
  g.phase = "end";
  show(g, { phase: "end", title: g.def.title, total: g.def.questions.length, board: board(g) });
}
/** Host: ends the session (everyone's screen closes). */
export function closeQuiz(sessionId: string) {
  const g = games.get(sessionId);
  if (g) void leave(g.session);
}

function hostStep(g: HostGame, e: Step) {
  const s = g.session;
  if (e.action === "join") {
    const had = g.scores.get(e.from_id);
    if (had) had.name = e.from_name || had.name;
    else g.scores.set(e.from_id, { id: e.from_id, name: e.from_name || "Someone", score: 0, gained: 0, right: 0 });
    if (g.phase === "lobby") lobby(g);
    else bump();
    const me = board(g).find((p) => p.id === e.from_id);
    void tell(s, "hello", { id: e.from_id, score: me?.score ?? 0 }, e.from_id);
    return;
  }
  if (e.action === "leave" || e.action === "decline") {
    // Someone who leaves with no points drops off the board (an answer still waiting to be scored counts).
    if (g.scores.get(e.from_id)?.score === 0 && !g.answers.has(e.from_id)) g.scores.delete(e.from_id);
    if (g.phase === "lobby") lobby(g);
    else {
      bump();
      everyoneIn(g);
    }
    return;
  }
  if (e.action !== "answer" || g.phase !== "question") return;
  const m = s.members.get(e.from_id);
  if (!m || g.answers.has(m.id)) return;
  const x = g.def.questions[g.index];
  const d = e.data ?? {};
  const index = d.index;
  const choice = d.choice;
  if (index !== g.index || typeof choice !== "number" || !Number.isInteger(choice) || choice < 0 || choice >= x.options.length) return;
  const now = hostNow();
  // When they tapped, on this PC's clock; it can't be after the answer got here.
  let at = typeof d.at_us === "number" && Number.isFinite(d.at_us) ? d.at_us / 1000 : now;
  at = Math.min(at, now);
  if (at > g.closesAt + GRACE_MS) return;
  at = Math.max(at, g.opensAt);
  const right = choice === x.correct;
  const left = Math.min(1, Math.max(0, (g.closesAt - at) / (g.closesAt - g.opensAt)));
  g.answers.set(m.id, { choice, at, right, points: right ? 500 + Math.round(500 * left) : 0 });
  if (!g.scores.has(m.id)) g.scores.set(m.id, { id: m.id, name: m.name, score: 0, gained: 0, right: 0 });
  bump();
  everyoneIn(g);
}
/** Everyone playing has answered: reveal a moment later (the last tap gets to feel sent). */
function everyoneIn(g: HostGame) {
  if (g.phase !== "question" || !g.session.members.size) return;
  for (const id of g.session.members.keys()) if (!g.answers.has(id)) return;
  clear(g);
  g.timer = window.setTimeout(() => reveal(g), 600);
}

// ------------------------------------------------------------------ member: answering

export type Pick = { choice: number; at_us: number; sent: "sending" | "sent" | "failed" };
type Mine = { me: string; picks: Map<number, Pick>; results: Map<number, Result> };
const mine = new Map<string, Mine>();
function mineFor(sessionId: string): Mine {
  let m = mine.get(sessionId);
  if (!m) mine.set(sessionId, (m = { me: "", picks: new Map(), results: new Map() }));
  return m;
}
export const myId = (sessionId: string) => mine.get(sessionId)?.me ?? "";
export const myPick = (sessionId: string, index: number) => mine.get(sessionId)?.picks.get(index) ?? null;
export const myResult = (sessionId: string, index: number) => mine.get(sessionId)?.results.get(index) ?? null;

/** Member: the answer, stamped with the moment of the tap on the host's clock. Once per question. */
export async function answer(s: Session, index: number, choice: number) {
  const m = mineFor(s.id);
  const had = m.picks.get(index);
  if (had && had.sent !== "failed") return;
  const pick: Pick = { choice, at_us: had?.at_us ?? Math.round(hostNow(s.hostId) * 1000), sent: "sending" };
  m.picks.set(index, pick);
  bump();
  const err = await tell(s, "answer", { index, choice, at_us: pick.at_us });
  pick.sent = err ? "failed" : "sent";
  bump();
}

function memberStep(e: Step, s: Session) {
  const d = e.data ?? {};
  if (e.action === "state" && d.phase === "board") {
    // PC clocks drift a little over a long quiz: line up with the host again while everyone looks
    // at the leaderboard (a quiet moment, so the measurement is clean), before the next question.
    void clockWith(s.hostId, 8, 20000).catch(() => {});
  } else if (e.action === "hello") {
    mineFor(e.session_id).me = str(d.id);
    bump();
  } else if (e.action === "result") {
    const m = mineFor(e.session_id);
    m.me = str(d.id, m.me);
    const r: Result = { index: int(d.index, -1), choice: int(d.choice, -1), right: d.right === true, points: int(d.points), score: int(d.score), rank: int(d.rank), players: int(d.players) };
    if (r.index >= 0) m.results.set(r.index, r);
    bump();
  }
}

// ------------------------------------------------------------------ the steps

/** For tests and the screens: when a question appeared on this PC (wall clock, ms). */
export const quizProbe = { opened: [] as { session: string; index: number; role: "host" | "member"; wall: number }[] };
export function noteOpened(session: string, index: number, role: "host" | "member") {
  quizProbe.opened.push({ session, index, role, wall: performance.timeOrigin + performance.now() });
  if (quizProbe.opened.length > 100) quizProbe.opened.shift();
}

function onStep(e: Step, s: Session | null) {
  // "closed": this PC left (or, as host, ended it); "end": the host ended it (a member's "end" means nothing).
  if ((e.action === "closed" && !e.from_id) || (e.action === "end" && s?.role !== "host")) {
    const g = games.get(e.session_id);
    if (g) {
      clear(g);
      games.delete(e.session_id);
    }
    mine.delete(e.session_id);
    bump();
    return;
  }
  if (!s) return;
  if (s.role === "host") {
    const g = games.get(s.id);
    if (g) hostStep(g, e);
  } else memberStep(e, s);
}
const un = together.on("quiz", onStep);
if (import.meta.hot) import.meta.hot.dispose(() => un());
