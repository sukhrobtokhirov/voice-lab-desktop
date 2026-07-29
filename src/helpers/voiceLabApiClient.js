const crypto = require("crypto");
const authLogger = require("./authLogger");
const operationStore = require("./dictationOperationStore");

const CLIENT_ID = "voicelab-desktop";
const STATUS_CODE = { 400: "INVALID_REQUEST", 401: "AUTH_EXPIRED", 402: "INSUFFICIENT_CREDITS", 403: "ENTITLEMENT_REQUIRED", 409: "IDEMPOTENCY_CONFLICT", 413: "AUDIO_LIMIT_EXCEEDED", 422: "AUDIO_INVALID", 429: "RATE_LIMITED", 500: "SERVICE_UNAVAILABLE", 502: "SERVICE_UNAVAILABLE", 503: "SERVICE_UNAVAILABLE", 504: "SERVICE_UNAVAILABLE" };

function normalizeErrorCode(status, body) {
  const serverCode = String(body?.code || body?.error_code || "").toUpperCase();
  if (status === 403) return "ENTITLEMENT_REQUIRED";
  if (status === 409) return serverCode === "DESKTOP_DEVICE_LIMIT" ? "DEVICE_LIMIT" : "IDEMPOTENCY_CONFLICT";
  if (status === 413) return "AUDIO_LIMIT_EXCEEDED";
  if (status === 422) return serverCode === "STT_DURATION_LIMIT_EXCEEDED" ? "AUDIO_LIMIT_EXCEEDED" : "AUDIO_INVALID";
  if (status === 429) {
    if (serverCode === "STT_CONCURRENCY_LIMIT") return "CONCURRENCY_LIMIT";
    if (serverCode === "STT_DAILY_LIMIT") return "DAILY_CAP_REACHED";
    return "RATE_LIMITED";
  }
  return STATUS_CODE[status] || serverCode || "BACKEND_FAILED";
}

class VoiceLabApiError extends Error {
  constructor({ code, message, status = null, retryAfterSeconds = null, details = {} }) {
    super(message || code || "VoiceLab request failed");
    this.name = "VoiceLabApiError";
    this.code = code || "BACKEND_FAILED";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
    this.details = details && typeof details === "object" ? details : {};
  }
  toPublic() {
    const details = { ...(this.details.details || {}), ...this.details };
    const result = { success: false, error: this.message, code: this.code, serverCode: details.code || null, requestId: details.requestId || details.request_id || null, hint: details.hint || null, status: this.status, retryAfterSeconds: this.retryAfterSeconds };
    for (const key of ["required", "available", "required_credits", "available_credits", "max_duration_seconds", "max_concurrent_operations", "rolling_24h_credit_limit", "rolling_24h_credits_used", "operation_id"]) if (details[key] != null) result[key] = details[key];
    return result;
  }
}

function retryAfterSeconds(response) {
  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric >= 0) return numeric;
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : null;
}

function composeSignal(externalSignal, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort(externalSignal?.reason);
  if (externalSignal) externalSignal.aborted ? abort() : externalSignal.addEventListener("abort", abort, { once: true });
  return { signal: controller.signal, cleanup() { clearTimeout(timeout); externalSignal?.removeEventListener?.("abort", abort); } };
}

class VoiceLabApiClient {
  constructor({ authManager, apiBaseUrl, appVersion, channel, billingOrigin }) {
    this.authManager = authManager;
    this.apiBaseUrl = apiBaseUrl.replace(/\/+$/, "");
    this.appVersion = appVersion;
    this.channel = channel;
    this.billingOrigin = billingOrigin.replace(/\/+$/, "");
    this.walletCache = null;
    this.walletFetchedAt = 0;
    this.walletAccountId = null;
    this.activeDictationOperations = new Set();
  }

  resetSessionState() {
    this.walletCache = null;
    this.walletFetchedAt = 0;
    this.walletAccountId = null;
    this.activeDictationOperations.clear();
  }

