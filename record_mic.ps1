# ─────────────────────────────────────────────────────────────────────
# record_mic.ps1 — Native Windows Microphone Recorder using winmm.dll
# ─────────────────────────────────────────────────────────────────────

param(
    [string]$OutputFile = "input.wav",
    [int]$DurationSec = 6
)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class AudioRecorder {
    [DllImport("winmm.dll", EntryPoint = "mciSendStringA")]
    public static extern int mciSendString(string command, string buffer, int bufferSize, IntPtr hwndCallback);
}
"@

Write-Host "🎤 Recording audio for $DurationSec seconds..."

# Close any previous recorder instance
[AudioRecorder]::mciSendString("close recorder", $null, 0, [IntPtr]::Zero)

# Open waveaudio device
[AudioRecorder]::mciSendString("open new type waveaudio alias recorder", $null, 0, [IntPtr]::Zero)
[AudioRecorder]::mciSendString("set recorder bitspersample 16 channels 1 samplespersec 16000", $null, 0, [IntPtr]::Zero)
[AudioRecorder]::mciSendString("record recorder", $null, 0, [IntPtr]::Zero)

Start-Sleep -Seconds $DurationSec

# Save to output file
[AudioRecorder]::mciSendString("save recorder `"$OutputFile`"", $null, 0, [IntPtr]::Zero)
[AudioRecorder]::mciSendString("close recorder", $null, 0, [IntPtr]::Zero)

Write-Host "✅ Audio saved to $OutputFile"
