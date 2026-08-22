const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const API_ORIGIN = "https://api.voicelab.test";
const INSTALLATION_ID = "c3050f2f-6f09-46e1-a50c-b7aa7e12ca54";
const AUTHORIZATION_ID = `dau_${"a".repeat(43)}`;
const AUTHORIZATION_CODE = `dac_${"c".repeat(43)}`;

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function loadVoiceLabClient(t) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-request-surface-"));
  const modulePath = require.resolve("../../src/helpers/voiceLabApiClient");
  const storePath = require.resolve("../../src/helpers/dictationOperationStore");
  const originalLoad = Module._load;
  Module._load = function loadWithElectronStub(request, parent, isMain) {
    if (request === "electron") return { app: { getPath: () => userData } };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[modulePath];
    delete require.cache[storePath];
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
    t.after(() => {
      delete require.cache[modulePath];
      delete require.cache[storePath];
      fs.rmSync(userData, { recursive: true, force: true });
    });
  }
}

function createAuthManager() {
  const state = { accessTokenCalls: 0, refreshCalls: 0, invalidations: 0 };
  return {
    state,
    async getValidAccessToken() {
      state.accessTokenCalls += 1;
      return "desktop-access-token";
    },
    getSessionMetadata() {
      return {
        accountId: "account-7",
        installationId: INSTALLATION_ID,
        sessionId: "desktop-session-7",
      };
    },
    async refreshSession() {
      state.refreshCalls += 1;
    },
    invalidateSession() {
      state.invalidations += 1;
    },
  };
}

function createClient(t) {
  const VoiceLabApiClient = loadVoiceLabClient(t);
  const authManager = createAuthManager();
  return {
    authManager,
    client: new VoiceLabApiClient({
      authManager,
      apiBaseUrl: `${API_ORIGIN}/`,
      billingOrigin: "https://voicelab.test/",
      appVersion: "1.8.0",
      channel: "test",
    }),
  };
}

function installFetch(t, implementation) {
  const originalFetch = global.fetch;
  global.fetch = implementation;
  t.after(() => {
    global.fetch = originalFetch;
  });
}

function assertNoBrowserCredentials(init) {
  const headers = new Headers(init.headers);
  assert.equal(init.credentials, undefined);
  assert.equal(headers.has("cookie"), false);
  assert.equal(headers.has("origin"), false);
  assert.equal(headers.has("referer"), false);
}

test("every supported VoiceLab data endpoint has an exact method, URL, and credential boundary", async (t) => {
  const { client, authManager } = createClient(t);
  const calls = [];
  installFetch(t, async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/billing/desktop/pricing")) {
      return jsonResponse({
        enabled: false,
        currency: "USD",
        provider: "polar",
        plans: [],
        request_id: "req_pricing",
      });
    }
    if (url.endsWith("/desktop/usage")) {
      return jsonResponse({
        desktop_stt: {
          enabled: true,
          plan_id: "plan_pro",
          plan_name: "Pro",
          usage_window: "day",
          usage_limit_seconds: 28_800,
          used_seconds: 842,
          reserved_seconds: 0,
          remaining_seconds: 27_958,
          max_request_seconds: 300,
          window_starts_at: "2026-08-22T00:00:00Z",
          resets_at: "2026-08-23T00:00:00Z",
        },
        request_id: "req_subscription",
      });
    }
    if (url.endsWith("/v1/desktop/stt")) {
      return jsonResponse({
        text: "salom",
        language: "uz",
        duration_ms: 1_250,
        usage: {
          used_seconds: 12,
          limit_seconds: 120,
          remaining_seconds: 108,
          usage_window: "day",
        },
        request_id: "req_stt",
      });
    }
    return jsonResponse({ ok: true, request_id: `req_sync_${calls.length}` });
  });

  await client.getDesktopPricing();
  await client.getDesktopUsage();
  await client.sendDictationChunk(
    {
      operationId: "operation-7",
      accountId: "account-7",
      authContext: { accountId: "account-7", sessionId: "desktop-session-7" },
      language: "uz",
      durationMs: 1_250,
    },
    Buffer.from("audio"),
    { contentType: "audio/mpeg" }
  );
  assert.equal(calls.length, 3);
  assert.deepEqual(
    calls.map(({ url, init }) => [url, init.method]),
    [
      [`${API_ORIGIN}/api/v1/billing/desktop/pricing`, "GET"],
      [`${API_ORIGIN}/v1/desktop/usage`, "GET"],
      [`${API_ORIGIN}/v1/desktop/stt`, "POST"],
    ]
  );

  for (const { init } of calls) assertNoBrowserCredentials(init);
  const pricingHeaders = new Headers(calls[0].init.headers);
  assert.equal(pricingHeaders.has("authorization"), false);
  assert.equal(pricingHeaders.has("x-voicelab-installation-id"), false);
  assert.equal(pricingHeaders.has("x-voicelab-session-id"), false);
  assert.equal(authManager.state.accessTokenCalls, 2);

  for (const { init } of calls.slice(1)) {
    const headers = new Headers(init.headers);
    assert.equal(headers.get("authorization"), "Bearer desktop-access-token");
    assert.equal(headers.has("x-voicelab-client"), false);
    assert.equal(headers.has("x-voicelab-app-version"), false);
    assert.equal(headers.has("x-voicelab-channel"), false);
    assert.equal(headers.has("x-voicelab-installation-id"), false);
    assert.equal(headers.has("x-voicelab-session-id"), false);
  }
  assert.equal(new Headers(calls[1].init.headers).has("content-type"), false);
  assert.equal(new Headers(calls[2].init.headers).has("content-type"), false);
  assert.ok(calls[2].init.body instanceof FormData);
  assert.equal(authManager.state.refreshCalls, 0);
  assert.equal(authManager.state.invalidations, 0);
});

