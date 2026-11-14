#!/bin/sh
# LANX for Linux — install or update in one line (Ubuntu, Debian, Mint, Pop!_OS, Zorin, Fedora):
#
#     (wget -qO- https://lanx-website.vercel.app/install.sh 2>/dev/null || curl -fsSL https://lanx-website.vercel.app/install.sh) | sh
#
# (That line uses wget or curl, whichever this computer has: many Mint and Ubuntu computers
# have wget but no curl. Shorter, to type by hand: wget -qO- https://lanx-website.vercel.app/install.sh | sh)
#
# No password is needed. It downloads the newest LANX from the LANX website, checks it and
# installs it for you alone, in your own folder (~/.local/lib/lanx), with its entry in the
# applications menu, and opens LANX. Run it again any time to update. Nothing else on the
# computer is changed.
#
# The administrator's password is asked only when it cannot be avoided: this computer is
# missing a system part LANX needs, it is a Fedora computer, or you ask for LANX to be
# installed for every user of the computer:
#
#     … | sh -s -- --system
#
# To take your own copy away again (your chats stay):   … | sh -s -- --remove
set -eu

SITE="${LANX_SITE:-https://lanx-website.vercel.app}"

say() { printf '\033[1;36m%s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m%s\033[0m\n' "$*"; }
fail() {
  printf '\033[1;31m%s\033[0m\n' "$*" >&2
  exit 1
}

MODE=user
for a in "$@"; do
  case "$a" in
    --system) MODE=system ;;
    --user) MODE=user ;;
    --remove) MODE=remove ;;
  esac
done
# The administrator installs for everyone.
if [ "$(id -u)" -eq 0 ] && [ "$MODE" = user ]; then MODE=system; fi

# Where your own copy lives.
SHARE="${XDG_DATA_HOME:-$HOME/.local/share}"
LIBDIR="$HOME/.local/lib/lanx"
BIN="$LIBDIR/lanx"
ENTRY="$SHARE/applications/LANX.desktop"
AUTOSTART="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"

