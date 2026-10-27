// Development only (lab.html, never in the app): every game at one PC with
// the real rules, flat or 3D, light or dark — for building and checking the
// 3D boards without starting LANX itself.
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import "../App.css";
import { StrictMode, Suspense, useCallback, useMemo, useState, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { GAMES } from "../lib/games";
import { outcome, summaryOf, turnOf, validateMoves } from "../lib/gameRules";
import { BOARDS } from "../components/games/boards/index";
import { ChainReactionBoard, ChessBoard, ConnectFourBoard, ReversiBoard, TicTacToeBoard } from "../components/games/Boards";
import type { BoardProps } from "../components/games/boardProps";
import { BOARDS3D, SOLO3D } from "../components/games/three/index";
import { Fallback } from "../components/games/three/Board3D";
import { Game2048, Minesweeper, SnakeGame } from "../components/games/Solo";

const CLASSIC: Record<string, ComponentType<BoardProps>> = { tictactoe: TicTacToeBoard, connect4: ConnectFourBoard, reversi: ReversiBoard, chess: ChessBoard, chainreaction: ChainReactionBoard };
const COLOURS = ["#f43f5e", "#0ea5e9", "#10b981", "#f59e0b", "#8b5cf6", "#f97316", "#14b8a6", "#ec4899"];

function Lab() {
  const q = new URLSearchParams(location.search);
  const [game, setGame] = useState(q.get("g") ?? "ludo");
  const [n, setN] = useState(Number(q.get("n") ?? 2));
  const [three, setThree] = useState(q.get("flat") !== "1");
  const [moves, setMoves] = useState<string[]>([]);
  const [deltas, setDeltas] = useState<unknown[]>([]);
  const [round, setRound] = useState(1);
  const [problem, setProblem] = useState("");
  const [secrets, setSecrets] = useState<Record<number, unknown>>({});
  const seatQ = q.get("seat");
  const meta = GAMES.find((g) => g.id === game)!;
  const seats = useMemo(() => Array.from({ length: n }, (_, i) => ({ id: `local:${i}`, name: `Player ${i + 1}`, color: COLOURS[i] })), [n]);
  const seed = `lab-${game}#${round}`;
  const over = outcome(game, moves, n, seed);
  const turn = turnOf(game, moves, n, seed);
  const onMove = useCallback(
    (mv: string) => {
      setMoves((cur) => {
        const next = [...cur, mv];
        if (!validateMoves(game, next, n, seed)) {
          setProblem(`Not allowed: ${mv}`);
          return cur;
        }
        setProblem("");
        (window as unknown as { __labMoves?: string[] }).__labMoves = next;
        return next;
      });
    },
    [game, n, seed],
  );
  (window as unknown as { __labMoves?: string[] }).__labMoves = moves;
  (window as unknown as { __labMove?: (m: string) => void }).__labMove = onMove;
  const seat = seatQ !== null ? Number(seatQ) : Math.max(0, turn);
  const props: BoardProps = { moves, canPlay: !over.over, turn, seat, seats, starter: 0, seed, local: seatQ === null, host: true, onMove, deltas, onDelta: (d) => setDeltas((x) => [...x, d]), secret: secrets[seat], onSecret: (v) => setSecrets((x) => ({ ...x, [seat]: v })) };
  const Flat: ComponentType<BoardProps> | undefined = CLASSIC[game] ?? BOARDS[game];
  const Deep = BOARDS3D[game] as (typeof BOARDS3D)[string] | undefined;
  const SoloDeep = SOLO3D[game] as (typeof SOLO3D)[string] | undefined;
  const soloScore = (v: number) => ((window as unknown as { __labScore?: number }).__labScore = v);
  const reset = (g = game, k = n) => {
    setGame(g);
    setN(Math.max(GAMES.find((x) => x.id === g)!.minPlayers, Math.min(k, GAMES.find((x) => x.id === g)!.maxPlayers)));
    setMoves([]);
    setDeltas([]);
    setRound((r) => r + 1);
  };
  return (
    <div className="flex h-screen">
      <aside className="w-56 shrink-0 overflow-y-auto border-r border-slate-200 p-2 text-[12.5px] dark:border-slate-800">
        {GAMES.map((g) => (
          <button key={g.id} type="button" data-lab-pick={g.id} onClick={() => reset(g.id)} className={`block w-full rounded-lg px-2 py-1 text-left ${g.id === game ? "bg-indigo-600 text-white" : "hover:bg-slate-500/10"}`}>
            {g.emoji} {g.name} {g.id in BOARDS3D || g.id in SOLO3D ? "· 3D" : ""}
          </button>
        ))}
      </aside>
      <main className="flex min-w-0 flex-1 flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <b>{meta.name}</b>
          <label>
            players <input type="number" min={meta.minPlayers} max={meta.maxPlayers} value={n} onChange={(e) => reset(game, Number(e.target.value))} className="w-14 rounded border px-1 dark:bg-slate-800" />
          </label>
          <button type="button" data-lab-3d onClick={() => setThree((v) => !v)} className="rounded-full bg-slate-500/10 px-3 py-1">
            {three ? "3D" : "Flat"}
          </button>
          <button type="button" onClick={() => document.documentElement.classList.toggle("dark")} className="rounded-full bg-slate-500/10 px-3 py-1">
            Light/Dark
          </button>
          <button type="button" data-lab-reset onClick={() => reset()} className="rounded-full bg-slate-500/10 px-3 py-1">
            New game
          </button>
          <span data-lab-turn>turn {turn}</span>
          <span data-lab-over>{over.over ? `over: ${over.reason} (winner ${over.winner})` : ""}</span>
          <span className="text-slate-500">{summaryOf(game, moves, n, seed)}</span>
          <span className="text-rose-600" data-lab-problem>{problem}</span>
          <span className="text-slate-400" data-lab-moves>{moves.length} moves: {moves.slice(-6).join(" ")}</span>
        </div>
        <div className="flex min-h-0 flex-1 overflow-auto rounded-2xl bg-white/70 p-4 dark:bg-slate-900/60 [&>*]:m-auto" key={`${game}-${round}-${three}`}>
          {meta.players === 1 ? (
            three && SoloDeep ? (
              <Suspense fallback={null}>
                <SoloDeep onScore={soloScore} />
              </Suspense>
            ) : (
              <>
                {game === "2048" && <Game2048 onScore={soloScore} />}
                {game === "snake" && <SnakeGame onScore={soloScore} />}
                {game === "mines" && <Minesweeper onScore={soloScore} />}
              </>
            )
          ) : three && Deep && Flat ? (
            <Suspense fallback={<Flat {...props} />}>
              <Fallback flat={Flat} props={props}>
                <Deep {...props} />
              </Fallback>
            </Suspense>
          ) : Flat ? (
            <Flat {...props} />
          ) : null}
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Lab />
  </StrictMode>,
);
