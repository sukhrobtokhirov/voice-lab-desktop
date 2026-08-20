import type { InferenceProvider } from "./types";
import { withSessionRefresh } from "../../../lib/auth";
import { getSettings } from "../../../stores/settingsStore";
import logger from "../../../utils/logger";

export const voiceLabProvider: InferenceProvider = {
  id: "voicelab",
  async call({ text, model, agentName, config, ctx }) {
    logger.logReasoning("VOICELAB_START", { model, agentName });

    const customPrompt = config.systemPrompt
      ? undefined
      : getSettings().customPrompts.cleanup || undefined;

    const result = await withSessionRefresh(async () => {
      const res = await window.electronAPI?.cloudReason?.(text, {
        agentName,
        customDictionary: ctx.getCustomDictionary(),
        customPrompt,
        systemPrompt: config.systemPrompt,
        promptMode: config.systemPrompt ? undefined : "cleanup",
        language: config.language || ctx.getPreferredLanguage(),
        locale: ctx.getUiLanguage(),
      });

      if (!res?.success) {
        const err: Error & { code?: string } = new Error(
          res?.error || "VoiceLab cloud reasoning failed"
        );
        err.code = res?.code;
        throw err;
      }

      return res;
    });

    logger.logReasoning("VOICELAB_SUCCESS", {
      model: result.model,
      provider: "voicelab",
      resultLength: result.text.length,
      promptMode: result.promptMode,
      matchType: result.matchType,
    });

    return result.text;
  },
};
