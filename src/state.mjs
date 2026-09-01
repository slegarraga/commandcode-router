import fs from "node:fs";
import { randomBytes } from "node:crypto";

import { atomicWrite, privateDirectory, readJson } from "./files.mjs";
import { routerPaths } from "./paths.mjs";

/** @typedef {{ version: 1, secret: string, port: number, installedAt: string }} RouterState */

/** @param {{ port?: number }} [options] @returns {RouterState} */
export function newState(options = {}) {
  return {
    version: 1,
    secret: randomBytes(32).toString("base64url"),
    port: options.port ?? 4219,
    installedAt: new Date().toISOString(),
  };
}

/** @param {{ paths?: ReturnType<typeof routerPaths> }} [options] @returns {RouterState | null} */
export function loadState(options = {}) {
  const paths = options.paths ?? routerPaths();
  try {
    const state = readJson(paths.state);
    if (
      state.version !== 1 ||
      typeof state.secret !== "string" ||
      !Number.isInteger(state.port)
    ) {
      throw new Error("Invalid commandcode-router state file.");
    }
    return state;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

/** @param {RouterState} state @param {{ paths?: ReturnType<typeof routerPaths> }} [options] */
export function storeState(state, options = {}) {
  const paths = options.paths ?? routerPaths();
  privateDirectory(paths.stateDirectory);
  atomicWrite(paths.state, `${JSON.stringify(state, null, 2)}\n`);
}

/** @param {{ paths?: ReturnType<typeof routerPaths> }} [options] */
export function removeState(options = {}) {
  const paths = options.paths ?? routerPaths();
  fs.rmSync(paths.state, { force: true });
}

/** @param {RouterState} state */
export function routerBaseURL(state) {
  return `http://127.0.0.1:${state.port}/_commandcode/${state.secret}/v1`;
}
