export type CapabilitySource = "provider" | "preset" | "user" | "fallback";

export interface ModelCapabilities {
  modelName: string;
  contextWindow: number;
  maxOutputTokens: number;
  systemReserve: number;
  toolReserve: number;
  usableInputBudget: number;
  summarizationThreshold: number; // e.g. 75% of usableInputBudget
  source: CapabilitySource;
}

export interface ModelPreset {
  contextWindow: number;
  maxOutputTokens?: number;
}

export const KNOWN_MODEL_PRESETS: Record<string, ModelPreset> = {
  // Gemma presets
  "gemma4:12b": { contextWindow: 8192, maxOutputTokens: 2048 },
  "gemma4": { contextWindow: 8192, maxOutputTokens: 2048 },
  "gemma2:9b": { contextWindow: 8192, maxOutputTokens: 2048 },
  "gemma2:27b": { contextWindow: 8192, maxOutputTokens: 2048 },
  "gemma2": { contextWindow: 8192, maxOutputTokens: 2048 },

  // Qwen presets
  "qwen2.5:14b": { contextWindow: 32768, maxOutputTokens: 4096 },
  "qwen2.5:7b": { contextWindow: 32768, maxOutputTokens: 4096 },
  "qwen2.5:32b": { contextWindow: 32768, maxOutputTokens: 4096 },
  "qwen2.5": { contextWindow: 32768, maxOutputTokens: 4096 },

  // Llama presets
  "llama3.1": { contextWindow: 128000, maxOutputTokens: 4096 },
  "llama3.2": { contextWindow: 128000, maxOutputTokens: 4096 },
  "llama3.3": { contextWindow: 128000, maxOutputTokens: 4096 },

  // Gemini presets
  "gemini-2.5-flash": { contextWindow: 1048576, maxOutputTokens: 8192 },
  "gemini-2.0-flash": { contextWindow: 1048576, maxOutputTokens: 8192 },
  "gemini-1.5-flash": { contextWindow: 1048576, maxOutputTokens: 8192 },
  "gemini-1.5-pro": { contextWindow: 2097152, maxOutputTokens: 8192 },

  // Claude presets
  "claude-3-5-sonnet": { contextWindow: 200000, maxOutputTokens: 8192 },

  // OpenAI presets
  "gpt-4o": { contextWindow: 128000, maxOutputTokens: 4096 },
  "gpt-4o-mini": { contextWindow: 128000, maxOutputTokens: 4096 },
};

export const FALLBACK_CONTEXT_WINDOW = 4096;
export const DEFAULT_MAX_OUTPUT_TOKENS = 1024;
export const DEFAULT_SYSTEM_RESERVE = 1024;
export const DEFAULT_TOOL_RESERVE = 256;

export interface ResolveModelOptions {
  modelName?: string;
  provider?: string;
  providerReportedContext?: number;
  userContextSetting?: number;
  systemReserve?: number;
  toolReserve?: number;
  maxOutputTokens?: number;
}

/**
 * Resolves effective model capabilities with dynamic context calculation
 * Priority:
 * 1. Provider-reported capability
 * 2. Verified model preset
 * 3. User setting
 * 4. Conservative fallback (4096)
 */
export function resolveModelCapabilities(opts: ResolveModelOptions): ModelCapabilities {
  const modelName = (opts.modelName || "default").toLowerCase().trim();
  let contextWindow = FALLBACK_CONTEXT_WINDOW;
  let source: CapabilitySource = "fallback";
  let presetOutput = DEFAULT_MAX_OUTPUT_TOKENS;

  // 1. Provider capability
  if (typeof opts.providerReportedContext === "number" && opts.providerReportedContext > 0) {
    contextWindow = opts.providerReportedContext;
    source = "provider";
  } else {
    // 2. Verified model preset check
    let matchedPreset: ModelPreset | undefined;
    for (const [key, preset] of Object.entries(KNOWN_MODEL_PRESETS)) {
      if (modelName === key || modelName.startsWith(key) || modelName.includes(key)) {
        matchedPreset = preset;
        break;
      }
    }

    if (matchedPreset) {
      contextWindow = matchedPreset.contextWindow;
      presetOutput = matchedPreset.maxOutputTokens || DEFAULT_MAX_OUTPUT_TOKENS;
      source = "preset";
    } else if (typeof opts.userContextSetting === "number" && opts.userContextSetting >= 1024) {
      // 3. User setting
      contextWindow = opts.userContextSetting;
      source = "user";
    } else {
      // 4. Conservative fallback
      contextWindow = FALLBACK_CONTEXT_WINDOW;
      source = "fallback";
    }
  }

  const maxOutputTokens = opts.maxOutputTokens || presetOutput;
  const systemReserve = opts.systemReserve ?? DEFAULT_SYSTEM_RESERVE;
  const toolReserve = opts.toolReserve ?? DEFAULT_TOOL_RESERVE;

  // usableInputBudget = contextWindow - maxOutputTokens - systemReserve - toolReserve
  const usableInputBudget = Math.max(512, contextWindow - maxOutputTokens - systemReserve - toolReserve);

  // Summarization triggered when usable budget reaches 75%
  const summarizationThreshold = Math.round(usableInputBudget * 0.75);

  return {
    modelName,
    contextWindow,
    maxOutputTokens,
    systemReserve,
    toolReserve,
    usableInputBudget,
    summarizationThreshold,
    source,
  };
}
