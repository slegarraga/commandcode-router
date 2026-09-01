import assert from "node:assert/strict";
import test from "node:test";

import { publicError, RouterError } from "../src/errors.mjs";

test("exposes deliberate router errors without exposing their details", () => {
  const error = new RouterError("invalid_request", "Safe message", {
    status: 400,
    details: { secret: "hidden" },
  });
  assert.equal(error.status, 400);
  assert.deepEqual(publicError(error), {
    error: {
      type: "invalid_request",
      code: "invalid_request",
      message: "Safe message",
    },
  });
  assert.doesNotMatch(JSON.stringify(publicError(error)), /hidden/);
});

test("collapses unexpected errors to a stable public error", () => {
  assert.deepEqual(publicError(new Error("private upstream body")), {
    error: {
      type: "router_error",
      code: "router_error",
      message: "The router could not complete this request.",
    },
  });
});
