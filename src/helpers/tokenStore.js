const { app } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const authLogger = require("./authLogger");
const secretCrypto = require("./secretCrypto");

const STORE_VERSION = 2;
const STORE_MAGIC = Buffer.from("VLAB-AUTH\0V2\0", "utf8");
const storeFile = () => path.join(app.getPath("userData"), "auth-token.bin");
const legacyStoreFile = () => path.join(app.getPath("userData"), "auth-token.json");
const legacyMigrationSentinel = () =>
  path.join(app.getPath("userData"), ".auth-token-legacy-migrated");

let cachedStore = null;

function emptyStore() {
  return {
    version: STORE_VERSION,
    installationId: crypto.randomUUID(),
    session: null,
    pending: null,
  };
}

function normalizeSession(session) {
  if (!session || typeof session !== "object") return null;
  const accessToken = session.accessToken || session.access || session.access_token || "";
  const refreshToken = session.refreshToken || session.refresh || session.refresh_token || "";
  if (!accessToken) return null;
  return {
    accessToken,
    accessExpiresAt: Number(session.accessExpiresAt) || Date.now() + 5 * 60 * 1000,
    refreshToken,
    refreshExpiresAt: Number(session.refreshExpiresAt) || 0,
    sessionId: session.sessionId || session.session_id || "",
    user: session.user && typeof session.user === "object" ? session.user : null,
    kind: session.kind || "legacy",
  };
}

function parseStore(raw, { allowLegacy = false } = {}) {
  const parsed = JSON.parse(raw);
  if (parsed?.version === STORE_VERSION && parsed.installationId) {
    return {
      version: STORE_VERSION,
      installationId: String(parsed.installationId),
      session: normalizeSession(parsed.session),
      pending: parsed.pending && typeof parsed.pending === "object" ? parsed.pending : null,
    };
  }

  if (!allowLegacy || (parsed?.version != null && Number(parsed.version) !== 1)) {
    throw new Error("Unsupported secure token store version");
  }
  const legacySession = normalizeSession(parsed);
  return { ...emptyStore(), session: legacySession };
}

function markLegacyMigrationComplete() {
  if (fs.existsSync(legacyMigrationSentinel())) return;
  fs.writeFileSync(legacyMigrationSentinel(), String(Date.now()), {
    mode: 0o600,
    flag: "wx",
  });
}

function readStore() {
  if (cachedStore) return cachedStore;
  const file = storeFile();
  if (!fs.existsSync(file)) {
    const legacyFile = legacyStoreFile();
    if (fs.existsSync(legacyFile) && !fs.existsSync(legacyMigrationSentinel())) {
      try {
        const legacy = parseStore(fs.readFileSync(legacyFile, "utf8"), { allowLegacy: true });
        writeStore(legacy);
        markLegacyMigrationComplete();
        fs.rmSync(legacyFile, { force: true });
        return legacy;
      } catch {
        authLogger.error("legacy_secure_store_migration_failed", {
          errorCode: "AUTH_LEGACY_STORE_INVALID",
        });
      }
    }
    return (cachedStore = emptyStore());
  }
  if (!secretCrypto.isAvailable()) {
    authLogger.error("secure_storage_unavailable", { errorCode: "AUTH_SECURE_STORAGE_UNAVAILABLE" });
    return (cachedStore = emptyStore());
  }

  try {
    const encoded = fs.readFileSync(file);
    const hasMagic =
      encoded.length > STORE_MAGIC.length &&
      crypto.timingSafeEqual(encoded.subarray(0, STORE_MAGIC.length), STORE_MAGIC);
    if (!hasMagic && fs.existsSync(legacyMigrationSentinel())) {
      throw new Error("Magicless secure token store is not eligible for migration");
    }
    const encrypted = hasMagic ? encoded.subarray(STORE_MAGIC.length) : encoded;
    const decrypted = secretCrypto.decrypt(encrypted);
    const raw = decrypted.value;
    const needsReencrypt = !hasMagic || decrypted.needsReencrypt;
    cachedStore = parseStore(raw, { allowLegacy: !hasMagic });
    if (needsReencrypt) {
      writeStore(cachedStore);
      if (!hasMagic) markLegacyMigrationComplete();
    }
    return cachedStore;
  } catch {
    authLogger.error("secure_store_read_failed", { errorCode: "AUTH_SECURE_STORE_READ_FAILED" });
    return (cachedStore = emptyStore());
  }
}

function writeStore(value) {
  if (!secretCrypto.isAvailable()) {
    const error = new Error("Secure credential storage is unavailable");
    error.code = "AUTH_SECURE_STORAGE_UNAVAILABLE";
    throw error;
  }

  const file = storeFile();
  const directory = path.dirname(file);
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.mkdirSync(directory, { recursive: true });
  const encrypted = Buffer.concat([STORE_MAGIC, secretCrypto.encrypt(JSON.stringify(value))]);
  try {
    fs.writeFileSync(temporary, encrypted, { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, file);
    try {
      fs.chmodSync(file, 0o600);
    } catch {}
    cachedStore = value;
  } finally {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {}
  }
}

function update(mutator, { allowMemoryOnly = false } = {}) {
  const current = readStore();
  const next = mutator({ ...current });
  if (!secretCrypto.isAvailable() && allowMemoryOnly) {
    cachedStore = next;
    return next;
  }
  writeStore(next);
  return next;
}

function getInstallationId() {
  const store = readStore();
  if (!store.installationId) {
    store.installationId = crypto.randomUUID();
    if (secretCrypto.isAvailable()) writeStore(store);
  }
  return store.installationId;
}

function getSession() {
  return readStore().session;
}

function saveSession(session) {
  const normalized = normalizeSession(session);
  if (!normalized) throw new Error("Invalid authentication session");
  update((store) => ({ ...store, session: normalized }));
}

function clearSession() {
  update((store) => ({ ...store, session: null }), { allowMemoryOnly: true });
}

function getPending() {
  return readStore().pending;
}

function savePending(pending) {
  if (!pending || typeof pending !== "object") throw new Error("Invalid pending authorization");
  update((store) => ({ ...store, pending }));
}

function clearPending() {
  update((store) => ({ ...store, pending: null }), { allowMemoryOnly: true });
}

function completeAuthorization(session) {
  const normalized = normalizeSession(session);
  if (!normalized) throw new Error("Invalid authentication session");
  update((store) => ({ ...store, session: normalized, pending: null }));
}

function get() {
  return getSession()?.accessToken || null;
}

function getRefresh() {
  return getSession()?.refreshToken || null;
}

function set(token) {
  if (!token) return clearSession();
  try {
    const parsed = JSON.parse(token);
    return saveSession(parsed);
  } catch {
    const existing = getSession();
    return saveSession({
      ...(existing || {}),
      accessToken: token,
      accessExpiresAt: Date.now() + 5 * 60 * 1000,
    });
  }
}

function setSession(accessToken, refreshToken) {
  const existing = getSession();
  saveSession({
    ...(existing || {}),
    accessToken,
    accessExpiresAt: existing?.accessExpiresAt || Date.now() + 5 * 60 * 1000,
    refreshToken: refreshToken || existing?.refreshToken || "",
    kind: existing?.kind || "legacy",
  });
}

function clear() {
  update((store) => ({ ...store, session: null, pending: null }), { allowMemoryOnly: true });
}

module.exports = {
  clear,
  clearPending,
  clearSession,
  completeAuthorization,
  get,
  getInstallationId,
  getPending,
  getRefresh,
  getSession,
  savePending,
  saveSession,
  set,
  setSession,
};
