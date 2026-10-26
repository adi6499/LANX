// Party games played in timed rounds, run by the host (the one who opened
// the table). The host opens a round ("o:<round>:<deadline>"), everyone
// answers at once ("<player>@a:<answer>"), and the host closes it
// ("e:<round>") when the clock runs out or everyone has answered. Only the
// host's PC adds the opening and closing steps; the others' steps are marked
// with their own player number. Answers are scored when the round closes,
// in the order they arrived (first in = fastest).

import { ON, draw, win, type GameDef, type Outcome } from "./core.ts";

export interface RoundState {
  /** Rounds played so far (the current one included once open). */
  round: number;
  open: boolean;
  /** When the host will close the round (ms since epoch, the host's clock). */
  deadline: number;
  /** Answers this round, by player, in arrival order. */
  answers: { player: number; text: string }[];
  scores: number[];
  /** Words about the last round, for everyone. */
  log: string[];
  done: boolean;
}

export interface PartyRules<Extra> {
  rounds: number;
  /** Something for this round from the seed (a question, a sum, a word). */
  setup(seed: string, round: number, n: number): Extra;
  /** Scores the round's answers; returns a line for the log. */
  score(s: RoundState, extra: Extra, n: number): string;
  /** Whether a player's answer may be taken (e.g. one answer only). */
  accept?(s: RoundState, player: number, text: string, extra: Extra): boolean;
  /** Players may send several answers in a round (words, taps). */
  multi?: boolean;
  /** Seconds a round lasts (the host's clock), for the boards. */
  seconds?: number;
  /** The lowest number of players that makes sense. */
  minPlayers?: number;
}

export type PartyState<Extra> = RoundState & { extra: Extra | null };

export function partyReplay<Extra>(moves: string[], n: number, seed: string, r: PartyRules<Extra>): PartyState<Extra> | null {
  const s: PartyState<Extra> = { round: 0, open: false, deadline: 0, answers: [], scores: Array(n).fill(0), log: [], done: false, extra: null };
  for (const m of moves) {
    if (s.done) return null;
    const open = /^o:(\d+):(\d+)$/.exec(m);
    if (open) {
      if (s.open || Number(open[1]) !== s.round + 1) return null;
      s.round++;
      s.open = true;
      s.deadline = Number(open[2]);
      s.answers = [];
      s.extra = r.setup(seed, s.round, n);
      continue;
    }
    const close = /^e:(\d+)$/.exec(m);
    if (close) {
      if (!s.open || Number(close[1]) !== s.round) return null;
      s.open = false;
      s.log.push(r.score(s, s.extra as Extra, n));
      if (s.round >= r.rounds) s.done = true;
      continue;
    }
    const ans = /^(\d+)@a:(.*)$/s.exec(m);
    if (!ans) return null;
    const p = Number(ans[1]);
    if (!s.open || p < 0 || p >= n) return null;
    if (!r.multi && s.answers.some((a) => a.player === p)) return null; // one answer each
    if (r.accept && !r.accept(s, p, ans[2], s.extra as Extra)) return null;
    s.answers.push({ player: p, text: ans[2].slice(0, 200) });
  }
  return s;
}

export function partyOutcome(s: RoundState, _n: number, what = "points"): Outcome {
  if (!s.done) return ON;
  const best = Math.max(...s.scores);
  const tops = s.scores.map((x, i) => (x === best ? i : -1)).filter((i) => i >= 0);
  return tops.length > 1 ? draw(`${best} ${what} each`, s.scores) : win(tops[0], `${best} ${what}`, s.scores);
}

/** Everyone acts at once while a round is open; between rounds the host acts. */
export const partyTurn = () => -1;

export function partyDef<Extra>(id: string, name: string, blurb: string, emoji: string, maxPlayers: number, r: PartyRules<Extra>, what = "points"): GameDef<PartyState<Extra>> {
  return {
    id,
    name,
    blurb,
    emoji,
    minPlayers: r.minPlayers ?? 2,
    maxPlayers,
    hosted: true,
    replay: (moves, n, seed) => partyReplay(moves, n, seed, r),
    turn: partyTurn,
    outcome: (s, n) => partyOutcome(s, n, what),
    summary: (s) => `round ${s.round}/${r.rounds} · ` + s.scores.map((x, i) => `P${i + 1} ${x}`).join(" · "),
  };
}

// ---------------------------------------------------------------- Tap Roulette

export interface TapExtra {
  loser: number;
}

export const tapRoulette = partyDef<TapExtra>(
  "taproulette",
  "Tap Roulette",
  "Everyone taps in; the app picks one loser at random.",
  "🎯",
  8,
  {
    rounds: 5,
    setup: (seed, round, n) => {
      // The loser is drawn from the seed when the round closes; pick now, show then.
      let h = 2166136261;
      for (const ch of `${seed}#tap${round}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
      return { loser: (h >>> 0) % n };
    },
    score: (s, extra, n) => {
      const tapped = s.answers.map((a) => a.player);
      // Only those who tapped in can lose; if the drawn one did not tap, the first who did not tap loses instead.
      let loser = extra.loser;
      if (!tapped.includes(loser)) {
        const missing = Array.from({ length: n }, (_, p) => p).filter((p) => !tapped.includes(p));
        loser = missing[0] ?? loser;
      }
      for (let p = 0; p < n; p++) if (p !== loser) s.scores[p] += 1;
      return `Round ${s.round}: Player ${loser + 1} loses!`;
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
  "Quick sums, head to head: first right answer scores most.",
  "➗",
  8,
  {
    rounds: 10,
    setup: (seed, round) => {
      let h = 2166136261;
      for (const ch of `${seed}#math${round}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
      const x = h >>> 0;
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
      let first = true;
      const right: number[] = [];
      for (const a of s.answers) {
        if (Number(a.text) === extra.answer) {
          s.scores[a.player] += first ? 3 : 1;
          right.push(a.player);
          first = false;
        }
      }
      return `Round ${s.round}: ${extra.question} = ${extra.answer}${right.length ? ` — first: Player ${right[0] + 1}` : " — nobody got it"}`;
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
    setup: (seed, round) => {
      let h = 2166136261;
      for (const ch of `${seed}#trivia`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
      const start = (h >>> 0) % TRIVIA.length;
      return TRIVIA[(start + (round - 1) * 7) % TRIVIA.length];
    },
    score: (s, q) => {
      let first = true;
      const right: number[] = [];
      for (const a of s.answers) {
        if (Number(a.text) === q.a) {
          s.scores[a.player] += first ? 15 : 10;
          right.push(a.player);
          first = false;
        }
      }
      return `Round ${s.round}: ${q.options[q.a]}${right.length ? ` — ${right.length} right, first Player ${right[0] + 1}` : " — nobody got it"}`;
    },
  },
);
