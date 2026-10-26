// Draw & Guess — 3–8 players. Each round one player draws a secret word on
// the shared board (the strokes go round the table through the host) while
// the others type guesses. The first right guess scores 10, the drawer 5,
// and the round ends; otherwise the clock runs out after 75 seconds. As
// many rounds as players, so everyone draws once.
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
  /** Round closed by a right guess: who. */
  guessedBy?: number;
}

export const drawWord = (seed: string, round: number) => DRAW_WORDS[Math.floor(rng(`${seed}#draw${round}`)() * DRAW_WORDS.length)];
const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z ]/g, "");

export const drawGuess = partyDef<DrawExtra>(
  "drawguess",
  "Draw & Guess",
  "One draws, the rest guess — first right answer wins the round.",
  "✏️",
  8,
  {
    rounds: 8,
    multi: true,
    seconds: 75,
    minPlayers: 3,
    setup: (seed, round, n) => ({ drawer: (round - 1) % n, word: drawWord(seed, round) }),
    accept: (_s, player, text, extra) => player !== extra.drawer && text.trim().length > 0 && text.length <= 40,
    score: (s, extra, _n) => {
      const right = s.answers.find((a) => norm(a.text) === norm(extra.word));
      if (right) {
        s.scores[right.player] += 10;
        s.scores[extra.drawer] += 5;
        extra.guessedBy = right.player;
        return `Round ${s.round}: "${extra.word}" — Player ${right.player + 1} got it (+10), the drawer +5`;
      }
      return `Round ${s.round}: it was "${extra.word}" — nobody guessed`;
    },
  },
);

/** Rounds stop when everyone has drawn once (up to the table size). */
export const drawRoundsFor = (n: number) => Math.min(8, Math.max(3, n));

export type DrawState = PartyState<DrawExtra>;
