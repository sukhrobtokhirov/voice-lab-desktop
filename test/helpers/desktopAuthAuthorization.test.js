const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const INSTALLATION_ID = "0191f85b-7b5d-7f2a-8d71-2f5ea87cdf77";
const REQUEST_ID = `dau_${"r".repeat(43)}`;
const CALLBACK_CODE = `dac_${"c".repeat(43)}`;

function jsonResponse(status, body) {
  return new Response(body == null ? null : JSON.stringify(body), { status });
}

function loadDesktopAuthManager(initialSession = null) {
  const modulePath = require.resolve("../../src/helpers/desktopAuthManager");
  delete require.cache[modulePath];
  let pending = null;
  let storedSession = initialSession ? { ...initialSession } : null;
  let openedUrl = null;
  let openCount = 0;
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
    if (request === "electron") {
      return {
        shell: {
          openExternal: async (url) => {
            openedUrl = url;
            openCount += 1;
          },
        },
      };
    }
    if (request === "./tokenStore") return tokenStore;
    if (request === "./authLogger") return { warn: () => {}, info: () => {} };
    if (request === "os") return { hostname: () => "  Studio\u0000 \u202e Workstation\n" };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return {
      DesktopAuthManager: require(modulePath),
      getOpenedUrl: () => openedUrl,
      getOpenCount: () => openCount,
      getPending: () => pending,
      getStoredSession: () => storedSession,
      expirePending: () => {
        pending.expiresAt = Date.now() - 1;
      },
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

test("starts system-browser PKCE authorization through the exact Go contract", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  const { DesktopAuthManager, getOpenedUrl, getPending } = loadDesktopAuthManager();
  const manager = managerFrom(DesktopAuthManager);
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return jsonResponse(201, {
      authorization_request_id: REQUEST_ID,
      authorization_url: `https://voicelab.uz/app/sign-in?desktop_auth_id=${REQUEST_ID}`,
      expires_in: 600,
    });
  };

  const status = await manager.startAuthorization();

  assert.equal(status.status, "waiting-for-browser");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.voicelab.uz/api/v2/auth/desktop/authorizations");
  const request = JSON.parse(calls[0].init.body);
  assert.equal(request.client_id, "voicelab-desktop");
  assert.equal(request.redirect_uri, "voicelab://auth/callback");
  assert.equal(request.code_challenge_method, "S256");
  assert.match(request.code_challenge, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(getPending().codeVerifier.length, 43);
  assert.match(getPending().codeVerifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(request.state.length, 43);
  assert.match(request.state, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(
    request.code_challenge,
    require("node:crypto")
      .createHash("sha256")
      .update(getPending().codeVerifier)
      .digest("base64url")
  );
  assert.deepEqual(Object.keys(request).sort(), [
    "app_version",
    "client_id",
    "code_challenge",
    "code_challenge_method",
    "device_name",
    "installation_id",
    "platform",
    "redirect_uri",
    "state",
  ]);
  assert.equal(request.installation_id, INSTALLATION_ID);
  assert.equal(request.device_name, "Studio Workstation");
  assert.equal(request.app_version, "1.8.0");
  assert.equal(request.platform, process.platform === "win32" ? "windows" : process.platform);
  assert.equal(getPending().authorizationRequestId, REQUEST_ID);
  assert.equal(getOpenedUrl(), `https://voicelab.uz/app/sign-in?desktop_auth_id=${REQUEST_ID}`);
  assert.equal(new URL(getOpenedUrl()).pathname, "/app/sign-in");
  assert.equal(new URL(getOpenedUrl()).searchParams.get("desktop_auth_id"), REQUEST_ID);
  assert.equal(new URL(getOpenedUrl()).searchParams.get("state"), null);
});

test("reopens and cancels an existing authorization without replacing PKCE state", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  const { DesktopAuthManager, getOpenCount, getOpenedUrl, getPending } = loadDesktopAuthManager();
  const manager = managerFrom(DesktopAuthManager);
  let authorizationRequests = 0;
  global.fetch = async () => {
    authorizationRequests += 1;
    return jsonResponse(201, {
      authorization_request_id: REQUEST_ID,
      authorization_url: `https://voicelab.uz/app/sign-in?desktop_auth_id=${REQUEST_ID}`,
      expires_in: 600,
    });
  };

  await manager.startAuthorization();
  const originalPending = getPending();
  await manager.startAuthorization();

  assert.equal(authorizationRequests, 1);
  assert.equal(getOpenCount(), 2);
  assert.equal(getPending().state, originalPending.state);
  assert.equal(new URL(getOpenedUrl()).searchParams.get("desktop_auth_id"), REQUEST_ID);

  const cancelled = manager.cancelAuthorization();
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.errorCode, "AUTH_CANCELLED_BY_USER");
  assert.equal(getPending(), null);
});

test("surfaces the exact sanitized backend failure alongside its stable error code", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  const { DesktopAuthManager } = loadDesktopAuthManager();
  const manager = managerFrom(DesktopAuthManager);
  global.fetch = async () =>
    new Response("upstream returned HTML", {
      status: 502,
      headers: { "Content-Type": "text/html" },
    });

  await assert.rejects(manager.startAuthorization(), {
    code: "AUTH_BACKEND_RESPONSE_INVALID",
    message: "Authentication server returned an invalid response",
  });
  assert.deepEqual(manager.getPublicStatus(), {
    status: "error",
    user: null,
    errorCode: "AUTH_BACKEND_RESPONSE_INVALID",
    errorMessage: "Authentication server returned an invalid response",
  });
});

