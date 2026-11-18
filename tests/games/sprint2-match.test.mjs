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
  for (const [game, places] of [["dots", 4], ["ludo", 6], ["bankroll", 6]]) {
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
  assert.deepEqual([...H.getMatch(id).moves].sort(), [`o:1:${T}`, "1@a#1:in", "2@a#1:in"].sort(), "the host has both answers (in 3.16.0 it threw the second away)");
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

// ------------------------------------------------------------------ S2-02
test("S2-02 a table goes on after the host's LANX has restarted", async () => {
  const { net, pcs, id } = await table("chainreaction");
  let { H } = pcs;
  const { G1, G2 } = pcs;
  assert.equal(await H.play(id, "0"), null);
  await tick();
  assert.equal(await G1.play(id, "20"), null);
  await tick();
  await H.saveLive();
  // The host's LANX is closed and started again.
  H = pcs.H = await net.boot("H");
  await tick(12);
  const back = H.getMatch(id);
  assert.ok(back, "the host still has its table (it used to be gone, and every move of a guest was dropped without a word)");
  assert.equal(back.status, "playing");
  assert.deepEqual(back.moves, ["0", "20"]);
  assert.equal(H.isHost(back), true);
  // G2, whose turn it is, plays: the host takes the move and tells everyone.
  assert.equal(await G2.play(id, "40"), null);
  await tick(12);
  for (const pc of [H, G1, G2]) assert.deepEqual(pc.getMatch(id).moves, ["0", "20", "40"]);
  assert.equal(H.myTurn(H.getMatch(id)), true);
  assert.equal(await H.play(id, "5"), null);
  await tick(12);
  for (const pc of [G1, G2]) assert.deepEqual(pc.getMatch(id).moves, ["0", "20", "40", "5"]);
});

test("S2-02 a guest whose LANX restarted is back at the table with the game as it stands", async () => {
  const { net, pcs, id } = await table("chainreaction");
  const { H, G2 } = pcs;
  assert.equal(await H.play(id, "0"), null);
  await tick();
  await pcs.G1.saveLive();
  // While G1's LANX is closed, nothing reaches it; the host's news for G1 waits.
  net.fail = (from, to) => to === "G1";
  delete net.pcs.G1;
  const G1 = (pcs.G1 = await (async () => {
    net.fail = null;
    return net.boot("G1");
  })());
  await tick(12);
  assert.deepEqual(G1.getMatch(id).moves, ["0"]);
  assert.equal(G1.myTurn(G1.getMatch(id)), true);
  assert.equal(await G1.play(id, "20"), null);
  await tick(12);
  for (const pc of [H, G2]) assert.deepEqual(pc.getMatch(id).moves, ["0", "20"]);
});

test("S2-02 a two-player game goes on after both have restarted LANX, and a move made meanwhile is fetched", async () => {
  const net = makeNet();
  let A = await net.boot("A");
  let B = await net.boot("B");
  const { match, card } = A.challenge("tictactoe", peer("B"));
  const id = match.id;
  await B.openFromCard(card, cardMsg("A"), [peer("A")]);
  await tick();
  assert.equal(await A.play(id, "0"), null);
  await tick();
  await A.saveLive();
  await B.saveLive();
  // B plays while A's LANX is closed (the move cannot be delivered), then closes LANX too.
  net.fail = (from, to) => to === "A";
  assert.equal(await B.play(id, "4"), null);
  await tick();
  await B.saveLive();
  net.fail = null;
  A = await net.boot("A");
  B = await net.boot("B");
  await tick(20);
  assert.deepEqual(A.getMatch(id).moves, ["0", "4"], "A has the move B made while A was closed");
  assert.deepEqual(B.getMatch(id).moves, ["0", "4"]);
  assert.equal(A.myTurn(A.getMatch(id)), true);
  assert.equal(await A.play(id, "1"), null);
  await tick();
  assert.deepEqual(B.getMatch(id).moves, ["0", "4", "1"]);
});

// ------------------------------------------------------------------ S2-09
test("S2-09 a challenge that was cancelled stays cancelled: pressing Play on its card starts no game", async () => {
  const net = makeNet();
  let A = await net.boot("A");
  const B = await net.boot("B");
  const { match, card } = A.challenge("tictactoe", peer("B"));
  const id = match.id;
  // A cancels while B cannot be reached: B never hears of it.
  net.fail = (from, to) => to === "B";
  await A.leave(id);
  await tick();
  net.fail = null;
  await A.saveLive();
  A = await net.boot("A"); // …and A's LANX has even been restarted since
  // B presses Play on the card.
  await B.openFromCard(card, cardMsg("A"), [peer("A")]);
  await tick(12);
  assert.equal(A.getMatch(id), undefined, "no game appears on A's PC (one used to, with nobody in it)");
  assert.equal(B.getMatch(id).status, "left", "B's card says the game is gone");
});

test("S2-09 giving up is remembered, and a colleague who was away learns of it", async () => {
  const net = makeNet();
  let A = await net.boot("A");
  let B = await net.boot("B");
  const { match, card } = A.challenge("tictactoe", peer("B"));
  const id = match.id;
  await B.openFromCard(card, cardMsg("A"), [peer("A")]);
  await tick();
  assert.equal(await A.play(id, "0"), null);
  await tick();
  await B.saveLive();
  // A gives up while B's LANX is closed.
  net.fail = (from, to) => to === "B";
  await A.resign(id);
  await tick();
  net.fail = null;
  await A.saveLive();
  assert.equal(A.getMatch(id).status, "over");
  A = await net.boot("A");
  assert.equal(A.getMatch(id).status, "over", "after a restart A's game is still over (it used to come back as being played)");
  B = await net.boot("B");
  await tick(20);
  assert.equal(B.getMatch(id).status, "over", "B, back at the game, learns that A gave up");
  assert.equal(B.getMatch(id).result.winner, B.mySeat(B.getMatch(id)));
  assert.match(B.getMatch(id).result.reason, /resigned/);
  assert.deepEqual([net.stats("B").tictactoe.played, net.stats("B").tictactoe.won], [1, 1]);
  assert.deepEqual([net.stats("A").tictactoe.played, net.stats("A").tictactoe.lost], [1, 1]);
});

test("S2-09 another round asked of a colleague who cleared the game: the asker is told it is gone", async () => {
  const net = makeNet();
  const A = await net.boot("A");
  const B = await net.boot("B");
  const { match, card } = A.challenge("tictactoe", peer("B"));
  const id = match.id;
  await B.openFromCard(card, cardMsg("A"), [peer("A")]);
  await tick();
  for (const [who, mv] of [[A, "0"], [B, "3"], [A, "1"], [B, "4"], [A, "2"]]) {
    assert.equal(await who.play(id, mv), null);
    await tick();
  }
  await B.leave(id); // B presses Clear on the finished game
  await tick();
  await A.rematch(id);
  await tick(12);
  assert.equal(A.getMatch(id).status, "left", "A sees that B is no longer in it (A used to wait at an empty board)");
  assert.equal(B.getMatch(id), undefined);
});

// ------------------------------------------------------------------ S2-04
test("S2-04 the host takes out a player whose PC has gone on their turn, and the table plays on", async () => {
  const { net, pcs, id } = await table("chainreaction");
  const { H, G1, G2 } = pcs;
  assert.equal(await H.play(id, "0"), null);
  await tick();
  // It is G1's turn, and G1's PC is gone (switched off): nothing reaches it, nothing comes from it.
  net.fail = (from, to) => to === "G1" || from === "G1";
  assert.equal(H.turnSeat(H.getMatch(id)), 1);
  assert.equal(H.myTurn(H.getMatch(id)), false);
  assert.equal(G2.myTurn(G2.getMatch(id)), false, "the table waits for G1 (and used to, for good)");
  // Only the host can do it, and not to itself.
  assert.match(await G2.removePlayer(id, 1), /Only the host/);
  assert.match(await H.removePlayer(id, 0), /Resign/);
  assert.equal(await H.removePlayer(id, 1), null);
  await tick(12);
  assert.ok(H.getMatch(id).moves.includes("x1"), "G1 is out, as if they had left");
  assert.ok(H.getMatch(id).gone.includes("G1"));
  assert.equal(H.getMatch(id).status, "playing");
  assert.equal(G2.myTurn(G2.getMatch(id)), true, "the next player has the move");
  assert.equal(await G2.play(id, "40"), null);
  await tick(12);
  assert.deepEqual(H.getMatch(id).moves, ["0", "x1", "40"]);
  // Taking the same player out twice changes nothing.
  assert.equal(await H.removePlayer(id, 1), null);
  assert.deepEqual(H.getMatch(id).moves, ["0", "x1", "40"]);
  // G1's PC comes back and tries to move: it is shown the game, in which it is out.
  net.fail = null;
  await net.send("G1", "H", { match_id: id, game: "chainreaction", action: "move", seq: 0, data: { cell: "20", n: 1, k: "late-1" }, at: 0 });
  await tick(12);
  assert.deepEqual(H.getMatch(id).moves, ["0", "x1", "40"]);
  assert.ok(G1.getMatch(id).moves.includes("x1"));
  // With two left, taking out the other one ends the game: the host has won.
  assert.equal(await H.play(id, "5"), null);
  await tick(12);
  assert.equal(await H.removePlayer(id, 2), null);
  await tick(12);
  assert.equal(H.getMatch(id).status, "over");
  assert.equal(H.getMatch(id).result.winner, 0);
});

// ------------------------------------------------------------------ S2-07
/** A finished game of tic-tac-toe between A and B (A won). */
async function finished() {
  const net = makeNet();
  const A = await net.boot("A");
  const B = await net.boot("B");
  const { match, card } = A.challenge("tictactoe", peer("B"));
  await B.openFromCard(card, cardMsg("A"), [peer("A")]);
  await tick();
  for (const [who, mv] of [[A, "0"], [B, "3"], [A, "1"], [B, "4"], [A, "2"]]) {
    assert.equal(await who.play(match.id, mv), null);
    await tick();
  }
  return { net, A, B, id: match.id };
}

test("S2-07 another round is asked for: nothing changes until the other says yes", async () => {
  const { A, B, id } = await finished();
  await A.rematch(id, { ask: true });
  await tick(12);
  assert.equal(A.getMatch(id).status, "over", "the asker's board stays as it was");
  assert.equal(A.getMatch(id).round, 1);
  assert.deepEqual(A.getMatch(id).asked, { round: 2 });
  assert.equal(B.getMatch(id).status, "over", "the asked player's finished game is still there to look at");
  assert.equal(B.getMatch(id).moves.length, 5);
  assert.deepEqual(B.getMatch(id).rematchAsk, { round: 2 });
  // B says yes.
  await B.acceptRematch(id);
  await tick(12);
  for (const pc of [A, B]) {
    assert.equal(pc.getMatch(id).status, "playing");
    assert.equal(pc.getMatch(id).round, 2);
    assert.deepEqual(pc.getMatch(id).moves, []);
    assert.equal(pc.getMatch(id).asked, undefined);
    assert.equal(pc.getMatch(id).rematchAsk, undefined);
  }
  assert.equal(B.myTurn(B.getMatch(id)), true, "the other player starts the second round");
  assert.equal(await B.play(id, "4"), null);
  await tick();
  assert.deepEqual(A.getMatch(id).moves, ["4"]);
});

test("S2-07 \"not now\" leaves both boards as they were, and the asker is told", async () => {
  const { A, B, id } = await finished();
  await A.rematch(id, { ask: true });
  await tick(12);
  await B.declineRematch(id);
  await tick(12);
  assert.equal(A.getMatch(id).asked, undefined);
  assert.match(A.getMatch(id).note, /does not want another round/);
  for (const pc of [A, B]) {
    assert.equal(pc.getMatch(id).status, "over");
    assert.equal(pc.getMatch(id).round, 1);
    assert.equal(pc.getMatch(id).moves.length, 5);
  }
  // Asking again is possible, and a yes then starts the round.
  await A.rematch(id, { ask: true });
  await tick(12);
  await B.acceptRematch(id);
  await tick(12);
  assert.equal(A.getMatch(id).round, 2);
});

test("S2-07 both ask at the same moment: the round simply starts", async () => {
  const { net, A, B, id } = await finished();
  net.hold = (from, to, step) => step.action === "rematch";
  await A.rematch(id, { ask: true });
  await B.rematch(id, { ask: true });
  await tick();
  net.hold = null;
  await net.release();
  await tick(20);
  for (const pc of [A, B]) {
    assert.equal(pc.getMatch(id).status, "playing");
    assert.equal(pc.getMatch(id).round, 2);
    assert.deepEqual(pc.getMatch(id).moves, []);
  }
});

test("S2-07 a request for another round never wipes a game that is being played", async () => {
  const net = makeNet();
  const A = await net.boot("A");
  const B = await net.boot("B");
  const { match, card } = A.challenge("tictactoe", peer("B"));
  const id = match.id;
  await B.openFromCard(card, cardMsg("A"), [peer("A")]);
  await tick();
  assert.equal(await A.play(id, "0"), null);
  await tick();
  assert.equal(await B.play(id, "4"), null);
  await tick();
  // A "rematch" for a later round arrives in the middle of the game (an old copy pressed too early, or a changed one).
  for (const data of [{ round: 2 }, { round: 2, ask: 1 }, { round: 9 }]) {
    await net.send("B", "A", { match_id: id, game: "tictactoe", action: "rematch", seq: 0, data, at: 0 });
    await tick(12);
    assert.equal(A.getMatch(id).round, 1);
    assert.deepEqual(A.getMatch(id).moves, ["0", "4"], "the game on A's board is untouched (it used to be wiped)");
    assert.equal(A.getMatch(id).rematchAsk, undefined);
  }
  assert.equal(await A.play(id, "1"), null);
  await tick();
  assert.deepEqual(B.getMatch(id).moves, ["0", "4", "1"]);
});

test("S2-07 with a colleague on an older LANX another round starts at once, as before", async () => {
  const { A, B, id } = await finished();
  // (the board asks only when the colleague's LANX can answer; for an older one it calls rematch without "ask")
  assert.equal(A.versionAtLeast("3.16.1", A.REMATCH_ASK), false);
  assert.equal(A.versionAtLeast("3.17.0", A.REMATCH_ASK), true);
  assert.equal(A.versionAtLeast("3.9.9", "3.17.0"), false);
  assert.equal(A.versionAtLeast("4.0.0", "3.17.0"), true);
  assert.equal(A.versionAtLeast(undefined, "3.17.0"), false);
  await A.rematch(id);
  await tick(12);
  for (const pc of [A, B]) {
    assert.equal(pc.getMatch(id).status, "playing");
    assert.equal(pc.getMatch(id).round, 2);
  }
});

// ------------------------------------------------------------------ S2-12
test("S2-12 the PCs of a game compare what they see: the same moves giving another game is noticed", async () => {
  const net = makeNet();
  const A = await net.boot("A");
  const B = await net.boot("B");
  const { match, card } = A.challenge("ludo", peer("B"));
  const id = match.id;
  await B.openFromCard(card, cardMsg("A"), [peer("A")]);
  await tick();
  assert.equal(await A.play(id, "r"), null);
  await tick(12);
  // Every step carries a fingerprint, and the two agree.
  const steps = net.log.filter((l) => l.action === "move");
  assert.match(steps.at(-1).data.fp, /^1:\d+:[0-9a-z]+$/);
  assert.equal(A.getMatch(id).fp, B.getMatch(id).fp);
  assert.ok(!A.getMatch(id).outOfStep && !B.getMatch(id).outOfStep);
  // A copy that makes another game of the same moves (another die, say) would send another fingerprint.
  const now = B.getMatch(id);
  const [round, count] = now.fp.split(":");
  await net.send("A", "B", { match_id: id, game: "ludo", action: "move", seq: 0, data: { moves: now.moves, round: 1, first: "A", fp: `${round}:${count}:zzzz` }, at: 0 });
  await tick(12);
  assert.equal(B.getMatch(id).outOfStep, true, "B is told that the two PCs do not see the same game (this used to stay unnoticed)");
  // The same moves and the same fingerprint again: all is well again.
  await net.send("A", "B", { match_id: id, game: "ludo", action: "move", seq: 0, data: { moves: now.moves, round: 1, first: "A", fp: now.fp }, at: 0 });
  await tick(12);
  assert.equal(B.getMatch(id).outOfStep, false);
  // A fingerprint of another moment of the game, or none at all (an older LANX), says nothing.
  for (const fp of [`${round}:${Number(count) + 3}:zzzz`, `2:${count}:zzzz`, undefined]) {
    await net.send("A", "B", { match_id: id, game: "ludo", action: "move", seq: 0, data: { moves: now.moves, round: 1, first: "A", fp }, at: 0 });
    await tick(12);
    assert.equal(B.getMatch(id).outOfStep, false, String(fp));
  }
});

test("S2-12 a table: a guest compares with the host, through a whole game without a false alarm", async () => {
  const { net, pcs, id } = await table("chainreaction");
  await playOut(pcs, id, 5);
  for (const k of Object.keys(pcs)) assert.ok(!pcs[k].getMatch(id).outOfStep, `${k} in step`);
  assert.ok(net.log.filter((l) => l.action === "state").every((l) => typeof l.data.fp === "string"));
  // The host's news with another fingerprint for the same moves: the guest is told.
  const h = pcs.H.getMatch(id);
  const last = net.log.filter((l) => l.to === "G1" && l.action === "state").at(-1).data;
  await net.send("H", "G1", { match_id: id, game: "chainreaction", action: "state", seq: 0, data: { ...last, rev: last.rev + 1, fp: `${h.round}:${h.moves.length}:zzzz` }, at: 0 });
  await tick(12);
  assert.equal(pcs.G1.getMatch(id).outOfStep, true);
});

// ------------------------------------------------------------------ S2-13
test("S2-13 the rules: an answer says which round it is for, and is refused in any other", async () => {
  const { tapRoulette } = await import(new URL("../../src/lib/games/party.ts", import.meta.url).href);
  const { werewolf } = await import(new URL("../../src/lib/games/werewolf.ts", import.meta.url).href);
  const rules = await import(new URL("../../src/lib/gameRules.ts", import.meta.url).href);
  const T = 1_700_000_000_000;
  const round1 = [`o:1:${T}`];
  assert.ok(tapRoulette.replay([...round1, "0@a#1:in"], 3, "m-s13#1"), "an answer for the open round");
  assert.equal(tapRoulette.replay([...round1, "0@a#2:in"], 3, "m-s13#1"), null, "an answer for another round");
  assert.ok(tapRoulette.replay([...round1, "0@a:in"], 3, "m-s13#1"), "the old form (a game played before 3.17.0) is still read");
  const round2 = [...round1, "0@a#1:in", "e:1", `o:2:${T}`];
  assert.equal(tapRoulette.replay([...round2, "1@a#1:in"], 3, "m-s13#1"), null, "a late answer for round 1 is not taken for round 2");
  assert.ok(tapRoulette.replay([...round2, "1@a#2:in"], 3, "m-s13#1"));
  // The store marks an answer with the round it is given in; other moves are left alone.
  assert.equal(rules.stampMove("taproulette", round2, 3, "m-s13#1", "1@a:in"), "1@a#2:in");
  assert.equal(rules.stampMove("trivia", [], 3, "m-s13#1", "2@a:1"), "2@a#0:1");
  assert.equal(rules.stampMove("drawguess", [], 3, "m-s13#1", "2@a:a guess: with a colon"), "2@a#0:a guess: with a colon");
  assert.equal(rules.stampMove("taproulette", round2, 3, "m-s13#1", "1@a#2:in"), "1@a#2:in", "marked already");
  assert.equal(rules.stampMove("battleship", [], 2, "s", "0@ready"), "0@ready");
  assert.equal(rules.stampMove("tictactoe", [], 2, "s", "4"), "4");
  assert.equal(rules.stampMove("ludo", [], 2, "s", "r"), "r");
  // Werewolf: a vote says which day it is for.
  const day1 = ["night:1", "dawn:1:none", "day:1"];
  assert.ok(werewolf.replay(day1, 5, "m-ww#1"));
  assert.ok(werewolf.replay([...day1, "0@v#1:1"], 5, "m-ww#1"));
  assert.ok(werewolf.replay([...day1, "0@v:1"], 5, "m-ww#1"), "the old form");
  assert.equal(werewolf.replay([...day1, "0@v#2:1"], 5, "m-ww#1"), null);
  const day2 = [...day1, "lynch:1:none", "night:2", "dawn:2:none", "day:2"];
  assert.ok(werewolf.replay(day2, 5, "m-ww#1"));
  assert.equal(werewolf.replay([...day2, "0@v#1:1"], 5, "m-ww#1"), null, "yesterday's vote is not counted today");
  assert.ok(werewolf.replay([...day2, "0@v#2:skip"], 5, "m-ww#1"));
  assert.equal(rules.stampMove("werewolf", day2, 5, "m-ww#1", "3@v:1"), "3@v#2:1");
});

test("S2-13 a table: an answer that arrives after the next round has opened is not taken for it", async () => {
  const { net, pcs, id } = await table("taproulette");
  const { H, G1, G2 } = pcs;
  const T = 1_700_000_000_000;
  assert.equal(await H.play(id, `o:1:${T}`), null);
  await tick(12);
  // G1 taps in round 1, but the tap is held up on the way.
  net.hold = (from, to, step) => from === "G1" && step.action === "move";
  assert.equal(await G1.play(id, "1@a:in"), null);
  await tick();
  assert.equal(net.held.length, 1);
  assert.equal(net.held.length && net.log.filter((l) => l.from === "G1" && l.action === "move").at(-1).data.cell, "1@a#1:in", "the tap says it is for round 1");
  net.hold = null;
  // Meanwhile the host closes round 1 (G1 "did not tap in") and opens round 2.
  assert.equal(await G2.play(id, "2@a:in"), null);
  assert.equal(await H.play(id, "0@a:in"), null);
  await tick(12);
  assert.equal(await H.play(id, "e:1"), null);
  assert.equal(await H.play(id, `o:2:${T}`), null);
  await tick(12);
  // Now G1's tap for round 1 arrives.
  await net.release();
  await tick(20);
  const moves = H.getMatch(id).moves;
  assert.ok(!moves.some((x) => x.startsWith("1@a")), `G1's late tap is not in round 2 (it used to be counted there): ${moves.join(" ")}`);
  assert.deepEqual(G1.getMatch(id).moves, moves, "and G1's board has been put right");
  // G1 taps in round 2 for real.
  assert.equal(await G1.play(id, "1@a:in"), null);
  await tick(12);
  assert.ok(H.getMatch(id).moves.includes("1@a#2:in"));
});
