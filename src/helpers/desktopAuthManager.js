const { EventEmitter } = require("events");
const crypto = require("crypto");
const os = require("os");
const { shell } = require("electron");
const tokenStore = require("./tokenStore");
const authLogger = require("./authLogger");

const CLIENT_ID = "voicelab-desktop";
const PENDING_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20_000;
const CALLBACK_MAX_LENGTH = 4096;
const CALLBACK_ALLOWED_PARAMS = new Set([
  "v",
  "code",
  "state",
  "error",
  "error_code",
  "error_description",
]);

class DesktopAuthError extends Error {
  constructor(code, message, httpStatus = null) {
    super(message);
    this.name = "DesktopAuthError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function base64url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
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

class DesktopAuthManager extends EventEmitter {
  constructor({ channel, scheme, appVersion, apiBaseUrl, authorizationOrigins }) {
    super();
    if (!channel || !scheme || !appVersion || !apiBaseUrl || !authorizationOrigins?.length) {
      throw new Error("Desktop authentication runtime configuration is incomplete");
    }
    this.channel = channel;
    this.scheme = scheme;
    this.appVersion = appVersion;
    this.apiBaseUrl = apiBaseUrl.replace(/\/+$/, "");
    this.authorizationOrigins = new Set(authorizationOrigins);
    this.status = "signed-out";
    this.user = null;
    this.errorCode = null;
    this.pendingExpiryTimer = null;
    this.refreshPromise = null;
    this.bootstrapPromise = null;
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
    if (pending && pending.expiresAt <= Date.now()) {
      tokenStore.clearPending();
      pending = null;
    }
    if (pending && pending.expiresAt > Date.now()) this._schedulePendingExpiry(pending.expiresAt);

    const stored = tokenStore.getSession();
    if (!stored) {
      this._setStatus(pending ? "waiting-for-browser" : "signed-out");
      return this.getPublicStatus();
    }

    this._setStatus("checking-session");
    try {
      let session = stored;
      if (!session.accessToken || session.accessExpiresAt <= Date.now() + 60_000) {
        await this.refreshSession({ force: true, validateUser: false });
        session = tokenStore.getSession();
      }
      if (!session?.accessToken) throw new DesktopAuthError("AUTH_EXPIRED", "Session expired");
      const user = await this._fetchValidUser(session.accessToken);
      tokenStore.saveSession({ ...session, user });
      tokenStore.clearPending();
      this._setStatus("authenticated", { user });
      return this.getPublicStatus();
    } catch (error) {
      tokenStore.clearSession();
      this._setStatus("signed-out", { errorCode: error.code || "AUTH_SESSION_INVALID" });
      authLogger.warn("bootstrap_failed", {
        errorCode: error.code || "AUTH_SESSION_INVALID",
        httpStatus: error.httpStatus,
      });
      return this.getPublicStatus();
    }
  }

  getPublicStatus() {
    return { status: this.status, user: this.user, errorCode: this.errorCode };
  }

  getSessionMetadata() {
    const session = tokenStore.getSession();
    return {
      sessionId: session?.sessionId || null,
      accountId: session?.user ? String(session.user.id ?? session.user.user_id ?? session.user.uuid) : null,
      installationId: tokenStore.getInstallationId(),
      channel: this.channel,
    };
  }

  _setStatus(status, extra = {}) {
    this.status = status;
    this.user = extra.user === undefined ? (status === "authenticated" ? this.user : null) : extra.user;
    this.errorCode = extra.errorCode || null;
    this.emit("status", this.getPublicStatus());
  }

  _device() {
    return {
      installation_id: tokenStore.getInstallationId(),
      name: os.hostname().slice(0, 160) || "VoiceLab Desktop",
      platform: process.platform,
      app_version: this.appVersion,
      channel: this.channel,
    };
  }

  _schedulePendingExpiry(expiresAt) {
    clearTimeout(this.pendingExpiryTimer);
    const delay = Math.max(0, expiresAt - Date.now());
    this.pendingExpiryTimer = setTimeout(() => {
      tokenStore.clearPending();
      this._setStatus("expired", { errorCode: "AUTH_TRANSACTION_EXPIRED" });
    }, delay);
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
        throw new DesktopAuthError(
          body?.code || (response.status === 401 ? "AUTH_UNAUTHORIZED" : "AUTH_BACKEND_REJECTED"),
          body?.detail || body?.error || "Authentication request failed",
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
    const profile = await this._request("/api/v1/auth/desktop/me/", {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const user = normalizedUser(profile);
    if (!user) {
      throw new DesktopAuthError("AUTH_USER_RESPONSE_INVALID", "Authenticated user is missing");
    }
    return user;
  }

  _validateAuthorizationUrl(value) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new DesktopAuthError("AUTHORIZATION_URL_INVALID", "Authorization URL is invalid");
    }
    const loopbackDevelopment =
      this.channel === "development" &&
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost");
    if (!this.authorizationOrigins.has(url.origin) && !loopbackDevelopment) {
      throw new DesktopAuthError("AUTHORIZATION_ORIGIN_REJECTED", "Authorization origin rejected");
    }
    if (url.username || url.password || url.hash) {
      throw new DesktopAuthError("AUTHORIZATION_URL_INVALID", "Authorization URL is invalid");
    }
    return url.toString();
  }

  async startAuthorization() {
    if (tokenStore.getSession()) {
      await this._revokeCurrentSession();
    }
    tokenStore.clearPending();
    clearTimeout(this.pendingExpiryTimer);
    const codeVerifier = base64url(crypto.randomBytes(64));
    const codeChallenge = base64url(crypto.createHash("sha256").update(codeVerifier).digest());
    const state = base64url(crypto.randomBytes(32));
    const nonce = base64url(crypto.randomBytes(32));
    const redirectUri = `${this.scheme}://auth/callback`;
    const pending = {
      codeVerifier,
      state,
      nonce,
      redirectUri,
      createdAt: Date.now(),
      expiresAt: Date.now() + PENDING_TTL_MS,
    };
    tokenStore.savePending(pending);
    this._setStatus("opening-browser");
    try {
      const response = await this._request("/api/v1/auth/desktop/authorizations/", {
        method: "POST",
        body: JSON.stringify({
          client_id: CLIENT_ID,
          redirect_uri: redirectUri,
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
          state,
          nonce,
          device: this._device(),
        }),
      });
      if (
        typeof response?.authorization_request_id !== "string" ||
        typeof response?.authorization_url !== "string"
      ) {
        throw new DesktopAuthError("AUTHORIZATION_RESPONSE_INVALID", "Authorization response invalid");
      }
      const authorizationUrl = this._validateAuthorizationUrl(response.authorization_url);
      const expiresAt =
        Date.now() + Math.min(PENDING_TTL_MS, finiteSeconds(response.expires_in, 600) * 1000);
      tokenStore.savePending({
        ...pending,
        authorizationRequestId: response.authorization_request_id,
        expiresAt,
      });
      this._schedulePendingExpiry(expiresAt);
      await shell.openExternal(authorizationUrl);
      this._setStatus("waiting-for-browser");
      return this.getPublicStatus();
    } catch (error) {
      tokenStore.clearPending();
      this._setStatus("error", { errorCode: error.code || "AUTH_START_FAILED" });
      throw error;
    }
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
    const callbackError = url.searchParams.get("error") || "";
    const errorCode = url.searchParams.get("error_code") || callbackError;
    if (version !== "2" || state.length < 32 || state.length > 512) {
      throw new DesktopAuthError("AUTH_CALLBACK_INVALID", "Authentication callback is invalid");
    }
    if (callbackError || errorCode) {
      if (code || callbackError.length > 80 || errorCode.length > 120) {
        throw new DesktopAuthError("AUTH_CALLBACK_INVALID", "Authentication callback is invalid");
      }
      return { state, error: callbackError || errorCode, errorCode };
    }
    if (code.length < 32 || code.length > 512) {
      throw new DesktopAuthError("AUTH_CALLBACK_INVALID", "Authentication callback is invalid");
    }
    return { state, code, error: "", errorCode: "" };
  }

  async handleCallback(callbackUrl) {
    const pending = tokenStore.getPending();
    if (!pending) {
      throw new DesktopAuthError("AUTH_TRANSACTION_MISSING", "No pending authentication request");
    }
    try {
      if (pending.expiresAt <= Date.now()) {
        tokenStore.clearPending();
        this._setStatus("expired", { errorCode: "AUTH_TRANSACTION_EXPIRED" });
        return this.getPublicStatus();
      }
      const callback = this._parseCallback(callbackUrl);
      if (!constantTimeEqual(callback.state, pending.state)) {
        throw new DesktopAuthError("AUTH_STATE_MISMATCH", "Authentication state mismatch");
      }
      if (callback.error) {
        tokenStore.clearPending();
        clearTimeout(this.pendingExpiryTimer);
        const cancellationCode = `${callback.error}:${callback.errorCode}`.toLowerCase();
        const cancelled = /access_denied|cancelled|canceled|auth_cancel/.test(cancellationCode);
        this._setStatus(cancelled ? "cancelled" : "error", {
          errorCode: callback.errorCode || (cancelled ? "AUTH_ACCESS_DENIED" : "AUTH_CALLBACK_ERROR"),
        });
        return this.getPublicStatus();
      }

      const fingerprint = base64url(
        crypto.createHash("sha256").update(`${callback.code}:${callback.state}`).digest()
      );
      if (pending.callbackFingerprint && constantTimeEqual(pending.callbackFingerprint, fingerprint)) {
        return this.getPublicStatus();
      }
      tokenStore.savePending({ ...pending, callbackFingerprint: fingerprint });
      this._setStatus("exchanging");
      const response = await this._request("/api/v1/auth/desktop/token/", {
        method: "POST",
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: CLIENT_ID,
          redirect_uri: pending.redirectUri,
          code: callback.code,
          code_verifier: pending.codeVerifier,
          state: pending.state,
          nonce: pending.nonce,
          device: this._device(),
        }),
      });
      let user = normalizedUser(response);
      if (!user) user = await this._fetchValidUser(response?.access_token);
      const session = this._sessionFromTokenResponse(response, null, user);
      if (tokenStore.getSession()) {
        await this._revokeCurrentSession();
      }
      tokenStore.completeAuthorization(session);
      clearTimeout(this.pendingExpiryTimer);
      this._setStatus("authenticated", { user });
      return this.getPublicStatus();
    } catch (error) {
      if (error.code !== "AUTH_STATE_MISMATCH") tokenStore.clearPending();
      this._setStatus("error", { errorCode: error.code || "AUTH_EXCHANGE_FAILED" });
      authLogger.warn("callback_failed", {
        errorCode: error.code || "AUTH_EXCHANGE_FAILED",
        httpStatus: error.httpStatus,
      });
      throw error;
    }
  }

  _sessionFromTokenResponse(response, existingSession = null, suppliedUser = null) {
    if (
      typeof response?.access_token !== "string" ||
      response.access_token.length < 16 ||
      typeof (response.refresh_token || existingSession?.refreshToken) !== "string"
    ) {
      throw new DesktopAuthError("AUTH_TOKEN_RESPONSE_INVALID", "Authentication token response invalid");
    }
    const user = suppliedUser || normalizedUser(response) || validUser(existingSession?.user);
    if (!user) {
      throw new DesktopAuthError("AUTH_USER_RESPONSE_INVALID", "Authenticated user is missing");
    }
    const now = Date.now();
    return {
      kind: "desktop-v2",
      accessToken: response.access_token,
      accessExpiresAt: now + finiteSeconds(response.expires_in, 900) * 1000,
      refreshToken: response.refresh_token || existingSession?.refreshToken,
      refreshExpiresAt:
        now + finiteSeconds(response.refresh_expires_in, 30 * 24 * 60 * 60) * 1000,
      sessionId: response.session_id || existingSession?.sessionId || null,
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
    const session = tokenStore.getSession();
    if (!session?.refreshToken) throw new DesktopAuthError("AUTH_EXPIRED", "Session expired");
    if (!force && session.accessToken && session.accessExpiresAt > Date.now() + 60_000) {
      return this.getPublicStatus();
    }
    if (session.refreshExpiresAt && session.refreshExpiresAt <= Date.now()) {
      tokenStore.clearSession();
      throw new DesktopAuthError("AUTH_EXPIRED", "Session expired");
    }
    try {
      let response;
      if (session.kind === "desktop-v2") {
        response = await this._request("/api/v1/auth/desktop/token/refresh/", {
          method: "POST",
          body: JSON.stringify({
            grant_type: "refresh_token",
            client_id: CLIENT_ID,
            refresh_token: session.refreshToken,
          }),
        });
      } else {
        response = await this._request("/api/token/refresh/", {
          method: "POST",
          body: JSON.stringify({ refresh: session.refreshToken }),
        });
      }
      const accessToken = response?.access_token || response?.access;
      if (typeof accessToken !== "string") {
        throw new DesktopAuthError("AUTH_TOKEN_RESPONSE_INVALID", "Invalid refresh response");
      }
      let user = normalizedUser(response) || validUser(session.user);
      if (validateUser) user = await this._fetchValidUser(accessToken);
      if (!user) throw new DesktopAuthError("AUTH_USER_RESPONSE_INVALID", "Authenticated user is missing");
      const updated = {
        ...session,
        accessToken,
        accessExpiresAt: Date.now() + finiteSeconds(response.expires_in, 900) * 1000,
        refreshToken: response.refresh_token || response.refresh || session.refreshToken,
        refreshExpiresAt:
          response.refresh_expires_in != null
            ? Date.now() + finiteSeconds(response.refresh_expires_in, 30 * 24 * 60 * 60) * 1000
            : session.refreshExpiresAt,
        sessionId: response.session_id || session.sessionId,
        user,
      };
      tokenStore.saveSession(updated);
      this._setStatus("authenticated", { user });
      return this.getPublicStatus();
    } catch (error) {
      const terminalRejection = [400, 401, 403].includes(Number(error?.httpStatus));
      if (terminalRejection) {
        tokenStore.clearSession();
        this._setStatus("signed-out", { errorCode: error.code || "AUTH_REFRESH_FAILED" });
      } else {
        this._setStatus("error", { errorCode: error.code || "AUTH_REFRESH_FAILED" });
      }
      throw error;
    }
  }

  async getValidAccessToken() {
    if (this.bootstrapPromise) await this.bootstrapPromise;
    let session = tokenStore.getSession();
    if (!session) throw new DesktopAuthError("AUTH_REQUIRED", "Authentication required");
    if (!session.accessToken || session.accessExpiresAt <= Date.now() + 60_000) {
      await this.refreshSession({ force: true });
      session = tokenStore.getSession();
    }
    if (!session?.accessToken || !validUser(session.user)) {
      throw new DesktopAuthError("AUTH_EXPIRED", "Session expired");
    }
    return session.accessToken;
  }

  async adoptSession(payload) {
    const accessToken = payload?.access_token || payload?.access;
    const refreshToken = payload?.refresh_token || payload?.refresh || "";
    if (typeof accessToken !== "string" || accessToken.length < 16) {
      throw new DesktopAuthError("AUTH_TOKEN_RESPONSE_INVALID", "Invalid login response");
    }
    let user = normalizedUser(payload);
    if (!user) user = await this._fetchValidUser(accessToken);
    if (!user) throw new DesktopAuthError("AUTH_USER_RESPONSE_INVALID", "Authenticated user is missing");
    const now = Date.now();
    if (!payload?.session_id || !refreshToken) {
      throw new DesktopAuthError(
        "AUTH_SESSION_TYPE_REJECTED",
        "Only scoped VoiceLab desktop sessions can be adopted"
      );
    }
    const existingSession = tokenStore.getSession();
    if (existingSession && existingSession.sessionId !== payload.session_id) {
      await this._revokeCurrentSession();
    }
    tokenStore.saveSession({
      kind: "desktop-v2",
      accessToken,
      accessExpiresAt: now + finiteSeconds(payload.expires_in, 900) * 1000,
      refreshToken,
      refreshExpiresAt: refreshToken
        ? now + finiteSeconds(payload.refresh_expires_in, 30 * 24 * 60 * 60) * 1000
        : null,
      sessionId: payload?.session_id || null,
      user,
    });
    this._setStatus("authenticated", { user });
    return this.getPublicStatus();
  }

  async deleteAccount() {
    const accessToken = await this.getValidAccessToken();
    await this._request("/api/auth/delete-account/", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    await this.logout();
    return { success: true };
  }

  async logout() {
    if (!tokenStore.getSession()) {
      tokenStore.clearPending();
      clearTimeout(this.pendingExpiryTimer);
      this._setStatus("signed-out");
      return { success: true, revoked: false };
    }

    try {
      const revoked = await this._revokeCurrentSession();
      tokenStore.clearPending();
      clearTimeout(this.pendingExpiryTimer);
      this._setStatus("signed-out");
      return { success: true, revoked };
    } catch (error) {
      this._setStatus("error", { errorCode: error.code || "AUTH_LOGOUT_FAILED" });
      authLogger.warn("logout_revocation_failed", {
        errorCode: error.code || "AUTH_LOGOUT_FAILED",
        httpStatus: error.httpStatus,
      });
      throw error;
    }
  }

  async _revokeCurrentSession() {
    const session = tokenStore.getSession();
    if (!session) return false;

    if (session.kind === "desktop-v2") {
      try {
        if (!session.accessToken || session.accessExpiresAt <= Date.now() + 60_000) {
          await this.refreshSession({ force: true, validateUser: false });
        }
        let current = tokenStore.getSession();
        if (!current?.accessToken) {
          return true;
        }
        try {
          await this._request("/api/v1/auth/desktop/logout/", {
            method: "POST",
            headers: { Authorization: `Bearer ${current.accessToken}` },
          });
        } catch (error) {
          if (Number(error?.httpStatus) !== 401 || !current.refreshToken) {
            throw error;
          }
          await this.refreshSession({ force: true, validateUser: false });
          current = tokenStore.getSession();
          if (!current?.accessToken) return true;
          await this._request("/api/v1/auth/desktop/logout/", {
            method: "POST",
            headers: { Authorization: `Bearer ${current.accessToken}` },
          });
        }
      } catch (error) {
        if (![400, 401, 403].includes(Number(error?.httpStatus))) {
          throw error;
        }
      }
      tokenStore.clearSession();
      return true;
    }

    if (session.accessToken) {
      try {
        await this._request("/api/auth/logout/", {
          method: "POST",
          headers: { Authorization: `Bearer ${session.accessToken}` },
          body: JSON.stringify({ refresh: session.refreshToken || "" }),
        });
      } catch (error) {
        if (![400, 401, 403].includes(Number(error?.httpStatus))) {
          throw error;
        }
      }
    }
    tokenStore.clearSession();
    return true;
  }
}

module.exports = DesktopAuthManager;
module.exports.DesktopAuthError = DesktopAuthError;
module.exports.normalizedUser = normalizedUser;
