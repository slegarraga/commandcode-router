import fs from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { atomicWrite } from "./files.mjs";
import { routerPaths } from "./paths.mjs";

const LABEL = "ai.commandcode.codex-router";
const cliPath = fileURLToPath(new URL("../bin/commandcode-router.mjs", import.meta.url));

/** @param {string} value */
function xml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** @param {{ paths?: ReturnType<typeof routerPaths>, nodePath?: string }} [options] */
export function launchAgent(options = {}) {
  const paths = options.paths ?? routerPaths();
  const nodePath = options.nodePath ?? process.execPath;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(nodePath)}</string>
    <string>${xml(cliPath)}</string>
    <string>serve</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CODEX_HOME</key>
    <string>${xml(paths.codexHome)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>${xml(paths.log)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(paths.log)}</string>
</dict>
</plist>
`;
}

function launchDomain() {
  return `gui/${process.getuid?.() ?? 0}`;
}

/** @param {string} raw */
function processId(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Number(parsed.pid);
  } catch {
    return Number(raw);
  }
}

/** @param {number} pid */
export function ownsRouterProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    const command = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return command.includes(cliPath) && /\sserve(?:\s|$)/.test(command);
  } catch {
    return false;
  }
}

/** @param {string[]} args @param {{ tolerateFailure?: boolean }} [options] */
function launchctl(args, options = {}) {
  try {
    execFileSync("launchctl", args, { stdio: "ignore" });
  } catch (error) {
    if (!options.tolerateFailure) throw error;
  }
}

/** @param {{ paths?: ReturnType<typeof routerPaths> }} [options] */
export function installService(options = {}) {
  const paths = options.paths ?? routerPaths();
  if (process.platform !== "darwin") {
    startDetached({ paths });
    return;
  }
  atomicWrite(paths.launchAgent, launchAgent({ paths }), 0o644);
  launchctl(["bootout", launchDomain(), paths.launchAgent], { tolerateFailure: true });
  launchctl(["bootstrap", launchDomain(), paths.launchAgent]);
}

/** @param {{ paths?: ReturnType<typeof routerPaths> }} [options] */
export function startDetached(options = {}) {
  const paths = options.paths ?? routerPaths();
  const log = fs.openSync(paths.log, "a", 0o600);
  const child = spawn(process.execPath, [cliPath, "serve"], {
    detached: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, CODEX_HOME: paths.codexHome },
  });
  child.unref();
  fs.closeSync(log);
}

/** @param {{ paths?: ReturnType<typeof routerPaths> }} [options] */
export function stopService(options = {}) {
  const paths = options.paths ?? routerPaths();
  if (process.platform === "darwin" && fs.existsSync(paths.launchAgent)) {
    launchctl(["bootout", launchDomain(), paths.launchAgent], { tolerateFailure: true });
  }
  try {
    const pid = processId(fs.readFileSync(paths.pid, "utf8"));
    if (ownsRouterProcess(pid)) process.kill(pid, "SIGTERM");
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
  }
  fs.rmSync(paths.pid, { force: true });
}

/** @param {{ paths?: ReturnType<typeof routerPaths> }} [options] */
export function removeService(options = {}) {
  const paths = options.paths ?? routerPaths();
  stopService({ paths });
  fs.rmSync(paths.launchAgent, { force: true });
}
