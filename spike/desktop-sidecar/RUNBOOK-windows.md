# The sidecar spike on the Windows laptop

For tec-757, in PowerShell, once the spike workflow has built the Windows installer. The Mac serves the files on the tailnet; nothing here needs Rust or a build. Node is already on the laptop (from the rehearsal of 2026-11-03). About five minutes.

1. **Fetch the installer and the check script** from the Mac:

   ```powershell
   mkdir C:\armature-spike -Force; cd C:\armature-spike
   curl.exe -O "http://100.85.125.14:8000/armature-spike-setup.exe"
   curl.exe -O "http://100.85.125.14:8000/spike-check.mjs"
   ```

2. **Install it, as a person would:** run the installer by double-clicking it in Explorer, so what SmartScreen says about an unsigned program is seen. Note what it shows and what you had to click. Then:

   ```powershell
   dir "$env:LOCALAPPDATA\Armature Spike"
   ```

3. **Open it once by hand** from the Start menu. A window titled "Armature (sidecar spike)" lists the events; note whether a console window flashes up beside it. Click **Ping the core**, then **Quit**. Then open it again and close the window with its X instead of Quit. After each:

   ```powershell
   Get-Process armature-node -ErrorAction SilentlyContinue
   Test-Path "$env:LOCALAPPDATA\com.mossglenn.armature.spike\workspaces\lock"
   ```

   Both should say nothing and `False`.

4. **Run the checks** (about a minute; windows open and close by themselves):

   ```powershell
   $exe = Get-ChildItem "$env:LOCALAPPDATA\Armature Spike\*.exe" | Where-Object { $_.Name -notmatch 'uninstall|armature-node' } | Select-Object -First 1
   node spike-check.mjs $exe.FullName > results.jsonl; type results.jsonl
   ```

5. **Inside the OneDrive folder, if wanted:** not part of this spike; the folder rules are the plan's §9.

6. **Send back** `results.jsonl`, the installer size (`dir armature-spike-setup.exe`), and what steps 2 and 3 showed.

7. **Uninstall** from Settings, Apps, "Armature Spike"; then `Remove-Item -Recurse "$env:LOCALAPPDATA\com.mossglenn.armature.spike"`.
