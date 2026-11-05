"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execSync, spawn } = require("node:child_process");

const CLINE_API_BASE = "https://api.cline.bot/api/v1";
const CLINE_PREFIX = "vividcline";
const CLINE_BEAM = "reflection/beam-1.0-501b-a23b";

const TARGETS = [
  {
    key: "kilo-beam-free",
    name: "Beam 1.0 Free",
    source: "Kilo",
    accent: "magenta",
    exact: [
      "kc/reflection/beam-free",
      "kilo/reflection/beam-free",
      "kilocode/reflection/beam-free",
      "kgw/reflection/beam-free",
    ],
    fuzzy: (m) =>
      /beam/i.test(m.id) &&
      /free/i.test(m.id) &&
      /(^|\/)(kc|kilo|kilocode|kgw)\//i.test(m.id),
  },
  {
    key: "opencode-deepseek-flash",
    name: "DeepSeek V4.1 Flash",
    source: "OpenCode Free",
    accent: "cyan",
    exact: ["oc/deepseek-v4.1-flash-free"],
    fuzzy: (m) =>
      /deepseek[-_/]v4\.1[-_]flash/i.test(m.id) && /(^|\/)oc\//i.test(m.id),
  },
  {
    key: "cline-beam",
    name: "Beam 1.0",
    source: "Cline",
    accent: "lime",
    exact: [
      `${CLINE_PREFIX}/${CLINE_BEAM}`,
      `${CLINE_PREFIX}/reflection/beam-free`,
      "cline/reflection/beam-1.0-501b-a23b",
      "cline/reflection/beam-free",
      "clinepass/cline-pass/reflection/beam-free",
      "cl/reflection/beam-1.0-501b-a23b",
      "cline-free/reflection/beam-free",
    ],
    fuzzy: (m) =>
      /beam/i.test(m.id) && /(^|\/)(cline|clinepass|cl)\//i.test(m.id),
  },
];

class RouterError extends Error {
  constructor(message, code = "ROUTER", status = 0) {
    super(message);
    this.name = "RouterError";
    this.code = code;
    this.status = status;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, options = {}) {
  const { method = "GET", headers = {}, body, timeout = 20000 } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    return { ok: res.ok, status: res.status, data, text };
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw new RouterError(`Request timed out: ${url}`, "TIMEOUT");
    }
    throw new RouterError(`Network error: ${err.message}`, "NETWORK");
  } finally {
    clearTimeout(timer);
  }
}

function originOf(baseUrl) {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return "http://localhost:20128";
  }
}

function isLocal(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname;
    return ["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(host);
  } catch {
    return false;
  }
}

function dataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
      "9router"
    );
  }
  return path.join(os.homedir(), ".9router");
}

function readCliToken() {
  try {
    const dir = dataDir();
    const machine = fs.readFileSync(path.join(dir, "machine-id"), "utf8").trim();
    const secret = fs.readFileSync(path.join(dir, "auth", "cli-secret"), "utf8").trim();
    if (!machine || !secret) return "";
    return crypto
      .createHash("sha256")
      .update(machine + "9r-cli-auth" + secret)
      .digest("hex")
      .substring(0, 16);
  } catch {
    return "";
  }
}

let cachedClient;
let cachedClientBase;
function loadInternalClient(baseUrl) {
  if (cachedClient && cachedClientBase === baseUrl) return cachedClient;
  try {
    const root = execSync("npm root -g", {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15000,
    }).trim();
    const modPath = path.join(root, "9router", "src", "cli", "api", "client.js");
    const client = require(modPath);
    const u = new URL(baseUrl);
    client.configure({
      host: u.hostname,
      port: Number(u.port) || (u.protocol === "https:" ? 443 : 20128),
      protocol: u.protocol,
    });
    cachedClient = client;
    cachedClientBase = baseUrl;
    return client;
  } catch {
    return null;
  }
}

