import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { bundledCatalog, install, uninstall } from "../src/installer.mjs";
import { storeApiKey } from "../src/key-store.mjs";
import { routerPaths } from "../src/paths.mjs";

/** @param {import("node:test").TestContext} t */
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "commandcode-router-install-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return routerPaths({ codexHome: path.join(directory, ".codex"), userHome: directory });
}

test("installs and uninstalls transactionally in an isolated Codex home", async (t) => {
  const paths = fixture(t);
  fs.mkdirSync(paths.codexHome, { recursive: true });
  const original = 'model = "native"\n\n[features]\nhooks = true\n';
  fs.writeFileSync(paths.codexConfig, original);
  storeApiKey("test-key", { paths });

  const result = await install({
    paths,
    port: 4399,
    service: false,
    nativeCatalog: { models: [{ slug: "native", display_name: "Native" }] },
    fetch: async () => Response.json({ data: [{ id: "stepfun/Step-3.7-Flash" }] }),
  });

  const configured = fs.readFileSync(paths.codexConfig, "utf8");
  const catalog = JSON.parse(fs.readFileSync(paths.catalog, "utf8"));
  assert.equal(result.modelCount, 1);
  assert.match(configured, /openai_base_url = "http:\/\/127\.0\.0\.1:4399\/_commandcode\//);
  assert.match(configured, /model_catalog_json/);
  assert.deepEqual(catalog.models.map((/** @type {{ slug: string }} */ model) => model.slug), [
    "native",
    "commandcode/step-3.7-flash",
  ]);
  assert.equal(fs.readFileSync(paths.backup, "utf8"), original);

  uninstall({ paths, service: false });
  assert.equal(fs.readFileSync(paths.codexConfig, "utf8"), original);
  assert.ok(fs.existsSync(paths.credentials));
  assert.ok(!fs.existsSync(paths.state));
  assert.ok(!fs.existsSync(paths.catalog));
});

test("does not touch a Codex config owned by another router", async (t) => {
  const paths = fixture(t);
  fs.mkdirSync(paths.codexHome, { recursive: true });
  const original = 'openai_base_url = "http://another-router"\n';
  fs.writeFileSync(paths.codexConfig, original);
  storeApiKey("test-key", { paths });

  await assert.rejects(
    () => install({
      paths,
      service: false,
      nativeCatalog: [],
      fetch: async () => Response.json({ data: [] }),
    }),
    /Refusing to replace user-owned openai_base_url/,
  );
  assert.equal(fs.readFileSync(paths.codexConfig, "utf8"), original);
  assert.ok(!fs.existsSync(paths.state));
});

test("parses the Codex bundled catalog through an injectable runner", () => {
  const catalog = bundledCatalog((command, args) => {
    assert.equal(command, "codex");
    assert.deepEqual(args, ["debug", "models", "--bundled"]);
    return JSON.stringify([{ slug: "native" }]);
  });
  assert.deepEqual(catalog, [{ slug: "native" }]);
});

test("rolls back files when service installation fails", async (t) => {
  const paths = fixture(t);
  fs.mkdirSync(paths.codexHome, { recursive: true });
  const original = 'model = "native"\n';
  fs.writeFileSync(paths.codexConfig, original);
  storeApiKey("test-key", { paths });
  let removed = false;

  await assert.rejects(() => install({
    paths,
    nativeCatalog: [],
    fetch: async () => Response.json({ data: [] }),
    serviceInstaller: () => { throw new Error("launch failed"); },
    serviceRemover: () => { removed = true; },
  }), /launch failed/);

  assert.equal(removed, true);
  assert.equal(fs.readFileSync(paths.codexConfig, "utf8"), original);
  assert.ok(fs.existsSync(paths.credentials));
  assert.ok(!fs.existsSync(paths.state));
  assert.ok(!fs.existsSync(paths.catalog));
  assert.ok(!fs.existsSync(paths.backup));
});

test("commits config only after the installed service is healthy", async (t) => {
  const paths = fixture(t);
  fs.mkdirSync(paths.codexHome, { recursive: true });
  fs.writeFileSync(paths.codexConfig, 'model = "native"\n');
  storeApiKey("test-key", { paths });
  let installed = false;

  await install({
    paths,
    nativeCatalog: [],
    fetch: async () => Response.json({ data: [] }),
    serviceInstaller: () => { installed = true; },
    healthFetch: async () => Response.json({ status: "ok" }),
  });

  assert.equal(installed, true);
  assert.match(fs.readFileSync(paths.codexConfig, "utf8"), /commandcode-router/);
  uninstall({ paths, service: false });
});
