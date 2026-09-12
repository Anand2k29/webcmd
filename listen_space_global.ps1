# ─────────────────────────────────────────────────────────────────────
# listen_space_global.ps1 — Continuous Background Listener for ANA
# Listens for:
#   1. Voice Wake Word: "Hello ANA", "Hey ANA", "Hi ANA", "OK ANA", "ANA"
#   2. Keyboard Wake Action: 3x Spacebar taps anywhere on Windows
# ─────────────────────────────────────────────────────────────────────

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinHook {
    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int vKey);
}
"@

Add-Type -AssemblyName System.Speech

Write-Host "======================================================"
Write-Host "  🤖  A.N.A Global Voice & 3x Spacebar Listener Active"
Write-Host "======================================================"
Write-Host "Listening for 'Hello ANA' or 3x Spacebar taps..."
Write-Host ""

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$batPath = Join-Path $scriptDir "Start_ANA.bat"

# Initialize Speech Recognition Engine for continuous voice listening
$sapi = $null
try {
    $sapi = New-Object System.Speech.Recognition.SpeechRecognitionEngine
    $sapi.SetInputToDefaultAudioDevice()
    $choices = New-Object System.Speech.Recognition.Choices
    $choices.Add([string[]]@("hello ana", "hey ana", "hi ana", "ok ana", "ana", "on a", "hello anna"))
    $gb = New-Object System.Speech.Recognition.GrammarBuilder($choices)
    $g = New-Object System.Speech.Recognition.Grammar($gb)
    $sapi.LoadGrammar($g)
} catch {
    Write-Host "Warning: Speech recognition engine initialization failed. Using keyboard hook fallback."
}

$spaceCount = 0
$lastTime = [DateTime]::Now
$wasPressed = $false
$lastTriggerTime = [DateTime]::Now.AddSeconds(-10)

function TriggerANA($source) {
    global: $lastTriggerTime
    $now = [DateTime]::Now
    if (($now - $lastTriggerTime).TotalSeconds -lt 5) {
        return # Debounce multiple triggers within 5s
    }
    $lastTriggerTime = $now
    Write-Host "🚀 Wake signal detected via $source! Launching ANA..."
    Start-Process -FilePath $batPath
}

while ($true) {
    # 1. Check Voice Wake Word asynchronously if SAPI loaded
    if ($sapi) {
        try {
            $result = $sapi.Recognize([TimeSpan]::FromMilliseconds(150))
            if ($result -and $result.Text -and $result.Confidence -gt 0.3) {
                Write-Host "🎤 Voice Heard: $($result.Text) (Confidence: $($result.Confidence))"
                TriggerANA("Voice ('$($result.Text)')")
            }
        } catch {}
    }

    # 2. Check 3x Spacebar keypress
    $state = [WinHook]::GetAsyncKeyState(0x20) # 0x20 = Spacebar
    $isPressed = ($state -band 0x8000) -ne 0

    if ($isPressed -and -not $wasPressed) {
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
            TriggerANA("3x Spacebar")
        }
    }

    $wasPressed = $isPressed
    Start-Sleep -Milliseconds 30
}
