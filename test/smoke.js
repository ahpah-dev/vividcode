"use strict";

const assert = require("node:assert");
const path = require("node:path");

process.env.VIVIDCODE_FAST = "1";

const { version, parseArgs } = require("../src/main");
const { buildRows, formatContext } = require("../src/selector");
const agent = require("../src/agent");
const { stripJsonc } = require("../src/importer");
const { normalizeBaseUrl, maskKey } = require("../src/config");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

check("version is semver", () => {
  assert.match(version(), /^\d+\.\d+\.\d+$/);
});

check("parseArgs collects prompt and flags", () => {
  const args = parseArgs(["--yolo", "--model", "oc/beam", "build", "it"]);
  assert.equal(args.yolo, true);
  assert.equal(args.model, "oc/beam");
  assert.deepEqual(args.prompt, ["build", "it"]);
});

check("parseArgs supports --key=value", () => {
  const args = parseArgs(["--url=http://localhost:20128/v1"]);
  assert.equal(args.url, "http://localhost:20128/v1");
});

check("normalizeBaseUrl adds /v1", () => {
  assert.equal(normalizeBaseUrl("http://localhost:20128"), "http://localhost:20128/v1");
  assert.equal(normalizeBaseUrl("http://localhost:20128/v1/"), "http://localhost:20128/v1");
});

check("maskKey hides the middle", () => {
  assert.equal(maskKey("sk-1234567890"), "sk-12…7890");
});

check("formatContext compacts large windows", () => {
  assert.equal(formatContext(200000), "200K");
  assert.equal(formatContext(1000000), "1M");
});

check("selector pins imported models first", () => {
  const models = [
    { id: "zzz/other", provider: "zzz", free: false, tools: true, context: 0 },
    { id: "kc/reflection/beam-free", provider: "kc", free: true, tools: true, context: 200000 },
  ];
  const targets = [
    { key: "kilo", name: "Beam 1.0 Free", source: "Kilo", status: "ready", model: "kc/reflection/beam-free" },
  ];
  const { rows } = buildRows(models, targets, "", "");
  const firstItem = rows.find((row) => row.type === "item");
  assert.equal(firstItem.model.id, "kc/reflection/beam-free");
});

check("selector filters by query", () => {
  const models = [
    { id: "kc/reflection/beam-free", provider: "kc", free: true, tools: true, context: 0 },
    { id: "oc/deepseek-v4.1-flash-free", provider: "oc", free: true, tools: true, context: 0 },
  ];
  const { rows } = buildRows(models, [], "deepseek", "");
  const ids = rows.filter((row) => row.type === "item").map((row) => row.model.id);
  assert.deepEqual(ids, ["oc/deepseek-v4.1-flash-free"]);
});

check("agent rejects paths outside the workspace", () => {
  assert.throws(() => agent.safePath("../outside.txt"), /outside the workspace/);
  assert.ok(agent.safePath("inside.txt").startsWith(process.cwd()));
});

check("jsonc stripper removes comments", () => {
  const parsed = JSON.parse(stripJsonc('{\n // hi\n "a": 1,\n /* block */\n "b": 2,\n}'));
  assert.deepEqual(parsed, { a: 1, b: 2 });
});

check("agent exposes the five core tools", () => {
  const names = agent.TOOL_DEFS.map((tool) => tool.function.name).sort();
  assert.deepEqual(names, ["list_files", "read_file", "run_command", "search_files", "write_file"]);
});

console.log(`\n  VividCode smoke test: ${passed} checks passed\n`);
