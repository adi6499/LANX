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

import { ON, draw, leaver, rng, shuffled, win, type GameDef, type Outcome } from "./core.ts";
import { TRIVIA, type TriviaQ } from "./triviaQuestions.ts";

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
      } else if (!s.open && r.over?.(s, n)) {
        // LANX 3.16.0: nothing is left to play (Draw & Guess: everyone who still had a
        // drawing turn has left between rounds). The game used to wait for a round that
        // could never open.
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
    // LANX 3.17.0: "<player>@a#<round>:<answer>" — an answer says which round it is for, and is
    // refused in any other. (Without the round, one that arrived after the next round had opened
    // was taken for that round.) The form without a round is still read: games played before.
    const ans = /^(\d+)@a(?:#(\d+))?:(.*)$/s.exec(m);
    if (!ans) return null;
    const p = Number(ans[1]);
    if (!s.open || p < 0 || p >= n || s.out[p]) return null;
    if (ans[2] !== undefined && Number(ans[2]) !== s.round) return null;
    if (!r.multi && s.answers.some((a) => a.player === p)) return null; // one answer each
    if (r.accept && !r.accept(s, p, ans[3], s.extra as Extra)) return null;
    s.answers.push({ player: p, text: ans[3].slice(0, 200) });
  }
  return s;
}

export function partyOutcome(s: RoundState, _n: number, what = "points"): Outcome {
  if (!s.done) return ON;
  const ps = present(s);
  if (ps.length === 1 && s.out.some(Boolean)) return win(ps[0], `the others left · ${s.scores[ps[0]]} ${what}`, s.scores);
  const best = Math.max(...ps.map((p) => s.scores[p]));
  const tops = ps.filter((p) => s.scores[p] === best);
  return tops.length > 1 ? draw(`${best} ${what} each`, s.scores, tops) : win(tops[0], `${best} ${what}`, s.scores);
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

/** LANX 3.16.0: a well-mixed whole number from a text, the same on every PC: the seeded
 *  generator, run in a little first. (The plain hash of "…#tap1", "…#tap2" moves by a fixed
 *  step from round to round, so Tap Roulette's wheel was not random: with two players the
 *  loser simply alternated, with seven or eight every game was a draw.) */
export const drawOf = (text: string): number => {
  const next = rng(text);
  for (let i = 0; i < 12; i++) next();
  return Math.floor(next() * 4294967296);
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
    setup: (seed, round) => ({ draw: drawOf(`${seed}#tap${round}`) }),
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
      const right = s.answers.filter((a) => a.text.trim() !== "" && Number(a.text) === extra.answer).map((a) => a.player);
      for (const p of right) s.scores[p] += 1;
      return `Round ${s.round}: ${extra.question} = ${extra.answer}${right.length ? ` — right: ${listOf(right)}` : " — nobody got it"}`;
    },
  },
);

// ---------------------------------------------------------------- Trivia Night

// (The questions live in triviaQuestions.ts.)
export { TRIVIA, type TriviaQ };

export const trivia = partyDef<TriviaQ>(
  "trivia",
  "Trivia Night",
  "Ten questions, four options, everyone answers at once.",
  "❓",
  8,
  {
    rounds: 10,
    seconds: 20,
    // LANX 3.18.0: the whole set is shuffled for each match and the ten rounds take the first ten,
    // so no question comes twice in a match and the sets differ from match to match (there were
    // only forty sets: a start and a fixed step of seven). The four options are shuffled for each
    // round as well (37 of the 40 right answers used to sit second or third).
    setup: (seed, round) => {
      const order = shuffled(TRIVIA.map((_, i) => i), `${seed}#trivia`);
      const q = TRIVIA[order[(round - 1) % order.length]];
      const places = shuffled(q.options.map((_, i) => i), `${seed}#trivia${round}`);
      return { q: q.q, options: places.map((i) => q.options[i]), a: places.indexOf(q.a) };
    },
    score: (s, q) => {
      const right = s.answers.filter((a) => a.text.trim() !== "" && Number(a.text) === q.a).map((a) => a.player);
      for (const p of right) s.scores[p] += 10;
      return `Round ${s.round}: ${q.options[q.a]}${right.length ? ` — right: ${listOf(right)}` : " — nobody got it"}`;
    },
  },
);
