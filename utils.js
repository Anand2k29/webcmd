import "dotenv/config";
import fs from "fs";
import path from "path";
import axios from "axios";

// ─── LLM Waterfall Engine ────────────────────────────────────────────
// Cascade order:
//   1. Local Claude proxy (if configured)
//   2. Gemini API keys × models (round-robin, with per-key cooldowns)
//   3. OpenRouter models (last-resort fallback)
// ─────────────────────────────────────────────────────────────────────

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1/chat/completions";

// Rate limit: wait between retries
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Per-key cooldown tracker — skip keys that were recently rate-limited
const keyCooldowns = new Map(); // key identifier → Date.now() when cooldown expires

function isOnCooldown(keyId) {
  const expires = keyCooldowns.get(keyId);
  if (!expires) return false;
  if (Date.now() >= expires) {
    keyCooldowns.delete(keyId);
    return false;
  }
  return true;
}

function setCooldown(keyId, seconds = 30) {
  keyCooldowns.set(keyId, Date.now() + seconds * 1000);
}

function keyTag(key) { return key ? `...${key.slice(-4)}` : "???"; }

// ─── Collect all configured keys ─────────────────────────────────────
function getGeminiKeys() {
  return [
    process.env.GEMINI_API_KEY?.trim(),
    process.env.GEMINI_API_KEY_2?.trim(),
    process.env.GEMINI_API_KEY_3?.trim(),
    process.env.GEMINI_API_KEY_4?.trim(),
  ].filter(Boolean);
}

function getOpenRouterKeys() {
  return [
    process.env.OPENROUTER_API_KEY?.trim(),
    process.env.OPENROUTER_API_KEY_2?.trim(),
    process.env.OPENROUTER_API_KEY_3?.trim(),
  ].filter(Boolean);
}

// OpenRouter models to try in order (DeepSeek fast models prioritized)
const OPENROUTER_MODELS = [
  "deepseek/deepseek-chat",
  "deepseek/deepseek-r1-distill-llama-70b",
  "meta-llama/llama-3.3-70b-instruct",
  "google/gemini-2.5-flash",
  "mistralai/mistral-small-3.1-24b-instruct",
];

// Gemini models to cycle through per key (active & reliable endpoints)
const GEMINI_MODELS = [
  "gemini-3.6-flash",
  "gemini-2.5-flash",
];

// ─── Tier 1: Local Claude Proxy ──────────────────────────────────────
async function tryLocalClaude(prompt, systemPrompt, options) {
  const localUrl = process.env.LOCAL_CLAUDE_URL?.trim() ||
    (process.env.LLM_PROVIDER === "claude_free" ? "http://127.0.0.1:3000/api" : null);

  if (!localUrl) return null;

  const endpoint = localUrl.endsWith("/chat/completions")
    ? localUrl
    : `${localUrl.replace(/\/+$/, "")}/chat/completions`;

  const localModel = process.env.LOCAL_CLAUDE_MODEL?.trim() || "auto";

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      log("🤖", `[Tier 1] Local Claude (${localModel})...`, "dim");
      const resp = await axios.post(endpoint, {
        model: localModel,
        messages: [
          ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
          { role: "user", content: prompt }
        ],
        temperature: options.temperature ?? 0,
      }, { timeout: options.timeout || 45000 });

      const text = resp.data.choices?.[0]?.message?.content || resp.data.content?.[0]?.text;
      if (text) {
        log("✅", `[Tier 1] Local Claude responded`, "green");
        return text;
      }
    } catch (e) {
      if (attempt === 1) {
        console.log(`  ⏳ Local Claude notice (${e.message}). Retrying in 0.8s...`);
        await sleep(800); // ⚡ 1500→800ms
        continue;
      }
      console.log(`  ⚠️ Local Claude failed (${e.message}), cascading to Tier 2...`);
    }
  }
  return null;
}

