// LANX Games repair, Sprint 2: multiplayer reliability. The real match code (src/lib/games.ts)
// runs once per pretend PC over a pretend office network (tests/games/harness).
// Run: npm run test:games
import test from "node:test";
import assert from "node:assert/strict";
import { makeNet, peer, cardMsg, tick } from "./harness/net.mjs";

/** A table at `game`: the host H and guests G1…, of whom `joining` press Play; started. */
async function table(game, guests = ["G1", "G2"], joining = guests) {
  const net = makeNet();
  const pcs = { H: await net.boot("H") };
  for (const g of guests) pcs[g] = await net.boot(g);
  const { match, cards } = pcs.H.challengeMany(game, guests.map(peer));
  const everyone = ["H", ...guests];
  for (const g of joining) await pcs[g].openFromCard(cards[guests.indexOf(g)].card, cardMsg("H"), everyone.filter((x) => x !== g).map(peer));
  await tick();
  assert.equal(await pcs.H.startNow(match.id), null);
  await tick();
  return { net, pcs, id: match.id, cards, everyone };
}
/** Plays Chain Reaction with chance moves until it is over; who made the last move. */
async function playOut(pcs, id, seed = 7) {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let last = "";
  for (let n = 0; n < 3000 && pcs.H.getMatch(id).status === "playing"; n++) {
    const mover = () => Object.keys(pcs).find((k) => pcs[k].getMatch(id) && pcs[k].myTurn(pcs[k].getMatch(id)));
    // (the news of the last move may still be on its way to the next player)
    for (let w = 0; w < 40 && !mover() && pcs.H.getMatch(id).status === "playing"; w++) await tick();
    if (pcs.H.getMatch(id).status !== "playing") break;
    const who = mover();
    assert.ok(who, "somebody has the move");
    let ok = false;
    for (let t = 0; t < 300 && !ok; t++) ok = (await pcs[who].play(id, String(Math.floor(rnd() * 54)))) === null;
    assert.ok(ok, "a legal move was found");
    last = who;
    await tick();
  }
  await tick(20);
  return last;
}

// ------------------------------------------------------------------ S2-08
test("S2-08 a table: the game is counted once on every PC, whoever made the last move, and whatever arrives afterwards", async () => {
  const { net, pcs, id } = await table("chainreaction");
  const last = await playOut(pcs, id);
  assert.equal(pcs.H.getMatch(id).status, "over");
  for (const k of Object.keys(pcs)) {
    const st = net.stats(k).chainreaction;
    assert.equal(st.played, 1, `${k} played one game (a guest who made the last move used to get two)`);
    assert.equal(st.won + st.lost + st.drawn, 1, `${k}: one result`);
  }
  assert.equal(net.stats(last).chainreaction.won, 1, "whoever made the last move won it, once");
  // A stray move for the finished game makes the host "put the board right" again; and the host tells everyone once more.
  const stray = Object.keys(pcs).find((k) => k !== "H" && k !== last) ?? "G1";
  await net.send(stray, "H", { match_id: id, game: "chainreaction", action: "move", seq: 0, data: { cell: "0" }, at: 0 });
  await tick(20);
  for (const g of ["G1", "G2"]) await net.send("H", g, { match_id: id, game: "chainreaction", action: "state", seq: 0, data: JSON.parse(JSON.stringify({ moves: pcs.H.getMatch(id).moves, seats: pcs.H.getMatch(id).seats.map((s) => ({ id: s.id, name: s.name })), round: 1, status: "over", joined: ["H", "G1", "G2"] })), at: 0 });
  await tick(20);
  for (const k of Object.keys(pcs)) assert.equal(net.stats(k).chainreaction.played, 1, `${k} still has one game`);
});

