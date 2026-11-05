"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");
const ui = require("./ui");
const { load, save, normalizeBaseUrl, configPath, maskKey } = require("./config");
const { setup } = require("./importer");
const { selectModel } = require("./selector");
const { startRepl, printModelList } = require("./repl");
const {
  RouterError,
  find9RouterCommand,
  dataDir,
  isLocal,
} = require("./router");
const { readClineCredentials, scanLocalCatalogs, probeCline } = require("./importer");

function version() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).version;
  } catch {
    return "1.0.0";
  }
}

function parseArgs(argv) {
  const args = {
    prompt: [],
    help: false,
    version: false,
    setup: false,
    doctor: false,
    models: false,
    noSelect: false,
    noStart: false,
    noTools: false,
    forceTools: false,
    noCline: false,
    noAnim: false,
    yolo: false,
    think: false,
    model: "",
    url: "",
    key: "",
  };

  const takesValue = new Set(["--model", "--url", "--key", "--cwd"]);
  for (let i = 0; i < argv.length; i += 1) {
    let token = argv[i];
    if (token === "-h" || token === "--help") args.help = true;
    else if (token === "-v" || token === "--version") args.version = true;
    else if (token === "--setup") args.setup = true;
    else if (token === "--doctor") args.doctor = true;
    else if (token === "--models" || token === "--list") args.models = true;
    else if (token === "--no-select") args.noSelect = true;
    else if (token === "--no-start") args.noStart = true;
    else if (token === "--no-tools") args.noTools = true;
    else if (token === "--tools") args.forceTools = true;
    else if (token === "--no-cline" || token === "--no-cline-import") args.noCline = true;
    else if (token === "--no-anim" || token === "--fast") args.noAnim = true;
    else if (token === "--yolo" || token === "--yes") args.yolo = true;
    else if (token === "--think") args.think = true;
    else if (takesValue.has(token)) {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`Missing value for ${token}`);
      args[token.slice(2)] = value;
      i += 1;
    } else if (token.startsWith("--") && token.includes("=")) {
      const idx = token.indexOf("=");
      const name = token.slice(0, idx);
      const value = token.slice(idx + 1);
      if (!takesValue.has(name)) throw new Error(`Unknown option ${name}`);
      args[name.slice(2)] = value;
    } else if (token.startsWith("-")) {
      throw new Error(`Unknown option ${token}`);
    } else {
      args.prompt.push(token);
    }
  }
  return args;
}

function printHelp() {
  console.log(ui.banner());
  const lines = [
    `${ui.paint("usage", ui.PALETTE.dim)}      vividcode [prompt] [options]`,
    "",
    `${ui.paint("options", ui.PALETTE.cyan)}`,
    `  ${ui.paint("--setup", ui.PALETTE.ice)}             run 9Router auto-setup and exit`,
    `  ${ui.paint("--doctor", ui.PALETTE.ice)}            print a diagnostic report`,
    `  ${ui.paint("--models", ui.PALETTE.ice)}            list 9Router models`,
    `  ${ui.paint("--model <id>", ui.PALETTE.ice)}        start with a specific model`,
    `  ${ui.paint("--cwd <path>", ui.PALETTE.ice)}        workspace directory for the agent`,
    `  ${ui.paint("--url <base>", ui.PALETTE.ice)}        override 9Router base URL (default localhost:20128)`,
    `  ${ui.paint("--key <key>", ui.PALETTE.ice)}         override 9Router API key`,
    `  ${ui.paint("--no-start", ui.PALETTE.ice)}          do not auto-start 9Router`,
    `  ${ui.paint("--no-cline", ui.PALETTE.ice)}          skip automatic Cline import`,
    `  ${ui.paint("--tools", ui.PALETTE.ice)}             force native tool calling on`,
    `  ${ui.paint("--no-tools", ui.PALETTE.ice)}          disable native tool calling`,
    `  ${ui.paint("--yolo", ui.PALETTE.ice)}              auto-approve writes and commands`,
    `  ${ui.paint("--think", ui.PALETTE.ice)}             stream reasoning when available`,
    `  ${ui.paint("--fast", ui.PALETTE.ice)}              disable launch animations`,
    `  ${ui.paint("--version", ui.PALETTE.ice)}           print version`,
    "",
    `${ui.paint("examples", ui.PALETTE.cyan)}`,
    `  ${ui.dim("›")} vividcode`,
    `  ${ui.dim("›")} vividcode "build me a neon portfolio"`,
    `  ${ui.dim("›")} vividcode --model oc/deepseek-v4.1-flash-free "explain this repo"`,
    `  ${ui.dim("›")} vividcode --setup`,
  ];
  console.log(ui.box("VIVIDCODE · HELP", lines, { titleStops: ui.AURORA }));
  console.log("");
  console.log(ui.dim(`  v${version()} · built for 9Router · MIT`));
  console.log("");
}

