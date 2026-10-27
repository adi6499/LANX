// LANX 2.16.0: the 3D boards, by game id. Each one is loaded only when its
// game opens (three.js and Rapier never slow down LANX's start), takes the
// same props as the flat board and sends the same moves, so a 3D player and a
// flat player — or an older LANX — can play the same match.

import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { BoardProps } from "../boardProps";
import type { SoloProps } from "../Solo";

type Lazy = LazyExoticComponent<ComponentType<BoardProps>>;

export const BOARDS3D: Record<string, Lazy> = {
  ludo: lazy(() => import("./boards/Ludo3D")),
  snakes: lazy(() => import("./boards/Snakes3D")),
  pool: lazy(() => import("./boards/Pool3D")),
  go: lazy(() => import("./boards/Grid3D").then((m) => ({ default: m.Go3D }))),
  gomoku: lazy(() => import("./boards/Grid3D").then((m) => ({ default: m.Gomoku3D }))),
  tictactoe: lazy(() => import("./boards/Grid3D").then((m) => ({ default: m.TicTacToe3D }))),
  hex: lazy(() => import("./boards/Grid3D").then((m) => ({ default: m.Hex3D }))),
  reversi: lazy(() => import("./boards/Grid3D").then((m) => ({ default: m.Reversi3D }))),
  chess: lazy(() => import("./boards/Classic3D").then((m) => ({ default: m.Chess3D }))),
  checkers: lazy(() => import("./boards/Classic3D").then((m) => ({ default: m.Checkers3D }))),
  connect4: lazy(() => import("./boards/Classic3D").then((m) => ({ default: m.ConnectFour3D }))),
  chainreaction: lazy(() => import("./boards/Tiles3D").then((m) => ({ default: m.ChainReaction3D }))),
  dots: lazy(() => import("./boards/Tiles3D").then((m) => ({ default: m.Dots3D }))),
  memory: lazy(() => import("./boards/Tiles3D").then((m) => ({ default: m.Memory3D }))),
  minesvs: lazy(() => import("./boards/Tiles3D").then((m) => ({ default: m.MinesVersus3D }))),
  mahjong: lazy(() => import("./boards/Tiles3D").then((m) => ({ default: m.Mahjong3D }))),
  paintfight: lazy(() => import("./boards/Tiles3D").then((m) => ({ default: m.PaintFight3D }))),
  mancala: lazy(() => import("./boards/Mancala3D").then((m) => ({ default: m.Mancala3D }))),
  battleship: lazy(() => import("./boards/Sea3D")),
  backgammon: lazy(() => import("./boards/DiceBoards3D").then((m) => ({ default: m.Backgammon3D }))),
  bankroll: lazy(() => import("./boards/DiceBoards3D").then((m) => ({ default: m.Bankroll3D }))),
  crazy8: lazy(() => import("./boards/Cards3D").then((m) => ({ default: m.Crazy83D }))),
  ocho: lazy(() => import("./boards/Cards3D").then((m) => ({ default: m.Ocho3D }))),
  gofish: lazy(() => import("./boards/Cards3D").then((m) => ({ default: m.GoFish3D }))),
  blackjack: lazy(() => import("./boards/Cards3D").then((m) => ({ default: m.Blackjack3D }))),
  hearts: lazy(() => import("./boards/Cards3D").then((m) => ({ default: m.Hearts3D }))),
  spades: lazy(() => import("./boards/Cards3D").then((m) => ({ default: m.Spades3D }))),
  euchre: lazy(() => import("./boards/Cards3D").then((m) => ({ default: m.Euchre3D }))),
  ginrummy: lazy(() => import("./boards/Cards3D").then((m) => ({ default: m.Gin3D }))),
  holdem: lazy(() => import("./boards/Cards3D").then((m) => ({ default: m.Holdem3D }))),
  dominoes: lazy(() => import("./boards/Dominoes3D")),
  carrom: lazy(() => import("./boards/TableShots3D").then((m) => ({ default: m.Carrom3D }))),
  minigolf: lazy(() => import("./boards/TableShots3D").then((m) => ({ default: m.Golf3D }))),
  darts: lazy(() => import("./boards/Throw3D").then((m) => ({ default: m.Darts3D }))),
  archery: lazy(() => import("./boards/Throw3D").then((m) => ({ default: m.Archery3D }))),
  cuppong: lazy(() => import("./boards/Throw3D").then((m) => ({ default: m.CupPong3D }))),
  bowling: lazy(() => import("./boards/Bowling3D")),
  airhockey: lazy(() => import("./boards/Live3D").then((m) => ({ default: m.AirHockey3D }))),
  foosball: lazy(() => import("./boards/Live3D").then((m) => ({ default: m.Foosball3D }))),
  spinnerwars: lazy(() => import("./boards/Live3D").then((m) => ({ default: m.Spinner3D }))),
  taproulette: lazy(() => import("./boards/PartyScenes3D").then((m) => ({ default: m.TapRoulette3D }))),
  wordbox: lazy(() => import("./boards/PartyScenes3D").then((m) => ({ default: m.Wordbox3D }))),
  trivia: lazy(() => import("./boards/Party3D").then((m) => ({ default: m.Trivia3D }))),
  mathrush: lazy(() => import("./boards/Party3D").then((m) => ({ default: m.MathRush3D }))),
  werewolf: lazy(() => import("./boards/Party3D").then((m) => ({ default: m.Werewolf3D }))),
  drawguess: lazy(() => import("./boards/Party3D").then((m) => ({ default: m.DrawGuess3D }))),
};

/** The games you play alone, in 3D (same rules as games/Solo.tsx). */
export const SOLO3D: Record<string, LazyExoticComponent<ComponentType<SoloProps>>> = {
  "2048": lazy(() => import("./boards/Solo3D").then((m) => ({ default: m.Game2048_3D }))),
  snake: lazy(() => import("./boards/Solo3D").then((m) => ({ default: m.Snake3D }))),
  mines: lazy(() => import("./boards/Solo3D").then((m) => ({ default: m.Minesweeper3D }))),
};

export const has3d = (id: string) => id in BOARDS3D || id in SOLO3D;
