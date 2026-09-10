const START = "# >>> commandcode-router >>>";
const END = "# <<< commandcode-router <<<";

/** @param {string} value */
function tomlString(value) {
  return JSON.stringify(value);
}

/** @param {{ baseURL: string, catalogPath: string }} options */
export function managedBlock(options) {
  const provider = [
    'name = "Command Code Router"',
    `base_url = ${tomlString(options.baseURL)}`,
    'wire_api = "responses"',
    "requires_openai_auth = true",
    "supports_websockets = false",
  ].join(", ");
  return [
    START,
    'model_provider = "commandcode_router"',
    `model_catalog_json = ${tomlString(options.catalogPath)}`,
    `model_providers.commandcode_router = { ${provider} }`,
    END,
  ].join("\n");
}

/** @param {string} contents */
function markerRange(contents) {
  const start = contents.indexOf(START);
  const end = contents.indexOf(END);
  if (start === -1 && end === -1) return null;
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Codex config contains an incomplete commandcode-router marker block.");
  }
  return { start, end: end + END.length };
}

/** @param {string} contents */
function root(contents) {
  const lines = contents.split("\n");
  const table = lines.findIndex((line) => /^\s*\[[^[]/.test(line));
  return lines.slice(0, table === -1 ? lines.length : table).join("\n");
}

/**
 * @param {string} contents
 * @param {{ baseURL: string, catalogPath: string }} options
 */
export function installConfig(contents, options) {
  const expected = managedBlock(options);
  const markers = markerRange(contents);
  if (markers) {
    const existing = contents.slice(markers.start, markers.end);
    if (existing === expected) return contents;
    // Our own block from an earlier revision: upgrade it in place.
    return `${contents.slice(0, markers.start)}${expected}${contents.slice(markers.end)}`;
  }

  const rootContents = root(contents);
  for (const key of ["openai_base_url", "model_catalog_json", "model_provider"]) {
    if (new RegExp(`^\\s*${key}\\s*=`, "m").test(rootContents)) {
      throw new Error(`Refusing to replace user-owned ${key}.`);
    }
  }
  if (
    /^\s*model_providers\.commandcode_router\s*=/m.test(rootContents) ||
    /^\s*\[\s*model_providers\.commandcode_router\s*\]/m.test(contents)
  ) {
    throw new Error("Refusing to replace user-owned model_providers.commandcode_router.");
  }

  return `${expected}\n\n${contents.replace(/^\s+/, "")}`;
}

/** @param {string} contents */
export function uninstallConfig(contents) {
  const markers = markerRange(contents);
  if (!markers) return contents;
  const before = contents.slice(0, markers.start);
  const after = contents.slice(markers.end).replace(/^\n{1,2}/, "");
  return `${before}${after}`;
}

export const CONFIG_MARKERS = { start: START, end: END };
