const { app } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const authLogger = require("./authLogger");
const secretCrypto = require("./secretCrypto");

secretCrypto.configure?.(app.getPath("userData"));

const STORE_VERSION = 2;
const STORE_MAGIC = Buffer.from("VLAB-AUTH\0V2\0", "utf8");
const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const storeFile = () => path.join(app.getPath("userData"), "auth-token.bin");
const legacyStoreFile = () => path.join(app.getPath("userData"), "auth-token.json");
const legacyMigrationSentinel = () =>
  path.join(app.getPath("userData"), ".auth-token-legacy-migrated");

let cachedStore = null;
let installationIdPersisted = false;
let runtimeHydrated = false;
let runtimeSession = null;
let runtimePending = null;

function canonicalInstallationId(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return CANONICAL_UUID_PATTERN.test(normalized) && normalized !== ZERO_UUID ? normalized : null;
}

function createInstallationId() {
  return crypto.randomUUID().toLowerCase();
}

function emptyStore() {
  return {
    version: STORE_VERSION,
    installationId: createInstallationId(),
    session: null,
  };
}

function normalizeSession(session) {
  if (!session || typeof session !== "object") return null;
  const accessToken = session.accessToken || session.access || session.access_token || "";
  const refreshToken = session.refreshToken || session.refresh || session.refresh_token || "";
  const kind = session.kind === "desktop-go-v2" || refreshToken ? "desktop-go-v2" : "legacy";
  if (kind === "desktop-go-v2" ? !refreshToken : !accessToken) return null;
  return {
    accessToken,
    accessExpiresAt: Number(session.accessExpiresAt) || Date.now() + 5 * 60 * 1000,
    refreshToken,
    refreshExpiresAt: Number(session.refreshExpiresAt) || 0,
    sessionId: session.sessionId || session.session_id || "",
    user: session.user && typeof session.user === "object" ? session.user : null,
    kind,
  };
}

function persistentSession(session) {
  const normalized = normalizeSession(session);
  if (!normalized || normalized.kind !== "desktop-go-v2") return null;
  return {
    refreshToken: normalized.refreshToken,
  };
}

function hydrateRuntime(store) {
  if (runtimeHydrated) return;
  runtimeHydrated = true;
  const persisted = normalizeSession(store?.session);
  runtimeSession = persisted ? { ...persisted, accessToken: "", accessExpiresAt: 0 } : null;
  // Authorization requests are process-bound. PKCE verifier/state and the
  // loopback listener never survive a restart.
  runtimePending = null;
}

function normalizePending(pending) {
  if (!pending || typeof pending !== "object") return null;
  const requiredStrings = ["codeVerifier", "state", "redirectUri"];
  if (requiredStrings.some((key) => typeof pending[key] !== "string" || !pending[key])) return null;
  const createdAt = Number(pending.createdAt);
  const expiresAt = Number(pending.expiresAt);
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || expiresAt <= createdAt) {
    return null;
  }
  return {
    codeVerifier: pending.codeVerifier,
    state: pending.state,
    redirectUri: pending.redirectUri,
    createdAt,
    expiresAt,
    authorizationRequestId:
      typeof pending.authorizationRequestId === "string" ? pending.authorizationRequestId : "",
    authorizationUrl:
      typeof pending.authorizationUrl === "string" && pending.authorizationUrl.length <= 4096
        ? pending.authorizationUrl
        : "",
    callbackFingerprint:
      typeof pending.callbackFingerprint === "string" ? pending.callbackFingerprint : "",
  };
}

function parseStore(raw, { allowLegacy = false } = {}) {
  const parsed = JSON.parse(raw);
  if (parsed?.version === STORE_VERSION && parsed.installationId) {
    return {
      version: STORE_VERSION,
      installationId: String(parsed.installationId),
      session: persistentSession(parsed.session),
    };
  }

  if (!allowLegacy || (parsed?.version != null && Number(parsed.version) !== 1)) {
    throw new Error("Unsupported secure token store version");
  }
  const legacySession = normalizeSession(parsed);
  return { ...emptyStore(), session: persistentSession(legacySession) };
}

function tightenCredentialFilePermissions(file) {
  try {
    fs.chmodSync(file, 0o600);
  } catch {}
}

function quarantineUnreadableStore(file) {
  if (!fs.existsSync(file)) return null;
  tightenCredentialFilePermissions(file);
  const quarantine = `${file}.unreadable-${Date.now()}-${crypto
    .randomBytes(4)
    .toString("hex")}`;
  try {
    fs.renameSync(file, quarantine);
    tightenCredentialFilePermissions(quarantine);
    return quarantine;
  } catch {
    // Never delete or overwrite an unreadable legacy/corrupt credential blob.
    return null;
  }
}

function markLegacyMigrationComplete() {
  if (fs.existsSync(legacyMigrationSentinel())) {
    tightenCredentialFilePermissions(legacyMigrationSentinel());
    return;
  }
  fs.writeFileSync(legacyMigrationSentinel(), String(Date.now()), {
    mode: 0o600,
    flag: "wx",
  });
}

