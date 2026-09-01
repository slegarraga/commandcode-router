import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

/** @param {string} directory */
export function privateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
}

/**
 * Replace one file atomically so an interrupted install cannot leave half a config.
 * @param {string} filename
 * @param {string | Buffer} contents
 * @param {number} [mode]
 */
export function atomicWrite(filename, contents, mode = 0o600) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = path.join(
    path.dirname(filename),
    `.${path.basename(filename)}.${process.pid}.${randomBytes(6).toString("hex")}`,
  );
  try {
    fs.writeFileSync(temporary, contents, { mode });
    fs.chmodSync(temporary, mode);
    fs.renameSync(temporary, filename);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

/** @param {string} filename */
export function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}
