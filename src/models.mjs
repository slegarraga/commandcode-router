import fs from "node:fs";
import { fileURLToPath } from "node:url";

const profilesPath = fileURLToPath(new URL("../config/models.json", import.meta.url));

/** @typedef {{ slug: string, upstreamModel: string, protocol: "openai" | "anthropic", displayName: string, description: string, priority: number, defaultEffort: string, reasoningLevels: Array<{ effort: string, description: string }>, contextWindow: number, inputModalities: string[], compHash: string }} ModelProfile */

/** @returns {ModelProfile[]} */
function readProfiles() {
  const parsed = JSON.parse(fs.readFileSync(profilesPath, "utf8"));
  if (parsed.version !== 1 || !Array.isArray(parsed.models)) {
    throw new Error("Unsupported Command Code model profile format.");
  }
  return parsed.models;
}

const PROFILES = readProfiles();

/** @returns {ModelProfile[]} */
export function modelProfiles() {
  return PROFILES;
}

/** @param {string} slug */
export function profileFor(slug) {
  return PROFILES.find((profile) => profile.slug === slug);
}
