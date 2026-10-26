// Bankroll — a quick property-trading board, 2–6 players, 24 squares. Roll
// (the match rolls), move, and buy the street you land on or pay rent to
// its owner (double rent when they own the whole colour). Pass Go for 200.
// "Chance" squares pay or charge a little; the tax square charges; the
// police square sends you to the corner and costs a turn. Out of money is
// out of the game. The last one in wins, or after 30 rounds the richest
// (cash plus the price of what you own).
//
// Moves: "r" (roll); when you land on an unowned street, "b" (buy) or "s"
// (skip) before the next player rolls.

import { ON, dice, win, type GameDef, type Outcome } from "./core.ts";

export interface Square {
  kind: "go" | "street" | "chance" | "tax" | "police" | "jail" | "free";
  name: string;
  price?: number;
  rent?: number;
  group?: string;
}

export const BOARD: Square[] = [
  { kind: "go", name: "Go" },
  { kind: "street", name: "Station Rd", price: 60, rent: 6, group: "brown" },
  { kind: "chance", name: "Chance" },
  { kind: "street", name: "Market St", price: 60, rent: 8, group: "brown" },
  { kind: "tax", name: "Tax" },
  { kind: "street", name: "Lake View", price: 100, rent: 12, group: "sky" },
  { kind: "jail", name: "Jail" },
  { kind: "street", name: "Hill Rd", price: 100, rent: 12, group: "sky" },
  { kind: "street", name: "Park Lane", price: 120, rent: 16, group: "sky" },
  { kind: "chance", name: "Chance" },
  { kind: "street", name: "MG Road", price: 140, rent: 20, group: "pink" },
  { kind: "street", name: "Link Rd", price: 160, rent: 24, group: "pink" },
  { kind: "free", name: "Free Parking" },
  { kind: "street", name: "Mill Lane", price: 180, rent: 28, group: "orange" },
  { kind: "street", name: "Church St", price: 200, rent: 32, group: "orange" },
  { kind: "chance", name: "Chance" },
  { kind: "street", name: "Temple Rd", price: 220, rent: 36, group: "red" },
  { kind: "street", name: "Bazaar St", price: 240, rent: 40, group: "red" },
  { kind: "police", name: "Go to Jail" },
  { kind: "street", name: "Ring Rd", price: 260, rent: 44, group: "yellow" },
  { kind: "street", name: "Sea Face", price: 280, rent: 48, group: "yellow" },
  { kind: "chance", name: "Chance" },
  { kind: "street", name: "Mayfair", price: 350, rent: 70, group: "blue" },
  { kind: "street", name: "Boardwalk", price: 400, rent: 100, group: "blue" },
];
const CHANCE = [50, -40, 100, -60, 25, -25, 150, -100];
const ROUNDS = 30;

export interface BankrollState {
  cash: number[];
  pos: number[];
  /** owner[square] = player or -1. */
  owner: number[];
  out: boolean[];
  /** Lose the next turn (sent to jail). */
  skip: boolean[];
  turn: number;
  /** Waiting for buy/skip on this square, or -1. */
  offer: number;
  rolls: number;
  lastRoll: [number, number] | null;
  round: number;
  log: string[];
  winner: number | null;
  reason: string;
}

const alive = (s: BankrollState) => s.out.map((o, i) => (o ? -1 : i)).filter((i) => i >= 0);

function worth(s: BankrollState, p: number): number {
  return s.cash[p] + BOARD.reduce((a, sq, i) => a + (s.owner[i] === p ? sq.price ?? 0 : 0), 0);
}

function nextTurn(s: BankrollState, n: number) {
  for (let k = 0; k < n; k++) {
    const q = (s.turn + 1 + k) % n;
    if (q <= s.turn) s.round++;
    if (!s.out[q]) {
      s.turn = q;
      break;
    }
  }
  if (s.round > ROUNDS && s.winner === null) {
    const best = alive(s).sort((a, b) => worth(s, b) - worth(s, a))[0];
    s.winner = best;
    s.reason = `richest after ${ROUNDS} rounds (${worth(s, best)})`;
  }
}

