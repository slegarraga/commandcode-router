import fs from "node:fs";
import { Writable } from "node:stream";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { install, refreshCatalog, uninstall } from "./installer.mjs";
import { atomicWrite } from "./files.mjs";
import { loadApiKey, removeApiKey, storeApiKey } from "./key-store.mjs";
import { routerPaths } from "./paths.mjs";
import { installService, stopService } from "./service.mjs";
import { startServer } from "./server.mjs";
import { loadState, routerBaseURL } from "./state.mjs";

const packagePath = fileURLToPath(new URL("../package.json", import.meta.url));
const { version } = JSON.parse(fs.readFileSync(packagePath, "utf8"));

const HELP = `commandcode-router ${version}

Use Command Code models inside Codex. No menu bar, no separate UI.

Usage:
  commandcode-router install [--port 4219] [--no-service]
  commandcode-router key set
  commandcode-router status
  commandcode-router doctor
  commandcode-router models refresh
  commandcode-router start
  commandcode-router stop
  commandcode-router uninstall [--no-service]

install asks for a Command Code API key if one is not already stored.
The official Command Code Provider API requires GOAT or a higher plan.
`;

/** @param {string} nodeVersion */
export function supportedNode(nodeVersion) {
  const [major = 0, minor = 0] = nodeVersion.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 19);
}

/** @param {string[]} args @param {string} name */
function option(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function secretInput() {
  const fromEnvironment = process.env.COMMAND_CODE_API_KEY || process.env.COMMANDCODE_API_KEY;
  if (fromEnvironment?.trim()) return fromEnvironment.trim();
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8").trim();
  }

  let muted = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) process.stdout.write(chunk, encoding);
      callback();
    },
  });
  const readline = createInterface({ input: process.stdin, output, terminal: true });
  const answer = readline.question("Command Code API key (hidden): ");
  muted = true;
  const value = await answer;
  muted = false;
  readline.close();
  process.stdout.write("\n");
  return value.trim();
}

/**
 * @param {ReturnType<typeof routerPaths>} paths
 * @param {() => Promise<string>} [readSecret]
 */
export async function ensureStoredApiKey(paths, readSecret = secretInput) {
  if (loadApiKey({ paths })) return false;
  storeApiKey(await readSecret(), { paths });
  return true;
}

/** @param {ReturnType<typeof routerPaths>} paths */
async function health(paths) {
  const state = loadState({ paths });
  if (!state) return false;
  try {
    const response = await fetch(`${routerBaseURL(state)}/health`, {
      signal: AbortSignal.timeout(1_500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** @param {ReturnType<typeof routerPaths>} paths */
async function serve(paths) {
  const state = loadState({ paths });
  if (!state) throw new Error("Router is not installed.");
  const apiKey = loadApiKey({ paths });
  if (!apiKey) throw new Error("Command Code API key is not configured.");

  const server = /** @type {import("node:http").Server} */ (await startServer({
    secret: state.secret,
    port: state.port,
    apiKey,
  }));
  atomicWrite(paths.pid, `${JSON.stringify({ pid: process.pid })}\n`, 0o600);
  const shutdown = () => server.close(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.stdout.write(`commandcode-router listening on 127.0.0.1:${state.port}\n`);
}

/** @param {string[]} args */
export async function main(args) {
  const paths = routerPaths();
  const [command, subject] = args;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return;
  }
  if (command === "--version" || command === "version") {
    process.stdout.write(`${version}\n`);
    return;
  }

  if (command === "key" && subject === "set") {
    storeApiKey(await secretInput(), { paths });
    process.stdout.write("Command Code API key stored with mode 0600.\n");
    if (loadState({ paths })) installService({ paths });
    return;
  }
  if (command === "key" && subject === "remove") {
    removeApiKey({ paths });
    stopService({ paths });
    process.stdout.write("Command Code API key removed and router stopped.\n");
    return;
  }

  if (command === "install") {
    const rawPort = option(args, "--port");
    const port = rawPort === undefined ? undefined : Number(rawPort);
    if (port !== undefined && (!Number.isInteger(port) || port < 1024 || port > 65_535)) {
      throw new Error("--port must be an integer from 1024 through 65535.");
    }
    if (await ensureStoredApiKey(paths)) {
      process.stdout.write("Command Code API key stored with mode 0600.\n");
    }
    const result = await install({ paths, port, service: !args.includes("--no-service") });
    process.stdout.write(`Installed ${result.modelCount} reviewed Command Code models. Fully quit and reopen Codex.\n`);
    return;
  }

  if (command === "uninstall") {
    uninstall({ paths, service: !args.includes("--no-service") });
    process.stdout.write("Removed the Codex integration. The stored API key was preserved; use `key remove` to delete it.\n");
    return;
  }
  if (command === "serve") {
    await serve(paths);
    return;
  }
  if (command === "start") {
    if (!loadState({ paths })) throw new Error("Router is not installed.");
    installService({ paths });
    process.stdout.write("Router started.\n");
    return;
  }
  if (command === "stop") {
    stopService({ paths });
    process.stdout.write("Router stopped.\n");
    return;
  }
  if (command === "models" && subject === "refresh") {
    const modelCount = await refreshCatalog({ paths });
    process.stdout.write(`Refreshed ${modelCount} reviewed Command Code models. Fully quit and reopen Codex.\n`);
    return;
  }
  if (command === "status") {
    const state = loadState({ paths });
    process.stdout.write(`installed: ${state ? "yes" : "no"}\n`);
    process.stdout.write(`api key: ${loadApiKey({ paths }) ? "configured" : "missing"}\n`);
    process.stdout.write(`service: ${await health(paths) ? "running" : "stopped"}\n`);
    return;
  }
  if (command === "doctor") {
    const state = loadState({ paths });
    const checks = [
      ["Node.js 22.19+", supportedNode(process.versions.node)],
      ["installed", Boolean(state)],
      ["API key configured", Boolean(loadApiKey({ paths }))],
      ["model catalog present", fs.existsSync(paths.catalog)],
      ["headless service running", await health(paths)],
    ];
    for (const [label, passed] of checks) {
      process.stdout.write(`[${passed ? "OK" : "FAIL"}] ${label}\n`);
    }
    if (checks.some(([, passed]) => !passed)) process.exitCode = 1;
    return;
  }

  throw new Error(`Unknown command. Run \`commandcode-router help\`.`);
}
