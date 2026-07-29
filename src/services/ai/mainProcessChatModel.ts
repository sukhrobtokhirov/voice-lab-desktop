import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";

type PublicProviderConfig = {
  baseUrl?: string;
  lanUrl?: string;
  bedrockRegion?: string;
  bedrockProfile?: string;
  azureEndpoint?: string;
  azureApiVersion?: string;
  vertexProject?: string;
  vertexLocation?: string;
};

function serializableOptions(options: LanguageModelV3CallOptions): Record<string, unknown> {
  return {
    prompt: options.prompt,
    maxOutputTokens: options.maxOutputTokens,
    temperature: options.temperature,
    topP: options.topP,
    topK: options.topK,
    presencePenalty: options.presencePenalty,
    frequencyPenalty: options.frequencyPenalty,
    stopSequences: options.stopSequences,
    responseFormat: options.responseFormat,
    seed: options.seed,
    tools: options.tools,
    toolChoice: options.toolChoice,
    providerOptions: options.providerOptions,
  };
}

export function createMainProcessChatModel(
  provider: string,
  modelId: string,
  config: PublicProviderConfig = {}
): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider,
    modelId,
    supportedUrls: {},
    async doGenerate() {
      throw new Error("Main-process chat models are streaming-only");
    },
    async doStream(options) {
      const api = window.electronAPI;
      if (!api?.providerStreamStart || !api.onProviderStreamPart) {
        throw new Error("Provider streaming is not available");
      }
      const streamId = crypto.randomUUID();
      let unsubscribe: (() => void) | undefined;
      const stream = new ReadableStream<LanguageModelV3StreamPart>({
        start(controller) {
          const fail = (message: string) => {
            unsubscribe?.();
            unsubscribe = undefined;
            controller.error(new Error(message));
          };
          unsubscribe = api.onProviderStreamPart?.((payload) => {
            if (payload.streamId !== streamId) return;
            if (payload.error) return fail(payload.error);
            if (payload.done) {
              unsubscribe?.();
              unsubscribe = undefined;
              controller.close();
              return;
            }
            if (payload.part) controller.enqueue(payload.part as LanguageModelV3StreamPart);
          });
          options.abortSignal?.addEventListener(
            "abort",
            () => void api.providerStreamCancel?.(streamId),
            { once: true }
          );
          void api
            .providerStreamStart?.({
              streamId,
              provider,
              modelId,
              config,
              options: serializableOptions(options),
            })
            .then((result) => {
              if (result && !result.success) fail(result.error || "Provider stream failed");
            })
            .catch((error) => fail(error instanceof Error ? error.message : String(error)));
        },
        async cancel() {
          unsubscribe?.();
          unsubscribe = undefined;
          await api.providerStreamCancel?.(streamId);
        },
      });
      return {
        stream: stream as unknown as LanguageModelV3StreamResult["stream"],
      };
    },
  };
}
