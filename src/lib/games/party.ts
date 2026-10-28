// Party games played in timed rounds, run by the host (the one who opened
// the table). The host opens a round ("o:<round>:<deadline>"), everyone
// answers at once ("<player>@a:<answer>"), and the host closes it
// ("e:<round>") when the clock runs out or everyone has answered. Only the
// host's PC adds the opening and closing steps; the others' steps are marked
// with their own player number. Answers are scored when the round closes.
// LANX 2.17.0: "x<p>" — player p left: they answer no more, a round waits
// only for those still in, and they can't win; with one player left the
// game is over. Every right answer scores the same (the old "first in"
// bonus went by arrival order at the host, which favoured the host's PC).

import { ON, draw, leaver, win, type GameDef, type Outcome } from "./core.ts";

export interface RoundState {
  /** Rounds played so far (the current one included once open). */
  round: number;
  open: boolean;
  /** When the host will close the round (ms since epoch, the host's clock). */
  deadline: number;
  /** Answers this round, by player, in arrival order. */
  answers: { player: number; text: string }[];
  scores: number[];
  /** LANX 2.17.0: who left the table. */
  out: boolean[];
  /** Words about the rounds, for everyone ("P2" = player 2; the boards put names in). */
  log: string[];
  done: boolean;
}

export type PartyState<Extra> = RoundState & { extra: Extra | null };

export interface PartyRules<Extra> {
  /** Rounds in a game, or (2.17.0) worked out from the table size. */
  rounds: number | ((n: number) => number);
  /** Something for this round from the seed (a question, a sum, a word); null when no round can open. */
  setup(seed: string, round: number, n: number, s: PartyState<Extra>): Extra | null;
  /** Scores the round's answers; returns a line for the log. */
  score(s: RoundState, extra: Extra, n: number): string;
  /** Whether a player's answer may be taken (e.g. one answer only). */
  accept?(s: RoundState, player: number, text: string, extra: Extra): boolean;
  /** Players may send several answers in a round (words, taps). */
  multi?: boolean;
  /** Seconds a round lasts (the host's clock), for the boards. */
  seconds: number;
  /** The lowest number of players that makes sense. */
  minPlayers?: number;
  /** LANX 2.17.0: whether the game is over once this round has closed (default: after the last round). */
  over?(s: PartyState<Extra>, n: number): boolean;
  /** LANX 2.17.0: rounds in this game as things stand (default: `rounds`), for the boards. */
  total?(s: PartyState<Extra>, n: number): number;
}

/** LANX 2.17.0: the players still at the table. */
export const present = (s: RoundState): number[] => s.out.map((o, p) => (o ? -1 : p)).filter((p) => p >= 0);
/** Everyone still at the table has answered this round. */
export const allAnswered = (s: RoundState): boolean => {
  const ps = present(s);
  return ps.length > 0 && ps.every((p) => s.answers.some((a) => a.player === p));
};
/** "P1", "P1 and P3", "P1, P2 and P4". */
export function listOf(players: number[]): string {
  const t = players.map((p) => `P${p + 1}`);
  return t.length <= 1 ? (t[0] ?? "nobody") : `${t.slice(0, -1).join(", ")} and ${t[t.length - 1]}`;
}
const roundsFor = (r: { rounds: number | ((n: number) => number) }, n: number) => (typeof r.rounds === "number" ? r.rounds : r.rounds(n));

