"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { save } = require("./config");
const {
  CLINE_API_BASE,
  CLINE_PREFIX,
  CLINE_BEAM,
  RouterError,
  sleep,
  fetchJson,
  ensureServer,
  resolveApiKey,
  fetchModels,
  classifyTargets,
  internalRequest,
  readJsonQuiet,
} = require("./router");

function stripJsonc(text) {
  let out = "";
  let inString = false;
  let escaped = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inLine) {
      if (ch === "\n") {
        inLine = false;
        out += ch;
      }
      continue;
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLine = true;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlock = true;
      i += 1;
      continue;
    }
    out += ch;
  }
  return out.replace(/,\s*([}\]])/g, "$1");
}

function readOpencodeIds() {
  const files = [
    path.join(os.homedir(), ".config", "opencode", "opencode.jsonc"),
    path.join(os.homedir(), ".config", "opencode", "opencode.json"),
  ];
  const ids = [];
  for (const file of files) {
    let raw = "";
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    let parsed = null;
    try {
      parsed = JSON.parse(file.endsWith(".jsonc") ? stripJsonc(raw) : raw);
    } catch {
      continue;
    }
    for (const provider of Object.values(parsed?.provider || {})) {
      for (const id of Object.keys(provider?.models || {})) ids.push(id);
    }
  }
  return ids;
}

function scanLocalCatalogs() {
  const ids = new Set();
  const add = (value) => {
    if (typeof value === "string" && value.trim()) ids.add(value.trim());
  };

  const clineModels = readJsonQuiet(
    path.join(os.homedir(), ".cline", "data", "settings", "models.json")
  );
  if (clineModels?.providers) {
    for (const provider of Object.values(clineModels.providers)) {
      for (const id of Object.keys(provider.models || {})) add(id);
      for (const id of provider.discoveredModelIds || []) add(id);
    }
  }
  for (const id of readOpencodeIds()) add(id);
  return [...ids];
}

function readClineCredentials() {
  const candidates = [
    path.join(os.homedir(), ".cline", "data", "secrets.json"),
    process.env.APPDATA
      ? path.join(process.env.APPDATA, "cline", "data", "secrets.json")
      : "",
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "cline", "data", "secrets.json")
      : "",
  ].filter(Boolean);

  for (const file of candidates) {
    const secrets = readJsonQuiet(file);
    if (!secrets) continue;
    const value = secrets["cline:clineAccountId"];
    if (!value) continue;
    let payload = value;
    if (typeof value === "string" && value.trim().startsWith("{")) {
      try {
        payload = JSON.parse(value);
      } catch {
        payload = null;
      }
    }
    const token = payload?.idToken || payload?.accessToken || payload?.token;
    if (!token) continue;
    const expiresRaw = Number(payload?.expiresAt || 0);
    const expiresAt = expiresRaw > 1e12 ? expiresRaw : expiresRaw * 1000;
    return {
      token,
      refreshToken: payload?.refreshToken || "",
      expiresAt,
      expired: Boolean(expiresAt && expiresAt < Date.now() + 60000),
      source: file,
    };
  }
  return null;
}

