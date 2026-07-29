const test = require("node:test");
const assert = require("node:assert/strict");
const { validateWorkspaceApiRequest } = require("../../src/helpers/workspaceApiRequest");

test("allows only named workspace and team route shapes", () => {
  assert.deepEqual(
    validateWorkspaceApiRequest({
      method: "PATCH",
      path: "/api/workspaces/ws_1/members/user_2",
      body: { role: "admin" },
    }),
    {
      method: "PATCH",
      path: "/api/workspaces/ws_1/members/user_2",
      body: { role: "admin" },
    }
  );
  assert.equal(
    validateWorkspaceApiRequest({
      method: "POST",
      path: "/api/workspaces/ws_1/invitations",
      body: { email: "user@example.com", team_ids: ["team_1"] },
    }).method,
    "POST"
  );
});

test("rejects arbitrary backend paths, methods, and traversal", () => {
  for (const input of [
    { method: "GET", path: "/api/auth/session" },
    { method: "PUT", path: "/api/workspaces/ws_1" },
    { method: "GET", path: "/api/workspaces/../admin" },
    { method: "GET", path: "https://evil.test/api/workspaces" },
  ]) {
    assert.throws(() => validateWorkspaceApiRequest(input), {
      code: "DESKTOP_API_ROUTE_REJECTED",
    });
  }
});

test("rejects non-plain, deeply nested, and oversized bodies", () => {
  assert.throws(
    () => validateWorkspaceApiRequest({
      method: "POST",
      path: "/api/workspaces",
      body: new Date(),
    }),
    { code: "DESKTOP_API_BODY_REJECTED" }
  );
  assert.throws(
    () => validateWorkspaceApiRequest({
      method: "POST",
      path: "/api/workspaces",
      body: { name: "x".repeat(70 * 1024) },
    }),
    { code: "DESKTOP_API_BODY_REJECTED" }
  );
});
