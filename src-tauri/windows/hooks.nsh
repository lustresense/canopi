; canoPi NSIS current-user uninstall retention flow.
; Default is Keep. Never touch opened project folders or existing OMP data.
!define CANOPI_HOOK_DIR "${__FILEDIR__}"

!macro NSIS_HOOK_PREUNINSTALL
  StrCpy $R8 "keep"
  IfSilent canopi_pre_done
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Delete canoPi sessions, settings and cache permanently? No = Keep data (recommended). Project folders and global OMP are never removed." IDYES canopi_pre_delete
  Goto canopi_pre_done
  canopi_pre_delete:
    StrCpy $R8 "delete"
  canopi_pre_done:
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  StrCmp $R8 "delete" 0 canopi_post_done
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File "/oname=canopi-cleanup.ps1" "${CANOPI_HOOK_DIR}\uninstall-data.ps1"
  ExecWait 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\canopi-cleanup.ps1"' $R7
  StrCmp $R7 0 canopi_post_done
  IfSilent canopi_post_done
  MessageBox MB_OK|MB_ICONEXCLAMATION "canoPi was uninstalled, but some data could not be safely deleted. No project or global OMP files were touched. Delete remaining canoPi folders manually after checking permissions."
  canopi_post_done:
!macroend
