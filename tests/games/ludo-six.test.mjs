// LANX 3.19.0: Ludo for five and six players, on a six-sided board — and proof that Ludo for two
// to four players is exactly what it was.
// Run: npm run test:games
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";

const SRC = new URL("../../src/lib/games/", import.meta.url);
const load = (f) => import(new URL(f, SRC).href);
const rng = (seed) => {
  let a = seed >>> 0;
  return () => ((a = (a * 1103515245 + 12345) >>> 0) / 4294967296);
};

test("Ludo for 2 to 4 players is unchanged: twelve whole games of LANX 3.18.0 replay to the very same positions", async () => {
  const { ludo } = await load("ludo.ts");
  const games = JSON.parse(fs.readFileSync(new URL("./ludo-3180.json", import.meta.url), "utf8"));
  assert.equal(games.length, 12);
  for (const g of games) {
    const moves = g.moves.split(" ");
    const hash = createHash("sha256");
    let s = null;
    for (let i = 1; i <= moves.length; i++) {
      s = ludo.replay(moves.slice(0, i), g.n, g.seed);
      assert.ok(s, `${g.seed}: move ${i} (${moves[i - 1]}) is still allowed`);
      hash.update(JSON.stringify(s));
    }
    assert.equal(hash.digest("hex"), g.positions, `${g.seed}: every position on the way is the same`);
    assert.deepEqual(s, g.last, `${g.seed}: the same end`);
    assert.equal(ludo.summary(s), g.summary);
    assert.deepEqual(JSON.parse(JSON.stringify(ludo.outcome(s))), g.outcome);
  }
});

test("Ludo: the four-sided board for 2 to 4, the six-sided board for 5 and 6", async () => {
  const L = await load("ludo.ts");
  for (const n of [2, 3, 4]) {
    assert.equal(L.ludoArms(n), 4);
    assert.equal(L.ludoTrack(n), 52);
    assert.equal(L.ludoLast(n), 50);
    assert.equal(L.ludoFinish(n), 56);
  }
  for (const n of [5, 6]) {
    assert.equal(L.ludoArms(n), 6);
    assert.equal(L.ludoTrack(n), 78);
    assert.equal(L.ludoLast(n), 76);
    assert.equal(L.ludoFinish(n), 82);
  }
  assert.equal(L.ludo.minPlayers, 2);
  assert.equal(L.ludo.maxPlayers, 6);
  // The safe squares of the four-sided board are the eight they always were.
  assert.deepEqual([...Array(52).keys()].filter(L.ludoSafe), [0, 8, 13, 21, 26, 34, 39, 47]);
  // On the six-sided board: six start squares and six stars.
  assert.deepEqual([...Array(78).keys()].filter(L.ludoSafe), [0, 8, 13, 21, 26, 34, 39, 47, 52, 60, 65, 73]);
  // Every player has a corner of their own, and starts one arm on from the player before.
  for (const n of [5, 6]) {
    const corners = [...Array(n).keys()].map((p) => L.ludoCorner(p, n));
    assert.deepEqual(corners, [...Array(n).keys()]);
    assert.deepEqual(corners.map((c) => L.startOf(c, n)), corners.map((c) => c * 13));
    for (let c = 0; c < 6; c++) assert.equal(L.ludoPlayerAt(c, n), c < n ? c : -1);
  }
  // A token's way: its own start, all the way round to the square before its start's arm end, never past it.
  assert.equal(L.toAbsolute(0, 76, 6), 76);
  assert.equal(L.toAbsolute(5, 0, 6), 65);
  assert.equal(L.toAbsolute(5, 13, 6), 0, "the sixth colour passes the first colour's start");
  assert.equal(L.toAbsolute(5, 76, 6), 63);
});

