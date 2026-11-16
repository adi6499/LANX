// LANX Games repair, Sprint 3: the three games played alone — Snake (S3-10), Minesweeper (S3-11)
// and 2048 (S3-13). Their rules are in src/lib/games/solo*.ts; the boards only draw them.
// Run: npm run test:games
import test from "node:test";
import assert from "node:assert/strict";

const SRC = new URL("../../src/lib/games/", import.meta.url);
const load = (f) => import(new URL(f, SRC).href);
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ S3-10 Snake
test("S3-10 Snake: moving into the square the tail is leaving is not a bite", async () => {
  const { snakeStep } = await load("soloSnake.ts");
  // A snake going round a small block: the head is about to step where the tail is now.
  //   head (5,5) → right to (6,5), which is the tail's square.
  const s = { snake: [[5, 5], [5, 6], [6, 6], [6, 5]], dir: "R", turns: [], food: [15, 15], eaten: 1, dead: false, full: false };
  const next = snakeStep(s);
  assert.equal(next.dead, false, "the tail moved out as the head moved in");
  assert.deepEqual(next.snake, [[6, 5], [5, 5], [5, 6], [6, 6]]);
  // …and it can go round and round like that.
  let t = next;
  for (const d of ["D", "L", "U", "R", "D", "L", "U"]) t = snakeStep({ ...t, turns: [d] });
  assert.equal(t.dead, false);
});

test("S3-10 Snake: a real bite still ends the game, and so does the wall", async () => {
  const { snakeStep, SNAKE_N } = await load("soloSnake.ts");
  // Five long, turning back into its own middle.
  const s = { snake: [[5, 5], [5, 6], [6, 6], [6, 5], [7, 5]], dir: "R", turns: [], food: [15, 15], eaten: 2, dead: false, full: false };
  assert.equal(snakeStep(s).dead, true, "(6,5) is still body: the tail is at (7,5)");
  // Eating does not free the tail's square: a snake that grows into its own tail has bitten itself.
  const grow = { snake: [[5, 5], [5, 6], [6, 6], [6, 5]], dir: "R", turns: [], food: [6, 5], eaten: 1, dead: false, full: false };
  assert.equal(snakeStep(grow).dead, true);
  const wall = { snake: [[SNAKE_N - 1, 3], [SNAKE_N - 2, 3]], dir: "R", turns: [], food: [1, 1], eaten: 0, dead: false, full: false };
  assert.equal(snakeStep(wall).dead, true);
  assert.equal(snakeStep(snakeStep(wall)).snake.length, 2, "a dead snake does not move");
});

test("S3-10 Snake: two quick turns both count; straight back and a third turn are refused", async () => {
  const { snakeStart, snakeTurn, snakeStep } = await load("soloSnake.ts");
  let s = snakeStart(prng(1));
  assert.equal(s.dir, "R");
  assert.equal(snakeTurn(s, "L"), s, "straight back into itself");
  assert.equal(snakeTurn(s, "R"), s, "the way it is going already");
  s = snakeTurn(s, "U");
  s = snakeTurn(s, "L"); // pressed before the snake has taken its next step
  assert.deepEqual(s.turns, ["U", "L"]);
  assert.equal(snakeTurn(s, "D"), s, "no third turn waits");
  assert.equal(snakeTurn(s, "R"), s, "straight back from the last waiting turn");
  const a = snakeStep(s, prng(2));
  assert.deepEqual(a.snake[0], [10, 9], "first up");
  const b = snakeStep(a, prng(2));
  assert.deepEqual(b.snake[0], [9, 9], "then left");
  assert.equal(b.dead, false);
});

