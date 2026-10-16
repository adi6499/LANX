// Makes a small zip of the source code (no node_modules, no build output),
// suitable for sharing or backup. The build folders are what made the old
// LANAPPLICATION.zip 2.9 GB; they are recreated by `npm install` and `npm run release`.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
mkdirSync(join(root, "release"), { recursive: true });
const out = join("release", `LANX-source-${version}.zip`);

execFileSync(
  "tar",
  [
    "-a", "-c", "-f", out,
    "--exclude=node_modules",
    "--exclude=src-tauri/target",
    "--exclude=dist",
    "--exclude=release",
    "--exclude=.git",
    "--exclude=signing",
    "--exclude=*.pem",
    "--exclude=*.zip",
    ".",
  ],
  { cwd: root, stdio: "inherit" }
);
console.log(`Source zip: ${join(root, out)} (${(statSync(join(root, out)).size / 1024).toFixed(0)} KB)`);