// ─── Tier 2: Gemini API Keys × Models ────────────────────────────────
async function tryGemini(prompt, systemPrompt, options) {
  const apiKeys = getGeminiKeys();
  if (apiKeys.length === 0) return null;

  let lastError;

  for (const apiKey of apiKeys) {
    const tag = keyTag(apiKey);

    for (const model of GEMINI_MODELS) {
      const keyId = `gemini:${tag}:${model}`;

      // Skip keys on cooldown
      if (isOnCooldown(keyId)) {
        continue;
      }

      const url = `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`;
      const parts = [];
      if (systemPrompt) parts.push({ text: `[SYSTEM]\n${systemPrompt}\n[/SYSTEM]\n\n` });
      parts.push({ text: prompt });

      if (options.imageBase64) {
        parts.push({ inline_data: { mime_type: "image/png", data: options.imageBase64 } });
      }

      try {
        log("🤖", `[Tier 2] Gemini ${model} (key ${tag})...`, "dim");
        const resp = await axios.post(url, {
          contents: [{ parts }],
          generationConfig: { temperature: options.temperature ?? 0 },
        }, { timeout: options.timeout || 30000 });

        const text = resp.data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error("Empty response from Gemini");
        log("✅", `[Tier 2] Gemini ${model} (key ${tag}) responded`, "green");
        return text;
      } catch (err) {
        lastError = err.response?.data?.error?.message || err.message;
        const status = err.response?.status;

        if (status === 429 || (typeof lastError === "string" && (lastError.includes("Quota exceeded") || lastError.includes("rate-limits") || lastError.includes("RESOURCE_EXHAUSTED")))) {
          // Parse retry-after hint from error message if available
          const retryMatch = typeof lastError === "string" && lastError.match(/retry in ([\d.]+)s/i);
          const cooldownSec = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) + 5 : 60;
          setCooldown(keyId, cooldownSec);
          console.log(`  ⏳ Rate limit: ${model} (key ${tag}) → cooldown ${cooldownSec}s. Trying next...`);
          await sleep(500);
          continue; // Try next model or next key
        }
        // Non-rate-limit error → skip this model but try next
        console.log(`  ⚠️ Gemini ${model} (key ${tag}) error: ${typeof lastError === "string" ? lastError.slice(0, 80) : lastError}`);
        break; // break model loop, try next key
      }
    }
  }

  return null; // All Gemini keys/models exhausted
}

// ─── Tier 3: OpenRouter Fallback ─────────────────────────────────────
async function tryOpenRouter(prompt, systemPrompt, options) {
  const apiKeys = getOpenRouterKeys();
  if (apiKeys.length === 0) return null;

  let lastError;

  for (const apiKey of apiKeys) {
    const tag = keyTag(apiKey);

    for (const model of OPENROUTER_MODELS) {
      const keyId = `openrouter:${tag}:${model}`;

      if (isOnCooldown(keyId)) {
        continue;
      }

      try {
        log("🤖", `[Tier 3] OpenRouter ${model} (key ${tag})...`, "dim");

        const messages = [];
        if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
        messages.push({ role: "user", content: prompt });

        // OpenRouter doesn't support inline images in the same way,
        // so if there's an image, attach it as a multi-part user message
        if (options.imageBase64) {
          messages[messages.length - 1] = {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: `data:image/png;base64,${options.imageBase64}` } },
            ],
          };
        }

        const resp = await axios.post(OPENROUTER_BASE, {
          model,
          messages,
          temperature: options.temperature ?? 0,
        }, {
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://slabroute.app",
            "X-Title": "SlabRoute Browser Agent",
          },
          timeout: options.timeout || 45000,
        });

        const text = resp.data.choices?.[0]?.message?.content;
        if (!text) throw new Error("Empty response from OpenRouter");
        log("✅", `[Tier 3] OpenRouter ${model} responded`, "green");
        return text;
      } catch (err) {
        lastError = err.response?.data?.error?.message || err.message;
        const status = err.response?.status;

        if (status === 429 || (typeof lastError === "string" && lastError.includes("rate"))) {
          setCooldown(keyId, 30);
          console.log(`  ⏳ Rate limit: OpenRouter ${model} (key ${tag}) → cooldown 30s. Trying next...`);
          await sleep(500);
          continue;
        }
        console.log(`  ⚠️ OpenRouter ${model} error: ${typeof lastError === "string" ? lastError.slice(0, 80) : lastError}`);
        continue; // Try next model
      }
    }
  }

  return null; // All OpenRouter keys/models exhausted
}

