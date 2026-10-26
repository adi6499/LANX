// LANX 2.9.0: games — the hidden "/game" tool. Tic-tac-toe, Connect Four,
// Reversi and chess against a colleague over the office network (or two
// people at one PC), Chain Reaction for any number of colleagues (2.10.0),
// plus 2048, Snake and Minesweeper to play alone.
//
// A match lives here, outside the panel, so closing the games window never
// loses a game. The challenge goes out as a "game" card in the chat; every
// step after that is a `send_game` call, which the other PC hands to
// `receive()` through the `lanx://game` event. Only the list of moves travels
// (never a position); every PC replays it with the same rules in
// gameRules.ts (loaded on demand).
//
// Three kinds of match:
//   duo   — two colleagues, each PC talks straight to the other (2.9.0).
//   multi — several colleagues: the one who challenged is the host; the
//           others send their steps to the host, which keeps the one true
//           move list and sends the whole state back to everyone (2.10.0).
//   local — pass & play at this PC.

import { api, errorText } from "./api";
import type { Message, Peer } from "../types";

export type GameId = "tictactoe" | "connect4" | "reversi" | "chess" | "chainreaction";
export type SoloId = "2048" | "snake" | "mines";

export interface GameMeta {
  id: GameId | SoloId;
  name: string;
  blurb: string;
  players: 1 | 2;
  /** How many may sit at the board (2 for the classic two-player games). */
  maxPlayers: number;
  emoji: string;
}

export const GAMES: GameMeta[] = [
  { id: "tictactoe", name: "Tic-tac-toe", blurb: "Three in a row. Over in a minute.", players: 2, maxPlayers: 2, emoji: "❌" },
  { id: "connect4", name: "Connect Four", blurb: "Drop discs, line up four.", players: 2, maxPlayers: 2, emoji: "🔴" },
  { id: "reversi", name: "Reversi", blurb: "Flip the board to your colour.", players: 2, maxPlayers: 2, emoji: "⚫" },
  { id: "chess", name: "Chess", blurb: "The real thing, full rules.", players: 2, maxPlayers: 2, emoji: "♞" },
  { id: "chainreaction", name: "Chain Reaction", blurb: "Any number of players. Fill cells with orbs; explode across the board.", players: 2, maxPlayers: 32, emoji: "💥" },
  { id: "2048", name: "2048", blurb: "Slide and merge the tiles.", players: 1, maxPlayers: 1, emoji: "🔢" },
  { id: "snake", name: "Snake", blurb: "Eat, grow, don't bite yourself.", players: 1, maxPlayers: 1, emoji: "🐍" },
  { id: "mines", name: "Minesweeper", blurb: "Clear the field. Mind the mines.", players: 1, maxPlayers: 1, emoji: "💣" },
];

export const LAN_GAMES: GameId[] = ["tictactoe", "connect4", "reversi", "chess", "chainreaction"];
export const isLanGame = (id: string): id is GameId => (LAN_GAMES as string[]).includes(id);
export const gameMeta = (id: string): GameMeta | undefined => GAMES.find((g) => g.id === id);
export const gameName = (id: string): string => gameMeta(id)?.name ?? "Game";

/** "/game chess" → the game whose name or id starts with the word. */
export function findGame(query: string): GameMeta | undefined {
  const q = query.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!q) return undefined;
  return GAMES.find((g) => g.id.replace(/[^a-z0-9]/g, "").startsWith(q) || g.name.toLowerCase().replace(/[^a-z0-9]/g, "").startsWith(q));
}

/** Seat colours: the first twelve are picked by hand, after that a spread of hues. */
const SEAT_COLOURS = ["#f43f5e", "#0ea5e9", "#10b981", "#f59e0b", "#8b5cf6", "#f97316", "#14b8a6", "#ec4899", "#84cc16", "#6366f1", "#06b6d4", "#d946ef"];
export const seatColour = (i: number): string => SEAT_COLOURS[i] ?? `hsl(${(i * 47) % 360} 80% 55%)`;

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

/** The challenge card in a chat. `players`/`names` (2.10.0) list the whole table when there are more than two. */
export interface GameCardData {
  kind: "game";
  id: string;
  game: GameId;
  to: string;
  to_name: string;
  from_name: string;
  players?: string[];
  names?: string[];
}