export function partyReplay<Extra>(moves: string[], n: number, seed: string, r: PartyRules<Extra>): PartyState<Extra> | null {
  const s: PartyState<Extra> = { round: 0, open: false, deadline: 0, answers: [], scores: Array(n).fill(0), out: Array(n).fill(false), log: [], done: false, extra: null };
  for (const m of moves) {
    if (s.done) return null;
    const gone = leaver(m, n);
    if (gone !== null) {
      if (gone < 0 || s.out[gone]) return null;
      s.out[gone] = true;
      s.log.push(`P${gone + 1} left the game.`);
      if (present(s).length <= 1) {
        s.open = false;
        s.done = true;
      }
      continue;
    }
    const open = /^o:(\d+):(\d+)$/.exec(m);
    if (open) {
      if (s.open || Number(open[1]) !== s.round + 1) return null;
      const extra = r.setup(seed, s.round + 1, n, s);
      if (extra === null) return null;
      s.round++;
      s.open = true;
      s.deadline = Number(open[2]);
      s.answers = [];
      s.extra = extra;
      continue;
    }
    const close = /^e:(\d+)$/.exec(m);
    if (close) {
      if (!s.open || Number(close[1]) !== s.round) return null;
      s.open = false;
      s.log.push(r.score(s, s.extra as Extra, n));
      if (r.over ? r.over(s, n) : s.round >= roundsFor(r, n)) s.done = true;
      continue;
    }
    const ans = /^(\d+)@a:(.*)$/s.exec(m);
    if (!ans) return null;
    const p = Number(ans[1]);
    if (!s.open || p < 0 || p >= n || s.out[p]) return null;
    if (!r.multi && s.answers.some((a) => a.player === p)) return null; // one answer each
    if (r.accept && !r.accept(s, p, ans[2], s.extra as Extra)) return null;
    s.answers.push({ player: p, text: ans[2].slice(0, 200) });
  }
  return s;
}

export function partyOutcome(s: RoundState, _n: number, what = "points"): Outcome {
  if (!s.done) return ON;
  const ps = present(s);
  if (ps.length === 1 && s.out.some(Boolean)) return win(ps[0], `the others left · ${s.scores[ps[0]]} ${what}`, s.scores);
  const best = Math.max(...ps.map((p) => s.scores[p]));
  const tops = ps.filter((p) => s.scores[p] === best);
  return tops.length > 1 ? draw(`${best} ${what} each`, s.scores) : win(tops[0], `${best} ${what}`, s.scores);
}

/** Everyone acts at once while a round is open; between rounds the host acts. */
export const partyTurn = () => -1;

export type PartyDef<Extra> = GameDef<PartyState<Extra>> & {
  /** LANX 2.17.0: the round rules, for the boards (seconds, rounds). */
  rules: PartyRules<Extra>;
  /** Rounds in this game as things stand. */
  total(s: PartyState<Extra>, n: number): number;
};

export function partyDef<Extra>(id: string, name: string, blurb: string, emoji: string, maxPlayers: number, r: PartyRules<Extra>, what = "points"): PartyDef<Extra> {
  const total = (s: PartyState<Extra>, n: number) => (r.total ? r.total(s, n) : roundsFor(r, n));
  return {
    id,
    name,
    blurb,
    emoji,
    minPlayers: r.minPlayers ?? 2,
    maxPlayers,
    hosted: true,
    rules: r,
    total,
    replay: (moves, n, seed) => partyReplay(moves, n, seed, r),
    turn: partyTurn,
    outcome: (s, n) => partyOutcome(s, n, what),
    summary: (s, n) => `round ${s.round}/${total(s, n)} · ` + s.scores.map((x, i) => `P${i + 1} ${x}${s.out[i] ? " (left)" : ""}`).join(" · "),
  };
}

const hashOf = (text: string) => {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
};

// ---------------------------------------------------------------- Tap Roulette

export interface TapExtra {
  /** From the seed: picks the loser among the tappers when everyone tapped in. */
  draw: number;
  /** Filled in when the round closes: who lost, and whether the wheel drew them (everyone was in). */
  losers?: number[];
  drawn?: boolean;
}

/** LANX 2.17.0: whoever hasn't tapped in when the round closes loses it; when everyone did, the
 *  wheel draws one loser among them (from the seed, so the same on every PC). */
export function tapLosers(s: RoundState, extra: TapExtra): { losers: number[]; drawn: boolean } {
  const ps = present(s);
  const tapped = ps.filter((p) => s.answers.some((a) => a.player === p));
  const missed = ps.filter((p) => !tapped.includes(p));
  if (missed.length || !tapped.length) return { losers: missed, drawn: false };
  return { losers: [tapped[extra.draw % tapped.length]], drawn: true };
}

