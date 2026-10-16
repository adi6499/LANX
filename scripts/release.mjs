// After `tauri build`: copy the installer to ./release with its SHA-256 and
// its LANX release signature (.sig), so there is one obvious file to share.
// The .sig lets LANX 1.2+ pass the installer on to colleagues (Settings →
// Updates → Share an update); keep it next to the .exe.
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { signInstaller } from "./release-key.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const nsisDir = join(root, "src-tauri", "target", "release", "bundle", "nsis");
const installer = readdirSync(nsisDir).find((f) => f.endsWith("-setup.exe") && f.includes(`_${version}_`));
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
signInstaller(target, version);

console.log(`\nInstaller ready: ${target}`);
console.log(`Size: ${(data.length / 1024 / 1024).toFixed(1)} MB   SHA-256: ${sha}`);
console.log(`Release signature: ${target}.sig (keep it next to the .exe)`);
