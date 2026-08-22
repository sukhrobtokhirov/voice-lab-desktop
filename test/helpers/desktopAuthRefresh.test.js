const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const INSTALLATION_ID = "0191f85b-7b5d-7f2a-8d71-2f5ea87cdf77";
const REQUEST_ID = `dau_${"r".repeat(43)}`;

function jsonResponse(body, status = 200) {
  let payload = body;
  if (body && typeof body === "object") {
    payload = { request_id: "req_test_refresh", ...body };
    if (payload.authorization_request_id) payload.expires_in ??= 600;
    if (payload.access_token) {
      payload.token_type ??= "Bearer";
      payload.expires_in ??= 900;
      payload.refresh_expires_in ??= 3600;
      payload.session_id ??= "dss_test_refresh";
    }
  }
  return new Response(payload == null ? null : JSON.stringify(payload), {
    status,
    headers: payload == null ? {} : { "Content-Type": "application/json" },
  });
}

function unsignedJwt(payload) {
  return [
    Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "test-signature",
  ].join(".");
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

test("refresh sends only the exact token grant and atomically rotates the credential", async (t) => {
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
    return jsonResponse({
      access_token: "new-access-token-abcdefghijklmnopqrstuvwxyz",
      refresh_token: `refresh-new-${"n".repeat(40)}`,
      expires_in: 900,
      refresh_expires_in: 3600,
      session_id: session.sessionId,
    });
  };

  await manager.refreshSession({ force: true });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.voicelab.uz/api/v2/auth/desktop/token");
  assert.equal(requests[0].init.headers["Idempotency-Key"], undefined);
  const body = JSON.parse(requests[0].init.body);
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

test("refresh restores display identity from the new access JWT when the response omits user", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  const refreshOnlySession = {
    kind: "desktop-go-v2",
    accessToken: "",
    accessExpiresAt: 0,
    refreshToken: `refresh-old-${"r".repeat(40)}`,
    refreshExpiresAt: 0,
    sessionId: "",
    user: null,
  };
  const { DesktopAuthManager, getSession } = loadDesktopAuthManager(refreshOnlySession);
  const manager = managerFrom(DesktopAuthManager);
  global.fetch = async () =>
    jsonResponse({
      access_token: unsignedJwt({
        sub: "user-after-restart",
        email: "desktop@example.com",
        name: "Desktop Person",
        picture: "https://cdn.voicelab.uz/avatar/user-after-restart.png",
      }),
      refresh_token: `refresh-new-${"n".repeat(40)}`,
      session_id: "dss_after_restart",
    });

  const status = await manager.initialize();
  assert.equal(status.status, "authenticated");
  assert.deepEqual(status.user, {
    id: "user-after-restart",
    email: "desktop@example.com",
    name: "Desktop Person",
    image: "https://cdn.voicelab.uz/avatar/user-after-restart.png",
  });
  assert.equal(getSession().sessionId, "dss_after_restart");
  assert.equal(await manager.getValidAccessToken(), getSession().accessToken);
});

test("refresh never reports an authenticated user when no display profile can be restored", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  const refreshOnlySession = {
    kind: "desktop-go-v2",
    accessToken: "",
    accessExpiresAt: 0,
    refreshToken: `refresh-old-${"r".repeat(40)}`,
    refreshExpiresAt: 0,
    sessionId: "",
    user: null,
  };
  const { DesktopAuthManager, getSession } = loadDesktopAuthManager(refreshOnlySession);
  const manager = managerFrom(DesktopAuthManager);
  global.fetch = async () =>
    jsonResponse({
      access_token: unsignedJwt({ sub: "user-without-display-profile" }),
      refresh_token: `refresh-new-${"n".repeat(40)}`,
      session_id: "dss_missing_profile",
    });

  const status = await manager.initialize();

  assert.equal(status.status, "signed-out");
  assert.equal(status.errorCode, "AUTH_PROFILE_REQUIRED");
  assert.equal(status.user, null);
  assert.equal(getSession(), null);
});

test("an expired local refresh credential signs the user out with an explicit reason", async () => {
  const expiredSession = {
    ...initialSession(),
    refreshExpiresAt: Date.now() - 1,
  };
  const { DesktopAuthManager, getSession } = loadDesktopAuthManager(expiredSession);
  const manager = managerFrom(DesktopAuthManager);

  await assert.rejects(
    manager.refreshSession({ force: true }),
    (error) => error.code === "AUTH_EXPIRED"
  );

  assert.equal(getSession(), null);
  assert.deepEqual(
    {
      status: manager.getPublicStatus().status,
      errorCode: manager.getPublicStatus().errorCode,
    },
    { status: "signed-out", errorCode: "AUTH_EXPIRED" }
  );
});

test("invalid_refresh_token clears the desktop session and preserves diagnostics", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  const { DesktopAuthManager, getSession } = loadDesktopAuthManager(initialSession());
  const manager = managerFrom(DesktopAuthManager);
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        message: "The refresh token is invalid or expired.",
        error: { code: "invalid_refresh_token" },
        request_id: "req_invalid_refresh",
      }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );

  await assert.rejects(manager.refreshSession({ force: true }), (error) => {
    assert.equal(error.code, "invalid_refresh_token");
    assert.equal(error.requestId, "req_invalid_refresh");
    return true;
  });
  assert.equal(getSession(), null);
  assert.deepEqual(manager.getPublicStatus(), {
    status: "signed-out",
    user: null,
    errorCode: "invalid_refresh_token",
    errorMessage: "The refresh token is invalid or expired.",
    errorRequestId: "req_invalid_refresh",
  });
});

