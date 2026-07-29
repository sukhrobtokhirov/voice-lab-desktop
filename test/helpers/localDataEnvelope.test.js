const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { LocalDataEnvelope, MAGIC } = require("../../src/helpers/localDataEnvelope");

const testCrypto = {
  isAvailable: () => true,
  encryptBuffer: (value) => Buffer.from(value).reverse(),
  decryptBuffer: (value) => Buffer.from(value).reverse(),
};

test("migrates a legacy plaintext database into a versioned OS-keyed envelope", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-envelope-"));
  const databasePath = path.join(dir, "transcriptions.db");
  const envelope = new LocalDataEnvelope(databasePath, testCrypto);
  const calls = [];
  try {
    fs.writeFileSync(databasePath, Buffer.from("sensitive transcript"), { mode: 0o600 });
    const result = envelope.seal({
      open: true,
      pragma: (value) => calls.push(value),
      close: () => calls.push("close"),
    });
    assert.equal(result.sealed, true);
    assert.equal(fs.existsSync(databasePath), false);
    const sealed = fs.readFileSync(`${databasePath}.enc`);
    assert.equal(sealed.subarray(0, MAGIC.length).equals(MAGIC), true);
    assert.deepEqual(calls, ["wal_checkpoint(TRUNCATE)", "close"]);

    assert.equal(envelope.restore().restored, true);
    assert.equal(fs.readFileSync(databasePath, "utf8"), "sensitive transcript");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("does not delete plaintext when OS-backed encryption is unavailable", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-envelope-"));
  const databasePath = path.join(dir, "transcriptions.db");
  const envelope = new LocalDataEnvelope(databasePath, {
    ...testCrypto,
    isAvailable: () => false,
  });
  try {
    fs.writeFileSync(databasePath, "retain me", { mode: 0o600 });
    assert.throws(() => envelope.seal({ open: false }), /plaintext database retained/);
    assert.equal(fs.readFileSync(databasePath, "utf8"), "retain me");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("rejects unknown envelope versions without overwriting data", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-envelope-"));
  const databasePath = path.join(dir, "transcriptions.db");
  const envelope = new LocalDataEnvelope(databasePath, testCrypto);
  try {
    fs.writeFileSync(`${databasePath}.enc`, "unknown-format", { mode: 0o600 });
    assert.throws(() => envelope.restore(), /unsupported magic or version/);
    assert.equal(fs.existsSync(databasePath), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
