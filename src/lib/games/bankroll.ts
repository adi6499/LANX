// Bankroll — a quick property-trading board, 2–6 players, 24 squares. Roll
// (the match rolls two dice), move, and buy the street you land on or pay
// rent to its owner. Pass Go for 200. "Chance" squares pay or charge a
// little; the tax square charges; the police square sends you to jail,
// where you miss your next turn.
//
// LANX 2.17.0, closer to the real thing:
// - Own a whole colour and the rent doubles; then you can build houses on
//   it (evenly, up to four a street) and the rent multiplies (×5, ×10, ×15, ×20).
// - Doubles roll again; a third double in a row sends you to jail.
// - Can't pay? Your houses are sold back at half price first; if that is
//   still not enough you are bankrupt: the player you owe gets what you
//   have left and your streets (owed to the bank, the streets go back on sale).
// - The last one in wins; after 30 rounds the richest (cash, streets and
//   houses at cost) wins, and equal riches are a draw.
// - A player who leaves is out; their streets go back to the bank.
//
// Moves: "r" (roll — or, in jail, miss the turn), "b"/"s" (buy or skip the
// street you landed on), "h:<square>" (build a house), "x<p>" (player p left).

import { ON, dice, draw, lastIn, leaver, nextIn, win, type GameDef, type Outcome } from "./core.ts";

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
export const JAIL = 6;
/** What a house costs on each colour. */
export const HOUSE_COST: Record<string, number> = { brown: 50, sky: 50, pink: 100, orange: 100, red: 150, yellow: 150, blue: 200 };
export const MAX_HOUSES = 4;
/** Rent × this with 0..4 houses (0 = the whole colour, no houses yet). */
const HOUSE_RENT = [2, 5, 10, 15, 20];

export interface BankrollState {
  cash: number[];
  pos: number[];
  /** owner[square] = player or -1. */
  owner: number[];
  /** LANX 2.17.0: houses per square (0..4). */
  houses: number[];
  out: boolean[];
  /** In jail: misses the next turn. */
  skip: boolean[];
  turn: number;
  /** Waiting for buy/skip on this square, or -1. */
  offer: number;
  rolls: number;
  lastRoll: [number, number] | null;
  /** Doubles rolled in a row this turn, and whether the player rolls again. */
  doubles: number;
  again: boolean;
  /** How many squares the last roll walked (0 = nobody moved), for the animation. */
  walk: number;
  round: number;
  /** What happened, newest last ("P1 rolled 3+4: Hill Rd — rent 24 to P2"); boards name the players. */
  log: string[];
  winner: number | null;
  draw: boolean;
  reason: string;
}

const alive = (s: BankrollState) => s.out.map((o, i) => (o ? -1 : i)).filter((i) => i >= 0);
const groupSquares = (g: string) => BOARD.map((sq, i) => (sq.group === g ? i : -1)).filter((i) => i >= 0);

/** Whether player `p` owns every street of this colour. */
export function ownsSet(s: BankrollState, p: number, group: string): boolean {
  return groupSquares(group).every((i) => s.owner[i] === p);
}

/** The rent on square i to its owner now. */
export function rentOf(s: BankrollState, i: number): number {
  const sq = BOARD[i];
  const o = s.owner[i];
  if (o < 0 || !sq.group) return 0;
  if (!ownsSet(s, o, sq.group)) return sq.rent ?? 0;
  return (sq.rent ?? 0) * HOUSE_RENT[s.houses[i]];
}

/** The squares where player p may build a house now (whole colour, built evenly, cash enough). */
export function buildable(s: BankrollState, p: number): number[] {
  if (s.winner !== null || s.offer >= 0 || s.turn !== p || s.out[p]) return [];
  const out: number[] = [];
  for (const g of Object.keys(HOUSE_COST)) {
    if (!ownsSet(s, p, g) || s.cash[p] < HOUSE_COST[g]) continue;
    const sqs = groupSquares(g);
    const low = Math.min(...sqs.map((i) => s.houses[i]));
    if (low >= MAX_HOUSES) continue;
    out.push(sqs.find((i) => s.houses[i] === low)!);
  }
  return out;
}