/** A place at the board, in turn order. Pass & play seats have ids "local:<k>". */
export interface Seat {
  id: string;
  name: string;
  color: string;
}

export interface MatchResult {
  /** The winning seat, or null for a draw. */
  winner: number | null;
  draw: boolean;
  reason: string;
}

export interface Match {
  id: string;
  game: GameId;
  mode: "duo" | "multi" | "local";
  /** Everyone at the board, in turn order; the host (challenger) sits first. */
  seats: Seat[];
  /** The host's device id ("" for pass & play). */
  host: string;
  round: number;
  /** lobby: the host is collecting players (multi); waiting: the challenge is unanswered (duo). */
  status: "lobby" | "waiting" | "playing" | "over" | "declined" | "left";
  moves: string[];
  /** Player number to move: 0 = the one who moved first this round. */
  turn: number;
  result: MatchResult | null;
  /** multi: who has pressed Play (the host included). */
  joined: string[];
  /** multi: who left the table for good. */
  gone: string[];
  /** An extra line under the status ("The game started without you."). */
  note: string;
  lastAt: number;
  /** Something happened while the games window was closed. */
  unseen: boolean;
  /** The last step could not be delivered (plain words). */
  error: string | null;
}

// ---------------------------------------------------------------- who am I

let me = "";
let myName = "";
/** The app tells the store who this PC is (device id and display name). */
export const setMe = (id: string, name: string) => {
  me = id;
  myName = name;
};

// ---------------------------------------------------------------- the store

const matches = new Map<string, Match>();
/** Matches this PC ended as host: late steps for them are ignored. */
const ended = new Set<string>();
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
export const liveMatches = () => allMatches().filter((m) => m.status === "waiting" || m.status === "lobby" || m.status === "playing");

// ---------------------------------------------------------------- seats and turns

export const seatCount = (m: Match) => m.seats.length;
/** The seat that moves first this round: the host in round 1, then the next seat each round. */
export const starterSeat = (m: Match) => (m.round - 1) % Math.max(1, m.seats.length);
/** Player number (0 = starter) → seat, and back. */
export const seatOf = (m: Match, player: number) => (starterSeat(m) + player) % Math.max(1, m.seats.length);
export const playerOf = (m: Match, seat: number) => (seat - starterSeat(m) + m.seats.length) % Math.max(1, m.seats.length);
export const mySeat = (m: Match) => (m.mode === "local" ? -1 : m.seats.findIndex((s) => s.id === me));
export const turnSeat = (m: Match) => seatOf(m, m.turn);
export const myTurn = (m: Match) => m.status === "playing" && (m.mode === "local" || turnSeat(m) === mySeat(m));
export const isHost = (m: Match) => m.mode === "local" || m.host === me;
/** The colleague on the other side of a two-player match. */
export const opponent = (m: Match): Seat | null => (m.mode === "duo" ? (m.seats.find((s) => s.id !== me) ?? null) : null);