function containsRuntimeOnlyAuthState(raw) {
  try {
    const parsed = JSON.parse(raw);
    const session = parsed?.session;
    return Boolean(
      parsed?.pending ||
      session?.accessToken ||
      session?.access ||
      session?.access_token ||
      session?.accessExpiresAt ||
      (session && Object.keys(session).some((key) => key !== "refreshToken"))
    );
  } catch {
    return false;
  }
}

function readStore() {
  if (cachedStore) {
    hydrateRuntime(cachedStore);
    return cachedStore;
  }
  const file = storeFile();
  if (!fs.existsSync(file)) {
    const legacyFile = legacyStoreFile();
    if (fs.existsSync(legacyFile) && !fs.existsSync(legacyMigrationSentinel())) {
      try {
        tightenCredentialFilePermissions(legacyFile);
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
    installationIdPersisted = false;
    cachedStore = emptyStore();
    hydrateRuntime(cachedStore);
    return cachedStore;
  }
  if (!secretCrypto.isAvailable()) {
    authLogger.error("secure_storage_unavailable", {
      errorCode: "AUTH_SECURE_STORAGE_UNAVAILABLE",
    });
    installationIdPersisted = false;
    cachedStore = emptyStore();
    hydrateRuntime(cachedStore);
    return cachedStore;
  }

  try {
    tightenCredentialFilePermissions(file);
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
    const needsReencrypt =
      !hasMagic || decrypted.needsReencrypt || containsRuntimeOnlyAuthState(raw);
    cachedStore = parseStore(raw, { allowLegacy: !hasMagic });
    hydrateRuntime(cachedStore);
    installationIdPersisted = Boolean(
      canonicalInstallationId(cachedStore.installationId) === cachedStore.installationId
    );
    if (needsReencrypt || !installationIdPersisted) {
      writeStore(cachedStore);
      if (!hasMagic) markLegacyMigrationComplete();
    }
    return cachedStore;
  } catch {
    const quarantined = quarantineUnreadableStore(file);
    authLogger.error("secure_store_read_failed", {
      errorCode: "AUTH_SECURE_STORE_READ_FAILED",
      legacyStatePreserved: Boolean(quarantined),
    });
    installationIdPersisted = false;
    cachedStore = emptyStore();
    hydrateRuntime(cachedStore);
    return cachedStore;
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
  const persistedValue = {
    version: STORE_VERSION,
    installationId: canonicalInstallationId(value?.installationId) || createInstallationId(),
    session: persistentSession(value?.session),
  };
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const encrypted = Buffer.concat([
    STORE_MAGIC,
    secretCrypto.encrypt(JSON.stringify(persistedValue)),
  ]);
  try {
    fs.writeFileSync(temporary, encrypted, { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, file);
    try {
      fs.chmodSync(file, 0o600);
    } catch {}
    cachedStore = persistedValue;
    hydrateRuntime(cachedStore);
    installationIdPersisted = true;
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
  const installationId = canonicalInstallationId(store.installationId) || createInstallationId();
  if (store.installationId !== installationId || !installationIdPersisted) {
    const next = { ...store, installationId };
    if (secretCrypto.isAvailable()) {
      writeStore(next);
    } else {
      cachedStore = next;
    }
  }
  return installationId;
}

function getSession() {
  readStore();
  return runtimeSession;
}

function saveSession(session) {
  const normalized = normalizeSession(session);
  if (!normalized) throw new Error("Invalid authentication session");
  readStore();
  const previousSession = runtimeSession;
  runtimeSession = normalized;
  try {
    update((store) => ({ ...store, session: persistentSession(normalized) }));
  } catch (error) {
    runtimeSession = previousSession;
    throw error;
  }
}

function clearSession() {
  runtimeSession = null;
  update((store) => ({ ...store, session: null }), { allowMemoryOnly: true });
}

function getPending() {
  readStore();
  return runtimePending;
}

function savePending(pending) {
  const normalized = normalizePending(pending);
  if (!normalized) throw new Error("Invalid pending authorization");
  readStore();
  runtimePending = normalized;
}

function clearPending() {
  runtimePending = null;
}

function completeAuthorization(session) {
  const normalized = normalizeSession(session);
  if (!normalized) throw new Error("Invalid authentication session");
  readStore();
  const previousSession = runtimeSession;
  runtimeSession = normalized;
  runtimePending = null;
  try {
    update((store) => ({ ...store, session: persistentSession(normalized) }));
  } catch (error) {
    runtimeSession = previousSession;
    throw error;
  }
}

function get() {
  return getSession()?.accessToken || null;
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

function clear() {
  runtimeSession = null;
  runtimePending = null;
  update((store) => ({ ...store, session: null }), { allowMemoryOnly: true });
}

module.exports = {
  clear,
  clearPending,
  clearSession,
  completeAuthorization,
  get,
  getInstallationId,
  getPending,
  getSession,
  savePending,
  saveSession,
  set,
};
