// Writes wordbox-grids.json: forty letter grids as this engine makes them. The same forty
// must come out of the Linux and iPhone engine (WebKit); the test compares against this file.
import fs from "node:fs";
const { wordboxGrid } = await import(new URL("../../src/lib/games/wordbox.ts", import.meta.url).href);
const out = {};
for (let g = 0; g < 40; g++) {
  const seed = `m-${(g * 7919 + 13).toString(36)}-wb${g}#${1 + (g % 3)}`;
  const round = 1 + (g % 5);
  out[`${seed}|${round}`] = wordboxGrid(seed, round).join("");
}
fs.writeFileSync(new URL("./wordbox-grids.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log(Object.keys(out).length, "grids written");