/** "You" / the colleague's name / "Player 2". */
export function seatName(m: Match, seat: number): string {
  const s = m.seats[seat];
  if (!s) return "Someone";
  if (m.mode === "local") return s.name;
  return s.id === me ? "You" : s.name;
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
/** Read through a call so a status that `settle` changed is seen afresh. */
const isOver = (m: Match) => m.status === "over";

let nudge: ((text: string, match: Match) => void) | null = null;
/** The app shows a small note when a step arrives while the games window is closed. */
export const onNudge = (fn: ((text: string, match: Match) => void) | null) => {
  nudge = fn;
};

function make(p: Partial<Match> & Pick<Match, "id" | "game" | "mode" | "seats" | "host" | "status">): Match {
  const m: Match = {
    round: 1,
    moves: [],
    turn: 0,
    result: null,
    joined: [],
    gone: [],
    note: "",
    lastAt: Date.now(),
    unseen: false,
    error: null,
    ...p,
  };
  matches.set(m.id, m);
  bump();
  return m;
}

const mySeatEntry = (i: number): Seat => ({ id: me, name: myName || "You", color: seatColour(i) });
const peerSeat = (p: Peer, i: number): Seat => ({ id: p.id, name: p.display_name, color: seatColour(i) });

// ---------------------------------------------------------------- starting a match

/** A challenge to one colleague: the match (waiting) and the card to post in the chat. */
export function challenge(game: GameId, peer: Peer): { match: Match; card: GameCardData } {
  const m = make({ id: newId(), game, mode: "duo", seats: [mySeatEntry(0), peerSeat(peer, 1)], host: me, status: "waiting", joined: [me] });
  return { match: m, card: { kind: "game", id: m.id, game, to: peer.id, to_name: peer.display_name, from_name: myName } };
}

/** A table for several colleagues: one card per colleague, all naming the whole table. */
export function challengeMany(game: GameId, peers: Peer[]): { match: Match; cards: { peerId: string; card: GameCardData }[] } {
  const seats = [mySeatEntry(0), ...peers.map((p, i) => peerSeat(p, i + 1))];
  const m = make({ id: newId(), game, mode: "multi", seats, host: me, status: "lobby", joined: [me] });
  const players = seats.map((s) => s.id);
  const names = seats.map((s) => s.name);
  return {
    match: m,
    cards: peers.map((p) => ({ peerId: p.id, card: { kind: "game", id: m.id, game, to: p.id, to_name: p.display_name, from_name: myName, players, names } })),
  };
}

/** Pass & play at this PC, `count` people taking turns. */
export function localMatch(game: GameId, count = 2): Match {
  const n = Math.max(2, Math.min(count, gameMeta(game)?.maxPlayers ?? 2));
  const seats = Array.from({ length: n }, (_, i) => ({ id: `local:${i}`, name: `Player ${i + 1}`, color: seatColour(i) }));
  return make({ id: newId(), game, mode: "local", seats, host: "", status: "playing" });
}

/** "Play" on a challenge card. The invited side joins (and tells the host); the challenger just opens the match. */
export async function openFromCard(card: GameCardData, msg: Message, peers: Peer[]): Promise<Match> {
  let m = matches.get(card.id);
  const invited = card.to === me;
  const table = card.players && card.players.length > 2 ? card.players : null;
  const host = msg.is_outgoing ? me : msg.sender_id;
  if (!m) {
    if (table) {
      const names = card.names ?? [];
      const seats = table.map((id, i) => ({ id, name: id === me ? myName || "You" : (peers.find((p) => p.id === id)?.display_name ?? names[i] ?? "Colleague"), color: seatColour(i) }));
      m = make({ id: card.id, game: card.game, mode: "multi", seats, host, status: "lobby", joined: invited ? [host, me] : [me] });
    } else {
      const oppId = invited ? host : card.to;
      const peer = peers.find((p) => p.id === oppId);
      const opp: Seat = { id: oppId, name: peer?.display_name ?? (invited ? card.from_name : card.to_name) ?? "Colleague", color: "" };
      const seats = invited ? [{ ...opp, color: seatColour(0) }, mySeatEntry(1)] : [mySeatEntry(0), { ...opp, color: seatColour(1) }];
      m = make({ id: card.id, game: card.game, mode: "duo", seats, host, status: invited ? "playing" : "waiting", joined: [host] });
    }
  }
  if (invited && m.mode === "multi" && (m.status === "lobby" || m.status === "playing")) await sendTo(m.host, m, "accept", null);
  if (invited && m.mode === "duo" && m.moves.length === 0 && m.round === 1 && m.status === "playing") await sendTo(m.host, m, "accept", null);
  return m;
}

// ---------------------------------------------------------------- sending

async function sendTo(peerId: string, m: Match, action: GameAction, data: unknown): Promise<boolean> {
  try {
    await api.sendGame(peerId, { match_id: m.id, game: m.game, action, seq: m.moves.length, data, at: 0 });
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

const stateData = (m: Match) => ({ moves: m.moves, seats: m.seats.map((s) => ({ id: s.id, name: s.name })), round: m.round, status: m.status, joined: m.joined });

/** The host tells everyone at the table how things stand. */
async function broadcast(m: Match) {
  const ids = m.seats.filter((s) => s.id !== me && !m.gone.includes(s.id) && (m.status !== "lobby" || m.joined.includes(s.id))).map((s) => s.id);
  await Promise.all(ids.map((id) => sendTo(id, m, "state", stateData(m))));
}

/** Works out whose turn it is and whether the game is over; records the score when it ends. */
async function settle(m: Match) {
  const rules = await import("./gameRules");
  const n = m.seats.length;
  m.turn = rules.turnOf(m.game, m.moves, n);
  const end = rules.outcome(m.game, m.moves, n);
  if (end.over && m.status === "playing") {
    m.status = "over";
    m.result = { winner: end.winner === null ? null : seatOf(m, end.winner), draw: end.draw, reason: end.reason };
    void recordResult(m);
  }
}

async function appendValid(m: Match, move: string): Promise<boolean> {
  const rules = await import("./gameRules");
  const next = [...m.moves, move];
  if (!rules.validateMoves(m.game, next, m.seats.length)) return false;
  m.moves = next;
  m.lastAt = Date.now();
  await settle(m);
  return true;
}

// ---------------------------------------------------------------- what you do

/** Your move. Returns a plain-words problem, or null when it went through. */
export async function play(id: string, move: string): Promise<string | null> {
  const m = matches.get(id);
  if (!m || m.status !== "playing") return "This game is over.";
  if (!myTurn(m)) return `Wait for ${seatName(m, turnSeat(m))}'s move.`;
  if (!(await appendValid(m, move))) return "That move isn't allowed.";
  bump();
  if (m.mode === "duo") void sendTo(opponent(m)!.id, m, "move", { moves: m.moves, round: m.round });
  else if (m.mode === "multi") {
    if (isHost(m)) void broadcast(m);
    else void sendTo(m.host, m, "move", { cell: move });
  }
  return null;
}

/** Give up (in Chain Reaction with several players the others play on). */
export async function resign(id: string) {
  const m = matches.get(id);
  if (!m || m.status !== "playing") return;
  if (m.mode === "duo") {
    m.status = "over";
    m.result = { winner: playerOf(m, mySeat(m)) === 0 ? seatOf(m, 1) : seatOf(m, 0), draw: false, reason: "you resigned" };
    m.lastAt = Date.now();
    void recordResult(m);
    bump();
    await sendTo(opponent(m)!.id, m, "resign", { round: m.round });
    return;
  }
  if (m.mode === "local") {
    if (m.game === "chainreaction") await appendValid(m, `x${m.turn}`);
    else {
      m.status = "over";
      m.result = { winner: seatOf(m, 1 - m.turn), draw: false, reason: `${seatName(m, turnSeat(m))} resigned` };
      void recordResult(m);
    }
    bump();
    return;
  }
  // multi
  const seat = mySeat(m);
  if (seat < 0) return;
  await appendValid(m, `x${playerOf(m, seat)}`);
  bump();
  if (isHost(m)) await broadcast(m);
  else await sendTo(m.host, m, "resign", null);
}

/** Another round: the next seat starts this time. (multi: the host decides.) */
export async function rematch(id: string) {
  const m = matches.get(id);
  if (!m || (m.status !== "over" && m.status !== "playing")) return;
  if (m.mode === "multi") {
    if (!isHost(m)) return;
    m.seats = m.seats.filter((s) => !m.gone.includes(s.id));
    if (m.seats.length < 2) return;
  }
  m.round += 1;
  m.moves = [];
  m.turn = 0;
  m.result = null;
  m.status = "playing";
  m.lastAt = Date.now();
  bump();
  if (m.mode === "duo") await sendTo(opponent(m)!.id, m, "rematch", { round: m.round });
  else if (m.mode === "multi") await broadcast(m);
}

/** The host starts a multi-player game with whoever has joined. */
export async function startNow(id: string): Promise<string | null> {
  const m = matches.get(id);
  if (!m || m.mode !== "multi" || !isHost(m) || m.status !== "lobby") return "Not a table you host.";
  const seats = m.seats.filter((s) => m.joined.includes(s.id) && !m.gone.includes(s.id));
  if (seats.length < 2) return "Nobody has joined yet — they press Play on the card in their chat.";
  m.seats = seats;
  m.status = "playing";
  m.moves = [];
  m.turn = 0;
  m.result = null;
  m.lastAt = Date.now();
  bump();
  await broadcast(m);
  return null;
}

/** Leave the match for good (the others are told). */
export async function leave(id: string) {
  const m = matches.get(id);
  if (!m) return;
  matches.delete(id);
  bump();
  if (m.mode === "duo") {
    if (m.status === "playing" || m.status === "waiting") await sendTo(opponent(m)!.id, m, "leave", null);
  } else if (m.mode === "multi") {
    if (isHost(m)) {
      ended.add(m.id);
      const ids = m.seats.filter((s) => s.id !== me && !m.gone.includes(s.id)).map((s) => s.id);
      await Promise.all(ids.map((pid) => sendTo(pid, m, "leave", null)));
    } else if (m.status === "lobby" || m.status === "playing") {
      await sendTo(m.host, m, "leave", null);
    }
  }
}

export async function decline(card: GameCardData, msg: Message) {
  if (card.to !== me) return;
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

// ---------------------------------------------------------------- steps from colleagues

type Data = { moves?: unknown; round?: unknown; cell?: unknown; seats?: unknown; status?: unknown; joined?: unknown };

/** A step from a colleague (the `lanx://game` event). */
export function receive(e: GameEvent) {
  void receiveAsync(e);
}

async function receiveAsync(e: GameEvent) {
  if (!isLanGame(e.game) || ended.has(e.match_id)) return;
  const d = (e.data && typeof e.data === "object" ? e.data : {}) as Data;
  let m = matches.get(e.match_id);
  if (!m) {
    if (e.action === "state" && Array.isArray(d.seats)) {
      // A table this PC doesn't know (LANX restarted?): rebuild it from the host's state.
      m = make({ id: e.match_id, game: e.game, mode: "multi", seats: [], host: e.from_id, status: "lobby", unseen: true });
    } else if ((e.action === "accept" || e.action === "move") && !Array.isArray(d.seats) && d.cell === undefined) {
      // A two-player match this PC doesn't know: rebuild it from the step.
      const other: Seat = { id: e.from_id, name: e.from_name, color: "" };
      const iHost = e.action === "accept";
      m = make({
        id: e.match_id,
        game: e.game,
        mode: "duo",
        seats: iHost ? [mySeatEntry(0), { ...other, color: seatColour(1) }] : [{ ...other, color: seatColour(0) }, mySeatEntry(1)],
        host: iHost ? me : e.from_id,
        status: "playing",
        unseen: true,
      });
    } else return;
  }
  if (m.mode === "multi") {
    if (isHost(m)) await hostStep(m, e, d);
    else await guestStep(m, e, d);
    return;
  }
  if (m.mode !== "duo") return;
  await duoStep(m, e, d);
}

/** Two players, straight to each other. */
async function duoStep(m: Match, e: GameEvent, d: Data) {
  const opp = opponent(m);
  if (!opp || opp.id !== e.from_id) return; // only the other player's steps count
  const round = typeof d.round === "number" && Number.isInteger(d.round) ? d.round : null;
  const who = opp.name;
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
        m.result = { winner: mySeat(m), draw: false, reason: `${who} resigned` };
        void recordResult(m);
        note = `${who} resigned — you won at ${game}.`;
      }
      break;
    case "rematch":
      if (round !== null && round > m.round) {
        m.round = round;
        m.moves = [];
        m.turn = 0;
        m.result = null;
        m.status = "playing";
        note = `${who} wants another round of ${game}.`;
      }
      break;
    case "move":
    case "state": {
      const mv = Array.isArray(d.moves) ? d.moves.map(String) : null;
      if (!mv) return;
      if (round !== null && round > m.round) {
        m.round = round;
        m.moves = [];
        m.turn = 0;
        m.result = null;
        m.status = "playing";
      }
      if (round !== null && round < m.round) return; // an old round's move
      if (m.status === "waiting") m.status = "playing";
      if (m.status !== "playing" || mv.length <= m.moves.length) return;
      const rules = await import("./gameRules");
      if (!rules.validateMoves(m.game, mv, 2)) return;
      m.moves = mv;
      await settle(m);
      note = isOver(m) ? `${game} vs ${who}: ${resultText(m)}` : `${who} played — your move in ${game}.`;
      break;
    }
    default:
      return;
  }
  m.lastAt = Date.now();
  m.unseen = true;
  bump();
  if (note) nudge?.(note, m);
}

/** The host of a table: takes the players' steps and sends everyone the state. */
async function hostStep(m: Match, e: GameEvent, d: Data) {
  const seat = m.seats.findIndex((s) => s.id === e.from_id);
  if (seat < 0) return; // not at this table
  const who = m.seats[seat].name;
  const game = gameName(m.game);
  let note = "";
  switch (e.action) {
    case "accept":
      if (m.status === "lobby") {
        if (!m.joined.includes(e.from_id)) {
          m.joined.push(e.from_id);
          note = `${who} joined your ${game} table (${m.joined.length} in).`;
        }
        m.gone = m.gone.filter((id) => id !== e.from_id);
        await broadcast(m);
      } else {
        await sendTo(e.from_id, m, "state", stateData(m)); // started already: they see it
      }
      break;
    case "decline":
    case "leave":
      if (m.status === "lobby") {
        m.joined = m.joined.filter((id) => id !== e.from_id);
        if (!m.gone.includes(e.from_id)) m.gone.push(e.from_id);
        note = `${who} is not joining the ${game} table.`;
        await broadcast(m);
      } else if (m.status === "playing") {
        await appendValid(m, `x${playerOf(m, seat)}`);
        if (!m.gone.includes(e.from_id)) m.gone.push(e.from_id);
        note = `${who} left the ${game} game.`;
        await broadcast(m);
      }
      break;
    case "resign":
      if (m.status === "playing") {
        await appendValid(m, `x${playerOf(m, seat)}`);
        note = `${who} is out of the ${game} game.`;
        await broadcast(m);
      }
      break;
    case "move": {
      if (m.status !== "playing" || turnSeat(m) !== seat || d.cell === undefined) {
        await sendTo(e.from_id, m, "state", stateData(m)); // put their board right
        return;
      }
      const ok = await appendValid(m, String(d.cell));
      if (!ok) {
        await sendTo(e.from_id, m, "state", stateData(m));
        return;
      }
      note = isOver(m) ? `${game}: ${resultText(m)}` : myTurn(m) ? `${who} played — your move in ${game}.` : "";
      await broadcast(m);
      break;
    }
    default:
      return;
  }
  m.lastAt = Date.now();
  m.unseen = true;
  bump();
  if (note) nudge?.(note, m);
}

/** A player at someone else's table: the host's state is the truth. */
async function guestStep(m: Match, e: GameEvent, d: Data) {
  if (e.from_id !== m.host) return;
  const game = gameName(m.game);
  let note = "";
  if (e.action === "leave") {
    if (m.status === "lobby" || m.status === "playing") {
      m.status = "left";
      m.note = `${e.from_name} closed the table.`;
      note = `${e.from_name} closed the ${game} table.`;
    }
  } else if (e.action === "state") {
    const seatsIn = Array.isArray(d.seats) ? (d.seats as { id?: unknown; name?: unknown }[]) : null;
    if (!seatsIn) return;
    const seats: Seat[] = seatsIn.map((s, i) => ({ id: String(s.id ?? ""), name: String(s.id) === me ? myName || "You" : String(s.name ?? "Colleague"), color: seatColour(i) }));
    const moves = Array.isArray(d.moves) ? d.moves.map(String) : [];
    const round = typeof d.round === "number" && Number.isInteger(d.round) ? d.round : m.round;
    const status = d.status === "lobby" ? "lobby" : "playing";
    const joined = Array.isArray(d.joined) ? d.joined.map(String) : m.joined;
    const rules = await import("./gameRules");
    if (!rules.validateMoves(m.game, moves, seats.length)) return;
    if (status === "playing" && !seats.some((s) => s.id === me)) {
      m.status = "declined";
      m.note = "The game started without you.";
      note = `The ${game} table started without you.`;
    } else {
      const wasLobby = m.status === "lobby";
      const had = m.round === round ? m.moves.length : -1;
      m.seats = seats;
      m.moves = moves;
      m.round = round;
      m.joined = joined;
      m.status = status;
      m.result = null;
      m.note = "";
      await settle(m);
      if (isOver(m)) note = `${game}: ${resultText(m)}`;
      else if (wasLobby && status === "playing") note = `${e.from_name} started the ${game} game${myTurn(m) ? " — your move!" : "."}`;
      else if (moves.length > had && myTurn(m)) note = `Your move in ${game}.`;
    }
  } else return;
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
  if (m.mode === "local" || !m.result) return;
  const seat = mySeat(m);
  if (seat < 0) return;
  const s = await loadStats();
  const g = (s[m.game] ??= fresh());
  g.played += 1;
  if (m.result.draw) g.drawn += 1;
  else if (m.result.winner === seat) g.won += 1;
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