test("Ludo for 5 and 6: the six-sided board has a square for every step, and no two in one place", async () => {
  const H = await load("ludoHex.ts");
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  assert.equal(H.HEX_LOOP.length, 78);
  assert.equal(H.HEX_HOME.length, 6);
  // One square on is one square away (a little more where the track turns from one arm into the next).
  H.HEX_LOOP.forEach((s, i) => {
    const step = d(s, H.HEX_LOOP[(i + 1) % 78]);
    assert.ok(step > 0.99 && step < 1.4, `square ${i} → ${i + 1}: ${step.toFixed(3)}`);
  });
  const squares = [...H.HEX_LOOP, ...H.HEX_HOME.flat()];
  assert.equal(squares.length, 78 + 30);
  for (let i = 0; i < squares.length; i++) for (let j = i + 1; j < squares.length; j++) assert.ok(d(squares[i], squares[j]) > 0.99, `squares ${i} and ${j} do not overlap`);
  for (let c = 0; c < 6; c++) {
    // The home squares lead from the arm's end square straight towards the middle.
    const entry = H.HEX_LOOP[(c * 13 + 76) % 78];
    assert.ok(Math.abs(d(entry, H.HEX_HOME[c][0]) - 1) < 1e-9, "the first home square is next to the arm's end");
    for (let h = 1; h < 5; h++) assert.ok(Math.abs(d(H.HEX_HOME[c][h - 1], H.HEX_HOME[c][h]) - 1) < 1e-9);
    const mid = (s) => Math.hypot(s.x, s.y);
    for (let h = 1; h < 5; h++) assert.ok(mid(H.HEX_HOME[c][h]) < mid(H.HEX_HOME[c][h - 1]), "towards the middle");
    // The yard's four spots lie in its court, clear of every square, and on the board.
    for (let t = 0; t < 4; t++) {
      const spot = H.hexSpot(c, t);
      assert.ok(d(spot, H.hexYard(c)) + 0.62 < H.HEX_YARD_R, "inside the court");
      for (const s of squares) assert.ok(d(spot, s) > 1.3, "clear of the track");
      assert.ok(mid(spot) + 0.62 < H.HEX_EDGE, "on the board");
    }
    // The places a token can stand on, by its own count.
    assert.deepEqual(H.hexPlace(c, -1, 2), H.hexSpot(c, 2));
    assert.deepEqual(H.hexPlace(c, 0, 0), H.HEX_LOOP[c * 13]);
    assert.deepEqual(H.hexPlace(c, 76, 0), entry);
    assert.deepEqual(H.hexPlace(c, 77, 0), H.HEX_HOME[c][0]);
    assert.deepEqual(H.hexPlace(c, 81, 0), H.HEX_HOME[c][4]);
    assert.deepEqual(H.hexPlace(c, 82, 3), H.hexIn(c, 3));
    assert.ok(mid(H.hexIn(c, 0)) < 3, "home is the field in the middle");
  }
  // Turned by a sixth, the board lies on itself (every arm is the same).
  const turn = (s) => ({ x: s.x * 0.5 - s.y * Math.sin(Math.PI / 3), y: s.x * Math.sin(Math.PI / 3) + s.y * 0.5 });
  for (let i = 0; i < 78; i++) assert.ok(d(turn(H.HEX_LOOP[i]), H.HEX_LOOP[(i + 13) % 78]) < 1e-9);
});

test("Ludo for 5 and 6: whole games play to the end, by the same rules", async () => {
  const { ludo, ludoMovable, ludoFinish, ludoLast, ludoSafe, toAbsolute } = await load("ludo.ts");
  for (const n of [5, 6]) {
    const finish = ludoFinish(n);
    let knocks = 0;
    let homes = 0;
    for (const game of [1, 2, 3, 4, 5, 6]) {
      const seed = `six-${n}-${game}`;
      const rnd = rng(n * 911 + game * 31);
      const moves = [];
      let s = ludo.replay(moves, n, seed);
      assert.equal(s.pos.length, n);
      const leaveAt = game % 3 === 0 ? 60 + game * 20 : -1;
      for (let ply = 0; ply < 9000 && s.winner === null; ply++) {
        let m;
        if (ply === leaveAt) m = `x${(s.turn + 2) % n}`;
        else if (!s.roll) m = "r";
        else {
          const can = ludoMovable(s);
          assert.ok(can.length > 0, "a roll that is waiting can be played");
          m = `m:${can[Math.floor(rnd() * can.length)]}`;
        }
        const before = s;
        moves.push(m);
        s = ludo.replay(moves, n, seed);
        assert.ok(s, `${seed}: ${m} is allowed`);
        if (s.event === "knock" && m.startsWith("m:")) {
          knocks++;
          // A knock happens on the track, never on a safe square, and sends exactly one token home.
          const t = Number(m.slice(2));
          const at = s.pos[before.turn][t];
          assert.ok(at <= ludoLast(n));
          assert.equal(ludoSafe(toAbsolute(before.turn, at, n)), false);
          assert.equal(s.pos[s.victim].filter((x) => x === -1).length, before.pos[s.victim].filter((x) => x === -1).length + 1);
        }
        if (s.event === "home" && m.startsWith("m:")) homes++;
        for (const row of s.pos) for (const x of row) assert.ok(x >= -1 && x <= finish, "every token is on the board");
      }
      assert.notEqual(s.winner, null, `${seed}: the game ends`);
      const o = ludo.outcome(s);
      assert.equal(o.over, true);
      assert.equal(o.winner, s.winner);
      assert.ok(s.pos[s.winner].every((x) => x === finish) || s.out.filter((x) => !x).length === 1);
      assert.equal(ludo.replay([...moves, "r"], n, seed), null, "nothing more after the end");
    }
    assert.ok(knocks > 5, `${n} players: tokens were knocked out (${knocks})`);
    assert.ok(homes > 10, `${n} players: tokens came home (${homes})`);
  }
});

