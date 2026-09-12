# ─────────────────────────────────────────────────────────────────────
# install_startup.ps1 — Installs ANA Background Listener to Windows Startup
# ─────────────────────────────────────────────────────────────────────

$WshShell = New-Object -ComObject WScript.Shell
$StartupFolder = [System.Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupFolder "ANA Background Listener.lnk"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$TargetVBS = Join-Path $ScriptDir "Start_ANA_Background_Listener_Silent.vbs"

$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "wscript.exe"
$Shortcut.Arguments = "`"$TargetVBS`""
$Shortcut.WorkingDirectory = $ScriptDir
$Shortcut.Description = "ANA Background Voice & 3x Spacebar Listener"
$Shortcut.IconLocation = "shell32.dll, 14"
$Shortcut.Save()

Write-Host "======================================================"
Write-Host "  ✅ ANA Background Listener installed to Startup!"
Write-Host "======================================================"
Write-Host "Shortcut Path : $ShortcutPath"
Write-Host "Target Script : $TargetVBS"
Write-Host ""
Write-Host "Whenever you turn on or open your laptop, ANA will automatically"
Write-Host "listen for 'Hello ANA' or 3x Spacebar taps in the background!"
Write-Host "======================================================"
