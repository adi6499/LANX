#!/usr/bin/env node
// Build LANX for Linux from this Windows PC.
//
//   node linux/build.mjs            → release/LANX-<version>-linux-amd64.deb + -linux-x86_64.rpm (+ .sha256.txt)
//   node linux/build.mjs --check    → only "cargo check" (fast: does the Rust code compile on Linux?)
//   node linux/build.mjs --test     → the Rust unit tests on Linux
//
// Where it builds (Linux programs can only be built on Linux):
//   1. WSL  — the Ubuntu inside Windows (preferred: "Ubuntu-22.04" so the result
//             runs on Ubuntu 22.04 and newer; else "Ubuntu"). First run installs
//             the build tools there (linux/setup-wsl.sh), later runs reuse them.
//   2. Docker Desktop, if it is running and WSL is not usable (linux/Dockerfile).
// Force one with --wsl or --docker; pick a WSL distro with --distro <name>.
import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(root, "release");
fs.mkdirSync(releaseDir, { recursive: true });
const args = process.argv.slice(2);
const mode = args.includes("--check") ? "check" : args.includes("--test") ? "test" : "build";
const script = { check: "check-in-container.sh", test: "test-in-container.sh", build: "build-in-container.sh" }[mode];
const distroArg = args.includes("--distro") ? args[args.indexOf("--distro") + 1] : null;

const sh = process.platform === "win32";
function run(cmd, cmdArgs, direct = false) {
  console.log(`\n$ ${cmd} ${cmdArgs.join(" ")}`);
  // `direct`: no cmd.exe in between (it mangles quoted paths with spaces).
  const r = spawnSync(cmd, cmdArgs, { stdio: "inherit", shell: sh && !direct });
  if (r.status !== 0) {
    console.error(`\n✖ ${cmd} failed (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
}
function out(cmd, cmdArgs) {
  const r = spawnSync(cmd, cmdArgs, { encoding: "utf8", shell: sh });
  return r.status === 0 ? (r.stdout || "").replace(/\0/g, "") : "";
}

// --- where?
const wslDistros = out("wsl.exe", ["-l", "-q"]).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
const wslDistro = distroArg || ["Ubuntu-22.04", "Ubuntu-24.04", "Ubuntu"].find((d) => wslDistros.includes(d));
const dockerUp = /linux/.test(out("docker", ["version", "--format", "{{.Server.Os}}"]));
let where = args.includes("--docker") ? "docker" : args.includes("--wsl") ? "wsl" : wslDistro ? "wsl" : dockerUp ? "docker" : null;
if (where === "wsl" && !wslDistro) where = null;
if (where === "docker" && !dockerUp) where = null;
if (!where) {
  console.error(`✖ No Linux to build in. Either install Ubuntu in WSL (PowerShell: wsl --install -d Ubuntu-22.04 --no-launch)
  or start Docker Desktop, then run this again.`);
  process.exit(1);
}

if (where === "wsl") {
  // C:\Users\... → /mnt/c/Users/...
  const toWsl = (p) => p.replace(/^([A-Za-z]):\\/, (_, d) => `/mnt/${d.toLowerCase()}/`).replace(/\\/g, "/");
  const host = toWsl(root);
  const q = (s) => `"${s.replace(/"/g, '\\"')}"`;
  const inner = [
    `cd ${q(host)}`,
    `bash linux/setup-wsl.sh`,
    `HOST=${q(host)} WORK=/root/lanx-work OUT=${q(host + "/release")} bash linux/${script}`,
  ].join(" && ");
  console.log(`Building in WSL distro "${wslDistro}" (as root). First time: installs build tools, downloads Rust crates.`);
  // --exec: WSL runs bash with exactly these arguments (no second shell parsing them).
  run("wsl.exe", ["-d", wslDistro, "-u", "root", "--exec", "bash", "-c", inner], true);
} else {
  console.log("Building in Docker (linux/Dockerfile).");
  run("docker", ["build", "-t", "lanx-linux-builder", path.join(root, "linux")]);
  run("docker", [
    "run", "--rm",
    "-v", `${root}:/host:ro`,
    "-v", `${releaseDir}:/out`,
    "-v", "lanx-linux-work:/work",
    "-v", "lanx-linux-cargo:/opt/cargo/registry",
    "lanx-linux-builder", "bash", `/host/linux/${script}`,
  ]);
}

if (mode === "build") {
  const ver = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  console.log(`\nDone. Linux files in release\\:
  LANX-${ver}-linux-amd64.deb       (Ubuntu / Debian / Mint: double-click or "sudo apt install ./LANX-${ver}-linux-amd64.deb")
  LANX-${ver}-linux-x86_64.rpm     (Fedora: double-click, or "sudo dnf install ./LANX-${ver}-linux-x86_64.rpm")
  (or for any of them, one line:  (wget -qO- https://lanx-website.vercel.app/install.sh 2>/dev/null || curl -fsSL https://lanx-website.vercel.app/install.sh) | sh)
Then put them on the website:  node website/update-website.mjs`);
}
