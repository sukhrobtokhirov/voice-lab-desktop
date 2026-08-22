const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const modulePath = require.resolve("../../src/helpers/secretCrypto");

function loadSecretCrypto(userData) {
  delete require.cache[modulePath];
  const service = require(modulePath);
  service.configure(userData);
  return service;
}

test("local authenticated encryption persists without credential-vault APIs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-local-key-"));
  const keyFile = path.join(dir, "secure-keys", "device-master-key.v1");
  try {
    const firstProcess = loadSecretCrypto(dir);
    const encrypted = firstProcess.encrypt("desktop-refresh-secret");
    assert.notEqual(encrypted.includes(Buffer.from("desktop-refresh-secret")), true);
    assert.equal(firstProcess.decrypt(encrypted).value, "desktop-refresh-secret");

    const restartedProcess = loadSecretCrypto(dir);
    assert.equal(restartedProcess.decrypt(encrypted).value, "desktop-refresh-secret");
    assert.equal(fs.statSync(path.dirname(keyFile)).mode & 0o777, 0o700);
    assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600);
  } finally {
    delete require.cache[modulePath];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ciphertext tampering and unversioned legacy data fail closed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-local-key-"));
  try {
    const service = loadSecretCrypto(dir);
    const encrypted = service.encrypt("authenticated-value");
    encrypted[encrypted.length - 1] ^= 1;
    assert.throws(() => service.decrypt(encrypted), /could not be authenticated/);

    const oldUnversionedBlob = crypto.randomBytes(80);
    assert.throws(() => service.decrypt(oldUnversionedBlob), /unsupported or legacy/);
  } finally {
    delete require.cache[modulePath];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("legacy vault backup is neither opened nor modified", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-legacy-backup-"));
  const secureDir = path.join(dir, "secure-keys");
  const legacyBackup = path.join(secureDir, "master-key-backup.enc");
  try {
    fs.mkdirSync(secureDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(legacyBackup, "opaque-old-vault-data", { mode: 0o600 });
    const before = fs.readFileSync(legacyBackup);

    const service = loadSecretCrypto(dir);
    service.encrypt("new-format");
    assert.deepEqual(fs.readFileSync(legacyBackup), before);
  } finally {
    delete require.cache[modulePath];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("desktop runtime contains no executable native-vault references", () => {
  const root = path.resolve(__dirname, "../..");
  const runtimeFiles = [
    "src/helpers/secretCrypto.js",
    "src/helpers/tokenStore.js",
    "src/helpers/localDataCrypto.js",
    "src/helpers/localDataEnvelope.js",
    "src/helpers/environment.js",
  ];
  for (const relative of runtimeFiles) {
    const source = fs.readFileSync(path.join(root, relative), "utf8");
    assert.doesNotMatch(source, /require\(["']electron["']\).*safeStorage/s, relative);
    assert.doesNotMatch(source, /safeStorage\s*\.(encryptString|decryptString)/, relative);
    assert.doesNotMatch(source, /require\(["']@napi-rs\/keyring["']\)/, relative);
  }
});
