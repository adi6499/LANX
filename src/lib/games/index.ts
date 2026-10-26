// LANX 2.11.0 / 2.12.0: every game that follows the shared shape, by id. The
// older five (tic-tac-toe, Connect Four, Reversi, chess, Chain Reaction) keep
// their own code in gameRules.ts.

import type { GameDef } from "./core.ts";
import { battleship } from "./battleship.ts";
import { checkers } from "./checkers.ts";
import { dots } from "./dots.ts";
import { go } from "./go.ts";
import { gomoku } from "./gomoku.ts";
import { hex } from "./hex.ts";
import { mahjong } from "./mahjong.ts";
import { mancala } from "./mancala.ts";
import { memory } from "./memory.ts";
import { minesVersus } from "./minesVersus.ts";
import { snakes } from "./snakes.ts";
import { ludo } from "./ludo.ts";
import { backgammon } from "./backgammon.ts";
import { dominoes } from "./dominoes.ts";
import { bankroll } from "./bankroll.ts";
import { crazy8 } from "./crazy8.ts";
import { ocho } from "./ocho.ts";
import { gofish } from "./gofish.ts";
import { blackjack } from "./blackjack.ts";
import { hearts, spades, euchre } from "./tricks.ts";
import { ginrummy } from "./ginrummy.ts";
import { holdem } from "./holdem.ts";
import { tapRoulette, mathRush, trivia } from "./party.ts";
import { wordbox } from "./wordbox.ts";
import { paintFight } from "./paintfight.ts";
import { drawGuess } from "./drawguess.ts";
import { werewolf } from "./werewolf.ts";
import { darts } from "./darts.ts";
import { archery } from "./archery.ts";
import { cupPong } from "./cuppong.ts";
import { bowling } from "./bowling.ts";
import { minigolf } from "./minigolf.ts";
import { pool } from "./pool.ts";
import { carrom } from "./carrom.ts";
import { airhockey, foosball, spinnerWars } from "./realtime.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ALL: GameDef<any>[] = [
  checkers, dots, gomoku, hex, go, mancala, memory, minesVersus, battleship, mahjong,
  snakes, ludo, backgammon, dominoes, bankroll,
  crazy8, ocho, gofish, blackjack, hearts, spades, euchre, ginrummy, holdem,
  tapRoulette, mathRush, trivia, wordbox, paintFight, drawGuess, werewolf,
  darts, archery, cupPong, bowling, minigolf, pool, carrom,
  airhockey, foosball, spinnerWars,
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const DEFS: Record<string, GameDef<any>> = Object.fromEntries(ALL.map((d) => [d.id, d]));

export const defFor = (id: string): GameDef | undefined => DEFS[id];
