#!/usr/bin/env node
// Test the current checkout (any branch, any git worktree) on a phone with Expo Go.
//
// Starts the API from THIS checkout, finds the computer's LAN IPv4 address, then
// starts Expo with EXPO_PUBLIC_API_URL=http://<lan-ip>:<port> set for this run only.
// No file is edited. See docs/test-on-phone.md.
//
//   npm run dev:phone                      local API + Expo on the LAN
//   npm run dev:phone -- --ip 10.0.0.5     use this IP instead of the detected one
//   npm run dev:phone -- --port 3001       API port (default: PORT, then apps/api/.env, then 3000)
//   npm run dev:phone -- --render          no local API, use the Render deploy (runs main)
//   npm run dev:phone -- --api-url <url>   no local API, use this URL
//   npm run dev:phone -- --tunnel          pass --tunnel to Expo (API must still be reachable)
//   npm run dev:phone -- --clear           clear the Metro cache
//   npm run dev:phone -- --copy-env        copy missing .env files from the main checkout
//
// Node only (no dependencies), works from PowerShell, cmd and Git Bash.

import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RENDER_URL = "https://earnm-api.onrender.com";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API_DIR = join(ROOT, "apps", "api");
const MOBILE_DIR = join(ROOT, "apps", "mobile");
const IS_WINDOWS = process.platform === "win32";

const HELP = readFileSync(fileURLToPath(import.meta.url), "utf8")
  .split("\n")
  .slice(1, 17)
  .map((line) => line.replace(/^\/\/ ?/, ""))
  .join("\n");

function fail(message) {
  console.error(`\n[dev-phone] ${message}\n`);
  process.exit(1);
}

function log(message) {
  console.log(`[dev-phone] ${message}`);
}

// ---------- arguments ----------

function parseArgs(argv) {
  const opts = { ip: null, port: null, apiUrl: null, tunnel: false, clear: false, copyEnv: false, expoArgs: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const v = argv[++i];
      if (!v || v.startsWith("--")) fail(`${arg} needs a value.`);
      return v;
    };
    switch (arg) {
      case "--ip": opts.ip = value(); break;
      case "--port": opts.port = value(); break;
      case "--render": opts.apiUrl = RENDER_URL; break;
      case "--api-url": opts.apiUrl = value().replace(/\/+$/, ""); break;
      case "--tunnel": opts.tunnel = true; break;
      case "--clear": opts.clear = true; break;
      case "--copy-env": opts.copyEnv = true; break;
      case "-h": case "--help": console.log(HELP); process.exit(0);
      case "--": opts.expoArgs.push(...argv.slice(i + 1)); i = argv.length; break;
      default: fail(`Unknown option ${arg}. Run with --help.`);
    }
  }
  if (opts.port !== null && !/^\d+$/.test(opts.port)) fail("--port must be a number.");
  if (opts.ip !== null && !/^\d{1,3}(\.\d{1,3}){3}$/.test(opts.ip)) fail("--ip must be an IPv4 address like 192.168.1.20.");
  return opts;
}

// ---------- .env files ----------

/** Reads KEY=value lines without printing anything. Only used for PORT. */
function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

function mainCheckout() {
  const res = spawnSync("git", ["worktree", "list", "--porcelain"], { cwd: ROOT, encoding: "utf8" });
  if (res.status !== 0) return null;
  const first = res.stdout.split(/\r?\n/).find((l) => l.startsWith("worktree "));
  if (!first) return null;
  const path = resolve(first.slice("worktree ".length));
  return path === ROOT ? null : path;
}