export const tapRoulette = partyDef<TapExtra>(
  "taproulette",
  "Tap Roulette",
  "Tap in before the clock runs out — miss it and you lose; if everyone's in, the wheel picks one loser.",
  "🎯",
  8,
  {
    rounds: 5,
    seconds: 10,
    setup: (seed, round) => ({ draw: hashOf(`${seed}#tap${round}`) }),
    score: (s, extra) => {
      const { losers, drawn } = tapLosers(s, extra);
      extra.losers = losers;
      extra.drawn = drawn;
      for (const p of present(s)) if (!losers.includes(p)) s.scores[p] += 1;
      if (drawn) return `Round ${s.round}: everyone tapped in — the wheel picks P${losers[0] + 1}, who loses!`;
      return `Round ${s.round}: ${listOf(losers)} didn't tap in — ${losers.length > 1 ? "they lose" : "loses"}!`;
    },
  },
  "survivals",
);

// ---------------------------------------------------------------- Math Rush

export interface MathExtra {
  question: string;
  answer: number;
}

export const mathRush = partyDef<MathExtra>(
  "mathrush",
  "Math Rush",
  "Quick sums for everyone at once: a point for each right answer.",
  "➗",
  8,
  {
    rounds: 10,
    seconds: 15,
    setup: (seed, round) => {
      const x = hashOf(`${seed}#math${round}`);
      const kind = x % 4;
      const a = 2 + ((x >>> 4) % 48);
      const b = 2 + ((x >>> 12) % 24);
      if (kind === 0) return { question: `${a} + ${b}`, answer: a + b };
      if (kind === 1) return { question: `${a + b} − ${b}`, answer: a };
      if (kind === 2) return { question: `${a % 13} × ${b % 13}`, answer: (a % 13) * (b % 13) };
      const q = (a % 12) + 1;
      return { question: `${q * (b % 10 + 1)} ÷ ${q}`, answer: (b % 10) + 1 };
    },
    score: (s, extra) => {
      const right = s.answers.filter((a) => Number(a.text) === extra.answer).map((a) => a.player);
      for (const p of right) s.scores[p] += 1;
      return `Round ${s.round}: ${extra.question} = ${extra.answer}${right.length ? ` — right: ${listOf(right)}` : " — nobody got it"}`;
    },
  },
);

// ---------------------------------------------------------------- Trivia Night

export interface TriviaQ {
  q: string;
  options: string[];
  /** Index of the right option. */
  a: number;
}

