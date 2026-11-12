#!/usr/bin/env bash
# Runs INSIDE the lanx-linux-builder container (see linux/build.mjs).
#   /host  = the LANAPPLICATION folder from Windows (read-only)
#   /work  = a Docker volume that keeps node_modules and the Rust build between runs
#   /out   = where the finished .deb and .rpm are copied (release/ on Windows)
set -euo pipefail
# Paths: Docker mounts /host, /work and /out; the WSL route passes them in.
HOST="${HOST:-/host}"; WORK="${WORK:-/work}"; OUT="${OUT:-/out}"
export PATH="$HOME/.cargo/bin:$PATH"
export APPIMAGE_EXTRACT_AND_RUN=1 NO_STRIP=true

echo "== LANX Linux build: $(date)"
mkdir -p "$WORK/src" "$OUT"
cd "$WORK/src"

echo "== copying source"
rsync -a --delete \
  --exclude node_modules --exclude src-tauri/target --exclude dist --exclude release \
  --exclude .git --exclude signing --exclude linux --exclude "*.lanxbackup" \
  "$HOST/" "$WORK/src/"

VERSION=$(node -p "require('./package.json').version")
echo "== version $VERSION"

echo "== npm install"
if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi

echo "== tauri build (deb + rpm)"
export CARGO_TARGET_DIR="$WORK/target"
export CARGO_NET_RETRY=10
npx tauri build --config src-tauri/tauri.linux.conf.json "$@"

echo "== results"
B="$WORK/target/release/bundle"
ls -la "$B/deb" "$B/rpm" 2>/dev/null || true
# This version's files only (older builds stay in the bundle folders).
DEB=$(ls "$B"/deb/*_"$VERSION"_*.deb | head -1)
RPM=$(ls "$B"/rpm/*-"$VERSION"-*.rpm | head -1)
cp -f "$DEB" "$OUT/LANX-$VERSION-linux-amd64.deb"
cp -f "$RPM" "$OUT/LANX-$VERSION-linux-x86_64.rpm"
cd "$OUT"
sha256sum "LANX-$VERSION-linux-amd64.deb" > "LANX-$VERSION-linux-amd64.deb.sha256.txt"
sha256sum "LANX-$VERSION-linux-x86_64.rpm" > "LANX-$VERSION-linux-x86_64.rpm.sha256.txt"
echo "== done: $(date)"
ls -la "$OUT"/LANX-$VERSION-linux-*
