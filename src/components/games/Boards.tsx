// LANX 2.9.0: the boards of the two-player games. Each one only draws the
// position from the list of moves and reports the move a player makes; the
// rules live in lib/gameRules.ts and the match in lib/games.ts.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { sfx } from "../../lib/gameSounds";
import type { Square } from "chess.js";
import {
  C4_COLS,
  C4_ROWS,
  CR_COLS,
  c4Grid,
  c4WinCells,
  chessGame,
  chessSan,
  chessTargets,
  crCritical,
  crEmpty,
  crPlace,
  crReplay,
  type CRBoard,
  reversiBoard,
  reversiCount,
  reversiLegal,
  tttBoard,
  tttLine,
} from "../../lib/gameRules";

import type { BoardProps } from "./boardProps";
export type { BoardProps } from "./boardProps";

export const SEAT_COLOURS: [string, string] = ["bg-sky-500", "bg-rose-500"];

// ---------------------------------------------------------------- tic-tac-toe

export function TicTacToeBoard({ moves, canPlay, onMove }: BoardProps) {
  const board = useMemo(() => tttBoard(moves), [moves]);
  const line = useMemo(() => tttLine(board), [board]);
  return (
    <div data-game-board="tictactoe" className="grid grid-cols-3 gap-2 p-3 rounded-2xl lanx-group" style={{ width: 312 }}>
      {board.map((cell, i) => {
        const lit = line?.includes(i);
        return (
          <button
            key={i}
            type="button"
            data-game-cell={i}
            disabled={!canPlay || cell !== null || !!line}
            onClick={() => onMove(String(i))}
            className={`h-[92px] w-[92px] rounded-xl text-5xl font-black flex items-center justify-center transition-all ${lit ? "bg-emerald-500/20 ring-2 ring-emerald-500" : "bg-white dark:bg-slate-800"} ${cell === null && canPlay && !line ? "hover:bg-indigo-500/10 cursor-pointer" : ""} disabled:cursor-default`}
          >
            {cell === 0 && <span className="text-sky-500 lanx-pop">✕</span>}
            {cell === 1 && <span className="text-rose-500 lanx-pop">○</span>}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- Connect Four

export function ConnectFourBoard({ moves, canPlay, turn, onMove }: BoardProps) {
  const grid = useMemo(() => c4Grid(moves), [moves]);
  const winCells = useMemo(() => c4WinCells(grid), [grid]);
  const [hover, setHover] = useState<number | null>(null);
  const full = (c: number) => grid[0][c] !== null;
  const over = !!winCells || moves.length === C4_ROWS * C4_COLS;
  return (
    <div data-game-board="connect4" className="rounded-2xl bg-blue-700 dark:bg-blue-900 p-3 shadow-inner" style={{ width: 7 * 52 + 24 }}>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: C4_COLS }, (_, c) => (
          <button
            key={c}
            type="button"
            data-game-col={c}
            disabled={!canPlay || full(c) || over}
            onMouseEnter={() => setHover(c)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onMove(String(c))}
            className="h-6 rounded-md flex items-center justify-center text-white/70 disabled:opacity-0 hover:bg-white/10"
            aria-label={`Drop in column ${c + 1}`}
          >
            {hover === c && canPlay && !full(c) && !over ? <span className={`g3-token h-4 w-4 rounded-full ${turn === 0 ? "bg-red-500" : "bg-yellow-400"}`} /> : "▾"}
          </button>
        ))}
        {grid.map((row, r) =>
          row.map((cell, c) => {
            const lit = winCells?.some(([rr, cc]) => rr === r && cc === c);
            return (
              <div key={`${r}-${c}`} data-game-c4={`${r}-${c}`} className={`h-12 w-12 rounded-full flex items-center justify-center ${lit ? "ring-4 ring-white" : ""} bg-blue-950/60`}>
                {cell !== null && <span className={`g3-token h-10 w-10 rounded-full shadow-inner lanx-pop ${cell === 0 ? "bg-red-500" : "bg-yellow-400"}`} />}
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Reversi

export function ReversiBoard({ moves, canPlay, turn, onMove }: BoardProps) {
  const board = useMemo(() => reversiBoard(moves) ?? reversiBoard([])!, [moves]);
  const legal = useMemo(() => reversiLegal(board, (turn % 2) as 0 | 1), [board, turn]);
  const [black, white] = reversiCount(board);
  const last = moves.length ? Number(moves[moves.length - 1]) : -1;
  return (
    <div data-game-board="reversi" className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-4 text-[12.5px] font-semibold">
        <span className="inline-flex items-center gap-1.5" data-reversi-black>
          <span className="g3-token h-4 w-4 rounded-full bg-slate-900 ring-1 ring-white/40" /> {black}
        </span>
        <span className="inline-flex items-center gap-1.5" data-reversi-white>
          <span className="g3-token h-4 w-4 rounded-full bg-white ring-1 ring-slate-400" /> {white}
        </span>
      </div>
      <div className="grid grid-cols-8 gap-[2px] rounded-xl bg-emerald-900 p-[6px]" style={{ width: 8 * 44 + 14 + 12 }}>
        {board.map((cell, i) => {
          const can = canPlay && legal.includes(i);
          return (
            <button
              key={i}
              type="button"
              data-game-cell={i}
              disabled={!can}
              onClick={() => onMove(String(i))}
              className={`h-11 w-11 rounded-[4px] flex items-center justify-center ${i === last ? "bg-emerald-500" : "bg-emerald-600"} ${can ? "hover:bg-emerald-400 cursor-pointer" : ""} disabled:cursor-default`}
            >
              {cell === 0 && <span className="g3-token h-9 w-9 rounded-full bg-slate-900 shadow lanx-pop" />}
              {cell === 1 && <span className="g3-token h-9 w-9 rounded-full bg-white shadow lanx-pop" />}
              {cell === -1 && can && <span className={`h-3 w-3 rounded-full ${turn === 0 ? "bg-slate-900/50" : "bg-white/70"}`} />}
            </button>
          );
        })}
      </div>
      {canPlay && legal.length === 0 && (
        <button type="button" data-game-pass onClick={() => onMove("p")} className="rounded-full bg-amber-500 px-4 py-1.5 text-[12.5px] font-semibold text-white hover:bg-amber-600">
          No move possible — pass
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Chain Reaction

/** Where 1–4 orbs sit inside a cell (percent of the cell's inner square; an orb is 42% wide). */
const ORB_POS: CSSProperties[][] = [
  [{ left: "29%", top: "29%" }],
  [{ left: "2%", top: "29%" }, { left: "56%", top: "29%" }],
  [{ left: "29%", top: "2%" }, { left: "2%", top: "56%" }, { left: "56%", top: "56%" }],
  [{ left: "2%", top: "2%" }, { left: "56%", top: "2%" }, { left: "2%", top: "56%" }, { left: "56%", top: "56%" }],
];
const DEFAULT_SEATS = [
  { id: "a", name: "Red", color: "#f43f5e" },
  { id: "b", name: "Blue", color: "#0ea5e9" },
];

export function ChainReactionBoard({ moves, canPlay, turn, seats = DEFAULT_SEATS, starter = 0, onMove }: BoardProps) {
  const n = Math.max(2, seats.length);
  const state = useMemo(() => crReplay(moves, n), [moves, n]);
  const final = state?.board ?? crEmpty();
  // Player number → seat (colour, name).
  const seatOf = (p: number) => seats[(starter + p) % n] ?? DEFAULT_SEATS[p % 2];
  // The last move's explosions, wave by wave, so every PC sees the chain go off.
  const waves = useMemo(() => {
    if (!moves.length || moves[moves.length - 1].startsWith("x")) return null;
    const prev = crReplay(moves.slice(0, -1), n);
    return prev ? crPlace(prev.board, Number(moves[moves.length - 1]), prev.turn) : null;
  }, [moves, n]);
  const [frame, setFrame] = useState<CRBoard | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!waves || waves.length < 2) {
      setFrame(null);
      setBusy(false);
      return;
    }
    let k = 0;
    setBusy(true);
    setFrame(waves[0]);
    const t = window.setInterval(() => {
      k += 1;
      if (k >= waves.length) {
        window.clearInterval(t);
        setFrame(null);
        setBusy(false);
        return;
      }
      setFrame(waves[k]);
      sfx("chain");
    }, 170);
    return () => window.clearInterval(t);
  }, [waves]);
  const board = frame ?? final;
  const counts = state?.counts ?? Array(n).fill(0);
  const turnColour = seatOf(turn).color;
  return (
    <div data-game-board="chainreaction" data-cr-busy={busy ? "1" : undefined} className="flex w-full flex-col items-center gap-2">
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[12.5px] font-semibold" data-cr-counts>
        {Array.from({ length: n }, (_, p) => {
          const s = seatOf(p);
          const out = state?.out[p] ?? false;
          return (
            <span key={p} className={`inline-flex items-center gap-1.5 ${out ? "line-through opacity-50" : ""} ${p === turn && !out ? "underline decoration-2 underline-offset-4" : ""}`} data-cr-count-seat={(starter + p) % n} title={s.name}>
              <span className="g3-token h-3.5 w-3.5 rounded-full" style={{ backgroundColor: s.color }} /> {counts[p]}
            </span>
          );
        })}
      </div>
      {/* Nine columns that shrink with the window: never wider than the space beside the side panel. */}
      <div className="grid w-full max-w-[470px] gap-[3px] rounded-xl bg-slate-900 p-[6px]" style={{ gridTemplateColumns: `repeat(${CR_COLS}, minmax(0, 1fr))` }}>
        {board.map((c, i) => {
          const can = canPlay && !busy && (c.owner === null || c.owner === turn);
          const near = c.n > 0 && c.n === crCritical(i) - 1;
          const shown = Math.min(c.n, 4);
          const colour = c.owner === null ? "" : seatOf(c.owner).color;
          return (
            <button
              key={i}
              type="button"
              data-cr-cell={i}
              data-cr-owner={c.owner ?? ""}
              data-cr-count={c.n}
              disabled={!can}
              onClick={() => onMove(String(i))}
              style={can ? ({ "--cr-hover": turnColour } as CSSProperties) : undefined}
              className={`aspect-square w-full min-w-0 rounded-md flex items-center justify-center bg-slate-800 ${can ? "cursor-pointer hover:ring-2 hover:ring-inset hover:ring-[var(--cr-hover)]" : ""} disabled:cursor-default`}
            >
              {c.n > 0 && (
                <span className={`relative block h-[72%] w-[72%] ${near ? "animate-pulse" : ""}`}>
                  {Array.from({ length: shown }, (_, k) => (
                    <span key={k} className="g3-token absolute h-[42%] w-[42%] rounded-full shadow-md lanx-pop" style={{ ...ORB_POS[shown - 1][k], backgroundColor: colour }} />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="max-w-[400px] text-center text-[11px] text-slate-500">A corner bursts at 2 orbs, an edge at 3, the middle at 4 — and takes the neighbours with it.</div>
    </div>
  );
}

// ---------------------------------------------------------------- Chess

const GLYPH: Record<string, string> = { wk: "♔", wq: "♕", wr: "♖", wb: "♗", wn: "♘", wp: "♙", bk: "♚", bq: "♛", br: "♜", bb: "♝", bn: "♞", bp: "♟" };
const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

export function ChessBoard({ moves, canPlay, turn, seat, onMove }: BoardProps) {
  const game = useMemo(() => chessGame(moves), [moves]);
  const [from, setFrom] = useState<Square | null>(null);
  const targets = useMemo(() => (from ? chessTargets(moves, from) : []), [moves, from]);
  const flip = seat === 1;
  const board = game?.board() ?? [];
  const history = game ? game.history({ verbose: true }) : [];
  const lastMove = history.length ? history[history.length - 1] : undefined;
  const inCheck = game?.inCheck() ?? false;
  const kingSq = useMemo(() => {
    if (!game || !inCheck) return null;
    for (const row of game.board()) for (const p of row) if (p && p.type === "k" && p.color === game.turn()) return p.square;
    return null;
  }, [game, inCheck]);

  const tap = (sq: Square, piece: { color: string } | null) => {
    if (!canPlay || !game) return;
    const mine = (turn === 0 ? "w" : "b") as "w" | "b";
    if (from && targets.includes(sq)) {
      const san = chessSan(moves, from, sq);
      setFrom(null);
      if (san) onMove(san);
      return;
    }
    if (piece && piece.color === mine) setFrom(from === sq ? null : sq);
    else setFrom(null);
  };

  // The board takes the room it has (up to 54 px a square) instead of overflowing.
  const wrap = useRef<HTMLDivElement>(null);
  const [cell, setCell] = useState(54);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => setCell(Math.max(28, Math.min(54, Math.floor(el.clientWidth / 8))));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ranks = flip ? [...board].reverse() : board;
  return (
    <div ref={wrap} className="flex w-full max-w-[432px] justify-center">
    <div data-game-board="chess" className="rounded-xl overflow-hidden ring-1 ring-black/20 shadow-lg select-none" style={{ width: cell * 8 }}>
      {ranks.map((row, ri) => {
        const rank = flip ? ri + 1 : 8 - ri;
        const cells = flip ? [...row].reverse() : row;
        return (
          <div key={rank} className="flex">
            {cells.map((piece, ci) => {
              const file = flip ? 7 - ci : ci;
              const sq = `${FILES[file]}${rank}` as Square;
              const dark = (file + rank) % 2 === 0;
              const isFrom = from === sq;
              const isTarget = targets.includes(sq);
              const wasLast = lastMove && (lastMove.from === sq || lastMove.to === sq);
              const check = kingSq === sq;
              return (
                <button
                  key={sq}
                  type="button"
                  data-chess-square={sq}
                  onClick={() => tap(sq, piece)}
                  style={{ width: cell, height: cell, fontSize: Math.round(cell * 0.7) }}
                  className={`relative flex items-center justify-center leading-none ${dark ? "bg-[#769656]" : "bg-[#eeeed2]"} ${isFrom ? "!bg-amber-300" : ""} ${wasLast && !isFrom ? "!bg-yellow-200/80" : ""} ${check ? "!bg-red-400" : ""} ${canPlay ? "cursor-pointer" : "cursor-default"}`}
                >
                  {piece && <span className={`lanx-pop ${piece.color === "w" ? "text-white drop-shadow-[0_1px_1px_rgba(0,0,0,.8)]" : "text-black"}`}>{GLYPH[`${piece.color}${piece.type}`]}</span>}
                  {isTarget && <span className={`absolute ${piece ? "inset-0 ring-4 ring-inset ring-slate-900/40 rounded-sm" : "h-4 w-4 rounded-full bg-slate-900/35"}`} />}
                  {ci === 0 && <span className="absolute left-0.5 top-0.5 text-[9px] font-bold text-black/50">{rank}</span>}
                  {ri === 7 && <span className="absolute right-0.5 bottom-0 text-[9px] font-bold text-black/50">{FILES[file]}</span>}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
    </div>
  );
}

/** The move list of a chess game, two columns like a scoresheet. */
export function ChessMoves({ moves }: { moves: string[] }) {
  const rows: [string, string | undefined][] = [];
  for (let i = 0; i < moves.length; i += 2) rows.push([moves[i], moves[i + 1]]);
  return (
    <ol data-chess-moves className="grid grid-cols-[auto_1fr_1fr] gap-x-2 text-[12px] font-mono text-slate-700 dark:text-slate-200">
      {rows.map(([w, b], i) => (
        <li key={i} className="contents">
          <span className="text-slate-400">{i + 1}.</span>
          <span>{w}</span>
          <span>{b ?? ""}</span>
        </li>
      ))}
    </ol>
  );
}
