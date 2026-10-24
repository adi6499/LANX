// LANX 2.9.0: games — the hidden "/game" tool. Tic-tac-toe, Connect Four,
// Reversi and chess against a colleague over the office network (or two
// people at one PC), plus 2048, Snake and Minesweeper to play alone.
//
// A match lives here, outside the panel, so closing the games window never
// loses a game. The challenge goes out as a "game" card in the chat; every
// step after that (accept, move, resign, rematch) is a `send_game` call to
// the other PC, which hands it to `receive()` through the `lanx://game` event.
// Only the list of moves travels (never a position), and both sides replay
// it with the same rules in gameRules.ts, which is loaded on demand.

import { api, errorText } from "./api";
import type { Message, Peer } from "../types";

export type GameId = "tictactoe" | "connect4" | "reversi" | "chess";
export type SoloId = "2048" | "snake" | "mines";

export interface GameMeta {
  id: GameId | SoloId;
  name: string;
  blurb: string;
  players: 1 | 2;
  emoji: string;
}

export const GAMES: GameMeta[] = [
  { id: "tictactoe", name: "Tic-tac-toe", blurb: "Three in a row. Over in a minute.", players: 2, emoji: "❌" },
  { id: "connect4", name: "Connect Four", blurb: "Drop discs, line up four.", players: 2, emoji: "🔴" },
  { id: "reversi", name: "Reversi", blurb: "Flip the board to your colour.", players: 2, emoji: "⚫" },
  { id: "chess", name: "Chess", blurb: "The real thing, full rules.", players: 2, emoji: "♞" },
  { id: "2048", name: "2048", blurb: "Slide and merge the tiles.", players: 1, emoji: "🔢" },
  { id: "snake", name: "Snake", blurb: "Eat, grow, don't bite yourself.", players: 1, emoji: "🐍" },
  { id: "mines", name: "Minesweeper", blurb: "Clear the field. Mind the mines.", players: 1, emoji: "💣" },
];

export const LAN_GAMES: GameId[] = ["tictactoe", "connect4", "reversi", "chess"];
export const isLanGame = (id: string): id is GameId => (LAN_GAMES as string[]).includes(id);
export const gameMeta = (id: string): GameMeta | undefined => GAMES.find((g) => g.id === id);
export const gameName = (id: string): string => gameMeta(id)?.name ?? "Game";

/** "/game chess" → the game whose name or id starts with the word. */
export function findGame(query: string): GameMeta | undefined {
  const q = query.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!q) return undefined;
  return GAMES.find((g) => g.id.replace(/[^a-z0-9]/g, "").startsWith(q) || g.name.toLowerCase().replace(/[^a-z0-9]/g, "").startsWith(q));
}

export type GameAction = "accept" | "decline" | "move" | "resign" | "rematch" | "leave" | "state";

/** One step of a match, as it travels between two PCs. */
export interface GameStep {
  match_id: string;
  game: GameId;
  action: GameAction;
  seq: number;
  data: unknown;
  at: number;
}

/** A step that arrived from a colleague (the `lanx://game` event). */
export interface GameEvent extends GameStep {
  from_id: string;
  from_name: string;
}

/** The challenge card in a chat. */
export interface GameCardData {
  kind: "game";
  id: string;
  game: GameId;
  to: string;
  to_name: string;
  from_name: string;
}

export interface Opponent {
  id: string;
  name: string;
  color: string;
}

export interface MatchResult {
  /** 0 = the player who moved first this round, 1 = the other, null for a draw. */
  winner: 0 | 1 | null;
  draw: boolean;
  reason: string;
}

export interface Match {
  id: string;
  game: GameId;
  /** The colleague on the other side; null for pass-and-play at this PC. */
  opp: Opponent | null;
  /** True when this PC sent the challenge (it moves first in round 1). */
  mine: boolean;
  round: number;
  status: "waiting" | "playing" | "over" | "declined" | "left";
  moves: string[];
  result: MatchResult | null;
  lastAt: number;
  /** Something happened while the games window was closed. */
  unseen: boolean;
  /** The last step could not be delivered (plain words). */
  error: string | null;
}