function ensureEnvFiles(opts, needApi) {
  const wanted = [];
  if (needApi) wanted.push(join("apps", "api", ".env"));
  const main = mainCheckout();
  const missing = wanted.filter((rel) => !existsSync(join(ROOT, rel)));
  if (missing.length === 0) return;

  const fromMain = main ? missing.filter((rel) => existsSync(join(main, rel))) : [];
  if (opts.copyEnv && fromMain.length === missing.length) {
    for (const rel of fromMain) {
      copyFileSync(join(main, rel), join(ROOT, rel));
      log(`Copied ${rel} from ${main} (gitignored, values not shown).`);
    }
    // apps/mobile/.env is optional for this script, but copy it too so plain `expo start` works.
    const mobileRel = join("apps", "mobile", ".env");
    if (!existsSync(join(ROOT, mobileRel)) && existsSync(join(main, mobileRel))) {
      copyFileSync(join(main, mobileRel), join(ROOT, mobileRel));
      log(`Copied ${mobileRel} from ${main}.`);
    }
    return;
  }

  const lines = [`Missing ${missing.join(", ")} in this checkout (${ROOT}).`];
  if (fromMain.length === missing.length) {
    lines.push("", "Copy them from the main checkout by running again with --copy-env:", "  npm run dev:phone -- --copy-env");
  } else {
    lines.push("", "Create it from apps/api/.env.example (needs DATABASE_URL, TEST_DATABASE_URL, INTERNAL_SECRET).");
  }
  lines.push("Or use the Render API instead: npm run dev:phone -- --render");
  fail(lines.join("\n"));
}

// ---------- dependencies ----------

// On Windows `npm`/`npx` are .cmd shims, which need a shell. Node warns (DEP0190) when
// args are passed alongside shell: true, so there we pass one quoted command line instead.
function shellArgs(cmd, args) {
  if (!IS_WINDOWS) return [cmd, args];
  const quote = (a) => (/^[\w.:/=@-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`);
  return [[cmd, ...args].map(quote).join(" "), []];
}

function spawnTool(cmd, args, options) {
  const [c, a] = shellArgs(cmd, args);
  return spawn(c, a, { ...options, shell: IS_WINDOWS });
}

function run(cmd, args, cwd) {
  const [c, a] = shellArgs(cmd, args);
  const res = spawnSync(c, a, { cwd, stdio: "inherit", shell: IS_WINDOWS });
  if (res.status !== 0) fail(`\`${cmd} ${args.join(" ")}\` failed in ${cwd}.`);
}

function ensureInstalled(dir) {
  if (existsSync(join(dir, "node_modules"))) return;
  log(`No node_modules in ${dir}: running npm ci (first run in this checkout).`);
  run("npm", ["ci"], dir);
}

// ---------- LAN address ----------

const VIRTUAL = /(vethernet|wsl|hyper-v|virtualbox|vmware|vbox|docker|tailscale|zerotier|loopback|bluetooth|utun|bridge|tap|tun|vpn)/i;
const PREFERRED = /(wi-?fi|wlan|wireless|^en\d|^eth|ethernet)/i;

function isPrivate(ip) {
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

function lanCandidates() {
  const list = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      const v4 = addr.family === "IPv4" || addr.family === 4;
      if (!v4 || addr.internal || addr.address.startsWith("169.254.")) continue;
      let score = 0;
      if (isPrivate(addr.address)) score += 4;
      if (PREFERRED.test(name)) score += 2;
      if (VIRTUAL.test(name)) score -= 10;
      list.push({ name, address: addr.address, score });
    }
  }
  return list.sort((x, y) => y.score - x.score);
}

// ---------- processes ----------

const children = [];

function killTree(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  if (IS_WINDOWS) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
  }
}

function shutdown(code = 0) {
  for (const child of children) killTree(child);
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

function prefixLines(stream, prefix, out) {
  let buf = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buf += chunk;
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    for (const line of lines) out.write(`${prefix} ${line}\n`);
  });
  stream.on("end", () => { if (buf) out.write(`${prefix} ${buf}\n`); });
}

