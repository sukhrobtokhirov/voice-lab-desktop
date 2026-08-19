const { z } = require("zod");

const PROVIDERS = [
  "openai",
  "anthropic",
  "gemini",
  "groq",
  "xai",
  "mistral",
  "openrouter",
  "tinfoil",
  "corti",
  "custom",
  "lan",
  "bedrock",
  "azure",
  "vertex",
];

const CREDENTIAL_IDS = [
  "openai",
  "anthropic",
  "gemini",
  "groq",
  "xai",
  "mistral",
  "openrouter",
  "tinfoil",
  "cortiApiKey",
  "cortiClientId",
  "cortiClientSecret",
  "customTranscription",
  "cleanupCustom",
  "bedrockAccessKeyId",
  "bedrockSecretAccessKey",
  "bedrockSessionToken",
  "azureApiKey",
  "vertexApiKey",
];

const publicProviderConfigSchema = z
  .object({
    systemPrompt: z.string().max(100_000).optional(),
    maxTokens: z.number().int().min(1).max(131_072).optional(),
    temperature: z.number().min(0).max(2).optional(),
    disableThinking: z.boolean().optional(),
    language: z.string().trim().max(32).optional(),
    bedrockRegion: z.string().trim().max(64).optional(),
    bedrockProfile: z.string().trim().max(256).optional(),
    azureEndpoint: z.string().trim().max(2048).optional(),
    azureApiVersion: z.string().trim().max(64).optional(),
    vertexProject: z.string().trim().max(256).optional(),
    vertexLocation: z.string().trim().max(128).optional(),
  })
  .strict();

const providerReasonSchema = z
  .object({
    provider: z.enum(PROVIDERS),
    model: z.string().trim().min(1).max(512),
    text: z.string().max(1_000_000),
    config: publicProviderConfigSchema.default({}),
  })
  .strict();

const providerStreamSchema = z
  .object({
    streamId: z.string().uuid(),
    provider: z.enum(PROVIDERS),
    modelId: z.string().trim().min(1).max(512),
    config: publicProviderConfigSchema.default({}),
    options: z.record(z.string(), z.unknown()),
  })
  .strict();

const providerCredentialSaveSchema = z
  .object({
    credential: z.enum(CREDENTIAL_IDS),
    value: z.string().max(16_384),
  })
  .strict();

const providerModelListSchema = z
  .object({
    provider: z.enum(["openai", "openrouter", "custom", "lan"]),
  })
  .strict();

const providerEndpointSaveSchema = z
  .object({
    provider: z.enum(["custom", "lan"]),
    endpoint: z.string().trim().min(1).max(2048),
  })
  .strict();

const providerConfigValueSchema = z.string().trim().max(2048);

const providerTranscriptionSchema = z
  .object({
    audioBuffer: z.union([z.instanceof(ArrayBuffer), z.instanceof(Uint8Array)]),
    mimeType: z.string().trim().max(128).default("audio/webm"),
    provider: z.enum([
      "openai",
      "groq",
      "xai",
      "mistral",
      "tinfoil",
      "corti",
      "custom",
      "lan",
    ]),
    model: z.string().trim().max(512).optional(),
    diarize: z.boolean().optional(),
    baseUrl: z.string().trim().max(2048).optional(),
    language: z.string().trim().max(32).optional(),
    prompt: z.string().max(4000).optional(),
    keyterms: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
    contextBias: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
    environment: z.enum(["us", "eu", "au"]).optional(),
    tenant: z.string().trim().max(128).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const bytes = value.audioBuffer.byteLength;
    if (bytes > 25 * 1024 * 1024) {
      ctx.addIssue({ code: "custom", message: "Audio exceeds the 25 MB BYOK limit" });
    }
  });

const providerFileTranscriptionSchema = z
  .object({
    filePath: z.string().trim().min(1).max(4096),
    baseUrl: z.string().trim().max(2048).optional(),
    model: z.string().trim().max(512).optional(),
    diarize: z.boolean().optional(),
    provider: z.enum([
      "openai",
      "groq",
      "xai",
      "mistral",
      "tinfoil",
      "corti",
      "custom",
      "lan",
    ]),
    language: z.string().trim().max(32).optional(),
    environment: z.enum(["us", "eu", "au"]).optional(),
    tenant: z.string().trim().max(128).optional(),
    transcriptionMode: z.string().trim().max(64).optional(),
    remoteTranscriptionUrl: z.string().trim().max(2048).optional(),
    remoteTranscriptionModel: z.string().trim().max(512).optional(),
  })
  .strict();

function parse(schema, value, code = "IPC_PAYLOAD_INVALID") {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const error = new Error("Invalid IPC payload");
  error.code = code;
  error.details = result.error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
  throw error;
}

module.exports = {
  CREDENTIAL_IDS,
  PROVIDERS,
  parse,
  providerCredentialSaveSchema,
  providerEndpointSaveSchema,
  providerConfigValueSchema,
  providerFileTranscriptionSchema,
  providerModelListSchema,
  providerReasonSchema,
  providerStreamSchema,
  providerTranscriptionSchema,
  publicProviderConfigSchema,
};
