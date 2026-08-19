const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("VoiceLab Dictate uses the authenticated Go usage and completed STT contracts", async (t) => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-client-test-"));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));

  const originalLoad = Module._load;
  Module._load = function loadWithElectronStub(request, parent, isMain) {
    if (request === "electron") return { app: { getPath: () => userData } };
    return originalLoad.call(this, request, parent, isMain);
  };
  const clientPath = require.resolve("../../src/helpers/voiceLabApiClient");
  const storePath = require.resolve("../../src/helpers/dictationOperationStore");
  delete require.cache[clientPath];
  delete require.cache[storePath];
  const VoiceLabApiClient = require(clientPath);
  Module._load = originalLoad;

  const authManager = {
    getValidAccessToken: async () => "desktop-access-token",
    getSessionMetadata: () => ({
      accountId: "account-7",
      installationId: "install-9",
      sessionId: "session-4",
    }),
    refreshSession: async () => {},
  };
  const client = new VoiceLabApiClient({
    authManager,
    apiBaseUrl: "https://api.voicelab.test",
    billingOrigin: "https://voicelab.test",
    appVersion: "1.7.15",
    channel: "test",
  });

  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/api/v1/account/usage")) {
      return jsonResponse({
        account: {
          plan: { id: "pro", name: "Pro", status: "active" },
          billing_period: {
            starts_at: "2026-08-01T00:00:00Z",
            ends_at: "2026-09-01T00:00:00Z",
          },
        },
        credits: {
          unit: "credits",
          is_unlimited: false,
          total: 50,
          used: 1.75,
          remaining: 48.25,
          resets_at: "2026-09-01T00:00:00Z",
        },
        request_id: "req_usage",
      });
    }
    if (url.endsWith("/api/v1/stt")) {
      return jsonResponse({
        id: "stt_complete_1",
        transcript: "Assalomu alaykum",
        language: "uz",
        duration_ms: 1200,
        request_id: "req_stt_complete",
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  t.after(() => {
    global.fetch = originalFetch;
    delete require.cache[clientPath];
    delete require.cache[storePath];
  });

  const wallet = await client.getWallet();
  assert.equal(wallet.availableCredits, "48.25");
  assert.equal(wallet.isUnlimited, false);
  assert.equal(wallet.balanceCredits, "50");
  assert.equal(wallet.reservedCredits, "0");
  assert.equal(wallet.currency, "credits");
  assert.deepEqual(wallet.limits.supported_languages, ["uz", "en", "ru"]);
  assert.equal(wallet.topUpUrl, "https://voicelab.test/app/billing?source=dictate");

  const audioBuffer = Buffer.from("test audio bytes");
  const operation = await client.beginDictation({
    audioBuffer,
    source: "dictate",
    durationMs: 1200,
    language: "uz",
  });
  const response = await client.sendDictationChunk(
    operation,
    audioBuffer,
    {
      contentType: "audio/webm",
      fileName: "dictation.webm",
      includeSpeakers: true,
    },
    0,
    1
  );
  assert.equal(response.transcript, "Assalomu alaykum");
  const publicResponse = await client.publicResult(response, operation.operationId);
  assert.equal(publicResponse.success, true);
  assert.equal(publicResponse.text, "Assalomu alaykum");
  assert.equal(publicResponse.operationId, operation.operationId);
  assert.equal(publicResponse.availableCredits, "48.25");
  assert.equal(publicResponse.audioDurationMs, 1200);

  const walletCall = calls[0];
  assert.equal(walletCall.init.headers.Authorization, "Bearer desktop-access-token");
  assert.equal(walletCall.init.headers["X-VoiceLab-Installation-ID"], "install-9");
  assert.equal(walletCall.init.headers["X-VoiceLab-Session-ID"], "session-4");

  const operationCall = calls.find((call) => call.init.method === "POST");
  assert.ok(operationCall);
  assert.equal(operationCall.url, "https://api.voicelab.test/api/v1/stt");
  assert.match(
    operationCall.init.headers["Idempotency-Key"],
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  );
  assert.deepEqual([...operationCall.init.body.keys()], ["audio", "language", "include_speakers"]);
  assert.equal(operationCall.init.body.get("language"), "uz");
  assert.equal(operationCall.init.body.get("include_speakers"), "true");
  assert.ok(operationCall.init.body.get("audio") instanceof Blob);
  assert.equal(operationCall.init.body.get("logical_operation_id"), null);
  assert.equal(operationCall.init.body.get("audio_sha256"), null);

  client.finishDictation(operation);
});

test("VoiceLab Dictate maps auto to uz and polls queued Go STT jobs", async (t) => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-client-poll-test-"));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));

  const originalLoad = Module._load;
  Module._load = function loadWithElectronStub(request, parent, isMain) {
    if (request === "electron") return { app: { getPath: () => userData } };
    return originalLoad.call(this, request, parent, isMain);
  };
  const clientPath = require.resolve("../../src/helpers/voiceLabApiClient");
  const storePath = require.resolve("../../src/helpers/dictationOperationStore");
  delete require.cache[clientPath];
  delete require.cache[storePath];
  const VoiceLabApiClient = require(clientPath);
  Module._load = originalLoad;

  const authManager = {
    getValidAccessToken: async () => "go-jwt",
    getSessionMetadata: () => ({
      accountId: "account-poll",
      installationId: "install-poll",
      sessionId: null,
    }),
    refreshSession: async () => {},
  };
  const client = new VoiceLabApiClient({
    authManager,
    apiBaseUrl: "https://api.voicelab.test/",
    billingOrigin: "https://voicelab.test/",
    appVersion: "1.7.15",
    channel: "test",
  });

  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/api/v1/account/usage")) {
      return jsonResponse({
        account: { plan: { id: "free", name: "Free", status: "active" } },
        credits: {
          unit: "credits",
          is_unlimited: false,
          total: 10,
          used: 0,
          remaining: 10,
          resets_at: null,
        },
        request_id: "req_usage_poll",
      });
    }
    if (url.endsWith("/api/v1/stt")) {
      return jsonResponse({ id: "stt_queued_1", status: "queued", request_id: "req_queued" }, 202);
    }
    if (url.endsWith("/api/v1/stt/transcriptions/stt_queued_1")) {
      return jsonResponse({
        id: "stt_queued_1",
        status: "completed",
        transcript: "Navbatdagi natija",
        language: "uz",
        duration_ms: 900,
        request_id: "req_completed",
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  t.after(() => {
    global.fetch = originalFetch;
    delete require.cache[clientPath];
    delete require.cache[storePath];
  });

  const audioBuffer = Buffer.from("queued audio bytes");
  const operation = await client.beginDictation({
    audioBuffer,
    durationMs: 900,
    language: "auto",
  });
  assert.equal(operation.language, "uz");

  const response = await client.sendDictationChunk(
    operation,
    audioBuffer,
    { contentType: "audio/mpeg", fileName: "queued.mp3" },
    0,
    1
  );
  assert.equal(response.status, "completed");
  assert.equal(response.transcript, "Navbatdagi natija");

  const post = calls.find((call) => call.init.method === "POST");
  assert.equal(post.init.headers.Authorization, "Bearer go-jwt");
  assert.deepEqual([...post.init.body.keys()], ["audio", "language"]);
  assert.equal(post.init.body.get("language"), "uz");
  assert.equal(post.init.body.get("include_speakers"), null);
  assert.ok(
    calls.some(
      (call) => call.url === "https://api.voicelab.test/api/v1/stt/transcriptions/stt_queued_1"
    )
  );
  assert.equal(
    calls.some((call) => call.url.includes("/api/v1/desktop/")),
    false
  );

  client.finishDictation(operation);
});