test("S2-08 two players: a finished game is not counted again after LANX restarts and the old card is pressed", async () => {
  const net = makeNet();
  const A = await net.boot("A");
  let B = await net.boot("B");
  const { match, card } = A.challenge("tictactoe", peer("B"));
  await B.openFromCard(card, cardMsg("A"), [peer("A")]);
  await tick();
  for (const [who, mv] of [[A, "0"], [B, "3"], [A, "1"], [B, "4"], [A, "2"]]) {
    assert.equal(await who.play(match.id, mv), null);
    await tick();
  }
  assert.deepEqual([net.stats("A").tictactoe.played, net.stats("A").tictactoe.won], [1, 1]);
  assert.deepEqual([net.stats("B").tictactoe.played, net.stats("B").tictactoe.lost], [1, 1]);
  for (let k = 1; k <= 3; k++) {
    B = await net.boot("B"); // LANX restarted on B's PC
    await B.openFromCard(card, cardMsg("A", true), [peer("A")]);
    await tick(20);
    assert.deepEqual([net.stats("B").tictactoe.played, net.stats("B").tictactoe.lost], [1, 1], `after restart ${k}`);
  }
  // Another round is another game.
  await A.rematch(match.id);
  await tick();
  for (const [who, mv] of [[B, "0"], [A, "3"], [B, "1"], [A, "4"], [B, "2"]]) {
    assert.equal(await who.play(match.id, mv), null, `round 2, ${mv}`);
    await tick();
  }
  assert.deepEqual([net.stats("B").tictactoe.played, net.stats("B").tictactoe.won, net.stats("B").tictactoe.lost], [2, 1, 1]);
  assert.deepEqual([net.stats("A").tictactoe.played, net.stats("A").tictactoe.won, net.stats("A").tictactoe.lost], [2, 1, 1]);
});

test("S2-08 statistics that cannot be read for a moment are not wiped by the next result", async () => {
  const net = makeNet();
  net.prefs.B = { games_stats: JSON.stringify({ tictactoe: { played: 40, won: 22, lost: 15, drawn: 3 }, "2048": { played: 9, won: 0, lost: 0, drawn: 0, best: 5120 } }) };
  const A = await net.boot("A");
  const B = await net.boot("B");
  const game = async (first, second, id) => {
    for (const [who, mv] of [[first, "0"], [second, "3"], [first, "1"], [second, "4"], [first, "2"]]) {
      assert.equal(await who.play(id, mv), null);
      await tick();
    }
  };
  const { match, card } = A.challenge("tictactoe", peer("B"));
  await B.openFromCard(card, cardMsg("A"), [peer("A")]);
  await tick();
  net.prefFail = (pc, key) => pc === "B" && key === "games_stats"; // B's settings cannot be read just now
  await game(A, B, match.id);
  assert.equal(JSON.parse(net.prefs.B.games_stats).tictactoe.played, 40, "nothing was written over B's statistics (they used to be wiped: played 1)");
  assert.equal(JSON.parse(net.prefs.B.games_stats)["2048"].best, 5120);
  net.prefFail = null;
  await A.rematch(match.id);
  await tick();
  await game(B, A, match.id);
  const st = net.stats("B");
  assert.deepEqual([st.tictactoe.played, st.tictactoe.won, st.tictactoe.lost], [41, 23, 15], "the next game is counted on top of what was there");
  assert.equal(st["2048"].best, 5120);
});

// ------------------------------------------------------------------ S2-06
test("S2-06 an invited colleague who presses Play after the start sits down at the next round", async () => {
  const { pcs, id, cards } = await table("chainreaction", ["G1", "G2"], ["G1"]);
  const { H, G1, G2 } = pcs;
  assert.deepEqual(H.getMatch(id).seats.map((s) => s.id), ["H", "G1"], "the game started with the two who were in");
  // G2 presses Play on the card now.
  await G2.openFromCard(cards[1].card, cardMsg("H"), [peer("H"), peer("G1")]);
  await tick();
  assert.deepEqual((H.getMatch(id).late ?? []).map((l) => l.id), ["G2"], "the host has G2 down for the next round (this never happened before)");
  assert.equal(G2.getMatch(id).status, "declined");
  assert.match(G2.getMatch(id).note, /sit down at the next round/);
  assert.equal(H.getMatch(id).status, "playing", "the game under way is not disturbed");
  assert.equal(await H.play(id, "0"), null);
  await tick();
  assert.deepEqual(G1.getMatch(id).moves, ["0"]);
  // Pressing Play again changes nothing.
  await G2.openFromCard(cards[1].card, cardMsg("H"), [peer("H"), peer("G1")]);
  await tick();
  assert.equal(H.getMatch(id).late.length, 1);
  // The next round: three at the table.
  await H.rematch(id);
  await tick();
  for (const pc of [H, G1, G2]) {
    assert.deepEqual(pc.getMatch(id).seats.map((s) => s.id), ["H", "G1", "G2"]);
    assert.equal(pc.getMatch(id).status, "playing");
    assert.equal(pc.getMatch(id).round, 2);
  }
  assert.equal(G2.getMatch(id).note, "");
});

