const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  safeArchivePath,
  sha256File,
  verifySha256,
} = require("../../scripts/lib/download-utils");
const {
  loadManifest,
  manifestEntryFor,
  verifyOwnedSidecar,
} = require("../../scripts/lib/sidecar-manifest");

test("archive paths cannot escape the extraction directory", () => {
  const root = path.join(os.tmpdir(), "voicelab-safe-extract");
  assert.equal(safeArchivePath(root, "nested/model.bin"), path.join(root, "nested/model.bin"));
  assert.throws(() => safeArchivePath(root, "../outside"), /Unsafe archive path/);
  assert.throws(() => safeArchivePath(root, "/absolute"), /Unsafe archive path/);
  assert.throws(() => safeArchivePath(root, "C:\\absolute.exe"), /Unsafe archive path/);
});

test("sha256 verification fails closed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-hash-"));
  const file = path.join(dir, "sidecar");
  try {
    fs.writeFileSync(file, "trusted fixture");
    const digest = sha256File(file);
    assert.equal(verifySha256(file, digest), digest);
    assert.throws(() => verifySha256(file, "0".repeat(64)), /sha256 mismatch/);
    assert.throws(() => verifySha256(file, ""), /Missing or invalid owned sha256/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("owned sidecar manifest declares and verifies the macOS ARM64 baseline", () => {
  const manifest = loadManifest();
  const file = path.join(__dirname, "..", "..", "resources", "bin", "llama-server-darwin-arm64");
  const entry = manifestEntryFor(file, "darwin", "arm64", manifest);
  assert.ok(entry);
  assert.match(entry.sha256, /^[a-f0-9]{64}$/);
  if (fs.existsSync(file)) {
    assert.equal(verifyOwnedSidecar(file, "darwin", "arm64", manifest), entry.sha256);
  }
  assert.throws(
    () => verifyOwnedSidecar(file, "linux", "x64", manifest),
    /No owned sidecar hash/
  );
});