function pay(s: BankrollState, from: number, to: number, amount: number) {
  s.cash[from] -= amount;
  if (to >= 0) s.cash[to] += amount;
  if (s.cash[from] < 0) {
    s.out[from] = true;
    s.log.push(`Player ${from + 1} is out of money`);
    BOARD.forEach((_, i) => {
      if (s.owner[i] === from) s.owner[i] = -1;
    });
  }
}

function outcome(s: BankrollState): Outcome {
  return s.winner !== null ? win(s.winner, s.reason, s.cash) : ON;
}

export const bankroll: GameDef<BankrollState> = {
  id: "bankroll",
  name: "Bankroll",
  blurb: "Fast property trading: buy streets, collect rent, don't go broke.",
  emoji: "🏦",
  minPlayers: 2,
  maxPlayers: 6,
  replay(moves, n, seed) {
    const s: BankrollState = { cash: Array(n).fill(1000), pos: Array(n).fill(0), owner: Array(BOARD.length).fill(-1), out: Array(n).fill(false), skip: Array(n).fill(false), turn: 0, offer: -1, rolls: 0, lastRoll: null, round: 1, log: [], winner: null, reason: "" };
    for (const m of moves) {
      if (s.winner !== null) return null;
      const p = s.turn;
      if (m === "b" || m === "s") {
        if (s.offer < 0) return null;
        const sq = BOARD[s.offer];
        if (m === "b") {
          if (s.cash[p] < (sq.price ?? 0)) return null;
          s.cash[p] -= sq.price ?? 0;
          s.owner[s.offer] = p;
          s.log.push(`Player ${p + 1} bought ${sq.name}`);
        }
        s.offer = -1;
        nextTurn(s, n);
        continue;
      }
      if (m !== "r" || s.offer >= 0) return null;
      if (s.skip[p]) {
        s.skip[p] = false;
        s.log.push(`Player ${p + 1} sits out a turn`);
        nextTurn(s, n);
        continue;
      }
      const a = dice(seed, s.rolls);
      const b = dice(seed, s.rolls + 1);
      s.rolls += 2;
      s.lastRoll = [a, b];
      const from = s.pos[p];
      const to = (from + a + b) % BOARD.length;
      if (to < from) {
        s.cash[p] += 200;
        s.log.push(`Player ${p + 1} passed Go (+200)`);
      }
      s.pos[p] = to;
      const sq = BOARD[to];
      let landed = `Player ${p + 1} rolled ${a}+${b}: ${sq.name}`;
      if (sq.kind === "street") {
        const o = s.owner[to];
        if (o === -1) {
          s.offer = to;
          s.log.push(landed + " (for sale)");
          continue; // wait for buy / skip
        }
        if (o !== p) {
          const set = BOARD.every((x, i) => x.group !== sq.group || s.owner[i] === o);
          const rent = (sq.rent ?? 0) * (set ? 2 : 1);
          pay(s, p, o, rent);
          landed += ` — rent ${rent} to Player ${o + 1}`;
        }
      } else if (sq.kind === "chance") {
        const amt = CHANCE[(a * 7 + b + s.rolls) % CHANCE.length];
        pay(s, p, -1, -amt);
        landed += ` — chance ${amt > 0 ? "+" : ""}${amt}`;
      } else if (sq.kind === "tax") {
        pay(s, p, -1, 100);
        landed += " — tax 100";
      } else if (sq.kind === "police") {
        s.pos[p] = 6;
        s.skip[p] = true;
        landed += " — to jail, miss a turn";
      }
      s.log.push(landed);
      const left = alive(s);
      if (left.length === 1) {
        s.winner = left[0];
        s.reason = "the last one solvent";
        continue;
      }
      nextTurn(s, n);
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s) => outcome(s),
  summary: (s) => s.cash.map((c, i) => `P${i + 1} ${s.out[i] ? "out" : c}`).join(" · ") + ` · round ${Math.min(s.round, ROUNDS)}/${ROUNDS}`,
};
