import os from "node:os";
import path from "node:path";

/**
 * @param {{ codexHome?: string, userHome?: string }} [options]
 */
export function routerPaths(options = {}) {
  const userHome = options.userHome ?? os.homedir();
  const codexHome = options.codexHome ?? process.env.CODEX_HOME ?? path.join(userHome, ".codex");
  const stateDirectory = path.join(codexHome, "commandcode-router");
  return {
    userHome,
    codexHome,
    stateDirectory,
    codexConfig: path.join(codexHome, "config.toml"),
    state: path.join(stateDirectory, "state.json"),
    credentials: path.join(stateDirectory, "credentials.json"),
    catalog: path.join(stateDirectory, "models.json"),
    backup: path.join(stateDirectory, "config.before-install.toml"),
    pid: path.join(stateDirectory, "router.pid"),
    log: path.join(stateDirectory, "router.log"),
    launchAgent: path.join(userHome, "Library", "LaunchAgents", "ai.commandcode.codex-router.plist"),
  };
}