test("auth_unavailable preserves the rotating refresh credential for explicit retry", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  const session = initialSession();
  const { DesktopAuthManager, getSession } = loadDesktopAuthManager(session);
  const manager = managerFrom(DesktopAuthManager);
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        message: "Desktop authentication is temporarily unavailable.",
        error: { code: "auth_unavailable" },
        request_id: "req_auth_unavailable",
      }),
      {
        status: 503,
        headers: { "Content-Type": "application/json", "Retry-After": "8" },
      }
    );

  await assert.rejects(manager.refreshSession({ force: true }), (error) => {
    assert.equal(error.code, "auth_unavailable");
    assert.equal(error.retryAfterSeconds, 8);
    return true;
  });
  assert.equal(getSession().refreshToken, session.refreshToken);
  assert.deepEqual(manager.getPublicStatus(), {
    status: "error",
    user: null,
    errorCode: "auth_unavailable",
    errorMessage: "Desktop authentication is temporarily unavailable.",
    errorRequestId: "req_auth_unavailable",
    retryAfterSeconds: 8,
  });
});

test("authenticated sessions proactively refresh before access-token expiry", async (t) => {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const timers = [];
  t.after(() => {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  });
  global.setTimeout = (callback, delay) => {
    const timer = { callback, delay, unref() {} };
    timers.push(timer);
    return timer;
  };
  global.clearTimeout = () => {};

  const session = {
    ...initialSession(),
    accessExpiresAt: Date.now() + 15 * 60_000,
  };
  const { DesktopAuthManager } = loadDesktopAuthManager(session);
  const manager = managerFrom(DesktopAuthManager);
  let refreshes = 0;
  manager.refreshSession = async ({ force }) => {
    assert.equal(force, true);
    refreshes += 1;
  };

  manager._setStatus("authenticated", { user: session.user });

  assert.equal(timers.length, 1);
  assert.ok(timers[0].delay <= 14 * 60_000);
  assert.ok(timers[0].delay > 13 * 60_000);
  timers[0].callback();
  await Promise.resolve();
  assert.equal(refreshes, 1);
});

test("ambiguous refresh transport failure clears the token to prevent rotated-token reuse", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  const { DesktopAuthManager, getSession } = loadDesktopAuthManager(initialSession());
  const manager = managerFrom(DesktopAuthManager);
  global.fetch = async () => {
    throw new Error("connection reset");
  };

  await assert.rejects(manager.refreshSession({ force: true }), /connection reset/);
  assert.equal(getSession(), null);
  assert.equal(manager.getPublicStatus().status, "signed-out");
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
    });

  await assert.rejects(
    manager.refreshSession({ force: true }),
    (error) => error.code === "AUTH_REFRESH_ROTATION_REQUIRED"
  );
  assert.equal(getSession(), null);
});

test("refresh fails closed on a malformed token response", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  const { DesktopAuthManager, getSession } = loadDesktopAuthManager(initialSession());
  const manager = managerFrom(DesktopAuthManager);
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        access_token: "new-access-token-abcdefghijklmnopqrstuvwxyz",
        refresh_token: `refresh-new-${"n".repeat(40)}`,
        token_type: "bearer",
        expires_in: 900,
        refresh_expires_in: 3600,
        session_id: "dss_invalid_shape",
        request_id: "req_invalid_shape",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  await assert.rejects(
    manager.refreshSession({ force: true }),
    (error) => error.code === "AUTH_TOKEN_RESPONSE_INVALID"
  );
  assert.equal(getSession(), null);
});

test("refresh requires a fresh session_id instead of accepting the stored value", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  const { DesktopAuthManager, getSession } = loadDesktopAuthManager(initialSession());
  const manager = managerFrom(DesktopAuthManager);
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        access_token: "new-access-token-abcdefghijklmnopqrstuvwxyz",
        refresh_token: `refresh-new-${"n".repeat(40)}`,
        token_type: "Bearer",
        expires_in: 900,
        refresh_expires_in: 3600,
        request_id: "req_missing_session_id",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  await assert.rejects(
    manager.refreshSession({ force: true }),
    (error) => error.code === "AUTH_TOKEN_RESPONSE_INVALID"
  );
  assert.equal(getSession(), null);
});

test("refresh ignores an unexpected user payload and preserves the current identity", async (t) => {
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
      refresh_token: `refresh-new-${"n".repeat(40)}`,
      session_id: "dss_preserve_identity",
      user: { id: "attacker", email: "attacker@example.com" },
    });

  const status = await manager.refreshSession({ force: true });
  assert.equal(status.user.id, session.user.id);
  assert.equal(status.user.email, session.user.email);
  assert.equal(getSession().user.id, session.user.id);
  assert.equal(getSession().user.email, session.user.email);
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
            })
          );
      });
    }
    if (url.endsWith("/desktop/logout")) {
      logoutRequest = { url, init };
      return new Promise((resolve) => {
        resolveLogout = () => resolve(new Response(null, { status: 204 }));
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
