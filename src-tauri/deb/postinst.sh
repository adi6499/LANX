#!/bin/sh
# LANX (.deb, after installing): colleagues on the local network must reach
# LANX. Most Linux desktops have no firewall switched on; when the ufw
# firewall is on, allow LANX's ports from private (office / home) networks
# only, so there is nothing to set up by hand. Never fails the install.
set +e
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  for net in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16; do
    ufw allow from "$net" to any port 52925 proto udp comment "LANX: finding colleagues" >/dev/null 2>&1
    ufw allow from "$net" to any port 52926 proto tcp comment "LANX: messages and files" >/dev/null 2>&1
    ufw allow from "$net" to any port 52930:52931 proto tcp comment "LANX: on your phone" >/dev/null 2>&1
  done
fi
exit 0
