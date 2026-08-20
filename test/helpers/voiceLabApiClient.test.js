const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const API_BASE_URL = "https://api.voicelab.test";
const DESKTOP_STT_URL = `${API_BASE_URL}/v1/desktop/stt`;
const DESKTOP_PRICING_URL = `${API_BASE_URL}/api/v1/billing/desktop/pricing`;
const MAX_AUDIO_BYTES = 64 * 1024 * 1024;

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function loadClient(t) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-desktop-stt-test-"));
  const clientPath = require.resolve("../../src/helpers/voiceLabApiClient");
  const storePath = require.resolve("../../src/helpers/dictationOperationStore");
  const originalLoad = Module._load;

  try {
    Module._load = function loadWithElectronStub(request, parent, isMain) {
      if (request === "electron") return { app: { getPath: () => userData } };
      return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[clientPath];
    delete require.cache[storePath];
    return require(clientPath);
  } finally {
    Module._load = originalLoad;
    t.after(() => {
      delete require.cache[clientPath];
      delete require.cache[storePath];
      fs.rmSync(userData, { recursive: true, force: true });
    });
  }
}

function createAuthManager() {
  const state = {
    accessToken: "desktop-access-token-1",
    accountId: "account-7",
    sessionId: "session-4",
    getValidAccessTokenCalls: 0,
    refreshCalls: 0,
    refreshOptions: [],
    invalidateCalls: 0,
    invalidations: [],
  };
  return {
    state,
    async getValidAccessToken() {
      state.getValidAccessTokenCalls += 1;
      return state.accessToken;
    },
    getSessionMetadata() {
      return {
        accountId: state.accountId,
        installationId: "install-9",
        sessionId: state.sessionId,
      };
    },
    async refreshSession(options) {
      state.refreshCalls += 1;
      state.refreshOptions.push(options);
      state.accessToken = "desktop-access-token-2";
    },
    invalidateSession(details) {
      state.invalidateCalls += 1;
      state.invalidations.push(details);
    },
  };
}

function createClient(VoiceLabApiClient, authManager = createAuthManager()) {
  const client = new VoiceLabApiClient({
    authManager,
    apiBaseUrl: `${API_BASE_URL}/`,
    billingOrigin: "https://voicelab.test/",
    appVersion: "1.7.15",
    channel: "test",
  });
  return { client, authManager };
}

function installFetch(t, implementation) {
  const originalFetch = global.fetch;
  global.fetch = implementation;
  t.after(() => {
    global.fetch = originalFetch;
  });
}

function operation(overrides = {}) {
  return {
    operationId: "local-operation-1",
    accountId: "account-7",
    language: "uz",
    durationMs: 1_250,
    ...overrides,
  };
}

function wallet(maxDurationSeconds = 300) {
  return {
    isUnlimited: false,
    balanceCredits: null,
    reservedCredits: "0",
    availableCredits: null,
    limits: {
      dictation_enabled: true,
      dictation_max_concurrent_operations: 1,
      dictation_max_duration_seconds: maxDurationSeconds,
      supported_languages: ["uz", "en", "ru"],
      auto_detection_supported: true,
    },
  };
}

function assertNoForbiddenMultipartHeaders(init) {
  const headers = new Headers(init.headers);
  assert.equal(headers.has("content-type"), false, "fetch must generate the multipart boundary");
  assert.equal(headers.has("content-length"), false, "fetch must calculate Content-Length");
  assert.equal(headers.has("idempotency-key"), false, "desktop STT has no idempotency key");
}

