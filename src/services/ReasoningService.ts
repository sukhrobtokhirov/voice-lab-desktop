import { BaseReasoningService, type ReasoningConfig } from "./BaseReasoningService";
import { getSettings } from "../stores/settingsStore";
import { wrapCleanupTranscript } from "../config/prompts";
import { voiceLabProvider } from "./ai/inferenceProviders/voicelab";

export type AgentStreamChunk =
  | { type: "content"; text: string }
  | { type: "tool_calls"; calls: Array<{ id: string; name: string; arguments: string }> }
  | {
      type: "tool_result";
      callId: string;
      toolName: string;
      displayText: string;
      metadata?: Record<string, unknown>;
    }
  | { type: "done"; finishReason?: string };

type ChatMessage = { role: string; content: string | Array<unknown> };

/**
 * Text processing goes through the signed-in VoiceLab API. This deliberately
 * replaces the former third-party provider bridge while keeping existing
 * callers compatible during the transition.
 */
class ReasoningService extends BaseReasoningService {
  private streamAbortController: AbortController | null = null;

  constructor() {
    super();
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", () => this.destroy());
    }
  }

  async processText(
    text: string,
    model = "",
    agentName: string | null = null,
    config: ReasoningConfig = {}
  ): Promise<string> {
    return voiceLabProvider.call({
      text: config.systemPrompt ? text : wrapCleanupTranscript(text),
      model,
      agentName,
      config,
      ctx: {
        getApiKey: async () => "",
        getSystemPrompt: this.getSystemPrompt.bind(this),
        getCustomDictionary: this.getCustomDictionary.bind(this),
        getPreferredLanguage: this.getPreferredLanguage.bind(this),
        getUiLanguage: this.getUiLanguage.bind(this),
        callChatCompletionsApi: async () => {
          throw new Error("Direct provider requests are not supported");
        },
        calculateMaxTokens: this.calculateMaxTokens.bind(this),
      },
    });
  }

  private latestText(messages: ChatMessage[]): string {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (typeof message.content === "string" && message.content.trim()) return message.content;
    }
    return "";
  }

  private async *streamVoiceLabText(
    messages: ChatMessage[],
    config: ReasoningConfig & { systemPrompt?: string }
  ): AsyncGenerator<string, void, unknown> {
    const controller = new AbortController();
    this.streamAbortController = controller;
    try {
      const text = this.latestText(messages);
      if (!text || controller.signal.aborted) return;
      const result = await this.processText(text, "", null, config);
      if (!controller.signal.aborted && result) yield result;
    } finally {
      if (this.streamAbortController === controller) this.streamAbortController = null;
    }
  }

  async *processTextStreaming(
    messages: Array<{ role: string; content: string }>,
    _model: string,
    _provider: string,
    config: ReasoningConfig & { systemPrompt: string }
  ): AsyncGenerator<string, void, unknown> {
    yield* this.streamVoiceLabText(messages, config);
  }

  async *processTextStreamingAI(
    messages: Array<{ role: string; content: string }>,
    _model: string,
    _provider: string,
    config: ReasoningConfig & { systemPrompt: string },
    _tools?: unknown
  ): AsyncGenerator<AgentStreamChunk, void, unknown> {
    for await (const text of this.streamVoiceLabText(messages, config)) {
      yield { type: "content", text };
    }
    yield { type: "done", finishReason: "stop" };
  }

  async *processTextStreamingCloud(
    messages: ChatMessage[],
    config: {
      systemPrompt: string;
      tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
      executeToolCall?: (
        name: string,
        args: string
      ) => Promise<{ data: string; displayText: string; metadata?: Record<string, unknown> }>;
    }
  ): AsyncGenerator<AgentStreamChunk, void, unknown> {
    for await (const text of this.streamVoiceLabText(messages, config)) {
      yield { type: "content", text };
    }
    yield { type: "done", finishReason: "stop" };
  }

  cancelActiveStream(): void {
    this.streamAbortController?.abort();
    this.streamAbortController = null;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(getSettings().isSignedIn);
  }

  destroy(): void {
    this.cancelActiveStream();
  }
}

export default new ReasoningService();