async function internalRequest(baseUrl, apiPath, method = "GET", body) {
  const client = loadInternalClient(baseUrl);
  if (client && apiPath === "/api/keys" && method === "GET") return client.getApiKeys();
  if (client && apiPath === "/api/keys" && method === "POST") return client.createApiKey(body.name);
  if (client && apiPath === "/api/provider-nodes" && method === "GET") return client.getProviderNodes();
  if (client && apiPath === "/api/provider-nodes" && method === "POST") return client.createProviderNode(body);
  if (client && method === "PUT" && /^\/api\/provider-nodes\/[^/]+$/.test(apiPath)) {
    return client.updateProviderNode(apiPath.split("/").pop(), body);
  }
  if (client && apiPath === "/api/providers" && method === "GET") return client.getProviders();
  if (client && apiPath === "/api/providers" && method === "POST") return client.createApiKeyProvider(body);
  if (client && method === "PUT" && /^\/api\/providers\/[^/]+$/.test(apiPath)) {
    return client.updateConnection(apiPath.split("/").pop(), body);
  }
  if (client && method === "POST" && /^\/api\/providers\/[^/]+\/test$/.test(apiPath)) {
    return client.testProvider(apiPath.split("/")[3]);
  }

  const token = readCliToken();
  if (!token) {
    return { success: false, error: "9Router CLI token unavailable (is 9Router installed?)" };
  }
  try {
    const res = await fetchJson(`${originOf(baseUrl)}${apiPath}`, {
      method,
      headers: { "Content-Type": "application/json", "x-9r-cli-token": token },
      body,
      timeout: 20000,
    });
    if (!res.ok) {
      return { success: false, error: res.data?.error || `HTTP ${res.status}`, statusCode: res.status };
    }
    return { success: true, data: res.data, statusCode: res.status };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function checkHealth(baseUrl) {
  try {
    const res = await fetchJson(`${baseUrl}/models`, { timeout: 4000 });
    return res.status > 0 && res.status < 500;
  } catch {
    return false;
  }
}

function find9RouterCommand() {
  try {
    const which = process.platform === "win32" ? "where.exe 9router" : "which 9router";
    const out = execSync(which, { encoding: "utf8", windowsHide: true, timeout: 8000 })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (out.length) {
      const executable = out.find((line) => /\.(cmd|exe|bat)$/i.test(line));
      return executable || out[0];
    }
  } catch {
    /* ignore */
  }
  return process.platform === "win32" ? "9router.cmd" : "9router";
}

function startServer() {
  try {
    const command = find9RouterCommand();
    const child = spawn(command, ["--no-browser"], {
      detached: true,
      stdio: "ignore",
      shell: process.platform === "win32",
      windowsHide: true,
      cwd: os.homedir(),
      env: process.env,
    });
    child.unref();
    return { started: true, command };
  } catch (err) {
    return { started: false, error: err.message };
  }
}

async function waitForServer(baseUrl, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await checkHealth(baseUrl)) return true;
    await sleep(900);
  }
  return false;
}

async function ensureServer(baseUrl, options = {}) {
  const { autoStart = true, onStatus = () => {} } = options;
  if (await checkHealth(baseUrl)) return { online: true, started: false };
  if (!autoStart) return { online: false, started: false };
  if (!isLocal(baseUrl)) {
    return { online: false, started: false, error: "Remote 9Router is offline." };
  }
  onStatus("Launching 9Router engine…");
  const launch = startServer();
  if (!launch.started) return { online: false, started: false, error: launch.error };
  onStatus("Waiting for 9Router handshake…");
  const online = await waitForServer(baseUrl, 35000);
  return { online, started: online, error: online ? "" : "9Router did not answer in time." };
}

async function fetchModels(baseUrl, apiKey) {
  const headers = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetchJson(`${baseUrl}/models`, { headers, timeout: 20000 });
  if (res.status === 401 || res.status === 403) {
    throw new RouterError("9Router rejected the API key.", "AUTH", res.status);
  }
  if (!res.ok) {
    throw new RouterError(
      res.data?.error || `9Router models request failed (HTTP ${res.status}).`,
      "HTTP",
      res.status
    );
  }
  const list = Array.isArray(res.data?.data) ? res.data.data : [];
  return list.map(decorateModel);
}

