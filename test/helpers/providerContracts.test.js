const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  parse,
  providerReasonSchema,
  providerTranscriptionSchema,
} = require("../../src/helpers/ipc/providerContracts");
const { ProviderService } = require("../../src/helpers/providerService");

test("provider IPC rejects renderer-supplied secrets", () => {
  assert.throws(
    () =>
      parse(providerReasonSchema, {
        provider: "openai",
        model: "gpt-4.1-mini",
        text: "hello",
        config: { apiKey: "secret" },
      }),
    /Invalid IPC payload/
  );
});

test("provider transcription enforces the BYOK byte limit", () => {
  assert.throws(
    () =>
      parse(providerTranscriptionSchema, {
        provider: "openai",
        audioBuffer: new Uint8Array(25 * 1024 * 1024 + 1),
      }),
    /Invalid IPC payload/
  );
});

test("provider credential status is opaque and saves remain in main", async () => {
  let savedValue = null;
  let persisted = false;
  const service = new ProviderService({
    getOpenAIKey: () => "raw-secret",
    saveOpenAIKey: async (value) => {
      savedValue = value;
    },
    saveAllKeysToEnvFile: async () => {
      persisted = true;
    },
  });

  const status = service.credentialStatus();
  assert.equal(status.credentials.openai, true);
  assert.doesNotMatch(JSON.stringify(status), /raw-secret/);

  await service.saveCredential({ credential: "openai", value: "replacement" });
  assert.equal(savedValue, "replacement");
  assert.equal(persisted, true);
});

test("generated preloads expose no raw provider secret getters", () => {
  const dir = path.resolve(__dirname, "../../preloads");
  const forbidden =
    /\b(?:getOpenAIApiKey|getGroqApiKey|getGeminiApiKey|getAnthropicApiKey|getBedrockAccessKeyId|getBedrockSecretAccessKey|getBedrockSessionToken|getAzureApiKey|getVertexApiKey|getTinfoilApiKey|getCortiApiKey)\b/;
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".js"))) {
    assert.doesNotMatch(fs.readFileSync(path.join(dir, file), "utf8"), forbidden, file);
  }
});

test("each BrowserWindow configuration uses a capability-specific preload", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../src/helpers/windowConfig.js"),
    "utf8"
  );
  for (const name of ["control-panel", "overlay", "agent", "notification", "preview"]) {
    assert.ok(source.includes(`"preloads", "${name}.js"`), `${name} preload is missing`);
  }
  assert.doesNotMatch(source, /["']preload\.js["']/);
});

test("auxiliary windows cannot save credentials or start authentication", () => {
  const dir = path.resolve(__dirname, "../../preloads");
  for (const name of ["overlay", "agent", "notification", "preview"]) {
    const source = fs.readFileSync(path.join(dir, `${name}.js`), "utf8");
    const capabilities = JSON.parse(
      source.match(/const preloadCapabilities = new Set\\((\\[[^;]+\\])\\);/)?.[1] || "[]"
    );
    assert.ok(!capabilities.includes("providerSaveCredential"), name);
    assert.ok(!capabilities.includes("authStartBrowser"), name);
    assert.ok(!capabilities.includes("providerTranscribeFile"), name);
  }
});

test("legacy provider compatibility channels are absent from the monolithic handler", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../src/helpers/ipcHandlers.js"),
    "utf8"
  );
  assert.doesNotMatch(
    source,
    /process-anthropic-reasoning|process-enterprise-reasoning|enterprise-stream-(?:start|cancel)|proxy-(?:xai|mistral|corti|tinfoil)-transcription/
  );
});
