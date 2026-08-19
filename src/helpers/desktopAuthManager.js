const crypto = require("crypto");
const { EventEmitter } = require("events");
const os = require("os");
const { shell } = require("electron");

const authLogger = require("./authLogger");
const tokenStore = require("./tokenStore");

const CLIENT_ID = "voicelab-desktop";
const PENDING_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20_000;
const ACCESS_EXPIRY_SKEW_MS = 60_000;
const CALLBACK_MAX_LENGTH = 4096;
const CALLBACK_ALLOWED_PARAMS = new Set(["v", "code", "state"]);
const AUTHORIZATION_QUERY_PARAMS = new Set(["desktop_auth_id"]);
const AUTHORIZATION_REQUEST_ID_PATTERN = /^dau_[A-Za-z0-9_-]{1,256}$/;
const AUTHORIZATION_CODE_PATTERN = /^dac_[A-Za-z0-9_-]{1,1020}$/;
const OAUTH_VALUE_PATTERN = /^[A-Za-z0-9._~-]+$/;
const PKCE_VALUE_LENGTH = 43;
const DEVICE_NAME_MAX_LENGTH = 160;

class DesktopAuthError extends Error {
  constructor(code, message, httpStatus = null) {
    super(message);
    this.name = "DesktopAuthError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function base64url(buffer) {
  return buffer.toString("base64url");
}

function finiteSeconds(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function publicErrorMessage(value) {
  return typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f\u007f]+/g, " ")
        .trim()
        .slice(0, 500) || null
    : null;
}

function sanitizedDeviceName(value = os.hostname()) {
  const sanitized = String(value || "")
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, DEVICE_NAME_MAX_LENGTH);
  return sanitized || `VoiceLab Desktop (${process.platform})`;
}

function desktopPlatform() {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin" || process.platform === "linux") return process.platform;
  throw new DesktopAuthError("AUTH_PLATFORM_UNSUPPORTED", "Desktop platform is unsupported");
}

function validUser(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = value.id ?? value.user_id ?? value.uuid;
  if ((typeof id !== "string" && typeof id !== "number") || String(id).length < 1) return null;
  return value;
}

function normalizedUser(payload) {
  const candidates = [
    payload?.user,
    payload?.result?.user,
    payload?.profile?.user,
    payload?.result?.profile?.user,
    payload?.profile,
    payload?.result,
    payload,
  ];
  for (const candidate of candidates) {
    const user = validUser(candidate);
    if (user) return user;
  }
  return null;
}

function refreshIdempotencyKey(storedSession) {
  const material = [
    "desktop-refresh-v2",
    String(storedSession?.sessionId || ""),
    String(storedSession?.refreshToken || ""),
  ].join("\0");
  const digest = crypto.createHash("sha256").update(material).digest();
  return `desktop-refresh-${base64url(digest)}`;
}

class DesktopAuthManager extends EventEmitter {
  constructor({ channel, scheme, appVersion, apiBaseUrl, authWebBaseUrl, authorizationOrigins }) {
    super();
    if (!channel || !scheme || !appVersion || !apiBaseUrl || !authorizationOrigins?.length) {
      throw new Error("Desktop authentication runtime configuration is incomplete");
    }
    this.channel = channel;
    this.scheme = scheme;
    this.appVersion = appVersion;
    this.apiBaseUrl = this._validateOrigin(apiBaseUrl, "Desktop API origin");
    this.authorizationOrigins = new Set(
      authorizationOrigins.map((origin) => this._validateOrigin(origin, "Authorization origin"))
    );
    this.authOrigin = this._validateOrigin(
      authWebBaseUrl || authorizationOrigins[0],
      "Authorization web origin"
    );
    if (!this.authorizationOrigins.has(this.authOrigin)) {
      throw new Error("Desktop authorization web origin is not trusted");
    }
    this.status = "signed-out";
    this.user = null;
    this.errorCode = null;
    this.errorMessage = null;
    this.pendingExpiryTimer = null;
    this.refreshPromise = null;
    this.bootstrapPromise = null;
  }

  _validateOrigin(value, label) {
    try {
      const url = new URL(String(value));
      const localDevelopment =
        this.channel === "development" &&
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(url.hostname);
      if (
        (!localDevelopment && url.protocol !== "https:") ||
        url.username ||
        url.password ||
        url.origin !== String(value).replace(/\/+$/, "") ||
        (url.pathname && url.pathname !== "/") ||
        url.search ||
        url.hash
      ) {
        throw new Error("invalid origin");
      }
      return url.origin;
    } catch {
      throw new Error(`${label} is invalid`);
    }
  }