async function refreshCline(creds) {
  if (!creds.refreshToken) return { ok: false, error: "No Cline refresh token found." };
  try {
    const res = await fetchJson(`${CLINE_API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: { refreshToken: creds.refreshToken, grantType: "refresh_token" },
      timeout: 30000,
    });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: res.data?.error?.message || res.data?.message || `Cline refresh failed (HTTP ${res.status}).`,
      };
    }
    const data = res.data?.data || res.data;
    if (!data?.accessToken) return { ok: false, error: "Cline refresh response did not include an access token." };
    const expiresRaw = Number(data.expiresAt || 0);
    const expiresAt = expiresRaw > 1e12 ? expiresRaw : expiresRaw * 1000;
    return {
      ok: true,
      token: data.accessToken,
      refreshToken: data.refreshToken || creds.refreshToken,
      expiresAt,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function probeClineChat(token) {
  try {
    const res = await fetchJson(`${CLINE_API_BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: {
        model: CLINE_BEAM,
        messages: [{ role: "user", content: "ping" }],
        stream: false,
        max_tokens: 8,
      },
      timeout: 30000,
    });
    if (res.ok) return { ok: true, status: res.status };
    return {
      ok: false,
      status: res.status,
      error: res.data?.error?.message || res.data?.message || `Cline chat returned HTTP ${res.status}.`,
    };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
}

async function deactivateCline(baseUrl) {
  const providersRes = await internalRequest(baseUrl, "/api/providers", "GET");
  if (!providersRes.success) return false;
  const connections = providersRes.data?.connections || [];
  const mine = connections.find((c) => c.name === "Cline (VividCode)");
  if (!mine) return false;
  const res = await internalRequest(baseUrl, `/api/providers/${mine.id}`, "PUT", {
    isActive: false,
  });
  return Boolean(res.success);
}

async function probeCline(creds) {
  try {
    const res = await fetchJson(`${CLINE_API_BASE}/models`, {
      headers: { Authorization: `Bearer ${creds.token}` },
      timeout: 15000,
    });
    if (!res.ok) return { ok: false, status: res.status, models: [] };
    const ids = (res.data?.data || []).map((m) => m.id);
    return { ok: true, status: res.status, models: ids };
  } catch (err) {
    return { ok: false, status: 0, models: [], error: err.message };
  }
}

async function importCline(baseUrl, options = {}) {
  const { onStatus = () => {} } = options;
  const creds = readClineCredentials();
  if (!creds) return { status: "no-credentials" };

  let token = creds.token;
  let refreshed = false;
  if (creds.expired) {
    onStatus("Refreshing Cline session…");
    const refresh = await refreshCline(creds);
    if (!refresh.ok) {
      await deactivateCline(baseUrl);
      return {
        status: "expired",
        detail: refresh.error || "Cline session expired. Re-authenticate with: cline auth cline",
      };
    }
    token = refresh.token;
    refreshed = true;
  }

  onStatus("Verifying Cline session…");
  const chatProbe = await probeClineChat(token);
  if (!chatProbe.ok) {
    await deactivateCline(baseUrl);
    const unauthorized = chatProbe.status === 401 || chatProbe.status === 403;
    return {
      status: unauthorized ? "unauthorized" : "unusable",
      detail: unauthorized
        ? "Cline rejected the stored session. Re-authenticate with: cline auth cline"
        : chatProbe.error,
    };
  }

  onStatus("Reading Cline catalog…");
  const probe = await probeCline({ token });
  if (!probe.ok) {
    return {
      status: "unauthorized",
      detail: probe.error || `Cline API returned ${probe.status}.`,
    };
  }
  if (!probe.models.includes(CLINE_BEAM)) {
    return { status: "no-beam", detail: `Cline exposes ${probe.models.length} models, but not ${CLINE_BEAM}.` };
  }

  onStatus("Importing Cline into 9Router…");
  const nodesRes = await internalRequest(baseUrl, "/api/provider-nodes", "GET");
  let node = null;
  if (nodesRes.success) {
    const nodes = nodesRes.data?.nodes || nodesRes.data || [];
    node = nodes.find((n) => n.prefix === CLINE_PREFIX) || null;
    const legacy = nodes.find((n) => n.prefix === "cline");
    if (!node && legacy) {
      onStatus("Migrating Cline provider prefix…");
      const migrated = await internalRequest(baseUrl, `/api/provider-nodes/${legacy.id}`, "PUT", {
        name: "Cline",
        prefix: CLINE_PREFIX,
        baseUrl: CLINE_API_BASE,
        type: "openai-compatible",
        apiType: "chat",
      });
      if (migrated.success) {
        node = migrated.data?.node || { ...legacy, prefix: CLINE_PREFIX };
      }
    }
  }

  if (!node) {
    const created = await internalRequest(baseUrl, "/api/provider-nodes", "POST", {
      name: "Cline",
      prefix: CLINE_PREFIX,
      baseUrl: CLINE_API_BASE,
      type: "openai-compatible",
      apiType: "chat",
    });
    // Unique prefix avoids colliding with 9Router's built-in "cline" alias.
    if (!created.success) {
      return { status: "node-failed", detail: created.error };
    }
    node = created.data?.node || created.data;
  }
  if (!node || !node.id) return { status: "node-failed", detail: "9Router did not return a node id." };

  const providersRes = await internalRequest(baseUrl, "/api/providers", "GET");
  const connections = providersRes.success
    ? providersRes.data?.connections || []
    : [];
  let connection = connections.find((c) => c.provider === node.id) || null;

  if (connection) {
    const updated = await internalRequest(baseUrl, `/api/providers/${connection.id}`, "PUT", {
      apiKey: token,
      isActive: true,
    });
    if (!updated.success) {
      return { status: "connection-failed", detail: updated.error, node };
    }
    connection = updated.data?.connection || connection;
  } else {
    const conn = await internalRequest(baseUrl, "/api/providers", "POST", {
      provider: node.id,
      name: "Cline (VividCode)",
      apiKey: token,
    });
    if (!conn.success) {
      return { status: "connection-failed", detail: conn.error, node };
    }
    connection = conn.data?.connection || conn.data;
  }

  if (connection?.id) {
    onStatus("Testing Cline connection…");
    const test = await internalRequest(baseUrl, `/api/providers/${connection.id}/test`, "POST");
    if (!test.success) {
      return { status: "connection-failed", detail: test.error, node, connection };
    }
  }

  onStatus("Waiting for Cline models…");
  const deadline = Date.now() + 18000;
  while (Date.now() < deadline) {
    const { getInternalKeys } = require("./router");
    const keyInfo = await getInternalKeys(baseUrl);
    const key =
      keyInfo.keys.find((k) => /vividcode/i.test(k.name || ""))?.key ||
      keyInfo.keys.find((k) => k.isActive !== false)?.key ||
      keyInfo.keys[0]?.key;
    if (key) {
      try {
        const models = await fetchModels(baseUrl, key);
        if (models.some((m) => m.id === `${CLINE_PREFIX}/${CLINE_BEAM}`)) {
          return {
            status: "imported",
            node,
            connection,
            refreshed,
            model: `${CLINE_PREFIX}/${CLINE_BEAM}`,
          };
        }
      } catch {
        /* keep polling */
      }
    }
    await sleep(1200);
  }

  return {
    status: "pending",
    node,
    connection,
    refreshed,
    detail: "Cline was added, but 9Router has not listed its models yet.",
  };
}

function chooseDefaultModel(cfg, targets, models) {
  if (cfg.model && models.some((m) => m.id === cfg.model)) return cfg.model;
  const order = ["opencode-deepseek-flash", "kilo-beam-free", "cline-beam"];
  for (const key of order) {
    const target = targets.find((t) => t.key === key && t.status === "ready");
    if (target) return target.model;
  }
  const freeCoder = models.find(
    (m) => m.free && m.tools && /coder|deepseek|beam|glm|qwen|kimi/i.test(m.id)
  );
  if (freeCoder) return freeCoder.id;
  const free = models.find((m) => m.free);
  if (free) return free.id;
  return models[0]?.id || "";
}

async function setup(cfg, options = {}) {
  const {
    onStatus = () => {},
    autoStart = cfg.autoStart !== false,
    importCline: shouldImportCline = true,
    persist = true,
  } = options;

  const server = await ensureServer(cfg.baseUrl, { autoStart, onStatus });
  if (!server.online) {
    throw new RouterError(
      server.error || `9Router is not reachable at ${cfg.baseUrl}.`,
      "OFFLINE"
    );
  }

  const keyInfo = await resolveApiKey(cfg, { onStatus });
  cfg.apiKey = keyInfo.key;

  onStatus("Scanning 9Router model gateway…");
  let models = await fetchModels(cfg.baseUrl, keyInfo.key);
  let targets = classifyTargets(models);

  let clineImport = { status: "skipped" };
  const clineTarget = targets.find((t) => t.key === "cline-beam");
  const shouldTouchCline =
    shouldImportCline &&
    clineTarget &&
    (clineTarget.status !== "ready" || /cline\//i.test(clineTarget.model));
  if (shouldTouchCline) {
    clineImport = await importCline(cfg.baseUrl, { onStatus });
    if (
      ["imported", "pending", "expired", "unauthorized", "unusable", "no-beam"].includes(
        clineImport.status
      )
    ) {
      onStatus("Rescanning model gateway…");
      models = await fetchModels(cfg.baseUrl, keyInfo.key);
      targets = classifyTargets(models);
    }
  } else if (clineTarget && clineTarget.status === "ready") {
    clineImport = { status: "ready", model: clineTarget.model };
  }

  const localHints = scanLocalCatalogs().filter((id) =>
    /beam|deepseek-v4\.1-flash/i.test(id)
  );

  const ready = targets.filter((t) => t.status === "ready");
  const missing = targets.filter((t) => t.status !== "ready");
  const defaultModel = chooseDefaultModel(cfg, targets, models);

  cfg.model = defaultModel;
  cfg.imported = targets.map((target) => ({
    key: target.key,
    name: target.name,
    source: target.source,
    status: target.status,
    model: target.model,
    checkedAt: new Date().toISOString(),
  }));
  cfg.lastImport = {
    at: new Date().toISOString(),
    baseUrl: cfg.baseUrl,
    ready: ready.length,
    total: targets.length,
  };

  if (persist) save(cfg);

  return {
    server,
    apiKey: keyInfo,
    models,
    targets,
    ready,
    missing,
    defaultModel,
    clineImport,
    localHints,
  };
}

module.exports = {
  stripJsonc,
  scanLocalCatalogs,
  readClineCredentials,
  probeCline,
  importCline,
  chooseDefaultModel,
  setup,
};
