# ── Kill stale ANA background listeners ──
$procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -and $_.CommandLine.Contains("listen_space_global.ps1")
}

foreach ($p in $procs) {
    if ($p.ProcessId -ne $PID) {
        Write-Host "Stopping background listener PID $($p.ProcessId)..."
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
}
Write-Host "✅ Cleanup complete."