function mark(status) {
  return status === "ready" ? ui.paint("✓", ui.PALETTE.lime) : ui.paint("○", ui.PALETTE.amber);
}

function printSetupReport(cfg, report) {
  const server = report.server || {};
  const lines = [
    `${ui.paint("endpoint", ui.PALETTE.dim)}     ${ui.paint(cfg.baseUrl, ui.PALETTE.cyan)}  ${ui.dot(server.online === false ? ui.PALETTE.red : ui.PALETTE.lime)} ${ui.dim(server.started ? "online · launched" : "online")}`,
    `${ui.paint("api key", ui.PALETTE.dim)}      ${ui.paint(maskKey(cfg.apiKey), ui.PALETTE.ice)}  ${ui.dim(`· ${report.apiKey?.source || "config"}`)}`,
    `${ui.paint("models", ui.PALETTE.dim)}       ${ui.paint(String(report.models.length), ui.PALETTE.mint)} live  ${ui.dim("· 9router gateway")}`,
    `${ui.paint("imported", ui.PALETTE.dim)}     ${ui.paint(`${report.ready.length}/${report.targets.length}`, report.missing.length ? ui.PALETTE.amber : ui.PALETTE.lime)} requested models`,
  ];
  console.log("");
  console.log(ui.box("AUTOMATIC 9ROUTER SETUP", lines, { titleStops: ui.NEON }));

  const targetLines = report.targets.map((target) => {
    const value =
      target.status === "ready"
        ? ui.paint(target.model, ui.PALETTE.ice)
        : ui.dim("not served yet");
    return `${mark(target.status)} ${ui.padEnd(target.name, 20)} ${ui.padEnd(ui.paint(target.source, ui.PALETTE.magenta), 26)} ${value}`;
  });

  const notes = [];
  if (report.clineImport?.status === "imported") {
    notes.push(ui.success("Cline linked automatically into 9Router."));
  } else if (report.clineImport?.status === "no-credentials") {
    notes.push(ui.warn("Cline session not found — open Cline once, or connect Cline in 9Router."));
  } else if (report.clineImport?.status === "expired") {
    notes.push(ui.warn("Cline session expired — run `cline auth cline`, then /import."));
  } else if (report.clineImport?.status === "unauthorized") {
    notes.push(ui.warn("Cline rejected its stored session — run `cline auth cline`, then /import."));
  } else if (report.clineImport?.status === "unusable") {
    notes.push(ui.warn(`Cline session is not usable: ${report.clineImport.detail || "unknown error"}`));
  } else if (report.clineImport?.status === "pending") {
    notes.push(ui.warn("Cline was added; 9Router is still discovering its models."));
  } else if (report.clineImport?.status === "node-failed" || report.clineImport?.status === "connection-failed") {
    notes.push(ui.warn(`Cline import failed: ${report.clineImport.detail || "unknown error"}`));
  }
  if (report.missing.length && !notes.length) {
    const missing = report.missing.map((t) => t.source).join(", ");
    notes.push(ui.warn(`Still missing: ${missing}. Connect those providers in the 9Router dashboard.`));
  }

  console.log("");
  console.log(ui.box("AUTO-IMPORT · BEAM + DEEPSEEK", [...targetLines, ...(notes.length ? ["", ...notes] : [])], {
    titleStops: ui.FIRE,
  }));
  console.log("");
  console.log(`  ${ui.dim("config")} ${ui.paint(configPath(), ui.PALETTE.dim)}`);
}