test("S3-10 Snake: the food always lands on a free square, also on a nearly full board", async () => {
  const { snakeFood, snakeStep, SNAKE_N } = await load("soloSnake.ts");
  // Every square taken but two.
  const all = [];
  for (let y = 0; y < SNAKE_N; y++) for (let x = 0; x < SNAKE_N; x++) all.push([x, y]);
  const snake = all.slice(0, all.length - 2);
  const seen = new Set();
  const r = prng(7);
  for (let i = 0; i < 200; i++) {
    const f = snakeFood(snake, r);
    assert.ok(f && !snake.some(([x, y]) => x === f[0] && y === f[1]));
    seen.add(f.join(","));
  }
  assert.equal(seen.size, 2, "both free squares are used");
  assert.equal(snakeFood(all, r), null, "a full board has no room for food");
  assert.equal(snakeFood(snake, () => 0.999999999).join(","), `${SNAKE_N - 1},${SNAKE_N - 1}`);
  // The last bite fills the board: the game is over, and won.
  const row = [];
  for (let y = 0; y < SNAKE_N; y++) {
    const xs = [...Array(SNAKE_N).keys()];
    for (const x of y % 2 ? xs.reverse() : xs) row.push([x, y]);
  }
  const body = row.slice(0, row.length - 1).reverse(); // head at the square before the last one
  const last = row[row.length - 1];
  const dir = last[0] > body[0][0] ? "R" : "L";
  const end = snakeStep({ snake: body, dir, turns: [], food: last, eaten: 5, dead: false, full: false }, r);
  assert.equal(end.full, true);
  assert.equal(end.dead, true);
  assert.equal(end.eaten, 6);
});

test("S3-10 Snake: a held key, or one pressed in the moment of the crash, does not start the next game", async () => {
  const { snakeMayRestart, snakeDelay } = await load("soloSnake.ts");
  assert.equal(snakeMayRestart(true, 5000), false, "a key that is held down repeats");
  assert.equal(snakeMayRestart(false, 100), false, "pressed while still steering");
  assert.equal(snakeMayRestart(false, 700), true);
  assert.equal(snakeDelay(0), 140);
  assert.equal(snakeDelay(1000), 60, "never faster than this");
});

// ------------------------------------------------------------------ S3-11 Minesweeper
test("S3-11 Minesweeper: a first click on a flagged square does not lose the mines", async () => {
  const { minesStart, minesFlag, minesOpen, MINES } = await load("soloMines.ts");
  let g = minesFlag(minesStart(), 40);
  const same = minesOpen(g, 40, prng(1));
  assert.equal(same, g, "a flagged square is left alone");
  assert.equal(same.planted, false, "and no mines were 'laid' for it (the field used to end up with none)");
  // The real first click, elsewhere.
  g = minesOpen(g, 0, prng(1));
  assert.equal(g.planted, true);
  assert.equal(g.field.filter((s) => s.mine).length, MINES);
  assert.equal(g.field[40].flag, true, "the flag is still there");
  assert.equal(g.state, "playing");
});

test("S3-11 Minesweeper: the first square opened, and the squares around it, are never mined", async () => {
  const { minesStart, minesOpen, around, MINES, MS } = await load("soloMines.ts");
  const r = prng(99);
  for (let n = 0; n < 300; n++) {
    const i = Math.floor(r() * MS * MS);
    const g = minesOpen(minesStart(), i, r);
    assert.equal(g.field.filter((s) => s.mine).length, MINES);
    for (const k of [i, ...around(i)]) assert.equal(g.field[k].mine, false);
    assert.equal(g.field[i].open, true);
    assert.equal(g.field[i].n, 0, "so the first click always opens a patch");
    assert.notEqual(g.state, "lost");
    g.field.forEach((s, j) => assert.equal(s.n, around(j).filter((k) => g.field[k].mine).length));
  }
});

/** A field laid by hand: mines on the given squares. */
async function laid(mines) {
  const { freshField, around } = await load("soloMines.ts");
  const f = freshField();
  for (const i of mines) f[i].mine = true;
  f.forEach((s, i) => (s.n = around(i).filter((j) => f[j].mine).length));
  return { field: f, planted: true, state: "playing" };
}

