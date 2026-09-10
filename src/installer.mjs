import fs from "node:fs";
import { execFileSync } from "node:child_process";

import { discoverModelIds, mergedCatalog } from "./catalog.mjs";
import { installConfig, uninstallConfig } from "./codex-config.mjs";
import { atomicWrite, privateDirectory } from "./files.mjs";
import { loadApiKey } from "./key-store.mjs";
import { routerPaths } from "./paths.mjs";
import { installService, removeService } from "./service.mjs";
import { loadState, newState, removeState, routerBaseURL, storeState } from "./state.mjs";

/** @param {string} filename */
function contentsOrEmpty(filename) {
  try {
    return fs.readFileSync(filename, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return "";
    throw error;
  }
}

/** @param {import("./state.mjs").RouterState} state @param {typeof globalThis.fetch} fetch */
async function waitForService(state, fetch) {
  const url = `${routerBaseURL(state)}/health`;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      // The process may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Headless router service did not become healthy after installation.");
}

/** @param {(command: string, args: string[]) => string} [run] */
export function bundledCatalog(run = (command, args) =>
  execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
) {
  const parsed = JSON.parse(run("codex", ["debug", "models", "--bundled"]));
  if (!Array.isArray(parsed) && !(parsed && typeof parsed === "object" && Array.isArray(parsed.models))) {
    throw new Error("Codex returned an invalid bundled model catalog.");
  }
  return parsed;
}

/**
 * Prefer Codex's account-scoped remote cache. The bundled catalog is only a
 * bootstrap fallback for a Codex home that has not fetched its first catalog.
 *
 * @param {{ paths?: ReturnType<typeof routerPaths>, run?: (command: string, args: string[]) => string }} [options]
 */
export function currentNativeCatalog(options = {}) {
  const paths = options.paths ?? routerPaths();
  try {
    const parsed = JSON.parse(fs.readFileSync(paths.codexModelsCache, "utf8"));
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.models) || parsed.models.length === 0) {
      throw new Error("Codex returned an invalid cached model catalog.");
    }
    return parsed;
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    return bundledCatalog(options.run);
  }
}

/**
 * @param {{
 *   paths?: ReturnType<typeof routerPaths>,
 *   fetch?: typeof globalThis.fetch,
 *   nativeCatalog?: unknown,
 * }} [options]
 */
export async function refreshCatalog(options = {}) {
  const paths = options.paths ?? routerPaths();
  const availableModelIds = await discoverModelIds({
    fetch: options.fetch,
    apiKey: loadApiKey({ paths }),
  });
  const catalog = mergedCatalog(options.nativeCatalog ?? currentNativeCatalog({ paths }), { availableModelIds });
  privateDirectory(paths.stateDirectory);
  const encoded = `${JSON.stringify(catalog, null, 2)}\n`;
  if (contentsOrEmpty(paths.catalog) !== encoded) atomicWrite(paths.catalog, encoded, 0o600);
  return catalog.models.filter((model) => String(model.slug).startsWith("commandcode")).length;
}

/**
 * Keep the generated picker catalog reconciled with both providers. Codex
 * cache changes trigger an immediate refresh; the interval also discovers
 * newly available reviewed Command Code models.
 *
 * @param {{
 *   paths?: ReturnType<typeof routerPaths>,
 *   refresh?: () => Promise<unknown>,
 *   logger?: Pick<Console, "info" | "error">,
 *   watchFile?: (filename: string, options: { interval: number, persistent: boolean }, listener: (current: Pick<fs.Stats, "mtimeMs" | "size" | "ino">, previous: Pick<fs.Stats, "mtimeMs" | "size" | "ino">) => void) => void,
 *   unwatchFile?: (filename: string, listener: (current: Pick<fs.Stats, "mtimeMs" | "size" | "ino">, previous: Pick<fs.Stats, "mtimeMs" | "size" | "ino">) => void) => void,
 *   setIntervalFn?: (callback: () => void, interval: number) => { unref?: () => void },
 *   clearIntervalFn?: (timer: { unref?: () => void }) => void,
 *   watchIntervalMs?: number,
 *   refreshIntervalMs?: number,
 * }} [options]
 */
