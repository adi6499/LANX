// LANX 2.9.0: the hidden games window ("/game" in any chat). Pick a game on
// the left; challenge a colleague who is online (they get a card in the
// chat and press Play), open a table for several colleagues (Chain
// Reaction, 2.10.0), play two or more at this PC, or play alone. Matches
// live in lib/games.ts, so closing this window never loses a game.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import { ArrowLeft, Box, Check, Flag, Gamepad2, Loader2, LogOut, Monitor, Play, RefreshCw, Swords, Trophy, Users, Volume2, VolumeX, X } from "lucide-react";
import type { Peer } from "../../types";
import { Avatar } from "../Avatar";
import * as games from "../../lib/games";
import { GAMES, GROUP_LABEL, type GameCardData, type GameId, type GameMeta, type Match, type SoloId } from "../../lib/games";
import { ChainReactionBoard, ChessBoard, ChessMoves, ConnectFourBoard, ReversiBoard, TicTacToeBoard, type BoardProps } from "./Boards";
import { BOARDS } from "./boards/index";
import { summaryOf } from "../../lib/gameRules";
import { Game2048, Minesweeper, SnakeGame } from "./Solo";
import { gameSoundOn, setGameSound, sfx } from "../../lib/gameSounds";
import { game3dOn, setGame3d } from "../../lib/game3d";
import "./games3d.css";
import { BOARDS3D, SOLO3D } from "./three/index";
import { Fallback } from "./three/Board3D";
import { canWebGL } from "./three/support";

/** The five oldest boards live in Boards.tsx (the 3D fallback needs them by id). */
const CLASSIC: Record<string, ComponentType<BoardProps>> = { tictactoe: TicTacToeBoard, connect4: ConnectFourBoard, reversi: ReversiBoard, chess: ChessBoard, chainreaction: ChainReactionBoard };

interface Props {
  initialQuery: string;
  openMatchId: string | null;
  peers: Peer[];
  myId: string;
  myName: string;
  /** The colleague of the chat this was opened from (offered first). */
  chatPeerId: string | null;
  onClose: () => void;
  onError: (t: string) => void;
  /** Post a challenge card into the chat with that colleague. */
  onSendCard: (card: GameCardData, peerId: string) => Promise<void>;
  /** On its way out (the app keeps it a moment so it can fade). */
  closing?: boolean;
}

const btn = "inline-flex items-center justify-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors active:scale-95 disabled:opacity-50 disabled:active:scale-100";
/** What the two sides are called in the two-player games (player 0 moves first). */
const SIDE_LABEL: Partial<Record<GameId, [string, string]>> = {
  tictactoe: ["✕", "○"],
  connect4: ["Red", "Yellow"],
  reversi: ["Black", "White"],
  chess: ["White", "Black"],
  checkers: ["Red", "Black"],
  gomoku: ["Black", "White"],
  hex: ["Red", "Blue"],
  go: ["Black", "White"],
  mancala: ["Bottom", "Top"],
};

function statsLine(id: string): string {
  const s = games.statsFor(id);
  if (!s || !s.played) return "";
  if (games.isLanGame(id)) return `W ${s.won} · L ${s.lost} · D ${s.drawn}`;
  if (id === "mines") return s.best ? `Best ${s.best} s` : `${s.played} played`;
  return s.best ? `Best ${s.best}` : `${s.played} played`;
}

