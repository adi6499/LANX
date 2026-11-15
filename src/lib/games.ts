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
import { sfx } from "./gameSounds";

/** When this run of LANX started (seconds): a challenge card older than this may belong to a game that
 *  was going on before LANX restarted, whose moves this PC no longer has (2.16.1). */
const startedAt = Date.now() / 1000;

/** A game's id ("chess", "ludo"…); the rules live in gameRules.ts or games/index.ts. */
export type GameId = string;
export type SoloId = "2048" | "snake" | "mines";

export interface GameMeta {
  id: GameId | SoloId;
  name: string;
  blurb: string;
  /** 1 = a solo game played in the browser alone; 2 = a match (two or more people). */
  players: 1 | 2;
  /** How many may sit at the board. */
  minPlayers: number;
  maxPlayers: number;
  emoji: string;
  /** Not for pass & play (hidden information). */
  noLocal?: boolean;
  /** Run through a host even with two players (timed rounds, private deals, live play). */
  hosted?: boolean;
  /** The host streams positions live (lib/gameChannel.ts) rather than everyone replaying moves. */
  realtime?: boolean;
  /** LANX 2.17.0: only these table sizes work (Cup Pong: 2, or two teams of 2). */
  sizes?: number[];
  /** Belongs to a group in the list. */
  group: "grid" | "board" | "dice" | "cards" | "party" | "shots" | "live" | "solo";
}

const g = (id: string, name: string, blurb: string, emoji: string, group: GameMeta["group"], min: number, max: number, extra: Partial<GameMeta> = {}): GameMeta => ({ id, name, blurb, players: group === "solo" ? 1 : 2, minPlayers: min, maxPlayers: max, emoji, group, ...extra });

export const GAMES: GameMeta[] = [
  // grid
  g("tictactoe", "Tic-tac-toe", "Three in a row. Over in a minute.", "❌", "grid", 2, 2),
  g("connect4", "Connect Four", "Drop discs, line up four.", "🔴", "grid", 2, 2),
  g("gomoku", "Gomoku", "Five in a row on a big open board.", "⚪", "grid", 2, 2),
  g("dots", "Dots & Boxes", "Draw lines, close boxes, keep the turn when you do.", "🔲", "grid", 2, 4),
  g("hex", "Hex", "Join your two sides of the board before they join theirs.", "⬡", "grid", 2, 2),
  g("battleship", "Sea Battle", "Hide your fleet, call the squares, sink theirs first.", "🚢", "grid", 2, 2, { noLocal: true }),
  g("minesvs", "Minesweeper Versus", "One shared field; open safe squares for points, mines cost you.", "💣", "grid", 2, 4),
  g("memory", "Memory", "Find the pairs before the others do.", "🃏", "grid", 2, 8),
  g("chainreaction", "Chain Reaction", "Any number of players. Fill cells with orbs; explode across the board.", "💥", "grid", 2, 32),
  g("paintfight", "Paint Fight", "Tap fast: paint more squares than the others in thirty seconds.", "🎨", "grid", 2, 8, { hosted: true, noLocal: true }),
  // board
  g("chess", "Chess", "The real thing, full rules.", "♞", "board", 2, 2),
  g("checkers", "Checkers", "Jump to capture; crown a king on the far row.", "🔴", "board", 2, 2),
  g("reversi", "Reversi", "Flip the board to your colour.", "⚫", "board", 2, 2),
  g("go", "Go", "Surround territory on a 9×9 board. Pass twice to finish.", "⚫", "board", 2, 2),
  g("mancala", "Mancala", "Sow seeds round the board; most in your store wins.", "🫘", "board", 2, 2),
  g("mahjong", "Mahjong Duels", "Take free matching tiles in turn; most pairs wins.", "🀄", "board", 2, 4),
  // dice
  g("ludo", "Ludo", "Four tokens round the board; a six gets you out and rolls again.", "🎲", "dice", 2, 4),
  g("snakes", "Snakes & Ladders", "Climb the ladders, dodge the snakes, hit 100 exactly — a six rolls again.", "🪜", "dice", 2, 8),
  g("bankroll", "Bankroll", "Fast property trading: buy streets, collect rent, don't go broke.", "🏦", "dice", 2, 6),
  g("backgammon", "Backgammon", "Race your checkers home on the dice; hit lone ones on the way.", "🎯", "dice", 2, 2),
  g("dominoes", "Dominoes", "Match the ends of the line; first out of tiles wins.", "🁡", "dice", 2, 4),
  // cards
  g("ocho", "Ocho", "Colours, numbers, skips and wilds — shed your hand first.", "🃏", "cards", 2, 8),
  g("crazy8", "Crazy Eights", "Match suit or rank; eights are wild. First hand out wins.", "🂸", "cards", 2, 6),
  g("holdem", "Texas Hold'em", "Bluff and bet with chips that are only points; twenty hands.", "🂮", "cards", 2, 8),
  g("spades", "Spades", "Partners across the table bid their tricks; spades always trump.", "♠️", "cards", 4, 4),
  g("hearts", "Hearts", "Avoid the hearts and the queen of spades; lowest score wins.", "♥️", "cards", 4, 4),
  g("euchre", "Euchre", "Fast partnership tricks with bowers; first team to ten.", "🃑", "cards", 4, 4),
  g("ginrummy", "Gin Rummy", "Build sets and runs; knock when your deadwood is ten or less.", "🂭", "cards", 2, 2),
  g("gofish", "Go Fish", "Ask for a rank; collect books of four.", "🐟", "cards", 2, 6),
  g("blackjack", "Blackjack 21", "Hit, stand, double or split against the house; five rounds, most points wins.", "🂡", "cards", 1, 6),
  // party
  g("drawguess", "Draw & Guess", "One draws, the rest guess — first right answer wins the round.", "✏️", "party", 3, 8, { hosted: true, noLocal: true }),
  g("trivia", "Trivia Night", "Ten questions, four options, everyone answers at once.", "❓", "party", 2, 8, { hosted: true, noLocal: true }),
  g("werewolf", "Werewolf", "Hidden roles: find the wolves by day before they eat the village by night.", "🐺", "party", 5, 12, { hosted: true, noLocal: true }),
  g("wordbox", "Wordbox", "Find words on a 4×4 letter grid against the clock.", "🔤", "party", 2, 8, { hosted: true, noLocal: true }),
  g("mathrush", "Math Rush", "Quick sums for everyone at once: a point for each right answer.", "➗", "party", 2, 8, { hosted: true, noLocal: true }),
  g("taproulette", "Tap Roulette", "Tap in before the clock runs out — miss it and you lose; if everyone\'s in, the wheel picks one loser.", "🎯", "party", 2, 8, { hosted: true, noLocal: true }),
  // aim and shoot
  g("carrom", "Carrom", "Flick the striker; pocket your nine coins and cover the queen.", "🪙", "shots", 2, 2),
  g("pool", "8-Ball Pool", "Solids or stripes, then the 8 — real angles, real bounces.", "🎱", "shots", 2, 2),
  g("cuppong", "Cup Pong", "Bounce the ball into their cups before they clear yours.", "🥤", "shots", 2, 4, { sizes: [2, 4] }),
  g("minigolf", "Mini Golf", "Nine holes; bounce off the walls and sink it in the fewest strokes.", "⛳", "shots", 1, 8),
  g("bowling", "Bowling", "Ten frames, strikes and spares; aim and power are up to you.", "🎳", "shots", 1, 8),
  g("darts", "Darts", "501, finish on a double; three darts a turn — bust and you lose the turn.", "🎯", "shots", 1, 8),
  g("archery", "Archery", "Six arrows each; allow for the wind.", "🏹", "shots", 1, 8),
  // live
  g("airhockey", "Air Hockey", "Live puck, live paddles — first to five.", "🏒", "live", 2, 2, { hosted: true, realtime: true }),
  g("foosball", "Table Soccer", "Four rods a side, live ball — first to five.", "⚽", "live", 2, 2, { hosted: true, realtime: true }),
  g("spinnerwars", "Spinner Wars", "Bump the others out of the arena; last spinner standing.", "🌀", "live", 2, 8, { hosted: true, realtime: true }),
  // solo
  g("2048", "2048", "Slide and merge the tiles.", "🔢", "solo", 1, 1),
  g("snake", "Snake", "Eat, grow, don't bite yourself.", "🐍", "solo", 1, 1),
  g("mines", "Minesweeper", "Clear the field. Mind the mines.", "💣", "solo", 1, 1),
];

