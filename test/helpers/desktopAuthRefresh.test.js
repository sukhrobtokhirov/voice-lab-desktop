const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const INSTALLATION_ID = "0191f85b-7b5d-7f2a-8d71-2f5ea87cdf77";
const REQUEST_ID = `dau_${"r".repeat(43)}`;

function jsonResponse(body, status = 200) {
  return new Response(body == null ? null : JSON.stringify(body), { status });
}

function loadDesktopAuthManager(initialSession) {
  const modulePath = require.resolve("../../src/helpers/desktopAuthManager");
  delete require.cache[modulePath];
  let storedSession = initialSession ? { ...initialSession } : null;
  let pending = null;
  const tokenStore = {
    getInstallationId: () => INSTALLATION_ID,
    getSession: () => (storedSession ? { ...storedSession } : null),
    saveSession: (value) => {
      storedSession = { ...value };
    },
    clearSession: () => {
      storedSession = null;
    },
    getPending: () => (pending ? { ...pending } : null),
    savePending: (value) => {
      pending = { ...value };
    },
    clearPending: () => {
      pending = null;
    },
    completeAuthorization: (value) => {
      storedSession = { ...value };
      pending = null;
    },
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
      getPending: () => pending,
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

test("refresh canonicalizes stored Go user aliases without calling me", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  const session = {
    ...initialSession(),
    user: {
      uuid: "user-alias-9",
      username: "alias@example.com",
      display_name: "Alias User",
    },
  };
  const { DesktopAuthManager, getSession } = loadDesktopAuthManager(session);
  const manager = managerFrom(DesktopAuthManager);
  const requests = [];
  global.fetch = async (url) => {
    requests.push(url);
    return jsonResponse({
      access_token: "new-access-token-abcdefghijklmnopqrstuvwxyz",
      refresh_token: `refresh-new-${"n".repeat(40)}`,
      expires_in: 900,
      refresh_expires_in: 3600,
      session_id: session.sessionId,
    });
  };

  const status = await manager.refreshSession({ force: true });

  assert.equal(status.status, "authenticated");
  assert.deepEqual(
    {
      id: status.user.id,
      email: status.user.email,
      name: status.user.name,
    },
    {
      id: "user-alias-9",
      email: "alias@example.com",
      name: "Alias User",
    }
  );
  assert.deepEqual(getSession().user, status.user);
  assert.deepEqual(requests, ["https://api.voicelab.uz/api/v2/auth/desktop/token"]);
});

test("logout clears locally before revoke and a late refresh cannot restore the session", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  const session = initialSession();
  const { DesktopAuthManager, getSession } = loadDesktopAuthManager(session);
  const manager = managerFrom(DesktopAuthManager);
  let resolveRefresh;
  let resolveLogout;
  let logoutRequest;
  global.fetch = async (url, init) => {
    if (url.endsWith("/desktop/token")) {
      return new Promise((resolve) => {
        resolveRefresh = () =>
          resolve(
            jsonResponse({
              access_token: "late-access-token-abcdefghijklmnopqrstuvwxyz",
              refresh_token: `refresh-late-${"l".repeat(40)}`,
              user: session.user,
            })
          );
      });
    }
    if (url.endsWith("/desktop/logout")) {
      logoutRequest = { url, init };
      return new Promise((resolve) => {
        resolveLogout = () => resolve(jsonResponse({ success: true }));
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const refresh = manager.refreshSession({ force: true, validateUser: false });
  await new Promise((resolve) => setImmediate(resolve));
  const logout = manager.logout();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(getSession(), null);
  assert.equal(manager.getPublicStatus().status, "signed-out");
  assert.equal(logoutRequest.init.headers.Authorization, `Bearer ${session.accessToken}`);
  assert.equal(JSON.parse(logoutRequest.init.body).refresh_token, session.refreshToken);

  resolveLogout();
  assert.deepEqual(await logout, { success: true, revoked: true });
  resolveRefresh();
  await assert.rejects(refresh, (error) => error.code === "AUTH_OPERATION_SUPERSEDED");
  assert.equal(getSession(), null);
  assert.equal(manager.getPublicStatus().status, "signed-out");
});

test("a new authorization supersedes an in-flight refresh without overwriting its session", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  const session = initialSession();
  const { DesktopAuthManager, getPending, getSession } = loadDesktopAuthManager(session);
  const manager = managerFrom(DesktopAuthManager);
  let resolveRefresh;
  global.fetch = async (url) => {
    if (url.endsWith("/desktop/token")) {
      return new Promise((resolve) => {
        resolveRefresh = () =>
          resolve(
            jsonResponse({
              access_token: "late-access-token-abcdefghijklmnopqrstuvwxyz",
              refresh_token: `refresh-late-${"l".repeat(40)}`,
              user: session.user,
            })
          );
      });
    }
    if (url.endsWith("/authorizations")) {
      return jsonResponse(
        {
          authorization_request_id: REQUEST_ID,
          authorization_url: `https://voicelab.uz/app/sign-in?desktop_auth_id=${REQUEST_ID}`,
        },
        201
      );
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const refresh = manager.refreshSession({ force: true, validateUser: false });
  await new Promise((resolve) => setImmediate(resolve));
  const authorization = await manager.startAuthorization();
  resolveRefresh();

  assert.equal(authorization.status, "waiting-for-browser");
  assert.equal(getPending().authorizationRequestId, REQUEST_ID);
  await assert.rejects(refresh, (error) => error.code === "AUTH_OPERATION_SUPERSEDED");
  assert.equal(getSession().accessToken, session.accessToken);
  assert.equal(manager.getPublicStatus().status, "waiting-for-browser");
});
