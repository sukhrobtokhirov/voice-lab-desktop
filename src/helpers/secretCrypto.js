const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const debugLogger = require("./debugLogger");

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const ENVELOPE_MAGIC = Buffer.from("VLAB-SECRET\0V2\0", "utf8");
const KEY_FILE = "device-master-key.v1";

let configuredUserDataPath = null;
let cachedKey = null;

// Deliberate security tradeoff: VoiceLab does not use Electron safeStorage or
// a native credential vault because those can prompt/block ad-hoc signed macOS
// builds during launch. The random wrapping key is therefore protected by OS
// account and filesystem permissions (0700 directory, 0600 file), not by a
// hardware- or login-bound vault. Encryption remains authenticated at rest,
// but an attacker who can read both this key and the ciphertext can decrypt it.

function configure(userDataPath) {
  const normalized = path.resolve(String(userDataPath || ""));
  if (!userDataPath || normalized === path.parse(normalized).root) {
    throw new TypeError("A concrete userDataPath is required for encrypted storage");
  }
  if (configuredUserDataPath && configuredUserDataPath !== normalized) {
    cachedKey = null;
  }
  configuredUserDataPath = normalized;
  return module.exports;
}

function _keyPath() {
  if (!configuredUserDataPath) {
    throw new Error("Encrypted storage has not been configured with a userDataPath");
  }
  return path.join(configuredUserDataPath, "secure-keys", KEY_FILE);
}

function _atomicCreateKey(target, key) {
  const directory = path.dirname(target);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  try {
    fs.writeFileSync(temporary, key, { mode: 0o600, flag: "wx" });
    fs.chmodSync(temporary, 0o600);
    try {
      // Linking is exclusive: a second process cannot replace a key that won
      // the race and already protects persisted data.
      fs.linkSync(temporary, target);
    } catch (error) {
      if (error.code !== "EEXIST" || !fs.existsSync(target)) throw error;
    }
    fs.chmodSync(target, 0o600);
  } finally {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {}
  }
}

function _loadOrCreateKey() {
  if (cachedKey) return cachedKey;
  const target = _keyPath();
  if (!fs.existsSync(target)) _atomicCreateKey(target, crypto.randomBytes(KEY_BYTES));
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Encrypted storage key path is not a regular file");
  }
  fs.chmodSync(path.dirname(target), 0o700);
  fs.chmodSync(target, 0o600);
  const key = fs.readFileSync(target);
  if (key.length !== KEY_BYTES) {
    throw new Error("Encrypted storage key has an invalid length");
  }
  cachedKey = key;
  return cachedKey;
}

function isAvailable() {
  try {
    _loadOrCreateKey();
    return true;
  } catch (error) {
    debugLogger.warn(
      "local encrypted storage is unavailable",
      { error: error?.message },
      "secretCrypto"
    );
    return false;
  }
}

function encrypt(plaintext) {
  const key = _loadOrCreateKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(ENVELOPE_MAGIC);
  const ciphertext = Buffer.concat([
    cipher.update(String(plaintext), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([ENVELOPE_MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}

function encryptBuffer(value) {
  if (!Buffer.isBuffer(value)) throw new TypeError("encryptBuffer expects a Buffer");
  return encrypt(value.toString("base64"));
}

function isCurrentCiphertext(blob) {
  const encoded = Buffer.from(blob || []);
  return (
    encoded.length >= ENVELOPE_MAGIC.length + IV_BYTES + TAG_BYTES &&
    encoded.subarray(0, ENVELOPE_MAGIC.length).equals(ENVELOPE_MAGIC)
  );
}

function decrypt(blob) {
  const encoded = Buffer.from(blob);
  if (!isCurrentCiphertext(encoded)) {
    // Old vault-wrapped and unversioned ciphertext is intentionally not read:
    // doing so would reintroduce a credential-vault call or silently accept an
    // unauthenticated migration. The caller must discard/recreate that state.
    const error = new Error("decryption failed: unsupported or legacy encrypted format");
    error.code = "LEGACY_ENCRYPTED_FORMAT";
    throw error;
  }
  try {
    const key = _loadOrCreateKey();
    const ivStart = ENVELOPE_MAGIC.length;
    const tagStart = ivStart + IV_BYTES;
    const ciphertextStart = tagStart + TAG_BYTES;
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      key,
      encoded.subarray(ivStart, tagStart)
    );
    decipher.setAAD(ENVELOPE_MAGIC);
    decipher.setAuthTag(encoded.subarray(tagStart, ciphertextStart));
    const value = Buffer.concat([
      decipher.update(encoded.subarray(ciphertextStart)),
      decipher.final(),
    ]).toString("utf8");
    return { value, needsReencrypt: false };
  } catch {
    const error = new Error("decryption failed: encrypted data could not be authenticated");
    error.code = "ENCRYPTED_DATA_AUTH_FAILED";
    throw error;
  }
}

function decryptBufferWithMetadata(blob) {
  const result = decrypt(blob);
  return {
    value: Buffer.from(result.value, "base64"),
    needsReencrypt: result.needsReencrypt,
  };
}

function decryptBuffer(blob) {
  return decryptBufferWithMetadata(blob).value;
}

module.exports = {
  configure,
  decrypt,
  decryptBuffer,
  decryptBufferWithMetadata,
  encrypt,
  encryptBuffer,
  isAvailable,
  isCurrentCiphertext,
};
