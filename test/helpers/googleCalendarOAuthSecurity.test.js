const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateOAuthCallbackRequest,
} = require("../../src/helpers/googleCalendarOAuth");

const STATE = "a".repeat(64);
const request = (url, overrides = {}) => ({
  method: "GET",
  url,
  socket: { remoteAddress: "127.0.0.1" },
  ...overrides,
});

test("Google OAuth callback accepts only the loopback GET callback with matching state", () => {
  const result = validateOAuthCallbackRequest(
    request(`/callback?code=code-1&state=${STATE}`),
    STATE
  );
  assert.equal(result.ok, true);
  assert.equal(result.url.searchParams.get("code"), "code-1");
});

test("Google OAuth callback rejects wrong method, path, peer, state, and duplicates", () => {
  const invalid = [
    request(`/callback?code=x&state=${STATE}`, { method: "POST" }),
    request(`/?code=x&state=${STATE}`),
    request(`/callback?code=x&state=${STATE}`, { socket: { remoteAddress: "192.0.2.2" } }),
    request("/callback?code=x&state=wrong"),
    request(`/callback?code=x&state=${STATE}&state=${STATE}`),
    request(`/callback?code=x&code=y&state=${STATE}`),
  ];
  for (const item of invalid) {
    assert.equal(validateOAuthCallbackRequest(item, STATE).ok, false);
  }
});

test("an OAuth error is trusted only after state validation", () => {
  assert.equal(
    validateOAuthCallbackRequest(request("/callback?error=access_denied&state=wrong"), STATE).ok,
    false
  );
  assert.equal(
    validateOAuthCallbackRequest(
      request(`/callback?error=access_denied&state=${STATE}`),
      STATE
    ).ok,
    true
  );
});
