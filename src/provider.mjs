import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";

import { RouterError } from "./errors.mjs";
import { profileFor } from "./models.mjs";
import { modelMessages, modelToolChoice, modelTools } from "./responses-request.mjs";

export const COMMAND_CODE_API = "https://api.commandcode.ai/provider/v1";

/** @param {string} model */
export function protocolFor(model) {
  return /(^|\/)claude[-/]/i.test(model) || /anthropic/i.test(model)
    ? "anthropic"
    : "openai";
}

/** @param {Record<string, unknown>} request */
function reasoningEffort(request) {
  if (!request.reasoning || typeof request.reasoning !== "object") return undefined;
  const effort = /** @type {{ effort?: unknown }} */ (request.reasoning).effort;
  return typeof effort === "string" ? effort : undefined;
}

/** @param {string | undefined} effort */
function thinkingBudget(effort) {
  return {
    low: 2_048,
    medium: 4_096,
    high: 8_192,
    xhigh: 16_384,
    max: 32_768,
    ultra: 32_768,
  }[effort ?? ""];
}

/** @param {Record<string, unknown>} request */
function modelName(request) {
  const raw = String(request.model ?? "");
  const profile = profileFor(raw);
  if (profile) return profile.upstreamModel;
  return raw.startsWith("commandcode-messages/")
    ? raw.slice("commandcode-messages/".length)
    : raw.startsWith("commandcode/")
      ? raw.slice("commandcode/".length)
      : raw;
}

/**
 * @param {Record<string, unknown>} request
 * @param {{ apiKey: string, baseURL?: string, fetch?: typeof globalThis.fetch }} options
 */
export function commandCodeStream(request, options) {
  const upstreamModel = modelName(request);
  if (!upstreamModel) {
    throw new RouterError("invalid_model", "A Command Code model is required.", { status: 400 });
  }
  if (!options.apiKey) {
    throw new RouterError(
      "missing_api_key",
      "No Command Code API key is configured. Run `commandcode-router key set`.",
      { status: 401 },
    );
  }

  const baseURL = options.baseURL ?? COMMAND_CODE_API;
  const profile = profileFor(String(request.model));
  const protocol = profile?.protocol ?? (String(request.model).startsWith("commandcode-messages/")
    ? "anthropic"
    : protocolFor(upstreamModel));
  const headers = { "x-cmd-zdr": "1" };
  const provider = protocol === "anthropic"
    ? createAnthropic({ baseURL, apiKey: options.apiKey, headers, fetch: options.fetch })
    : createOpenAICompatible({
        baseURL,
        name: "command-code",
        apiKey: options.apiKey,
        headers,
        fetch: options.fetch,
      });

  const tools = modelTools(request.tools);
  const effort = reasoningEffort(request);
  const budgetTokens = protocol === "anthropic" ? thinkingBudget(effort) : undefined;
  return streamText({
    model: provider(upstreamModel),
    messages: modelMessages(request),
    tools,
    toolChoice: tools ? modelToolChoice(request.tool_choice) : undefined,
    maxOutputTokens: budgetTokens ? Math.max(16_384, budgetTokens + 8_192) : undefined,
    providerOptions: protocol === "anthropic" && budgetTokens
      ? { anthropic: { thinking: { type: "enabled", budgetTokens } } }
      : protocol === "openai" && effort
        ? { commandCode: { reasoningEffort: effort } }
        : undefined,
    maxRetries: 0,
    onError: () => {},
    abortSignal: request.abortSignal instanceof AbortSignal ? request.abortSignal : undefined,
  });
}
