// LANX Games repair, Sprint 2: the host's steady clock (S2-03) and the live line of the
// real-time games (S2-11), each with stand-ins for what only a web engine has (a worker; a
// connection between two PCs).   Run: npm run test:games
import test from "node:test";
import assert from "node:assert/strict";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const lib = (f) => import(new URL(`../../src/lib/${f}`, import.meta.url).href);

// ------------------------------------------------------------------ S2-03
test("S2-03 the steady clock keeps time when the page's own timers are slowed (LANX hidden or minimised)", async () => {
  const { steadyInterval, steadyTimeout } = await lib("steadyClock.ts");
  const real = { setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, Worker: globalThis.Worker };
  const workers = [];
  // A stand-in worker: it ticks at the pace it is asked for, whatever the page does.
  globalThis.Worker = class {
    constructor(url) {
      this.url = url;
      this.timer = null;
      workers.push(this);
    }
    postMessage(ms) {
      this.timer = real.setInterval(() => this.onmessage?.({ data: 0 }), ms);
    }
    terminate() {
      real.clearInterval(this.timer);
      this.ended = true;
    }
  };
  // A hidden window: the page's timers come once a minute.
  globalThis.setInterval = (fn) => real.setInterval(fn, 60_000);
  try {
    let ticks = 0;
    const stop = steadyInterval(() => ticks++, 50);
    await wait(560);
    stop();
    assert.equal(workers[0].url, "/lanx-ticker.js");
    assert.ok(ticks >= 8 && ticks <= 12, `about ten ticks in half a second while the page is hidden: ${ticks}`);
    const after = ticks;
    await wait(150);
    assert.equal(ticks, after, "stopped means stopped");
    assert.equal(workers[0].ended, true);
    // "In 300 ms", asked of a hidden page: on time, and once.
    let fired = 0;
    const t0 = Date.now();
    let at = 0;
    steadyTimeout(() => {
      fired++;
      at = Date.now() - t0;
    }, 300);
    await wait(700);
    assert.equal(fired, 1);
    assert.ok(at >= 300 && at < 450, `fired after ${at} ms`);
    // Cancelled before its time: never.
    let never = 0;
    const cancel = steadyTimeout(() => never++, 200);
    cancel();
    await wait(350);
    assert.equal(never, 0);
  } finally {
    globalThis.setInterval = real.setInterval;
    globalThis.Worker = real.Worker;
  }
});

test("S2-03 with both clocks running (LANX in view) the work is not done twice as often", async () => {
  const { steadyInterval } = await lib("steadyClock.ts");
  const real = { Worker: globalThis.Worker };
  globalThis.Worker = class {
    postMessage(ms) {
      this.timer = setInterval(() => this.onmessage?.({ data: 0 }), ms);
    }
    terminate() {
      clearInterval(this.timer);
    }
  };
  try {
    let ticks = 0;
    const stop = steadyInterval(() => ticks++, 50);
    await wait(1030);
    stop();
    assert.ok(ticks >= 15 && ticks <= 26, `about twenty ticks in a second, not forty: ${ticks}`);
  } finally {
    globalThis.Worker = real.Worker;
  }
  // No worker to be had at all: the page's clock alone still does the work.
  const { steadyInterval: again } = await lib("steadyClock.ts");
  const W = globalThis.Worker;
  globalThis.Worker = class {
    constructor() {
      throw new Error("no workers here");
    }
  };
  try {
    let ticks = 0;
    const stop = again(() => ticks++, 40);
    await wait(300);
    stop();
    assert.ok(ticks >= 4, `the page's clock alone: ${ticks}`);
  } finally {
    globalThis.Worker = W;
  }
});

// ------------------------------------------------------------------ S2-11
/** Stand-ins for the connection between two PCs: a data channel that is open, or never opens. */
function fakeRtc(opens) {
  const made = [];
  globalThis.RTCPeerConnection = class {
    constructor() {
      this.localDescription = { sdp: "sdp" };
      this.iceGatheringState = "complete";
      made.push(this);
    }
    createDataChannel() {
      const dc = { readyState: "connecting", sentTexts: [], send(t) { this.sentTexts.push(t); }, close() {} };
      this.dc = dc;
      return dc;
    }
    async createOffer() { return { type: "offer", sdp: "sdp" }; }
    async createAnswer() { return { type: "answer", sdp: "sdp" }; }
    async setLocalDescription() {}
    async setRemoteDescription() {}
    addEventListener() {}
    removeEventListener() {}
    close() {}
  };
  return {
    made,
    /** Opens the lines of the players `opens` says yes to (in the order the host offered them). */
    settle(players) {
      made.forEach((pc, i) => {
        if (!pc.dc || !opens(players[i])) return;
        pc.dc.readyState = "open";
        pc.dc.onopen?.();
      });
    },
  };
}

test("S2-11 the live line: a player whose own line never opened still gets the game, through the host", async () => {
  const rtc = fakeRtc((p) => p !== 2); // player 2's line never opens
  const { GameChannel } = await lib("gameChannel.ts");
  const relayed = [];
  const host = new GameChannel({ me: 0, host: true, players: [0, 1, 2, 3], sendDelta: (d) => relayed.push(d) });
  await wait(30);
  rtc.settle([1, 2, 3]);
  relayed.length = 0; // (the offers went through the relay; from here on, the game)
  host.send({ t: "s", s: { n: 1 } });
  const lineOf = (i) => rtc.made[i].dc.sentTexts.map((t) => JSON.parse(t));
  assert.equal(lineOf(0).length, 1, "player 1 gets it on the line");
  assert.equal(lineOf(2).length, 1, "player 3 gets it on the line");
  assert.equal(lineOf(1).length, 0);
  assert.deepEqual(relayed.map((d) => [d.kind, d.to, d.payload.s.n]), [["live", 2, 1]], "player 2 gets it through the relay (it used to get nothing while the others had a line)");
  // The relay is not flooded: of many positions in a row, player 2 gets about ten a second.
  for (let n = 2; n <= 40; n++) host.send({ t: "s", s: { n } });
  assert.equal(lineOf(0).length, 40);
  assert.equal(relayed.length, 1, "none of the next 39 within the same tenth of a second");
  await wait(120);
  host.send({ t: "s", s: { n: 41 } });
  assert.equal(relayed.length, 2);
  assert.equal(relayed[1].payload.s.n, 41, "and what goes through is the newest");
  host.close();
});

test("S2-11 the live line: an older position that arrives after a newer one is left out", async () => {
  fakeRtc(() => false);
  const { GameChannel } = await lib("gameChannel.ts");
  const guest = new GameChannel({ me: 1, host: false, players: [0, 1], sendDelta: () => {} });
  const got = [];
  guest.onMessage((from, data) => got.push(`${from}:${data.s}`));
  // Through the relay, out of order: 5, then 3 (late), then 6; and one from an older LANX without a number.
  for (const [q, s] of [[5, "five"], [3, "three"], [6, "six"], [undefined, "old"]]) guest.feed({ kind: "live", from: 0, __from: 0, payload: { t: "s", s }, q });
  assert.deepEqual(got, ["0:five", "0:six", "0:old"]);
  // A guest whose line is not open sends its moves through the relay, also not more than ten a second.
  const out = [];
  const g2 = new GameChannel({ me: 2, host: false, players: [0, 1, 2], sendDelta: (d) => out.push(d) });
  for (let i = 0; i < 20; i++) g2.send({ t: "i", i: { x: i } });
  assert.equal(out.length, 1);
  assert.equal(typeof out[0].q, "number");
  guest.close();
  g2.close();
});
