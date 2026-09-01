import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

import { launchAgent, ownsRouterProcess } from "../src/service.mjs";
import { routerPaths } from "../src/paths.mjs";

test("launches only a headless service", () => {
  const paths = routerPaths({ codexHome: "/tmp/codex-home", userHome: "/tmp/user-home" });
  const plist = launchAgent({ paths, nodePath: "/usr/local/bin/node" });

  assert.match(plist, /<string>serve<\/string>/);
  assert.match(plist, /<key>RunAtLoad<\/key>/);
  assert.doesNotMatch(plist, /menu|tray|status.?bar/i);
});

test("does not mistake an unrelated live pid for the router", () => {
  assert.equal(ownsRouterProcess(process.pid), false);
});

test("generates a valid macOS launch agent", { skip: process.platform !== "darwin" }, (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "commandcode-router-plist-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "router.plist");
  fs.writeFileSync(filename, launchAgent({
    paths: routerPaths({ codexHome: "/tmp/codex-home", userHome: "/tmp/user-home" }),
    nodePath: "/usr/local/bin/node",
  }));
  assert.doesNotThrow(() => execFileSync("plutil", ["-lint", filename], { stdio: "ignore" }));
});
