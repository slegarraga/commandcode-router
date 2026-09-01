import assert from "node:assert/strict";
import test from "node:test";

import { supportedNode } from "../src/cli.mjs";

test("enforces the documented Node.js floor", () => {
  assert.equal(supportedNode("22.18.9"), false);
  assert.equal(supportedNode("22.19.0"), true);
  assert.equal(supportedNode("24.0.0"), true);
});
