$WshShell = New-Object -ComObject WScript.Shell
$Desktop = [System.Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $Desktop "ANA - Voice Assistant.lnk"
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "d:\SLAB Hackthon\SlabRoute\Start_ANA.bat"
$Shortcut.WorkingDirectory = "d:\SLAB Hackthon\SlabRoute"
$Shortcut.Description = "Launch ANA Voice Assistant"
$Shortcut.IconLocation = "shell32.dll, 14"
$Shortcut.Save()
Write-Host "Created Desktop Shortcut at: $ShortcutPath"
