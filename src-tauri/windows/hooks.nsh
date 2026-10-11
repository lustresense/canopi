; canoPi NSIS current-user uninstall retention flow.
; Default is Keep. Never touch opened project folders or existing OMP/9Router data.
; Contract (tests/package-contract.test.mjs): StrCpy $R8 "keep", MB_DEFBUTTON2,
; canopi_pre_delete, canopi-cleanup.ps1 must stay present.
;
; Safety notes (verified against tauri-bundler 2.8.0-2.12.x installer.nsi):
;  * The stock uninstall confirm page adds a "Delete app data" checkbox whose
;    handler runs `RmDir /r "$APPDATA\${BUNDLEID}"` and
;    `RmDir /r "$LOCALAPPDATA\${BUNDLEID}"`. NSIS RMDir /r follows junctions and
;    performs no canoPi ownership-marker validation. We force
;    $DeleteAppDataCheckboxState to 0 below so that blind deletion NEVER runs;
;    data deletion is finalized only by uninstall-data.ps1 against validated
;    canoPi-owned roots (marker `.canopi-owner`, reparse points refused).
;  * ${__FILEDIR__} resolves to this hook file's directory only at top level,
;    so the directory is captured in a !define before the macro bodies.
!define CANOPI_HOOK_DIR "${__FILEDIR__}"

!macro NSIS_HOOK_PREUNINSTALL
  StrCpy $R8 "keep"
  ; Neutralize the stock template's blind RmDir /r app-data deletion.
  StrCpy $DeleteAppDataCheckboxState 0
  IfSilent canopi_pre_done

  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Delete canoPi sessions, settings and cache permanently? No = Keep data (recommended). Project folders, global OMP and 9Router settings are never removed." IDYES canopi_pre_delete
  Goto canopi_pre_done
  canopi_pre_delete:
    StrCpy $R8 "delete"
  canopi_pre_done:

  ; Stop only processes whose executable lives inside THIS installation.
  ; Never touches a globally installed OMP engine or foreign processes.
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File "/oname=canopi-stop-processes.ps1" "${CANOPI_HOOK_DIR}\stop-canopi-processes.ps1"
  ExecWait 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\canopi-stop-processes.ps1" -InstallDir "$INSTDIR"' $R7
  StrCmp $R7 0 canopi_stop_ok
  IfSilent canopi_stop_ok
  MessageBox MB_OK|MB_ICONEXCLAMATION "canoPi could not fully stop its running processes within this installation. Uninstall continues; if files remain afterwards, close canoPi completely and run the uninstaller again. Data folders are unaffected by this step."
  canopi_stop_ok:
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  StrCmp $R8 "delete" 0 canopi_post_done
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File "/oname=canopi-cleanup.ps1" "${CANOPI_HOOK_DIR}\uninstall-data.ps1"
  ExecWait 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\canopi-cleanup.ps1"' $R7
  StrCmp $R7 0 canopi_post_done
  IfSilent canopi_post_done
  MessageBox MB_OK|MB_ICONEXCLAMATION "canoPi was uninstalled, but some canoPi data could not be safely deleted. No project, global OMP or 9Router files were touched. Details: $LOCALAPPDATA\canoPi-uninstall-receipt.json. Close other programs, then delete the remaining canoPi folders manually or rerun the uninstaller."
  canopi_post_done:
!macroend