# "Start with the computer" (LANX writes that entry itself, with the program it ran from):
# it must start the copy that is installed now, not one that is older or gone.
point_autostart() { # from-program to-program ("" = that program is gone: no entry)
  for f in "$AUTOSTART"/*.desktop; do
    [ -f "$f" ] || continue
    grep -q "^Exec=\"\{0,1\}$1\"\{0,1\}\( \|$\)" "$f" 2>/dev/null || continue
    if [ -n "$2" ]; then
      sed "s|^Exec=\"\{0,1\}$1\"\{0,1\}|Exec=\"$2\"|" "$f" > "$f.new" && mv -f "$f.new" "$f"
    else
      rm -f "$f"
    fi
  done
}

if [ "$MODE" = remove ]; then
  rm -rf "$LIBDIR"
  rm -f "$HOME/.local/bin/lanx" "$ENTRY"
  find "$SHARE/icons" -name 'lanx.png' -exec rm -f {} + 2>/dev/null || true
  if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database "$SHARE/applications" >/dev/null 2>&1 || true; fi
  say "Your own copy of LANX is removed. Your chats are kept (in $SHARE/LANX)."
  if command -v dpkg-query >/dev/null 2>&1 && dpkg-query -W -f='${Status}' lanx 2>/dev/null | grep -q '^install ok installed'; then
    point_autostart "$BIN" /usr/bin/lanx
    warn "A LANX installed for every user of this computer is still there. To remove that one too (it asks the administrator's password): sudo apt remove lanx"
  else
    point_autostart "$BIN" ""
  fi
  exit 0
fi

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
  # (Fedora's packages can't be unpacked into your own folder the same way.)
  if [ "$MODE" = user ]; then
    MODE=system
    warn "On Fedora LANX is installed for the whole computer: the administrator's password is asked."
  fi
else
  fail "This Linux has neither apt nor dnf. Download the .deb or .rpm from $SITE and install it with your package manager."
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

# A LANX installed for every user of this computer (by the administrator, or by an earlier
# version of this installer): its version, or nothing.
SYS_VERSION=""
if [ "$KIND" = deb ]; then
  SYS_VERSION=$(dpkg-query -W -f='${Status} ${Version}' lanx 2>/dev/null | sed -n 's/^install ok installed //p' || true)
fi

open_lanx() { # the program to start
  # Open it (a LANX already running is replaced by the new one), unless this is a session
  # without a screen (over SSH, say).
  if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] && [ "$(id -u)" -ne 0 ] && command -v "$1" >/dev/null 2>&1; then
    say "Opening LANX…"
    if command -v setsid >/dev/null 2>&1; then
      setsid "$1" --restart >/dev/null 2>&1 < /dev/null &
    else
      nohup "$1" --restart >/dev/null 2>&1 < /dev/null &
    fi
  fi
}

# Nothing to do: the whole computer already has this LANX, and you have no copy of your own
# (which would be the one the menu opens).
if [ "$MODE" = user ] && [ ! -x "$BIN" ] && [ -n "$SYS_VERSION" ] && dpkg --compare-versions "$SYS_VERSION" ge "$VERSION" 2>/dev/null; then
  say "LANX $SYS_VERSION is already installed on this computer. It is in your applications menu."
  open_lanx lanx
  exit 0
fi

say "Downloading LANX $VERSION ($NAME)…"
fetch "$SITE$FILE" "$TMP/$NAME" || fail "The download didn't finish. Please try again."
chmod 644 "$TMP/$NAME" 2>/dev/null || true
if fetch "$SITE$FILE.sha256.txt" "$TMP/sum.txt" 2>/dev/null && command -v sha256sum >/dev/null 2>&1; then
  WANT=$(cut -d' ' -f1 "$TMP/sum.txt")
  GOT=$(sha256sum "$TMP/$NAME" | cut -d' ' -f1)
  [ "$WANT" = "$GOT" ] || fail "The downloaded file is damaged (its fingerprint doesn't match). Please try again."
fi

# ---------------------------------------------------------------- for you alone (no password)

# The system parts the package says it needs that this computer does not have.
missing_parts() {
  for p in $(dpkg-deb -f "$TMP/$NAME" Depends 2>/dev/null | tr ',' '\n' | sed 's/^ *//; s/[ (|].*//' | sort -u); do
    dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -q '^install ok installed' || printf ' %s' "$p"
  done
}

# Installs into your own folder. Fails (and says why) when that can't work on this computer.
user_install() {
  command -v dpkg-deb >/dev/null 2>&1 || return 1
  X="$TMP/unpacked"
  mkdir -p "$X"
  dpkg-deb -x "$TMP/$NAME" "$X" 2>/dev/null || return 1
  [ -f "$X/usr/bin/lanx" ] || return 1
  MISSING=$(missing_parts)
  if [ -z "$MISSING" ] && command -v ldd >/dev/null 2>&1 && ldd "$X/usr/bin/lanx" 2>/dev/null | grep -q 'not found'; then
    MISSING=" (a system library)"
  fi
  if [ -n "$MISSING" ]; then
    warn "This computer is missing system parts LANX needs:$MISSING"
    return 1
  fi
  FROM=$(ls "$X"/usr/share/applications/*.desktop 2>/dev/null | head -n 1)
  [ -n "$FROM" ] || return 1
  mkdir -p "$LIBDIR" "$HOME/.local/bin" "$SHARE/applications"
  # (Put in place in one step: a LANX that is running keeps working until it is restarted.)
  cp "$X/usr/bin/lanx" "$LIBDIR/lanx.new"
  chmod 755 "$LIBDIR/lanx.new"
  mv -f "$LIBDIR/lanx.new" "$BIN"
  printf '%s\n' "$VERSION" > "$LIBDIR/VERSION"
  ln -sf "$BIN" "$HOME/.local/bin/lanx"
  if [ -d "$X/usr/share/icons" ]; then
    mkdir -p "$SHARE/icons"
    cp -R "$X/usr/share/icons/." "$SHARE/icons/"
  fi
  # The menu entry: the package's own, pointing at your copy. (An entry of the same name
  # for the whole computer is hidden by yours.)
  BINQ=$(printf '%s' "$BIN" | sed 's/[\\&|]/\\&/g')
  sed "s|^Exec=lanx|Exec=\"$BINQ\"|" "$FROM" > "$ENTRY.new"
  mv -f "$ENTRY.new" "$ENTRY"
  if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database "$SHARE/applications" >/dev/null 2>&1 || true; fi
  if command -v gtk-update-icon-cache >/dev/null 2>&1; then gtk-update-icon-cache -q -f -t "$SHARE/icons/hicolor" >/dev/null 2>&1 || true; fi
  # (An older LANX for the whole computer may have set itself to start with the computer.)
  point_autostart /usr/bin/lanx "$BIN"
  return 0
}

if [ "$MODE" = user ]; then
  say "Installing LANX for you (no password needed)…"
  if user_install; then
    say "LANX $VERSION is installed. It is in your applications menu."
    if [ -n "$SYS_VERSION" ] && [ "$SYS_VERSION" != "$VERSION" ]; then
      warn "An older LANX ($SYS_VERSION) installed for every user of this computer is still there; the menu now opens your new one. To remove the old one (optional, it asks the administrator's password): sudo apt remove lanx"
    fi
    # Colleagues reach LANX through the firewall only if it lets them. (An earlier install
    # for the whole computer already saw to that.)
    if [ -z "$SYS_VERSION" ] && [ -r /etc/ufw/ufw.conf ] && grep -q '^ENABLED=yes' /etc/ufw/ufw.conf 2>/dev/null; then
      warn "This computer's firewall is switched on. Colleagues can find this computer only once LANX is let through it. To do that, run this once (it asks the administrator's password):"
      warn "  (wget -qO- $SITE/install.sh 2>/dev/null || curl -fsSL $SITE/install.sh) | sh -s -- --system"
    fi
    open_lanx "$BIN"
    exit 0
  fi
  warn "So LANX has to be installed for the whole computer this time, and the administrator's password is asked once. (If you don't have it, ask the person who looks after this computer to run this line.)"
fi

# ------------------------------------------------- for the whole computer (asks the password)

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 || fail "Installing for the whole computer needs an administrator: run this again as root, or install sudo."
  SUDO="sudo"
  # Ask once, here, so a wrong or missing password is said plainly (and not as a failed install).
  say "The administrator's password is needed for this. Type it and press Enter (on some computers nothing shows while you type)…"
  sudo -v || fail "Without the administrator's password LANX can't be installed for the whole computer. Ask the person who looks after this computer to run this line once."
fi

if [ "$KIND" = deb ]; then
  # LANX needs the web engine Ubuntu 22.04 / Debian 12 / Mint 21 and newer have.
  if command -v apt-cache >/dev/null 2>&1 && ! apt-cache policy libwebkit2gtk-4.1-0 2>/dev/null | grep -q 'Candidate: [0-9]'; then
    $SUDO apt-get update -qq >/dev/null 2>&1 || true
    apt-cache policy libwebkit2gtk-4.1-0 2>/dev/null | grep -q 'Candidate: [0-9]' ||
      fail "This Linux is too old for LANX: it needs Ubuntu 22.04, Debian 12, Linux Mint 21 or newer."
  fi
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

say "Installing LANX for the whole computer…"
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
# (Your own copy, if it is another version, would hide the one just installed for the
# whole computer: it goes. Your chats are not in there.)
if [ "$(id -u)" -ne 0 ] && [ -x "$BIN" ] && [ "$(cat "$LIBDIR/VERSION" 2>/dev/null || true)" != "$VERSION" ]; then
  rm -rf "$LIBDIR"
  rm -f "$HOME/.local/bin/lanx" "$ENTRY"
  point_autostart "$BIN" /usr/bin/lanx
fi
if [ -x "$BIN" ]; then open_lanx "$BIN"; else open_lanx lanx; fi
