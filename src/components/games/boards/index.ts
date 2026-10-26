// LANX 2.11.0: the boards of the games that follow the shared shape, by id.
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
};