// ---------------------------------------------------------------- the store

const matches = new Map<string, Match>();
const subs = new Set<() => void>();
let version = 0;

export const subscribe = (fn: () => void) => {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
};
export const snapshot = () => version;
const bump = () => {
  version++;
  for (const fn of subs) fn();
};

export const getMatch = (id: string) => matches.get(id);
export const allMatches = () => [...matches.values()].sort((a, b) => b.lastAt - a.lastAt);
export const liveMatches = () => allMatches().filter((m) => m.status === "waiting" || m.status === "playing");

/** Who starts this round: the challenger in odd rounds, the other player in even ones. */
export const iStart = (m: Match) => m.mine === (m.round % 2 === 1);
/** My seat this round (0 moves first). Pass-and-play has no "me": whoever's turn it is. */
export const myIndex = (m: Match): 0 | 1 => (iStart(m) ? 0 : 1);
export const turnIndex = (m: Match): 0 | 1 => (m.moves.length % 2) as 0 | 1;
export const myTurn = (m: Match) => m.status === "playing" && (!m.opp || turnIndex(m) === myIndex(m));

/** "You" / the colleague's name / "Player 1" for a seat. */
export function seatName(m: Match, seat: 0 | 1): string {
  if (!m.opp) return seat === 0 ? "Player 1" : "Player 2";
  return seat === myIndex(m) ? "You" : m.opp.name;
}

export function resultText(m: Match): string {
  const r = m.result;
  if (!r) return "";
  if (r.draw) return `Draw — ${r.reason}`;
  if (r.winner === null) return r.reason;
  const who = seatName(m, r.winner);
  return `${who === "You" ? "You won" : `${who} won`} — ${r.reason}`;
}

const newId = () => `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

let nudge: ((text: string, match: Match) => void) | null = null;
/** The app shows a small note when a step arrives while the games window is closed. */
export const onNudge = (fn: ((text: string, match: Match) => void) | null) => {
  nudge = fn;
};

// ---------------------------------------------------------------- starting a match

/** A challenge to a colleague: the match (waiting) and the card to post in the chat. */
export function challenge(game: GameId, peer: Peer, myName: string): { match: Match; card: GameCardData } {
  const m: Match = {
    id: newId(),
    game,
    opp: { id: peer.id, name: peer.display_name, color: peer.avatar_color },
    mine: true,
    round: 1,
    status: "waiting",
    moves: [],
    result: null,
    lastAt: Date.now(),
    unseen: false,
    error: null,
  };
  matches.set(m.id, m);
  bump();
  return { match: m, card: { kind: "game", id: m.id, game, to: peer.id, to_name: peer.display_name, from_name: myName } };
}

/** Two people at this PC. */
export function localMatch(game: GameId): Match {
  const m: Match = { id: newId(), game, opp: null, mine: true, round: 1, status: "playing", moves: [], result: null, lastAt: Date.now(), unseen: false, error: null };
  matches.set(m.id, m);
  bump();
  return m;
}

/** "Play" on a challenge card: the invited side accepts (and tells the challenger);
 *  the challenger just opens the match. */
export async function openFromCard(card: GameCardData, msg: Message, myId: string, peers: Peer[]): Promise<Match> {
  let m = matches.get(card.id);
  const invited = card.to === myId;
  if (!m) {
    const oppId = invited ? msg.sender_id : card.to;
    const peer = peers.find((p) => p.id === oppId);
    m = {
      id: card.id,
      game: card.game,
      opp: { id: oppId, name: peer?.display_name ?? (invited ? card.from_name : card.to_name) ?? "Colleague", color: peer?.avatar_color ?? "" },
      mine: !invited,
      round: 1,
      status: invited ? "playing" : "waiting",
      moves: [],
      result: null,
      lastAt: Date.now(),
      unseen: false,
      error: null,
    };
    matches.set(m.id, m);
    bump();
  }
  if (invited && m.moves.length === 0 && m.round === 1 && m.status === "playing") await send(m, "accept", null);
  return m;
}

// ---------------------------------------------------------------- steps

async function send(m: Match, action: GameAction, data: unknown): Promise<boolean> {
  if (!m.opp) return true;
  try {
    await api.sendGame(m.opp.id, { match_id: m.id, game: m.game, action, seq: m.moves.length, data, at: 0 });
    if (m.error) {
      m.error = null;
      bump();
    }
    return true;
  } catch (e) {
    m.error = errorText(e);
    bump();
    return false;
  }
}

async function settle(m: Match) {
  const rules = await import("./gameRules");
  const end = rules.outcome(m.game, m.moves);
  if (end.over && m.status === "playing") {
    m.status = "over";
    m.result = { winner: end.winner, draw: end.draw, reason: end.reason };
    void recordResult(m);
  }
}

/** Your move. Returns a plain-words problem, or null when it went through. */
export async function play(id: string, move: string): Promise<string | null> {
  const m = matches.get(id);
  if (!m || m.status !== "playing") return "This game is over.";
  if (m.opp && turnIndex(m) !== myIndex(m)) return `Wait for ${m.opp.name}'s move.`;
  const rules = await import("./gameRules");
  const next = [...m.moves, move];
  if (!rules.validateMoves(m.game, next)) return "That move isn't allowed.";
  m.moves = next;
  m.lastAt = Date.now();
  await settle(m);
  bump();
  void send(m, "move", { moves: m.moves, round: m.round });
  return null;
}

