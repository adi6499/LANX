// LANX 2.9.0: the hidden games window ("/game" in any chat). Pick a game on
// the left; challenge a colleague who is online (they get a card in the
// chat and press Play), or play two at this PC, or play alone. Matches live
// in lib/games.ts, so closing this window never loses a game.

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ArrowLeft, Flag, Gamepad2, Loader2, LogOut, Monitor, RefreshCw, Swords, Trophy, Users, X } from "lucide-react";
import type { Peer } from "../../types";
import { Avatar } from "../Avatar";
import * as games from "../../lib/games";
import { GAMES, type GameCardData, type GameId, type GameMeta, type Match, type SoloId } from "../../lib/games";
import { ChainReactionBoard, ChessBoard, ChessMoves, ConnectFourBoard, ReversiBoard, TicTacToeBoard, type BoardProps } from "./Boards";
import { Game2048, Minesweeper, SnakeGame } from "./Solo";

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
  /** Post the challenge card into the chat with that colleague. */
  onSendCard: (card: GameCardData, peerId: string) => Promise<void>;
}

const btn = "inline-flex items-center justify-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors active:scale-95 disabled:opacity-50 disabled:active:scale-100";
const SEAT_LABEL: Record<GameId, [string, string]> = { tictactoe: ["✕", "○"], connect4: ["Red", "Yellow"], reversi: ["Black", "White"], chess: ["White", "Black"], chainreaction: ["Red", "Blue"] };

function statsLine(id: string): string {
  const s = games.statsFor(id);
  if (!s || !s.played) return "";
  if (games.isLanGame(id)) return `W ${s.won} · L ${s.lost} · D ${s.drawn}`;
  if (id === "mines") return s.best ? `Best ${s.best} s` : `${s.played} played`;
  return s.best ? `Best ${s.best}` : `${s.played} played`;
}