  getBillingUrl(source = "dictate") {
    const url = new URL("/app/billing", this.billingOrigin);
    url.searchParams.set("source", source === "dictate" ? source : "desktop");
    return url.toString();
  }

  async authenticatedFetch(pathname, options = {}) {
    let authRetried = false;
    for (;;) {
      let accessToken;
      try { accessToken = await this.authManager.getValidAccessToken(); }
      catch (error) { throw new VoiceLabApiError({ code: error.code || "AUTH_EXPIRED", message: "VoiceLab session expired. Sign in again.", status: 401 }); }
      const metadata = this.authManager.getSessionMetadata();
      const timed = composeSignal(options.signal, options.timeoutMs || 45_000);
      let response;
      try {
        response = await fetch(`${this.apiBaseUrl}${pathname}`, {
          method: options.method || "GET",
          headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}`, "X-VoiceLab-Client": CLIENT_ID, "X-VoiceLab-App-Version": this.appVersion, "X-VoiceLab-Channel": this.channel, "X-VoiceLab-Installation-ID": metadata.installationId, ...(metadata.sessionId ? { "X-VoiceLab-Session-ID": metadata.sessionId } : {}), ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}), ...(options.headers || {}) },
          body: options.bodyFactory ? options.bodyFactory() : options.body,
          signal: timed.signal,
        });
      } catch (error) {
        timed.cleanup();
        if (options.signal?.aborted) throw new VoiceLabApiError({ code: "CANCELLED", message: "Request cancelled" });
        throw new VoiceLabApiError({ code: "SERVICE_UNAVAILABLE", message: "VoiceLab is temporarily unavailable. Retry the same operation shortly." });
      }
      timed.cleanup();
      if (response.status === 401 && !authRetried) {
        authRetried = true;
        try { await this.authManager.refreshSession({ force: true }); }
        catch { throw new VoiceLabApiError({ code: "AUTH_EXPIRED", message: "VoiceLab session expired. Sign in again.", status: 401 }); }
        continue;
      }
      const text = await response.text();
      let body = null;
      if (text) {
        try { body = JSON.parse(text); }
        catch { throw new VoiceLabApiError({ code: "BACKEND_RESPONSE_INVALID", message: "VoiceLab returned an invalid response.", status: response.status }); }
      }
      if (response.ok) return body;
      const error = new VoiceLabApiError({ code: normalizeErrorCode(response.status, body), message: body?.error || body?.detail || body?.message || "VoiceLab request failed", status: response.status, retryAfterSeconds: retryAfterSeconds(response), details: body || {} });
      authLogger.warn("voicelab_request_failed", { errorCode: error.code, serverCode: body?.code, httpStatus: response.status, method: options.method || "GET", path: pathname });
      throw error;
    }
  }

  normalizeWallet(payload) {
    const plan = payload?.plan || {};
    const dictate = payload?.dictate || {};
    const available = String(payload?.available_balance ?? payload?.balance ?? "0");
    const reserved = String(payload?.reserved_balance ?? "0");
    const total = String(payload?.total_balance ?? payload?.balance ?? available);
    return { balanceCredits: total, reservedCredits: reserved, availableCredits: available, currency: payload?.currency || "AI_CREDITS", plan: plan.code || "free", planName: plan.name || plan.code || "Free", planStatus: plan.status || null, limits: { dictation_enabled: dictate.enabled !== false, credits_per_minute: dictate.credits_per_minute, dictation_max_devices: dictate.max_devices, dictation_max_concurrent_operations: dictate.max_concurrent_operations, dictation_max_duration_seconds: dictate.max_duration_seconds, dictation_rolling_24h_credit_limit: dictate.rolling_24h_credit_limit, dictation_rolling_24h_credits_used: dictate.rolling_24h_credits_used, supported_languages: Array.isArray(dictate.supported_languages) ? dictate.supported_languages : Array.isArray(payload?.supported_languages) ? payload.supported_languages : [], auto_detection_supported: dictate.auto_detection_supported === true || payload?.auto_detection_supported === true }, topUpUrl: this.getBillingUrl("dictate") };
  }

  async getWallet({ force = false } = {}) {
    const accountId = this.authManager.getSessionMetadata().accountId;
    if (
      !force &&
      this.walletCache &&
      this.walletAccountId === accountId &&
      Date.now() - this.walletFetchedAt < 30_000
    ) {
      return this.walletCache;
    }
    const wallet = this.normalizeWallet(
      await this.authenticatedFetch("/api/v1/desktop/wallet/", { timeoutMs: 15_000 })
    );
    if (this.authManager.getSessionMetadata().accountId !== accountId) {
      throw new VoiceLabApiError({
        code: "AUTH_ACCOUNT_CHANGED",
        message: "The active VoiceLab account changed during this request.",
        status: 409,
      });
    }
    this.walletCache = wallet;
    this.walletAccountId = accountId;
    this.walletFetchedAt = Date.now();
    return this.walletCache;
  }

  async beginDictation({ audioBuffer, source = "dictate", durationMs = null, language = null }) {
    const wallet = await this.getWallet();
    const requestedLanguage = typeof language === "string" ? language.trim().toLowerCase() : "auto";
    const supported = new Set(wallet.limits.supported_languages || []);
    const autoSupported = wallet.limits.auto_detection_supported === true;
    if (requestedLanguage === "auto" && !autoSupported) {
      throw new VoiceLabApiError({ code: "AUDIO_LANGUAGE_UNSUPPORTED", message: "Automatic language detection is not available for this provider. Choose a language.", status: 422, details: { language: requestedLanguage, supported_languages: [...supported] } });
    }
    if (requestedLanguage !== "auto" && !supported.has(requestedLanguage)) {
      throw new VoiceLabApiError({ code: "AUDIO_LANGUAGE_UNSUPPORTED", message: "This language is not available for VoiceLab Cloud.", status: 422, details: { language: requestedLanguage, supported_languages: [...supported] } });
    }
    const normalizedLanguage = requestedLanguage === "auto" ? null : requestedLanguage;
    if (wallet.limits.dictation_enabled === false) throw new VoiceLabApiError({ code: "ENTITLEMENT_REQUIRED", message: "Dictate is not enabled for this plan.", status: 403 });
    const limit = Number(wallet.limits.dictation_max_concurrent_operations ?? 1);
    if (this.activeDictationOperations.size >= Math.max(1, limit)) throw new VoiceLabApiError({ code: "CONCURRENCY_LIMIT", message: "Another VoiceLab Dictate operation is already running.", status: 429, details: { max_concurrent_operations: limit } });
    const maxDuration = Number(wallet.limits.dictation_max_duration_seconds ?? process.env.VOICELAB_DICTATION_MAX_DURATION_SECONDS ?? 600);
    if (durationMs && Number.isFinite(maxDuration) && durationMs > maxDuration * 1000) throw new VoiceLabApiError({ code: "AUDIO_LIMIT_EXCEEDED", message: "This recording is longer than the current Dictate limit.", status: 413, details: { max_duration_seconds: maxDuration } });
    const audioHash = crypto.createHash("sha256").update(audioBuffer).digest("hex");
    const accountId = this.authManager.getSessionMetadata().accountId;
    if (!accountId) {
      throw new VoiceLabApiError({
        code: "AUTH_REQUIRED",
        message: "Authentication required.",
        status: 401,
      });
    }
    const operation = operationStore.begin({
      audioHash,
      source,
      durationMs,
      language: normalizedLanguage,
      accountId,
    });
    this.activeDictationOperations.add(operation.operationId);
    return operation;
  }

  async waitForOperation(initial, operation, index, signal) {
    let payload = initial;
    let operationPayload = payload?.operation || payload;
    const serverId =
      operationPayload?.operation_id ||
      operationPayload?.id ||
      operationStore.get(operation.operationId)?.serverOperations?.[String(index)];
    if (serverId == null) throw new VoiceLabApiError({ code: "BACKEND_RESPONSE_INVALID", message: "VoiceLab operation id is missing.", status: 502 });
    operationStore.attachServerOperation(
      operation.operationId,
      index,
      serverId,
      operationStore.get(operation.operationId)?.expectedChunkCount
    );
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      operationPayload = payload?.operation || payload;
      const status = String(operationPayload?.status || "").toLowerCase();
      if (status === "success") return payload;
      if (status === "failed") throw new VoiceLabApiError({ code: operationPayload?.code || "DICTATION_FAILED", message: operationPayload?.error || operationPayload?.detail || "Transcription failed.", status: 422, details: operationPayload });
      await new Promise((resolve) => setTimeout(resolve, 750));
      payload = await this.authenticatedFetch(`/api/v1/desktop/dictation/operations/${encodeURIComponent(serverId)}/`, { method: "GET", timeoutMs: 20_000, signal });
    }
    operationStore.retain(operation.operationId);
    throw new VoiceLabApiError({
      code: "DICTATION_PROCESSING",
      message: "Transcription is still processing. Retry to resume this operation.",
      status: 202,
      details: { operation_id: serverId, resumable: true },
    });
  }

  async sendDictationChunk(operation, audioBuffer, metadata = {}, index = 0, count = 1) {
    if (operation.accountId !== this.authManager.getSessionMetadata().accountId) {
      throw new VoiceLabApiError({
        code: "AUTH_ACCOUNT_CHANGED",
        message: "This operation belongs to a different VoiceLab account.",
        status: 409,
      });
    }
    const language = metadata.language ?? operation.language;
    const idempotencyKey = operationStore.deterministicChunkKey(operation, index);
    const totalDurationSeconds = Number(
      operation.totalDurationSeconds
      ?? (Number.isFinite(operation.durationMs) ? operation.durationMs / 1000 : NaN)
    );
    if (count > 1 && (!Number.isFinite(totalDurationSeconds) || totalDurationSeconds <= 0)) {
      throw new VoiceLabApiError({
        code: "AUDIO_DURATION_REQUIRED",
        message: "Chunked Dictate requires a measured total audio duration.",
        status: 422,
      });
    }
    const bodyFactory = () => {
      const form = new FormData();
      if (language && language !== "auto") form.append("language", language);
      form.append(
        "logical_operation_id",
        operation.logicalOperationId || operation.operationId
      );
      form.append("chunk_index", String(index));
      form.append("chunk_count", String(count));
      if (Number.isFinite(totalDurationSeconds) && totalDurationSeconds > 0) {
        form.append("total_duration_seconds", String(totalDurationSeconds));
      }
      form.append("audio_sha256", crypto.createHash("sha256").update(audioBuffer).digest("hex"));
      form.append("audio", new Blob([audioBuffer], { type: metadata.contentType || "audio/mpeg" }), metadata.fileName || `dictation-${index}.mp3`);
      return form;
    };
    const persistedServerId =
      operationStore.get(operation.operationId)?.serverOperations?.[String(index)];
    const initial = persistedServerId
      ? await this.authenticatedFetch(
          `/api/v1/desktop/dictation/operations/${encodeURIComponent(persistedServerId)}/`,
          { method: "GET", timeoutMs: 20_000, signal: metadata.signal }
        )
      : await this.authenticatedFetch("/api/v1/desktop/dictation/operations/", {
          method: "POST",
          bodyFactory,
          idempotencyKey,
          timeoutMs: 120_000,
          signal: metadata.signal,
        });
    operationStore.attachServerOperation(operation.operationId, index, persistedServerId || initial?.operation?.operation_id || initial?.operation_id || initial?.id, count);
    const result = await this.waitForOperation(initial, operation, index, metadata.signal);
    operationStore.recordChunkResult(operation.operationId, index, result);
    return result;
  }

  async getSyncBootstrap() {
    return this.authenticatedFetch("/api/v1/desktop/sync/bootstrap/", {
      method: "GET",
      timeoutMs: 20_000,
    });
  }

  async pushSyncMutations(payload, idempotencyKey) {
    return this.authenticatedFetch("/api/v1/desktop/sync/mutations/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      idempotencyKey,
      timeoutMs: 30_000,
    });
  }

  async getSyncChanges(cursor, limit = 200) {
    const query = new URLSearchParams({ limit: String(Math.min(200, Math.max(1, limit))) });
    if (cursor) query.set("cursor", cursor);
    return this.authenticatedFetch(`/api/v1/desktop/sync/changes/?${query}`, {
      method: "GET",
      timeoutMs: 30_000,
    });
  }

  async resumePendingDictations({ signal } = {}) {
    const accountId = this.authManager.getSessionMetadata().accountId;
    if (!accountId) return [];
    const completed = [];
    for (const operation of operationStore.listPending(accountId)) {
      if (operation.accountId !== this.authManager.getSessionMetadata().accountId) break;
      const expectedCount = Number(operation.expectedChunkCount || 0);
      const serverEntries = Object.entries(operation.serverOperations || {})
        .sort(([left], [right]) => Number(left) - Number(right));
      if (!serverEntries.length || (expectedCount > 0 && serverEntries.length < expectedCount)) continue;
      try {
        const results = [];
        for (const [rawIndex, serverId] of serverEntries) {
          const index = Number(rawIndex);
          const initial = await this.authenticatedFetch(
            `/api/v1/desktop/dictation/operations/${encodeURIComponent(serverId)}/`,
            { method: "GET", timeoutMs: 20_000, signal }
          );
          const result = await this.waitForOperation(initial, operation, index, signal);
          operationStore.recordChunkResult(operation.operationId, index, result);
          results.push(result);
        }
        const text = results.map((payload) => {
          const serverOperation = payload?.operation || payload || {};
          const result = serverOperation.result || payload?.result || serverOperation;
          return result.transcript || result.text || "";
        }).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
        const last = results[results.length - 1] || {};
        const serverOperation = last?.operation || last || {};
        const merged = {
          ...last,
          operation: {
            ...serverOperation,
            result: { ...(serverOperation.result || last.result || {}), text },
          },
        };
        const publicPayload = await this.publicResult(merged, operation.operationId);
        this.finishDictation(operation);
        completed.push(publicPayload);
      } catch (error) {
        this.failDictation(operation, error);
        if (error?.code === "AUTH_EXPIRED" || error?.code === "AUTH_ACCOUNT_CHANGED") break;
      }
    }
    return completed;
  }

  finishDictation(operation) { this.activeDictationOperations.delete(operation.operationId); operationStore.remove(operation.operationId); this.walletFetchedAt = 0; }
  failDictation(operation, error) { this.activeDictationOperations.delete(operation.operationId); ["SERVICE_UNAVAILABLE", "BACKEND_FAILED", "BACKEND_RESPONSE_INVALID", "DICTATION_PROCESSING"].includes(error?.code) ? operationStore.retain(operation.operationId) : operationStore.remove(operation.operationId); }

  async publicResult(payload, operationId) {
    const operation = payload?.operation || payload || {};
    const result = operation?.result || payload?.result || operation;
    let wallet = this.walletCache || { balanceCredits: null, reservedCredits: "0", availableCredits: null, limits: {} };
    try { wallet = await this.getWallet({ force: true }); } catch {}
    return { success: true, text: result.transcript || result.text || "", operationId, chargedCredits: operation?.charged_credits == null ? null : String(operation.charged_credits), balanceCredits: wallet.balanceCredits, reservedCredits: wallet.reservedCredits, availableCredits: wallet.availableCredits, limits: wallet.limits, sttProvider: result.stt_provider || result.provider || "voicelab", sttModel: result.stt_model || result.model || null, audioDurationMs: result.audio_duration_ms || (result.duration_seconds != null ? Math.round(Number(result.duration_seconds) * 1000) : null) };
  }
}

module.exports = VoiceLabApiClient;
module.exports.VoiceLabApiError = VoiceLabApiError;
