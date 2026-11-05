"use strict";

const readline = require("node:readline");
const ui = require("./ui");

function formatContext(n) {
  if (!n) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

function targetFor(model, targets) {
  return (targets || []).find((t) => t.status === "ready" && t.model === model.id) || null;
}

function matches(model, query, target) {
  if (!query) return true;
  const haystack = [
    model.id,
    model.provider,
    target?.name || "",
    target?.source || "",
    model.free ? "free" : "",
  ]
    .join(" ")
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((part) => haystack.includes(part));
}

function buildRows(models, targets, query, currentId) {
  const rows = [];
  const readyTargets = (targets || []).filter((t) => t.status === "ready" && t.model);
  const pinnedIds = new Set(readyTargets.map((t) => t.model));
  const pinned = readyTargets
    .map((t) => models.find((m) => m.id === t.model))
    .filter(Boolean)
    .filter((m) => matches(m, query, targetFor(m, targets)));

  rows.push({ type: "group", label: "IMPORTED FROM YOUR TOOLCHAIN" });
  if (pinned.length) {
    for (const model of pinned) rows.push({ type: "item", model, target: targetFor(model, targets) });
  } else {
    rows.push({ type: "empty", label: "no imported models match" });
  }

  const rest = models
    .filter((m) => !pinnedIds.has(m.id))
    .filter((m) => matches(m, query, null))
    .sort((a, b) => {
      if (a.free !== b.free) return a.free ? -1 : 1;
      return a.id.localeCompare(b.id);
    });

  rows.push({ type: "group", label: `ALL 9ROUTER MODELS  ·  ${rest.length}` });
  for (const model of rest) rows.push({ type: "item", model, target: null });

  let index = rows.findIndex((r) => r.type === "item" && r.model.id === currentId);
  if (index < 0) index = rows.findIndex((r) => r.type === "item");
  if (index < 0) index = 0;
  return { rows, index };
}

function nextItem(rows, index, dir) {
  let i = index;
  for (let guard = 0; guard < rows.length; guard += 1) {
    i += dir;
    if (i < 0) i = rows.length - 1;
    if (i >= rows.length) i = 0;
    if (rows[i].type === "item") return i;
  }
  return index;
}

function render(models, targets, state) {
  const width = Math.max(60, Math.min(process.stdout.columns || 100, 130));
  const height = process.stdout.rows || 30;
  const { rows, index, query } = state;
  const lines = [];
  lines.push("");
  lines.push(`  ${ui.gradient("◈ SELECT YOUR MODEL", ui.NEON)}  ${ui.dim("·  9router model gateway")}`);
  lines.push("");
  const search = query
    ? `${ui.paint("⌕", ui.PALETTE.magenta)} ${ui.paint(query, ui.PALETTE.ice)}${ui.paint("▌", ui.PALETTE.magenta)}`
    : `${ui.dim("⌕ type to filter  ·  ↑↓ move  ·  enter select  ·  esc cancel")}`;
  lines.push(`  ${search}`);
  lines.push("");

  const maxList = Math.max(6, Math.min(height - 10, 18));
  let start = 0;
  if (rows.length > maxList) {
    const selected = Math.max(0, index);
    start = Math.max(0, Math.min(selected - Math.floor(maxList / 2), rows.length - maxList));
  }
  const slice = rows.slice(start, start + maxList);
  const labelWidth = Math.min(46, Math.max(22, width - 46));

  for (let i = 0; i < slice.length; i += 1) {
    const row = slice[i];
    if (row.type === "group") {
      lines.push(`  ${ui.paint(row.label, ui.PALETTE.purple)}`);
      continue;
    }
    if (row.type === "empty") {
      lines.push(`  ${ui.dim(row.label)}`);
      continue;
    }
    const selected = start + i === index;
    const model = row.model;
    const target = row.target;
    const id = ui.truncate(model.id, labelWidth);
    const meta = target
      ? `${target.source} · ${target.name}`
      : model.provider || "9router";
    const badges = [];
    if (model.free) badges.push("FREE");
    if (model.tools) badges.push("TOOLS");
    if (model.reasoning) badges.push("THINK");
    const ctx = formatContext(model.context);
    const tailBits = [];
    if (ctx) tailBits.push(ctx);
    if (badges.length) tailBits.push(badges.join(" "));
    const tail = tailBits.join("  ");
    const plain = `  ${selected ? "▸" : " "} ${ui.padEnd(id, labelWidth)}  ${ui.truncate(meta, 24)}  ${tail}`;
    if (selected) {
      const padded = ui.padEnd(plain, width - 2);
      if (ui.colorEnabled) {
        lines.push(`\x1b[48;2;19;10;40m\x1b[38;2;0;240;255m\x1b[1m${padded}\x1b[0m`);
      } else {
        lines.push(`> ${plain}`);
      }
    } else {
      lines.push(ui.paint(plain, model.free ? ui.PALETTE.ice : ui.PALETTE.white));
    }
  }

  if (rows.length > maxList) {
    const above = start;
    const below = Math.max(0, rows.length - (start + maxList));
    lines.push(ui.dim(`  ${above ? `↑ ${above} more` : ""}${above && below ? "  ·  " : ""}${below ? `↓ ${below} more` : ""}`));
  }
  lines.push("");
  lines.push(`  ${ui.dim("enter")} select   ${ui.dim("esc")} cancel   ${ui.dim("type")} search   ${ui.dim("ctrl+c")} quit`);
  lines.push("");

  process.stdout.write("\x1b[2J\x1b[H" + lines.join("\n"));
}

async function numberedFallback(models, targets) {
  const ready = (targets || []).filter((t) => t.status === "ready" && t.model);
  console.log("");
  console.log(ui.gradient("SELECT A MODEL", ui.NEON));
  ready.forEach((t, i) => {
    console.log(`  ${i + 1}. ${ui.paint(t.model, ui.PALETTE.cyan)}  ${ui.dim(`${t.source} · ${t.name}`)}`);
  });
  const offset = ready.length;
  models
    .filter((m) => !ready.some((t) => t.model === m.id))
    .slice(0, 40)
    .forEach((m, i) => {
      console.log(`  ${offset + i + 1}. ${m.id}${m.free ? ui.dim("  free") : ""}`);
    });
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`\n  ${ui.paint("model #", ui.PALETTE.magenta)} `);
  rl.close();
  const n = Number.parseInt(answer, 10);
  const ordered = [
    ...ready.map((t) => t.model),
    ...models.filter((m) => !ready.some((t) => t.model === m.id)).map((m) => m.id),
  ];
  return ordered[n - 1] || null;
}