test("S2-06 someone who was never invited cannot sit down at a table", async () => {
  const { net, pcs, id } = await table("chainreaction", ["G1", "G2"], ["G1"]);
  await net.boot("X");
  await net.send("X", "H", { match_id: id, game: "chainreaction", action: "accept", seq: 0, data: null, at: 0 });
  await tick();
  assert.deepEqual(pcs.H.getMatch(id).late ?? [], []);
});

// ------------------------------------------------------------------ S2-10
test("S2-10 a table is never invited beyond the game's places", async () => {
  const net = makeNet();
  const H = await net.boot("H");
  const many = ["G1", "G2", "G3", "G4", "G5", "G6"].map(peer);
  for (const [game, places] of [["dots", 4], ["ludo", 4], ["bankroll", 6]]) {
    const { match, cards } = H.challengeMany(game, many);
    assert.equal(match.seats.length, Math.min(places, many.length + 1), `${game}: the host and ${places - 1} colleagues at most`);
    assert.equal(cards.length, match.seats.length - 1);
    assert.equal(H.sizeOk(H.gameMeta(game), match.seats.length), true);
  }
});

// ------------------------------------------------------------------ 3.16.1 (two faults of 3.16.0)
test("3.16.1 a table: a guest's move that ends the game reaches the host and everyone else", async () => {
  // Chain Reaction, three players, played with chance moves until one move ends it (three different games).
  for (const seed of [3, 11, 29]) {
    const { pcs, id } = await table("chainreaction");
    const last = await playOut(pcs, id, seed);
    for (const k of Object.keys(pcs)) assert.equal(pcs[k].getMatch(id).status, "over", `seed ${seed}: over on ${k} (the last move was ${last}'s)`);
    const moves = pcs.H.getMatch(id).moves.join(",");
    for (const k of Object.keys(pcs)) assert.equal(pcs[k].getMatch(id).moves.join(","), moves, `seed ${seed}: ${k} has the same game`);
  }
});

test("3.16.1 a party game: answers given at the same moment all count, and none is played twice", async () => {
  const { net, pcs, id } = await table("taproulette");
  const { H, G1, G2 } = pcs;
  const T = 1_700_000_000_000;
  assert.equal(await H.play(id, `o:1:${T}`), null);
  await tick();
  assert.equal(G1.getMatch(id).moves.length, 1);
  // G1 and G2 tap at the same moment: both answers are on their way before the host has either.
  net.hold = (from, to, step) => to === "H" && step.action === "move";
  assert.equal(await G1.play(id, `${G1.playerOf(G1.getMatch(id), G1.mySeat(G1.getMatch(id)))}@a:in`), null);
  assert.equal(await G2.play(id, `${G2.playerOf(G2.getMatch(id), G2.mySeat(G2.getMatch(id)))}@a:in`), null);
  await tick();
  assert.equal(net.held.length, 2);
  net.hold = null;
  await net.release();
  await tick(12);
  assert.deepEqual([...H.getMatch(id).moves].sort(), [`o:1:${T}`, "1@a:in", "2@a:in"].sort(), "the host has both answers (in 3.16.0 it threw the second away)");
  for (const pc of [G1, G2]) assert.deepEqual(pc.getMatch(id).moves, H.getMatch(id).moves);
  // The same answer arriving a second time (it was sent again although the first had arrived) is not played twice.
  const sent = net.log.filter((l) => l.to === "H" && l.action === "move");
  assert.equal(sent.length, 2);
  assert.ok(sent.every((l) => typeof l.data.k === "string" && l.data.n === undefined), "an answer carries its own number, and no place");
  const before = H.getMatch(id).moves.length;
  await net.send("G1", "H", { match_id: id, game: "taproulette", action: "move", seq: 0, data: sent[0].data, at: 0 });
  await tick(12);
  assert.equal(H.getMatch(id).moves.length, before);
  // The host answers for itself, closes the round, and the scores are the same everywhere.
  assert.equal(await H.play(id, "0@a:in"), null);
  assert.equal(await H.play(id, "e:1"), null);
  await tick(12);
  for (const pc of [G1, G2]) assert.deepEqual(pc.getMatch(id).moves, H.getMatch(id).moves);
});

test("3.16.1 a table: a move made in turn still names its place and is played once", async () => {
  const { net, pcs, id } = await table("chainreaction");
  const { H, G1 } = pcs;
  assert.equal(await H.play(id, "0"), null);
  await tick();
  assert.equal(await G1.play(id, "20"), null);
  await tick();
  const sent = net.log.filter((l) => l.to === "H" && l.action === "move");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].data.n, 1);
  assert.equal(typeof sent[0].data.k, "string");
  assert.deepEqual(H.getMatch(id).moves, ["0", "20"]);
});

