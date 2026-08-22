const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { KEYRING_MAGIC } = require("../../src/helpers/localDataCrypto");
const { MAGIC: DATABASE_ENVELOPE_MAGIC } = require("../../src/helpers/localDataEnvelope");
const {
  RECOVERY_MANIFEST,
  RECOVERY_PREFIX,
  preserveLegacyKeychainData,
} = require("../../src/helpers/legacyLocalDataRecovery");

const CURRENT_MAGIC = Buffer.from("CURRENT:", "utf8");

function provider() {
  return {
    configure: () => {},
    isCurrentCiphertext: (value) =>
      Buffer.from(value).subarray(0, CURRENT_MAGIC.length).equals(CURRENT_MAGIC),
  };
}

function fixture() {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-recovery-"));
  return {
    userDataPath,
    databasePath: path.join(userDataPath, "transcriptions.db"),
  };
}

function write(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, { mode: 0o600 });
}

test("preserves a legacy keyring with its database, sidecars, envelope, audio, and backup", () => {
  const paths = fixture();
  const keyring = path.join(paths.userDataPath, "secure-keys", "local-data-keys.v1.enc");
  const backup = path.join(paths.userDataPath, "secure-keys", "master-key-backup.enc");
  const audio = path.join(paths.userDataPath, "audio", "recording.webm.enc");
  const originals = new Map([
    [keyring, Buffer.concat([KEYRING_MAGIC, Buffer.from("legacy-wrapped-keyring")])],
    [backup, Buffer.from("legacy-key-backup")],
    [paths.databasePath, Buffer.from("sqlite")],
    [`${paths.databasePath}-wal`, Buffer.from("wal")],
    [`${paths.databasePath}-shm`, Buffer.from("shm")],
    [
      `${paths.databasePath}.enc`,
      Buffer.concat([DATABASE_ENVELOPE_MAGIC, Buffer.from("legacy-database-envelope")]),
    ],
    [audio, Buffer.from("legacy-audio")],
  ]);
  try {
    for (const [file, contents] of originals) write(file, contents);

    const result = preserveLegacyKeychainData({ ...paths, cryptoProvider: provider() });

    assert.equal(result.recovered, true);
    assert.equal(result.reason, "legacy_keychain_keyring");
    assert.match(path.basename(result.recoveryPath), new RegExp(`^${RECOVERY_PREFIX}`));
    assert.equal(fs.statSync(result.recoveryPath).mode & 0o777, 0o700);
    for (const [file, contents] of originals) {
      assert.equal(fs.existsSync(file), false, `${file} must leave the active profile`);
      const recovered = path.join(result.recoveryPath, path.relative(paths.userDataPath, file));
      assert.deepEqual(fs.readFileSync(recovered), contents);
    }
    const manifestPath = path.join(result.recoveryPath, RECOVERY_MANIFEST);
    assert.equal(fs.statSync(manifestPath).mode & 0o777, 0o600);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.reason, "legacy_keychain_keyring");
    assert.deepEqual(manifest.moved.sort(), result.moved.sort());
  } finally {
    fs.rmSync(paths.userDataPath, { recursive: true, force: true });
  }
});

test("preserves only a legacy sealed database when the active keyring is current", () => {
  const paths = fixture();
  const keyring = path.join(paths.userDataPath, "secure-keys", "local-data-keys.v1.enc");
  const envelope = `${paths.databasePath}.enc`;
  try {
    write(keyring, Buffer.concat([KEYRING_MAGIC, CURRENT_MAGIC, Buffer.from("keyring")]));
    write(paths.databasePath, "active plaintext database");
    write(envelope, Buffer.concat([DATABASE_ENVELOPE_MAGIC, Buffer.from("legacy-envelope")]));

    const result = preserveLegacyKeychainData({ ...paths, cryptoProvider: provider() });

    assert.equal(result.recovered, true);
    assert.equal(result.reason, "legacy_keychain_database_envelope");
    assert.equal(fs.existsSync(paths.databasePath), true);
    assert.equal(fs.existsSync(keyring), true);
    assert.equal(fs.existsSync(envelope), false);
    assert.deepEqual(result.moved, ["transcriptions.db.enc"]);
  } finally {
    fs.rmSync(paths.userDataPath, { recursive: true, force: true });
  }
});

test("leaves current encrypted local data in place", () => {
  const paths = fixture();
  const keyring = path.join(paths.userDataPath, "secure-keys", "local-data-keys.v1.enc");
  const envelope = `${paths.databasePath}.enc`;
  try {
    write(keyring, Buffer.concat([KEYRING_MAGIC, CURRENT_MAGIC, Buffer.from("keyring")]));
    write(envelope, Buffer.concat([DATABASE_ENVELOPE_MAGIC, CURRENT_MAGIC, Buffer.from("db")]));

    const result = preserveLegacyKeychainData({ ...paths, cryptoProvider: provider() });

    assert.deepEqual(result, { recovered: false, recoveryPath: null, reason: null, moved: [] });
    assert.equal(fs.existsSync(keyring), true);
    assert.equal(fs.existsSync(envelope), true);
    assert.equal(
      fs.readdirSync(paths.userDataPath).some((name) => name.startsWith(RECOVERY_PREFIX)),
      false
    );
  } finally {
    fs.rmSync(paths.userDataPath, { recursive: true, force: true });
  }
});
