; Yukti one-click installer additions (electron-builder NSIS).
; Uninstall also removes the AI components Yukti downloaded (server, engines, model: several GB) and asks whether to
; delete the user's data. Nothing is removed when a newer Yukti-Setup.exe is installing over this one (update).
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; Stop only Yukti's own helper programs: the ones started from the Yukti folder. Stopping by name would also end an
    ; unrelated llama-server.exe (another AI program on this computer). $$_ is PowerShell's $_ (NSIS needs $$ for $).
    nsExec::Exec /TIMEOUT=30000 `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -like '$LOCALAPPDATA\Yukti\*' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
    Sleep 1500
    RMDir /r "$LOCALAPPDATA\Yukti\Server"
    ; A file was still in use (a program that needed a moment to end): wait and try once more. What is locked even then
    ; is left for Windows to remove at the next restart - the uninstall itself goes on and reports no error.
    ${if} ${FileExists} "$LOCALAPPDATA\Yukti\Server\*.*"
      Sleep 2500
      RMDir /r /REBOOTOK "$LOCALAPPDATA\Yukti\Server"
      SetRebootFlag false
    ${endIf}
    ClearErrors
    MessageBox MB_YESNO|MB_ICONQUESTION "Also delete Yukti's data on this computer (documents, chats, users and backups)?$\r$\n$\r$\nChoose No to keep it, for example to reinstall Yukti later." /SD IDNO IDNO yukti_keep_data
      RMDir /r "$LOCALAPPDATA\Yukti\data"
      RMDir /r "$LOCALAPPDATA\Yukti\models"
    yukti_keep_data:
  ${endIf}
!macroend
