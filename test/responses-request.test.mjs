import assert from "node:assert/strict";
import test from "node:test";

import { modelMessages, modelToolChoice, modelTools } from "../src/responses-request.mjs";

test("converts Responses history without losing tool identity", () => {
  const messages = modelMessages({
    instructions: "Be precise.",
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Read the file" }],
      },
      {
        type: "function_call",
        id: "fc_1",
        call_id: "call_1",
        name: "read_file",
        arguments: '{"path":"README.md"}',
      },
      {
        type: "function_call_output",
        call_id: "call_1",
        output: "contents",
      },
    ],
  });

  assert.deepEqual(messages, [
    { role: "system", content: "Be precise." },
    { role: "user", content: [{ type: "text", text: "Read the file" }] },
    {
      role: "assistant",
      content: [{
        type: "tool-call",
        toolCallId: "call_1",
        toolName: "read_file",
        input: { path: "README.md" },
      }],
    },
    {
      role: "tool",
      content: [{
        type: "tool-result",
        toolCallId: "call_1",
        toolName: "read_file",
        output: { type: "text", value: "contents" },
      }],
    },
  ]);
});

test("builds SDK tools from Responses function definitions", () => {
  const tools = modelTools([{
    type: "function",
    name: "read_file",
    description: "Read one file",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  }]);

  assert.ok(tools?.read_file);
  assert.equal(tools.read_file.description, "Read one file");
  assert.deepEqual(modelToolChoice({ type: "function", name: "read_file" }), {
    type: "tool",
    toolName: "read_file",
  });
});

test("bridges freeform Codex tools through a function-shaped input", () => {
  const tools = modelTools([{
    type: "custom",
    name: "apply_patch",
    description: "Apply a patch.",
    format: { type: "grammar", definition: "start: patch" },
  }]);
  assert.ok(tools?.apply_patch);
  assert.equal(typeof tools.apply_patch.description, "string");
  assert.match(String(tools.apply_patch.description), /freeform tool input/);
  assert.match(String(tools.apply_patch.description), /start: patch/);

  assert.deepEqual(modelMessages({
    input: [{
      type: "custom_tool_call",
      call_id: "patch_1",
      name: "apply_patch",
      input: "*** Begin Patch",
    }],
  }), [{
    role: "assistant",
    content: [{
      type: "tool-call",
      toolCallId: "patch_1",
      toolName: "apply_patch",
      input: { input: "*** Begin Patch" },
    }],
  }]);
});

test("rejects malformed Responses input", () => {
  assert.throws(
    () => modelMessages({ input: { role: "user" } }),
    { code: "invalid_request", status: 400 },
  );
});
