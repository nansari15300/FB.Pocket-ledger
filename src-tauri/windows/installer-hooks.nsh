; Pocket Ledger Tauri NSIS hooks (tauri.conf.json bundle.windows.nsis.installerHooks).
; ProductName "Pocket Ledger Tauri" / identifier com.pocketledger.desktop —
; Electron "Pocket Ledger" (pocket-ledger-electron) alag uninstall key par hai.
; IN TEEN MACRO ME ELECTRON KO KABHI UNINSTALL / DELETE MAT KARNA.

!macro NSIS_HOOK_PREINSTALL
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; First install: Tauri apna Start Menu shortcut khud banata hai.
  ; Yahan Electron desktop/start-menu .lnk nahi chhedte.
!macroend

!macro NSIS_HOOK_PREUNINSTALL
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
!macroend
