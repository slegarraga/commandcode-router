import assert from "node:assert/strict";
import test from "node:test";

import { startServer } from "../src/server.mjs";

const SECRET = "a".repeat(48);

function openAiSse() {
  return [
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
  ].map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
}

/** @param {import("node:http").Server} server */
function origin(server) {
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

test("keeps health behind the capability URL", async (t) => {
  const server = /** @type {import("node:http").Server} */ (await startServer({
    secret: SECRET,
    apiKey: "key",
    port: 0,
    logger: { info() {}, error() {} },
  }));
  t.after(() => server.close());

  const hidden = await fetch(`${origin(server)}/health`);
  const prefixCollision = await fetch(`${origin(server)}/_commandcode/${SECRET}extra/v1/health`);
  const health = await fetch(`${origin(server)}/_commandcode/${SECRET}/v1/health`);
  assert.equal(hidden.status, 404);
  assert.equal(prefixCollision.status, 404);
  assert.deepEqual(await health.json(), { status: "ok" });
});

test("passes non-Responses methods through without requiring a JSON body", async (t) => {
  /** @type {Array<{ url: string, method: string | undefined }>} */
  const captures = [];
  const server = /** @type {import("node:http").Server} */ (await startServer({
    secret: SECRET,
    apiKey: "key",
    port: 0,
    nativeBaseURL: "https://native.test/backend-api/codex",
    fetch: async (url, init) => {
      captures.push({ url: String(url), method: init?.method });
      return Response.json({ data: [] });
    },
    logger: { info() {}, error() {} },
  }));
  t.after(() => server.close());

  const response = await fetch(`${origin(server)}/_commandcode/${SECRET}/v1/models`);
  assert.equal(response.status, 200);
  assert.deepEqual(captures, [{
    url: "https://native.test/backend-api/codex/models",
    method: "GET",
  }]);
});

test("translates Command Code streams into Responses events", async (t) => {
  const server = /** @type {import("node:http").Server} */ (await startServer({
    secret: SECRET,
    apiKey: "key",
    port: 0,
    fetch: async () => new Response(openAiSse(), {
      headers: { "content-type": "text/event-stream" },
    }),
    logger: { info() {}, error() {} },
  }));
  t.after(() => server.close());

  const response = await fetch(`${origin(server)}/_commandcode/${SECRET}/v1/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "commandcode/deepseek/example", input: "hello", stream: true }),
  });
  const stream = await response.text();

  assert.equal(response.status, 200);
  assert.match(stream, /event: response\.output_text\.delta/);
  assert.match(stream, /"delta":"hello"/);
  assert.match(stream, /event: response\.completed/);
  assert.match(stream, /data: \[DONE\]/);
});

test("passes native models through with the caller authorization", async (t) => {
  /** @type {Array<{ url: string, authorization: string | null }>} */
  const captures = [];
  const server = /** @type {import("node:http").Server} */ (await startServer({
    secret: SECRET,
    apiKey: "key",
    port: 0,
    nativeBaseURL: "https://native.test/backend-api/codex",
    fetch: async (url, init) => {
      captures.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return new Response("native", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    },
    logger: { info() {}, error() {} },
  }));
  t.after(() => server.close());

  const response = await fetch(`${origin(server)}/_commandcode/${SECRET}/v1/responses`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer native-token",
    },
    body: JSON.stringify({ model: "gpt-native", input: "hello" }),
  });

  assert.equal(await response.text(), "native");
  assert.deepEqual(captures, [{
    url: "https://native.test/backend-api/codex/responses",
    authorization: "Bearer native-token",
  }]);
});