export const GROUP_LABEL: Record<GameMeta["group"], string> = { grid: "Grid games", board: "Board games", dice: "Dice games", cards: "Card games", party: "Party games", shots: "Aim & shoot", live: "Live arcade", solo: "Just you" };

export const LAN_GAMES: GameId[] = GAMES.filter((x) => x.players === 2).map((x) => x.id);
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
/** LANX 2.17.0: games whose rules changed in 2.17.0 — both PCs need 2.17.0 (src-tauri RULES_2170_GAMES). */
export const RULES_2170 = new Set<string>(["ludo", "dots", "memory", "minesvs", "mahjong", "battleship", "go", "hex", "checkers", "taproulette", "mathrush", "trivia", "drawguess", "wordbox", "paintfight", "werewolf", "airhockey", "foosball", "spinnerwars", "hearts", "spades", "euchre", "blackjack", "ginrummy", "holdem", "ocho", "crazy8", "gofish", "snakes", "bankroll", "backgammon", "dominoes", "carrom", "pool", "cuppong", "bowling", "darts", "minigolf", "archery"]);
/** LANX 2.17.1: Ludo's home stretch was fixed (five squares), so Ludo needs 2.17.1 on both PCs. */
export const RULES_2171 = new Set<string>(["ludo"]);
/** LANX 3.16.0: games whose rules were repaired in 3.16.0 (the same moves replay differently in an
 *  older copy), so every PC at the table needs 3.16.0 (src-tauri RULES_3160_GAMES). */
export const RULES_3160 = new Set<string>(["gofish", "dominoes", "bankroll", "holdem", "mahjong", "taproulette", "wordbox", "drawguess", "werewolf"]);
/** The oldest LANX a colleague needs to play this game with you. */
export const needsVersion = (id: string) => (RULES_3160.has(id) ? "3.16.0" : RULES_2171.has(id) ? "2.17.1" : RULES_2170.has(id) ? "2.17.0" : id === "chainreaction" ? "2.10.0" : ["dots", "minesvs", "memory", "mahjong"].includes(id) ? "2.11.0" : "2.12.0");
/** Whether this many players can sit at the game. */
export const sizeOk = (meta: GameMeta | undefined, n: number) => !!meta && n >= meta.minPlayers && n <= meta.maxPlayers && (!meta.sizes || meta.sizes.includes(n));

export const seatColour = (i: number): string => SEAT_COLOURS[i] ?? `hsl(${(i * 47) % 360} 80% 55%)`;

export type GameAction = "accept" | "decline" | "move" | "resign" | "rematch" | "leave" | "state" | "delta";

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
  /** LANX 2.17.0: every winning seat when a team wins together. */
  winners?: number[];
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
  /** Something this PC keeps to itself for the game (a hidden fleet); never sent. */
  secret?: unknown;
  /** The round that secret belongs to (2.17.0: it is kept on disk too, so a restart doesn't lose a fleet). */
  secretRound?: number;
  /** multi, the host (2.17.0): colleagues who pressed Play after the game started; they sit down at the next round. */
  late?: { id: string; name: string }[];
  /** multi, the host (3.17.0): the number of the news last sent to the table; it only ever goes up. */
  rev?: number;
  /** multi, a guest (3.17.0): the number of the newest news taken from the host, and which run of the host's LANX it came from. */
  hostRev?: number;
  hostBoot?: string;
  /** multi, the host (3.16.1): the numbers of the guests' moves played lately, so that none is played twice. */
  seen?: string[];
  /** multi, the host (3.17.0): everyone the table was opened for. (The seats hold only who was in at the start.) */
  invited?: { id: string; name: string }[];
  /** LANX 2.16.1: this PC lost the game (LANX restarted), so the other player's next full list of moves
   *  is taken as it stands (the rules still check it) instead of only their new moves. */
  catchUp?: boolean;
  /** Light steps relayed by the host and not kept in the moves (strokes, taps, roles) — 2.12.0. */
  deltas: unknown[];
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
/** This run of LANX (3.17.0): a host's news is numbered within a run; after a restart the count starts again. */
const BOOT = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

