const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const INSTALLATION_ID = "0191f85b-7b5d-7f2a-8d71-2f5ea87cdf77";

function jsonResponse(body, status = 200) {
  return new Response(body == null ? null : JSON.stringify(body), { status });
}

function loadDesktopAuthManager(initialSession) {
  const modulePath = require.resolve("../../src/helpers/desktopAuthManager");
  delete require.cache[modulePath];
  let storedSession = initialSession ? { ...initialSession } : null;
  const tokenStore = {
    getInstallationId: () => INSTALLATION_ID,
    getSession: () => (storedSession ? { ...storedSession } : null),
    saveSession: (value) => {
      storedSession = { ...value };
    },
    clearSession: () => {
      storedSession = null;
    },
    getPending: () => null,
    clearPending: () => {},
  };
  const originalLoad = Module._load;
  Module._load = function mockedLoad(request, parent, isMain) {
    if (request === "electron") return { shell: { openExternal: async () => {} } };
    if (request === "./tokenStore") return tokenStore;
    if (request === "./authLogger") return { warn: () => {}, info: () => {} };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return {
      DesktopAuthManager: require(modulePath),
      getSession: () => storedSession,
    };
  } finally {
    Module._load = originalLoad;
  }
}

function managerFrom(DesktopAuthManager) {
  return new DesktopAuthManager({
    channel: "production",
    scheme: "voicelab",
    appVersion: "1.8.0",
    apiBaseUrl: "https://api.voicelab.uz",
    authWebBaseUrl: "https://voicelab.uz",
    authorizationOrigins: ["https://voicelab.uz"],
  });
}

function initialSession() {
  return {
    kind: "desktop-go-v2",
    accessToken: "expired-access-token",
    accessExpiresAt: 0,
    refreshToken: `refresh-old-${"r".repeat(40)}`,
    refreshExpiresAt: Date.now() + 60_000,
    sessionId: "desktop-session-1",
    user: { id: "7", email: "desktop@example.com" },
  };
}

test("refresh uses the token grant, rotates refresh token, and reuses idempotency after retry", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  const session = initialSession();
  const { DesktopAuthManager, getSession } = loadDesktopAuthManager(session);
  const manager = managerFrom(DesktopAuthManager);
  const requests = [];
  global.fetch = async (url, init) => {
    requests.push({ url, init });
    if (requests.length === 1) throw new Error("connection reset");
    return jsonResponse({
      access_token: "new-access-token-abcdefghijklmnopqrstuvwxyz",
      refresh_token: `refresh-new-${"n".repeat(40)}`,
      expires_in: 900,
      refresh_expires_in: 3600,
      session_id: session.sessionId,
      user: session.user,
    });
  };

  await assert.rejects(
    manager.refreshSession({ force: true, validateUser: false }),
    /connection reset/
  );
  await manager.refreshSession({ force: true, validateUser: false });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "https://api.voicelab.uz/api/v2/auth/desktop/token");
  assert.equal(
    requests[0].init.headers["Idempotency-Key"],
    requests[1].init.headers["Idempotency-Key"]
  );
  assert.match(requests[0].init.headers["Idempotency-Key"], /^desktop-refresh-[A-Za-z0-9_-]{43}$/);
  const body = JSON.parse(requests[1].init.body);
  assert.equal(body.grant_type, "refresh_token");
  assert.equal(body.client_id, "voicelab-desktop");
  assert.equal(body.refresh_token, session.refreshToken);
  assert.equal(body.installation_id, INSTALLATION_ID);
  assert.deepEqual(Object.keys(body).sort(), [
    "client_id",
    "grant_type",
    "installation_id",
    "refresh_token",
  ]);
  assert.equal(getSession().refreshToken, `refresh-new-${"n".repeat(40)}`);
});

test("refresh rejects a response that does not rotate the refresh credential", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  const session = initialSession();
  const { DesktopAuthManager, getSession } = loadDesktopAuthManager(session);
  const manager = managerFrom(DesktopAuthManager);
  global.fetch = async () =>
    jsonResponse({
      access_token: "new-access-token-abcdefghijklmnopqrstuvwxyz",
      refresh_token: session.refreshToken,
      user: session.user,
    });

  await assert.rejects(
    manager.refreshSession({ force: true, validateUser: false }),
    (error) => error.code === "AUTH_REFRESH_ROTATION_REQUIRED"
  );
  assert.equal(getSession().refreshToken, session.refreshToken);
});

test("logout always clears local credentials and reports failed network revocation", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  const { DesktopAuthManager, getSession } = loadDesktopAuthManager({
    ...initialSession(),
    accessExpiresAt: Date.now() + 10 * 60_000,
  });
  const manager = managerFrom(DesktopAuthManager);
  let logoutRequest;
  global.fetch = async (url, init) => {
    logoutRequest = { url, init };
    throw new Error("offline");
  };

  const result = await manager.logout();

  assert.deepEqual(result, { success: true, revoked: false });
  assert.equal(logoutRequest.url, "https://api.voicelab.uz/api/v2/auth/desktop/logout");
  assert.equal(logoutRequest.init.headers.Authorization, "Bearer expired-access-token");
  assert.deepEqual(JSON.parse(logoutRequest.init.body), {
    refresh_token: initialSession().refreshToken,
    installation_id: INSTALLATION_ID,
  });
  assert.equal(getSession(), null);
  assert.equal(manager.getPublicStatus().status, "signed-out");
});