// ─── Main LLM Entry Point (Waterfall) ────────────────────────────────
export async function callGemini(prompt, systemPrompt = "", options = {}) {
  // Tier 1: Local Claude proxy
  const localResult = await tryLocalClaude(prompt, systemPrompt, options);
  if (localResult) return localResult;

  // Tier 2: Gemini API (multiple keys × multiple models)
  const geminiResult = await tryGemini(prompt, systemPrompt, options);
  if (geminiResult) return geminiResult;

  // Tier 3: OpenRouter (multiple keys × multiple models)
  const orResult = await tryOpenRouter(prompt, systemPrompt, options);
  if (orResult) return orResult;

  // All tiers exhausted
  const totalKeys = getGeminiKeys().length + getOpenRouterKeys().length;
  throw new Error(
    `All LLM tiers exhausted (${totalKeys} keys tried). ` +
    `Configure more keys in .env: GEMINI_API_KEY, GEMINI_API_KEY_2, GEMINI_API_KEY_3, GEMINI_API_KEY_4, ` +
    `OPENROUTER_API_KEY, OPENROUTER_API_KEY_2, OPENROUTER_API_KEY_3`
  );
}

// ─── HTML sanitisation ───────────────────────────────────────────────
export function sanitiseHTML(rawHTML) {
  return rawHTML
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ─── Smart DOM extraction (FAST — only interactive elements) ─────────
// Instead of sending 15K of raw HTML, extract only what matters:
// buttons, links, inputs, forms, prices, headings
export async function extractSmartDOM(page) {
  return page.evaluate(() => {
    const elements = [];
    const url = window.location.href;
    const title = document.title;

    // Extract interactive elements with context
    const selectors = [
      { sel: 'input:not([type="hidden"])', type: 'input' },
      { sel: 'textarea', type: 'textarea' },
      { sel: 'button', type: 'button' },
      { sel: 'a[href]', type: 'link' },
      { sel: 'select', type: 'select' },
      { sel: '[role="button"]', type: 'button' },
      { sel: '[onclick]', type: 'clickable' },
    ];

    for (const { sel, type } of selectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        // Skip invisible elements
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;

        const info = { type };
        // Build a unique CSS selector
        if (el.id) info.selector = `#${el.id}`;
        else if (el.name) info.selector = `${el.tagName.toLowerCase()}[name="${el.name}"]`;
        else if (el.getAttribute('aria-label')) info.selector = `[aria-label="${el.getAttribute('aria-label')}"]`;
        else if (el.getAttribute('data-testid')) info.selector = `[data-testid="${el.getAttribute('data-testid')}"]`;
        else if (el.className && typeof el.className === 'string') {
          const cls = el.className.split(' ').filter(c => c && c.length < 30).slice(0, 2).join('.');
          if (cls) info.selector = `${el.tagName.toLowerCase()}.${cls}`;
        }

        // Text content
        const text = (el.textContent || el.value || el.placeholder || el.getAttribute('aria-label') || '').trim().slice(0, 80);
        if (text) info.text = text;

        // For inputs
        if (el.type) info.inputType = el.type;
        if (el.placeholder) info.placeholder = el.placeholder;

        // For links
        if (el.href) info.href = el.href.slice(0, 120);

        if (info.selector) elements.push(info);
      }
    }

    // Extract key text (prices, headings)
    const headings = [];
    document.querySelectorAll('h1, h2, h3, [class*="price"], [class*="Price"]').forEach(el => {
      const text = (el.textContent || '').trim().slice(0, 100);
      if (text) headings.push(text);
    });

    return {
      url,
      title,
      headings: headings.slice(0, 10),
      elements: elements.slice(0, 60), // Cap at 60 elements
      elementCount: elements.length,
    };
  });
}

// ─── Safe JSON parsing (handles markdown fences, <think> tags, etc.) ─
export function safeParseJSON(text) {
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const matchArray = cleaned.match(/\[[\s\S]*\]/);
    if (matchArray) {
      try { return JSON.parse(matchArray[0]); } catch { /* fall through */ }
    }
    const matchObj = cleaned.match(/\{[\s\S]*\}/);
    if (matchObj) {
      try { return JSON.parse(matchObj[0]); } catch { /* fall through */ }
    }
    throw new Error(`Could not parse JSON from response: ${text.slice(0, 200)}`);
  }
}

