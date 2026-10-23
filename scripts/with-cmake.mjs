#!/usr/bin/env node
// Runs `tauri <args>` with CMake on the PATH. The speech engine (whisper.cpp)
// is built with CMake; on this PC it was installed with `pip install cmake`,
// which Windows does not put on the PATH by itself.
//   node scripts/with-cmake.mjs build [--no-bundle]
//   node scripts/with-cmake.mjs dev
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function findCmake() {
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["cmake"], { encoding: "utf8" });
  if (probe.status === 0 && probe.stdout.trim()) return null; // already on the PATH
  const home = os.homedir();
  const candidates = [
    path.join(home, "AppData", "Local", "Packages"),
    "C:\\Program Files\\CMake\\bin",
    "C:\\Program Files\\Microsoft Visual Studio\\2022\\BuildTools\\Common7\\IDE\\CommonExtensions\\Microsoft\\CMake\\CMake\\bin",
    "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\Common7\\IDE\\CommonExtensions\\Microsoft\\CMake\\CMake\\bin",
  ];
  for (const c of candidates) {
    if (!fs.existsSync(c)) continue;
    if (fs.existsSync(path.join(c, "cmake.exe"))) return c;
    // pip's cmake lives under a Python package folder: …\PythonSoftwareFoundation.Python.*\LocalCache\local-packages\Python3xx\Scripts
    if (c.endsWith("Packages")) {
      for (const d of fs.readdirSync(c)) {
        if (!d.startsWith("PythonSoftwareFoundation.Python")) continue;
        const lp = path.join(c, d, "LocalCache", "local-packages");
        if (!fs.existsSync(lp)) continue;
        for (const v of fs.readdirSync(lp)) {
          const s = path.join(lp, v, "Scripts");
          if (fs.existsSync(path.join(s, "cmake.exe"))) return s;
        }
      }
    }
  }
  const pipUser = spawnSync("python", ["-c", "import cmake,os;print(cmake.CMAKE_BIN_DIR)"], { encoding: "utf8" });
  if (pipUser.status === 0 && pipUser.stdout.trim() && fs.existsSync(pipUser.stdout.trim())) return pipUser.stdout.trim();
  return undefined;
}

/** libclang (bindgen needs it to read whisper.cpp's headers). `pip install libclang` puts it in a Python package. */
function findLibclang() {
  if (process.env.LIBCLANG_PATH) return null;
  const py = spawnSync("python", ["-c", "import clang,os;print(os.path.join(os.path.dirname(clang.__file__),'native'))"], { encoding: "utf8" });
  if (py.status === 0 && py.stdout.trim() && fs.existsSync(path.join(py.stdout.trim(), "libclang.dll"))) return py.stdout.trim();
  for (const c of ["C:\\Program Files\\LLVM\\bin"]) if (fs.existsSync(path.join(c, "libclang.dll"))) return c;
  return process.platform === "win32" ? undefined : null;
}

const dir = findCmake();
const env = { ...process.env };
if (dir) {
  env.PATH = `${dir}${path.delimiter}${env.PATH ?? ""}`;
  console.log(`[with-cmake] using CMake from ${dir}`);
} else if (dir === undefined) {
  console.error("[with-cmake] CMake was not found. Install it once with:  python -m pip install --user cmake   (or winget install Kitware.CMake)");
  process.exit(1);
}
const lc = findLibclang();
if (lc) {
  env.LIBCLANG_PATH = lc;
  console.log(`[with-cmake] using libclang from ${lc}`);
} else if (lc === undefined) {
  console.error("[with-cmake] libclang was not found. Install it once with:  python -m pip install --user libclang   (or winget install LLVM.LLVM)");
  process.exit(1);
}
const r = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["tauri", ...process.argv.slice(2)], { stdio: "inherit", env, shell: process.platform === "win32" });
process.exit(r.status ?? 1);
