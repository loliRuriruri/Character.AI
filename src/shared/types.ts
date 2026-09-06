export type LlmProvider = "ollama" | "gemini" | "easyproxy";

export type TtsProvider = "fish" | "voxcpm" | "irodori" | "web";

export type TtsStatus = "idle" | "loading" | "synthesizing" | "speaking";

export type GestureName = "idle" | "wave" | "nod" | "talk" | "cheer" | "sing" | "thinking" | "peace" | "shy" | "bow" | "curious" | "giggle" | "proud" | "explain" | "laugh" | "think" | "shoot" | "spin";

export type ChatMode = "free" | "rp" | "tutor";
export type ViewMode = "full" | "upper" | "pip";

export type TtsVoice = {
  id: string;
  displayName: string;
  wav: string;
  promptText: string;
  sourceWav?: string;
  durationSec?: number;
  rms?: number;
};

export type VoiceCatalog = {
  defaultId: string;
  notes?: string;
  voices: TtsVoice[];
};

export type SrsCard = {
  id: string;
  word: string;
  reading: string;
  meaning: string;
  exampleSentence?: string;
  repetition: number;
  intervalDays: number;
  easeFactor: number;
  nextReviewAt: number;
  createdAt: number;
};

export type AppSettings = {
  provider: LlmProvider;
  model: string;
  ollamaUrl: string;
  geminiApiKey: string;
  geminiModel: string;
  easyProxyUrl: string;
  pttKey: string;
  ttsEnabled: boolean;
  ttsProvider: TtsProvider;
  ttsWebFallback: boolean;
  ttsVoiceId: string;
  voxcpmPythonPath: string;
  voxcpmReferenceWav: string;
  voxcpmPromptText: string;
  voxcpmDevice: string;
  characterScale: number;
  vrmModelPath: string;
  vrmaMotionPath: string;
  chatMode: ChatMode;
  irodoriPythonPath: string;
  irodoriLoraId: string;
  viewMode: ViewMode;
  fishApiKey: string;
  fishVoiceId: string;
  fishLatency: "low" | "balanced" | "normal";
  userName?: string;
  callName?: string;
  relationship?: string;
};

export const defaultSettings: AppSettings = {
  provider: "ollama",
  model: "gemma4:12b",
  ollamaUrl: "http://127.0.0.1:11434",
  geminiApiKey: "",
  geminiModel: "gemini-2.5-flash",
  easyProxyUrl: "http://127.0.0.1:8317/v1/chat/completions",
  pttKey: "Space",
  ttsEnabled: true,
  ttsProvider: "voxcpm",
  ttsWebFallback: true,
  ttsVoiceId: "nilou",
  voxcpmPythonPath: "C:\\Users\\a4jud\\VoxCPM\\.venv\\Scripts\\python.exe",
  voxcpmReferenceWav: "C:\\TEST\\MikuChat-v3\\assets\\tts\\my_voice_ref.wav",
  voxcpmPromptText: "ノイズの多い環境でも、私の音声認識は正確です。あなたの囁き声も、一言も漏らさず拾えますよ。",
  voxcpmDevice: "auto",
  characterScale: 1.0,
  vrmModelPath: "/models/HatsuneMikuNT.vrm",
  vrmaMotionPath: "/models/idle_loop.vrma",
  chatMode: "free",
  irodoriPythonPath: "C:\\Users\\a4jud\\.vdc-engines\\Irodori-TTS\\.venv\\Scripts\\python.exe",
  irodoriLoraId: "Nilou3000",
  viewMode: "full",
  fishApiKey: "",
  fishVoiceId: "acc8237220d8470985ec9be6c4c480a9",
  fishLatency: "low",
  userName: "마스터",
  callName: "마스터",
  relationship: "서로 신뢰하고 편안하게 마음을 터놓는 가까운 파트너",
};

export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  role: ChatRole;
  content: string;
  displayProse?: string;
  actionCues?: string[];
  gesture?: GestureName;
  imageBase64?: string;
  tutorFeedback?: {
    correction?: string;
    explanation?: string;
    vocabulary?: { word: string; reading: string; meaning: string }[];
  };
};

export type EmotionName = "neutral" | "happy" | "angry" | "sad" | "surprised" | "relaxed";

export type ProviderHealthStatus = "HEALTHY" | "DEGRADED" | "RECONNECTING" | "OFFLINE";

export type AppState = {
  speaking: boolean;
  pttHeld: boolean;
  chatCollapsed: boolean;
  settings: AppSettings;
  emotion: EmotionName;
  gesture: GestureName;
  lastError: string | null;
  ttsStatus: TtsStatus;
  isThinking: boolean;
  cardsDueCount: number;
  viewMode: ViewMode;
  isMuted: boolean;
  providerHealth?: ProviderHealthStatus;
  providerHealthMessage?: string | null;
};
