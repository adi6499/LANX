// Ludo for 2 to 4 players, as LANX 3.18.0 plays it: whole games played with chance moves, and a
// fingerprint of every position on the way. Made ONCE from the 3.18.0 rules, before Ludo got its
// six-sided board for 5 and 6 players; the test "Ludo for 2 to 4 players is unchanged" replays
// these games with the rules of today and must get the very same positions. (An older LANX at the
// table replays the same moves, so the game for 2 to 4 must never change by a hair.)
// Do not run this again: it would only record whatever the rules do now.
//   node --import ./tests/games/harness/hooks.mjs tests/games/make-ludo-fixture.mjs
import { createHash } from "node:crypto";
import fs from "node:fs";

const { ludo, ludoMovable } = await import(new URL("../../src/lib/games/ludo.ts", import.meta.url).href);
const out = [];
for (const n of [2, 3, 4]) {
  for (const game of [1, 2, 3, 4]) {
    const seed = `fixture-${n}-${game}`;
    let a = n * 1000 + game * 77;
    const rnd = () => ((a = (a * 1103515245 + 12345) >>> 0) / 4294967296);
    const moves = [];
    const hash = createHash("sha256");
    let s = ludo.replay(moves, n, seed);
    // In two of the four games somebody leaves on the way (never the last two).
    const leaveAt = game % 2 === 0 ? 40 + game * 15 : -1;
    for (let ply = 0; ply < 4000 && s.winner === null; ply++) {
      let m;
      if (ply === leaveAt && n > 2) m = `x${(s.turn + 1) % n}`;
      else if (!s.roll) m = "r";
      else {
        const can = ludoMovable(s);
        m = `m:${can[Math.floor(rnd() * can.length)]}`;
      }
      moves.push(m);
      s = ludo.replay(moves, n, seed);
      if (!s) throw new Error(`refused: ${m} after ${moves.length - 1} moves (${seed})`);
      hash.update(JSON.stringify(s));
    }
    out.push({ n, seed, moves: moves.join(" "), positions: hash.digest("hex"), last: s, summary: ludo.summary(s), outcome: ludo.outcome(s) });
  }
}
fs.writeFileSync(new URL("./ludo-3180.json", import.meta.url), JSON.stringify(out, null, 1));
console.log(out.map((g) => `${g.seed}: ${g.moves.split(" ").length} moves, winner ${g.last.winner}`).join("\n"));
