"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const APP_NAME = "VividCode";

function configDir() {
  if (process.env.VIVIDCODE_HOME) return process.env.VIVIDCODE_HOME;
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), APP_NAME);
  }
  return path.join(os.homedir(), ".config", "vividcode");
}

function configPath() {
  return path.join(configDir(), "config.json");
}

function defaultBaseUrl() {
  if (process.env.NINE_ROUTER_BASE_URL) return normalizeBaseUrl(process.env.NINE_ROUTER_BASE_URL);
  return "http://localhost:20128/v1";
}

const DEFAULTS = {
  version: 1,
  baseUrl: defaultBaseUrl(),
  apiKey: process.env.NINE_ROUTER_API_KEY || "",
  model: "",
  autoStart: true,
  tools: true,
  thinking: false,
  yolo: false,
  imported: [],
  lastImport: null,
  totalChats: 0,
};

function normalizeBaseUrl(url) {
  let base = String(url || "").trim();
  if (!base) return DEFAULTS.baseUrl;
  base = base.replace(/\/+$/, "");
  if (!/\/v1$/i.test(base) && !/\/api\/v1$/i.test(base)) base += "/v1";
  return base;
}

function ensureDir() {
  fs.mkdirSync(configDir(), { recursive: true });
}

function load() {
  const file = configPath();
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    data = {};
  }
  const cfg = { ...DEFAULTS, ...data };
  cfg.baseUrl = normalizeBaseUrl(cfg.baseUrl);
  if (process.env.NINE_ROUTER_API_KEY) cfg.apiKey = process.env.NINE_ROUTER_API_KEY;
  return cfg;
}

function save(cfg) {
  ensureDir();
  const file = configPath();
  const tmp = `${file}.${process.pid}.tmp`;
  const data = { ...cfg, version: 1 };
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* best effort on Windows */
  }
  return file;
}

function maskKey(key) {
  if (!key) return "(none)";
  const s = String(key);
  if (s.length <= 8) return "••••";
  return `${s.slice(0, 5)}…${s.slice(-4)}`;
}

function machineIdPath() {
  const dir =
    process.env.DATA_DIR ||
    (process.platform === "win32"
      ? path.join(process.env.APPDATA || "", "9router")
      : path.join(os.homedir(), ".9router"));
  return path.join(dir, "machine-id");
}

module.exports = {
  APP_NAME,
  DEFAULTS,
  configDir,
  configPath,
  load,
  save,
  normalizeBaseUrl,
  maskKey,
  machineIdPath,
};