test("desktop pricing uses the public desktop catalog without a desktop token", async (t) => {
  const VoiceLabApiClient = loadClient(t);
  const { client, authManager } = createClient(VoiceLabApiClient);
  const calls = [];
  installFetch(t, async (url, init) => {
    calls.push({ url, init });
    return jsonResponse({
      enabled: true,
      currency: "USD",
      provider: "polar",
      plans: [
        {
          code: "desktop-pro",
          name: "VoiceLab Flow Pro",
          price_cents: 1200,
          price_usd: "12.00",
          currency: "USD",
          billing_interval: "month",
          billing_interval_count: 1,
          daily_minutes: 450,
          max_recording_seconds: 300,
          internal_price_id: "do-not-expose",
        },
      ],
      request_id: "req_pricing_1",
    });
  });

  const pricing = await client.getDesktopPricing();

  assert.deepEqual(pricing, {
    enabled: true,
    currency: "USD",
    provider: "polar",
    plan: {
      code: "desktop-pro",
      name: "VoiceLab Flow Pro",
      priceUsd: "12.00",
      currency: "USD",
      billingInterval: "month",
      billingIntervalCount: 1,
      dailyMinutes: 450,
      maxRecordingSeconds: 300,
    },
    requestId: "req_pricing_1",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, DESKTOP_PRICING_URL);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(new Headers(calls[0].init.headers).has("authorization"), false);
  assert.equal(authManager.state.getValidAccessTokenCalls, 0);
  assert.doesNotMatch(calls[0].url, /account\/usage/);
});

test("desktop pricing safely handles an enabled catalog without a valid plan", async (t) => {
  const VoiceLabApiClient = loadClient(t);
  const { client } = createClient(VoiceLabApiClient);
  installFetch(t, async () => jsonResponse({ enabled: true, plans: [{ code: "missing-name" }] }));

  assert.deepEqual(await client.getDesktopPricing(), {
    enabled: true,
    currency: "USD",
    provider: null,
    plan: null,
    requestId: null,
  });
});

test("desktop STT sends one exact multipart request and exposes synchronous usage", async (t) => {
  const VoiceLabApiClient = loadClient(t);
  const { client } = createClient(VoiceLabApiClient);
  client.getWallet = async () => wallet();

  const serverPayload = {
    text: "Assalomu alaykum",
    language: "uz",
    duration_ms: 1_250,
    usage: {
      used_seconds: 31,
      daily_limit_seconds: 600,
      remaining_seconds: 569,
    },
    request_id: "req_desktop_stt_1",
    stt_provider: "openwhispr",
  };
  const calls = [];
  installFetch(t, async (url, init) => {
    calls.push({ url, init });
    assert.equal(url, DESKTOP_STT_URL);
    assert.equal(init.method, "POST");
    return jsonResponse(serverPayload);
  });

  const response = await client.sendDictationChunk(
    operation(),
    Buffer.from("webm audio bytes"),
    {
      contentType: "audio/webm",
      fileName: "dictation.webm",
      includeSpeakers: true,
      include_speakers: true,
    },
    0,
    1
  );

  assert.deepEqual(response, serverPayload);
  assert.equal(calls.length, 1, "a synchronous response must not start a polling request");
  assert.equal(
    calls.some(({ init }) => init.method === "GET"),
    false
  );

  const request = calls[0];
  const headers = new Headers(request.init.headers);
  assert.equal(headers.get("authorization"), "Bearer desktop-access-token-1");
  assert.equal(headers.get("x-voicelab-client"), "voicelab-desktop");
  assert.equal(headers.get("x-voicelab-installation-id"), "install-9");
  assertNoForbiddenMultipartHeaders(request.init);
  assert.ok(request.init.body instanceof FormData);
  assert.deepEqual([...request.init.body.keys()], ["audio", "language"]);
  assert.equal(request.init.body.getAll("audio").length, 1);
  assert.equal(request.init.body.getAll("language").length, 1);
  assert.equal(request.init.body.get("language"), "uz");
  assert.equal(request.init.body.get("include_speakers"), null);

  const audio = request.init.body.get("audio");
  assert.ok(audio instanceof Blob);
  assert.equal(audio.type, "audio/webm");
  assert.equal(audio.name, "dictation.webm");

  const publicResult = await client.publicResult(response, "local-operation-1");
  assert.equal(publicResult.success, true);
  assert.equal(publicResult.text, serverPayload.text);
  assert.equal(publicResult.audioDurationMs, serverPayload.duration_ms);
  assert.equal(publicResult.requestId, serverPayload.request_id);
  assert.deepEqual(publicResult.usage, serverPayload.usage);
  assert.equal(publicResult.source, "voicelab");
  assert.equal(publicResult.sttProvider, "voicelab");
});

test("invalid desktop token refreshes once and rebuilds multipart for one retry", async (t) => {
  const VoiceLabApiClient = loadClient(t);
  const { client, authManager } = createClient(VoiceLabApiClient);
  const calls = [];
  installFetch(t, async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1) {
      return jsonResponse(
        {
          error: { code: "invalid_desktop_token", message: "Desktop token expired" },
          request_id: "req_auth_1",
        },
        401
      );
    }
    return jsonResponse({
      text: "Yangilangan token bilan",
      language: "uz",
      duration_ms: 900,
      usage: { used_seconds: 1, daily_limit_seconds: 600, remaining_seconds: 599 },
      request_id: "req_auth_2",
    });
  });

  const result = await client.sendDictationChunk(
    operation({ durationMs: 900 }),
    Buffer.from("audio bytes"),
    { contentType: "audio/mpeg", fileName: "retry.mp3" }
  );

  assert.equal(result.request_id, "req_auth_2");
  assert.equal(authManager.state.refreshCalls, 1);
  assert.equal(authManager.state.refreshOptions[0]?.force, true);
  assert.equal(authManager.state.getValidAccessTokenCalls, 2);
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map(({ url }) => url),
    [DESKTOP_STT_URL, DESKTOP_STT_URL]
  );
  assert.equal(
    new Headers(calls[0].init.headers).get("authorization"),
    "Bearer desktop-access-token-1"
  );
  assert.equal(
    new Headers(calls[1].init.headers).get("authorization"),
    "Bearer desktop-access-token-2"
  );
  assert.notEqual(calls[0].init.body, calls[1].init.body, "FormData cannot be reused after retry");
  for (const { init } of calls) {
    assert.deepEqual([...init.body.keys()], ["audio", "language"]);
    assertNoForbiddenMultipartHeaders(init);
  }
});

