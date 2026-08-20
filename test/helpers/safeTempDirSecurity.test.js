const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  getSafeTempDir,
  reserveSafeTempFile,
  getReservedTempWriteOptions,
} = require("../../src/helpers/safeTempDir");

test("sensitive temp artifacts use a private directory and exclusive random files", () => {
  const privateDir = getSafeTempDir();
  assert.equal(getSafeTempDir(), privateDir);
  assert.notEqual(path.resolve(privateDir), path.resolve(os.tmpdir()));
  assert.match(path.basename(privateDir), /^voicelab-/);

  const first = reserveSafeTempFile("ow-url-", ".webm");
  const second = reserveSafeTempFile("ow-url-", ".webm");
  assert.notEqual(first, second);
  assert.equal(path.dirname(first), privateDir);
  assert.equal(path.dirname(second), privateDir);
  assert.match(path.basename(first), /^ow-url-[0-9a-f-]{36}\.webm$/);
  const writeOptions = getReservedTempWriteOptions(first);
  assert.equal(writeOptions.mode, 0o600);
  if (fs.constants.O_NOFOLLOW) {
    assert.equal(writeOptions.flags & fs.constants.O_NOFOLLOW, fs.constants.O_NOFOLLOW);
  }

  if (process.platform !== "win32") {
    assert.equal(fs.statSync(privateDir).mode & 0o777, 0o700);
    assert.equal(fs.statSync(first).mode & 0o777, 0o600);
    assert.equal(fs.statSync(second).mode & 0o777, 0o600);
  }

  fs.unlinkSync(first);
  fs.unlinkSync(second);
});

test("reserved temp files reject symlink replacement before writing", () => {
  if (process.platform === "win32") return;

  const privateDir = getSafeTempDir();
  const reserved = reserveSafeTempFile("ow-url-", ".pcm");
  const target = path.join(privateDir, "target.pcm");
  fs.writeFileSync(target, "do-not-overwrite", { mode: 0o600 });
  fs.unlinkSync(reserved);
  fs.symlinkSync(target, reserved);

  assert.throws(() => getReservedTempWriteOptions(reserved), /regular file/);
  assert.equal(fs.readFileSync(target, "utf8"), "do-not-overwrite");

  fs.unlinkSync(reserved);
  fs.unlinkSync(target);
});