export function GamesPanel({ initialQuery, openMatchId, peers, myId, myName, chatPeerId, onClose, onError, onSendCard }: Props) {
  useSyncExternalStore(games.subscribe, games.snapshot, games.snapshot);
  const openMatch = openMatchId ? games.getMatch(openMatchId) : undefined;
  const [pick, setPick] = useState<GameMeta>(() => games.findGame(initialQuery) ?? (openMatch ? games.gameMeta(openMatch.game)! : GAMES[0]));
  const [view, setView] = useState<"lobby" | "match" | "solo">(openMatch ? "match" : "lobby");
  const [matchId, setMatchId] = useState<string | null>(openMatch?.id ?? null);
  const [soloRun, setSoloRun] = useState(0);
  const [busyPeer, setBusyPeer] = useState<string | null>(null);
  const [, setStatsReady] = useState(false);

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

  const challenge = async (peer: Peer) => {
    if (!games.isLanGame(pick.id)) return;
    setBusyPeer(peer.id);
    const { match: m, card } = games.challenge(pick.id, peer, myName);
    try {
      await onSendCard(card, peer.id);
      setMatchId(m.id);
      setView("match");
    } catch (e) {
      void games.leave(m.id);
      onError(String((e as Error)?.message ?? e));
    } finally {
      setBusyPeer(null);
    }
  };

  const passAndPlay = () => {
    if (!games.isLanGame(pick.id)) return;
    const m = games.localMatch(pick.id);
    setMatchId(m.id);
    setView("match");
  };

  const openMatchView = (m: Match) => {
    setPick(games.gameMeta(m.game) ?? GAMES[0]);
    setMatchId(m.id);
    setView("match");
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 backdrop-blur-sm lanx-fade" onMouseDown={onClose}>
      <div data-games-panel data-games-view={view} className="w-[980px] max-w-[96vw] h-[680px] max-h-[94vh] flex flex-col rounded-[22px] lanx-sheet p-4 lanx-rise" onMouseDown={(e) => e.stopPropagation()}>
        {/* ---- header */}
        <div className="flex items-center gap-3 px-1">
          <div className="h-9 w-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center">
            <Gamepad2 className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-bold text-slate-900 dark:text-white leading-tight">Games</div>
            <div className="text-[11.5px] text-slate-500 truncate">A hidden corner of LANX — type /game in any chat. Challenge a colleague, or play alone.</div>
          </div>
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
                  const chip = m.status === "waiting" ? "waiting" : m.status === "playing" ? (mine ? "your move" : m.opp ? "their move" : "playing") : m.status;
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
                        <span className="block truncate text-[12.5px] font-semibold text-slate-900 dark:text-white">{m.opp ? `vs ${m.opp.name}` : `${games.gameName(m.game)} · pass & play`}</span>
                        <span className={`block text-[10.5px] ${mine && m.status === "playing" ? "text-indigo-600 dark:text-indigo-300 font-semibold" : "text-slate-500"}`}>{chip}</span>
                      </span>
                      {m.unseen && <span className="h-2 w-2 rounded-full bg-indigo-500" />}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="rounded-2xl lanx-group p-2">
              <div className="px-2 pb-1 text-[10.5px] font-bold uppercase tracking-wide text-slate-500">Games</div>
              {GAMES.map((g) => (
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
                    <span className={`block text-[10.5px] ${pick.id === g.id && view !== "match" ? "text-white/80" : "text-slate-500"}`}>{g.players === 2 ? "2 players" : "Solo"}{statsLine(g.id) ? ` · ${statsLine(g.id)}` : ""}</span>
                  </span>
                </button>
              ))}
            </div>
          </aside>

          {/* ---- main */}
          <section className="min-w-0 flex-1 rounded-2xl lanx-group overflow-hidden flex flex-col">
            {view === "lobby" && (
              <Lobby game={pick} peers={sortedPeers} chatPeerId={chatPeerId} busyPeer={busyPeer} onChallenge={challenge} onLocal={passAndPlay} onSolo={() => { setSoloRun((n) => n + 1); setView("solo"); }} />
            )}
            {view === "solo" && !games.isLanGame(pick.id) && (
              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex items-center gap-2 px-4 pt-3">
                  <button type="button" data-game-back onClick={() => setView("lobby")} className={`${btn} bg-slate-500/10 text-slate-700 dark:text-slate-200`}>
                    <ArrowLeft className="h-4 w-4" /> Back
                  </button>
                  <div className="text-[14px] font-bold">{pick.emoji} {pick.name}</div>
                  <div className="ml-auto text-[11.5px] text-slate-500">{statsLine(pick.id)}</div>
                </div>
                <div className="flex-1 flex items-center justify-center overflow-auto p-4" key={soloRun}>
                  {pick.id === "2048" && <Game2048 onScore={soloScore} />}
                  {pick.id === "snake" && <SnakeGame onScore={soloScore} />}
                  {pick.id === "mines" && <Minesweeper onScore={soloScore} />}
                </div>
              </div>
            )}
            {view === "match" && match && <MatchView match={match} myId={myId} onMove={onMove} onBack={() => setView("lobby")} onError={onError} />}
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

function Lobby({ game, peers, chatPeerId, busyPeer, onChallenge, onLocal, onSolo }: { game: GameMeta; peers: Peer[]; chatPeerId: string | null; busyPeer: string | null; onChallenge: (p: Peer) => void; onLocal: () => void; onSolo: () => void }) {
  const s = games.statsFor(game.id);
  return (
    <div className="flex-1 overflow-y-auto p-5" data-game-lobby={game.id}>
      <div className="flex items-start gap-4">
        <div className="h-16 w-16 rounded-2xl bg-white dark:bg-slate-800 shadow flex items-center justify-center text-4xl">{game.emoji}</div>
        <div className="min-w-0 flex-1">
          <div className="text-[20px] font-bold text-slate-900 dark:text-white leading-tight">{game.name}</div>
          <div className="text-[13px] text-slate-600 dark:text-slate-300">{game.blurb}</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
            <span className="rounded-full bg-slate-500/10 px-2 py-0.5 font-semibold inline-flex items-center gap-1">{game.players === 2 ? <Users className="h-3 w-3" /> : <Monitor className="h-3 w-3" />} {game.players === 2 ? "Two players" : "Just you"}</span>
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
      ) : (
        <>
          <div className="mt-6 text-[11px] font-bold uppercase tracking-wide text-slate-500">Challenge a colleague</div>
          <div className="mt-2 rounded-2xl bg-white/70 dark:bg-slate-800/60 divide-y divide-slate-500/10">
            {peers.length === 0 && <div className="px-4 py-3 text-[12.5px] text-slate-500">No colleagues on LANX yet.</div>}
            {peers.map((p) => {
              const online = p.status === "online";
              return (
                <div key={p.id} className="flex items-center gap-3 px-3 py-2" data-game-peer-row={p.id}>
                  <Avatar name={p.display_name} color={p.avatar_color} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-slate-900 dark:text-white">
                      {p.display_name}
                      {p.id === chatPeerId && <span className="ml-1.5 rounded-full bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 text-[10px] font-bold">this chat</span>}
                    </div>
                    <div className={`text-[11px] ${online ? "text-emerald-600" : "text-slate-400"}`}>{online ? "online" : "offline"}</div>
                  </div>
                  <button type="button" data-game-peer={p.id} disabled={!online || busyPeer !== null} onClick={() => onChallenge(p)} className={`${btn} ${online ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-slate-500/10 text-slate-500"}`}>
                    {busyPeer === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Swords className="h-3.5 w-3.5" />} Challenge
                  </button>
                </div>
              );
            })}
          </div>
          <div className="mt-2 text-[11.5px] text-slate-500">They get a card in your chat and press Play — then the board opens on both PCs. Their LANX needs 2.9.0 or newer.</div>

          <div className="mt-5 text-[11px] font-bold uppercase tracking-wide text-slate-500">Two people at this PC</div>
          <button type="button" data-game-local onClick={onLocal} className={`${btn} mt-2 bg-slate-500/10 text-slate-700 dark:text-slate-200 hover:bg-slate-500/20`}>
            <Monitor className="h-4 w-4" /> Pass & play
          </button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- a match

function MatchView({ match: m, myId, onMove, onBack, onError }: { match: Match; myId: string; onMove: (mv: string) => void; onBack: () => void; onError: (t: string) => void }) {
  const meta = games.gameMeta(m.game)!;
  const turn = games.turnIndex(m);
  const seat = m.opp ? games.myIndex(m) : 0;
  const canPlay = games.myTurn(m);
  const [sure, setSure] = useState(false);
  useEffect(() => setSure(false), [m.id, m.round]);
  void myId;

  const status = (() => {
    if (m.status === "waiting") return `Waiting for ${m.opp?.name ?? "them"} to press Play…`;
    if (m.status === "declined") return `${m.opp?.name ?? "They"} declined.`;
    if (m.status === "left") return `${m.opp?.name ?? "They"} left the game.`;
    if (m.status === "over") return games.resultText(m);
    if (!m.opp) return `${games.seatName(m, turn)} to move (${SEAT_LABEL[m.game][turn]})`;
    return canPlay ? "Your move" : `${m.opp.name}'s move`;
  })();

  const board: BoardProps = { moves: m.moves, canPlay, turn, seat, onMove };
  return (
    <div className="flex-1 flex flex-col min-h-0" data-game-match={m.id} data-game-match-status={m.status}>
      <div className="flex items-center gap-2 px-4 pt-3">
        <button type="button" data-game-back onClick={onBack} className={`${btn} bg-slate-500/10 text-slate-700 dark:text-slate-200`}>
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <div className="text-[14px] font-bold">
          {meta.emoji} {meta.name} <span className="text-slate-400 font-medium">· {m.opp ? `vs ${m.opp.name}` : "pass & play"}</span>
        </div>
        {m.round > 1 && <span className="rounded-full bg-slate-500/10 px-2 py-0.5 text-[11px] font-semibold">Round {m.round}</span>}
      </div>
      <div className="flex-1 min-h-0 flex items-stretch gap-4 p-4">
        <div className="flex-1 flex items-center justify-center overflow-auto">
          {m.status === "waiting" ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
              <div className="text-[14px] font-semibold">{status}</div>
              <div className="text-[12px] text-slate-500 max-w-[320px]">The challenge is in your chat with {m.opp?.name}. The moment they press Play, the board opens here.</div>
            </div>
          ) : (
            <>
              {m.game === "tictactoe" && <TicTacToeBoard {...board} />}
              {m.game === "connect4" && <ConnectFourBoard {...board} />}
              {m.game === "reversi" && <ReversiBoard {...board} />}
              {m.game === "chess" && <ChessBoard {...board} />}
              {m.game === "chainreaction" && <ChainReactionBoard {...board} />}
            </>
          )}
        </div>
        <aside className="w-[220px] shrink-0 flex flex-col gap-3">
          <div className="rounded-2xl bg-white/70 dark:bg-slate-800/60 p-3 flex flex-col gap-2">
            {([0, 1] as const).map((s) => {
              const name = games.seatName(m, s);
              const isOpp = m.opp && s !== games.myIndex(m);
              return (
                <div key={s} className={`flex items-center gap-2 rounded-xl px-2 py-1.5 ${m.status === "playing" && turn === s ? "bg-indigo-500/10 ring-1 ring-indigo-500/40" : ""}`} data-game-seat={s}>
                  {isOpp && m.opp ? <Avatar name={m.opp.name} color={m.opp.color || "#6366f1"} size={28} /> : <span className="h-7 w-7 rounded-full bg-slate-500/15 flex items-center justify-center text-[12px] font-bold">{s + 1}</span>}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-semibold text-slate-900 dark:text-white">{name}</div>
                    <div className="text-[10.5px] text-slate-500">{SEAT_LABEL[m.game][s]}{s === 0 ? " · starts" : ""}</div>
                  </div>
                  {m.status === "playing" && turn === s && <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-300">to move</span>}
                  {m.result && !m.result.draw && m.result.winner === s && <Trophy className="h-4 w-4 text-amber-500" />}
                </div>
              );
            })}
          </div>
          <div data-game-status className={`rounded-2xl px-3 py-2 text-[13px] font-semibold ${m.status === "over" ? "bg-amber-500/15 text-amber-800 dark:text-amber-200" : canPlay && m.status === "playing" ? "bg-indigo-600 text-white" : "bg-white/70 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200"}`}>
            {status}
          </div>
          {m.error && (
            <div data-game-error className="rounded-2xl bg-rose-500/10 px-3 py-2 text-[12px] text-rose-700 dark:text-rose-300">
              {m.error}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {m.status === "playing" && m.moves.length > 0 && (
              sure ? (
                <button type="button" data-game-resign-sure onClick={() => void games.resign(m.id)} className={`${btn} bg-rose-600 text-white hover:bg-rose-700`}>
                  <Flag className="h-3.5 w-3.5" /> Yes, resign
                </button>
              ) : (
                <button type="button" data-game-resign onClick={() => setSure(true)} className={`${btn} bg-slate-500/10 text-slate-700 dark:text-slate-200`}>
                  <Flag className="h-3.5 w-3.5" /> Resign
                </button>
              )
            )}
            {m.status === "over" && (
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
                <LogOut className="h-3.5 w-3.5" /> {m.status === "waiting" ? "Cancel challenge" : "Clear"}
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