export function worth(s: BankrollState, p: number): number {
  return s.cash[p] + BOARD.reduce((a, sq, i) => a + (s.owner[i] === p ? (sq.price ?? 0) + s.houses[i] * HOUSE_COST[sq.group ?? "brown"] : 0), 0);
}

function endIfOne(s: BankrollState, n: number): boolean {
  const last = lastIn(s.out, n);
  if (last === null) return false;
  s.winner = last;
  s.reason = "the last one solvent";
  return true;
}

function nextTurn(s: BankrollState, n: number) {
  s.doubles = 0;
  s.again = false;
  const q = nextIn(s.turn, n, s.out);
  if (q <= s.turn) s.round++;
  s.turn = q;
  if (s.round > ROUNDS && s.winner === null) {
    const left = alive(s);
    const best = Math.max(...left.map((p) => worth(s, p)));
    const tops = left.filter((p) => worth(s, p) === best);
    if (tops.length > 1) {
      s.draw = true;
      s.winner = -1;
      s.reason = `${ROUNDS} rounds — equal riches (${best})`;
    } else {
      s.winner = tops[0];
      s.reason = `richest after ${ROUNDS} rounds (${best})`;
    }
  }
}

/** Player `from` pays `amount` to `to` (−1 = the bank). Short of cash: houses go back at half price; then bankrupt. */
function pay(s: BankrollState, from: number, to: number, amount: number) {
  if (amount <= 0) {
    s.cash[from] -= amount;
    return;
  }
  let sold = 0;
  while (s.cash[from] < amount) {
    // Sell from the most built street first.
    let best = -1;
    BOARD.forEach((_sq, i) => {
      if (s.owner[i] === from && s.houses[i] > 0 && (best < 0 || s.houses[i] > s.houses[best])) best = i;
    });
    if (best < 0) break;
    s.houses[best]--;
    s.cash[from] += HOUSE_COST[BOARD[best].group!] / 2;
    sold++;
  }
  if (sold) s.log.push(`P${from + 1} sold ${sold} house${sold > 1 ? "s" : ""} back to the bank at half price`);
  if (s.cash[from] >= amount) {
    s.cash[from] -= amount;
    if (to >= 0) s.cash[to] += amount;
    return;
  }
  // Bankrupt: the creditor takes what is left (never more than there is).
  const left = Math.max(0, s.cash[from]);
  s.cash[from] = 0;
  s.out[from] = true;
  s.skip[from] = false;
  BOARD.forEach((_sq, i) => {
    if (s.owner[i] !== from) return;
    s.owner[i] = to;
    s.houses[i] = 0;
  });
  s.log.push(to >= 0 ? `P${from + 1} can't pay ${amount} — bankrupt! P${to + 1} gets ₹${left} and their streets` : `P${from + 1} can't pay ${amount} — bankrupt! Their streets go back on sale`);
}

function outcome(s: BankrollState): Outcome {
  if (s.winner === null) return ON;
  if (s.draw) return draw(s.reason, s.cash);
  return win(s.winner, s.reason, s.cash);
}

