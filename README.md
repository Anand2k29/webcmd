# 🤖 SlabRoute + A.N.A — Voice-Activated Self-Learning Browser Agent

> **SLAB Hackathon** | *"Hello ANA" — Explore once. Learn the workflow. Reuse instantly.*

SlabRoute is an autonomous browser agent powered by **ANA (Autonomous Navigation Assistant)** — a voice-activated AI that can **search, shop, and checkout** on real e-commerce websites. It learns entire workflows and replays them **instantly without API calls** on repeat runs.

---

## 🧠 How It Works

```
User: "Hello ANA" → "Buy me a laptop under 60000 on Flipkart"
        │
        ▼
┌──────────────────────┐        ┌─────────────────────┐
│  1. CHECK MEMORY     │──HIT──▶│  Replay instantly    │
│  (workflow_memory)   │        │  Zero API calls! ⚡   │
└──────────────────────┘        └─────────────────────┘
        │ MISS
        ▼
┌──────────────────────┐        ┌─────────────────────┐
│  2. LLM WATERFALL    │───────▶│  Claude → Gemini ×4  │
│  (askPlanner)        │        │  → OpenRouter ×6     │
└──────────────────────┘        └─────────────────────┘
        │  [step1, step2, …]
        ▼
┌──────────────────────┐        ┌─────────────────────┐
│  3. EXECUTE          │───────▶│  Smart DOM + LLM     │
│  (for each step)     │        │  DOM → Action JSON   │
└──────────────────────┘        └─────────────────────┘
        │  {action, selector, value}
        ▼
┌──────────────────────┐        ┌─────────────────────┐
│  4. BROWSER          │───────▶│  Playwright          │
│  (visible, persisted)│        │  With login sessions │
└──────────────────────┘        └─────────────────────┘
        │
        ▼
┌──────────────────────┐
│  5. LEARN & SAVE     │  ← Incremental saves after every step!
│  Full workflow cached │
└──────────────────────┘
```

## ✨ Key Features

| Feature | Description |
|---|---|
| 🎤 **ANA Voice Assistant** | Say "Hello ANA" — voice-activated browsing with natural language |
| 🌊 **3-Tier LLM Waterfall** | Claude proxy → 4× Gemini keys → 3× OpenRouter keys (never hits rate limits) |
| ⚡ **Self-Learning** | First run learns; repeat runs replay with zero API calls |
| 💾 **Always-Save Workflows** | Incremental save after every step — never lose progress |
| 🌐 **Visible Browser** | Real Chromium browser you can watch and interact with |
| 🔐 **Persistent Sessions** | Stays logged in across runs via browser profiles |
| 🛡️ **Human-in-the-Loop** | Auto-detects login & payment pages, waits for you |
| 🔄 **Smart Heuristics** | Amazon + Flipkart DOM selectors for bulletproof rate-limit fallback |

## 🎤 ANA Voice Assistant

ANA is your **Alexa-like voice interface** for browser automation:

```
╔══════════════════════════════════════════════════════════════╗
║   🤖  A.N.A — Autonomous Navigation Assistant             ║
║   Voice-Activated • Self-Learning • Intelligent             ║
╚══════════════════════════════════════════════════════════════╝

  ✅ ANA voice assistant is ready!
  🎤 Say "Hello ANA" to use voice, or press Enter for keyboard...

  🤖 ANA: "Hello! I am ANA, your Autonomous Navigation Assistant.
           What would you like me to help you with today?"

  📝 ANA heard: "buy a laptop under 60000 on Flipkart"
  🤖 ANA: "Got it! I'll search for that on Flipkart."
```

**Voice Features:**
- 🎤 Wake word: **"Hello ANA"** (also accepts "Hey ANA", "Hi ANA")
- 🗣️ Natural language commands (no menu numbers needed)
- 📢 ANA narrates each step during execution
- ⌨️ Automatic keyboard fallback if voice fails
- 🔇 Works without voice too (keyboard-only mode)

## 🌊 LLM Waterfall (Never Hit Rate Limits)

```
Tier 1: Local Claude Proxy    → Free, fastest
  ↓ (if failed)
Tier 2: Gemini API × 4 keys   → 4 keys × 2 models = 8 slots
  ↓ (if all rate-limited)
Tier 3: OpenRouter × 3 keys   → 3 keys × 6 models = 18 slots
  ↓ (if all exhausted)
Tier 4: DOM Heuristic Fallback → Zero API, selector-based
```

Supports up to **26 LLM fallback slots** with per-key cooldown tracking!

## 🛡️ Safety Guarantees

- ✅ **Never auto-submits payment** — always pauses and waits for you
- ✅ **Never types passwords** — detects login pages and hands control to you
- ✅ **Human approval** on all sensitive actions (submit, delete, confirm order)
- ✅ **Your credentials never touch the LLM** — only DOM structure is sent

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Install Playwright browsers
npm run install-browsers

# 3. Set up your API keys in .env
cp .env.example .env
# Add your Gemini keys (up to 4) + OpenRouter keys

# 4. Run the agent!
node index.js
```

## 📁 Project Structure

| File | Description |
|---|---|
| `index.js` | Main agent — planner, executor, voice integration, workflow recorder |
| `utils.js` | LLM waterfall, DOM extraction, page detection, logging |
| `voice.js` | **ANA** — voice assistant (TTS/STT via Windows PowerShell) |
| `profile.js` | User profile for auto-filling forms |
| `workflow_memory.json` | Auto-generated learned workflows (always saved) |
| `browser_profile/` | Persistent Chromium profile for login sessions |

## ⚙️ Environment Variables

```env
# Tier 1: Local Claude Proxy (optional)
LLM_PROVIDER=claude_free
LOCAL_CLAUDE_URL=http://127.0.0.1:3000/api

# Tier 2: Gemini API Keys (up to 4 for rotation)
GEMINI_API_KEY=your_key_1
GEMINI_API_KEY_2=your_key_2
GEMINI_API_KEY_3=your_key_3
GEMINI_API_KEY_4=your_key_4

# Tier 3: OpenRouter Keys (last-resort fallback)
OPENROUTER_API_KEY=your_openrouter_key
OPENROUTER_API_KEY_2=optional_key_2
OPENROUTER_API_KEY_3=optional_key_3
```

## ⚡ Latency Optimizations

| Parameter | Before | After |
|---|---|---|
| Step delay | 1200ms | 400ms |
| Tab-check wait | 1000ms | 400ms |
| Retry wait | 2000ms | 800ms |
| Claude retry | 1500ms | 800ms |
| Element timeout | 5000ms | 3000ms |
| Planner timeout | 45s | 30s |
| Worker timeout | 20s | 15s |

## 🏆 Hackathon Scoring Alignment

| Criterion | Points | How SlabRoute + ANA Delivers |
|---|---|---|
| 🟢 Live Reliability | 30 | 3-tier LLM waterfall, persistent browser, auto-retry, DOM heuristics |
| 💡 Real-World Usefulness | 25 | Voice-activated shopping, booking, research — end-to-end |
| 🧠 Technical Depth | 20 | LLM waterfall, self-learning, voice I/O, incremental save |
| ✨ Creativity | 15 | "Hello ANA" voice wake word + explore-once-replay-forever |
| 🎤 Demo & Storytelling | 10 | ANA narrates steps, visible browser, rich terminal UI |

## 📜 License

MIT
