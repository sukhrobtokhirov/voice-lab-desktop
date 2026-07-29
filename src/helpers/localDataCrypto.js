const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const secretCrypto = require("./secretCrypto");

const KEYRING_MAGIC = Buffer.from("VLAB-KEYRING\0V1\0", "utf8");
const FIELD_PREFIX = "vlabf:1:";
const AUDIO_MAGIC = Buffer.from("VLAB-AUDIO\0V2\0", "utf8");
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_RETAINED_KEYS = 4;
const instances = new Map();

class LocalDataCorruptionError extends Error {
  constructor(message, cause = null) {
    super(message);
    this.name = "LocalDataCorruptionError";
    this.code = "LOCAL_DATA_CORRUPTED";
    this.cause = cause || undefined;
  }
}

function atomicWrite(target, contents, mode = 0o600) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(target), 0o700);
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  fs.writeFileSync(temporary, contents, { mode });
  fs.chmodSync(temporary, mode);
  fs.renameSync(temporary, target);
  fs.chmodSync(target, mode);
}

function encodeContext(context) {
  const table = String(context?.table || "");
  const row = String(context?.row || "");
  const field = String(context?.field || "");
  if (!table || !row || !field) throw new TypeError("Complete encryption context is required");
  return Buffer.from(`${table}\0${row}\0${field}`, "utf8");
}

function normalizeRegistry(registry) {
  if (!registry || registry.format !== 1 || !Number.isInteger(registry.current)) {
    throw new LocalDataCorruptionError("Local data key registry is invalid");
  }
  const keys = {};
  for (const [version, encoded] of Object.entries(registry.keys || {})) {
    const key = Buffer.from(encoded, "base64");
    if (key.length !== KEY_BYTES) {
      throw new LocalDataCorruptionError(`Local data key ${version} has an invalid length`);
    }
    keys[Number(version)] = key;
  }
  if (!keys[registry.current]) {
    throw new LocalDataCorruptionError("Current local data key is missing");
  }
  const indexKey = Buffer.from(registry.index_key || "", "base64");
  if (indexKey.length !== KEY_BYTES) {
    throw new LocalDataCorruptionError("Local data index key is invalid");
  }
  return {
    format: 1,
    current: registry.current,
    keys,
    indexKey,
    createdAt: registry.created_at || new Date().toISOString(),
    rotatedAt: registry.rotated_at || null,
  };
}

class LocalDataCrypto {
  constructor({
    userDataPath,
    wrappingCrypto = secretCrypto,
    keyringPath = null,
    registry = null,
    persist = true,
  }) {
    if (!userDataPath && !keyringPath && !registry) {
      throw new TypeError("userDataPath, keyringPath, or registry is required");
    }
    this.userDataPath = userDataPath || path.dirname(path.dirname(keyringPath));
    this.keyringPath =
      keyringPath || path.join(this.userDataPath, "secure-keys", "local-data-keys.v1.enc");
    this.wrappingCrypto = wrappingCrypto;
    this.persist = persist;
    this.registry = registry ? normalizeRegistry(registry) : this._loadOrCreateRegistry();
  }

  static forUserDataPath(userDataPath, options = {}) {
    const key = path.resolve(userDataPath);
    if (!instances.has(key)) {
      instances.set(key, new LocalDataCrypto({ userDataPath, ...options }));
    }
    return instances.get(key);
  }

  static clearInstanceCacheForTests() {
    instances.clear();
  }

  _serializeRegistry() {
    return Buffer.from(
      JSON.stringify({
        format: 1,
        current: this.registry.current,
        keys: Object.fromEntries(
          Object.entries(this.registry.keys).map(([version, key]) => [
            version,
            key.toString("base64"),
          ])
        ),
        index_key: this.registry.indexKey.toString("base64"),
        created_at: this.registry.createdAt,
        rotated_at: this.registry.rotatedAt,
      }),
      "utf8"
    );
  }