async function isUp(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function startApi(port) {
  const health = `http://127.0.0.1:${port}/health`;
  if (await isUp(health)) {
    fail(`Something already answers on port ${port} (maybe another checkout's API).\nStop it, or pick another port: npm run dev:phone -- --port ${Number(port) + 1}`);
  }

  log(`Starting the API from this checkout on port ${port}...`);
  const api = spawnTool("npm", ["run", "dev"], {
    cwd: API_DIR,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    detached: !IS_WINDOWS,
  });
  children.push(api);
  prefixLines(api.stdout, "[api]", process.stdout);
  prefixLines(api.stderr, "[api]", process.stderr);

  let exited = null;
  api.on("exit", (code) => {
    exited = code;
    if (expoStarted) {
      console.error(`\n[dev-phone] The API stopped (exit code ${code}). Stopping Expo.`);
      shutdown(1);
    }
  });

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (exited !== null) fail(`The API exited (code ${exited}) before it was ready. See the [api] lines above.`);
    if (await isUp(health)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  fail(`The API did not answer ${health} within 90 seconds.`);
}

let expoStarted = false;

function startExpo(apiUrl, ip, opts) {
  // Clear Metro's cache when the API URL changed since the last run: EXPO_PUBLIC_* values
  // are inlined into the bundle, so a cached bundle could keep calling the old URL.
  const stateDir = join(MOBILE_DIR, ".expo");
  const stateFile = join(stateDir, "dev-phone-last-api-url");
  const lastUrl = existsSync(stateFile) ? readFileSync(stateFile, "utf8").trim() : null;
  const clear = opts.clear || lastUrl !== apiUrl;
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(stateFile, apiUrl);

  const args = ["expo", "start"];
  if (opts.tunnel) args.push("--tunnel");
  if (clear) args.push("--clear");
  args.push(...opts.expoArgs);

  const env = { ...process.env, EXPO_PUBLIC_API_URL: apiUrl };
  // Make the QR code point at the same address as the API (Expo picks its own otherwise).
  if (ip && !opts.tunnel) env.REACT_NATIVE_PACKAGER_HOSTNAME = ip;

  log(`npx ${args.join(" ")}${clear && !opts.clear ? "   (API URL changed: clearing Metro cache once)" : ""}`);
  const expo = spawnTool("npx", args, { cwd: MOBILE_DIR, env, stdio: "inherit" });
  expoStarted = true;
  children.push(expo);
  expo.on("exit", (code) => shutdown(code ?? 0));
}

function branchName() {
  const res = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  return res.status === 0 ? res.stdout.trim() : "(unknown)";
}

// ---------- main ----------

const opts = parseArgs(process.argv.slice(2));
const useLocalApi = opts.apiUrl === null;

ensureEnvFiles(opts, useLocalApi);
if (useLocalApi) ensureInstalled(API_DIR);
ensureInstalled(MOBILE_DIR);

let ip = opts.ip;
let apiUrl = opts.apiUrl;
let port = null;

if (useLocalApi) {
  port = opts.port ?? process.env.PORT ?? readEnvFile(join(API_DIR, ".env")).PORT ?? "3000";
  if (!ip) {
    const candidates = lanCandidates();
    if (candidates.length === 0) {
      fail("No LAN IPv4 address found. Is Wi-Fi on? Pass one with --ip, or use --render.");
    }
    ip = candidates[0].address;
    const others = candidates.slice(1).filter((c) => c.score > 0);
    if (others.length > 0) {
      log(`Using ${ip} (${candidates[0].name}). Other addresses: ${others.map((c) => `${c.address} (${c.name})`).join(", ")}. Pick one with --ip if the phone can't connect.`);
    }
  }
  apiUrl = `http://${ip}:${port}`;
} else if (!ip) {
  ip = lanCandidates()[0]?.address ?? null;
}

console.log("");
log(`Checkout: ${ROOT}`);
log(`Branch:   ${branchName()}`);
log(`API URL:  ${apiUrl}${useLocalApi ? "  (local API from this checkout)" : ""}`);
if (opts.tunnel && useLocalApi) {
  log("Warning: --tunnel only tunnels Metro. The phone still needs to reach the API at the LAN address above.");
}
console.log("");

if (useLocalApi) await startApi(port);
log(`${useLocalApi ? "API is up. " : ""}On the iPhone, open ${apiUrl}/health in Safari to check the phone can reach the API.`);
startExpo(apiUrl, ip, opts);
