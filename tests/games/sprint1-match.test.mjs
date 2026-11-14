// LANX Games repair, Sprint 1: the two serious faults in how a match is carried between PCs.
// The real match code (src/lib/games.ts) runs here once per pretend PC, over a pretend office
// network on which a send can fail (tests/games/harness).
// Run: npm run test:games
import test from "node:test";
import assert from "node:assert/strict";
import { makeNet, peer, cardMsg, tick } from "./harness/net.mjs";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** A table of three at `game`: the host H and the guests G1 and G2, started. */
async function tableOfThree(game) {
  const net = makeNet();
  const H = await net.boot("H");
  const G1 = await net.boot("G1");
  const G2 = await net.boot("G2");
  const { match, cards } = H.challengeMany(game, [peer("G1"), peer("G2")]);
  await G1.openFromCard(cards[0].card, cardMsg("H"), [peer("H"), peer("G2")]);
  await G2.openFromCard(cards[1].card, cardMsg("H"), [peer("H"), peer("G1")]);
  await tick();
  assert.equal(await H.startNow(match.id), null);
  await tick();
  return { net, H, G1, G2, id: match.id };
}

// ------------------------------------------------------------------ S1-01
test("S1-01 two players: a move that could not be sent is sent again by itself", async () => {
  const net = makeNet();
  const A = await net.boot("A");
  const B = await net.boot("B");
  const { match, card } = A.challenge("tictactoe", peer("B"));
  const id = match.id;
  await B.openFromCard(card, cardMsg("A"), [peer("A")]);
  await tick();
  assert.equal(await A.play(id, "0"), null);
  await tick();
  assert.deepEqual(B.getMatch(id).moves, ["0"]);

  // B's PC cannot reach A for a moment (A's LANX is locked, say) — B moves just then.
  net.fail = (from) => from === "B";
  assert.equal(await B.play(id, "4"), null);
  await tick();
  assert.deepEqual(A.getMatch(id).moves, ["0"], "the move did not arrive");
  assert.ok(B.getMatch(id).error, "B is told the move could not be sent");
  assert.equal(B.unsentCount(id), 1);

  // The network is back. Nobody presses anything: the move arrives within two seconds.
  net.fail = null;
  await wait(1800);
  await tick();
  assert.deepEqual(A.getMatch(id).moves, ["0", "4"], "the move was sent again and arrived");
  assert.equal(A.myTurn(A.getMatch(id)), true, "A can play on (both used to wait for each other for good)");
  assert.equal(B.getMatch(id).error, null);
  assert.equal(B.unsentCount(id), 0);

  // The game is played to the end; it is counted once on each PC.
  for (const [who, mv] of [[A, "1"], [B, "8"], [A, "2"]]) {
    assert.equal(await who.play(id, mv), null);
    await tick();
  }
  assert.equal(A.getMatch(id).status, "over");
  assert.equal(B.getMatch(id).status, "over");
});

test("S1-01 two players: the last move of a game arrives too, and pressing Play on the card sends at once", async () => {
  const net = makeNet();
  const A = await net.boot("A");
  const B = await net.boot("B");
  const { match, card } = A.challenge("tictactoe", peer("B"));
  const id = match.id;
  await B.openFromCard(card, cardMsg("A"), [peer("A")]);
  await tick();
  for (const [who, mv] of [[A, "0"], [B, "3"], [A, "1"], [B, "4"]]) {
    assert.equal(await who.play(id, mv), null);
    await tick();
  }
  net.fail = (from) => from === "A";
  assert.equal(await A.play(id, "2"), null); // three in a row: A wins — and B does not hear of it
  await tick();
  assert.equal(A.getMatch(id).status, "over");
  assert.equal(B.getMatch(id).status, "playing");
  net.fail = null;
  // A presses Play on the card in the chat: what was waiting goes now (no need to wait for the clock).
  await A.openFromCard(card, { ...cardMsg("A"), is_outgoing: true }, [peer("B")]);
  await tick();
  assert.equal(B.getMatch(id).status, "over", "B hears the result");
  assert.deepEqual(B.getMatch(id).moves, ["0", "3", "1", "4", "2"]);
});

test("S1-01 two players: when anything arrives from the colleague, what was waiting for them goes at once", async () => {
  const net = makeNet();
  const A = await net.boot("A");
  const B = await net.boot("B");
  const { match, card } = A.challenge("tictactoe", peer("B"));
  const id = match.id;
  await B.openFromCard(card, cardMsg("A"), [peer("A")]);
  await tick();
  assert.equal(await A.play(id, "0"), null);
  await tick();
  net.fail = (from) => from === "B";
  assert.equal(await B.play(id, "4"), null);
  await tick();
  net.fail = null;
  // A (who has seen nothing) presses Play on the card again: A's copy asks B's nothing new, but
  // a step from A reaches B — and B's waiting move goes back at once.
  await net.send("A", "B", { match_id: id, game: "tictactoe", action: "state", seq: 1, data: { moves: ["0"], round: 1, first: "A" }, at: 0 });
  await tick();
  assert.deepEqual(A.getMatch(id).moves, ["0", "4"]);
});