test("a second invalid-token response stops after the single authorized retry", async (t) => {
  const VoiceLabApiClient = loadClient(t);
  const { client, authManager } = createClient(VoiceLabApiClient);
  let fetchCalls = 0;
  installFetch(t, async () => {
    fetchCalls += 1;
    return jsonResponse(
      {
        error: { code: "invalid_desktop_token", message: "Desktop token expired" },
        request_id: `req_auth_${fetchCalls}`,
      },
      401
    );
  });

  await assert.rejects(
    () =>
      client.sendDictationChunk(operation(), Buffer.from("audio bytes"), {
        contentType: "audio/mpeg",
        fileName: "retry.mp3",
      }),
    (error) => error.code === "AUTH_EXPIRED" && error.status === 401
  );
  assert.equal(fetchCalls, 2);
  assert.equal(authManager.state.refreshCalls, 1);
  assert.equal(authManager.state.getValidAccessTokenCalls, 2);
  assert.equal(authManager.state.invalidateCalls, 1);
  assert.equal(authManager.state.invalidations[0]?.code, "invalid_desktop_token");
});

test("non-STT 401 responses never refresh or invalidate the desktop session", async (t) => {
  for (const requestCase of [
    {
      name: "desktop sync bootstrap",
      path: "/api/v1/desktop/sync/bootstrap/",
      run: (client) => client.getSyncBootstrap(),
    },
    {
      name: "account usage wallet",
      path: "/api/v1/account/usage",
      run: (client) => client.getWallet({ force: true }),
    },
  ]) {
    await t.test(requestCase.name, async (t) => {
      const VoiceLabApiClient = loadClient(t);
      const { client, authManager } = createClient(VoiceLabApiClient);
      const calls = [];
      installFetch(t, async (url, init) => {
        calls.push({ url, init });
        return jsonResponse(
          {
            error: { code: "invalid_desktop_token", message: "Not valid for this endpoint" },
            request_id: "req_non_stt_401",
          },
          401
        );
      });

      await assert.rejects(
        () => requestCase.run(client),
        (error) =>
          error.code === "AUTH_EXPIRED" &&
          error.status === 401 &&
          error.toPublic().requestId === "req_non_stt_401"
      );
      assert.equal(calls.length, 1);
      assert.equal(new URL(calls[0].url).pathname, requestCase.path);
      assert.equal(authManager.state.refreshCalls, 0);
      assert.equal(authManager.state.invalidateCalls, 0);
    });
  }
});

test("STT only refreshes for the exact invalid_desktop_token code", async (t) => {
  const VoiceLabApiClient = loadClient(t);
  const { client, authManager } = createClient(VoiceLabApiClient);
  let fetchCalls = 0;
  installFetch(t, async () => {
    fetchCalls += 1;
    return jsonResponse(
      {
        error: { code: "INVALID_DESKTOP_TOKEN", message: "Wrong code casing" },
        request_id: "req_wrong_auth_code",
      },
      401
    );
  });

  await assert.rejects(
    () =>
      client.sendDictationChunk(operation(), Buffer.from("audio bytes"), {
        contentType: "audio/mpeg",
        fileName: "no-refresh.mp3",
      }),
    (error) => error.code === "AUTH_EXPIRED" && error.status === 401
  );
  assert.equal(fetchCalls, 1);
  assert.equal(authManager.state.refreshCalls, 0);
  assert.equal(authManager.state.invalidateCalls, 0);
});

