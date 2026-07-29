import {
  getModelProvider,
  getCloudModel,
  getOpenAiApiConfig,
  getProviderDisplayName,
  isEnterpriseProvider,
  type EnterpriseProvider,
} from "../models/ModelRegistry";
import { BaseReasoningService, ReasoningConfig } from "./BaseReasoningService";
import logger from "../utils/logger";
import { getSettings, isCloudCleanupMode } from "../stores/settingsStore";
import { wrapCleanupTranscript } from "../config/prompts";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText, stepCountIs } from "ai";
import { createMainProcessChatModel } from "./ai/mainProcessChatModel";

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

// Old Ollama/strict proxies reject the `reasoning` object; drop it and retry once.
async function fetchWithReasoningFieldFallback(
  doFetch: () => Promise<Response>,
  requestBody: Record<string, unknown>,
  logEvent: string
): Promise<Response> {
  let res = await doFetch();
  if (!res.ok && (res.status === 400 || res.status === 422) && requestBody.reasoning) {
    logger.logReasoning(logEvent, { status: res.status });
    delete requestBody.reasoning;
    void res.body?.cancel();
    res = await doFetch();
  }
  return res;
}

class ReasoningService extends BaseReasoningService {
  private static readonly MAX_TOOL_STEPS = 20;
  private streamAbortController: AbortController | null = null;