export const bankroll: GameDef<BankrollState> = {
  id: "bankroll",
  name: "Bankroll",
  blurb: "Fast property trading: buy streets, collect rent, don't go broke.",
  emoji: "🏦",
  minPlayers: 2,
  maxPlayers: 6,
  replay(moves, n, seed) {
    const s: BankrollState = { cash: Array(n).fill(1000), pos: Array(n).fill(0), owner: Array(BOARD.length).fill(-1), houses: Array(BOARD.length).fill(0), out: Array(n).fill(false), skip: Array(n).fill(false), turn: 0, offer: -1, rolls: 0, lastRoll: null, doubles: 0, again: false, walk: 0, round: 1, log: [], winner: null, draw: false, reason: "" };
    /** After a roll is dealt with: roll again on doubles, else the next player. */
    const done = (p: number) => {
      if (endIfOne(s, n)) return;
      if (s.again && !s.out[p]) return;
      nextTurn(s, n);
    };
    for (const m of moves) {
      if (s.winner !== null) return null;
      const p = s.turn;
      s.walk = 0;
      const gone = leaver(m, n);
      if (gone !== null) {
        if (gone < 0 || s.out[gone]) return null;
        s.out[gone] = true;
        s.log.push(`P${gone + 1} left the game — their streets go back on sale`);
        BOARD.forEach((_sq, i) => {
          if (s.owner[i] !== gone) return;
          s.owner[i] = -1;
          s.houses[i] = 0;
        });
        if (endIfOne(s, n)) continue;
        if (gone === p) {
          s.offer = -1;
          nextTurn(s, n);
        }
        continue;
      }
      const build = /^h:(\d+)$/.exec(m);
      if (build) {
        const i = Number(build[1]);
        if (!buildable(s, p).includes(i)) return null;
        const g = BOARD[i].group!;
        s.cash[p] -= HOUSE_COST[g];
        s.houses[i]++;
        s.log.push(`P${p + 1} built a house on ${BOARD[i].name} (rent now ${rentOf(s, i)})`);
        continue;
      }
      if (m === "b" || m === "s") {
        if (s.offer < 0) return null;
        const sq = BOARD[s.offer];
        if (m === "b") {
          if (s.cash[p] < (sq.price ?? 0)) return null;
          s.cash[p] -= sq.price ?? 0;
          s.owner[s.offer] = p;
          s.log.push(`P${p + 1} bought ${sq.name}${sq.group && ownsSet(s, p, sq.group) ? " — the whole colour! Rent doubles, and houses can be built" : ""}`);
        } else s.log.push(`P${p + 1} left ${sq.name} for sale`);
        s.offer = -1;
        done(p);
        continue;
      }
      if (m !== "r" || s.offer >= 0) return null;
      if (s.skip[p]) {
        s.skip[p] = false;
        s.log.push(`P${p + 1} missed a turn in jail — out next turn`);
        nextTurn(s, n);
        continue;
      }
      const a = dice(seed, s.rolls);
      const b = dice(seed, s.rolls + 1);
      s.rolls += 2;
      s.lastRoll = [a, b];
      const doubles = a === b;
      s.doubles = doubles ? s.doubles + 1 : 0;
      s.again = doubles;
      if (s.doubles === 3) {
        s.pos[p] = JAIL;
        s.skip[p] = true;
        s.log.push(`P${p + 1} rolled a third double (${a}+${b}) — to jail, miss a turn`);
        nextTurn(s, n);
        continue;
      }
      const from = s.pos[p];
      const to = (from + a + b) % BOARD.length;
      s.walk = a + b;
      if (to < from) {
        s.cash[p] += 200;
        s.log.push(`P${p + 1} passed Go (+200)`);
      }
      s.pos[p] = to;
      const sq = BOARD[to];
      let landed = `P${p + 1} rolled ${a}+${b}${doubles ? " (doubles — roll again)" : ""}: ${sq.name}`;
      if (sq.kind === "street") {
        const o = s.owner[to];
        if (o === -1) {
          s.offer = to;
          s.log.push(landed + ` — for sale at ₹${sq.price}`);
          continue; // wait for buy / skip
        }
        if (o !== p) {
          const rent = rentOf(s, to);
          s.log.push(`${landed} — rent ${rent} to P${o + 1}`);
          pay(s, p, o, rent);
        } else s.log.push(`${landed} — their own street`);
      } else if (sq.kind === "chance") {
        const amt = CHANCE[(a * 7 + b + s.rolls) % CHANCE.length];
        s.log.push(`${landed} — ${amt > 0 ? `wins ${amt}` : `pays ${-amt}`}`);
        pay(s, p, -1, -amt);
      } else if (sq.kind === "tax") {
        s.log.push(`${landed} — tax 100`);
        pay(s, p, -1, 100);
      } else if (sq.kind === "police") {
        s.pos[p] = JAIL;
        s.skip[p] = true;
        s.again = false;
        s.log.push(`P${p + 1} rolled ${a}+${b}: Go to Jail — miss a turn`);
      } else s.log.push(landed);
      done(p);
    }
    return s;
  },
  turn: (s) => s.turn,
  outcome: (s) => outcome(s),
  summary: (s) => s.cash.map((c, i) => `P${i + 1} ${s.out[i] ? "out" : c}`).join(" · ") + ` · round ${Math.min(s.round, ROUNDS)}/${ROUNDS}`,
};