function printTroubleshooting(cfg, err) {
  console.log("");
  console.log(ui.error(err.message));
  console.log("");
  const lines = [];
  if (err.code === "OFFLINE") {
    lines.push(`${ui.paint("1.", ui.PALETTE.cyan)} install 9Router:  ${ui.paint("npm i -g 9router", ui.PALETTE.ice)}`);
    lines.push(`${ui.paint("2.", ui.PALETTE.cyan)} start it:          ${ui.paint("9router --no-browser", ui.PALETTE.ice)}`);
    lines.push(`${ui.paint("3.", ui.PALETTE.cyan)} open the dashboard: ${ui.paint("http://localhost:20128", ui.PALETTE.ice)}`);
    lines.push(`${ui.paint("4.", ui.PALETTE.cyan)} rerun:             ${ui.paint("VividCode.bat", ui.PALETTE.ice)}`);
    lines.push("");
    lines.push(ui.dim("Already running elsewhere? use --url http://host:20128"));
  } else if (err.code === "AUTH") {
    lines.push(`${ui.paint("1.", ui.PALETTE.cyan)} open ${ui.paint("http://localhost:20128", ui.PALETTE.ice)} → API Keys`);
    lines.push(`${ui.paint("2.", ui.PALETTE.cyan)} copy a key and run ${ui.paint("set NINE_ROUTER_API_KEY=...", ui.PALETTE.ice)}`);
    lines.push(`${ui.paint("3.", ui.PALETTE.cyan)} or run ${ui.paint("vividcode --key <key>", ui.PALETTE.ice)}`);
  } else {
    lines.push(`${ui.dim("Run with VIVIDCODE_DEBUG=1 for a stack trace.")}`);
  }
  console.log(ui.box("LINK FAILED", lines, { titleStops: ui.FIRE }));
  console.log("");
  console.log(ui.dim(`  target: ${cfg.baseUrl}`));
  console.log("");
}

async function printDoctor(cfg, report) {
  let cmd = "not found";
  try {
    cmd = find9RouterCommand();
  } catch {
    /* ignore */
  }
  let npmRoot = "unknown";
  try {
    npmRoot = execSync("npm root -g", { encoding: "utf8", windowsHide: true }).trim();
  } catch {
    /* ignore */
  }
  let cwd = "";
  try {
    cwd = process.cwd();
  } catch {
    /* ignore */
  }
  const creds = readClineCredentials();
  let clineProbe = "not checked";
  if (creds && creds.expired) {
    clineProbe = "run `cline auth cline`";
  } else if (creds) {
    const probe = await probeCline(creds);
    clineProbe = probe.ok ? `ok · ${probe.models.length} models` : `failed${probe.error ? ` · ${probe.error}` : ""}`;
  }
  const hints = scanLocalCatalogs().filter((id) => /beam|deepseek-v4\.1-flash/i.test(id));

  const lines = [
    `${ui.paint("node", ui.PALETTE.dim)}          ${process.version}`,
    `${ui.paint("platform", ui.PALETTE.dim)}      ${process.platform} ${process.arch}`,
    `${ui.paint("cwd", ui.PALETTE.dim)}           ${cwd}`,
    `${ui.paint("config", ui.PALETTE.dim)}        ${configPath()}`,
    `${ui.paint("9router bin", ui.PALETTE.dim)}   ${cmd}`,
    `${ui.paint("9router data", ui.PALETTE.dim)}  ${dataDir()}`,
    `${ui.paint("npm root", ui.PALETTE.dim)}      ${npmRoot}`,
    `${ui.paint("endpoint", ui.PALETTE.dim)}      ${cfg.baseUrl}${isLocal(cfg.baseUrl) ? " (local)" : " (remote)"}`,
    `${ui.paint("api key", ui.PALETTE.dim)}       ${maskKey(cfg.apiKey)}`,
    `${ui.paint("live models", ui.PALETTE.dim)}   ${(report?.models || []).length}`,
    `${ui.paint("model", ui.PALETTE.dim)}         ${cfg.model || "(none)"}`,
    `${ui.paint("cline creds", ui.PALETTE.dim)}   ${creds ? `${creds.expired ? "expired" : "found"} · ${clineProbe}` : "not found"}`,
    `${ui.paint("local hints", ui.PALETTE.dim)}   ${hints.length ? ui.truncate(hints.slice(0, 5).join(", "), 64) : "none"}`,
    "",
    `${ui.paint("targets", ui.PALETTE.cyan)}`,
    ...(report?.targets || []).map(
      (t) => `${mark(t.status)} ${ui.padEnd(t.name, 20)} ${ui.padEnd(t.source, 16)} ${t.status === "ready" ? t.model : ui.dim("missing")}`
    ),
  ];
  console.log("");
  console.log(ui.box("VIVIDCODE · DOCTOR", lines, { titleStops: ui.AURORA }));
  console.log("");
}