export function GamesPanel({ initialQuery, openMatchId, peers, myId, myName, chatPeerId, onClose, onError, onSendCard, closing }: Props) {
  useSyncExternalStore(games.subscribe, games.snapshot, games.snapshot);
  useEffect(() => games.setMe(myId, myName), [myId, myName]);
  const openMatch = openMatchId ? games.getMatch(openMatchId) : undefined;
  const [pick, setPick] = useState<GameMeta>(() => games.findGame(initialQuery) ?? (openMatch ? games.gameMeta(openMatch.game)! : GAMES[0]));
  const [view, setView] = useState<"lobby" | "match" | "solo">(openMatch ? "match" : "lobby");
  const [matchId, setMatchId] = useState<string | null>(openMatch?.id ?? null);
  const [soloRun, setSoloRun] = useState(0);
  const [busy, setBusy] = useState(false);
  const [, setStatsReady] = useState(false);
  const [sound, setSound] = useState(gameSoundOn());
  const [three, setThree] = useState(game3dOn());

  useEffect(() => {
    void games.loadStats().then(() => setStatsReady(true));
  }, []);

  useEffect(() => {
    if (!openMatchId) return;
    const m = games.getMatch(openMatchId);
    if (m) {
      setPick(games.gameMeta(m.game) ?? GAMES[0]);
      setMatchId(m.id);
      setView("match");
    }
  }, [openMatchId]);

  const match = matchId ? games.getMatch(matchId) : undefined;
  useEffect(() => {
    if (match) games.markSeen(match.id);
  }, [match, match?.lastAt]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const live = games.allMatches();
  const sortedPeers = useMemo(() => {
    const rank = (p: Peer) => (p.id === chatPeerId ? 0 : p.status === "online" ? 1 : 2);
    return [...peers].filter((p) => p.trust_state !== "blocked").sort((a, b) => rank(a) - rank(b) || a.display_name.localeCompare(b.display_name));
  }, [peers, chatPeerId]);

  const openMatchView = (m: Match) => {
    setPick(games.gameMeta(m.game) ?? GAMES[0]);
    setMatchId(m.id);
    setView("match");
  };

  const challengeOne = async (peer: Peer) => {
    if (!games.isLanGame(pick.id)) return;
    setBusy(true);
    const { match: m, card } = games.challenge(pick.id, peer);
    try {
      await onSendCard(card, peer.id);
      openMatchView(m);
    } catch (e) {
      void games.leave(m.id);
      onError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const challengeMany = async (chosen: Peer[]) => {
    if (!games.isLanGame(pick.id) || chosen.length === 0) return;
    // One colleague: a plain two-player game (works with 2.9.1 copies too) — unless the game needs a host.
    if (chosen.length === 1 && !pick.hosted) return challengeOne(chosen[0]);
    setBusy(true);
    const { match: m, cards } = games.challengeMany(pick.id, chosen);
    let sent = 0;
    for (const { peerId, card } of cards) {
      try {
        await onSendCard(card, peerId);
        sent += 1;
      } catch (e) {
        onError(String((e as Error)?.message ?? e));
      }
    }
    setBusy(false);
    if (!sent) {
      void games.leave(m.id);
      return;
    }
    openMatchView(m);
  };

  const passAndPlay = (count: number) => {
    if (!games.isLanGame(pick.id)) return;
    openMatchView(games.localMatch(pick.id, count));
  };

  const onMove = useCallback(
    (mv: string) => {
      if (!matchId) return;
      void games.play(matchId, mv).then((problem) => problem && onError(problem));
    },
    [matchId, onError],
  );

  const soloScore = useCallback(
    (score: number) => {
      if (games.isLanGame(pick.id)) return;
      void games.recordScore(pick.id as SoloId, score, pick.id === "mines");
    },
    [pick.id],
  );

  return (
    <div className={`fixed inset-0 z-[60] flex items-center justify-center bg-black/30 backdrop-blur-sm ${closing ? "lanx-closing" : "lanx-fade"}`} onMouseDown={onClose}>
      <div data-games-panel data-games-view={view} data-games-3d={three ? "1" : undefined} className="w-[1180px] max-w-[96vw] h-[780px] max-h-[94vh] flex flex-col rounded-[22px] lanx-sheet p-4 lanx-rise" onMouseDown={(e) => e.stopPropagation()}>
        {/* ---- header */}
        <div className="flex items-center gap-3 px-1">
          <div className="h-9 w-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center">
            <Gamepad2 className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-bold text-slate-900 dark:text-white leading-tight">Games</div>
            <div className="text-[11.5px] text-slate-500 truncate">A hidden corner of LANX — type /game in any chat. Challenge colleagues, or play alone.</div>
          </div>
          <button
            type="button"
            data-games-3d-toggle={three ? "on" : "off"}
            title={three ? "The boards are in 3D — click for a flat look" : "Flat boards — click for 3D"}
            onClick={() => {
              const v = !three;
              setGame3d(v);
              setThree(v);
            }}
            className={`${btn} ${three ? "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/20" : "bg-slate-500/10 text-slate-500 hover:bg-slate-500/20"}`}
          >
            <Box className="h-4 w-4" /> {three ? "3D" : "Flat"}
          </button>
          <button
            type="button"
            data-games-sound={sound ? "on" : "off"}
            title={sound ? "Game sounds are on — click to mute them" : "Game sounds are off — click to turn them on"}
            onClick={() => {
              const v = !sound;
              setGameSound(v);
              setSound(v);
              if (v) sfx("pop");
            }}
            className={`${btn} ${sound ? "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/20" : "bg-slate-500/10 text-slate-500 hover:bg-slate-500/20"}`}
          >
            {sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />} {sound ? "Sound" : "Muted"}
          </button>
          <button type="button" data-games-close onClick={onClose} className={`${btn} bg-slate-500/10 text-slate-700 dark:text-slate-200 hover:bg-slate-500/20`}>
            <X className="h-4 w-4" /> Close
          </button>
        </div>

        <div className="mt-3 flex min-h-0 flex-1 gap-3">
          {/* ---- left: live matches + the games */}
          <aside className="w-[232px] shrink-0 flex flex-col gap-2 overflow-y-auto pr-1" data-games-list>
            {live.length > 0 && (
              <div className="rounded-2xl lanx-group p-2">
                <div className="px-2 pb-1 text-[10.5px] font-bold uppercase tracking-wide text-slate-500">Your games</div>
                {live.slice(0, 8).map((m) => {
                  const mine = games.myTurn(m);
                  const chip =
                    m.status === "waiting" ? "waiting" : m.status === "lobby" ? `${m.joined.length} joined` : m.status === "playing" ? (mine ? "your move" : m.mode === "local" ? "playing" : `${games.seatName(m, games.turnSeat(m))}'s move`) : m.status;
                  const title = m.mode === "local" ? `${games.gameName(m.game)} · pass & play` : m.mode === "multi" ? `${games.gameName(m.game)} · ${m.seats.length} players` : `vs ${games.opponent(m)?.name ?? "?"}`;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      data-game-live={m.id}
                      onClick={() => openMatchView(m)}
                      className={`w-full flex items-center gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-slate-500/10 ${matchId === m.id && view === "match" ? "bg-indigo-500/10" : ""}`}
                    >
                      <span className="text-base">{games.gameMeta(m.game)?.emoji}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-semibold text-slate-900 dark:text-white">{title}</span>
                        <span className={`block truncate text-[10.5px] ${mine && m.status === "playing" ? "text-indigo-600 dark:text-indigo-300 font-semibold" : "text-slate-500"}`}>{chip}</span>
                      </span>
                      {m.unseen && <span className="h-2 w-2 rounded-full bg-indigo-500" />}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="rounded-2xl lanx-group p-2">
              <div className="px-2 pb-1 text-[10.5px] font-bold uppercase tracking-wide text-slate-500">Games · {GAMES.length}</div>
              {GAMES.map((g, gi) => (
                <div key={g.id}>
                {(gi === 0 || GAMES[gi - 1].group !== g.group) && <div className="px-2 pb-0.5 pt-2 text-[10px] font-bold uppercase tracking-wide text-indigo-500/80" data-game-group={g.group}>{GROUP_LABEL[g.group]}</div>}
                <button
                  key={g.id}
                  type="button"
                  data-game-pick={g.id}
                  onClick={() => {
                    setPick(g);
                    setView("lobby");
                  }}
                  className={`w-full flex items-center gap-2.5 rounded-xl px-2 py-2 text-left hover:bg-slate-500/10 ${pick.id === g.id && view !== "match" ? "bg-indigo-600 text-white hover:bg-indigo-600" : ""}`}
                >
                  <span className="h-8 w-8 rounded-lg bg-white/80 dark:bg-slate-800 flex items-center justify-center text-lg shadow-sm">{g.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold leading-tight">{g.name}</span>
                    <span className={`block text-[10.5px] ${pick.id === g.id && view !== "match" ? "text-white/80" : "text-slate-500"}`}>
                      {g.players === 1 ? "Solo" : g.minPlayers === g.maxPlayers ? `${g.maxPlayers} players` : g.minPlayers === 1 ? `1–${g.maxPlayers} players` : `${g.minPlayers}–${g.maxPlayers} players`}
                      {statsLine(g.id) ? ` · ${statsLine(g.id)}` : ""}
                    </span>
                  </span>
                </button>
                </div>
              ))}
            </div>
          </aside>

          {/* ---- main */}
          <section className="min-w-0 flex-1 rounded-2xl lanx-group overflow-hidden flex flex-col">
            {view === "lobby" && (
              <Lobby
                game={pick}
                peers={sortedPeers}
                chatPeerId={chatPeerId}
                busy={busy}
                onChallenge={challengeOne}
                onChallengeMany={challengeMany}
                onLocal={passAndPlay}
                onSolo={() => {
                  setSoloRun((n) => n + 1);
                  setView("solo");
                }}
              />
            )}
            {view === "solo" && !games.isLanGame(pick.id) && (
              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex items-center gap-2 px-4 pt-3">
                  <button type="button" data-game-back onClick={() => setView("lobby")} className={`${btn} bg-slate-500/10 text-slate-700 dark:text-slate-200`}>
                    <ArrowLeft className="h-4 w-4" /> Back
                  </button>
                  <div className="text-[14px] font-bold">
                    {pick.emoji} {pick.name}
                  </div>
                  <div className="ml-auto text-[11.5px] text-slate-500">{statsLine(pick.id)}</div>
                </div>
                <div className="flex-1 overflow-auto flex p-4 [&>*]:m-auto" key={`${soloRun}-${three}`}>
                  {three && canWebGL() && SOLO3D[pick.id] ? (
                    <SoloDeep id={pick.id} onScore={soloScore} />
                  ) : (
                    <Stage on>
                      {pick.id === "2048" && <Game2048 onScore={soloScore} />}
                      {pick.id === "snake" && <SnakeGame onScore={soloScore} />}
                      {pick.id === "mines" && <Minesweeper onScore={soloScore} />}
                    </Stage>
                  )}
                </div>
              </div>
            )}
            {view === "match" && match && <MatchView match={match} three={three} onMove={onMove} onBack={() => setView("lobby")} onError={onError} />}
            {view === "match" && !match && (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-500">
                <div className="text-[13px]">That game is gone.</div>
                <button type="button" data-game-back onClick={() => setView("lobby")} className={`${btn} bg-slate-500/10 text-slate-700 dark:text-slate-200`}>
                  <ArrowLeft className="h-4 w-4" /> Back to games
                </button>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- lobby

function Lobby({
  game,
  peers,
  chatPeerId,
  busy,
  onChallenge,
  onChallengeMany,
  onLocal,
  onSolo,
}: {
  game: GameMeta;
  peers: Peer[];
  chatPeerId: string | null;
  busy: boolean;
  onChallenge: (p: Peer) => void;
  onChallengeMany: (ps: Peer[]) => void;
  onLocal: (count: number) => void;
  onSolo: () => void;
}) {
  const s = games.statsFor(game.id);
  const many = game.maxPlayers > 2 || !!game.hosted;
  const counts = Array.from({ length: Math.min(8, game.maxPlayers) - Math.max(1, game.minPlayers) + 1 }, (_, k) => Math.max(1, game.minPlayers) + k);
  const [chosen, setChosen] = useState<string[]>([]);
  const [count, setCount] = useState(Math.max(1, game.minPlayers));
  useEffect(() => {
    setChosen([]);
    setCount(Math.max(2, game.minPlayers) <= game.maxPlayers ? Math.max(2, game.minPlayers) : Math.max(1, game.minPlayers));
  }, [game.id, game.minPlayers, game.maxPlayers]);
  const online = peers.filter((p) => p.status === "online");
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const chosenPeers = online.filter((p) => chosen.includes(p.id));

  return (
    <div className="flex-1 overflow-y-auto p-5" data-game-lobby={game.id}>
      <div className="flex items-start gap-4">
        <div className="h-16 w-16 rounded-2xl bg-white dark:bg-slate-800 shadow flex items-center justify-center text-4xl">{game.emoji}</div>
        <div className="min-w-0 flex-1">
          <div className="text-[20px] font-bold text-slate-900 dark:text-white leading-tight">{game.name}</div>
          <div className="text-[13px] text-slate-600 dark:text-slate-300">{game.blurb}</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
            <span className="rounded-full bg-slate-500/10 px-2 py-0.5 font-semibold inline-flex items-center gap-1">
              {game.players === 2 ? <Users className="h-3 w-3" /> : <Monitor className="h-3 w-3" />} {game.players === 1 ? "Just you" : many ? "Two or more players" : "Two players"}
            </span>
            {s && s.played > 0 && (
              <span className="rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 px-2 py-0.5 font-semibold inline-flex items-center gap-1" data-game-stats>
                <Trophy className="h-3 w-3" /> {statsLine(game.id)}
              </span>
            )}
          </div>
        </div>
      </div>

      {game.players === 1 ? (
        <div className="mt-6">
          <button type="button" data-game-solo onClick={onSolo} className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700 !px-6 !py-2.5 !text-[14px]`}>
            <Gamepad2 className="h-4 w-4" /> Play
          </button>
        </div>
      ) : many ? (
        <>
          <div className="mt-6 text-[11px] font-bold uppercase tracking-wide text-slate-500">Open a table — tick the colleagues to invite</div>
          <div className="mt-2 rounded-2xl bg-white/70 dark:bg-slate-800/60 divide-y divide-slate-500/10">
            {peers.length === 0 && <div className="px-4 py-3 text-[12.5px] text-slate-500">No colleagues on LANX yet.</div>}
            {peers.map((p) => {
              const isOn = p.status === "online";
              const on = chosen.includes(p.id);
              return (
                <label key={p.id} className={`flex items-center gap-3 px-3 py-2 ${isOn ? "cursor-pointer" : "opacity-60"}`} data-game-peer-row={p.id}>
                  <input type="checkbox" data-game-pick-peer={p.id} disabled={!isOn || busy} checked={on} onChange={() => toggle(p.id)} className="h-4 w-4 accent-indigo-600" />
                  <Avatar name={p.display_name} color={p.avatar_color} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-slate-900 dark:text-white">
                      {p.display_name}
                      {p.id === chatPeerId && <span className="ml-1.5 rounded-full bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 text-[10px] font-bold">this chat</span>}
                    </div>
                    <div className={`text-[11px] ${isOn ? "text-emerald-600" : "text-slate-400"}`}>{isOn ? "online" : "offline"}</div>
                  </div>
                </label>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" data-game-challenge-many disabled={busy || chosenPeers.length + 1 < Math.max(2, game.minPlayers)} onClick={() => onChallengeMany(chosenPeers)} className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Swords className="h-3.5 w-3.5" />}
              {chosenPeers.length === 0 ? `Invite colleagues${game.minPlayers > 2 ? ` (${game.minPlayers - 1} or more)` : ""}` : `Invite ${chosenPeers.length} ${chosenPeers.length === 1 ? "colleague" : "colleagues"} — ${chosenPeers.length + 1} at the table`}
            </button>
            <span className="text-[11.5px] text-slate-500">
              Each gets a card in your chat; you start once they have pressed Play.{" "}
              {game.minPlayers === game.maxPlayers ? `Exactly ${game.minPlayers} players.` : game.minPlayers > 2 ? `${game.minPlayers} to ${game.maxPlayers} players.` : `Up to ${game.maxPlayers} players.`} Their LANX needs {["chainreaction"].includes(game.id) ? "2.10.0" : ["dots", "minesvs", "memory", "mahjong"].includes(game.id) ? "2.11.0" : "2.12.0"}.
            </span>
          </div>

          {!game.noLocal && (
            <>
              <div className="mt-5 text-[11px] font-bold uppercase tracking-wide text-slate-500">{counts[0] === 1 ? "At this PC" : "Pass & play at this PC"}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {counts.length > 1 && (
                  <div className="flex items-center gap-1 rounded-full bg-white/70 dark:bg-slate-800/60 p-1" data-game-local-counts>
                    {counts.map((n) => (
                      <button key={n} type="button" data-game-local-count={n} onClick={() => setCount(n)} className={`h-7 w-7 rounded-full text-[12px] font-bold ${count === n ? "bg-indigo-600 text-white" : "text-slate-600 dark:text-slate-300 hover:bg-slate-500/10"}`}>
                        {n}
                      </button>
                    ))}
                  </div>
                )}
                <button type="button" data-game-local onClick={() => onLocal(count)} className={`${btn} bg-slate-500/10 text-slate-700 dark:text-slate-200 hover:bg-slate-500/20`}>
                  <Monitor className="h-4 w-4" /> {count === 1 ? "Play alone" : `Pass & play with ${count}`}
                </button>
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <div className="mt-6 text-[11px] font-bold uppercase tracking-wide text-slate-500">Challenge a colleague</div>
          <div className="mt-2 rounded-2xl bg-white/70 dark:bg-slate-800/60 divide-y divide-slate-500/10">
            {peers.length === 0 && <div className="px-4 py-3 text-[12.5px] text-slate-500">No colleagues on LANX yet.</div>}
            {peers.map((p) => {
              const isOn = p.status === "online";
              return (
                <div key={p.id} className="flex items-center gap-3 px-3 py-2" data-game-peer-row={p.id}>
                  <Avatar name={p.display_name} color={p.avatar_color} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-slate-900 dark:text-white">
                      {p.display_name}
                      {p.id === chatPeerId && <span className="ml-1.5 rounded-full bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 text-[10px] font-bold">this chat</span>}
                    </div>
                    <div className={`text-[11px] ${isOn ? "text-emerald-600" : "text-slate-400"}`}>{isOn ? "online" : "offline"}</div>
                  </div>
                  <button type="button" data-game-peer={p.id} disabled={!isOn || busy} onClick={() => onChallenge(p)} className={`${btn} ${isOn ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-slate-500/10 text-slate-500"}`}>
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Swords className="h-3.5 w-3.5" />} Challenge
                  </button>
                </div>
              );
            })}
          </div>
          <div className="mt-2 text-[11.5px] text-slate-500">They get a card in your chat and press Play — then the board opens on both PCs. Their LANX needs {["tictactoe", "connect4", "reversi", "chess"].includes(game.id) ? "2.9.0" : "2.11.0"} or newer.</div>

          {!game.noLocal && (
            <>
              <div className="mt-5 text-[11px] font-bold uppercase tracking-wide text-slate-500">Two people at this PC</div>
              <button type="button" data-game-local onClick={() => onLocal(2)} className={`${btn} mt-2 bg-slate-500/10 text-slate-700 dark:text-slate-200 hover:bg-slate-500/20`}>
                <Monitor className="h-4 w-4" /> Pass & play
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- a match

function MatchView({ match: m, three, onMove, onBack, onError }: { match: Match; three: boolean; onMove: (mv: string) => void; onBack: () => void; onError: (t: string) => void }) {
  const meta = games.gameMeta(m.game)!;
  const seatNow = games.turnSeat(m);
  const mine = games.mySeat(m);
  const canPlay = games.myTurn(m);
  const host = games.isHost(m);
  const sides = SIDE_LABEL[m.game];
  const [sure, setSure] = useState(false);
  useEffect(() => setSure(false), [m.id, m.round]);

  const status = (() => {
    if (m.status === "waiting") return `Waiting for ${games.opponent(m)?.name ?? "them"} to press Play…`;
    if (m.status === "lobby") return host ? `${m.joined.length} of ${m.seats.length} at the table — start when ready` : `Waiting for ${m.seats[0]?.name ?? "the host"} to start…`;
    if (m.status === "declined") return m.note || `${games.opponent(m)?.name ?? "They"} declined.`;
    if (m.status === "left") return m.note || `${games.opponent(m)?.name ?? "They"} left the game.`;
    if (m.status === "over") return games.resultText(m);
    if (m.turn < 0) return "Both sides act now";
    if (m.mode === "local") return `${games.seatName(m, seatNow)} to move${sides ? ` (${sides[m.turn]})` : ""}`;
    return canPlay ? "Your move" : `${games.seatName(m, seatNow)}'s move`;
  })();
  const summary = m.status === "playing" || m.status === "over" ? summaryOf(m.game, m.moves, m.seats.length, games.seedOf(m)) : "";

  const title = m.mode === "local" ? "pass & play" : m.mode === "multi" ? `${m.seats.length} players` : `vs ${games.opponent(m)?.name ?? "?"}`;
  const board: BoardProps = {
    moves: m.moves,
    canPlay,
    turn: m.turn,
    seat: m.mode === "local" || mine < 0 ? Math.max(0, m.turn) : games.playerOf(m, mine),
    seats: m.seats,
    starter: games.starterSeat(m),
    seed: games.seedOf(m),
    secret: m.secret,
    onSecret: (v) => games.setSecret(m.id, v),
    local: m.mode === "local",
    deltas: m.deltas,
    onDelta: (d) => games.sendDelta(m.id, d),
    host,
    onMove,
  };
  const Generic = BOARDS[m.game];
  const Flat = CLASSIC[m.game] ?? Generic;
  // LANX 2.16.0: a real 3D board (three.js) when there is one and this PC can draw it; the flat board otherwise.
  const Deep = three && Flat && canWebGL() ? BOARDS3D[m.game] : undefined;
  const showBoard = m.status === "playing" || m.status === "over" || (m.status === "left" && m.moves.length > 0);
  // Boards you aim or draw on with the mouse stay flat, so the pointer lands where you point.
  const tilt = !Deep && !meta.realtime && meta.group !== "shots" && m.game !== "drawguess" && m.game !== "paintfight";
  return (
    <div className="flex-1 flex flex-col min-h-0" data-game-match={m.id} data-game-match-status={m.status} data-game-mode={m.mode}>
      <div className="flex items-center gap-2 px-4 pt-3">
        <button type="button" data-game-back onClick={onBack} className={`${btn} bg-slate-500/10 text-slate-700 dark:text-slate-200`}>
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <div className="text-[14px] font-bold">
          {meta.emoji} {meta.name} <span className="text-slate-400 font-medium">· {title}</span>
        </div>
        {m.round > 1 && <span className="rounded-full bg-slate-500/10 px-2 py-0.5 text-[11px] font-semibold">Round {m.round}</span>}
      </div>
      <div className="flex-1 min-h-0 flex items-stretch gap-4 p-4">
        {/* A board taller or wider than the room scrolls from its top-left edge (centred with margins, not flex). */}
        <div className="flex-1 min-w-0 overflow-auto flex [&>*]:m-auto">
          <Stage on={showBoard && tilt}>
          {m.status === "waiting" && (
            <div className="flex flex-col items-center gap-3 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
              <div className="text-[14px] font-semibold">{status}</div>
              <div className="text-[12px] text-slate-500 max-w-[320px]">The challenge is in your chat with {games.opponent(m)?.name}. The moment they press Play, the board opens here.</div>
            </div>
          )}
          {m.status === "lobby" && (
            <div className="flex flex-col items-center gap-3 text-center" data-game-table>
              <Users className="h-8 w-8 text-indigo-500" />
              <div className="text-[14px] font-semibold">{status}</div>
              <div className="text-[12px] text-slate-500 max-w-[340px]">
                {host ? "Each colleague has a card in their chat with you; they press Play to sit down. Start whenever enough have joined — the rest can watch next round." : `${m.seats[0]?.name ?? "The host"} starts the game once everyone has sat down.`}
              </div>
              {host && (
                <button type="button" data-game-start disabled={m.joined.length < 2} onClick={() => void games.startNow(m.id).then((p) => p && onError(p))} className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700 !px-5 !py-2`}>
                  <Play className="h-4 w-4" /> Start with {m.joined.length}
                </button>
              )}
            </div>
          )}
          {(m.status === "declined" || (m.status === "left" && !showBoard)) && <div className="text-[14px] font-semibold text-slate-600 dark:text-slate-300">{status}</div>}
          {showBoard && Deep && Flat && (
            <Suspense fallback={<Flat {...board} />}>
              <Fallback flat={Flat} props={board} key={m.id}>
                <Deep {...board} />
              </Fallback>
            </Suspense>
          )}
          {showBoard && !Deep && (
            <>
              {m.game === "tictactoe" && <TicTacToeBoard {...board} />}
              {m.game === "connect4" && <ConnectFourBoard {...board} />}
              {m.game === "reversi" && <ReversiBoard {...board} />}
              {m.game === "chess" && <ChessBoard {...board} />}
              {m.game === "chainreaction" && <ChainReactionBoard {...board} />}
              {Generic && <Generic {...board} />}
            </>
          )}
          </Stage>
        </div>
        <aside className="w-[220px] shrink-0 flex flex-col gap-3 min-h-0">
          <div className="rounded-2xl bg-white/70 dark:bg-slate-800/60 p-3 flex flex-col gap-1.5 max-h-[46%] overflow-y-auto" data-game-seats>
            {m.seats.map((s, i) => {
              const name = games.seatName(m, i);
              const isMe = i === mine;
              const joined = m.status === "lobby" ? m.joined.includes(s.id) : true;
              const gone = m.gone.includes(s.id);
              const p = games.playerOf(m, i);
              const toMove = m.status === "playing" && seatNow === i;
              return (
                <div key={s.id} className={`flex items-center gap-2 rounded-xl px-2 py-1.5 ${toMove ? "bg-indigo-500/10 ring-1 ring-indigo-500/40" : ""} ${gone ? "opacity-50" : ""}`} data-game-seat={i} data-game-joined={joined ? s.id : undefined}>
                  {m.mode !== "local" && !isMe ? <Avatar name={s.name} color={s.color || "#6366f1"} size={28} /> : <span className="h-7 w-7 rounded-full flex items-center justify-center text-[12px] font-bold text-white" style={{ backgroundColor: s.color }}>{i + 1}</span>}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-semibold text-slate-900 dark:text-white">{name}</div>
                    <div className="text-[10.5px] text-slate-500 flex items-center gap-1">
                      {sides ? sides[p] : <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />}
                      {p === 0 && m.status !== "lobby" ? " · starts" : ""}
                      {gone ? " · left" : m.status === "lobby" ? (joined ? " · joined" : " · invited") : ""}
                    </div>
                  </div>
                  {m.status === "lobby" && joined && <Check className="h-4 w-4 text-emerald-500" />}
                  {toMove && <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-300">to move</span>}
                  {m.result && !m.result.draw && m.result.winner === i && <Trophy className="h-4 w-4 text-amber-500" />}
                </div>
              );
            })}
          </div>
          <div data-game-status className={`rounded-2xl px-3 py-2 text-[13px] font-semibold ${m.status === "over" ? "bg-amber-500/15 text-amber-800 dark:text-amber-200" : canPlay && m.status === "playing" ? "bg-indigo-600 text-white" : "bg-white/70 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200"}`}>
            {status}
            {summary && (
              <div data-game-summary className="mt-0.5 text-[11px] font-medium opacity-80">
                {summary}
              </div>
            )}
          </div>
          {m.error && (
            <div data-game-error className="rounded-2xl bg-rose-500/10 px-3 py-2 text-[12px] text-rose-700 dark:text-rose-300">
              {m.error}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {m.status === "playing" && m.moves.length > 0 && (m.mode === "local" || mine >= 0) && (sure ? (
              <button type="button" data-game-resign-sure onClick={() => void games.resign(m.id)} className={`${btn} bg-rose-600 text-white hover:bg-rose-700`}>
                <Flag className="h-3.5 w-3.5" /> Yes, give up
              </button>
            ) : (
              <button type="button" data-game-resign onClick={() => setSure(true)} className={`${btn} bg-slate-500/10 text-slate-700 dark:text-slate-200`}>
                <Flag className="h-3.5 w-3.5" /> {m.mode === "local" && m.seats.length > 2 ? `${games.seatName(m, seatNow)} gives up` : "Resign"}
              </button>
            ))}
            {m.status === "over" && (m.mode !== "multi" || host) && (
              <button type="button" data-game-rematch onClick={() => void games.rematch(m.id)} className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`}>
                <RefreshCw className="h-3.5 w-3.5" /> Rematch
              </button>
            )}
            {m.status !== "playing" && (
              <button
                type="button"
                data-game-leave
                onClick={() => {
                  void games.leave(m.id).catch((e) => onError(String(e)));
                  onBack();
                }}
                className={`${btn} bg-slate-500/10 text-slate-700 dark:text-slate-200`}
              >
                <LogOut className="h-3.5 w-3.5" /> {m.status === "waiting" ? "Cancel challenge" : m.status === "lobby" ? (host ? "Close table" : "Leave table") : "Clear"}
              </button>
            )}
            {m.status === "playing" && m.mode === "multi" && (
              <button
                type="button"
                data-game-leave
                onClick={() => {
                  void games.leave(m.id).catch((e) => onError(String(e)));
                  onBack();
                }}
                className={`${btn} bg-slate-500/10 text-slate-700 dark:text-slate-200`}
              >
                <LogOut className="h-3.5 w-3.5" /> {host ? "Close table" : "Leave table"}
              </button>
            )}
          </div>
          {m.game === "chess" && m.moves.length > 0 && (
            <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl bg-white/70 dark:bg-slate-800/60 p-3">
              <ChessMoves moves={m.moves} />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the solo games in 3D (2.16.0)

const SOLO_FLAT: Record<string, ComponentType<{ onScore: (n: number) => void }>> = { "2048": Game2048, snake: SnakeGame, mines: Minesweeper };

/** A solo game in 3D, with the flat one while it loads (or if 3D fails on this PC). */
function SoloDeep({ id, onScore }: { id: string; onScore: (n: number) => void }) {
  const Deep = SOLO3D[id];
  const Flat = SOLO_FLAT[id];
  const flatAsBoard = useMemo(() => (() => <Flat onScore={onScore} />) as unknown as ComponentType<BoardProps>, [Flat, onScore]);
  return (
    <Suspense fallback={<Flat onScore={onScore} />}>
      <Fallback flat={flatAsBoard} props={{} as BoardProps}>
        <Deep onScore={onScore} />
      </Fallback>
    </Suspense>
  );
}

// ---------------------------------------------------------------- the 3D table (2.13.0)

/** The board lies on a tilted table that leans a little towards the mouse (games3d.css). Takes no room of its own. */
function Stage({ on, children }: { on: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className="g3-stage [&>*]:m-auto"
      style={{ display: "contents" }}
      data-g3={on ? "1" : undefined}
      onMouseMove={(e) => {
        const el = ref.current;
        const r = el?.firstElementChild?.getBoundingClientRect();
        if (!el || !on || !r || r.width < 1 || r.height < 1) return;
        const dx = (e.clientX - r.left) / r.width - 0.5;
        const dy = (e.clientY - r.top) / r.height - 0.5;
        el.style.setProperty("--g3-ry", `${(dx * 7).toFixed(2)}deg`);
        el.style.setProperty("--g3-rx", `${(-dy * 6).toFixed(2)}deg`);
      }}
      onMouseLeave={() => {
        ref.current?.style.removeProperty("--g3-rx");
        ref.current?.style.removeProperty("--g3-ry");
      }}
    >
      {children}
    </div>
  );
}
