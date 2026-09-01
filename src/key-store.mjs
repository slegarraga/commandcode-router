import fs from "node:fs";

import { atomicWrite, privateDirectory } from "./files.mjs";
import { routerPaths } from "./paths.mjs";

/**
 * @param {string} apiKey
 * @param {{ paths?: ReturnType<typeof routerPaths> }} [options]
 */
export function storeApiKey(apiKey, options = {}) {
  const value = apiKey.trim();
  if (!value) throw new Error("Command Code API key cannot be empty.");
  const paths = options.paths ?? routerPaths();
  privateDirectory(paths.stateDirectory);
  atomicWrite(paths.credentials, `${JSON.stringify({ apiKey: value }, null, 2)}\n`);
}

/** @param {{ paths?: ReturnType<typeof routerPaths>, env?: NodeJS.ProcessEnv }} [options] */
export function loadApiKey(options = {}) {
  const env = options.env ?? process.env;
  const fromEnvironment = env.COMMAND_CODE_API_KEY || env.COMMANDCODE_API_KEY;
  if (fromEnvironment?.trim()) return fromEnvironment.trim();

  const paths = options.paths ?? routerPaths();
  try {
    const payload = JSON.parse(fs.readFileSync(paths.credentials, "utf8"));
    return typeof payload.apiKey === "string" ? payload.apiKey.trim() : "";
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return "";
    throw error;
  }
}

/** @param {{ paths?: ReturnType<typeof routerPaths> }} [options] */
export function removeApiKey(options = {}) {
  const paths = options.paths ?? routerPaths();
  fs.rmSync(paths.credentials, { force: true });
}
