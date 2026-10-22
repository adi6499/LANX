#!/usr/bin/env bash
# Smoke test of a built LANX for Linux, inside WSL (as root), on a hidden
# virtual screen: installs the .deb, starts LANX with a test profile, checks
# that the window appears and the network ports are open, saves a screenshot.
#   HOST=/mnt/c/.../LANAPPLICATION OUT=/mnt/c/.../somewhere bash linux/smoke-in-wsl.sh
set -uo pipefail
HOST="${HOST:-/host}"; OUT="${OUT:-/tmp}"
VERSION=$(node -p "require('$HOST/package.json').version" 2>/dev/null || grep -m1 '"version"' "$HOST/package.json" | sed 's/[^0-9.]//g')
DEB="$HOST/release/LANX-$VERSION-linux-amd64.deb"
echo "== installing $DEB"
apt-get install -y --no-install-recommends "$DEB" >/tmp/lanx-deb-install.log 2>&1 || { tail -20 /tmp/lanx-deb-install.log; echo "✖ .deb did not install"; exit 1; }
dpkg -s lanx | grep -E "^(Package|Version|Status)"
ls -la /usr/bin/lanx /usr/share/applications/*lanx* 2>/dev/null

echo "== starting a virtual screen"
pkill -x Xvfb 2>/dev/null; sleep 0.5; rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
Xvfb :99 -screen 0 1280x800x24 >/tmp/xvfb.log 2>&1 &
sleep 2
export DISPLAY=:99
export LANX_PROFILE=smoke
export WEBKIT_DISABLE_COMPOSITING_MODE=1
rm -rf "$HOME/.local/share/com.lanx.desktop-smoke" "$HOME/.local/share/LANX-smoke" 2>/dev/null

echo "== starting LANX (test profile 'smoke')"
pkill -x lanx 2>/dev/null; sleep 0.5
# Loopback only (LANX's own test switches): the test copy must never appear as
# a colleague in the real LANX on this PC or on the office network.
export LANX_BIND=127.0.0.1 LANX_UDP_PORT=53925 LANX_TCP_PORT=53926 LANX_QUIET=1
/usr/bin/lanx >/tmp/lanx-smoke.log 2>&1 &
LPID=$!
for i in $(seq 1 40); do
  sleep 1
  if xdotool search --name "LANX" >/dev/null 2>&1; then break; fi
done
sleep 4
echo "== process alive: $(kill -0 $LPID 2>/dev/null && echo yes || echo NO)"
echo "== windows:"; xdotool search --name "LANX" 2>/dev/null | while read -r w; do echo "   $(xdotool getwindowname "$w") ($(xdotool getwindowgeometry "$w" | tr '\n' ' '))"; done
echo "== listening ports:"; (ss -lntup 2>/dev/null || netstat -lntup 2>/dev/null) | grep -i lanx || echo "   (none found)"
sleep 20
import -window root "$OUT/lanx-linux-smoke.png" 2>/dev/null && echo "== screenshot: $OUT/lanx-linux-smoke.png"
echo "== LANX output (first lines):"; head -20 /tmp/lanx-smoke.log
kill $LPID 2>/dev/null; sleep 1; pkill -x lanx 2>/dev/null; pkill -x Xvfb 2>/dev/null
echo "== smoke test done"
