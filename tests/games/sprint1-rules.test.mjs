// LANX Games repair, Sprint 1: one test for each serious fault of the audit that lives in
// the rules (the faults in how a match is carried between PCs are in sprint1-match.test.mjs).
// Run: npm run test:games   (Node runs the .ts rule files as they are)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SRC = new URL("../../src/lib/games/", import.meta.url);
const load = (f) => import(new URL(f, SRC).href);
/** A small generator of our own, so that every run of a test plays the same games. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];
const sum = (list) => list.reduce((a, b) => a + b, 0);

// ------------------------------------------------------------------ S1-03
test("S1-03 no game mixes by sorting with a random comparison (that differs between Windows and Linux/iPhone)", () => {
  const bad = [];
  for (const f of fs.readdirSync(SRC).filter((f) => f.endsWith(".ts"))) {
    const text = fs.readFileSync(new URL(f, SRC), "utf8");
    text.split("\n").forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, "");
      if (/\.sort\(\s*\(\s*\)\s*=>/.test(code)) bad.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});

test("S1-03 Wordbox: the letter grids are the fixed ones (the same list must come out of the Linux and iPhone engine)", async () => {
  const { wordboxGrid } = await load("wordbox.ts");
  const grids = JSON.parse(fs.readFileSync(new URL("./wordbox-grids.json", import.meta.url), "utf8"));
  assert.equal(Object.keys(grids).length, 40);
  for (const [key, want] of Object.entries(grids)) {
    const [seed, round] = key.split("|");
    assert.equal(wordboxGrid(seed, Number(round)).join(""), want, key);
  }
  // …and every grid uses each of the sixteen dice once.
  const DICE = ["AAEEGN", "ABBJOO", "ACHOPS", "AFFKPS", "AOOTTW", "CIMOTU", "DEILRX", "DELRVY", "DISTTY", "EEGHNW", "EEINSU", "EHRTVW", "EIOSST", "ELRTTY", "HIMNQU", "HLNNRZ"];
  for (let g = 0; g < 300; g++) {
    const grid = wordboxGrid(`m-dice${g}#1`, 1 + (g % 5));
    assert.equal(grid.length, 16);
    const free = [...DICE];
    // (a matching of letters to dice: try the dice with the fewest fitting letters first)
    const fits = (k, used) => {
      if (k === grid.length) return true;
      for (let d = 0; d < free.length; d++) {
        if (used[d] || !free[d].includes(grid[k])) continue;
        used[d] = true;
        if (fits(k + 1, used)) return true;
        used[d] = false;
      }
      return false;
    };
    assert.ok(fits(0, Array(16).fill(false)), `grid ${grid.join("")} is not one throw of the sixteen dice`);
  }
});

test("S1-03 Werewolf: the roles are dealt fairly (the host was a wolf 32% of the time instead of 20%)", async () => {
  const { dealRoles, wolfCount } = await load("werewolf.ts");
  const { rng } = await load("core.ts");
  for (const [n, fair] of [[5, 1 / 5], [8, 2 / 8], [12, 3 / 12]]) {
    assert.equal(wolfCount(n) / n, fair);
    const wolf = Array(n).fill(0);
    const seer = Array(n).fill(0);
    const DEALS = 20000;
    for (let g = 0; g < DEALS; g++) {
      const roles = dealRoles(n, rng(`m-deal${g}-${n}#1`));
      assert.equal(roles.filter((r) => r === "wolf").length, wolfCount(n));
      assert.equal(roles.filter((r) => r === "seer").length, 1);
      roles.forEach((r, p) => {
        if (r === "wolf") wolf[p]++;
        if (r === "seer") seer[p]++;
      });
    }
    for (let p = 0; p < n; p++) {
      assert.ok(Math.abs(wolf[p] / DEALS - fair) < 0.015, `${n} players: seat ${p + 1} is a wolf in ${((wolf[p] / DEALS) * 100).toFixed(1)}% (fair ${(fair * 100).toFixed(0)}%)`);
      assert.ok(Math.abs(seer[p] / DEALS - 1 / n) < 0.012, `${n} players: seat ${p + 1} is the seer in ${((seer[p] / DEALS) * 100).toFixed(1)}%`);
    }
  }
});

// ------------------------------------------------------------------ S1-04
test("S1-04 Go Fish: the player to move always has somebody to ask, and every game ends", async () => {
  const { gofish } = await load("gofish.ts");
  const { RANKS } = await load("cards.ts");
  /** What the board offers: a rank you hold, from someone else at the table who holds cards. */
  const boardMoves = (s) => {
    const hand = s.hands[s.turn] ?? [];
    const out = [];
    for (const r of RANKS.filter((r) => hand.some((c) => c[0] === r))) s.hands.forEach((h, p) => p !== s.turn && h.length > 0 && !s.gone[p] && out.push(`a:${p}:${r}`));
    return out;
  };
  for (const n of [2, 3, 4, 6]) {
    for (let g = 0; g < 250; g++) {
      const seed = `m-audit${g}-gofish#1`;
      const r = prng(1000 * n + g);
      const moves = [];
      let s = gofish.replay(moves, n, seed);
      for (let step = 0; !gofish.outcome(s, n).over; step++) {
        assert.ok(step < 3000, `${n} players, ${seed}: the game does not end`);
        // Nobody sits with an empty hand while the stock has cards.
        if (s.stock.length) s.hands.forEach((h, p) => assert.ok(s.gone[p] || h.length > 0, `${n} players, ${seed}, after ${moves.length} moves: P${p + 1} holds nothing though the stock has ${s.stock.length} cards`));
        const offered = boardMoves(s);
        assert.ok(offered.length > 0, `${n} players, ${seed}, after ${moves.length} moves: P${s.turn + 1} has nobody to ask (${moves.join(" ")})`);
        moves.push(pick(r, offered));
        s = gofish.replay(moves, n, seed);
        assert.ok(s, `${n} players, ${seed}: the rules refuse a move the board offers (${moves.at(-1)})`);
      }
      assert.equal(sum(s.books.map((b) => (Array.isArray(b) ? b.length : b))), 13, `${n} players, ${seed}: all thirteen books are laid when the game is over`);
    }
  }
});

