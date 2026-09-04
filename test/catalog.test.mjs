import assert from "node:assert/strict";
import test from "node:test";

import { discoverModelIds, mergedCatalog } from "../src/catalog.mjs";
import { modelProfiles, profileFor } from "../src/models.mjs";

test("ships a reviewed, internally consistent model catalog", () => {
  const profiles = modelProfiles();
  assert.equal(profiles.length, 38);
  assert.equal(new Set(profiles.map((profile) => profile.slug)).size, profiles.length);
  assert.ok(profiles.every((profile) => profile.slug.startsWith("commandcode")));
  assert.equal(profileFor("commandcode/step-3.7-flash")?.upstreamModel, "stepfun/Step-3.7-Flash");
});

test("merges native models and only discovered reviewed profiles", () => {
  const availableModelIds = new Set([
    "stepfun/Step-3.7-Flash",
    "model-that-has-no-reviewed-profile",
  ]);
  const catalog = mergedCatalog({ models: [{ slug: "native", display_name: "Native" }] }, {
    availableModelIds,
  });

  assert.deepEqual(catalog.models.map((model) => model.slug), [
    "native",
    "commandcode/step-3.7-flash",
  ]);
  assert.equal(catalog.models[1].apply_patch_tool_type, "freeform");
});

test("discovers model ids from the official provider shape", async () => {
  const ids = await discoverModelIds({
    baseURL: "https://command.test/v1",
    fetch: async (url) => {
      assert.equal(String(url), "https://command.test/v1/models");
      return Response.json({ data: [{ id: "one" }, { id: "two" }, { nope: true }] });
    },
  });
  assert.deepEqual([...ids], ["one", "two"]);
});

test("explains rejected keys and Go-plan entitlements without leaking bodies", async () => {
  await assert.rejects(
    () => discoverModelIds({
      fetch: async () => new Response("{\"secret\":\"nope\"}", { status: 401 }),
    }),
    { code: "invalid_api_key", message: "Command Code rejected the configured API key." },
  );
  await assert.rejects(
    () => discoverModelIds({
      fetch: async () => new Response("{\"error\":{\"code\":\"upgrade_required\"},\"secret\":\"nope\"}", {
        status: 403,
      }),
    }),
    {
      code: "upgrade_required",
      message: "Command Code Provider API access requires a GOAT or higher plan.",
    },
  );
});
