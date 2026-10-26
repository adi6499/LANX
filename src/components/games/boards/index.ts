// LANX 2.11.0 / 2.12.0: the boards of the games that follow the shared shape, by id.
import type { ComponentType } from "react";
import type { BoardProps } from "../boardProps";
import { BattleshipBoard } from "./BattleshipBoard";
import { CheckersBoard } from "./CheckersBoard";
import { DotsBoard } from "./DotsBoard";
import { GoBoard } from "./GoBoard";
import { GomokuBoard } from "./GomokuBoard";
import { HexBoard } from "./HexBoard";
import { MahjongBoard } from "./MahjongBoard";
import { MancalaBoard } from "./MancalaBoard";
import { MemoryBoard } from "./MemoryBoard";
import { MinesVersusBoard } from "./MinesVersusBoard";
import { SnakesBoard } from "./SnakesBoard";
import { LudoBoard } from "./LudoBoard";
import { BackgammonBoard } from "./BackgammonBoard";
import { DominoesBoard } from "./DominoesBoard";
import { BankrollBoard } from "./BankrollBoard";
import { Crazy8Board } from "./Crazy8Board";
import { OchoBoard } from "./OchoBoard";
import { GoFishBoard } from "./GoFishBoard";
import { BlackjackBoard } from "./BlackjackBoard";
import { EuchreBoard, HeartsBoard, SpadesBoard } from "./TrickBoard";
import { GinBoard } from "./GinBoard";
import { HoldemBoard } from "./HoldemBoard";
import { MathRushBoard, TapRouletteBoard, TriviaBoard, WordboxBoard } from "./PartyBoards";
import { PaintFightBoard } from "./PaintFightBoard";
import { DrawGuessBoard } from "./DrawGuessBoard";
import { WerewolfBoard } from "./WerewolfBoard";
import { ArcheryBoard, BowlingBoard, CupPongBoard, DartsBoard } from "./ShotBoards";
import { CarromBoard, GolfBoard, PoolBoard } from "./TableBoards";
import { AirHockeyBoard, FoosballBoard, SpinnerBoard } from "./RealtimeBoards";

export const BOARDS: Record<string, ComponentType<BoardProps>> = {
  checkers: CheckersBoard,
  dots: DotsBoard,
  gomoku: GomokuBoard,
  hex: HexBoard,
  go: GoBoard,
  mancala: MancalaBoard,
  memory: MemoryBoard,
  minesvs: MinesVersusBoard,
  battleship: BattleshipBoard,
  mahjong: MahjongBoard,
  snakes: SnakesBoard,
  ludo: LudoBoard,
  backgammon: BackgammonBoard,
  dominoes: DominoesBoard,
  bankroll: BankrollBoard,
  crazy8: Crazy8Board,
  ocho: OchoBoard,
  gofish: GoFishBoard,
  blackjack: BlackjackBoard,
  hearts: HeartsBoard,
  spades: SpadesBoard,
  euchre: EuchreBoard,
  ginrummy: GinBoard,
  holdem: HoldemBoard,
  taproulette: TapRouletteBoard,
  mathrush: MathRushBoard,
  trivia: TriviaBoard,
  wordbox: WordboxBoard,
  paintfight: PaintFightBoard,
  drawguess: DrawGuessBoard,
  werewolf: WerewolfBoard,
  darts: DartsBoard,
  archery: ArcheryBoard,
  cuppong: CupPongBoard,
  bowling: BowlingBoard,
  minigolf: GolfBoard,
  pool: PoolBoard,
  carrom: CarromBoard,
  airhockey: AirHockeyBoard,
  foosball: FoosballBoard,
  spinnerwars: SpinnerBoard,
};
