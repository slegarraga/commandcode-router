const START = "# >>> commandcode-router >>>";
const END = "# <<< commandcode-router <<<";

/** @param {string} value */
function tomlString(value) {
  return JSON.stringify(value);
}

/** @param {{ baseURL: string, catalogPath: string }} options */
export function managedBlock(options) {
  return [
    START,
    `openai_base_url = ${tomlString(options.baseURL)}`,
    `model_catalog_json = ${tomlString(options.catalogPath)}`,
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
    if (existing !== expected) {
      throw new Error("Codex config is managed by a different commandcode-router installation.");
    }
    return contents;
  }

  const rootContents = root(contents);
  for (const key of ["openai_base_url", "model_catalog_json"]) {
    if (new RegExp(`^\\s*${key}\\s*=`, "m").test(rootContents)) {
      throw new Error(`Refusing to replace user-owned ${key}.`);
    }
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
