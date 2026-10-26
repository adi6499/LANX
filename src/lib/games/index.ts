// LANX 2.11.0: every game that follows the shared shape, by id. The older
// five (tic-tac-toe, Connect Four, Reversi, chess, Chain Reaction) keep their
// own code in gameRules.ts.

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const DEFS: Record<string, GameDef<any>> = Object.fromEntries([checkers, dots, gomoku, hex, go, mancala, memory, minesVersus, battleship, mahjong].map((d) => [d.id, d]));

export const defFor = (id: string): GameDef | undefined => DEFS[id];
