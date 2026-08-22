const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  safeArchivePath,
  safeArchiveSymlinkTarget,
  sha256File,
  verifySha256,
} = require("../../scripts/lib/download-utils");

test("archive paths cannot escape the extraction directory", () => {
  const root = path.join(os.tmpdir(), "voicelab-safe-extract");
  assert.equal(safeArchivePath(root, "nested/model.bin"), path.join(root, "nested/model.bin"));
  assert.throws(() => safeArchivePath(root, "../outside"), /Unsafe archive path/);
  assert.throws(() => safeArchivePath(root, "/absolute"), /Unsafe archive path/);
  assert.throws(() => safeArchivePath(root, "C:\\absolute.exe"), /Unsafe archive path/);
});

test("archive symlinks may only resolve to relative targets inside the extraction directory", () => {
  const root = path.join(os.tmpdir(), "voicelab-safe-extract");
  const safeLink = safeArchiveSymlinkTarget(root, "bundle/libvoice.dylib", "libvoice.1.dylib");
  assert.equal(safeLink.entryPath, path.join(root, "bundle", "libvoice.dylib"));
  assert.equal(safeLink.targetPath, path.join(root, "bundle", "libvoice.1.dylib"));
  assert.throws(
    () => safeArchiveSymlinkTarget(root, "bundle/libvoice.dylib", "../../outside"),
    /Unsafe archive path/
  );
  assert.throws(
    () => safeArchiveSymlinkTarget(root, "bundle/libvoice.dylib", "/etc/passwd"),
    /Unsafe archive link target/
  );
});

test("large release downloads tolerate CDN pauses", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "scripts", "lib", "download-utils.js"),
    "utf8"
  );
  assert.match(source, /const REQUEST_TIMEOUT = 5 \* 60 \* 1000/);
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
