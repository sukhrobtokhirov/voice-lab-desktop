const { app } = require("electron");
const fs = require("fs");
const path = require("path");
const debugLogger = require("./debugLogger");
const secretCrypto = require("./secretCrypto");

const tokenFile = () => path.join(app.getPath("userData"), "auth-token.bin");

let cachedRaw = null;

function readRaw() {
  if (cachedRaw !== null) return cachedRaw || "";
  try {
    const file = tokenFile();
    if (!fs.existsSync(file)) return (cachedRaw = "");
    const buf = fs.readFileSync(file);
    if (!secretCrypto.isAvailable()) {
      cachedRaw = buf.toString("utf8");
      return cachedRaw || "";
    }
    const { value, needsReencrypt } = secretCrypto.decrypt(buf);
    cachedRaw = value;
    if (needsReencrypt) writeRaw(value);
    return cachedRaw || "";
  } catch (err) {
    debugLogger.error("tokenStore.get failed", { error: err?.message });
    cachedRaw = "";
    return "";
  }
}

function writeRaw(value) {
  try {
    const file = tokenFile();
    const data = secretCrypto.isAvailable()
      ? secretCrypto.encrypt(value)
      : Buffer.from(value, "utf8");
    fs.writeFileSync(file, data, { mode: 0o600 });
    cachedRaw = value;
  } catch (err) {
    debugLogger.error("tokenStore.set failed", { error: err?.message });
  }
}

function parseStored(raw) {
  if (!raw) return { access: null, refresh: null };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const access = parsed.access || parsed.access_token || null;
      const refresh = parsed.refresh || parsed.refresh_token || null;
      if (access) return { access, refresh };
    }
  } catch {
    // legacy plain bearer string
  }
  return { access: raw, refresh: null };
}

/** Access token for Authorization headers (legacy callers). */
function get() {
  return parseStored(readRaw()).access;
}

function getRefresh() {
  return parseStored(readRaw()).refresh;
}

/** Accept plain access token or JSON `{ access, refresh }`. */
function set(token) {
  if (!token) {
    clear();
    return;
  }
  try {
    const parsed = JSON.parse(token);
    if (parsed && typeof parsed === "object" && (parsed.access || parsed.access_token)) {
      writeRaw(
        JSON.stringify({
          access: parsed.access || parsed.access_token,
          refresh: parsed.refresh || parsed.refresh_token || "",
        })
      );
      return;
    }
  } catch {
    // plain token
  }
  const existing = parseStored(readRaw());
  writeRaw(JSON.stringify({ access: token, refresh: existing.refresh || "" }));
}

function setSession(access, refresh) {
  if (!access) {
    clear();
    return;
  }
  writeRaw(JSON.stringify({ access, refresh: refresh || "" }));
}

function clear() {
  cachedRaw = "";
  try {
    fs.rmSync(tokenFile(), { force: true });
  } catch (err) {
    debugLogger.error("tokenStore.clear failed", { error: err?.message });
  }
}

module.exports = { get, getRefresh, set, setSession, clear };
