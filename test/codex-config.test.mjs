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
  assert.throws(
    () => installConfig('model_provider = "another"\n', options),
    /Refusing to replace user-owned model_provider/,
  );
  assert.throws(
    () => installConfig('model_providers.commandcode_router = { base_url = "http://another" }\n', options),
    /Refusing to replace user-owned model_providers\.commandcode_router/,
  );
  assert.throws(
    () => installConfig('[model_providers.commandcode_router]\nbase_url = "http://another"\n', options),
    /Refusing to replace user-owned model_providers\.commandcode_router/,
  );
});

test("selects an HTTPS-only custom provider and upgrades the legacy block", () => {
  const block = managedBlock(options);
  assert.match(block, /^model_provider = "commandcode_router"$/m);
  assert.match(block, /supports_websockets = false/);
  assert.match(block, /requires_openai_auth = true/);
  assert.doesNotMatch(block, /openai_base_url/);

  const legacy = [
    "# >>> commandcode-router >>>",
    'openai_base_url = "http://127.0.0.1:4219/_commandcode/old/v1"',
    'model_catalog_json = "/tmp/old.json"',
    "# <<< commandcode-router <<<",
    "",
    'model = "native"',
    "",
  ].join("\n");
  const upgraded = installConfig(legacy, options);

  assert.ok(upgraded.startsWith(block));
  assert.match(upgraded, /model = "native"/);
  assert.equal(installConfig(upgraded, options), upgraded);
  assert.equal(uninstallConfig(upgraded), 'model = "native"\n');
});

test("rejects damaged ownership markers", () => {
  assert.throws(
    () => uninstallConfig("# >>> commandcode-router >>>\n"),
    /incomplete commandcode-router marker block/,
  );
});
