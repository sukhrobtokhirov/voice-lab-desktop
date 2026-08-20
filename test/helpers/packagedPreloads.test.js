const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { assertPackagedPreloads, configuredPreloadPaths } = require("../../scripts/afterPack");

const projectDir = path.resolve(__dirname, "../..");

function createContext() {
  const appOutDir = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-preload-pack-"));
  return {
    appOutDir,
    electronPlatformName: "linux",
    packager: { projectDir },
  };
}

test("electron-builder includes generated capability preloads", () => {
  const config = JSON.parse(
    fs.readFileSync(path.join(projectDir, "electron-builder.json"), "utf8")
  );
  assert.ok(config.files.includes("preloads/**/*"));
});

test("afterPack accepts output containing every configured preload", (t) => {
  const context = createContext();
  t.after(() => fs.rmSync(context.appOutDir, { recursive: true, force: true }));
  const appDir = path.join(context.appOutDir, "resources", "app");
  for (const preloadPath of configuredPreloadPaths(projectDir)) {
    const destination = path.join(appDir, preloadPath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, "preload");
  }
  assert.doesNotThrow(() => assertPackagedPreloads(context));
});

test("afterPack fails when a window-configured preload is absent", (t) => {
  const context = createContext();
  t.after(() => fs.rmSync(context.appOutDir, { recursive: true, force: true }));
  const appDir = path.join(context.appOutDir, "resources", "app");
  const expected = configuredPreloadPaths(projectDir);
  for (const preloadPath of expected.slice(1)) {
    const destination = path.join(appDir, preloadPath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, "preload");
  }
  assert.throws(
    () => assertPackagedPreloads(context),
    new RegExp(`missing configured preload.*${expected[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
  );
});

test("dictation overlay excludes destructive and account-scoped capabilities", () => {
  const overlay = fs.readFileSync(path.join(projectDir, "preloads", "overlay.js"), "utf8");
  const match = overlay.match(/const preloadCapabilities = new Set\((\[[^;]+\])\);/);
  assert.ok(match, "generated capability allowlist is present");
  const capabilities = new Set(JSON.parse(match[1]));
  for (const capability of [
    "cleanupApp",
    "clearTranscriptions",
    "deleteAllAudio",
    "noteFilesSetPath",
    "deleteDiarizationModels",
    "llamaCppInstall",
    "setAutoStartEnabled",
    "gcalStartOAuth",
    "armDisplayMediaCapture",
    "modelDeleteAll",
    "deleteNote",
  ]) {
    assert.equal(capabilities.has(capability), false, capability);
  }
});

test("only the control panel exposes the display-media grant capability", () => {
  const controlPanel = fs.readFileSync(
    path.join(projectDir, "preloads", "control-panel.js"),
    "utf8"
  );
  assert.match(controlPanel, /"armDisplayMediaCapture"/);
  for (const name of ["overlay", "agent", "notification", "preview"]) {
    const preload = fs.readFileSync(path.join(projectDir, "preloads", `${name}.js`), "utf8");
    const capabilities = preload.slice(preload.indexOf("const preloadCapabilities"));
    assert.doesNotMatch(capabilities, /"armDisplayMediaCapture"/, name);
  }
});