test("retired desktop sync methods fail closed without making a network request", async (t) => {
  const { client, authManager } = createClient(t);
  let calls = 0;
  installFetch(t, async () => {
    calls += 1;
    return jsonResponse({ ok: true });
  });

  for (const operation of [
    () => client.getSyncBootstrap("cursor"),
    () => client.pushSyncMutations({ mutations: [] }, "idem"),
    () => client.getSyncChanges("cursor", 20),
  ]) {
    await assert.rejects(operation(), {
      code: "DESKTOP_ENDPOINT_UNAVAILABLE",
      status: 501,
    });
  }
  assert.equal(calls, 0);
  assert.equal(authManager.state.accessTokenCalls, 0);
});

test("authenticated subscription errors preserve fixtures and never retry", async (t) => {
  const { client, authManager } = createClient(t);
  const calls = [];
  installFetch(t, async (url, init) => {
    calls.push({ url, init });
    return jsonResponse(
      {
        error: {
          code: "rate_limited",
          message: "Try later.\u0000",
          fields: { cursor: "Wait before polling again." },
        },
        request_id: `req_rate_${calls.length}`,
      },
      429,
      { "retry-after": "11" }
    );
  });

  const operations = [() => client.getDesktopUsage()];
  for (let index = 0; index < operations.length; index += 1) {
    await assert.rejects(operations[index](), (error) => {
      assert.equal(error.code, "RATE_LIMITED");
      assert.equal(error.status, 429);
      assert.equal(error.retryAfterSeconds, 11);
      assert.equal(error.toPublic().requestId, `req_rate_${index + 1}`);
      assert.deepEqual(error.toPublic().fields, { cursor: "Wait before polling again." });
      return true;
    });
    assert.equal(calls.length, index + 1, "the endpoint must make exactly one request");
  }
  assert.equal(authManager.state.refreshCalls, 0);
  assert.equal(authManager.state.invalidations, 0);
});

test("desktop usage unavailable preserves the documented server code", async (t) => {
  const { client } = createClient(t);
  installFetch(t, async () =>
    jsonResponse(
      {
        message: "Desktop usage is temporarily unavailable.",
        error: { code: "desktop_usage_unavailable" },
        request_id: "req_usage_unavailable",
      },
      503
    )
  );

  await assert.rejects(client.getDesktopUsage(), (error) => {
    assert.equal(error.code, "SERVICE_UNAVAILABLE");
    assert.equal(error.status, 503);
    assert.equal(error.toPublic().serverCode, "desktop_usage_unavailable");
    assert.equal(error.toPublic().requestId, "req_usage_unavailable");
    return true;
  });
});

test("desktop subscription usage is never cached", async (t) => {
  const { client } = createClient(t);
  let calls = 0;
  installFetch(t, async () => {
    calls += 1;
    return jsonResponse({
      desktop_stt: {
        enabled: true,
        plan_id: "plan_pro",
        plan_name: "Pro",
        usage_window: "day",
        usage_limit_seconds: 28_800,
        used_seconds: calls,
        reserved_seconds: 0,
        remaining_seconds: 28_800 - calls,
        max_request_seconds: 300,
        window_starts_at: "2026-08-22T00:00:00Z",
        resets_at: "2026-08-23T00:00:00Z",
      },
      request_id: `req_subscription_${calls}`,
    });
  });

  const first = await client.getDesktopUsage();
  const second = await client.getDesktopUsage();
  assert.equal(calls, 2);
  assert.notEqual(second.requestId, first.requestId);
});

