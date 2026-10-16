; LANX installer hooks (included by Tauri's NSIS template).
;
; The installer runs as administrator (installMode = perMachine), so it can
; open LANX in Windows Defender Firewall up front. Without this, Windows shows
; a "Windows Defender Firewall has blocked some features of this app" popup on
; first launch, and on networks marked "Public" LANX silently cannot receive.

!define LANX_FW_RULE "LANX Messenger"
!define LANX_FW_RULE_PUBLIC "LANX Messenger (public networks, local subnet only)"

!macro NSIS_HOOK_POSTINSTALL
  ; Drop old rules for this program, including any "Block" rule Windows made
  ; if someone pressed Cancel on a firewall popup for an earlier LANX.
  nsExec::Exec 'netsh advfirewall firewall delete rule name=all program="$INSTDIR\${MAINBINARYNAME}.exe"'
  Pop $0
  ; Office (domain) and home/work (private) networks: allow LANX.
  nsExec::Exec 'netsh advfirewall firewall add rule name="${LANX_FW_RULE}" description="Lets colleagues on your local network reach LANX for chat, file transfers and discovery." dir=in action=allow program="$INSTDIR\${MAINBINARYNAME}.exe" enable=yes profile=domain,private'
  Pop $0
  ; Networks Windows marked "Public": only computers on the same subnet.
  nsExec::Exec 'netsh advfirewall firewall add rule name="${LANX_FW_RULE_PUBLIC}" description="Lets computers on the same local subnet reach LANX." dir=in action=allow program="$INSTDIR\${MAINBINARYNAME}.exe" enable=yes profile=public remoteip=localsubnet'
  Pop $0
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  nsExec::Exec 'netsh advfirewall firewall delete rule name="${LANX_FW_RULE}"'
  Pop $0
  nsExec::Exec 'netsh advfirewall firewall delete rule name="${LANX_FW_RULE_PUBLIC}"'
  Pop $0
  ; "Start with Windows" entry created by LANX for this user.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "LANX"
!macroend
