import { jsonSchema, tool } from "ai";

import { RouterError } from "./errors.mjs";

/** @typedef {import("ai").ModelMessage} ModelMessage */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value */
function text(value) {
  if (typeof value === "string") return value;
  return JSON.stringify(value ?? "");
}

/** @param {unknown} value */
function argumentsObject(value) {
  if (object(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return {};

  try {
    const parsed = JSON.parse(value);
    return object(parsed) ? parsed : { value: parsed };
  } catch {
    return { raw: value };
  }
}

/** @param {unknown} value @returns {import("@ai-sdk/provider-utils").ToolResultOutput} */
function toolOutput(value) {
  if (object(value) || Array.isArray(value)) {
    return {
      type: "json",
      value: /** @type {any} */ (value),
    };
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (object(parsed) || Array.isArray(parsed)) {
        return {
          type: "json",
          value: /** @type {any} */ (parsed),
        };
      }
    } catch {
      // Tool output is commonly plain text.
    }
  }

  return { type: "text", value: text(value) };
}

/**
 * @param {ModelMessage[]} messages
 * @param {ModelMessage} next
 */
function append(messages, next) {
  messages.push(next);
}

/** @param {unknown} raw @returns {import("ai").UserContent} */
function userParts(raw) {
  const parts = Array.isArray(raw) ? raw : [{ type: "input_text", text: raw }];
  /** @type {Array<import("@ai-sdk/provider-utils").TextPart | import("@ai-sdk/provider-utils").ImagePart>} */
  const result = [];
  for (const part of parts) {
    if (!object(part)) continue;
    if (["input_text", "text"].includes(String(part.type))) {
      result.push({ type: "text", text: text(part.text) });
    }
    if (part.type === "input_image" && typeof part.image_url === "string") {
      result.push({ type: "image", image: part.image_url });
    }
  }
  return result;
}

/** @param {unknown} raw @returns {import("ai").AssistantContent} */
function assistantParts(raw) {
  const parts = Array.isArray(raw) ? raw : [{ type: "output_text", text: raw }];
  /** @type {Array<import("@ai-sdk/provider-utils").TextPart | import("@ai-sdk/provider-utils").ReasoningPart>} */
  const result = [];
  for (const part of parts) {
    if (!object(part)) continue;
    if (["output_text", "text"].includes(String(part.type))) {
      result.push({ type: "text", text: text(part.text) });
    }
    if (part.type === "reasoning" && typeof part.summary === "string") {
      result.push({ type: "reasoning", text: part.summary });
    }
  }
  return result;
}

/** @param {unknown} format */
function customFormat(format) {
  if (typeof format === "string") return format;
  if (!object(format)) return "";
  if (typeof format.definition === "string") return format.definition;
  try {
    return JSON.stringify(format);
  } catch {
    return "";
  }
}

/**
 * Convert the Responses API's flat input list into AI SDK model messages.
 * @param {Record<string, unknown>} request
 * @returns {ModelMessage[]}
 */
export function modelMessages(request) {
  /** @type {ModelMessage[]} */
  const messages = [];
  /** @type {Map<string, string>} */
  const toolNames = new Map();

  if (typeof request.instructions === "string" && request.instructions.trim()) {
    messages.push({ role: "system", content: request.instructions });
  }

  const input = typeof request.input === "string" ? [
    { role: "user", content: [{ type: "input_text", text: request.input }] },
  ] : request.input;

  if (!Array.isArray(input)) {
    throw new RouterError("invalid_request", "Responses input must be a string or an array.", {
      status: 400,
    });
  }

  for (const item of input) {
    if (!object(item)) continue;

    if (item.type === "function_call" || item.type === "custom_tool_call") {
      const callId = text(item.call_id || item.id);
      const toolName = text(item.name);
      toolNames.set(callId, toolName);
      append(messages, {
        role: "assistant",
        content: [{
          type: "tool-call",
          toolCallId: callId,
          toolName,
          input: item.type === "custom_tool_call"
            ? { input: text(item.input) }
            : argumentsObject(item.arguments),
        }],
      });
      continue;
    }

    if (["function_call_output", "custom_tool_call_output"].includes(String(item.type))) {
      const callId = text(item.call_id || item.id);
      append(messages, {
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: callId,
          toolName: toolNames.get(callId) ?? "tool",
          output: toolOutput(item.output),
        }],
      });
      continue;
    }

    if (item.type === "message" || typeof item.role === "string") {
      const role = item.role;
      if (role === "assistant") {
        append(messages, { role: "assistant", content: assistantParts(item.content) });
      } else if (role === "system" || role === "developer") {
        messages.push({ role: "system", content: text(item.content) });
      } else {
        append(messages, { role: "user", content: userParts(item.content) });
      }
    }
  }

  return messages;
}

/** @param {unknown} rawTools */
export function modelTools(rawTools) {
  if (!Array.isArray(rawTools)) return undefined;

  /** @type {Record<string, ReturnType<typeof tool>>} */
  const tools = {};
  for (const candidate of rawTools) {
    if (!object(candidate) || typeof candidate.name !== "string") {
      continue;
    }

    if (candidate.type === "custom") {
      const format = customFormat(candidate.format);
      const description = typeof candidate.description === "string"
        ? candidate.description
        : "Use this freeform tool.";
      tools[candidate.name] = tool({
        description: [
          description,
          format ? `Freeform format:\n${format}` : "",
          "Return the complete freeform tool input in the `input` field.",
        ].filter(Boolean).join("\n\n"),
        inputSchema: jsonSchema({
          type: "object",
          properties: { input: { type: "string" } },
          required: ["input"],
          additionalProperties: false,
        }),
      });
      continue;
    }

    if (candidate.type !== "function") continue;

    tools[candidate.name] = tool({
      description: typeof candidate.description === "string" ? candidate.description : undefined,
      inputSchema: jsonSchema(object(candidate.parameters) ? candidate.parameters : {
        type: "object",
        properties: {},
      }),
    });
  }

  return Object.keys(tools).length ? tools : undefined;
}

/**
 * @param {unknown} choice
 * @returns {"auto" | "none" | "required" | { type: "tool", toolName: string } | undefined}
 */
export function modelToolChoice(choice) {
  if (choice === "auto" || choice === "none" || choice === "required") return choice;
  if (object(choice) && choice.type === "function" && typeof choice.name === "string") {
    return { type: "tool", toolName: choice.name };
  }
  return undefined;
}
