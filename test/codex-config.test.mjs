import assert from "node:assert/strict";
import test from "node:test";

import { installConfig, managedBlock, uninstallConfig } from "../src/codex-config.mjs";

const options = {
  baseURL: "http://127.0.0.1:4219/_commandcode/secret/v1",
  catalogPath: "/tmp/models.json",
};

test("installs before TOML tables and uninstalls cleanly", () => {
  const original = 'model = "native"\n\n[features]\nhooks = true\n';
  const installed = installConfig(original, options);

  assert.ok(installed.startsWith(`${managedBlock(options)}\n\nmodel = "native"`));
  assert.equal(installConfig(installed, options), installed);
  assert.equal(uninstallConfig(installed), original);
});

test("refuses to replace another router or user catalog", () => {
  assert.throws(
    () => installConfig('openai_base_url = "http://another-router"\n', options),
    /Refusing to replace user-owned openai_base_url/,
  );
  assert.throws(
    () => installConfig('model_catalog_json = "/mine.json"\n', options),
    /Refusing to replace user-owned model_catalog_json/,
  );
});

test("rejects damaged ownership markers", () => {
  assert.throws(
    () => uninstallConfig("# >>> commandcode-router >>>\n"),
    /incomplete commandcode-router marker block/,
  );
});