/** LANX 2.17.0: the match the games window has on screen (a hosted game nobody looks at is run by HostRunner). */
let showing: string | null = null;
export const showingMatch = () => showing;
export function setShowing(id: string | null) {
  if (showing === id) return;
  showing = id;
  bump();
}
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
/** The seat to move, or -1 when everyone acts at once (placing ships, say). */
export const turnSeat = (m: Match) => (m.turn < 0 ? -1 : seatOf(m, m.turn));
export const myTurn = (m: Match) => m.status === "playing" && (m.mode === "local" || (m.turn < 0 ? mySeat(m) >= 0 && !m.gone.includes(me) : turnSeat(m) === mySeat(m)));
/** The seed for this round's dice and shuffles: the same on every PC. */
export const seedOf = (m: Match) => `${m.id}#${m.round}`;

/** Save something this PC keeps to itself for the game (never sent). LANX 2.17.0: kept on this PC's disk
 *  too, for this round, so restarting LANX mid-game doesn't lose it (a Sea Battle fleet, say). */
export function setSecret(id: string, value: unknown) {
  const m = matches.get(id);
  if (!m) return;
  m.secret = value;
  m.secretRound = m.round;
  try {
    localStorage.setItem(`lanx-game-secret:${id}`, JSON.stringify({ round: m.round, value }));
  } catch {
    /* fine: kept in memory */
  }
  bump();
}
/** This round's secret (a fleet placed in an earlier round doesn't count). */
export function secretOf(m: Match): unknown {
  if (m.secret !== undefined && (m.secretRound ?? m.round) === m.round) return m.secret;
  try {
    const raw = localStorage.getItem(`lanx-game-secret:${m.id}`);
    const saved = raw ? (JSON.parse(raw) as { round?: number; value?: unknown }) : null;
    if (saved && saved.round === m.round) return saved.value;
  } catch {
    /* nothing saved */
  }
  return undefined;
}
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

/** LANX 2.17.0: the rules name players as "P2" (turn order, from 1); say who that is. */
export function namedText(m: Match, text: string): string {
  return text.replace(/\bP(\d+)\b/g, (all, k: string) => {
    const seat = seatOf(m, Number(k) - 1);
    const name = seatName(m, seat);
    return name === "Someone" ? all : name.split(" (")[0];
  });
}

export function resultText(m: Match): string {
  const r = m.result;
  if (!r) return "";
  const reason = namedText(m, r.reason);
  if (r.draw) return `Draw — ${reason}`;
  if (r.winner === null) return reason;
  // LANX 2.17.0: a team wins together.
  const names = (r.winners && r.winners.length > 1 ? r.winners : [r.winner]).map((s) => seatName(m, s));
  const you = names.includes("You");
  const others = names.filter((x) => x !== "You");
  const who = you ? (others.length ? `You and ${others.join(" and ")}` : "You") : others.join(" and ");
  return `${who} won — ${reason}`;
}

