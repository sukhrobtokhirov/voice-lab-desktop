export interface InferenceProviderContext {
  getApiKey(provider: string): Promise<string>;
  getSystemPrompt(agentName?: string): string;
  getCustomDictionary(): string[];
  getPreferredLanguage(): string;
  getUiLanguage(): string;
  callChatCompletionsApi(...args: unknown[]): Promise<unknown>;
  calculateMaxTokens(text: string): number;
}

export interface InferenceProvider {
  id: string;
  call(input: {
    text: string;
    model: string;
    agentName?: string;
    config: {
      systemPrompt?: string;
      language?: string;
    };
    ctx: InferenceProviderContext;
  }): Promise<string>;
}