test("a stale retried STT response cannot invalidate a newer desktop session", async (t) => {
  const VoiceLabApiClient = loadClient(t);
  const { client, authManager } = createClient(VoiceLabApiClient);
  let fetchCalls = 0;
  installFetch(t, async () => {
    fetchCalls += 1;
    if (fetchCalls === 2) {
      authManager.state.accessToken = "new-login-access-token";
      authManager.state.sessionId = "session-new-login";
    }
    return jsonResponse(
      {
        error: { code: "invalid_desktop_token", message: "Desktop token expired" },
        request_id: `req_stale_${fetchCalls}`,
      },
      401
    );
  });

  await assert.rejects(
    () =>
      client.sendDictationChunk(operation(), Buffer.from("audio bytes"), {
        contentType: "audio/mpeg",
        fileName: "stale.mp3",
      }),
    (error) => error.code === "AUTH_EXPIRED" && error.status === 401
  );
  assert.equal(fetchCalls, 2);
  assert.equal(authManager.state.refreshCalls, 1);
  assert.equal(authManager.state.invalidateCalls, 0);
  assert.equal(authManager.state.sessionId, "session-new-login");
});

test("desktop STT errors preserve server semantics, Retry-After, and nested fields", async (t) => {
  const cases = [
    {
      name: "subscription required",
      status: 402,
      serverCode: "desktop_subscription_required",
      publicCode: "ENTITLEMENT_REQUIRED",
    },
    {
      name: "another dictation is active",
      status: 429,
      serverCode: "concurrent_dictation",
      publicCode: "CONCURRENCY_LIMIT",
    },
    {
      name: "daily allowance is exhausted",
      status: 429,
      serverCode: "daily_dictation_limit_reached",
      publicCode: "DAILY_CAP_REACHED",
    },
    {
      name: "STT is overloaded",
      status: 429,
      serverCode: "stt_overloaded",
      publicCode: "RATE_LIMITED",
      retryAfter: "17",
      retryAfterSeconds: 17,
    },
    {
      name: "audio exceeds the duration limit",
      status: 413,
      serverCode: "audio_too_long",
      publicCode: "AUDIO_LIMIT_EXCEEDED",
      fields: { max_duration_seconds: 300 },
      maxDurationSeconds: 300,
    },
    {
      name: "audio format is unsupported",
      status: 415,
      serverCode: "unsupported_audio_format",
      publicCode: "AUDIO_INVALID",
    },
    {
      name: "no speech was detected",
      status: 422,
      serverCode: "no_speech_detected",
      publicCode: "NO_SPEECH_DETECTED",
    },
    {
      name: "desktop STT is temporarily unavailable",
      status: 503,
      serverCode: "desktop_stt_unavailable",
      publicCode: "SERVICE_UNAVAILABLE",
    },
    {
      name: "desktop STT timed out",
      status: 504,
      serverCode: "desktop_stt_timeout",
      publicCode: "SERVICE_UNAVAILABLE",
    },
  ];

  for (const errorCase of cases) {
    await t.test(errorCase.name, async (t) => {
      const VoiceLabApiClient = loadClient(t);
      const { client } = createClient(VoiceLabApiClient);
      let fetchCalls = 0;
      installFetch(t, async () => {
        fetchCalls += 1;
        return jsonResponse(
          {
            error: {
              code: errorCase.serverCode,
              message: errorCase.name,
              ...(errorCase.fields ? { fields: errorCase.fields } : {}),
            },
            request_id: `req_${errorCase.serverCode}`,
          },
          errorCase.status,
          errorCase.retryAfter ? { "retry-after": errorCase.retryAfter } : {}
        );
      });

      let thrown;
      try {
        await client.sendDictationChunk(operation(), Buffer.from("audio bytes"), {
          contentType: "audio/mpeg",
          fileName: "error.mp3",
        });
      } catch (error) {
        thrown = error;
      }

      assert.ok(thrown, "the non-2xx response must reject");
      assert.equal(fetchCalls, 1, "non-auth failures must never be retried automatically");
      assert.equal(thrown.code, errorCase.publicCode);
      assert.equal(thrown.status, errorCase.status);
      const publicError = thrown.toPublic();
      assert.equal(publicError.serverCode, errorCase.serverCode);
      assert.equal(publicError.requestId, `req_${errorCase.serverCode}`);
      assert.equal(publicError.retryAfterSeconds, errorCase.retryAfterSeconds ?? null);
      if (errorCase.maxDurationSeconds != null) {
        assert.equal(publicError.max_duration_seconds, errorCase.maxDurationSeconds);
      }
    });
  }
});

