const assert = require("node:assert/strict");
const test = require("node:test");

const { redact } = require("../../src/helpers/authLogger");

test("desktop diagnostics retain safe server error codes but redact OAuth material", () => {
  const result = redact({
    serverCode: "desktop_stt_unavailable",
    requestId: "req_safe_support_id",
    authorizationCode: "dac_secret",
    codeVerifier: "pkce_secret",
    accessToken: "jwt_secret",
    callbackUrl: "voicelab://auth/callback?code=dac_secret",
  });

  assert.equal(result.serverCode, "desktop_stt_unavailable");
  assert.equal(result.requestId, "req_safe_support_id");
  assert.equal(result.authorizationCode, "[REDACTED]");
  assert.equal(result.codeVerifier, "[REDACTED]");
  assert.equal(result.accessToken, "[REDACTED]");
  assert.equal(result.callbackUrl, "[REDACTED]");
});
