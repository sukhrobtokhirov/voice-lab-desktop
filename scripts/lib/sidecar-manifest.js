const fs = require("fs");
const path = require("path");
const { verifySha256 } = require("./download-utils");

const DEFAULT_MANIFEST = path.join(__dirname, "..", "..", "resources", "sidecar-manifest.json");

function loadManifest(manifestPath = DEFAULT_MANIFEST) {
  const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) {
    throw new Error("Owned sidecar manifest is invalid");
  }
  return parsed;
}

function manifestEntryFor(filePath, platform, arch, manifest = loadManifest()) {
  const relativePath = `bin/${path.basename(filePath)}`;
  return manifest.entries.find(
    (entry) => entry.path === relativePath && entry.platform === platform && entry.arch === arch
  );
}

function verifyOwnedSidecar(filePath, platform, arch, manifest = loadManifest()) {
  const entry = manifestEntryFor(filePath, platform, arch, manifest);
  if (!entry) {
    throw new Error(
      `No owned sidecar hash for ${platform}-${arch}/${path.basename(filePath)}`
    );
  }
  return verifySha256(filePath, entry.sha256);
}

module.exports = {
  DEFAULT_MANIFEST,
  loadManifest,
  manifestEntryFor,
  verifyOwnedSidecar,
};
