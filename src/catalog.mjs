import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { COMMAND_CODE_API } from "./provider.mjs";
import { modelProfiles } from "./models.mjs";

const instructionsPath = fileURLToPath(new URL("../config/model-instructions.md", import.meta.url));
const MODEL_INSTRUCTIONS = fs.readFileSync(instructionsPath, "utf8").trim();

/** @param {import("./models.mjs").ModelProfile} profile */
function catalogEntry(profile) {
  const baseInstructions = MODEL_INSTRUCTIONS;
  return {
    slug: profile.slug,
    display_name: profile.displayName,
    description: profile.description,
    default_reasoning_level: profile.defaultEffort,
    supported_reasoning_levels: profile.reasoningLevels,
    shell_type: "unified_exec",
    visibility: "list",
    supported_in_api: true,
    priority: profile.priority,
    additional_speed_tiers: [],
    service_tiers: [],
    availability_nux: null,
    upgrade: null,
    base_instructions: baseInstructions,
    model_messages: {
      instructions_template: baseInstructions,
      instructions_variables: {
        personality_default: "",
        personality_friendly: "",
        personality_pragmatic: "",
      },
    },
    include_skills_usage_instructions: true,
    include_plugin_usage_instructions: true,
    include_apps_usage_instructions: true,
    default_reasoning_summary: "none",
    support_verbosity: false,
    default_verbosity: null,
    apply_patch_tool_type: "freeform",
    web_search_tool_type: "text_and_image",
    truncation_policy: {
      mode: "tokens",
      limit: 10_000,
    },
    supports_image_detail_original: false,
    context_window: profile.contextWindow,
    max_context_window: profile.contextWindow,
    comp_hash: profile.compHash,
    effective_context_window_percent: 90,
    experimental_supported_tools: [],
    input_modalities: profile.inputModalities,
    supports_search_tool: false,
    use_responses_lite: false,
    node_repl_auto_review_required: false,
    node_repl_disabled: false,
    auto_compact_token_limit: Math.floor(profile.contextWindow * 0.88),
    default_service_tier: null,
    supports_reasoning_summaries: true,
    supports_parallel_tool_calls: true,
    multi_agent_version: "v1",
  };
}

/**
 * Unknown upstream models stay out of Codex until a reviewed profile ships.
 * @param {{ fetch?: typeof globalThis.fetch, apiKey?: string, baseURL?: string }} [options]
 */
export async function discoverModelIds(options = {}) {
  const fetch = options.fetch ?? globalThis.fetch;
  const headers = options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : undefined;
  const response = await fetch(`${options.baseURL ?? COMMAND_CODE_API}/models`, { headers });
  if (!response.ok) throw new Error(`Command Code model discovery failed with HTTP ${response.status}.`);
  const payload = /** @type {{ data?: unknown }} */ (await response.json());
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.data)) {
    throw new Error("Command Code returned an invalid model catalog.");
  }
  return new Set(payload.data.flatMap((/** @type {unknown} */ model) => {
    if (!model || typeof model !== "object") return [];
    const id = /** @type {{ id?: unknown }} */ (model).id;
    return typeof id === "string" ? [id] : [];
  }));
}

/**
 * @param {unknown} nativeCatalog
 * @param {{ availableModelIds?: Set<string> }} [options]
 */
export function mergedCatalog(nativeCatalog, options = {}) {
  const nativeModels = Array.isArray(nativeCatalog)
    ? nativeCatalog
    : nativeCatalog &&
        typeof nativeCatalog === "object" &&
        Array.isArray(/** @type {{ models?: unknown }} */ (nativeCatalog).models)
      ? /** @type {{ models: unknown[] }} */ (nativeCatalog).models
      : [];
  const profiles = modelProfiles().filter((profile) =>
    !options.availableModelIds || options.availableModelIds.has(profile.upstreamModel)
  );
  return {
    models: [
      ...nativeModels,
      ...profiles.map(catalogEntry),
    ],
  };
}
