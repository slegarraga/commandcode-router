import { identifier } from "./ids.mjs";

/** @typedef {import("ai").TextStreamPart<Record<string, import("ai").Tool>>} TextStreamPart */

/** @param {unknown} value */
function errorMessage(value) {
  const status = value && typeof value === "object" && "statusCode" in value
    ? Number(value.statusCode)
    : undefined;
  const responseBody = value && typeof value === "object" && "responseBody" in value
    ? String(value.responseBody)
    : "";
  if (status === 403 && responseBody.includes("upgrade_required")) {
    return "Command Code Provider API access requires a GOAT or higher plan.";
  }
  if (status === 401) return "Command Code rejected the configured API key.";
  if (status === 429) return "Command Code rate-limited this request. Try again shortly.";
  if (status && status >= 500) return "Command Code is temporarily unavailable.";
  return "Command Code could not complete this request.";
}

export class ResponsesStream {
  /** @param {{ model: string, customTools?: Set<string>, now?: () => number }} options */
  constructor({ model, customTools = new Set(), now = Date.now }) {
    this.model = model;
    this.responseId = identifier("resp");
    this.messageId = identifier("msg");
    this.reasoningId = identifier("rs");
    this.createdAt = Math.floor(now() / 1000);
    this.sequence = 0;
    this.text = "";
    this.reasoning = "";
    this.textStarted = false;
    this.reasoningStarted = false;
    this.nextOutputIndex = 0;
    /** @type {number | null} */
    this.textOutputIndex = null;
    /** @type {number | null} */
    this.reasoningOutputIndex = null;
    /** @type {Array<Record<string, unknown> | undefined>} */
    this.output = [];
    this.customTools = customTools;
    /** @type {Map<string, { itemId: string, callId: string, name: string, arguments: string, outputIndex: number, custom: boolean }>} */
    this.calls = new Map();
  }

  nextSequence() {
    this.sequence += 1;
    return this.sequence;
  }

  /** @param {Record<string, unknown>} event */
  event(event) {
    return `event: ${event.type}\ndata: ${JSON.stringify({
      ...event,
      sequence_number: this.nextSequence(),
    })}\n\n`;
  }

  /**
   * @param {"in_progress" | "completed" | "failed"} status
   * @param {Record<string, number>} [usage]
   */
  response(status, usage) {
    return {
      id: this.responseId,
      object: "response",
      created_at: this.createdAt,
      status,
      model: this.model,
      output: this.output.filter((item) => item !== undefined),
      usage,
    };
  }

  started() {
    return this.event({
      type: "response.created",
      response: this.response("in_progress"),
    });
  }

  ensureText() {
    if (this.textStarted) return "";
    this.textStarted = true;
    this.textOutputIndex = this.nextOutputIndex++;
    return this.event({
      type: "response.output_item.added",
      output_index: this.textOutputIndex,
      item: {
        id: this.messageId,
        type: "message",
        role: "assistant",
        status: "in_progress",
        content: [],
      },
    }) + this.event({
      type: "response.content_part.added",
      item_id: this.messageId,
      output_index: this.textOutputIndex,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    });
  }

  ensureReasoning() {
    if (this.reasoningStarted) return "";
    this.reasoningStarted = true;
    this.reasoningOutputIndex = this.nextOutputIndex++;
    return this.event({
      type: "response.output_item.added",
      output_index: this.reasoningOutputIndex,
      item: {
        id: this.reasoningId,
        type: "reasoning",
        status: "in_progress",
        summary: [],
      },
    }) + this.event({
      type: "response.reasoning_summary_part.added",
      item_id: this.reasoningId,
      output_index: this.reasoningOutputIndex,
      summary_index: 0,
      part: { type: "summary_text", text: "" },
    });
  }

  /** @param {TextStreamPart} part */
  part(part) {
    switch (part.type) {
      case "text-delta": {
        this.text += part.text;
        return this.ensureText() + this.event({
          type: "response.output_text.delta",
          item_id: this.messageId,
          output_index: this.textOutputIndex,
          content_index: 0,
          delta: part.text,
          logprobs: [],
        });
      }
      case "reasoning-delta": {
        this.reasoning += part.text;
        return this.ensureReasoning() + this.event({
          type: "response.reasoning_summary_text.delta",
          item_id: this.reasoningId,
          output_index: this.reasoningOutputIndex,
          summary_index: 0,
          delta: part.text,
        });
      }
      case "tool-input-start": {
        const outputIndex = this.nextOutputIndex++;
        const call = {
          itemId: identifier("fc"),
          callId: part.id,
          name: part.toolName,
          arguments: "",
          outputIndex,
          custom: this.customTools.has(part.toolName),
        };
        this.calls.set(part.id, call);
        return this.callStarted(call);
      }
      case "tool-input-delta": {
        const call = this.calls.get(part.id);
        if (!call) return "";
        call.arguments += part.delta;
        return call.custom ? "" : this.event({
          type: "response.function_call_arguments.delta",
          item_id: call.itemId,
          output_index: call.outputIndex,
          delta: part.delta,
        });
      }
      case "tool-call": {
        let call = this.calls.get(part.toolCallId);
        let started = "";
        if (!call) {
          const outputIndex = this.nextOutputIndex++;
          call = {
            itemId: identifier("fc"),
            callId: part.toolCallId,
            name: part.toolName,
            arguments: "",
            outputIndex,
            custom: this.customTools.has(part.toolName),
          };
          this.calls.set(part.toolCallId, call);
          started = this.callStarted(call);
        }
        call.name = part.toolName;
        call.arguments = call.custom
          ? this.customInput(part.input)
          : call.arguments || JSON.stringify(part.input ?? {});
        return started + this.finishCall(call);
      }
      case "error":
        return this.event({
          type: "response.failed",
          response: {
            ...this.response("failed"),
            error: { code: "upstream_error", message: errorMessage(part.error) },
          },
        });
      default:
        return "";
    }
  }

