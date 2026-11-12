#!/bin/sh
# LANX for Linux — install or update in one line (Ubuntu, Debian, Mint, Pop!_OS, Zorin, Fedora):
#
#     curl -fsSL https://lanx-website.vercel.app/install.sh | sh
#
# (or: wget -qO- https://lanx-website.vercel.app/install.sh | sh)
#
# It downloads the newest LANX package from the LANX website, checks it, installs it with
# your system's own installer (asking your password once) and opens LANX. Run it again
# any time to update. Nothing else on the computer is changed.
set -eu

SITE="${LANX_SITE:-https://lanx-website.vercel.app}"

say() { printf '\033[1;36m%s\033[0m\n' "$*"; }
fail() {
  printf '\033[1;31m%s\033[0m\n' "$*" >&2
  exit 1
}

[ "$(uname -s)" = "Linux" ] || fail "This installs LANX for Linux. On Windows, download LANX from $SITE"
case "$(uname -m)" in
  x86_64 | amd64) ;;
  *) fail "LANX for Linux needs a 64-bit Intel or AMD computer (this one is $(uname -m))." ;;
esac

fetch() { # url file
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 3 -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -q --tries=3 -O "$2" "$1"
  else
    fail "Please install curl or wget first (sudo apt install curl)."
  fi
}

if command -v apt-get >/dev/null 2>&1; then
  KIND=deb
  PATTERN='/files/LANX-[0-9][0-9.]*-linux-amd64\.deb'
elif command -v dnf >/dev/null 2>&1; then
  KIND=rpm
  PATTERN='/files/LANX-[0-9][0-9.]*-linux-x86_64\.rpm'
else
  fail "This Linux has neither apt nor dnf. Download the .deb or .rpm from $SITE and install it with your package manager."
fi

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 || fail "Installing needs an administrator: run this again as root, or install sudo."
  SUDO="sudo"
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT INT TERM

say "Finding the newest LANX…"
fetch "$SITE/version.json" "$TMP/version.json" || fail "Couldn't reach $SITE — is this computer online?"
FILE=$(grep -o "$PATTERN" "$TMP/version.json" | head -n 1 || true)
[ -n "$FILE" ] || fail "The LANX website has no .$KIND package right now. Please try again later."
NAME=$(basename "$FILE")
VERSION=$(printf '%s' "$NAME" | sed 's/^LANX-\([0-9.]*\)-.*/\1/')

if [ "$KIND" = deb ]; then
  # LANX needs the web engine Ubuntu 22.04 / Debian 12 / Mint 21 and newer have.
  if command -v apt-cache >/dev/null 2>&1 && ! apt-cache policy libwebkit2gtk-4.1-0 2>/dev/null | grep -q 'Candidate: [0-9]'; then
    $SUDO apt-get update -qq >/dev/null 2>&1 || true
    apt-cache policy libwebkit2gtk-4.1-0 2>/dev/null | grep -q 'Candidate: [0-9]' ||
      fail "This Linux is too old for LANX: it needs Ubuntu 22.04, Debian 12, Linux Mint 21 or newer."
  fi
fi

say "Downloading LANX $VERSION ($NAME)…"
fetch "$SITE$FILE" "$TMP/$NAME" || fail "The download didn't finish. Please try again."
if fetch "$SITE$FILE.sha256.txt" "$TMP/sum.txt" 2>/dev/null && command -v sha256sum >/dev/null 2>&1; then
  WANT=$(cut -d' ' -f1 "$TMP/sum.txt")
  GOT=$(sha256sum "$TMP/$NAME" | cut -d' ' -f1)
  [ "$WANT" = "$GOT" ] || fail "The downloaded file is damaged (its fingerprint doesn't match). Please try again."
fi

say "Installing (your password may be asked once)…"
if [ "$KIND" = deb ]; then
  $SUDO apt-get install -y "$TMP/$NAME" || fail "Installing didn't work. The messages above say why."
else
  $SUDO dnf install -y "$TMP/$NAME" || fail "Installing didn't work. The messages above say why."
fi

say "LANX $VERSION is installed. It is in your applications menu."
# Open it (a LANX already running is replaced by the new one), unless this is a session
# without a screen (over SSH, say).
if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] && [ "$(id -u)" -ne 0 ] && command -v lanx >/dev/null 2>&1; then
  say "Opening LANX…"
  if command -v setsid >/dev/null 2>&1; then
    setsid lanx --restart >/dev/null 2>&1 < /dev/null &
  else
    nohup lanx --restart >/dev/null 2>&1 < /dev/null &
  fi
fi
