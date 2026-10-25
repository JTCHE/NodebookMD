; Gives F1 back to Houdini's own help before the app goes, while the record of
; what F1 pointed at is still in the app data. An update runs this uninstaller
; too, with /UPDATE, and must keep the hook.
!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    ${Do}
      ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --unhook' $0
      ${If} $0 = 0
      ${OrIf} ${Silent}
      ${OrIf} $PassiveMode = 1
        ${Break}
      ${EndIf}
      ${IfNot} ${Cmd} `MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Houdini is open. Close Houdini, then click Retry.$\n$\nIf you click Cancel, F1 in Houdini continues to open ${PRODUCTNAME}, which will not be on this computer." IDRETRY`
        ${Break}
      ${EndIf}
    ${Loop}
  ${EndIf}
!macroend

; The app was called HoudiniMD. The installer names the install folder, the
; uninstall entry and the shortcuts after the product, so the new name would
; install beside the old one. This removes the old one. Its uninstaller runs in
; update mode: the app data (one identifier for both names) and the F1 hook
; stay, and the app names its new exe in F1's startup script at launch
; (`hook::refresh`).
;
; An update (the updater runs this with /UPDATE) makes no shortcuts, and the
; old uninstaller in update mode keeps its own. So each old shortcut is
; replaced here by one with the new name.
; Before 0.3.0 the exe was houdinimd.exe. The template closes the app by its
; new name only, so an open older app is closed here. Left open, it holds the
; data folders, which then cannot move, and the port F1 points at.
!macro NSIS_HOOK_PREINSTALL
  ${If} ${FileExists} "$INSTDIR\houdinimd.exe"
    !insertmacro CheckIfAppIsRunning "$INSTDIR\houdinimd.exe" "${PRODUCTNAME}"
  ${EndIf}
!macroend

!define OLD_PRODUCTNAME "HoudiniMD"
!define TASKBAR_PINS "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"
!macro NSIS_HOOK_POSTINSTALL
  ; Before 0.3.0 the exe was houdinimd.exe and the data folders were named
  ; com.houdinimd.app. The template moves the Start menu and desktop
  ; shortcuts to the new exe, but not a pin on the taskbar.
  ${If} $OldMainBinaryName != ""
  ${AndIf} $OldMainBinaryName != "${MAINBINARYNAME}.exe"
    !insertmacro IsShortcutTarget "${TASKBAR_PINS}\${PRODUCTNAME}.lnk" "$INSTDIR\$OldMainBinaryName"
    Pop $0
    ${If} $0 = 1
      !insertmacro SetShortcutTarget "${TASKBAR_PINS}\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    ${EndIf}
  ${EndIf}
  ; Moves the data folders, and names the new exe in Houdini's startup
  ; script, now: F1 then works if Houdini starts before the app does.
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --migrate'
  ReadRegStr $R0 HKCU "Software\houdinimd\${OLD_PRODUCTNAME}" ""
  ${If} $R0 != ""
  ${AndIf} ${FileExists} "$R0\uninstall.exe"
    ; `_?=` runs it in place and makes ExecWait wait for it, so it cannot
    ; remove itself or its folder; both go after.
    ExecWait '"$R0\uninstall.exe" /S /UPDATE _?=$R0'
    Delete "$R0\uninstall.exe"
    RMDir "$R0"
    !insertmacro REPLACE_OLD_SHORTCUT "$SMPROGRAMS"
    !insertmacro REPLACE_OLD_SHORTCUT "$DESKTOP"
    DeleteRegKey HKCU "Software\houdinimd\${OLD_PRODUCTNAME}"
    DeleteRegKey /ifempty HKCU "Software\houdinimd"
  ${EndIf}
!macroend

!macro REPLACE_OLD_SHORTCUT folder
  ${If} ${FileExists} "${folder}\${OLD_PRODUCTNAME}.lnk"
    !insertmacro UnpinShortcut "${folder}\${OLD_PRODUCTNAME}.lnk"
    Delete "${folder}\${OLD_PRODUCTNAME}.lnk"
    CreateShortcut "${folder}\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "${folder}\${PRODUCTNAME}.lnk"
  ${EndIf}
!macroend
