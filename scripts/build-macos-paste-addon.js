#!/usr/bin/env node

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

if (process.platform !== "darwin") process.exit(0);

const archIndex = process.argv.indexOf("--arch");
const targetArch =
  (archIndex !== -1 && process.argv[archIndex + 1]) || process.env.TARGET_ARCH || process.arch;
const targets = {
  arm64: "arm64-apple-macosx11.0",
  x64: "x86_64-apple-macosx10.15",
};
const target = targets[targetArch];
if (!target) {
  console.error(`[paste-addon] Unsupported architecture: ${targetArch}`);
  process.exit(1);
}

const root = path.resolve(__dirname, "..");
const source = path.join(root, "resources", "macos-paste-addon.mm");
const output = path.join(root, "resources", "bin", "macos-paste-addon.node");
const nodeInclude = path.resolve(path.dirname(process.execPath), "..", "include", "node");
if (!fs.existsSync(path.join(nodeInclude, "node_api.h"))) {
  console.error(`[paste-addon] Node headers not found at ${nodeInclude}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(output), { recursive: true });
const result = spawnSync(
  "clang++",
  [
    "-std=c++17",
    "-O2",
    "-bundle",
    "-undefined",
    "dynamic_lookup",
    "-target",
    target,
    `-I${nodeInclude}`,
    "-framework",
    "Cocoa",
    "-framework",
    "ApplicationServices",
    source,
    "-o",
    output,
  ],
  { stdio: "inherit" }
);
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`[paste-addon] Built ${path.relative(root, output)} (${targetArch})`);
