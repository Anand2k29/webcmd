import fs from "fs";
import path from "path";
import readline from "readline";

// ─── User Profile Store ──────────────────────────────────────────────
const PROFILE_FILE = path.resolve("./user_profile.json");

const COLORS = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  bgCyan: "\x1b[46m",
  bgMagenta: "\x1b[45m",
};

function ask(question) {
  return new Promise((resolve) => {
    if (process.stdin.isTTY && process.stdin.setRawMode) {
      try { process.stdin.setRawMode(false); } catch {}
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

export function loadProfile() {
  if (!fs.existsSync(PROFILE_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(PROFILE_FILE, "utf-8")); }
  catch { return null; }
}

export function saveProfile(profile) {
  fs.writeFileSync(PROFILE_FILE, JSON.stringify(profile, null, 2));
}

export function hasProfile() {
  return loadProfile() !== null;
}

// ─── Interactive profile setup ───────────────────────────────────────
export async function setupProfile() {
  const existing = loadProfile();

  console.log(`
${COLORS.bgCyan}${COLORS.bright}                                                    ${COLORS.reset}
${COLORS.bgCyan}${COLORS.bright}   👤  User Profile Setup                           ${COLORS.reset}
${COLORS.bgCyan}${COLORS.bright}                                                    ${COLORS.reset}

${COLORS.dim}SlabRoute needs your details to auto-fill forms on websites.
Your data is stored locally in user_profile.json and NEVER sent to any LLM.${COLORS.reset}
`);

  const profile = existing || {};

  const fields = [
    { key: "name", label: "Full Name", example: "Rahul Sharma" },
    { key: "email", label: "Email", example: "rahul@example.com" },
    { key: "phone", label: "Phone Number", example: "+91 98765 43210" },
    { key: "desired_role", label: "Target Job Title / Role", example: "Software Engineer / React Developer" },
    { key: "experience_years", label: "Total Experience (Years)", example: "2-4 years" },
    { key: "skills", label: "Key Skills (comma separated)", example: "JavaScript, TypeScript, Node.js, React, Python" },
    { key: "target_salary", label: "Expected Salary Band", example: "$120,000 - $160,000 / year or ₹20-35 LPA" },
    { key: "linkedin_url", label: "LinkedIn Profile URL", example: "https://linkedin.com/in/rahulsharma", optional: true },
    { key: "github_url", label: "GitHub / Portfolio URL", example: "https://github.com/rahulsharma", optional: true },
    { key: "address_line1", label: "Address Line 1", example: "123, MG Road" },
    { key: "city", label: "City", example: "Mumbai / Remote" },
    { key: "country", label: "Country", example: "India" },
    { key: "resume_summary", label: "Resume Summary / Short Bio", example: "Full Stack Engineer with 3+ years experience building web apps and automation APIs", optional: true },
  ];

  for (const field of fields) {
    const current = profile[field.key];
    const currentDisplay = current ? ` ${COLORS.dim}[current: ${current}]${COLORS.reset}` : "";
    const prompt = `  ${COLORS.cyan}${field.label}${COLORS.reset}${currentDisplay} ${COLORS.dim}(e.g. ${field.example})${COLORS.reset}: `;

    const answer = await ask(prompt);
    if (answer) {
      profile[field.key] = answer;
    } else if (!current && !field.optional) {
      console.log(`  ${COLORS.yellow}⚠ Skipped — you can update later with profile setup${COLORS.reset}`);
    }
  }

  profile.setup_at = new Date().toISOString();
  saveProfile(profile);

  console.log(`\n  ${COLORS.green}✅ Profile saved!${COLORS.reset} Your details are stored locally.\n`);
  return profile;
}

// ─── Daily Routine Store ──────────────────────────────────────────────
const ROUTINE_FILE = path.resolve("./daily_routine.json");

export function loadDailyRoutine() {
  if (!fs.existsSync(ROUTINE_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(ROUTINE_FILE, "utf-8")); }
  catch { return []; }
}

export function saveDailyRoutine(items) {
  fs.writeFileSync(ROUTINE_FILE, JSON.stringify(items, null, 2));
}

export async function setupDailyRoutine() {
  const existing = loadDailyRoutine();
  console.log(`
${COLORS.bgMagenta}${COLORS.bright}                                                    ${COLORS.reset}
${COLORS.bgMagenta}${COLORS.bright}   🛒  Daily Life Routine Shopping Setup            ${COLORS.reset}
${COLORS.bgMagenta}${COLORS.bright}                                                    ${COLORS.reset}

${COLORS.dim}Set up items you order regularly (e.g., Milk, Eggs, Bread, Coffee).
SlabRoute will learn the path on First Run and replay instantly with 0 tokens!${COLORS.reset}
`);

  if (existing.length > 0) {
    console.log(`  ${COLORS.green}Current Daily Routine Items:${COLORS.reset}`);
    existing.forEach((item, i) => console.log(`   ${i + 1}. ${item.name} (${item.platform})`));
    console.log();
  }

  const items = [...existing];
  const countStr = await ask(`  ${COLORS.cyan}How many items to add to your daily routine? (e.g. 1-3):${COLORS.reset} `);
  const count = parseInt(countStr) || 1;

  for (let i = 0; i < count; i++) {
    console.log(`\n  ${COLORS.yellow}Item ${i + 1}:${COLORS.reset}`);
    const name = await ask(`   Product Name (e.g. 1 Gallon Whole Milk, Eggs 12-pack): `);
    const platform = await ask(`   Platform (e.g. Instacart, Blinkit, Zepto, Amazon, Flipkart): `) || "Instacart";
    if (name) {
      items.push({ name, platform, added_at: new Date().toISOString() });
    }
  }

  saveDailyRoutine(items);
  console.log(`\n  ${COLORS.green}✅ Daily Routine saved! (${items.length} total items)${COLORS.reset}\n`);
  return items;
}

// ─── Auto-fill helper: generates fill instructions for the worker LLM ─
export function getAutoFillContext(profile) {
  if (!profile) return "";
  const parts = [];
  if (profile.name) parts.push(`Full name: ${profile.name}`);
  if (profile.email) parts.push(`Email: ${profile.email}`);
  if (profile.phone) parts.push(`Phone: ${profile.phone}`);
  if (profile.desired_role) parts.push(`Target Role: ${profile.desired_role}`);
  if (profile.experience_years) parts.push(`Experience: ${profile.experience_years}`);
  if (profile.skills) parts.push(`Key Skills: ${profile.skills}`);
  if (profile.target_salary) parts.push(`Target Salary: ${profile.target_salary}`);
  if (profile.linkedin_url) parts.push(`LinkedIn: ${profile.linkedin_url}`);
  if (profile.github_url) parts.push(`GitHub/Portfolio: ${profile.github_url}`);
  if (profile.address_line1) parts.push(`Address: ${profile.address_line1}`);
  if (profile.city) parts.push(`City: ${profile.city}`);
  if (profile.country) parts.push(`Country: ${profile.country}`);
  if (profile.resume_summary) parts.push(`Resume Summary: ${profile.resume_summary}`);

  if (parts.length === 0) return "";
  return `\n\nUSER PROFILE & RESUME DATA (use for job matching, cover letters, and auto-filling forms):\n${parts.join("\n")}`;
}
