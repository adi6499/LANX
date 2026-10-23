#!/usr/bin/env bash
# One-time setup of a WSL Ubuntu (22.04 or 24.04) as the LANX Linux build box.
# Run as root inside WSL (linux/build.mjs does this for you):
#   wsl -d Ubuntu-22.04 -u root -- bash /mnt/c/.../linux/setup-wsl.sh
# Safe to run again: it only installs what is missing.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

need_apt=0
for p in build-essential pkg-config libssl-dev libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf libxdo-dev libasound2-dev rsync file curl ca-certificates desktop-file-utils squashfs-tools libfuse2 cmake clang libclang-dev; do
  dpkg -s "$p" >/dev/null 2>&1 || need_apt=1
done
if [ "$need_apt" = 1 ]; then
  echo "== installing build packages (one time)"
  apt-get update
  apt-get install -y --no-install-recommends build-essential pkg-config libssl-dev libgtk-3-dev \
    libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf libxdo-dev libasound2-dev \
    rsync file curl wget ca-certificates git xz-utils desktop-file-utils squashfs-tools libfuse2 cmake clang libclang-dev
fi

# Node 22 (Vite 8 needs 20.19+).
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "== installing Node 22 (one time)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y --no-install-recommends nodejs
fi
node --version; npm --version

# Rust (stable), for root.
if ! command -v cargo >/dev/null 2>&1 && [ ! -x "$HOME/.cargo/bin/cargo" ]; then
  echo "== installing Rust (one time)"
  curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable
fi
export PATH="$HOME/.cargo/bin:$PATH"
rustc --version; cargo --version
echo "== setup done"
