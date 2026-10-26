// Carrom, two players. Flick the striker from your baseline at the coins:
// nine white, nine black and the red queen. Pot your colour (white for the
// first player); the queen is worth three when you pot one of yours
// straight after her. Potting the striker is a foul: one of your potted
// coins comes back. Pot all nine of yours to win (the queen must be covered
// first by someone). Moves: "s:<x>:<angle>:<power>" — the striker's place on
// your baseline (−180…180), the angle and the power.

import { ON, win, type GameDef, type Outcome } from "./core.ts";
import { K, rectWalls, settle, velocity, type Body, type Table } from "./physics2d.ts";

export const CARROM_S = 600;
const COIN_R = 13;
const STRIKER_R = 17;
const POCKET_R = 24;
export const QUEEN = 19;
export const STRIKER = 0;

const TABLE: Table = {
  walls: rectWalls(0, 0, CARROM_S * K, CARROM_S * K),
  pockets: [[14, 14], [CARROM_S - 14, 14], [14, CARROM_S - 14], [CARROM_S - 14, CARROM_S - 14]].map(([x, y]) => ({ x: x * K, y: y * K, r: POCKET_R * K })),
  friction: 9,
  stop: 60,
  bounce: 720,
};

/** ids 1..9 white, 10..18 black, 19 queen, 0 striker. */
export function carromSetup(): Body[] {
  const c = CARROM_S / 2;
  const coins: Body[] = [{ id: QUEEN, x: c * K, y: c * K, vx: 0, vy: 0, r: COIN_R * K, mass: 1, out: false }];
  const ring = (count: number, radius: number, startId: number, alt: boolean) => {
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2;
      coins.push({ id: startId + k, x: Math.round((c + Math.cos(a) * radius) * K), y: Math.round((c + Math.sin(a) * radius) * K), vx: 0, vy: 0, r: COIN_R * K, mass: 1, out: false });
      void alt;
    }
  };
  // Inner ring of six alternating, outer ring of twelve alternating.
  const inner = [1, 10, 2, 11, 3, 12];
  const outer = [13, 4, 14, 5, 15, 6, 16, 7, 17, 8, 18, 9];
  inner.forEach((id, k) => {
    const a = (k / 6) * Math.PI * 2;
    coins.push({ id, x: Math.round((c + Math.cos(a) * COIN_R * 2.05) * K), y: Math.round((c + Math.sin(a) * COIN_R * 2.05) * K), vx: 0, vy: 0, r: COIN_R * K, mass: 1, out: false });
  });
  outer.forEach((id, k) => {
    const a = (k / 12) * Math.PI * 2 + Math.PI / 12;
    coins.push({ id, x: Math.round((c + Math.cos(a) * COIN_R * 4.1) * K), y: Math.round((c + Math.sin(a) * COIN_R * 4.1) * K), vx: 0, vy: 0, r: COIN_R * K, mass: 1, out: false });
  });
  void ring;
  return coins;
}

export interface CarromState {
  coins: Body[];
  turn: number;
  /** Potted coins per player, and whether they hold the queen. */
  potted: number[][];
  queenBy: number | null;
  /** The queen was potted last shot and must be covered. */
  queenPending: number | null;
  winner: number | null;
  reason: string;
  frames: { x: number; y: number; out: boolean }[][];
  striker: { x: number; y: number } | null;
  log: string[];
}

const colourOf = (id: number) => (id >= 1 && id <= 9 ? 0 : id >= 10 && id <= 18 ? 1 : -1);

export function carromShot(s: CarromState, x: number, angle: number, power: number): CarromState {
  const p = s.turn;
  const base = p === 0 ? CARROM_S - 70 : 70;
  const sx = Math.max(60, Math.min(CARROM_S - 60, CARROM_S / 2 + x));
  const striker: Body = { id: STRIKER, x: sx * K, y: base * K, vx: 0, vy: 0, r: STRIKER_R * K, mass: 2, out: false };
  const [vx, vy] = velocity(angle, power * 5500);
  striker.vx = vx;
  striker.vy = vy;
  const bodies = [striker, ...s.coins.map((c) => ({ ...c }))];
  const { events, frames } = settle(bodies, TABLE, 4000, 5);
  const potted = events.filter((e) => e.kind === "pocket").map((e) => e.a);
  const next: CarromState = { ...s, coins: bodies.slice(1), frames, striker: { x: sx, y: base }, log: [...s.log], potted: s.potted.map((x) => [...x]) };
  let keep = false;
  let note = "";
  const mine = potted.filter((id) => colourOf(id) === p);
  const theirs = potted.filter((id) => colourOf(id) === 1 - p);
  // Coins of the other colour go to the other player.
  for (const id of theirs) next.potted[1 - p].push(id);
  for (const id of mine) next.potted[p].push(id);
  if (mine.length) keep = true;
  if (potted.includes(QUEEN)) {
    next.queenPending = p;
    if (mine.length) {
      next.queenBy = p;
      next.queenPending = null;
      note = "queen covered";
    } else keep = true;
  } else if (s.queenPending === p) {
    if (mine.length) {
      next.queenBy = p;
      next.queenPending = null;
      note = "queen covered";
    } else {
      // Not covered: the queen comes back to the centre.
      const q = next.coins.find((c) => c.id === QUEEN)!;
      q.out = false;
      q.x = (CARROM_S / 2) * K;
      q.y = (CARROM_S / 2) * K;
      next.queenPending = null;
      note = "queen not covered — back she goes";
    }
  }
  if (potted.includes(STRIKER)) {
    keep = false;
    const give = next.potted[p].pop();
    if (give !== undefined) {
      const c = next.coins.find((x) => x.id === give)!;
      c.out = false;
      c.x = (CARROM_S / 2) * K;
      c.y = (CARROM_S / 2 + 30) * K;
    }
    note = "striker potted — foul";
  }
  if (next.potted[p].filter((id) => colourOf(id) === p).length >= 9 && (next.queenBy !== null)) {
    next.winner = p;
    next.reason = "all nine coins home";
  }
  next.log.push(`Player ${p + 1}: ${potted.filter((id) => id !== STRIKER).length ? `potted ${potted.filter((id) => id !== STRIKER).length}` : "nothing"}${note ? ` — ${note}` : ""}`);
  if (!keep && next.winner === null) next.turn = 1 - p;
  return next;
}

function outcome(s: CarromState): Outcome {
  return s.winner !== null ? win(s.winner, s.reason) : ON;
}

export const carrom: GameDef<CarromState> = {
  id: "carrom",
  name: "Carrom",
  blurb: "Flick the striker; pocket your nine coins and cover the queen.",
  emoji: "🪙",
  minPlayers: 2,
  maxPlayers: 2,
  replay(moves) {
    let s: CarromState = { coins: carromSetup(), turn: 0, potted: [[], []], queenBy: null, queenPending: null, winner: null, reason: "", frames: [], striker: null, log: [] };
    for (const m of moves) {
      if (s.winner !== null) return null;
      const mv = /^s:(-?\d+):(-?\d+):(\d+)$/.exec(m);
      if (!mv) return null;
      s = carromShot(s, Number(mv[1]), Number(mv[2]), Math.max(1, Math.min(100, Number(mv[3]))));
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s) => outcome(s),
  summary: (s) => `white ${s.potted[0].filter((id) => colourOf(id) === 0).length}/9 · black ${s.potted[1].filter((id) => colourOf(id) === 1).length}/9${s.queenBy !== null ? ` · queen: P${s.queenBy + 1}` : ""}`,
};
