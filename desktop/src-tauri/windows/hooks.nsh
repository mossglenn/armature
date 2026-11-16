; Hooks into Tauri's NSIS installer (bundle.windows.nsis.installerHooks in tauri.conf.json).
;
; After an install or an update, tell Windows' shell that icons may have changed. Explorer keeps
; icons in a cache keyed by the executable's path, and an update replaces the executable at the
; same path, so without this the taskbar, the Start menu and the desktop shortcut may go on
; showing the icon of the version installed before (seen 2026-11-08 on a Windows PC: the new icon
; in the window and the tray, the old one on the taskbar). Tauri's own template sends this
; notification only when the program registers file associations, and this one registers none.
;
; Two calls, since neither is documented as covering every surface:
;   SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_FLUSH)  the documented request to rebuild the cache
;   ie4uinit.exe -show                                Windows 10 and 11's own refresh of it
; The second is skipped quietly where the file is absent. Both run per user, without elevation,
; and in a silent install too, which is how the updater runs the installer.
!macro NSIS_HOOK_POSTINSTALL
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)'
  Push $0
  nsExec::Exec '"$SYSDIR\ie4uinit.exe" -show'
  Pop $0 ; nsExec's result, not used
  Pop $0 ; the register as the installer left it
!macroend