const newId = () => `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
/** Read through a call so a status that `settle` changed is seen afresh. */
const isOver = (m: Match) => m.status === "over";

// ---------------------------------------------------------------- sounds (2.13.0)

/** The sound of a move that just landed on the board — yours, or a colleague's. */
function soundAfterMove(m: Match, mine: boolean) {
  if (isOver(m)) return resultSfx(m);
  const group = gameMeta(m.game)?.group;
  if (group === "live") return; // the arcade boards make their own noise
  if (!mine && m.mode !== "local" && myTurn(m)) return sfx("turn");
  sfx(group === "dice" ? "dice" : group === "cards" ? "card" : group === "party" ? "pop" : group === "shots" ? "whoosh" : "place");
}

/** Won, lost or drawn, from this PC's point of view (pass & play: somebody won). */
function resultSfx(m: Match) {
  if (!m.result) return;
  if (m.result.draw || m.result.winner === null) return sfx("draw");
  if (m.mode === "local") return sfx("win");
  sfx(wonBy(m.result, mySeat(m)) ? "win" : "lose");
}

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
    deltas: [],
    lastAt: Date.now(),
    unseen: false,
    error: null,
    ...p,
  };
  matches.set(m.id, m);
  bump();
  void settle(m); // the rules say who moves first (in Hearts, whoever holds the 2♣)
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
export function challengeMany(game: GameId, all: Peer[]): { match: Match; cards: { peerId: string; card: GameCardData }[] } {
  // LANX 3.17.0: no more invitations than the game has places. (A table invited beyond its size
  // could not be started when everyone pressed Play.)
  const peers = all.slice(0, Math.max(1, (gameMeta(game)?.maxPlayers ?? 8) - 1));
  const seats = [mySeatEntry(0), ...peers.map((p, i) => peerSeat(p, i + 1))];
  const m = make({ id: newId(), game, mode: "multi", seats, host: me, status: "lobby", joined: [me], invited: seats.map((s) => ({ id: s.id, name: s.name })) });
  const players = seats.map((s) => s.id);
  const names = seats.map((s) => s.name);
  return {
    match: m,
    cards: peers.map((p) => ({ peerId: p.id, card: { kind: "game", id: m.id, game, to: p.id, to_name: p.display_name, from_name: myName, players, names } })),
  };
}

/** Pass & play at this PC, `count` people taking turns (one, for the games you can play alone). */
export function localMatch(game: GameId, count = 2): Match {
  const meta = gameMeta(game);
  const n = Math.max(meta?.minPlayers ?? 2, Math.min(count, meta?.maxPlayers ?? 2));
  const seats = Array.from({ length: n }, (_, i) => ({ id: `local:${i}`, name: `Player ${i + 1}`, color: seatColour(i) }));
  return make({ id: newId(), game, mode: "local", seats, host: "", status: "playing" });
}

/** "Play" on a challenge card. The invited side joins (and tells the host); the challenger just opens the match. */
export async function openFromCard(card: GameCardData, msg: Message, peers: Peer[]): Promise<Match> {
  let m = matches.get(card.id);
  const invited = card.to === me;
  // LANX 2.17.0: a card that lists the players is a table, even with two (a hosted game with one colleague).
  const table = card.players && card.players.length >= 2 ? card.players : null;
  const host = msg.is_outgoing ? me : msg.sender_id;
  // LANX 2.16.1: the card knows who challenged; put a two-player match rebuilt the wrong way round right.
  if (m && m.mode === "duo" && !table && m.seats.length === 2 && m.seats[0].id !== host && m.seats[1].id === host) {
    m.seats = [m.seats[1], m.seats[0]].map((s, i) => ({ ...s, color: seatColour(i) }));
    m.host = host;
    await settle(m);
  }
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
      // LANX 2.16.1: a card from before LANX restarted may be a game already under way: ask for it.
      const before = msg.timestamp < startedAt - 5;
      m = make({ id: card.id, game: card.game, mode: "duo", seats, host, status: invited ? "playing" : "waiting", joined: [host], catchUp: before });
      if (before) void sendTo(oppId, m, "state", { sync: 1, round: m.round, first: seats[0].id });
    }
  }
  resendPending(m.id);
  if (invited && m.moves.length === 0 && m.status !== "over") sfx(m.mode === "duo" ? "start" : "join");
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

// LANX 3.16.0: a step that matters is sent until it has arrived. (A move used to be sent once.
// If the colleague's LANX was locked or off the network for that moment, both PCs then waited
// for each other for good, and only "Resign" was left.) It goes again after 1.5, 3, 6, 12 and
// then every 20 seconds, for a quarter of an hour; at once when anything arrives from that
// colleague for this match, and when you press Play on the card again.
interface Pending {
  matchId: string;
  peer: string;
  tries: number;
  since: number;
  timer: ReturnType<typeof setTimeout> | null;
  go: () => Promise<boolean>;
}
const pending = new Map<string, Pending>();
const RETRY_MS = [1500, 3000, 6000, 12000, 20000];
const RETRY_FOR_MS = 15 * 60_000;

/** Sends what `build` gives (worked out afresh each time; null: nothing to send any more), again
 *  and again until it arrives. A newer send of the same `kind` to the same colleague takes its place. */
function sendSure(peerId: string, m: Match, kind: string, build: () => { action: GameAction; data: unknown } | null): Promise<boolean> {
  const key = `${m.id}|${peerId}|${kind}`;
  const old = pending.get(key);
  if (old?.timer) clearTimeout(old.timer);
  const p: Pending = { matchId: m.id, peer: peerId, tries: 0, since: Date.now(), timer: null, go: async () => false };
  p.go = async () => {
    if (p.timer) clearTimeout(p.timer);
    p.timer = null;
    const step = matches.get(m.id) === m ? build() : null;
    if (!step) {
      if (pending.get(key) === p) pending.delete(key);
      return true;
    }
    const ok = await sendTo(peerId, m, step.action, step.data);
    if (pending.get(key) !== p) return ok; // a newer one took its place meanwhile
    if (ok || Date.now() - p.since > RETRY_FOR_MS) {
      pending.delete(key);
      return ok;
    }
    if (!p.timer) p.timer = setTimeout(() => void p.go(), RETRY_MS[Math.min(p.tries++, RETRY_MS.length - 1)]);
    return false;
  };
  pending.set(key, p);
  return p.go();
}

/** A guest's moves made in turn that may still be waiting to be sent: their place in the game. */
const unsentInTurn = new Map<string, { matchId: string; n: number; round: number }>();
/** Moves the host's game has moved past: nothing more to send for them. */
const unsentDone = new Set<string>();

/** Tries now what is still waiting to be sent (for one match, and one colleague of it, when given). How many. */
export function resendPending(matchId?: string, peerId?: string): number {
  let n = 0;
  for (const p of [...pending.values()]) {
    if ((matchId && p.matchId !== matchId) || (peerId && p.peer !== peerId) || !p.timer) continue;
    n++;
    void p.go();
  }
  return n;
}
/** Steps of this match still waiting to arrive somewhere. */
export const unsentCount = (matchId: string) => [...pending.values()].filter((p) => p.matchId === matchId).length;
const dropPending = (matchId: string, peerId: string, kind: string) => {
  const key = `${matchId}|${peerId}|${kind}`;
  const p = pending.get(key);
  if (p?.timer) clearTimeout(p.timer);
  pending.delete(key);
};

const stateData = (m: Match) => ({
  moves: m.moves,
  seats: m.seats.map((s) => ({ id: s.id, name: s.name })),
  round: m.round,
  status: m.status,
  joined: m.joined,
  // LANX 3.17.0: the number of this news (see guestStep: older news never replaces newer).
  rev: m.rev ?? 0,
  boot: BOOT,
  // LANX 3.17.0: who sits down at the next round (they pressed Play after the start).
  late: (m.late ?? []).map((l) => l.id),
  // LANX 2.17.0: a game that ended because someone left (the rules alone wouldn't say it is over).
  ended: m.status === "over" && m.result && m.result.winner === null && !m.result.draw ? m.result.reason : undefined,
});

/** LANX 2.17.0: did this seat win (alone, or with their team)? */
export const wonBy = (r: MatchResult, seat: number) => !r.draw && r.winner !== null && (r.winners ? r.winners.includes(seat) : r.winner === seat);

/** LANX 2.17.0: a player left or gave up. The rules take them out (the others play on) when the game
 *  allows it; otherwise the game ends there with nobody winning, rather than waiting for them forever. */
async function dropOut(m: Match, player: number, who: string) {
  if (await appendValid(m, `x${player}`)) return;
  if (m.status !== "playing") return;
  if (m.seats.length === 2) {
    m.status = "over";
    m.result = { winner: seatOf(m, 1 - player), draw: false, reason: `${who} gave up` };
    void recordResult(m);
    return;
  }
  // LANX 3.16.0: this game knows players leaving, and the rules refused it now: that player is
  // out of the game already (gave up before, went bankrupt, was knocked out), and it is not their
  // turn. Nothing changes for the others. (This used to end the game for everyone, with no winner:
  // the buttons stay on screen for someone who is out, and pressing one again was enough.)
  const rules = await import("./gameRules");
  if (m.turn !== player && rules.validateMoves(m.game, [`x${player}`], m.seats.length, seedOf(m))) return;
  m.status = "over";
  m.result = { winner: null, draw: false, reason: `${who} left — the game can't go on without them` };
}

/** The host tells everyone at the table how things stand. */
async function broadcast(m: Match) {
  m.rev = (m.rev ?? 0) + 1;
  const ids = m.seats.filter((s) => s.id !== me && !m.gone.includes(s.id) && (m.status !== "lobby" || m.joined.includes(s.id))).map((s) => s.id);
  await Promise.all(
    ids.map((id) =>
      // (the state as it is when it goes out: an older one is never sent after a newer)
      sendSure(id, m, "state", () => (m.seats.some((x) => x.id === id) && !m.gone.includes(id) ? { action: "state", data: stateData(m) } : null)),
    ),
  );
}

