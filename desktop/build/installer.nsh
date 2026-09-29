; Yukti one-click installer additions (electron-builder NSIS).
; Uninstall also removes the AI components Yukti downloaded (server, engines, model: several GB) and asks whether to
; delete the user's data. Nothing is removed when a newer Yukti-Setup.exe is installing over this one (update).
!macro customUnInstall
  ${ifNot} ${isUpdated}
    nsExec::Exec 'taskkill /F /IM yukti-server.exe'
    nsExec::Exec 'taskkill /F /IM llama-server.exe'
    RMDir /r "$LOCALAPPDATA\Yukti\Server"
    MessageBox MB_YESNO|MB_ICONQUESTION "Also delete Yukti's data on this computer (documents, chats, users and backups)?$\r$\n$\r$\nChoose No to keep it, for example to reinstall Yukti later." /SD IDNO IDNO yukti_keep_data
      RMDir /r "$LOCALAPPDATA\Yukti\data"
      RMDir /r "$LOCALAPPDATA\Yukti\models"
    yukti_keep_data:
  ${endIf}
!macroend
