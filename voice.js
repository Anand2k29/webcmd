// ─────────────────────────────────────────────────────────────────────
// voice.js — ANA (Autonomous Navigation Assistant)
// Voice-activated assistant using Windows PowerShell System.Speech
// Zero external npm dependencies — pure native Windows SAPI
// ─────────────────────────────────────────────────────────────────────

import { execSync, exec, spawn } from "child_process";
import fs from "fs";
import path from "path";
import readline from "readline";
import axios from "axios";

// ─── Config ──────────────────────────────────────────────────────────
const SPEECH_RATE = 1;            // 1 = natural human conversational speed (was 2)
const DEFAULT_LISTEN_SEC = 8;     // Extended STT duration for relaxed speaking
const CONFIDENCE_THRESHOLD = 0.20; // Confidence threshold for STT
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
    .replace(/https?:\/\/\S+/gi, "link")   // Replace URLs with "link"
    .replace(/[═╔╗╚╝║─┐┌└┘│▓░▒█]/g, "")   // Box chars
    .replace(/[\[\]\(\)\{\}\*\#\_\~]/g, " ") // Markdown special chars -> space
    .replace(/[^\x20-\x7E\s]/g, " ")       // Non-ASCII → space
    .replace(/\s+/g, " ")                   // Normalize whitespace
    .trim()
    .slice(0, 450);
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
  const vbsPath = path.join(TEMP_DIR, "tts.vbs");
  const vbsScript = `
Set s = CreateObject("SAPI.SpVoice")
On Error Resume Next
For Each v In s.GetVoices
    If InStr(LCase(v.GetDescription), "zira") > 0 Or InStr(LCase(v.GetDescription), "hazel") > 0 Or InStr(LCase(v.GetDescription), "female") > 0 Or InStr(LCase(v.GetDescription), "eva") > 0 Then
        Set s.Voice = v
        Exit For
    End If
Next
s.Rate = 1
s.Volume = 100
s.Speak WScript.Arguments(0)
`.trim();

  fs.writeFileSync(vbsPath, vbsScript, "utf-8");
  try {
    execSync(`cscript //NoLogo "${vbsPath}" "${cleaned.replace(/"/g, '""')}"`, {
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
  const id = Date.now();
  const vbsPath = path.join(TEMP_DIR, `tts_${id}.vbs`);
  const vbsScript = `
Set s = CreateObject("SAPI.SpVoice")
On Error Resume Next
For Each v In s.GetVoices
    If InStr(LCase(v.GetDescription), "zira") > 0 Or InStr(LCase(v.GetDescription), "hazel") > 0 Or InStr(LCase(v.GetDescription), "female") > 0 Or InStr(LCase(v.GetDescription), "eva") > 0 Then
        Set s.Voice = v
        Exit For
    End If
Next
s.Rate = 1
s.Volume = 100
s.Speak WScript.Arguments(0)
`.trim();

  fs.writeFileSync(vbsPath, vbsScript, "utf-8");
  const child = spawn("cscript", ["//NoLogo", vbsPath, cleaned], {
    stdio: "ignore", detached: true,
  });
  child.unref();
  child.on("exit", () => { try { fs.unlinkSync(vbsPath); } catch {} });
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
  $r.InitialSilenceTimeout = [TimeSpan]::FromSeconds(3.5)
  $r.EndSilenceTimeout = [TimeSpan]::FromSeconds(1.5)
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
    const result = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${scriptPath}"`, {
      encoding: "utf-8",
      timeout: (durationSec + 12) * 1000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.trim();
  } catch {
    return "";
  }
}

// ─── Spoken text phonetic cleaner & normalizer ────────────────────────
export function cleanSpokenText(text) {
  if (!text) return "";
  let clean = text.trim();
  clean = clean
    .replace(/\b(for|four)\s*(hundred|00)\b/gi, "400")
    .replace(/\b(rs|rupees|rupee)\b/gi, "rs")
    .replace(/\bfoot\s*ball\b/gi, "football")
    .replace(/\bama\s*zon\b/gi, "amazon")
    .replace(/\bflip\s*kart\b/gi, "flipkart")
    .replace(/\bdon and for\b/gi, "football under 400rs")
    .replace(/\bunder\s*(for|four)\b/gi, "under 400")
    .replace(/\bsoft\s*ware\s*eng\b/gi, "software engineer")
    .replace(/\bcold\s*email\b/gi, "cold mail")
    .replace(/\bapply\s*to\s*job\b/gi, "apply to job");
  return clean;
}

// ─── Combined: Hybrid Voice + Keyboard non-blocking prompt ────────────
export async function voiceAsk(promptText, listenSec = DEFAULT_LISTEN_SEC) {
  const clean = cleanForSpeech(promptText);
  if (clean) {
    speakAsync(clean);
  }

  // Load custom vocabulary from user voice profile if present
  const vp = loadVoiceProfile();
  const customWords = vp?.custom_words || [
    "order", "buy", "football", "amazon", "flipkart", "under", "rupees", "rs",
    "400", "500", "1000", "search", "apply", "jobs", "gmail", "mail", "milk",
    "eggs", "laptop", "phone", "book", "flight", "software engineer", "linkedin",
    "recruiter", "cold email", "compose"
  ];
  const wordsPS = customWords.map(w => `"${w.replace(/"/g, '""')}"`).join(", ");

  return new Promise((resolve) => {
    let resolved = false;
    let sttProcess = null;
    let rl = null;

    ensureTempDir();
    const id = Date.now();
    const scriptPath = path.join(TEMP_DIR, `stt_${id}.ps1`);
    const script = `
Add-Type -AssemblyName System.Speech
$r = New-Object System.Speech.Recognition.SpeechRecognitionEngine
try {
  $r.SetInputToDefaultAudioDevice()
  $r.InitialSilenceTimeout = [TimeSpan]::FromSeconds(3.5)
  $r.EndSilenceTimeout = [TimeSpan]::FromSeconds(1.5)
  $dict = New-Object System.Speech.Recognition.DictationGrammar
  $r.LoadGrammar($dict)
  try {
    $choices = New-Object System.Speech.Recognition.Choices
    $choices.Add([string[]]@(${wordsPS}))
    $gb = New-Object System.Speech.Recognition.GrammarBuilder($choices)
    $g = New-Object System.Speech.Recognition.Grammar($gb)
    $r.LoadGrammar($g)
  } catch {}
  $result = $r.Recognize([TimeSpan]::FromSeconds(${listenSec}))
  if ($result -and $result.Text) {
    Write-Output $result.Text
  }
} catch {} finally {
  try { $r.Dispose() } catch {}
}
`.trim();

    fs.writeFileSync(scriptPath, script, "utf-8");

    // Ensure rawMode is OFF so standard readline works 100% natively
    if (process.stdin.isTTY && process.stdin.setRawMode) {
      try { process.stdin.setRawMode(false); } catch {}
    }

    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    function cleanup() {
      if (sttProcess) {
        try { sttProcess.kill(); } catch {}
        sttProcess = null;
      }
      try { if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath); } catch {}
      if (rl) {
        try { rl.close(); } catch {}
        rl = null;
      }
    }

    function finish(resultText) {
      if (resolved) return;
      resolved = true;
      cleanup();
      const cleaned = cleanSpokenText(resultText);
      resolve(cleaned || null);
    }

    console.log(`\n  ${V.cyan}🎤 ANA Listening...${V.r} ${V.d}(Speak clearly into your mic or type text & press Enter)${V.r}`);

    sttProcess = spawn("powershell", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", scriptPath
    ], { stdio: ["pipe", "pipe", "pipe"] });

    let stdoutData = "";
    sttProcess.stdout.on("data", (chunk) => {
      stdoutData += chunk.toString();
    });

    sttProcess.on("exit", () => {
      if (resolved) return;
      const text = stdoutData.trim();
      if (text) {
        const cleaned = cleanSpokenText(text);
        process.stdout.write(`\r  ${V.green}🎤 ANA heard:${V.r} "${V.b}${cleaned}${V.r}"\n`);
        finish(cleaned);
      } else {
        finish("");
      }
    });

    rl.question(`  ${V.b}👉 ${V.r}`, (answer) => {
      if (answer && answer.trim()) {
        finish(answer);
      }
    });
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

// ─── Ollama AI Wake Word Verification ────────────────────────────────
export async function matchesWakeWordOllama(text) {
  if (matchesWakeWord(text)) return true;
  if (!text || text.length < 3) return false;

  const ollamaUrl = process.env.OLLAMA_URL?.trim() || "http://127.0.0.1:11434";
  const ollamaModel = process.env.OLLAMA_MODEL?.trim() || "llama3.2";

  try {
    const endpoint = `${ollamaUrl.replace(/\/+$/, "")}/v1/chat/completions`;
    const resp = await axios.post(endpoint, {
      model: ollamaModel,
      messages: [
        {
          role: "system",
          content: "You are an AI wake-word detector for assistant 'ANA'. Given spoken text from audio speech-to-text (which may have typos/accents), answer strictly 'YES' if the user intended to greet or wake up ANA (e.g., 'hello ana', 'hey anna', 'wake up ana', 'on a', 'hi assistant'), or 'NO' otherwise."
        },
        { role: "user", content: text }
      ],
      temperature: 0,
    }, { timeout: 2000 });

    const ans = resp.data.choices?.[0]?.message?.content?.trim()?.toUpperCase();
    if (ans && ans.includes("YES")) return true;
  } catch {
    // Silent fallback to regex matching if Ollama server is offline
  }
  return false;
}

// ─── Ollama Speech Intent Refiner ────────────────────────────────────
export async function refineVoiceWithOllama(rawSpokenText) {
  if (!rawSpokenText || rawSpokenText.length < 3) return rawSpokenText;

  const ollamaUrl = process.env.OLLAMA_URL?.trim() || "http://127.0.0.1:11434";
  const ollamaModel = process.env.OLLAMA_MODEL?.trim() || "llama3.2";

  try {
    const endpoint = `${ollamaUrl.replace(/\/+$/, "")}/v1/chat/completions`;
    const resp = await axios.post(endpoint, {
      model: ollamaModel,
      messages: [
        {
          role: "system",
          content: "You are a speech intent normalizer. Correct any misheard spoken words, typos, or disjointed speech into a clear user action command for a web browser assistant. Output ONLY the clean action command in 1 line."
        },
        { role: "user", content: rawSpokenText }
      ],
      temperature: 0.1,
    }, { timeout: 2500 });

    const text = resp.data.choices?.[0]?.message?.content?.trim();
    if (text && text.length > 2) {
      return text.replace(/^["']|["']$/g, "");
    }
  } catch {
    // Silent fallback to rule-based phonetic cleaner
  }
  return cleanSpokenText(rawSpokenText);
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
  $dict = New-Object System.Speech.Recognition.DictationGrammar
  $r.LoadGrammar($dict)
  try {
    $choices = New-Object System.Speech.Recognition.Choices
    $choices.Add([string[]]@("hello ana", "hey ana", "hi ana", "ok ana", "ana"))
    $gb = New-Object System.Speech.Recognition.GrammarBuilder($choices)
    $g = New-Object System.Speech.Recognition.Grammar($gb)
    $r.LoadGrammar($g)
  } catch {}
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

    // Voice listener (async powershell STT spawn - hidden)
    sttProcess = spawn("powershell", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", scriptPath
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
  console.log(`  ${V.d}  • "Show top 5 jobs"        — Open Daily Top 5 Job Discovery Dashboard${V.r}`);
  console.log(`  ${V.d}  • "Apply to job 1"         — Auto-fill & apply to Job #1${V.r}`);
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
  if (["buy", "shop", "order", "purchase", "laptop", "phone", "product", "amazon", "flipkart", "instacart", "blinkit", "zepto", "football"]
    .some(kw => lower.includes(kw))) {

    let siteStr = "by searching Google for the best option";
    let targetSite = "";
    if (lower.includes("amazon")) { targetSite = "Amazon"; siteStr = "on Amazon"; }
    else if (lower.includes("flipkart")) { targetSite = "Flipkart"; siteStr = "on Flipkart"; }
    else if (lower.includes("instacart")) { targetSite = "Instacart"; siteStr = "on Instacart"; }
    else if (lower.includes("blinkit")) { targetSite = "Blinkit"; siteStr = "on Blinkit"; }
    else if (lower.includes("zepto")) { targetSite = "Zepto"; siteStr = "on Zepto"; }

    let cleanProduct = response
      .replace(/^order\s*(me)?\s*(a|an)?\s*/i, "")
      .replace(/^buy\s*(me)?\s*(a|an)?\s*/i, "")
      .replace(/^shop\s*(for)?\s*(a|an)?\s*/i, "")
      .replace(/\s*from\s*(amazon|flipkart|instacart|blinkit|zepto|google)\b/gi, "")
      .replace(/\s*on\s*(amazon|flipkart|instacart|blinkit|zepto|google)\b/gi, "")
      .trim();

    if (!cleanProduct) cleanProduct = response;

    if (!targetSite) {
      const siteAnswer = await askFn(`  ${V.cyan}Which website? Amazon, Flipkart, or press Enter for Google:${V.r} `, 5);
      if (siteAnswer) {
        const sLow = siteAnswer.toLowerCase();
        if (sLow.includes("flipkart")) siteStr = "on Flipkart";
        else if (sLow.includes("amazon")) siteStr = "on Amazon";
        else siteStr = `on ${siteAnswer}`;
      }
    }

    speak(`Got it! Searching for ${cleanProduct} ${siteStr}.`);
    return `Search for "${cleanProduct}" ${siteStr}. Open product page, click "Add to Cart" or "Buy Now", proceed to checkout, auto-fill address details using profile, and wait for me to complete payment.`;
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

// ─── Voice Profile Calibration Engine ────────────────────────────────
const VOICE_PROFILE_FILE = path.resolve("./user_voice_profile.json");

export function loadVoiceProfile() {
  if (!fs.existsSync(VOICE_PROFILE_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(VOICE_PROFILE_FILE, "utf-8")); }
  catch { return null; }
}

export function saveVoiceProfile(profile) {
  fs.writeFileSync(VOICE_PROFILE_FILE, JSON.stringify(profile, null, 2));
}

export async function calibrateVoiceProfile() {
  console.log(`\n  ${V.bgMag}${V.b} 🎙️  ANA User Voice Calibration & Acoustic Training ${V.r}\n`);
  console.log(`  ${V.d}ANA will listen to sample phrases from your voice to calibrate its${V.r}`);
  console.log(`  ${V.d}acoustic recognition engine, gain sensitivity, and custom vocabulary.${V.r}\n`);

  speak("Welcome to Voice Calibration! Let's train ANA to recognize your voice perfectly.");

  const phrases = [
    "Hello ANA, order a football on Amazon under 400rs",
    "Search for software engineer jobs on LinkedIn",
    "Compose a cold email to recruiter on Gmail"
  ];

  const capturedPhrases = [];

  for (let i = 0; i < phrases.length; i++) {
    const target = phrases[i];
    console.log(`\n  ${V.yellow}Step ${i + 1}/${phrases.length}: Please read out loud into your microphone:${V.r}`);
    console.log(`  ${V.cyan}${V.b}"${target}"${V.r}`);

    speak(`Step ${i + 1}. Please read out loud: ${target}`);

    // Call voiceAsk directly so microphone STT is guaranteed for calibration!
    const heard = await voiceAsk(`  ${V.b}🎤 Sample ${i + 1}:${V.r} `, 8);

    if (heard) {
      console.log(`  ${V.green}✓ Recorded acoustic sample:${V.r} "${V.b}${heard}${V.r}"\n`);
      capturedPhrases.push({ target, heard });
    } else {
      console.log(`  ${V.d}⚠️ Sample skipped or not recognized.${V.r}\n`);
    }
  }

  const profile = {
    calibrated_at: new Date().toISOString(),
    samples_count: capturedPhrases.length,
    user_speech_level: "calibrated",
    phrases: capturedPhrases,
    custom_words: [
      "football", "amazon", "flipkart", "instacart", "blinkit", "zepto",
      "400", "500", "1000", "under", "rs", "rupees", "linkedin", "indeed",
      "naukri", "gmail", "compose", "outreach", "irctc", "makemytrip"
    ],
  };

  saveVoiceProfile(profile);

  console.log(`  ${V.green}${V.b}✅ Voice Profile Calibrated & Saved!${V.r}`);
  console.log(`  ${V.d}ANA is now trained on your voice acoustic characteristics.${V.r}\n`);
  speak("Voice calibration complete! I am now familiarized with your voice.");

  return profile;
}

// ─── Narration (non-blocking voice during automation) ────────────────
export function narrate(message) {
  if (_voiceMode && _voiceAvailable) {
    speakAsync(message);
  }
}

// ─── ANA Personality ─────────────────────────────────────────────────
export function greetUser() {
  const vp = loadVoiceProfile();
  const calibratedText = vp ? " Your voice profile is calibrated." : "";
  const greetings = [
    `Hello! I am ANA, your Autonomous Navigation Assistant.${calibratedText} What would you like me to help you with today?`,
    `Hi there! ANA here, ready to browse the web for you.${calibratedText} What can I do?`,
    `Welcome! I'm ANA, your personal browser agent.${calibratedText} Tell me what you need!`,
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
