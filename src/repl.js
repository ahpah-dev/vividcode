"use strict";

const readline = require("node:readline");
const fs = require("node:fs");
const path = require("node:path");
const ui = require("./ui");
const { Session } = require("./chat");
const agent = require("./agent");
const { selectModel } = require("./selector");
const { setup } = require("./importer");
const { save, maskKey } = require("./config");

function printHeader(cfg, report) {
  const model = (report?.models || []).find((m) => m.id === cfg.model);
  const target = (report?.targets || []).find((t) => t.status === "ready" && t.model === cfg.model);
  const ctx = model?.context ? `${Math.round(model.context / 1000)}K ctx` : "ctx ?";
  const bits = [
    model?.free ? ui.paint("FREE", ui.PALETTE.lime) : ui.paint("PAID", ui.PALETTE.amber),
    cfg.tools
      ? ui.paint(model?.tools === false ? "tools (model may reject)" : "tools", ui.PALETTE.mint)
      : ui.paint("tools off", ui.PALETTE.red),
    ui.dim(ctx),
  ];
  if (target) bits.unshift(ui.paint(`${target.source} · ${target.name}`, ui.PALETTE.ice));
  const lines = [
    `${ui.paint("link", ui.PALETTE.dim)}     ${ui.paint(cfg.baseUrl, ui.PALETTE.cyan)}`,
    `${ui.paint("model", ui.PALETTE.dim)}    ${ui.paint(cfg.model || "(none)", ui.PALETTE.ice)}`,
    `${ui.paint("signal", ui.PALETTE.dim)}   ${bits.join(ui.dim("  ·  "))}`,
    `${ui.paint("mode", ui.PALETTE.dim)}     ${ui.paint(cfg.yolo ? "YOLO" : "guarded", cfg.yolo ? ui.PALETTE.red : ui.PALETTE.lime)} ${ui.dim("· /help for commands")}`,
  ];
  console.log("");
  console.log(ui.box("VIVIDCODE × 9ROUTER", lines, { titleStops: ui.AURORA }));
}

function printStatus(cfg, report, session) {
  const lines = [
    `${ui.paint("endpoint", ui.PALETTE.dim)}      ${cfg.baseUrl}  ${ui.dot()}`,
    `${ui.paint("api key", ui.PALETTE.dim)}       ${maskKey(cfg.apiKey)}`,
    `${ui.paint("model", ui.PALETTE.dim)}         ${cfg.model || "(none)"}`,
    `${ui.paint("live models", ui.PALETTE.dim)}   ${(report?.models || []).length}`,
    `${ui.paint("tools", ui.PALETTE.dim)}         ${cfg.tools ? "on" : "off"}`,
    `${ui.paint("thinking", ui.PALETTE.dim)}      ${cfg.thinking ? "shown" : "hidden"}`,
    `${ui.paint("auto-approve", ui.PALETTE.dim)}  ${cfg.yolo ? "on" : "off"}`,
    `${ui.paint("history", ui.PALETTE.dim)}       ${session.messages.length} messages  ·  ~${Math.round(session.messages.reduce((s, m) => s + String(m.content || "").length, 0) / 4)} tokens`,
    `${ui.paint("config", ui.PALETTE.dim)}        ${require("./config").configPath()}`,
  ];
  console.log("");
  console.log(ui.box("SYSTEM STATUS", lines, { titleStops: ui.NEON }));
}

function printHelp() {
  const lines = [
    `${ui.paint("/model", ui.PALETTE.cyan)}          open the neon model selector`,
    `${ui.paint("/models [q]", ui.PALETTE.cyan)}     list 9Router models`,
    `${ui.paint("/setup", ui.PALETTE.cyan)}          re-run 9Router auto-import`,
    `${ui.paint("/import", ui.PALETTE.cyan)}         re-import Cline + models`,
    `${ui.paint("/status", ui.PALETTE.cyan)}         show link, key, model and mode`,
    `${ui.paint("/files [path]", ui.PALETTE.cyan)}   list workspace files`,
    `${ui.paint("/add <path>", ui.PALETTE.cyan)}     add a file to the session context`,
    `${ui.paint("/apply <path>", ui.PALETTE.cyan)}   write the last code block to a file`,
    `${ui.paint("/run <cmd>", ui.PALETTE.cyan)}      run a shell command (confirmed)`,
    `${ui.paint("/new", ui.PALETTE.cyan)}            start a fresh conversation`,
    `${ui.paint("/clear", ui.PALETTE.cyan)}          clear the screen`,
    `${ui.paint("/tools", ui.PALETTE.cyan)}          toggle native tool calling`,
    `${ui.paint("/think", ui.PALETTE.cyan)}          toggle reasoning stream`,
    `${ui.paint("/yolo", ui.PALETTE.cyan)}           toggle auto-approve`,
    `${ui.paint("/exit", ui.PALETTE.cyan)}           leave the vibe`,
    "",
    ui.dim("Mention files with @path/to/file in your prompt to load them."),
  ];
  console.log("");
  console.log(ui.box("COMMANDS", lines, { titleStops: ui.AURORA }));
}

