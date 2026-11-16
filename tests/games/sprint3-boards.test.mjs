// LANX Games repair, Sprint 3: what the boards' fixes rest on in the rules — Checkers' "you must
// jump" (S3-03) and Werewolf's night (S3-09). The boards themselves (Reversi's automatic pass,
// the lost role card, the picture for a returning guest) are checked in the running app.
// Run: npm run test:games
import test from "node:test";
import assert from "node:assert/strict";

const SRC = new URL("../../src/lib/games/", import.meta.url);
const load = (f) => import(new URL(f, SRC).href);

test("S3-03 Checkers: 'you must jump' is said exactly when a jump is there to take", async () => {
  const { checkers, checkersMoves, checkersMustJump } = await load("checkers.ts");
  const start = checkers.replay([], 2, "");
  const first = checkersMoves(start);
  assert.ok(first.length > 0);
  assert.equal(checkersMustJump(first), false, "the opening has no jump");
  assert.equal(checkersMustJump([]), false);
  // Play on at random until a jump comes up; there, every legal move is a jump (it is forced).
  let seen = 0;
  for (let game = 0; game < 40 && seen < 25; game++) {
    let moves = [];
    let a = 1234 + game;
    const rnd = () => ((a = (a * 1103515245 + 12345) >>> 0) / 4294967296);
    for (let ply = 0; ply < 120; ply++) {
      const s = checkers.replay(moves, 2, "");
      if (!s) break;
      const legal = checkersMoves(s);
      if (!legal.length) break;
      const jumps = legal.filter((m) => {
        const p = m.split("-").map(Number);
        return Math.abs(p[1] - p[0]) > 9;
      });
      assert.equal(checkersMustJump(legal), jumps.length > 0);
      if (jumps.length) {
        seen++;
        assert.equal(jumps.length, legal.length, "with a jump on the board, only jumps are legal");
      }
      moves = [...moves, legal[Math.floor(rnd() * legal.length)]];
    }
  }
  assert.ok(seen >= 25, `met ${seen} positions with a jump`);
});

test("S3-09 Werewolf: a wolf's later pick replaces the earlier one, and the night knows whether the pack agrees", async () => {
  const { resolveNight } = await load("werewolf.ts");
  const roles = ["wolf", "wolf", "seer", "villager", "villager", "villager", "villager"];
  const alive = roles.map(() => true);
  const kill = (from, target) => ({ kind: "kill", from, target, night: 1 });
  const peek = (from, target) => ({ kind: "peek", from, target, night: 1 });
  // The two wolves pick different victims: everyone has acted, but the pack does not agree.
  let r = resolveNight([kill(0, 3), kill(1, 4), peek(2, 0)], roles, alive, 1);
  assert.equal(r.allIn, true);
  assert.equal(r.agreed, false);
  assert.equal(r.victim, 3, "a tie goes to the one picked first (as before)");
  // Wolf 1 sees wolf 0's pick and changes theirs: the latest pick counts.
  r = resolveNight([kill(0, 3), kill(1, 4), peek(2, 0), kill(1, 3)], roles, alive, 1);
  assert.equal(r.agreed, true);
  assert.equal(r.victim, 3);
  assert.deepEqual(r.picks, [{ wolf: 0, target: 3 }, { wolf: 1, target: 3 }]);
  // …or wolf 0 goes over to wolf 1's choice instead.
  r = resolveNight([kill(0, 3), kill(1, 4), kill(0, 4)], roles, alive, 1);
  assert.equal(r.agreed, true);
  assert.equal(r.victim, 4);
  assert.equal(r.allIn, false, "the seer has not peeked yet");
  // The seer's latest peek counts too.
  r = resolveNight([peek(2, 0), peek(2, 5)], roles, alive, 1);
  assert.equal(r.peek, 5);
  // One wolf alone always "agrees"; nobody having picked is not a disagreement either.
  const lone = ["wolf", "seer", "villager", "villager", "villager"];
  assert.equal(resolveNight([kill(0, 2)], lone, lone.map(() => true), 1).agreed, true);
  assert.equal(resolveNight([], roles, alive, 1).agreed, true);
  // A pick from another night, at a packmate, or at someone dead does not count.
  r = resolveNight([{ ...kill(0, 3), night: 2 }, kill(0, 1), kill(1, 6)], roles, alive.map((a, p) => p !== 6), 1);
  assert.equal(r.victim, null);
});
