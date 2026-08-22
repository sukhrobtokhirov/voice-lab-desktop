const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const debugLogger = require("./debugLogger");
const secretCrypto = require("./secretCrypto");
const { KEYRING_MAGIC } = require("./localDataCrypto");
const { MAGIC: DATABASE_ENVELOPE_MAGIC } = require("./localDataEnvelope");

const RECOVERY_PREFIX = "legacy-keychain-recovery-";
const RECOVERY_MANIFEST = "RECOVERY.json";

function isPathInside(parent, target) {
  const relative = path.relative(parent, target);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== "..";
}

function legacyWrappedPayload(file, outerMagic, cryptoProvider) {
  if (!fs.existsSync(file)) return false;
  const contents = fs.readFileSync(file);
  if (
    contents.length <= outerMagic.length ||
    !contents.subarray(0, outerMagic.length).equals(outerMagic)
  ) {
    return false;
  }
  return !cryptoProvider.isCurrentCiphertext(contents.subarray(outerMagic.length));
}

function recoveryDirectory(userDataPath) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(
    userDataPath,
    `${RECOVERY_PREFIX}${timestamp}-${crypto.randomBytes(4).toString("hex")}`
  );
}

function movePreservingRelativePath(userDataPath, recoveryPath, source) {
  const relative = path.relative(userDataPath, source);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === "..") {
    throw new Error("Legacy recovery source is outside userData");
  }
  const destination = path.join(recoveryPath, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(destination), 0o700);
  fs.renameSync(source, destination);
  return { source, destination, relative };
}

function rollbackMoves(moves) {
  for (const move of [...moves].reverse()) {
    try {
      if (!fs.existsSync(move.destination) || fs.existsSync(move.source)) continue;
      fs.mkdirSync(path.dirname(move.source), { recursive: true, mode: 0o700 });
      fs.renameSync(move.destination, move.source);
    } catch {}
  }
}

/**
 * Preserves local data that is still bound to the retired OS credential vault.
 *
 * Reading that data would require invoking Keychain/safeStorage, which is
 * forbidden by the zero-vault desktop design. We move the mutually-dependent
 * keyring, database and audio set together so a support-assisted recovery
 * remains possible, then allow startup to create a clean local store. Nothing
 * in the legacy set is decrypted, copied to logs, or deleted.
 */
function preserveLegacyKeychainData({
  userDataPath,
  databasePath,
  cryptoProvider = secretCrypto,
} = {}) {
  const normalizedUserData = path.resolve(String(userDataPath || ""));
  const normalizedDatabase = path.resolve(String(databasePath || ""));
  if (
    !userDataPath ||
    normalizedUserData === path.parse(normalizedUserData).root ||
    !databasePath ||
    !isPathInside(normalizedUserData, normalizedDatabase)
  ) {
    throw new TypeError("Concrete userData and database paths are required for legacy recovery");
  }
  if (typeof cryptoProvider.isCurrentCiphertext !== "function") {
    throw new TypeError("Crypto provider must identify current ciphertext without decrypting it");
  }
  cryptoProvider.configure?.(normalizedUserData);

  const secureKeysPath = path.join(normalizedUserData, "secure-keys");
  const keyringPath = path.join(secureKeysPath, "local-data-keys.v1.enc");
  const databaseEnvelopePath = `${normalizedDatabase}.enc`;
  const legacyKeyring = legacyWrappedPayload(keyringPath, KEYRING_MAGIC, cryptoProvider);
  const legacyDatabaseEnvelope = legacyWrappedPayload(
    databaseEnvelopePath,
    DATABASE_ENVELOPE_MAGIC,
    cryptoProvider
  );

  if (!legacyKeyring && !legacyDatabaseEnvelope) {
    return { recovered: false, recoveryPath: null, reason: null, moved: [] };
  }

  const recoveryPath = recoveryDirectory(normalizedUserData);
  const candidates = legacyKeyring
    ? [
        keyringPath,
        path.join(secureKeysPath, "master-key-backup.enc"),
        normalizedDatabase,
        `${normalizedDatabase}-wal`,
        `${normalizedDatabase}-shm`,
        databaseEnvelopePath,
        path.join(normalizedUserData, "audio"),
      ]
    : [databaseEnvelopePath];
  const moves = [];

  try {
    fs.mkdirSync(recoveryPath, { recursive: false, mode: 0o700 });
    fs.chmodSync(recoveryPath, 0o700);
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        moves.push(movePreservingRelativePath(normalizedUserData, recoveryPath, candidate));
      }
    }
    const manifest = {
      format: 1,
      created_at: new Date().toISOString(),
      reason: legacyKeyring ? "legacy_keychain_keyring" : "legacy_keychain_database_envelope",
      moved: moves.map((move) => move.relative),
    };
    const manifestPath = path.join(recoveryPath, RECOVERY_MANIFEST);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
    fs.chmodSync(manifestPath, 0o600);
    debugLogger.warn(
      "preserved legacy keychain-bound local data before clean startup",
      { reason: manifest.reason, itemCount: moves.length },
      "localDataRecovery"
    );
    return {
      recovered: true,
      recoveryPath,
      reason: manifest.reason,
      moved: manifest.moved,
    };
  } catch (error) {
    rollbackMoves(moves);
    try {
      fs.rmSync(recoveryPath, { recursive: true, force: true });
    } catch {}
    const recoveryError = new Error("Legacy local data could not be preserved safely");
    recoveryError.code = "LEGACY_LOCAL_DATA_RECOVERY_FAILED";
    recoveryError.cause = error;
    throw recoveryError;
  }
}

module.exports = {
  RECOVERY_MANIFEST,
  RECOVERY_PREFIX,
  preserveLegacyKeychainData,
};
