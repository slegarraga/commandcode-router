import { randomUUID } from "node:crypto";

/** @param {string} prefix */
export function identifier(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}
