# ─────────────────────────────────────────────────────────────────────
# listen_space_global.ps1 — Continuous Asynchronous Background Listener for ANA
# Dual-Engine:
#   1. Continuous Asynchronous Voice Engine (System.Speech RecognizeAsync)
#   2. High-Frequency Low-Latency Keyboard Hook (GetAsyncKeyState @ 15ms)
# ─────────────────────────────────────────────────────────────────────

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinHook {
    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int vKey);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@

Add-Type -AssemblyName System.Speech

Write-Host "======================================================"
Write-Host "  🤖  A.N.A Global Voice & 3x Spacebar Listener Active"
Write-Host "======================================================"
Write-Host "Listening for 'Hello ANA' or 3x Rapid Spacebar taps..."
Write-Host ""

$script:scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$script:batPath = Join-Path $script:scriptDir "Start_ANA.bat"

# ── Single Instance Guard: Terminate duplicate background listener processes ──
try {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -and $_.CommandLine.Contains("listen_space_global.ps1") -and $_.ProcessId -ne $PID
    } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} catch {}

$script:lastTriggerTime = [DateTime]::Now.AddSeconds(-15)

function TriggerANA($source) {
    $now = [DateTime]::Now
    if (($now - $script:lastTriggerTime).TotalSeconds -lt 8) {
        return # Debounce multiple triggers within 8s
    }

    # Check if ANA (index.js or Start_ANA.bat) is already running in an active window
    $existing = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -and ($_.CommandLine.Contains("index.js") -or $_.CommandLine.Contains("Start_ANA.bat"))
    }

    if ($existing) {
        Write-Host "ℹ️ ANA process is already active (PID: $($existing[0].ProcessId)). Skipping launch."
        $script:lastTriggerTime = $now
        return
    }

    $script:lastTriggerTime = $now
    Write-Host "🚀 Wake signal detected via $source! Launching ANA..."
    try {
        Start-Process -FilePath "cmd.exe" -ArgumentList "/c `"$script:batPath`"" -WindowStyle Normal
    } catch {
        Start-Process -FilePath $script:batPath -WindowStyle Normal
    }
}

# ── 1. Asynchronous Speech Recognition Engine ───────────────────────
$sapi = $null
try {
    $sapi = New-Object System.Speech.Recognition.SpeechRecognitionEngine
    $sapi.SetInputToDefaultAudioDevice()

    # Strict Grammar choices for wake words (prevents background noise false triggers)
    $choices = New-Object System.Speech.Recognition.Choices
    $choices.Add([string[]]@(
        "hello ana", "hey ana", "hi ana", "ok ana",
        "hello anna", "hey anna", "hi anna", "wake up ana", "wake up anna"
    ))
    $gb = New-Object System.Speech.Recognition.GrammarBuilder($choices)
    $g = New-Object System.Speech.Recognition.Grammar($gb)
    $sapi.LoadGrammar($g)

    # Register Asynchronous Event Handler with confidence filter (0.60+)
    $action = {
        $text = $Event.SourceEventArgs.Result.Text
        $conf = $Event.SourceEventArgs.Result.Confidence
        if ($text -and $conf -ge 0.60) {
            Write-Host "🎤 Voice Heard: '$text' (Confidence: $conf)"
            TriggerANA "Voice ('$text')"
        }
    }
    Register-ObjectEvent -InputObject $sapi -EventName "SpeechRecognized" -Action $action | Out-Null

    # Start continuous non-blocking async listening
    $sapi.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
    Write-Host "✅ Continuous Voice Engine active ('Hello ANA')."
} catch {
    Write-Host "⚠️ Voice Engine fallback mode. Keyboard hook active."
}

# ── 2. High-Frequency Low-Latency Keyboard Hook (15ms) ───────────────
# Requires 3 rapid spacebar taps where each tap is within 450ms of the previous tap
$spaceCount = 0
$firstTapTime = [DateTime]::Now
$lastTapTime = [DateTime]::Now
$wasPressed = $false

Write-Host "✅ 3x Rapid Spacebar Keyboard Hook active."
Write-Host "Ready! Say 'Hello ANA' or tap Spacebar 3 times rapidly to wake ANA."
Write-Host ""

while ($true) {
    $state = [WinHook]::GetAsyncKeyState(0x20) # 0x20 = Spacebar
    $isPressed = ($state -band 0x8000) -ne 0

    if ($isPressed -and -not $wasPressed) {
        $now = [DateTime]::Now
        $msSinceLastTap = ($now - $lastTapTime).TotalMilliseconds

        # A valid tap in a rapid sequence must occur within 450ms of the previous tap
        if ($msSinceLastTap -lt 450) {
            $spaceCount++
        } else {
            $spaceCount = 1
            $firstTapTime = $now
        }
        $lastTapTime = $now

        # Require 3 taps within 900ms total duration
        if ($spaceCount -ge 3) {
            $totalMs = ($now - $firstTapTime).TotalMilliseconds
            if ($totalMs -le 900) {
                $spaceCount = 0
                TriggerANA "3x Rapid Spacebar ($([Math]::Round($totalMs))ms)"
            } else {
                $spaceCount = 1
                $firstTapTime = $now
            }
        }
    }

    $wasPressed = $isPressed
    Start-Sleep -Milliseconds 15
}