export const TRIVIA: TriviaQ[] = [
  { q: "Which planet is known as the Red Planet?", options: ["Venus", "Mars", "Jupiter", "Mercury"], a: 1 },
  { q: "How many sides does a hexagon have?", options: ["5", "6", "7", "8"], a: 1 },
  { q: "What is the capital of Australia?", options: ["Sydney", "Melbourne", "Canberra", "Perth"], a: 2 },
  { q: "Which gas do plants take in from the air?", options: ["Oxygen", "Nitrogen", "Carbon dioxide", "Helium"], a: 2 },
  { q: "Who painted the Mona Lisa?", options: ["Michelangelo", "Leonardo da Vinci", "Raphael", "Donatello"], a: 1 },
  { q: "What is the largest ocean?", options: ["Atlantic", "Indian", "Arctic", "Pacific"], a: 3 },
  { q: "How many minutes are in a day?", options: ["1,440", "1,400", "1,240", "1,640"], a: 0 },
  { q: "Which metal is liquid at room temperature?", options: ["Iron", "Mercury", "Copper", "Zinc"], a: 1 },
  { q: "What is the national animal of India?", options: ["Lion", "Elephant", "Tiger", "Peacock"], a: 2 },
  { q: "Which river flows through Kolkata?", options: ["Ganga", "Hooghly", "Yamuna", "Godavari"], a: 1 },
  { q: "The Taj Mahal is in which city?", options: ["Delhi", "Jaipur", "Agra", "Lucknow"], a: 2 },
  { q: "How many players are on a cricket team?", options: ["9", "10", "11", "12"], a: 2 },
  { q: "What is H2O?", options: ["Salt", "Water", "Hydrogen", "Oxygen"], a: 1 },
  { q: "Which is the smallest prime number?", options: ["0", "1", "2", "3"], a: 2 },
  { q: "The Great Wall is in which country?", options: ["Japan", "India", "China", "Mongolia"], a: 2 },
  { q: "Which language has the most native speakers?", options: ["English", "Hindi", "Mandarin", "Spanish"], a: 2 },
  { q: "What is 15% of 200?", options: ["20", "25", "30", "35"], a: 2 },
  { q: "Which organ pumps blood?", options: ["Lungs", "Liver", "Heart", "Kidney"], a: 2 },
  { q: "Which is the longest river in the world?", options: ["Amazon", "Nile", "Yangtze", "Mississippi"], a: 1 },
  { q: "Who wrote Hamlet?", options: ["Charles Dickens", "William Shakespeare", "Jane Austen", "Mark Twain"], a: 1 },
  { q: "What does CPU stand for?", options: ["Central Process Unit", "Central Processing Unit", "Computer Personal Unit", "Core Processing Utility"], a: 1 },
  { q: "Which currency is used in Japan?", options: ["Yuan", "Won", "Yen", "Ringgit"], a: 2 },
  { q: "How many bones are in the adult human body?", options: ["196", "206", "216", "226"], a: 1 },
  { q: "The first Indian in space was…", options: ["Kalpana Chawla", "Rakesh Sharma", "Sunita Williams", "Vikram Sarabhai"], a: 1 },
  { q: "Which planet has the most moons?", options: ["Jupiter", "Saturn", "Uranus", "Neptune"], a: 1 },
  { q: "What is the boiling point of water at sea level?", options: ["90 °C", "100 °C", "110 °C", "120 °C"], a: 1 },
  { q: "Which Indian city is called the Pink City?", options: ["Jodhpur", "Udaipur", "Jaipur", "Bikaner"], a: 2 },
  { q: "Which is the largest desert in the world?", options: ["Sahara", "Gobi", "Antarctic", "Arabian"], a: 2 },
  { q: "What is the square root of 144?", options: ["10", "11", "12", "14"], a: 2 },
  { q: "Which blood group is the universal donor?", options: ["A", "B", "AB", "O negative"], a: 3 },
  { q: "The Olympics are held every…", options: ["2 years", "3 years", "4 years", "5 years"], a: 2 },
  { q: "Which is the hardest natural substance?", options: ["Gold", "Iron", "Diamond", "Quartz"], a: 2 },
  { q: "Who is known as the Father of the Nation in India?", options: ["Jawaharlal Nehru", "Mahatma Gandhi", "Sardar Patel", "B. R. Ambedkar"], a: 1 },
  { q: "What is the chemical symbol for gold?", options: ["Gd", "Go", "Au", "Ag"], a: 2 },
  { q: "How many continents are there?", options: ["5", "6", "7", "8"], a: 2 },
  { q: "Which Indian state is the largest by area?", options: ["Maharashtra", "Madhya Pradesh", "Rajasthan", "Uttar Pradesh"], a: 2 },
  { q: "Which instrument has 88 keys?", options: ["Guitar", "Piano", "Violin", "Flute"], a: 1 },
  { q: "What is 7 × 8?", options: ["54", "56", "58", "64"], a: 1 },
  { q: "Mount Everest lies on the border of Nepal and…", options: ["India", "Bhutan", "China", "Pakistan"], a: 2 },
  { q: "Which is the fastest land animal?", options: ["Lion", "Cheetah", "Horse", "Greyhound"], a: 1 },
];


export const trivia = partyDef<TriviaQ>(
  "trivia",
  "Trivia Night",
  "Ten questions, four options, everyone answers at once.",
  "❓",
  8,
  {
    rounds: 10,
    seconds: 20,
    setup: (seed, round) => {
      const start = hashOf(`${seed}#trivia`) % TRIVIA.length;
      return TRIVIA[(start + (round - 1) * 7) % TRIVIA.length];
    },
    score: (s, q) => {
      const right = s.answers.filter((a) => Number(a.text) === q.a).map((a) => a.player);
      for (const p of right) s.scores[p] += 10;
      return `Round ${s.round}: ${q.options[q.a]}${right.length ? ` — right: ${listOf(right)}` : " — nobody got it"}`;
    },
  },
);