function printModelList(report, query = "") {
  const q = query.toLowerCase();
  const models = (report?.models || []).filter(
    (m) => !q || `${m.id} ${m.provider} ${m.free ? "free" : ""}`.toLowerCase().includes(q)
  );
  const lines = [];
  for (const target of report?.targets || []) {
    const mark = target.status === "ready" ? ui.paint("✓", ui.PALETTE.lime) : ui.paint("○", ui.PALETTE.amber);
    const value = target.status === "ready" ? ui.paint(target.model, ui.PALETTE.ice) : ui.dim("not served yet");
    lines.push(`${mark} ${ui.padEnd(target.name, 20)} ${ui.padEnd(ui.paint(target.source, ui.PALETTE.magenta), 26)} ${value}`);
  }
  lines.push("");
  const rest = models.filter((m) => !(report?.targets || []).some((t) => t.model === m.id));
  for (const m of rest.slice(0, 45)) {
    lines.push(`  ${ui.paint(m.id, m.free ? ui.PALETTE.ice : ui.PALETTE.white)}${m.free ? ui.dim("  free") : ""}`);
  }
  if (rest.length > 45) lines.push(ui.dim(`  … ${rest.length - 45} more`));
  lines.push("");
  lines.push(ui.dim("run /model to open the interactive selector"));
  console.log("");
  console.log(ui.box("MODEL GATEWAY", lines, { titleStops: ui.NEON }));
}

function lastCodeBlock(text) {
  const re = /```[^\n]*\n([\s\S]*?)```/g;
  let match;
  let last = null;
  while ((match = re.exec(text || "")) !== null) last = match[1];
  return last;
}

