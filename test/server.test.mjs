import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
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

test("forwards non-JSON Responses bodies to the native Codex API", async (t) => {
  /** @type {Array<{ url: string, body: string }>} */
  const captures = [];
  const server = /** @type {import("node:http").Server} */ (await startServer({
    secret: SECRET,
    apiKey: "key",
    port: 0,
    nativeBaseURL: "https://native.test/backend-api/codex",
    fetch: async (url, init) => {
      const raw = init?.body;
      captures.push({
        url: String(url),
        body: raw instanceof Uint8Array ? Buffer.from(raw).toString("utf8") : "",
      });
      return new Response("native", { status: 200 });
    },
    logger: { info() {}, error() {} },
  }));
  t.after(() => server.close());

  const empty = await fetch(`${origin(server)}/_commandcode/${SECRET}/v1/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  const raw = await fetch(`${origin(server)}/_commandcode/${SECRET}/v1/responses`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: Buffer.from([0x00, 0x01, 0x02]),
  });

  assert.equal(empty.status, 200);
  assert.equal(raw.status, 200);
  assert.deepEqual(captures, [
    { url: "https://native.test/backend-api/codex/responses", body: "" },
    { url: "https://native.test/backend-api/codex/responses", body: "\u0000\u0001\u0002" },
  ]);
});

test("accepts Responses bodies larger than 16 MiB", async (t) => {
  let received = 0;
  const server = /** @type {import("node:http").Server} */ (await startServer({
    secret: SECRET,
    apiKey: "key",
    port: 0,
    nativeBaseURL: "https://native.test/backend-api/codex",
    fetch: async (_url, init) => {
      const raw = init?.body;
      received = raw instanceof Uint8Array ? raw.byteLength : 0;
      return new Response("native", { status: 200 });
    },
    logger: { info() {}, error() {} },
  }));
  t.after(() => server.close());

  const huge = Buffer.alloc(16 * 1024 * 1024 + 1, 120);
  const response = await fetch(`${origin(server)}/_commandcode/${SECRET}/v1/responses`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: huge,
  });

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "native");
  assert.equal(received, huge.length);
});

test("routes gzipped Command Code Responses JSON", async (t) => {
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

  const payload = JSON.stringify({
    model: "commandcode/deepseek/example",
    input: "hello",
    stream: true,
  });
  const response = await fetch(`${origin(server)}/_commandcode/${SECRET}/v1/responses`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-encoding": "gzip",
    },
    body: gzipSync(payload),
  });
  const stream = await response.text();

  assert.equal(response.status, 200);
  assert.match(stream, /event: response\.output_text\.delta/);
  assert.match(stream, /"delta":"hello"/);
});