// ------------------------------------------------------------------ S2-01
test("S2-01 a table: the host's news is numbered, and older news that arrives late never replaces newer", async () => {
  const { net, pcs, id } = await table("chainreaction");
  const { H, G1, G2 } = pcs;
  // What the host sends to G2 is held up on the way.
  net.hold = (from, to, step) => from === "H" && to === "G2" && step.action === "state";
  assert.equal(await H.play(id, "0"), null);
  await tick();
  assert.equal(await G1.play(id, "20"), null);
  await tick();
  assert.equal(net.held.length, 2, "two pieces of news are on their way to G2");
  assert.deepEqual(G2.getMatch(id).moves, []);
  net.hold = null;
  // They arrive the wrong way round: the newer first, then the older.
  await net.release([1, 0]);
  await tick(12);
  assert.deepEqual(G2.getMatch(id).moves, ["0", "20"], "G2 keeps the newer game (the older one used to win, and the table then waited for G2 for good)");
  assert.equal(G2.myTurn(G2.getMatch(id)), true);
  assert.equal(await G2.play(id, "40"), null);
  await tick();
  assert.deepEqual(H.getMatch(id).moves, ["0", "20", "40"]);
  // The numbers only ever go up.
  const revs = net.log.filter((l) => l.from === "H" && l.to === "G1" && l.action === "state").map((l) => l.data.rev);
  assert.ok(revs.length >= 4 && revs.every((r, i) => i === 0 || r >= revs[i - 1]), `the host's numbers: ${revs.join(",")}`);
  // After the host's LANX has started again its count begins anew: that news is taken (it is the truth now).
  const fresh = { ...net.log.filter((l) => l.to === "G2" && l.action === "state").at(-1).data, rev: 1, boot: "another-run" };
  await net.send("H", "G2", { match_id: id, game: "chainreaction", action: "state", seq: 0, data: fresh, at: 0 });
  await tick(12);
  assert.equal(G2.getMatch(id).hostBoot, "another-run");
  assert.equal(G2.getMatch(id).hostRev, 1);
});

// ------------------------------------------------------------------ S2-05
for (const order of [[0, 1], [1, 0]]) {
  test(`S2-05 two players: both press Ready in Sea Battle at the same moment (arriving ${order[0] ? "B's first" : "A's first"}) — both count`, async () => {
    const net = makeNet();
    const A = await net.boot("A");
    const B = await net.boot("B");
    const { match, card } = A.challenge("battleship", peer("B"));
    const id = match.id;
    await B.openFromCard(card, cardMsg("A"), [peer("A")]);
    await tick();
    net.hold = (from, to, step) => step.action === "move";
    assert.equal(await A.play(id, "0@ready"), null);
    assert.equal(await B.play(id, "1@ready"), null);
    await tick();
    assert.equal(net.held.length, 2);
    net.hold = null;
    await net.release(order);
    await tick(20);
    for (const pc of [A, B]) assert.deepEqual(pc.getMatch(id).moves, ["0@ready", "1@ready"], "both PCs have both, in the same order (each used to keep only its own, for good)");
    assert.equal(A.myTurn(A.getMatch(id)), true, "the first player can fire");
    assert.equal(B.myTurn(B.getMatch(id)), false);
    assert.equal(await A.play(id, "f:0"), null);
    await tick();
    assert.deepEqual(B.getMatch(id).moves, ["0@ready", "1@ready", "f:0"]);
    assert.equal(A.unsentCount(id) + B.unsentCount(id), 0);
  });
}

test("S2-05 two players: moves made in turn are not mixed together (only moves both may make at once are)", async () => {
  const net = makeNet();
  const A = await net.boot("A");
  const B = await net.boot("B");
  const { match, card } = A.challenge("tictactoe", peer("B"));
  await B.openFromCard(card, cardMsg("A"), [peer("A")]);
  await tick();
  assert.equal(await A.play(match.id, "0"), null);
  await tick();
  // A list that differs from ours in a move made in turn is not taken, whoever sends it.
  await net.send("B", "A", { match_id: match.id, game: "tictactoe", action: "move", seq: 1, data: { moves: ["4"], round: 1, first: "A" }, at: 0 });
  await tick(12);
  assert.deepEqual(A.getMatch(match.id).moves, ["0"]);
});
