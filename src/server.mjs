import http from "node:http";
import zlib from "node:zlib";
import { Readable } from "node:stream";

import { publicError, RouterError } from "./errors.mjs";
import { commandCodeStream } from "./provider.mjs";
import { ResponsesStream } from "./responses-stream.mjs";

const HOP_BY_HOP = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/** @param {http.IncomingMessage} request */
async function body(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Best-effort JSON sniff for Command Code routing.
 * Native pass-through keeps the original bytes when the body is empty,
 * gzipped, or not JSON.
 *
 * @param {Buffer} bytes
 * @param {http.IncomingHttpHeaders} headers
 */
function decodeResponsesPayload(bytes, headers) {
  if (!bytes.length) return null;
  let raw = bytes;
  const encoding = String(headers["content-encoding"] ?? "").toLowerCase();
  if (encoding.includes("gzip") || (raw[0] === 0x1f && raw[1] === 0x8b)) {
    try {
      raw = zlib.gunzipSync(raw);
    } catch {
      return null;
    }
  }
  const text = raw.toString("utf8").replace(/^\uFEFF/, "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** @param {http.IncomingHttpHeaders} source */
function upstreamHeaders(source) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(source)) {
    if (HOP_BY_HOP.has(name) || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
  headers.set("content-type", "application/json");
  headers.set("accept-encoding", "identity");
  return headers;
}

/** @param {http.ServerResponse} response @param {number} status @param {unknown} payload */
function sendJson(response, status, payload) {
  const encoded = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(encoded),
    "cache-control": "no-store",
  });
  response.end(encoded);
}

/** @param {string} model */
function isCommandCode(model) {
  return model.startsWith("commandcode/") || model.startsWith("commandcode-messages/");
}

/**
 * @param {http.IncomingMessage} request
 * @param {http.ServerResponse} response
 * @param {Record<string, unknown>} payload
 * @param {{ apiKey: string, fetch: typeof globalThis.fetch, commandCodeBaseURL?: string }} options
 */
async function respondWithCommandCode(request, response, payload, options) {
  const controller = new AbortController();
  request.once("aborted", () => controller.abort());
  payload.abortSignal = controller.signal;

  const result = commandCodeStream(payload, {
    apiKey: options.apiKey,
    baseURL: options.commandCodeBaseURL,
    fetch: options.fetch,
  });
  const customTools = new Set(Array.isArray(payload.tools)
    ? payload.tools.flatMap((candidate) =>
        candidate &&
        typeof candidate === "object" &&
        candidate.type === "custom" &&
        typeof candidate.name === "string"
          ? [candidate.name]
          : []
      )
    : []);
  const stream = new ResponsesStream({ model: String(payload.model), customTools });
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-store",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  response.flushHeaders();
  response.write(stream.started());

  let failed = false;
  for await (const part of result.fullStream) {
    if (part.type === "error") failed = true;
    const frame = stream.part(part);
    if (frame) response.write(frame);
    if (part.type === "finish" && !failed) {
      response.end(stream.finished(part.totalUsage));
      return;
    }
  }

  if (!response.writableEnded) {
    response.end(failed ? "data: [DONE]\n\n" : stream.finished());
  }
}

/**
 * @param {http.IncomingMessage} request
 * @param {http.ServerResponse} response
 * @param {Buffer} requestBody
 * @param {{ nativeBaseURL: string, fetch: typeof globalThis.fetch }} options
 */
async function forwardNative(request, response, requestBody, options) {
  const source = new URL(request.url ?? "/", "http://localhost");
  const target = new URL(source.pathname.replace(/^.*?\/v1\//, ""), `${options.nativeBaseURL.replace(/\/$/, "")}/`);
  target.search = source.search;
  const upstream = await options.fetch(target, {
    method: request.method,
    headers: upstreamHeaders(request.headers),
    body: requestBody.length ? new Uint8Array(requestBody) : undefined,
    redirect: "manual",
  });

  /** @type {Record<string, string>} */
  const headers = {};
  for (const [name, value] of upstream.headers) {
    if (!HOP_BY_HOP.has(name) && name !== "content-encoding") headers[name] = value;
  }
  response.writeHead(upstream.status, headers);
  if (!upstream.body) return response.end();
  Readable.fromWeb(/** @type {any} */ (upstream.body)).pipe(response);
}

/**
 * @param {{
 *   secret: string,
 *   apiKey: string,
 *   nativeBaseURL?: string,
 *   commandCodeBaseURL?: string,
 *   fetch?: typeof globalThis.fetch,
 *   logger?: Pick<Console, "info" | "error">,
 * }} options
 */
export function createHandler(options) {
  if (!/^[A-Za-z0-9_-]{32,}$/.test(options.secret)) {
    throw new Error("Router secret must contain at least 32 URL-safe characters.");
  }
  const prefix = `/_commandcode/${options.secret}/v1`;
  const fetch = options.fetch ?? globalThis.fetch;
  const nativeBaseURL = options.nativeBaseURL ?? "https://chatgpt.com/backend-api/codex";
  const logger = options.logger ?? console;

  /**
   * @param {http.IncomingMessage} request
   * @param {http.ServerResponse} response
   */
  return async function handler(request, response) {
    const started = Date.now();
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) {
      sendJson(response, 404, { error: { code: "not_found", message: "Not found." } });
      return;
    }

    try {
      if (request.method === "GET" && url.pathname === `${prefix}/health`) {
        sendJson(response, 200, { status: "ok" });
        return;
      }

      const bytes = await body(request);
      if (
        request.method === "POST" &&
        url.pathname === `${prefix}/responses`
      ) {
        const payload = decodeResponsesPayload(bytes, request.headers);
        if (payload && typeof payload === "object" && isCommandCode(String(payload.model ?? ""))) {
          await respondWithCommandCode(request, response, payload, {
            apiKey: options.apiKey,
            commandCodeBaseURL: options.commandCodeBaseURL,
            fetch,
          });
          return;
        }
      }

      await forwardNative(request, response, bytes, { nativeBaseURL, fetch });
    } catch (error) {
      logger.error(error instanceof RouterError ? error.message : "Router request failed");
      if (!response.headersSent) {
        sendJson(response, error instanceof RouterError ? error.status : 502, publicError(error));
      } else if (!response.writableEnded) {
        response.end();
      }
    } finally {
      logger.info(`${request.method} ${url.pathname.replace(options.secret, "<secret>")} ${response.statusCode} ${Date.now() - started}ms`);
    }
  };
}

/**
 * @param {Parameters<typeof createHandler>[0] & { host?: string, port?: number }} options
 */
export function startServer(options) {
  const server = http.createServer(createHandler(options));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 4219, options.host ?? "127.0.0.1", () => resolve(server));
  });
}
