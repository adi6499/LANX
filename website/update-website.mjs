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
  if (/^LANX-(Setup-|\d+\.\d+\.\d+-linux-)/i.test(old) && !old.startsWith(name) && !old.startsWith(`LANX-${version}-linux-`)) {
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

// 2b. LANX for Linux: the .deb and .AppImage of the SAME version, if they were
//     built (node linux/build.mjs) and sit next to the installer.
//     Files over 50 MB (the AppImage is ~80 MB) are left out unless you pass
//     --appimage: GitHub/Vercel cope badly with big files in a repository.
const linux = {};
const MAX_SITE_FILE = 50 * 1048576;
const withAppImage = process.argv.includes("--appimage");
for (const [key, ext] of [["deb", "deb"], ["appimage", "AppImage"]]) {
  const lname = `LANX-${version}-linux-amd64.${ext}`;
  const lsrc = path.join(path.dirname(src), lname);
  if (!fs.existsSync(lsrc)) continue;
  const lbytes = fs.readFileSync(lsrc);
  if (lbytes.length > MAX_SITE_FILE && !withAppImage) {
    console.log(`  skipped       ${lname} (${(lbytes.length / 1048576).toFixed(0)} MB is too big for the repository; add --appimage to force it)`);
    continue;
  }
  fs.writeFileSync(path.join(filesDir, lname), lbytes);
  const lsha = crypto.createHash("sha256").update(lbytes).digest("hex");
  fs.writeFileSync(path.join(filesDir, lname + ".sha256.txt"), `${lsha}  ${lname}
`);
  linux[key] = { file: `/files/${lname}`, bytes: lbytes.length, size: (lbytes.length / 1048576).toFixed(1) + " MB", sha256: lsha };
  console.log(`  copied        files\\${lname}  (${linux[key].size})`);
}
if (!Object.keys(linux).length) console.log(`  (no Linux files for ${version} next to the installer — the Linux section stays hidden)`);

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
  linux: Object.keys(linux).length ? linux : undefined,
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
if (linux.deb) {
  setText("debSize", linux.deb.size);
  setText("debSha", linux.deb.sha256);
  html = html.replace(/href="[^"]*"(\s+data-v="debHref")/g, `href="${linux.deb.file}"$1`);
}
if (linux.appimage) {
  setText("appSize", linux.appimage.size);
  setText("appSha", linux.appimage.sha256);
  html = html.replace(/href="[^"]*"(\s+data-v="appHref")/g, `href="${linux.appimage.file}"$1`);
}
for (const [key, attr] of [["deb", "data-linux-deb"], ["appimage", "data-linux-appimage"]]) {
  html = linux[key]
    ? html.replace(new RegExp(`(${attr})\\s+hidden`, "g"), "$1")
    : html.replace(new RegExp(`(${attr})(?!\\s+hidden)`, "g"), "$1 hidden");
}
// Show the Linux parts only when there is something to download.
html = Object.keys(linux).length
  ? html.replace(/(data-linux-only)\s+hidden/g, "$1")
  : html.replace(/(data-linux-only)(?!\s+hidden)/g, "$1 hidden");
fs.writeFileSync(htmlPath, html);
console.log(`  updated       index.html`);

// 5. vercel.json — the /download and /latest links. There are two copies:
//    website/vercel.json (used when Vercel's Root Directory is "website") and
//    the one at the repository root (used when it is not). Keep both in step.
for (const vPath of [path.join(here, "vercel.json"), path.resolve(here, "..", "vercel.json")]) {
  if (!fs.existsSync(vPath)) continue;
  const v = JSON.parse(fs.readFileSync(vPath, "utf8"));
  for (const r of v.redirects || []) if (r.source === "/download" || r.source === "/latest") r.destination = info.file;
  fs.writeFileSync(vPath, JSON.stringify(v, null, 2) + "\n");
  console.log(`  updated       ${path.relative(path.resolve(here, ".."), vPath)}`);
}

console.log(`
Done. The website now offers LANX ${version} (${size}).
Next, publish it (Vercel follows the main branch on GitHub):
    git add website vercel.json
    git commit -m "Website: LANX ${version}"
    git push origin main
`);
