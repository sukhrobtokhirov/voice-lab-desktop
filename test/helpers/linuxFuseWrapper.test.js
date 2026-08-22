const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { applyLinuxFusesBeforeWrapping } = require("../../scripts/afterPack");

test("applies Linux fuses to the Electron binary before installing the launcher wrapper", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "linux-fuse-wrapper-test-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const binaryName = "voicelab-desktop";
  const binaryPath = path.join(tempDir, binaryName);
  fs.writeFileSync(binaryPath, "real-electron-elf");

  const configuredFuses = { runAsNode: false, onlyLoadAppFromAsar: true };
  const generatedFuseConfig = { version: 1, 0: false, 5: true };
  const calls = [];
  const context = {
    electronPlatformName: "linux",
    appOutDir: tempDir,
    packager: {
      executableName: binaryName,
      config: { electronFuses: configuredFuses },
      async generateFuseConfig(fuses) {
        calls.push(["generate", fuses]);
        return generatedFuseConfig;
      },
      async addElectronFuses(fuseContext, fuseConfig) {
        calls.push(["apply", fuseContext, fuseConfig, fs.readFileSync(binaryPath, "utf8")]);
      },
    },
  };

  await applyLinuxFusesBeforeWrapping(context);

  assert.deepEqual(calls, [
    ["generate", configuredFuses],
    ["apply", context, generatedFuseConfig, "real-electron-elf"],
  ]);
  assert.equal(context.packager.config.electronFuses, null);
  assert.equal(
    fs.readFileSync(path.join(tempDir, `${binaryName}-app`), "utf8"),
    "real-electron-elf"
  );
  assert.match(fs.readFileSync(binaryPath, "utf8"), /^#!\/bin\/bash/);
});