// ─── Workflow memory (Reinforcement Learning Q-Cache) ─────────────────
const CACHE_FILE = path.resolve("./workflow_memory.json");
const RL_ALPHA = 0.3; // Learning rate
const RL_GAMMA = 0.9; // Discount factor

export function loadMemory() {
  if (!fs.existsSync(CACHE_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8")); }
  catch { return {}; }
}

export function saveMemory(data) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
}

export function getCachedWorkflow(goal) {
  const mem = loadMemory();
  const key = goal.toLowerCase().trim();
  const entry = mem[key];
  if (!entry) return null;
  // RL Policy check: accept if Q-value > 0 or previously successful
  if (entry.q_value !== undefined && entry.q_value < -20) return null; // Reject low Q policy
  return entry;
}

export function saveWorkflow(goal, steps, complete = false, durationMs = 3000) {
  const mem = loadMemory();
  const key = goal.toLowerCase().trim();
  const existing = mem[key] || {};

  const prevQ = existing.q_value ?? (complete ? 70 : 10);
  const durationSec = Math.max(0.5, durationMs / 1000);

  // Reinforcement Learning Reward Function R:
  // Completion bonus +100 | Failure penalty -30 | Speed bonus / latency penalty
  let reward = complete ? 100 : -20;
  reward -= Math.min(30, durationSec * 1.2);
  if (complete && steps.length <= 6) reward += 20;

  // Q-Learning Bellman update: Q(s,a) <- Q(s,a) + alpha * [R + gamma * maxQ' - Q(s,a)]
  const nextMaxQ = complete ? 100 : 0;
  const newQ = prevQ + RL_ALPHA * (reward + RL_GAMMA * nextMaxQ - prevQ);
  const visits = (existing.visits || 0) + 1;

  mem[key] = {
    learned_at: new Date().toISOString(),
    steps,
    success: complete,
    step_count: steps.length,
    q_value: Math.round(newQ * 10) / 10,
    visits,
    last_reward: Math.round(reward * 10) / 10,
    avg_duration_sec: Math.round(durationSec * 10) / 10,
    first_seen: existing.first_seen || new Date().toISOString(),
  };

  saveMemory(mem);
}

export function listLearnedWorkflows() {
  const mem = loadMemory();
  return Object.keys(mem).filter(k => mem[k].steps && mem[k].steps.length > 0);
}

// ─── Page-type detection ─────────────────────────────────────────────
export async function detectPageType(page) {
  return page.evaluate(() => {
    const html = document.body?.innerHTML?.toLowerCase() || "";
    const url = window.location.href.toLowerCase();

    // 1. Password/Login detection (strict: requires password input field)
    const hasPasswordField = !!document.querySelector('input[type="password"]');
    const loginKeywords = ["sign in", "log in", "login", "signin", "enter password"];
    if (hasPasswordField && loginKeywords.some((kw) => html.includes(kw))) return "login";

    // 2. SEARCH RESULTS Detection (Google/Bing/Amazon search pages)
    const searchUrls = ["google.com/search", "bing.com/search", "/s?", "search?", "s?k="];
    if (searchUrls.some((kw) => url.includes(kw))) return "search_results";

    // 3. PRODUCT PAGE Detection (has Add to Cart / Buy Now buttons)
    const productSelectors = [
      '#add-to-cart-button', '#buy-now-button', '[name="submit.add-to-cart"]',
      '[data-action="add-to-cart"]', 'button[name="add-to-cart"]', '.add-to-cart-btn'
    ];
    if (productSelectors.some(sel => !!document.querySelector(sel))) return "product";

    // 4. CART Detection
    const cartUrls = ["/cart", "/gp/cart", "/basket", "shopping-cart"];
    if (cartUrls.some((kw) => url.includes(kw))) return "cart";

    // 5. PAYMENT / CHECKOUT Detection (strict: must be on actual checkout domain path or have explicit payment inputs)
    const checkoutUrls = [
      "/checkout", "/buy/payselect", "/gp/buy/spc", "/payselect", "/payment-options", 
      "/spc/handlers", "checkout.", "/pay/", "cart/checkout"
    ];
    const isCheckoutUrl = checkoutUrls.some((kw) => url.includes(kw));

    const paymentInputSelectors = [
      '#pay-button', '#submitOrderButtonId', 'input[name="ppw-instrumentRowSelection"]',
      '[data-pmts-component-id]', 'input[name*="card"]', 'input[id*="cvv"]', 'input[id*="upi"]'
    ];
    const hasPaymentInput = paymentInputSelectors.some(sel => !!document.querySelector(sel));

    if (isCheckoutUrl || hasPaymentInput) {
      const paymentHeaderKeywords = [
        "select a payment method", "choose how to pay", "payment options",
        "enter upi id", "credit or debit card", "order summary", "cash on delivery"
      ];
      if (paymentHeaderKeywords.some(kw => html.includes(kw)) || isCheckoutUrl) {
        return "payment";
      }
    }

    return "unknown";
  });
}

// ─── Screenshot utilities ────────────────────────────────────────────
export async function takeScreenshot(page) {
  const buffer = await page.screenshot({ type: "png", fullPage: false });
  return buffer.toString("base64");
}

export async function askVision(screenshotBase64, prompt) {
  return callGemini(prompt, "", { imageBase64: screenshotBase64, timeout: 30000 });
}

// ─── Browser overlay injection ───────────────────────────────────────
// Injects a floating status bar into the browser page so user can SEE
// what the agent is thinking/doing — this is a hackathon differentiator!
export async function injectOverlay(page) {
  await page.evaluate(() => {
    if (document.getElementById('slabroute-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'slabroute-overlay';
    overlay.innerHTML = `
      <div id="sr-status" style="
        position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
        background: linear-gradient(135deg, #0f0c29, #302b63, #24243e);
        color: #fff; padding: 8px 16px; font-family: 'Segoe UI', sans-serif;
        font-size: 13px; display: flex; align-items: center; gap: 12px;
        box-shadow: 0 2px 12px rgba(0,0,0,0.4); border-bottom: 2px solid #7c3aed;
      ">
        <span style="font-size: 18px;">🤖</span>
        <span style="font-weight: 600; color: #a78bfa;">SlabRoute Agent</span>
        <span id="sr-msg" style="color: #e0e0e0; flex: 1;">Initializing...</span>
        <span id="sr-dot" style="width: 8px; height: 8px; border-radius: 50%; background: #22c55e; animation: sr-pulse 1s infinite;"></span>
      </div>
      <style>
        @keyframes sr-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes sr-highlight {
          0% { outline: 3px solid transparent; }
          50% { outline: 3px solid #7c3aed; outline-offset: 2px; }
          100% { outline: 3px solid transparent; }
        }
        .sr-highlight { animation: sr-highlight 1.5s ease-in-out 3; }
      </style>
    `;
    document.body.appendChild(overlay);
  });
}

export async function updateOverlayStatus(page, message) {
  try {
    await page.evaluate((msg) => {
      const el = document.getElementById('sr-msg');
      if (el) el.textContent = msg;
    }, message);
  } catch { /* page navigated, ignore */ }
}

export async function highlightElement(page, selector) {
  try {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) {
        el.classList.add('sr-highlight');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => el.classList.remove('sr-highlight'), 4500);
      }
    }, selector);
  } catch { /* ignore */ }
}

// ─── Pretty logging ──────────────────────────────────────────────────
const COLORS = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  bgBlue: "\x1b[44m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgRed: "\x1b[41m",
};

export function log(emoji, message, color = "reset") {
  console.log(`${COLORS[color]}${emoji} ${message}${COLORS.reset}`);
}

export function logStep(index, total, message) {
  console.log(
    `\n${COLORS.bgBlue}${COLORS.bright} STEP ${index + 1}/${total} ${COLORS.reset} ${COLORS.cyan}${message}${COLORS.reset}`
  );
}

export function logAction(action) {
  console.log(
    `  ${COLORS.dim}→ action: ${COLORS.yellow}${action.action}${COLORS.reset}` +
    (action.selector ? `  ${COLORS.dim}selector: ${COLORS.magenta}${action.selector}${COLORS.reset}` : "") +
    (action.value ? `  ${COLORS.dim}value: ${COLORS.green}${action.value}${COLORS.reset}` : "")
  );
}
