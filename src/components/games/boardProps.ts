// LANX 2.9.0 / 2.11.0: what every board is given. A board only draws the
// position from the list of moves and reports the move a player makes; the
// rules live in lib/gameRules.ts and lib/games/*, the match in lib/games.ts.

import { createContext } from "react";

export interface Seat {
  id: string;
  name: string;
  color: string;
}

export interface BoardProps {
  moves: string[];
  /** Whether this PC may move now. */
  canPlay: boolean;
  /** Whose turn it is: the player number (0 = moved first this round), or -1 when everyone acts at once. */
  turn: number;
  /** My player number (0 or 1 in the two-player games); turns the chess board round. */
  seat: number;
  /** Everyone at the board, and which seat moved first this round — for colours and names. */
  seats?: Seat[];
  starter?: number;
  /** The seed for this round's dice and shuffles (2.11.0). */
  seed?: string;
  /** Something this PC keeps to itself (a hidden fleet), and how to save it (2.11.0). */
  secret?: unknown;
  onSecret?: (value: unknown) => void;
  /** Pass & play at this PC (no secrets, everyone sees everything). */
  local?: boolean;
  onMove: (move: string) => void;
  /** Light, unrecorded steps relayed by the host (brush strokes, taps) — 2.13.0. */
  deltas?: unknown[];
  onDelta?: (data: unknown) => void;
  /** Whether this PC hosts the table. */
  host?: boolean;
}

/** LANX 2.17.0: true inside HostRunner — the host isn't looking at this board, so it keeps the game
 *  moving by itself (a party board opens the next round after a short pause). */
export const HostAway = createContext(false);

/** LANX 2.17.0: the rules say "P2" (player numbers count from 1 in turn order); boards say who that is. */
export function namesIn(text: string, seats: Seat[] | undefined, starter: number, n: number): string {
  if (!text || !seats?.length) return text;
  return text.replace(/\bP(\d+)\b/g, (all, k: string) => {
    const p = Number(k) - 1;
    return p >= 0 && p < n ? seatFor(seats, starter, p, n).name.split(" (")[0] : all;
  });
}

/** Player number → seat (colour, name), given who started this round. */
export function seatFor(seats: Seat[] | undefined, starter: number, player: number, n: number): Seat {
  const fallback = [
    { id: "a", name: "Player 1", color: "#f43f5e" },
    { id: "b", name: "Player 2", color: "#0ea5e9" },
    { id: "c", name: "Player 3", color: "#10b981" },
    { id: "d", name: "Player 4", color: "#f59e0b" },
  ];
  if (!seats || !seats.length) return fallback[player % fallback.length];
  return seats[(starter + player) % n] ?? fallback[player % fallback.length];
}
