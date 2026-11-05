"use strict";

const { TOOL_DEFS, systemPrompt, executeTool, parseTextToolBlocks } = require("./agent");

class ChatError extends Error {
  constructor(message, status = 0, body = "") {
    super(message);
    this.name = "ChatError";
    this.status = status;
    this.body = body;
  }
}

function contentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part.text === "string") return part.text;
        return "";
      })
      .join("");
  }
  return "";
}

function makeToolCalls(acc) {
  return acc
    .filter(Boolean)
    .map((call, index) => ({
      id: call.id || `call_vivid_${Date.now()}_${index}`,
      type: "function",
      function: {
        name: call.function?.name || call.name || "",
        arguments: call.function?.arguments || call.arguments || "{}",
      },
    }))
    .filter((call) => call.function.name);
}

function mergeToolDelta(acc, deltaToolCalls) {
  for (const part of deltaToolCalls || []) {
    const index = Number.isInteger(part.index) ? part.index : acc.length;
    if (!acc[index]) {
      acc[index] = { id: "", type: "function", function: { name: "", arguments: "" } };
    }
    const slot = acc[index];
    if (part.id) slot.id = part.id;
    const fn = part.function || {};
    if (fn.name && !slot.function.name.includes(fn.name)) slot.function.name += fn.name;
    if (fn.arguments) slot.function.arguments += fn.arguments;
  }
}

async function streamOnce(options) {
  const {
    baseUrl,
    apiKey,
    model,
    messages,
    tools,
    onText = () => {},
    onReasoning = () => {},
    signal,
  } = options;

  const body = {
    model,
    messages,
    stream: true,
    temperature: 0.6,
  };
  if (tools) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = `9Router returned HTTP ${res.status}.`;
    try {
      const parsed = JSON.parse(text);
      message = parsed?.error?.message || parsed?.error || parsed?.message || message;
      if (typeof message === "object") message = JSON.stringify(message);
    } catch {
      if (text) message = text.slice(0, 400);
    }
    throw new ChatError(message, res.status, text);
  }

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream") || !res.body) {
    const data = await res.json();
    const choice = data?.choices?.[0] || {};
    const msg = choice.message || {};
    const content = contentToText(msg.content);
    if (content) onText(content);
    const reasoning = msg.reasoning_content || msg.reasoning || "";
    if (reasoning) onReasoning(reasoning);
    return {
      content,
      reasoning,
      toolCalls: makeToolCalls((msg.tool_calls || []).map((call) => call)),
      finishReason: choice.finish_reason || "stop",
      usage: data.usage || null,
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let reasoning = "";
  let finishReason = "";
  let usage = null;
  const toolAcc = [];

  const consume = (payload) => {
    if (!payload || payload === "[DONE]") return;
    let json;
    try {
      json = JSON.parse(payload);
    } catch {
      return;
    }
    if (json.usage) usage = json.usage;
    const choice = json.choices?.[0];
    if (!choice) return;
    const delta = choice.delta || {};
    const text = contentToText(delta.content);
    if (text) {
      content += text;
      onText(text);
    }
    const think = delta.reasoning_content || delta.reasoning || delta.thinking || "";
    if (think) {
      reasoning += think;
      onReasoning(think);
    }
    if (delta.tool_calls) mergeToolDelta(toolAcc, delta.tool_calls);
    if (choice.finish_reason) finishReason = choice.finish_reason;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("data:")) consume(line.slice(5).trim());
    }
  }
  if (buffer.trim().startsWith("data:")) consume(buffer.trim().slice(5).trim());

  return {
    content,
    reasoning,
    toolCalls: makeToolCalls(toolAcc),
    finishReason: finishReason || "stop",
    usage,
  };
}

function looksLikeToolError(status, body) {
  if (![400, 404, 422, 500].includes(status)) return false;
  return /tool|function|tool_choice|tool_calls/i.test(String(body || ""));
}

function trimHistory(messages, maxChars = 500000) {
  const system = messages.find((m) => m.role === "system");
  let total = messages.reduce((sum, m) => sum + String(m.content || "").length, 0);
  while (total > maxChars && messages.length > 4) {
    const idx = messages.findIndex((m) => m.role !== "system");
    if (idx < 0) break;
    let remove = 1;
    if (messages[idx + 1] && ["user", "assistant", "tool"].includes(messages[idx + 1].role)) {
      remove = 2;
    }
    const removed = messages.splice(idx, remove);
    total -= removed.reduce((sum, m) => sum + String(m.content || "").length, 0);
  }
  if (system && messages[0] !== system) {
    messages.unshift(system);
  }
  return messages;
}