function extractFileMentions(text) {
  const paths = [];
  const re = /(?:^|\s)@([^\s]+)/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    paths.push(match[1].replace(/^["']|["']$/g, ""));
  }
  return [...new Set(paths)];
}

function buildFileContext(paths) {
  const chunks = [];
  for (const p of paths) {
    try {
      const content = agent.readFile(p);
      chunks.push(`### ${p}\n\`\`\`\n${content}\n\`\`\``);
    } catch (err) {
      chunks.push(`### ${p}\n(could not read: ${err.message})`);
    }
  }
  return chunks.join("\n\n");
}

function summarizeOutput(output) {
  const text = String(output || "").trim();
  if (!text) return "(empty)";
  const lines = text.split(/\r?\n/);
  if (lines.length === 1 && text.length <= 100) return text;
  return `${lines.length} lines · ${text.length} chars`;
}

async function startRepl(options) {
  const { cfg, report, args } = options;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    historySize: 200,
  });

  let closed = false;
  let pendingResolve = null;
  const ask = (question) =>
    new Promise((resolve) => {
      if (closed) return resolve(null);
      pendingResolve = resolve;
      rl.question(question, (answer) => {
        pendingResolve = null;
        resolve(answer);
      });
    });

  let spinner = null;
  let busy = false;

  const stopSpinner = () => {
    if (spinner) {
      spinner.stop();
      spinner = null;
    }
  };
  const ensureSpinner = (text = "vibing…") => {
    if (!spinner) spinner = new ui.Spinner(text).start();
    return spinner;
  };

  const confirm = async (req) => {
    stopSpinner();
    if (cfg.yolo) return true;
    if (!process.stdin.isTTY) {
      console.log(ui.warn("Non-interactive session: write/command blocked. Re-run with --yolo to allow."));
      return false;
    }
    if (req.kind === "write") {
      console.log("");
      console.log(`  ${ui.paint("✎ write", ui.PALETTE.amber)} ${ui.paint(req.path, ui.PALETTE.ice)} ${ui.dim(`(${req.bytes} bytes)`)}`);
      if (req.preview) {
        for (const line of req.preview.split("\n").slice(0, 8)) {
          console.log(`    ${ui.dim(line)}`);
        }
      }
      const answer = await ask(`  ${ui.paint("apply this write?", ui.PALETTE.amber)} ${ui.dim("[y/N/a=always]")} `);
      const a = String(answer || "").trim().toLowerCase();
      if (a === "a" || a === "always") {
        cfg.yolo = true;
        save(cfg);
        return true;
      }
      return a === "y" || a === "yes";
    }
    if (req.kind === "run") {
      console.log("");
      console.log(`  ${ui.paint("$", ui.PALETTE.magenta)} ${ui.paint(req.command, ui.PALETTE.ice)}`);
      const answer = await ask(`  ${ui.paint("run this command?", ui.PALETTE.amber)} ${ui.dim("[y/N/a=always]")} `);
      const a = String(answer || "").trim().toLowerCase();
      if (a === "a" || a === "always") {
        cfg.yolo = true;
        save(cfg);
        return true;
      }
      return a === "y" || a === "yes";
    }
    return true;
  };

  const session = new Session({
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    model: cfg.model,
    tools: cfg.tools,
    thinking: cfg.thinking,
    yolo: cfg.yolo,
    confirm,
    onText: (chunk) => {
      stopSpinner();
      process.stdout.write(chunk);
    },
    onReasoning: (chunk) => {
      stopSpinner();
      process.stdout.write(ui.dim(chunk));
    },
    onTool: (name, toolArgs) => {
      stopSpinner();
      const detail =
        toolArgs.path || toolArgs.command || toolArgs.pattern || toolArgs.query || `${Object.keys(toolArgs).length} args`;
      console.log("");
      console.log(`  ${ui.paint("⚡", ui.PALETTE.magenta)} ${ui.paint(name, ui.PALETTE.cyan)} ${ui.dim(String(detail).slice(0, 100))}`);
    },
    onToolResult: (name, output) => {
      console.log(`  ${ui.paint("└", ui.PALETTE.purple)} ${ui.dim(summarizeOutput(output))}`);
    },
    onNote: (note) => {
      stopSpinner();
      console.log("");
      console.log(`  ${ui.warn(note)}`);
    },
  });

  const prompt = () => {
    const name = cfg.model ? cfg.model.replace(/^.*\//, "") : "vivid";
    return `\n  ${ui.gradient("◈", ui.NEON)} ${ui.paint("vivid", ui.PALETTE.ice)} ${ui.dim(`[${name}]`)} ${ui.paint("▸", ui.PALETTE.magenta)} `;
  };

  const changeModel = async () => {
    const picked = await selectModel(report.models || [], {
      targets: report.targets || [],
      current: cfg.model,
    });
    if (picked) {
      cfg.model = picked.id;
      session.setModel(cfg.model);
      save(cfg);
      console.log(`\n  ${ui.success(`model → ${ui.paint(cfg.model, ui.PALETTE.ice)}`)}\n`);
      printHeader(cfg, report);
    }
  };

  const refreshImport = async () => {
    const sp = new ui.Spinner("Re-importing models from 9Router…").start();
    try {
      const fresh = await setup(cfg, {
        onStatus: (text) => sp.setText(text),
        importCline: true,
        persist: true,
      });
      sp.stop(ui.success(`gateway synced · ${fresh.ready.length}/${fresh.targets.length} imported targets live`));
      report.models = fresh.models;
      report.targets = fresh.targets;
      if (!fresh.models.some((m) => m.id === cfg.model)) {
        cfg.model = fresh.defaultModel;
        session.setModel(cfg.model);
        save(cfg);
      }
      printHeader(cfg, report);
    } catch (err) {
      sp.stop(ui.error(err.message));
    }
  };

  console.log("");
  if (!args.oneShot) {
    await ui.typeText(`  ${ui.gradient("The neon gate is open.", ui.AURORA)} ${ui.dim("Type a prompt, or /help for commands.")}\n`);
  }
  printHeader(cfg, report);

  rl.on("close", () => {
    closed = true;
    if (pendingResolve) {
      const resolve = pendingResolve;
      pendingResolve = null;
      resolve(null);
    }
  });
  process.on("SIGINT", () => {
    if (busy) {
      session.stop();
      process.stdout.write("\n");
      console.log(ui.warn("interrupted"));
      return;
    }
    console.log(`\n  ${ui.dim("later, vibe coder.")}\n`);
    rl.close();
    process.exit(0);
  });

  const runTurn = async (text) => {
    busy = true;
    ensureSpinner("vibing…");
    let hadOutput = false;
    let hadTools = false;
    const originalOnText = session.onText;
    const originalOnReasoning = session.onReasoning;
    const originalOnTool = session.onTool;
    const originalOnToolResult = session.onToolResult;
    session.onText = (chunk) => {
      hadOutput = true;
      originalOnText(chunk);
    };
    session.onReasoning = (chunk) => {
      hadOutput = true;
      originalOnReasoning(chunk);
    };
    session.onTool = (name, toolArgs) => {
      hadTools = true;
      originalOnTool(name, toolArgs);
    };
    session.onToolResult = (name, output) => {
      hadTools = true;
      originalOnToolResult(name, output);
    };
    try {
      const mentions = extractFileMentions(text);
      if (mentions.length) {
        const context = buildFileContext(mentions);
        if (context) session.addContext(context);
      }
      await session.ask(text.replace(/@([^\s]+)/g, "$1"));
    } catch (err) {
      stopSpinner();
      if (err.name === "AbortError") {
        console.log(ui.warn("interrupted"));
      } else {
        console.log("");
        console.log(ui.error(err.message));
        if (err.status === 401) {
          console.log(ui.dim("  Your 9Router key may be stale. Run /setup to refresh it."));
        }
      }
    } finally {
      stopSpinner();
      if (!hadOutput && !hadTools) process.stdout.write(ui.dim("  (no text returned)"));
      if (hadOutput || hadTools) process.stdout.write("\n");
      busy = false;
    }
  };

  if (args.oneShot) {
    const text = args.prompt.join(" ").trim();
    if (!text) {
      rl.close();
      return;
    }
    await runTurn(text);
    rl.close();
    return;
  }

  while (!closed) {
    const line = await ask(prompt());
    if (line === null || closed) break;
    const text = line.trim();
    if (!text) continue;

    if (text === "/exit" || text === "/quit" || text === ":q") break;
    if (text === "/help" || text === "?") {
      printHelp();
      continue;
    }
    if (text === "/clear") {
      ui.clearScreen();
      console.log(ui.banner());
      printHeader(cfg, report);
      continue;
    }
    if (text === "/new") {
      session.reset();
      console.log(`  ${ui.success("conversation reset")}`);
      continue;
    }
    if (text === "/status") {
      printStatus(cfg, report, session);
      continue;
    }
    if (text === "/model") {
      await changeModel();
      continue;
    }
    if (text.startsWith("/models")) {
      printModelList(report, text.slice(7).trim());
      continue;
    }
    if (text === "/setup" || text === "/import") {
      await refreshImport();
      continue;
    }
    if (text === "/tools") {
      cfg.tools = !cfg.tools;
      session.toolsEnabled = cfg.tools;
      save(cfg);
      console.log(`  ${ui.success(`native tools ${cfg.tools ? "on" : "off"}`)}`);
      continue;
    }
    if (text === "/think") {
      cfg.thinking = !cfg.thinking;
      session.setThinking(cfg.thinking);
      save(cfg);
      console.log(`  ${ui.success(`reasoning stream ${cfg.thinking ? "shown" : "hidden"}`)}`);
      continue;
    }
    if (text === "/yolo") {
      cfg.yolo = !cfg.yolo;
      session.yolo = cfg.yolo;
      save(cfg);
      console.log(`  ${ui.success(`auto-approve ${cfg.yolo ? "on" : "off"}`)}`);
      continue;
    }
    if (text.startsWith("/files")) {
      const rel = text.slice(6).trim() || ".";
      try {
        console.log("");
        console.log(ui.box(`FILES · ${rel}`, agent.listFiles(rel, 3).split("\n").slice(0, 80), { titleStops: ui.AURORA }));
      } catch (err) {
        console.log(ui.error(err.message));
      }
      continue;
    }
    if (text.startsWith("/add ")) {
      const rel = text.slice(5).trim();
      try {
        const content = agent.readFile(rel);
        session.addContext(`### ${rel}\n\`\`\`\n${content}\n\`\`\``);
        console.log(`  ${ui.success(`added ${rel} · ~${Math.round(content.length / 4)} tokens`)}`);
      } catch (err) {
        console.log(ui.error(err.message));
      }
      continue;
    }
    if (text.startsWith("/apply")) {
      const rel = text.slice(6).trim();
      const block = lastCodeBlock(session.lastAssistant);
      if (!block) {
        console.log(ui.warn("No fenced code block in the last response."));
        continue;
      }
      const target = rel || (await ask(`  ${ui.paint("write code block to path:", ui.PALETTE.amber)} `));
      if (!target) continue;
      const ok = await confirm({
        kind: "write",
        path: target,
        bytes: Buffer.byteLength(block),
        preview: block.split("\n").slice(0, 8).join("\n"),
      });
      if (ok) {
        try {
          console.log(`  ${ui.success(agent.writeFile(target, block))}`);
        } catch (err) {
          console.log(ui.error(err.message));
        }
      }
      continue;
    }
    if (text.startsWith("/run ")) {
      const command = text.slice(5).trim();
      const ok = await confirm({ kind: "run", command });
      if (ok) {
        console.log("");
        const sp = new ui.Spinner("running…").start();
        const output = await agent.runCommand(command);
        sp.stop(ui.success("command finished"));
        console.log(output);
      }
      continue;
    }
    if (text.startsWith("/")) {
      console.log(ui.warn(`Unknown command ${text}. Try /help.`));
      continue;
    }

    await runTurn(text);
  }

  rl.close();
  console.log(`\n  ${ui.dim("connection closed · stay vivid.")}\n`);
}

module.exports = {
  startRepl,
  printHeader,
  printHelp,
  printStatus,
  printModelList,
  lastCodeBlock,
};
