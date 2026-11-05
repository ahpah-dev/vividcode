"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { exec } = require("node:child_process");

const IGNORE = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  "__pycache__",
  ".venv",
  "venv",
  ".pytest_cache",
  ".idea",
  ".vscode",
  ".vividcode",
  "coverage",
]);

const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files in the workspace as relative paths. Use this to explore the project.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative directory path. Defaults to ." },
          depth: { type: "number", description: "Maximum recursion depth (1-4). Default 2." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a text file from the workspace. Returns raw file contents.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Relative file path." } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create or overwrite a file with the full new contents. Requires user confirmation.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path." },
          content: { type: "string", description: "Full file contents to write." },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Run a shell command in the workspace. Requires user confirmation.",
      parameters: {
        type: "object",
        properties: { command: { type: "string", description: "Command to execute." } },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search workspace text files with a regular expression. Returns file:line matches.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "JavaScript regular expression." },
          path: { type: "string", description: "Relative directory to search. Defaults to ." },
        },
        required: ["pattern"],
      },
    },
  },
];

function rootDir() {
  return process.cwd();
}

function safePath(relPath) {
  const root = rootDir();
  const target = path.resolve(root, relPath || ".");
  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Refusing to access path outside the workspace: ${relPath}`);
  }
  return target;
}

function relPath(abs) {
  return path.relative(rootDir(), abs).split(path.sep).join("/") || ".";
}

function walk(dir, depth, maxDepth, out, counter) {
  if (depth > maxDepth || counter.count >= 300) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (counter.count >= 300 || IGNORE.has(entry.name)) continue;
    if (entry.name.startsWith(".git")) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(`${relPath(abs)}/`);
      counter.count += 1;
      walk(abs, depth + 1, maxDepth, out, counter);
    } else if (entry.isFile()) {
      out.push(relPath(abs));
      counter.count += 1;
    }
  }
}

function listFiles(rel = ".", depth = 2) {
  const abs = safePath(rel);
  if (!fs.existsSync(abs)) throw new Error(`Not found: ${rel}`);
  if (!fs.statSync(abs).isDirectory()) return relPath(abs);
  const out = [];
  walk(abs, 0, Math.max(1, Math.min(4, Number(depth) || 2)), out, { count: 0 });
  return out.length ? out.join("\n") : "(empty directory)";
}

function readFile(rel) {
  const abs = safePath(rel);
  if (!fs.existsSync(abs)) throw new Error(`Not found: ${rel}`);
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) throw new Error(`That is a directory, not a file: ${rel}`);
  if (stat.size > 2_000_000) throw new Error(`File is too large (${stat.size} bytes).`);
  const buf = fs.readFileSync(abs);
  if (buf.includes(0)) throw new Error(`Binary file, refusing to read: ${rel}`);
  const text = buf.toString("utf8");
  if (text.length > 60000) {
    return `${text.slice(0, 60000)}\n\n… [truncated ${text.length - 60000} characters]`;
  }
  return text;
}

function writeFile(rel, content) {
  const abs = safePath(rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const existing = fs.existsSync(abs);
  fs.writeFileSync(abs, String(content ?? ""), "utf8");
  return `${existing ? "Updated" : "Created"} ${relPath(abs)} (${Buffer.byteLength(String(content ?? ""))} bytes)`;
}

function runCommand(command) {
  return new Promise((resolve) => {
    exec(
      command,
      {
        cwd: rootDir(),
        timeout: 120000,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
        shell: process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "/bin/sh",
      },
      (err, stdout, stderr) => {
        const parts = [];
        if (stdout) parts.push(stdout.trimEnd());
        if (stderr) parts.push(`[stderr]\n${stderr.trimEnd()}`);
        if (err) {
          parts.push(`[exit ${err.code ?? err.signal ?? "error"}]${err.killed ? " (timed out)" : ""}`);
        }
        const text = parts.filter(Boolean).join("\n");
        resolve(text.length > 30000 ? `${text.slice(0, 30000)}\n… [truncated]` : text || "(no output)");
      }
    );
  });
}

function searchFiles(pattern, rel = ".") {
  const abs = safePath(rel);
  let regex;
  try {
    regex = new RegExp(pattern, "i");
  } catch (err) {
    throw new Error(`Invalid regex: ${err.message}`);
  }
  const results = [];
  const files = [];
  const collect = (dir, depth) => {
    if (depth > 5 || files.length > 1500) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (IGNORE.has(entry.name) || entry.name.startsWith(".git")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) collect(full, depth + 1);
      else if (entry.isFile() && files.length < 1500) files.push(full);
    }
  };
  if (fs.statSync(abs).isFile()) files.push(abs);
  else collect(abs, 0);

  for (const file of files) {
    let text;
    try {
      if (fs.statSync(file).size > 600000) continue;
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (text.includes("\u0000")) continue;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (regex.test(lines[i])) {
        results.push(`${relPath(file)}:${i + 1}: ${lines[i].trim().slice(0, 180)}`);
        if (results.length >= 120) break;
      }
    }
    if (results.length >= 120) break;
  }
  return results.length ? results.join("\n") : "(no matches)";
}

function workspaceSnapshot() {
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(rootDir(), { withFileTypes: true });
  } catch {
    return "(workspace unreadable)";
  }
  entries
    .filter((e) => !IGNORE.has(e.name) && !e.name.startsWith(".git"))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .slice(0, 60)
    .forEach((entry) => out.push(entry.isDirectory() ? `${entry.name}/` : entry.name));
  return out.join("\n") || "(empty workspace)";
}

function systemPrompt() {
  const cwd = rootDir();
  return [
    "You are VividCode, a sharp autonomous coding agent living inside a neon terminal.",
    "You are connected to 9Router and can use native tools to inspect and modify the workspace.",
    "",
    `Workspace: ${cwd}`,
    `Platform: ${process.platform} (${os.release()})`,
    "",
    "Operating rules:",
    "- Inspect before editing. Use list_files / read_file / search_files to understand the code.",
    "- Make focused, complete edits. write_file replaces the whole file, so include everything.",
    "- Prefer small, idiomatic changes that match the existing code style.",
    "- Never fabricate file contents or command output.",
    "- Ask for confirmation through the tool layer for writes and commands; do not assume.",
    "- Use relative paths only. Never touch paths outside the workspace.",
    "- Keep responses tight. After changing files, summarize what changed in a few bullets.",
    "- If native tool calling is unavailable, emit exactly one fenced block per action:",
    '  ```vividcode-tool',
    '  {"tool":"read_file","path":"src/app.js"}',
    "  ```",
    "- After a text-protocol tool block, stop and wait for the result.",
    "",
    "Workspace snapshot:",
    workspaceSnapshot(),
  ].join("\n");
}