function estimateTokens(messages) {
  const chars = messages.reduce((sum, m) => sum + String(m.content || "").length, 0);
  return Math.round(chars / 4);
}

class Session {
  constructor(options) {
    const {
      baseUrl,
      apiKey,
      model,
      tools = true,
      thinking = false,
      yolo = false,
      confirm,
      onText,
      onReasoning,
      onTool,
      onToolResult,
      onNote = () => {},
    } = options;
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.model = model;
    this.toolsEnabled = tools;
    this.thinking = thinking;
    this.yolo = yolo;
    this.confirm = confirm || (async () => true);
    this.onText = onText || (() => {});
    this.onReasoning = onReasoning || (() => {});
    this.onTool = onTool || (() => {});
    this.onToolResult = onToolResult || (() => {});
    this.onNote = onNote;
    this.toolSupport = true;
    this.messages = [{ role: "system", content: systemPrompt() }];
    this.lastAssistant = "";
    this.totalTokens = 0;
    this.abort = null;
  }

  setModel(model) {
    this.model = model;
  }

  setThinking(value) {
    this.thinking = Boolean(value);
  }

  reset() {
    this.messages = [{ role: "system", content: systemPrompt() }];
    this.lastAssistant = "";
    this.totalTokens = 0;
  }

  addContext(text) {
    this.messages.push({
      role: "user",
      content: `Reference context loaded into the session:\n\n${text}`,
    });
  }

  stop() {
    if (this.abort) this.abort.abort();
  }

  async ask(userText) {
    this.messages.push({ role: "user", content: userText });
    return this.run();
  }

  async stream() {
    this.abort = new AbortController();
    const useTools = this.toolsEnabled && this.toolSupport;
    try {
      return await streamOnce({
        baseUrl: this.baseUrl,
        apiKey: this.apiKey,
        model: this.model,
        messages: trimHistory(this.messages),
        tools: useTools ? TOOL_DEFS : null,
        onText: (chunk) => {
          this.lastAssistant += chunk;
          this.onText(chunk);
        },
        onReasoning: (chunk) => {
          if (this.thinking) this.onReasoning(chunk);
        },
        signal: this.abort.signal,
      });
    } catch (err) {
      if (useTools && err instanceof ChatError && looksLikeToolError(err.status, err.body)) {
        this.toolSupport = false;
        this.onNote("This model does not accept native tools — switching to text tool protocol.");
        return this.stream();
      }
      throw err;
    } finally {
      this.abort = null;
    }
  }

  async run() {
    const maxSteps = 12;
    let finalText = "";
    for (let step = 0; step < maxSteps; step += 1) {
      const result = await this.stream();
      if (result.usage?.total_tokens) this.totalTokens += result.usage.total_tokens;
      finalText = result.content || "";

      if (result.toolCalls && result.toolCalls.length) {
        this.messages.push({
          role: "assistant",
          content: result.content || "",
          tool_calls: result.toolCalls,
        });
        for (const call of result.toolCalls) {
          const name = call.function.name;
          let args = {};
          try {
            args = JSON.parse(call.function.arguments || "{}");
          } catch {
            args = {};
          }
          this.onTool(name, args);
          const output = await executeTool(name, args, {
            confirm: this.confirm,
            yolo: this.yolo,
            log: () => {},
          });
          this.onToolResult(name, output);
          this.messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: output,
          });
        }
        this.lastAssistant = "";
        continue;
      }

      this.messages.push({ role: "assistant", content: result.content || "" });
      const blocks = this.toolsEnabled
        ? parseTextToolBlocks(result.content || "")
        : [];
      if (blocks.length) {
        for (const block of blocks.slice(0, 3)) {
          this.onTool(block.name, block.args);
          const output = await executeTool(block.name, block.args, {
            confirm: this.confirm,
            yolo: this.yolo,
            log: () => {},
          });
          this.onToolResult(block.name, output);
          this.messages.push({
            role: "user",
            content: `[tool result: ${block.name}]\n${output}`,
          });
        }
        this.lastAssistant = "";
        continue;
      }
      break;
    }
    this.lastAssistant = finalText;
    trimHistory(this.messages);
    return finalText;
  }
}

module.exports = {
  ChatError,
  Session,
  streamOnce,
  estimateTokens,
  trimHistory,
};