  constructor() {
    super();
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", () => this.destroy());
    }
  }

  private isLanCleanupMode(): boolean {
    const settings = getSettings();
    return settings.cleanupMode === "self-hosted" && !!settings.cleanupRemoteUrl;
  }

  async processText(
    text: string,
    model: string = "",
    agentName: string | null = null,
    config: ReasoningConfig = {}
  ): Promise<string> {
    const trimmedModel = model?.trim?.() || "";
    const provider = config.lanUrl ? "lan" : config.provider || getModelProvider(trimmedModel);
    if (!trimmedModel && provider !== "openwhispr") throw new Error("No reasoning model selected");

    if (provider === "openwhispr") {
      const handler = (await import("./ai/inferenceProviders/openwhispr")).openwhisprProvider;
      return handler.call({
        text,
        model: trimmedModel,
        agentName,
        config,
        ctx: {
          getApiKey: async () => "",
          getSystemPrompt: this.getSystemPrompt.bind(this),
          getCustomDictionary: this.getCustomDictionary.bind(this),
          getPreferredLanguage: this.getPreferredLanguage.bind(this),
          getUiLanguage: this.getUiLanguage.bind(this),
          callChatCompletionsApi: async () => { throw new Error("Unavailable"); },
          calculateMaxTokens: this.calculateMaxTokens.bind(this),
        },
      });
    }
    if (provider === "local") {
      const systemPrompt = config.systemPrompt || this.getSystemPrompt(agentName);
      const result = await window.electronAPI.processLocalReasoning(
        config.systemPrompt ? text : wrapCleanupTranscript(text),
        trimmedModel,
        agentName,
        { ...config, systemPrompt, customApiKey: undefined }
      );
      if (!result.success) throw new Error(result.error || "Local reasoning failed");
      return result.text || "";
    }

    const result = await window.electronAPI.providerReason?.({
      provider,
      model: trimmedModel,
      text: config.systemPrompt ? text : wrapCleanupTranscript(text),
      config: {
        systemPrompt: config.systemPrompt || this.getSystemPrompt(agentName),
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        disableThinking: config.disableThinking,
        language: config.language,
      },
    });
    if (!result?.success) throw new Error(result?.error || "Provider reasoning failed");
    return result.text || "";
  }

  async *processTextStreaming(
    messages: Array<{ role: string; content: string }>,
    model: string,
    provider: string,
    config: ReasoningConfig & { systemPrompt: string }
  ): AsyncGenerator<string, void, unknown> {
    const proxy = createMainProcessChatModel(provider, model);
    const controller = new AbortController();
    this.streamAbortController = controller;
    const result = streamText({
      model: proxy,
      messages: messages.map((message) => ({
        role: message.role as "system" | "user" | "assistant",
        content: message.content,
      })),
      abortSignal: controller.signal,
      maxOutputTokens: config.maxTokens || 4096,
      temperature: config.temperature ?? 0.3,
    });
    try {
      for await (const text of result.textStream) yield text;
    } finally {
      if (this.streamAbortController === controller) this.streamAbortController = null;
    }
  }

  async *processTextStreamingAI(
    messages: Array<{ role: string; content: string }>,
    model: string,
    provider: string,
    config: ReasoningConfig & { systemPrompt: string },
    tools?: Record<string, import("ai").Tool>
  ): AsyncGenerator<AgentStreamChunk, void, unknown> {
    const isLocalProvider = provider === "local";
    let aiModel;
    if (isLocalProvider) {
      const serverResult = await window.electronAPI.llamaServerStart(model);
      if (!serverResult.success || !serverResult.port) {
        throw new Error(serverResult.error || "Failed to start local model server");
      }
      aiModel = createOpenAI({
        apiKey: "no-key",
        baseURL: `http://127.0.0.1:${serverResult.port}/v1`,
      }).chat(model);
    } else {
      aiModel = createMainProcessChatModel(provider, model);
    }
    logger.logReasoning("AGENT_AI_SDK_STREAM_REQUEST", {
      model,
      provider,
      hasTools: !!tools,
      toolCount: tools ? Object.keys(tools).length : 0,
      messageCount: messages.length,
    });

    const useTemperature = true;

    // cancelActiveStream() aborts this controller; streamText propagates it
    // into doStream, cancelling the enterprise IPC proxy's request in main.
    const abortController = new AbortController();
    this.streamAbortController = abortController;

    const result = streamText({
      model: aiModel,
      messages: messages.map((m) => ({
        role: m.role as "system" | "user" | "assistant",
        content: m.content,
      })),
      tools: tools || undefined,
      stopWhen: stepCountIs(tools ? ReasoningService.MAX_TOOL_STEPS : 1),
      abortSignal: abortController.signal,
      ...(useTemperature ? { temperature: config.temperature ?? 0.3 } : {}),
      maxOutputTokens: config.maxTokens || 4096,
    });

    try {
      for await (const chunk of result.fullStream) {
        if (chunk.type === "text-delta") {
          yield { type: "content", text: chunk.text };
        } else if (chunk.type === "tool-call") {
          yield {
            type: "tool_calls",
            calls: [
              {
                id: chunk.toolCallId,
                name: chunk.toolName,
                arguments: JSON.stringify(chunk.input),
              },
            ],
          };
        } else if (chunk.type === "tool-result") {
          const output = chunk.output;
          const displayText =
            typeof output === "string" ? output : output?.error ? String(output.error) : "Done";
          yield {
            type: "tool_result",
            callId: chunk.toolCallId,
            toolName: chunk.toolName,
            displayText,
          };
        } else if (chunk.type === "finish") {
          yield { type: "done", finishReason: chunk.finishReason };
        }
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        yield { type: "done", finishReason: "stop" };
        return;
      }
      throw error;
    } finally {
      if (this.streamAbortController === abortController) {
        this.streamAbortController = null;
      }
    }
  }

  cancelActiveStream(): void {
    this.streamAbortController?.abort();
    this.streamAbortController = null;
  }

  private streamFromIPC(
    messages: Array<{ role: string; content: string | Array<unknown> }>,
    opts: {
      systemPrompt?: string;
      tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
    }
  ): AsyncGenerator<
    {
      type: string;
      text?: string;
      id?: string;
      name?: string;
      arguments?: string;
      finishReason?: string;
    },
    void,
    unknown
  > {
    type StreamEvent = {
      type: string;
      text?: string;
      id?: string;
      name?: string;
      arguments?: string;
      finishReason?: string;
    };
    const queue: Array<StreamEvent | { type: "__error"; error: string } | { type: "__end" }> = [];
    let resolve: (() => void) | null = null;

    const cleanupChunk = window.electronAPI?.onAgentStreamChunk?.((chunk) => {
      queue.push(chunk);
      resolve?.();
    });
    const cleanupError = window.electronAPI?.onAgentStreamError?.((err) => {
      queue.push({ type: "__error", error: err.error });
      resolve?.();
    });
    const cleanupEnd = window.electronAPI?.onAgentStreamEnd?.(() => {
      queue.push({ type: "__end" });
      resolve?.();
    });

    const cleanup = () => {
      cleanupChunk?.();
      cleanupError?.();
      cleanupEnd?.();
    };

    window.electronAPI?.startAgentStream?.(messages, opts);

    const generator = async function* () {
      try {
        while (true) {
          if (queue.length === 0) {
            await new Promise<void>((r) => {
              resolve = r;
            });
            resolve = null;
          }

          while (queue.length > 0) {
            const item = queue.shift()!;
            if (item.type === "__end") return;
            if (item.type === "__error") throw new Error((item as { error: string }).error);
            yield item as StreamEvent;
          }
        }
      } finally {
        cleanup();
      }
    };

    return generator();
  }

  async *processTextStreamingCloud(
    messages: Array<{ role: string; content: string | Array<unknown> }>,
    config: {
      systemPrompt: string;
      tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
      executeToolCall?: (
        name: string,
        args: string
      ) => Promise<{ data: string; displayText: string; metadata?: Record<string, unknown> }>;
    }
  ): AsyncGenerator<AgentStreamChunk, void, unknown> {
    const maxSteps = config.tools?.length ? ReasoningService.MAX_TOOL_STEPS : 1;
    let currentMessages = [...messages];

    for (let step = 0; step < maxSteps; step++) {
      const stream = this.streamFromIPC(currentMessages, {
        systemPrompt: config.systemPrompt,
        tools: config.tools,
      });

      const pendingToolCalls: Array<{ id: string; name: string; arguments: string }> = [];

      for await (const ev of stream) {
        if (ev.type === "content") {
          yield { type: "content", text: ev.text as string };
        } else if (ev.type === "tool_call") {
          const call = {
            id: ev.id as string,
            name: ev.name as string,
            arguments: ev.arguments as string,
          };
          pendingToolCalls.push(call);
          yield { type: "tool_calls", calls: [call] };
        }
      }

      if (pendingToolCalls.length === 0 || !config.executeToolCall) {
        yield { type: "done", finishReason: "stop" };
        return;
      }

      for (const call of pendingToolCalls) {
        let toolResult: { data: string; displayText: string; metadata?: Record<string, unknown> };
        try {
          toolResult = await config.executeToolCall(call.name, call.arguments);
        } catch (error) {
          const errMsg = `Error: ${(error as Error).message}`;
          toolResult = { data: errMsg, displayText: errMsg };
        }
        yield {
          type: "tool_result",
          callId: call.id,
          toolName: call.name,
          displayText: toolResult.displayText,
          ...(toolResult.metadata ? { metadata: toolResult.metadata } : {}),
        };

        currentMessages = [
          ...currentMessages,
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: call.id,
                toolName: call.name,
                input: JSON.parse(call.arguments),
              },
            ],
          },
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: call.id,
                toolName: call.name,
                output: { type: "text", value: toolResult.data },
              },
            ],
          },
        ];
      }
    }

    yield { type: "done", finishReason: "stop" };
  }

  async isAvailable(): Promise<boolean> {
    try {
      if (isCloudCleanupMode() || this.isLanCleanupMode()) return true;
      const status = await window.electronAPI.providerCredentialStatus?.();
      const configured = status?.credentials || {};
      const settings = getSettings();
      if (settings.cleanupProvider === "bedrock") {
        return Boolean(configured.bedrockAccessKeyId || settings.bedrockProfile?.trim());
      }
      if (settings.cleanupProvider === "vertex") {
        return Boolean(configured.vertexApiKey || settings.vertexProject?.trim());
      }
      const id = settings.cleanupProvider === "custom" ? "cleanupCustom" : settings.cleanupProvider;
      return Boolean(configured[id] || (await window.electronAPI.checkLocalReasoningAvailable?.()));
    } catch {
      return false;
    }
  }

  destroy(): void {
    this.cancelActiveStream();
  }
}

export default new ReasoningService();
