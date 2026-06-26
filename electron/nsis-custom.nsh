; ──────────────────────────────────────────────
; Buddy NSIS 自定义安装脚本
; ──────────────────────────────────────────────

!macro customInit
  ; 检查是否已运行，提示关闭
  nsExec::ExecToLog 'tasklist /FI "IMAGENAME eq Buddy.exe" /NH'
  Pop $0
  ${If} $0 == "0"
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION "Buddy 正在运行，安装前需要关闭。$\n$\n点击确定自动关闭并继续安装。" IDOK closeApp IDCANCEL abortInstall
    closeApp:
      nsExec::ExecToLog 'taskkill /IM Buddy.exe /F'
      Sleep 1000
      Goto done
    abortInstall:
      Abort
    done:
  ${EndIf}
!macroend

!macro customInstall
  ; 创建开始菜单快捷方式组
  CreateDirectory "$SMPROGRAMS\Buddy"

  ; 创建卸载快捷方式到开始菜单
  CreateShortcut "$SMPROGRAMS\Buddy\卸载 Buddy.lnk" "$INSTDIR\Uninstall Buddy.exe"

  ; 添加防火墙规则（允许 WebSocket 通信）
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Buddy AI" dir=in action=allow program="$INSTDIR\Buddy.exe" enable=yes profile=any'

  ; 注册 URL Protocol（buddy:// 唤起应用）
  WriteRegStr HKCU "SOFTWARE\Classes\buddy" "" "URL:Buddy Protocol"
  WriteRegStr HKCU "SOFTWARE\Classes\buddy" "URL Protocol" ""
  WriteRegStr HKCU "SOFTWARE\Classes\buddy\shell\open\command" "" '"$INSTDIR\Buddy.exe" "%1"'

  ; 文件关联（.buddy 文件）
  WriteRegStr HKCU "SOFTWARE\Classes\.buddy" "" "Buddy.Workspace"
  WriteRegStr HKCU "SOFTWARE\Classes\Buddy.Workspace\shell\open\command" "" '"$INSTDIR\Buddy.exe" "%1"'
!macroend

!macro customUnInit
  ; 卸载前关闭应用
  nsExec::ExecToLog 'taskkill /IM Buddy.exe /F' 2>nul
  Sleep 1000
!macroend

!macro customUnInstall
  ; 删除防火墙规则
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Buddy AI"' 2>nul

  ; 删除 URL Protocol 注册
  DeleteRegKey HKCU "SOFTWARE\Classes\buddy"

  ; 删除文件关联
  DeleteRegKey HKCU "SOFTWARE\Classes\.buddy"
  DeleteRegKey HKCU "SOFTWARE\Classes\Buddy.Workspace"

  ; 删除开始菜单组
  RMDir /r "$SMPROGRAMS\Buddy"

  ; 删除用户数据（可选，询问用户）
  MessageBox MB_YESNO|MB_ICONQUESTION "是否删除用户数据（聊天记录、设置等）？" IDYES deleteData IDNO keepData
  deleteData:
    RMDir /r "$APPDATA\Buddy"
    RMDir /r "$LOCALAPPDATA\Buddy"
    Goto doneData
  keepData:
    ; 保留数据
  doneData:
!macroend