test("rejects untrusted, unbound, or extra authorization URL values", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  const { DesktopAuthManager, getOpenedUrl, getPending } = loadDesktopAuthManager();
  const manager = managerFrom(DesktopAuthManager);

  for (const makeUrl of [
    () => `https://evil.example/app/sign-in?desktop_auth_id=${REQUEST_ID}`,
    () => `https://voicelab.uz/app/home?desktop_auth_id=${REQUEST_ID}`,
    () => `https://voicelab.uz/app/sign-in?desktop_auth_id=tampered`,
    () => `https://voicelab.uz/app/sign-in?desktop_auth_id=${REQUEST_ID}&next=https://evil.example`,
    (state) => `https://voicelab.uz/app/sign-in?desktop_auth_id=${REQUEST_ID}&state=${state}`,
  ]) {
    global.fetch = async (_url, init) => {
      const request = JSON.parse(init.body);
      return jsonResponse(201, {
        authorization_request_id: REQUEST_ID,
        authorization_url: makeUrl(request.state),
        expires_in: 600,
      });
    };
    await assert.rejects(manager.startAuthorization(), (error) => {
      assert.match(error.code, /^AUTHORIZATION_(?:ORIGIN_REJECTED|URL_INVALID)$/);
      return true;
    });
    assert.equal(getOpenedUrl(), null);
    assert.equal(getPending(), null);
  }

  global.fetch = async () => {
    const legacyId = "3b1715a0-75c2-4fd4-bdd8-a7bfb42a9e65";
    return jsonResponse(201, {
      authorization_request_id: legacyId,
      authorization_url: `https://voicelab.uz/app/sign-in?desktop_auth_id=${legacyId}`,
    });
  };
  await assert.rejects(
    manager.startAuthorization(),
    (error) => error.code === "AUTHORIZATION_RESPONSE_INVALID"
  );
});

test("v1 callback exchanges code and PKCE verifier without browser cookies", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  const { DesktopAuthManager, getPending, getStoredSession } = loadDesktopAuthManager();
  const manager = managerFrom(DesktopAuthManager);
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/authorizations")) {
      return jsonResponse(201, {
        authorization_request_id: REQUEST_ID,
        authorization_url: `https://voicelab.uz/app/sign-in?desktop_auth_id=${REQUEST_ID}`,
        expires_in: 600,
      });
    }
    return jsonResponse(200, {
      access_token: "access-token-abcdefghijklmnopqrstuvwxyz",
      refresh_token: "refresh-token-abcdefghijklmnopqrstuvwxyz",
      expires_in: 900,
      refresh_expires_in: 3600,
      session_id: "desktop-session-1",
      user: { id: "user-7", email: "desktop@example.com" },
    });
  };
  await manager.startAuthorization();
  const pending = getPending();

  const status = await manager.handleCallback(
    `voicelab://auth/callback?v=1&code=${CALLBACK_CODE}&state=${pending.state}`
  );

  assert.equal(status.status, "authenticated");
  const exchange = calls[1];
  assert.equal(exchange.url, "https://api.voicelab.uz/api/v2/auth/desktop/token");
  assert.equal(exchange.init.credentials, undefined);
  assert.equal(exchange.init.headers.Origin, undefined);
  assert.equal(exchange.init.headers.Referer, undefined);
  const body = JSON.parse(exchange.init.body);
  assert.deepEqual(body, {
    grant_type: "authorization_code",
    client_id: "voicelab-desktop",
    redirect_uri: "voicelab://auth/callback",
    code: CALLBACK_CODE,
    code_verifier: pending.codeVerifier,
    installation_id: INSTALLATION_ID,
  });
  assert.equal(getPending(), null);
  assert.equal(getStoredSession().refreshToken, "refresh-token-abcdefghijklmnopqrstuvwxyz");

  const requestCountAfterExchange = calls.length;
  const duplicateStatus = await manager.handleCallback(
    `voicelab://auth/callback?code=${CALLBACK_CODE}&state=${pending.state}`
  );
  assert.equal(duplicateStatus.status, "authenticated");
  assert.equal(calls.length, requestCountAfterExchange);
});

