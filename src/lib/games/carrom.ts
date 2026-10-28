// Carrom, two players, Indian club rules (LANX 2.17.0). Flick the striker
// from your baseline at the coins: nine white, nine black and the red queen.
// Pocket your colour (white for the first player) and you shoot again. The
// queen must be covered: pocket one of yours in the same stroke or the next,
// or she goes back to the centre. Fouls — the striker going in, pocketing
// your last coin before the queen is covered, or pocketing the opponent's
// last coin — send back everything of yours from that stroke plus a penalty
// coin (owed until you have one). Returned coins go to the centre, never on
// top of another. Pocket all nine with the queen covered to win.
// Moves: "s:<x>:<angle>:<power>" — the striker's place on your baseline
// (−180…180), the angle and the power.

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
  /** What happened, one line a stroke ("P1 pocketed 2 — shoots again"); boards name the players. */
  log: string[];
  /** LANX 2.17.0: penalty coins owed (a foul with nothing pocketed yet), paid with the next coin pocketed. */
  due: number[];
}

const colourOf = (id: number) => (id >= 1 && id <= 9 ? 0 : id >= 10 && id <= 18 ? 1 : -1);
const ownCount = (s: CarromState, p: number) => s.potted[p].filter((id) => colourOf(id) === p).length;

/** Where the striker sits for player `p` placed at `x` on the baseline (table units). */
export function strikerSpot(p: number, x: number): { sx: number; base: number } {
  return { sx: Math.max(60, Math.min(CARROM_S - 60, CARROM_S / 2 + x)), base: p === 0 ? CARROM_S - 70 : 70 };
}

/** Free spots for coins put back, nearest the centre first: a tight hexagonal grid (whole numbers only). */
const SPOTS: [number, number][] = (() => {
  const out: [number, number, number][] = [];
  for (let j = -5; j <= 5; j++)
    for (let i = -5; i <= 5; i++) {
      const x = i * 28 + (j % 2 ? 14 : 0);
      const y = j * 25;
      out.push([x, y, x * x + y * y]);
    }
  out.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
  return out.map(([x, y]) => [x, y]);
})();

/** Puts these coins back on the board near the centre, each where it touches no other piece. */
function putBack(coins: Body[], ids: number[]) {
  for (const id of ids) {
    const c = coins.find((x) => x.id === id);
    if (!c) continue;
    c.out = true; // not in the way of itself while looking
    for (const [dx, dy] of SPOTS) {
      const x = (CARROM_S / 2 + dx) * K;
      const y = (CARROM_S / 2 + dy) * K;
      const clear = coins.every((o) => o.out || (o.x - x) ** 2 + (o.y - y) ** 2 >= (o.r + c.r) ** 2);
      if (!clear) continue;
      c.x = x;
      c.y = y;
      break;
    }
    c.out = false;
    c.vx = 0;
    c.vy = 0;
  }
}

/** The flick itself: every piece's path (frames every 5 steps, striker first) and what happened, with the step. */
export function carromSimulate(s: CarromState, x: number, angle: number, power: number) {
  const { sx, base } = strikerSpot(s.turn, x);
  const striker: Body = { id: STRIKER, x: sx * K, y: base * K, vx: 0, vy: 0, r: STRIKER_R * K, mass: 2, out: false };
  const [vx, vy] = velocity(angle, power * 5500);
  striker.vx = vx;
  striker.vy = vy;
  const bodies = [striker, ...s.coins.map((c) => ({ ...c }))];
  const { events, frames } = settle(bodies, TABLE, 4000, 5);
  return { bodies, events, frames, sx, base };
}

/** LANX 2.17.0, Indian club rules:
 *  - your coin in: shoot again; the opponent's coins in: theirs, and your turn ends (unless one of yours went in too);
 *  - the queen: cover her by pocketing one of yours in the same stroke or the next, or she goes back to the centre;
 *  - fouls (the striker in, your last coin before the queen is covered, the opponent's last coin): everything of
 *    yours pocketed that stroke goes back (the queen too), plus one penalty coin of yours — owed if you have none yet;
 *  - nine coins and the queen covered (by anyone): you win. */
