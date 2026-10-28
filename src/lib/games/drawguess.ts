// Draw & Guess — 3–8 players. Each round one player draws a secret word on
// the shared board (the strokes go round the table through the host) while
// the others type guesses. The first right guess scores 10, the drawer 5,
// and the round ends; otherwise the clock runs out after 75 seconds.
// LANX 2.17.0: everyone draws as often as everyone else — twice each at a
// table of up to four, once each at five or more — and the drawing turns of
// a player who left are skipped.
// Moves: "<player>@a:<guess>"; the host opens and closes rounds.

import { partyDef, type PartyState } from "./party.ts";
import { rng } from "./core.ts";

export const DRAW_WORDS = [
  "apple", "bicycle", "umbrella", "elephant", "guitar", "rocket", "pizza", "camera", "mountain", "butterfly", "laptop", "candle", "tractor", "giraffe", "sandwich", "lighthouse", "snowman", "helicopter", "cactus", "penguin",
  "toothbrush", "volcano", "kite", "octopus", "train", "balloon", "ladder", "island", "crown", "telescope", "scooter", "ice cream", "football", "rainbow", "whale", "robot", "castle", "spider", "banana", "hammer",
  "bridge", "tent", "teapot", "dragon", "windmill", "submarine", "pineapple", "parrot", "glasses", "drum", "anchor", "cloud", "wallet", "tiger", "fountain", "necklace", "kangaroo", "pencil", "bucket", "sunflower",
];

export interface DrawExtra {
  drawer: number;
  word: string;
  /** LANX 2.17.0: this round's place in the drawing order (the drawer is slot % players). */
  slot: number;
  /** Round closed by a right guess: who. */
  guessedBy?: number;
}

export const drawWord = (seed: string, round: number) => DRAW_WORDS[Math.floor(rng(`${seed}#draw${round}`)() * DRAW_WORDS.length)];
/** LANX 2.17.0: how a guess is compared with the word — on every board as in the rules: only the letters count. */
export const drawNorm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
export const isRightGuess = (guess: string, word: string) => drawNorm(guess) !== "" && drawNorm(guess) === drawNorm(word);

/** Drawing turns each: twice at a table of up to four, once at five or more. */
export const drawTurnsEach = (n: number) => (n <= 4 ? 2 : 1);
/** Rounds in a game when nobody leaves: everyone draws the same number of times. */
export const drawRoundsFor = (n: number) => n * drawTurnsEach(n);

/** The next drawing turn after `after` whose drawer is still at the table, or null when none is left. */
function nextSlot(after: number, n: number, out: boolean[]): number | null {
  for (let k = after + 1; k < drawRoundsFor(n); k++) if (!out[k % n]) return k;
  return null;
}
const slotOf = (s: PartyState<DrawExtra>) => s.extra?.slot ?? -1;

export const drawGuess = partyDef<DrawExtra>(
  "drawguess",
  "Draw & Guess",
  "One draws, the rest guess — first right answer wins the round.",
  "✏️",
  8,
  {
    rounds: drawRoundsFor,
    multi: true,
    seconds: 75,
    minPlayers: 3,
    setup: (seed, round, n, s) => {
      const slot = nextSlot(slotOf(s), n, s.out);
      return slot === null ? null : { drawer: slot % n, word: drawWord(seed, round), slot };
    },
    accept: (_s, player, text, extra) => player !== extra.drawer && text.trim().length > 0 && text.length <= 40,
    score: (s, extra, _n) => {
      const right = s.answers.find((a) => isRightGuess(a.text, extra.word));
      if (right) {
        s.scores[right.player] += 10;
        s.scores[extra.drawer] += 5;
        extra.guessedBy = right.player;
        return `Round ${s.round}: "${extra.word}" — P${right.player + 1} got it (+10), the drawer P${extra.drawer + 1} +5`;
      }
      return `Round ${s.round}: it was "${extra.word}" — nobody guessed`;
    },
    over: (s, n) => nextSlot(slotOf(s), n, s.out) === null,
    total: (s, n) => {
      let left = 0;
      for (let k = nextSlot(slotOf(s), n, s.out); k !== null; k = nextSlot(k, n, s.out)) left++;
      return s.round + (s.done ? 0 : left);
    },
  },
);

export type DrawState = PartyState<DrawExtra>;