test("S1-01 a table: a guest's move that could not be sent reaches the host, and is played once", async () => {
  const { net, H, G1, G2, id } = await tableOfThree("chainreaction");
  assert.equal(await H.play(id, "0"), null);
  await tick();
  net.fail = (from, to) => from === "G1" && to === "H";
  assert.equal(await G1.play(id, "20"), null);
  await tick();
  assert.deepEqual(H.getMatch(id).moves, ["0"], "the host has not got it");
  net.fail = null;
  await wait(1800);
  await tick();
  assert.deepEqual(H.getMatch(id).moves, ["0", "20"], "sent again, and the host has it");
  assert.deepEqual(G2.getMatch(id).moves, ["0", "20"], "and so has the other guest");
  assert.equal(G1.unsentCount(id), 0);

  // A move names its place in the game: the same one coming again, or late, is not played.
  const stale = { match_id: id, game: "chainreaction", action: "move", seq: 0, data: { cell: "20", n: 1 }, at: 0 };
  assert.equal(await G2.play(id, "40"), null);
  await tick();
  assert.equal(await H.play(id, "5"), null);
  await tick();
  assert.equal(H.myTurn(H.getMatch(id)), false);
  assert.equal(G1.myTurn(G1.getMatch(id)), true, "it is G1's turn again, and its own square 20 would be allowed again");
  await net.send("G1", "H", stale);
  await tick();
  assert.deepEqual(H.getMatch(id).moves, ["0", "20", "40", "5"], "the old move was not played a second time");
  // (A copy of LANX from before 3.16.0 names no place: its moves are taken as before.)
  await net.send("G1", "H", { ...stale, data: { cell: "20" } });
  await tick();
  assert.deepEqual(H.getMatch(id).moves, ["0", "20", "40", "5", "20"]);
});

test("S1-01 a table: the host's news reaches a guest who could not be reached for a moment", async () => {
  const { net, H, G1, G2, id } = await tableOfThree("chainreaction");
  net.fail = (from, to) => from === "H" && to === "G2";
  assert.equal(await H.play(id, "0"), null);
  await tick();
  assert.deepEqual(G1.getMatch(id).moves, ["0"]);
  assert.deepEqual(G2.getMatch(id).moves, [], "G2 has not heard");
  // G1 plays meanwhile: the host has more news for G2, and one send is waiting, not two.
  assert.equal(await G1.play(id, "1"), null);
  await tick();
  assert.equal(H.unsentCount(id), 1);
  net.fail = null;
  await wait(1800);
  await tick();
  assert.deepEqual(G2.getMatch(id).moves, ["0", "1"], "G2 gets the game as it stands now");
  assert.equal(G2.myTurn(G2.getMatch(id)), true);
  assert.equal(H.unsentCount(id), 0);
});

// ------------------------------------------------------------------ S1-02
for (const game of ["chainreaction", "memory", "dots", "mahjong", "ludo", "snakes", "bankroll", "dominoes", "minesvs"]) {
  test(`S1-02 ${game}, three players: someone who is out already presses Resign or Leave again — the others play on`, async () => {
    const { H, G1, G2, id } = await tableOfThree(game);
    // G2 gives up. The two others play on.
    await G2.resign(id);
    await tick();
    for (const pc of [H, G1, G2]) {
      assert.equal(pc.getMatch(id).status, "playing", "after the first Resign the game goes on");
      assert.ok(pc.getMatch(id).moves.includes("x2"));
    }
    const before = H.getMatch(id).moves.length;
    // The button is still on G2's screen. G2 presses it again…
    await G2.resign(id);
    await tick();
    for (const pc of [H, G1]) {
      assert.equal(pc.getMatch(id).status, "playing", "after the second Resign the game still goes on (it used to end for everyone, with no winner)");
      assert.equal(pc.getMatch(id).result, null);
    }
    // …and then "Leave table".
    await G2.leave(id);
    await tick();
    for (const pc of [H, G1]) {
      assert.equal(pc.getMatch(id).status, "playing", "after Leave table as well");
      assert.equal(pc.getMatch(id).result, null);
    }
    assert.equal(H.getMatch(id).moves.length, before, "nothing was added to the game");
    assert.equal(H.myTurn(H.getMatch(id)) || G1.myTurn(G1.getMatch(id)), true, "one of the two still in has the move");
    // When G1 gives up too, the host is the last one in and wins.
    await G1.resign(id);
    await tick();
    assert.equal(H.getMatch(id).status, "over");
    assert.equal(H.getMatch(id).result.winner, H.mySeat(H.getMatch(id)));
  });
}

test("S1-02 every game for three or more players knows a player leaving, at every table size (the fix relies on it)", async () => {
  const net = makeNet();
  const pc = await net.boot("S");
  const rules = await import(new URL("../../src/lib/gameRules.ts", import.meta.url).href);
  const games = pc.GAMES.filter((g) => g.maxPlayers >= 3 && g.kind !== "solo");
  assert.ok(games.length >= 30, `${games.length} games for three or more`);
  for (const g of games) {
    for (let n = Math.max(3, g.minPlayers); n <= g.maxPlayers; n++) {
      if (!pc.sizeOk(g, n)) continue;
      for (let p = 0; p < n; p++) assert.equal(rules.validateMoves(g.id, [`x${p}`], n, "m-leave#1"), true, `${g.id} with ${n} players: player ${p + 1} leaving is refused`);
      // …and leaving twice is refused by the rules (the store then leaves the game alone).
      assert.equal(rules.validateMoves(g.id, ["x1", "x1"], n, "m-leave#1"), false, `${g.id} with ${n} players: leaving twice is taken`);
    }
  }
});
