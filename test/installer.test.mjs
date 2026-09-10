import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  bundledCatalog,
  currentNativeCatalog,
  install,
  refreshCatalog,
  startCatalogSync,
  uninstall,
} from "../src/installer.mjs";
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
  assert.match(configured, /model_provider = "commandcode_router"/);
  assert.match(configured, /supports_websockets = false/);
  assert.match(configured, /model_providers\.commandcode_router = \{ .*http:\/\/127\.0\.0\.1:4399\/_commandcode\//);
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

test("prefers Codex's account-scoped cache over the bundled catalog", (t) => {
  const paths = fixture(t);
  fs.mkdirSync(paths.codexHome, { recursive: true });
  fs.writeFileSync(paths.codexModelsCache, JSON.stringify({
    fetched_at: "2026-09-04T23:00:00Z",
    models: [{ slug: "gpt-6-astra", display_name: "GPT-6-Astra" }],
  }));

  const catalog = currentNativeCatalog({
    paths,
    run: () => { throw new Error("bundled fallback should not run"); },
  });
  assert.deepEqual(catalog.models.map((/** @type {{ slug: string }} */ model) => model.slug), ["gpt-6-astra"]);
});

test("falls back to the bundled catalog only before Codex creates its cache", (t) => {
  const paths = fixture(t);
  const catalog = currentNativeCatalog({
    paths,
    run: (command, args) => {
      assert.equal(command, "codex");
      assert.deepEqual(args, ["debug", "models", "--bundled"]);
      return JSON.stringify([{ slug: "bundled-native" }]);
    },
  });
  assert.deepEqual(catalog, [{ slug: "bundled-native" }]);
});

test("preserves the last known-good output when Codex's cache is invalid", (t) => {
  const paths = fixture(t);
  fs.mkdirSync(paths.codexHome, { recursive: true });
  fs.writeFileSync(paths.codexModelsCache, "{not-json");
  assert.throws(() => currentNativeCatalog({ paths }), SyntaxError);
});

test("refreshes the installed catalog from Codex's remote cache and Command Code discovery", async (t) => {
  const paths = fixture(t);
  fs.mkdirSync(paths.codexHome, { recursive: true });
  fs.writeFileSync(paths.codexModelsCache, JSON.stringify({
    models: [{ slug: "gpt-6-astra", display_name: "GPT-6-Astra" }],
  }));
  storeApiKey("test-key", { paths });

  const count = await refreshCatalog({
    paths,
    fetch: async () => Response.json({ data: [{ id: "stepfun/Step-3.7-Flash" }] }),
  });
  const catalog = JSON.parse(fs.readFileSync(paths.catalog, "utf8"));
  assert.equal(count, 1);
  assert.deepEqual(catalog.models.map((/** @type {{ slug: string }} */ model) => model.slug), [
    "gpt-6-astra",
    "commandcode/step-3.7-flash",
  ]);
});

test("watches Codex changes and periodically reconciles both catalogs", async (t) => {
  const paths = fixture(t);
  /** @type {((current: { mtimeMs: number, size: number, ino: number }, previous: { mtimeMs: number, size: number, ino: number }) => void) | undefined} */
  let listener;
  /** @type {(() => void) | undefined} */
  let periodic;
  let refreshes = 0;
  let unwatched = false;
  let cleared = false;
  const sync = await startCatalogSync({
    paths,
    refresh: async () => { refreshes += 1; },
    watchFile: (_filename, _options, callback) => { listener = callback; },
    unwatchFile: () => { unwatched = true; },
    setIntervalFn: (callback) => {
      periodic = callback;
      return { unref() {} };
    },
    clearIntervalFn: () => { cleared = true; },
  });
  assert.equal(refreshes, 1);

  assert.ok(listener);
  listener({ mtimeMs: 2, size: 2, ino: 2 }, { mtimeMs: 1, size: 1, ino: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(refreshes, 2);
  assert.ok(periodic);
  periodic();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(refreshes, 3);

  sync.close();
  assert.equal(unwatched, true);
  assert.equal(cleared, true);
});

test("uses filesystem watching and a periodic timer with production defaults", async (t) => {
  const paths = fixture(t);
  let refreshes = 0;
  const sync = await startCatalogSync({
    paths,
    refresh: async () => { refreshes += 1; },
    watchIntervalMs: 10,
    refreshIntervalMs: 10,
  });
  await new Promise((resolve) => setTimeout(resolve, 35));
  sync.close();
  assert.ok(refreshes >= 2);
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