// ------------------------------------------------------------------ S1-05
test("S1-05 Dominoes: the game is only called blocked when nobody at the table can play", async () => {
  const { dominoes, dominoPlayable } = await load("dominoes.ts");
  // The audit's case: P1 opens, P2 and P3 pass, P1 leaves. P2 can now play (the tiles of
  // someone who left are gone from the count) — the game used to end "blocked" here.
  const s = dominoes.replay("p:6-6:r,x,x,x0".split(","), 3, "dm3-129");
  assert.ok(s);
  assert.equal(dominoes.outcome(s, 3).over, false);
  assert.ok(dominoPlayable(s, s.hands[s.turn]).length > 0);

  // Random games with people leaving: a game that ends blocked really is blocked, and a
  // game never goes on with nobody able to play.
  for (const n of [2, 3, 4]) {
    for (let g = 0; g < 300; g++) {
      const seed = `dm${n}-${g}`;
      const r = prng(77 * n + g);
      const moves = [];
      let s = dominoes.replay(moves, n, seed);
      for (let step = 0; !dominoes.outcome(s, n).over; step++) {
        assert.ok(step < 400, `${seed}: the game does not end`);
        const canPlay = (p) => !s.out[p] && dominoPlayable(s, s.hands[p]).length > 0;
        const nobody = s.line.length > 0 && !s.hands.some((_, p) => canPlay(p));
        const mine = dominoPlayable(s, s.hands[s.turn]);
        const stay = s.out.filter((o) => !o).length;
        let move;
        if (stay > 2 && r() < 0.04) move = `x${pick(r, s.out.map((o, p) => (o ? -1 : p)).filter((p) => p >= 0))}`;
        else if (mine.length) {
          const m = pick(r, mine);
          move = `p:${m.tile[0]}-${m.tile[1]}:${m.end}`;
        } else move = "x";
        const next = dominoes.replay([...moves, move], n, seed);
        assert.ok(next, `${seed}: refused ${move} after ${moves.join(",")}`);
        moves.push(move);
        s = next;
        // Nobody could play: the pass of the player to move ends the game at once (it used to take a pass from everyone).
        if (nobody && move === "x") assert.equal(dominoes.outcome(s, n).over, true, `${seed}: nobody can play, P passed, and the game goes on (${moves.join(",")})`);
      }
      const o = dominoes.outcome(s, n);
      if (/block/i.test(o.reason)) s.hands.forEach((h, p) => assert.ok(s.out[p] || dominoPlayable(s, h).length === 0, `${seed}: called blocked, but P${p + 1} can play (${moves.join(",")})`));
    }
  }
});