export async function resign(id: string) {
  const m = matches.get(id);
  if (!m || m.status !== "playing") return;
  m.status = "over";
  m.result = { winner: m.opp ? ((1 - myIndex(m)) as 0 | 1) : ((1 - turnIndex(m)) as 0 | 1), draw: false, reason: m.opp ? "you resigned" : `${seatName(m, turnIndex(m))} resigned` };
  m.lastAt = Date.now();
  void recordResult(m);
  bump();
  await send(m, "resign", { round: m.round });
}

/** Another round: the other player starts this time. */
export async function rematch(id: string) {
  const m = matches.get(id);
  if (!m || (m.status !== "over" && m.status !== "playing")) return;
  m.round += 1;
  m.moves = [];
  m.result = null;
  m.status = "playing";
  m.lastAt = Date.now();
  bump();
  await send(m, "rematch", { round: m.round });
}

/** Leave the match for good (the other side is told). */
export async function leave(id: string) {
  const m = matches.get(id);
  if (!m) return;
  const tell = m.opp && (m.status === "playing" || m.status === "waiting");
  matches.delete(id);
  bump();
  if (tell) await send(m, "leave", null);
}

export async function decline(card: GameCardData, msg: Message, myId: string) {
  if (card.to !== myId) return;
  try {
    await api.sendGame(msg.sender_id, { match_id: card.id, game: card.game, action: "decline", seq: 0, data: null, at: 0 });
  } catch {
    /* they will see no accept */
  }
}

export function markSeen(id: string) {
  const m = matches.get(id);
  if (m && m.unseen) {
    m.unseen = false;
    bump();
  }
}

