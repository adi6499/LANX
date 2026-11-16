// LANX Games repair, Sprint 3: the smaller defects, game by game — the ones in the rules.
// Run: npm run test:games
import test from "node:test";
import assert from "node:assert/strict";
import { makeNet, peer, cardMsg, tick } from "./harness/net.mjs";

const SRC = new URL("../../src/lib/", import.meta.url);
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
const pick = (r, list) => list[Math.floor(r() * list.length)];
const sum = (list) => list.reduce((a, b) => a + b, 0);
const T = 1_700_000_000_000;

// ------------------------------------------------------------------ S3-02
test("S3-02 Chess: a draw is final — no move is taken after the same position has come three times, or after mate", async () => {
  const rules = await load("gameRules.ts");
  const dance = ["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1", "Ng8"]; // the first position, for the third time
  for (let k = 0; k <= dance.length; k++) assert.equal(rules.validateMoves("chess", dance.slice(0, k)), true, `the first ${k} moves`);
  const end = rules.outcome("chess", dance);
  assert.equal(end.over, true);
  assert.equal(end.draw, true);
  assert.match(end.reason, /three times/);
  assert.equal(rules.validateMoves("chess", [...dance, "e4"]), false, "one more move is refused (the rules used to take it)");
  // Mate ends it too.
  const mate = ["f3", "e5", "g4", "Qh4#"];
  assert.equal(rules.outcome("chess", mate).winner, 1);
  assert.equal(rules.validateMoves("chess", [...mate, "a3"]), false);
  // An ordinary game is untouched.
  assert.equal(rules.validateMoves("chess", ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"]), true);
  assert.equal(rules.validateMoves("chess", ["e4", "e5", "Ke3"]), false);
});

// ------------------------------------------------------------------ S3-07
test("S3-07 Blackjack alone: you win only when you finish ahead of the dealer", async () => {
  const { blackjack } = await load("games/blackjack.ts");
  // The audit's game: four rounds stood on, four points down. It said "P1 wins".
  const lost = blackjack.replay("s s s s".split(" "), 1, "m-solo2#1");
  assert.ok(lost);
  const end = blackjack.outcome(lost, 1);
  assert.equal(lost.points[0], -4);
  assert.equal(end.over, true);
  assert.equal(end.winner, null);
  assert.equal(end.draw, false);
  assert.match(end.reason, /dealer wins.*4 points behind/);
  // Over many games played alone: ahead is a win, level a draw, behind the dealer's.
  const seen = { won: 0, level: 0, lost: 0 };
  for (let g = 0; g < 300; g++) {
    const seed = `m-solo${g}#1`;
    const r = prng(600 + g);
    const moves = [];
    let s = blackjack.replay(moves, 1, seed);
    for (let step = 0; step < 200 && !blackjack.outcome(s, 1).over; step++) {
      const ok = ["h", "s", "d"].filter((m) => blackjack.replay([...moves, m], 1, seed));
      if (!ok.length) break;
      moves.push(ok.includes("s") && r() < 0.7 ? "s" : pick(r, ok));
      s = blackjack.replay(moves, 1, seed);
    }
    const o = blackjack.outcome(s, 1);
    if (!o.over) continue;
    const pts = s.points[0];
    if (pts > 0) {
      seen.won++;
      assert.equal(o.winner, 0, seed);
    } else if (pts === 0) {
      seen.level++;
      assert.equal(o.draw, true, seed);
    } else {
      seen.lost++;
      assert.ok(o.winner === null && !o.draw, `${seed}: ${pts} points must not be a win`);
    }
  }
  assert.ok(seen.won > 20 && seen.lost > 20, JSON.stringify(seen));
  // With others at the table nothing changes: most points wins.
  const two = blackjack.replay([], 2, "m-two#1");
  assert.equal(blackjack.outcome(two, 2).over, false);
});

// ------------------------------------------------------------------ S3-15
test("S3-15 Math Rush and Trivia: an empty answer is no answer", async () => {
  const { mathRush, trivia } = await load("games/party.ts");
  // A sum whose answer is 0 ("3 × 0"): an empty answer used to count as right.
  let seed = "";
  for (let g = 0; g < 4000 && !seed; g++) if (mathRush.rules.setup(`m-zero${g}#1`, 1, 2, null).answer === 0) seed = `m-zero${g}#1`;
  assert.ok(seed, "a sum with the answer 0 was found");
  const play = (def, sd, a0, a1) => def.replay([`o:1:${T}`, `0@a#1:${a0}`, `1@a#1:${a1}`, "e:1"], 2, sd);
  let s = play(mathRush, seed, "", "0");
  assert.ok(s, "the list is read");
  assert.deepEqual(s.scores, [0, 1], "the empty answer scores nothing; \"0\" is right");
  s = play(mathRush, seed, "  ", "0");
  assert.deepEqual(s.scores, [0, 1]);
  // Trivia: a question whose right option is the first one (number 0).
  let tseed = "";
  for (let g = 0; g < 4000 && !tseed; g++) if (trivia.rules.setup(`m-first${g}#1`, 1, 2, null).a === 0) tseed = `m-first${g}#1`;
  assert.ok(tseed, "a question whose first option is right was found");
  s = play(trivia, tseed, "", "0");
  assert.deepEqual(s.scores, [0, 10]);
});

test("S3-15 a draw between two of three players reads as that, and the third has lost", async () => {
  const { dots } = await load("games/dots.ts");
  const { draw } = await load("games/core.ts");
  assert.deepEqual(draw("x", [1, 1], [0, 1]).tied, [0, 1]);
  // Dots & Boxes, 10-10-5.
  const end = dots.outcome({ scores: [10, 10, 5], out: [false, false, false], linesLeft: 0 }, 3);
  assert.equal(end.draw, true);
  assert.deepEqual(end.tied, [0, 1]);
  // In a match (Tap Roulette, three players, everyone taps in every round): tables are played until one ends with two level in front.
  for (let attempt = 0; attempt < 60; attempt++) {
    const net = makeNet();
    const pcs = { H: await net.boot("H"), G1: await net.boot("G1"), G2: await net.boot("G2") };
    const { match, cards } = pcs.H.challengeMany("taproulette", [peer("G1"), peer("G2")]);
    await pcs.G1.openFromCard(cards[0].card, cardMsg("H"), [peer("H"), peer("G2")]);
    await pcs.G2.openFromCard(cards[1].card, cardMsg("H"), [peer("H"), peer("G1")]);
    await tick();
    assert.equal(await pcs.H.startNow(match.id), null);
    await tick();
    const id = match.id;
    for (let round = 1; round <= 5; round++) {
      assert.equal(await pcs.H.play(id, `o:${round}:${T}`), null);
      await tick(8);
      for (const [k, p] of [["H", 0], ["G1", 1], ["G2", 2]]) assert.equal(await pcs[k].play(id, `${p}@a:in`), null);
      await tick(8);
      assert.equal(await pcs.H.play(id, `e:${round}`), null);
      await tick(8);
    }
    await tick(20);
    const m = pcs.H.getMatch(id);
    assert.equal(m.status, "over");
    if (!m.result.draw || !m.result.tied) continue;
    assert.equal(m.result.tied.length, 2);
    const third = [0, 1, 2].find((x) => !m.result.tied.includes(x));
    const names = ["H", "G1", "G2"];
    // The words name the two, on every PC.
    assert.match(pcs.H.resultText(m), /^Draw between .+ and .+ — /);
    for (const k of names) assert.ok(!pcs[k].resultText(pcs[k].getMatch(id)).startsWith("Draw — "), `${k}: ${pcs[k].resultText(pcs[k].getMatch(id))}`);
    // The records: a draw for the two, a loss for the third (it used to be a draw for all three).
    for (const seat of m.result.tied) assert.deepEqual([net.stats(names[seat]).taproulette.drawn, net.stats(names[seat]).taproulette.lost], [1, 0], `${names[seat]} drew`);
    assert.deepEqual([net.stats(names[third]).taproulette.drawn, net.stats(names[third]).taproulette.lost], [0, 1], `${names[third]} lost`);
    return;
  }
  assert.fail("no table ended with two players level in front in 60 tries");
});

test("S3-15 Chain Reaction: the last line says how the game really ended", async () => {
  const rules = await load("gameRules.ts");
  assert.equal(rules.outcome("chainreaction", ["0", "x1"], 2).reason, "the other player gave up", "two players, one gave up (it said \"the board is all one colour\")");
  assert.equal(rules.outcome("chainreaction", ["0", "20", "40", "x1", "x2"], 3).reason, "everyone else left");
  // A game played out: won on the board.
  const r = prng(77);
  const moves = [];
  for (let step = 0; step < 3000 && !rules.outcome("chainreaction", moves, 2).over; step++) {
    for (let t = 0; t < 400; t++) {
      const m = String(Math.floor(r() * 54));
      if (rules.validateMoves("chainreaction", [...moves, m], 2)) {
        moves.push(m);
        break;
      }
    }
  }
  assert.equal(rules.outcome("chainreaction", moves, 2).reason, "the board is all one colour");
});

// ------------------------------------------------------------------ S3-16
test("S3-16 Hold'em: nobody is asked to act alone with nothing to call; the odd chip goes round from the button; no chips vanish", async () => {
  const { holdem } = await load("games/holdem.ts");
  const total = (s) => sum(s.chips) + (s.over ? 0 : sum(s.contributed));
  let oddSplits = 0;
  let hands = 0;
  for (let g = 0; g < 700; g++) {
    const n = 2 + (g % 5);
    const seed = `m-hd${g}#1`;
    const r = prng(9100 + g);
    const moves = [];
    let st = holdem.replay(moves, n, seed);
    const chips = total(st);
    for (let step = 0; step < 500 && !holdem.outcome(st, n).over; step++) {
      // Whoever is to act has something to decide: either others can still bet too, or there is a bet to call.
      if (st.street < 4) {
        const act = st.chips.map((_, p) => p).filter((p) => !st.folded[p] && !st.out[p] && !st.allin[p]);
        const p = st.turn;
        assert.ok(!(act.length === 1 && st.bets[p] >= st.toCall), `${seed}, ${n} players: P${p + 1} is asked to act alone with nothing to call after ${moves.join(" ")}`);
      }
      const before = { button: st.button, hand: st.hand };
      // (odd raises, so that pots are not always even)
      const tries = ["c", "c", "c", "c", "f", `r:${st.toCall + st.minRaise + 1 + 2 * Math.floor(r() * 15)}`, "a"];
      let next = null;
      for (let k = 0; k < 8 && !next; k++) {
        const m = pick(r, tries);
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
      assert.equal(total(st), chips, `${seed}: chips`);
      // A hand just ended in a showdown with a pot shared unevenly: who got the chip that could not be shared?
      if (st.last && st.last.hand === before.hand && st.last.shown.length > 1) {
        hands++;
        const winners = st.last.shown.filter((x) => x.won > 0);
        const names = new Set(winners.map((x) => x.name));
        if (winners.length === 2 && names.size === 1 && Math.abs(winners[0].won - winners[1].won) === 1) {
          oddSplits++;
          const more = winners[0].won > winners[1].won ? winners[0].player : winners[1].player;
          const less = winners[0].won > winners[1].won ? winners[1].player : winners[0].player;
          const after = (p) => (p - before.button - 1 + n) % n;
          assert.ok(after(more) < after(less), `${seed}: the odd chip went to P${more + 1}, but P${less + 1} sits first after the button (P${before.button + 1})`);
        }
      }
    }
  }
  assert.ok(hands > 300, `${hands} showdowns looked at`);
  assert.ok(oddSplits >= 3, `only ${oddSplits} pots were shared with a chip left over; the test needs a few`);
});
