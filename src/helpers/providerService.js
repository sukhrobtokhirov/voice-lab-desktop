const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { generateText } = require("ai");
const { createOpenAI } = require("@ai-sdk/openai");
const { createGroq } = require("@ai-sdk/groq");
const { createAnthropic } = require("@ai-sdk/anthropic");
const { createGoogleGenerativeAI } = require("@ai-sdk/google");
const { getEnterpriseAIModel } = require("./enterpriseAiProviders");
const { mapEnterpriseError, validateEnterpriseEndpoint } = require("./enterpriseProviderErrors");
const { transcribeAudio: transcribeWithCorti } = require("./cortiTranscription");
const { transcribeWithTinfoil } = require("./tinfoilTranscription");
const { getTinfoilChatModels } = require("./tinfoilCatalog");
const { resolveAllowedAudioPath } = require("./audioPathPolicy");
const { formatTimestamp } = require("./speakerMerge");
const debugLogger = require("./debugLogger");
const {
  createPinnedFetch,
  normalizeApprovedEndpoint,
  resolveApprovedEndpoint,
} = require("./providerNetworkPolicy");

const ENDPOINTS = Object.freeze({
  openai: "https://api.openai.com/v1",
  groq: "https://api.groq.com/openai/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  openrouter: "https://openrouter.ai/api/v1",
  corti: "https://ai.eu.corti.app/v1",
  xaiStt: "https://api.x.ai/v1/stt",
  mistralStt: "https://api.mistral.ai/v1/audio/transcriptions",
});

const CREDENTIALS = Object.freeze({
  openai: ["getOpenAIKey", "saveOpenAIKey"],
  anthropic: ["getAnthropicKey", "saveAnthropicKey"],
  gemini: ["getGeminiKey", "saveGeminiKey"],
  groq: ["getGroqKey", "saveGroqKey"],
  xai: ["getXaiKey", "saveXaiKey"],
  mistral: ["getMistralKey", "saveMistralKey"],
  openrouter: ["getOpenrouterKey", "saveOpenrouterKey"],
  tinfoil: ["getTinfoilKey", "saveTinfoilKey"],
  cortiApiKey: ["getCortiKey", "saveCortiKey"],
  cortiClientId: ["getCortiClientId", "saveCortiClientId"],
  cortiClientSecret: ["getCortiClientSecret", "saveCortiClientSecret"],
  customTranscription: ["getCustomTranscriptionKey", "saveCustomTranscriptionKey"],
  cleanupCustom: ["getCleanupCustomKey", "saveCleanupCustomKey"],
  bedrockAccessKeyId: ["getBedrockAccessKeyId", "saveBedrockAccessKeyId"],
  bedrockSecretAccessKey: ["getBedrockSecretAccessKey", "saveBedrockSecretAccessKey"],
  bedrockSessionToken: ["getBedrockSessionToken", "saveBedrockSessionToken"],
  azureApiKey: ["getAzureApiKey", "saveAzureApiKey"],
  vertexApiKey: ["getVertexApiKey", "saveVertexApiKey"],
});

const PUBLIC_CONFIG = Object.freeze({
  bedrockRegion: ["getBedrockRegion", "saveBedrockRegion"],
  bedrockProfile: ["getBedrockProfile", "saveBedrockProfile"],
  azureEndpoint: ["getAzureEndpoint", "saveAzureEndpoint"],
  azureDeployment: ["getAzureDeployment", "saveAzureDeployment"],
  azureApiVersion: ["getAzureApiVersion", "saveAzureApiVersion"],
  vertexProject: ["getVertexProject", "saveVertexProject"],
  vertexLocation: ["getVertexLocation", "saveVertexLocation"],
});

const PROVIDER_CREDENTIAL = Object.freeze({
  openai: "openai",
  anthropic: "anthropic",
  gemini: "gemini",
  groq: "groq",
  xai: "xai",
  mistral: "mistral",
  openrouter: "openrouter",
  tinfoil: "tinfoil",
  corti: "cortiApiKey",
  custom: "cleanupCustom",
  azure: "azureApiKey",
  vertex: "vertexApiKey",
});