async function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.log("");
    console.log(ui.error(err.message));
    console.log(ui.dim("  run `vividcode --help` for usage"));
    console.log("");
    process.exitCode = 1;
    return;
  }
  if (args.noAnim) process.env.VIVIDCODE_FAST = "1";
  if (args.cwd) {
    try {
      process.chdir(path.resolve(args.cwd));
    } catch (err) {
      console.log("");
      console.log(ui.error(`Cannot enter workspace: ${err.message}`));
      console.log("");
      process.exitCode = 1;
      return;
    }
  }
  if (args.help) {
    printHelp();
    return;
  }
  if (args.version) {
    console.log(`VividCode ${version()}`);
    return;
  }

  const cfg = load();
  if (args.url) cfg.baseUrl = normalizeBaseUrl(args.url);
  if (args.key) cfg.apiKey = args.key;
  if (args.noStart) cfg.autoStart = false;
  if (args.yolo) cfg.yolo = true;
  if (args.think) cfg.thinking = true;
  if (args.noTools) cfg.tools = false;
  if (args.forceTools) cfg.tools = true;

  if (!args.noAnim && process.stdout.isTTY) console.log(ui.banner());
  else console.log(`\n  ${ui.gradient("VIVIDCODE", ui.NEON)} ${ui.dim("· 9router neon vibe cli")}\n`);

  const spinner = new ui.Spinner("Waking the neon gateway…").start();
  let report;
  try {
    report = await setup(cfg, {
      onStatus: (text) => spinner.setText(text),
      autoStart: cfg.autoStart !== false,
      importCline: !args.noCline,
      persist: true,
    });
    spinner.stop(ui.success("9Router linked"));
  } catch (err) {
    spinner.stop(ui.error("9Router link failed"));
    printTroubleshooting(cfg, err);
    process.exitCode = 1;
    return;
  }

  printSetupReport(cfg, report);

  if (args.setup) {
    console.log(`  ${ui.success("setup complete")}`);
    console.log("");
    return;
  }
  if (args.doctor) {
    await printDoctor(cfg, report);
    return;
  }
  if (args.models) {
    printModelList(report);
    return;
  }

  if (args.model) {
    if (!report.models.some((m) => m.id === args.model)) {
      console.log("");
      console.log(ui.warn(`Model "${args.model}" is not in the live gateway; falling back.`));
    } else {
      cfg.model = args.model;
    }
  }

  if (!args.model && !args.noSelect && !args.prompt.length && process.stdin.isTTY) {
    const picked = await selectModel(report.models, {
      targets: report.targets,
      current: cfg.model,
    });
    if (picked) cfg.model = picked.id;
    save(cfg);
  }

  if (!cfg.model && report.defaultModel) cfg.model = report.defaultModel;
  if (!cfg.model) {
    console.log(ui.error("No models are available from 9Router."));
    console.log(ui.dim("  Connect at least one provider in the dashboard: http://localhost:20128"));
    process.exitCode = 1;
    return;
  }
  save(cfg);

  await startRepl({
    cfg,
    report,
    args: {
      oneShot: args.prompt.length > 0,
      prompt: args.prompt,
    },
  });
}

module.exports = { main, parseArgs, version };