function decorateModel(model) {
  const id = String(model.id || "");
  const owner = String(model.owned_by || model.provider || "9router");
  const caps = model.capabilities || {};
  const context = caps.contextWindow || model.context_length || model.context_window || 0;
  const maxOut = caps.maxOutput || model.max_completion_tokens || 0;
  return {
    id,
    provider: owner,
    free: /free/i.test(id) || /free/i.test(owner),
    tools: caps.tools !== false,
    reasoning: Boolean(caps.reasoning),
    vision: Boolean(caps.vision),
    context,
    maxOut,
    raw: model,
  };
}

async function getInternalKeys(baseUrl) {
  const res = await internalRequest(baseUrl, "/api/keys", "GET");
  if (!res.success) return { keys: [], error: res.error };
  return { keys: res.data?.keys || [], error: "" };
}

async function createInternalKey(baseUrl) {
  const res = await internalRequest(baseUrl, "/api/keys", "POST", { name: "VividCode" });
  if (!res.success) return { key: "", error: res.error };
  return { key: res.data?.key || "", error: "" };
}

async function resolveApiKey(cfg, options = {}) {
  const { onStatus = () => {} } = options;
  const baseUrl = cfg.baseUrl;
  const candidates = [];
  if (cfg.apiKey) candidates.push({ key: cfg.apiKey, source: "config" });
  if (process.env.NINE_ROUTER_API_KEY && process.env.NINE_ROUTER_API_KEY !== cfg.apiKey) {
    candidates.push({ key: process.env.NINE_ROUTER_API_KEY, source: "env" });
  }

  for (const candidate of candidates) {
    try {
      await fetchModels(baseUrl, candidate.key);
      return candidate;
    } catch (err) {
      if (err.code !== "AUTH") throw err;
    }
  }

  onStatus("Requesting a VividCode key from 9Router…");
  const { keys, error } = await getInternalKeys(baseUrl);
  if (keys.length) {
    const preferred =
      keys.find((k) => /vividcode/i.test(k.name || "")) ||
      keys.find((k) => k.isActive !== false) ||
      keys[0];
    if (preferred?.key) {
      try {
        await fetchModels(baseUrl, preferred.key);
        return { key: preferred.key, source: "9router" };
      } catch {
        /* try a fresh key */
      }
    }
  }

  const created = await createInternalKey(baseUrl);
  if (created.key) {
    try {
      await fetchModels(baseUrl, created.key);
      return { key: created.key, source: "created" };
    } catch {
      /* fall through */
    }
  }

  throw new RouterError(
    error
      ? `Could not obtain a 9Router key: ${error}`
      : "Could not obtain a 9Router API key. Set NINE_ROUTER_API_KEY or pass --key.",
    "AUTH"
  );
}

function classifyTargets(models) {
  const byId = new Map(models.map((m) => [m.id.toLowerCase(), m]));
  return TARGETS.map((target) => {
    let match = null;
    for (const id of target.exact) {
      const found = byId.get(id.toLowerCase());
      if (found) {
        match = found;
        break;
      }
    }
    if (!match) match = models.find((m) => target.fuzzy(m)) || null;
    return {
      ...target,
      status: match ? "ready" : "missing",
      model: match ? match.id : "",
      meta: match || null,
    };
  });
}

function readJsonQuiet(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

module.exports = {
  CLINE_API_BASE,
  CLINE_PREFIX,
  CLINE_BEAM,
  TARGETS,
  RouterError,
  sleep,
  fetchJson,
  originOf,
  isLocal,
  dataDir,
  readCliToken,
  loadInternalClient,
  internalRequest,
  checkHealth,
  find9RouterCommand,
  startServer,
  waitForServer,
  ensureServer,
  fetchModels,
  decorateModel,
  getInternalKeys,
  createInternalKey,
  resolveApiKey,
  classifyTargets,
  readJsonQuiet,
};