export function carromShot(s: CarromState, x: number, angle: number, power: number): CarromState {
  const p = s.turn;
  const o = 1 - p;
  const { bodies, events, frames, sx, base } = carromSimulate(s, x, angle, power);
  const potted = [...new Set(events.filter((e) => e.kind === "pocket").map((e) => e.a))];
  const next: CarromState = { ...s, coins: bodies.slice(1), frames, striker: { x: sx, y: base }, log: [...s.log], potted: s.potted.map((x) => [...x]), due: [...s.due] };
  const who = `P${p + 1}`;
  const mine = potted.filter((id) => colourOf(id) === p);
  const theirs = potted.filter((id) => colourOf(id) === o);
  const queenIn = potted.includes(QUEEN);
  const fouls: string[] = [];
  const back: number[] = [];
  if (potted.includes(STRIKER)) fouls.push("the striker went in");
  if (theirs.length && ownCount(s, o) + theirs.length >= 9) {
    fouls.push("their last coin went in");
    back.push(...theirs);
  } else next.potted[o].push(...theirs);
  // Paying a penalty owed: the first of your coins in goes back to the centre.
  const pay = Math.min(next.due[p], mine.length);
  const kept = mine.length - pay;
  // Is the queen covered now? (In the same stroke, or the stroke after she went in.)
  const covers = kept > 0 && (queenIn || s.queenPending === p);
  if (!fouls.length && ownCount(s, p) + kept >= 9 && s.queenBy === null && !covers) fouls.push("the last coin went in before the queen was covered");
  let keep = false;
  let words: string;
  if (fouls.length) {
    // Everything of yours from this stroke goes back, the queen too, plus a penalty coin.
    back.push(...mine);
    if (queenIn || s.queenPending === p) back.push(QUEEN);
    next.queenPending = s.queenPending === p ? null : s.queenPending;
    const penalty = [...next.potted[p]].reverse().find((id) => colourOf(id) === p);
    if (penalty !== undefined) {
      next.potted[p].splice(next.potted[p].lastIndexOf(penalty), 1);
      back.push(penalty);
    } else next.due[p]++;
    const whites = back.filter((id) => colourOf(id) === 0).length;
    const blacks = back.filter((id) => colourOf(id) === 1).length;
    const coins = [whites ? `${whites} white` : "", blacks ? `${blacks} black` : ""].filter(Boolean).join(" and ");
    const goes = [coins ? `${coins} coin${whites + blacks > 1 ? "s" : ""}` : "", back.includes(QUEEN) ? "the queen" : ""].filter(Boolean).join(" and ");
    words = `Foul by ${who}: ${fouls.join(" and ")} — ${goes ? `${goes} back to the centre` : "nothing to put back"}${penalty === undefined ? `; ${who} owes a penalty coin` : " (one is the penalty)"}`;
  } else {
    if (pay) {
      next.due[p] -= pay;
      back.push(...mine.slice(0, pay));
    }
    next.potted[p].push(...mine.slice(pay));
    keep = mine.length > 0;
    const parts: string[] = [];
    if (mine.length) parts.push(`${who} pocketed ${mine.length === 1 ? "a coin" : `${mine.length} coins`}${pay ? ` (${pay} paid the penalty owed)` : ""}`);
    const their = `${theirs.length === 1 ? "a coin" : `${theirs.length} coins`} of theirs`;
    if (theirs.length) parts.push(mine.length ? `${their} went in too` : `${who} pocketed ${their}`);
    if (covers) {
      next.queenBy = p;
      next.queenPending = null;
      parts.push("the queen is covered");
    } else if (queenIn) {
      next.queenPending = p;
      keep = true;
      parts.push(`${who} pocketed the queen — cover her with your next coin`);
    } else if (s.queenPending === p) {
      back.push(QUEEN);
      next.queenPending = null;
      parts.push("the queen wasn't covered — back to the centre");
    }
    words = parts.length ? parts.join("; ") : `${who} pocketed nothing`;
    if (ownCount(next, p) >= 9 && next.queenBy !== null) {
      next.winner = p;
      next.reason = "all nine coins home";
      words += ` — all nine! ${who} wins`;
    }
  }
  putBack(next.coins, back);
  if (!keep && next.winner === null) {
    next.turn = o;
    words += ` — P${o + 1} to play`;
  } else if (next.winner === null) words += " — shoots again";
  next.log.push(words);
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
    let s: CarromState = { coins: carromSetup(), turn: 0, potted: [[], []], queenBy: null, queenPending: null, winner: null, reason: "", frames: [], striker: null, log: [], due: [0, 0] };
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
  summary: (s) => `white ${ownCount(s, 0)}/9 · black ${ownCount(s, 1)}/9${s.queenBy !== null ? ` · queen: P${s.queenBy + 1}` : s.queenPending !== null ? " · queen to cover" : ""}`,
};
