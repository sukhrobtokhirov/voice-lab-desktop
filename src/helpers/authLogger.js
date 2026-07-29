const debugLogger = require("./debugLogger");

const SENSITIVE_KEY =
  /(authorization|cookie|token|secret|password|email|device.?name|url|code|state|nonce|verifier|challenge)/i;
const SAFE_ERROR_KEYS = new Set([
  "errorCode",
  "event",
  "httpStatus",
  "method",
  "operationId",
  "path",
  "provider",
  "retryAfterSeconds",
  "status",
]);

function redact(value, key = "", depth = 0) {
  if (depth > 6) return "[TRUNCATED]";
  if (SENSITIVE_KEY.test(key) && !SAFE_ERROR_KEYS.has(key)) return "[REDACTED]";
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    if (value.length > 256) return `${value.slice(0, 64)}…[TRUNCATED]`;
    return value;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, key, depth + 1));
  if (typeof value === "object") {
    const output = {};
    for (const [childKey, childValue] of Object.entries(value).slice(0, 40)) {
      output[childKey] = redact(childValue, childKey, depth + 1);
    }
    return output;
  }
  return String(value);
}

function write(level, event, details = {}) {
  const payload = redact({ event, ...details });
  const method = debugLogger[level] || debugLogger.info || debugLogger.log;
  method.call(debugLogger, "Desktop auth", payload, "auth");
}

module.exports = {
  debug: (event, details) => write("debug", event, details),
  info: (event, details) => write("info", event, details),
  warn: (event, details) => write("warn", event, details),
  error: (event, details) => write("error", event, details),
  redact,
};