export async function startCatalogSync(options = {}) {
  const paths = options.paths ?? routerPaths();
  const logger = options.logger ?? console;
  const refresh = options.refresh ?? (() => refreshCatalog({ paths }));
  const watchFile = options.watchFile ?? ((filename, watchOptions, listener) => {
    fs.watchFile(filename, watchOptions, listener);
  });
  const unwatchFile = options.unwatchFile ?? ((filename, listener) => fs.unwatchFile(filename, listener));
  const setIntervalFn = options.setIntervalFn ?? ((callback, interval) => setInterval(callback, interval));
  const clearIntervalFn = options.clearIntervalFn ?? ((timer) => clearInterval(/** @type {NodeJS.Timeout} */ (timer)));
  let closed = false;
  let running = false;
  let queued = false;

  const reconcile = async () => {
    if (closed) return;
    if (running) {
      queued = true;
      return;
    }
    running = true;
    do {
      queued = false;
      try {
        await refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown catalog refresh error.";
        logger.error(`Catalog refresh failed: ${message}`);
      }
    } while (queued && !closed);
    running = false;
  };

  await reconcile();

  /**
   * @param {Pick<fs.Stats, "mtimeMs" | "size" | "ino">} current
   * @param {Pick<fs.Stats, "mtimeMs" | "size" | "ino">} previous
   */
  const listener = (current, previous) => {
    if (
      current.mtimeMs === previous.mtimeMs &&
      current.size === previous.size &&
      current.ino === previous.ino
    ) return;
    void reconcile();
  };
  watchFile(paths.codexModelsCache, {
    interval: options.watchIntervalMs ?? 1_000,
    persistent: false,
  }, listener);
  const timer = setIntervalFn(() => void reconcile(), options.refreshIntervalMs ?? 5 * 60_000);
  timer.unref?.();

  return {
    refresh: reconcile,
    close() {
      if (closed) return;
      closed = true;
      unwatchFile(paths.codexModelsCache, listener);
      clearIntervalFn(timer);
    },
  };
}

/**
 * @param {{
 *   paths?: ReturnType<typeof routerPaths>,
 *   port?: number,
 *   fetch?: typeof globalThis.fetch,
 *   nativeCatalog?: unknown,
 *   service?: boolean,
 *   serviceInstaller?: typeof installService,
 *   serviceRemover?: typeof removeService,
 *   healthFetch?: typeof globalThis.fetch,
 * }} [options]
 */
export async function install(options = {}) {
  const paths = options.paths ?? routerPaths();
  if (!loadApiKey({ paths })) {
    throw new Error("Store a Command Code API key first with `commandcode-router key set`.");
  }

  const existingState = loadState({ paths });
  if (existingState && options.port !== undefined && options.port !== existingState.port) {
    throw new Error("Router is already installed on a different port. Uninstall it before changing ports.");
  }
  const state = existingState ?? newState({ port: options.port });
  const configExisted = fs.existsSync(paths.codexConfig);
  const catalogExisted = fs.existsSync(paths.catalog);
  const previousCatalog = catalogExisted ? fs.readFileSync(paths.catalog) : null;
  const original = contentsOrEmpty(paths.codexConfig);
  const configured = installConfig(original, {
    baseURL: routerBaseURL(state),
    catalogPath: paths.catalog,
  });

  const modelCount = await refreshCatalog({
    paths,
    fetch: options.fetch,
    nativeCatalog: options.nativeCatalog,
  });
  const serviceInstaller = options.serviceInstaller ?? installService;
  const serviceRemover = options.serviceRemover ?? removeService;
  try {
    privateDirectory(paths.stateDirectory);
    if (!existingState) atomicWrite(paths.backup, original, 0o600);
    storeState(state, { paths });
    if (options.service !== false) {
      serviceInstaller({ paths });
      await waitForService(state, options.healthFetch ?? globalThis.fetch);
    }
    atomicWrite(paths.codexConfig, configured, 0o600);
    return { state, modelCount };
  } catch (error) {
    if (options.service !== false) {
      try {
        serviceRemover({ paths });
      } catch {
        // Preserve the installation error; doctor will expose any remaining service.
      }
    }
    if (configExisted) atomicWrite(paths.codexConfig, original, 0o600);
    else fs.rmSync(paths.codexConfig, { force: true });
    if (!existingState) {
      removeState({ paths });
      fs.rmSync(paths.backup, { force: true });
    }
    if (previousCatalog) atomicWrite(paths.catalog, previousCatalog, 0o600);
    else fs.rmSync(paths.catalog, { force: true });
    throw error;
  }
}

/** @param {{ paths?: ReturnType<typeof routerPaths>, service?: boolean }} [options] */
export function uninstall(options = {}) {
  const paths = options.paths ?? routerPaths();
  if (options.service !== false) removeService({ paths });
  const original = contentsOrEmpty(paths.codexConfig);
  const cleaned = uninstallConfig(original);
  if (cleaned !== original) atomicWrite(paths.codexConfig, cleaned, 0o600);
  fs.rmSync(paths.catalog, { force: true });
  fs.rmSync(paths.backup, { force: true });
  fs.rmSync(paths.pid, { force: true });
  removeState({ paths });
}