function parseTextToolBlocks(text) {
  const blocks = [];
  const re = /```(?:vividcode-tool|vivid-tool|tool)\s*\n([\s\S]*?)```/gi;
  let match;
  while ((match = re.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const name = parsed.tool || parsed.name;
      const args = parsed.args || parsed.arguments || parsed;
      if (name) blocks.push({ name, args });
    } catch {
      /* ignore malformed block */
    }
  }
  return blocks;
}

function previewFor(content) {
  const text = String(content ?? "");
  const lines = text.split(/\r?\n/);
  return lines.slice(0, 6).join("\n") + (lines.length > 6 ? "\n…" : "");
}

async function executeTool(name, args, ctx = {}) {
  const { confirm = async () => true, yolo = false, log = () => {} } = ctx;
  const input = args || {};
  try {
    if (name === "list_files") {
      const result = listFiles(input.path || ".", input.depth || 2);
      log(`list_files ${input.path || "."}`);
      return result;
    }
    if (name === "read_file") {
      if (!input.path) return "Error: path is required.";
      const result = readFile(input.path);
      log(`read_file ${input.path}`);
      return result;
    }
    if (name === "search_files") {
      if (!input.pattern) return "Error: pattern is required.";
      const result = searchFiles(input.pattern, input.path || ".");
      log(`search_files ${input.pattern}`);
      return result;
    }
    if (name === "write_file") {
      if (!input.path) return "Error: path is required.";
      const content = String(input.content ?? "");
      if (!yolo) {
        const ok = await confirm({
          kind: "write",
          path: input.path,
          bytes: Buffer.byteLength(content),
          preview: previewFor(content),
        });
        if (!ok) return `User rejected writing ${input.path}.`;
      }
      const result = writeFile(input.path, content);
      log(result);
      return result;
    }
    if (name === "run_command") {
      if (!input.command) return "Error: command is required.";
      if (!yolo) {
        const ok = await confirm({ kind: "run", command: input.command });
        if (!ok) return "User rejected running the command.";
      }
      log(`$ ${input.command}`);
      return await runCommand(input.command);
    }
    return `Error: unknown tool "${name}".`;
  } catch (err) {
    return `Error: ${err.message}`;
  }
}

module.exports = {
  TOOL_DEFS,
  systemPrompt,
  executeTool,
  parseTextToolBlocks,
  listFiles,
  readFile,
  writeFile,
  runCommand,
  searchFiles,
  safePath,
  rootDir,
};
