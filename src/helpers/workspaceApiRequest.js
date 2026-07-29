const MAX_PATH_LENGTH = 1024;
const MAX_BODY_BYTES = 64 * 1024;
const SAFE_SEGMENT = "[A-Za-z0-9_-]{1,128}";

const ROUTES = [
  { methods: ["GET", "POST"], pattern: new RegExp(`^/api/workspaces(?:/${SAFE_SEGMENT})*(?:\\?[^#]*)?$`) },
  { methods: ["PATCH"], pattern: new RegExp(`^/api/workspaces/${SAFE_SEGMENT}(?:/members/${SAFE_SEGMENT})?$`) },
  { methods: ["DELETE"], pattern: new RegExp(`^/api/workspaces/${SAFE_SEGMENT}(?:/(?:members|invitations|api-keys)/${SAFE_SEGMENT})?$`) },
  { methods: ["GET", "POST"], pattern: new RegExp(`^/api/teams(?:/${SAFE_SEGMENT})*(?:\\?[^#]*)?$`) },
  { methods: ["PATCH"], pattern: new RegExp(`^/api/teams/${SAFE_SEGMENT}$`) },
  { methods: ["DELETE"], pattern: new RegExp(`^/api/teams/${SAFE_SEGMENT}(?:/members/${SAFE_SEGMENT})?$`) },
  { methods: ["POST"], pattern: new RegExp(`^/api/v1/keys/${SAFE_SEGMENT}/revoke/?$`) },
];

function plainJson(value, depth = 0) {
  if (depth > 8) return false;
  if (value == null || ["string", "number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every((item) => plainJson(item, depth + 1));
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.entries(value).every(
    ([key, item]) => key !== "__proto__" && key !== "constructor" && plainJson(item, depth + 1)
  );
}

function validateWorkspaceApiRequest(input) {
  const method = String(input?.method || "GET").toUpperCase();
  const requestPath = String(input?.path || "");
  if (
    requestPath.length === 0
    || requestPath.length > MAX_PATH_LENGTH
    || requestPath.includes("\\")
    || /[\r\n]/.test(requestPath)
  ) {
    throw Object.assign(new Error("Invalid workspace API path"), {
      code: "DESKTOP_API_ROUTE_REJECTED",
    });
  }
  const route = ROUTES.find(
    (candidate) => candidate.methods.includes(method) && candidate.pattern.test(requestPath)
  );
  if (!route) {
    throw Object.assign(new Error("Workspace API operation is not allowed"), {
      code: "DESKTOP_API_ROUTE_REJECTED",
    });
  }
  if (input?.body !== undefined) {
    if (!plainJson(input.body)) {
      throw Object.assign(new Error("Workspace API body must be plain JSON"), {
        code: "DESKTOP_API_BODY_REJECTED",
      });
    }
    if (Buffer.byteLength(JSON.stringify(input.body), "utf8") > MAX_BODY_BYTES) {
      throw Object.assign(new Error("Workspace API body is too large"), {
        code: "DESKTOP_API_BODY_REJECTED",
      });
    }
  }
  return { method, path: requestPath, body: input?.body };
}

module.exports = { validateWorkspaceApiRequest };