// ------------------------------------------------------------------ S1-06
test("S1-06 Draw & Guess: the game ends when everyone who still had a drawing turn has left", async () => {
  const { drawGuess } = await load("drawguess.ts");
  const T = 1_700_000_000_000;
  const seed = "m-dg#1";
  // Three players, six drawing turns (P1 P2 P3 P1 P2 P3). Five rounds are played…
  const moves = [];
  for (let r = 1; r <= 5; r++) moves.push(`o:${r}:${T}`, `e:${r}`);
  let s = drawGuess.replay(moves, 3, seed);
  assert.ok(s);
  assert.equal(drawGuess.outcome(s, 3).over, false);
  assert.equal(s.extra.drawer, 1);
  // …then P3, who owns the last one, leaves between the rounds. Nothing is left to play.
  s = drawGuess.replay([...moves, "x2"], 3, seed);
  assert.ok(s);
  assert.equal(drawGuess.outcome(s, 3).over, true, "the game is over (it used to wait for a round that could not open)");

  // Random tables with people leaving at any moment: a game that is not over can always open its next round.
  for (const n of [3, 4, 5, 8]) {
    for (let g = 0; g < 300; g++) {
      const sd = `m-dg${n}-${g}#1`;
      const r = prng(31 * n + g);
      const list = [];
      let st = drawGuess.replay(list, n, sd);
      for (let round = 1; !drawGuess.outcome(st, n).over; round++) {
        assert.ok(round < 30, `${sd}: does not end`);
        const leave = () => {
          const there = st.out.map((o, p) => (o ? -1 : p)).filter((p) => p >= 0);
          if (there.length > 1 && r() < 0.18) {
            list.push(`x${pick(r, there)}`);
            st = drawGuess.replay(list, n, sd);
            assert.ok(st, `${sd}: a player leaving was refused (${list.join(" ")})`);
          }
        };
        leave();
        if (drawGuess.outcome(st, n).over) break;
        const opened = drawGuess.replay([...list, `o:${st.round + 1}:${T}`], n, sd);
        assert.ok(opened, `${sd}: not over, but the next round cannot open (${list.join(" ")})`);
        list.push(`o:${st.round + 1}:${T}`);
        st = opened;
        leave();
        if (drawGuess.outcome(st, n).over) break;
        if (st.open) {
          list.push(`e:${st.round}`);
          st = drawGuess.replay(list, n, sd);
          assert.ok(st, `${sd}: closing the round was refused (${list.join(" ")})`);
        }
      }
    }
  }
});

