# 🤖 SlabRoute + webcmd + A.N.A — Autonomous Self-Learning Browser Agent

> **SLAB Hackathon** | *Powered by **webcmd** architecture & **ANA (Autonomous Navigation Assistant)** — "Hello ANA"*

**SlabRoute** is a state-of-the-art autonomous browser agent built on the **webcmd** autonomous web automation engine. It combines voice-activated AI (**ANA**), multi-tier LLM waterfalls (**Ollama** + **claude-code-for-free** + **Gemini** + **OpenRouter**), an RL Q-value trajectory cache, an AI Job Discovery Assistant, and live visual Playwright Chromium browser execution.

---

## 🌐 webcmd Architecture & Mental Model

SlabRoute leverages **webcmd** (`webcmd_repo`) as its core execution engine:

```
                  ┌─────────────────────────────────────────┐
                  │       🎤 ANA Voice & CLI Interface      │
                  └────────────────────┬────────────────────┘
                                       │
                                       ▼
                  ┌─────────────────────────────────────────┐
                  │  ⚡ Fuzzy Q-Cache (workflow_memory.json) │
                  │  0 LLM Tokens • Sub-200ms DOM Replay    │
                  └────────────────────┬────────────────────┘
                                       │ (Cache Miss)
                                       ▼
 ┌──────────────────────────────────────────────────────────────────────────┐
 │                         🌊 Multi-Tier LLM Waterfall                      │
 │ Tier 1: Local Claude Proxy (claude-code-for-free @ http://127.0.0.1:3000)│
 │ Tier 1B: Local Ollama Model (llama3.2 / qwen2.5 @ http://127.0.0.1:11434) │
 │ Tier 2: Gemini API Keys × Round-Robin Models                            │
 │ Tier 3: OpenRouter Fallback Models                                       │
 │ Tier 4: Zero-API Smart DOM Heuristic Fallback                           │
 └─────────────────────────────────────┬────────────────────────────────────┘
                                       │
                                       ▼
                  ┌─────────────────────────────────────────┐
                  │  ⚙️ webcmd Autonomous Action Dispatcher  │
                  │  (Navigate, Click, Type, Select, Fill)  │
                  └────────────────────┬────────────────────┘
                                       │
                                       ▼
                  ┌─────────────────────────────────────────┐
                  │  🌐 Playwright Chromium Browser Engine  │
                  │  (Visible Window, Purple Overlay, Focus)│
                  └────────────────────┬────────────────────┘
                                       │
                                       ▼
                  ┌─────────────────────────────────────────┐
                  │  🔐 Section 9 Hard-Gated Human Confirmation│
                  │  (Pauses for Login, Apply & Checkout)   │
                  └─────────────────────────────────────────┘
```

---

## ✨ Key Features & Capabilities

| Feature | Description |
|---|---|
| 🛠️ **Powered by webcmd** | Autonomous DOM action primitives, atomic step execution, and trajectory recording |
| 🎤 **ANA Voice Assistant** | Say **"Hello ANA"** or tap **3x Spacebar** anywhere on Windows to activate |
| 🦙 **Local LLM & Ollama** | Integrated with `claude-code-for-free` (port 3000) & `Ollama llama3.2` (port 11434) |
| 💼 **Job Discovery & Auto-Apply** | 17-field job schema, 7-signal weighted match score (0-100), AI cover letters |
| ⚡ **Fuzzy Q-Cache Memory** | Replays learned workflows with 0 LLM tokens and 150ms step latency |
| 🌐 **Live Browser Dual-Interface** | Plays visually inside Playwright Chromium window with purple status overlay |
| 🔊 **F.R.I.D.A.Y. Female Voice** | Articulate female AI voice synthesizer via Windows VBScript SAPI |
| 🛡️ **Human-Gated Handoff** | Hard-gated user confirmation before submitting any application or payment |

## 🌍 Universal Web Automation & Multi-Task Capabilities

SlabRoute + **webcmd** is **not limited to job applications** — it is a **universal, general-purpose web agent** designed for **all web tasks** across any site:

- 🛒 **E-Commerce & Shopping**: Search products, compare prices, filter items (*e.g. "Order a football on Amazon under ₹400"*).
- 📧 **Recruiter Cold Mailing & Outreach**: Draft and send targeted outreach emails with personalized profile summaries.
- 🔍 **Deep Web Research**: Autonomous multi-page navigation, data extraction, and synthesis.
- 💼 **Job Discovery & Auto-Apply**: 17-field schema matching, 7-signal scoring, and automated application staging.
- 📝 **Automated Form Filling & Booking**: Handles complex forms, drop-downs, and logins with learned Q-cache speed.

---

## 💼 Job Discovery & Automated Application Engine

SlabRoute includes a daily Job Discovery engine:

- **17-Field Schema**: Title, Company, Location, Remote Type, Salary Range, Experience, Requirements, Responsibilities, Dates, Applicants, Openings, Rating, Review Snippet, Application URL, Source.
- **7-Signal Weighted Match Matrix**:
  - Requirements Overlap (30%)
  - Title Relevance (20%)
  - Salary Band Alignment (15%)
  - Application Urgency (10%)
  - Company Rating (10%)
  - Freshness (10%)
  - Competition Level (5%)
- **Batch Range Selection**: Supports `1-4`, `1,2,3`, `1-5` to stage multiple applications in live Playwright Chromium.


## 🎤 ANA Voice Assistant & Background Listener

- **Wake Word**: Say **"Hello ANA"**, **"Hey ANA"**, or press **Spacebar 3 times**.
- **Windows Startup Integration**: Run `install_startup.ps1` to automatically listen in background on laptop boot.
- **Whisper & Ollama Speech Refiner**: Audio recorded natively via `winmm.dll` and refined using Ollama / Whisper for multi-accent accuracy.
- **Zero Window Flashes**: Spawns hidden background STT processes (`-WindowStyle Hidden`) for a clean desktop.

---

## 🌊 Multi-Tier LLM Waterfall

```env
Tier 1: Local Claude Proxy (claude-code-for-free) -> http://127.0.0.1:3000/api
  ↓ (2.5s fast timeout failover)
Tier 1B: Local Ollama Model (llama3.2 / qwen2.5) -> http://127.0.0.1:11434
  ↓ (silent failover)
Tier 2: Gemini API Keys (4 keys × rotation)
  ↓ (key cooldown map)
Tier 3: OpenRouter Fallback Keys (3 keys × model cascade)
  ↓ (if all exhausted)
Tier 4: Zero-API Smart DOM Heuristics (0 Tokens Used)
```

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
npm run install-browsers
```

### 2. Configure Environment (`.env`)
```env
# Tier 1: Local Model Proxies
LLM_PROVIDER=claude_free
LOCAL_CLAUDE_URL=http://127.0.0.1:3000/api
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.2

# Tier 2: Gemini API Keys
GEMINI_API_KEY=your_key_1
GEMINI_API_KEY_2=your_key_2

# Tier 3: OpenRouter Keys
OPENROUTER_API_KEY=your_openrouter_key
```

### 3. Run SlabRoute & ANA
```bash
node index.js
```

### 4. Install Laptop Startup Listener (Optional)
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File install_startup.ps1
```

---

## 📁 Repository Structure

| Directory / File | Role |
|---|---|
| `webcmd_repo/` | Core **webcmd** autonomous browser command surface & Playwright runtime |
| `index.js` | Main agent — menu dispatcher, planner, browser launcher, Q-cache replay |
| `jobs.js` | Job Discovery Agent — 17-field schema, 7-signal match matrix, dashboard |
| `voice.js` | **ANA** — voice wake word engine, VBScript SAPI TTS, Ollama intent refiner |
| `utils.js` | 4-Tier LLM Waterfall, DOM heuristics, fuzzy Jaccard Q-cache matcher |
| `profile.js` | User profile store for candidate resume fields & form auto-filling |
| `listen_space_global.ps1` | Continuous background listener for "Hello ANA" & 3x Spacebar |
| `install_startup.ps1` | Registers background listener into Windows Startup folder |
| `workflow_memory.json` | Learned RL Q-trajectory cache |

---

## 🛡️ Safety & Privacy

- 🔒 **Credentials Stored Locally**: Profile details remain in `./user_profile.json` on your device.
- 🛑 **Section 9 Hard Gate**: Never auto-submits any application or payment without explicit `"Yes"` terminal confirmation.
- ⚡ **Zero-Token Replay**: Cached workflows execute with 0 tokens sent to any external API.

---

## 📜 License

MIT
