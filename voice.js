// ─────────────────────────────────────────────────────────────────────
// voice.js — ANA (Autonomous Navigation Assistant)
// Voice-activated assistant using Windows PowerShell System.Speech
// Zero external npm dependencies — pure native Windows SAPI
// ─────────────────────────────────────────────────────────────────────

import { execSync, exec, spawn } from "child_process";
import fs from "fs";
import path from "path";
import readline from "readline";

// ─── Config ──────────────────────────────────────────────────────────
const SPEECH_RATE = 2;            // -10 (slowest) to 10 (fastest)
const DEFAULT_LISTEN_SEC = 6;     // Default STT duration
const CONFIDENCE_THRESHOLD = 0.25; // Min confidence for STT
const TEMP_DIR = path.resolve("./.ana_temp");

let _voiceAvailable = null;
let _voiceMode = false;

// ─── ANSI Colors ─────────────────────────────────────────────────────
const V = {
  r: "\x1b[0m", b: "\x1b[1m", d: "\x1b[2m",
  cyan: "\x1b[36m", yellow: "\x1b[33m", green: "\x1b[32m",
  magenta: "\x1b[35m", red: "\x1b[31m", blue: "\x1b[34m",
  bgMag: "\x1b[45m",
};

// ─── Helpers ─────────────────────────────────────────────────────────
function ensureTempDir() {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
}

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function cleanForSpeech(text) {
  return stripAnsi(text)
    .replace(/[═╔╗╚╝║─┐┌└┘│▓░▒█]/g, "")   // Box chars
    .replace(/[^\x20-\x7E\s]/g, " ")         // Non-ASCII → space
    .replace(/\s+/g, " ")                     // Normalize whitespace
    .trim()
    .slice(0, 500);
}

