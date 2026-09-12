# ─────────────────────────────────────────────────────────────────────
# listen_space_global.ps1 — Continuous Asynchronous Background Listener for ANA
# Dual-Engine:
#   1. Continuous Asynchronous Voice Engine (System.Speech RecognizeAsync)
#   2. High-Frequency Low-Latency Keyboard Hook (GetAsyncKeyState @ 25ms)
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

$lastTriggerTime = [DateTime]::Now.AddSeconds(-10)

function TriggerANA($source) {
    global: $lastTriggerTime
    global: $batPath
    $now = [DateTime]::Now
    if (($now - $lastTriggerTime).TotalSeconds -lt 4) {
        return # Debounce multiple triggers within 4s
    }
    $lastTriggerTime = $now
    Write-Host "🚀 Wake signal detected via $source! Launching ANA..."
    try {
        Start-Process -FilePath "cmd.exe" -ArgumentList "/c `"$batPath`"" -WindowStyle Normal
    } catch {
        Start-Process -FilePath $batPath -WindowStyle Normal
    }
}

# ── 1. Asynchronous Speech Recognition Engine ───────────────────────
$sapi = $null
try {
    $sapi = New-Object System.Speech.Recognition.SpeechRecognitionEngine
    $sapi.SetInputToDefaultAudioDevice()

    # Grammar choices for wake words
    $choices = New-Object System.Speech.Recognition.Choices
    $choices.Add([string[]]@(
        "hello ana", "hey ana", "hi ana", "ok ana", "ana",
        "hello anna", "hey anna", "hi anna", "wake up ana", "wake up anna",
        "order a football", "search jobs", "apply to job"
    ))
    $gb = New-Object System.Speech.Recognition.GrammarBuilder($choices)
    $g = New-Object System.Speech.Recognition.Grammar($gb)
    $sapi.LoadGrammar($g)

    # Register Asynchronous Event Handler
    $action = {
        $text = $Event.SourceEventArgs.Result.Text
        $conf = $Event.SourceEventArgs.Result.Confidence
        if ($text -and $conf -gt 0.20) {
            Write-Host "🎤 Voice Heard: '$text' (Confidence: $conf)"
            & $using:function:TriggerANA "Voice ('$text')"
        }
    }
    Register-ObjectEvent -InputObject $sapi -EventName "SpeechRecognized" -Action $action | Out-Null

    # Start continuous non-blocking async listening
    $sapi.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
    Write-Host "✅ Continuous Voice Engine active ('Hello ANA')."
} catch {
    Write-Host "⚠️ Voice Engine fallback mode. Keyboard hook active."
}

# ── 2. High-Frequency Keyboard Hook Loop (25ms) ──────────────────────
$spaceCount = 0
$lastTime = [DateTime]::Now
$wasPressed = $false

Write-Host "✅ 3x Spacebar Keyboard Hook active."
Write-Host "Ready! Say 'Hello ANA' or tap Spacebar 3 times to wake ANA."
Write-Host ""

while ($true) {
    $state = [WinHook]::GetAsyncKeyState(0x20) # 0x20 = Spacebar
    $isPressed = ($state -band 0x8000) -ne 0

    if ($isPressed -and -not $wasPressed) {
        $now = [DateTime]::Now
        if (($now - $lastTime).TotalMilliseconds -lt 1600) {
            $spaceCount++
        } else {
            $spaceCount = 1
        }
        $lastTime = $now
        Write-Host "  🎤 [Space tap $spaceCount/3]"

        if ($spaceCount -ge 3) {
            $spaceCount = 0
            TriggerANA "3x Spacebar"
        }
    }

    $wasPressed = $isPressed
    Start-Sleep -Milliseconds 25
}
