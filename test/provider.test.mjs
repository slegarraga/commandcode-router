import assert from "node:assert/strict";
import test from "node:test";

import { commandCodeStream, protocolFor } from "../src/provider.mjs";

function openAiSse() {
  const chunks = [
    {
      id: "chatcmpl_1",
      object: "chat.completion.chunk",
      created: 1_700_000_000,
      model: "deepseek/example",
      choices: [{ index: 0, delta: { role: "assistant", content: "hello" }, finish_reason: null }],
    },
    {
      id: "chatcmpl_1",
      object: "chat.completion.chunk",
      created: 1_700_000_000,
      model: "deepseek/example",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
    },
  ];
  return `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
}

function anthropicSse() {
  const events = [
    ["message_start", {
      type: "message_start",
      message: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude/example",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 4, output_tokens: 0 },
      },
    }],
    ["content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    }],
    ["content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "hello" },
    }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 1 },
    }],
    ["message_stop", { type: "message_stop" }],
  ];
  return events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

/** @param {ReturnType<typeof commandCodeStream>} result */
async function parts(result) {
  const collected = [];
  for await (const part of result.fullStream) collected.push(part);
  return collected;
}

test("routes non-Claude models through Command Code chat completions", async () => {
  /** @type {Array<{ url: string, init: RequestInit | undefined }>} */
  const captures = [];
  const result = commandCodeStream({
    model: "commandcode/deepseek/example",
    input: "hello",
    reasoning: { effort: "high" },
  }, {
    apiKey: "test-key",
    baseURL: "https://command.test/v1",
    fetch: async (url, init) => {
      captures.push({ url: String(url), init });
      return new Response(openAiSse(), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    },
  });
  const stream = await parts(result);

  const captured = captures[0];
  assert.ok(captured);
  assert.equal(captured.url, "https://command.test/v1/chat/completions");
  assert.equal(new Headers(captured.init?.headers).get("x-cmd-zdr"), "1");
  const requestBody = JSON.parse(String(captured.init?.body));
  assert.equal(requestBody.reasoning_effort, "high");
  const text = stream.find((part) => part.type === "text-delta");
  assert.ok(text && text.type === "text-delta");
  assert.equal(text.text, "hello");
  const last = stream.at(-1);
  assert.ok(last);
  assert.equal(last.type, "finish");
});

test("routes Claude models through Command Code messages", async () => {
  /** @type {Array<{ url: string, init: RequestInit | undefined }>} */
  const captures = [];
  const result = commandCodeStream({
    model: "commandcode-messages/anthropic/claude-example",
    input: "hello",
    reasoning: { effort: "high" },
  }, {
    apiKey: "test-key",
    baseURL: "https://command.test/v1",
    fetch: async (url, init) => {
      captures.push({ url: String(url), init });
      return new Response(anthropicSse(), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    },
  });
  const stream = await parts(result);

  const captured = captures[0];
  assert.ok(captured);
  assert.equal(captured.url, "https://command.test/v1/messages");
  assert.equal(new Headers(captured.init?.headers).get("x-cmd-zdr"), "1");
  const requestBody = JSON.parse(String(captured.init?.body));
  assert.deepEqual(requestBody.thinking, { type: "enabled", budget_tokens: 8_192 });
  assert.equal(requestBody.max_tokens, 24_576);
  const text = stream.find((part) => part.type === "text-delta");
  assert.ok(text && text.type === "text-delta");
  assert.equal(text.text, "hello");
});

test("does not silently accept missing credentials", () => {
  assert.throws(
    () => commandCodeStream({ model: "commandcode/example", input: "hello" }, { apiKey: "" }),
    { code: "missing_api_key", status: 401 },
  );
});

test("recognizes Anthropic model ids", () => {
  assert.equal(protocolFor("anthropic/claude-sonnet-5"), "anthropic");
  assert.equal(protocolFor("deepseek/deepseek-v4"), "openai");
});