function escapePS(text) {
  return text.replace(/'/g, "''").replace(/`/g, "``");
}

// ─── Check Voice Availability ────────────────────────────────────────
export function checkVoiceAvailability() {
  if (_voiceAvailable !== null) return _voiceAvailable;
  try {
    const r = execSync(
      'powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Speech; Write-Output VOICE_OK"',
      { encoding: "utf-8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] }
    );
    _voiceAvailable = r.trim().includes("VOICE_OK");
  } catch {
    _voiceAvailable = false;
  }
  return _voiceAvailable;
}

// ─── TTS: ANA Speaks (blocking — waits until done) ───────────────────
export function speak(text) {
  if (!_voiceAvailable) return;
  const cleaned = cleanForSpeech(text);
  if (!cleaned) return;

  ensureTempDir();
  const escaped = escapePS(cleaned);
  const scriptPath = path.join(TEMP_DIR, "tts.ps1");
  const script = `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try { $s.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::Female) } catch {}
$s.Rate = ${SPEECH_RATE}
$s.Speak('${escaped}')
$s.Dispose()
`.trim();

  fs.writeFileSync(scriptPath, script, "utf-8");
  try {
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`, {
      timeout: 30000, stdio: "pipe",
    });
  } catch { /* silent */ }
}

// Non-blocking speak (fire and forget — for narration during steps)
export function speakAsync(text) {
  if (!_voiceAvailable) return;
  const cleaned = cleanForSpeech(text);
  if (!cleaned) return;

  ensureTempDir();
  const escaped = escapePS(cleaned);
  const id = Date.now();
  const scriptPath = path.join(TEMP_DIR, `tts_${id}.ps1`);
  const script = `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try { $s.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::Female) } catch {}
$s.Rate = ${SPEECH_RATE}
$s.Speak('${escaped}')
$s.Dispose()
`.trim();

  fs.writeFileSync(scriptPath, script, "utf-8");
  const child = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath], {
    stdio: "ignore", detached: true,
  });
  child.unref();
  child.on("exit", () => { try { fs.unlinkSync(scriptPath); } catch {} });
}

// ─── STT: User Speaks (blocking — waits for speech) ──────────────────
export function listen(durationSec = DEFAULT_LISTEN_SEC) {
  if (!_voiceAvailable) return "";

  ensureTempDir();
  const scriptPath = path.join(TEMP_DIR, "stt.ps1");
  const script = `
Add-Type -AssemblyName System.Speech
Start-Sleep -Milliseconds 400
$r = New-Object System.Speech.Recognition.SpeechRecognitionEngine
try {
  $r.SetInputToDefaultAudioDevice()
  $g = New-Object System.Speech.Recognition.DictationGrammar
  $r.LoadGrammar($g)
  $result = $r.Recognize([TimeSpan]::FromSeconds(${durationSec}))
  if ($result -and $result.Text) {
    Write-Output $result.Text
  }
} catch {
  Write-Output ""
} finally {
  try { $r.Dispose() } catch {}
}
`.trim();

  fs.writeFileSync(scriptPath, script, "utf-8");
  try {
    const result = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`, {
      encoding: "utf-8",
      timeout: (durationSec + 12) * 1000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.trim();
  } catch {
    return "";
  }
}

// ─── Combined: Hybrid Voice + Keyboard non-blocking prompt ────────────
export async function voiceAsk(promptText, listenSec = DEFAULT_LISTEN_SEC) {
  const clean = cleanForSpeech(promptText);
  if (clean) {
    speakAsync(clean);
  }

  return new Promise((resolve) => {
    let resolved = false;
    let sttProcess = null;
    let typedBuffer = "";
    let isTyping = false;

    ensureTempDir();
    const id = Date.now();
    const scriptPath = path.join(TEMP_DIR, `stt_${id}.ps1`);
    const script = `
Add-Type -AssemblyName System.Speech
$r = New-Object System.Speech.Recognition.SpeechRecognitionEngine
try {
  $r.SetInputToDefaultAudioDevice()
  $g = New-Object System.Speech.Recognition.DictationGrammar
  $r.LoadGrammar($g)
  $result = $r.Recognize([TimeSpan]::FromSeconds(${listenSec}))
  if ($result -and $result.Text) {
    Write-Output $result.Text
  }
} catch {} finally {
  try { $r.Dispose() } catch {}
}
`.trim();

    fs.writeFileSync(scriptPath, script, "utf-8");

    function cleanup() {
      if (sttProcess) {
        try { sttProcess.kill(); } catch {}
        sttProcess = null;
      }
      try { if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath); } catch {}
      if (process.stdin.isTTY && process.stdin.setRawMode) {
        try { process.stdin.setRawMode(false); } catch {}
      }
      if (onKeypress) {
        process.stdin.removeListener("keypress", onKeypress);
      }
    }

    function finish(resultText) {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(resultText ? resultText.trim() : null);
    }

    console.log(`\n  ${V.cyan}🎤 ANA Listening...${V.r} ${V.d}(Speak or start typing directly below)${V.r}`);
    process.stdout.write(`  ${V.b}👉 ${V.r}`);

    sttProcess = spawn("powershell", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath
    ], { stdio: ["pipe", "pipe", "pipe"] });

    let stdoutData = "";
    sttProcess.stdout.on("data", (chunk) => {
      stdoutData += chunk.toString();
    });

    sttProcess.on("exit", () => {
      if (resolved || isTyping) return;
      const text = stdoutData.trim();
      if (text) {
        process.stdout.write(`\r  ${V.green}🎤 ANA heard:${V.r} "${V.b}${text}${V.r}"\n`);
        finish(text);
      } else {
        if (!isTyping) {
          isTyping = true;
          process.stdout.write(`\r  ${V.d}⌨️  Voice timeout. Type your input and press Enter:${V.r}\n  ${V.b}👉 ${V.r}`);
        }
      }
    });

    let onKeypress = null;
    if (process.stdin.isTTY) {
      readline.emitKeypressEvents(process.stdin);
      if (process.stdin.setRawMode) process.stdin.setRawMode(true);

      onKeypress = (str, key) => {
        if (resolved) return;

        if (key && key.ctrl && key.name === "c") {
          cleanup();
          process.exit(0);
        }

        // Kill STT background process as soon as typing begins
        if (!isTyping) {
          isTyping = true;
          if (sttProcess) { try { sttProcess.kill(); } catch {} }
        }

        if (key && (key.name === "return" || key.name === "enter")) {
          process.stdout.write("\n");
          finish(typedBuffer);
          return;
        }

        if (key && key.name === "backspace") {
          if (typedBuffer.length > 0) {
            typedBuffer = typedBuffer.slice(0, -1);
            process.stdout.write("\b \b");
          }
          return;
        }

        if (str && str.length === 1 && str.charCodeAt(0) >= 32) {
          typedBuffer += str;
          process.stdout.write(str);
        }
      };

      process.stdin.on("keypress", onKeypress);
    } else {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question("", (ans) => {
        rl.close();
        finish(ans);
      });
    }
  });
}

// ─── Voice Mode State ────────────────────────────────────────────────
export function isVoiceMode() { return _voiceMode; }
export function setVoiceMode(mode) { _voiceMode = mode; }
export { stripAnsi };

// ─── Wake Word Matching ──────────────────────────────────────────────
export function matchesWakeWord(text) {
  const lower = (text || "").toLowerCase().trim();
  if (/\bhello\s*(ana|anna|on a|ha na)\b/i.test(lower)) return true;
  if (/\bhey\s*(ana|anna|on a|ha na)\b/i.test(lower)) return true;
  if (/\bhi\s*(ana|anna)\b/i.test(lower)) return true;
  if (/\bok\s*(ana|anna)\b/i.test(lower)) return true;
  if (/^(ana|anna)\b/i.test(lower)) return true;
  return false;
}

