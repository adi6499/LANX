#!/bin/sh
# LANX for Linux — install or update in one line (Ubuntu, Debian, Mint, Pop!_OS, Zorin, Fedora):
#
#     (wget -qO- https://lanx-website.vercel.app/install.sh 2>/dev/null || curl -fsSL https://lanx-website.vercel.app/install.sh) | sh
#
# (That line uses wget or curl, whichever this computer has: many Mint and Ubuntu computers
# have wget but no curl. Shorter, to type by hand: wget -qO- https://lanx-website.vercel.app/install.sh | sh)
#
# It downloads the newest LANX package from the LANX website, checks it, installs it with
# your system's own installer (asking your password once) and opens LANX. Run it again
# any time to update. Nothing else on the computer is changed.
set -eu

SITE="${LANX_SITE:-https://lanx-website.vercel.app}"

say() { printf '\033[1;36m%s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m%s\033[0m\n' "$*"; }
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
    fail "This computer has neither wget nor curl. Install one first (sudo apt install wget), then run this again."
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
# (The system's installer reads the package as its own user. Let it, or it ends with a
# worrying "Permission denied" note even though everything worked.)
chmod 755 "$TMP" 2>/dev/null || true

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
chmod 644 "$TMP/$NAME" 2>/dev/null || true
if fetch "$SITE$FILE.sha256.txt" "$TMP/sum.txt" 2>/dev/null && command -v sha256sum >/dev/null 2>&1; then
  WANT=$(cut -d' ' -f1 "$TMP/sum.txt")
  GOT=$(sha256sum "$TMP/$NAME" | cut -d' ' -f1)
  [ "$WANT" = "$GOT" ] || fail "The downloaded file is damaged (its fingerprint doesn't match). Please try again."
fi

install_package() {
  if [ "$KIND" = deb ]; then
    # (If the system's own updater is busy, wait for it for up to two minutes instead of failing.)
    $SUDO apt-get install -y -o DPkg::Lock::Timeout=120 "$TMP/$NAME"
  else
    $SUDO dnf install -y "$TMP/$NAME"
  fi
}

# Is this LANX fully installed now? The system's installer also ends with an error when some
# OTHER package on the computer is broken (a driver that can't be built for a new kernel,
# say), even though LANX itself went in fine. That must not be reported as LANX failing.
lanx_ready() {
  [ "$KIND" = deb ] || return 1
  case "$(dpkg-query -W -f='${Status} ${Version}' lanx 2>/dev/null || true)" in
    "install ok installed $VERSION"*) return 0 ;;
  esac
  return 1
}

say "Installing. If it asks for your password, type it and press Enter (on some computers nothing shows while you type)…"
OTHERS=no
if ! install_package; then
  if lanx_ready; then
    OTHERS=yes
  else
    [ "$KIND" = deb ] || fail "Installing didn't work. The messages above say why."
    # Most often the computer's list of system packages is out of date, so the parts LANX
    # needs can't be fetched: bring the list up to date and try once more.
    say "That didn't work. Bringing the system's package list up to date and trying once more…"
    $SUDO apt-get update || true
    if ! install_package; then
      lanx_ready || fail "Installing didn't work. The messages above say why."
      OTHERS=yes
    fi
  fi
fi

if [ "$OTHERS" = yes ]; then
  # The packages that are unpacked but could not finish installing (never LANX here).
  BROKEN=$(dpkg-query -W -f='${db:Status-Abbrev}${Package}\n' 2>/dev/null | sed -n 's/^i[FUH][ R]//p' | grep -v '^lanx$' | tr '\n' ' ' | sed 's/ *$//' || true)
  if [ -n "$BROKEN" ]; then
    warn "The errors above are not about LANX. Another package on this computer could not finish installing: $BROKEN"
    warn "It shows the same errors whenever anything is installed here, until it is repaired or removed."
  else
    warn "The system's installer reported a problem (see above), but LANX itself is installed."
  fi
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
