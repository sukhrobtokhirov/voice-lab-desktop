const fs = require("fs");
const path = require("path");

const { rebuild } = require("@electron/rebuild");
const { getAbi } = require("node-abi");

const NATIVE_MODULES = ["better-sqlite3"];

function targetPlatform(value) {
  return typeof value === "string" ? value : value?.nodeName;
}

exports.default = async function rebuildElectronNative(context) {
  const appDir = path.resolve(String(context?.appDir || ""));
  const electronVersion = String(context?.electronVersion || "").trim();
  const platform = targetPlatform(context?.platform);
  const arch = String(context?.arch || "").trim();

  if (!appDir || !electronVersion || !platform || !arch) {
    throw new Error("Native rebuild requires appDir, Electron version, platform, and architecture");
  }

  await rebuild({
    buildPath: appDir,
    electronVersion,
    platform,
    arch,
    onlyModules: NATIVE_MODULES,
    force: true,
    buildFromSource: true,
  });

  const abi = String(getAbi(electronVersion, "electron"));
  const cachedBinary = path.join(
    appDir,
    "node_modules",
    "better-sqlite3",
    "bin",
    `${platform}-${arch}-${abi}`,
    "better-sqlite3.node"
  );
  const releaseBinary = path.join(
    appDir,
    "node_modules",
    "better-sqlite3",
    "build",
    "Release",
    "better_sqlite3.node"
  );
  for (const binary of [cachedBinary, releaseBinary]) {
    if (!fs.statSync(binary, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Native rebuild did not produce ${path.relative(appDir, binary)}`);
    }
  }

  console.log(
    `  beforeBuild: rebuilt ${NATIVE_MODULES.join(", ")} for Electron ${electronVersion} ABI ${abi} (${platform}-${arch})`
  );

  // Continue through electron-builder's dependency collection. The target-ABI
  // cache above makes its generic rebuild deterministic, and afterPack verifies
  // that the exact cached binary reached the application bundle.
  return true;
};

module.exports.targetPlatform = targetPlatform;
