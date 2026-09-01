import assert from "node:assert/strict";
import test from "node:test";

import { ResponsesStream } from "../src/responses-stream.mjs";

/** @param {string} stream */
function events(stream) {
  return stream
    .split("\n\n")
    .map((block) => block.split("\n").find((line) => line.startsWith("data: ")))
    .flatMap((line) => typeof line === "string" && line !== "data: [DONE]" ? [line] : [])
    .map((line) => JSON.parse(line.slice(6)));
}

test("emits a complete Responses text lifecycle", () => {
  const stream = new ResponsesStream({ model: "commandcode/example", now: () => 1_700_000_000_000 });
  const frames = stream.started()
    + stream.part({ type: "text-delta", id: "text_1", text: "hel" })
    + stream.part({ type: "text-delta", id: "text_1", text: "lo" })
    + stream.finished({ inputTokens: 7, outputTokens: 2, totalTokens: 9 });
  const parsed = events(frames);

  assert.deepEqual(parsed.map((event) => event.type), [
    "response.created",
    "response.output_item.added",
    "response.content_part.added",
    "response.output_text.delta",
    "response.output_text.delta",
    "response.output_text.done",
    "response.content_part.done",
    "response.output_item.done",
    "response.completed",
  ]);
  assert.equal(parsed.at(-1).response.output[0].content[0].text, "hello");
  assert.deepEqual(parsed.at(-1).response.usage, {
    input_tokens: 7,
    output_tokens: 2,
    total_tokens: 9,
  });
});

test("emits function call arguments and a completed item", () => {
  const stream = new ResponsesStream({ model: "commandcode/example" });
  const frames = stream.started()
    + stream.part({ type: "tool-input-start", id: "call_1", toolName: "read_file" })
    + stream.part({ type: "tool-input-delta", id: "call_1", delta: '{"path":' })
    + stream.part({ type: "tool-input-delta", id: "call_1", delta: '"README.md"}' })
    + stream.part({
      type: "tool-call",
      toolCallId: "call_1",
      toolName: "read_file",
      input: { path: "README.md" },
      providerExecuted: false,
      dynamic: false,
    })
    + stream.finished();
  const parsed = events(frames);

  assert.equal(parsed.filter((event) => event.type === "response.function_call_arguments.delta").length, 2);
  const done = parsed.find((event) => event.type === "response.output_item.done");
  assert.equal(done.item.name, "read_file");
  assert.equal(done.item.arguments, '{"path":"README.md"}');
  assert.equal(parsed.at(-1).response.output[0].type, "function_call");
});

test("reconstructs a freeform apply_patch call for Codex", () => {
  const stream = new ResponsesStream({
    model: "commandcode/example",
    customTools: new Set(["apply_patch"]),
  });
  const frames = stream.started()
    + stream.part({ type: "tool-input-start", id: "patch_1", toolName: "apply_patch" })
    + stream.part({ type: "tool-input-delta", id: "patch_1", delta: '{"input":"ignored partial"}' })
    + stream.part({
      type: "tool-call",
      toolCallId: "patch_1",
      toolName: "apply_patch",
      input: { input: "*** Begin Patch\n*** End Patch" },
      providerExecuted: false,
      dynamic: false,
    })
    + stream.finished();
  const parsed = events(frames);

  assert.ok(!parsed.some((event) => event.type === "response.function_call_arguments.delta"));
  assert.equal(
    parsed.find((event) => event.type === "response.output_item.added")?.item.type,
    "custom_tool_call",
  );
  assert.equal(
    parsed.find((event) => event.type === "response.custom_tool_call_input.done")?.input,
    "*** Begin Patch\n*** End Patch",
  );
  assert.deepEqual(parsed.at(-1).response.output[0], {
    id: parsed.at(-1).response.output[0].id,
    call_id: "patch_1",
    type: "custom_tool_call",
    name: "apply_patch",
    input: "*** Begin Patch\n*** End Patch",
    status: "completed",
  });
});

test("adds a tool item even when the provider emits only a completed tool call", () => {
  const stream = new ResponsesStream({ model: "commandcode/example" });
  const parsed = events(
    stream.started()
    + stream.part({
      type: "tool-call",
      toolCallId: "call_1",
      toolName: "read_file",
      input: { path: "README.md" },
      providerExecuted: false,
      dynamic: false,
    })
    + stream.finished(),
  );
  assert.deepEqual(
    parsed.filter((event) => event.type.startsWith("response.output_item")).map((event) => event.type),
    ["response.output_item.added", "response.output_item.done"],
  );
});

test("emits a complete reasoning summary before following text", () => {
  const stream = new ResponsesStream({ model: "commandcode/example" });
  const frames = stream.started()
    + stream.part({ type: "reasoning-delta", id: "reasoning_1", text: "Think." })
    + stream.part({ type: "text-delta", id: "text_1", text: "Done." })
    + stream.finished();
  const parsed = events(frames);

  assert.deepEqual(
    parsed.filter((event) => /reasoning_summary/.test(event.type)).map((event) => event.type),
    [
      "response.reasoning_summary_part.added",
      "response.reasoning_summary_text.delta",
      "response.reasoning_summary_text.done",
      "response.reasoning_summary_part.done",
    ],
  );
  const output = parsed.at(-1).response.output;
  assert.equal(output[0].type, "reasoning");
  assert.equal(output[0].summary[0].text, "Think.");
  assert.equal(output[1].type, "message");
  assert.equal(output[1].content[0].text, "Done.");
});

test("turns the official Go-plan entitlement error into actionable safe copy", () => {
  const stream = new ResponsesStream({ model: "commandcode/example" });
  const frames = stream.started() + stream.part({
    type: "error",
    error: {
      statusCode: 403,
      responseBody: '{"error":{"code":"upgrade_required"},"secret":"do-not-echo"}',
    },
  });
  const failed = events(frames).at(-1);

  assert.equal(failed.type, "response.failed");
  assert.equal(
    failed.response.error.message,
    "Command Code Provider API access requires a GOAT or higher plan.",
  );
  assert.doesNotMatch(JSON.stringify(failed), /do-not-echo/);
});
