import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { mergedCatalog } from "../src/catalog.mjs";
import { bundledCatalog } from "../src/installer.mjs";
import { modelProfiles } from "../src/models.mjs";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "commandcode-router-catalog-"));
try {
  const catalogPath = path.join(temporary, "models.json");
  const catalog = mergedCatalog(bundledCatalog());
  fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  fs.writeFileSync(
    path.join(temporary, "config.toml"),
    `model_catalog_json = ${JSON.stringify(catalogPath)}\n`,
  );
  const output = execFileSync("codex", ["debug", "models"], {
    encoding: "utf8",
    env: { ...process.env, CODEX_HOME: temporary },
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  });
  const parsed = JSON.parse(output);
  /** @type {Array<Record<string, unknown>>} */
  const models = Array.isArray(parsed) ? parsed : parsed.models;
  const routed = models.filter((model) => String(model.slug).startsWith("commandcode"));
  assert.equal(routed.length, modelProfiles().length);
  assert.ok(routed.every((model) => model.apply_patch_tool_type === "freeform"));
  process.stdout.write(`Codex accepted ${routed.length} Command Code model profiles.\n`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