function selectModel(models, options = {}) {
  const { targets = [], current = "", title = "model" } = options;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return numberedFallback(models, targets);
  }

  return new Promise((resolve) => {
    let state = buildRows(models, targets, "", current);
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    ui.hideCursor();
    process.stdout.write("\x1b[?1049h");
    render(models, targets, state);

    const cleanup = (result) => {
      process.stdin.removeListener("keypress", onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\x1b[?1049l");
      ui.showCursor();
      resolve(result);
    };

    const onKey = (str, key) => {
      if (!key) return;
      if (key.ctrl && key.name === "c") {
        cleanup(null);
        return;
      }
      if (key.name === "escape") {
        cleanup(null);
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        const row = state.rows[state.index];
        if (row && row.type === "item") cleanup(row.model);
        return;
      }
      if (key.name === "up") {
        state.index = nextItem(state.rows, state.index, -1);
        render(models, targets, state);
        return;
      }
      if (key.name === "down") {
        state.index = nextItem(state.rows, state.index, 1);
        render(models, targets, state);
        return;
      }
      if (key.name === "pageup") {
        for (let i = 0; i < 8; i += 1) state.index = nextItem(state.rows, state.index, -1);
        render(models, targets, state);
        return;
      }
      if (key.name === "pagedown") {
        for (let i = 0; i < 8; i += 1) state.index = nextItem(state.rows, state.index, 1);
        render(models, targets, state);
        return;
      }
      if (key.name === "backspace") {
        state = buildRows(models, targets, state.query.slice(0, -1), state.rows[state.index]?.model?.id);
        render(models, targets, state);
        return;
      }
      if (key.name === "u" && key.ctrl) {
        state = buildRows(models, targets, "", current);
        render(models, targets, state);
        return;
      }
      if (str && str.length === 1 && !key.ctrl && !key.meta && str >= " ") {
        state = buildRows(models, targets, state.query + str, state.rows[state.index]?.model?.id);
        render(models, targets, state);
      }
    };

    process.stdin.on("keypress", onKey);
    render(models, targets, { ...state, query: "", rows: state.rows, index: state.index });
    void title;
  });
}

module.exports = {
  selectModel,
  formatContext,
  buildRows,
};