  _persistRegistry() {
    if (!this.persist) return;
    if (!this.wrappingCrypto?.isAvailable?.()) {
      throw new Error("OS-backed encryption is required for local data");
    }
    const wrapped = this.wrappingCrypto.encryptBuffer(this._serializeRegistry());
    atomicWrite(this.keyringPath, Buffer.concat([KEYRING_MAGIC, wrapped]));
  }

  _loadOrCreateRegistry() {
    if (fs.existsSync(this.keyringPath)) {
      fs.chmodSync(this.keyringPath, 0o600);
      const contents = fs.readFileSync(this.keyringPath);
      if (
        contents.length <= KEYRING_MAGIC.length
        || !contents.subarray(0, KEYRING_MAGIC.length).equals(KEYRING_MAGIC)
      ) {
        throw new LocalDataCorruptionError("Local data key registry format is unsupported");
      }
      try {
        const plaintext = this.wrappingCrypto.decryptBuffer(
          contents.subarray(KEYRING_MAGIC.length)
        );
        return normalizeRegistry(JSON.parse(plaintext.toString("utf8")));
      } catch (error) {
        throw new LocalDataCorruptionError(
          "Local data key registry could not be authenticated",
          error
        );
      }
    }
    if (!this.wrappingCrypto?.isAvailable?.()) {
      throw new Error("OS-backed encryption is required for local data");
    }
    const registry = normalizeRegistry({
      format: 1,
      current: 1,
      keys: { 1: crypto.randomBytes(KEY_BYTES).toString("base64") },
      index_key: crypto.randomBytes(KEY_BYTES).toString("base64"),
      created_at: new Date().toISOString(),
    });
    this.registry = registry;
    this._persistRegistry();
    return registry;
  }

  get currentVersion() {
    return this.registry.current;
  }

  isEncryptedText(value) {
    return typeof value === "string" && value.startsWith(FIELD_PREFIX);
  }

  encryptedTextVersion(value) {
    if (!this.isEncryptedText(value)) return null;
    const version = Number(value.split(":", 4)[2]);
    return Number.isInteger(version) ? version : null;
  }

  encryptText(value, context, version = this.currentVersion) {
    if (value === null || value === undefined) return value;
    const key = this.registry.keys[version];
    if (!key) throw new LocalDataCorruptionError(`Local data key ${version} is unavailable`);
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(encodeContext(context));
    const ciphertext = Buffer.concat([
      cipher.update(String(value), "utf8"),
      cipher.final(),
    ]);
    return `${FIELD_PREFIX}${version}:${iv.toString("base64url")}:${cipher
      .getAuthTag()
      .toString("base64url")}:${ciphertext.toString("base64url")}`;
  }

