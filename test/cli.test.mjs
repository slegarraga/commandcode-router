import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ensureStoredApiKey, supportedNode } from "../src/cli.mjs";
import { loadApiKey, storeApiKey } from "../src/key-store.mjs";
import { routerPaths } from "../src/paths.mjs";

/** @param {import("node:test").TestContext} t */
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "commandcode-router-cli-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return routerPaths({ codexHome: path.join(directory, ".codex"), userHome: directory });
}

test("enforces the documented Node.js floor", () => {
  assert.equal(supportedNode("22.18.9"), false);
  assert.equal(supportedNode("22.19.0"), true);
  assert.equal(supportedNode("24.0.0"), true);
});

test("install prompts only when no API key is stored", async (t) => {
  const paths = fixture(t);
  let reads = 0;

  assert.equal(await ensureStoredApiKey(paths, async () => {
    reads += 1;
    return "first-key";
  }), true);
  assert.equal(loadApiKey({ paths, env: {} }), "first-key");
  assert.equal(reads, 1);

  assert.equal(await ensureStoredApiKey(paths, async () => {
    reads += 1;
    return "second-key";
  }), false);
  assert.equal(loadApiKey({ paths, env: {} }), "first-key");
  assert.equal(reads, 1);

  storeApiKey("replaced-key", { paths });
  assert.equal(loadApiKey({ paths, env: {} }), "replaced-key");
});