function cleanError(error, provider) {
  const message = String(error?.message || "Provider request failed")
    .replace(/(?:sk|key|token|secret)-[A-Za-z0-9._-]{8,}/gi, "[redacted]")
    .slice(0, 1000);
  const wrapped = new Error(message);
  wrapped.code = error?.code || "PROVIDER_FAILED";
  wrapped.provider = provider;
  wrapped.retryable = error?.retryable === true;
  return wrapped;
}

function validatedEndpoint(raw, { allowPrivate = false } = {}) {
  const value = String(raw || "").trim();
  if (!value) throw Object.assign(new Error("Provider endpoint is required"), { code: "NO_API" });
  if (value.length > 2048) throw new Error("Provider endpoint is too long");
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Provider endpoint is invalid");
  }
  if (!allowPrivate && url.protocol !== "https:") {
    throw new Error("Remote provider endpoints must use HTTPS");
  }
  return url.toString().replace(/\/+$/, "");
}

function joinEndpoint(base, suffix) {
  const normalized = base.replace(/\/+$/, "");
  return normalized.endsWith(suffix) ? normalized : `${normalized}${suffix}`;
}

function audioExtension(mimeType) {
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "m4a";
  return "webm";
}

class ProviderService {
  constructor(environmentManager, options = {}) {
    this.environment = environmentManager;
    this.streams = new Map();
    this.tinfoilProviders = new Map();
    this.lookup = options.lookup;
    this.createProviderFetch = options.createPinnedFetch || createPinnedFetch;
  }

  credentialStatus() {
    const credentials = {};
    for (const [id, [getter]] of Object.entries(CREDENTIALS)) {
      credentials[id] = Boolean(this.environment?.[getter]?.());
    }
    return { credentials };
  }

  async saveCredential({ credential, value }) {
    const entry = CREDENTIALS[credential];
    if (!entry) throw new Error("Unsupported credential");
    const [, saver] = entry;
    await this.environment[saver](String(value || "").trim());
    await this.environment.saveAllKeysToEnvFile?.();
    return { success: true, configured: Boolean(String(value || "").trim()) };
  }

  getConfig(id) {
    const [getter] = PUBLIC_CONFIG[id] || [];
    if (!getter) throw new Error("Unsupported provider configuration");
    return this.environment?.[getter]?.() ?? null;
  }

  async saveConfig(id, value) {
    const [, saver] = PUBLIC_CONFIG[id] || [];
    if (!saver) throw new Error("Unsupported provider configuration");
    await this.environment[saver](value);
    await this.environment.saveAllKeysToEnvFile?.();
    return { success: true };
  }

  async saveEndpoint({ provider, endpoint }) {
    const mode = provider === "lan" ? "lan" : "remote";
    const approved = await resolveApprovedEndpoint(endpoint, mode, this.lookup);
    const saver =
      provider === "lan" ? "saveLanProviderEndpoint" : "saveCustomProviderEndpoint";
    await this.environment[saver](approved.endpoint);
    await this.environment.saveAllKeysToEnvFile?.();
    return { success: true, provider, endpoint: approved.endpoint };
  }

  listTinfoilModels() {
    return getTinfoilChatModels();
  }