  decryptText(value, context, { allowPlaintext = false } = {}) {
    if (value === null || value === undefined) return value;
    if (!this.isEncryptedText(value)) {
      if (allowPlaintext) return String(value);
      throw new LocalDataCorruptionError("Sensitive local data is unexpectedly plaintext");
    }
    const parts = value.split(":");
    if (parts.length !== 6 || parts[0] !== "vlabf" || parts[1] !== "1") {
      throw new LocalDataCorruptionError("Encrypted local field format is invalid");
    }
    const version = Number(parts[2]);
    const key = this.registry.keys[version];
    if (!key) throw new LocalDataCorruptionError(`Local data key ${version} is unavailable`);
    try {
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(parts[3], "base64url")
      );
      decipher.setAAD(encodeContext(context));
      decipher.setAuthTag(Buffer.from(parts[4], "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(parts[5], "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } catch (error) {
      throw new LocalDataCorruptionError("Encrypted local field authentication failed", error);
    }
  }

  deterministicIndex(namespace, value) {
    const normalizedNamespace = String(namespace || "");
    if (!normalizedNamespace) throw new TypeError("Index namespace is required");
    return crypto
      .createHmac("sha256", this.registry.indexKey)
      .update(normalizedNamespace, "utf8")
      .update(Buffer.from([0]))
      .update(String(value || ""), "utf8")
      .digest("hex");
  }

  encryptBytes(value, context, version = this.currentVersion) {
    const input = Buffer.from(value);
    const key = this.registry.keys[version];
    if (!key) throw new LocalDataCorruptionError(`Local data key ${version} is unavailable`);
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(encodeContext(context));
    const ciphertext = Buffer.concat([cipher.update(input), cipher.final()]);
    const versionBuffer = Buffer.allocUnsafe(4);
    versionBuffer.writeUInt32BE(version);
    return Buffer.concat([AUDIO_MAGIC, versionBuffer, iv, cipher.getAuthTag(), ciphertext]);
  }

  decryptBytes(value, context) {
    const input = Buffer.from(value);
    const minimum = AUDIO_MAGIC.length + 4 + IV_BYTES + TAG_BYTES;
    if (input.length < minimum || !input.subarray(0, AUDIO_MAGIC.length).equals(AUDIO_MAGIC)) {
      throw new LocalDataCorruptionError("Encrypted local binary format is invalid");
    }
    const versionOffset = AUDIO_MAGIC.length;
    const version = input.readUInt32BE(versionOffset);
    const key = this.registry.keys[version];
    if (!key) throw new LocalDataCorruptionError(`Local data key ${version} is unavailable`);
    const ivOffset = versionOffset + 4;
    const tagOffset = ivOffset + IV_BYTES;
    const ciphertextOffset = tagOffset + TAG_BYTES;
    try {
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        key,
        input.subarray(ivOffset, tagOffset)
      );
      decipher.setAAD(encodeContext(context));
      decipher.setAuthTag(input.subarray(tagOffset, ciphertextOffset));
      return Buffer.concat([decipher.update(input.subarray(ciphertextOffset)), decipher.final()]);
    } catch (error) {
      throw new LocalDataCorruptionError("Encrypted local binary authentication failed", error);
    }
  }

  encryptedBytesVersion(value) {
    const input = Buffer.from(value);
    if (
      input.length < AUDIO_MAGIC.length + 4
      || !input.subarray(0, AUDIO_MAGIC.length).equals(AUDIO_MAGIC)
    ) {
      return null;
    }
    return input.readUInt32BE(AUDIO_MAGIC.length);
  }

  rotateKey() {
    if (this.retainedVersions().length >= MAX_RETAINED_KEYS) {
      const error = new Error(
        "Local data key rotation requires old database and audio data to be re-encrypted first"
      );
      error.code = "LOCAL_DATA_KEY_ROTATION_REQUIRED";
      throw error;
    }
    const nextVersion = Math.max(...Object.keys(this.registry.keys).map(Number)) + 1;
    this.registry.keys[nextVersion] = crypto.randomBytes(KEY_BYTES);
    this.registry.current = nextVersion;
    this.registry.rotatedAt = new Date().toISOString();
    this._persistRegistry();
    return nextVersion;
  }

  retainedVersions() {
    return Object.keys(this.registry.keys).map(Number).sort((a, b) => a - b);
  }

  pruneKeys(activeVersions) {
    const active = new Set([...activeVersions].map(Number));
    active.add(this.currentVersion);
    const versions = this.retainedVersions();
    const removable = versions.filter((version) => !active.has(version));
    while (versions.length - removable.length < 1) removable.pop();
    for (const version of removable) delete this.registry.keys[version];
    if (this.retainedVersions().length > MAX_RETAINED_KEYS) {
      throw new Error("Old local data keys remain referenced and cannot be pruned safely");
    }
    this._persistRegistry();
  }

  backupKeyring(destination) {
    if (!fs.existsSync(this.keyringPath)) throw new Error("Local data key registry is missing");
    atomicWrite(destination, fs.readFileSync(this.keyringPath));
    return destination;
  }

  destroyKeyring() {
    fs.rmSync(this.keyringPath, { force: true });
    instances.delete(path.resolve(this.userDataPath));
  }
}

module.exports = {
  AUDIO_MAGIC,
  FIELD_PREFIX,
  KEYRING_MAGIC,
  LocalDataCorruptionError,
  LocalDataCrypto,
};
