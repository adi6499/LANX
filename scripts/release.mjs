// After `tauri build`: copy the installer to ./release with its SHA-256, so
// there is one obvious file to share.
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const nsisDir = join(root, "src-tauri", "target", "release", "bundle", "nsis");
const installer = readdirSync(nsisDir).find((f) => f.endsWith("-setup.exe") && f.includes(version));
if (!installer) {
  console.error(`No installer for version ${version} in ${nsisDir}`);
  process.exit(1);
}

const outDir = join(root, "release");
mkdirSync(outDir, { recursive: true });
const target = join(outDir, `LANX-Setup-${version}.exe`);
copyFileSync(join(nsisDir, installer), target);

const data = readFileSync(target);
const sha = createHash("sha256").update(data).digest("hex");
writeFileSync(`${target}.sha256.txt`, `${sha}  LANX-Setup-${version}.exe\n`);

console.log(`\nInstaller ready: ${target}`);
console.log(`Size: ${(data.length / 1024 / 1024).toFixed(1)} MB   SHA-256: ${sha}`);