  /** @param {{ itemId: string, callId: string, name: string, arguments: string, outputIndex: number, custom: boolean }} call */
  callStarted(call) {
    const item = call.custom ? {
      id: call.itemId,
      call_id: call.callId,
      type: "custom_tool_call",
      name: call.name,
      input: "",
      status: "in_progress",
    } : {
      id: call.itemId,
      call_id: call.callId,
      type: "function_call",
      name: call.name,
      arguments: "",
      status: "in_progress",
    };
    return this.event({
      type: "response.output_item.added",
      output_index: call.outputIndex,
      item,
    });
  }

  /** @param {unknown} input */
  customInput(input) {
    if (input && typeof input === "object" && "input" in input && typeof input.input === "string") {
      return input.input;
    }
    return typeof input === "string" ? input : JSON.stringify(input ?? "");
  }

  /** @param {{ itemId: string, callId: string, name: string, arguments: string, outputIndex: number, custom: boolean }} call */
  finishCall(call) {
    const item = call.custom ? {
      id: call.itemId,
      call_id: call.callId,
      type: "custom_tool_call",
      name: call.name,
      input: call.arguments,
      status: "completed",
    } : {
      id: call.itemId,
      call_id: call.callId,
      type: "function_call",
      name: call.name,
      arguments: call.arguments,
      status: "completed",
    };
    this.output[call.outputIndex] = item;
    return this.event({
      type: call.custom
        ? "response.custom_tool_call_input.delta"
        : "response.function_call_arguments.done",
      item_id: call.itemId,
      output_index: call.outputIndex,
      ...(call.custom ? { delta: call.arguments } : { arguments: call.arguments }),
      name: call.name,
    }) + (call.custom ? this.event({
      type: "response.custom_tool_call_input.done",
      item_id: call.itemId,
      output_index: call.outputIndex,
      input: call.arguments,
      name: call.name,
    }) : "") + this.event({
      type: "response.output_item.done",
      output_index: call.outputIndex,
      item,
    });
  }

  /** @param {{ inputTokens?: number, outputTokens?: number, totalTokens?: number }} [usage] */
  finished(usage = {}) {
    let frames = "";
    const finishText = () => {
      if (this.textOutputIndex === null) return "";
      const item = {
        id: this.messageId,
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: this.text, annotations: [] }],
      };
      this.output[this.textOutputIndex] = item;
      return this.event({
        type: "response.output_text.done",
        item_id: this.messageId,
        output_index: this.textOutputIndex,
        content_index: 0,
        text: this.text,
        logprobs: [],
      }) + this.event({
        type: "response.content_part.done",
        item_id: this.messageId,
        output_index: this.textOutputIndex,
        content_index: 0,
        part: item.content[0],
      }) + this.event({
        type: "response.output_item.done",
        output_index: this.textOutputIndex,
        item,
      });
    };
    const finishReasoning = () => {
      if (this.reasoningOutputIndex === null) return "";
      const item = {
        id: this.reasoningId,
        type: "reasoning",
        status: "completed",
        summary: [{ type: "summary_text", text: this.reasoning }],
      };
      this.output[this.reasoningOutputIndex] = item;
      return this.event({
        type: "response.reasoning_summary_text.done",
        item_id: this.reasoningId,
        output_index: this.reasoningOutputIndex,
        summary_index: 0,
        text: this.reasoning,
      }) + this.event({
        type: "response.reasoning_summary_part.done",
        item_id: this.reasoningId,
        output_index: this.reasoningOutputIndex,
        summary_index: 0,
        part: { type: "summary_text", text: this.reasoning },
      }) + this.event({
        type: "response.output_item.done",
        output_index: this.reasoningOutputIndex,
        item,
      });
    };
    const finalizers = [
      { index: this.textOutputIndex, finish: finishText },
      { index: this.reasoningOutputIndex, finish: finishReasoning },
    ].filter((entry) => entry.index !== null).sort((a, b) => Number(a.index) - Number(b.index));
    for (const finalizer of finalizers) frames += finalizer.finish();

    const responseUsage = {
      input_tokens: usage.inputTokens ?? 0,
      output_tokens: usage.outputTokens ?? 0,
      total_tokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
    };
    frames += this.event({
      type: "response.completed",
      response: this.response("completed", responseUsage),
    });
    return `${frames}data: [DONE]\n\n`;
  }
}
