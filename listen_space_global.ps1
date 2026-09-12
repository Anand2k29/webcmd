Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinHook {
    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int vKey);
}
"@

$spaceCount = 0
$lastTime = [DateTime]::Now
$wasPressed = $false

Write-Host "======================================================"
Write-Host "  🤖  A.N.A Global 3x Spacebar Listener Active"
Write-Host "======================================================"
Write-Host "Listening for 3x Spacebar taps anywhere on Windows..."
Write-Host "Press Space 3 times quickly on your keyboard to launch ANA."
Write-Host ""

while ($true) {
    $state = [WinHook]::GetAsyncKeyState(0x20) # 0x20 = Spacebar
    $isPressed = ($state -band 0x8000) -ne 0

    if ($isPressed -and -not $wasPressed) {
        # Edge trigger: key down transition
        $now = [DateTime]::Now
        if (($now - $lastTime).TotalMilliseconds -lt 1800) {
            $spaceCount++
        } else {
            $spaceCount = 1
        }
        $lastTime = $now
        Write-Host "  🎤 [Space tap $spaceCount/3]"

        if ($spaceCount -ge 3) {
            $spaceCount = 0
            Write-Host "🚀 3x Spacebar detected! Launching ANA Voice Assistant..."
            Start-Process -FilePath "d:\SLAB Hackthon\SlabRoute\Start_ANA.bat"
            Start-Sleep -Seconds 3
        }
    }

    $wasPressed = $isPressed
    Start-Sleep -Milliseconds 25
}
