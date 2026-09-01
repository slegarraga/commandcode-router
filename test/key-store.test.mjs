import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadApiKey, removeApiKey, storeApiKey } from "../src/key-store.mjs";
import { routerPaths } from "../src/paths.mjs";

test("stores credentials privately and lets environment override them", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "commandcode-router-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const paths = routerPaths({ codexHome: path.join(directory, ".codex"), userHome: directory });

  storeApiKey("stored-key", { paths });
  assert.equal(loadApiKey({ paths, env: {} }), "stored-key");
  assert.equal(loadApiKey({ paths, env: { COMMAND_CODE_API_KEY: "environment-key" } }), "environment-key");
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(paths.credentials).mode & 0o777, 0o600);
    assert.equal(fs.statSync(paths.stateDirectory).mode & 0o777, 0o700);
  }

  removeApiKey({ paths });
  assert.equal(loadApiKey({ paths, env: {} }), "");
});