test("public pricing preserves Retry-After and structured error diagnostics", async (t) => {
  const { client } = createClient(t);
  let calls = 0;
  installFetch(t, async () => {
    calls += 1;
    return jsonResponse(
      {
        error: {
          code: "rate_limited",
          message: "Pricing is rate limited.",
          fields: { pricing: "Retry later." },
        },
        request_id: "req_pricing_rate_limit",
      },
      429,
      { "retry-after": "23" }
    );
  });

  await assert.rejects(client.getDesktopPricing(), (error) => {
    assert.equal(error.code, "RATE_LIMITED");
    assert.equal(error.status, 429);
    assert.equal(error.retryAfterSeconds, 23);
    assert.equal(error.toPublic().requestId, "req_pricing_rate_limit");
    assert.deepEqual(error.toPublic().fields, { pricing: "Retry later." });
    return true;
  });
  assert.equal(calls, 1);
});

test("invalid pricing JSON retains request id and content type diagnostics", async (t) => {
  const { client } = createClient(t);
  installFetch(
    t,
    async () =>
      new Response("<html>upstream failure</html>", {
        status: 502,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "x-request-id": "req_pricing_invalid_json",
        },
      })
  );

  await assert.rejects(client.getDesktopPricing(), (error) => {
    assert.equal(error.code, "BACKEND_RESPONSE_INVALID");
    assert.equal(error.status, 502);
    assert.equal(error.details.request_id, "req_pricing_invalid_json");
    assert.equal(error.details.content_type, "text/html");
    return true;
  });
});

test("authenticated cancellation remains active while the response body is streaming", async (t) => {
  const { client } = createClient(t);
  const externalController = new AbortController();
  let bodyReadStarted;
  const bodyStarted = new Promise((resolve) => {
    bodyReadStarted = resolve;
  });
  let calls = 0;
  installFetch(t, async (_url, init) => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      text() {
        bodyReadStarted();
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve('{"ok":true}'), 75);
          init.signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            },
            { once: true }
          );
        });
      },
    };
  });

  const request = client.authenticatedFetch("/api/v1/desktop/sync/changes/?limit=1", {
    signal: externalController.signal,
    timeoutMs: 1_000,
  });
  await bodyStarted;
  externalController.abort("user cancelled");

  await assert.rejects(request, (error) => {
    assert.equal(error.code, "CANCELLED");
    return true;
  });
  assert.equal(calls, 1);
});

test("public pricing timeout remains active while the response body is streaming", async (t) => {
  const { client } = createClient(t);
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (callback, milliseconds, ...args) =>
    originalSetTimeout(callback, milliseconds === 15_000 ? 5 : milliseconds, ...args);
  t.after(() => {
    global.setTimeout = originalSetTimeout;
  });
  let calls = 0;
  installFetch(t, async (_url, init) => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      text() {
        return new Promise((resolve, reject) => {
          const timer = originalSetTimeout(
            () => resolve('{"enabled":false,"plans":[],"request_id":"req_slow"}'),
            50
          );
          init.signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            },
            { once: true }
          );
        });
      },
    };
  });

  await assert.rejects(client.getDesktopPricing(), (error) => {
    assert.equal(error.code, "SERVICE_UNAVAILABLE");
    return true;
  });
  assert.equal(calls, 1);
});

function loadDesktopAuthManager(t) {
  const modulePath = require.resolve("../../src/helpers/desktopAuthManager");
  delete require.cache[modulePath];
  let session = null;
  let pending = null;
  const tokenStore = {
    getInstallationId: () => INSTALLATION_ID,
    getSession: () => (session ? { ...session } : null),
    saveSession: (value) => {
      session = { ...value };
    },
    clearSession: () => {
      session = null;
    },
    getPending: () => (pending ? { ...pending } : null),
    savePending: (value) => {
      pending = { ...value };
    },
    clearPending: () => {
      pending = null;
    },
    completeAuthorization: (value) => {
      session = { ...value };
      pending = null;
    },
  };
  const originalLoad = Module._load;
  Module._load = function loadWithAuthStubs(request, parent, isMain) {
    if (request === "electron") return { shell: { openExternal: async () => {} } };
    if (request === "./tokenStore") return tokenStore;
    if (request === "./authLogger") return { info: () => {}, warn: () => {} };
    if (request === "os") return { hostname: () => "VoiceLab Test Device" };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return {
      DesktopAuthManager: require(modulePath),
      getPending: () => pending,
    };
  } finally {
    Module._load = originalLoad;
    t.after(() => {
      delete require.cache[modulePath];
    });
  }
}