// ------------------------------------------------------------------ S1-07
test("S1-07 Mahjong Duels: the table is always cleared, honours count double, and either player can win", async () => {
  const { mahjong, mjFree, mjValue } = await load("mahjong.ts");
  assert.equal(mjValue("🀀"), 2);
  assert.equal(mjValue("🀆"), 2);
  assert.equal(mjValue("🀇"), 1);
  assert.equal(mahjong.replay(["0,9999999"], 2, "m-mj#1"), null, "a tile number far off the table is refused");
  const wins = [0, 0];
  let draws = 0;
  const GAMES = 300;
  for (let g = 0; g < GAMES; g++) {
    const seed = `m-mj${g}#1`;
    const r = prng(9000 + g);
    const moves = [];
    let s = mahjong.replay(moves, 2, seed);
    for (let step = 0; !mahjong.outcome(s, 2).over; step++) {
      assert.ok(step < 200, `${seed}: does not end`);
      const free = s.tiles.map((t, i) => (t && mjFree(s.tiles, i) ? i : -1)).filter((i) => i >= 0);
      const pairs = [];
      for (let a = 0; a < free.length; a++) for (let b = a + 1; b < free.length; b++) if (s.tiles[free[a]] === s.tiles[free[b]]) pairs.push(`${free[a]},${free[b]}`);
      assert.ok(pairs.length > 0, `${seed}: tiles are left but no pair is free (the table was not shuffled again)`);
      moves.push(pick(r, pairs));
      s = mahjong.replay(moves, 2, seed);
      assert.ok(s, `${seed}: a free pair was refused`);
    }
    assert.ok(s.tiles.every((t) => t === null), `${seed}: the game ended with tiles on the table`);
    // 36 pairs, 7 kinds of honours (2 points) and 29 others (1 point).
    assert.equal(sum(s.scores), 7 * 2 + 29, `${seed}: the points do not add up`);
    const o = mahjong.outcome(s, 2);
    if (o.draw) draws++;
    else wins[o.winner]++;
  }
  // (An odd total: no game can be drawn. It used to be: first player wins or a draw, never the second.)
  assert.equal(draws, 0);
  assert.ok(wins[1] > GAMES * 0.35 && wins[0] > GAMES * 0.35, `first player won ${wins[0]}, second ${wins[1]} of ${GAMES}`);
});

// ------------------------------------------------------------------ S1-08
test("S1-08 Bankroll: the creditor really gets a bankrupt player's cash, and the scores are what decides the game", async () => {
  const { bankroll } = await load("bankroll.ts");
  const moves = "r,r,b,r,b,r,r,b,r,b,r,r,b,r,r,r,b,r,b,r,r,b,r,b,r,r,r".split(",");
  const before = bankroll.replay(moves.slice(0, -1), 3, "s1405");
  const after = bankroll.replay(moves, 3, "s1405");
  assert.deepEqual(before.cash, [42, 850, 1068]);
  assert.deepEqual(after.out, [true, false, false]);
  assert.deepEqual(after.cash, [0, 892, 1068], "P2 was owed 48 and gets the 42 that P1 had left");

  // Random games to the end: the winner is the one with the highest score shown.
  let finished = 0;
  for (let g = 0; g < 120; g++) {
    const n = 2 + (g % 3);
    const seed = `m-br${g}#1`;
    const r = prng(500 + g);
    const moves = [];
    let s = bankroll.replay(moves, n, seed);
    for (let step = 0; step < 4000 && !bankroll.outcome(s, n).over; step++) {
      const options = ["r", "b", "s", "h", "e", "p"].filter((m) => bankroll.replay([...moves, m], n, seed));
      if (!options.length) break;
      // (buy most of the time when it is offered: games end sooner)
      moves.push(options.includes("b") && r() < 0.8 ? "b" : pick(r, options));
      s = bankroll.replay(moves, n, seed);
    }
    const o = bankroll.outcome(s, n);
    if (!o.over) continue;
    finished++;
    const best = Math.max(...o.scores);
    if (o.draw) assert.ok(o.scores.filter((x) => x === best).length > 1, `${seed}: a draw without equal top scores ${o.scores}`);
    else assert.equal(o.scores[o.winner], best, `${seed}: P${o.winner + 1} won with ${o.scores[o.winner]} while the scores are ${o.scores}`);
    s.out.forEach((gone, p) => gone && assert.equal(o.scores[p], 0));
  }
  assert.ok(finished >= 60, `only ${finished} of 120 random games finished`);
});

