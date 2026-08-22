const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("node:module");

const tokenStorePath = require.resolve("../../src/helpers/tokenStore");
const originalLoad = Module._load;
const MAGIC = Buffer.from("VLAB-AUTH\0V2\0", "utf8");
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function loadTokenStore(userData) {
  delete require.cache[tokenStorePath];
  const cryptoProvider = {
    isAvailable: () => true,
    encrypt: (value) => Buffer.from(`ENC:${value}`, "utf8"),
    decrypt: (value) => {
      const raw = value.toString("utf8");
      if (!raw.startsWith("ENC:")) throw new Error("invalid encrypted fixture");
      return { value: raw.slice(4), needsReencrypt: false };
    },
  };
  Module._load = function mockedLoad(request, parent, isMain) {
    if (request === "electron") return { app: { getPath: () => userData } };
    if (request === "./secretCrypto") return cryptoProvider;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require("../../src/helpers/tokenStore");
  } finally {
    Module._load = originalLoad;
  }
}

function readEncryptedStore(userData) {
  const encoded = fs.readFileSync(path.join(userData, "auth-token.bin"));
  assert.equal(encoded.subarray(0, MAGIC.length).equals(MAGIC), true);
  const encryptedFixture = encoded.subarray(MAGIC.length).toString("utf8");
  assert.match(encryptedFixture, /^ENC:/);
  return JSON.parse(encryptedFixture.slice(4));
}