  async initialize() {
    if (this.bootstrapPromise) return this.bootstrapPromise;
    this.bootstrapPromise = this._bootstrap().finally(() => {
      this.bootstrapPromise = null;
    });
    return this.bootstrapPromise;
  }

  async _bootstrap() {
    let pending = tokenStore.getPending();
    if (pending && !this._isValidPending(pending)) {
      tokenStore.clearPending();
      pending = null;
    }
    if (pending) this._schedulePendingExpiry(pending.expiresAt);

    const storedSession = tokenStore.getSession();
    if (!storedSession) {
      this._setStatus(pending ? "waiting-for-browser" : "signed-out");
      return this.getPublicStatus();
    }

    this._setStatus("checking-session");
    try {
      let current = storedSession;
      if (!current.accessToken || current.accessExpiresAt <= Date.now() + ACCESS_EXPIRY_SKEW_MS) {
        await this.refreshSession({ force: true, validateUser: false });
        current = tokenStore.getSession();
      }
      if (!current?.accessToken) throw new DesktopAuthError("AUTH_EXPIRED", "Session expired");
      const user = await this._fetchValidUser(current.accessToken);
      tokenStore.saveSession({ ...current, user });
      this._setStatus("authenticated", { user });
    } catch (error) {
      const terminalRejection =
        [400, 401, 403].includes(Number(error?.httpStatus)) || error?.code === "AUTH_EXPIRED";
      if (terminalRejection) tokenStore.clearSession();
      this._setStatus(
        pending ? "waiting-for-browser" : terminalRejection ? "signed-out" : "error",
        {
          errorCode: error.code || "AUTH_SESSION_INVALID",
          errorMessage: error.message,
        }
      );
      authLogger.warn("bootstrap_failed", {
        errorCode: error.code || "AUTH_SESSION_INVALID",
        httpStatus: error.httpStatus,
      });
    }
    return this.getPublicStatus();
  }

  getPublicStatus() {
    return {
      status: this.status,
      user: this.user,
      errorCode: this.errorCode,
      errorMessage: this.errorMessage,
    };
  }

  getSessionMetadata() {
    const storedSession = tokenStore.getSession();
    return {
      sessionId: storedSession?.sessionId || null,
      accountId: storedSession?.user
        ? String(storedSession.user.id ?? storedSession.user.user_id ?? storedSession.user.uuid)
        : null,
      installationId: tokenStore.getInstallationId(),
      channel: this.channel,
    };
  }

  _setStatus(status, extra = {}) {
    this.status = status;
    this.user =
      extra.user === undefined ? (status === "authenticated" ? this.user : null) : extra.user;
    this.errorCode = extra.errorCode || null;
    this.errorMessage = publicErrorMessage(extra.errorMessage);
    this.emit("status", this.getPublicStatus());
  }

  _isValidPending(pending) {
    const now = Date.now();
    const fieldsAreValid = Boolean(
      pending &&
      typeof pending === "object" &&
      typeof pending.codeVerifier === "string" &&
      pending.codeVerifier.length === PKCE_VALUE_LENGTH &&
      OAUTH_VALUE_PATTERN.test(pending.codeVerifier) &&
      typeof pending.state === "string" &&
      pending.state.length === PKCE_VALUE_LENGTH &&
      OAUTH_VALUE_PATTERN.test(pending.state) &&
      pending.redirectUri === `${this.scheme}://auth/callback` &&
      AUTHORIZATION_REQUEST_ID_PATTERN.test(pending.authorizationRequestId || "") &&
      typeof pending.authorizationUrl === "string" &&
      pending.authorizationUrl.length <= CALLBACK_MAX_LENGTH &&
      Number.isFinite(pending.createdAt) &&
      Number.isFinite(pending.expiresAt) &&
      pending.createdAt <= now + 30_000 &&
      pending.expiresAt > now &&
      pending.expiresAt - pending.createdAt <= PENDING_TTL_MS
    );
    if (!fieldsAreValid) return false;
    try {
      this._validateAuthorizationUrl(pending.authorizationUrl, pending.authorizationRequestId);
      return true;
    } catch {
      return false;
    }
  }