test("S3-11 Minesweeper: a click on a number with its flags planted opens the rest; a wrong flag costs the game", async () => {
  const { minesOpen, minesFlag, minesChord } = await load("soloMines.ts");
  // One mine at square 0 (top left). Square 10 (row 1, column 1) shows 1.
  let g = await laid([0]);
  g = minesOpen(g, 10);
  assert.equal(g.field[10].n, 1);
  assert.equal(g.state, "playing");
  assert.equal(minesChord(g, 10), g, "no flag yet: nothing happens");
  const right = minesChord(minesFlag(g, 0), 10);
  assert.equal(right.state, "won", "everything but the mine is open");
  assert.equal(right.field[0].open, false);
  // The flag on the wrong square: the mine it missed goes off.
  const wrong = minesChord(minesFlag(g, 1), 10);
  assert.equal(wrong.state, "lost");
  assert.equal(wrong.field[0].open, true, "the mine is shown");
  // A closed square, or an open empty one, has nothing to open around.
  assert.equal(minesChord(g, 80), g);
});

test("S3-11 Minesweeper: no more flags than mines, none on an open square, and winning needs no flags", async () => {
  const { minesStart, minesFlag, minesOpen, flagsOn, MINES, MS } = await load("soloMines.ts");
  let g = minesStart();
  for (let i = 0; i < MINES + 5; i++) g = minesFlag(g, i);
  assert.equal(flagsOn(g), MINES, "the counter stops at zero");
  g = minesFlag(g, 3); // one comes off again
  assert.equal(flagsOn(g), MINES - 1);
  g = minesFlag(g, MINES + 2);
  assert.equal(flagsOn(g), MINES);
  // Winning by opening every safe square.
  let w = await laid([0, 8, 72, 80]);
  for (let i = 0; i < MS * MS; i++) if (!w.field[i].mine) w = minesOpen(w, i);
  assert.equal(w.state, "won");
  assert.equal(minesFlag(w, 0), w, "a finished game takes no flags");
  assert.equal(minesOpen(w, 0), w);
  const open = await laid([0]);
  const o = minesOpen(open, 80);
  assert.equal(minesFlag(o, 80), o, "an open square takes no flag");
  // Opening a mine loses, and shows every mine.
  const lost = minesOpen(await laid([0, 8]), 8);
  assert.equal(lost.state, "lost");
  assert.ok(lost.field[0].open && lost.field[8].open);
});

test("S3-11 Minesweeper: the clock never shows less than zero", async () => {
  const { minesSeconds } = await load("soloMines.ts");
  assert.equal(minesSeconds(null, 99999), 0, "before the first click");
  assert.equal(minesSeconds(5000, 4000), 0, "a clock that went backwards");
  assert.equal(minesSeconds(1000, 13999), 12);
});

// ------------------------------------------------------------------ S3-13 2048
test("S3-13 2048: the game in play is kept and read back; junk and finished games are not", async () => {
  const { pack2048, unpack2048, canMove, topTile } = await load("solo2048.ts");
  const grid = [
    [2, 4, 8, 16],
    [0, 2, 0, 32],
    [0, 0, 2, 64],
    [0, 0, 0, 2048],
  ];
  const back = unpack2048(pack2048({ grid, score: 20480, won: true }));
  assert.deepEqual(back, { grid, score: 20480, won: true });
  assert.notEqual(back.grid, grid, "its own copy");
  // "won" is also true when the tile is simply there.
  assert.equal(unpack2048(JSON.stringify({ g: grid, s: 1, w: 0 })).won, true);
  assert.equal(topTile(grid), 2048);
  for (const junk of [null, "", "{", "[]", JSON.stringify({ g: [[2]], s: 0 }), JSON.stringify({ g: grid, s: -4 }), JSON.stringify({ g: grid, s: 1.5 }), JSON.stringify({ g: grid.map((r) => r.map(() => 0)), s: 0 }), JSON.stringify({ g: grid.map((r) => r.map((v) => (v === 2 ? 3 : v))), s: 0 }), JSON.stringify({ g: grid.map((r) => r.map(String)), s: 0 })])
    assert.equal(unpack2048(junk), null, String(junk).slice(0, 40));
  // A board with no move left is a finished game: it is not brought back.
  const stuck = [
    [2, 4, 2, 4],
    [4, 2, 4, 2],
    [2, 4, 2, 4],
    [4, 2, 4, 2],
  ];
  assert.equal(canMove(stuck), false);
  assert.equal(unpack2048(pack2048({ grid: stuck, score: 100, won: false })), null);
});