// ------------------------------------------------------------------ S1-09
test("S1-09 Tap Roulette: the wheel is random from round to round", async () => {
  const { tapRoulette, drawOf } = await load("party.ts");
  const T = 1_700_000_000_000;
  const G = 4000;
  for (const n of [2, 4, 8]) {
    const patterns = new Map();
    const lost = Array(n).fill(0);
    let drawn = 0;
    for (let i = 0; i < G; i++) {
      const seed = `m-${(i * 7919).toString(36)}-${(i * 31).toString(36)}#${1 + (i % 3)}`;
      const moves = [];
      const losers = [];
      let s;
      for (let round = 1; round <= 5; round++) {
        moves.push(`o:${round}:${T}`);
        for (let p = 0; p < n; p++) moves.push(`${p}@a:in`);
        moves.push(`e:${round}`);
        s = tapRoulette.replay(moves, n, seed);
        assert.ok(s, `${seed}: refused`);
        assert.equal(s.extra.losers.length, 1);
        losers.push(s.extra.losers[0]);
        lost[s.extra.losers[0]]++;
      }
      const rel = losers.map((l) => (l - losers[0] + n) % n).join("");
      patterns.set(rel, (patterns.get(rel) ?? 0) + 1);
      if (tapRoulette.outcome(s, n).draw) drawn++;
    }
    // Every seat loses about as often as any other…
    for (let p = 0; p < n; p++) assert.ok(Math.abs(lost[p] / (G * 5) - 1 / n) < 0.02, `${n} players: seat ${p + 1} lost ${((lost[p] / (G * 5)) * 100).toFixed(1)}% of the rounds`);
    // …and who loses after whom has no pattern. (Two players: it used to be 01010 every time.)
    const most = Math.max(...patterns.values());
    if (n === 2) {
      assert.equal(patterns.size, 16, "two players: all sixteen orders of losers come up");
      assert.ok(most / G < 0.1, `two players: one order of losers came in ${((most / G) * 100).toFixed(0)}% of the matches`);
    } else assert.ok(patterns.size > 200 && most / G < 0.03, `${n} players: ${patterns.size} orders of losers, the most common in ${((most / G) * 100).toFixed(1)}%`);
    // Two players, five rounds: never a draw. Four players: it used to be a three-way draw every time.
    // (Eight players: five rounds with one loser each leave at least three players unbeaten, so first
    // place is always shared. That is how the game is laid out, not the wheel: see the checklist, S3.)
    if (n === 2) assert.equal(drawn, 0);
    if (n === 4) assert.ok(drawn / G < 0.85, `four players: ${((drawn / G) * 100).toFixed(0)}% of the matches are drawn`);
  }
  assert.equal(drawOf("abc"), drawOf("abc"));
  assert.notEqual(drawOf("abc#tap1"), drawOf("abc#tap2"));
});

// ------------------------------------------------------------------ S1-10
test("S1-10 a big table: players 11 and 12 can leave", async () => {
  const { leaver } = await load("core.ts");
  assert.equal(leaver("x9", 12), 9);
  assert.equal(leaver("x10", 12), 10);
  assert.equal(leaver("x11", 12), 11);
  assert.equal(leaver("x12", 12), -1, "nobody has that number at a table of twelve");
  assert.equal(leaver("x1", 2), 1);
  assert.equal(leaver("x5", 3), -1);
  for (const other of ["x", "x100", "x1a", "xx", "x-1", "x 1", "1x", ""]) assert.equal(leaver(other, 12), null, JSON.stringify(other));

  // Werewolf at twelve: when player 12 leaves, the game goes on for the other eleven.
  const { werewolf } = await load("werewolf.ts");
  const start = werewolf.replay([], 12, "m-ww12#1");
  assert.ok(start);
  for (const p of [10, 11]) {
    const s = werewolf.replay([`x${p}`], 12, "m-ww12#1");
    assert.ok(s, `x${p} is understood`);
    assert.equal(werewolf.outcome(s, 12).over, false);
  }
});