function authManagerFrom(DesktopAuthManager) {
  return new DesktopAuthManager({
    channel: "production",
    scheme: "voicelab",
    appVersion: "1.8.0",
    apiBaseUrl: API_ORIGIN,
    authWebBaseUrl: "https://voicelab.test",
    authorizationOrigins: ["https://voicelab.test"],
  });
}

test("desktop auth endpoints never use browser cookies or generic session routes", async (t) => {
  const { DesktopAuthManager, getPending } = loadDesktopAuthManager(t);
  const manager = authManagerFrom(DesktopAuthManager);
  const calls = [];
  let refreshNumber = 0;
  installFetch(t, async (url, init) => {
    calls.push({ url, init });
    const body = init.body ? JSON.parse(init.body) : null;
    if (url.endsWith("/authorizations")) {
      return jsonResponse(
        {
          authorization_request_id: AUTHORIZATION_ID,
          authorization_url: `https://voicelab.test/app/sign-in?desktop_auth_id=${AUTHORIZATION_ID}`,
          expires_in: 600,
          request_id: "req_auth_create",
        },
        201
      );
    }
    if (url.endsWith("/token")) {
      refreshNumber += 1;
      return jsonResponse({
        access_token: `access-token-${refreshNumber}-${"a".repeat(32)}`,
        refresh_token: `refresh-token-${refreshNumber}-${"r".repeat(32)}`,
        token_type: "Bearer",
        expires_in: 900,
        refresh_expires_in: 3600,
        session_id: "desktop-session-auth",
        user: { id: "user-7", email: "desktop@example.com" },
        request_id: body.grant_type === "authorization_code" ? "req_exchange" : "req_refresh",
      });
    }
    if (url.endsWith("/logout")) {
      return jsonResponse({ success: true, request_id: "req_logout" });
    }
    throw new Error(`unexpected auth URL: ${url}`);
  });

  await manager.startAuthorization();
  const pending = getPending();
  const callback = new URL(pending.redirectUri);
  callback.searchParams.set("code", AUTHORIZATION_CODE);
  callback.searchParams.set("state", pending.state);
  await manager.handleCallback(callback.toString());
  await manager.refreshSession({ force: true });
  await manager.logout();

  assert.equal(calls.length, 4);
  assert.deepEqual(
    calls.map(({ url, init }) => [url, init.method]),
    [
      [`${API_ORIGIN}/api/v2/auth/desktop/authorizations`, "POST"],
      [`${API_ORIGIN}/api/v2/auth/desktop/token`, "POST"],
      [`${API_ORIGIN}/api/v2/auth/desktop/token`, "POST"],
      [`${API_ORIGIN}/api/v2/auth/desktop/logout`, "POST"],
    ]
  );
  for (const { url, init } of calls) {
    assertNoBrowserCredentials(init);
    assert.doesNotMatch(url, /\/api\/v2\/auth\/(?:login|refresh)(?:$|[/?])/);
    const headers = new Headers(init.headers);
    assert.equal(headers.get("accept"), "application/json");
    assert.equal(headers.get("content-type"), "application/json");
  }
  for (const call of calls.slice(0, 3)) {
    assert.equal(new Headers(call.init.headers).has("authorization"), false);
  }
  assert.match(new Headers(calls[3].init.headers).get("authorization"), /^Bearer access-token-/);

  assert.equal(JSON.parse(calls[1].init.body).grant_type, "authorization_code");
  assert.equal(JSON.parse(calls[2].init.body).grant_type, "refresh_token");
  assert.deepEqual(Object.keys(JSON.parse(calls[3].init.body)).sort(), [
    "installation_id",
    "refresh_token",
  ]);
});

test("desktop auth timeout covers response body consumption and makes one request", async (t) => {
  const { DesktopAuthManager } = loadDesktopAuthManager(t);
  const manager = authManagerFrom(DesktopAuthManager);
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (callback, milliseconds, ...args) =>
    originalSetTimeout(callback, milliseconds === 20_000 ? 5 : milliseconds, ...args);
  t.after(() => {
    global.setTimeout = originalSetTimeout;
  });
  let calls = 0;
  installFetch(t, async (_url, init) => {
    calls += 1;
    return {
      ok: true,
      status: 201,
      headers: new Headers({ "content-type": "application/json" }),
      text() {
        return new Promise((resolve, reject) => {
          const timer = originalSetTimeout(() => resolve("{}"), 50);
          init.signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            },
            { once: true }
          );
        });
      },
    };
  });

  await assert.rejects(manager.startAuthorization(), (error) => {
    assert.equal(error.code, "AUTH_NETWORK_TIMEOUT");
    return true;
  });
  assert.equal(calls, 1);
});