test("expired and state-mismatched callbacks cannot exchange a code", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  const { DesktopAuthManager, expirePending, getPending } = loadDesktopAuthManager();
  const manager = managerFrom(DesktopAuthManager);
  let exchanges = 0;
  global.fetch = async (url) => {
    if (url.endsWith("/authorizations")) {
      return jsonResponse(201, {
        authorization_request_id: REQUEST_ID,
        authorization_url: `https://voicelab.uz/app/sign-in?desktop_auth_id=${REQUEST_ID}`,
      });
    }
    exchanges += 1;
    return jsonResponse(500, {});
  };

  await manager.startAuthorization();
  const validState = getPending().state;
  await assert.rejects(
    manager.handleCallback(
      `voicelab://auth/callback?v=1&code=${CALLBACK_CODE}&state=${"x".repeat(43)}`
    ),
    (error) => error.code === "AUTH_STATE_MISMATCH"
  );
  assert.equal(getPending().state, validState);
  expirePending();
  const status = await manager.handleCallback(
    `voicelab://auth/callback?v=1&code=${CALLBACK_CODE}&state=${validState}`
  );
  assert.equal(status.status, "expired");
  assert.equal(exchanges, 0);
  assert.equal(getPending(), null);
});

test("duplicate callbacks exchange exactly once while the first exchange is active", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  const { DesktopAuthManager, getPending } = loadDesktopAuthManager();
  const manager = managerFrom(DesktopAuthManager);
  let resolveExchange;
  let exchanges = 0;
  global.fetch = async (url) => {
    if (url.endsWith("/authorizations")) {
      return jsonResponse(201, {
        authorization_request_id: REQUEST_ID,
        authorization_url: `https://voicelab.uz/app/sign-in?desktop_auth_id=${REQUEST_ID}`,
      });
    }
    exchanges += 1;
    return new Promise((resolve) => {
      resolveExchange = () =>
        resolve(
          jsonResponse(200, {
            access_token: "access-token-abcdefghijklmnopqrstuvwxyz",
            refresh_token: "refresh-token-abcdefghijklmnopqrstuvwxyz",
            user: { id: "user-7", email: "desktop@example.com" },
          })
        );
    });
  };
  await manager.startAuthorization();
  const callback = `voicelab://auth/callback?v=1&code=${CALLBACK_CODE}&state=${getPending().state}`;

  const first = manager.handleCallback(callback);
  await new Promise((resolve) => setImmediate(resolve));
  const duplicateStatus = await manager.handleCallback(callback);
  assert.equal(duplicateStatus.status, "exchanging");
  assert.equal(exchanges, 1);
  resolveExchange();
  assert.equal((await first).status, "authenticated");
});

test("callback parser rejects duplicate, extra, and wrong-version parameters", () => {
  const { DesktopAuthManager } = loadDesktopAuthManager();
  const manager = managerFrom(DesktopAuthManager);
  const state = "s".repeat(43);
  assert.deepEqual(
    manager._parseCallback(`voicelab://auth/callback?code=${CALLBACK_CODE}&state=${state}`),
    { code: CALLBACK_CODE, state }
  );
  for (const callback of [
    `voicelab://auth/callback?v=2&code=${CALLBACK_CODE}&state=${state}`,
    `voicelab://auth/callback?v=1&code=${CALLBACK_CODE}&state=${state}&state=${state}`,
    `voicelab://auth/callback?v=1&code=${CALLBACK_CODE}&state=${state}&access_token=secret`,
    `voicelab://auth/callback?code=legacy-code-abcdefghijklmnopqrstuvwxyz&state=${state}`,
    `voicelab://auth/callback?code=${CALLBACK_CODE}&state=${"short"}`,
    `voicelab://auth/callback?error=access_denied&state=${state}`,
    `voicelab://auth/callback?code=${CALLBACK_CODE}&state=${"s".repeat(257)}`,
  ]) {
    assert.throws(
      () => manager._parseCallback(callback),
      (error) => error.code === "AUTH_CALLBACK_INVALID"
    );
  }
});

test("starting and cold-bootstrapping a new authorization preserves the current session", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  const existing = {
    kind: "desktop-go-v2",
    accessToken: "existing-access-token-abcdefghijklmnopqrstuvwxyz",
    accessExpiresAt: Date.now() + 10 * 60_000,
    refreshToken: "existing-refresh-token-abcdefghijklmnopqrstuvwxyz",
    refreshExpiresAt: Date.now() + 60 * 60_000,
    sessionId: "existing-session",
    user: { id: "existing-user", email: "existing@example.com" },
  };
  const { DesktopAuthManager, getPending, getStoredSession } = loadDesktopAuthManager(existing);
  const manager = managerFrom(DesktopAuthManager);
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/authorizations")) {
      return jsonResponse(201, {
        authorization_request_id: REQUEST_ID,
        authorization_url: `https://voicelab.uz/app/sign-in?desktop_auth_id=${REQUEST_ID}`,
      });
    }
    if (url.endsWith("/api/v2/auth/me")) return jsonResponse(200, { user: existing.user });
    throw new Error(`Unexpected request: ${url}`);
  };

  await manager.startAuthorization();
  assert.equal(calls.length, 1);
  assert.equal(getStoredSession().sessionId, "existing-session");
  assert.ok(getPending());

  const restarted = managerFrom(DesktopAuthManager);
  const status = await restarted.initialize();
  assert.equal(status.status, "authenticated");
  assert.equal(calls.length, 2);
  assert.ok(getPending());
});