// ------------------------------------------------------------------ S1-11
test("S1-11 2048: Up sends the tiles up and Down sends them down", async () => {
  const { move2048, canMove, addTile, empty, topTile } = await load("solo2048.ts");
  const g = empty();
  g[1][2] = 2;
  g[2][2] = 2;
  g[3][0] = 4;
  const row = (grid, r) => grid[r].join(" ");
  const up = move2048(g, "up");
  assert.equal(row(up.grid, 0), "4 0 4 0");
  assert.equal(sum(up.grid.flat()), 8);
  assert.equal(up.gained, 4);
  const down = move2048(g, "down");
  assert.equal(row(down.grid, 3), "4 0 4 0");
  assert.equal(row(down.grid, 0), "0 0 0 0");
  const left = move2048(g, "left");
  assert.deepEqual(left.grid.map((r) => r[0]), [0, 2, 2, 4]);
  const right = move2048(g, "right");
  assert.deepEqual(right.grid.map((r) => r[3]), [0, 2, 2, 4]);
  assert.equal(move2048(up.grid, "up").moved, false);

  // Against a plain second way of working it out, on random boards, in all four directions.
  const r = prng(2048);
  const plain = (grid, dir) => {
    const out = empty();
    for (let k = 0; k < 4; k++) {
      // the line of four as read from the side the tiles slide towards
      const cells = [0, 1, 2, 3].map((i) => (dir === "left" ? [k, i] : dir === "right" ? [k, 3 - i] : dir === "up" ? [i, k] : [3 - i, k]));
      const vals = cells.map(([y, x]) => grid[y][x]).filter((v) => v);
      const merged = [];
      for (let i = 0; i < vals.length; i++) {
        if (vals[i] === vals[i + 1]) merged.push(vals[i++] * 2);
        else merged.push(vals[i]);
      }
      merged.forEach((v, i) => (out[cells[i][0]][cells[i][1]] = v));
    }
    return out;
  };
  for (let t = 0; t < 2000; t++) {
    const grid = empty().map((line) => line.map(() => (r() < 0.45 ? 0 : 2 ** (1 + Math.floor(r() * 4)))));
    for (const dir of ["left", "right", "up", "down"]) assert.deepEqual(move2048(grid, dir).grid, plain(grid, dir), `${dir} on ${JSON.stringify(grid)}`);
  }
  // A new tile lands on a free square only, and a full board with no equal neighbours is over.
  let board = empty();
  for (let i = 0; i < 16; i++) board = addTile(board, r);
  assert.equal(board.flat().filter((v) => v).length, 16);
  assert.equal(canMove([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]]), false);
  assert.equal(topTile([[2, 4, 2, 4], [4, 2, 64, 2], [2, 4, 2, 4], [4, 2, 4, 2]]), 64);
});

// ------------------------------------------------------------------ S1-12
test("S1-12 Hold'em: no chips vanish (side pots when players have folded or left)", async () => {
  const { holdem } = await load("holdem.ts");
  // The chips on the table: those in front of the players plus those paid into the hand being
  // played (when the game is over the last pot has been paid out; what the hand list still shows is history).
  const total = (s) => sum(s.chips) + (s.over ? 0 : sum(s.contributed));
  // The audit's hand: 960 chips used to vanish from the table.
  const start = holdem.replay([], 3, "m-u1#1");
  const s = holdem.replay("r:990 c c c c c c c c c c c c f".split(" "), 3, "m-u1#1");
  assert.ok(s);
  assert.equal(total(start), 3000);
  assert.equal(total(s), 3000);

  // Random tables, people folding, going all in and leaving: the chips on the table never change.
  for (let g = 0; g < 400; g++) {
    const n = 2 + (g % 7);
    const seed = `m-he${g}#1`;
    const r = prng(4000 + g);
    const moves = [];
    let st = holdem.replay(moves, n, seed);
    const chips = total(st);
    for (let step = 0; step < 400 && !holdem.outcome(st, n).over; step++) {
      const there = st.gone.map((o, p) => (o ? -1 : p)).filter((p) => p >= 0);
      const tries = ["c", "c", "c", "f", `r:${10 * (1 + Math.floor(r() * 30))}`, `r:${st.chips[st.turn] ?? 0}`, "r:5000"];
      if (there.length > 2 && r() < 0.03) tries.unshift(`x${pick(r, there)}`);
      let next = null;
      for (let k = 0; k < 6 && !next; k++) {
        const m = k === 0 && tries[0].startsWith("x") ? tries[0] : pick(r, tries);
        next = holdem.replay([...moves, m], n, seed);
        if (next) moves.push(m);
      }
      if (!next) {
        for (const m of ["c", "f"]) {
          next = holdem.replay([...moves, m], n, seed);
          if (next) {
            moves.push(m);
            break;
          }
        }
      }
      if (!next) break;
      st = next;
      assert.equal(total(st), chips, `${seed}, ${n} players: ${chips} chips became ${total(st)} after ${moves.join(" ")}`);
    }
  }
});
