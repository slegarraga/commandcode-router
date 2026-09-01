#!/usr/bin/env node

import { main } from "../src/cli.mjs";

main(process.argv.slice(2)).catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
});