/** A step from a colleague (the `lanx://game` event). */
export function receive(e: GameEvent) {
  if (!isLanGame(e.game)) return;
  let m = matches.get(e.match_id);
  if (!m) {
    if (e.action === "leave" || e.action === "decline") return;
    // A match this PC doesn't know (LANX was restarted?): rebuild it from the step.
    m = {
      id: e.match_id,
      game: e.game,
      opp: { id: e.from_id, name: e.from_name, color: "" },
      mine: e.action === "accept",
      round: 1,
      status: "playing",
      moves: [],
      result: null,
      lastAt: Date.now(),
      unseen: true,
      error: null,
    };
    matches.set(m.id, m);
  }
  if (!m.opp || m.opp.id !== e.from_id) return; // only the other player's steps count
  const d = (e.data && typeof e.data === "object" ? e.data : {}) as { moves?: unknown; round?: unknown };
  const round = typeof d.round === "number" && Number.isInteger(d.round) ? d.round : null;
  const who = m.opp.name;
  const game = gameName(m.game);
  let note = "";
  switch (e.action) {
    case "accept":
      if (m.status === "waiting") {
        m.status = "playing";
        note = `${who} accepted — ${game} is on. Your move!`;
      }
      break;
    case "decline":
      if (m.status === "waiting") {
        m.status = "declined";
        note = `${who} declined the ${game} challenge.`;
      }
      break;
    case "leave":
      if (m.status === "playing" || m.status === "waiting") {
        m.status = "left";
        note = `${who} left the ${game} game.`;
      }
      break;
    case "resign":
      if (m.status === "playing") {
        m.status = "over";
        m.result = { winner: myIndex(m), draw: false, reason: `${who} resigned` };
        void recordResult(m);
        note = `${who} resigned — you won at ${game}.`;
      }
      break;
    case "rematch":
      if (round !== null && round > m.round) {
        m.round = round;
        m.moves = [];
        m.result = null;
        m.status = "playing";
        note = `${who} wants another round of ${game}.`;
      }
      break;
    case "move":
    case "state": {
      const mv = Array.isArray(d.moves) ? d.moves.map(String) : null;
      if (!mv) break;
      if (round !== null && round > m.round) {
        m.round = round;
        m.moves = [];
        m.result = null;
        m.status = "playing";
      }
      if (round !== null && round < m.round) break; // an old round's move
      if (m.status === "waiting") m.status = "playing";
      if (m.status !== "playing" || mv.length <= m.moves.length) break;
      const target = m;
      void import("./gameRules").then(async (rules) => {
        if (!rules.validateMoves(target.game, mv) || mv.length <= target.moves.length) return;
        target.moves = mv;
        target.lastAt = Date.now();
        target.unseen = true;
        await settle(target);
        bump();
        nudge?.(target.status === "over" ? `${game} vs ${who}: ${resultText(target)}` : `${who} played — your move in ${game}.`, target);
      });
      return;
    }
    default:
      return;
  }
  m.lastAt = Date.now();
  m.unseen = true;
  bump();
  if (note) nudge?.(note, m);
}

// ---------------------------------------------------------------- scores

export interface GameStats {
  played: number;
  won: number;
  lost: number;
  drawn: number;
  best?: number;
}
export type Stats = Record<string, GameStats>;

let stats: Stats | null = null;

export async function loadStats(): Promise<Stats> {
  if (stats) return stats;
  try {
    const raw = await api.getPref("games_stats");
    const parsed = raw ? (JSON.parse(raw) as Stats) : {};
    stats = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    stats = {};
  }
  return stats;
}

async function saveStats() {
  try {
    await api.setPref("games_stats", JSON.stringify(stats ?? {}));
  } catch {
    /* the score is only a convenience */
  }
}

const fresh = (): GameStats => ({ played: 0, won: 0, lost: 0, drawn: 0 });

async function recordResult(m: Match) {
  if (!m.opp || !m.result) return;
  const s = await loadStats();
  const g = (s[m.game] ??= fresh());
  g.played += 1;
  if (m.result.draw) g.drawn += 1;
  else if (m.result.winner === myIndex(m)) g.won += 1;
  else g.lost += 1;
  await saveStats();
  bump();
}

/** A solo game finished with this score (Minesweeper counts seconds: lower is better). */
export async function recordScore(game: SoloId, score: number, lowerIsBetter = false) {
  const s = await loadStats();
  const g = (s[game] ??= fresh());
  g.played += 1;
  if (g.best === undefined || (lowerIsBetter ? score < g.best : score > g.best)) g.best = score;
  await saveStats();
  bump();
}

export const statsFor = (id: string): GameStats | undefined => stats?.[id];
