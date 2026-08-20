const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const helpersDir = path.join(__dirname, "../../src/helpers");

test("diagnostic call sites do not log transcript or clipboard excerpts", () => {
  const files = [
    "ipcHandlers.js",
    "deepgramStreaming.js",
    "assemblyAiStreaming.js",
    "clipboard.js",
  ];
  const source = files
    .map((name) => fs.readFileSync(path.join(helpersDir, name), "utf8"))
    .join("\n");
  const loggingOnlySource = source.replace(
    'pasteWith({ cmd: "xdotool", args: typeArgs })',
    'pasteWith({ cmd: "xdotool", args: REDACTED })'
  );

  assert.doesNotMatch(loggingOnlySource, /text:\s*[^\n]*(?:slice|substring)\s*\(/);
  assert.doesNotMatch(loggingOnlySource, /textPreview\s*:/);
  assert.doesNotMatch(loggingOnlySource, /args:\s*(?:tool\.args|typeArgs)/);
});