test("persists only the rotating credential plus a sanitized encrypted display profile", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-token-"));
  try {
    const store = loadTokenStore(dir);
    store.saveSession({
      kind: "desktop-go-v2",
      accessToken: "access",
      refreshToken: "rotating-refresh-token",
      refreshExpiresAt: Date.now() + 60_000,
      user: {
        id: "user-1",
        email: "desktop@example.com",
        name: "Desktop Person",
        image: "https://cdn.voicelab.uz/avatar/user-1.png",
      },
    });
    const encoded = fs.readFileSync(path.join(dir, "auth-token.bin"));
    assert.equal(fs.statSync(path.join(dir, "auth-token.bin")).mode & 0o777, 0o600);
    assert.equal(encoded.subarray(0, MAGIC.length).equals(MAGIC), true);
    assert.doesNotMatch(encoded.toString("utf8"), /^access$/);
    const decrypted = JSON.parse(encoded.subarray(MAGIC.length).toString("utf8").slice(4));
    assert.equal(store.getSession().accessToken, "access");
    assert.equal(decrypted.session.accessToken, undefined);
    assert.equal(decrypted.session.accessExpiresAt, undefined);
    assert.equal(decrypted.session.refreshToken, "rotating-refresh-token");
    assert.deepEqual(decrypted.session, { refreshToken: "rotating-refresh-token" });
    assert.deepEqual(decrypted.profile, {
      id: "user-1",
      email: "desktop@example.com",
      name: "Desktop Person",
      image: "https://cdn.voicelab.uz/avatar/user-1.png",
    });

    const restarted = loadTokenStore(dir).getSession();
    assert.equal(restarted.accessToken, "");
    assert.equal(restarted.refreshToken, "rotating-refresh-token");
    assert.equal(restarted.refreshExpiresAt, 0);
    assert.equal(restarted.sessionId, "");
    assert.deepEqual(restarted.user, decrypted.profile);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("tightens permissions on an existing encrypted credential store", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-token-"));
  const file = path.join(dir, "auth-token.bin");
  try {
    const fixture = {
      version: 2,
      installationId: "550e8400-e29b-41d4-a716-446655440000",
      session: null,
    };
    fs.writeFileSync(
      file,
      Buffer.concat([MAGIC, Buffer.from(`ENC:${JSON.stringify(fixture)}`)]),
      { mode: 0o644 }
    );
    fs.chmodSync(file, 0o644);

    loadTokenStore(dir).getInstallationId();
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("quarantines an unreadable legacy credential blob and starts signed out", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-token-"));
  const file = path.join(dir, "auth-token.bin");
  const legacy = Buffer.from("opaque-legacy-vault-ciphertext");
  try {
    fs.writeFileSync(file, legacy, { mode: 0o644 });
    const store = loadTokenStore(dir);

    assert.equal(store.getSession(), null);
    const id = store.getInstallationId();
    assert.match(id, CANONICAL_UUID_PATTERN);
    const quarantined = fs
      .readdirSync(dir)
      .filter((name) => name.startsWith("auth-token.bin.unreadable-"));
    assert.equal(quarantined.length, 1);
    assert.deepEqual(fs.readFileSync(path.join(dir, quarantined[0])), legacy);
    assert.equal(fs.statSync(path.join(dir, quarantined[0])).mode & 0o777, 0o600);
    assert.equal(fs.existsSync(file), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("creates and persists one canonical lowercase installation UUID before any session exists", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-token-"));
  try {
    const firstStore = loadTokenStore(dir);
    const firstId = firstStore.getInstallationId();

    assert.match(firstId, CANONICAL_UUID_PATTERN);
    assert.equal(firstId, firstId.toLowerCase());
    assert.equal(readEncryptedStore(dir).installationId, firstId);
    assert.equal(firstStore.getSession(), null);
    assert.equal(firstStore.getPending(), null);

    const restartedStore = loadTokenStore(dir);
    assert.equal(restartedStore.getInstallationId(), firstId);
    restartedStore.clear();
    assert.equal(loadTokenStore(dir).getInstallationId(), firstId);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("keeps PKCE verifier and state process-memory only", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-token-"));
  try {
    const store = loadTokenStore(dir);
    store.getInstallationId();
    store.savePending({
      codeVerifier: "v".repeat(43),
      state: "s".repeat(43),
      redirectUri: "http://127.0.0.1:52753/callback",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      authorizationRequestId: `dau_${"r".repeat(43)}`,
      authorizationUrl: `https://voicelab.uz/app/sign-in?desktop_auth_id=dau_${"r".repeat(43)}`,
    });

    assert.equal(store.getPending().state, "s".repeat(43));
    const persisted = readEncryptedStore(dir);
    assert.equal(persisted.pending, undefined);
    assert.equal(loadTokenStore(dir).getPending(), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("canonicalizes and persists uppercase or invalid installation identifiers", () => {
  for (const existingId of [
    "550E8400-E29B-41D4-A716-446655440000",
    "installation-1",
    "00000000-0000-0000-0000-000000000000",
  ]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-token-"));
    try {
      const fixture = {
        version: 2,
        installationId: existingId,
        session: null,
        pending: null,
      };
      fs.writeFileSync(
        path.join(dir, "auth-token.bin"),
        Buffer.concat([MAGIC, Buffer.from(`ENC:${JSON.stringify(fixture)}`)]),
        { mode: 0o600 }
      );

      const store = loadTokenStore(dir);
      const canonicalId = store.getInstallationId();
      assert.match(canonicalId, CANONICAL_UUID_PATTERN);
      assert.equal(canonicalId, canonicalId.toLowerCase());
      assert.equal(readEncryptedStore(dir).installationId, canonicalId);
      assert.equal(loadTokenStore(dir).getInstallationId(), canonicalId);
      if (existingId !== "550E8400-E29B-41D4-A716-446655440000") {
        assert.notEqual(canonicalId, existingId);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("drops legacy access-only credentials during encrypted store migration", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-token-"));
  try {
    fs.writeFileSync(
      path.join(dir, "auth-token.bin"),
      `ENC:${JSON.stringify({ version: 1, access_token: "legacy-access" })}`,
      { mode: 0o600 }
    );
    const store = loadTokenStore(dir);
    assert.equal(store.getSession(), null);
    assert.equal(fs.existsSync(path.join(dir, ".auth-token-legacy-migrated")), true);
    assert.equal(
      fs.readFileSync(path.join(dir, "auth-token.bin")).subarray(0, MAGIC.length).equals(MAGIC),
      true
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("migrates persisted access and PKCE state to a refresh-session-only restart state", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-token-"));
  try {
    const existing = {
      version: 2,
      installationId: "550e8400-e29b-41d4-a716-446655440000",
      session: {
        kind: "desktop-go-v2",
        accessToken: "existing-access",
        refreshToken: "legacy-refresh-secret",
        refreshExpiresAt: Date.now() + 60_000,
        user: { id: "user-1", email: "desktop@example.com" },
      },
      pending: {
        codeVerifier: "v".repeat(86),
        state: "s".repeat(43),
        redirectUri: "voicelab://auth/callback",
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        authorizationRequestId: "3b1715a0-75c2-4fd4-bdd8-a7bfb42a9e65",
        authorizationUrl:
          "https://voicelab.uz/app/sign-in?desktop_auth_id=3b1715a0-75c2-4fd4-bdd8-a7bfb42a9e65",
      },
    };
    fs.writeFileSync(
      path.join(dir, "auth-token.bin"),
      Buffer.concat([MAGIC, Buffer.from(`ENC:${JSON.stringify(existing)}`)]),
      { mode: 0o600 }
    );

    const store = loadTokenStore(dir);
    assert.equal(store.getSession().accessToken, "");
    assert.equal(store.getSession().kind, "desktop-go-v2");
    assert.equal(store.getSession().refreshToken, "legacy-refresh-secret");
    assert.equal(store.getPending(), null);
    const cleaned = readEncryptedStore(dir);
    assert.deepEqual(cleaned.session, { refreshToken: "legacy-refresh-secret" });
    assert.deepEqual(cleaned.profile, {
      id: "user-1",
      email: "desktop@example.com",
      name: "desktop@example.com",
      image: null,
    });
    assert.equal(cleaned.pending, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("rejects plaintext, unknown versions, and repeated magicless migration", () => {
  for (const fixture of [
    JSON.stringify({ access_token: "plaintext" }),
    `ENC:${JSON.stringify({ version: 99, access_token: "unknown" })}`,
  ]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-token-"));
    try {
      fs.writeFileSync(path.join(dir, "auth-token.bin"), fixture, { mode: 0o600 });
      const store = loadTokenStore(dir);
      assert.equal(store.getSession(), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-token-"));
  try {
    fs.writeFileSync(path.join(dir, ".auth-token-legacy-migrated"), "done");
    fs.writeFileSync(
      path.join(dir, "auth-token.bin"),
      `ENC:${JSON.stringify({ version: 1, access_token: "replayed" })}`
    );
    assert.equal(loadTokenStore(dir).getSession(), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
