#!/usr/bin/env node
// update-website.mjs — put a new LANX installer on the website.
//
//   node website/update-website.mjs         → takes the NEWEST LANX-Setup-x.y.z.exe
//                                             from ..\LANAPPLICATION\release
//   node update-website.mjs C:\path\to\LANX-Setup-2.5.0.exe
//
// It copies the installer (+ .sig + .sha256.txt) into files\, removes the old
// one, and updates version.json, index.html and vercel.json. Then publish with:
//   vercel --prod
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const filesDir = path.join(here, "files");
const releaseDir = path.resolve(here, "..", "release");

const semver = (name) => {
  const m = /LANX-Setup-(\d+)\.(\d+)\.(\d+)\.exe$/i.exec(name);
  return m ? [+m[1], +m[2], +m[3]] : null;
};
const newer = (a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);

function pickInstaller() {
  const arg = process.argv[2];
  if (arg) {
    const p = path.resolve(arg);
    if (!fs.existsSync(p) || !semver(path.basename(p))) fail(`Not a LANX installer: ${p}`);
    return p;
  }
  if (!fs.existsSync(releaseDir)) fail(`Release folder not found: ${releaseDir}\nGive the installer path as an argument instead.`);
  const all = fs.readdirSync(releaseDir).filter((n) => semver(n));
  if (!all.length) fail(`No LANX-Setup-x.y.z.exe in ${releaseDir}`);
  all.sort((a, b) => newer(semver(b), semver(a)));
  return path.join(releaseDir, all[0]);
}

function fail(msg) {
  console.error("\n✖ " + msg + "\n");
  process.exit(1);
}

const src = pickInstaller();
const name = path.basename(src);
const version = semver(name).join(".");
const sigSrc = src + ".sig";
const shaSrc = src + ".sha256.txt";

console.log(`\nLANX ${version}  ←  ${src}`);

// 1. Copy the installer and its companions, remove older ones.
fs.mkdirSync(filesDir, { recursive: true });
for (const old of fs.readdirSync(filesDir)) {
  if (/^LANX-Setup-/i.test(old) && !old.startsWith(name)) {
    fs.unlinkSync(path.join(filesDir, old));
    console.log(`  removed old   files\\${old}`);
  }
}
fs.copyFileSync(src, path.join(filesDir, name));
console.log(`  copied        files\\${name}`);
let hasSig = false;
if (fs.existsSync(sigSrc)) {
  fs.copyFileSync(sigSrc, path.join(filesDir, name + ".sig"));
  hasSig = true;
  console.log(`  copied        files\\${name}.sig`);
} else {
  console.log(`  ! no .sig next to the installer — colleagues can't share this version through LANX itself (normal installs are fine)`);
}

// 2. Checksum (verify against the .sha256.txt if there is one).
const bytes = fs.readFileSync(path.join(filesDir, name));
const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
if (fs.existsSync(shaSrc)) {
  const expected = (fs.readFileSync(shaSrc, "utf8").trim().split(/\s+/)[0] || "").toLowerCase();
  if (expected && expected !== sha256) fail(`Checksum mismatch!\n  ${shaSrc} says ${expected}\n  but the file is   ${sha256}\nThe installer may be damaged. Build it again with "npm run release".`);
}
fs.writeFileSync(path.join(filesDir, name + ".sha256.txt"), `${sha256}  ${name}\n`);
console.log(`  checksum      ${sha256}`);

// 3. version.json
const stat = fs.statSync(src);
const date = stat.mtime;
const iso = date.toISOString().slice(0, 10);
const dateText = date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const size = (bytes.length / 1048576).toFixed(1) + " MB";
const info = {
  version,
  file: `/files/${name}`,
  sig: hasSig ? `/files/${name}.sig` : null,
  sha256File: `/files/${name}.sha256.txt`,
  sha256,
  bytes: bytes.length,
  size,
  date: iso,
  dateText,
  windows: "Windows 10 / 11, 64-bit",
};
fs.writeFileSync(path.join(here, "version.json"), JSON.stringify(info, null, 2) + "\n");
console.log(`  wrote         version.json`);

// 4. index.html — the values shown before JavaScript runs.
const htmlPath = path.join(here, "index.html");
let html = fs.readFileSync(htmlPath, "utf8");
const setText = (key, value) => {
  html = html.replace(new RegExp(`(<[^>]*data-v="${key}"[^>]*>)[^<]*(</)`, "g"), `$1${value}$2`);
};
setText("version", version);
setText("size", size);
setText("date", dateText);
setText("sha256", sha256);
html = html.replace(/href="[^"]*"(\s+data-v="dlHref")/g, `href="${info.file}"$1`);
html = html.replace(/href="[^"]*"(\s+data-v="sigHref")/g, `href="${info.sig || info.file}"$1`);
html = html.replace(/href="[^"]*"(\s+data-v="shaHref")/g, `href="${info.sha256File}"$1`);
fs.writeFileSync(htmlPath, html);
console.log(`  updated       index.html`);

// 5. vercel.json — the /download and /latest links.
const vPath = path.join(here, "vercel.json");
const v = JSON.parse(fs.readFileSync(vPath, "utf8"));
for (const r of v.redirects || []) if (r.source === "/download" || r.source === "/latest") r.destination = info.file;
fs.writeFileSync(vPath, JSON.stringify(v, null, 2) + "\n");
console.log(`  updated       vercel.json`);

console.log(`
Done. The website now offers LANX ${version} (${size}).
Next, publish it (Vercel follows the main branch on GitHub):
    git add website
    git commit -m "Website: LANX ${version}"
    git push origin main
`);
