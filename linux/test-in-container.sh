#!/usr/bin/env bash
# Runs INSIDE the lanx-linux-builder container: the Rust unit tests on Linux.
set -euo pipefail
# Paths: Docker mounts /host, /work and /out; the WSL route passes them in.
HOST="${HOST:-/host}"; WORK="${WORK:-/work}"; OUT="${OUT:-/out}"
export PATH="$HOME/.cargo/bin:$PATH"
export APPIMAGE_EXTRACT_AND_RUN=1 NO_STRIP=true
mkdir -p "$WORK/src"
cd "$WORK/src"
rsync -a --delete \
  --exclude node_modules --exclude src-tauri/target --exclude dist --exclude release \
  --exclude .git --exclude signing --exclude linux --exclude "*.lanxbackup" \
  "$HOST/" "$WORK/src/"
export CARGO_TARGET_DIR="$WORK/target"
export CARGO_NET_RETRY=10
cd src-tauri
mkdir -p ../dist
cargo test --locked --no-fail-fast -- --test-threads=4 2>&1 | grep -v "^\s*Compiling"
echo "== cargo test finished"
