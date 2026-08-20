const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("release packaging enables the hardened Electron fuse set", () => {
  const builder = JSON.parse(read("electron-builder.json"));

  assert.equal(builder.asar, true);
  assert.deepEqual(builder.electronFuses, {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    // The packaged renderer is loaded with BrowserWindow.loadFile(). Electron's
    // file loader requires these privileges; navigation and IPC are constrained
    // separately by the application's window security policy.
    grantFileProtocolExtraPrivileges: true,
  });
});

test("the unpacked ONNX worker remains an Electron utility process", () => {
  const builder = JSON.parse(read("electron-builder.json"));
  const workerClient = read("src/helpers/onnxWorkerClient.js");
  const afterPack = read("scripts/afterPack.js");

  assert.ok(builder.asarUnpack.includes("src/workers/**/*"));
  assert.match(workerClient, /utilityProcess\.fork\(WORKER_SCRIPT/);
  assert.doesNotMatch(workerClient, /\bprocess\.fork\(/);
  assert.match(afterPack, /app\.asar\.unpacked/);
  assert.match(afterPack, /src["'], ["']workers["'], ["']onnxWorker\.js/);
});

test("macOS transport security does not allow arbitrary network loads", () => {
  const config = JSON.parse(read("electron-builder.json"));
  const afterPack = read("scripts/afterPack.js");
  assert.equal(config.mac.extendInfo.NSAppTransportSecurity.NSAllowsArbitraryLoads, false);
  assert.equal(config.mac.extendInfo.NSAppTransportSecurity.NSAllowsLocalNetworking, true);
  assert.match(afterPack, /enforceMacTransportSecurity\(context\)/);
  assert.match(afterPack, /NSAllowsArbitraryLoads false/);
});