/** Works out whose turn it is and whether the game is over; records the score when it ends. */
async function settle(m: Match) {
  const rules = await import("./gameRules");
  const n = m.seats.length;
  m.turn = rules.turnOf(m.game, m.moves, n, seedOf(m));
  const end = rules.outcome(m.game, m.moves, n, seedOf(m));
  if (end.over && m.status === "playing") {
    m.status = "over";
    m.result = { winner: end.winner === null ? null : seatOf(m, end.winner), draw: end.draw, reason: end.reason, winners: end.winners?.map((p) => seatOf(m, p)) };
    void recordResult(m);
  }
  bump(); // the turn (or the result) changed after the rules were loaded
}

async function appendValid(m: Match, move: string): Promise<boolean> {
  const rules = await import("./gameRules");
  const next = [...m.moves, move];
  if (!rules.validateMoves(m.game, next, m.seats.length, seedOf(m))) return false;
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
  soundAfterMove(m, true);
  bump();
  if (m.mode === "duo") void sendSure(opponent(m)!.id, m, "moves", () => ({ action: "move", data: duoData(m) }));
  else if (m.mode === "multi") {
    if (isHost(m)) void broadcast(m);
    else {
      // Every move has a number of its own (`k`): the host plays each number once, so a move that
      // is sent twice (the first did arrive, after all) is never played twice. A move made in
      // turn also says its place in the game (`n`), and is taken only there.
      // LANX 3.16.1: sent whatever the move did to the game here — a move that ends the game must
      // reach the host too (in 3.16.0 it never did); and each move waits by itself (`k` is part
      // of what it is filed under), so two quick answers do not push each other out.
      const n = m.moves.length - 1;
      const round = m.round;
      const k = `${playerOf(m, mySeat(m))}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`;
      const inTurn = !move.includes("@");
      void sendSure(m.host, m, `move:${k}`, () => (m.round === round && !unsentDone.has(k) ? { action: "move", data: inTurn ? { cell: move, n, k } : { cell: move, k } } : null));
      if (inTurn) unsentInTurn.set(k, { matchId: m.id, n, round });
    }
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
    resultSfx(m);
    bump();
    await sendTo(opponent(m)!.id, m, "resign", { round: m.round });
    return;
  }
  if (m.mode === "local") {
    await dropOut(m, m.turn, seatName(m, turnSeat(m)));
    if (isOver(m)) resultSfx(m);
    else sfx("buzz");
    bump();
    return;
  }
  // multi
  const seat = mySeat(m);
  if (seat < 0) return;
  await dropOut(m, playerOf(m, seat), seatName(m, seat));
  if (isOver(m)) resultSfx(m);
  else sfx("buzz");
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
    const meta = gameMeta(m.game);
    // LANX 2.17.0: whoever pressed Play after the start sits down now (room allowing); colours follow the places.
    const late = (m.late ?? []).filter((l) => !m.seats.some((s) => s.id === l.id)).map((l) => ({ id: l.id, name: l.name, color: "" }));
    const seats = [...m.seats.filter((s) => !m.gone.includes(s.id)), ...late].slice(0, meta?.maxPlayers ?? 8);
    if (seats.length < Math.max(2, meta?.minPlayers ?? 2)) return;
    m.seats = seats.map((s, i) => ({ ...s, color: seatColour(i) }));
    m.joined = [...new Set([...m.joined, ...late.map((l) => l.id)])];
    m.late = [];
  }
  m.round += 1;
  m.moves = [];
  m.turn = 0;
  m.result = null;
  m.status = "playing";
  m.deltas = [];
  m.lastAt = Date.now();
  await settle(m);
  sfx("start");
  bump();
  if (m.mode === "duo") {
    const round = m.round;
    await sendSure(opponent(m)!.id, m, "rematch", () => (m.round === round && m.moves.length === 0 ? { action: "rematch", data: { round } } : null));
  } else if (m.mode === "multi") await broadcast(m);
}