  _schedulePendingExpiry(expiresAt) {
    clearTimeout(this.pendingExpiryTimer);
    const delay = Math.max(0, expiresAt - Date.now());
    this.pendingExpiryTimer = setTimeout(() => {
      tokenStore.clearPending();
      this._setStatus("expired", { errorCode: "AUTH_TRANSACTION_EXPIRED" });
    }, delay);
    this.pendingExpiryTimer.unref?.();
  }

  async _request(pathname, init = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.apiBaseUrl}${pathname}`, {
        ...init,
        headers: {
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers || {}),
        },
        signal: controller.signal,
      });
      const text = await response.text();
      let body = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          throw new DesktopAuthError(
            "AUTH_BACKEND_RESPONSE_INVALID",
            "Authentication server returned an invalid response",
            response.status
          );
        }
      }
      if (!response.ok) {
        const envelope = body?.error && typeof body.error === "object" ? body.error : null;
        throw new DesktopAuthError(
          envelope?.code ||
            body?.code ||
            (response.status === 401 ? "AUTH_UNAUTHORIZED" : "AUTH_BACKEND_REJECTED"),
          body?.message ||
            envelope?.message ||
            (typeof body?.error === "string" ? body.error : null) ||
            body?.detail ||
            "Authentication request failed",
          response.status
        );
      }
      return body;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new DesktopAuthError("AUTH_NETWORK_TIMEOUT", "Authentication request timed out");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async _fetchValidUser(accessToken) {
    const profile = await this._request("/api/v2/auth/me", {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const user = normalizedUser(profile);
    if (!user) {
      throw new DesktopAuthError("AUTH_USER_RESPONSE_INVALID", "Authenticated user is missing");
    }
    return user;
  }

  _validateAuthorizationUrl(value, expectedRequestId) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new DesktopAuthError("AUTHORIZATION_URL_INVALID", "Authorization URL is invalid");
    }
    const loopbackDevelopment =
      this.channel === "development" &&
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(url.hostname);
    if (
      (!this.authorizationOrigins.has(url.origin) && !loopbackDevelopment) ||
      url.origin !== this.authOrigin
    ) {
      throw new DesktopAuthError("AUTHORIZATION_ORIGIN_REJECTED", "Authorization origin rejected");
    }
    if (
      url.pathname !== "/app/sign-in" ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      url.searchParams.get("desktop_auth_id") !== expectedRequestId
    ) {
      throw new DesktopAuthError("AUTHORIZATION_URL_INVALID", "Authorization URL is invalid");
    }
    const queryKeys = [...url.searchParams.keys()];
    if (
      queryKeys.length !== AUTHORIZATION_QUERY_PARAMS.size ||
      queryKeys.some(
        (key) => !AUTHORIZATION_QUERY_PARAMS.has(key) || url.searchParams.getAll(key).length !== 1
      )
    ) {
      throw new DesktopAuthError("AUTHORIZATION_URL_INVALID", "Authorization URL is invalid");
    }
    return value;
  }

  async startAuthorization() {
    if (this.status === "opening-browser" || this.status === "exchanging") {
      return this.getPublicStatus();
    }
    const existingPending = tokenStore.getPending();
    if (existingPending && this._isValidPending(existingPending)) {
      return this.reopenAuthorization();
    }
    tokenStore.clearPending();
    clearTimeout(this.pendingExpiryTimer);

    const codeVerifier = base64url(crypto.randomBytes(32));
    const codeChallenge = base64url(crypto.createHash("sha256").update(codeVerifier).digest());
    const state = base64url(crypto.randomBytes(32));
    const redirectUri = `${this.scheme}://auth/callback`;
    const pending = {
      codeVerifier,
      state,
      redirectUri,
      createdAt: Date.now(),
      expiresAt: Date.now() + PENDING_TTL_MS,
    };
    tokenStore.savePending(pending);
    this._setStatus("opening-browser");