test("Ludo for 6: the long way round, the exact number home, and a knock where two colours' ways cross", async () => {
  const { ludo, ludoMovable, toAbsolute } = await load("ludo.ts");
  // Find, by playing at random, positions that show each rule; then check the rule on them.
  let exact = 0;
  let lane = 0;
  let crossed = 0;
  for (let game = 0; game < 30 && (exact < 3 || lane < 3 || crossed < 3); game++) {
    const seed = `six-rules-${game}`;
    const rnd = rng(4242 + game);
    const moves = [];
    let s = ludo.replay(moves, 6, seed);
    for (let ply = 0; ply < 6000 && s.winner === null; ply++) {
      let m = "r";
      if (s.roll) {
        const can = ludoMovable(s);
        // A token in its home squares needs the exact number: 82 is home, and nothing goes past it.
        s.pos[s.turn].forEach((x, t) => {
          if (x >= 77 && x < 82) {
            lane++;
            assert.equal(can.includes(t), x + s.roll <= 82, `from ${x} with a ${s.roll}`);
            if (x + s.roll > 82) exact++;
          }
        });
        m = `m:${can[Math.floor(rnd() * can.length)]}`;
      }
      const before = s;
      moves.push(m);
      s = ludo.replay(moves, 6, seed);
      assert.ok(s);
      if (s.event === "knock" && m.startsWith("m:")) {
        const t = Number(m.slice(2));
        const abs = toAbsolute(before.turn, s.pos[before.turn][t], 6);
        const was = before.pos[s.victim].find((x, k) => s.pos[s.victim][k] === -1 && x >= 0);
        assert.equal(toAbsolute(s.victim, was, 6), abs, "both stood on the same square of the shared track");
        if (Math.abs(before.turn - s.victim) > 1) crossed++;
      }
    }
  }
  assert.ok(lane >= 3 && exact >= 3, "the exact number was needed");
  assert.ok(crossed >= 3, "colours from far apart met on the track");
  // A token never leaves the track before it has been all the way round: 76 squares, then home squares.
  const one = ludo.replay([], 6, "x");
  assert.deepEqual(one.pos, Array.from({ length: 6 }, () => [-1, -1, -1, -1]));
  assert.deepEqual(one.out, [false, false, false, false, false, false]);
});

test("Ludo: six places at the table; a table of five or six needs LANX 3.19.0 on every PC, four do not", async () => {
  const G = await import(new URL("../../src/lib/games.ts", import.meta.url).href);
  const meta = G.gameMeta("ludo");
  assert.equal(meta.minPlayers, 2);
  assert.equal(meta.maxPlayers, 6);
  for (const n of [2, 3, 4, 5, 6]) assert.equal(G.sizeOk(meta, n), true);
  assert.equal(G.sizeOk(meta, 7), false);
  for (const n of [2, 3, 4]) assert.equal(G.needsVersionFor("ludo", n), "2.17.1");
  for (const n of [5, 6]) assert.equal(G.needsVersionFor("ludo", n), "3.19.0");
  assert.equal(G.needsVersionFor("bankroll", 6), G.needsVersion("bankroll"));
  assert.equal(G.localMatch("ludo", 6).seats.length, 6);
  assert.equal(G.localMatch("ludo", 9).seats.length, 6);
});