test("network ambiguity is surfaced without an automatic resend", async (t) => {
  const VoiceLabApiClient = loadClient(t);
  const { client, authManager } = createClient(VoiceLabApiClient);
  let fetchCalls = 0;
  installFetch(t, async () => {
    fetchCalls += 1;
    throw new TypeError("connection reset after upload");
  });

  await assert.rejects(
    () =>
      client.sendDictationChunk(operation(), Buffer.from("audio bytes"), {
        contentType: "audio/mpeg",
        fileName: "ambiguous.mp3",
      }),
    (error) => error.code === "SERVICE_UNAVAILABLE"
  );
  assert.equal(fetchCalls, 1);
  assert.equal(authManager.state.refreshCalls, 0);
});

test("cancelling desktop STT aborts the active upload without retrying", async (t) => {
  const VoiceLabApiClient = loadClient(t);
  const { client, authManager } = createClient(VoiceLabApiClient);
  const externalAbort = new AbortController();
  let fetchCalls = 0;
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  installFetch(
    t,
    async (_url, init) =>
      new Promise((_resolve, reject) => {
        fetchCalls += 1;
        markStarted();
        init.signal.addEventListener(
          "abort",
          () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          { once: true }
        );
      })
  );

  const activeOperation = await client.beginDictation({
    audioBuffer: Buffer.from("audio bytes"),
    durationMs: 1_000,
    language: "uz",
  });
  const request = client.sendDictationChunk(activeOperation, Buffer.from("audio bytes"), {
    contentType: "audio/mpeg",
    fileName: "cancel.mp3",
    signal: externalAbort.signal,
  });
  await started;
  externalAbort.abort();

  await assert.rejects(request, (error) => error.code === "CANCELLED");
  client.failDictation(activeOperation, { code: "CANCELLED" });
  assert.equal(fetchCalls, 1);
  assert.equal(authManager.state.refreshCalls, 0);
});

test("desktop STT enforces 64 MiB and absolute duration boundaries", async (t) => {
  const VoiceLabApiClient = loadClient(t);
  const { client } = createClient(VoiceLabApiClient);

  const minimumDuration = await client.beginDictation({
    audioBuffer: Buffer.from("audio"),
    durationMs: 500,
    language: "uz",
  });
  client.finishDictation(minimumDuration);

  await assert.rejects(
    () =>
      client.beginDictation({
        audioBuffer: Buffer.from("audio"),
        durationMs: 499,
        language: "uz",
      }),
    (error) => error.code === "AUDIO_INVALID" && error.status === 422
  );

  const absoluteDurationBoundary = await client.beginDictation({
    audioBuffer: Buffer.from("audio"),
    durationMs: 300_000,
    language: "uz",
  });
  client.finishDictation(absoluteDurationBoundary);

  await assert.rejects(
    () =>
      client.beginDictation({
        audioBuffer: Buffer.from("audio"),
        durationMs: 300_001,
        language: "uz",
      }),
    (error) =>
      error.code === "AUDIO_LIMIT_EXCEEDED" &&
      error.status === 413 &&
      error.toPublic().max_duration_seconds === 300
  );

  let boundaryAudio = Buffer.alloc(MAX_AUDIO_BYTES);
  const sizeBoundary = await client.beginDictation({
    audioBuffer: boundaryAudio,
    durationMs: 1_000,
    language: "uz",
  });
  client.finishDictation(sizeBoundary);
  boundaryAudio = null;

  await assert.rejects(
    () =>
      client.beginDictation({
        audioBuffer: Buffer.alloc(MAX_AUDIO_BYTES + 1),
        durationMs: 1_000,
        language: "uz",
      }),
    (error) => error.code === "AUDIO_LIMIT_EXCEEDED" && error.status === 413
  );
});