/** The host starts a multi-player game with whoever has joined. */
export async function startNow(id: string): Promise<string | null> {
  const m = matches.get(id);
  if (!m || m.mode !== "multi" || !isHost(m) || m.status !== "lobby") return "Not a table you host.";
  const seats = m.seats.filter((s) => m.joined.includes(s.id) && !m.gone.includes(s.id));
  if (seats.length < 2) return "Nobody has joined yet — they press Play on the card in their chat.";
  const min = gameMeta(m.game)?.minPlayers ?? 2;
  if (seats.length < min) return `${gameName(m.game)} needs at least ${min} players — ${seats.length} at the table so far.`;
  if (!sizeOk(gameMeta(m.game), seats.length)) return `${gameName(m.game)} is for ${gameMeta(m.game)?.sizes?.join(" or ")} players — ${seats.length} at the table now.`;
  // LANX 2.17.0: colours by the new places, as every guest's PC does.
  m.seats = seats.map((s, i) => ({ ...s, color: seatColour(i) }));
  m.status = "playing";
  m.moves = [];
  m.turn = 0;
  m.result = null;
  m.deltas = [];
  m.lastAt = Date.now();
  await settle(m);
  sfx("start");
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

function pushDelta(m: Match, data: unknown) {
  m.deltas = [...m.deltas, data].slice(-600);
  bump();
}

/** A light step for the others at the table (a stroke, a tap, a role card): the host passes it on;
 *  with `to` (a player number) only that player gets it. Never kept in the moves.
 *  LANX 2.16.0: each one carries `__from`, the sender's player number, filled in by whoever
 *  received it from the sender (only the host's word is taken for someone else's). */
export function sendDelta(id: string, raw: unknown) {
  const m = matches.get(id);
  if (!m) return;
  const meP = m.mode === "local" ? -1 : mySeat(m);
  const data = raw && typeof raw === "object" && !Array.isArray(raw) && meP >= 0 ? { ...(raw as object), __from: playerOf(m, meP) } : raw;
  const to = data && typeof data === "object" && typeof (data as { to?: unknown }).to === "number" ? ((data as { to: number }).to as number) : null;
  if (m.mode === "local") {
    pushDelta(m, data);
    return;
  }
  if (m.mode === "duo") {
    pushDelta(m, data);
    void sendTo(opponent(m)!.id, m, "delta", data);
    return;
  }
  if (isHost(m)) {
    const mine = to === null || seatOf(m, to) === mySeat(m);
    if (mine) pushDelta(m, data);
    const targets = to === null ? m.seats.filter((s) => s.id !== me && !m.gone.includes(s.id)).map((s) => s.id) : [m.seats[seatOf(m, to)]?.id].filter((x): x is string => !!x && x !== me);
    for (const pid of targets) void sendTo(pid, m, "delta", data);
  } else {
    if (to === null || seatOf(m, to) === mySeat(m)) pushDelta(m, data);
    void sendTo(m.host, m, "delta", data);
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

type Data = { moves?: unknown; round?: unknown; cell?: unknown; seats?: unknown; status?: unknown; joined?: unknown; first?: unknown; sync?: unknown; ended?: unknown };

/** What a two-player match tells the other PC: the moves, the round and (2.16.1) who sits first. */
const duoData = (m: Match) => ({ moves: m.moves, round: m.round, first: m.seats[0]?.id });

/** LANX 2.16.1: who challenged in a two-player match, from the game card in the chat with that colleague. */
async function challenger(matchId: string, peerId: string): Promise<string | null> {
  try {
    const conv = (await api.getConversations()).find((c) => c.peer_id === peerId);
    if (!conv) return null;
    const msgs = await api.getMessages(conv.id);
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i];
      if (msg.message_type !== "card") continue;
      try {
        const c = JSON.parse(msg.content) as Partial<GameCardData>;
        if (c.kind === "game" && c.id === matchId) return msg.is_outgoing ? me : peerId;
      } catch {
        /* not a card */
      }
    }
  } catch {
    /* no chat to look in */
  }
  return null;
}

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
    } else if (e.action === "delta") {
      return; // a stroke for a table this PC no longer has
    } else if ((e.action === "accept" || ((e.action === "move" || e.action === "state") && Array.isArray(d.moves))) && !Array.isArray(d.seats) && d.cell === undefined) {
      // A two-player match this PC doesn't know (LANX restarted): rebuild it from the step.
      // LANX 2.16.1: whoever challenged sits first. The step says who (2.16.1 and newer); for an older
      // LANX the challenge card in the chat does. (Before, the sender was always taken to be first.)
      const other: Seat = { id: e.from_id, name: e.from_name, color: "" };
      const iHost = e.action === "accept" || (typeof d.first === "string" ? d.first === me : (await challenger(e.match_id, e.from_id)) === me);
      if (matches.has(e.match_id)) return receiveAsync(e); // another step rebuilt it meanwhile
      m = make({
        id: e.match_id,
        game: e.game,
        mode: "duo",
        seats: iHost ? [mySeatEntry(0), { ...other, color: seatColour(1) }] : [{ ...other, color: seatColour(0) }, mySeatEntry(1)],
        host: iHost ? me : e.from_id,
        status: "playing",
        unseen: true,
        catchUp: e.action !== "accept",
      });
    } else return;
  }
  resendPending(m.id, e.from_id);
  if (e.action === "delta") {
    // Relayed by the host to everyone else (or to the one it names), and kept for the boards.
    const seat = m.seats.findIndex((s) => s.id === e.from_id);
    if (seat < 0) return;
    // LANX 2.16.0: who really sent it. A guest takes the host's word for a relayed step; anyone else's
    // claim is replaced by the seat it actually came from (so nobody can act in another player's name).
    let data = e.data;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const claimed = (data as { __from?: unknown }).__from;
      const trusted = m.mode === "multi" && !isHost(m) && e.from_id === m.host && typeof claimed === "number";
      data = { ...(data as object), __from: trusted ? claimed : playerOf(m, seat) };
    }
    const to = data && typeof data === "object" && typeof (data as { to?: unknown }).to === "number" ? ((data as { to: number }).to as number) : null;
    if (m.mode === "multi" && isHost(m)) {
      const targets = to === null ? m.seats.filter((s) => s.id !== me && s.id !== e.from_id && !m.gone.includes(s.id)).map((s) => s.id) : [m.seats[seatOf(m, to)]?.id].filter((x): x is string => !!x && x !== me && x !== e.from_id);
      for (const pid of targets) void sendTo(pid, m, "delta", data);
      if (to === null || seatOf(m, to) === mySeat(m)) pushDelta(m, data);
    } else if (to === null || seatOf(m, to) === mySeat(m)) pushDelta(m, data);
    return;
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
        sfx("start");
        note = `${who} accepted — ${game} is on. Your move!`;
      }
      break;
    case "decline":
      if (m.status === "waiting") {
        m.status = "declined";
        sfx("buzz");
        note = `${who} declined the ${game} challenge.`;
      }
      break;
    case "leave":
      if (m.status === "playing" || m.status === "waiting") {
        m.status = "left";
        sfx("buzz");
        note = `${who} left the ${game} game.`;
      }
      break;
    case "resign":
      if (m.status === "playing") {
        m.status = "over";
        m.result = { winner: mySeat(m), draw: false, reason: `${who} resigned` };
        void recordResult(m);
        resultSfx(m);
        note = `${who} resigned — you won at ${game}.`;
      }
      break;
    case "rematch":
      if (round !== null && round > m.round) {
        m.round = round;
        m.moves = [];
        m.deltas = [];
        m.turn = 0;
        m.result = null;
        m.status = "playing";
        await settle(m);
        sfx("start");
        note = `${who} wants another round of ${game}.`;
      }
      break;
    case "move":
    case "state": {
      // LANX 2.16.1: "please send me the game" — their LANX restarted and lost it.
      if (e.action === "state" && d.sync) {
        if (m.status === "playing" || m.status === "over") void sendTo(opp.id, m, "state", duoData(m));
        return;
      }
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
      // LANX 3.17.0: both moved at the same moment, where both may (each pressed Ready in Sea
      // Battle, say): the two lists then differ, and neither is the longer one. Both moves count,
      // in one fixed order (the first player's, then the second's), so both PCs end with the same
      // list. (Lists of equal length used to be ignored on both sides, and both waited for good.)
      if (m.status === "playing" && !m.catchUp) {
        let c = 0;
        while (c < mv.length && c < m.moves.length && mv[c] === m.moves[c]) c++;
        const mine = m.moves.slice(c);
        const meP = playerOf(m, mySeat(m));
        const themP = playerOf(m, m.seats.findIndex((x) => x.id === opp.id));
        const theirs = mv.slice(c).filter((x) => !mine.includes(x));
        if (mine.length && theirs.length && mine.every((x) => x.startsWith(`${meP}@`)) && theirs.every((x) => x.startsWith(`${themP}@`))) {
          const merged = [...m.moves.slice(0, c), ...(meP < themP ? [...mine, ...theirs] : [...theirs, ...mine])];
          const rulesNow = await import("./gameRules");
          if (rulesNow.validateMoves(m.game, merged, 2, seedOf(m))) {
            m.moves = merged;
            await settle(m);
            soundAfterMove(m, false);
            if (merged.length !== mv.length || merged.some((x, i) => mv[i] !== x)) void sendSure(opp.id, m, "moves", () => ({ action: "move", data: duoData(m) }));
            note = myTurn(m) ? `${who} played — your move in ${game}.` : `${who} played in ${game}.`;
            break;
          }
        }
      }
      // LANX 2.16.1: their board is behind ours (their LANX restarted, or a step went missing): send them the game.
      if (mv.length < m.moves.length && !m.catchUp && (m.status === "playing" || m.status === "over")) void sendTo(opp.id, m, "state", duoData(m));
      if (m.status !== "playing" || mv.length <= m.moves.length) return;
      const rules = await import("./gameRules");
      if (!rules.validateMoves(m.game, mv, 2, seedOf(m))) return;
      if (m.catchUp) {
        // This PC lost the game: take their list once (the rules accepted it), and the seat order they give.
        if (typeof d.first === "string" && d.first !== m.seats[0].id && m.seats.some((s) => s.id === d.first)) {
          m.seats = [m.seats[1], m.seats[0]].map((s, i) => ({ ...s, color: seatColour(i) }));
          m.host = d.first;
        }
        m.catchUp = false;
      } else {
        // LANX 2.16.0: the moves already played stay as they were, and every new one must be theirs —
        // their turn, or marked with their player number when both act at once (placing a fleet).
        if (!m.moves.every((x, i) => mv[i] === x)) return;
        const theirs = playerOf(m, m.seats.findIndex((s) => s.id === opp.id));
        for (let k = m.moves.length; k < mv.length; k++) {
          const t = rules.turnOf(m.game, mv.slice(0, k), 2, seedOf(m));
          if (!(t === theirs || (t < 0 && mv[k].startsWith(`${theirs}@`)))) return;
        }
      }
      m.moves = mv;
      await settle(m);
      soundAfterMove(m, false);
      note = isOver(m) ? `${game} vs ${who}: ${resultText(m)}` : myTurn(m) ? `${who} played — your move in ${game}.` : `${who} played in ${game}.`;
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
  if (seat < 0) {
    // LANX 3.17.0: not at the table, but invited to it, and pressing Play after the start: they sit
    // down at the next round. (This was meant to work since 2.17.0, but whoever was not seated was
    // turned away before the code for it was reached.)
    const guest = (m.invited ?? []).find((x) => x.id === e.from_id);
    if (!guest || e.action !== "accept" || (m.status !== "playing" && m.status !== "over")) return;
    if (!(m.late ?? []).some((l) => l.id === e.from_id)) {
      m.late = [...(m.late ?? []), { id: e.from_id, name: guest.name || e.from_name }];
      m.gone = m.gone.filter((id) => id !== e.from_id);
      m.lastAt = Date.now();
      m.unseen = true;
      bump();
      nudge?.(`${guest.name || e.from_name} wants to join the ${gameName(m.game)} table — they sit down at the next round.`, m);
    }
    await sendTo(e.from_id, m, "state", stateData(m));
    return;
  }
  const who = m.seats[seat].name;
  const game = gameName(m.game);
  let note = "";
  switch (e.action) {
    case "accept":
      if (m.status === "lobby") {
        if (!m.joined.includes(e.from_id)) {
          m.joined.push(e.from_id);
          sfx("join");
          note = `${who} joined your ${game} table (${m.joined.length} in).`;
        }
        m.gone = m.gone.filter((id) => id !== e.from_id);
        await broadcast(m);
      } else {
        // Started already: they see it, and sit down at the next round (2.17.0).
        if (!m.seats.some((s) => s.id === e.from_id) && !(m.late ?? []).some((l) => l.id === e.from_id)) {
          m.late = [...(m.late ?? []), { id: e.from_id, name: e.from_name }];
          note = `${e.from_name} wants to join the ${game} table — they sit down at the next round.`;
        }
        await sendTo(e.from_id, m, "state", stateData(m));
      }
      break;
    case "decline":
    case "leave":
      if (m.status === "lobby") {
        m.joined = m.joined.filter((id) => id !== e.from_id);
        if (!m.gone.includes(e.from_id)) m.gone.push(e.from_id);
        sfx("buzz");
        note = `${who} is not joining the ${game} table.`;
        await broadcast(m);
      } else if (m.status === "playing") {
        await dropOut(m, playerOf(m, seat), who);
        if (!m.gone.includes(e.from_id)) m.gone.push(e.from_id);
        if (isOver(m)) resultSfx(m);
        else sfx("buzz");
        note = `${who} left the ${game} game.`;
        await broadcast(m);
      }
      break;
    case "resign":
      if (m.status === "playing") {
        await dropOut(m, playerOf(m, seat), who);
        if (isOver(m)) resultSfx(m);
        else sfx("buzz");
        note = `${who} is out of the ${game} game.`;
        await broadcast(m);
      }
      break;
    case "move": {
      // Their turn — or, when everyone acts at once, a move marked with their own player number.
      const theirs = m.turn < 0 ? String(d.cell ?? "").startsWith(`${playerOf(m, seat)}@`) : turnSeat(m) === seat;
      // LANX 3.16.0: a move made in turn says which place in the game it is for; one that comes
      // again, or late, is not played. LANX 3.16.1: only of moves made in turn (where everyone acts
      // at once, two answers of the same moment both name the same place, and both count); and
      // every move's own number is played once.
      const place = m.turn >= 0 && typeof (d as { n?: unknown }).n === "number" ? ((d as { n?: number }).n as number) : null;
      const k = typeof (d as { k?: unknown }).k === "string" ? ((d as { k: string }).k as string).slice(0, 40) : null;
      const again = k !== null && (m.seen ?? []).includes(k);
      if (m.status !== "playing" || !theirs || d.cell === undefined || again || (place !== null && place !== m.moves.length)) {
        await sendTo(e.from_id, m, "state", stateData(m)); // put their board right
        return;
      }
      const ok = await appendValid(m, String(d.cell));
      if (!ok) {
        await sendTo(e.from_id, m, "state", stateData(m));
        return;
      }
      if (k !== null) m.seen = [...(m.seen ?? []), k].slice(-200);
      soundAfterMove(m, false);
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
      sfx("buzz");
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
    if (!rules.validateMoves(m.game, moves, seats.length, `${m.id}#${round}`)) return;
    // LANX 3.17.0: the host numbers its news. Each one travels by itself and they can arrive out of
    // order; an older one that comes late is left alone. (It used to replace the newer one: if the
    // newer had given this PC the move, the table then waited for good.)
    const rev = typeof (d as { rev?: unknown }).rev === "number" ? ((d as { rev: number }).rev as number) : null;
    const boot = typeof (d as { boot?: unknown }).boot === "string" ? ((d as { boot: string }).boot as string) : null;
    if (rev !== null && boot !== null) {
      if (m.hostBoot === boot && rev < (m.hostRev ?? 0)) return;
      m.hostBoot = boot;
      m.hostRev = rev;
    }
    const late = Array.isArray((d as { late?: unknown }).late) && ((d as { late: unknown[] }).late.map(String).includes(me));
    if ((status === "playing" || d.status === "over") && !seats.some((s) => s.id === me)) {
      const before = m.note;
      m.status = "declined";
      // LANX 3.17.0: "…you sit down at the next round" once the host has heard your Play.
      m.note = late ? "The game is under way. You sit down at the next round." : "The game started without you.";
      if (m.note !== before) {
        sfx("buzz");
        note = late ? `The ${game} table is playing — you sit down at the next round.` : `The ${game} table started without you.`;
      }
    } else {
      const wasLobby = m.status === "lobby";
      // (A move of mine, made in turn, that was still waiting to be sent: the host's game holds it,
      // or has gone on without it. An answer given when everyone acts at once keeps waiting: the
      // host's list growing says nothing about it.)
      for (const [k, w] of unsentInTurn) {
        if (w.matchId !== m.id || (w.round === round && moves.length <= w.n)) continue;
        unsentDone.add(k);
        unsentInTurn.delete(k);
        dropPending(m.id, m.host, `move:${k}`);
      }
      const had = m.round === round ? m.moves.length : -1;
      const hadJoined = m.joined.length;
      const newRound = m.round !== round;
      if (newRound) m.deltas = []; // last round's strokes and taps (2.17.0)
      m.seats = seats;
      m.moves = moves;
      m.round = round;
      m.joined = joined;
      m.status = status;
      m.result = null;
      m.note = "";
      await settle(m);
      // LANX 2.17.0: the host ended it because someone left.
      if (!isOver(m) && d.status === "over" && typeof d.ended === "string") {
        m.status = "over";
        m.result = { winner: null, draw: false, reason: d.ended };
      }
      if (isOver(m)) {
        resultSfx(m);
        note = `${game}: ${resultText(m)}`;
      } else if (wasLobby && status === "playing") {
        sfx("start");
        note = `${e.from_name} started the ${game} game${myTurn(m) ? " — your move!" : "."}`;
      } else if (status === "playing" && newRound) sfx("start");
      else if (status === "playing" && moves.length > had) {
        soundAfterMove(m, false);
        if (myTurn(m)) note = `Your move in ${game}.`;
      } else if (status === "lobby" && joined.length > hadJoined) sfx("join");
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
/** LANX 3.17.0: the rounds already counted ("<match>#<round>"), kept with the statistics, so that no
 *  game is counted twice — not when the result arrives a second time, not after LANX restarts. */
let counted: string[] = [];
const COUNTED = "#counted";
const COUNTED_MAX = 400;

export async function loadStats(): Promise<Stats> {
  if (stats) return stats;
  let raw: string | null;
  try {
    raw = await api.getPref("games_stats");
  } catch {
    // LANX 3.17.0: could not be read just now. Nothing is kept and nothing will be written over
    // what is on disk; the next time tries again. (This used to be taken for "no statistics yet",
    // and the next result then wiped every earlier one.)
    return {};
  }
  let parsed: unknown = {};
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = {};
  }
  const all = (parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}) as Record<string, unknown>;
  counted = Array.isArray(all[COUNTED]) ? (all[COUNTED] as unknown[]).map(String).slice(-COUNTED_MAX) : [];
  delete all[COUNTED];
  stats = all as Stats;
  return stats;
}

async function saveStats() {
  if (!stats) return; // never read: nothing of ours to write
  try {
    await api.setPref("games_stats", JSON.stringify({ ...stats, [COUNTED]: counted.slice(-COUNTED_MAX) }));
  } catch {
    /* the score is only a convenience */
  }
}

const fresh = (): GameStats => ({ played: 0, won: 0, lost: 0, drawn: 0 });

async function recordResult(m: Match) {
  if (m.mode === "local" || !m.result) return;
  const seat = mySeat(m);
  if (seat < 0) return;
  // (taken now: the match may have gone on to another round by the time the statistics are read)
  const result = m.result;
  const key = `${m.id}#${m.round}`;
  if (result.winner === null && !result.draw) return; // abandoned: nobody won or lost, and it is not a game played
  await loadStats();
  if (!stats || counted.includes(key)) return;
  counted.push(key);
  const g = (stats[m.game] ??= fresh());
  g.played += 1;
  if (result.draw) g.drawn += 1;
  else if (wonBy(result, seat)) g.won += 1;
  else g.lost += 1;
  await saveStats();
  bump();
}

/** A solo game finished with this score (Minesweeper counts seconds: lower is better). */
export async function recordScore(game: SoloId, score: number, lowerIsBetter = false) {
  await loadStats();
  if (!stats) return;
  const g = (stats[game] ??= fresh());
  g.played += 1;
  if (g.best === undefined || (lowerIsBetter ? score < g.best : score > g.best)) g.best = score;
  await saveStats();
  bump();
}

export const statsFor = (id: string): GameStats | undefined => stats?.[id];