  async listModels({ provider }) {
    const credentialId =
      provider === "openrouter"
        ? "openrouter"
        : provider === "openai"
          ? "openai"
          : provider === "custom"
            ? "cleanupCustom"
            : null;
    const apiKey = this._credential(credentialId, {
      optional: provider === "custom" || provider === "lan",
    });
    let baseUrl;
    let providerFetch = fetch;
    if (provider === "openai") baseUrl = ENDPOINTS.openai;
    else if (provider === "openrouter") baseUrl = ENDPOINTS.openrouter;
    else {
      const binding = this._endpointBinding(provider);
      baseUrl = binding.endpoint;
      providerFetch = this.createProviderFetch(baseUrl, binding.mode, { lookup: this.lookup });
    }
    const endpoint = joinEndpoint(baseUrl, "/models");
    const response = await providerFetch(endpoint, {
      method: "GET",
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = {};
    }
    if (!response.ok) {
      const error = new Error(`${response.status} ${text.slice(0, 200)}`.trim());
      error.code = response.status === 401 ? "INVALID_KEY" : "PROVIDER_FAILED";
      throw cleanError(error, provider);
    }
    const rawModels = Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : [];
    return {
      success: true,
      models: rawModels
        .map((item) => {
          const rawId = item?.id ?? item?.name;
          if (rawId === undefined || rawId === null || rawId === "") return null;
          return {
            id: String(rawId),
            ownedBy: typeof item?.owned_by === "string" ? item.owned_by : undefined,
            description:
              typeof item?.description === "string" ? item.description : undefined,
          };
        })
        .filter(Boolean),
    };
  }

  _credential(id, { optional = false } = {}) {
    const entry = CREDENTIALS[id];
    const value = entry ? String(this.environment?.[entry[0]]?.() || "").trim() : "";
    if (!value && !optional) {
      const error = new Error("Provider credential is not configured");
      error.code = "API_KEY_MISSING";
      throw error;
    }
    return value;
  }

  _endpointBinding(provider) {
    if (provider === "custom") {
      const endpoint = normalizeApprovedEndpoint(
        this.environment.getCustomProviderEndpoint?.(),
        "remote"
      );
      return { endpoint, mode: "remote" };
    }
    if (provider === "lan") {
      const endpoint = normalizeApprovedEndpoint(
        this.environment.getLanProviderEndpoint?.(),
        "lan"
      );
      return { endpoint, mode: "lan" };
    }
    throw new Error("Unsupported endpoint binding");
  }

  _enterpriseConfig(config = {}) {
    return {
      bedrockRegion: config.bedrockRegion || this.environment.getBedrockRegion?.() || "us-east-1",
      bedrockProfile: config.bedrockProfile || this.environment.getBedrockProfile?.() || "",
      bedrockAccessKeyId: this._credential("bedrockAccessKeyId", { optional: true }),
      bedrockSecretAccessKey: this._credential("bedrockSecretAccessKey", { optional: true }),
      bedrockSessionToken: this._credential("bedrockSessionToken", { optional: true }),
      azureEndpoint: config.azureEndpoint || this.environment.getAzureEndpoint?.() || "",
      azureApiVersion:
        config.azureApiVersion || this.environment.getAzureApiVersion?.() || "2024-10-21",
      vertexProject: config.vertexProject || this.environment.getVertexProject?.() || "",
      vertexLocation:
        config.vertexLocation || this.environment.getVertexLocation?.() || "us-central1",
    };
  }

  async _model(provider, model, config = {}) {
    if (["bedrock", "azure", "vertex"].includes(provider)) {
      const enterprise = this._enterpriseConfig(config);
      if (provider === "azure") validateEnterpriseEndpoint(enterprise.azureEndpoint);
      const apiKey =
        provider === "azure"
          ? this._credential("azureApiKey")
          : provider === "vertex"
            ? this._credential("vertexApiKey", { optional: true })
            : "";
      return getEnterpriseAIModel(provider, model, apiKey, enterprise);
    }

    if (provider === "tinfoil") {
      const key = this._credential("tinfoil");
      if (!this.tinfoilProviders.has(key)) {
        const { TinfoilAISDKProvider } = await import("tinfoil");
        this.tinfoilProviders.set(key, new TinfoilAISDKProvider({ apiKey: key }));
      }
      return this.tinfoilProviders.get(key)(model);
    }

    const credentialId = PROVIDER_CREDENTIAL[provider];
    const apiKey = this._credential(credentialId, {
      optional: provider === "custom" || provider === "lan",
    });
    switch (provider) {
      case "openai":
        return createOpenAI({ apiKey })(model);
      case "groq":
        return createGroq({ apiKey })(model);
      case "anthropic":
        return createAnthropic({ apiKey })(model);
      case "gemini":
        return createGoogleGenerativeAI({ apiKey })(model);
      case "openrouter":
        return createOpenAI({ apiKey, baseURL: ENDPOINTS.openrouter }).chat(model);
      case "corti":
        return createOpenAI({ apiKey, baseURL: ENDPOINTS.corti }).chat(model);
      case "custom":
      case "lan": {
        const binding = this._endpointBinding(provider);
        const providerFetch = this.createProviderFetch(binding.endpoint, binding.mode, {
          lookup: this.lookup,
        });
        return createOpenAI({
          apiKey: provider === "lan" ? "credentialless" : apiKey || "no-key",
          baseURL: binding.endpoint,
          fetch: providerFetch,
        }).chat(model);
      }
      default:
        throw new Error(`Unsupported reasoning provider: ${provider}`);
    }
  }

  async reason(payload) {
    const { provider, model, text, config } = payload;
    try {
      const aiModel = await this._model(provider, model, config);
      const result = await generateText({
        model: aiModel,
        system: config.systemPrompt || undefined,
        prompt: text,
        maxOutputTokens: config.maxTokens || 4096,
        ...(typeof config.temperature === "number" ? { temperature: config.temperature } : {}),
        abortSignal: AbortSignal.timeout(60_000),
      });
      return { success: true, text: result.text || "" };
    } catch (error) {
      if (["bedrock", "azure", "vertex"].includes(provider)) {
        const mapped = mapEnterpriseError(provider, error, this._enterpriseConfig(config));
        return { success: false, error: mapped.message, retryable: mapped.retryable === true };
      }
      throw cleanError(error, provider);
    }
  }

  async startStream(event, payload) {
    const { streamId, provider, modelId, config, options } = payload;
    const key = `${event.sender.id}:${streamId}`;
    if (this.streams.has(key)) throw new Error("Stream already exists");
    const controller = new AbortController();
    this.streams.set(key, controller);
    const send = (part) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send("provider-stream-part", { streamId, ...part });
      }
    };
    try {
      const model = await this._model(provider, modelId, config);
      const result = await model.doStream({ ...options, abortSignal: controller.signal });
      const reader = result.stream.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          send({ part: value });
        }
      } finally {
        reader.releaseLock();
      }
      send({ done: true });
      return { success: true };
    } catch (error) {
      const safe = cleanError(error, provider);
      send({ error: safe.message });
      return { success: false, error: safe.message, code: safe.code };
    } finally {
      this.streams.delete(key);
    }
  }

  cancelStream(event, streamId) {
    const key = `${event.sender.id}:${streamId}`;
    this.streams.get(key)?.abort();
    this.streams.delete(key);
    return { success: true };
  }

  async transcribe(payload) {
    const {
      audioBuffer,
      mimeType,
      provider,
      model,
      baseUrl,
      language,
      prompt,
      keyterms,
      contextBias,
      environment,
      tenant,
      diarize,
    } = payload;
    const audio = Buffer.from(audioBuffer);
    try {
      if (provider === "corti") {
        const result = await transcribeWithCorti({
          environment: environment || "us",
          tenant: tenant || "base",
          clientId: this._credential("cortiClientId"),
          clientSecret: this._credential("cortiClientSecret"),
          audioBuffer: audio,
          language: language || "en",
        });
        return { success: true, text: result.text || "" };
      }
      if (provider === "tinfoil") {
        const result = await transcribeWithTinfoil({
          audioBuffer: audio,
          fileName: `audio.${audioExtension(mimeType)}`,
          contentType: mimeType,
          language,
          prompt,
          apiKey: this._credential("tinfoil"),
        });
        return { success: true, text: result.text || "" };
      }

      const credentialId =
        provider === "custom" || provider === "lan"
          ? "customTranscription"
          : PROVIDER_CREDENTIAL[provider];
      const apiKey = this._credential(credentialId, {
        optional: provider === "custom" || provider === "lan",
      });
      let endpoint;
      if (provider === "xai") endpoint = ENDPOINTS.xaiStt;
      else if (provider === "mistral") endpoint = ENDPOINTS.mistralStt;
      else if (provider === "openai") endpoint = `${ENDPOINTS.openai}/audio/transcriptions`;
      else if (provider === "groq") endpoint = `${ENDPOINTS.groq}/audio/transcriptions`;
      else {
        endpoint = joinEndpoint(
          validatedEndpoint(baseUrl, { allowPrivate: provider === "custom" || provider === "lan" }),
          "/audio/transcriptions"
        );
      }

      const form = new FormData();
      form.append("file", new Blob([audio], { type: mimeType }), `audio.${audioExtension(mimeType)}`);
      if (provider !== "xai") form.append("model", model || "whisper-1");
      if (language && language !== "auto") form.append("language", language);
      if (prompt) form.append("prompt", prompt.slice(0, provider === "groq" ? 890 : 4000));
      for (const value of keyterms || []) form.append("keyterms", value);
      for (const value of contextBias || []) form.append("context_bias", value);
      if (diarize && provider === "mistral") {
        form.set("diarize", "true");
        form.set("timestamp_granularities", "segment");
      } else if (diarize && provider === "openai") {
        form.set("model", "gpt-4o-transcribe-diarize");
        form.set("response_format", "diarized_json");
        form.set("chunking_strategy", "auto");
      }

      const headers = {};
      if (apiKey) {
        headers[provider === "mistral" ? "x-api-key" : "Authorization"] =
          provider === "mistral" ? apiKey : `Bearer ${apiKey}`;
      }
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: form,
        signal: AbortSignal.timeout(90_000),
      });
      const responseText = await response.text();
      let body;
      try {
        body = responseText ? JSON.parse(responseText) : {};
      } catch {
        body = { error: responseText };
      }
      if (!response.ok) {
        const error = new Error(
          body?.error?.message || body?.error || `Provider returned ${response.status}`
        );
        error.code =
          response.status === 401
            ? "INVALID_KEY"
            : response.status === 429
              ? "PROVIDER_RATE_LIMITED"
              : "PROVIDER_FAILED";
        throw error;
      }
      const diarizedSegments = Array.isArray(body?.speakers)
        ? body.speakers.map((segment) => ({
            speaker: segment.id || `Speaker ${segment.speaker || "?"}`,
            text: segment.text || "",
            start: segment.start || 0,
            end: segment.end || 0,
          }))
        : Array.isArray(body?.segments) && body.segments.some((segment) => segment?.speaker)
          ? body.segments
          : null;
      if (diarize && diarizedSegments) {
        const text = diarizedSegments
          .map(
            (segment) =>
              `[${segment.speaker || "Speaker ?"}] ${formatTimestamp(segment.start || 0)} - ${formatTimestamp(segment.end || 0)}\n${segment.text || ""}`
          )
          .join("\n\n");
        return { success: true, text, diarized: true };
      }
      return { success: true, text: body.text || "", raw: body };
    } catch (error) {
      debugLogger.warn("Provider transcription failed", {
        provider,
        code: error?.code,
        requestId: crypto.randomUUID(),
      });
      throw cleanError(error, provider);
    }
  }

  async transcribeFile(payload) {
    const realPath = resolveAllowedAudioPath(payload.filePath);
    if (!realPath) {
      const error = new Error("Audio path is not approved");
      error.code = "FILE_PATH_FORBIDDEN";
      throw error;
    }

    const { resolveSelfHostedRetryRoute } = await import("./retryTranscriptionRouting.js");
    const route = resolveSelfHostedRetryRoute({
      transcriptionMode: payload.transcriptionMode,
      remoteTranscriptionUrl: payload.remoteTranscriptionUrl,
      remoteTranscriptionModel: payload.remoteTranscriptionModel,
    });
    if (route?.kind === "configuration-error") throw new Error(route.error);

    const selfHosted = route?.kind === "self-hosted";
    const size = fs.statSync(realPath).size;
    if (!selfHosted && size > 25 * 1024 * 1024) {
      const error = new Error("File too large. Maximum size for bring-your-own-key is 25 MB.");
      error.code = "FILE_TOO_LARGE";
      throw error;
    }

    const extension = path.extname(realPath).slice(1).toLowerCase();
    const mimeType =
      {
        wav: "audio/wav",
        mp3: "audio/mpeg",
        m4a: "audio/mp4",
        mp4: "audio/mp4",
        webm: "audio/webm",
        ogg: "audio/ogg",
        flac: "audio/flac",
      }[extension] || "audio/mpeg";

    return this.transcribe({
      audioBuffer: fs.readFileSync(realPath),
      mimeType,
      provider: selfHosted ? "lan" : payload.provider,
      model: selfHosted ? route.model : payload.model,
      baseUrl: selfHosted ? route.endpoint : payload.baseUrl,
      language: payload.language,
      environment: payload.environment,
      tenant: payload.tenant,
      diarize: payload.diarize,
    });
  }
}

module.exports = { CREDENTIALS, ProviderService, validatedEndpoint };
