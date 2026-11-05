"use strict";

const isTTY = Boolean(process.stdout.isTTY);
const colorEnabled =
  (isTTY || process.env.FORCE_COLOR === "1") &&
  !process.env.NO_COLOR &&
  process.env.TERM !== "dumb";

const PALETTE = {
  cyan: "#00F0FF",
  ice: "#B8F7FF",
  magenta: "#FF2BD6",
  purple: "#8B5CFF",
  blue: "#3D7BFF",
  lime: "#7CFF6B",
  mint: "#42FFC4",
  amber: "#FFC857",
  red: "#FF4D6D",
  white: "#EAF6FF",
  dim: "#5A6B85",
  void: "#070B16",
  panel: "#0C1224",
};

const NEON = [PALETTE.cyan, PALETTE.purple, PALETTE.magenta];
const AURORA = [PALETTE.lime, PALETTE.cyan, PALETTE.blue];
const FIRE = [PALETTE.amber, PALETTE.magenta, PALETTE.red];

const hexCache = new Map();
function parseHex(hex) {
  if (hexCache.has(hex)) return hexCache.get(hex);
  const h = hex.replace("#", "");
  const value = [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
  hexCache.set(hex, value);
  return value;
}

function sgr(code) {
  return `\x1b[${code}m`;
}

function fg(hex) {
  if (!colorEnabled) return "";
  const [r, g, b] = parseHex(hex);
  return `\x1b[38;2;${r};${g};${b}m`;
}

function bg(hex) {
  if (!colorEnabled) return "";
  const [r, g, b] = parseHex(hex);
  return `\x1b[48;2;${r};${g};${b}m`;
}

const RESET = colorEnabled ? sgr(0) : "";
const BOLD = colorEnabled ? sgr(1) : "";
const DIM = colorEnabled ? sgr(2) : "";
const ITALIC = colorEnabled ? sgr(3) : "";
const UNDERLINE = colorEnabled ? sgr(4) : "";

function paint(text, hex) {
  if (!colorEnabled) return String(text);
  return `${fg(hex)}${text}${RESET}`;
}

function bold(text) {
  return colorEnabled ? `${BOLD}${text}${RESET}` : String(text);
}

function dim(text) {
  return colorEnabled ? `${DIM}${text}${RESET}` : String(text);
}

function italic(text) {
  return colorEnabled ? `${ITALIC}${text}${RESET}` : String(text);
}

function underline(text) {
  return colorEnabled ? `${UNDERLINE}${text}${RESET}` : String(text);
}

function stripAnsi(text) {
  return String(text).replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
}

function visibleLength(text) {
  return [...stripAnsi(text)].length;
}

function truncate(text, max) {
  const chars = [...stripAnsi(text)];
  if (chars.length <= max) return text;
  if (max <= 1) return "…";
  return chars.slice(0, max - 1).join("") + "…";
}

function padEnd(text, width) {
  const gap = Math.max(0, width - visibleLength(text));
  return text + " ".repeat(gap);
}

function padStart(text, width) {
  const gap = Math.max(0, width - visibleLength(text));
  return " ".repeat(gap) + text;
}

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function mixHex(from, to, t) {
  const a = parseHex(from);
  const b = parseHex(to);
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function gradient(text, stops = NEON) {
  if (!colorEnabled) return String(text);
  const chars = [...String(text)];
  const total = Math.max(1, chars.length - 1);
  let out = "";
  chars.forEach((ch, i) => {
    if (ch === "\n") {
      out += ch;
      return;
    }
    const pos = (i / total) * (stops.length - 1);
    const idx = Math.min(stops.length - 2, Math.floor(pos));
    const [r, g, b] = mixHex(stops[idx], stops[idx + 1], pos - idx);
    out += `\x1b[38;2;${r};${g};${b}m${ch}`;
  });
  return out + RESET;
}

function gradientMultiline(lines, stops = NEON) {
  if (!colorEnabled) return lines.join("\n");
  const total = lines.reduce((sum, line) => sum + [...line].length, 0);
  let cursor = 0;
  return lines
    .map((line) => {
      const chars = [...line];
      let out = "";
      for (const ch of chars) {
        if (ch === " ") {
          out += ch;
          cursor += 1;
          continue;
        }
        const pos = total <= 1 ? 0 : cursor / (total - 1);
        const scaled = pos * (stops.length - 1);
        const idx = Math.min(stops.length - 2, Math.floor(scaled));
        const [r, g, b] = mixHex(stops[idx], stops[idx + 1], scaled - idx);
        out += `\x1b[38;2;${r};${g};${b}m${ch}`;
        cursor += 1;
      }
      return out + RESET;
    })
    .join("\n");
}

const WORDMARK = [
  "██╗   ██╗██╗██╗   ██╗██╗██████╗  ██████╗ ██████╗ ██████╗ ███████╗",
  "██║   ██║██║██║   ██║██║██╔══██╗██╔════╝██╔═══██╗██╔══██╗██╔════╝",
  "██║   ██║██║██║   ██║██║██║  ██║██║     ██║   ██║██║  ██║█████╗  ",
  "╚██╗ ██╔╝██║╚██╗ ██╔╝██║██║  ██║██║     ██║   ██║██║  ██║██╔══╝  ",
  " ╚████╔╝ ██║ ╚████╔╝ ██║██████╔╝╚██████╗╚██████╔╝██████╔╝███████╗",
  "  ╚═══╝  ╚═╝  ╚═══╝  ╚═╝╚═════╝  ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝",
];

function banner() {
  const width = process.stdout.columns || 100;
  if (width < 76) {
    return [
      "",
      `  ${gradient("V I V I D C O D E", NEON)}`,
      `  ${dim("neon vibe coding  ·  9router native")}`,
      "",
    ].join("\n");
  }
  return [
    "",
    gradientMultiline(WORDMARK, NEON),
    `  ${gradient("◆ NEON VIBE CODING", AURORA)} ${dim("·")} ${paint("9ROUTER NATIVE", PALETTE.cyan)} ${dim("·")} ${paint("AUTO-IMPORT", PALETTE.magenta)}`,
    "",
  ].join("\n");
}

function miniBanner(model) {
  const modelText = model ? model : "no model";
  return [
    `${gradient("VIVIDCODE", AURORA)} ${dim("›")} ${paint(modelText, PALETTE.ice)}`,
    `${dim("────────────────────────────────────────────────────────────")}`,
  ].join("\n");
}

function rule(width) {
  const w = width || Math.min(process.stdout.columns || 72, 72);
  return paint("─".repeat(w), PALETTE.purple);
}

function badge(text, color = PALETTE.cyan) {
  if (!colorEnabled) return `[${text}]`;
  return `${fg(color)}${BOLD}▐ ${text} ▌${RESET}`;
}

function pill(text, color = PALETTE.cyan) {
  if (!colorEnabled) return `(${text})`;
  return `${bg(color)}${fg(PALETTE.void)}${BOLD} ${text} ${RESET}`;
}

function kv(key, value, opts = {}) {
  const keyWidth = opts.keyWidth || 12;
  const k = padEnd(paint(key, opts.keyColor || PALETTE.dim), keyWidth + (colorEnabled ? 9 : 0));
  return `  ${k} ${value}`;
}

function box(title, lines, opts = {}) {
  const width = process.stdout.columns || 100;
  const content = (lines || []).map(String);
  const rawWidth = Math.max(
    title ? visibleLength(title) + 4 : 0,
    ...content.map((line) => visibleLength(line)),
    24
  );
  const inner = Math.min(rawWidth + 2, Math.max(28, width - 6));
  const border = opts.color || PALETTE.purple;
  const topTitle = title ? ` ${gradient(title, opts.titleStops || NEON)} ` : "";
  const topFill = Math.max(0, inner - visibleLength(topTitle) - 1);
  const out = [];
  out.push(`${paint("╭─", border)}${topTitle}${paint("─".repeat(topFill) + "╮", border)}`);
  for (const line of content) {
    const clipped = truncate(line, inner - 1);
    out.push(`${paint("│", border)} ${padEnd(clipped, inner - 1)}${paint("│", border)}`);
  }
  out.push(`${paint("╰" + "─".repeat(inner) + "╯", border)}`);
  return out.join("\n");
}

function success(text) {
  return `${paint("✓", PALETTE.lime)} ${text}`;
}

function warn(text) {
  return `${paint("▲", PALETTE.amber)} ${text}`;
}

function error(text) {
  return `${paint("✖", PALETTE.red)} ${text}`;
}

function info(text) {
  return `${paint("◈", PALETTE.cyan)} ${text}`;
}

function dot(color = PALETTE.lime) {
  return paint("●", color);
}

function clearScreen() {
  if (!isTTY) return;
  process.stdout.write("\x1b[2J\x1b[H");
}

process.on("exit", () => {
  if (isTTY) process.stdout.write("\x1b[?25h");
});

function hideCursor() {
  if (isTTY) process.stdout.write("\x1b[?25l");
}

function showCursor() {
  if (isTTY) process.stdout.write("\x1b[?25h");
}

function clearLine() {
  if (isTTY) process.stdout.write("\r\x1b[2K");
}

class Spinner {
  constructor(text, opts = {}) {
    this.text = text;
    this.frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    this.index = 0;
    this.timer = null;
    this.stream = opts.stream || process.stdout;
    this.active = false;
  }

  start() {
    if (!isTTY) {
      return this;
    }
    this.active = true;
    hideCursor();
    const tick = () => {
      const frame = this.frames[this.index++ % this.frames.length];
      this.stream.write(`\r\x1b[2K  ${paint(frame, PALETTE.cyan)} ${gradient(this.text, AURORA)}`);
    };
    tick();
    this.timer = setInterval(tick, 80);
    return this;
  }

  setText(text) {
    this.text = text;
  }

  stop(finalLine) {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.active) {
      this.stream.write("\r\x1b[2K");
      this.active = false;
    }
    if (finalLine) this.stream.write(`  ${finalLine}\n`);
    showCursor();
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function typeText(text, speed = 9) {
  if (!isTTY || process.env.VIVIDCODE_FAST === "1" || process.env.NO_ANIM === "1") {
    process.stdout.write(text);
    return;
  }
  for (const ch of text) {
    process.stdout.write(ch);
    await sleep(speed);
  }
}

module.exports = {
  PALETTE,
  NEON,
  AURORA,
  FIRE,
  colorEnabled,
  isTTY,
  fg,
  bg,
  paint,
  bold,
  dim,
  italic,
  underline,
  stripAnsi,
  visibleLength,
  truncate,
  padEnd,
  padStart,
  gradient,
  gradientMultiline,
  banner,
  miniBanner,
  rule,
  badge,
  pill,
  kv,
  box,
  success,
  warn,
  error,
  info,
  dot,
  clearScreen,
  hideCursor,
  showCursor,
  clearLine,
  Spinner,
  sleep,
  typeText,
};
