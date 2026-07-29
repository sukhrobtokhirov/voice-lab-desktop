const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

function loadDesktopAuthManager(initialSession) {
  const modulePath = require.resolve("../../src/helpers/desktopAuthManager");
  delete require.cache[modulePath];

  let session = { ...initialSession };
  const tokenStore = {
    getInstallationId: () => "desktop-installation-0001",
    getSession: () => (session ? { ...session } : null),
    saveSession: (value) => {
      session = { ...value };
    },
    clearSession: () => {
      session = null;
    },
  };
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "electron") return { shell: { openExternal: async () => {} } };
    if (request === "./tokenStore") return tokenStore;
    if (request === "./authLogger") return { warn: () => {}, info: () => {} };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return {
      DesktopAuthManager: require(modulePath),
      getSession: () => session,
    };
  } finally {
    Module._load = originalLoad;
  }
}

test("desktop refresh sends current device data and reuses its idempotency key on retry", async () => {
  const initialSession = {
    kind: "desktop-v2",
    accessToken: "expired-access-token",
    accessExpiresAt: 0,
    refreshToken: `vldr_${"r".repeat(80)}`,
    refreshExpiresAt: Date.now() + 60_000,
    sessionId: "9e00d715-87b6-482e-90fe-9d781c9e12fb",
    user: { id: 7, email: "desktop@example.com" },
  };
  const { DesktopAuthManager, getSession } = loadDesktopAuthManager(initialSession);
  const manager = new DesktopAuthManager({
    channel: "production",
    scheme: "voicelab",
    appVersion: "1.8.0",
    apiBaseUrl: "https://api.voicelab.uz",
    authorizationOrigins: ["https://voicelab.uz"],
  });
  const requests = [];
  manager._request = async (path, init) => {
    requests.push({ path, init });
    if (requests.length === 1) throw new Error("connection reset");
    return {
      access_token: "new-access-token",
      expires_in: 900,
      refresh_token: `vldr_${"n".repeat(80)}`,
      refresh_expires_in: 3600,
      session_id: initialSession.sessionId,
      user: initialSession.user,
    };
  };

  await assert.rejects(
    manager.refreshSession({ force: true, validateUser: false }),
    /connection reset/
  );
  await manager.refreshSession({ force: true, validateUser: false });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].path, "/api/v1/auth/desktop/token/refresh/");
  assert.equal(
    requests[0].init.headers["Idempotency-Key"],
    requests[1].init.headers["Idempotency-Key"]
  );
  assert.match(requests[0].init.headers["Idempotency-Key"], /^desktop-refresh-[A-Za-z0-9_-]{43}$/);
  const body = JSON.parse(requests[1].init.body);
  assert.deepEqual(body.device, {
    installation_id: "desktop-installation-0001",
    name: require("node:os").hostname().slice(0, 160) || "VoiceLab Desktop",
    platform: process.platform,
    app_version: "1.8.0",
    channel: "production",
  });
  assert.equal(getSession().refreshToken, `vldr_${"n".repeat(80)}`);
});