// ─── Wake Word Detection (race: voice vs 3x Spacebar vs keyboard) ───
export function detectWakeWordOrKeypress(listenSec = 7) {
  return new Promise((resolve) => {
    let resolved = false;
    let sttProcess = null;
    let spaceCount = 0;
    let lastSpaceTime = 0;
    let onKeypress = null;

    ensureTempDir();
    const id = Date.now();
    const scriptPath = path.join(TEMP_DIR, `wake_${id}.ps1`);
    const script = `
Add-Type -AssemblyName System.Speech
$r = New-Object System.Speech.Recognition.SpeechRecognitionEngine
try {
  $r.SetInputToDefaultAudioDevice()
  $g = New-Object System.Speech.Recognition.DictationGrammar
  $r.LoadGrammar($g)
  $result = $r.Recognize([TimeSpan]::FromSeconds(${listenSec}))
  if ($result -and $result.Text) {
    Write-Output $result.Text
  }
} catch {} finally {
  try { $r.Dispose() } catch {}
}
`.trim();

    fs.writeFileSync(scriptPath, script, "utf-8");

    function cleanup() {
      if (sttProcess) {
        try { sttProcess.kill(); } catch {}
        sttProcess = null;
      }
      try { if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath); } catch {}
      if (process.stdin.isTTY && process.stdin.setRawMode) {
        try { process.stdin.setRawMode(false); } catch {}
      }
      if (onKeypress) {
        process.stdin.removeListener("keypress", onKeypress);
      }
    }

    function finish(mode) {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(mode);
    }

    if (process.stdin.isTTY) {
      readline.emitKeypressEvents(process.stdin);
      if (process.stdin.setRawMode) process.stdin.setRawMode(true);

      onKeypress = (_str, key) => {
        if (resolved) return;

        if (key && key.ctrl && key.name === "c") {
          cleanup();
          process.exit(0);
        }

        if (key && key.name === "space") {
          const now = Date.now();
          if (now - lastSpaceTime < 1500) {
            spaceCount++;
          } else {
            spaceCount = 1;
          }
          lastSpaceTime = now;
          if (spaceCount >= 3) {
            finish("voice"); // Wake up ANA!
            return;
          }
        }
        if (key && (key.name === "return" || key.name === "enter")) {
          finish("keyboard");
        }
      };
      process.stdin.on("keypress", onKeypress);
    }

    // Voice listener (async powershell STT spawn)
    sttProcess = spawn("powershell", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath
    ], { stdio: ["pipe", "pipe", "pipe"] });

    let stdoutData = "";
    sttProcess.stdout.on("data", (chunk) => {
      stdoutData += chunk.toString();
    });

    sttProcess.on("exit", () => {
      if (resolved) return;
      const text = stdoutData.trim();
      if (text && matchesWakeWord(text)) {
        finish("voice");
      } else {
        finish("timeout");
      }
    });
  });
}

