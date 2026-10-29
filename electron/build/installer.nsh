; Custom NSIS hooks for Pocket Ledger installer (wired via build.nsis.include).
; First install: optional desktop shortcut prompt. Update/reinstall: keep existing shortcut, no prompt.
; BUILD_UNINSTALLER pass: no Var / desktop logic (NSIS warning 6001 as error otherwise).
; Update fix: the old uninstaller (run with --updated) deletes $INSTDIR and refreshes the shell while the exe is
; missing, so Explorer caches a blank icon for the desktop shortcut. createDesktopShortcut=false means
; electron-builder never refreshes it again, so customInstall re-creates it and notifies the shell.

!ifdef BUILD_UNINSTALLER
!macro customInit
!macroend
!macro customInstall
!macroend
!macro customUnInstall
  ; Real uninstall only (not the --updated pass): remove the desktop shortcut created by customInstall.
  ; DO_NOT_CREATE_DESKTOP_SHORTCUT makes electron-builder skip it, which left a blank orphan .lnk.
  ${IfNot} ${isUpdated}
    ${If} ${FileExists} "$newDesktopLink"
      WinShell::UninstShortcut "$newDesktopLink"
      Delete "$newDesktopLink"
      System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, i 0, i 0)'
    ${EndIf}
  ${EndIf}
!macroend
!else

Var PL_DESKTOP_PROMPT_OK

!macro customInit
  StrCpy $PL_DESKTOP_PROMPT_OK "yes"
  ReadRegStr $R0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $R1 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString
  ${If} $R0 != ""
  ${OrIf} $R1 != ""
    StrCpy $PL_DESKTOP_PROMPT_OK "no"
  ${EndIf}
!macroend

!macro customInstall
  ${IfNot} ${Silent}
    ${If} $PL_DESKTOP_PROMPT_OK == "no"
      Goto pl_desktop_done_pl
    ${EndIf}
    ${If} ${isUpdated}
      Goto pl_desktop_done_pl
    ${EndIf}
    ${If} ${FileExists} "$newDesktopLink"
      Goto pl_desktop_done_pl
    ${EndIf}
    ${If} ${FileExists} "$oldDesktopLink"
      Goto pl_desktop_done_pl
    ${EndIf}
    MessageBox MB_YESNO|MB_ICONQUESTION "Create a shortcut on your desktop?" /SD IDNO IDYES pl_desktop_yes_pl IDNO pl_desktop_no_pl
    pl_desktop_yes_pl:
      CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
      System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
    pl_desktop_no_pl:
    pl_desktop_done_pl:
  ${EndIf}

  ; Every install/update (silent included): re-point an existing desktop shortcut at the freshly written
  ; exe icon and tell Explorer to drop its cached (blank) icon for it and the Start menu link.
  ${If} ${FileExists} "$newDesktopLink"
    SetOutPath "$INSTDIR"
    CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
    System::Call 'shell32::SHChangeNotify(i 0x2000, i 0x1005, w "$newDesktopLink", i 0)'
  ${EndIf}
  ${If} ${FileExists} "$newStartMenuLink"
    System::Call 'shell32::SHChangeNotify(i 0x2000, i 0x1005, w "$newStartMenuLink", i 0)'
  ${EndIf}
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, i 0, i 0)'
!macroend

!endif