    try {
      const response = await this._request("/api/v2/auth/desktop/authorizations", {
        method: "POST",
        headers: { "X-Request-ID": crypto.randomUUID() },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          redirect_uri: redirectUri,
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
          state,
          installation_id: tokenStore.getInstallationId(),
          device_name: sanitizedDeviceName(),
          app_version: this.appVersion,
          platform: desktopPlatform(),
        }),
      });
      const requestId = response?.authorization_request_id;
      if (
        typeof requestId !== "string" ||
        !AUTHORIZATION_REQUEST_ID_PATTERN.test(requestId) ||
        typeof response?.authorization_url !== "string"
      ) {
        throw new DesktopAuthError(
          "AUTHORIZATION_RESPONSE_INVALID",
          "Authorization response invalid"
        );
      }
      const authorizationUrl = this._validateAuthorizationUrl(
        response.authorization_url,
        requestId
      );
      const expiresAt = Math.min(
        pending.expiresAt,
        Date.now() + finiteSeconds(response.expires_in, 600) * 1000
      );
      tokenStore.savePending({
        ...pending,
        authorizationRequestId: requestId,
        authorizationUrl,
        expiresAt,
      });
      this._schedulePendingExpiry(expiresAt);
      await shell.openExternal(authorizationUrl, { activate: true });
      this._setStatus("waiting-for-browser");
      return this.getPublicStatus();
    } catch (error) {
      tokenStore.clearPending();
      clearTimeout(this.pendingExpiryTimer);
      this._setStatus("error", {
        errorCode: error.code || "AUTH_START_FAILED",
        errorMessage: error.message,
      });
      throw error;
    }
  }

  async reopenAuthorization() {
    const pending = tokenStore.getPending();
    if (!pending || !this._isValidPending(pending)) {
      tokenStore.clearPending();
      clearTimeout(this.pendingExpiryTimer);
      const expired = pending && Number(pending.expiresAt) <= Date.now();
      this._setStatus(expired ? "expired" : "signed-out", {
        errorCode: expired ? "AUTH_TRANSACTION_EXPIRED" : null,
      });
      return this.getPublicStatus();
    }

    const authorizationUrl = this._validateAuthorizationUrl(
      pending.authorizationUrl,
      pending.authorizationRequestId
    );
    await shell.openExternal(authorizationUrl, { activate: true });
    this._setStatus("waiting-for-browser");
    return this.getPublicStatus();
  }

  cancelAuthorization() {
    tokenStore.clearPending();
    clearTimeout(this.pendingExpiryTimer);
    this._setStatus("cancelled", { errorCode: "AUTH_CANCELLED_BY_USER" });
    return this.getPublicStatus();
  }

  _parseCallback(value) {
    if (typeof value !== "string" || value.length > CALLBACK_MAX_LENGTH) {
      throw new DesktopAuthError("AUTH_CALLBACK_INVALID", "Authentication callback is invalid");
    }
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new DesktopAuthError("AUTH_CALLBACK_INVALID", "Authentication callback is invalid");
    }
    if (
      url.protocol !== `${this.scheme}:` ||
      url.hostname !== "auth" ||
      url.pathname !== "/callback" ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    ) {
      throw new DesktopAuthError("AUTH_CALLBACK_INVALID", "Authentication callback is invalid");
    }
    for (const key of url.searchParams.keys()) {
      if (!CALLBACK_ALLOWED_PARAMS.has(key) || url.searchParams.getAll(key).length !== 1) {
        throw new DesktopAuthError("AUTH_CALLBACK_INVALID", "Authentication callback is invalid");
      }
    }
    const version = url.searchParams.get("v");
    const state = url.searchParams.get("state") || "";
    const code = url.searchParams.get("code") || "";
    if (
      (version !== null && version !== "1") ||
      state.length < 32 ||
      state.length > 256 ||
      !OAUTH_VALUE_PATTERN.test(state)
    ) {
      throw new DesktopAuthError("AUTH_CALLBACK_INVALID", "Authentication callback is invalid");
    }
    if (!AUTHORIZATION_CODE_PATTERN.test(code)) {
      throw new DesktopAuthError("AUTH_CALLBACK_INVALID", "Authentication callback is invalid");
    }
    return { state, code };
  }

  async handleCallback(callbackUrl) {
    const pending = tokenStore.getPending();
    if (!pending) {
      const storedSession = tokenStore.getSession();
      if (storedSession?.kind === "desktop-go-v2" && validUser(storedSession.user)) {
        this._setStatus("authenticated", { user: storedSession.user });
        return this.getPublicStatus();
      }
      throw new DesktopAuthError("AUTH_TRANSACTION_MISSING", "No pending authentication request");
    }
    try {
      if (!this._isValidPending(pending)) {
        tokenStore.clearPending();
        clearTimeout(this.pendingExpiryTimer);
        if (Number(pending.expiresAt) <= Date.now()) {
          this._setStatus("expired", { errorCode: "AUTH_TRANSACTION_EXPIRED" });
          return this.getPublicStatus();
        }
        throw new DesktopAuthError("AUTH_TRANSACTION_INVALID", "Authentication request is invalid");
      }
      const callback = this._parseCallback(callbackUrl);
      if (!constantTimeEqual(callback.state, pending.state)) {
        throw new DesktopAuthError("AUTH_STATE_MISMATCH", "Authentication state mismatch");
      }
      const fingerprint = base64url(
        crypto.createHash("sha256").update(`${callback.code}\0${callback.state}`).digest()
      );
      if (pending.callbackFingerprint) {
        if (
          constantTimeEqual(pending.callbackFingerprint, fingerprint) &&
          this.status === "exchanging"
        ) {
          return this.getPublicStatus();
        }
        throw new DesktopAuthError(
          "AUTH_CALLBACK_REPLAYED",
          "Authentication callback was already used"
        );
      }
      tokenStore.savePending({ ...pending, callbackFingerprint: fingerprint });
      clearTimeout(this.pendingExpiryTimer);
      this._setStatus("exchanging");

      const response = await this._request("/api/v2/auth/desktop/token", {
        method: "POST",
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: CLIENT_ID,
          redirect_uri: pending.redirectUri,
          code: callback.code,
          code_verifier: pending.codeVerifier,
          installation_id: tokenStore.getInstallationId(),
        }),
      });
      const accessToken = response?.access_token || response?.access;
      let user = normalizedUser(response);
      if (!user) user = await this._fetchValidUser(accessToken);
      const sessionValue = this._sessionFromTokenResponse(response, null, user);
      tokenStore.completeAuthorization(sessionValue);
      clearTimeout(this.pendingExpiryTimer);
      this._setStatus("authenticated", { user });
      return this.getPublicStatus();
    } catch (error) {
      if (error.code !== "AUTH_STATE_MISMATCH" && error.code !== "AUTH_CALLBACK_REPLAYED") {
        tokenStore.clearPending();
        clearTimeout(this.pendingExpiryTimer);
      }
      this._setStatus("error", {
        errorCode: error.code || "AUTH_EXCHANGE_FAILED",
        errorMessage: error.message,
      });
      authLogger.warn("callback_failed", {
        errorCode: error.code || "AUTH_EXCHANGE_FAILED",
        httpStatus: error.httpStatus,
      });
      throw error;
    }
  }

  _sessionFromTokenResponse(response, existingSession = null, suppliedUser = null) {
    const accessToken = response?.access_token || response?.access;
    const refreshToken = response?.refresh_token || response?.refresh;
    if (
      typeof accessToken !== "string" ||
      accessToken.length < 16 ||
      typeof refreshToken !== "string" ||
      refreshToken.length < 16
    ) {
      throw new DesktopAuthError(
        "AUTH_TOKEN_RESPONSE_INVALID",
        "Authentication token response invalid"
      );
    }
    if (
      existingSession?.refreshToken &&
      constantTimeEqual(refreshToken, existingSession.refreshToken)
    ) {
      throw new DesktopAuthError(
        "AUTH_REFRESH_ROTATION_REQUIRED",
        "Authentication refresh token was not rotated"
      );
    }
    const user = suppliedUser || normalizedUser(response) || validUser(existingSession?.user);
    if (!user) {
      throw new DesktopAuthError("AUTH_USER_RESPONSE_INVALID", "Authenticated user is missing");
    }
    const now = Date.now();
    return {
      kind: "desktop-go-v2",
      accessToken,
      accessExpiresAt: now + finiteSeconds(response.expires_in, 900) * 1000,
      refreshToken,
      refreshExpiresAt:
        response.refresh_expires_in == null && existingSession?.refreshExpiresAt
          ? existingSession.refreshExpiresAt
          : now + finiteSeconds(response.refresh_expires_in, 30 * 24 * 60 * 60) * 1000,
      sessionId: response.session_id || existingSession?.sessionId || "",
      user,
    };
  }

  async refreshSession({ force = false, validateUser = true } = {}) {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this._refreshSession({ force, validateUser }).finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  async _refreshSession({ force, validateUser }) {
    const storedSession = tokenStore.getSession();
    if (!storedSession?.refreshToken || storedSession.kind !== "desktop-go-v2") {
      throw new DesktopAuthError("AUTH_EXPIRED", "Session expired");
    }
    if (
      !force &&
      storedSession.accessToken &&
      storedSession.accessExpiresAt > Date.now() + ACCESS_EXPIRY_SKEW_MS
    ) {
      return this.getPublicStatus();
    }
    if (storedSession.refreshExpiresAt && storedSession.refreshExpiresAt <= Date.now()) {
      tokenStore.clearSession();
      throw new DesktopAuthError("AUTH_EXPIRED", "Session expired");
    }
    try {
      const response = await this._request("/api/v2/auth/desktop/token", {
        method: "POST",
        headers: { "Idempotency-Key": refreshIdempotencyKey(storedSession) },
        body: JSON.stringify({
          grant_type: "refresh_token",
          client_id: CLIENT_ID,
          refresh_token: storedSession.refreshToken,
          installation_id: tokenStore.getInstallationId(),
        }),
      });
      const accessToken = response?.access_token || response?.access;
      let user = normalizedUser(response) || validUser(storedSession.user);
      if (validateUser) user = await this._fetchValidUser(accessToken);
      const updated = this._sessionFromTokenResponse(response, storedSession, user);
      tokenStore.saveSession(updated);
      this._setStatus("authenticated", { user });
      return this.getPublicStatus();
    } catch (error) {
      const terminalRejection = [400, 401, 403].includes(Number(error?.httpStatus));
      if (terminalRejection) {
        tokenStore.clearSession();
        this._setStatus("signed-out", {
          errorCode: error.code || "AUTH_REFRESH_FAILED",
          errorMessage: error.message,
        });
      } else {
        this._setStatus("error", {
          errorCode: error.code || "AUTH_REFRESH_FAILED",
          errorMessage: error.message,
        });
      }
      throw error;
    }
  }

  async getValidAccessToken() {
    if (this.bootstrapPromise) await this.bootstrapPromise;
    let storedSession = tokenStore.getSession();
    if (!storedSession) throw new DesktopAuthError("AUTH_REQUIRED", "Authentication required");
    if (
      !storedSession.accessToken ||
      storedSession.accessExpiresAt <= Date.now() + ACCESS_EXPIRY_SKEW_MS
    ) {
      await this.refreshSession({ force: true });
      storedSession = tokenStore.getSession();
    }
    if (!storedSession?.accessToken || !validUser(storedSession.user)) {
      throw new DesktopAuthError("AUTH_EXPIRED", "Session expired");
    }
    return storedSession.accessToken;
  }

  async deleteAccount() {
    await shell.openExternal(`${this.authOrigin}/app/settings?section=account`, { activate: true });
    return { success: true, openedBrowser: true };
  }

  async logout() {
    const storedSession = tokenStore.getSession();
    if (!storedSession) {
      tokenStore.clearPending();
      clearTimeout(this.pendingExpiryTimer);
      this._setStatus("signed-out");
      return { success: true, revoked: false };
    }
    const revoked = await this._revokeCurrentSession();
    tokenStore.clearPending();
    clearTimeout(this.pendingExpiryTimer);
    this._setStatus("signed-out");
    return { success: true, revoked };
  }

  async _revokeCurrentSession() {
    let storedSession = tokenStore.getSession();
    if (!storedSession) return false;
    let revoked = false;
    try {
      if (
        !storedSession.accessToken ||
        storedSession.accessExpiresAt <= Date.now() + ACCESS_EXPIRY_SKEW_MS
      ) {
        await this.refreshSession({ force: true, validateUser: false });
        storedSession = tokenStore.getSession();
      }
      if (storedSession?.accessToken) {
        await this._request("/api/v2/auth/desktop/logout", {
          method: "POST",
          headers: { Authorization: `Bearer ${storedSession.accessToken}` },
          body: JSON.stringify({
            refresh_token: storedSession.refreshToken,
            installation_id: tokenStore.getInstallationId(),
          }),
        });
        revoked = true;
      }
    } catch (error) {
      if (![400, 401, 403].includes(Number(error?.httpStatus))) {
        authLogger.warn("logout_revocation_failed", {
          errorCode: error.code || "AUTH_LOGOUT_FAILED",
          httpStatus: error.httpStatus,
        });
      }
    } finally {
      tokenStore.clearSession();
    }
    return revoked;
  }
}

module.exports = DesktopAuthManager;
module.exports.DesktopAuthError = DesktopAuthError;
module.exports.normalizedUser = normalizedUser;