// ─── Voice-Driven Menu ──────────────────────────────────────────────
export async function voiceMenu(askFn) {
  console.log(`\n  ${V.bgMag}${V.b} 🤖 ANA Voice Mode ${V.r}\n`);
  console.log(`  ${V.d}Available voice commands:${V.r}`);
  console.log(`  ${V.d}  • "Buy [product]"          — Shop online (Amazon/Flipkart)${V.r}`);
  console.log(`  ${V.d}  • "Search jobs for [role]"  — Search & auto-apply for jobs${V.r}`);
  console.log(`  ${V.d}  • "Cold mail [recruiter]"   — Compose outreach email${V.r}`);
  console.log(`  ${V.d}  • "Search [topic]"          — Research online${V.r}`);
  console.log(`  ${V.d}  • "Book [trip]"             — Book flights/hotels/trains${V.r}`);
  console.log(`  ${V.d}  • Or describe any task naturally${V.r}\n`);

  const response = await askFn(
    `  ${V.cyan}🎤 What would you like me to do?${V.r} `, 8
  );

  if (!response) {
    speak("Switching to keyboard mode.");
    setVoiceMode(false);
    return null; // Caller falls back to showMenu()
  }

  const lower = response.toLowerCase();

  // ── Job Application intent ──
  if (["job", "jobs", "apply", "hire", "recruiter", "career", "linkedin", "indeed", "naukri"]
    .some(kw => lower.includes(kw))) {
    const role = response;
    const location = await askFn(`  ${V.cyan}Preferred location? Remote, India, or city?${V.r} `, 5) || "Remote";
    speak(`Got it! I'll search for ${role} jobs in ${location} and auto fill applications.`);
    return `Go to LinkedIn or Indeed, search for "${role}" jobs in "${location}". Open top matching job postings, click "Easy Apply" or "Apply Now", auto-fill applicant details using user profile, and present application for submission.`;
  }

  // ── Cold Mailing intent ──
  if (["mail", "email", "cold mail", "outreach", "gmail", "message recruiter", "write email"]
    .some(kw => lower.includes(kw))) {
    const recipient = await askFn(`  ${V.cyan}Recipient email or contact name?${V.r} `, 6) || "recruiter";
    const subject = await askFn(`  ${V.cyan}Email subject line?${V.r} `, 6) || "Outreach / Job Inquiry";
    speak(`Got it! Opening Gmail to compose cold mail to ${recipient}.`);
    return `Open Gmail, click "Compose", set recipient to "${recipient}", set subject to "${subject}", and write personalized outreach email with user profile details.`;
  }

  // ── Shopping intent ──
  if (["buy", "shop", "order", "purchase", "laptop", "phone", "product", "amazon", "flipkart"]
    .some(kw => lower.includes(kw))) {
    const product = response;
    const site = await askFn(`  ${V.cyan}Which website? Amazon, Flipkart, or Google search?${V.r} `, 5) || "";
    const siteLow = site.toLowerCase();
    const siteStr = siteLow.includes("flipkart") ? "on Flipkart"
      : siteLow.includes("amazon") ? "on Amazon"
      : site ? `on ${site}` : "by searching Google for the best option";
    speak(`Got it! I'll search for ${product} ${siteStr}.`);
    return `Search for "${product}" ${siteStr}. Open the product page, click "Add to Cart" or "Buy Now", proceed to checkout, and wait for me to complete payment.`;
  }

  // ── Research intent ──
  if (["search", "research", "find", "look up", "learn", "what is", "who is", "how to"]
    .some(kw => lower.includes(kw))) {
    const where = await askFn(`  ${V.cyan}Where to search? Google, Wikipedia, or another site?${V.r} `, 5) || "Google";
    speak(`Got it! I'll research that on ${where}.`);
    return `Go to ${where} and research "${response}". Open the most relevant results, read the content, and gather key information.`;
  }

  // ── Booking intent ──
  if (["book", "ticket", "flight", "hotel", "train", "bus", "travel"]
    .some(kw => lower.includes(kw))) {
    const from = await askFn(`  ${V.cyan}Where from?${V.r} `, 5) || "";
    const to = await askFn(`  ${V.cyan}Where to?${V.r} `, 5) || "";
    const date = await askFn(`  ${V.cyan}When? Say a date or skip.${V.r} `, 5) || "";
    const dateStr = (date && !date.toLowerCase().includes("skip")) ? ` on ${date}` : "";
    speak(`Got it! I'll book from ${from} to ${to}${dateStr}.`);
    return `Book a trip from ${from} to ${to}${dateStr}. Search for available options, select the best one, and proceed to booking.`;
  }

  // ── Custom — use spoken text as goal ──
  speak("Got it! I'll work on that right away.");
  return response;
}

// ─── Narration (non-blocking voice during automation) ────────────────
export function narrate(message) {
  if (_voiceMode && _voiceAvailable) {
    speakAsync(message);
  }
}

// ─── ANA Personality ─────────────────────────────────────────────────
export function greetUser() {
  const greetings = [
    "Hello! I am ANA, your Autonomous Navigation Assistant. What would you like me to help you with today?",
    "Hi there! ANA here, ready to browse the web for you. What can I do?",
    "Welcome! I'm ANA, your personal browser agent. Tell me what you need!",
  ];
  const greeting = greetings[Math.floor(Math.random() * greetings.length)];
  console.log(`  ${V.green}${V.b}🤖 ANA:${V.r} ${V.cyan}"${greeting}"${V.r}\n`);
  speak(greeting);
}

export function announceStep(stepDesc) {
  if (!_voiceMode) return;
  const short = stepDesc.length > 80 ? stepDesc.slice(0, 80) : stepDesc;
  speakAsync(short);
}

export function announceCompletion() {
  speak("All done! Your workflow has been completed and saved successfully.");
}

// ─── Cleanup temp files ──────────────────────────────────────────────
export function cleanup() {
  try {
    if (fs.existsSync(TEMP_DIR)) {
      for (const f of fs.readdirSync(TEMP_DIR)) {
        try { fs.unlinkSync(path.join(TEMP_DIR, f)); } catch {}
      }
      try { fs.rmdirSync(TEMP_DIR); } catch {}
    }
  } catch {}
}
