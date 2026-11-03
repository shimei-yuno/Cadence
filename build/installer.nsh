; ---------------------------------------------------------------------------
; Cadence — extra uninstaller step (electron-builder picks up this file
; automatically from the build folder).
;
; When Cadence is uninstalled by hand, offer to delete the task files its tabs
; were tracking. The app keeps their paths in %APPDATA%\Cadence\vault-paths.txt
; (UTF-16, one path per line — see writeVaultList in electron/main.js).
;
; Safety rules:
;   - never during an upgrade (isUpdated) or a silent uninstall
;   - the answer defaults to "No"
;   - only .md and .txt files are ever deleted
; ---------------------------------------------------------------------------
!include "LogicLib.nsh"

; electron-builder compiles this file twice: once for the installer and once for
; the uninstaller (BUILD_UNINSTALLER). These variables are only used by the
; uninstaller, and NSIS warns about unused ones (warning 6001) — which
; electron-builder treats as a build error — so declare them only there.
!ifdef BUILD_UNINSTALLER
  Var cdnList
  Var cdnFile
  Var cdnLine
  Var cdnTail
  Var cdnShort
  Var cdnCount
  Var cdnMore
  Var cdnPreview
!endif

; Reads the next line of an open UTF-16 file into $cdnLine with any trailing
; CR/LF removed, or jumps to _eof at the end. _p makes the labels unique.
!macro cdnReadLine _h _eof _p
  ClearErrors
  FileReadUTF16LE ${_h} $cdnLine
  IfErrors ${_eof}
  ${_p}Strip:
    StrCpy $cdnTail $cdnLine 1 -1
    StrCmp $cdnTail "$\r" ${_p}Trim
    StrCmp $cdnTail "$\n" ${_p}Trim
    Goto ${_p}Done
  ${_p}Trim:
    StrCpy $cdnLine $cdnLine -1
    Goto ${_p}Strip
  ${_p}Done:
!macroend

; Jumps to _ok when $cdnLine looks like one of our task files (.md / .txt).
!macro cdnIsTaskFile _ok _p
  StrCmp $cdnLine "" ${_p}No
  StrCpy $cdnTail $cdnLine 3 -3
  StrCmp $cdnTail ".md" ${_ok}
  StrCpy $cdnTail $cdnLine 4 -4
  StrCmp $cdnTail ".txt" ${_ok}
  ${_p}No:
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
  ${ifNot} ${Silent}
    ; Electron keeps its data per user, even for an all-users install.
    ${if} $installMode == "all"
      SetShellVarContext current
    ${endif}
    StrCpy $cdnList "$APPDATA\Cadence\vault-paths.txt"
    ${if} $installMode == "all"
      SetShellVarContext all
    ${endif}

    ${if} ${FileExists} "$cdnList"
      StrCpy $cdnCount 0
      StrCpy $cdnPreview ""

      ; pass 1: count the task files and remember the first two for the prompt
      ClearErrors
      FileOpen $cdnFile "$cdnList" r
      IfErrors cdnAllDone
      cdnCountLoop:
        !insertmacro cdnReadLine $cdnFile cdnCountEnd cdnA
        !insertmacro cdnIsTaskFile cdnCountOk cdnB
        Goto cdnCountLoop
      cdnCountOk:
        IntOp $cdnCount $cdnCount + 1
        ${if} $cdnCount <= 2
          StrCpy $cdnShort $cdnLine 90
          StrCpy $cdnPreview "$cdnPreview$\r$\n  $cdnShort"
        ${endif}
        Goto cdnCountLoop
      cdnCountEnd:
      FileClose $cdnFile

      ${if} $cdnCount > 0
        StrCpy $cdnMore ""
        ${if} $cdnCount > 2
          IntOp $cdnTail $cdnCount - 2
          StrCpy $cdnMore "$\r$\n  ...and $cdnTail more"
        ${endif}
        MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 \
          "Cadence is tracking $cdnCount task file(s):$\r$\n$cdnPreview$cdnMore$\r$\n$\r$\nAlso delete these files from this computer?$\r$\n$\r$\nThis cannot be undone. If they are in a synced folder (Dropbox, iCloud, Syncthing...) they will be removed from your other devices too.$\r$\n$\r$\nChoose No to keep your task files." \
          IDYES cdnDoDelete IDNO cdnAllDone
      ${endif}
      Goto cdnAllDone

      ; pass 2: the person said yes
      cdnDoDelete:
      ClearErrors
      FileOpen $cdnFile "$cdnList" r
      IfErrors cdnAllDone
      cdnDelLoop:
        !insertmacro cdnReadLine $cdnFile cdnDelEnd cdnC
        !insertmacro cdnIsTaskFile cdnDelOk cdnD
        Goto cdnDelLoop
      cdnDelOk:
        Delete "$cdnLine"
        Goto cdnDelLoop
      cdnDelEnd:
      FileClose $cdnFile
      Delete "$cdnList"
      cdnAllDone:
    ${endif}
  ${endif}
  ${endif}
!macroend
